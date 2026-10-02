//! rdkafka `ClientConfig` builder and error classification utilities.
//!
//! `build_rdkafka_config` is the single place that translates the frontend
//! `KafkaConnectionConfig` (SASL mode + TLS settings) into rdkafka properties.
//! Error classifiers mirror the server-side helpers in `kafka-service.ts`.

use std::collections::HashMap;

use rdkafka::config::ClientConfig;

use super::oauth::event_hub_resource;
use super::state::ClientHandle;
use super::types::{KafkaAuthConfig, KafkaConnectionConfig, KafkaTlsConfig};

// ─── Error classifiers ────────────────────────────────────────────────────────

/// Returns true when the error message indicates a SASL / credential failure.
/// Mirrors server-side `isAuthError` heuristic in `kafka-service.ts`.
pub(super) fn is_auth_error(err_msg: &str) -> bool {
    let msg = err_msg.to_lowercase();
    msg.contains("sasl authentication failed")
        || msg.contains("authentication failed")
        || msg.contains("invalid credentials")
        || msg.contains("azure cli")
}

/// Classify a connect-phase error into one of three KAFKA_CONNECT_* codes.
/// Mirrors server-side `isTimeoutError` + `isAuthError` heuristics.
pub(super) fn connect_error_code(err_msg: &str) -> &'static str {
    let msg = err_msg.to_lowercase();
    if msg.contains("timed out") || msg.contains("timeout") || msg.contains("connection timed") {
        "KAFKA_CONNECT_TIMEOUT"
    } else if is_auth_error(err_msg) {
        "KAFKA_AUTH_FAILED"
    } else {
        "KAFKA_CONNECT_FAILED"
    }
}

// ─── ClientConfig builder ─────────────────────────────────────────────────────

/// Build an `rdkafka::ClientConfig` from the frontend connection config.
/// This is the single translation point from frontend schema to librdkafka keys.
pub(crate) fn build_rdkafka_config(conn: &KafkaConnectionConfig) -> ClientConfig {
    let mut cfg = ClientConfig::new();
    cfg.set("bootstrap.servers", &conn.brokers.join(","));
    cfg.set("client.id", &conn.client_id);

    let conn_timeout = conn.connection_timeout_ms.unwrap_or(5_000);
    let req_timeout = conn.request_timeout_ms.unwrap_or(10_000);
    cfg.set(
        "socket.connection.setup.timeout.ms",
        &conn_timeout.to_string(),
    );
    cfg.set("request.timeout.ms", &req_timeout.to_string());

    let has_tls = conn.tls.as_ref().map(|t| t.enabled).unwrap_or(false);
    let auth_mode = conn
        .auth
        .as_ref()
        .map(|a| a.mode.as_str())
        .unwrap_or("none");
    let has_sasl = auth_mode != "none";

    let security_protocol = match (has_tls, has_sasl) {
        (false, false) => "PLAINTEXT",
        (true, false) => "SSL",
        (false, true) => "SASL_PLAINTEXT",
        (true, true) => "SASL_SSL",
    };
    cfg.set("security.protocol", security_protocol);

    apply_sasl_config(&mut cfg, conn.auth.as_ref(), &conn.brokers);
    apply_tls_config(&mut cfg, conn.tls.as_ref());

    cfg
}

/// `request.timeout.ms` applies only to producers. A consumer ignores it and
/// librdkafka prints CONFWARN for every client that still has the property.
pub(crate) fn prepare_consumer_config(cfg: &mut ClientConfig) {
    cfg.remove("request.timeout.ms");
}

fn apply_sasl_config(cfg: &mut ClientConfig, auth: Option<&KafkaAuthConfig>, brokers: &[String]) {
    let auth = match auth {
        Some(a) => a,
        None => return,
    };
    if auth.mode == "oauthbearer" {
        cfg.set("sasl.mechanism", "OAUTHBEARER");
        let resource = event_hub_resource(brokers).unwrap_or_default();
        cfg.set("sasl.oauthbearer.config", &resource);
        return;
    }
    let mechanism = match auth.mode.as_str() {
        "plain" => "PLAIN",
        "scram-sha-256" => "SCRAM-SHA-256",
        "scram-sha-512" => "SCRAM-SHA-512",
        _ => return,
    };
    cfg.set("sasl.mechanism", mechanism);
    cfg.set("sasl.username", auth.username.as_deref().unwrap_or(""));
    cfg.set("sasl.password", auth.password.as_deref().unwrap_or(""));
}

