#[cfg(test)]
mod tests {
    use crate::types::*;

    // ── DetailLevel ─────────────────────────────────────────

    #[test]
    fn detail_level_default_is_full() {
        assert_eq!(DetailLevel::default(), DetailLevel::Full);
    }

    #[test]
    fn detail_level_serde_roundtrip() {
        for (level, expected_str) in [
            (DetailLevel::Full, "\"full\""),
            (DetailLevel::MetricsOnly, "\"metrics-only\""),
            (DetailLevel::Sampled, "\"sampled\""),
        ] {
            let json = serde_json::to_string(&level).unwrap();
            assert_eq!(json, expected_str);
            let parsed: DetailLevel = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, level);
        }
    }

    #[test]
    fn execution_plan_pool_without_detail_level_defaults_to_full() {
        let json = r#"{
            "mode": "pool",
            "scenarios": [],
            "concurrency": 5,
            "timeoutMs": 3000,
            "retryCount": 0,
            "retryDelayMs": 0,
            "thinkTime": { "type": "none" },
            "circuitBreaker": { "policy": "continue" }
        }"#;
        let plan: ExecutionPlan = serde_json::from_str(json).unwrap();
        match plan {
            ExecutionPlan::Pool { detail_level, .. } => assert_eq!(detail_level, DetailLevel::Full),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn execution_plan_pool_with_detail_level_sampled() {
        let json = r#"{
            "mode": "pool",
            "scenarios": [],
            "concurrency": 5,
            "timeoutMs": 3000,
            "retryCount": 0,
            "retryDelayMs": 0,
            "thinkTime": { "type": "none" },
            "circuitBreaker": { "policy": "continue" },
            "detailLevel": "sampled"
        }"#;
        let plan: ExecutionPlan = serde_json::from_str(json).unwrap();
        match plan {
            ExecutionPlan::Pool { detail_level, .. } => assert_eq!(detail_level, DetailLevel::Sampled),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn execution_plan_load_profile_with_metrics_only() {
        let json = r#"{
            "mode": "load-profile",
            "scenarios": [],
            "concurrency": 50,
            "durationSec": 60,
            "timeoutMs": 5000,
            "retryCount": 0,
            "retryDelayMs": 0,
            "thinkTime": { "type": "none" },
            "circuitBreaker": { "policy": "continue" },
            "profileType": "sustained",
            "detailLevel": "metrics-only"
        }"#;
        let plan: ExecutionPlan = serde_json::from_str(json).unwrap();
        match plan {
            ExecutionPlan::LoadProfile { detail_level, .. } => assert_eq!(detail_level, DetailLevel::MetricsOnly),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn execution_plan_detail_level_serialized_as_camel_case() {
        let plan = ExecutionPlan::Pool {
            scenarios: vec![],
            concurrency: 1,
            timeout_ms: 0,
            retry_count: 0,
            retry_delay_ms: 0,
            think_time: ThinkTimeConfig::None,
            circuit_breaker: CircuitBreakerConfig::Continue,
            detail_level: DetailLevel::Sampled,
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains("\"detailLevel\":\"sampled\""), "Expected detailLevel in JSON: {json}");
        assert!(!json.contains("detail_level"), "No snake_case: {json}");
    }

    // ── FinalResults ──────────────────────────────────────

    #[test]
    fn final_results_serde_roundtrip() {
        let fr = FinalResults { results: vec![] };
        let json = serde_json::to_string(&fr).unwrap();
        assert!(json.contains("\"results\":[]"));
        let parsed: FinalResults = serde_json::from_str(&json).unwrap();
        assert!(parsed.results.is_empty());
    }

}
