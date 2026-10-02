//! Contract types aligned with `src-server/kafka/contracts.ts`.
//! All input types use `#[serde(rename_all = "camelCase")]` to match the
//! camelCase JSON payloads coming from the frontend via `@tauri-apps/api/core`.
//! All output types use the same to produce camelCase JSON for the TypeScript
//! response parsers in Phase 9C.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Input types ──────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaAuthConfig {
    pub mode: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaTlsConfig {
    pub enabled: bool,
    pub reject_unauthorized: Option<bool>,
    /// SNI override — not supported in rdkafka 0.37; accepted for API parity.
    #[allow(dead_code)]
    pub server_name: Option<String>,
    pub ca_pem: Option<String>,
    pub cert_pem: Option<String>,
    pub key_pem: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConnectionConfig {
    pub cluster_id: String,
    pub client_id: String,
    pub brokers: Vec<String>,
    pub connection_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
    pub auth: Option<KafkaAuthConfig>,
    pub tls: Option<KafkaTlsConfig>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaProduceMessage {
    pub key: Option<String>,
    pub value: String,
    pub headers: Option<HashMap<String, String>>,
    pub partition: Option<i32>,
    /// Millis-since-epoch as a string, matching kafkajs convention.
    pub timestamp: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaProduceRequest {
    pub cluster_id: Option<String>,
    pub topic: String,
    pub messages: Vec<KafkaProduceMessage>,
    /// Optional producer acks: 0 = none, 1 = leader, -1 = all replicas.
    pub acks: Option<i32>,
    pub timeout_ms: Option<u64>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaMessageFilter {
    pub key_equals: Option<String>,
    pub headers_match: Option<HashMap<String, String>>,
    pub json_path: Option<String>,
    pub json_equals: Option<String>,
    /// Case-insensitive substring of the raw message value.
    #[serde(default)]
    pub body_contains: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct KafkaConsumeOnceRequest {
    pub cluster_id: Option<String>,
    pub topic: String,
    pub group_id: Option<String>,
    pub from_beginning: Option<bool>,
    pub timeout_ms: Option<u64>,
    pub max_messages: Option<usize>,
    pub filter: Option<KafkaMessageFilter>,
    pub sort_order: Option<String>,
    pub seek_offsets: Option<Vec<KafkaSeekOffset>>,
    pub partition: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSeekOffset {
    pub partition: i32,
    pub offset: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscribeRequest {
    pub cluster_id: Option<String>,
    pub topic: String,
    pub group_id: Option<String>,
    pub from_beginning: Option<bool>,
    pub filter: Option<KafkaMessageFilter>,
    /// Stop after this many messages that pass the filter.
    pub max_messages: Option<usize>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaUnsubscribeRequest {
    /// Retained for future multi-cluster routing; not yet consumed server-side.
    #[allow(dead_code)]
    pub cluster_id: Option<String>,
    pub subscription_id: String,
}

// ─── Envelope types ───────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaEnvelopeMeta {
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Serialize, Debug)]
pub struct KafkaSuccessEnvelope<T: Serialize> {
    pub ok: bool,
    pub op: String,
    pub data: T,
    pub meta: KafkaEnvelopeMeta,
}

#[derive(Serialize, Debug)]
pub struct KafkaErrorEnvelope {
    pub ok: bool,
    pub op: String,
    pub error: KafkaErrorBody,
    pub meta: KafkaEnvelopeMeta,
}

#[derive(Serialize, Debug)]
pub struct KafkaErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
}

// ─── Output types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaServiceStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_count: Option<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConnectResult {
    pub status: KafkaServiceStatus,
    pub reused_existing_connection: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaDisconnectResult {
    pub status: KafkaServiceStatus,
    pub disconnected: bool,
    pub cleaned_subscriptions: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaTopicSummary {
    pub name: String,
    pub partitions: i32,
    pub is_internal: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaTopicsResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    pub topics: Vec<KafkaTopicSummary>,
}

/// Aligned with `KafkaTopicPartitionDetail` in contracts.ts.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaTopicPartitionDetail {
    pub partition_id: i32,
    pub leader: i32,
    pub replicas: Vec<i32>,
    pub isr: Vec<i32>,
    pub earliest_offset: String,
    pub latest_offset: String,
    pub message_count: i64,
}

/// Aligned with `KafkaTopicConsumerGroupSummary` in contracts.ts.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaTopicConsumerGroupSummary {
    pub group_id: String,
    pub state: String,
    pub total_lag: i64,
}

/// Aligned with `KafkaTopicDetail` in contracts.ts.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaTopicDetail {
    pub name: String,
    pub partition_count: i32,
    pub replication_factor: i32,
    pub is_internal: bool,
    pub partitions: Vec<KafkaTopicPartitionDetail>,
    pub consumer_groups: Vec<KafkaTopicConsumerGroupSummary>,
    pub config: HashMap<String, String>,
    pub health_status: String,
    /// True when consumer groups are still loading. Partitions and config are ready.
    pub groups_pending: bool,
}

/// Aligned with `KafkaProduceRecordResult` in contracts.ts.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaProduceRecordResult {
    pub partition: i32,
    pub offset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// Aligned with `KafkaProduceResult` in contracts.ts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaProduceResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    pub topic: String,
    pub sent_count: usize,
    pub records: Vec<KafkaProduceRecordResult>,
}

/// Aligned with `KafkaConsumeRecord` in contracts.ts.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConsumeRecord {
    pub topic: String,
    pub partition: i32,
    pub offset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
}

/// Aligned with `KafkaConsumeResult` in contracts.ts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConsumeResult {
    pub message_count: usize,
    pub messages: Vec<KafkaConsumeRecord>,
    pub timed_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<Vec<KafkaSeekOffset>>,
}

