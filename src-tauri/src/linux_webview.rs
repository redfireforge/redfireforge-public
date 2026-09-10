//! Linux WebKitGTK blank-window workarounds.
//!
//! WebKitGTK 2.4x/2.5x often creates the window but never paints (solid navy
//! `--bg`, or solid white on the light Standard theme) on VMware guests,
//! Wayland sessions, and AppImage FUSE mounts. Env vars must be set **before**
//! the webview is created. Existing user values are left alone except
//! `GDK_BACKEND` / `WAYLAND_DISPLAY`: AppRun often exports `GDK_BACKEND=x11`
//! while leaving `WAYLAND_DISPLAY` set, and GDK still prefers Wayland.

#[cfg(target_os = "linux")]
use std::env;
#[cfg(target_os = "linux")]
use std::fs;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LinuxDisplayHints {
    pub wayland: bool,
    pub vmware: bool,
    pub appimage: bool,
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

pub(crate) fn is_vmware_pci_vendor(vendor: &str) -> bool {
    matches!(vendor.trim().to_ascii_lowercase().as_str(), "0x15ad" | "15ad")
}

pub(crate) fn is_appimage_env(appimage: Option<&str>, appdir: Option<&str>) -> bool {
    appimage.map(|v| !v.is_empty()).unwrap_or(false)
        || appdir.map(|v| !v.is_empty()).unwrap_or(false)
}

pub(crate) fn is_wayland_session(wayland_display: Option<&str>, xdg_session_type: Option<&str>) -> bool {
    wayland_display.map(|v| !v.is_empty()).unwrap_or(false)
        || xdg_session_type.is_some_and(|v| v.eq_ignore_ascii_case("wayland"))
}

fn needs_x11_backend(hints: &LinuxDisplayHints) -> bool {
    hints.vmware || hints.wayland
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

    if needs_x11_backend(hints) {
        if !already_set("WEBKIT_DISABLE_COMPOSITING_MODE") {
            patch
                .set
                .push(("WEBKIT_DISABLE_COMPOSITING_MODE".into(), "1".into()));
        }
        // Force X11 even when AppRun already exported GDK_BACKEND=x11: GDK still
        // binds Wayland while WAYLAND_DISPLAY remains in the environment.
        patch.set.push(("GDK_BACKEND".into(), "x11".into()));
        patch.unset.push("WAYLAND_DISPLAY".into());
    }

    if hints.vmware && !already_set("LIBGL_ALWAYS_SOFTWARE") {
        patch
            .set
            .push(("LIBGL_ALWAYS_SOFTWARE".into(), "1".into()));
    }

    // WebKit's sandbox cannot see an AppImage FUSE/squashfs mount, so the
    // window stays white/navy. Extracted or .deb launches leave this unset.
    if hints.appimage && !already_set("WEBKIT_DISABLE_SANDBOX") {
        patch
            .set
            .push(("WEBKIT_DISABLE_SANDBOX".into(), "1".into()));
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
            vmware: is_vmware_dmi(&read_dmi_blob()) || has_vmware_pci(),
            appimage: is_appimage_env(
                env::var("APPIMAGE").ok().as_deref(),
                env::var("APPDIR").ok().as_deref(),
            ),
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
        "/sys/devices/virtual/dmi/id/sys_vendor",
        "/sys/devices/virtual/dmi/id/product_name",
        "/sys/devices/virtual/dmi/id/bios_vendor",
    ] {
        if let Ok(value) = fs::read_to_string(path) {
            blob.push_str(&value);
            blob.push(' ');
        }
    }
    blob
}

#[cfg(target_os = "linux")]
fn has_vmware_pci() -> bool {
    let Ok(entries) = fs::read_dir("/sys/bus/pci/devices") else {
        return false;
    };
    entries.flatten().any(|entry| {
        fs::read_to_string(entry.path().join("vendor"))
            .is_ok_and(|vendor| is_vmware_pci_vendor(&vendor))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn already_none(_: &str) -> bool {
        false
    }

    fn bare_hints(wayland: bool, vmware: bool, appimage: bool) -> LinuxDisplayHints {
        LinuxDisplayHints {
            wayland,
            vmware,
            appimage,
        }
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
    fn vmware_pci_matches_svga_vendor() {
        assert!(is_vmware_pci_vendor("0x15ad"));
        assert!(is_vmware_pci_vendor("0x15AD\n"));
        assert!(is_vmware_pci_vendor("15ad"));
        assert!(!is_vmware_pci_vendor("0x10de"));
        assert!(!is_vmware_pci_vendor(""));
    }

    #[test]
    fn appimage_env_from_appimage_or_appdir() {
        assert!(is_appimage_env(Some("/tmp/RedfireForge.AppImage"), None));
        assert!(is_appimage_env(None, Some("/tmp/.mount_RedfirXXXX")));
        assert!(!is_appimage_env(Some(""), None));
        assert!(!is_appimage_env(None, None));
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
        let patch = compute_linux_webview_env_patch(&bare_hints(false, false, false), already_none);
        assert_eq!(
            patch.set,
            vec![("WEBKIT_DISABLE_DMABUF_RENDERER".into(), "1".into())]
        );
        assert!(patch.unset.is_empty());
    }

    #[test]
    fn wayland_forces_x11_and_unsets_wayland_display() {
        let patch = compute_linux_webview_env_patch(&bare_hints(true, false, false), already_none);
        assert!(patch
            .set
            .iter()
            .any(|(k, v)| k == "WEBKIT_DISABLE_DMABUF_RENDERER" && v == "1"));
        assert!(patch
            .set
            .iter()
            .any(|(k, v)| k == "WEBKIT_DISABLE_COMPOSITING_MODE" && v == "1"));
        assert!(patch.set.iter().any(|(k, v)| k == "GDK_BACKEND" && v == "x11"));
        assert!(!patch.set.iter().any(|(k, _)| k == "LIBGL_ALWAYS_SOFTWARE"));
        assert!(!patch.set.iter().any(|(k, _)| k == "WEBKIT_DISABLE_SANDBOX"));
        assert_eq!(patch.unset, vec!["WAYLAND_DISPLAY".to_string()]);
    }

    #[test]
    fn vmware_forces_x11_and_software_gl() {
        let patch = compute_linux_webview_env_patch(&bare_hints(true, true, false), already_none);
        let keys: Vec<_> = patch.set.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"WEBKIT_DISABLE_DMABUF_RENDERER"));
        assert!(keys.contains(&"WEBKIT_DISABLE_COMPOSITING_MODE"));
        assert!(keys.contains(&"GDK_BACKEND"));
        assert!(keys.contains(&"LIBGL_ALWAYS_SOFTWARE"));
        assert!(!keys.contains(&"WEBKIT_DISABLE_SANDBOX"));
        assert_eq!(patch.unset, vec!["WAYLAND_DISPLAY".to_string()]);
    }

    #[test]
    fn appimage_disables_webkit_sandbox() {
        let patch = compute_linux_webview_env_patch(&bare_hints(false, false, true), already_none);
        assert!(patch
            .set
            .iter()
            .any(|(k, v)| k == "WEBKIT_DISABLE_SANDBOX" && v == "1"));
        assert!(patch.unset.is_empty());
    }

    #[test]
    fn existing_user_env_is_not_overwritten_except_display_backend() {
        let patch = compute_linux_webview_env_patch(&bare_hints(true, true, true), |key| {
            matches!(
                key,
                "WEBKIT_DISABLE_DMABUF_RENDERER"
                    | "WEBKIT_DISABLE_COMPOSITING_MODE"
                    | "GDK_BACKEND"
                    | "LIBGL_ALWAYS_SOFTWARE"
                    | "WEBKIT_DISABLE_SANDBOX"
            )
        });
        assert_eq!(patch.set, vec![("GDK_BACKEND".into(), "x11".into())]);
        assert_eq!(patch.unset, vec!["WAYLAND_DISPLAY".to_string()]);
    }
}
