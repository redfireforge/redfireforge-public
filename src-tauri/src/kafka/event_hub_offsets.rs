//! Event Hubs offset lookup through KafkaJS.
//!
//! librdkafka 2.12 sends ListOffsets with a leader epoch. Event Hubs resets
//! that connection, so `fetch_watermarks` never returns. KafkaJS stops at
//! ListOffsets v3, which the broker answers. The numeric offsets are then
//! used for the desktop fetch.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::Value;

use super::oauth::{event_hub_access_token, event_hub_resource};
use super::types::{KafkaConsumeRecord, KafkaSeekOffset};

#[derive(Debug)]
pub(crate) struct EventHubPage {
    pub windows: Vec<(i32, i64, i64)>,
    pub messages: Vec<KafkaConsumeRecord>,
    pub timed_out: bool,
}

const LOOKUP_SCRIPT: &str = r#"
const { Kafka, logLevel } = require('kafkajs');
const Broker = require('kafkajs/src/broker');
const Cluster = require('kafkajs/src/cluster');
const READ_UNCOMMITTED = 0;
const originalListOffsets = Broker.prototype.listOffsets;
Broker.prototype.listOffsets = function listOffsetsUncommitted(request) {
  return originalListOffsets.call(this, Object.assign({}, request, { isolationLevel: READ_UNCOMMITTED }));
};
let eventHubCluster = null;
const originalConnect = Cluster.prototype.connect;
Cluster.prototype.connect = async function captureCluster() {
  eventHubCluster = this;
  return originalConnect.apply(this, arguments);
};
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    console.error('offset lookup input was not JSON');
    process.exit(1);
  }
  const kafka = new Kafka({
    clientId: 'redfireforge-offsets',
    brokers: input.brokers,
    ssl: true,
    logLevel: logLevel.NOTHING,
    sasl: {
      mechanism: 'oauthbearer',
      oauthBearerProvider: async () => ({ value: input.token }),
    },
    connectionTimeout: 15000,
    requestTimeout: 20000,
    retry: { retries: 1 },
  });
  const admin = kafka.admin();
  const budget = Math.max(1000, Number(input.timeoutMs) || 10000);
  const timer = setTimeout(() => {
    console.error('offset lookup timed out');
    process.exit(2);
  }, budget + 15000);
  try {
    await admin.connect();
    const offsets = await admin.fetchTopicOffsets(input.topic);
    const page = await readPage(input, offsets, budget);
    process.stdout.write(JSON.stringify(page) + '\n', () => {
      process.exit(process.exitCode || 0);
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(message);
    process.exit(1);
  } finally {
    clearTimeout(timer);
    try { await admin.disconnect(); } catch (_) {}
  }
});

function numberOf(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startsFor(input, offsets) {
  const rows = offsets.filter((row) => input.partition == null || row.partition === input.partition);
  const seekByPartition = new Map((input.seeks || []).map((seek) => [seek.partition, numberOf(seek.offset)]));
  const total = rows.reduce((sum, row) => sum + Math.max(0, numberOf(row.high) - numberOf(row.low)), 0);
  const maxMessages = Math.max(1, Number(input.maxMessages) || 1);
  return rows.map((row) => {
    const low = numberOf(row.low);
    const high = numberOf(row.high);
    if (seekByPartition.has(row.partition)) {
      return { partition: row.partition, low, high, start: Math.max(low, seekByPartition.get(row.partition)) };
    }
    if (input.fromBeginning) {
      return { partition: row.partition, low, high, start: low };
    }
    const available = Math.max(0, high - low);
    if (total <= 0 || available <= 0) {
      return { partition: row.partition, low, high, start: high };
    }
    const share = Math.max(1, Math.ceil((available / total) * maxMessages));
    return { partition: row.partition, low, high, start: Math.max(low, high - share) };
  });
}

function textOf(value) {
  if (value == null) return null;
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function headersOf(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw != null) out[key] = textOf(raw);
  }
  return out;
}

function recordFrom(topic, partition, message) {
  return {
    topic,
    partition,
    offset: String(message.offset),
    timestamp: message.timestamp ? String(message.timestamp) : null,
    key: textOf(message.key),
    value: textOf(message.value) || '',
    headers: headersOf(message.headers),
  };
}

