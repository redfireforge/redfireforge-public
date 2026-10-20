//! One-shot consume that assigns partitions directly.
//!
//! librdkafka rejects `assign` when `group.id` is missing (`Local: Unknown group`).
//! The id is only there to satisfy that client. Partitions are still assigned
//! explicitly, the same way Kafka UI reads a topic, so this does not join or
//! rebalance a consumer group. Event Hubs uses `$Default`, which already exists.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use rdkafka::config::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::error::KafkaError;
use rdkafka::message::Message;
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};

use super::message::{consume_record_from_message, filter_narrows, matches_filter};
use super::oauth::{create_rdkafka_client, fetch_cluster_metadata, AzureEventHubContext};
use super::types::{
    KafkaConsumeRecord, KafkaConsumeResult, KafkaMessageFilter, KafkaSeekOffset,
};

/// How many newest records to inspect when a filter is set.
const FILTER_READ_LIMIT: usize = 5_000;

struct PartitionWindow {
    partition: i32,
    low: i64,
    high: i64,
    start: i64,
}

pub(super) fn consume_assigned(
    rdkafka_config: ClientConfig,
    group_id: &str,
    topic: &str,
    partition_filter: Option<i32>,
    from_beginning: bool,
    sort_desc: bool,
    seek_offsets: Option<Vec<KafkaSeekOffset>>,
    max_messages: usize,
    timeout_ms: u64,
    filter: Option<KafkaMessageFilter>,
) -> Result<KafkaConsumeResult, String> {
    let refresh_oauth = rdkafka_config
        .get("sasl.mechanism")
        .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
    // Azure sign-in plus Event Hubs offset lookup often takes longer than the
    // message-read timeout. Keep the user's timeout for the read, and give
    // setup at least 30s on OAUTHBEARER so the default 10s field still works.
    let setup_budget = consume_setup_budget(timeout_ms, refresh_oauth);
    let brokers = rdkafka_config
        .get("bootstrap.servers")
        .unwrap_or("")
        .to_string();
    let filtering = filter.as_ref().is_some_and(filter_narrows);
    // Latest normally reads only Max Messages. A body filter has to look further
    // back, or a match just outside that page never shows up. Topics always
    // asks for that wider scan; Consume must do the same for Oldest First.
    let wide_filter = wide_filter_scan(filtering, from_beginning, sort_desc);
    let read_limit = if wide_filter {
        max_messages.max(FILTER_READ_LIMIT)
    } else {
        max_messages
    };
    // librdkafka 2.12 ListOffsets includes a leader epoch, and a group id sends
    // the Azure token to the group coordinator, which then fails the handshake.
    // KafkaJS reads the page without joining that coordinator.
    if brokers.to_ascii_lowercase().contains(".servicebus.windows.net") {
        let page = super::event_hub_offsets::read_event_hub_page(
            &brokers,
            topic,
            from_beginning,
            read_limit,
            timeout_ms,
            partition_filter,
            seek_offsets.as_deref(),
        )?;
        let windows = page
            .windows
            .iter()
            .map(|(partition, low, high)| format!("{partition}:{low}-{high}"))
            .collect::<Vec<_>>()
            .join(", ");
        log::info!(
            "Event Hubs page for {topic}: {} messages ({windows})",
            page.messages.len()
        );
        return Ok(finish_page(
            page.windows,
            page.messages,
            page.timed_out,
            filter.as_ref(),
            sort_desc,
            max_messages,
        ));
    }

    // Partition metadata uses a client with no group.id. A group id redirects
    // librdkafka's main queue, and the Azure token refresh can miss that queue,
    // which surfaces as Broker transport failure before any message is read.
    let mut probe_cfg = rdkafka_config.clone();
    super::config::prepare_consumer_config(&mut probe_cfg);
    let probe: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&probe_cfg)?;
    let metadata = fetch_cluster_metadata(&probe, setup_budget, refresh_oauth)?;

    let topic_meta = metadata
        .topics()
        .iter()
        .find(|candidate| candidate.name() == topic)
        .ok_or_else(|| format!("Topic '{topic}' was not found on the cluster"))?;
    if let Some(err) = topic_meta.error() {
        return Err(format!("Topic '{topic}' is not readable: {err:?}"));
    }

    let partition_ids: Vec<i32> = topic_meta
        .partitions()
        .iter()
        .map(|partition| partition.id())
        .filter(|id| partition_filter.is_none_or(|wanted| wanted == *id))
        .collect();
    let mut windows = match read_watermarks(&probe, topic, &partition_ids, setup_budget) {
        Ok(measured) => measured,
        Err(err) => {
            log::warn!("{err}");
            partition_ids.iter().copied().map(unknown_window).collect()
        }
    };
    drop(probe);

    let explicit_seek = seek_offsets.is_some();
    apply_starts(&mut windows, from_beginning, sort_desc, seek_offsets, read_limit)?;
    // Event Hubs often reports 0,0 watermarks for a topic that has records.
    // Assigning Beginning / the tail still reads those records. A real empty
    // topic reaches partition EOF and returns nothing.
    let mut logical_read = !explicit_seek && !watermarks_have_records(&windows);

    let mut consumer_cfg = rdkafka_config;
    super::config::prepare_consumer_config(&mut consumer_cfg);
    consumer_cfg.set("group.id", group_id);
    consumer_cfg.set("enable.auto.commit", "false");
    consumer_cfg.set("enable.auto.offset.store", "false");
    consumer_cfg.set("enable.partition.eof", "true");
    let consumer: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&consumer_cfg)?;
    // Sign this reader in. Partitions are already known, so a transport error
    // here is not fatal; the read loop polls the same queue and can finish sign-in.
    if let Err(err) = fetch_cluster_metadata(&consumer, setup_budget, refresh_oauth) {
        log::warn!("Kafka consume reader is still connecting: {err}");
    }
    if logical_read {
        // OffsetTail asks for the same watermark query Event Hubs just reset,
        // and that failure shows up as "Message consumption error". Measure
        // offsets on this signed-in connection instead.
        match read_watermarks(&consumer, topic, &partition_ids, setup_budget) {
            Ok(measured) => {
                windows = measured;
                apply_starts(&mut windows, from_beginning, sort_desc, None, read_limit)?;
                logical_read = !watermarks_have_records(&windows);
            }
            Err(err) => log::warn!("{err}"),
        }
    }

    let readable: Vec<&PartitionWindow> = windows.iter().filter(|window| window.start < window.high).collect();
    if readable.is_empty() && !logical_read {
        return Ok(empty_result(false));
    }

    let mut assignment = TopicPartitionList::new();
    let mut expected_left: HashMap<i32, i64> = HashMap::new();
    if logical_read && !from_beginning {
        return Err(format!(
            "Could not read offsets for {topic}: the broker disconnected before sending them"
        ));
    }

    if logical_read {
        let offset = Offset::Beginning;
        for window in &windows {
            assignment
                .add_partition_offset(topic, window.partition, offset)
                .map_err(|err| err.to_string())?;
            // Unknown length. EOF, the read cap, or the timeout ends the read.
            expected_left.insert(window.partition, i64::MAX / 4);
        }
    } else {
        for window in &readable {
            assignment
                .add_partition_offset(topic, window.partition, Offset::Offset(window.start))
                .map_err(|err| err.to_string())?;
            expected_left.insert(window.partition, window.high - window.start);
        }
    }
    consumer.assign(&assignment).map_err(|err| err.to_string())?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
    let mut messages = Vec::new();
    let mut seen = 0usize;
    let mut timed_out = false;
    let mut last_disconnect: Option<String> = None;
    // Newest-first with a filter must read the whole window, then keep the
    // newest matches. Stopping at Max Messages would keep the oldest hits.
    let gather_window = wide_filter;
    let examine_limit = if logical_read { read_limit.max(1) } else { usize::MAX };
    while seen < examine_limit
        && (gather_window || messages.len() < max_messages)
        && expected_left.values().any(|left| *left > 0)
    {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            timed_out = true;
            break;
        }
        match consumer.poll(remaining.min(Duration::from_millis(250))) {
            None => continue,
            Some(Ok(message)) => {
                seen += 1;
                if let Some(left) = expected_left.get_mut(&message.partition()) {
                    *left = (*left - 1).max(0);
                }
                let record = consume_record_from_message(&message);
                if matches_filter(&record, filter.as_ref()) {
                    messages.push(record);
                }
            }
            Some(Err(KafkaError::PartitionEOF(id))) => {
                expected_left.insert(id, 0);
            }
            Some(Err(err)) => {
                let text = err.to_string();
                if is_retryable_broker_error(&text) {
                    log::warn!("Kafka consume is retrying after a broker disconnect: {text}");
                    last_disconnect = Some(text);
                    continue;
                }
                return Err(text);
            }
        }
    }

    if wide_filter || sort_desc {
        messages.sort_by(|left, right| {
            offset_number(&right.offset)
                .cmp(&offset_number(&left.offset))
                .then(left.partition.cmp(&right.partition))
        });
    }
    if messages.len() > max_messages {
        messages.truncate(max_messages);
    }
    if wide_filter && !sort_desc {
        messages.reverse();
    }

    if messages.is_empty() {
        if let Some(err) = last_disconnect {
            return Err(err);
        }
    }

    let (has_more, next_cursor) = desc_page(&messages, &windows, sort_desc);
    let count = messages.len();
    Ok(KafkaConsumeResult {
        message_count: count,
        messages,
        timed_out: timed_out && count < max_messages,
        has_more: Some(has_more),
        next_cursor,
    })
}

