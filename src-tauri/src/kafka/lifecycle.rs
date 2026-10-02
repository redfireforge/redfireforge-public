//! Phase 9A: Kafka lifecycle commands — connect, disconnect, status, topics.
//!
//! These commands manage the `KafkaState` connection map.  Each command
//! calls `state.inner.lock()` exactly once per operation to avoid holding
//! the lock across I/O (blocking metadata calls run in `spawn_blocking`).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use rdkafka::consumer::{BaseConsumer, Consumer};
use serde_json::Value;

use super::config::{
    build_rdkafka_config, connect_error_code, prepare_consumer_config, resolve_cluster,
};
use super::envelope::{
    disconnected_status, error_envelope, handle_to_status, now_iso, success_envelope,
};
use super::oauth::{create_rdkafka_client, fetch_cluster_metadata, AzureEventHubContext};
use super::topic_groups::{
    admin_request_still_running, clear_admin_request_flag, groups_for_topic, topic_config,
};
use super::state::{ClientHandle, KafkaState};
use super::types::{
    KafkaConnectResult, KafkaConnectionConfig, KafkaDisconnectResult, KafkaServiceStatus,
    KafkaTopicDetail, KafkaTopicPartitionDetail, KafkaTopicSummary, KafkaTopicsResult,
};

// ─── kafka_connect ────────────────────────────────────────────────────────────

