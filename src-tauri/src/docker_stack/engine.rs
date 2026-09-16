//! Detect Docker Desktop vs OrbStack and persist the Learning Hub pick.

#[cfg(windows)]
use super::docker_bin::{first_existing_file, windows_desktop_exe_candidates};
use super::prefs::engine_preference_path;
use std::path::Path;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DockerEngineId {
    Desktop,
    Orbstack,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerEngineSnapshot {
    pub desktop_installed: bool,
    pub orbstack_installed: bool,
    pub preference: Option<DockerEngineId>,
    pub needs_choice: bool,
    pub active_engine: Option<DockerEngineId>,
}

static ACTIVE_CONTEXT: RwLock<Option<String>> = RwLock::new(None);

pub fn parse_engine_id(raw: &str) -> Option<DockerEngineId> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "desktop" => Some(DockerEngineId::Desktop),
        "orbstack" => Some(DockerEngineId::Orbstack),
        _ => None,
    }
}

pub fn engine_id_label(id: DockerEngineId) -> &'static str {
    match id {
        DockerEngineId::Desktop => "desktop",
        DockerEngineId::Orbstack => "orbstack",
    }
}

pub fn detect_desktop_installed(home: Option<&str>) -> bool {
    #[cfg(target_os = "macos")]
    {
        if Path::new("/Applications/Docker.app").is_dir() {
            return true;
        }
        if let Some(h) = home.filter(|s| !s.is_empty()) {
            return Path::new(&format!("{h}/Applications/Docker.app")).is_dir();
        }
        false
    }
    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").ok();
        let pf86 = std::env::var("ProgramFiles(x86)").ok();
        let local = std::env::var("LOCALAPPDATA").ok();
        first_existing_file(&windows_desktop_exe_candidates(
            pf.as_deref(),
            pf86.as_deref(),
            local.as_deref(),
        ))
        .is_some()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = home;
        true
    }
}

pub fn detect_orbstack_installed(home: Option<&str>) -> bool {
    #[cfg(target_os = "macos")]
    {
        if Path::new("/Applications/OrbStack.app").is_dir() {
            return true;
        }
        if let Some(h) = home.filter(|s| !s.is_empty()) {
            return Path::new(&format!("{h}/.orbstack/bin/docker")).is_file()
                || Path::new(&format!("{h}/.orbstack")).is_dir();
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
        false
    }
}

pub fn build_snapshot(
    desktop_installed: bool,
    orbstack_installed: bool,
    preference: Option<DockerEngineId>,
) -> DockerEngineSnapshot {
    let preference = match preference {
        Some(DockerEngineId::Desktop) if desktop_installed => Some(DockerEngineId::Desktop),
        Some(DockerEngineId::Orbstack) if orbstack_installed => Some(DockerEngineId::Orbstack),
        _ => None,
    };
    let needs_choice = desktop_installed && orbstack_installed && preference.is_none();
    let active_engine = match preference {
        Some(id) => Some(id),
        None if orbstack_installed && !desktop_installed => Some(DockerEngineId::Orbstack),
        None if desktop_installed && !orbstack_installed => Some(DockerEngineId::Desktop),
        _ => None,
    };
    DockerEngineSnapshot {
        desktop_installed,
        orbstack_installed,
        preference,
        needs_choice,
        active_engine,
    }
}

pub fn context_for(snapshot: &DockerEngineSnapshot) -> Option<&'static str> {
    match snapshot.active_engine {
        Some(DockerEngineId::Orbstack) => Some("orbstack"),
        Some(DockerEngineId::Desktop)
            if snapshot.desktop_installed && snapshot.orbstack_installed =>
        {
            Some("desktop-linux")
        }
        _ => None,
    }
}

pub fn active_context() -> Option<String> {
    ACTIVE_CONTEXT.read().ok().and_then(|g| g.clone())
}

fn set_active_context(ctx: Option<String>) {
    if let Ok(mut guard) = ACTIVE_CONTEXT.write() {
        *guard = ctx;
    }
}

