//! Consumer groups that have committed offsets on one topic.
//!
//! librdkafka's Rust wrapper does not expose ListConsumerGroups or
//! ListConsumerGroupOffsets, so this calls those admin APIs directly.
//! A group is included only when it has a committed offset on the topic.

use std::cell::Cell;
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use std::time::{Duration, Instant};

use rdkafka::bindings as rdsys;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdsys::rd_kafka_resp_err_t;

use super::oauth::AzureEventHubContext;
use super::types::KafkaTopicConsumerGroupSummary;

thread_local! {
    /// Set when an admin request is still running. The caller must keep the
    /// client alive; dropping it trips a librdkafka assertion.
    static ADMIN_STILL_RUNNING: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn admin_request_still_running() -> bool {
    ADMIN_STILL_RUNNING.get()
}

pub(super) fn clear_admin_request_flag() {
    ADMIN_STILL_RUNNING.set(false);
}

const LIST_TIMEOUT: Duration = Duration::from_secs(8);
const DESCRIBE_TIMEOUT: Duration = Duration::from_secs(8);
const OFFSET_TIMEOUT: Duration = Duration::from_secs(4);
const DESCRIBE_BATCH: usize = 80;
const OFFSET_PARALLEL: usize = 40;

/// Topic settings from DescribeConfigs. Empty when the cluster does not return any.
pub(super) fn topic_config(
    consumer: &BaseConsumer<AzureEventHubContext>,
    topic: &str,
) -> HashMap<String, String> {
    if topic.is_empty() {
        return HashMap::new();
    }
    match describe_topic_config(consumer, topic) {
        Ok(config) => config,
        Err(err) => {
            log::warn!("Kafka topic config failed for {topic}: {err}");
            HashMap::new()
        }
    }
}

fn describe_topic_config(
    consumer: &BaseConsumer<AzureEventHubContext>,
    topic: &str,
) -> Result<HashMap<String, String>, String> {
    let Ok(topic_c) = CString::new(topic) else {
        return Err("topic name is not valid".to_string());
    };
    let client = consumer.client().native_ptr();
    let resource = unsafe {
        rdsys::rd_kafka_ConfigResource_new(
            rdsys::rd_kafka_ResourceType_t::RD_KAFKA_RESOURCE_TOPIC,
            topic_c.as_ptr(),
        )
    };
    if resource.is_null() {
        return Err("could not describe topic config".to_string());
    }
    let queue = match admin_queue(client) {
        Ok(queue) => queue,
        Err(err) => {
            unsafe { rdsys::rd_kafka_ConfigResource_destroy(resource) };
            return Err(err);
        }
    };
    let options = match admin_options(
        client,
        rdsys::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DESCRIBECONFIGS,
        Duration::from_secs(8),
    ) {
        Ok(options) => options,
        Err(err) => {
            unsafe {
                rdsys::rd_kafka_ConfigResource_destroy(resource);
                rdsys::rd_kafka_queue_destroy(queue);
            }
            return Err(err);
        }
    };
    let mut resources = [resource];
    unsafe {
        rdsys::rd_kafka_DescribeConfigs(client, resources.as_mut_ptr(), 1, options, queue);
        rdsys::rd_kafka_ConfigResource_destroy(resource);
        rdsys::rd_kafka_AdminOptions_destroy(options);
    }
    let event = match poll_event(consumer, queue, Duration::from_secs(12), rdsys::RD_KAFKA_EVENT_DESCRIBECONFIGS_RESULT) {
        Ok(event) => event,
        Err(err) => return Err(err),
    };
    let result = unsafe { rdsys::rd_kafka_event_DescribeConfigs_result(event) };
    let config = if result.is_null() {
        HashMap::new()
    } else {
        configs_from_result(result)
    };
    unsafe {
        rdsys::rd_kafka_event_destroy(event);
        rdsys::rd_kafka_queue_destroy(queue);
    }
    Ok(config)
}

fn configs_from_result(result: *const rdsys::rd_kafka_DescribeConfigs_result_t) -> HashMap<String, String> {
    let mut count: usize = 0;
    let rows = unsafe { rdsys::rd_kafka_DescribeConfigs_result_resources(result, &mut count) };
    let mut config = HashMap::new();
    if rows.is_null() || count == 0 {
        return config;
    }
    let resource = unsafe { *rows };
    let error = unsafe { rdsys::rd_kafka_ConfigResource_error(resource) };
    if error != rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_NO_ERROR {
        log::warn!(
            "Kafka topic config resource error: {}",
            c_string(unsafe { rdsys::rd_kafka_ConfigResource_error_string(resource) })
        );
        return config;
    }
    let mut entry_count: usize = 0;
    let entries = unsafe { rdsys::rd_kafka_ConfigResource_configs(resource, &mut entry_count) };
    if entries.is_null() || entry_count == 0 {
        return config;
    }
    let entries = unsafe { std::slice::from_raw_parts(entries, entry_count) };
    for entry in entries {
        let name = c_string(unsafe { rdsys::rd_kafka_ConfigEntry_name(*entry) });
        let value = c_string(unsafe { rdsys::rd_kafka_ConfigEntry_value(*entry) });
        if name.is_empty() || value.is_empty() {
            continue;
        }
        config.insert(name, value);
    }
    config
}

pub(super) fn groups_for_topic(
    consumer: &BaseConsumer<AzureEventHubContext>,
    topic: &str,
    watermarks: &[(i32, i64)],
) -> Vec<KafkaTopicConsumerGroupSummary> {
    if watermarks.is_empty() {
        return Vec::new();
    }
    match list_groups_for_topic(consumer, topic, watermarks) {
        Ok(groups) => groups,
        Err(err) => {
            log::warn!("Kafka consumer group list failed for {topic}: {err}");
            Vec::new()
        }
    }
}

fn list_groups_for_topic(
    consumer: &BaseConsumer<AzureEventHubContext>,
    topic: &str,
    watermarks: &[(i32, i64)],
) -> Result<Vec<KafkaTopicConsumerGroupSummary>, String> {
    // A private reply queue, destroyed only after its result event arrives.
    // Destroying it sooner, or dropping the client while the request is still
    // in flight, trips a librdkafka assertion and kills the app.
    let client = consumer.client().native_ptr();
    let queue = admin_queue(client)?;
    let listings = match list_consumer_groups(consumer, queue) {
        Ok(listings) => listings,
        Err(err) => {
            if !admin_request_still_running() {
                unsafe { rdsys::rd_kafka_queue_destroy(queue) };
            }
            return Err(err);
        }
    };

    if !admin_request_still_running() {
        unsafe { rdsys::rd_kafka_queue_destroy(queue) };
    }
    let listed = listings.len();
    log::info!("Kafka topic {topic}: listed {listed} consumer groups");
    let mut assigned = Vec::new();
    for chunk in listings.chunks(DESCRIBE_BATCH) {
        if admin_request_still_running() {
            break;
        }
        match groups_assigned_to_topic(consumer, chunk, topic) {
            Ok(hits) => assigned.extend(hits),
            Err(err) => {
                log::warn!("Kafka topic {topic}: consumer group describe failed: {err}");
                if admin_request_still_running() {
                    break;
                }
            }
        }
    }
    log::info!("Kafka topic {topic}: {} groups are assigned to this topic", assigned.len());
    let mut groups = groups_with_topic_offsets(consumer, &assigned, topic, watermarks);
    let found: std::collections::HashSet<String> = groups.iter().map(|group| group.group_id.clone()).collect();
    for (group_id, state) in &assigned {
        if found.contains(group_id) {
            continue;
        }
        groups.push(KafkaTopicConsumerGroupSummary {
            group_id: group_id.clone(),
            state: state.clone(),
            total_lag: 0,
        });
    }
    log::info!("Kafka topic {topic}: showing {} consumer groups", groups.len());
    groups.sort_by(|left, right| left.group_id.cmp(&right.group_id));
    Ok(groups)
}

/// Groups in this batch whose members are assigned `topic`.
/// One describe call fans the batch out together, instead of an offset lookup per group.
fn groups_assigned_to_topic(
    consumer: &BaseConsumer<AzureEventHubContext>,
    groups: &[(String, String)],
    topic: &str,
) -> Result<Vec<(String, String)>, String> {
    if groups.is_empty() {
        return Ok(Vec::new());
    }
    let client = consumer.client().native_ptr();
    let names: Vec<CString> = groups
        .iter()
        .filter_map(|(group_id, _)| CString::new(group_id.as_str()).ok())
        .collect();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let queue = admin_queue(client)?;
    let mut ptrs: Vec<*const c_char> = names.iter().map(|name| name.as_ptr()).collect();
    let options = match admin_options(
        client,
        rdsys::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_DESCRIBECONSUMERGROUPS,
        DESCRIBE_TIMEOUT,
    ) {
        Ok(options) => options,
        Err(err) => {
            unsafe { rdsys::rd_kafka_queue_destroy(queue) };
            return Err(err);
        }
    };
    unsafe {
        rdsys::rd_kafka_DescribeConsumerGroups(client, ptrs.as_mut_ptr(), ptrs.len(), options, queue);
        rdsys::rd_kafka_AdminOptions_destroy(options);
    }
    let event = match poll_event(
        consumer,
        queue,
        DESCRIBE_TIMEOUT + Duration::from_secs(4),
        rdsys::RD_KAFKA_EVENT_DESCRIBECONSUMERGROUPS_RESULT,
    ) {
        Ok(event) => event,
        Err(err) => return Err(err),
    };
    let result = unsafe { rdsys::rd_kafka_event_DescribeConsumerGroups_result(event) };
    let assigned = if result.is_null() {
        Vec::new()
    } else {
        assigned_from_describe(result, topic)
    };
    unsafe {
        rdsys::rd_kafka_event_destroy(event);
        rdsys::rd_kafka_queue_destroy(queue);
    }
    Ok(assigned)
}

fn assigned_from_describe(
    result: *const rdsys::rd_kafka_DescribeConsumerGroups_result_t,
    topic: &str,
) -> Vec<(String, String)> {
    let mut count: usize = 0;
    let rows = unsafe { rdsys::rd_kafka_DescribeConsumerGroups_result_groups(result, &mut count) };
    if rows.is_null() || count == 0 {
        return Vec::new();
    }
    let rows = unsafe { std::slice::from_raw_parts(rows, count) };
    let mut assigned = Vec::new();
    for group in rows {
        let group = *group;
        let group_id = c_string(unsafe { rdsys::rd_kafka_ConsumerGroupDescription_group_id(group) });
        if group_id.is_empty() || !group_assignment_includes(group, topic) {
            continue;
        }
        let state_ptr = unsafe {
            rdsys::rd_kafka_consumer_group_state_name(rdsys::rd_kafka_ConsumerGroupDescription_state(group))
        };
        assigned.push((group_id, c_string(state_ptr)));
    }
    assigned
}

fn group_assignment_includes(group: *const rdsys::rd_kafka_ConsumerGroupDescription_t, topic: &str) -> bool {
    let members = unsafe { rdsys::rd_kafka_ConsumerGroupDescription_member_count(group) };
    for index in 0..members {
        let member = unsafe { rdsys::rd_kafka_ConsumerGroupDescription_member(group, index) };
        if member.is_null() {
            continue;
        }
        let assignment = unsafe { rdsys::rd_kafka_MemberDescription_assignment(member) };
        if assignment.is_null() {
            continue;
        }
        let partitions = unsafe { rdsys::rd_kafka_MemberAssignment_partitions(assignment) };
        if partitions.is_null() {
            continue;
        }
        let partitions = unsafe { &*partitions };
        if partitions.elems.is_null() || partitions.cnt <= 0 {
            continue;
        }
        let elems = unsafe { std::slice::from_raw_parts(partitions.elems, partitions.cnt as usize) };
        if elems.iter().any(|elem| c_string(elem.topic) == topic) {
            return true;
        }
    }
    false
}

struct PendingOffset {
    group_id: String,
    state: String,
    queue: *mut rdsys::rd_kafka_queue_t,
}

/// Committed-offset lookups for many groups at once.
/// Kafka UI shows every group that has committed this topic, and a namespace
/// can have hundreds of groups. One-at-a-time lookups never finish.
fn groups_with_topic_offsets(
    consumer: &BaseConsumer<AzureEventHubContext>,
    listings: &[(String, String)],
    topic: &str,
    watermarks: &[(i32, i64)],
) -> Vec<KafkaTopicConsumerGroupSummary> {
    let client = consumer.client().native_ptr();
    let mut groups = Vec::new();
    for chunk in listings.chunks(OFFSET_PARALLEL) {
        if admin_request_still_running() {
            break;
        }
        let mut pending = Vec::new();
        for (group_id, state) in chunk {
            match start_offset_lookup(client, group_id, state, topic, watermarks) {
                Ok(request) => pending.push(request),
                Err(err) => log::warn!("Kafka topic {topic}: offsets for group {group_id} failed: {err}"),
            }
        }
        let deadline = Instant::now() + OFFSET_TIMEOUT + Duration::from_secs(2);
        while !pending.is_empty() {
            let _ = consumer.poll(Duration::from_millis(20));
            let mut waiting = Vec::new();
            for request in pending {
                let event = unsafe { rdsys::rd_kafka_queue_poll(request.queue, 0) };
                if event.is_null() {
                    if Instant::now() >= deadline {
                        log::warn!("Kafka topic {topic}: offsets for group {} are still running", request.group_id);
                        ADMIN_STILL_RUNNING.set(true);
                        continue;
                    }
                    waiting.push(request);
                    continue;
                }
                let kind = unsafe { rdsys::rd_kafka_event_type(event) } as i32;
                if kind != rdsys::RD_KAFKA_EVENT_LISTCONSUMERGROUPOFFSETS_RESULT {
                    unsafe { rdsys::rd_kafka_event_destroy(event) };
                    waiting.push(request);
                    continue;
                }
                let result = unsafe { rdsys::rd_kafka_event_ListConsumerGroupOffsets_result(event) };
                if !result.is_null() {
                    if let Some(commits) = offsets_from_result(result) {
                        if let Some(total_lag) = lag_for_commits(watermarks, &commits) {
                            groups.push(KafkaTopicConsumerGroupSummary {
                                group_id: request.group_id.clone(),
                                state: request.state.clone(),
                                total_lag,
                            });
                        }
                    }
                }
                unsafe {
                    rdsys::rd_kafka_event_destroy(event);
                    rdsys::rd_kafka_queue_destroy(request.queue);
                }
            }
            pending = waiting;
        }
    }
    groups
}

fn start_offset_lookup(
    client: *mut rdsys::rd_kafka_t,
    group_id: &str,
    state: &str,
    topic: &str,
    watermarks: &[(i32, i64)],
) -> Result<PendingOffset, String> {
    let group_c = CString::new(group_id).map_err(|_| "group id is not valid".to_string())?;
    let topic_c = CString::new(topic).map_err(|_| "topic name is not valid".to_string())?;
    let queue = admin_queue(client)?;
    let partitions = unsafe { rdsys::rd_kafka_topic_partition_list_new(watermarks.len() as c_int) };
    if partitions.is_null() {
        unsafe { rdsys::rd_kafka_queue_destroy(queue) };
        return Err("could not build the partition list".to_string());
    }
    for (partition, _) in watermarks {
        unsafe {
            rdsys::rd_kafka_topic_partition_list_add(partitions, topic_c.as_ptr(), *partition);
        }
    }
    let request = unsafe { rdsys::rd_kafka_ListConsumerGroupOffsets_new(group_c.as_ptr(), partitions) };
    unsafe { rdsys::rd_kafka_topic_partition_list_destroy(partitions) };
    if request.is_null() {
        unsafe { rdsys::rd_kafka_queue_destroy(queue) };
        return Err("could not request committed offsets".to_string());
    }
    let options = match admin_options(
        client,
        rdsys::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_LISTCONSUMERGROUPOFFSETS,
        OFFSET_TIMEOUT,
    ) {
        Ok(options) => options,
        Err(err) => {
            unsafe {
                rdsys::rd_kafka_ListConsumerGroupOffsets_destroy(request);
                rdsys::rd_kafka_queue_destroy(queue);
            }
            return Err(err);
        }
    };
    let mut requests = [request];
    unsafe {
        rdsys::rd_kafka_ListConsumerGroupOffsets(client, requests.as_mut_ptr(), 1, options, queue);
        rdsys::rd_kafka_ListConsumerGroupOffsets_destroy(request);
        rdsys::rd_kafka_AdminOptions_destroy(options);
    }
    Ok(PendingOffset {
        group_id: group_id.to_string(),
        state: state.to_string(),
        queue,
    })
}

fn list_consumer_groups(
    consumer: &BaseConsumer<AzureEventHubContext>,
    queue: *mut rdsys::rd_kafka_queue_t,
) -> Result<Vec<(String, String)>, String> {
    let client = consumer.client().native_ptr();
    let options = admin_options(client, rdsys::rd_kafka_admin_op_t::RD_KAFKA_ADMIN_OP_LISTCONSUMERGROUPS, LIST_TIMEOUT)?;
    unsafe {
        rdsys::rd_kafka_ListConsumerGroups(client, options, queue);
        rdsys::rd_kafka_AdminOptions_destroy(options);
    }
    let event = poll_event(consumer, queue, LIST_TIMEOUT + Duration::from_secs(4), rdsys::RD_KAFKA_EVENT_LISTCONSUMERGROUPS_RESULT)?;
    let result = unsafe { rdsys::rd_kafka_event_ListConsumerGroups_result(event) };
    if result.is_null() {
        unsafe { rdsys::rd_kafka_event_destroy(event) };
        return Err("consumer group list returned no result".to_string());
    }
    let mut count: usize = 0;
    let rows = unsafe { rdsys::rd_kafka_ListConsumerGroups_result_valid(result, &mut count) };
    let mut listings = Vec::with_capacity(count);
    if !rows.is_null() {
        let slice = unsafe { std::slice::from_raw_parts(rows, count) };
        for row in slice {
            let id = c_string(unsafe { rdsys::rd_kafka_ConsumerGroupListing_group_id(*row) });
            if id.is_empty() {
                continue;
            }
            let state_ptr = unsafe {
                rdsys::rd_kafka_consumer_group_state_name(rdsys::rd_kafka_ConsumerGroupListing_state(*row))
            };
            listings.push((id, c_string(state_ptr)));
        }
    }
    unsafe { rdsys::rd_kafka_event_destroy(event) };
    Ok(listings)
}

fn offsets_from_result(result: *const rdsys::rd_kafka_ListConsumerGroupOffsets_result_t) -> Option<Vec<(i32, i64)>> {
    let mut count: usize = 0;
    let rows = unsafe { rdsys::rd_kafka_ListConsumerGroupOffsets_result_groups(result, &mut count) };
    if rows.is_null() || count == 0 {
        return None;
    }
    let group = unsafe { *rows };
    let error = unsafe { rdsys::rd_kafka_group_result_error(group) };
    if !error.is_null() {
        let code = unsafe { rdsys::rd_kafka_error_code(error) };
        if code != rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_NO_ERROR {
            return None;
        }
    }
    let list = unsafe { rdsys::rd_kafka_group_result_partitions(group) };
    if list.is_null() {
        return None;
    }
    let list = unsafe { &*list };
    if list.elems.is_null() || list.cnt <= 0 {
        return None;
    }
    let elems = unsafe { std::slice::from_raw_parts(list.elems, list.cnt as usize) };
    Some(elems.iter().map(|elem| (elem.partition, elem.offset)).collect())
}

fn admin_options(
    client: *mut rdsys::rd_kafka_t,
    op: rdsys::rd_kafka_admin_op_t,
    timeout: Duration,
) -> Result<*mut rdsys::rd_kafka_AdminOptions_t, String> {
    let options = unsafe { rdsys::rd_kafka_AdminOptions_new(client, op) };
    if options.is_null() {
        return Err("could not create admin options".to_string());
    }
    let mut err = [0u8; 256];
    let code = unsafe {
        rdsys::rd_kafka_AdminOptions_set_request_timeout(
            options,
            timeout.as_millis() as c_int,
            err.as_mut_ptr() as *mut c_char,
            err.len(),
        )
    };
    if code != rd_kafka_resp_err_t::RD_KAFKA_RESP_ERR_NO_ERROR {
        unsafe { rdsys::rd_kafka_AdminOptions_destroy(options) };
        return Err(c_string(err.as_ptr() as *const c_char));
    }
    Ok(options)
}

fn admin_queue(client: *mut rdsys::rd_kafka_t) -> Result<*mut rdsys::rd_kafka_queue_t, String> {
    let queue = unsafe { rdsys::rd_kafka_queue_new(client) };
    if queue.is_null() {
        return Err("could not open an admin queue".to_string());
    }
    Ok(queue)
}

/// Wait until the admin result is queued. The request timeout inside librdkafka
/// posts that result, including failures. The reply queue stays alive until then.
fn poll_event(
    consumer: &BaseConsumer<AzureEventHubContext>,
    queue: *mut rdsys::rd_kafka_queue_t,
    timeout: Duration,
    expected: i32,
) -> Result<*mut rdsys::rd_kafka_event_t, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let _ = consumer.poll(Duration::from_millis(20));
        let event = unsafe { rdsys::rd_kafka_queue_poll(queue, 50) };
        if !event.is_null() {
            let kind = unsafe { rdsys::rd_kafka_event_type(event) } as i32;
            if kind == expected {
                return Ok(event);
            }
            unsafe { rdsys::rd_kafka_event_destroy(event) };
        }
        if Instant::now() >= deadline {
            ADMIN_STILL_RUNNING.set(true);
            log::error!("Kafka admin request is still running; the client will stay open");
            return Err("timed out waiting for the cluster".to_string());
        }
    }
}

fn c_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
}

/// Sums lag for partitions with a real committed offset.
/// `None` means the group has not committed this topic.
pub(crate) fn lag_for_commits(watermarks: &[(i32, i64)], commits: &[(i32, i64)]) -> Option<i64> {
    let mut matched = false;
    let mut lag = 0i64;
    for (partition, offset) in commits {
        if *offset < 0 {
            continue;
        }
        let Some((_, high)) = watermarks.iter().find(|(id, _)| id == partition) else {
            continue;
        };
        matched = true;
        lag += (*high - *offset).max(0);
    }
    if matched { Some(lag) } else { None }
}

#[cfg(test)]
mod tests {
    use super::lag_for_commits;

    #[test]
    fn lag_sums_committed_partitions() {
        let watermarks = [(0, 100), (1, 40), (2, 10)];
        let commits = [(0, 90), (1, 40), (2, -1001)];
        assert_eq!(lag_for_commits(&watermarks, &commits), Some(10));
    }

    #[test]
    fn lag_is_absent_when_nothing_is_committed() {
        let watermarks = [(0, 100)];
        assert_eq!(lag_for_commits(&watermarks, &[(0, -1001)]), None);
    }
}
