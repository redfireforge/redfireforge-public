//! Pooled HTTP transport for Requests / `httpFetch` on desktop.
//!
//! `tauri-plugin-http` builds a new `reqwest::Client` on every fetch, so each
//! Send pays a fresh DNS + TCP + TLS handshake. Insomnia (and our load-test
//! executor) reuse idle connections. This command keeps two long-lived clients:
//! one that honors the OS proxy, and one with `no_proxy` for loopback.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const POOL_IDLE_SECS: u64 = 90;
const CONNECT_TIMEOUT_SECS: u64 = 10;
const REQUEST_TIMEOUT_SECS: u64 = 120;
const MAX_REDIRECTS: usize = 10;

const CLIENT_MANAGED_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "accept-encoding",
    "accept-charset",
];

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudioHttpFetchRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudioHttpFetchResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn is_loopback_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0:0:0:0:0:0:0:1"
}

fn is_client_managed_header(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    CLIENT_MANAGED_HEADERS.iter().any(|h| *h == lower)
}

fn build_header_map(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        if is_client_managed_header(name) {
            continue;
        }
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("Invalid header name '{}': {}", name, e))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|e| format!("Invalid header value for '{}': {}", name, e))?;
        map.insert(header_name, header_value);
    }
    Ok(map)
}

fn client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .pool_max_idle_per_host(32)
        .pool_idle_timeout(Duration::from_secs(POOL_IDLE_SECS))
        .tcp_nodelay(true)
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(Policy::limited(MAX_REDIRECTS))
}

fn pooled_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        client_builder()
            .build()
            .expect("studio HTTP client")
    })
}

fn pooled_loopback_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        client_builder()
            .no_proxy()
            .build()
            .expect("studio loopback HTTP client")
    })
}

fn client_for_url(url: &str) -> &'static Client {
    if is_loopback_url(url) {
        pooled_loopback_client()
    } else {
        pooled_client()
    }
}

fn error_response(message: String) -> StudioHttpFetchResponse {
    StudioHttpFetchResponse {
        status: 0,
        status_text: String::new(),
        headers: HashMap::new(),
        body: String::new(),
        error: Some(message),
    }
}

async fn fetch_with_client(
    client: &Client,
    req: &StudioHttpFetchRequest,
) -> StudioHttpFetchResponse {
    let method = req.method.to_uppercase();
    let headers = match build_header_map(req.headers.as_ref().unwrap_or(&HashMap::new())) {
        Ok(h) => h,
        Err(e) => return error_response(e),
    };

    let http_method = match reqwest::Method::from_bytes(method.as_bytes()) {
        Ok(m) => m,
        Err(e) => return error_response(format!("Invalid HTTP method: {}", e)),
    };

    let mut builder = client.request(http_method, &req.url).headers(headers);
    if let Some(body) = &req.body {
        if method != "GET" && method != "HEAD" {
            builder = builder.body(body.clone());
        }
    }

    let response = match builder.send().await {
        Ok(r) => r,
        Err(e) => return error_response(format!("HTTP request failed: {}", e)),
    };

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let mut out_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            out_headers.insert(key.as_str().to_string(), v.to_string());
        }
    }
    let body = match response.text().await {
        Ok(b) => b,
        Err(e) => return error_response(format!("Failed to read response body: {}", e)),
    };

    StudioHttpFetchResponse {
        status: status.as_u16(),
        status_text,
        headers: out_headers,
        body,
        error: None,
    }
}

#[tauri::command]
pub async fn studio_http_fetch(request: StudioHttpFetchRequest) -> StudioHttpFetchResponse {
    let client = client_for_url(&request.url);
    fetch_with_client(client, &request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_use_no_proxy_client() {
        assert!(is_loopback_url("http://localhost:3001/api"));
        assert!(is_loopback_url("http://127.0.0.1/health"));
        assert!(is_loopback_url("http://[::1]/"));
        assert_eq!(client_for_url("http://localhost:5173") as *const Client,
            pooled_loopback_client() as *const Client);
    }

    #[test]
    fn remote_hosts_use_pooled_client() {
        assert!(!is_loopback_url("https://sales-catalog.example.com/v1"));
        assert!(!is_loopback_url("not a url"));
        assert_eq!(
            client_for_url("https://api.example.com/v1") as *const Client,
            pooled_client() as *const Client
        );
    }

    #[test]
    fn strips_client_managed_headers() {
        let mut headers = HashMap::new();
        headers.insert("Accept".into(), "application/json".into());
        headers.insert("Accept-Encoding".into(), "gzip, deflate, br".into());
        headers.insert("Connection".into(), "close".into());
        headers.insert("Host".into(), "example.com".into());
        headers.insert("Authorization".into(), "Bearer tok".into());
        let map = build_header_map(&headers).expect("headers");
        assert!(map.contains_key("accept"));
        assert!(map.contains_key("authorization"));
        assert!(!map.contains_key("accept-encoding"));
        assert!(!map.contains_key("connection"));
        assert!(!map.contains_key("host"));
    }

    #[test]
    fn pooled_clients_build_once() {
        let a = pooled_client() as *const Client;
        let b = pooled_client() as *const Client;
        assert_eq!(a, b);
        let c = pooled_loopback_client() as *const Client;
        let d = pooled_loopback_client() as *const Client;
        assert_eq!(c, d);
        assert_ne!(a as usize, c as usize);
    }
}