async function fetchPartition(topic, partition, offset, deadline) {
  const leaders = eventHubCluster.findLeaderForPartitions(topic, [partition]);
  const nodeId = Object.keys(leaders)[0];
  if (nodeId == null) return null;
  const broker = await eventHubCluster.findBroker({ nodeId });
  const response = await broker.fetch({
    isolationLevel: READ_UNCOMMITTED,
    maxWaitTime: Math.max(250, Math.min(5000, deadline - Date.now())),
    minBytes: 1,
    maxBytes: 5242880,
    topics: [{
      topic,
      partitions: [{ partition, fetchOffset: String(offset), maxBytes: 1048576 }],
    }],
  });
  const topicResponse = (response.responses || []).find((item) => item.topicName === topic);
  return topicResponse && (topicResponse.partitions || []).find((item) => item.partition === partition);
}

async function readPage(input, offsets, budget) {
  const rows = startsFor(input, offsets);
  const messages = [];
  const wanted = Math.max(1, Number(input.maxMessages) || 1);
  const deadline = Date.now() + budget;
  let timedOut = false;
  if (!eventHubCluster) return { timedOut: false, offsets, messages };
  for (const row of rows) {
    if (messages.length >= wanted || timedOut) break;
    let share = row.high > row.start
      ? row.high - row.start
      : Math.max(1, Math.ceil(wanted / Math.max(1, rows.length)));
    let cursor = row.start < row.high ? row.start : row.low;
    let high = Math.max(row.high, cursor);
    let placed = false;
    while (messages.length < wanted && cursor < high) {
      if (Date.now() >= deadline) { timedOut = true; break; }
      let part = null;
      try {
        part = await fetchPartition(input.topic, row.partition, cursor, deadline);
      } catch (err) {
        const kind = String((err && (err.type || err.name)) || '');
        if (kind.indexOf('OFFSET_OUT_OF_RANGE') >= 0) break;
        throw err;
      }
      if (!part) break;
      const reported = numberOf(part.highWatermark);
      if (!placed) {
        placed = true;
        if (reported > high) {
          high = reported;
          share = Math.max(share, Math.ceil(wanted / Math.max(1, rows.length)));
        }
        const tail = Math.max(row.low, high - share);
        if (cursor < tail) { cursor = tail; continue; }
      }
      const batch = part.messages || [];
      if (batch.length === 0) break;
      let next = cursor;
      for (const message of batch) {
        const offset = numberOf(message.offset);
        if (offset + 1 > next) next = offset + 1;
        if (message.isControlRecord || offset < cursor) continue;
        messages.push(recordFrom(input.topic, row.partition, message));
        if (messages.length >= wanted) break;
      }
      if (next <= cursor) break;
      cursor = next;
    }
  }
  return { timedOut, offsets, messages };
}
"#;

/// `(partition, low, high)` for one Event Hubs topic.
pub(crate) fn read_event_hub_page(
    brokers: &str,
    topic: &str,
    from_beginning: bool,
    max_messages: usize,
    timeout_ms: u64,
    partition: Option<i32>,
    seeks: Option<&[KafkaSeekOffset]>,
) -> Result<EventHubPage, String> {
    let broker_list: Vec<String> = brokers
        .split(',')
        .map(str::trim)
        .filter(|broker| !broker.is_empty())
        .map(str::to_string)
        .collect();
    let resource = event_hub_resource(&broker_list)
        .ok_or_else(|| "not an Event Hubs broker".to_string())?;
    let root = kafkajs_root().ok_or_else(|| {
        "KafkaJS is not available next to the app, so Event Hubs offsets could not be read".to_string()
    })?;
    let token = event_hub_access_token(&resource)?;
    let payload = serde_json::json!({
        "brokers": broker_list,
        "topic": topic,
        "token": token,
        "fromBeginning": from_beginning,
        "maxMessages": max_messages.max(1),
        "timeoutMs": timeout_ms.max(1),
        "partition": partition,
        "seeks": seeks.unwrap_or(&[]),
    });
    let output = run_kafkajs(&root, &payload.to_string(), timeout_ms)?;
    parse_event_hub_page(&output)
}

fn json_payload(body: &str) -> Result<Value, String> {
    let trimmed = body.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }
    for line in trimmed.lines().rev() {
        let line = line.trim();
        if line.starts_with('{') {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                return Ok(value);
            }
        }
    }
    
    let preview = if trimmed.len() > 200 {
        format!("{}...", &trimmed[..200])
    } else {
        trimmed.to_string()
    };
    
    Err(if preview.is_empty() {
        "Event Hubs offset lookup returned empty output".to_string()
    } else {
        format!("Event Hubs offset lookup did not return offsets: {preview}")
    })
}

