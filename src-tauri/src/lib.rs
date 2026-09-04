pub mod assertion_evaluator;
mod arrival_executor;
mod commands;
mod companion;
mod graphql;
mod grpc;
mod kafka;
mod websocket;
mod api_mock;
mod docker_stack;
pub mod date_helpers;
pub mod histogram;
pub mod deep_compare;
mod executor_circuit;
mod executor_detail_level;
mod executor_think_time;
mod executor;
pub mod field_operator;
pub mod http_helpers;
pub mod json_path;
pub mod json_validator;
pub mod subset_match;
mod types;
pub mod validation_result;
pub mod validation_types;

#[cfg(test)]
mod assertion_evaluator_basic_test;
#[cfg(test)]
mod histogram_test;
#[cfg(test)]
mod assertion_evaluator_collection_test;
#[cfg(test)]
mod assertion_evaluator_test;
#[cfg(test)]
mod assertion_evaluator_test_helpers;
#[cfg(test)]
mod assertion_evaluator_value_test;
#[cfg(test)]
mod cross_module_test;
#[cfg(test)]
mod date_helpers_test;
#[cfg(test)]
mod deep_compare_test;
#[cfg(test)]
mod arrival_executor_test;
#[cfg(test)]
mod executor_test;
#[cfg(test)]
mod executor_test_helpers;
#[cfg(test)]
mod field_operator_test;
#[cfg(test)]
mod http_helpers_test;
#[cfg(test)]
mod json_path_test;
#[cfg(test)]
mod json_validator_test;
#[cfg(test)]
mod subset_match_test;
#[cfg(test)]
mod validation_result_test;
#[cfg(test)]
mod validation_types_test;

