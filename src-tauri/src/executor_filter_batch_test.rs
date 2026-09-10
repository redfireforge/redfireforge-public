#[cfg(test)]
mod tests {
    use crate::executor_test_helpers::make_execution_result;
    use crate::types::*;

    // ── filter_batch ──────────────────────────────────────

    #[test]
    fn filter_batch_full_takes_all() {
        use crate::executor::filter_batch;
        let result = make_execution_result("rr-1");
        let mut batch = vec![result.clone(), result.clone(), result.clone()];
        let out = filter_batch(&DetailLevel::Full, &mut batch);
        assert_eq!(out.len(), 3);
        assert!(batch.is_empty());
    }

    #[test]
    fn filter_batch_metrics_only_returns_empty() {
        use crate::executor::filter_batch;
        let result = make_execution_result("rr-1");
        let mut batch = vec![result.clone(), result.clone()];
        let out = filter_batch(&DetailLevel::MetricsOnly, &mut batch);
        assert!(out.is_empty());
        assert!(batch.is_empty());
    }

    #[test]
    fn filter_batch_sampled_caps_at_10() {
        use crate::executor::filter_batch;
        let result = make_execution_result("rr-1");
        let mut batch: Vec<ExecutionResult> = (0..25).map(|_| result.clone()).collect();
        let out = filter_batch(&DetailLevel::Sampled, &mut batch);
        assert_eq!(out.len(), 10);
        assert!(batch.is_empty());
    }

    #[test]
    fn filter_batch_sampled_less_than_cap() {
        use crate::executor::filter_batch;
        let result = make_execution_result("rr-1");
        let mut batch = vec![result.clone(), result.clone(), result.clone()];
        let out = filter_batch(&DetailLevel::Sampled, &mut batch);
        assert_eq!(out.len(), 3);
        assert!(batch.is_empty());
    }

    #[test]
    fn progress_batch_with_metrics_roundtrip() {
        use crate::histogram::MetricsSnapshot;
        let batch = ProgressBatch {
            completed: 100,
            total: 100,
            results: vec![],
            elapsed_ms: 5000.0,
            current_in_flight: 0,
            target_concurrency: 10,
            breaker_tripped: false,
            metrics: Some(MetricsSnapshot {
                p50: 12.5, p95: 45.0, p99: 98.0, p999: 120.0,
                min: 1.0, max: 150.0, avg: 20.0,
                total: 100, errors: 5, tps: 20.0,
            }),
            target_rps: None,
            actual_rps: None,
            dropped_requests: None,
        };
        let json = serde_json::to_string(&batch).unwrap();
        assert!(json.contains("\"metrics\""));
        let parsed: ProgressBatch = serde_json::from_str(&json).unwrap();
        let m = parsed.metrics.unwrap();
        assert_eq!(m.total, 100);
        assert_eq!(m.errors, 5);
        assert!((m.p50 - 12.5).abs() < 0.01);
    }
}