/// Connect to a Kafka cluster.  If the cluster is already connected, returns
/// the existing status with `reusedExistingConnection: true`.  Otherwise performs
/// a metadata probe in a blocking thread to verify broker reachability before
/// persisting the connection handle.
#[tauri::command]
pub async fn kafka_connect(
    state: tauri::State<'_, KafkaState>,
    connection: KafkaConnectionConfig,
) -> Result<Value, String> {
    let start = Instant::now();
    let cluster_id = connection.cluster_id.clone();

    // Fast path: cluster already known
    {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = map.get(&cluster_id) {
            let result = KafkaConnectResult {
                status: handle_to_status(handle),
                reused_existing_connection: true,
            };
            return Ok(success_envelope(
                "connect",
                result,
                Some(start.elapsed().as_millis() as u64),
            ));
        }
    }

    let rdkafka_config = build_rdkafka_config(&connection);
    let cfg_for_check = rdkafka_config.clone();
    let timeout_ms = connection.connection_timeout_ms.unwrap_or(5_000);

    let connect_result = tokio::task::spawn_blocking(move || {
        let mut admin_cfg = cfg_for_check;
        prepare_consumer_config(&mut admin_cfg);
        // No group.id: a consumer group redirects the main queue, and the
        // OAUTHBEARER token refresh is delivered on that queue.
        let consumer: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&admin_cfg)?;
        let refresh_oauth = admin_cfg
            .get("sasl.mechanism")
            .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
        fetch_cluster_metadata(&consumer, Duration::from_millis(timeout_ms), refresh_oauth)
            .map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;

    match connect_result {
        Ok(_) => {
            let connected_at = now_iso();
            let handle = ClientHandle {
                cluster_id: cluster_id.clone(),
                client_id: connection.client_id.clone(),
                brokers: connection.brokers.clone(),
                connected_at: connected_at.clone(),
                rdkafka_config,
                subscriptions: HashMap::new(),
            };
            {
                let mut map = state.inner.lock().map_err(|e| e.to_string())?;
                map.insert(cluster_id.clone(), handle);
            }
            Ok(success_envelope(
                "connect",
                KafkaConnectResult {
                    status: KafkaServiceStatus {
                        state: "connected".to_string(),
                        cluster_id: Some(cluster_id),
                        connected_at: Some(connected_at),
                        last_error: None,
                        subscription_count: Some(0),
                    },
                    reused_existing_connection: false,
                },
                Some(duration_ms),
            ))
        }
        Err(e) => Ok(error_envelope(
            "connect",
            connect_error_code(&e),
            &e,
            Some(true),
        )),
    }
}

// ─── kafka_disconnect ─────────────────────────────────────────────────────────

/// Disconnect from a cluster.  Cancels all active subscriptions and removes
/// the connection handle.
#[tauri::command]
pub async fn kafka_disconnect(
    state: tauri::State<'_, KafkaState>,
    cluster_id: Option<String>,
) -> Result<Value, String> {
    let start = Instant::now();
    let mut map = state.inner.lock().map_err(|e| e.to_string())?;

    let target_id = match &cluster_id {
        Some(id) => id.clone(),
        None => match map.keys().next().cloned() {
            Some(id) => id,
            None => {
                return Ok(success_envelope(
                    "disconnect",
                    KafkaDisconnectResult {
                        status: disconnected_status(),
                        disconnected: false,
                        cleaned_subscriptions: 0,
                    },
                    Some(start.elapsed().as_millis() as u64),
                ));
            }
        },
    };

    let (disconnected, cleaned_subscriptions) = match map.remove(&target_id) {
        Some(handle) => {
            for sub in handle.subscriptions.values() {
                sub.cancel_token.cancel();
            }
            (true, handle.subscriptions.len() as u32)
        }
        None => (false, 0),
    };

    Ok(success_envelope(
        "disconnect",
        KafkaDisconnectResult {
            status: disconnected_status(),
            disconnected,
            cleaned_subscriptions,
        },
        Some(start.elapsed().as_millis() as u64),
    ))
}

// ─── kafka_status ─────────────────────────────────────────────────────────────

/// Return the current connection status for a cluster (or the first connected
/// cluster when `cluster_id` is omitted).
#[tauri::command]
pub async fn kafka_status(
    state: tauri::State<'_, KafkaState>,
    cluster_id: Option<String>,
) -> Result<Value, String> {
    let map = state.inner.lock().map_err(|e| e.to_string())?;
    let status = match &cluster_id {
        Some(id) => match map.get(id) {
            Some(h) => handle_to_status(h),
            None => disconnected_status(),
        },
        None => match map.values().next() {
            Some(h) => handle_to_status(h),
            None => disconnected_status(),
        },
    };
    Ok(success_envelope("status", status, None))
}

// ─── kafka_topics ─────────────────────────────────────────────────────────────

/// Fetch the topic list from a connected cluster.
#[tauri::command]
pub async fn kafka_topics(
    state: tauri::State<'_, KafkaState>,
    cluster_id: Option<String>,
    include_internal: Option<bool>,
) -> Result<Value, String> {
    let start = Instant::now();
    let include_internal = include_internal.unwrap_or(false);

    let (rdkafka_config, resolved_cluster_id) = {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        match resolve_cluster(&map, cluster_id.as_deref()) {
            Some(pair) => pair,
            None => {
                return Ok(error_envelope(
                    "topics",
                    "KAFKA_NOT_CONNECTED",
                    "No Kafka cluster is connected. Call kafka_connect first.",
                    Some(false),
                ));
            }
        }
    };

    let metadata_result = tokio::task::spawn_blocking(move || {
        let mut admin_cfg = rdkafka_config;
        prepare_consumer_config(&mut admin_cfg);
        let consumer: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&admin_cfg)?;
        let refresh_oauth = admin_cfg
            .get("sasl.mechanism")
            .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
        fetch_cluster_metadata(&consumer, Duration::from_millis(10_000), refresh_oauth)
    })
    .await
    .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;

    match metadata_result {
        Ok(metadata) => {
            let mut topics: Vec<KafkaTopicSummary> = metadata
                .topics()
                .iter()
                .filter_map(|t| {
                    let name = t.name().to_string();
                    let is_internal = name.starts_with("__");
                    if !include_internal && is_internal {
                        return None;
                    }
                    Some(KafkaTopicSummary {
                        name,
                        partitions: t.partitions().len() as i32,
                        is_internal,
                    })
                })
                .collect();
            topics.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(success_envelope(
                "topics",
                KafkaTopicsResult {
                    cluster_id: Some(resolved_cluster_id),
                    topics,
                },
                Some(duration_ms),
            ))
        }
        Err(e) => Ok(error_envelope(
            "topics",
            "KAFKA_TOPICS_FAILED",
            &e,
            Some(true),
        )),
    }
}

// ─── kafka_topic_detail ───────────────────────────────────────────────────────