use commands::ExecutorState;
use grpc::lifecycle;
use grpc::state::GrpcState;
use kafka::state::KafkaState;
use tauri::Manager;
use websocket::state::WsState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Install a process-level rustls CryptoProvider (ring) before any TLS work.
  // rustls 0.23 panics on the first `wss://` handshake if no default provider
  // is installed and the enabled crypto crate features are ambiguous (both
  // `ring` and `aws-lc-rs` get unified in via tokio-tungstenite's rustls dep).
  // Installing explicitly here fixes native `wss://` connections.
  let _ = rustls::crypto::ring::default_provider().install_default();

  #[allow(unused_mut)] // `mut` is required when the `mcp-bridge` feature is enabled
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .manage(ExecutorState::new())
    .manage(KafkaState::new())
    .manage(WsState::new())
    .manage(GrpcState::new())
    .manage(api_mock::ApiMockNativeState::new())
    .invoke_handler(tauri::generate_handler![
      commands::start_load_test,
      commands::abort_load_test,
      commands::is_rust_executor_available,
      kafka::lifecycle::kafka_connect,
      kafka::lifecycle::kafka_disconnect,
      kafka::lifecycle::kafka_status,
      kafka::lifecycle::kafka_topics,
      kafka::operations::kafka_produce,
      kafka::operations::kafka_consume_once,
      kafka::operations::kafka_subscribe,
      kafka::operations::kafka_unsubscribe,
      kafka::operations::kafka_subscriptions,
      websocket::lifecycle::ws_connect,
      websocket::lifecycle::ws_disconnect,
      websocket::lifecycle::ws_status,
      websocket::operations::ws_send,
      websocket::operations::ws_ping,
      websocket::operations::ws_receive_next,
      graphql::http_fetch::gql_http_fetch,
      graphql::http_upload::gql_http_upload,
      grpc::unary::grpc_unary,
      grpc::unary::grpc_call_cancel,
      grpc::stream::grpc_stream_start,
      grpc::stream::grpc_stream_send,
      grpc::stream::grpc_stream_end,
      grpc::stream::grpc_stream_cancel,
      grpc::lifecycle::grpc_tab_cleanup,
      grpc::lifecycle::grpc_tab_events_attach,
      grpc::lifecycle::grpc_tab_events_detach,
      grpc::lifecycle::grpc_tab_heartbeat,
      grpc::diagnostics::grpc_native_diagnostics,
      grpc::mock_server::grpc_mock_listener_start,
      grpc::mock_server::grpc_mock_listener_stop,
      grpc::mock_server::grpc_mock_listener_status,
      grpc::mock_server::grpc_mock_listener_commit,
      grpc::mock_server::grpc_mock_listener_log,
      api_mock::commands::api_mock_listener_start,
      api_mock::commands::api_mock_listener_stop,
      api_mock::commands::api_mock_listener_restart,
      api_mock::commands::api_mock_listener_commit,
      api_mock::commands::api_mock_listener_status,
      api_mock::commands::api_mock_listener_transactions_query,
      api_mock::commands::api_mock_listener_transactions_clear,
      api_mock::commands::api_mock_listener_state,
      api_mock::commands::api_mock_listener_reset_state,
      api_mock::commands::api_mock_listener_diagnostics,
      api_mock::commands::api_mock_listener_recorded_drafts,
      api_mock::commands::api_mock_listener_recorded_drafts_ack,
      api_mock::commands::api_mock_listener_recorded_drafts_clear,
      api_mock::commands::api_mock_ports_next,
      api_mock::commands::api_mock_ports_probe,
      docker_stack::extract::get_docker_stack_path,
      docker_stack::state::check_docker_state,
      docker_stack::state::open_docker_desktop,
      docker_stack::lifecycle::get_stack_status,
      docker_stack::lifecycle::get_stack_manifest,
      docker_stack::lifecycle::start_docker_stack,
      docker_stack::lifecycle::stop_docker_stack,
      docker_stack::lifecycle::stop_all_stacks,
      docker_stack::lifecycle::check_stale_stacks,
      docker_stack::state::check_cert_expiry,
      docker_stack::state::get_docker_available_memory_mb,
      docker_stack::state::trigger_app_update_check,
      docker_stack::lifecycle::uninstall_cleanup,
      docker_stack::lifecycle::read_last_run_log,
      docker_stack::prefs::get_stop_on_close,
      docker_stack::prefs::set_stop_on_close,
      docker_stack::images::get_docker_image_sizes,
      docker_stack::images::remove_docker_images,
      docker_stack::prefs::get_prefetch_choice,
      docker_stack::prefs::set_prefetch_choice,
      docker_stack::prefetch::prefetch_docker_images,
      docker_stack::prefetch::cancel_prefetch,
      docker_stack::prefetch::is_prefetch_running,
    ]);

  #[cfg(debug_assertions)]
  {
    builder = builder.plugin(tauri_plugin_mcp_bridge::init());
  }

  builder
    .manage(companion::CompanionState::default())
    .setup(|app| {
      let grpc_state = app.state::<GrpcState>();
      lifecycle::start_orphan_supervisor(grpc_state.inner().clone());
      companion::start(app.handle());

      docker_stack::extract_docker_resources_if_needed(app.handle());

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        let state = window.state::<GrpcState>();
        lifecycle::shutdown_all(&state);
        let _ = grpc::mock_server::shutdown_all_mock_listeners();
        api_mock::shutdown_all_listeners(&window.state::<api_mock::ApiMockNativeState>());
        companion::stop(window.app_handle());
      }
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app_handle, event| {
      match event {
        tauri::RunEvent::ExitRequested { .. } => {
          docker_stack::on_app_exit(app_handle);
        }
        tauri::RunEvent::Exit => {
          let state = app_handle.state::<GrpcState>();
          lifecycle::shutdown_all(&state);
          let _ = grpc::mock_server::shutdown_all_mock_listeners();
          api_mock::shutdown_all_listeners(&app_handle.state::<api_mock::ApiMockNativeState>());
          companion::stop(app_handle);
          docker_stack::on_app_exit(app_handle);
        }
        _ => {}
      }
    });
}
