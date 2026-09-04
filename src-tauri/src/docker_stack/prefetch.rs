//! First-launch / Settings image prefetch (Phase 10).
//! Emits `docker-pull`, never `docker-log`.

use super::docker_bin::docker_cmd;
use super::extract::{extract_docker_resources_if_needed, resolve_stack_rel, stack_dir};
use super::manifest::{apply_compose_files, load_manifest, ALL_STACK_KEYS};
use super::prefs::{write_prefetch_choice, PrefetchChoice};
use super::state::{check_docker_state, DockerState};
use serde_json::Value;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

static PREFETCH_BUSY: AtomicBool = AtomicBool::new(false);
static PREFETCH_CANCEL: AtomicBool = AtomicBool::new(false);
static PREFETCH_CHILD: StdMutex<Option<Child>> = StdMutex::new(None);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DockerPullEvent {
    stack_key: String,
    line: String,
}

/// Unique compose projects to pull. `grpc-spring` shares `docker/grpc` with `grpc`.
pub fn prefetch_stack_keys(requested: Option<&str>) -> Vec<&'static str> {
    match requested {
        Some(key) => {
            let key = if key == "grpc-spring" { "grpc" } else { key };
            ALL_STACK_KEYS
                .iter()
                .copied()
                .find(|k| *k == key)
                .into_iter()
                .collect()
        }
        None => ALL_STACK_KEYS
            .iter()
            .copied()
            .filter(|k| *k != "grpc-spring")
            .collect(),
    }
}

/// Pull with the Spring profile so one `docker/grpc` pull covers GRPC-24.
pub fn pull_manifest_key(stack_key: &str) -> &str {
    match stack_key {
        "grpc" | "grpc-spring" => "grpc-spring",
        other => other,
    }
}

