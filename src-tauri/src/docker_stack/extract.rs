//! Resource extraction and path resolution (Phase 2).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

use super::last_run::{
    collect_last_run_logs, is_last_run_log_file_name, restore_last_run_logs,
};

const FORGE_VERSION_FILE: &str = ".forge-version";
const SKIP_DIR_NAMES: &[&str] = &["node_modules", ".git", ".DS_Store", "target", ".settings"];

/// One extract at a time — setup spawn and `get_docker_stack_path` can overlap.
static EXTRACT_GATE: OnceLock<Mutex<()>> = OnceLock::new();

/// The lesson gate polls `get_stack_status` every 3s; each call hits extract.
/// Log the skip once per process so relaunch still shows it without flooding.
static SKIP_EXTRACT_LOGGED: OnceLock<()> = OnceLock::new();

fn extract_gate() -> std::sync::MutexGuard<'static, ()> {
    EXTRACT_GATE
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Compose / manifest / TLS cert files that must exist after a successful extract.
pub(crate) const EXTRACT_SENTINELS: &[&str] = &[
    "graphql/docker-compose.yml",
    "graphql/stack.json",
    "graphql/tls/docker-compose.yml",
    "graphql/tls/docker-compose.mtls.yml",
    "graphql/tls/stack.json",
    "graphql/tls/certs/ca.crt",
    "graphql/tls/certs/server.crt",
    "graphql/tls/certs/server.key",
    "graphql/tls/certs/client.crt",
    "graphql/tls/certs/client.key",
    "grpc/docker-compose.yml",
    "grpc/stack.json",
    "grpc/stack-spring.json",
    "grpc/certs/ca.crt",
    "grpc/certs/server.crt",
    "grpc/certs/server.key",
    "grpc/certs/client.crt",
    "grpc/certs/client.key",
    "kafka/plaintext/docker-compose.yml",
    "kafka/plaintext/stack.json",
    "kafka/secure/docker-compose.yml",
    "kafka/secure/.bootstrap.yaml",
    "kafka/secure/stack.json",
    "kafka/tls/docker-compose.yml",
    "kafka/tls/.bootstrap.yaml",
    "kafka/tls/stack.json",
    "kafka/tls/certs/ca.crt",
    "kafka/tls/certs/broker.crt",
    "kafka/tls/certs/broker.key",
    "kafka/schema-registry/docker-compose.yml",
    "kafka/schema-registry/stack.json",
    "websocket/socketio/docker-compose.yml",
    "websocket/socketio/stack.json",
    "websocket/graphql/docker-compose.yml",
    "websocket/graphql/stack.json",
    "websocket/stomp/docker-compose.yml",
    "websocket/stomp/stack.json",
    "websocket/docker-compose.tls.yml",
    "websocket/docker-compose.mtls.yml",
    "websocket/stack.json",
    "websocket/certs/ca.crt",
    "websocket/certs/server.crt",
    "websocket/certs/server.key",
    "websocket/certs/client.crt",
    "websocket/certs/client.key",
    "api-mock/docker-compose.yml",
    "api-mock/stack.json",
    // Compose bind-mounts — `up` fails immediately if these are missing.
    "graphql/tls/nginx-gql-tls.conf",
    "graphql/tls/nginx-gql-mtls.conf",
    "websocket/nginx-wss.conf",
    "websocket/nginx-mtls.conf",
    "grpc/envoy/envoy.yaml",
    "grpc/oauth-mock/server.mjs",
    // `build:` stacks — `compose up` / `--build` fails immediately without these.
    "graphql/Dockerfile",
    "api-mock/Dockerfile",
    "websocket/graphql/Dockerfile",
    "websocket/socketio/Dockerfile",
    "grpc/Dockerfile",
    "grpc/Dockerfile.mock",
    "grpc/spring-boot/Dockerfile",
    // Dockerfile COPY sources — a leftover extract with only the Dockerfile
    // stamps complete and then `compose up --build` fails immediately.
    "graphql/package.json",
    "graphql/server.js",
    "api-mock/server.mjs",
    "websocket/graphql/package.json",
    "websocket/graphql/server.js",
    "websocket/socketio/package.json",
    "websocket/socketio/server.js",
    "grpc/proto/echo.proto",
    "grpc/proto/api.proto",
    "grpc/proto/eliza.proto",
    "grpc/go-server/go.mod",
    "grpc/go-server/main.go",
    "grpc/go-mock-server/go.mod",
    "grpc/go-mock-server/main.go",
    "grpc/go-mock-server/config/rules.json",
    "grpc/spring-boot/pom.xml",
    "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/GrpcSpringBootFixtureApplication.java",
    "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/EchoFixtureGrpcService.java",
    "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/HealthFixtureGrpcService.java",
    "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/BearerAuthServerInterceptor.java",
    "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/EchoServletBridgeController.java",
    "grpc/spring-boot/src/main/resources/application.yml",
    "grpc/spring-boot/src/main/proto/echo.proto",
    "grpc/spring-boot/src/main/proto/health.proto",
];