pub(crate) fn parse_event_hub_page(body: &str) -> Result<EventHubPage, String> {
    let parsed = json_payload(body)?;
    let rows = parsed
        .get("offsets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let windows = parse_offset_rows(&Value::Array(rows).to_string())?;
    let mut messages = Vec::new();
    if let Some(rows) = parsed.get("messages").and_then(Value::as_array) {
        for row in rows {
            let Some(partition) = row.get("partition").and_then(Value::as_i64) else {
                continue;
            };
            if !(0..=i32::MAX as i64).contains(&partition) {
                continue;
            }
            messages.push(KafkaConsumeRecord {
                topic: row.get("topic").and_then(Value::as_str).unwrap_or("").to_string(),
                partition: partition as i32,
                offset: json_text(row.get("offset")),
                timestamp: row.get("timestamp").and_then(Value::as_str).map(str::to_string),
                key: row.get("key").and_then(Value::as_str).map(str::to_string),
                value: row.get("value").and_then(Value::as_str).unwrap_or("").to_string(),
                headers: row.get("headers").and_then(header_map),
            });
        }
    }
    Ok(EventHubPage {
        windows,
        messages,
        timed_out: parsed.get("timedOut").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn json_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn header_map(value: &Value) -> Option<std::collections::HashMap<String, String>> {
    let object = value.as_object()?;
    let mut headers = std::collections::HashMap::new();
    for (key, item) in object {
        if let Some(text) = item.as_str() {
            headers.insert(key.clone(), text.to_string());
        }
    }
    if headers.is_empty() { None } else { Some(headers) }
}

pub(crate) fn parse_offset_rows(body: &str) -> Result<Vec<(i32, i64, i64)>, String> {
    let rows: Vec<Value> = serde_json::from_str(body.trim())
        .map_err(|_| "Event Hubs offset lookup did not return offsets".to_string())?;
    let mut windows = Vec::new();
    for row in rows {
        let Some(partition) = row.get("partition").and_then(Value::as_i64) else {
            continue;
        };
        let high = json_i64(row.get("high")).or_else(|| json_i64(row.get("offset")));
        let low = json_i64(row.get("low"));
        let (Some(low), Some(high)) = (low, high) else {
            continue;
        };
        if (0..=i32::MAX as i64).contains(&partition) {
            windows.push((partition as i32, low, high));
        }
    }
    if windows.is_empty() {
        return Err("Event Hubs offset lookup returned no partitions".to_string());
    }
    Ok(windows)
}

fn json_i64(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn directory_with_kafkajs(start: PathBuf) -> Option<PathBuf> {
    let mut dir = start;
    for _ in 0..12 {
        if dir.join("node_modules").join("kafkajs").is_dir() {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn kafkajs_root() -> Option<PathBuf> {
    let mut starts = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            // Packaged app: Contents/MacOS/<binary> → Contents/Resources/event-hubs
            if let Some(contents) = bin_dir.parent() {
                let resources = contents.join("Resources");
                starts.push(resources.join("event-hubs"));
                // Tauri keeps the `resources/` prefix from the config path.
                starts.push(resources.join("resources").join("event-hubs"));
            }
            starts.push(bin_dir.to_path_buf());
        }
    }
    starts.into_iter().find_map(directory_with_kafkajs)
}

/// Finder launches have a short PATH, so Node from nvm or Homebrew is missed.
fn node_binary() -> PathBuf {
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return path;
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let nvm = PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            let mut versions: Vec<_> = entries.filter_map(Result::ok).map(|entry| entry.path()).collect();
            versions.sort();
            if let Some(latest) = versions.into_iter().next_back() {
                let node = latest.join("bin/node");
                if node.is_file() {
                    return node;
                }
            }
        }
    }
    PathBuf::from("node")
}

fn run_kafkajs(root: &PathBuf, payload: &str, timeout_ms: u64) -> Result<String, String> {
    let mut child = Command::new(node_binary())
        .arg("-e")
        .arg(LOOKUP_SCRIPT)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Could not start the Event Hubs offset lookup: {err}"))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Could not write the Event Hubs offset lookup".to_string())?
        .write_all(payload.as_bytes())
        .map_err(|err| format!("Could not write the Event Hubs offset lookup: {err}"))?;
    let _ = child.stdin.take();
    let finished = wait_child(
        child,
        Duration::from_millis(timeout_ms.saturating_add(20_000)),
    )?;
    if !finished.status.success() {
        let detail = sanitize_lookup_error(&String::from_utf8_lossy(&finished.stderr));
        return Err(if detail.is_empty() {
            "Event Hubs offset lookup failed".to_string()
        } else {
            format!("Event Hubs offset lookup failed: {detail}")
        });
    }
    Ok(String::from_utf8_lossy(&finished.stdout).to_string())
}

fn wait_child(
    child: std::process::Child,
    budget: Duration,
) -> Result<std::process::Output, String> {
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(budget) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(err)) => Err(format!("Event Hubs offset lookup failed: {err}")),
        Err(_) => {
            let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
            let _ = rx.recv_timeout(Duration::from_secs(2));
            Err("Event Hubs offset lookup timed out".to_string())
        }
    }
}

fn sanitize_lookup_error(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.contains("eyJ"))
        .unwrap_or("")
        .chars()
        .take(180)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_brokers_do_not_use_the_event_hub_offset_client() {
        let err = read_event_hub_page("127.0.0.1:19092", "orders", false, 10, 1000, None, None)
            .unwrap_err();
        assert!(err.contains("not an Event Hubs"));
    }

    #[test]
    fn ignores_log_lines_around_the_page() {
        let page = parse_event_hub_page(
            "{\"level\":\"INFO\",\"message\":\"connected\"}\n{\"timedOut\":false,\"offsets\":[{\"partition\":0,\"low\":\"1\",\"high\":\"9\"}],\"messages\":[]}\n",
        )
        .unwrap();
        assert_eq!(page.windows, vec![(0, 1, 9)]);
        assert!(page.messages.is_empty());
    }

    #[test]
    fn parses_a_page_of_messages() {
        let page = parse_event_hub_page(
            r#"{"timedOut":true,"offsets":[{"partition":0,"low":"4","high":"20"}],"messages":[{"topic":"offers","partition":0,"offset":"15","timestamp":"100","key":"a","value":"{\"status\":\"CREATED\"}","headers":{"source":"hub"}}]}"#,
        )
        .unwrap();
        assert!(page.timed_out);
        assert_eq!(page.windows, vec![(0, 4, 20)]);
        assert_eq!(page.messages.len(), 1);
        assert_eq!(page.messages[0].value, "{\"status\":\"CREATED\"}");
        assert_eq!(
            page.messages[0].headers.as_ref().unwrap().get("source").map(String::as_str),
            Some("hub")
        );
    }

    #[test]
    fn parses_string_and_numeric_offsets() {
        let rows = parse_offset_rows(
            r#"[{"partition":0,"offset":"120","high":"120","low":"40"},{"partition":1,"high":8,"low":1}]"#,
        )
        .unwrap();
        assert_eq!(rows, vec![(0, 40, 120), (1, 1, 8)]);
    }

    #[test]
    fn uses_offset_when_high_is_missing() {
        let rows = parse_offset_rows(r#"[{"partition":2,"offset":"15","low":"3"}]"#).unwrap();
        assert_eq!(rows, vec![(2, 3, 15)]);
    }

    #[test]
    fn rejects_empty_and_unreadable_payloads() {
        assert!(parse_offset_rows("not-json").is_err());
        assert!(parse_offset_rows("[]").unwrap_err().contains("no partitions"));
        assert!(parse_offset_rows(r#"[{"partition":"a"}]"#).is_err());
    }

    #[test]
    fn finds_kafkajs_when_the_app_directory_is_not_the_repo() {
        let root = std::env::temp_dir().join(format!("rff-kafkajs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Contents/Resources/event-hubs/node_modules/kafkajs")).unwrap();
        let found = directory_with_kafkajs(root.join("Contents/MacOS"));
        assert_eq!(found, None);
        let found = directory_with_kafkajs(root.join("Contents/Resources/event-hubs"));
        assert!(found.unwrap().join("node_modules/kafkajs").is_dir());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn drops_lines_that_could_contain_a_token() {
        assert_eq!(sanitize_lookup_error("eyJabc.def.ghi\nBroker disconnected"), "Broker disconnected");
        assert_eq!(sanitize_lookup_error(""), "");
    }
}
