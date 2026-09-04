//! Concurrent stack slots (Phase 9). Pure rules — no Docker or AppHandle.

pub const MAX_CONCURRENT_STACKS: usize = 2;

pub fn slot_key(stack_key: &str) -> &str {
    match stack_key {
        "grpc" | "grpc-spring" => "grpc-family",
        other => other,
    }
}

/// `None` = start allowed. `Some("STACK_LIMIT:key1,key2")` = refuse.
pub fn stack_limit_error(starting: &str, running_keys: &[&str]) -> Option<String> {
    if running_keys.iter().any(|k| *k == starting) {
        return None;
    }
    let mut slots: Vec<&str> = Vec::new();
    for key in running_keys {
        let slot = slot_key(key);
        if !slots.contains(&slot) {
            slots.push(slot);
        }
    }
    if slots.len() >= MAX_CONCURRENT_STACKS && !slots.contains(&slot_key(starting)) {
        let mut payload: Vec<&str> = Vec::new();
        for key in running_keys {
            if !payload.contains(key) {
                payload.push(key);
            }
        }
        Some(format!("STACK_LIMIT:{}", payload.join(",")))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_one_unrelated_is_allowed() {
        assert_eq!(stack_limit_error("graphql", &[]), None);
        assert_eq!(stack_limit_error("kafka-plaintext", &["graphql"]), None);
    }

    #[test]
    fn same_key_overlay_is_allowed() {
        assert_eq!(
            stack_limit_error("graphql", &["graphql", "kafka-plaintext"]),
            None
        );
    }

    #[test]
    fn two_unrelated_blocks_a_third() {
        assert_eq!(
            stack_limit_error("ws-socketio", &["graphql", "kafka-plaintext"]),
            Some("STACK_LIMIT:graphql,kafka-plaintext".into())
        );
    }

    #[test]
    fn grpc_then_spring_shares_one_slot() {
        assert_eq!(stack_limit_error("grpc-spring", &["grpc"]), None);
        assert_eq!(slot_key("grpc"), slot_key("grpc-spring"));
    }

    #[test]
    fn overlay_sibling_allowed_when_two_slots_already_full() {
        assert_eq!(
            stack_limit_error("grpc-spring", &["grpc", "graphql"]),
            None
        );
    }

    #[test]
    fn new_grpc_family_blocked_when_two_other_slots_full() {
        assert_eq!(
            stack_limit_error("grpc-spring", &["graphql", "kafka-plaintext"]),
            Some("STACK_LIMIT:graphql,kafka-plaintext".into())
        );
    }

    #[test]
    fn grpc_family_plus_graphql_blocks_kafka() {
        assert_eq!(
            stack_limit_error("kafka-plaintext", &["grpc", "grpc-spring", "graphql"]),
            Some("STACK_LIMIT:grpc,grpc-spring,graphql".into())
        );
    }

    #[test]
    fn two_graphql_lessons_are_one_slot() {
        assert_eq!(stack_limit_error("graphql", &["graphql"]), None);
    }

    #[test]
    fn reserved_in_flight_keys_count_as_running() {
        assert_eq!(
            stack_limit_error("ws-socketio", &["graphql", "kafka-plaintext"]),
            Some("STACK_LIMIT:graphql,kafka-plaintext".into())
        );
        assert_eq!(
            stack_limit_error("kafka-plaintext", &["graphql"]),
            None
        );
    }

    #[test]
    fn payload_dedupes_duplicate_running_keys() {
        assert_eq!(
            stack_limit_error("ws-socketio", &["graphql", "graphql", "kafka-plaintext"]),
            Some("STACK_LIMIT:graphql,kafka-plaintext".into())
        );
    }
}
