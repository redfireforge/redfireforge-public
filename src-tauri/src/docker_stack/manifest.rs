//! stack.json / stack-spring.json loading and compose argv helpers.

use super::limit::slot_key;
use std::path::{Path, PathBuf};
use tokio::process::Command;

pub const STARTED_WITH_FILE: &str = ".started-with-version";

pub const ALL_STACK_KEYS: &[&str] = &[
    "graphql-tls",
    "graphql",
    "grpc-spring",
    "grpc",
    "kafka-plaintext",
    "kafka-secure",
    "kafka-tls",
    "kafka-schema-registry",
    "ws-socketio",
    "ws-graphql",
    "ws-stomp",
    "ws-tls",
    "api-mock",
];

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackManifest {
    pub stack_key: Option<String>,
    pub since_version: Option<String>,
    #[serde(default)]
    pub compose_files: Vec<String>,
    #[serde(default)]
    pub build_on_start: bool,
    pub compose_profile: Option<String>,
    #[serde(default)]
    pub requires_companion_probe: bool,
    #[serde(default)]
    pub ports: Vec<u16>,
    pub min_memory_mb: Option<u64>,
    pub cert_expires_at: Option<String>,
}

pub fn manifest_path(stack_dir: &Path, stack_key: &str) -> PathBuf {
    if stack_key == "grpc-spring" {
        stack_dir.join("stack-spring.json")
    } else {
        stack_dir.join("stack.json")
    }
}

pub fn load_manifest(stack_dir: &Path, stack_key: &str) -> Result<StackManifest, String> {
    let manifest_file = manifest_path(stack_dir, stack_key);
    let content = std::fs::read_to_string(&manifest_file)
        .map_err(|e| format!("Cannot read stack.json for {stack_key}: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid stack.json for {stack_key}: {e}"))
}

/// Unique Compose project so folders that share a basename do not collide
/// (`docker/graphql` vs `docker/websocket/graphql`, `graphql/tls` vs `kafka/tls`).
/// `grpc` / `grpc-spring` share one project via `slot_key`.
pub fn compose_project_name(stack_key: &str) -> String {
    format!("rff-{}", slot_key(stack_key))
}

fn push_named_project(args: &mut Vec<String>, project: &str) {
    args.push("-p".into());
    args.push(project.to_string());
}

fn push_project_args(args: &mut Vec<String>, stack_key: &str) {
    push_named_project(args, &compose_project_name(stack_key));
}

fn project_key_from_manifests(manifests: &[StackManifest]) -> Option<&str> {
    manifests.iter().find_map(|m| m.stack_key.as_deref())
}

/// Folder basename Compose used before `-p rff-*` (`graphql/tls` → `tls`).
pub fn legacy_compose_project_name(stack_dir: &Path) -> Option<String> {
    stack_dir
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .map(|n| n.to_string())
}

/// `true` when this dir’s old default project is not the current `rff-*` name.
pub fn legacy_compose_project_if_distinct(
    stack_dir: &Path,
    manifests: &[StackManifest],
) -> Option<String> {
    let legacy = legacy_compose_project_name(stack_dir)?;
    let current = project_key_from_manifests(manifests).map(compose_project_name);
    if current.as_deref() == Some(legacy.as_str()) {
        None
    } else {
        Some(legacy)
    }
}

/// `--profile` / `-f` argv shared by status, start, and stop.
/// Always pass every compose file — a second `up -d` with only one `-f`
/// in the same project tears down services from the other files.
pub fn compose_file_args(manifest: &StackManifest) -> Vec<String> {
    compose_file_args_opts(manifest, true)
}

pub fn compose_file_args_opts(manifest: &StackManifest, include_profile: bool) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(key) = manifest.stack_key.as_deref() {
        push_project_args(&mut args, key);
    }
    if include_profile {
        if let Some(profile) = &manifest.compose_profile {
            args.push("--profile".into());
            args.push(profile.clone());
        }
    }
    for file in &manifest.compose_files {
        args.push("-f".into());
        args.push(file.clone());
    }
    args
}

/// Keys that share a compose project and must stop / `--rmi` together.
pub fn stop_stack_keys(key: &str) -> &'static [&'static str] {
    match key {
        "grpc" | "grpc-spring" => &["grpc", "grpc-spring"],
        _ => &[],
    }
}

pub fn load_related_manifests(stack_dir: &Path, stack_key: &str) -> Vec<StackManifest> {
    let extra = stop_stack_keys(stack_key);
    let keys: Vec<&str> = if extra.is_empty() {
        vec![stack_key]
    } else {
        extra.to_vec()
    };
    keys.into_iter()
        .filter_map(|key| load_manifest(stack_dir, key).ok())
        .collect()
}

