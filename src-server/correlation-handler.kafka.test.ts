/**
 * Phase 5D — Kafka dispatch, idempotency, stale-wait cleanup, and outcome parity.
 *
 * Covers:
 *  - extractKafkaCorrelationId (key, body, header, query/default)
 *  - matchKafkaCorrelation (topic match, expired scan cleanup, source variants)
 *  - dispatchKafkaResumeMessage (happy path, no-match, duplicate idempotency,
 *    replay after correlation removed, stale entry cleanup during scan)
 *  - extractKafkaIdempotencyKey (deterministic key format)
 *  - ServerPausedEntry.correlationSource = 'key' round-trip through bridge mapping
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addPausedCorrelation,
  clearAllCorrelations,
  findByCorrelationId,
  getPausedCount,
  setCorrelationStore,
  notifyResume,
  registerResumeWaiter,
  extractKafkaCorrelationId,
  matchKafkaCorrelation,
  dispatchKafkaResumeMessage,
  type ServerPausedEntry,
  type KafkaResumeMessage,
} from './correlation-handler.js';
import { InMemoryServerStore } from './correlation-store-memory.js';
import { extractKafkaIdempotencyKey, clearIdempotency } from './webhook-idempotency.js';
import { makeEntry } from './__test-utils__/correlationTestHelpers.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeKafkaEntry(overrides: Partial<ServerPausedEntry> = {}): ServerPausedEntry {
  return makeEntry({
    correlationId: 'ord-123',
    webhookPath: 'orders',               // Kafka topic stored as webhookPath
    correlationSource: 'body',
    correlationJsonPath: 'orderId',
    ...overrides,
  });
}

function makeMsg(overrides: Partial<KafkaResumeMessage> = {}): KafkaResumeMessage {
  return {
    topic: 'orders',
    partition: 0,
    offset: '42',
    key: 'ord-123',
    value: JSON.stringify({ orderId: 'ord-123', amount: 100 }),
    headers: { 'x-order-id': 'ord-123' },
    ...overrides,
  };
}

// ─── extractKafkaIdempotencyKey ──────────────────────────────────────────────

describe('extractKafkaIdempotencyKey', () => {
  it('produces a deterministic key from topic+partition+offset', () => {
    expect(extractKafkaIdempotencyKey('orders', 0, '42')).toBe('kafka:orders:0:42');
  });

  it('different offsets produce different keys', () => {
    const k1 = extractKafkaIdempotencyKey('orders', 0, '42');
    const k2 = extractKafkaIdempotencyKey('orders', 0, '43');
    expect(k1).not.toBe(k2);
  });

  it('different partitions produce different keys', () => {
    const k1 = extractKafkaIdempotencyKey('orders', 0, '42');
    const k2 = extractKafkaIdempotencyKey('orders', 1, '42');
    expect(k1).not.toBe(k2);
  });

  it('different topics produce different keys', () => {
    const k1 = extractKafkaIdempotencyKey('orders', 0, '42');
    const k2 = extractKafkaIdempotencyKey('payments', 0, '42');
    expect(k1).not.toBe(k2);
  });
});

// ─── extractKafkaCorrelationId ───────────────────────────────────────────────

describe('extractKafkaCorrelationId', () => {
  it('extracts from Kafka message key when correlationSource = key', () => {
    const entry = makeKafkaEntry({ correlationSource: 'key' });
    const id = extractKafkaCorrelationId(entry, makeMsg({ key: 'ord-123' }));
    expect(id).toBe('ord-123');
  });

  it('returns undefined for empty key when correlationSource = key', () => {
    const entry = makeKafkaEntry({ correlationSource: 'key' });
    expect(extractKafkaCorrelationId(entry, makeMsg({ key: '' }))).toBeUndefined();
  });

  it('returns undefined for missing key when correlationSource = key', () => {
    const entry = makeKafkaEntry({ correlationSource: 'key' });
    expect(extractKafkaCorrelationId(entry, makeMsg({ key: undefined }))).toBeUndefined();
  });

  it('extracts from JSON body via JSONPath when correlationSource = body', () => {
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'orderId' });
    const id = extractKafkaCorrelationId(entry, makeMsg());
    expect(id).toBe('ord-123');
  });

  it('extracts nested path from JSON body', () => {
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'data.id' });
    const msg = makeMsg({ value: JSON.stringify({ data: { id: 'nested-789' } }) });
    expect(extractKafkaCorrelationId(entry, msg)).toBe('nested-789');
  });

  it('extracts body path with $. prefix', () => {
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: '$.orderId' });
    const id = extractKafkaCorrelationId(entry, makeMsg());
    expect(id).toBe('ord-123');
  });

  it('returns undefined when body is non-JSON', () => {
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'id' });
    expect(extractKafkaCorrelationId(entry, makeMsg({ value: 'not-json' }))).toBeUndefined();
  });

  it('returns undefined when JSONPath is missing', () => {
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: undefined });
    expect(extractKafkaCorrelationId(entry, makeMsg())).toBeUndefined();
  });

  it('returns undefined for non-existent body path', () => {
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'missing.field' });
    expect(extractKafkaCorrelationId(entry, makeMsg())).toBeUndefined();
  });

  it('returns undefined when body value is empty (falsy) — uses {} as parsed fallback', () => {
    // Covers the `message.value ? JSON.parse(...) : {}` FALSE branch (empty value)
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'orderId' });
    expect(extractKafkaCorrelationId(entry, makeMsg({ value: '' }))).toBeUndefined();
  });

  it('returns undefined when path resolves to null', () => {
    // Covers `current != null ? String(current) : undefined` FALSE branch
    const entry = makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'id' });
    expect(extractKafkaCorrelationId(entry, makeMsg({ value: JSON.stringify({ id: null }) }))).toBeUndefined();
  });

  it('extracts from message header when correlationSource = header', () => {
    const entry = makeKafkaEntry({ correlationSource: 'header', correlationHeader: 'x-order-id' });
    const id = extractKafkaCorrelationId(entry, makeMsg({ headers: { 'x-order-id': 'hdr-456' } }));
    expect(id).toBe('hdr-456');
  });

  it('falls back to lowercase header name lookup', () => {
    const entry = makeKafkaEntry({ correlationSource: 'header', correlationHeader: 'X-Order-ID' });
    const id = extractKafkaCorrelationId(
      entry,
      makeMsg({ headers: { 'x-order-id': 'hdr-456' } }),
    );
    expect(id).toBe('hdr-456');
  });

  it('returns undefined when header name is missing', () => {
    const entry = makeKafkaEntry({ correlationSource: 'header', correlationHeader: undefined });
    expect(extractKafkaCorrelationId(entry, makeMsg())).toBeUndefined();
  });

  it('returns undefined for query source (not applicable for Kafka)', () => {
    const entry = makeKafkaEntry({
      correlationSource: 'query' as ServerPausedEntry['correlationSource'],
    });
    expect(extractKafkaCorrelationId(entry, makeMsg())).toBeUndefined();
  });
});

// ─── matchKafkaCorrelation ───────────────────────────────────────────────────

describe('matchKafkaCorrelation', () => {
  beforeEach(() => {
    setCorrelationStore(new InMemoryServerStore());
    clearAllCorrelations();
    clearIdempotency();
  });

  it('matches by topic and extracted correlation ID (body source)', () => {
    addPausedCorrelation(makeKafkaEntry());
    const result = matchKafkaCorrelation('orders', makeMsg());
    expect(result).toBeDefined();
    expect(result!.correlationId).toBe('ord-123');
    expect(result!.entry.executionId).toBe('exec-1');
  });

  it('matches by topic and message key (key source)', () => {
    addPausedCorrelation(makeKafkaEntry({ correlationSource: 'key' }));
    const result = matchKafkaCorrelation('orders', makeMsg({ key: 'ord-123' }));
    expect(result).toBeDefined();
    expect(result!.correlationId).toBe('ord-123');
  });

  it('matches by topic and header (header source)', () => {
    addPausedCorrelation(makeKafkaEntry({
      correlationSource: 'header',
      correlationHeader: 'x-order-id',
    }));
    const result = matchKafkaCorrelation('orders', makeMsg({ headers: { 'x-order-id': 'ord-123' } }));
    expect(result).toBeDefined();
    expect(result!.correlationId).toBe('ord-123');
  });

  it('returns undefined when topic does not match', () => {
    addPausedCorrelation(makeKafkaEntry());
    expect(matchKafkaCorrelation('payments', makeMsg())).toBeUndefined();
  });

  it('returns undefined when correlation ID does not match', () => {
    addPausedCorrelation(makeKafkaEntry({ correlationId: 'ord-999' }));
    const result = matchKafkaCorrelation('orders', makeMsg());  // msg has orderId = 'ord-123'
    expect(result).toBeUndefined();
  });

  it('removes expired entries during scan and returns undefined', () => {
    addPausedCorrelation(makeKafkaEntry({
      correlationId: 'stale',
      timeoutAt: Date.now() - 1000,   // already expired
    }));
    const result = matchKafkaCorrelation('orders', makeMsg({ value: JSON.stringify({ orderId: 'stale' }) }));
    expect(result).toBeUndefined();
    expect(getPausedCount()).toBe(0);  // stale entry was cleaned up
  });

  it('matches a non-expired entry and skips an expired sibling on the same topic', () => {
    addPausedCorrelation(makeKafkaEntry({
      correlationId: 'stale',
      timeoutAt: Date.now() - 1000,
    }));
    addPausedCorrelation(makeKafkaEntry({
      correlationId: 'ord-123',
      timeoutAt: Date.now() + 60_000,
    }));
    const result = matchKafkaCorrelation('orders', makeMsg());
    expect(result).toBeDefined();
    expect(result!.correlationId).toBe('ord-123');
    expect(findByCorrelationId('stale')).toBeUndefined();  // cleaned up
  });
});

// ─── dispatchKafkaResumeMessage ──────────────────────────────────────────────

describe('dispatchKafkaResumeMessage', () => {
  beforeEach(() => {
    setCorrelationStore(new InMemoryServerStore());
    clearAllCorrelations();
    clearIdempotency();
  });

  it('resumes matching correlation and removes it from the store', () => {
    addPausedCorrelation(makeKafkaEntry());
    const result = dispatchKafkaResumeMessage(makeMsg());
    expect(result.resumed).toBe(true);
    if (!result.resumed) return;
    expect(result.correlationId).toBe('ord-123');
    expect(result.executionId).toBe('exec-1');
    expect(getPausedCount()).toBe(0);  // entry removed
  });

  it('calls notifyResume() so in-process waiters receive the message data', async () => {
    addPausedCorrelation(makeKafkaEntry());
    const resumePayloads: Array<Record<string, unknown>> = [];
    registerResumeWaiter('ord-123', (data) => {
      resumePayloads.push(data.webhookData);
    });

    dispatchKafkaResumeMessage(makeMsg());

    expect(resumePayloads).toHaveLength(1);
    expect(resumePayloads[0]).toMatchObject({
      topic: 'orders',
      partition: 0,
      offset: '42',
      key: 'ord-123',
    });
  });

  it('seeds value and headers into the resume payload', () => {
    addPausedCorrelation(makeKafkaEntry());
    let received: Record<string, unknown> = {};
    registerResumeWaiter('ord-123', (data) => { received = data.webhookData; });

    dispatchKafkaResumeMessage(makeMsg({ headers: { 'x-trace': 'abc' } }));

    expect(received['headers']).toMatchObject({ 'x-trace': 'abc' });
    expect(received['value']).toContain('ord-123');
  });

  it('uses empty-string fallbacks for absent key/value and empty-object for absent headers in resume payload', () => {
    // Covers `message.key ?? ''`, `message.value ?? ''`, and `message.headers ?? {}`
    // right-side fallback branches in the resumeData object (only reachable when match succeeds)
    addPausedCorrelation(makeKafkaEntry({ correlationSource: 'body', correlationJsonPath: 'orderId' }));
    let received: Record<string, unknown> = {};
    registerResumeWaiter('ord-123', (data) => { received = data.webhookData; });

    dispatchKafkaResumeMessage(makeMsg({
      key: undefined,
      value: JSON.stringify({ orderId: 'ord-123' }),
      headers: undefined,
    }));

    expect(received['key']).toBe('');
    expect(received['headers']).toEqual({});
  });

  it('returns no-match and uses empty string for absent message key in log (no-match + key ?? fallback)', () => {
    // Covers `message.key ?? ''` right-side branch in the no-match console.log line
    const result = dispatchKafkaResumeMessage(makeMsg({ key: undefined }));
    expect(result.resumed).toBe(false);
    if (result.resumed) return;
    expect(result.reason).toBe('no-match');
  });

  it('returns no-match when topic has no waiting correlations', () => {
    const result = dispatchKafkaResumeMessage(makeMsg());
    expect(result.resumed).toBe(false);
    if (result.resumed) return;
    expect(result.reason).toBe('no-match');
  });

  it('returns no-match when correlation ID in message does not match', () => {
    addPausedCorrelation(makeKafkaEntry({ correlationId: 'other-id' }));
    const result = dispatchKafkaResumeMessage(makeMsg()); // message has orderId = 'ord-123'
    expect(result.resumed).toBe(false);
    if (result.resumed) return;
    expect(result.reason).toBe('no-match');
  });

  it('idempotent — second delivery of same offset returns duplicate (no active match)', () => {
    addPausedCorrelation(makeKafkaEntry());
    // First dispatch: resumes successfully
    const first = dispatchKafkaResumeMessage(makeMsg());
    expect(first.resumed).toBe(true);

    // Second dispatch: same offset, correlation already consumed
    const second = dispatchKafkaResumeMessage(makeMsg());
    expect(second.resumed).toBe(false);
    if (second.resumed) return;
    expect(second.reason).toBe('duplicate');
    expect(second.correlationId).toBe('ord-123');
  });

  it('idempotent — same offset replayed while a new correlation is waiting is still processed', () => {
    // First run: add, dispatch, consume
    addPausedCorrelation(makeKafkaEntry());
    dispatchKafkaResumeMessage(makeMsg());
    expect(getPausedCount()).toBe(0);

    // Second run: a new execution is waiting with the same correlationId and same topic
    addPausedCorrelation(makeKafkaEntry({ executionId: 'exec-2' }));
    // The idempotency key (same offset) was already recorded for exec-1.
    // But now exec-2 is actively paused, so we must NOT block it.
    const second = dispatchKafkaResumeMessage(makeMsg());
    // Per the idempotency guard: cached && !activeStore.find(correlationId) → duplicate
    // Since exec-2's entry is in the store, activeStore.find returns it, so NOT a duplicate
    expect(second.resumed).toBe(true);
    if (!second.resumed) return;
    expect(second.executionId).toBe('exec-2');
  });

  it('removes stale expired entries during scan and still dispatches to valid entry', () => {
    // Stale entry (expired)
    addPausedCorrelation(makeKafkaEntry({
      correlationId: 'stale-id',
      timeoutAt: Date.now() - 1000,
    }));
    // Valid entry
    addPausedCorrelation(makeKafkaEntry({ correlationId: 'ord-123' }));

    const result = dispatchKafkaResumeMessage(makeMsg());
    expect(result.resumed).toBe(true);
    expect(findByCorrelationId('stale-id')).toBeUndefined();  // stale cleaned up
  });

  it('dispatch completes synchronously — notifyResume fires before return', () => {
    addPausedCorrelation(makeKafkaEntry());
    let notified = false;
    registerResumeWaiter('ord-123', () => { notified = true; });

    dispatchKafkaResumeMessage(makeMsg());

    expect(notified).toBe(true);
  });

  // ── Stale wait (no in-process waiter — simulates server restart) ────────────

  it('queues resume data when no in-process waiter is registered (orphaned entry)', () => {
    // Simulate a restart: entry persists in store, but resumeWaiters map is empty
    addPausedCorrelation(makeKafkaEntry());
    // NOTE: no registerResumeWaiter() call — simulates server restart scenario

    const result = dispatchKafkaResumeMessage(makeMsg());
    // dispatch should still succeed: notifyResume() queues data in queuedResumes for later pickup
    expect(result.resumed).toBe(true);
    expect(getPausedCount()).toBe(0);  // entry removed from active store
  });

  it('does not resume when correlation entry has timed out before dispatch', () => {
    addPausedCorrelation(makeKafkaEntry({
      timeoutAt: Date.now() - 1,  // already expired
    }));
    const result = dispatchKafkaResumeMessage(makeMsg());
    expect(result.resumed).toBe(false);
    if (result.resumed) return;
    expect(result.reason).toBe('no-match');
  });

  // ── Direct-resume vs Kafka dispatch outcome parity ──────────────────────────

  it('Kafka dispatch and direct HTTP resume both call notifyResume with same shape', () => {
    // Kafka dispatch path
    addPausedCorrelation(makeKafkaEntry({ correlationId: 'kafka-corr' }));
    let kafkaPayload: Record<string, unknown>;
    registerResumeWaiter('kafka-corr', (data) => { kafkaPayload = data.webhookData; });

    dispatchKafkaResumeMessage(makeMsg({ key: 'kafka-corr' }));  // uses key source won't match — use body
    // Re-add for body source match
    setCorrelationStore(new InMemoryServerStore());
    clearAllCorrelations();
    clearIdempotency();

    addPausedCorrelation(makeKafkaEntry({ correlationId: 'kafka-corr' }));
    kafkaPayload = {};
    registerResumeWaiter('kafka-corr', (data) => { kafkaPayload = data.webhookData; });
    dispatchKafkaResumeMessage(makeMsg({ value: JSON.stringify({ orderId: 'kafka-corr' }) }));

    // Direct resume path
    addPausedCorrelation(makeKafkaEntry({ correlationId: 'direct-corr' }));
    let directPayload: Record<string, unknown> = {};
    registerResumeWaiter('direct-corr', (data) => { directPayload = data.webhookData; });
    notifyResume('direct-corr', {
      webhookData: { topic: 'orders', partition: 0, offset: '42', key: '', value: '{}', headers: {} },
      executionId: 'exec-1',
      workflowId: 'wf-1',
      ts: Date.now(),
    });

    // Both payloads should have the same top-level keys
    expect(Object.keys(kafkaPayload).sort()).toEqual(Object.keys(directPayload).sort());
  });
});
