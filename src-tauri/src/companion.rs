//! Companion sidecar lifecycle.
//!
//! The desktop app has no web server in front of it, so features that need the
//! Node companion (API Mock listeners, proxies, schedulers) require it to be
//! running. The bundled sidecar is started with the app and killed on exit.
//!
//! In `tauri dev` the developer usually already runs `npm run server:dev`; if
//! the port is occupied we adopt that instance instead of fighting over it.
//! Lesson Docker reachability does not use this sidecar — PrerequisiteGate
//! probes the service port with native HTTP so a stale or foreign occupant
//! of :3001 cannot lock Start Demo.

use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub const COMPANION_PORT: u16 = 3001;

#[derive(Default)]
pub struct CompanionState {
  child: Mutex<Option<CommandChild>>,
}

fn port_in_use(port: u16) -> bool {
  let addr: SocketAddr = ([127, 0, 0, 1], port).into();
  TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Spawn the bundled companion unless something is already serving the port.
pub fn start(app: &AppHandle) {
  if port_in_use(COMPANION_PORT) {
    log::info!("companion: port {COMPANION_PORT} already serving — reusing it");
    return;
  }

  let command = match app.shell().sidecar("redfireforge-companion") {
    Ok(c) => c
      .env("PORT", COMPANION_PORT.to_string())
      // Tells the companion to exit when our stdin pipe closes, so it cannot
      // outlive the app if we are killed without running a shutdown hook.
      .env("RF_SIDECAR", "1"),
    Err(e) => {
      log::error!("companion: sidecar not found: {e}");
      return;
    }
  };

  match command.spawn() {
    Ok((mut rx, child)) => {
      log::info!("companion: started on port {COMPANION_PORT}");
      if let Some(state) = app.try_state::<CompanionState>() {
        *state.child.lock().unwrap() = Some(child);
      }
      // Drain output so the pipe never fills and blocks the child.
      tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stderr(line) => {
              log::warn!("companion: {}", String::from_utf8_lossy(&line).trim_end())
            }
            CommandEvent::Terminated(payload) => {
              log::warn!("companion: exited ({:?})", payload.code);
              break;
            }
            _ => {}
          }
        }
      });
    }
    Err(e) => log::error!("companion: failed to spawn: {e}"),
  }
}

/// Kill the companion we spawned. Adopted instances are left alone.
pub fn stop(app: &AppHandle) {
  if let Some(state) = app.try_state::<CompanionState>() {
    if let Some(child) = state.child.lock().unwrap().take() {
      let _ = child.kill();
      log::info!("companion: stopped");
    }
  }
}