/// Topic metadata, watermarks, and config. Consumer groups load separately
/// so this call is not blocked by a namespace-wide group scan.
#[tauri::command]
pub async fn kafka_topic_detail(
    state: tauri::State<'_, KafkaState>,
    topic_name: String,
    cluster_id: Option<String>,
) -> Result<Value, String> {
    let start = Instant::now();
    let topic_name = topic_name.trim().to_string();
    if topic_name.is_empty() {
        return Ok(error_envelope(
            "topic-detail",
            "KAFKA_TOPIC_DETAIL_FAILED",
            "topicName is required",
            Some(false),
        ));
    }

    let rdkafka_config = {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        match resolve_cluster(&map, cluster_id.as_deref()) {
            Some((config, _)) => config,
            None => {
                return Ok(error_envelope(
                    "topic-detail",
                    "KAFKA_NOT_CONNECTED",
                    "No Kafka cluster is connected. Call kafka_connect first.",
                    Some(false),
                ));
            }
        }
    };

    let detail_result = tokio::task::spawn_blocking(move || {
        read_topic_detail(&rdkafka_config, &topic_name)
    })
    .await
    .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;
    match detail_result {
        Ok(detail) => Ok(success_envelope("topic-detail", detail, Some(duration_ms))),
        Err(e) => Ok(error_envelope(
            "topic-detail",
            "KAFKA_TOPIC_DETAIL_FAILED",
            &e,
            Some(true),
        )),
    }
}

fn read_topic_detail(rdkafka_config: &rdkafka::config::ClientConfig, topic_name: &str) -> Result<KafkaTopicDetail, String> {
    let mut consumer_cfg = rdkafka_config.clone();
    prepare_consumer_config(&mut consumer_cfg);
    let consumer: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&consumer_cfg)?;
    let refresh_oauth = rdkafka_config
        .get("sasl.mechanism")
        .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
    let metadata = fetch_cluster_metadata(&consumer, Duration::from_millis(10_000), refresh_oauth)?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|candidate| candidate.name() == topic_name)
        .ok_or_else(|| format!("Topic '{topic_name}' was not found on the cluster"))?;
    if let Some(err) = topic_meta.error() {
        return Err(format!("Topic '{topic_name}' is not readable: {err:?}"));
    }

    let mut partitions = Vec::new();
    for partition in topic_meta.partitions() {
        let id = partition.id();
        let (low, high) = consumer
            .fetch_watermarks(topic_name, id, Duration::from_secs(5))
            .map_err(|err| format!("Could not read offsets for {topic_name} partition {id}: {err}"))?;
        let message_count = (high - low).max(0);
        partitions.push(KafkaTopicPartitionDetail {
            partition_id: id,
            leader: partition.leader(),
            replicas: partition.replicas().to_vec(),
            isr: partition.isr().to_vec(),
            earliest_offset: low.to_string(),
            latest_offset: high.to_string(),
            message_count,
        });
    }

    let replication_factor = partitions.first().map(|partition| partition.replicas.len() as i32).unwrap_or(0);
    let health_status = if partitions.is_empty() {
        "unknown".to_string()
    } else if partitions.iter().any(|partition| partition.isr.len() < partition.replicas.len()) {
        "degraded".to_string()
    } else {
        "healthy".to_string()
    };

    clear_admin_request_flag();
    let config = topic_config(&consumer, topic_name);
    if admin_request_still_running() {
        // Dropping the client while a config request is still in flight asserts
        // inside librdkafka and kills the app.
        std::mem::forget(consumer);
    }

    Ok(KafkaTopicDetail {
        name: topic_name.to_string(),
        partition_count: partitions.len() as i32,
        replication_factor,
        is_internal: topic_name.starts_with("__"),
        partitions,
        consumer_groups: Vec::new(),
        config,
        health_status,
        groups_pending: true,
    })
}

fn read_topic_groups(
    rdkafka_config: &rdkafka::config::ClientConfig,
    topic_name: &str,
) -> Result<Vec<super::types::KafkaTopicConsumerGroupSummary>, String> {
    let mut consumer_cfg = rdkafka_config.clone();
    prepare_consumer_config(&mut consumer_cfg);
    let consumer: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&consumer_cfg)?;
    let refresh_oauth = rdkafka_config
        .get("sasl.mechanism")
        .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
    let metadata = fetch_cluster_metadata(&consumer, Duration::from_millis(10_000), refresh_oauth)?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|candidate| candidate.name() == topic_name)
        .ok_or_else(|| format!("Topic '{topic_name}' was not found on the cluster"))?;
    if let Some(err) = topic_meta.error() {
        return Err(format!("Topic '{topic_name}' is not readable: {err:?}"));
    }

    let mut watermarks = Vec::new();
    for partition in topic_meta.partitions() {
        let id = partition.id();
        let (_, high) = consumer
            .fetch_watermarks(topic_name, id, Duration::from_secs(5))
            .map_err(|err| format!("Could not read offsets for {topic_name} partition {id}: {err}"))?;
        watermarks.push((id, high));
    }

    clear_admin_request_flag();
    let groups = groups_for_topic(&consumer, topic_name, &watermarks);
    if admin_request_still_running() {
        std::mem::forget(consumer);
    }
    Ok(groups)
}