pub fn docker_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let docker_dir = base.join("docker");
    fs::create_dir_all(&docker_dir).map_err(|e| format!("Cannot create docker dir: {e}"))?;
    Ok(docker_dir)
}

pub fn stack_dir(app: &AppHandle, stack_key: &str) -> Result<PathBuf, String> {
    let rel = resolve_stack_rel(stack_key)?;
    let base = docker_data_dir(app)?;
    Ok(base.join(rel))
}

/// Known stack key → relative dir under `docker/`. Unknown keys (including
/// `..`) must not join onto the app data path.
pub(crate) fn stack_key_to_dir(key: &str) -> Option<&'static str> {
    match key {
        "graphql" => Some("graphql"),
        "graphql-tls" => Some("graphql/tls"),
        "grpc" | "grpc-spring" => Some("grpc"),
        "kafka-plaintext" => Some("kafka/plaintext"),
        "kafka-secure" => Some("kafka/secure"),
        "kafka-tls" => Some("kafka/tls"),
        "kafka-schema-registry" => Some("kafka/schema-registry"),
        "ws-socketio" => Some("websocket/socketio"),
        "ws-graphql" => Some("websocket/graphql"),
        "ws-stomp" => Some("websocket/stomp"),
        "ws-tls" => Some("websocket"),
        "api-mock" => Some("api-mock"),
        _ => None,
    }
}

pub(crate) fn resolve_stack_rel(key: &str) -> Result<&'static str, String> {
    stack_key_to_dir(key).ok_or_else(|| format!("Unknown docker stack '{key}'"))
}

/// Hold the extract mutex for a filesystem read that must not race `remove_dir_all`.
pub(crate) fn with_extract_gate<T>(f: impl FnOnce() -> T) -> T {
    let _gate = extract_gate();
    f()
}

fn should_skip_name(name: &str) -> bool {
    SKIP_DIR_NAMES.contains(&name)
}

pub(crate) fn extraction_looks_complete(docker_dir: &Path) -> bool {
    EXTRACT_SENTINELS
        .iter()
        .all(|rel| docker_dir.join(rel).is_file())
}

fn bundled_docker_source(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("docker");
        if bundled.is_dir() {
            return Some(bundled);
        }
    }
    repo_docker_dir()
}

pub(crate) fn repo_docker_dir() -> Option<PathBuf> {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker");
    if repo.is_dir() {
        Some(repo.canonicalize().unwrap_or(repo))
    } else {
        None
    }
}

pub fn extract_docker_resources_if_needed(app: &AppHandle) {
    let _gate = extract_gate();
    extract_docker_resources_if_needed_locked(app);
}

/// Extract, then fail if the tree is still missing required stack files.
pub fn ensure_docker_extracted(app: &AppHandle) -> Result<(), String> {
    ensure_complete_stack_dir(app, None).map(|_| ())
}

