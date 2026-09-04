//! Port pre-check before `docker compose up`, with best-effort occupant names.

use super::docker_bin::{first_existing_file, hidden_cmd};
use super::manifest::StackManifest;
use serde::Serialize;
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const LOOKUP_TIMEOUT: Duration = Duration::from_millis(800);
const MAX_PROCESS_NAME_CHARS: usize = 64;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupant {
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

impl PortOccupant {
    fn port_only(port: u16) -> Self {
        Self {
            port,
            process: None,
            pid: None,
        }
    }
}

/// Only `AddrInUse` counts — `::1` bind can fail with `AddrNotAvailable`
/// when IPv6 is off, and that must not mark every port occupied.
fn bind_addr_in_use(host: &str, port: u16) -> bool {
    match TcpListener::bind((host, port)) {
        Err(e) => e.kind() == std::io::ErrorKind::AddrInUse,
        Ok(_) => false,
    }
}

/// Occupied if IPv4/IPv6 loopback or all-interfaces cannot bind (`AddrInUse`).
/// Compose publishes `0.0.0.0:port` and often `[::]:port`; a LAN-only
/// listener is invisible to loopback alone. `::` bind errors other than
/// `AddrInUse` (IPv6 off) are ignored, same as `::1`.
pub fn find_occupied_ports(ports: &[u16]) -> Vec<u16> {
    ports
        .iter()
        .filter(|&&port| {
            bind_addr_in_use("127.0.0.1", port)
                || bind_addr_in_use("::1", port)
                || bind_addr_in_use("0.0.0.0", port)
                || bind_addr_in_use("::", port)
        })
        .copied()
        .collect()
}

pub fn format_port_conflict_error(occupants: &[PortOccupant]) -> String {
    match serde_json::to_string(occupants) {
        Ok(json) => format!("PORT_CONFLICT:{json}"),
        Err(_) => {
            let ports = occupants
                .iter()
                .map(|o| o.port.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!("PORT_CONFLICT:{ports}")
        }
    }
}

pub async fn check_port_conflicts(manifest: &StackManifest) -> Result<(), String> {
    check_ports_free(&manifest.ports).await
}

pub async fn check_ports_free(ports: &[u16]) -> Result<(), String> {
    let occupied = find_occupied_ports(ports);
    if occupied.is_empty() {
        return Ok(());
    }
    let occupants = lookup_occupants(&occupied).await;
    Err(format_port_conflict_error(&occupants))
}

async fn lookup_occupants(ports: &[u16]) -> Vec<PortOccupant> {
    if ports.is_empty() {
        return Vec::new();
    }
    #[cfg(unix)]
    {
        lookup_unix(ports).await
    }
    #[cfg(windows)]
    {
        lookup_windows(ports).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        ports.iter().copied().map(PortOccupant::port_only).collect()
    }
}

pub(crate) fn lookup_command_candidates(name: &str, system_root: Option<&str>) -> Vec<PathBuf> {
    match name {
        "lsof" | "ps" => vec![
            PathBuf::from(format!("/usr/sbin/{name}")),
            PathBuf::from(format!("/usr/bin/{name}")),
            PathBuf::from(format!("/bin/{name}")),
            PathBuf::from(name),
        ],
        "netstat" | "tasklist" => {
            let root = system_root.filter(|s| !s.is_empty()).unwrap_or("C:\\Windows");
            vec![
                PathBuf::from(format!(r"{root}\System32\{name}.exe")),
                PathBuf::from(name),
            ]
        }
        other => vec![PathBuf::from(other)],
    }
}

fn hidden_lookup_cmd(name: &str) -> Command {
    let system_root: Option<String> = {
        #[cfg(windows)]
        {
            std::env::var("SystemRoot").ok()
        }
        #[cfg(not(windows))]
        {
            None
        }
    };
    let candidates = lookup_command_candidates(name, system_root.as_deref());
    let program = first_existing_file(&candidates).unwrap_or_else(|| PathBuf::from(name));
    hidden_cmd(program)
}

#[cfg(unix)]
async fn lookup_unix(ports: &[u16]) -> Vec<PortOccupant> {
    let mut cmd = hidden_lookup_cmd("lsof");
    cmd.args(["-nP", "-sTCP:LISTEN"]);
    for port in ports {
        cmd.arg(format!("-iTCP:{port}"));
    }
    let output = run_hidden_timeout(cmd).await;
    let pids: Vec<(u16, Option<u32>)> = ports
        .iter()
        .map(|&port| {
            let pid = output
                .as_deref()
                .and_then(|text| parse_lsof_listen_pid(text, port));
            (port, pid)
        })
        .collect();
    attach_process_names(pids, lookup_unix_comm).await
}

#[cfg(unix)]
async fn lookup_unix_comm(pid: u32) -> Option<String> {
    let mut cmd = hidden_lookup_cmd("ps");
    cmd.args(["-p", &pid.to_string(), "-o", "comm="]);
    let output = run_hidden_timeout(cmd).await?;
    parse_ps_comm(&output)
}

#[cfg(windows)]
async fn lookup_windows(ports: &[u16]) -> Vec<PortOccupant> {
    // No `-p tcp`: that filter is IPv4-only and drops `[::]:4010` / TCPv6 rows.
    let mut cmd = hidden_lookup_cmd("netstat");
    cmd.args(["-ano"]);
    let output = run_hidden_timeout(cmd).await;
    let pids: Vec<(u16, Option<u32>)> = ports
        .iter()
        .map(|&port| {
            let pid = output
                .as_deref()
                .and_then(|text| parse_netstat_listen_pid(text, port));
            (port, pid)
        })
        .collect();
    attach_process_names(pids, lookup_windows_image).await
}

#[cfg(windows)]
async fn lookup_windows_image(pid: u32) -> Option<String> {
    let mut cmd = hidden_lookup_cmd("tasklist");
    cmd.args([
        "/FI",
        &format!("PID eq {pid}"),
        "/FO",
        "CSV",
        "/NH",
    ]);
    let output = run_hidden_timeout(cmd).await?;
    output.lines().find_map(parse_tasklist_image)
}

async fn attach_process_names<F, Fut>(
    pids: Vec<(u16, Option<u32>)>,
    mut lookup_name: F,
) -> Vec<PortOccupant>
where
    F: FnMut(u32) -> Fut,
    Fut: std::future::Future<Output = Option<String>>,
{
    let unique: Vec<u32> = {
        let mut seen = Vec::new();
        for (_, pid) in &pids {
            if let Some(pid) = *pid {
                if !seen.contains(&pid) {
                    seen.push(pid);
                }
            }
        }
        seen
    };
    let mut names: HashMap<u32, Option<String>> = HashMap::new();
    let lookups = unique.iter().map(|&pid| {
        let fut = lookup_name(pid);
        async move { (pid, fut.await) }
    });
    for (pid, name) in futures::future::join_all(lookups).await {
        names.insert(pid, name);
    }
    pids.into_iter()
        .map(|(port, pid)| match pid {
            Some(pid) => PortOccupant {
                port,
                pid: Some(pid),
                process: names.get(&pid).and_then(|n| n.clone()),
            },
            None => PortOccupant::port_only(port),
        })
        .collect()
}

async fn run_hidden_timeout(mut cmd: Command) -> Option<String> {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    cmd.kill_on_drop(true);
    let child = cmd.spawn().ok()?;
    match tokio::time::timeout(LOOKUP_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(out)) => Some(decode_command_output(&out.stdout)),
        _ => None,
    }
}

pub(crate) fn split_host_port(addr: &str) -> Option<(&str, &str)> {
    let addr = addr.trim();
    if addr.is_empty() {
        return None;
    }
    if let Some(rest) = addr.strip_prefix('[') {
        let (host, after) = rest.split_once("]:")?;
        return Some((host, after));
    }
    addr.rsplit_once(':')
}

/// lsof sometimes glues the state on (`*:4010(LISTEN)`).
pub(crate) fn local_addr_has_port(addr: &str, port: u16) -> bool {
    let token = addr
        .trim_matches(|c: char| c == '(' || c == ')')
        .split('(')
        .next()
        .unwrap_or(addr)
        .trim();
    let Some((_host, port_str)) = split_host_port(token) else {
        return false;
    };
    port_str.parse::<u16>().ok() == Some(port)
}

fn decode_utf16_units(bytes: &[u8], little: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| {
            if little {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

/// ASCII-ish UTF-16 LE has a 0 high byte on most code units. UTF-8 netstat
/// output never looks like that, so this does not steal a normal capture.
fn looks_like_utf16_le(bytes: &[u8]) -> bool {
    if bytes.len() < 8 || bytes.len() % 2 != 0 {
        return false;
    }
    let pairs = bytes.len() / 2;
    let nul_high = bytes.chunks_exact(2).filter(|c| c[1] == 0).count();
    nul_high * 4 >= pairs * 3
}

/// Console captures may be UTF-8 or UTF-16 (Windows BOM, or LE with no BOM).
pub(crate) fn decode_command_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        return decode_utf16_units(&bytes[2..], true);
    }
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        return decode_utf16_units(&bytes[2..], false);
    }
    if looks_like_utf16_le(bytes) {
        return decode_utf16_units(bytes, true);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

pub(crate) fn sanitize_process_name(name: &str) -> Option<String> {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>();
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out = trimmed.to_string();
    if out.chars().count() > MAX_PROCESS_NAME_CHARS {
        out = out.chars().take(MAX_PROCESS_NAME_CHARS).collect();
    }
    Some(out)
}

fn strip_bom(s: &str) -> &str {
    s.trim_start_matches('\u{feff}')
}

#[cfg(any(unix, test))]
pub(crate) fn parse_lsof_listen_pid(output: &str, port: u16) -> Option<u32> {
    for line in output.lines() {
        let line = strip_bom(line).trim();
        if line.is_empty() || line.starts_with("COMMAND") {
            continue;
        }
        if !line.to_ascii_uppercase().contains("LISTEN") {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 2 {
            continue;
        }
        let mentions_port = cols.iter().any(|col| local_addr_has_port(col, port));
        if !mentions_port {
            continue;
        }
        return cols
            .iter()
            .find_map(|col| col.parse::<u32>().ok())
            .filter(|&pid| pid > 0);
    }
    None
}

#[cfg(any(unix, test))]
pub(crate) fn parse_ps_comm(output: &str) -> Option<String> {
    let line = output
        .lines()
        .map(|l| strip_bom(l).trim())
        .find(|l| !l.is_empty())?;
    sanitize_process_name(line)
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_netstat_listen_pid(output: &str, port: u16) -> Option<u32> {
    let mut fallback = None;
    for line in output.lines() {
        let line = strip_bom(line);
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        let proto = cols[0].to_ascii_lowercase();
        if proto != "tcp" && proto != "tcpv6" {
            continue;
        }
        if !local_addr_has_port(cols[1], port) {
            continue;
        }
        let Some(pid) = cols
            .iter()
            .rev()
            .find_map(|p| p.parse::<u32>().ok())
            .filter(|&p| p > 0)
        else {
            continue;
        };
        let state = cols.get(3).copied().unwrap_or("");
        if state.eq_ignore_ascii_case("listening") || state == "02" {
            return Some(pid);
        }
        fallback = Some(pid);
    }
    fallback
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_tasklist_image(line: &str) -> Option<String> {
    let line = strip_bom(line).trim();
    if line.is_empty() || line.starts_with("INFO:") {
        return None;
    }
    let name = if let Some(rest) = line.strip_prefix('"') {
        rest.split('"').next().unwrap_or("")
    } else {
        line.split(',').next().unwrap_or("")
    };
    sanitize_process_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_ephemeral_port_is_not_occupied() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        assert!(find_occupied_ports(&[port]).is_empty());
    }

    #[test]
    fn bound_port_is_occupied() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        assert_eq!(find_occupied_ports(&[port]), vec![port]);
        drop(listener);
    }

    #[test]
    fn ipv6_loopback_listener_counts_as_occupied() {
        let Ok(listener) = TcpListener::bind(("::1", 0)) else {
            return;
        };
        let port = listener.local_addr().expect("addr").port();
        assert_eq!(find_occupied_ports(&[port]), vec![port]);
        drop(listener);
    }

    #[test]
    fn all_interfaces_ipv4_listener_counts_as_occupied() {
        let Ok(listener) = TcpListener::bind(("0.0.0.0", 0)) else {
            return;
        };
        let port = listener.local_addr().expect("addr").port();
        assert_eq!(find_occupied_ports(&[port]), vec![port]);
        drop(listener);
    }

    #[test]
    fn all_interfaces_ipv6_listener_counts_as_occupied() {
        let Ok(listener) = TcpListener::bind(("::", 0)) else {
            return;
        };
        let port = listener.local_addr().expect("addr").port();
        assert_eq!(find_occupied_ports(&[port]), vec![port]);
        drop(listener);
    }

    #[test]
    fn bind_addr_in_use_ignores_unavailable_family() {
        // A free high port on an unavailable address family is not occupied.
        if TcpListener::bind(("::1", 0)).is_err() {
            assert!(!bind_addr_in_use("::1", 59999));
        }
    }

    #[test]
    fn format_error_is_json_after_prefix() {
        let err = format_port_conflict_error(&[PortOccupant {
            port: 4010,
            process: Some("Python".into()),
            pid: Some(72363),
        }]);
        assert!(err.starts_with("PORT_CONFLICT:["));
        assert!(err.contains("\"port\":4010"));
        assert!(err.contains("Python"));
        assert!(err.contains("72363"));
    }

    #[test]
    fn format_error_omits_missing_name() {
        let err = format_port_conflict_error(&[PortOccupant::port_only(4443)]);
        assert!(err.starts_with("PORT_CONFLICT:["));
        assert!(err.contains("\"port\":4443"));
        assert!(!err.contains("process"));
    }

    #[test]
    fn split_host_port_does_not_treat_4010_as_401() {
        assert!(local_addr_has_port("127.0.0.1:4010", 4010));
        assert!(!local_addr_has_port("127.0.0.1:4010", 401));
        assert!(local_addr_has_port("[::]:4010", 4010));
        assert!(local_addr_has_port("*:4443", 4443));
        assert!(local_addr_has_port("*:4010(LISTEN)", 4010));
        assert!(!local_addr_has_port("127.0.0.1:40100", 4010));
    }

    #[test]
    fn parse_lsof_sample() {
        let sample = "\
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
Python  72363 me     3u  IPv4 0x1      0t0  TCP *:4010 (LISTEN)
node      99 me     8u  IPv6 0x2      0t0  TCP [::1]:4443 (LISTEN)
";
        assert_eq!(parse_lsof_listen_pid(sample, 4010), Some(72363));
        assert_eq!(parse_lsof_listen_pid(sample, 4443), Some(99));
        assert_eq!(parse_lsof_listen_pid(sample, 80), None);
        let glued = "\u{feff}Python  72363 me  3u  IPv4  TCP *:4010(LISTEN)\n";
        assert_eq!(parse_lsof_listen_pid(glued, 4010), Some(72363));
    }

    #[test]
    fn parse_ps_comm_takes_basename() {
        assert_eq!(
            parse_ps_comm("/usr/bin/python3.14\n"),
            Some("python3.14".into())
        );
        assert_eq!(parse_ps_comm("   \n"), None);
    }

    #[test]
    fn parse_netstat_sample_prefers_listening() {
        let sample = "\
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:4010         0.0.0.0:0              LISTENING       72363
  TCP    127.0.0.1:51234        127.0.0.1:4010         ESTABLISHED     88
  TCP    [::]:4443              [::]:0                 LISTENING       99
";
        assert_eq!(parse_netstat_listen_pid(sample, 4010), Some(72363));
        assert_eq!(parse_netstat_listen_pid(sample, 4443), Some(99));
        assert_eq!(parse_netstat_listen_pid(sample, 80), None);
    }

    #[test]
    fn parse_netstat_falls_back_when_locale_omits_listening() {
        let sample = "\
  TCP    0.0.0.0:4010           0.0.0.0:0              ABHOREN         72363
  TCP    127.0.0.1:51234        127.0.0.1:4010         ESTABLISHED     88
";
        assert_eq!(parse_netstat_listen_pid(sample, 4010), Some(72363));
        assert_eq!(parse_netstat_listen_pid(sample, 80), None);
    }

    #[test]
    fn parse_netstat_ignores_remote_column_only_match() {
        let sample = "\
  TCP    127.0.0.1:51234        127.0.0.1:4010         ESTABLISHED     88
";
        assert_eq!(parse_netstat_listen_pid(sample, 4010), None);
    }

    #[test]
    fn parse_netstat_reads_ipv6_and_bom() {
        let sample = "\u{feff}  TCP    [::]:4010              [::]:0                 LISTENING       42\n";
        assert_eq!(parse_netstat_listen_pid(sample, 4010), Some(42));
        let hex_state = "  TCP    127.0.0.1:4010         0.0.0.0:0              02              7\n";
        assert_eq!(parse_netstat_listen_pid(hex_state, 4010), Some(7));
        let extra_col = "  TCP    127.0.0.1:4010         0.0.0.0:0              LISTENING       72363 Offload\n";
        assert_eq!(parse_netstat_listen_pid(extra_col, 4010), Some(72363));
    }

    #[test]
    fn parse_tasklist_csv() {
        assert_eq!(
            parse_tasklist_image("\"Python.exe\",\"72363\",\"Console\",\"1\",\"12,345 K\""),
            Some("Python.exe".into())
        );
        assert_eq!(
            parse_tasklist_image("\u{feff}\"Python.exe\",\"72363\",\"Console\",\"1\",\"12,345 K\""),
            Some("Python.exe".into())
        );
        assert_eq!(parse_tasklist_image("INFO: No tasks"), None);
    }

    #[test]
    fn decode_command_output_reads_utf16_le_bom() {
        let text = "  TCP    [::]:4010              [::]:0                 LISTENING       42\n";
        let mut bytes = vec![0xFF, 0xFE];
        for u in text.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        let decoded = decode_command_output(&bytes);
        assert_eq!(parse_netstat_listen_pid(&decoded, 4010), Some(42));
    }

    #[test]
    fn decode_command_output_reads_utf16_le_without_bom() {
        let text = "  TCP    [::]:4010              [::]:0                 LISTENING       42\n";
        let mut bytes = Vec::new();
        for u in text.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        let decoded = decode_command_output(&bytes);
        assert_eq!(parse_netstat_listen_pid(&decoded, 4010), Some(42));
        assert_eq!(decode_command_output(text.as_bytes()), text);
    }

    #[test]
    fn lookup_command_candidates_cover_unix_and_windows() {
        let lsof = lookup_command_candidates("lsof", None);
        assert!(lsof.iter().any(|p| p.ends_with("usr/sbin/lsof") || p.ends_with("/usr/sbin/lsof")));
        assert!(lsof.iter().any(|p| p == std::path::Path::new("lsof")));
        let netstat = lookup_command_candidates("netstat", Some(r"D:\Windows"));
        assert!(netstat.iter().any(|p| {
            let s = p.to_string_lossy();
            s.contains("System32") && s.contains("netstat.exe")
        }));
    }

    #[test]
    fn sanitize_strips_controls_and_caps() {
        assert_eq!(sanitize_process_name("ab\0c"), Some("abc".into()));
        let long = "n".repeat(80);
        assert_eq!(
            sanitize_process_name(&long).map(|s| s.chars().count()),
            Some(64)
        );
    }
}
