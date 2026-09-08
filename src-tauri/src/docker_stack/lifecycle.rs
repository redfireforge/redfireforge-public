//! Start / stop / status / stale / uninstall.

use super::docker_bin::docker_cmd;
use super::extract::{
    docker_data_dir, ensure_complete_stack_dir, ensure_docker_extracted,
    extract_docker_resources_if_needed, resolve_stack_rel, stack_dir, with_extract_gate,
};
use super::last_run::{
    append_last_run_line, last_run_log_path, read_last_run_log_text, truncate_last_run_log,
};
use super::limit::{slot_key, stack_limit_error};
use super::manifest::{
    apply_compose_files, apply_compose_files_without_profile, apply_merged_compose,
    compose_has_running_from_lists, compose_merged_args_for_project, compose_up_args_with_build,
    is_version_newer, legacy_compose_project_if_distinct, load_manifest, load_related_manifests,
    overlay_only_ports, parse_compose_name_list, ALL_STACK_KEYS, STARTED_WITH_FILE, StackManifest,
};
use super::ports::{check_port_conflicts, check_ports_free};
use super::state::docker_available_memory_mb;
use crate::companion::COMPANION_PORT;
use std::collections::{HashMap, HashSet};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DockerLogEvent {
    stack_key: String,
    line: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LowMemoryWarning {
    stack_key: String,
    available_mb: u64,
    recommended_mb: u64,
}

static START_LIMIT_GATE: Mutex<()> = Mutex::const_new(());
static RESERVED_STARTS: LazyLock<StdMutex<HashMap<String, usize>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static START_CHILDREN: LazyLock<StdMutex<HashMap<String, HashMap<u64, Child>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static NEXT_START_CHILD: AtomicU64 = AtomicU64::new(1);

fn start_children_lock() -> std::sync::MutexGuard<'static, HashMap<String, HashMap<u64, Child>>> {
    START_CHILDREN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `grpc` / `grpc-spring` share one compose project — F3 Stop of either
/// must cancel both in-flight `compose up` children.
pub(crate) fn keys_sharing_start_slot(stack_key: &str) -> Vec<&'static str> {
    let slot = slot_key(stack_key);
    ALL_STACK_KEYS
        .iter()
        .copied()
        .filter(|k| slot_key(k) == slot)
        .collect()
}

fn register_start_child(stack_key: &str, child: Child) -> u64 {
    let id = NEXT_START_CHILD.fetch_add(1, Ordering::Relaxed);
    start_children_lock()
        .entry(stack_key.to_string())
        .or_default()
        .insert(id, child);
    id
}

fn take_start_child(stack_key: &str, id: u64) -> Option<Child> {
    let mut lock = start_children_lock();
    let child = lock.get_mut(stack_key).and_then(|m| m.remove(&id));
    if lock.get(stack_key).is_some_and(|m| m.is_empty()) {
        lock.remove(stack_key);
    }
    child
}

fn take_and_kill_start_children(keys: &[&str]) {
    let mut lock = start_children_lock();
    let mut taken = Vec::new();
    for key in keys {
        if let Some(children) = lock.remove(*key) {
            taken.extend(children.into_values());
        }
    }
    drop(lock);
    for mut child in taken {
        let _ = child.start_kill();
    }
}

/// F3 Stop / Settings Stop: kill `compose up` that is still pulling.
fn cancel_in_flight_starts_for_stack(stack_key: &str) {
    take_and_kill_start_children(&keys_sharing_start_slot(stack_key));
}

/// Quit / Stop all: orphaned `compose up` would keep pulling after Exit.
fn cancel_all_in_flight_starts() {
    let mut lock = start_children_lock();
    let taken: Vec<Child> = lock.drain().flat_map(|(_, m)| m.into_values()).collect();
    drop(lock);
    for mut child in taken {
        let _ = child.start_kill();
    }
}