fn apply_tls_config(cfg: &mut ClientConfig, tls: Option<&KafkaTlsConfig>) {
    let tls = match tls {
        Some(t) if t.enabled => t,
        _ => return,
    };
    let reject = tls.reject_unauthorized.unwrap_or(true);
    if !reject {
        cfg.set("enable.ssl.certificate.verification", "false");
    } else if tls.ca_pem.is_none() {
        // Event Hubs uses a public CA. "probe" loads the OS trust store
        // (macOS keychain / Windows store) instead of an empty OpenSSL bundle.
        cfg.set("ssl.ca.location", "probe");
    }
    if let Some(ca_pem) = &tls.ca_pem {
        cfg.set("ssl.ca.pem", ca_pem);
    }
    if let Some(cert_pem) = &tls.cert_pem {
        cfg.set("ssl.certificate.pem", cert_pem);
    }
    if let Some(key_pem) = &tls.key_pem {
        cfg.set("ssl.key.pem", key_pem);
    }
    if let Some(passphrase) = &tls.passphrase {
        cfg.set("ssl.key.password", passphrase);
    }
}

// ─── Cluster resolution helper ────────────────────────────────────────────────

/// Resolve the target cluster's stored rdkafka config + cluster_id from state.
/// Returns `None` if no matching cluster is connected (caller returns NOT_CONNECTED).
pub(super) fn resolve_cluster(
    map: &HashMap<String, ClientHandle>,
    cluster_id: Option<&str>,
) -> Option<(ClientConfig, String)> {
    let handle = match cluster_id {
        Some(id) => map.get(id),
        None => map.values().next(),
    };
    handle.map(|h| (h.rdkafka_config.clone(), h.cluster_id.clone()))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kafka::types::{KafkaAuthConfig, KafkaConnectionConfig, KafkaTlsConfig};

    fn base_conn() -> KafkaConnectionConfig {
        KafkaConnectionConfig {
            cluster_id: "c1".to_string(),
            client_id: "rf-test".to_string(),
            brokers: vec!["b1:9092".to_string()],
            connection_timeout_ms: None,
            request_timeout_ms: None,
            auth: None,
            tls: None,
        }
    }

    #[test]
    fn build_rdkafka_config_plaintext_no_auth() {
        let _cfg = build_rdkafka_config(&base_conn());
    }

    #[test]
    fn prepare_consumer_config_drops_producer_timeout() {
        let mut conn = base_conn();
        conn.request_timeout_ms = Some(8_000);
        let mut cfg = build_rdkafka_config(&conn);
        assert_eq!(cfg.get("request.timeout.ms"), Some("8000"));
        prepare_consumer_config(&mut cfg);
        assert_eq!(cfg.get("request.timeout.ms"), None);
        assert_eq!(cfg.get("bootstrap.servers"), Some("b1:9092"));
    }

    #[test]
    fn build_rdkafka_config_custom_timeouts() {
        let mut conn = base_conn();
        conn.connection_timeout_ms = Some(3_000);
        conn.request_timeout_ms = Some(8_000);
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_sasl_plain_no_tls() {
        let mut conn = base_conn();
        conn.auth = Some(KafkaAuthConfig {
            mode: "plain".to_string(),
            username: Some("alice".to_string()),
            password: Some("secret".to_string()),
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_sasl_scram256_no_tls() {
        let mut conn = base_conn();
        conn.auth = Some(KafkaAuthConfig {
            mode: "scram-sha-256".to_string(),
            username: Some("svc".to_string()),
            password: Some("pw".to_string()),
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_sasl_scram512_with_tls() {
        let mut conn = base_conn();
        conn.auth = Some(KafkaAuthConfig {
            mode: "scram-sha-512".to_string(),
            username: Some("svc".to_string()),
            password: Some("pw".to_string()),
        });
        conn.tls = Some(KafkaTlsConfig {
            enabled: true,
            reject_unauthorized: Some(false),
            server_name: None,
            ca_pem: Some(
                "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----".to_string(),
            ),
            cert_pem: None,
            key_pem: None,
            passphrase: None,
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_oauthbearer_event_hub() {
        let mut conn = base_conn();
        conn.brokers = vec!["a218876-t01-musea2-evhns.servicebus.windows.net:9093".to_string()];
        conn.auth = Some(KafkaAuthConfig {
            mode: "oauthbearer".to_string(),
            username: None,
            password: None,
        });
        conn.tls = Some(KafkaTlsConfig {
            enabled: true,
            reject_unauthorized: Some(true),
            server_name: None,
            ca_pem: None,
            cert_pem: None,
            key_pem: None,
            passphrase: None,
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_tls_only_no_sasl() {
        let mut conn = base_conn();
        conn.tls = Some(KafkaTlsConfig {
            enabled: true,
            reject_unauthorized: Some(true),
            server_name: None,
            ca_pem: None,
            cert_pem: None,
            key_pem: None,
            passphrase: None,
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_tls_disabled_is_noop() {
        let mut conn = base_conn();
        conn.tls = Some(KafkaTlsConfig {
            enabled: false,
            reject_unauthorized: None,
            server_name: None,
            ca_pem: None,
            cert_pem: None,
            key_pem: None,
            passphrase: None,
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn build_rdkafka_config_unknown_auth_mode_noop() {
        let mut conn = base_conn();
        conn.auth = Some(KafkaAuthConfig {
            mode: "kerberos".to_string(),
            username: None,
            password: None,
        });
        let _cfg = build_rdkafka_config(&conn);
    }

    #[test]
    fn connect_error_code_timeout_variants() {
        assert_eq!(
            connect_error_code("Connection timed out after 5000ms"),
            "KAFKA_CONNECT_TIMEOUT"
        );
        assert_eq!(
            connect_error_code("broker timeout"),
            "KAFKA_CONNECT_TIMEOUT"
        );
        assert_eq!(
            connect_error_code("timed out connecting to broker"),
            "KAFKA_CONNECT_TIMEOUT"
        );
    }

    #[test]
    fn connect_error_code_auth_variants() {
        assert_eq!(
            connect_error_code("SASL authentication failed: invalid credentials"),
            "KAFKA_AUTH_FAILED"
        );
        assert_eq!(
            connect_error_code("authentication failed for user"),
            "KAFKA_AUTH_FAILED"
        );
        assert_eq!(
            connect_error_code("Azure CLI authentication failed. Run az login"),
            "KAFKA_AUTH_FAILED"
        );
        assert_eq!(
            connect_error_code("Invalid credentials provided"),
            "KAFKA_AUTH_FAILED"
        );
    }

    #[test]
    fn connect_error_code_non_timeout_variants() {
        assert_eq!(
            connect_error_code("SSL handshake failed"),
            "KAFKA_CONNECT_FAILED"
        );
        assert_eq!(
            connect_error_code("Connection refused"),
            "KAFKA_CONNECT_FAILED"
        );
    }

    #[test]
    fn is_auth_error_true_variants() {
        assert!(is_auth_error("SASL authentication failed"));
        assert!(is_auth_error("Authentication failed for user alice"));
        assert!(is_auth_error("Invalid credentials"));
    }

    #[test]
    fn is_auth_error_false_variants() {
        assert!(!is_auth_error("Connection refused"));
        assert!(!is_auth_error("broker timeout"));
        assert!(!is_auth_error("SSL handshake failed"));
    }

    #[test]
    fn resolve_cluster_by_explicit_id() {
        use crate::kafka::state::ClientHandle;
        use std::collections::HashMap;
        let mut map: HashMap<String, ClientHandle> = HashMap::new();
        map.insert(
            "c1".to_string(),
            ClientHandle {
                cluster_id: "c1".to_string(),
                client_id: "cli".to_string(),
                brokers: vec![],
                connected_at: "2026-01-01T00:00:00.000Z".to_string(),
                rdkafka_config: ClientConfig::new(),
                subscriptions: HashMap::new(),
            },
        );
        let result = resolve_cluster(&map, Some("c1"));
        assert!(result.is_some());
        assert_eq!(result.unwrap().1, "c1");
    }

    #[test]
    fn resolve_cluster_first_when_no_id() {
        use crate::kafka::state::ClientHandle;
        use std::collections::HashMap;
        let mut map: HashMap<String, ClientHandle> = HashMap::new();
        map.insert(
            "only".to_string(),
            ClientHandle {
                cluster_id: "only".to_string(),
                client_id: "cli".to_string(),
                brokers: vec![],
                connected_at: "2026-01-01T00:00:00.000Z".to_string(),
                rdkafka_config: ClientConfig::new(),
                subscriptions: HashMap::new(),
            },
        );
        let result = resolve_cluster(&map, None);
        assert!(result.is_some());
    }

    #[test]
    fn resolve_cluster_missing_id_returns_none() {
        use std::collections::HashMap;
        let map: HashMap<String, crate::kafka::state::ClientHandle> = HashMap::new();
        assert!(resolve_cluster(&map, Some("missing")).is_none());
    }

    #[test]
    fn resolve_cluster_empty_map_returns_none() {
        use std::collections::HashMap;
        let map: HashMap<String, crate::kafka::state::ClientHandle> = HashMap::new();
        assert!(resolve_cluster(&map, None).is_none());
    }
}
