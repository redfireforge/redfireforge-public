//! Linux WebKitGTK blank-window workarounds.
//!
//! WebKitGTK 2.4x/2.5x often creates the window but never paints (solid navy
//! `--bg`, or solid white on the light Standard theme) on VMware guests,
//! Wayland sessions, and AppImage FUSE mounts. Env vars must be set **before**
//! the webview is created. Existing user values are left alone except
//! `GDK_BACKEND` / `WAYLAND_DISPLAY`: AppRun often exports `GDK_BACKEND=x11`
//! while leaving `WAYLAND_DISPLAY` set, and GDK still prefers Wayland.
//!
//! Official AppImages also bundle Ubuntu 22.04 WebKit/EGL via AppRun's
//! `LD_LIBRARY_PATH`. Those libraries fail to create an EGL display on VMware
//! (`EGL_BAD_PARAMETER`) and the window stays white. After applying env
//! patches we re-exec once with the system lib dir prepended so the webview
//! process loads host WebKit/GL.

// Helpers below are used on Linux and by unit tests. Non-Linux release builds
// only call apply_linux_webview_workarounds(), which is a no-op there.
#![cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]

#[cfg(target_os = "linux")]
use std::env;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;
#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "linux")]
use std::process::Command;

#[cfg(target_os = "linux")]
pub(crate) const RFF_LINUX_WEBVIEW_REEXEC: &str = "RFF_LINUX_WEBVIEW_REEXEC";
pub(crate) const SYSTEM_GL_LIB_DIR: &str = "/usr/lib/x86_64-linux-gnu";

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
        maybe_reexec_appimage_with_system_gl(&hints);
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

/// Prepend `system_lib` to `LD_LIBRARY_PATH`. `None` if it is already first.
pub(crate) fn prefixed_ld_library_path(current: Option<&str>, system_lib: &str) -> Option<String> {
    let current = current.unwrap_or("");
    if current.split(':').next() == Some(system_lib) {
        return None;
    }
    if current.is_empty() {
        Some(system_lib.to_string())
    } else {
        Some(format!("{system_lib}:{current}"))
    }
}

