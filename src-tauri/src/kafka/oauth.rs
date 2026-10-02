//! Azure Event Hubs OAUTHBEARER token provider for librdkafka.
//!
//! The desktop client asks the Azure CLI for a token scoped to the namespace
//! in the bootstrap host (`https://<namespace>.servicebus.windows.net`). That
//! matches an `az login` session already used by other Kafka tools.

use std::env;
use std::io::ErrorKind;
use std::process::Command;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rdkafka::client::{ClientContext, OAuthToken};
use rdkafka::config::{ClientConfig, FromClientConfigAndContext};
use rdkafka::consumer::{BaseConsumer, Consumer, ConsumerContext};
use rdkafka::metadata::Metadata;
use serde_json::Value;

const EVENT_HUB_HOST_SUFFIX: &str = ".servicebus.windows.net";

pub(crate) struct AzureEventHubContext;

impl ClientContext for AzureEventHubContext {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = true;

    fn generate_oauth_token(
        &self,
        oauthbearer_config: Option<&str>,
    ) -> Result<OAuthToken, Box<dyn std::error::Error>> {
        let resource = oauthbearer_config.unwrap_or("").trim();
        if !resource.starts_with("https://") || !resource.contains(EVENT_HUB_HOST_SUFFIX) {
            let message = "Azure OAUTHBEARER needs a broker on *.servicebus.windows.net";
            log::error!("{message}");
            return Err(message.into());
        }
        match fetch_event_hub_token(resource) {
            Ok(token) => {
                log::debug!("Azure Event Hubs token acquired for {resource}");
                Ok(token)
            }
            Err(err) => {
                log::error!("{err}");
                Err(err.into())
            }
        }
    }
}

impl ConsumerContext for AzureEventHubContext {}

pub(crate) fn create_rdkafka_client<T>(cfg: &ClientConfig) -> Result<T, String>
where
    T: FromClientConfigAndContext<AzureEventHubContext>,
{
    cfg.create_with_context(AzureEventHubContext)
        .map_err(|err| err.to_string())
}

/// Fetch cluster metadata, polling between attempts so an OAUTHBEARER token
/// refresh can be applied. librdkafka enqueues that refresh on the consumer
/// queue; `fetch_metadata` alone never reads the queue, so the first handshake
/// fails with a broker transport error.
pub(crate) fn fetch_cluster_metadata(
    consumer: &BaseConsumer<AzureEventHubContext>,
    timeout: Duration,
    refresh_oauth: bool,
) -> Result<Metadata, String> {
    if !refresh_oauth {
        return consumer
            .fetch_metadata(None, timeout)
            .map_err(|err| err.to_string());
    }

    let mut deadline = Instant::now() + timeout;
    let mut last_error = "Kafka metadata fetch timed out".to_string();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        // The Azure CLI call runs inside this poll. That wait is sign-in, not a
        // broker timeout, so it must not consume the metadata budget.
        let poll_started = Instant::now();
        let _ = consumer.poll(Duration::from_millis(50).min(remaining));
        let blocked = poll_started.elapsed();
        if blocked > Duration::from_millis(200) {
            deadline += blocked;
        }
        let attempt = Duration::from_millis(400).min(deadline.saturating_duration_since(Instant::now()));
        if attempt.is_zero() {
            break;
        }
        match consumer.fetch_metadata(None, attempt) {
            Ok(metadata) => return Ok(metadata),
            Err(err) => last_error = err.to_string(),
        }
    }
    log::warn!("Kafka metadata fetch failed: {last_error}");
    Err(last_error)
}

pub(crate) fn event_hub_resource(brokers: &[String]) -> Option<String> {
    brokers.iter().find_map(|broker| {
        let host = broker_host(broker).to_ascii_lowercase();
        if host.ends_with(EVENT_HUB_HOST_SUFFIX) && !host.contains('/') && !host.contains(' ') {
            Some(format!("https://{host}"))
        } else {
            None
        }
    })
}

fn broker_host(broker: &str) -> &str {
    let trimmed = broker.trim();
    match trimmed.rfind(':') {
        Some(index)
            if trimmed[index + 1..].chars().all(|ch| ch.is_ascii_digit())
                && trimmed[index + 1..].len() >= 2 =>
        {
            &trimmed[..index]
        }
        _ => trimmed,
    }
}

pub(crate) fn oauth_token_from_az_json(body: &str) -> Result<OAuthToken, String> {
    let parsed: Value = serde_json::from_str(body)
        .map_err(|_| "Azure CLI authentication failed. The token response could not be read. Run az login, then connect again.".to_string())?;
    let raw = parsed
        .get("accessToken")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Azure CLI authentication failed. No access token was returned. Run az login, then connect again.".to_string())?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .unwrap_or(raw)
        .trim()
        .to_string();
    if token.is_empty() || token.contains('\0') {
        return Err("Azure CLI authentication failed. No access token was returned. Run az login, then connect again.".to_string());
    }

    let lifetime_ms = expires_on_ms(&parsed)
        .or_else(|| jwt_exp_ms(&token))
        .unwrap_or_else(|| chrono_fallback_lifetime());
    let principal = jwt_claim(&token, "oid")
        .or_else(|| jwt_claim(&token, "appid"))
        .unwrap_or_else(|| "azure-eventhub".to_string())
        .replace('\0', "");

    Ok(OAuthToken {
        token,
        principal_name: principal,
        lifetime_ms,
    })
}