fn apply_starts(
    windows: &mut Vec<PartitionWindow>,
    from_beginning: bool,
    _sort_desc: bool,
    seek_offsets: Option<Vec<KafkaSeekOffset>>,
    max_messages: usize,
) -> Result<(), String> {
    if let Some(seeks) = seek_offsets {
        let mut by_partition = HashMap::new();
        for seek in seeks {
            let offset = seek.offset.parse::<i64>().map_err(|_| {
                format!(
                    "Offset '{}' on partition {} is not a number",
                    seek.offset, seek.partition
                )
            })?;
            by_partition.insert(seek.partition, offset);
        }
        windows.retain(|window| by_partition.contains_key(&window.partition));
        for window in windows.iter_mut() {
            window.start = by_partition[&window.partition].max(window.low);
        }
        return Ok(());
    }

    // Latest reads records already on the topic. Newest First only changes
    // display order, including when Start Position is Earliest. Waiting at
    // the high watermark returns nothing unless a new record arrives.
    if !from_beginning {
        let total = windows.iter().map(|window| (window.high - window.low).max(0)).sum::<i64>();
        for window in windows.iter_mut() {
            let available = (window.high - window.low).max(0);
            if total <= 0 || available <= 0 {
                window.start = window.high;
                continue;
            }
            let share = ((available as f64 / total as f64) * max_messages as f64).ceil() as i64;
            window.start = (window.high - share.max(1)).max(window.low);
        }
        return Ok(());
    }

    for window in windows.iter_mut() {
        window.start = window.low;
    }
    Ok(())
}