pub fn read_preference_from(app_data: &Path) -> Option<DockerEngineId> {
    std::fs::read_to_string(engine_preference_path(app_data))
        .ok()
        .and_then(|s| parse_engine_id(&s))
}

pub fn write_preference_to(app_data: &Path, preference: Option<DockerEngineId>) -> Result<(), String> {
    std::fs::create_dir_all(app_data).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    let path = engine_preference_path(app_data);
    let value = match preference {
        Some(id) => format!("{}\n", engine_id_label(id)),
        None => String::new(),
    };
    std::fs::write(&path, value).map_err(|e| format!("Cannot write engine preference: {e}"))
}

pub fn snapshot_for_app(app: &AppHandle) -> DockerEngineSnapshot {
    let home = std::env::var("HOME").ok();
    let desktop = detect_desktop_installed(home.as_deref());
    let orbstack = detect_orbstack_installed(home.as_deref());
    let preference = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| read_preference_from(&dir));
    let snapshot = build_snapshot(desktop, orbstack, preference);
    set_active_context(context_for(&snapshot).map(str::to_string));
    snapshot
}

pub fn set_preference(app: &AppHandle, preference: Option<DockerEngineId>) -> Result<DockerEngineSnapshot, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let home = std::env::var("HOME").ok();
    let snapshot = build_snapshot(
        detect_desktop_installed(home.as_deref()),
        detect_orbstack_installed(home.as_deref()),
        preference,
    );
    write_preference_to(&dir, snapshot.preference)?;
    set_active_context(context_for(&snapshot).map(str::to_string));
    Ok(snapshot)
}

#[tauri::command]
pub fn get_docker_engine_snapshot(app: AppHandle) -> DockerEngineSnapshot {
    snapshot_for_app(&app)
}

#[tauri::command]
pub fn set_docker_engine_preference(
    app: AppHandle,
    preference: Option<String>,
) -> Result<DockerEngineSnapshot, String> {
    let parsed = match preference.as_deref() {
        None => None,
        Some(raw) if raw.trim().is_empty() => None,
        Some(raw) => Some(parse_engine_id(raw).ok_or_else(|| format!("Invalid engine preference: {raw}"))?),
    };
    set_preference(&app, parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_engine_id_accepts_known_values() {
        assert_eq!(parse_engine_id("desktop"), Some(DockerEngineId::Desktop));
        assert_eq!(parse_engine_id("  ORBSTACK \n"), Some(DockerEngineId::Orbstack));
        assert_eq!(parse_engine_id("podman"), None);
        assert_eq!(parse_engine_id(""), None);
    }

    #[test]
    fn both_installed_without_pref_needs_choice() {
        let snap = build_snapshot(true, true, None);
        assert!(snap.needs_choice);
        assert_eq!(snap.active_engine, None);
        assert_eq!(context_for(&snap), None);
    }

    #[test]
    fn orbstack_pick_sets_context() {
        let snap = build_snapshot(true, true, Some(DockerEngineId::Orbstack));
        assert!(!snap.needs_choice);
        assert_eq!(snap.active_engine, Some(DockerEngineId::Orbstack));
        assert_eq!(context_for(&snap), Some("orbstack"));
    }

    #[test]
    fn desktop_pick_when_both_sets_desktop_linux_context() {
        let snap = build_snapshot(true, true, Some(DockerEngineId::Desktop));
        assert_eq!(context_for(&snap), Some("desktop-linux"));
    }

    #[test]
    fn only_orbstack_does_not_need_choice() {
        let snap = build_snapshot(false, true, None);
        assert!(!snap.needs_choice);
        assert_eq!(snap.active_engine, Some(DockerEngineId::Orbstack));
        assert_eq!(context_for(&snap), Some("orbstack"));
    }

    #[test]
    fn stale_pref_for_missing_app_is_cleared() {
        let snap = build_snapshot(true, false, Some(DockerEngineId::Orbstack));
        assert_eq!(snap.preference, None);
        assert_eq!(snap.active_engine, Some(DockerEngineId::Desktop));
        assert!(!snap.needs_choice);
    }
}