fn image_row_is_ready(obj: &Value) -> bool {
    let id = obj
        .get("ID")
        .or_else(|| obj.get("Id"))
        .or_else(|| obj.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    !id.is_empty() && id != "<none>"
}

fn ready_image_count(text: &str) -> usize {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(trimmed) {
        return items.iter().filter(|v| image_row_is_ready(v)).count();
    }
    if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(trimmed) {
        return usize::from(image_row_is_ready(&Value::Object(map)));
    }
    trimmed
        .lines()
        .filter(|line| {
            let line = line.trim();
            if line.is_empty() {
                return false;
            }
            serde_json::from_str::<Value>(line)
                .ok()
                .map(|v| image_row_is_ready(&v))
                .unwrap_or(false)
        })
        .count()
}

pub fn count_compose_services(text: &str) -> usize {
    text.lines().filter(|l| !l.trim().is_empty()).count()
}

pub fn compose_images_already_pulled(images_json: &str, service_count: usize) -> bool {
    service_count > 0 && ready_image_count(images_json) >= service_count
}

fn emit_pull(app: &AppHandle, stack_key: &str, line: impl Into<String>) {
    let _ = app.emit(
        "docker-pull",
        DockerPullEvent {
            stack_key: stack_key.to_string(),
            line: line.into(),
        },
    );
}

fn prefetch_child_lock() -> std::sync::MutexGuard<'static, Option<Child>> {
    PREFETCH_CHILD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn store_child(child: Child) {
    *prefetch_child_lock() = Some(child);
}

fn take_child() -> Option<Child> {
    prefetch_child_lock().take()
}

fn kill_stored_child() -> Result<(), String> {
    if let Some(child) = prefetch_child_lock().as_mut() {
        child
            .start_kill()
            .map_err(|e| format!("Failed to cancel prefetch: {e}"))?;
    }
    Ok(())
}

pub fn kill_prefetch_on_exit() {
    PREFETCH_CANCEL.store(true, Ordering::SeqCst);
    let _ = kill_stored_child();
}

#[tauri::command]
pub fn is_prefetch_running() -> bool {
    PREFETCH_BUSY.load(Ordering::SeqCst)
}

#[tauri::command]
pub async fn cancel_prefetch() -> Result<(), String> {
    PREFETCH_CANCEL.store(true, Ordering::SeqCst);
    kill_stored_child()
}

async fn compose_images_ready(dir: &Path, manifest_key: &str) -> bool {
    let Ok(manifest) = load_manifest(dir, manifest_key) else {
        return false;
    };
    let mut svc = docker_cmd();
    svc.arg("compose");
    apply_compose_files(&mut svc, &manifest);
    svc.args(["config", "--services"]);
    svc.current_dir(dir);
    let Ok(svc_out) = svc.output().await else {
        return false;
    };
    if !svc_out.status.success() {
        return false;
    }
    let service_count = count_compose_services(&String::from_utf8_lossy(&svc_out.stdout));

    let mut img = docker_cmd();
    img.arg("compose");
    apply_compose_files(&mut img, &manifest);
    img.args(["images", "--format", "json"]);
    img.current_dir(dir);
    let Ok(img_out) = img.output().await else {
        return false;
    };
    if !img_out.status.success() {
        return false;
    }
    compose_images_already_pulled(&String::from_utf8_lossy(&img_out.stdout), service_count)
}

async fn pull_one(app: &AppHandle, stack_key: &str) -> Result<(), String> {
    let dir = stack_dir(app, stack_key)?;
    if !dir.exists() {
        return Err(format!("Stack dir not found: {dir:?}"));
    }
    let manifest_key = pull_manifest_key(stack_key);
    if compose_images_ready(&dir, manifest_key).await {
        emit_pull(app, stack_key, format!("✓ {stack_key} images already present — skipped"));
        return Ok(());
    }
    if PREFETCH_CANCEL.load(Ordering::SeqCst) {
        return Err("PREFETCH_CANCELLED".into());
    }

    let manifest = load_manifest(&dir, manifest_key)?;
    emit_pull(app, stack_key, format!("=== Pulling {stack_key} images ==="));

    let mut cmd = docker_cmd();
    cmd.arg("compose");
    apply_compose_files(&mut cmd, &manifest);
    // Local-build services (GraphQL TLS test server, etc.) are not on Docker Hub.
    // Start Stack still builds them; prefetch only pulls public images.
    cmd.args(["pull", "--ignore-buildable"]);
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn docker compose pull: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    store_child(child);
    if PREFETCH_CANCEL.load(Ordering::SeqCst) {
        if let Some(mut child) = take_child() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        return Err("PREFETCH_CANCELLED".into());
    }

    let out_task = async {
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_pull(app, stack_key, line);
            }
        }
    };
    let err_task = async {
        if let Some(err) = stderr {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_pull(app, stack_key, line);
            }
        }
    };
    tokio::join!(out_task, err_task);

    let status = match take_child() {
        Some(mut child) => child
            .wait()
            .await
            .map_err(|e| format!("docker compose pull wait error: {e}"))?,
        None => return Err("PREFETCH_CANCELLED".into()),
    };
    if PREFETCH_CANCEL.load(Ordering::SeqCst) {
        return Err("PREFETCH_CANCELLED".into());
    }
    if !status.success() {
        return Err(format!(
            "PREFETCH_FAILED:docker compose pull failed for {stack_key} (exit {:?})",
            status.code()
        ));
    }
    emit_pull(app, stack_key, format!("✓ {stack_key} images ready"));
    Ok(())
}

#[tauri::command]
pub async fn prefetch_docker_images(
    app: AppHandle,
    stack_key: Option<String>,
) -> Result<(), String> {
    if PREFETCH_BUSY.swap(true, Ordering::SeqCst) {
        return Err("PREFETCH_IN_PROGRESS".into());
    }
    PREFETCH_CANCEL.store(false, Ordering::SeqCst);
    let _guard = PrefetchBusyGuard;
    if let Some(k) = &stack_key {
        resolve_stack_rel(k)?;
    }
    extract_docker_resources_if_needed(&app);

    match check_docker_state().await {
        DockerState::Running => {}
        DockerState::NotInstalled => return Err("DOCKER_NOT_INSTALLED".into()),
        DockerState::OutdatedCompose => return Err("DOCKER_OUTDATED_COMPOSE".into()),
        DockerState::NotRunning => return Err("DOCKER_NOT_RUNNING".into()),
    }

    let _ = write_prefetch_choice(&app, PrefetchChoice::Accepted);
    let keys = prefetch_stack_keys(stack_key.as_deref());
    if keys.is_empty() {
        return Err("Unknown stack key".into());
    }

    let mut failed: Vec<String> = Vec::new();
    for key in &keys {
        if PREFETCH_CANCEL.load(Ordering::SeqCst) {
            return Err("PREFETCH_CANCELLED".into());
        }
        if let Err(err) = pull_one(&app, key).await {
            if err == "PREFETCH_CANCELLED" {
                return Err(err);
            }
            emit_pull(&app, key, format!("⚠ {err}"));
            failed.push(format!("{key}: {err}"));
        }
    }

    prefetch_finish_result(&failed, PREFETCH_CANCEL.load(Ordering::SeqCst))?;
    if stack_key.is_none() {
        let _ = write_prefetch_choice(&app, PrefetchChoice::Done);
    }
    emit_pull(
        &app,
        keys.first().copied().unwrap_or("prefetch"),
        "=== Image download finished ===",
    );
    Ok(())
}

