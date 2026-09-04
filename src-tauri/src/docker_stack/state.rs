//! Docker daemon / Compose / memory / cert expiry commands.

use super::docker_bin::docker_cmd;
#[cfg(windows)]
use super::docker_bin::{
    first_existing_file, hidden_cmd, windows_desktop_exe_candidates,
};
use super::extract::ensure_complete_stack_dir;
use super::manifest::load_manifest;
#[cfg(not(windows))]
use tokio::process::Command;

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DockerState {
    NotInstalled,
    NotRunning,
    OutdatedCompose,
    Running,
}

fn is_not_found(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::NotFound
}

/// Result of `docker compose version` (Compose V1 is a failed/non-zero plugin).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ComposeVersionProbe {
    Success,
    BinaryNotFound,
    Timeout,
    Failed,
}

pub(crate) fn classify_compose_version_probe(probe: ComposeVersionProbe) -> DockerState {
    match probe {
        ComposeVersionProbe::Success => DockerState::Running,
        ComposeVersionProbe::BinaryNotFound => DockerState::NotInstalled,
        ComposeVersionProbe::Timeout => DockerState::NotRunning,
        ComposeVersionProbe::Failed => DockerState::OutdatedCompose,
    }
}

#[tauri::command]
pub async fn check_docker_state() -> DockerState {
    let info = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        docker_cmd().arg("info").output(),
    )
    .await;

    match info {
        Ok(Ok(out)) if out.status.success() => {}
        Ok(Err(e)) if is_not_found(&e) => return DockerState::NotInstalled,
        Err(_) => return DockerState::NotRunning,
        _ => return DockerState::NotRunning,
    }

    let compose_check = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        docker_cmd().args(["compose", "version"]).output(),
    )
    .await;

    classify_compose_version_probe(match compose_check {
        Ok(Ok(out)) if out.status.success() => ComposeVersionProbe::Success,
        Ok(Err(e)) if is_not_found(&e) => ComposeVersionProbe::BinaryNotFound,
        Err(_) => ComposeVersionProbe::Timeout,
        _ => ComposeVersionProbe::Failed,
    })
}

#[tauri::command]
pub async fn open_docker_desktop() {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").args(["-a", "Docker"]).spawn();
    }

    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").ok();
        let pf86 = std::env::var("ProgramFiles(x86)").ok();
        let local = std::env::var("LOCALAPPDATA").ok();
        let candidates = windows_desktop_exe_candidates(
            pf.as_deref(),
            pf86.as_deref(),
            local.as_deref(),
        );
        // `start` detaches from this job so Docker Desktop survives app quit.
        // hidden_cmd hides the brief cmd.exe console.
        let launched = if let Some(exe) = first_existing_file(&candidates) {
            hidden_cmd("cmd")
                .args(["/C", "start", ""])
                .arg(exe)
                .spawn()
                .is_ok()
        } else {
            false
        };
        if !launched {
            let _ = hidden_cmd("cmd")
                .args(["/C", "start", "", "Docker Desktop"])
                .spawn();
        }
    }

    #[cfg(target_os = "linux")]
    {
        // WSL / Linux typically run Docker Engine, not Docker Desktop.
        let engine = Command::new("systemctl")
            .args(["start", "docker"])
            .status()
            .await;
        if engine.map(|s| !s.success()).unwrap_or(true) {
            let sudo_sys = Command::new("sudo")
                .args(["-n", "systemctl", "start", "docker"])
                .status()
                .await;
            if sudo_sys.map(|s| !s.success()).unwrap_or(true) {
                let _ = Command::new("sudo")
                    .args(["-n", "service", "docker", "start"])
                    .status()
                    .await;
            }
        }
        let desktop = Command::new("systemctl")
            .args(["--user", "start", "docker-desktop"])
            .status()
            .await;
        if desktop.map(|s| !s.success()).unwrap_or(true) {
            let _ = Command::new("docker").arg("desktop").spawn();
        }
    }
}