fn reserved_starts_lock() -> std::sync::MutexGuard<'static, HashMap<String, usize>> {
    RESERVED_STARTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Counts overlapping Start of the same key (two GraphQL lessons, or Retry
/// while the first compose is still pulling). A HashSet would drop the slot
/// when the first command returned.
struct ReservedStart(String);

impl ReservedStart {
    fn acquire(key: String) -> Self {
        let mut lock = reserved_starts_lock();
        *lock.entry(key.clone()).or_insert(0) += 1;
        Self(key)
    }
}

impl Drop for ReservedStart {
    fn drop(&mut self) {
        let mut lock = reserved_starts_lock();
        match lock.get_mut(&self.0) {
            Some(count) if *count > 1 => *count -= 1,
            Some(_) => {
                lock.remove(&self.0);
            }
            None => {}
        }
    }
}

fn merge_reserved_starts(running: &mut Vec<String>) {
    let reserved = reserved_starts_lock();
    let mut present: HashSet<String> = running.drain(..).collect();
    for key in reserved.keys() {
        present.insert(key.clone());
    }
    // Roster order so F3 Stop buttons stay stable when one key is only reserved
    // (still pulling) and another is already up.
    for key in ALL_STACK_KEYS {
        if present.remove(*key) {
            running.push((*key).to_string());
        }
    }
    let mut unknown: Vec<String> = present.into_iter().collect();
    unknown.sort();
    running.extend(unknown);
}

fn emit_log(app: &AppHandle, stack_key: &str, line: impl Into<String>) {
    let line = line.into();
    let _ = app.emit(
        "docker-log",
        DockerLogEvent {
            stack_key: stack_key.to_string(),
            line: line.clone(),
        },
    );
    // Hold the extract mutex so a version-bump wipe cannot delete the file
    // between `stack_dir` and append (stdout/stderr both call this).
    with_extract_gate(|| {
        if let Ok(dir) = stack_dir(app, stack_key) {
            append_last_run_line(&dir, stack_key, &line);
        }
    });
}

async fn compose_service_names(
    dir: &Path,
    manifest: &StackManifest,
    include_profile: bool,
    args: &[&str],
) -> Vec<String> {
    compose_service_names_result(dir, manifest, include_profile, args)
        .await
        .unwrap_or_default()
}

async fn compose_service_names_result(
    dir: &Path,
    manifest: &StackManifest,
    include_profile: bool,
    args: &[&str],
) -> Result<Vec<String>, String> {
    let mut cmd = docker_cmd();
    cmd.arg("compose");
    if include_profile {
        apply_compose_files(&mut cmd, manifest);
    } else {
        apply_compose_files_without_profile(&mut cmd, manifest);
    }
    cmd.args(args);
    cmd.current_dir(dir);
    match cmd.output().await {
        Ok(out) if out.status.success() => Ok(parse_compose_name_list(
            &String::from_utf8_lossy(&out.stdout),
        )),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let detail = stderr.trim();
            if detail.is_empty() {
                Err(format!("docker compose {} failed", args.join(" ")))
            } else {
                Err(format!("docker compose {} failed: {detail}", args.join(" ")))
            }
        }
        Err(e) => Err(format!("docker compose {} failed: {e}", args.join(" "))),
    }
}

async fn compose_ps_running(dir: &Path, manifest: &StackManifest, include_profile: bool) -> Vec<String> {
    compose_service_names(
        dir,
        manifest,
        include_profile,
        &["ps", "--services", "--filter", "status=running"],
    )
    .await
}

/// Any container in this compose project (default or profiled) is running.
pub(crate) async fn compose_project_has_containers_result(
    dir: &Path,
    manifest: &StackManifest,
) -> Result<bool, String> {
    let profiled = compose_service_names_result(
        dir,
        manifest,
        true,
        &["ps", "--services", "--filter", "status=running"],
    )
    .await?;
    if !profiled.is_empty() {
        return Ok(true);
    }
    if manifest.compose_profile.is_some() {
        let defaults = compose_service_names_result(
            dir,
            manifest,
            false,
            &["ps", "--services", "--filter", "status=running"],
        )
        .await?;
        return Ok(!defaults.is_empty());
    }
    Ok(false)
}

