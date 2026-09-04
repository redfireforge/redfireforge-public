//! Per-stack Docker image disk usage and on-demand image removal.

use super::docker_bin::docker_cmd;
use super::extract::{extract_docker_resources_if_needed, resolve_stack_rel, stack_dir};
use super::lifecycle::{compose_has_running_result, down_legacy_compose_project};
use super::manifest::{
    apply_compose_files, apply_merged_compose, load_manifest, load_related_manifests, ALL_STACK_KEYS,
};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;
use tauri::AppHandle;

/// `true` if this compose dir was already handled (gRPC + Spring share one project).
pub(crate) fn already_seen_stack_dir(seen: &mut HashSet<String>, dir: &Path) -> bool {
    !seen.insert(dir.to_string_lossy().into_owned())
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackDiskUsage {
    pub stack_key: String,
    pub image_bytes: Option<u64>,
    pub size_label: Option<String>,
}

pub fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
    } else if bytes >= 1_000_000 {
        format!("{:.0} MB", bytes as f64 / 1_000_000.0)
    } else if bytes >= 1_000 {
        format!("{:.0} KB", bytes as f64 / 1_000.0)
    } else {
        format!("{bytes} B")
    }
}

fn parse_human_size(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut num_end = 0;
    for (i, c) in trimmed.char_indices() {
        if c.is_ascii_digit() || c == '.' {
            num_end = i + c.len_utf8();
        } else {
            break;
        }
    }
    if num_end == 0 {
        return None;
    }
    let n: f64 = trimmed[..num_end].parse().ok()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let unit = trimmed[num_end..].trim().to_ascii_uppercase();
    let mul = match unit.as_str() {
        "" | "B" => 1.0,
        "K" | "KB" | "KIB" => 1_000.0,
        "M" | "MB" | "MIB" => 1_000_000.0,
        "G" | "GB" | "GIB" => 1_000_000_000.0,
        "T" | "TB" | "TIB" => 1_000_000_000_000.0,
        _ => return None,
    };
    Some(n.mul_add(mul, 0.0) as u64)
}

fn size_from_json_value(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    if let Some(n) = value.as_f64() {
        if n.is_finite() && n >= 0.0 {
            return Some(n as u64);
        }
    }
    value.as_str().and_then(parse_human_size)
}

fn sizes_from_image_object(obj: &Value) -> Option<u64> {
    obj.get("Size")
        .or_else(|| obj.get("size"))
        .and_then(size_from_json_value)
}

/// Compose v2 may emit a JSON array, a single object, or NDJSON.
pub fn parse_compose_image_sizes(text: &str) -> Option<u64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(trimmed) {
        let sum: u64 = items.iter().filter_map(sizes_from_image_object).sum();
        return (sum > 0).then_some(sum);
    }
    if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(trimmed) {
        return sizes_from_image_object(&Value::Object(map)).filter(|n| *n > 0);
    }
    let sum: u64 = trimmed
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|v| sizes_from_image_object(&v))
        })
        .sum();
    (sum > 0).then_some(sum)
}

async fn compose_image_bytes(dir: &Path, stack_key: &str) -> Option<u64> {
    let manifest = load_manifest(dir, stack_key).ok()?;
    let mut cmd = docker_cmd();
    cmd.arg("compose");
    apply_compose_files(&mut cmd, &manifest);
    cmd.args(["images", "--format", "json"]);
    cmd.current_dir(dir);
    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    parse_compose_image_sizes(&String::from_utf8_lossy(&out.stdout))
}

#[tauri::command]
pub async fn get_docker_image_sizes(app: AppHandle) -> Vec<StackDiskUsage> {
    extract_docker_resources_if_needed(&app);
    let mut results = Vec::new();
    for key in ALL_STACK_KEYS {
        let Ok(dir) = stack_dir(&app, key) else {
            continue;
        };
        if !dir.exists() {
            continue;
        }
        let bytes = compose_image_bytes(&dir, key).await;
        results.push(StackDiskUsage {
            stack_key: (*key).to_string(),
            image_bytes: bytes,
            size_label: bytes.map(format_bytes),
        });
    }
    results
}

pub(crate) fn removal_blocked_reason(key: &str, probe: Result<bool, String>) -> Option<String> {
    match probe {
        Ok(true) => Some(format!("{key} is running — stop it before removing images")),
        Ok(false) => None,
        Err(e) => Some(format!("{key}: cannot verify the stack is stopped ({e})")),
    }
}

pub(crate) fn removal_peer_keys(key: &str) -> Vec<&str> {
    match key {
        "grpc" | "grpc-spring" => vec!["grpc", "grpc-spring"],
        other => vec![other],
    }
}

