//! Persist "stop stacks on app quit" so the Rust quit handler can read it.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const STOP_ON_CLOSE_FILE: &str = "docker-stop-on-close";
const PREFETCH_FILE: &str = "docker-images-prefetch";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PrefetchChoice {
    Declined,
    Accepted,
    Done,
}

/// Preference file lives beside `$APP_DATA/docker/`, not inside it.
pub fn prefetch_choice_path_for(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join(PREFETCH_FILE)
}

pub fn parse_prefetch_choice(contents: &str) -> Option<PrefetchChoice> {
    match contents.trim().to_ascii_lowercase().as_str() {
        "declined" => Some(PrefetchChoice::Declined),
        "accepted" => Some(PrefetchChoice::Accepted),
        "done" => Some(PrefetchChoice::Done),
        _ => None,
    }
}

fn prefetch_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(prefetch_choice_path_for(&base))
}

pub fn read_prefetch_choice(app: &AppHandle) -> Option<PrefetchChoice> {
    prefetch_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| parse_prefetch_choice(&s))
}

pub fn write_prefetch_choice(app: &AppHandle, choice: PrefetchChoice) -> Result<(), String> {
    let path = prefetch_path(app)?;
    let value = match choice {
        PrefetchChoice::Declined => "declined\n",
        PrefetchChoice::Accepted => "accepted\n",
        PrefetchChoice::Done => "done\n",
    };
    std::fs::write(&path, value).map_err(|e| format!("Cannot write prefetch preference: {e}"))
}

#[tauri::command]
pub fn get_prefetch_choice(app: AppHandle) -> Option<PrefetchChoice> {
    read_prefetch_choice(&app)
}

#[tauri::command]
pub fn set_prefetch_choice(app: AppHandle, choice: String) -> Result<(), String> {
    let parsed = parse_prefetch_choice(&choice)
        .ok_or_else(|| format!("Invalid prefetch choice: {choice}"))?;
    write_prefetch_choice(&app, parsed)
}

pub fn stop_on_close_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(stop_on_close_path_for(&base))
}

/// Preference file lives beside `$APP_DATA/docker/`, not inside it.
pub fn stop_on_close_path_for(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join(STOP_ON_CLOSE_FILE)
}

/// Missing or unreadable file defaults to **true** (current Phase 3 behavior).
pub fn parse_stop_on_close_contents(contents: &str) -> bool {
    !contents.trim().eq_ignore_ascii_case("false")
}

pub fn read_stop_on_close(app: &AppHandle) -> bool {
    match stop_on_close_path(app).and_then(|p| {
        std::fs::read_to_string(p).map_err(|e| e.to_string())
    }) {
        Ok(s) => parse_stop_on_close_contents(&s),
        Err(_) => true,
    }
}

pub fn write_stop_on_close(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let path = stop_on_close_path(app)?;
    std::fs::write(&path, if enabled { "true\n" } else { "false\n" })
        .map_err(|e| format!("Cannot write stop-on-close preference: {e}"))
}

#[tauri::command]
pub fn get_stop_on_close(app: AppHandle) -> bool {
    read_stop_on_close(&app)
}

#[tauri::command]
pub fn set_stop_on_close(app: AppHandle, enabled: bool) -> Result<(), String> {
    write_stop_on_close(&app, enabled)
}

#[cfg(test)]
mod tests {
    use super::parse_stop_on_close_contents;

    #[test]
    fn missing_or_true_defaults_to_stop() {
        assert!(parse_stop_on_close_contents(""));
        assert!(parse_stop_on_close_contents("true"));
        assert!(parse_stop_on_close_contents("true\n"));
        assert!(parse_stop_on_close_contents("TRUE"));
        assert!(parse_stop_on_close_contents("1"));
    }

    #[test]
    fn only_false_disables_stop() {
        assert!(!parse_stop_on_close_contents("false"));
        assert!(!parse_stop_on_close_contents("false\n"));
        assert!(!parse_stop_on_close_contents("  false  "));
        assert!(!parse_stop_on_close_contents("FALSE"));
    }

    #[test]
    fn stop_on_close_file_is_beside_docker_not_inside() {
        let app_data = std::path::Path::new("/tmp/rff-app-data");
        let path = super::stop_on_close_path_for(app_data);
        assert_eq!(path.file_name().unwrap(), "docker-stop-on-close");
        assert!(!path.starts_with(app_data.join("docker")));
        assert_eq!(path.parent().unwrap(), app_data);
    }

    #[test]
    fn prefetch_file_is_beside_docker_not_inside() {
        let app_data = std::path::Path::new("/tmp/rff-app-data");
        let path = super::prefetch_choice_path_for(app_data);
        assert_eq!(path.file_name().unwrap(), "docker-images-prefetch");
        assert!(!path.starts_with(app_data.join("docker")));
        assert_eq!(path.parent().unwrap(), app_data);
    }

    #[test]
    fn parse_prefetch_choice_known_values() {
        assert_eq!(
            super::parse_prefetch_choice("declined\n"),
            Some(super::PrefetchChoice::Declined)
        );
        assert_eq!(
            super::parse_prefetch_choice("  ACCEPTED  "),
            Some(super::PrefetchChoice::Accepted)
        );
        assert_eq!(super::parse_prefetch_choice("done"), Some(super::PrefetchChoice::Done));
        assert_eq!(super::parse_prefetch_choice(""), None);
        assert_eq!(super::parse_prefetch_choice("maybe"), None);
    }
}