/// Stop all: skip when Compose reported nothing, down when up, fail when unknown.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StopAllProbe {
    Skip,
    Down,
    Unknown(String),
}

pub(crate) fn classify_stop_all_probe(probe: Result<bool, String>) -> StopAllProbe {
    match probe {
        Ok(false) => StopAllProbe::Skip,
        Ok(true) => StopAllProbe::Down,
        Err(e) => StopAllProbe::Unknown(e),
    }
}

pub(crate) async fn compose_has_running(dir: &Path, manifest: &StackManifest) -> bool {
    let running = compose_ps_running(dir, manifest, true).await;
    let defaults = if manifest.compose_profile.is_some() {
        compose_service_names(dir, manifest, false, &["config", "--services"]).await
    } else {
        Vec::new()
    };
    compose_has_running_from_lists(&running, manifest.compose_profile.is_some(), &defaults)
}

/// Missing extract dirs are “not running”. A failed `compose ps` is `Err`
/// so Start cannot treat an unknown roster as empty and allow a third stack.
fn fold_running_stack_probes(
    results: impl IntoIterator<Item = Result<Option<String>, String>>,
) -> Result<Vec<String>, String> {
    let mut running = Vec::new();
    let mut errors = Vec::new();
    for item in results {
        match item {
            Ok(Some(key)) => running.push(key),
            Ok(None) => {}
            Err(e) => errors.push(e),
        }
    }
    if errors.is_empty() {
        Ok(running)
    } else {
        Err(format!(
            "Cannot verify running stacks ({})",
            errors.join("; ")
        ))
    }
}

async fn list_running_stack_keys(app: &AppHandle) -> Result<Vec<String>, String> {
    let futs = ALL_STACK_KEYS.iter().map(|key| {
        let app = app.clone();
        async move {
            let dir = match stack_dir(&app, key) {
                Ok(d) => d,
                Err(_) => return Ok(None),
            };
            if !dir.exists() {
                return Ok(None);
            }
            let manifest = match load_manifest(&dir, key) {
                Ok(m) => m,
                Err(_) => return Ok(None),
            };
            match compose_has_running_result(&dir, &manifest).await {
                Ok(true) => Ok(Some((*key).to_string())),
                Ok(false) => Ok(None),
                Err(e) => Err(format!("{key}: {e}")),
            }
        }
    });
    fold_running_stack_probes(futures::future::join_all(futs).await)
}

pub(crate) async fn compose_has_running_result(
    dir: &Path,
    manifest: &StackManifest,
) -> Result<bool, String> {
    let running = compose_service_names_result(
        dir,
        manifest,
        true,
        &["ps", "--services", "--filter", "status=running"],
    )
    .await?;
    let defaults = if manifest.compose_profile.is_some() {
        compose_service_names_result(dir, manifest, false, &["config", "--services"]).await?
    } else {
        Vec::new()
    };
    Ok(compose_has_running_from_lists(
        &running,
        manifest.compose_profile.is_some(),
        &defaults,
    ))
}

/// `Ok(false)` only when Compose successfully reported no running services.
/// A Docker / compose CLI failure is `Err` so Settings does not treat a
/// flaky probe as “stopped” (that hid Stop and enabled Remove).
#[tauri::command]
pub async fn get_stack_status(stack_key: String, app: AppHandle) -> Result<bool, String> {
    resolve_stack_rel(&stack_key)?;
    extract_docker_resources_if_needed(&app);
    let dir = stack_dir(&app, &stack_key)?;
    if !dir.exists() {
        return Ok(false);
    }
    let manifest = load_manifest(&dir, &stack_key)?;
    compose_has_running_result(&dir, &manifest).await
}

#[tauri::command]
pub async fn get_stack_manifest(
    stack_key: String,
    app: AppHandle,
) -> Result<StackManifest, String> {
    resolve_stack_rel(&stack_key)?;
    extract_docker_resources_if_needed(&app);
    let dir = stack_dir(&app, &stack_key)?;
    load_manifest(&dir, &stack_key)
}