/// `Ok(true)` if this stack or a sibling is up. `Err` if Compose cannot say
/// (fail closed — do not `--rmi` a stack that might still be running).
async fn stack_or_sibling_running(app: &AppHandle, key: &str) -> Result<bool, String> {
    let peers = removal_peer_keys(key);
    for peer in peers {
        let Ok(dir) = stack_dir(app, peer) else {
            continue;
        };
        if !dir.exists() {
            continue;
        }
        let manifest = load_manifest(&dir, peer)?;
        if compose_has_running_result(&dir, &manifest).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub async fn compose_down_rmi(dir: &Path, stack_key: &str) -> Result<(), String> {
    let manifests = load_related_manifests(dir, stack_key);
    if manifests.is_empty() {
        return Err(format!("Cannot read stack.json for {stack_key}"));
    }
    down_legacy_compose_project(dir, &manifests).await;
    let mut cmd = docker_cmd();
    cmd.arg("compose");
    apply_merged_compose(&mut cmd, &manifests);
    cmd.args(["down", "--rmi", "all", "--remove-orphans"]);
    cmd.current_dir(dir);
    let status = cmd
        .status()
        .await
        .map_err(|e| format!("Failed to remove images for {stack_key}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("docker compose down --rmi all failed for {stack_key}"))
    }
}

/// Removes images for one stack, or every stack when `stack_key` is `None`.
/// Running stacks are skipped so Settings → Remove cannot tear down a live lesson.
#[tauri::command]
pub async fn remove_docker_images(
    app: AppHandle,
    stack_key: Option<String>,
) -> Result<Vec<String>, String> {
    if let Some(k) = &stack_key {
        resolve_stack_rel(k)?;
    }
    if super::prefetch::is_prefetch_running() {
        return Err("PREFETCH_IN_PROGRESS".into());
    }
    extract_docker_resources_if_needed(&app);
    let targets: Vec<&str> = match &stack_key {
        Some(k) => vec![k.as_str()],
        None => ALL_STACK_KEYS.to_vec(),
    };
    let mut removed = Vec::new();
    let mut errors = Vec::new();
    let mut seen_dirs = HashSet::new();
    for key in targets {
        let Ok(dir) = stack_dir(&app, key) else {
            continue;
        };
        if !dir.exists() {
            continue;
        }
        if already_seen_stack_dir(&mut seen_dirs, &dir) {
            continue;
        }
        if let Some(reason) = removal_blocked_reason(key, stack_or_sibling_running(&app, key).await)
        {
            errors.push(reason);
            continue;
        }
        match compose_down_rmi(&dir, key).await {
            Ok(()) => removed.push(key.to_string()),
            Err(e) => errors.push(e),
        }
    }
    if errors.is_empty() {
        Ok(removed)
    } else if removed.is_empty() {
        Err(errors.join("; "))
    } else {
        Err(format!(
            "Removed {} stack(s); also: {}",
            removed.join(", "),
            errors.join("; ")
        ))
    }
}

pub async fn remove_all_images_for_uninstall(app: &AppHandle) -> (Vec<String>, Vec<String>) {
    extract_docker_resources_if_needed(app);
    let mut removed = Vec::new();
    let mut errors = Vec::new();
    let mut seen_dirs = HashSet::new();
    for key in ALL_STACK_KEYS {
        let Ok(dir) = stack_dir(app, key) else {
            continue;
        };
        if !dir.exists() {
            continue;
        }
        if already_seen_stack_dir(&mut seen_dirs, &dir) {
            continue;
        }
        match compose_down_rmi(&dir, key).await {
            Ok(()) => removed.push((*key).to_string()),
            Err(e) => errors.push(e),
        }
    }
    (removed, errors)
}

#[cfg(test)]
mod tests {
    use super::{format_bytes, parse_compose_image_sizes, parse_human_size};

    #[test]
    fn format_bytes_picks_unit() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(12_000), "12 KB");
        assert_eq!(format_bytes(512_000_000), "512 MB");
        assert_eq!(format_bytes(2_700_000_000), "2.7 GB");
    }

    #[test]
    fn parse_human_size_accepts_suffixes() {
        assert_eq!(parse_human_size("142MB"), Some(142_000_000));
        assert_eq!(parse_human_size("1.5 GB"), Some(1_500_000_000));
        assert_eq!(parse_human_size("2048"), Some(2048));
        assert_eq!(parse_human_size("not-a-size"), None);
    }

    #[test]
    fn parse_compose_image_sizes_json_array() {
        let json = r#"[{"Repository":"a","Size":"100MB"},{"Repository":"b","Size":512000000}]"#;
        assert_eq!(parse_compose_image_sizes(json), Some(612_000_000));
    }

    #[test]
    fn parse_compose_image_sizes_ndjson() {
        let text = "{\"Size\":\"50MB\"}\n{\"size\":25000000}\n";
        assert_eq!(parse_compose_image_sizes(text), Some(75_000_000));
    }

    #[test]
    fn parse_compose_image_sizes_empty_is_none() {
        assert_eq!(parse_compose_image_sizes(""), None);
        assert_eq!(parse_compose_image_sizes("[]"), None);
        assert_eq!(parse_compose_image_sizes("{\"Name\":\"x\"}"), None);
    }

    #[test]
    fn already_seen_stack_dir_skips_the_second_visit() {
        let mut seen = std::collections::HashSet::new();
        let dir = std::path::Path::new("/tmp/rff-docker/grpc");
        assert!(!super::already_seen_stack_dir(&mut seen, dir));
        assert!(super::already_seen_stack_dir(&mut seen, dir));
        assert!(!super::already_seen_stack_dir(&mut seen, std::path::Path::new("/tmp/rff-docker/graphql")));
    }

    #[test]
    fn grpc_keys_share_removal_peers() {
        assert_eq!(
            super::removal_peer_keys("grpc"),
            super::removal_peer_keys("grpc-spring")
        );
        assert_eq!(super::removal_peer_keys("graphql"), vec!["graphql"]);
    }

    #[test]
    fn removal_blocked_reason_fails_closed_on_probe_error() {
        assert_eq!(
            super::removal_blocked_reason("graphql", Ok(true)).as_deref(),
            Some("graphql is running — stop it before removing images")
        );
        assert_eq!(super::removal_blocked_reason("graphql", Ok(false)), None);
        assert_eq!(
            super::removal_blocked_reason("graphql", Err("compose ps failed".into())).as_deref(),
            Some("graphql: cannot verify the stack is stopped (compose ps failed)")
        );
    }
}