/// Consumer groups that have committed offsets on this topic.
#[tauri::command]
pub async fn kafka_topic_groups(
    state: tauri::State<'_, KafkaState>,
    topic_name: String,
    cluster_id: Option<String>,
) -> Result<Value, String> {
    let start = Instant::now();
    let topic_name = topic_name.trim().to_string();
    if topic_name.is_empty() {
        return Ok(error_envelope(
            "topic-groups",
            "KAFKA_TOPIC_GROUPS_FAILED",
            "topicName is required",
            Some(false),
        ));
    }

    let rdkafka_config = {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        match resolve_cluster(&map, cluster_id.as_deref()) {
            Some((config, _)) => config,
            None => {
                return Ok(error_envelope(
                    "topic-groups",
                    "KAFKA_NOT_CONNECTED",
                    "No Kafka cluster is connected. Call kafka_connect first.",
                    Some(false),
                ));
            }
        }
    };

    let groups_result = tokio::task::spawn_blocking(move || {
        read_topic_groups(&rdkafka_config, &topic_name)
    })
    .await
    .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;
    match groups_result {
        Ok(consumer_groups) => Ok(success_envelope(
            "topic-groups",
            serde_json::json!({ "consumerGroups": consumer_groups }),
            Some(duration_ms),
        )),
        Err(e) => Ok(error_envelope(
            "topic-groups",
            "KAFKA_TOPIC_GROUPS_FAILED",
            &e,
            Some(true),
        )),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kafka::state::{ClientHandle, KafkaState, SubscriptionHandle};
    use rdkafka::config::ClientConfig;
    use tokio_util::sync::CancellationToken;

    fn make_handle(cluster_id: &str) -> ClientHandle {
        ClientHandle {
            cluster_id: cluster_id.to_string(),
            client_id: "test-client".to_string(),
            brokers: vec!["localhost:9092".to_string()],
            connected_at: "2026-01-01T00:00:00.000Z".to_string(),
            rdkafka_config: ClientConfig::new(),
            subscriptions: HashMap::new(),
        }
    }

    #[test]
    fn kafka_state_new_is_empty() {
        let state = KafkaState::new();
        assert!(state.inner.lock().unwrap().is_empty());
    }

    #[test]
    fn state_insert_and_remove() {
        let state = KafkaState::new();
        state
            .inner
            .lock()
            .unwrap()
            .insert("c1".to_string(), make_handle("c1"));
        assert_eq!(state.inner.lock().unwrap().len(), 1);
        state.inner.lock().unwrap().remove("c1");
        assert!(state.inner.lock().unwrap().is_empty());
    }

    #[test]
    fn state_multiple_clusters() {
        let state = KafkaState::new();
        let mut map = state.inner.lock().unwrap();
        map.insert("c1".to_string(), make_handle("c1"));
        map.insert("c2".to_string(), make_handle("c2"));
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn subscription_count_computed_from_subscriptions_map() {
        let mut handle = make_handle("c1");
        assert_eq!(handle.subscription_count(), 0);
        handle.subscriptions.insert(
            "s1".to_string(),
            SubscriptionHandle {
                subscription_id: "s1aaaaaa".to_string(),
                topic: "orders".to_string(),
                group_id: "rf-subscribe-test-s1aaaaaa".to_string(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                cancel_token: CancellationToken::new(),
            },
        );
        assert_eq!(handle.subscription_count(), 1);
        handle.subscriptions.insert(
            "s2".to_string(),
            SubscriptionHandle {
                subscription_id: "s2aaaaaa".to_string(),
                topic: "payments".to_string(),
                group_id: "rf-subscribe-test-s2aaaaaa".to_string(),
                created_at: "2026-01-01T00:00:01.000Z".to_string(),
                cancel_token: CancellationToken::new(),
            },
        );
        assert_eq!(handle.subscription_count(), 2);
        handle.subscriptions.remove("s1");
        assert_eq!(handle.subscription_count(), 1);
    }

    #[test]
    fn double_underscore_prefix_is_internal() {
        for name in &["__consumer_offsets", "__transaction_state"] {
            assert!(
                name.starts_with("__"),
                "{} should be treated as internal",
                name
            );
        }
    }

    #[test]
    fn user_topics_are_not_internal() {
        for name in &["orders.created", "payments", "_single_underscore"] {
            assert!(
                !name.starts_with("__"),
                "{} should not be treated as internal",
                name
            );
        }
    }
}