/// Loopback TCP connect — do not HTTP-GET through reqwest (corporate
/// `ALL_PROXY` / `HTTP_PROXY` hijacks `127.0.0.1` and the companion looks down).
fn probe_loopback_port(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

pub(crate) fn oom_in_compose_ps_json(text: &str) -> bool {
    text.lines().any(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return false;
        }
        serde_json::from_str::<serde_json::Value>(trimmed)
            .ok()
            .and_then(|v| {
                v.get("ExitCode")
                    .or_else(|| v.get("exitCode"))
                    .and_then(|e| e.as_i64())
            })
            .map(|code| code == 137)
            .unwrap_or(false)
    })
}

async fn check_for_oom(stack_dir: &Path, manifest: &StackManifest) -> bool {
    let mut cmd = docker_cmd();
    cmd.arg("compose");
    apply_compose_files(&mut cmd, manifest);
    cmd.args(["ps", "--format", "json", "--all"]);
    cmd.current_dir(stack_dir);
    let Ok(out) = cmd.output().await else {
        return false;
    };
    oom_in_compose_ps_json(&String::from_utf8_lossy(&out.stdout))
}

async fn stream_child_pipes(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    app: &AppHandle,
    stack_key: &str,
) {
    let out_task = async {
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(app, stack_key, line);
            }
        }
    };
    let err_task = async {
        if let Some(err) = stderr {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                emit_log(app, stack_key, line);
            }
        }
    };
    tokio::join!(out_task, err_task);
}

async fn stream_piped_lines(child: &mut Child, app: &AppHandle, stack_key: &str) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    stream_child_pipes(stdout, stderr, app, stack_key).await;
}

/// Tear down leftovers from before `-p rff-*` (folder-basename projects).
pub(crate) async fn down_legacy_compose_project(dir: &Path, manifests: &[StackManifest]) {
    let Some(legacy) = legacy_compose_project_if_distinct(dir, manifests) else {
        return;
    };
    let mut cmd = docker_cmd();
    cmd.arg("compose");
    for arg in compose_merged_args_for_project(manifests, &legacy) {
        cmd.arg(arg);
    }
    cmd.arg("down");
    cmd.current_dir(dir);
    let _ = cmd.status().await;
}

