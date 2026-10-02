//! Message conversion helpers and consumer filter logic.
//!
//! `consume_record_from_message` bridges an rdkafka `BorrowedMessage` to the
//! contract-aligned `KafkaConsumeRecord`.
//!
//! `matches_filter` mirrors `matchesKafkaConsumeFilter` from
//! `src-server/kafka/kafka-service-utils.ts`.  `read_json_path` implements the
//! simple `$.key.subkey[0]` dot-path notation used by the filter.

use std::collections::HashMap;

use rdkafka::message::Headers;
use rdkafka::Timestamp;

use super::types::{KafkaConsumeRecord, KafkaMessageFilter};

// ─── Header extraction ────────────────────────────────────────────────────────

pub(super) fn extract_headers<H: Headers>(headers: &H) -> Option<HashMap<String, String>> {
    let mut map = HashMap::new();
    for header in headers.iter() {
        let value = header
            .value
            .and_then(|v| std::str::from_utf8(v).ok())
            .unwrap_or("")
            .to_string();
        map.insert(header.key.to_string(), value);
    }
    if map.is_empty() {
        None
    } else {
        Some(map)
    }
}

// ─── Timestamp conversion ─────────────────────────────────────────────────────

/// Epoch milliseconds, matching the string the topic table parses with `parseInt`.
pub(super) fn kafka_timestamp_millis(ts: Timestamp) -> Option<String> {
    let ms = match ts {
        Timestamp::CreateTime(ms) => ms,
        Timestamp::LogAppendTime(ms) => ms,
        _ => return None,
    };
    if ms <= 0 {
        return None;
    }
    Some(ms.to_string())
}

// ─── Message-to-record conversion ─────────────────────────────────────────────

pub(super) fn consume_record_from_message(
    msg: &rdkafka::message::BorrowedMessage<'_>,
) -> KafkaConsumeRecord {
    use rdkafka::Message;
    KafkaConsumeRecord {
        topic: msg.topic().to_string(),
        partition: msg.partition(),
        offset: msg.offset().to_string(),
        timestamp: kafka_timestamp_millis(msg.timestamp()),
        key: msg
            .key()
            .and_then(|k| std::str::from_utf8(k).ok().map(|s| s.to_string())),
        value: msg
            .payload()
            .and_then(|p| std::str::from_utf8(p).ok())
            .unwrap_or("")
            .to_string(),
        headers: msg.headers().and_then(extract_headers),
    }
}

// ─── JSON path reader ─────────────────────────────────────────────────────────

/// Read a value from a JSON string using simple `$.key.subkey[0]` notation.
/// Does not implement the full JSONPath spec — only dot-separated keys and
/// numeric array indices are supported, which is sufficient for the filter contract.
pub(super) fn read_json_path(json_text: &str, path: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(json_text).ok()?;
    let trimmed = path.trim();
    if !trimmed.starts_with("$.") {
        return None;
    }
    let normalized = trimmed[2..].replace('[', ".").replace(']', "");
    let tokens: Vec<&str> = normalized.split('.').filter(|t| !t.is_empty()).collect();

    let mut current = &parsed;
    let mut owned: serde_json::Value;
    for token in &tokens {
        match current {
            serde_json::Value::Object(map) => match map.get(*token) {
                Some(v) => {
                    owned = v.clone();
                    current = &owned;
                }
                None => return None,
            },
            serde_json::Value::Array(arr) => {
                let idx: usize = token.parse().ok()?;
                match arr.get(idx) {
                    Some(v) => {
                        owned = v.clone();
                        current = &owned;
                    }
                    None => return None,
                }
            }
            _ => return None,
        }
    }
    Some(match current {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

// ─── Message filter ───────────────────────────────────────────────────────────

/// Returns true when `record` passes all active criteria in `filter`.
/// A `None` filter always matches.  Mirrors `matchesKafkaConsumeFilter` from
/// `src-server/kafka/kafka-service-utils.ts`.
pub(super) fn matches_filter(
    record: &KafkaConsumeRecord,
    filter: Option<&KafkaMessageFilter>,
) -> bool {
    let filter = match filter {
        Some(f) => f,
        None => return true,
    };
    if let Some(key_eq) = &filter.key_equals {
        if record.key.as_deref() != Some(key_eq.as_str()) {
            return false;
        }
    }
    if let Some(headers_match) = &filter.headers_match {
        let record_headers = record.headers.as_ref();
        for (k, v) in headers_match {
            let actual = record_headers.and_then(|h| h.get(k)).map(|s| s.as_str());
            if actual != Some(v.as_str()) {
                return false;
            }
        }
    }
    if let Some(json_path) = &filter.json_path {
        let actual = read_json_path(&record.value, json_path);
        if let Some(expected) = &filter.json_equals {
            if actual.as_deref() != Some(expected.as_str()) {
                return false;
            }
        } else if actual.is_none() {
            return false;
        }
    }
    if let Some(needle) = filter.body_contains.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !body_has_text(&record.value, needle) {
            return false;
        }
    }
    true
}

/// True when `needle` appears in the raw record or in the text after JSON
/// string escapes are decoded. `event.body` is stored as one escaped string,
/// so the payload contains `\"accountType\":\"PN\"` while the message view
/// shows `"accountType":"PN"`.
pub(super) fn body_has_text(value: &str, needle: &str) -> bool {
    let needle = normalize_quotes(needle).to_lowercase();
    if needle.is_empty() {
        return true;
    }
    let value = value.to_lowercase();
    let value_text = json_unescape(&value);
    let needle_text = json_unescape(&needle);
    value.contains(&needle)
        || value.contains(&needle_text)
        || value_text.contains(&needle)
        || value_text.contains(&needle_text)
}

fn normalize_quotes(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\u{201c}' | '\u{201d}' | '\u{201e}' => '"',
            _ => ch,
        })
        .collect()
}