/// Union of `--profile` / `-f` from sibling manifests (gRPC + Spring).
pub fn compose_merged_args(manifests: &[StackManifest]) -> Vec<String> {
    let project = project_key_from_manifests(manifests).map(compose_project_name);
    compose_merged_args_for_optional_project(manifests, project.as_deref())
}

pub fn compose_merged_args_for_project(manifests: &[StackManifest], project: &str) -> Vec<String> {
    compose_merged_args_for_optional_project(manifests, Some(project))
}

fn compose_merged_args_for_optional_project(
    manifests: &[StackManifest],
    project: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(name) = project {
        push_named_project(&mut args, name);
    }
    let mut profiles = Vec::new();
    let mut files = Vec::new();
    for manifest in manifests {
        if let Some(profile) = &manifest.compose_profile {
            if !profiles.iter().any(|p| p == profile) {
                profiles.push(profile.clone());
            }
        }
        for file in &manifest.compose_files {
            if !files.iter().any(|f| f == file) {
                files.push(file.clone());
            }
        }
    }
    for profile in profiles {
        args.push("--profile".into());
        args.push(profile);
    }
    for file in files {
        args.push("-f".into());
        args.push(file);
    }
    args
}

pub fn apply_merged_compose(cmd: &mut Command, manifests: &[StackManifest]) {
    for arg in compose_merged_args(manifests) {
        cmd.arg(arg);
    }
}

/// Apply `--profile` and every `-f <compose file>` from the manifest.
pub fn apply_compose_files(cmd: &mut Command, manifest: &StackManifest) {
    for arg in compose_file_args(manifest) {
        cmd.arg(arg);
    }
}

pub fn apply_compose_files_without_profile(cmd: &mut Command, manifest: &StackManifest) {
    for arg in compose_file_args_opts(manifest, false) {
        cmd.arg(arg);
    }
}

/// `force_build` is the lesson-level `--build` overlay (graphql-batch-execution).
pub fn compose_up_args_with_build(manifest: &StackManifest, force_build: bool) -> Vec<String> {
    let mut args = vec!["compose".into()];
    args.extend(compose_file_args(manifest));
    args.push("up".into());
    args.push("-d".into());
    if manifest.build_on_start || force_build {
        args.push("--build".into());
    }
    args
}

pub fn parse_compose_name_list(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect()
}

/// A profiled stack is up only when a running service is *not* a default service.
pub fn profiled_services_are_running(running: &[String], default_services: &[String]) -> bool {
    running
        .iter()
        .any(|svc| !default_services.iter().any(|d| d == svc))
}

/// Status rule used by `compose_has_running` (unit-testable without Docker).
/// Empty `config --services` (defaults) means the profiled stack is not up.
/// Ports this profiled stack adds on top of the default compose project
/// (Spring 9090/8081). Shared ports stay owned by the already-running Go services.
pub fn overlay_only_ports(starting: &StackManifest, related: &[StackManifest]) -> Vec<u16> {
    if starting.compose_profile.is_none() {
        return Vec::new();
    }
    let mut shared: std::collections::HashSet<u16> = std::collections::HashSet::new();
    for manifest in related {
        if manifest.compose_profile.is_none() {
            shared.extend(&manifest.ports);
        }
    }
    starting
        .ports
        .iter()
        .copied()
        .filter(|port| !shared.contains(port))
        .collect()
}

pub fn compose_has_running_from_lists(
    running: &[String],
    has_profile: bool,
    defaults: &[String],
) -> bool {
    if running.is_empty() {
        return false;
    }
    if !has_profile {
        return true;
    }
    if defaults.is_empty() {
        return false;
    }
    profiled_services_are_running(running, defaults)
}