#[tauri::command]
pub async fn start_docker_stack(
    stack_key: String,
    app: AppHandle,
    build: Option<bool>,
) -> Result<(), String> {
    let dir = match ensure_complete_stack_dir(&app, Some(&stack_key)) {
        Ok(d) => d,
        Err(e) => {
            emit_log(&app, &stack_key, format!("✗ {e}"));
            return Err(e);
        }
    };
    let manifest = load_manifest(&dir, &stack_key)?;

    let _start_gate = START_LIMIT_GATE.lock().await;
    // Re-check under the gate so a racing Start of this same key is treated
    // as overlay, not a third slot. Probe failures are errors — fail-open
    // “not running” would skip the overlay path (F2 on our own ports) and
    // under-count other stacks (a third Start).
    let this_up = match compose_has_running_result(&dir, &manifest).await {
        Ok(up) => up,
        Err(e) => {
            let msg = format!("Cannot verify if {stack_key} is already running: {e}");
            emit_log(&app, &stack_key, format!("✗ {msg}"));
            return Err(msg);
        }
    };
    let project_up = match compose_project_has_containers_result(&dir, &manifest).await {
        Ok(up) => up,
        Err(e) => {
            let msg = format!("Cannot verify compose project status: {e}");
            emit_log(&app, &stack_key, format!("✗ {msg}"));
            return Err(msg);
        }
    };
    if !this_up {
        let mut running = match list_running_stack_keys(&app).await {
            Ok(keys) => keys,
            Err(e) => {
                emit_log(&app, &stack_key, format!("✗ {e}"));
                return Err(e);
            }
        };
        merge_reserved_starts(&mut running);
        let running_refs: Vec<&str> = running.iter().map(String::as_str).collect();
        if let Some(err) = stack_limit_error(&stack_key, &running_refs) {
            return Err(err);
        }
        // Sibling overlay (gRPC Go already up, starting Spring) must not
        // treat the shared ports as a foreign conflict — still check ports
        // this profile adds (9090 / 8081).
        if !project_up {
            let related = load_related_manifests(&dir, &stack_key);
            down_legacy_compose_project(&dir, &related).await;
            check_port_conflicts(&manifest).await?;
        } else {
            let extra = overlay_only_ports(&manifest, &load_related_manifests(&dir, &stack_key));
            if !extra.is_empty() {
                check_ports_free(&extra).await?;
            }
        }
        if let Some(err) = super::state::expired_cert_start_error(manifest.cert_expires_at.as_deref()) {
            emit_log(
                &app,
                &stack_key,
                "✗ This lesson needs a security certificate that has expired. Update the app.",
            );
            return Err(err);
        }
    }
    let _reserved = ReservedStart::acquire(stack_key.clone());

    // Wipe the previous run only after port/limit checks. If compose cannot
    // spawn, restore that file so Show logs is not blank. Hold the extract
    // mutex so a version-bump wipe cannot stash the truncated empty file.
    let previous_run = with_extract_gate(|| {
        let prev = read_last_run_log_text(&dir, &stack_key);
        truncate_last_run_log(&dir, &stack_key);
        prev
    });

    if this_up {
        emit_log(
            &app,
            &stack_key,
            "=== Stack already has running containers — ensuring all services are up ===",
        );
    } else if project_up {
        emit_log(
            &app,
            &stack_key,
            "=== Adding profile services to the running compose project ===",
        );
    }

    if let (Some(avail), Some(min)) = (docker_available_memory_mb().await, manifest.min_memory_mb) {
        if avail < min {
            let _ = app.emit(
                "docker-low-memory",
                LowMemoryWarning {
                    stack_key: stack_key.clone(),
                    available_mb: avail,
                    recommended_mb: min,
                },
            );
        }
    }

    emit_log(&app, &stack_key, format!("=== Starting {stack_key} stack ==="));

    let mut cmd = docker_cmd();
    for arg in compose_up_args_with_build(&manifest, build.unwrap_or(false)) {
        cmd.arg(arg);
    }
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            if let (Some(path), Some(text)) = (last_run_log_path(&dir, &stack_key), previous_run) {
                with_extract_gate(|| {
                    let _ = std::fs::write(path, text);
                });
            }
            return Err(format!("Failed to spawn docker: {e}"));
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child_id = register_start_child(&stack_key, child);
    drop(_start_gate);

    stream_child_pipes(stdout, stderr, &app, &stack_key).await;

    let status = match take_start_child(&stack_key, child_id) {
        Some(mut child) => child
            .wait()
            .await
            .map_err(|e| format!("docker compose wait error: {e}"))?,
        None => {
            emit_log(
                &app,
                &stack_key,
                "✗ Start cancelled — the stack was stopped",
            );
            return Err("START_CANCELLED".into());
        }
    };

    if !status.success() {
        if check_for_oom(&dir, &manifest).await {
            return Err(format!(
                "OOM_KILLED:{}",
                manifest.min_memory_mb.unwrap_or(0)
            ));
        }
        return Err(format!(
            "START_FAILED:docker compose up failed (exit {:?})",
            status.code()
        ));
    }
    emit_log(&app, &stack_key, "✓ compose project started");

    if manifest.requires_companion_probe {
        emit_log(
            &app,
            &stack_key,
            format!("Checking gRPC companion server on port {COMPANION_PORT}..."),
        );
        if probe_loopback_port(COMPANION_PORT, Duration::from_secs(2)) {
            emit_log(&app, &stack_key, "✓ gRPC companion server ready");
        } else {
            emit_log(
                &app,
                &stack_key,
                format!(
                    "⚠ gRPC proxy (port {COMPANION_PORT}) not responding. Try restarting the app."
                ),
            );
        }
    }

    let stamp = dir.join(STARTED_WITH_FILE);
    let _ = std::fs::write(&stamp, env!("CARGO_PKG_VERSION"));
    emit_log(&app, &stack_key, "=== Stack started ===");
    Ok(())
}