fn expires_on_ms(parsed: &Value) -> Option<i64> {
    let value = parsed.get("expires_on")?;
    let seconds = match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }?;
    Some(seconds.saturating_mul(1_000))
}

fn jwt_exp_ms(token: &str) -> Option<i64> {
    jwt_payload(token)?
        .get("exp")
        .and_then(Value::as_i64)
        .map(|seconds| seconds.saturating_mul(1_000))
}

fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    jwt_payload(token)?
        .get(claim)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn chrono_fallback_lifetime() -> i64 {
    // One hour from now when the CLI omits both expires_on and a JWT exp claim.
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    now_ms.saturating_add(3_600_000)
}

fn fetch_event_hub_token(resource: &str) -> Result<OAuthToken, String> {
    let output = Command::new(az_program())
        .args([
            "account",
            "get-access-token",
            "--resource",
            resource,
            "--output",
            "json",
        ])
        .env("PATH", az_path())
        .output()
        .map_err(|err| {
            if err.kind() == ErrorKind::NotFound {
                "Azure CLI authentication failed. Install the Azure CLI and run az login, then connect again.".to_string()
            } else {
                format!("Azure CLI authentication failed. Run az login, then connect again. {err}")
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = sanitize_cli_error(&stderr);
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(" {detail}")
        };
        return Err(format!(
            "Azure CLI authentication failed. Run az login, then connect again.{suffix}"
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    oauth_token_from_az_json(&stdout)
}

fn sanitize_cli_error(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.contains("eyJ"))
        .unwrap_or("")
        .chars()
        .take(180)
        .collect()
}

fn az_program() -> String {
    if cfg!(windows) {
        "az.cmd".to_string()
    } else {
        "az".to_string()
    }
}

fn az_path() -> String {
    let mut dirs = Vec::new();
    if let Ok(home) = env::var("HOME") {
        dirs.push(format!("{home}/.local/bin"));
        dirs.push(format!("{home}/bin"));
    }
    dirs.push("/opt/homebrew/bin".to_string());
    dirs.push("/usr/local/bin".to_string());
    dirs.push("/usr/bin".to_string());
    if let Ok(path) = env::var("PATH") {
        dirs.push(path);
    }
    let separator = if cfg!(windows) { ";" } else { ":" };
    dirs.join(separator)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    fn jwt(payload: &str) -> String {
        format!("e30.{}.e30", URL_SAFE_NO_PAD.encode(payload.as_bytes()))
    }

    #[test]
    fn event_hub_resource_uses_namespace_host() {
        let brokers = vec!["a218876-t01-musea2-evhns.servicebus.windows.net:9093".to_string()];
        assert_eq!(
            event_hub_resource(&brokers).as_deref(),
            Some("https://a218876-t01-musea2-evhns.servicebus.windows.net")
        );
    }

    #[test]
    fn event_hub_resource_skips_local_brokers() {
        let brokers = vec![
            "127.0.0.1:19092".to_string(),
            "A218876-T01-MUSEA2-EVHNS.servicebus.windows.net:9093".to_string(),
        ];
        assert_eq!(
            event_hub_resource(&brokers).as_deref(),
            Some("https://a218876-t01-musea2-evhns.servicebus.windows.net")
        );
    }

    #[test]
    fn event_hub_resource_rejects_unrelated_hosts() {
        let brokers = vec!["kafka.internal:9092".to_string()];
        assert!(event_hub_resource(&brokers).is_none());
        assert!(event_hub_resource(&[]).is_none());
    }

    #[test]
    fn oauth_token_reads_cli_json() {
        let token = jwt(r#"{"exp":2000000000,"oid":"user-1"}"#);
        let body = format!(r#"{{"accessToken":"{token}","expires_on":"1999999999"}}"#);
        let parsed = oauth_token_from_az_json(&body).unwrap();
        assert_eq!(parsed.token, token);
        assert_eq!(parsed.principal_name, "user-1");
        assert_eq!(parsed.lifetime_ms, 1_999_999_999_000);
    }

    #[test]
    fn oauth_token_strips_bearer_and_falls_back_to_jwt_exp() {
        let token = jwt(r#"{"exp":2000000000,"appid":"app-9"}"#);
        let body = format!(r#"{{"accessToken":"Bearer {token}"}}"#);
        let parsed = oauth_token_from_az_json(&body).unwrap();
        assert_eq!(parsed.token, token);
        assert_eq!(parsed.principal_name, "app-9");
        assert_eq!(parsed.lifetime_ms, 2_000_000_000_000);
    }

    #[test]
    fn oauth_token_uses_numeric_expires_on() {
        let body = r#"{"accessToken":"not-a-jwt","expires_on":1800000000}"#;
        let parsed = oauth_token_from_az_json(body).unwrap();
        assert_eq!(parsed.principal_name, "azure-eventhub");
        assert_eq!(parsed.lifetime_ms, 1_800_000_000_000);
    }

    #[test]
    fn oauth_token_rejects_empty_and_unreadable_responses() {
        assert!(oauth_token_from_az_json("nope").is_err());
        assert!(oauth_token_from_az_json(r#"{"accessToken":""}"#).is_err());
        assert!(oauth_token_from_az_json(r#"{"accessToken":"   "}"#).is_err());
    }

    #[test]
    fn sanitize_cli_error_drops_token_like_lines() {
        assert_eq!(
            sanitize_cli_error("\nERROR: Please run az login\neyJsecret\n"),
            "ERROR: Please run az login"
        );
        assert_eq!(sanitize_cli_error("   \n"), "");
    }
}