fn read_watermarks(
    consumer: &BaseConsumer<AzureEventHubContext>,
    topic: &str,
    partition_ids: &[i32],
    budget: Duration,
) -> Result<Vec<PartitionWindow>, String> {
    let deadline = Instant::now() + budget;
    let mut windows = Vec::with_capacity(partition_ids.len());
    for id in partition_ids {
        let mut last_error = format!("Could not read offsets for {topic} partition {id}");
        let mut read = None;
        while Instant::now() < deadline {
            // Pump the queue so an OAUTHBEARER refresh is applied before the
            // offset request. A blocking watermark call alone misses that queue.
            let _ = consumer.poll(Duration::from_millis(100));
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining < Duration::from_millis(400) {
                break;
            }
            match consumer.fetch_watermarks(topic, *id, remaining.min(Duration::from_secs(8))) {
                Ok((low, high)) => {
                    read = Some(PartitionWindow {
                        partition: *id,
                        low,
                        high,
                        start: low,
                    });
                    break;
                }
                Err(err) => {
                    last_error = format!("Could not read offsets for {topic} partition {id}: {err}");
                    log::warn!("{last_error}");
                }
            }
        }
        match read {
            Some(window) => windows.push(window),
            None => return Err(last_error),
        }
    }
    Ok(windows)
}

fn is_retryable_broker_error(message: &str) -> bool {
    let msg = message.to_lowercase();
    msg.contains("disconnected before response")
        || msg.contains("broker transport failure")
        || msg.contains("all broker connections are down")
        || msg.contains("connection refused")
}

fn finish_page(
    measured: Vec<(i32, i64, i64)>,
    messages: Vec<KafkaConsumeRecord>,
    timed_out: bool,
    filter: Option<&KafkaMessageFilter>,
    sort_desc: bool,
    max_messages: usize,
) -> KafkaConsumeResult {
    let (_, windows) = windows_from_offsets(measured, None);
    let mut messages: Vec<_> = messages
        .into_iter()
        .filter(|record| matches_filter(record, filter))
        .collect();
    if sort_desc {
        messages.sort_by(|left, right| {
            offset_number(&right.offset)
                .cmp(&offset_number(&left.offset))
                .then(left.partition.cmp(&right.partition))
        });
    }
    if messages.len() > max_messages {
        messages.truncate(max_messages);
    }
    let (has_more, next_cursor) = desc_page(&messages, &windows, sort_desc);
    let count = messages.len();
    KafkaConsumeResult {
        message_count: count,
        messages,
        timed_out: timed_out && count < max_messages,
        has_more: Some(has_more),
        next_cursor,
    }
}

