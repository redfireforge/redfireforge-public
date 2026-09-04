//! Docker stack management — extraction (Phase 2) and Start/Stop (Phase 3).
//!
//! Tauri `generate_handler!` must name the module that owns each `#[tauri::command]`
//! (re-exports do not carry the command macros).

mod docker_bin;
pub mod extract;
pub mod images;
mod last_run;
mod limit;
pub mod lifecycle;
mod manifest;
mod ports;
pub mod prefetch;
pub mod prefs;
pub mod state;

pub use extract::extract_docker_resources_if_needed;
use prefetch::kill_prefetch_on_exit;
use prefs::read_stop_on_close;

use std::sync::atomic::{AtomicBool, Ordering};

static EXIT_CLEANUP_DONE: AtomicBool = AtomicBool::new(false);

/// Stop lesson stacks (if the quit toggle is on) and kill a mid-pull prefetch.
/// Safe to call from both `ExitRequested` and `Exit`.
pub fn on_app_exit(app: &tauri::AppHandle) {
    if EXIT_CLEANUP_DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    kill_prefetch_on_exit();
    if !read_stop_on_close(app) {
        return;
    }
    tauri::async_runtime::block_on(async {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            lifecycle::stop_rff_projects_for_quit(),
        )
        .await;
    });
}

#[cfg(test)]
mod extract_tests {
    use super::extract::{
        copy_dir_recursive, extraction_looks_complete, repo_docker_dir, stack_key_to_dir,
        EXTRACT_SENTINELS,
    };
    use super::manifest::ALL_STACK_KEYS;
    use std::fs;
    use std::path::{Path, PathBuf};

    #[test]
    fn stack_key_to_dir_covers_every_known_key() {
        assert_eq!(stack_key_to_dir("graphql"), Some("graphql"));
        assert_eq!(stack_key_to_dir("graphql-tls"), Some("graphql/tls"));
        assert_eq!(stack_key_to_dir("grpc"), Some("grpc"));
        assert_eq!(stack_key_to_dir("grpc-spring"), Some("grpc"));
        assert_eq!(stack_key_to_dir("kafka-plaintext"), Some("kafka/plaintext"));
        assert_eq!(stack_key_to_dir("kafka-secure"), Some("kafka/secure"));
        assert_eq!(stack_key_to_dir("kafka-tls"), Some("kafka/tls"));
        assert_eq!(stack_key_to_dir("kafka-schema-registry"), Some("kafka/schema-registry"));
        assert_eq!(stack_key_to_dir("ws-socketio"), Some("websocket/socketio"));
        assert_eq!(stack_key_to_dir("ws-graphql"), Some("websocket/graphql"));
        assert_eq!(stack_key_to_dir("ws-stomp"), Some("websocket/stomp"));
        assert_eq!(stack_key_to_dir("ws-tls"), Some("websocket"));
        assert_eq!(stack_key_to_dir("api-mock"), Some("api-mock"));
        assert_eq!(ALL_STACK_KEYS.len(), 13);
        assert_eq!(stack_key_to_dir("not-a-stack"), None);
        assert_eq!(stack_key_to_dir(".."), None);
        assert_eq!(stack_key_to_dir("../graphql"), None);
        assert_eq!(stack_key_to_dir("graphql/../../../tmp"), None);
    }

