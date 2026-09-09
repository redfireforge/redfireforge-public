//! Linux WebKitGTK blank-window workarounds.
//!
//! WebKitGTK 2.4x/2.5x often creates the window but never paints (solid navy
//! `--bg`) on VMware guests and some Wayland/NVIDIA setups. Env vars must be
//! set **before** the webview is created. Existing user values are left alone.

#[cfg(target_os = "linux")]
use std::env;
#[cfg(target_os = "linux")]
use std::fs;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LinuxDisplayHints {
    pub wayland: bool,
    pub vmware: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct LinuxWebviewEnvPatch {
    pub set: Vec<(String, String)>,
    pub unset: Vec<String>,
}

/// Apply Linux WebKit workarounds. No-op on other platforms.
pub fn apply_linux_webview_workarounds() {
    #[cfg(target_os = "linux")]
    {
        let hints = LinuxDisplayHints::detect();
        let patch = compute_linux_webview_env_patch(&hints, |key| env::var_os(key).is_some());
        apply_linux_webview_env_patch(&patch);
    }
}

pub(crate) fn is_vmware_dmi(blob: &str) -> bool {
    blob.to_ascii_lowercase().contains("vmware")
}

pub(crate) fn is_wayland_session(wayland_display: Option<&str>, xdg_session_type: Option<&str>) -> bool {
    wayland_display.map(|v| !v.is_empty()).unwrap_or(false)
        || xdg_session_type.is_some_and(|v| v.eq_ignore_ascii_case("wayland"))
}

pub(crate) fn compute_linux_webview_env_patch(
    hints: &LinuxDisplayHints,
    already_set: impl Fn(&str) -> bool,
) -> LinuxWebviewEnvPatch {
    let mut patch = LinuxWebviewEnvPatch::default();

    // DMA-BUF is the common blank-window cause on NVIDIA, VMs, and some Mesa.
    if !already_set("WEBKIT_DISABLE_DMABUF_RENDERER") {
        patch
            .set
            .push(("WEBKIT_DISABLE_DMABUF_RENDERER".into(), "1".into()));
    }

    if hints.vmware {
        if !already_set("WEBKIT_DISABLE_COMPOSITING_MODE") {
            patch
                .set
                .push(("WEBKIT_DISABLE_COMPOSITING_MODE".into(), "1".into()));
        }
        if !already_set("GDK_BACKEND") {
            patch.set.push(("GDK_BACKEND".into(), "x11".into()));
        }
        if !already_set("LIBGL_ALWAYS_SOFTWARE") {
            patch
                .set
                .push(("LIBGL_ALWAYS_SOFTWARE".into(), "1".into()));
        }
        // GDK_BACKEND=x11 is ignored while WAYLAND_DISPLAY remains set.
        patch.unset.push("WAYLAND_DISPLAY".into());
    } else if hints.wayland && !already_set("WEBKIT_DISABLE_COMPOSITING_MODE") {
        patch
            .set
            .push(("WEBKIT_DISABLE_COMPOSITING_MODE".into(), "1".into()));
    }

    patch
}

#[cfg(target_os = "linux")]
fn apply_linux_webview_env_patch(patch: &LinuxWebviewEnvPatch) {
    for (key, value) in &patch.set {
        // Called once at process start, before the webview or worker threads.
        unsafe { env::set_var(key, value) };
    }
    for key in &patch.unset {
        unsafe { env::remove_var(key) };
    }
}

impl LinuxDisplayHints {
    #[cfg(target_os = "linux")]
    fn detect() -> Self {
        Self {
            wayland: is_wayland_session(
                env::var("WAYLAND_DISPLAY").ok().as_deref(),
                env::var("XDG_SESSION_TYPE").ok().as_deref(),
            ),
            vmware: is_vmware_dmi(&read_dmi_blob()),
        }
    }
}

#[cfg(target_os = "linux")]
fn read_dmi_blob() -> String {
    let mut blob = String::new();
    for path in [
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/bios_vendor",
    ] {
        if let Ok(value) = fs::read_to_string(path) {
            blob.push_str(&value);
            blob.push(' ');
        }
    }
    blob
}

#[cfg(test)]
mod tests {
    use super::*;

    fn already_none(_: &str) -> bool {
        false
    }

    #[test]
    fn vmware_dmi_matches_vendor_and_product() {
        assert!(is_vmware_dmi("VMware, Inc."));
        assert!(is_vmware_dmi("VMware Virtual Platform"));
        assert!(is_vmware_dmi("Phoenix Technologies Ltd\nVMware"));
        assert!(!is_vmware_dmi("QEMU"));
        assert!(!is_vmware_dmi("Dell Inc."));
        assert!(!is_vmware_dmi(""));
    }

    #[test]
    fn wayland_session_from_display_or_xdg() {
        assert!(is_wayland_session(Some("wayland-0"), None));
        assert!(is_wayland_session(None, Some("wayland")));
        assert!(is_wayland_session(None, Some("Wayland")));
        assert!(!is_wayland_session(None, Some("x11")));
        assert!(!is_wayland_session(Some(""), Some("x11")));
        assert!(!is_wayland_session(None, None));
    }

    #[test]
    fn linux_always_disables_dmabuf() {
        let patch = compute_linux_webview_env_patch(
            &LinuxDisplayHints {
                wayland: false,
                vmware: false,
            },
            already_none,
        );
        assert_eq!(
            patch.set,
            vec![("WEBKIT_DISABLE_DMABUF_RENDERER".into(), "1".into())]
        );
        assert!(patch.unset.is_empty());
    }

    #[test]
    fn wayland_also_disables_compositing() {
        let patch = compute_linux_webview_env_patch(
            &LinuxDisplayHints {
                wayland: true,
                vmware: false,
            },
            already_none,
        );
        assert!(patch.set.iter().any(|(k, v)| k == "WEBKIT_DISABLE_DMABUF_RENDERER" && v == "1"));
        assert!(patch.set.iter().any(|(k, v)| k == "WEBKIT_DISABLE_COMPOSITING_MODE" && v == "1"));
        assert!(!patch.set.iter().any(|(k, _)| k == "LIBGL_ALWAYS_SOFTWARE"));
        assert!(patch.unset.is_empty());
    }

    #[test]
    fn vmware_forces_x11_and_software_gl() {
        let patch = compute_linux_webview_env_patch(
            &LinuxDisplayHints {
                wayland: true,
                vmware: true,
            },
            already_none,
        );
        let keys: Vec<_> = patch.set.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"WEBKIT_DISABLE_DMABUF_RENDERER"));
        assert!(keys.contains(&"WEBKIT_DISABLE_COMPOSITING_MODE"));
        assert!(keys.contains(&"GDK_BACKEND"));
        assert!(keys.contains(&"LIBGL_ALWAYS_SOFTWARE"));
        assert_eq!(patch.unset, vec!["WAYLAND_DISPLAY".to_string()]);
    }

    #[test]
    fn existing_user_env_is_not_overwritten() {
        let patch = compute_linux_webview_env_patch(
            &LinuxDisplayHints {
                wayland: true,
                vmware: true,
            },
            |key| {
                matches!(
                    key,
                    "WEBKIT_DISABLE_DMABUF_RENDERER"
                        | "WEBKIT_DISABLE_COMPOSITING_MODE"
                        | "GDK_BACKEND"
                        | "LIBGL_ALWAYS_SOFTWARE"
                )
            },
        );
        assert!(patch.set.is_empty());
        assert_eq!(patch.unset, vec!["WAYLAND_DISPLAY".to_string()]);
    }
}
