//! Last-run compose log persistence (Phase 7).
//!
//! File name includes `stack_key` because `grpc` and `grpc-spring` share a directory.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub(crate) const MAX_LAST_RUN_LOG_BYTES: usize = 256 * 1024;

pub(crate) fn is_safe_stack_key(stack_key: &str) -> bool {
    !stack_key.is_empty()
        && !stack_key.contains('/')
        && !stack_key.contains('\\')
        && !stack_key.contains("..")
        && stack_key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn last_run_log_path(dir: &Path, stack_key: &str) -> Option<PathBuf> {
    if !is_safe_stack_key(stack_key) {
        return None;
    }
    Some(dir.join(format!("last-run-{stack_key}.log")))
}

pub(crate) fn truncate_last_run_log(dir: &Path, stack_key: &str) {
    if let Some(path) = last_run_log_path(dir, stack_key) {
        let _ = std::fs::write(path, []);
    }
}

pub(crate) fn append_last_run_line(dir: &Path, stack_key: &str, line: &str) {
    let Some(path) = last_run_log_path(dir, stack_key) else {
        return;
    };
    let _ = append_line(&path, line);
}

fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    {
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        writeln!(file, "{line}")?;
    }
    maybe_trim_last_run_file(path);
    Ok(())
}

/// Read already tails at 256 KB. Rewrite the file when it grows past 2× that
/// so a long compose pull cannot leave an unbounded last-run log on disk.
fn maybe_trim_last_run_file(path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if (meta.len() as usize) <= MAX_LAST_RUN_LOG_BYTES * 2 {
        return;
    }
    if let Some(text) = read_last_run_log_file(path) {
        let _ = std::fs::write(path, text);
    }
}

pub(crate) fn read_last_run_log_text(dir: &Path, stack_key: &str) -> Option<String> {
    let path = last_run_log_path(dir, stack_key)?;
    read_last_run_log_file(&path)
}

pub(crate) fn read_last_run_log_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let slice = tail_log_bytes(&bytes, MAX_LAST_RUN_LOG_BYTES);
    let text = String::from_utf8_lossy(slice).into_owned();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

pub(crate) fn is_last_run_log_file_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("last-run-") else {
        return false;
    };
    let Some(key) = rest.strip_suffix(".log") else {
        return false;
    };
    is_safe_stack_key(key)
}