/// Extract and optionally resolve one stack dir while the gate is held
/// (same as `get_docker_stack_path` — no wipe between “complete” and the path).
pub fn ensure_complete_stack_dir(
    app: &AppHandle,
    stack_key: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(key) = stack_key {
        resolve_stack_rel(key)?;
    }
    let _gate = extract_gate();
    extract_docker_resources_if_needed_locked(app);
    let docker_dir = docker_data_dir(app)?;
    if !extraction_looks_complete(&docker_dir) {
        return Err(
            "Extracted docker resources are incomplete — clone the public repo or reinstall Learning Hub"
                .into(),
        );
    }
    let Some(key) = stack_key else {
        return Ok(docker_dir);
    };
    let dir = stack_dir(app, key)?;
    if !dir.is_dir() {
        return Err(format!(
            "Extracted docker stack directory missing for '{key}'"
        ));
    }
    Ok(dir)
}

fn extract_docker_resources_if_needed_locked(app: &AppHandle) {
    let current_version = env!("CARGO_PKG_VERSION");

    let docker_dir = match docker_data_dir(app) {
        Ok(d) => d,
        Err(e) => {
            log::error!("[docker] Cannot resolve data dir: {e}");
            return;
        }
    };

    let version_file = docker_dir.join(FORGE_VERSION_FILE);
    let extracted_version = fs::read_to_string(&version_file).unwrap_or_default();
    let version_ok = extracted_version.trim() == current_version;
    if version_ok && extraction_looks_complete(&docker_dir) {
        // Hot path: PrerequisiteGate / Settings poll status every few seconds.
        if SKIP_EXTRACT_LOGGED.set(()).is_ok() {
            log::info!(
                "[docker] Resources up to date (v{current_version}) — skipping extraction"
            );
        }
        return;
    }

    let Some(source_docker) = bundled_docker_source(app) else {
        log::error!(
            "[docker] No bundled or repo docker/ source found — leaving existing files in place"
        );
        return;
    };

    if source_docker == docker_dir {
        log::warn!("[docker] Source and destination are the same path — skip copy");
        return;
    }

    log::info!(
        "[docker] Extracting v{current_version} from {:?} (previous stamp={:?})",
        source_docker,
        extracted_version.trim()
    );

    // Phase 7: last-run logs live under docker/ and must survive a version-bump wipe.
    let stashed_last_run = collect_last_run_logs(&docker_dir);

    if docker_dir.exists() {
        if let Err(e) = fs::remove_dir_all(&docker_dir) {
            log::error!("[docker] Failed to remove old docker dir: {e}");
            return;
        }
    }
    if let Err(e) = fs::create_dir_all(&docker_dir) {
        log::error!("[docker] Failed to recreate docker dir: {e}");
        restore_last_run_logs(&docker_dir, &stashed_last_run);
        return;
    }

    if let Err(e) = copy_dir_recursive(&source_docker, &docker_dir) {
        log::error!("[docker] Resource copy failed: {e}");
        restore_last_run_logs(&docker_dir, &stashed_last_run);
        return;
    }

    restore_last_run_logs(&docker_dir, &stashed_last_run);

    if !extraction_looks_complete(&docker_dir) {
        log::error!(
            "[docker] Extract finished but required stack files are missing — not stamping version"
        );
        return;
    }

    if let Err(e) = fs::write(&version_file, current_version) {
        log::error!("[docker] Failed to write version stamp: {e}");
    } else {
        log::info!("[docker] Extracted to {:?}", docker_dir);
    }
}

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {dst:?}: {e}"))?;
    let entries = fs::read_dir(src).map_err(|e| format!("readdir {src:?}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if should_skip_name(&name_str) {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if is_last_run_log_file_name(&name_str) {
            // Runtime logs must not come from a dirty repo / bundle tree.
            continue;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("copy {src_path:?}: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_docker_stack_path(stack_key: String, app: AppHandle) -> Result<String, String> {
    let dir = ensure_complete_stack_dir(&app, Some(&stack_key))?;
    Ok(dir.to_string_lossy().to_string())
}