#[tauri::command]
pub async fn stop_docker_stack(stack_key: String, app: AppHandle) -> Result<(), String> {
    resolve_stack_rel(&stack_key)?;
    // Best-effort extract. Do not require every sentinel — an unrelated
    // missing file must not block `compose down` of a stack that is up.
    extract_docker_resources_if_needed(&app);
    let dir = stack_dir(&app, &stack_key)?;
    let mut manifests = load_related_manifests(&dir, &stack_key);
    if manifests.is_empty() {
        ensure_docker_extracted(&app)?;
        manifests = load_related_manifests(&dir, &stack_key);
    }
    if manifests.is_empty() {
        let err = format!("Cannot read stack.json for {stack_key}");
        emit_log(&app, &stack_key, format!("✗ {err}"));
        return Err(err);
    }
    // Kill an in-flight Start (image pull) so F3 Stop cannot come back up.
    cancel_in_flight_starts_for_stack(&stack_key);
    emit_log(&app, &stack_key, format!("=== Stopping {stack_key} stack ==="));

    let mut cmd = docker_cmd();
    cmd.arg("compose");
    apply_merged_compose(&mut cmd, &manifests);
    cmd.arg("down");
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to stop stack: {e}"))?;
    stream_piped_lines(&mut child, &app, &stack_key).await;
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to stop stack: {e}"))?;
    down_legacy_compose_project(&dir, &manifests).await;
    if !status.success() {
        return Err("docker compose down failed".to_string());
    }
    emit_log(&app, &stack_key, "=== Stack stopped ===");
    Ok(())
}

#[tauri::command]
pub async fn stop_all_stacks(app: AppHandle) -> Result<(), String> {
    extract_docker_resources_if_needed(&app);
    cancel_all_in_flight_starts();
    let mut errors = vec![];
    let mut seen_dirs = std::collections::HashSet::new();
    for key in ALL_STACK_KEYS {
        let Ok(dir) = stack_dir(&app, key) else {
            continue;
        };
        if !dir.exists() {
            continue;
        }
        let dir_id = dir.to_string_lossy().to_string();
        if !seen_dirs.insert(dir_id) {
            continue;
        }
        let manifest = match load_manifest(&dir, key) {
            Ok(m) => m,
            Err(e) => {
                errors.push(format!("{key}: {e}"));
                continue;
            }
        };
        let manifests = load_related_manifests(&dir, key);
        match classify_stop_all_probe(
            compose_project_has_containers_result(&dir, &manifest).await,
        ) {
            StopAllProbe::Skip => {
                down_legacy_compose_project(&dir, &manifests).await;
                continue;
            }
            StopAllProbe::Down => {}
            StopAllProbe::Unknown(e) => {
                errors.push(format!("{key}: {e}"));
                continue;
            }
        }
        let mut cmd = docker_cmd();
        cmd.arg("compose");
        apply_merged_compose(&mut cmd, &manifests);
        cmd.arg("down");
        let status = cmd.current_dir(&dir).status().await;
        down_legacy_compose_project(&dir, &manifests).await;
        if status.map(|s| !s.success()).unwrap_or(true) {
            errors.push((*key).to_string());
        }
    }
    down_orphaned_rff_projects().await;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("Failed to stop: {}", errors.join(", ")))
    }
}

/// Quit path: do not extract (that mutex can block behind a mid-pull prefetch).
pub async fn stop_rff_projects_for_quit() {
    cancel_all_in_flight_starts();
    down_orphaned_rff_projects().await;
}

/// `docker compose ls -q` names that belong to Learning Hub (`rff-*` only).
pub(crate) fn rff_compose_project_names(ls_output: &str) -> Vec<String> {
    ls_output
        .lines()
        .map(str::trim)
        .filter(|name| name.starts_with("rff-") && !name.is_empty())
        .map(str::to_string)
        .collect()
}

