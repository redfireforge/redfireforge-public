//! Phase 9B: Kafka operation commands — produce, consume-once, subscribe,
//! unsubscribe, subscriptions.
//!
//! `kafka_subscribe` pre-registers the `SubscriptionHandle` in state *before*
//! spawning the background task so that `kafka_unsubscribe` and `kafka_disconnect`
//! can always find and cancel the subscription (eliminates the TTRT race).
//! The background task self-cleans from state when the consumer stream ends or
//! errors without an explicit cancel (mirrors server-side `.catch()` cleanup).

use std::time::{Duration, Instant};

use futures::StreamExt;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::error::KafkaError;
use rdkafka::message::OwnedHeaders;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde_json::Value;
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::config::{is_auth_error, resolve_cluster};
use super::consume_assign::consume_assigned;
use super::envelope::{error_envelope, now_iso, success_envelope};
use super::message::{consume_record_from_message, matches_filter};
use super::oauth::{create_rdkafka_client, AzureEventHubContext};
use super::state::{KafkaState, SubscriptionHandle};
use super::types::{
    KafkaConsumeOnceRequest, KafkaProduceRecordResult, KafkaProduceRequest,
    KafkaProduceResult, KafkaSubscribeInfo, KafkaSubscribeRequest, KafkaSubscribeResult,
    KafkaSubscriptionEndedPayload, KafkaSubscriptionErrorPayload, KafkaSubscriptionEventPayload,
    KafkaSubscriptionsResult,
    KafkaUnsubscribeRequest, KafkaUnsubscribeResult,
};

// ─── kafka_produce ────────────────────────────────────────────────────────────

/// Produce one or more messages to a Kafka topic.
/// Creates a short-lived `FutureProducer`, sends all messages, then drops it.
/// Per-message `acks`, `partition`, and `timestamp` are supported.
#[tauri::command]
pub async fn kafka_produce(
    state: tauri::State<'_, KafkaState>,
    request: KafkaProduceRequest,
) -> Result<Value, String> {
    let start = Instant::now();

    if request.topic.trim().is_empty() {
        return Ok(error_envelope(
            "produce",
            "KAFKA_INVALID_PRODUCE",
            "topic is required",
            Some(false),
        ));
    }
    if request.messages.is_empty() {
        return Ok(error_envelope(
            "produce",
            "KAFKA_INVALID_PRODUCE",
            "messages array must not be empty",
            Some(false),
        ));
    }

    let (rdkafka_config, cluster_id) = {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        match resolve_cluster(&map, request.cluster_id.as_deref()) {
            Some(pair) => pair,
            None => {
                return Ok(error_envelope(
                    "produce",
                    "KAFKA_NOT_CONNECTED",
                    "No Kafka cluster is connected. Call kafka_connect first.",
                    Some(false),
                ));
            }
        }
    };

    let topic = request.topic.clone();
    let messages = request.messages.clone();
    let timeout_ms = request.timeout_ms.unwrap_or(10_000);
    let acks = request.acks;

    let produce_result: Result<Vec<KafkaProduceRecordResult>, String> =
        tokio::task::spawn_blocking(move || {
            let mut producer_cfg = rdkafka_config;
            if let Some(a) = acks {
                producer_cfg.set("request.required.acks", &a.to_string());
            }
            let producer: FutureProducer<AzureEventHubContext> =
                create_rdkafka_client(&producer_cfg)?;
            let rt = tokio::runtime::Handle::current();
            let mut records = Vec::with_capacity(messages.len());

            for msg in &messages {
                let mut owned_headers = OwnedHeaders::new();
                if let Some(headers) = &msg.headers {
                    for (k, v) in headers {
                        owned_headers = owned_headers.insert(rdkafka::message::Header {
                            key: k,
                            value: Some(v.as_bytes()),
                        });
                    }
                }

                let mut record = FutureRecord::to(&topic)
                    .payload(msg.value.as_bytes())
                    .headers(owned_headers);

                if let Some(key) = &msg.key {
                    record = record.key(key.as_str());
                }
                if let Some(partition) = msg.partition {
                    record = record.partition(partition);
                }
                if let Some(ts_str) = &msg.timestamp {
                    if let Ok(ts_ms) = ts_str.parse::<i64>() {
                        record = record.timestamp(ts_ms);
                    }
                }

                let delivery = rt
                    .block_on(producer.send(record, Duration::from_millis(timeout_ms)))
                    .map_err(|(err, _)| err.to_string())?;

                records.push(KafkaProduceRecordResult {
                    partition: delivery.0,
                    offset: delivery.1.to_string(),
                    timestamp: None,
                });
            }
            Ok(records)
        })
        .await
        .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;
    match produce_result {
        Ok(records) => Ok(success_envelope(
            "produce",
            KafkaProduceResult {
                cluster_id: Some(cluster_id),
                topic: request.topic,
                sent_count: records.len(),
                records,
            },
            Some(duration_ms),
        )),
        Err(e) => {
            let code = if is_auth_error(&e) {
                "KAFKA_AUTH_FAILED"
            } else {
                "KAFKA_PRODUCE_FAILED"
            };
            let retryable = code != "KAFKA_AUTH_FAILED";
            Ok(error_envelope("produce", code, &e, Some(retryable)))
        }
    }
}

