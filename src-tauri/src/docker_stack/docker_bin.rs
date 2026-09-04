//! Resolve the `docker` CLI. On Windows, PATH is often stale until re-login
//! after a Docker Desktop install — fall back to well-known install paths.
//! Hide the extra console window when spawning the CLI on Windows.

use std::ffi::OsStr;
use std::path::PathBuf;
use tokio::process::Command;

#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_docker_cli_candidates(
    program_files: Option<&str>,
    program_data: Option<&str>,
    program_files_x86: Option<&str>,
    local_app_data: Option<&str>,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(pf) = program_files.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{pf}\Docker\Docker\resources\bin\docker.exe"
        )));
    }
    if let Some(pd) = program_data.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{pd}\DockerDesktop\version-bin\docker.exe"
        )));
    }
    if let Some(pf) = program_files_x86.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{pf}\Docker\Docker\resources\bin\docker.exe"
        )));
    }
    if let Some(la) = local_app_data.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{la}\Programs\DockerDesktop\resources\bin\docker.exe"
        )));
        out.push(PathBuf::from(format!(
            r"{la}\Programs\Docker\Docker\resources\bin\docker.exe"
        )));
        out.push(PathBuf::from(format!(
            r"{la}\Docker\Docker\resources\bin\docker.exe"
        )));
    }
    out.push(PathBuf::from(
        r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    ));
    out.push(PathBuf::from(
        r"C:\ProgramData\DockerDesktop\version-bin\docker.exe",
    ));
    out
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_desktop_exe_candidates(
    program_files: Option<&str>,
    program_files_x86: Option<&str>,
    local_app_data: Option<&str>,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(pf) = program_files.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{pf}\Docker\Docker\Docker Desktop.exe"
        )));
    }
    if let Some(pf) = program_files_x86.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{pf}\Docker\Docker\Docker Desktop.exe"
        )));
    }
    if let Some(la) = local_app_data.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(format!(
            r"{la}\Programs\DockerDesktop\Docker Desktop.exe"
        )));
        out.push(PathBuf::from(format!(
            r"{la}\Programs\Docker\Docker\Docker Desktop.exe"
        )));
        out.push(PathBuf::from(format!(
            r"{la}\Docker\Docker\Docker Desktop.exe"
        )));
    }
    out.push(PathBuf::from(
        r"C:\Program Files\Docker\Docker\Docker Desktop.exe",
    ));
    out
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn first_existing_file(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|p| p.is_file()).cloned()
}

/// First `docker.exe` on PATH (PATH first, then well-known install dirs).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_path_docker_exe(path_env: Option<&str>) -> Option<PathBuf> {
    let path_env = path_env.filter(|s| !s.is_empty())?;
    for dir in path_env.split(';') {
        let dir = dir.trim().trim_matches('"');
        if dir.is_empty() {
            continue;
        }
        let exe = PathBuf::from(dir).join("docker.exe");
        if exe.is_file() {
            return Some(exe);
        }
    }
    None
}

pub fn docker_bin() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(p) = windows_path_docker_exe(std::env::var("PATH").ok().as_deref()) {
            return p;
        }
        let pf = std::env::var("ProgramFiles").ok();
        let pd = std::env::var("ProgramData").ok();
        let pf86 = std::env::var("ProgramFiles(x86)").ok();
        let local = std::env::var("LOCALAPPDATA").ok();
        if let Some(p) = first_existing_file(&windows_docker_cli_candidates(
            pf.as_deref(),
            pd.as_deref(),
            pf86.as_deref(),
            local.as_deref(),
        )) {
            return p;
        }
    }
    PathBuf::from("docker")
}

/// Spawn a process without a flashing console on Windows (compose + port lookup).
pub fn hidden_cmd(program: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new(program);
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

pub fn docker_cmd() -> Command {
    hidden_cmd(docker_bin())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_cli_candidates_include_program_files_and_defaults() {
        let paths = windows_docker_cli_candidates(
            Some(r"D:\Program Files"),
            Some(r"D:\ProgramData"),
            Some(r"D:\Program Files (x86)"),
            Some(r"D:\Users\me\AppData\Local"),
        );
        let as_str: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        assert!(as_str.iter().any(|p| p.ends_with(r"D:\Program Files\Docker\Docker\resources\bin\docker.exe")
            || p.ends_with("D:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe")));
        assert!(as_str.iter().any(|p| p.contains("version-bin") && p.contains("docker.exe")));
        assert!(as_str.iter().any(|p| p.contains("(x86)") && p.contains("docker.exe")));
        assert!(as_str.iter().any(|p| p.contains(r"AppData\Local") && p.contains("docker.exe")
            || p.contains("AppData\\Local") && p.contains("docker.exe")));
        assert!(as_str.iter().any(|p| p.contains(r"Programs\DockerDesktop\resources\bin\docker.exe")
            || p.contains("Programs\\DockerDesktop\\resources\\bin\\docker.exe")));
        assert!(as_str.iter().any(|p| p.contains(r"C:\Program Files") || p.contains("C:\\Program Files")));
    }

    #[test]
    fn windows_desktop_candidates_include_x86() {
        let paths = windows_desktop_exe_candidates(
            Some(r"C:\Program Files"),
            Some(r"C:\Program Files (x86)"),
            Some(r"C:\Users\me\AppData\Local"),
        );
        let as_str: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        assert!(as_str.iter().any(|p| p.contains("Docker Desktop.exe") && p.contains("Program Files")));
        assert!(as_str.iter().any(|p| p.contains("(x86)")));
        assert!(as_str.iter().any(|p| p.contains("Docker Desktop.exe") && (p.contains(r"AppData\Local") || p.contains("AppData\\Local"))));
        assert!(as_str.iter().any(|p| p.contains(r"Programs\DockerDesktop\Docker Desktop.exe")
            || p.contains("Programs\\DockerDesktop\\Docker Desktop.exe")));
    }

    #[test]
    fn first_existing_file_none_for_missing() {
        assert!(first_existing_file(&[PathBuf::from("/no/such/docker.exe")]).is_none());
    }

    #[test]
    fn windows_path_docker_exe_finds_first_path_entry() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("rff-docker-path-{stamp}"));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join("docker.exe");
        std::fs::write(&exe, b"").unwrap();
        let path_env = format!("{};C:\\no-such-docker", bin.display());
        assert_eq!(windows_path_docker_exe(Some(&path_env)), Some(exe));
        assert!(windows_path_docker_exe(Some(r"C:\no-such-docker;D:\also-missing")).is_none());
        assert!(windows_path_docker_exe(Some("")).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn docker_bin_is_docker_on_non_windows() {
        #[cfg(not(windows))]
        assert_eq!(docker_bin(), PathBuf::from("docker"));
    }
}
