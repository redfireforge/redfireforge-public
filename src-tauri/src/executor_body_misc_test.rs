#[cfg(test)]
mod tests {
    use crate::types::*;

    // ── Body Capping ─────────────────────────────────────

    #[test]
    fn cap_body_short() {
        let short = "hello".to_string();
        assert_eq!(crate::executor::cap_body(&short), "hello");
    }

    #[test]
    fn cap_body_long() {
        let long = "x".repeat(5000);
        let capped = crate::executor::cap_body(&long);
        assert_eq!(capped.len(), 2000);
    }

    #[test]
    fn cap_body_exact_limit() {
        let exact = "x".repeat(2000);
        assert_eq!(crate::executor::cap_body(&exact).len(), 2000);
    }

    #[test]
    fn cap_body_empty() {
        assert_eq!(crate::executor::cap_body(""), "");
    }

    #[test]
    fn cap_body_multibyte_utf8() {
        // Each emoji is 4 bytes; 501 emojis = 2004 bytes > 2000
        let emojis = "🔥".repeat(501);
        let capped = crate::executor::cap_body(&emojis);
        // Must not panic, and must be valid UTF-8
        assert!(capped.len() <= 2000);
        assert!(capped.is_char_boundary(capped.len()));
        // Should be 500 emojis = 2000 bytes
        assert_eq!(capped.len(), 2000);
        assert_eq!(capped.chars().count(), 500);
    }

    #[test]
    fn cap_body_mixed_multibyte() {
        // 'é' is 2 bytes in UTF-8. 1001 of them = 2002 bytes
        let s = "é".repeat(1001);
        let capped = crate::executor::cap_body(&s);
        assert!(capped.len() <= 2000);
        // Should be 1000 chars = 2000 bytes
        assert_eq!(capped.len(), 2000);
    }

    // ── Response Time Rounding ───────────────────────────

    #[test]
    fn round_ms_precision() {
        use crate::executor::round_ms;
        assert_eq!(round_ms(1.2345), 1.23);
        assert_eq!(round_ms(1.235), 1.24);
        assert_eq!(round_ms(0.0), 0.0);
        assert_eq!(round_ms(100.0), 100.0);
        assert_eq!(round_ms(-0.005), -0.01); // negative edge
    }

    // ── Result Counter ───────────────────────────────────

    #[test]
    fn result_counter_reset_and_increment() {
        use crate::executor::reset_result_counter;
        reset_result_counter();
        // After reset, next IDs should start from 0
        let id1 = crate::executor::next_result_id();
        let id2 = crate::executor::next_result_id();
        assert!(id1.starts_with("rr-"));
        assert!(id2.starts_with("rr-"));
        // IDs should be sequential
        let n1: u64 = id1.strip_prefix("rr-").unwrap().parse().unwrap();
        let n2: u64 = id2.strip_prefix("rr-").unwrap().parse().unwrap();
        assert_eq!(n2, n1 + 1);
    }

    // ── Apply Think Time ─────────────────────────────────

    #[tokio::test]
    async fn apply_think_time_none_returns_immediately() {
        let cancel = tokio_util::sync::CancellationToken::new();
        let start = std::time::Instant::now();
        crate::executor::apply_think_time(&ThinkTimeConfig::None, &cancel).await;
        assert!(start.elapsed().as_millis() < 50);
    }

    #[tokio::test]
    async fn apply_think_time_cancelled_returns_immediately() {
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel();
        let start = std::time::Instant::now();
        crate::executor::apply_think_time(
            &ThinkTimeConfig::Constant { delay_ms: 5000 },
            &cancel,
        ).await;
        assert!(start.elapsed().as_millis() < 50);
    }

    #[tokio::test]
    async fn apply_think_time_constant_sleeps() {
        let cancel = tokio_util::sync::CancellationToken::new();
        let start = std::time::Instant::now();
        crate::executor::apply_think_time(
            &ThinkTimeConfig::Constant { delay_ms: 50 },
            &cancel,
        ).await;
        let elapsed = start.elapsed().as_millis();
        assert!(elapsed >= 40, "slept only {elapsed}ms");
        assert!(elapsed < 200, "slept too long: {elapsed}ms");
    }

    // ── Cap Body Edge Cases ───────────────────────────────

    #[test]
    fn cap_body_3byte_char_boundary() {
        // 'あ' is 3 bytes. 667*3=2001 bytes > 2000
        let s = "あ".repeat(667);
        let capped = crate::executor::cap_body(&s);
        assert!(capped.len() <= 2000);
        assert!(capped.is_char_boundary(capped.len()));
        // Should be 666 chars = 1998 bytes (backs off from 2000 which is mid-char)
        assert_eq!(capped.len(), 1998);
        assert_eq!(capped.chars().count(), 666);
    }

}