fn windows_from_offsets(
    measured: Vec<(i32, i64, i64)>,
    partition_filter: Option<i32>,
) -> (Vec<i32>, Vec<PartitionWindow>) {
    let windows: Vec<PartitionWindow> = measured
        .into_iter()
        .filter(|(partition, _, _)| partition_filter.is_none_or(|wanted| wanted == *partition))
        .map(|(partition, low, high)| PartitionWindow {
            partition,
            low,
            high,
            start: low,
        })
        .collect();
    let partition_ids = windows.iter().map(|window| window.partition).collect();
    (partition_ids, windows)
}

fn unknown_window(partition: i32) -> PartitionWindow {
    PartitionWindow {
        partition,
        low: -1001,
        high: -1001,
        start: -1001,
    }
}

/// True when every partition looked empty or reported an invalid watermark.
fn watermarks_have_records(windows: &[PartitionWindow]) -> bool {
    windows.iter().any(|window| window.low >= 0 && window.high > window.start)
}

fn wide_filter_scan(filtering: bool, from_beginning: bool, sort_desc: bool) -> bool {
    filtering && (sort_desc || !from_beginning)
}

fn consume_setup_budget(timeout_ms: u64, oauth: bool) -> Duration {
    let requested = timeout_ms.max(1);
    let floor = if oauth { 30_000 } else { requested };
    Duration::from_millis(requested.max(floor))
}

fn desc_page(
    messages: &[KafkaConsumeRecord],
    windows: &[PartitionWindow],
    sort_desc: bool,
) -> (bool, Option<Vec<KafkaSeekOffset>>) {
    if !sort_desc || messages.is_empty() {
        return (false, None);
    }
    let lows: HashMap<i32, i64> = windows.iter().map(|window| (window.partition, window.low)).collect();
    let mut oldest: HashMap<i32, i64> = HashMap::new();
    for message in messages {
        let offset = offset_number(&message.offset);
        oldest
            .entry(message.partition)
            .and_modify(|current| *current = (*current).min(offset))
            .or_insert(offset);
    }
    let cursor: Vec<KafkaSeekOffset> = oldest
        .into_iter()
        .filter(|(partition, offset)| *offset > lows.get(partition).copied().unwrap_or(0))
        .map(|(partition, offset)| KafkaSeekOffset {
            partition,
            offset: offset.to_string(),
        })
        .collect();
    let has_more = !cursor.is_empty();
    (has_more, if has_more { Some(cursor) } else { None })
}

fn offset_number(offset: &str) -> i64 {
    offset.parse::<i64>().unwrap_or(0)
}

pub(super) fn stream_start_offset(from_beginning: bool) -> Offset {
    if from_beginning {
        Offset::Beginning
    } else {
        Offset::End
    }
}

/// Partition list for a live stream. Uses a client with no group id so the
/// Azure token refresh stays on the main queue.
pub(super) fn stream_partition_ids(
    rdkafka_config: ClientConfig,
    topic: &str,
    timeout: Duration,
) -> Result<Vec<i32>, String> {
    let mut probe_cfg = rdkafka_config;
    super::config::prepare_consumer_config(&mut probe_cfg);
    let refresh_oauth = probe_cfg
        .get("sasl.mechanism")
        .is_some_and(|mechanism| mechanism.eq_ignore_ascii_case("OAUTHBEARER"));
    let probe: BaseConsumer<AzureEventHubContext> = create_rdkafka_client(&probe_cfg)?;
    let metadata = fetch_cluster_metadata(&probe, timeout, refresh_oauth)?;
    let topic_meta = metadata
        .topics()
        .iter()
        .find(|candidate| candidate.name() == topic)
        .ok_or_else(|| format!("Topic '{topic}' was not found on the cluster"))?;
    if let Some(err) = topic_meta.error() {
        return Err(format!("Topic '{topic}' is not readable: {err:?}"));
    }
    Ok(topic_meta.partitions().iter().map(|partition| partition.id()).collect())
}

pub(super) fn build_stream_assignment(
    topic: &str,
    partitions: &[i32],
    from_beginning: bool,
) -> Result<TopicPartitionList, String> {
    if partitions.is_empty() {
        return Err(format!("Topic '{topic}' has no partitions"));
    }
    let mut assignment = TopicPartitionList::new();
    let offset = stream_start_offset(from_beginning);
    for id in partitions {
        assignment
            .add_partition_offset(topic, *id, offset)
            .map_err(|err| err.to_string())?;
    }
    Ok(assignment)
}