pub fn is_version_newer(a: &str, b: &str) -> bool {
    if a.is_empty() {
        return false;
    }
    if b.is_empty() {
        return true;
    }
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(va), Ok(vb)) => {
            // `sinceVersion: 0.8.3` is the 0.8.3 train — not newer than 0.8.3-alpha.1.
            if va.major == vb.major
                && va.minor == vb.minor
                && va.patch == vb.patch
                && va.pre.is_empty()
                && !vb.pre.is_empty()
            {
                return false;
            }
            va > vb
        }
        (Ok(_), Err(_)) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_version_newer_semver() {
        assert!(is_version_newer("0.8.4", "0.8.3"));
        assert!(!is_version_newer("0.8.3", "0.8.3"));
        assert!(!is_version_newer("0.8.3", "0.8.4"));
        assert!(is_version_newer("0.8.3", ""));
        assert!(!is_version_newer("", "0.8.3"));
        assert!(is_version_newer("0.8.3-alpha.2", "0.8.3-alpha.1"));
        assert!(
            !is_version_newer("0.8.3", "0.8.3-alpha.1"),
            "release train 0.8.3 is not newer than 0.8.3-alpha.1"
        );
        assert!(is_version_newer("0.8.4", "0.8.3-alpha.1"));
        assert!(!is_version_newer("0.8.3-alpha.1", "0.8.3"));
    }

    #[test]
    fn compose_project_names_do_not_collide_on_folder_basename() {
        assert_eq!(compose_project_name("graphql"), "rff-graphql");
        assert_eq!(compose_project_name("ws-graphql"), "rff-ws-graphql");
        assert_eq!(compose_project_name("graphql-tls"), "rff-graphql-tls");
        assert_eq!(compose_project_name("kafka-tls"), "rff-kafka-tls");
        assert_eq!(compose_project_name("grpc"), compose_project_name("grpc-spring"));
        assert_eq!(compose_project_name("grpc"), "rff-grpc-family");
    }

    #[test]
    fn legacy_project_is_folder_basename_and_distinct_from_rff() {
        let tls = PathBuf::from("/tmp/docker/graphql/tls");
        assert_eq!(legacy_compose_project_name(&tls).as_deref(), Some("tls"));
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/graphql/tls");
        let m = load_manifest(&repo, "graphql-tls").expect("graphql-tls");
        assert_eq!(
            legacy_compose_project_if_distinct(&tls, &[m]),
            Some("tls".into())
        );
    }

    #[test]
    fn compose_files_declare_matching_project_name() {
        let docker = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker");
        let cases: &[(&str, &str)] = &[
            ("graphql", "graphql"),
            ("graphql-tls", "graphql/tls"),
            ("grpc", "grpc"),
            ("grpc-spring", "grpc"),
            ("kafka-plaintext", "kafka/plaintext"),
            ("kafka-secure", "kafka/secure"),
            ("kafka-tls", "kafka/tls"),
            ("kafka-schema-registry", "kafka/schema-registry"),
            ("ws-socketio", "websocket/socketio"),
            ("ws-graphql", "websocket/graphql"),
            ("ws-stomp", "websocket/stomp"),
            ("ws-tls", "websocket"),
            ("api-mock", "api-mock"),
        ];
        for (key, rel) in cases {
            let dir = docker.join(rel);
            let m = load_manifest(&dir, key).unwrap_or_else(|e| panic!("{key}: {e}"));
            let expected = format!("name: {}", compose_project_name(key));
            for file in &m.compose_files {
                let text = std::fs::read_to_string(dir.join(file))
                    .unwrap_or_else(|e| panic!("{key} {file}: {e}"));
                assert!(
                    text.contains(&expected),
                    "{key} {file} missing `{expected}`"
                );
            }
        }
    }

    #[test]
    fn merged_args_can_target_legacy_project() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/graphql/tls");
        let m = load_manifest(&repo, "graphql-tls").expect("graphql-tls");
        let args = compose_merged_args_for_project(&[m], "tls");
        assert!(args.windows(2).any(|w| w == ["-p", "tls"]));
        assert!(!args.iter().any(|a| a == "rff-graphql-tls"));
    }

    #[test]
    fn load_graphql_manifest_from_repo() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/graphql");
        let m = load_manifest(&repo, "graphql").expect("graphql stack.json");
        assert_eq!(m.ports, vec![4010]);
        assert_eq!(m.compose_files, vec!["docker-compose.yml"]);
        assert!(!m.build_on_start);
    }

    #[test]
    fn load_grpc_spring_uses_overlay_file() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/grpc");
        let m = load_manifest(&repo, "grpc-spring").expect("stack-spring.json");
        assert_eq!(m.compose_profile.as_deref(), Some("spring"));
        assert!(m.ports.contains(&9090));
    }

    #[test]
    fn load_ws_tls_from_websocket_root() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/websocket");
        let m = load_manifest(&repo, "ws-tls").expect("ws-tls stack.json");
        assert_eq!(m.compose_files.len(), 2);
        assert_eq!(m.cert_expires_at.as_deref(), Some("2036-08-30"));
    }

    #[test]
    fn compose_up_passes_every_file_in_one_command() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/graphql/tls");
        let m = load_manifest(&repo, "graphql-tls").expect("graphql-tls");
        let args = compose_up_args_with_build(&m, false);
        assert_eq!(
            args,
            vec![
                "compose",
                "-p",
                "rff-graphql-tls",
                "-f",
                "docker-compose.yml",
                "-f",
                "docker-compose.mtls.yml",
                "up",
                "-d",
            ]
        );
    }

    #[test]
    fn compose_up_ws_tls_keeps_both_files() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/websocket");
        let m = load_manifest(&repo, "ws-tls").expect("ws-tls");
        let args = compose_up_args_with_build(&m, false);
        assert!(args.windows(2).any(|w| w == ["-p", "rff-ws-tls"]));
        assert!(args.windows(2).any(|w| w == ["-f", "docker-compose.tls.yml"]));
        assert!(args.windows(2).any(|w| w == ["-f", "docker-compose.mtls.yml"]));
        assert_eq!(args.iter().filter(|a| *a == "-f").count(), 2);
    }

    #[test]
    fn compose_up_includes_spring_profile() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/grpc");
        let m = load_manifest(&repo, "grpc-spring").expect("stack-spring.json");
        let args = compose_up_args_with_build(&m, false);
        assert_eq!(
            args,
            vec![
                "compose",
                "-p",
                "rff-grpc-family",
                "--profile",
                "spring",
                "-f",
                "docker-compose.yml",
                "up",
                "-d",
            ]
        );
    }

    #[test]
    fn compose_up_force_build_adds_flag_once() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/graphql");
        let m = load_manifest(&repo, "graphql").expect("graphql");
        assert!(!m.build_on_start);
        let args = compose_up_args_with_build(&m, true);
        assert_eq!(args.iter().filter(|a| *a == "--build").count(), 1);
        assert!(!compose_up_args_with_build(&m, false).contains(&"--build".into()));
    }

    #[test]
    fn profiled_services_are_running_requires_non_default() {
        let running_go = vec!["grpc-test-server".into(), "envoy-grpc-web".into()];
        let defaults = vec![
            "grpc-test-server".into(),
            "grpc-test-server-tls".into(),
            "envoy-grpc-web".into(),
        ];
        assert!(!profiled_services_are_running(&running_go, &defaults));
        let mut with_spring = running_go.clone();
        with_spring.push("spring-boot-fixture".into());
        assert!(profiled_services_are_running(&with_spring, &defaults));
        assert!(!profiled_services_are_running(&[], &defaults));
    }

    #[test]
    fn compose_has_running_from_lists_profile_rules() {
        let go = vec!["grpc-test-server".into()];
        let defaults = vec!["grpc-test-server".into(), "envoy-grpc-web".into()];
        let spring = vec!["grpc-test-server".into(), "spring-boot-fixture".into()];
        assert!(compose_has_running_from_lists(&go, false, &[]));
        assert!(!compose_has_running_from_lists(&[], false, &[]));
        assert!(!compose_has_running_from_lists(&go, true, &defaults));
        assert!(compose_has_running_from_lists(&spring, true, &defaults));
        assert!(!compose_has_running_from_lists(&spring, true, &[]));
    }

    #[test]
    fn parse_compose_name_list_skips_blanks() {
        assert_eq!(
            parse_compose_name_list("grpc-test-server\n\nspring-boot-fixture\n"),
            vec!["grpc-test-server", "spring-boot-fixture"]
        );
    }

    #[test]
    fn overlay_only_ports_are_spring_extras() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/grpc");
        let go = load_manifest(&repo, "grpc").expect("grpc");
        let spring = load_manifest(&repo, "grpc-spring").expect("spring");
        assert!(overlay_only_ports(&go, &[go.clone(), spring.clone()]).is_empty());
        let extra = overlay_only_ports(&spring, &[go, spring.clone()]);
        assert!(extra.contains(&9090));
        assert!(extra.contains(&8081));
        assert!(!extra.contains(&50051));
    }

    #[test]
    fn stop_merges_grpc_spring_profile() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/grpc");
        let manifests = load_related_manifests(&repo, "grpc");
        assert_eq!(manifests.len(), 2);
        let args = compose_merged_args(&manifests);
        assert!(args.windows(2).any(|w| w == ["-p", "rff-grpc-family"]));
        assert!(args.windows(2).any(|w| w == ["--profile", "spring"]));
        assert!(args.windows(2).any(|w| w == ["-f", "docker-compose.yml"]));
        assert_eq!(stop_stack_keys("graphql"), &[] as &[&str]);
    }
}