fn json_unescape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('/') => out.push('/'),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

pub(super) fn filter_narrows(filter: &KafkaMessageFilter) -> bool {
    filter.body_contains.as_deref().is_some_and(|text| !text.trim().is_empty())
        || filter.key_equals.is_some()
        || filter.json_path.is_some()
        || filter.headers_match.as_ref().is_some_and(|headers| !headers.is_empty())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kafka::types::{KafkaConsumeRecord, KafkaMessageFilter};

    fn record(
        key: Option<&str>,
        value: &str,
        headers: Option<HashMap<String, String>>,
    ) -> KafkaConsumeRecord {
        KafkaConsumeRecord {
            topic: "t".to_string(),
            partition: 0,
            offset: "0".to_string(),
            timestamp: None,
            key: key.map(|s| s.to_string()),
            value: value.to_string(),
            headers,
        }
    }

    fn one_header(k: &str, v: &str) -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert(k.to_string(), v.to_string());
        m
    }

    // ── read_json_path ──────────────────────────────────────────────────────────

    #[test]
    fn read_json_path_simple_field() {
        assert_eq!(
            read_json_path(r#"{"id":1,"name":"Alice"}"#, "$.name"),
            Some("Alice".to_string())
        );
    }

    #[test]
    fn read_json_path_nested_field() {
        assert_eq!(
            read_json_path(r#"{"user":{"id":42,"role":"admin"}}"#, "$.user.role"),
            Some("admin".to_string())
        );
    }

    #[test]
    fn read_json_path_array_index() {
        assert_eq!(
            read_json_path(r#"{"items":["a","b","c"]}"#, "$.items[1]"),
            Some("b".to_string())
        );
    }

    #[test]
    fn read_json_path_numeric_value() {
        assert_eq!(
            read_json_path(r#"{"count":42}"#, "$.count"),
            Some("42".to_string())
        );
    }

    #[test]
    fn read_json_path_boolean_value() {
        assert_eq!(
            read_json_path(r#"{"active":true}"#, "$.active"),
            Some("true".to_string())
        );
    }

    #[test]
    fn read_json_path_missing_field() {
        assert_eq!(read_json_path(r#"{"id":1}"#, "$.name"), None);
    }

    #[test]
    fn read_json_path_out_of_bounds_index() {
        assert_eq!(read_json_path(r#"{"items":["a"]}"#, "$.items[5]"), None);
    }

    #[test]
    fn read_json_path_invalid_json() {
        assert_eq!(read_json_path("not-json", "$.name"), None);
    }

    #[test]
    fn read_json_path_invalid_prefix() {
        assert_eq!(read_json_path(r#"{"name":"test"}"#, "name"), None);
    }

    #[test]
    fn read_json_path_only_root_prefix() {
        // "$.." is degenerate — treated as empty path, returns root object serialised
        assert!(read_json_path(r#"{"x":1}"#, "$..").is_some());
    }

    // ── matches_filter ─────────────────────────────────────────────────────────

    #[test]
    fn filter_none_matches_everything() {
        assert!(matches_filter(&record(None, "any", None), None));
    }

    #[test]
    fn filter_key_equals_match() {
        let r = record(Some("order-1"), "v", None);
        let f = KafkaMessageFilter {
            key_equals: Some("order-1".to_string()),
            headers_match: None,
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_key_equals_no_match() {
        let r = record(Some("order-2"), "v", None);
        let f = KafkaMessageFilter {
            key_equals: Some("order-1".to_string()),
            headers_match: None,
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_key_equals_no_key_no_match() {
        let r = record(None, "v", None);
        let f = KafkaMessageFilter {
            key_equals: Some("order-1".to_string()),
            headers_match: None,
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_headers_match() {
        let r = record(None, "v", Some(one_header("x-trace", "abc")));
        let mut mh = HashMap::new();
        mh.insert("x-trace".to_string(), "abc".to_string());
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: Some(mh),
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_headers_no_match() {
        let r = record(None, "v", Some(one_header("x-trace", "xyz")));
        let mut mh = HashMap::new();
        mh.insert("x-trace".to_string(), "abc".to_string());
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: Some(mh),
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_headers_missing_key_no_match() {
        let r = record(None, "v", None);
        let mut mh = HashMap::new();
        mh.insert("x-trace".to_string(), "abc".to_string());
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: Some(mh),
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_json_path_match() {
        let r = record(None, r#"{"status":"paid"}"#, None);
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: None,
            json_path: Some("$.status".to_string()),
            json_equals: Some("paid".to_string()),
            body_contains: None,
        };
        assert!(matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_json_path_no_match() {
        let r = record(None, r#"{"status":"pending"}"#, None);
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: None,
            json_path: Some("$.status".to_string()),
            json_equals: Some("paid".to_string()),
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_json_path_exists_no_equals() {
        let r = record(None, r#"{"status":"anything"}"#, None);
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: None,
            json_path: Some("$.status".to_string()),
            json_equals: None,
            body_contains: None,
        };
        assert!(matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_body_contains_matches_escaped_json_string() {
        let raw = r#"{"event":{"body":"{\"accountType\":\"PN\",\"vin\":\"1\"}"}}"#;
        let r = record(None, raw, None);
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: None,
            json_path: None,
            json_equals: None,
            body_contains: Some(r#"\"accountType\":\"PN\""#.to_string()),
        };
        assert!(matches_filter(&r, Some(&f)));
        let visible = KafkaMessageFilter {
            body_contains: Some(r#""accountType":"PN""#.to_string()),
            ..f.clone()
        };
        assert!(matches_filter(&r, Some(&visible)));
        let mut curly_text = String::from(r#"\"accountType\":\"#);
        curly_text.push('\u{201d}');
        curly_text.push_str(r#"PN\""#);
        let curly = KafkaMessageFilter {
            body_contains: Some(curly_text),
            ..f.clone()
        };
        assert!(matches_filter(&r, Some(&curly)));
        let other = KafkaMessageFilter {
            body_contains: Some(r#"\"accountType\":\"FL\""#.to_string()),
            ..f
        };
        assert!(!matches_filter(&r, Some(&other)));
    }

    #[test]
    fn filter_json_path_not_exists_no_equals() {
        let r = record(None, r#"{"other":"x"}"#, None);
        let f = KafkaMessageFilter {
            key_equals: None,
            headers_match: None,
            json_path: Some("$.status".to_string()),
            json_equals: None,
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_combined_key_and_header_all_match() {
        let r = record(Some("k1"), "v", Some(one_header("env", "prod")));
        let mut mh = HashMap::new();
        mh.insert("env".to_string(), "prod".to_string());
        let f = KafkaMessageFilter {
            key_equals: Some("k1".to_string()),
            headers_match: Some(mh),
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(matches_filter(&r, Some(&f)));
    }

    #[test]
    fn filter_combined_key_match_header_miss() {
        let r = record(Some("k1"), "v", Some(one_header("env", "staging")));
        let mut mh = HashMap::new();
        mh.insert("env".to_string(), "prod".to_string());
        let f = KafkaMessageFilter {
            key_equals: Some("k1".to_string()),
            headers_match: Some(mh),
            json_path: None,
            json_equals: None,
            body_contains: None,
        };
        assert!(!matches_filter(&r, Some(&f)));
    }

    #[test]
    fn kafka_timestamp_millis_create_time() {
        let ts = Timestamp::CreateTime(1_748_822_400_000);
        assert_eq!(kafka_timestamp_millis(ts).as_deref(), Some("1748822400000"));
    }

    #[test]
    fn kafka_timestamp_millis_log_append_time() {
        let ts = Timestamp::LogAppendTime(1_748_822_400_000);
        assert_eq!(kafka_timestamp_millis(ts).as_deref(), Some("1748822400000"));
    }

    #[test]
    fn kafka_timestamp_not_available_returns_none() {
        assert!(kafka_timestamp_millis(Timestamp::NotAvailable).is_none());
        assert!(kafka_timestamp_millis(Timestamp::CreateTime(0)).is_none());
    }
}