fn is_safe_relative(rel: &Path) -> bool {
    !rel.as_os_str().is_empty()
        && !rel.is_absolute()
        && rel
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// Copy last-run files out of `$APP_DATA/docker/` before extract wipes the tree.
pub(crate) fn collect_last_run_logs(docker_dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut out = Vec::new();
    walk_last_run_logs(docker_dir, docker_dir, &mut out);
    out
}

fn walk_last_run_logs(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_last_run_logs(root, &path, out);
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_last_run_log_file_name(name) {
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        if !is_safe_relative(rel) {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&path) {
            out.push((rel.to_path_buf(), bytes));
        }
    }
}

/// Put stashed last-run files back after extract recopies bundled compose trees.
pub(crate) fn restore_last_run_logs(docker_dir: &Path, stash: &[(PathBuf, Vec<u8>)]) {
    for (rel, bytes) in stash {
        let Some(name) = rel.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_safe_relative(rel) || !is_last_run_log_file_name(name) {
            continue;
        }
        let dest = docker_dir.join(rel);
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(dest, bytes);
    }
}

/// Last `max` bytes, advanced to the next newline so the UI does not start mid-line.
pub(crate) fn tail_log_bytes(bytes: &[u8], max: usize) -> &[u8] {
    if bytes.len() <= max {
        return bytes;
    }
    let start = bytes.len() - max;
    match bytes[start..].iter().position(|&b| b == b'\n') {
        Some(i) => &bytes[start + i + 1..],
        None => &bytes[start..],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rff-last-run-{stamp}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn path_uses_stack_key_not_only_dir() {
        let dir = Path::new("/tmp/docker/grpc");
        assert_eq!(
            last_run_log_path(dir, "grpc").as_deref(),
            Some(Path::new("/tmp/docker/grpc/last-run-grpc.log"))
        );
        assert_eq!(
            last_run_log_path(dir, "grpc-spring").as_deref(),
            Some(Path::new("/tmp/docker/grpc/last-run-grpc-spring.log"))
        );
        assert_ne!(
            last_run_log_path(dir, "grpc"),
            last_run_log_path(dir, "grpc-spring")
        );
    }

    #[test]
    fn rejects_unsafe_stack_keys() {
        let dir = Path::new("/tmp/docker");
        assert!(last_run_log_path(dir, "../x").is_none());
        assert!(last_run_log_path(dir, "foo/bar").is_none());
        assert!(last_run_log_path(dir, "foo\\bar").is_none());
        assert!(last_run_log_path(dir, "").is_none());
        assert!(last_run_log_path(dir, "graphql").is_some());
        assert!(last_run_log_path(dir, "kafka-plaintext").is_some());
    }

    #[test]
    fn append_creates_missing_parent_dir() {
        let dir = temp_dir();
        let nested = dir.join("graphql");
        assert!(!nested.exists());
        append_last_run_line(&nested, "graphql", "line");
        assert_eq!(
            read_last_run_log_text(&nested, "graphql").as_deref(),
            Some("line\n")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn truncate_then_two_appends() {
        let dir = temp_dir();
        append_last_run_line(&dir, "graphql", "old");
        truncate_last_run_log(&dir, "graphql");
        append_last_run_line(&dir, "graphql", "one");
        append_last_run_line(&dir, "graphql", "two");
        assert_eq!(
            read_last_run_log_text(&dir, "graphql").as_deref(),
            Some("one\ntwo\n")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_or_empty_file_is_none() {
        let dir = temp_dir();
        assert!(read_last_run_log_text(&dir, "graphql").is_none());
        truncate_last_run_log(&dir, "graphql");
        assert!(read_last_run_log_text(&dir, "graphql").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sibling_keys_do_not_overwrite() {
        let dir = temp_dir();
        append_last_run_line(&dir, "grpc", "base");
        append_last_run_line(&dir, "grpc-spring", "spring");
        assert_eq!(read_last_run_log_text(&dir, "grpc").as_deref(), Some("base\n"));
        assert_eq!(
            read_last_run_log_text(&dir, "grpc-spring").as_deref(),
            Some("spring\n")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_over_max_returns_newline_aligned_tail() {
        let prefix = b"DROP-ME\n";
        let keep = vec![b'x'; MAX_LAST_RUN_LOG_BYTES];
        let mut bytes = prefix.to_vec();
        bytes.extend_from_slice(&keep);
        let tail = tail_log_bytes(&bytes, MAX_LAST_RUN_LOG_BYTES);
        assert_eq!(tail, keep.as_slice());
        assert!(!tail.starts_with(b"DROP"));
    }

    #[test]
    fn tail_without_newline_keeps_byte_window() {
        let bytes = vec![b'a'; MAX_LAST_RUN_LOG_BYTES + 8];
        let tail = tail_log_bytes(&bytes, MAX_LAST_RUN_LOG_BYTES);
        assert_eq!(tail.len(), MAX_LAST_RUN_LOG_BYTES);
        assert!(tail.iter().all(|&b| b == b'a'));
    }

    #[test]
    fn last_run_file_name_requires_safe_key() {
        assert!(is_last_run_log_file_name("last-run-graphql.log"));
        assert!(is_last_run_log_file_name("last-run-grpc-spring.log"));
        assert!(!is_last_run_log_file_name("last-run-.log"));
        assert!(!is_last_run_log_file_name("last-run-foo/bar.log"));
        assert!(!is_last_run_log_file_name("compose.log"));
        assert!(!is_last_run_log_file_name("last-run-graphql.txt"));
    }

    #[test]
    fn collect_then_restore_survives_a_dir_wipe() {
        let root = temp_dir();
        let docker = root.join("docker");
        let grpc = docker.join("grpc");
        let graphql = docker.join("graphql");
        fs::create_dir_all(&grpc).unwrap();
        fs::create_dir_all(&graphql).unwrap();
        fs::write(grpc.join("last-run-grpc.log"), "go\n").unwrap();
        fs::write(grpc.join("last-run-grpc-spring.log"), "spring\n").unwrap();
        fs::write(graphql.join("last-run-graphql.log"), "gql\n").unwrap();
        fs::write(graphql.join("docker-compose.yml"), "old\n").unwrap();
        fs::write(graphql.join("not-a-log.txt"), "skip\n").unwrap();

        let stash = collect_last_run_logs(&docker);
        assert_eq!(stash.len(), 3);
        fs::remove_dir_all(&docker).unwrap();
        fs::create_dir_all(docker.join("graphql")).unwrap();
        fs::write(docker.join("graphql").join("docker-compose.yml"), "new\n").unwrap();
        restore_last_run_logs(&docker, &stash);

        assert_eq!(
            read_last_run_log_text(&docker.join("grpc"), "grpc").as_deref(),
            Some("go\n")
        );
        assert_eq!(
            read_last_run_log_text(&docker.join("grpc"), "grpc-spring").as_deref(),
            Some("spring\n")
        );
        assert_eq!(
            read_last_run_log_text(&docker.join("graphql"), "graphql").as_deref(),
            Some("gql\n")
        );
        assert_eq!(
            fs::read_to_string(docker.join("graphql").join("docker-compose.yml")).unwrap(),
            "new\n"
        );
        assert!(!docker.join("graphql").join("not-a-log.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn append_trims_when_file_exceeds_double_max() {
        let dir = temp_dir();
        let path = last_run_log_path(&dir, "graphql").expect("path");
        let drop_marker = "UNIQUE-DROP-HEAD\n";
        let keep_marker = "UNIQUE-KEEP-TAIL\n";
        let mut bytes = drop_marker.as_bytes().to_vec();
        let filler = vec![b'x'; 80];
        while bytes.len() < MAX_LAST_RUN_LOG_BYTES * 2 {
            bytes.extend_from_slice(&filler);
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(keep_marker.as_bytes());
        fs::write(&path, &bytes).unwrap();
        append_last_run_line(&dir, "graphql", "newest");
        let text = read_last_run_log_text(&dir, "graphql").expect("trimmed");
        let on_disk = fs::metadata(&path).unwrap().len() as usize;
        assert!(on_disk <= MAX_LAST_RUN_LOG_BYTES);
        assert!(text.contains("newest"));
        assert!(text.contains("UNIQUE-KEEP-TAIL"));
        assert!(!text.contains("UNIQUE-DROP-HEAD"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_rejects_parent_dir_escape() {
        let dir = temp_dir();
        restore_last_run_logs(
            &dir,
            &[(PathBuf::from("../last-run-graphql.log"), b"nope\n".to_vec())],
        );
        assert!(!dir.join("last-run-graphql.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
