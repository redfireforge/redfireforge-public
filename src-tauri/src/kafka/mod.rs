//! Kafka integration module.
//!
//! Sub-modules:
//! - `types`      — contract types (input + output, aligned with contracts.ts)
//! - `envelope`   — response envelope helpers
//! - `config`     — rdkafka config builder + error classifiers
//! - `message`    — message conversion + consumer filter logic
//! - `lifecycle`  — Phase 9A commands (connect / disconnect / status / topics)
//! - `operations` — Phase 9B commands (produce / consume-once / subscribe / …)
//! - `commands`   — public re-export surface (keeps `kafka::commands::*` paths)
//! - `state`      — `KafkaState` + `ClientHandle` + `SubscriptionHandle`

pub mod commands;
pub mod config;
pub mod consume_assign;
pub mod envelope;
pub mod lifecycle;
pub mod message;
pub mod oauth;
pub mod operations;
pub mod state;
pub mod topic_groups;
pub mod types;