pub(crate) fn should_reexec_appimage_for_system_gl(
    appimage: bool,
    already_reexec: bool,
    system_lib_available: bool,
    current_ld: Option<&str>,
    system_lib: &str,
) -> bool {
    appimage
        && !already_reexec
        && system_lib_available
        && prefixed_ld_library_path(current_ld, system_lib).is_some()
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
        if !already_set("GSK_RENDERER") {
            patch.set.push(("GSK_RENDERER".into(), "cairo".into()));
        }
    }

    if hints.vmware {
        if !already_set("LIBGL_ALWAYS_SOFTWARE") {
            patch
                .set
                .push(("LIBGL_ALWAYS_SOFTWARE".into(), "1".into()));
        }
        if !already_set("GALLIUM_DRIVER") {
            patch.set.push(("GALLIUM_DRIVER".into(), "llvmpipe".into()));
        }
        if !already_set("MESA_LOADER_DRIVER_OVERRIDE") {
            patch
                .set
                .push(("MESA_LOADER_DRIVER_OVERRIDE".into(), "llvmpipe".into()));
        }
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

#[cfg(target_os = "linux")]
fn system_gl_lib_dir_available(dir: &str) -> bool {
    let path = Path::new(dir);
    path.join("libwebkit2gtk-4.1.so.0").exists() || path.join("libEGL.so.1").exists()
}

#[cfg(target_os = "linux")]
fn maybe_reexec_appimage_with_system_gl(hints: &LinuxDisplayHints) {
    let current_ld = env::var("LD_LIBRARY_PATH").ok();
    if !should_reexec_appimage_for_system_gl(
        hints.appimage,
        env::var_os(RFF_LINUX_WEBVIEW_REEXEC).is_some(),
        system_gl_lib_dir_available(SYSTEM_GL_LIB_DIR),
        current_ld.as_deref(),
        SYSTEM_GL_LIB_DIR,
    ) {
        return;
    }
    if let Some(new_ld) = prefixed_ld_library_path(current_ld.as_deref(), SYSTEM_GL_LIB_DIR) {
        unsafe { env::set_var("LD_LIBRARY_PATH", new_ld) };
    }
    let dri = Path::new(SYSTEM_GL_LIB_DIR).join("dri");
    if dri.is_dir() && env::var_os("LIBGL_DRIVERS_PATH").is_none() {
        unsafe { env::set_var("LIBGL_DRIVERS_PATH", dri.as_os_str()) };
    }
    let mesa = Path::new("/usr/share/glvnd/egl_vendor.d/50_mesa.json");
    if mesa.is_file() && env::var_os("__EGL_VENDOR_LIBRARY_FILENAMES").is_none() {
        unsafe { env::set_var("__EGL_VENDOR_LIBRARY_FILENAMES", mesa.as_os_str()) };
    }
    unsafe { env::set_var(RFF_LINUX_WEBVIEW_REEXEC, "1") };
    let Ok(exe) = env::current_exe() else {
        return;
    };
    let args: Vec<_> = env::args_os().skip(1).collect();
    let err = Command::new(exe).args(args).exec();
    // exec only returns on failure; continue with the current process.
    let _ = err;
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
        assert!(patch.set.iter().any(|(k, v)| k == "GSK_RENDERER" && v == "cairo"));
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
        assert!(keys.contains(&"GSK_RENDERER"));
        assert!(keys.contains(&"LIBGL_ALWAYS_SOFTWARE"));
        assert!(keys.contains(&"GALLIUM_DRIVER"));
        assert!(keys.contains(&"MESA_LOADER_DRIVER_OVERRIDE"));
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
                    | "GSK_RENDERER"
                    | "GALLIUM_DRIVER"
                    | "MESA_LOADER_DRIVER_OVERRIDE"
            )
        });
        assert_eq!(patch.set, vec![("GDK_BACKEND".into(), "x11".into())]);
        assert_eq!(patch.unset, vec!["WAYLAND_DISPLAY".to_string()]);
    }

    #[test]
    fn prefixed_ld_library_path_prepends_once() {
        assert_eq!(
            prefixed_ld_library_path(None, SYSTEM_GL_LIB_DIR),
            Some(SYSTEM_GL_LIB_DIR.to_string())
        );
        assert_eq!(
            prefixed_ld_library_path(Some("/opt/app/usr/lib"), SYSTEM_GL_LIB_DIR),
            Some(format!("{SYSTEM_GL_LIB_DIR}:/opt/app/usr/lib"))
        );
        assert_eq!(
            prefixed_ld_library_path(
                Some(&format!("{SYSTEM_GL_LIB_DIR}:/opt/app/usr/lib")),
                SYSTEM_GL_LIB_DIR
            ),
            None
        );
    }

    #[test]
    fn reexec_only_once_for_appimage_with_system_gl() {
        assert!(should_reexec_appimage_for_system_gl(
            true,
            false,
            true,
            Some("/tmp/.mount/usr/lib"),
            SYSTEM_GL_LIB_DIR
        ));
        assert!(!should_reexec_appimage_for_system_gl(
            true,
            true,
            true,
            Some("/tmp/.mount/usr/lib"),
            SYSTEM_GL_LIB_DIR
        ));
        assert!(!should_reexec_appimage_for_system_gl(
            false,
            false,
            true,
            Some("/tmp/.mount/usr/lib"),
            SYSTEM_GL_LIB_DIR
        ));
        assert!(!should_reexec_appimage_for_system_gl(
            true,
            false,
            false,
            Some("/tmp/.mount/usr/lib"),
            SYSTEM_GL_LIB_DIR
        ));
        assert!(!should_reexec_appimage_for_system_gl(
            true,
            false,
            true,
            Some(SYSTEM_GL_LIB_DIR),
            SYSTEM_GL_LIB_DIR
        ));
    }
}
