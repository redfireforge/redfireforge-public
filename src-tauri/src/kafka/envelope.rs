//! Envelope construction helpers and status-to-struct converters.
//!
//! All Tauri command handlers return `Result<Value, String>`.  Application-level
//! errors (not connected, invalid input, broker refused) use `Ok(error_envelope(...))`
//! so Phase 9C transport always receives a resolved value and can branch on
//! `envelope.ok`.  Only Mutex-poison (a bug indicator) propagates as `Err(String)`.

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;

use super::state::ClientHandle;
use super::types::{
    KafkaEnvelopeMeta, KafkaErrorBody, KafkaErrorEnvelope, KafkaServiceStatus, KafkaSuccessEnvelope,
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

// ─── Envelope constructors ────────────────────────────────────────────────────

pub(super) fn success_envelope<T: Serialize>(op: &str, data: T, duration_ms: Option<u64>) -> Value {
    serde_json::to_value(KafkaSuccessEnvelope {
        ok: true,
        op: op.to_string(),
        data,
        meta: KafkaEnvelopeMeta {
            timestamp: now_iso(),
            duration_ms,
        },
    })
    .unwrap_or_else(|e| {
        serde_json::json!({
            "ok": false,
            "op": op,
            "error": { "code": "SERIALIZATION_ERROR", "message": e.to_string() },
            "meta": { "timestamp": now_iso() }
        })
    })
}

pub(super) fn error_envelope(
    op: &str,
    code: &str,
    message: &str,
    retryable: Option<bool>,
) -> Value {
    serde_json::to_value(KafkaErrorEnvelope {
        ok: false,
        op: op.to_string(),
        error: KafkaErrorBody {
            code: code.to_string(),
            message: message.to_string(),
            retryable,
        },
        meta: KafkaEnvelopeMeta {
            timestamp: now_iso(),
            duration_ms: None,
        },
    })
    .unwrap_or_else(|_| {
        serde_json::json!({
            "ok": false, "op": op,
            "error": { "code": code, "message": message },
            "meta": { "timestamp": now_iso() }
        })
    })
}

// ─── Status helpers ───────────────────────────────────────────────────────────

pub(super) fn disconnected_status() -> KafkaServiceStatus {
    KafkaServiceStatus {
        state: "disconnected".to_string(),
        cluster_id: None,
        connected_at: None,
        last_error: None,
        subscription_count: None,
    }
}

pub(super) fn handle_to_status(handle: &ClientHandle) -> KafkaServiceStatus {
    KafkaServiceStatus {
        state: "connected".to_string(),
        cluster_id: Some(handle.cluster_id.clone()),
        connected_at: Some(handle.connected_at.clone()),
        last_error: None,
        subscription_count: Some(handle.subscription_count()),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kafka::types::KafkaServiceStatus;

    #[test]
    fn success_envelope_shape() {
        let status = KafkaServiceStatus {
            state: "connected".to_string(),
            cluster_id: Some("c1".to_string()),
            connected_at: Some("2026-01-01T00:00:00.000Z".to_string()),
            last_error: None,
            subscription_count: Some(0),
        };
        let env = success_envelope("status", status, Some(42));
        assert_eq!(env["ok"], true);
        assert_eq!(env["op"], "status");
        assert_eq!(env["data"]["clusterId"], "c1");
        assert_eq!(env["meta"]["durationMs"], 42);
    }

    #[test]
    fn success_envelope_no_duration() {
        let env = success_envelope("status", serde_json::json!({"x": 1}), None);
        assert_eq!(env["ok"], true);
        assert!(env["meta"].get("durationMs").is_none());
    }

    #[test]
    fn error_envelope_shape() {
        let env = error_envelope(
            "connect",
            "KAFKA_CONNECT_FAILED",
            "broker unreachable",
            Some(true),
        );
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["code"], "KAFKA_CONNECT_FAILED");
        assert_eq!(env["error"]["retryable"], true);
        assert!(env["meta"].get("durationMs").is_none());
    }

    #[test]
    fn error_envelope_without_retryable() {
        let env = error_envelope("topics", "KAFKA_NOT_CONNECTED", "not connected", None);
        assert_eq!(env["ok"], false);
        assert!(env["error"].get("retryable").is_none());
    }

    #[test]
    fn disconnected_status_shape() {
        let json = serde_json::to_value(disconnected_status()).unwrap();
        assert_eq!(json["state"], "disconnected");
        assert!(json.get("clusterId").is_none());
        assert!(json.get("connectedAt").is_none());
    }

    #[test]
    fn now_iso_is_rfc3339_millis() {
        let s = now_iso();
        // Should end in Z and contain a dot for milliseconds
        assert!(s.ends_with('Z'), "Expected ISO string to end with Z: {}", s);
        assert!(s.contains('.'), "Expected milliseconds separator in: {}", s);
    }
}