/// Aligned with `KafkaSubscribeInfo` in contracts.ts.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscribeInfo {
    pub subscription_id: String,
    pub topic: String,
    pub group_id: String,
    pub created_at: String,
}

/// Aligned with `KafkaSubscribeResult` in contracts.ts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscribeResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    pub subscription: KafkaSubscribeInfo,
}

/// Aligned with `KafkaSubscriptionsResult` in contracts.ts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscriptionsResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    pub subscriptions: Vec<KafkaSubscribeInfo>,
}

/// Aligned with `KafkaUnsubscribeResult` in contracts.ts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KafkaUnsubscribeResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    pub subscription_id: String,
    pub unsubscribed: bool,
}

/// Payload emitted for each streaming message via the `"kafka-subscription-message"` Tauri event.
/// Shape: `{ subscriptionId: string, record: KafkaConsumeRecord }`
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscriptionEventPayload {
    pub subscription_id: String,
    pub record: KafkaConsumeRecord,
}

/// Broker failure for a live stream. Emitted as `"kafka-subscription-error"`.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscriptionErrorPayload {
    pub subscription_id: String,
    pub message: String,
}

/// The live reader stopped because it reached Max Messages.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KafkaSubscriptionEndedPayload {
    pub subscription_id: String,
    pub reason: String,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kafka_connect_result_camel_case() {
        let result = KafkaConnectResult {
            status: KafkaServiceStatus {
                state: "connected".to_string(),
                cluster_id: Some("c1".to_string()),
                connected_at: Some("2026-01-01T00:00:00.000Z".to_string()),
                last_error: None,
                subscription_count: Some(0),
            },
            reused_existing_connection: true,
        };
        assert_eq!(
            serde_json::to_value(&result).unwrap()["reusedExistingConnection"],
            true
        );
    }

    #[test]
    fn kafka_disconnect_result_camel_case() {
        let result = KafkaDisconnectResult {
            status: KafkaServiceStatus {
                state: "disconnected".to_string(),
                cluster_id: None,
                connected_at: None,
                last_error: None,
                subscription_count: None,
            },
            disconnected: true,
            cleaned_subscriptions: 2,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["disconnected"], true);
        assert_eq!(json["cleanedSubscriptions"], 2);
    }

    #[test]
    fn kafka_topics_result_shape() {
        let result = KafkaTopicsResult {
            cluster_id: Some("c1".to_string()),
            topics: vec![
                KafkaTopicSummary {
                    name: "orders".to_string(),
                    partitions: 3,
                    is_internal: false,
                },
                KafkaTopicSummary {
                    name: "__consumer_offsets".to_string(),
                    partitions: 50,
                    is_internal: true,
                },
            ],
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["topics"][0]["isInternal"], false);
        assert_eq!(json["topics"][1]["isInternal"], true);
    }

    #[test]
    fn kafka_produce_result_shape() {
        let result = KafkaProduceResult {
            cluster_id: Some("c1".to_string()),
            topic: "orders".to_string(),
            sent_count: 2,
            records: vec![
                KafkaProduceRecordResult {
                    partition: 0,
                    offset: "42".to_string(),
                    timestamp: None,
                },
                KafkaProduceRecordResult {
                    partition: 1,
                    offset: "7".to_string(),
                    timestamp: Some("2026-01-01T00:00:00.000Z".to_string()),
                },
            ],
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["sentCount"], 2);
        assert_eq!(json["records"][0]["offset"], "42");
        assert!(json["records"][0].get("timestamp").is_none());
        assert_eq!(json["records"][1]["timestamp"], "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn kafka_produce_message_timestamp_deserialized() {
        let json = r#"{"value":"hello","timestamp":"1748822400000"}"#;
        let msg: KafkaProduceMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.timestamp, Some("1748822400000".to_string()));
        let ms: i64 = msg.timestamp.unwrap().parse().unwrap();
        assert_eq!(ms, 1_748_822_400_000_i64);
    }

    #[test]
    fn kafka_produce_request_acks_deserialized() {
        let json = r#"{"topic":"t","messages":[{"value":"v"}],"acks":-1}"#;
        let req: KafkaProduceRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.acks, Some(-1));
    }

    #[test]
    fn kafka_produce_request_acks_optional_absent() {
        let json = r#"{"topic":"t","messages":[{"value":"v"}]}"#;
        let req: KafkaProduceRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.acks, None);
    }

    #[test]
    fn kafka_consume_record_shape() {
        let mut headers = HashMap::new();
        headers.insert("x-trace".to_string(), "abc".to_string());
        let record = KafkaConsumeRecord {
            topic: "orders".to_string(),
            partition: 0,
            offset: "100".to_string(),
            timestamp: Some("2026-01-01T00:00:00.000Z".to_string()),
            key: Some("order-1".to_string()),
            value: r#"{"id":1}"#.to_string(),
            headers: Some(headers),
        };
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["topic"], "orders");
        assert_eq!(json["key"], "order-1");
        assert_eq!(json["headers"]["x-trace"], "abc");
    }

    #[test]
    fn kafka_consume_record_optional_fields_omitted() {
        let record = KafkaConsumeRecord {
            topic: "t".to_string(),
            partition: 0,
            offset: "0".to_string(),
            timestamp: None,
            key: None,
            value: "hello".to_string(),
            headers: None,
        };
        let json = serde_json::to_value(&record).unwrap();
        assert!(json.get("timestamp").is_none());
        assert!(json.get("key").is_none());
        assert!(json.get("headers").is_none());
    }

    #[test]
    fn kafka_consume_result_shape() {
        let result = KafkaConsumeResult {
            message_count: 1,
            messages: vec![KafkaConsumeRecord {
                topic: "t".to_string(),
                partition: 0,
                offset: "5".to_string(),
                timestamp: None,
                key: None,
                value: "v".to_string(),
                headers: None,
            }],
            timed_out: false,
            has_more: None,
            next_cursor: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["messageCount"], 1);
        assert_eq!(json["timedOut"], false);
    }

    #[test]
    fn kafka_subscribe_result_shape() {
        let result = KafkaSubscribeResult {
            cluster_id: Some("c1".to_string()),
            subscription: KafkaSubscribeInfo {
                subscription_id: "sub-uuid".to_string(),
                topic: "orders".to_string(),
                group_id: "rf-subscribe-c1-sub-uuid".to_string(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
            },
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["subscription"]["subscriptionId"], "sub-uuid");
        assert_eq!(json["subscription"]["groupId"], "rf-subscribe-c1-sub-uuid");
    }

    #[test]
    fn kafka_subscriptions_result_shape() {
        let result = KafkaSubscriptionsResult {
            cluster_id: Some("c1".to_string()),
            subscriptions: vec![
                KafkaSubscribeInfo {
                    subscription_id: "s1".to_string(),
                    topic: "orders".to_string(),
                    group_id: "g1".to_string(),
                    created_at: "2026-01-01T00:00:00.000Z".to_string(),
                },
                KafkaSubscribeInfo {
                    subscription_id: "s2".to_string(),
                    topic: "payments".to_string(),
                    group_id: "g2".to_string(),
                    created_at: "2026-01-01T00:00:01.000Z".to_string(),
                },
            ],
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["subscriptions"].as_array().unwrap().len(), 2);
        assert_eq!(json["subscriptions"][1]["topic"], "payments");
    }

    #[test]
    fn kafka_unsubscribe_result_shape() {
        let result = KafkaUnsubscribeResult {
            cluster_id: Some("c1".to_string()),
            subscription_id: "sub-uuid".to_string(),
            unsubscribed: true,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["subscriptionId"], "sub-uuid");
        assert_eq!(json["unsubscribed"], true);
    }

    #[test]
    fn subscription_event_payload_shape() {
        let payload = KafkaSubscriptionEventPayload {
            subscription_id: "sub-uuid".to_string(),
            record: KafkaConsumeRecord {
                topic: "orders".to_string(),
                partition: 0,
                offset: "10".to_string(),
                timestamp: None,
                key: None,
                value: "msg".to_string(),
                headers: None,
            },
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["subscriptionId"], "sub-uuid");
        assert_eq!(json["record"]["topic"], "orders");
    }

    #[test]
    fn service_status_optional_fields_omitted_when_disconnected() {
        let status = KafkaServiceStatus {
            state: "disconnected".to_string(),
            cluster_id: None,
            connected_at: None,
            last_error: None,
            subscription_count: None,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["state"], "disconnected");
        assert!(json.get("clusterId").is_none());
        assert!(json.get("connectedAt").is_none());
        assert!(json.get("subscriptionCount").is_none());
    }

    #[test]
    fn service_status_all_fields_present_when_connected() {
        let status = KafkaServiceStatus {
            state: "connected".to_string(),
            cluster_id: Some("c1".to_string()),
            connected_at: Some("2026-01-01T00:00:00.000Z".to_string()),
            last_error: None,
            subscription_count: Some(3),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["clusterId"], "c1");
        assert_eq!(json["subscriptionCount"], 3);
    }

    #[test]
    fn consume_request_defaults() {
        let json = r#"{"topic":"t"}"#;
        let req: KafkaConsumeOnceRequest = serde_json::from_str(json).unwrap();
        assert!(req.group_id.is_none());
        assert!(req.from_beginning.is_none());
        assert!(req.max_messages.is_none());
        assert!(req.filter.is_none());
    }

    #[test]
    fn subscribe_request_with_filter() {
        let json =
            r#"{"topic":"t","filter":{"keyEquals":"k1","jsonPath":"$.status","jsonEquals":"ok"}}"#;
        let req: KafkaSubscribeRequest = serde_json::from_str(json).unwrap();
        let f = req.filter.unwrap();
        assert_eq!(f.key_equals, Some("k1".to_string()));
        assert_eq!(f.json_path, Some("$.status".to_string()));
        assert_eq!(f.json_equals, Some("ok".to_string()));
    }
}