    #[test]
    fn copy_dir_recursive_skips_node_modules_and_target() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("rff-docker-stack-copy-{stamp}"));
        let src = root.join("src");
        let dst = root.join("dst");
        fs::create_dir_all(src.join("keep")).unwrap();
        fs::write(src.join("keep").join("ok.yml"), "ok: true\n").unwrap();
        fs::create_dir_all(src.join("node_modules").join("pkg")).unwrap();
        fs::write(src.join("node_modules").join("pkg").join("index.js"), "x").unwrap();
        fs::create_dir_all(src.join("target")).unwrap();
        fs::write(src.join("target").join("junk.yml"), "no\n").unwrap();
        fs::write(src.join(".DS_Store"), "skip").unwrap();
        fs::write(src.join(".bootstrap.yaml"), "hidden: true\n").unwrap();
        fs::write(src.join("last-run-graphql.log"), "do-not-copy\n").unwrap();

        copy_dir_recursive(&src, &dst).expect("copy");

        assert!(dst.join("keep").join("ok.yml").is_file());
        assert!(
            dst.join(".bootstrap.yaml").is_file(),
            "dotfiles like Kafka .bootstrap.yaml must be copied"
        );
        assert!(!dst.join("node_modules").exists());
        assert!(!dst.join("target").exists());
        assert!(!dst.join(".DS_Store").exists());
        assert!(
            !dst.join("last-run-graphql.log").exists(),
            "runtime last-run logs must not be copied from the bundle"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extraction_sentinels_require_every_stack_compose_file() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rff-docker-stack-sentinels-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        assert!(!extraction_looks_complete(&dir));
        for rel in EXTRACT_SENTINELS {
            let path = dir.join(rel);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, "x").unwrap();
        }
        assert!(extraction_looks_complete(&dir));
        fs::remove_file(dir.join("kafka/tls/.bootstrap.yaml")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        fs::write(dir.join("kafka/tls/.bootstrap.yaml"), "x").unwrap();
        fs::remove_file(dir.join("kafka/tls/docker-compose.yml")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        fs::write(dir.join("kafka/tls/docker-compose.yml"), "x").unwrap();
        fs::remove_file(dir.join("graphql/tls/certs/ca.crt")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        fs::write(dir.join("graphql/tls/certs/ca.crt"), "x").unwrap();
        fs::remove_file(dir.join("graphql/tls/certs/server.crt")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        fs::write(dir.join("graphql/tls/certs/server.crt"), "x").unwrap();
        fs::remove_file(dir.join("kafka/tls/certs/broker.key")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        fs::write(dir.join("kafka/tls/certs/broker.key"), "x").unwrap();
        fs::remove_file(dir.join("graphql/stack.json")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        fs::write(dir.join("graphql/stack.json"), "x").unwrap();
        fs::remove_file(dir.join("graphql/tls/docker-compose.mtls.yml")).unwrap();
        assert!(!extraction_looks_complete(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sentinels_include_tls_server_or_broker_material() {
        for rel in [
            "graphql/tls/certs/server.crt",
            "graphql/tls/certs/server.key",
            "graphql/tls/certs/client.key",
            "websocket/certs/server.crt",
            "websocket/certs/server.key",
            "websocket/certs/client.key",
            "grpc/certs/server.crt",
            "grpc/certs/server.key",
            "grpc/certs/client.key",
            "kafka/tls/certs/broker.crt",
            "kafka/tls/certs/broker.key",
        ] {
            assert!(
                EXTRACT_SENTINELS.contains(&rel),
                "EXTRACT_SENTINELS missing runtime TLS file {rel}"
            );
        }
        assert!(!EXTRACT_SENTINELS.iter().any(|rel| rel.ends_with("ca.key")));
    }

    #[test]
    fn sentinels_include_compose_bind_mounts() {
        for rel in [
            "graphql/tls/nginx-gql-tls.conf",
            "graphql/tls/nginx-gql-mtls.conf",
            "websocket/nginx-wss.conf",
            "websocket/nginx-mtls.conf",
            "grpc/envoy/envoy.yaml",
            "grpc/oauth-mock/server.mjs",
        ] {
            assert!(
                EXTRACT_SENTINELS.contains(&rel),
                "EXTRACT_SENTINELS missing bind-mount {rel}"
            );
        }
    }

    #[test]
    fn sentinels_include_build_dockerfiles() {
        for rel in [
            "graphql/Dockerfile",
            "api-mock/Dockerfile",
            "websocket/graphql/Dockerfile",
            "websocket/socketio/Dockerfile",
            "grpc/Dockerfile",
            "grpc/Dockerfile.mock",
            "grpc/spring-boot/Dockerfile",
        ] {
            assert!(
                EXTRACT_SENTINELS.contains(&rel),
                "EXTRACT_SENTINELS missing build Dockerfile {rel}"
            );
        }
    }

    #[test]
    fn sentinels_include_dockerfile_copy_sources() {
        for rel in [
            "graphql/package.json",
            "graphql/server.js",
            "api-mock/server.mjs",
            "websocket/graphql/package.json",
            "websocket/graphql/server.js",
            "websocket/socketio/package.json",
            "websocket/socketio/server.js",
            "grpc/proto/echo.proto",
            "grpc/proto/api.proto",
            "grpc/proto/eliza.proto",
            "grpc/go-server/go.mod",
            "grpc/go-server/main.go",
            "grpc/go-mock-server/go.mod",
            "grpc/go-mock-server/main.go",
            "grpc/go-mock-server/config/rules.json",
            "grpc/spring-boot/pom.xml",
            "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/GrpcSpringBootFixtureApplication.java",
            "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/EchoFixtureGrpcService.java",
            "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/HealthFixtureGrpcService.java",
            "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/BearerAuthServerInterceptor.java",
            "grpc/spring-boot/src/main/java/com/redfireforge/grpcfixture/EchoServletBridgeController.java",
            "grpc/spring-boot/src/main/resources/application.yml",
            "grpc/spring-boot/src/main/proto/echo.proto",
            "grpc/spring-boot/src/main/proto/health.proto",
        ] {
            assert!(
                EXTRACT_SENTINELS.contains(&rel),
                "EXTRACT_SENTINELS missing build COPY source {rel}"
            );
        }
    }

    #[test]
    fn sentinels_include_every_spring_boot_source() {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/grpc/spring-boot/src");
        assert!(src.is_dir(), "spring-boot src {src:?}");
        let mut files = Vec::new();
        fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
            for entry in fs::read_dir(dir).expect("read spring-boot src") {
                let path = entry.expect("entry").path();
                if path.is_dir() {
                    walk(&path, root, out);
                    continue;
                }
                let rel = path.strip_prefix(root).expect("rel");
                out.push(format!(
                    "grpc/spring-boot/src/{}",
                    rel.to_string_lossy().replace('\\', "/")
                ));
            }
        }
        walk(&src, &src, &mut files);
        assert!(!files.is_empty());
        for rel in &files {
            assert!(
                EXTRACT_SENTINELS.contains(&rel.as_str()),
                "EXTRACT_SENTINELS missing Spring COPY source {rel}"
            );
        }
    }

    #[test]
    fn sentinels_include_every_grpc_proto() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docker/grpc/proto");
        assert!(dir.is_dir(), "grpc proto {dir:?}");
        let mut found = 0;
        for entry in fs::read_dir(&dir).expect("read proto") {
            let name = entry.expect("entry").file_name();
            let name = name.to_string_lossy();
            if !name.ends_with(".proto") {
                continue;
            }
            found += 1;
            let rel = format!("grpc/proto/{name}");
            assert!(
                EXTRACT_SENTINELS.contains(&rel.as_str()),
                "EXTRACT_SENTINELS missing gRPC proto {rel}"
            );
        }
        assert!(found >= 3, "expected proto files, found {found}");
    }

    #[test]
    fn sentinels_include_every_stack_manifest() {
        for key in ALL_STACK_KEYS {
            let rel = if *key == "grpc-spring" {
                format!("{}/stack-spring.json", stack_key_to_dir(key).expect(key))
            } else {
                format!("{}/stack.json", stack_key_to_dir(key).expect(key))
            };
            assert!(
                EXTRACT_SENTINELS.contains(&rel.as_str()),
                "EXTRACT_SENTINELS missing {rel}"
            );
        }
    }

    #[test]
    fn repo_docker_dir_has_every_stack_and_sentinel() {
        let Some(dir) = repo_docker_dir() else {
            panic!("expected repo docker/ next to src-tauri");
        };
        assert!(extraction_looks_complete(&dir));
        for key in ALL_STACK_KEYS {
            let stack = dir.join(stack_key_to_dir(key).expect(key));
            assert!(stack.is_dir(), "{key} -> {stack:?}");
            let manifest = if *key == "grpc-spring" {
                stack.join("stack-spring.json")
            } else {
                stack.join("stack.json")
            };
            assert!(manifest.is_file(), "missing {manifest:?}");
        }
    }
}