fn empty_result(timed_out: bool) -> KafkaConsumeResult {
    KafkaConsumeResult {
        message_count: 0,
        messages: Vec::new(),
        timed_out,
        has_more: Some(false),
        next_cursor: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(partition: i32, low: i64, high: i64) -> PartitionWindow {
        PartitionWindow {
            partition,
            low,
            high,
            start: low,
        }
    }

    #[test]
    fn desc_seek_splits_the_newest_share_across_partitions() {
        let mut windows = vec![window(0, 0, 100), window(1, 10, 30)];
        apply_starts(&mut windows, false, true, None, 10).unwrap();
        assert_eq!(windows[0].start, 91);
        assert_eq!(windows[1].start, 28);
    }

    #[test]
    fn desc_seek_on_an_empty_topic_does_not_read() {
        let mut windows = vec![window(0, 4, 4)];
        apply_starts(&mut windows, false, true, None, 50).unwrap();
        assert_eq!(windows[0].start, 4);
        assert!(!watermarks_have_records(&windows));
    }

    #[test]
    fn earliest_reads_from_the_low_watermark_even_when_newest_first() {
        let mut windows = vec![window(0, 5, 100)];
        apply_starts(&mut windows, true, true, None, 10).unwrap();
        assert_eq!(windows[0].start, 5);
        assert!(watermarks_have_records(&windows));
    }

    #[test]
    fn invalid_watermarks_still_need_a_read() {
        assert!(!watermarks_have_records(&[window(0, -1001, -1001)]));
    }

    #[test]
    fn event_hub_offsets_keep_the_requested_partition() {
        let (ids, windows) = windows_from_offsets(vec![(0, 10, 40), (1, 2, 9)], Some(1));
        assert_eq!(ids, vec![1]);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].low, 2);
        assert_eq!(windows[0].high, 9);
    }

    #[test]
    fn broker_disconnect_during_consume_is_retried() {
        assert!(is_retryable_broker_error(
            "Message consumption error: NetworkException (Broker: Broker disconnected before response received)"
        ));
        assert!(!is_retryable_broker_error("SASL authentication failed"));
    }

    #[test]
    fn latest_oldest_first_reads_records_already_on_the_topic() {
        let mut windows = vec![window(0, 0, 100)];
        apply_starts(&mut windows, false, false, None, 10).unwrap();
        assert_eq!(windows[0].start, 90);
    }

    #[test]
    fn latest_filter_scans_past_the_first_page() {
        assert!(wide_filter_scan(true, false, false));
        assert!(wide_filter_scan(true, false, true));
        assert!(!wide_filter_scan(false, false, false));
        assert!(!wide_filter_scan(true, true, false));
    }

    #[test]
    fn oauth_setup_keeps_a_short_timeout_from_failing_sign_in() {
        assert_eq!(consume_setup_budget(10_000, true), Duration::from_millis(30_000));
        assert_eq!(consume_setup_budget(100_000, true), Duration::from_millis(100_000));
        assert_eq!(consume_setup_budget(10_000, false), Duration::from_millis(10_000));
    }

    #[test]
    fn live_stream_starts_at_the_end_unless_earliest_is_requested() {
        let latest = build_stream_assignment("offers", &[0, 2], false).unwrap();
        assert_eq!(latest.count(), 2);
        assert_eq!(latest.find_partition("offers", 0).unwrap().offset(), Offset::End);
        assert_eq!(latest.find_partition("offers", 2).unwrap().offset(), Offset::End);

        let earliest = build_stream_assignment("offers", &[1], true).unwrap();
        assert_eq!(earliest.find_partition("offers", 1).unwrap().offset(), Offset::Beginning);
    }

    #[test]
    fn live_stream_refuses_a_topic_with_no_partitions() {
        let err = build_stream_assignment("offers", &[], false).unwrap_err();
        assert!(err.contains("no partitions"));
    }

    #[test]
    fn explicit_seek_keeps_only_requested_partitions() {
        let mut windows = vec![window(0, 0, 10), window(1, 0, 10)];
        apply_starts(
            &mut windows,
            false,
            false,
            Some(vec![KafkaSeekOffset {
                partition: 1,
                offset: "3".to_string(),
            }]),
            10,
        )
        .unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].partition, 1);
        assert_eq!(windows[0].start, 3);
    }
}