/// Cancel wins even when every pull already succeeded (click during the
/// last `compose pull` teardown). Failed pulls still report `PREFETCH_FAILED`
/// when the user did not cancel.
pub(crate) fn prefetch_finish_result(failed: &[String], cancelled: bool) -> Result<(), String> {
    if cancelled {
        return Err("PREFETCH_CANCELLED".into());
    }
    if !failed.is_empty() {
        return Err(format!("PREFETCH_FAILED:{}", failed.join("; ")));
    }
    Ok(())
}

struct PrefetchBusyGuard;

impl Drop for PrefetchBusyGuard {
    fn drop(&mut self) {
        PREFETCH_BUSY.store(false, Ordering::SeqCst);
        let _ = kill_stored_child();
        *prefetch_child_lock() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_prefetch_skips_grpc_spring_sibling() {
        let keys = prefetch_stack_keys(None);
        assert!(!keys.contains(&"grpc-spring"));
        assert!(keys.contains(&"grpc"));
        assert_eq!(keys.len(), ALL_STACK_KEYS.len() - 1);
        let dirs: Vec<&str> = keys
            .iter()
            .filter_map(|k| super::super::extract::stack_key_to_dir(k))
            .collect();
        let mut unique = dirs.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), dirs.len());
    }

    #[test]
    fn grpc_spring_request_pulls_shared_dir_once() {
        assert_eq!(prefetch_stack_keys(Some("grpc-spring")), vec!["grpc"]);
        assert_eq!(pull_manifest_key("grpc"), "grpc-spring");
    }

    #[test]
    fn compose_images_ready_requires_every_service() {
        let json = r#"[{"ID":"sha256:aaa"},{"ID":"sha256:bbb"}]"#;
        assert!(compose_images_already_pulled(json, 2));
        assert!(!compose_images_already_pulled(json, 3));
        assert!(!compose_images_already_pulled(r#"[{"ID":"<none>"}]"#, 1));
        assert!(!compose_images_already_pulled("", 2));
        assert!(!compose_images_already_pulled(json, 0));
        assert_eq!(count_compose_services("a\nb\n\nc\n"), 3);
        let ndjson = "{\"ID\":\"sha256:aaa\"}\n{\"ID\":\"<none>\"}\n{\"ID\":\"sha256:bbb\"}\n";
        assert!(compose_images_already_pulled(ndjson, 2));
        assert!(!compose_images_already_pulled(ndjson, 3));
        assert_eq!(pull_manifest_key("graphql"), "graphql");
    }

    #[test]
    fn prefetch_finish_cancel_wins_over_success_and_failure() {
        assert_eq!(prefetch_finish_result(&[], false), Ok(()));
        assert_eq!(
            prefetch_finish_result(&[], true),
            Err("PREFETCH_CANCELLED".into())
        );
        assert_eq!(
            prefetch_finish_result(&["graphql: pull failed".into()], true),
            Err("PREFETCH_CANCELLED".into())
        );
        let failed = prefetch_finish_result(&["graphql: pull failed".into()], false)
            .expect_err("failed batch");
        assert!(failed.starts_with("PREFETCH_FAILED:"));
        assert!(failed.contains("graphql"));
    }
}