pub async fn docker_available_memory_mb() -> Option<u64> {
    let output = docker_cmd()
        .args(["info", "--format", "{{.MemTotal}}"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let bytes: u64 = String::from_utf8_lossy(&output.stdout).trim().parse().ok()?;
    Some(bytes / 1_048_576)
}

#[tauri::command]
pub async fn get_docker_available_memory_mb() -> Option<u64> {
    docker_available_memory_mb().await
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CertExpiryStatus {
    pub expires_at: Option<String>,
    pub days_remaining: Option<i64>,
}

#[tauri::command]
pub async fn check_cert_expiry(
    app: tauri::AppHandle,
    stack_key: String,
) -> Result<CertExpiryStatus, String> {
    let dir = ensure_complete_stack_dir(&app, Some(&stack_key))?;
    let manifest = load_manifest(&dir, &stack_key)?;
    let Some(expires_at) = manifest.cert_expires_at.filter(|s| !s.is_empty()) else {
        return Ok(CertExpiryStatus {
            expires_at: None,
            days_remaining: None,
        });
    };
    cert_days_remaining(&expires_at)
}

pub(crate) fn cert_days_remaining(expires_at: &str) -> Result<CertExpiryStatus, String> {
    let today = chrono::Utc::now().date_naive();
    let expiry = chrono::NaiveDate::parse_from_str(expires_at, "%Y-%m-%d")
        .map_err(|e| format!("Invalid certExpiresAt format: {e}"))?;
    Ok(CertExpiryStatus {
        expires_at: Some(expires_at.to_string()),
        days_remaining: Some((expiry - today).num_days()),
    })
}

/// Refuse Start when `certExpiresAt` is past or unreadable (State H).
/// Non-TLS manifests (`null` / empty) are allowed.
pub(crate) fn expired_cert_start_error(expires_at: Option<&str>) -> Option<String> {
    let expires = expires_at.filter(|s| !s.is_empty())?;
    match cert_days_remaining(expires) {
        Ok(status) if status.days_remaining.unwrap_or(0) <= 0 => {
            Some(format!("CERT_EXPIRED:{expires}"))
        }
        Err(_) => Some(format!("CERT_EXPIRED:{expires}")),
        _ => None,
    }
}

const LEARNING_HUB_RELEASES: &str = "https://github.com/redfireforge/redfireforge-public/releases";

#[tauri::command]
pub async fn trigger_app_update_check() {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(LEARNING_HUB_RELEASES).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = hidden_cmd("cmd")
            .args(["/C", "start", "", LEARNING_HUB_RELEASES])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(LEARNING_HUB_RELEASES).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cert_days_remaining_parses_iso_date() {
        let status = cert_days_remaining("2036-08-30").expect("parse");
        assert_eq!(status.expires_at.as_deref(), Some("2036-08-30"));
        assert!(status.days_remaining.unwrap() > 90);
    }

    #[test]
    fn cert_days_remaining_rejects_bad_date() {
        assert!(cert_days_remaining("not-a-date").is_err());
    }

    #[test]
    fn compose_v1_or_missing_plugin_is_outdated() {
        assert_eq!(
            classify_compose_version_probe(ComposeVersionProbe::Failed),
            DockerState::OutdatedCompose
        );
        assert_eq!(
            classify_compose_version_probe(ComposeVersionProbe::Success),
            DockerState::Running
        );
        assert_eq!(
            classify_compose_version_probe(ComposeVersionProbe::BinaryNotFound),
            DockerState::NotInstalled
        );
        assert_eq!(
            classify_compose_version_probe(ComposeVersionProbe::Timeout),
            DockerState::NotRunning
        );
    }

    #[test]
    fn expired_cert_start_error_blocks_past_and_unreadable() {
        assert!(expired_cert_start_error(None).is_none());
        assert!(expired_cert_start_error(Some("")).is_none());
        assert!(expired_cert_start_error(Some("2036-08-30")).is_none());
        assert_eq!(
            expired_cert_start_error(Some("2000-01-01")).as_deref(),
            Some("CERT_EXPIRED:2000-01-01")
        );
        assert_eq!(
            expired_cert_start_error(Some("not-a-date")).as_deref(),
            Some("CERT_EXPIRED:not-a-date")
        );
    }
}