// ─── kafka_consume_once ───────────────────────────────────────────────────────

/// Consume up to `maxMessages` messages from a topic, stopping at `timeoutMs`.
#[tauri::command]
pub async fn kafka_consume_once(
    state: tauri::State<'_, KafkaState>,
    request: KafkaConsumeOnceRequest,
) -> Result<Value, String> {
    let start = Instant::now();

    if request.topic.trim().is_empty() {
        return Ok(error_envelope(
            "consume-once",
            "KAFKA_INVALID_CONSUME_ONCE",
            "topic is required",
            Some(false),
        ));
    }

    let (rdkafka_config, _cluster_id) = {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        match resolve_cluster(&map, request.cluster_id.as_deref()) {
            Some(pair) => pair,
            None => {
                return Ok(error_envelope(
                    "consume-once",
                    "KAFKA_NOT_CONNECTED",
                    "No Kafka cluster is connected. Call kafka_connect first.",
                    Some(false),
                ));
            }
        }
    };

    let max_messages = request.max_messages.unwrap_or(1).max(1);
    let timeout_ms = request.timeout_ms.unwrap_or(10_000);
    let topic = request.topic.clone();
    let from_beginning = request.from_beginning.unwrap_or(false);
    let sort_desc = request.sort_order.as_deref() == Some("desc");
    let seek_offsets = request.seek_offsets.clone();
    let partition = request.partition;
    let filter = request.filter.clone();
    let oauth = rdkafka_config
        .get("sasl.mechanism")
        .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
    // librdkafka assign() requires a group id. Event Hubs already has $Default.
    // A generated id is not created on the namespace because we assign partitions
    // instead of joining the group.
    let group_id = if oauth {
        "$Default".to_string()
    } else {
        request.group_id.clone().unwrap_or_else(|| {
            format!("rf-read-{}", &Uuid::new_v4().to_string()[..8])
        })
    };

    let consume_result = tokio::task::spawn_blocking(move || {
        consume_assigned(
            rdkafka_config,
            &group_id,
            &topic,
            partition,
            from_beginning,
            sort_desc,
            seek_offsets,
            max_messages,
            timeout_ms,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;
    match consume_result {
        Ok(result) => Ok(success_envelope("consume-once", result, Some(duration_ms))),
        Err(e) => Ok(error_envelope(
            "consume-once",
            "KAFKA_CONSUME_ONCE_FAILED",
            &e,
            Some(true),
        )),
    }
}

// ─── kafka_subscribe ─────────────────────────────────────────────────────────

/// Start a long-lived streaming subscription.  Returns the subscription info
/// immediately.  Messages are emitted as `"kafka-subscription-message"` events.
///
/// The `SubscriptionHandle` is inserted into state **before** spawning the
/// background task so that concurrent `kafka_unsubscribe` / `kafka_disconnect`
/// calls can always find and cancel it.
#[tauri::command]
pub async fn kafka_subscribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, KafkaState>,
    request: KafkaSubscribeRequest,
) -> Result<Value, String> {
    let start = Instant::now();

    if request.topic.trim().is_empty() {
        return Ok(error_envelope(
            "subscribe",
            "KAFKA_INVALID_SUBSCRIBE",
            "topic is required",
            Some(false),
        ));
    }

    let (rdkafka_config, cluster_id) = {
        let map = state.inner.lock().map_err(|e| e.to_string())?;
        match resolve_cluster(&map, request.cluster_id.as_deref()) {
            Some(pair) => pair,
            None => {
                return Ok(error_envelope(
                    "subscribe",
                    "KAFKA_NOT_CONNECTED",
                    "No Kafka cluster is connected. Call kafka_connect first.",
                    Some(false),
                ));
            }
        }
    };

    let subscription_id = Uuid::new_v4().to_string();
    let topic = request.topic.clone();
    let from_beginning = request.from_beginning.unwrap_or(false);
    let filter = request.filter.clone();
    let max_messages = request.max_messages.unwrap_or(50).clamp(1, 10_000);
    let created_at = now_iso();
    // Event Hubs does not create consumer groups on subscribe. Assign the
    // partitions on `$Default` instead, the same way Consume Once reads.
    let oauth = rdkafka_config
        .get("sasl.mechanism")
        .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
    let group_id = if oauth {
        "$Default".to_string()
    } else {
        request.group_id.clone().unwrap_or_else(|| {
            format!("rf-subscribe-{}-{}", cluster_id, &subscription_id[..8])
        })
    };

    let assignment = if oauth {
        let probe_cfg = rdkafka_config.clone();
        let probe_topic = topic.clone();
        let ids = match tokio::task::spawn_blocking(move || {
            super::consume_assign::stream_partition_ids(
                probe_cfg,
                &probe_topic,
                Duration::from_secs(10),
            )
        })
        .await
        {
            Ok(Ok(ids)) => ids,
            Ok(Err(err)) => {
                return Ok(error_envelope(
                    "subscribe",
                    "KAFKA_SUBSCRIBE_FAILED",
                    &err,
                    Some(true),
                ));
            }
            Err(err) => {
                return Ok(error_envelope(
                    "subscribe",
                    "KAFKA_SUBSCRIBE_FAILED",
                    &err.to_string(),
                    Some(true),
                ));
            }
        };
        match super::consume_assign::build_stream_assignment(&topic, &ids, from_beginning) {
            Ok(list) => Some(list),
            Err(err) => {
                return Ok(error_envelope(
                    "subscribe",
                    "KAFKA_SUBSCRIBE_FAILED",
                    &err,
                    Some(true),
                ));
            }
        }
    } else {
        None
    };

    let mut consumer_cfg = rdkafka_config;
    super::config::prepare_consumer_config(&mut consumer_cfg);
    consumer_cfg.set("group.id", &group_id);
    if oauth {
        consumer_cfg.set("enable.auto.commit", "false");
        consumer_cfg.set("enable.auto.offset.store", "false");
        consumer_cfg.set("enable.partition.eof", "false");
    } else {
        consumer_cfg.set("enable.auto.commit", "true");
        consumer_cfg.set(
            "auto.offset.reset",
            if from_beginning { "earliest" } else { "latest" },
        );
    }

    let consumer: StreamConsumer<AzureEventHubContext> = match create_rdkafka_client(&consumer_cfg)
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(error_envelope(
                "subscribe",
                "KAFKA_SUBSCRIBE_FAILED",
                &e.to_string(),
                Some(true),
            ));
        }
    };
    let attached = if let Some(partitions) = &assignment {
        consumer.assign(partitions)
    } else {
        consumer.subscribe(&[topic.as_str()])
    };
    if let Err(e) = attached {
        return Ok(error_envelope(
            "subscribe",
            "KAFKA_SUBSCRIBE_FAILED",
            &e.to_string(),
            Some(true),
        ));
    }

    let cancel_token = CancellationToken::new();
    let cancel_token_bg = cancel_token.clone();
    let sub_id_bg = subscription_id.clone();
    let cluster_id_bg = cluster_id.clone();
    let app_bg = app.clone();

    // Register subscription BEFORE spawn to eliminate the TTRT cancel race.
    {
        let mut map = state.inner.lock().map_err(|e| e.to_string())?;
        match map.get_mut(&cluster_id) {
            Some(handle) => {
                handle.subscriptions.insert(
                    subscription_id.clone(),
                    SubscriptionHandle {
                        subscription_id: subscription_id.clone(),
                        topic: topic.clone(),
                        group_id: group_id.clone(),
                        created_at: created_at.clone(),
                        cancel_token,
                    },
                );
            }
            None => {
                return Ok(error_envelope(
                    "subscribe",
                    "KAFKA_NOT_CONNECTED",
                    "Kafka cluster was disconnected before the subscription could be registered.",
                    Some(false),
                ));
            }
        }
    }

    tokio::spawn(async move {
        let stream = consumer.stream();
        tokio::pin!(stream);
        let mut sent: usize = 0;
        let mut hit_max = false;
        let cancelled = loop {
            tokio::select! {
                biased;
                _ = cancel_token_bg.cancelled() => break true,
                msg_opt = stream.next() => {
                    match msg_opt {
                        Some(Ok(msg)) => {
                            let record = consume_record_from_message(&msg);
                            if !matches_filter(&record, filter.as_ref()) {
                                continue;
                            }
                            let payload = KafkaSubscriptionEventPayload {
                                subscription_id: sub_id_bg.clone(),
                                record,
                            };
                            let _ = app_bg.emit("kafka-subscription-message", payload);
                            sent += 1;
                            if sent >= max_messages {
                                hit_max = true;
                                break false;
                            }
                        }
                        Some(Err(KafkaError::PartitionEOF(_))) => {}
                        Some(Err(err)) => {
                            let _ = app_bg.emit(
                                "kafka-subscription-error",
                                KafkaSubscriptionErrorPayload {
                                    subscription_id: sub_id_bg.clone(),
                                    message: err.to_string(),
                                },
                            );
                            break false;
                        }
                        None => break false,
                    }
                }
            }
        };

        if hit_max {
            let _ = app_bg.emit(
                "kafka-subscription-ended",
                KafkaSubscriptionEndedPayload {
                    subscription_id: sub_id_bg.clone(),
                    reason: "max-reached".to_string(),
                },
            );
            // Stay registered until the UI unsubscribes, so Stop can still find it.
            cancel_token_bg.cancelled().await;
        } else if !cancelled {
            if let Ok(mut map) = app_bg.state::<KafkaState>().inner.lock() {
                if let Some(handle) = map.get_mut(&cluster_id_bg) {
                    handle.subscriptions.remove(&sub_id_bg);
                }
            }
        }
    });

    let duration_ms = start.elapsed().as_millis() as u64;
    Ok(success_envelope(
        "subscribe",
        KafkaSubscribeResult {
            cluster_id: Some(cluster_id),
            subscription: KafkaSubscribeInfo {
                subscription_id,
                topic,
                group_id,
                created_at,
            },
        },
        Some(duration_ms),
    ))
}