async fn down_orphaned_rff_projects() {
    let mut out = docker_cmd()
        .args(["compose", "ls", "-q", "--all"])
        .output()
        .await;
    if out.as_ref().map(|o| o.status.success()).unwrap_or(false) == false {
        out = docker_cmd().args(["compose", "ls", "-q"]).output().await;
    }
    let Ok(out) = out else {
        return;
    };
    for name in rff_compose_project_names(&String::from_utf8_lossy(&out.stdout)) {
        let _ = docker_cmd()
            .args(["compose", "-p", &name, "down"])
            .status()
            .await;
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleStackInfo {
    pub stack_key: String,
    pub started_with: String,
    pub since_version: String,
}

#[tauri::command]
pub async fn check_stale_stacks(app: AppHandle) -> Vec<StaleStackInfo> {
    extract_docker_resources_if_needed(&app);
    let mut stale = vec![];
    let mut seen_dirs = HashSet::new();
    for key in ALL_STACK_KEYS {
        let Ok(dir) = stack_dir(&app, key) else {
            continue;
        };
        if !dir.exists() {
            continue;
        }
        let Ok(manifest) = load_manifest(&dir, key) else {
            continue;
        };
        if !compose_has_running(&dir, &manifest).await {
            continue;
        }
        let dir_id = dir.to_string_lossy().to_string();
        if !seen_dirs.insert(dir_id) {
            continue;
        }
        let started_with = std::fs::read_to_string(dir.join(STARTED_WITH_FILE))
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        let since_version = manifest.since_version.unwrap_or_default();
        if is_version_newer(&since_version, &started_with) {
            stale.push(StaleStackInfo {
                stack_key: (*key).to_string(),
                started_with,
                since_version,
            });
        }
    }
    stale
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallReport {
    pub stopped: Vec<String>,
    pub errors: Vec<String>,
}

/// Stop every stack, remove compose images (`--rmi all`), then wipe `$APP_DATA/docker/`.
/// Preference file `docker-stop-on-close` lives beside that folder and is kept.
#[tauri::command]
pub async fn uninstall_cleanup(app: AppHandle) -> Result<UninstallReport, String> {
    extract_docker_resources_if_needed(&app);
    super::prefetch::kill_prefetch_on_exit();
    cancel_all_in_flight_starts();
    let (stopped, mut errors) = super::images::remove_all_images_for_uninstall(&app).await;
    let docker_dir = docker_data_dir(&app)?;
    if docker_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&docker_dir) {
            errors.push(format!("Failed to wipe docker data: {e}"));
        }
    }
    Ok(UninstallReport { stopped, errors })
}

/// Read the persisted last-run file. Do **not** extract first — extract can
/// `remove_dir_all` the docker tree, and a Show-logs hydrate must not wipe logs.
#[tauri::command]
pub async fn read_last_run_log(app: AppHandle, stack_key: String) -> Option<String> {
    with_extract_gate(|| {
        let dir = stack_dir(&app, &stack_key).ok()?;
        read_last_run_log_text(&dir, &stack_key)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    static RESERVED_TEST_GATE: StdMutex<()> = StdMutex::new(());

    fn lock_reserved_for_test() -> std::sync::MutexGuard<'static, ()> {
        RESERVED_TEST_GATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn oom_detects_exit_137() {
        let json = r#"{"Name":"redpanda","ExitCode":137}"#;
        assert!(oom_in_compose_ps_json(json));
        assert!(!oom_in_compose_ps_json(r#"{"Name":"ok","ExitCode":0}"#));
        assert!(!oom_in_compose_ps_json(""));
        assert!(oom_in_compose_ps_json(
            "{\"Name\":\"a\",\"ExitCode\":0}\n{\"Name\":\"b\",\"ExitCode\":137}"
        ));
    }

    #[test]
    fn rff_compose_project_names_ignore_unrelated() {
        let ls = "rff-graphql\norders-api-postgres\nrff-ws-tls\n\nrff-graphql\n";
        assert_eq!(
            rff_compose_project_names(ls),
            vec![
                "rff-graphql".to_string(),
                "rff-ws-tls".to_string(),
                "rff-graphql".to_string()
            ]
        );
        assert!(rff_compose_project_names("graphql\ntls\n").is_empty());
    }

    #[test]
    fn reserved_start_is_reference_counted() {
        let _gate = lock_reserved_for_test();
        let key = "phase9-refcount-test";
        let a = ReservedStart::acquire(key.into());
        let b = ReservedStart::acquire(key.into());
        assert_eq!(reserved_starts_lock().get(key).copied(), Some(2));
        drop(a);
        assert_eq!(reserved_starts_lock().get(key).copied(), Some(1));
        let mut running = vec![];
        merge_reserved_starts(&mut running);
        assert!(running.contains(&key.to_string()));
        drop(b);
        assert_eq!(reserved_starts_lock().get(key), None);
        let mut running = vec![];
        merge_reserved_starts(&mut running);
        assert!(!running.contains(&key.to_string()));
    }

    #[test]
    fn merge_reserved_starts_follows_roster_order() {
        let _gate = lock_reserved_for_test();
        let kafka = ReservedStart::acquire("kafka-plaintext".into());
        let graphql = ReservedStart::acquire("graphql".into());
        let mut running = vec![];
        merge_reserved_starts(&mut running);
        let graphql_at = running.iter().position(|k| k == "graphql");
        let kafka_at = running.iter().position(|k| k == "kafka-plaintext");
        assert!(graphql_at.is_some() && kafka_at.is_some());
        assert!(graphql_at.unwrap() < kafka_at.unwrap());
        drop(kafka);
        drop(graphql);
        let pulling = ReservedStart::acquire("graphql".into());
        let mut mixed = vec!["kafka-plaintext".to_string()];
        merge_reserved_starts(&mut mixed);
        assert_eq!(
            mixed,
            vec!["graphql".to_string(), "kafka-plaintext".to_string()]
        );
        drop(pulling);
    }

    #[test]
    fn classify_stop_all_probe_fails_closed() {
        assert_eq!(classify_stop_all_probe(Ok(false)), StopAllProbe::Skip);
        assert_eq!(classify_stop_all_probe(Ok(true)), StopAllProbe::Down);
        assert_eq!(
            classify_stop_all_probe(Err("compose ps failed".into())),
            StopAllProbe::Unknown("compose ps failed".into())
        );
    }

    #[test]
    fn f3_stop_cancels_sibling_in_flight_starts() {
        assert_eq!(
            keys_sharing_start_slot("grpc"),
            vec!["grpc-spring", "grpc"]
        );
        assert_eq!(
            keys_sharing_start_slot("grpc-spring"),
            vec!["grpc-spring", "grpc"]
        );
        assert_eq!(keys_sharing_start_slot("graphql"), vec!["graphql"]);
    }

    #[test]
    fn fold_running_stack_probes_fails_closed() {
        assert_eq!(
            fold_running_stack_probes(vec![
                Ok(Some("graphql".into())),
                Ok(None),
                Ok(Some("kafka-plaintext".into())),
            ]),
            Ok(vec!["graphql".into(), "kafka-plaintext".into()])
        );
        let err = fold_running_stack_probes(vec![
            Ok(Some("graphql".into())),
            Err("kafka-plaintext: compose ps failed".into()),
        ])
        .expect_err("probe failure");
        assert!(err.contains("Cannot verify running stacks"));
        assert!(err.contains("kafka-plaintext"));
        assert!(!err.contains("graphql:"));
    }

    #[test]
    fn probe_loopback_port_sees_an_open_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        assert!(probe_loopback_port(port, Duration::from_secs(1)));
        drop(listener);
        assert!(!probe_loopback_port(port, Duration::from_millis(200)));
    }
}
