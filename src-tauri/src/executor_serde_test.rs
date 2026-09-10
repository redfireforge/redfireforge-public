#[cfg(test)]
mod tests {
    use crate::executor_test_helpers::make_scenario;
    use crate::types::*;

    // ── Serde Round-Trip ─────────────────────────────────

    #[test]
    fn execution_plan_pool_serializes_camel_case_fields() {
        let plan = ExecutionPlan::Pool {
            scenarios: vec![],
            concurrency: 10,
            timeout_ms: 5000,
            retry_count: 2,
            retry_delay_ms: 100,
            think_time: ThinkTimeConfig::None,
            circuit_breaker: CircuitBreakerConfig::Continue,
            detail_level: DetailLevel::Full,
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains("timeoutMs"), "Expected camelCase: {json}");
        assert!(json.contains("retryCount"), "Expected camelCase: {json}");
        assert!(json.contains("retryDelayMs"), "Expected camelCase: {json}");
        assert!(json.contains("thinkTime"), "Expected camelCase: {json}");
        assert!(json.contains("circuitBreaker"), "Expected camelCase: {json}");
        assert!(!json.contains("timeout_ms"), "No snake_case: {json}");
        assert!(!json.contains("retry_count"), "No snake_case: {json}");
    }

    #[test]
    fn execution_plan_deserializes_from_js_camel_case() {
        let json = r#"{
            "mode": "pool",
            "scenarios": [],
            "concurrency": 5,
            "timeoutMs": 3000,
            "retryCount": 1,
            "retryDelayMs": 200,
            "thinkTime": { "type": "constant", "delayMs": 50 },
            "circuitBreaker": { "policy": "stop-first" }
        }"#;
        let plan: ExecutionPlan = serde_json::from_str(json).unwrap();
        match plan {
            ExecutionPlan::Pool { concurrency, timeout_ms, retry_count, .. } => {
                assert_eq!(concurrency, 5);
                assert_eq!(timeout_ms, 3000);
                assert_eq!(retry_count, 1);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn load_profile_deserializes_from_js_camel_case() {
        let json = r#"{
            "mode": "load-profile",
            "scenarios": [],
            "concurrency": 50,
            "durationSec": 120,
            "timeoutMs": 5000,
            "retryCount": 0,
            "retryDelayMs": 0,
            "thinkTime": { "type": "uniform", "minMs": 10, "maxMs": 100 },
            "circuitBreaker": { "policy": "stop-threshold", "maxErrors": 5, "maxErrorRate": 0.1, "minSampleSize": 20 },
            "profileType": "ramp-up",
            "rampUpSec": 30
        }"#;
        let plan: ExecutionPlan = serde_json::from_str(json).unwrap();
        match plan {
            ExecutionPlan::LoadProfile { duration_sec, profile_type, ramp_up_sec, .. } => {
                assert_eq!(duration_sec, 120);
                assert_eq!(profile_type, "ramp-up");
                assert_eq!(ramp_up_sec, Some(30));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn execution_plan_pool_roundtrip() {
        let plan = ExecutionPlan::Pool {
            scenarios: vec![make_scenario("a", Some(1.0))],
            concurrency: 10,
            timeout_ms: 5000,
            retry_count: 2,
            retry_delay_ms: 100,
            think_time: ThinkTimeConfig::Constant { delay_ms: 50 },
            circuit_breaker: CircuitBreakerConfig::StopFirst,
            detail_level: DetailLevel::Full,
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains(r#""mode":"pool""#));
        let parsed: ExecutionPlan = serde_json::from_str(&json).unwrap();
        match parsed {
            ExecutionPlan::Pool { concurrency, .. } => assert_eq!(concurrency, 10),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn execution_plan_sequential_roundtrip() {
        let plan = ExecutionPlan::Sequential {
            scenarios: vec![make_scenario("a", None)],
            timeout_ms: 3000,
            retry_count: 0,
            retry_delay_ms: 0,
            think_time: ThinkTimeConfig::None,
            circuit_breaker: CircuitBreakerConfig::Continue,
            detail_level: DetailLevel::Full,
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains(r#""mode":"sequential""#));
        let parsed: ExecutionPlan = serde_json::from_str(&json).unwrap();
        match parsed {
            ExecutionPlan::Sequential { timeout_ms, .. } => assert_eq!(timeout_ms, 3000),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn execution_plan_load_profile_roundtrip() {
        let plan = ExecutionPlan::LoadProfile {
            scenarios: vec![],
            concurrency: 50,
            duration_sec: 120,
            timeout_ms: 3000,
            retry_count: 0,
            retry_delay_ms: 0,
            think_time: ThinkTimeConfig::Uniform { min_ms: 10, max_ms: 100 },
            circuit_breaker: CircuitBreakerConfig::StopThreshold {
                max_errors: 5,
                max_error_rate: 0.1,
                min_sample_size: 20,
            },
            profile_type: "ramp-up".to_string(),
            ramp_up_sec: Some(30),
            spike_concurrency: None,
            spike_start_sec: None,
            spike_duration_sec: None,
            detail_level: DetailLevel::MetricsOnly,
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains(r#""mode":"load-profile""#));
        let parsed: ExecutionPlan = serde_json::from_str(&json).unwrap();
        match parsed {
            ExecutionPlan::LoadProfile { duration_sec, .. } => assert_eq!(duration_sec, 120),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn think_time_serde_roundtrip() {
        let configs = vec![
            ThinkTimeConfig::None,
            ThinkTimeConfig::Constant { delay_ms: 500 },
            ThinkTimeConfig::Uniform { min_ms: 10, max_ms: 100 },
            ThinkTimeConfig::Gaussian { mean_ms: 50, std_dev_ms: 10 },
        ];
        for c in &configs {
            let json = serde_json::to_string(c).unwrap();
            let parsed: ThinkTimeConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(
                serde_json::to_string(&parsed).unwrap(),
                json
            );
        }
    }

    #[test]
    fn think_time_serializes_camel_case() {
        let json = serde_json::to_string(&ThinkTimeConfig::Constant { delay_ms: 42 }).unwrap();
        assert!(json.contains("delayMs"), "Expected camelCase: {json}");
        assert!(!json.contains("delay_ms"), "No snake_case: {json}");

        let json2 = serde_json::to_string(&ThinkTimeConfig::Gaussian { mean_ms: 50, std_dev_ms: 10 }).unwrap();
        assert!(json2.contains("meanMs"), "Expected camelCase: {json2}");
        assert!(json2.contains("stdDevMs"), "Expected camelCase: {json2}");
    }

    #[test]
    fn breaker_config_serializes_camel_case() {
        let json = serde_json::to_string(&CircuitBreakerConfig::StopThreshold {
            max_errors: 5, max_error_rate: 0.1, min_sample_size: 20,
        }).unwrap();
        assert!(json.contains("maxErrors"), "Expected camelCase: {json}");
        assert!(json.contains("maxErrorRate"), "Expected camelCase: {json}");
        assert!(json.contains("minSampleSize"), "Expected camelCase: {json}");
    }

    #[test]
    fn breaker_config_serde_roundtrip() {
        let configs = vec![
            CircuitBreakerConfig::Continue,
            CircuitBreakerConfig::StopFirst,
            CircuitBreakerConfig::StopThreshold {
                max_errors: 10,
                max_error_rate: 0.25,
                min_sample_size: 50,
            },
        ];
        for c in &configs {
            let json = serde_json::to_string(c).unwrap();
            let parsed: CircuitBreakerConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(
                serde_json::to_string(&parsed).unwrap(),
                json
            );
        }
    }

    #[test]
    fn rust_scenario_serializes_to_camel_case() {
        let s = make_scenario("a", Some(2.0));
        let json = serde_json::to_string(&s).unwrap();
        // With rename_all = "camelCase", field should be featureGroupName, not feature_group_name
        assert!(json.contains("featureGroupName"), "Expected camelCase in JSON: {json}");
        assert!(json.contains("groupName"), "Expected camelCase in JSON: {json}");
        assert!(json.contains("dataRowId"), "Expected camelCase in JSON: {json}");
        assert!(!json.contains("feature_group_name"), "Should NOT have snake_case: {json}");
        assert!(!json.contains("group_name"), "Should NOT have snake_case: {json}");
        assert!(!json.contains("data_row_id"), "Should NOT have snake_case: {json}");
    }

    #[test]
    fn rust_scenario_serde_missing_optional_fields() {
        // JS may omit optional fields entirely — serde treats missing Option<T> as None
        let json = r#"{
            "id": "s1",
            "name": "test",
            "url": "http://example.com",
            "method": "GET",
            "headers": {}
        }"#;
        let s: RustScenario = serde_json::from_str(json).unwrap();
        assert_eq!(s.id, "s1");
        assert!(s.body.is_none());
        assert!(s.feature_group_name.is_none());
        assert!(s.weight.is_none());
        assert!(s.data_row_id.is_none());
        assert!(s.data_row_label.is_none());
    }

    #[test]
    fn rust_scenario_serde_with_optional_nulls() {
        let json = r#"{
            "id": "s1",
            "name": "test",
            "url": "http://example.com",
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": "{\"key\":1}",
            "featureGroupName": null,
            "groupName": null,
            "weight": null,
            "dataRowId": null,
            "dataRowLabel": null
        }"#;
        let s: RustScenario = serde_json::from_str(json).unwrap();
        assert_eq!(s.id, "s1");
        assert_eq!(s.method, "POST");
        assert!(s.feature_group_name.is_none());
        assert!(s.weight.is_none());
        assert_eq!(s.headers.get("content-type").unwrap(), "application/json");
        assert_eq!(s.body.as_deref(), Some("{\"key\":1}"));
    }

    #[test]
    fn execution_result_serializes_camel_case() {
        let result = ExecutionResult {
            id: "rr-0".into(),
            scenario_id: "s1".into(),
            scenario_name: "test".into(),
            feature_group_name: None,
            group_name: None,
            url: "http://example.com".into(),
            method: "GET".into(),
            http_status: 200,
            response_time_ms: 12.34,
            response_body: "".into(),
            response_headers: Default::default(),
            timestamp: 0,
            error_message: None,
            data_row_id: None,
            data_row_label: None,
            request_log: RequestLog { headers: Default::default(), body: None },
            timing: TimingBreakdown { dns_lookup: 0.0, tcp_connect: 0.0, tls_handshake: 0.0, ttfb: 0.0, download: 0.0, total: 0.0 },
            retry_count: 0,
            passed: None,
            failure_details: vec![],
            validation_mode: String::new(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("scenarioId"), "Expected camelCase: {json}");
        assert!(json.contains("httpStatus"), "Expected camelCase: {json}");
        assert!(json.contains("responseTimeMs"), "Expected camelCase: {json}");
        assert!(json.contains("responseBody"), "Expected camelCase: {json}");
        assert!(json.contains("errorMessage"), "Expected camelCase: {json}");
        assert!(json.contains("requestLog"), "Expected camelCase: {json}");
        assert!(json.contains("retryCount"), "Expected camelCase: {json}");
        assert!(!json.contains("scenario_id"), "No snake_case: {json}");
        assert!(!json.contains("http_status"), "No snake_case: {json}");
    }

    #[test]
    fn execution_result_serde_roundtrip() {
        let result = ExecutionResult {
            id: "rr-1".into(),
            scenario_id: "s1".into(),
            scenario_name: "test".into(),
            feature_group_name: Some("group".into()),
            group_name: None,
            url: "http://example.com".into(),
            method: "GET".into(),
            http_status: 200,
            response_time_ms: 12.34,
            response_body: "{\"ok\":true}".into(),
            response_headers: [("content-type".into(), "application/json".into())].into(),
            timestamp: 1234567890,
            error_message: None,
            data_row_id: Some("row-1".into()),
            data_row_label: Some("Row 1".into()),
            request_log: RequestLog {
                headers: Default::default(),
                body: None,
            },
            timing: TimingBreakdown {
                dns_lookup: 0.0,
                tcp_connect: 1.5,
                tls_handshake: 2.3,
                ttfb: 8.0,
                download: 4.34,
                total: 12.34,
            },
            retry_count: 1,
            passed: None,
            failure_details: vec![],
            validation_mode: String::new(),
        };
        let json = serde_json::to_string(&result).unwrap();
        let parsed: ExecutionResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.http_status, 200);
        assert_eq!(parsed.retry_count, 1);
        assert_eq!(parsed.feature_group_name.as_deref(), Some("group"));
    }

    #[test]
    fn progress_batch_serde_roundtrip() {
        let batch = ProgressBatch {
            completed: 5,
            total: 10,
            results: vec![],
            elapsed_ms: 1234.56,
            current_in_flight: 3,
            target_concurrency: 10,
            breaker_tripped: false,
            metrics: None,
            target_rps: None,
            actual_rps: None,
            dropped_requests: None,
        };
        let json = serde_json::to_string(&batch).unwrap();
        let parsed: ProgressBatch = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.completed, 5);
        assert_eq!(parsed.total, 10);
    }

    #[test]
    fn completion_summary_serde_roundtrip() {
        let summary = CompletionSummary {
            total_results: 42,
            duration_ms: 5000.0,
            breaker_tripped: true,
            final_metrics: None,
        };
        let json = serde_json::to_string(&summary).unwrap();
        let parsed: CompletionSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.total_results, 42);
        assert!(parsed.breaker_tripped);
    }

    #[test]
    fn progress_batch_deserializes_without_metrics_field() {
        let json = r#"{
            "completed": 10,
            "total": 50,
            "results": [],
            "elapsedMs": 500.0,
            "currentInFlight": 2,
            "targetConcurrency": 8,
            "breakerTripped": false
        }"#;
        let parsed: ProgressBatch = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.completed, 10);
        assert!(parsed.metrics.is_none());
    }

    #[test]
    fn completion_summary_deserializes_without_final_metrics() {
        let json = r#"{
            "totalResults": 100,
            "durationMs": 3000.0,
            "breakerTripped": false
        }"#;
        let parsed: CompletionSummary = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.total_results, 100);
        assert!(parsed.final_metrics.is_none());
    }

    #[test]
    fn progress_batch_metrics_none_omitted_from_json() {
        let batch = ProgressBatch {
            completed: 1,
            total: 1,
            results: vec![],
            elapsed_ms: 100.0,
            current_in_flight: 0,
            target_concurrency: 1,
            breaker_tripped: false,
            metrics: None,
            target_rps: None,
            actual_rps: None,
            dropped_requests: None,
        };
        let json = serde_json::to_string(&batch).unwrap();
        assert!(!json.contains("metrics"), "None metrics should be omitted: {json}");
    }

    #[test]
    fn completion_summary_final_metrics_none_omitted_from_json() {
        let summary = CompletionSummary {
            total_results: 0,
            duration_ms: 0.0,
            breaker_tripped: false,
            final_metrics: None,
        };
        let json = serde_json::to_string(&summary).unwrap();
        assert!(!json.contains("finalMetrics"), "None finalMetrics should be omitted: {json}");
    }

}