// ─── kafka_unsubscribe ────────────────────────────────────────────────────────

/// Cancel a streaming subscription by ID.
#[tauri::command]
pub async fn kafka_unsubscribe(
    state: tauri::State<'_, KafkaState>,
    request: KafkaUnsubscribeRequest,
) -> Result<Value, String> {
    let start = Instant::now();
    let mut map = state.inner.lock().map_err(|e| e.to_string())?;

    let mut found_cluster_id: Option<String> = None;
    for handle in map.values_mut() {
        if let Some(sub) = handle.subscriptions.remove(&request.subscription_id) {
            sub.cancel_token.cancel();
            found_cluster_id = Some(handle.cluster_id.clone());
            break;
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    match found_cluster_id {
        Some(cluster_id) => Ok(success_envelope(
            "unsubscribe",
            KafkaUnsubscribeResult {
                cluster_id: Some(cluster_id),
                subscription_id: request.subscription_id,
                unsubscribed: true,
            },
            Some(duration_ms),
        )),
        None => Ok(error_envelope(
            "unsubscribe",
            "KAFKA_SUBSCRIPTION_NOT_FOUND",
            &format!("Subscription '{}' does not exist", request.subscription_id),
            Some(false),
        )),
    }
}

// ─── kafka_subscriptions ──────────────────────────────────────────────────────

/// List all active streaming subscriptions for a cluster.
#[tauri::command]
pub async fn kafka_subscriptions(
    state: tauri::State<'_, KafkaState>,
    cluster_id: Option<String>,
) -> Result<Value, String> {
    let map = state.inner.lock().map_err(|e| e.to_string())?;
    let handle = match &cluster_id {
        Some(id) => map.get(id),
        None => map.values().next(),
    };
    match handle {
        Some(h) => {
            let subscriptions: Vec<KafkaSubscribeInfo> = h
                .subscriptions
                .values()
                .map(|sub| KafkaSubscribeInfo {
                    subscription_id: sub.subscription_id.clone(),
                    topic: sub.topic.clone(),
                    group_id: sub.group_id.clone(),
                    created_at: sub.created_at.clone(),
                })
                .collect();
            Ok(success_envelope(
                "subscriptions",
                KafkaSubscriptionsResult {
                    cluster_id: Some(h.cluster_id.clone()),
                    subscriptions,
                },
                None,
            ))
        }
        None => Ok(success_envelope(
            "subscriptions",
            KafkaSubscriptionsResult {
                cluster_id: None,
                subscriptions: vec![],
            },
            None,
        )),
    }
}
