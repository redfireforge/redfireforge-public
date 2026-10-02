import { describe, it, expect } from 'vitest';
import {
  validateAndFormatJson,
  validateBase64,
  validateHex,
  parseHeaderMatch,
  headersToRecord,
  buildConsumeFilter,
  buildPublishRequest,
  buildConsumeRequest,
  buildSubscribeRequest,
  matchesKafkaResultSearch,
  valuePreview,
} from './kafkaMessageStudioUtils';
import type { KafkaConsumeDraft, KafkaPublishDraft } from './types';

// ── matchesKafkaResultSearch ───────────────────────────────────────────────

describe('matchesKafkaResultSearch', () => {
  const row = {
    offset: '102',
    partition: 0,
    key: 'order-42',
    value: '{"status":"CREATED","id":7}',
  };

  it('matches everything when query is blank', () => {
    expect(matchesKafkaResultSearch(row, '')).toBe(true);
    expect(matchesKafkaResultSearch(row, '   ')).toBe(true);
  });

  it('matches offset, partition, key, and value (case-insensitive)', () => {
    expect(matchesKafkaResultSearch(row, '102')).toBe(true);
    expect(matchesKafkaResultSearch(row, 'ORDER-42')).toBe(true);
    expect(matchesKafkaResultSearch(row, 'created')).toBe(true);
    expect(matchesKafkaResultSearch(row, '0')).toBe(true);
  });

  it('honors match case when requested', () => {
    expect(matchesKafkaResultSearch(row, 'created', true)).toBe(false);
    expect(matchesKafkaResultSearch(row, 'CREATED', true)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesKafkaResultSearch(row, 'zzzz-missing')).toBe(false);
  });

  it('treats missing key as empty string', () => {
    expect(matchesKafkaResultSearch({ ...row, key: undefined }, 'order')).toBe(false);
    expect(matchesKafkaResultSearch({ ...row, key: undefined }, 'CREATED')).toBe(true);
  });
});

// ── validateAndFormatJson ──────────────────────────────────────────────────

describe('validateAndFormatJson', () => {
  it('returns ok:true + formatted:empty for blank input', () => {
    expect(validateAndFormatJson('')).toEqual({ ok: true, formatted: '' });
    expect(validateAndFormatJson('   ')).toEqual({ ok: true, formatted: '' });
  });

  it('parses and pretty-prints valid JSON object', () => {
    const result = validateAndFormatJson('{"a":1,"b":2}');
    expect(result.ok).toBe(true);
    expect(result.formatted).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  it('parses and pretty-prints valid JSON array', () => {
    const result = validateAndFormatJson('[1,2,3]');
    expect(result.ok).toBe(true);
    expect(result.formatted).toBe(JSON.stringify([1, 2, 3], null, 2));
  });

  it('returns ok:false for invalid JSON', () => {
    const result = validateAndFormatJson('{bad json}');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.formatted).toBeUndefined();
  });

  it('returns ok:false for partial JSON', () => {
    const result = validateAndFormatJson('{"a":');
    expect(result.ok).toBe(false);
  });
});

// ── parseHeaderMatch ───────────────────────────────────────────────────────

describe('parseHeaderMatch', () => {
  it('returns undefined for blank input', () => {
    expect(parseHeaderMatch('')).toBeUndefined();
    expect(parseHeaderMatch('  ')).toBeUndefined();
  });

  it('returns undefined when no = separator', () => {
    expect(parseHeaderMatch('noequals')).toBeUndefined();
  });

  it('returns undefined when key is empty (=value)', () => {
    expect(parseHeaderMatch('=value')).toBeUndefined();
  });

  it('parses key=value correctly', () => {
    expect(parseHeaderMatch('source=checkout')).toEqual({ source: 'checkout' });
  });

  it('trims key and value', () => {
    expect(parseHeaderMatch(' source = checkout ')).toEqual({ source: 'checkout' });
  });

  it('handles value with = in it', () => {
    expect(parseHeaderMatch('k=v=extra')).toEqual({ k: 'v=extra' });
  });
});

// ── headersToRecord ────────────────────────────────────────────────────────

describe('headersToRecord', () => {
  it('returns undefined for empty array', () => {
    expect(headersToRecord([])).toBeUndefined();
  });

  it('returns undefined when all rows are disabled', () => {
    expect(headersToRecord([
      { id: '1', key: 'k', value: 'v', enabled: false },
    ])).toBeUndefined();
  });

  it('returns undefined when all enabled rows have blank keys', () => {
    expect(headersToRecord([
      { id: '1', key: '  ', value: 'v', enabled: true },
    ])).toBeUndefined();
  });

  it('includes only enabled rows with non-blank keys', () => {
    const result = headersToRecord([
      { id: '1', key: 'a', value: '1', enabled: true },
      { id: '2', key: 'b', value: '2', enabled: false },
      { id: '3', key: '', value: '3', enabled: true },
    ]);
    expect(result).toEqual({ a: '1' });
  });

  it('trims keys', () => {
    expect(headersToRecord([
      { id: '1', key: ' x ', value: 'y', enabled: true },
    ])).toEqual({ x: 'y' });
  });
});

// ── buildConsumeFilter ─────────────────────────────────────────────────────

function baseDraft(): KafkaConsumeDraft {
  return {
    topic: 'test', groupId: 'g', startPosition: 'latest',
    timeoutMs: '10000', maxMessages: '50',
    keyEquals: '', headerMatch: '', jsonPath: '', jsonPathEquals: '',
  };
}

describe('buildConsumeFilter', () => {
  it('returns undefined when no filter fields set', () => {
    expect(buildConsumeFilter(baseDraft())).toBeUndefined();
  });

  it('includes keyEquals', () => {
    const f = buildConsumeFilter({ ...baseDraft(), keyEquals: 'my-key' });
    expect(f).toEqual({ keyEquals: 'my-key' });
  });

  it('includes headersMatch from headerMatch string', () => {
    const f = buildConsumeFilter({ ...baseDraft(), headerMatch: 'source=checkout' });
    expect(f).toEqual({ headersMatch: { source: 'checkout' } });
  });

  it('includes jsonPath and jsonEquals', () => {
    const f = buildConsumeFilter({ ...baseDraft(), jsonPath: '$.status', jsonPathEquals: 'CREATED' });
    expect(f).toEqual({ jsonPath: '$.status', jsonEquals: 'CREATED' });
  });

  it('omits jsonEquals when blank (assert path exists)', () => {
    const f = buildConsumeFilter({ ...baseDraft(), jsonPath: '$.status', jsonPathEquals: '' });
    expect(f).toEqual({ jsonPath: '$.status' });
  });

  it('combines all filters', () => {
    const f = buildConsumeFilter({
      ...baseDraft(),
      keyEquals: 'k',
      headerMatch: 'h=v',
      jsonPath: '$.a',
      jsonPathEquals: 'b',
    });
    expect(f).toEqual({ keyEquals: 'k', headersMatch: { h: 'v' }, jsonPath: '$.a', jsonEquals: 'b' });
  });
});

// ── buildPublishRequest ────────────────────────────────────────────────────

function basePublishDraft(): KafkaPublishDraft {
  return {
    topic: 'orders.events', key: '', keyFormat: 'string', partition: '', acks: -1,
    timeoutMs: '', headers: [], body: '{"hello":"world"}', bodyFormat: 'json',
  };
}

describe('buildPublishRequest', () => {
  it('includes required fields', () => {
    const req = buildPublishRequest(basePublishDraft(), 'cluster-a');
    expect(req.clusterId).toBe('cluster-a');
    expect(req.topic).toBe('orders.events');
    expect(req.acks).toBe(-1);
    expect(Array.isArray(req.messages)).toBe(true);
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].value).toBe('{"hello":"world"}');
  });

  it('omits key when blank', () => {
    const req = buildPublishRequest(basePublishDraft(), 'c');
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].key).toBeUndefined();
  });

  it('includes key when set', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), key: 'order-123' }, 'c');
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].key).toBe('order-123');
  });

  it('includes explicit partition', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), partition: '2' }, 'c');
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].partition).toBe(2);
  });

  it('omits partition when blank', () => {
    const req = buildPublishRequest(basePublishDraft(), 'c');
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].partition).toBeUndefined();
  });

  it('includes timeoutMs when set', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), timeoutMs: '5000' }, 'c');
    expect(req.timeoutMs).toBe(5000);
  });

  it('omits timeoutMs when blank', () => {
    const req = buildPublishRequest(basePublishDraft(), 'c');
    expect(req.timeoutMs).toBeUndefined();
  });

  it('includes headers', () => {
    const draft = {
      ...basePublishDraft(),
      headers: [{ id: '1', key: 'x-src', value: 'test', enabled: true }],
    };
    const req = buildPublishRequest(draft, 'c');
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].headers).toEqual({ 'x-src': 'test' });
  });

  it('omits headers when all disabled', () => {
    const draft = {
      ...basePublishDraft(),
      headers: [{ id: '1', key: 'x', value: 'y', enabled: false }],
    };
    const req = buildPublishRequest(draft, 'c');
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].headers).toBeUndefined();
  });

  it('includes schemaConfig when set', () => {
    const draft = {
      ...basePublishDraft(),
      schemaConfig: { registryUrl: 'http://localhost:8085', format: 'avro' as const },
    };
    const req = buildPublishRequest(draft, 'c');
    expect(req.schemaConfig).toEqual(draft.schemaConfig);
  });

  it('omits schemaConfig when undefined', () => {
    const req = buildPublishRequest(basePublishDraft(), 'c');
    expect(req.schemaConfig).toBeUndefined();
  });

  it('omits bodyFormat when json (default — no extra field)', () => {
    const req = buildPublishRequest(basePublishDraft(), 'c');
    expect(req.bodyFormat).toBeUndefined();
  });

  it('omits keyFormat when string (default — no extra field)', () => {
    const req = buildPublishRequest(basePublishDraft(), 'c');
    expect(req.keyFormat).toBeUndefined();
  });

  it('includes bodyFormat when base64', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), bodyFormat: 'base64' }, 'c');
    expect(req.bodyFormat).toBe('base64');
  });

  it('includes bodyFormat when hex', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), bodyFormat: 'hex' }, 'c');
    expect(req.bodyFormat).toBe('hex');
  });

  it('includes keyFormat when base64', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), keyFormat: 'base64' }, 'c');
    expect(req.keyFormat).toBe('base64');
  });

  it('includes bodyFormat when string', () => {
    const req = buildPublishRequest({ ...basePublishDraft(), bodyFormat: 'string' }, 'c');
    expect(req.bodyFormat).toBe('string');
  });
});
// ── validateBase64 ──────────────────────────────────────────────────────────────

describe('validateBase64', () => {
  it('returns ok:true + byteCount:0 for empty input', () => {
    expect(validateBase64('')).toMatchObject({ ok: true, byteCount: 0 });
    expect(validateBase64('   ')).toMatchObject({ ok: true, byteCount: 0 });
  });

  it('decodes valid base64 and returns byte count', () => {
    // 'hello' in base64 = 'aGVsbG8='
    const result = validateBase64('aGVsbG8=');
    expect(result.ok).toBe(true);
    expect(result.byteCount).toBe(5);
    expect(result.utf8Preview).toBe('hello');
  });

  it('returns ok:false for invalid base64 characters', () => {
    const result = validateBase64('not-valid!!!');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns ok:false for base64 with wrong padding', () => {
    const result = validateBase64('aGVsbG8');
    expect(result.ok).toBe(false);
  });
});

// ── validateHex ───────────────────────────────────────────────────────────────────

describe('validateHex', () => {
  it('returns ok:true + byteCount:0 for empty input', () => {
    expect(validateHex('')).toMatchObject({ ok: true, byteCount: 0 });
    expect(validateHex('  ')).toMatchObject({ ok: true, byteCount: 0 });
  });

  it('decodes space-separated hex and returns byte count + preview', () => {
    // '68 65 6c 6c 6f' = 'hello'
    const result = validateHex('68 65 6c 6c 6f');
    expect(result.ok).toBe(true);
    expect(result.byteCount).toBe(5);
    expect(result.utf8Preview).toBe('hello');
  });

  it('decodes continuous hex (no spaces)', () => {
    const result = validateHex('68656c6c6f');
    expect(result.ok).toBe(true);
    expect(result.byteCount).toBe(5);
  });

  it('returns ok:false for odd number of hex digits', () => {
    const result = validateHex('abc');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns ok:false for non-hex characters', () => {
    const result = validateHex('zz');
    expect(result.ok).toBe(false);
  });
});
// ── buildConsumeRequest ────────────────────────────────────────────────────

describe('buildConsumeRequest', () => {
  it('includes required fields', () => {
    const req = buildConsumeRequest(baseDraft(), 'cluster-a');
    expect(req.clusterId).toBe('cluster-a');
    expect(req.topic).toBe('test');
    expect(req.fromBeginning).toBe(false);
    expect(req.timeoutMs).toBe(10000);
    expect(req.maxMessages).toBe(50);
  });

  it('sets fromBeginning=true for earliest', () => {
    const req = buildConsumeRequest({ ...baseDraft(), startPosition: 'earliest' }, 'c');
    expect(req.fromBeginning).toBe(true);
  });

  it('uses defaults for invalid timeoutMs/maxMessages', () => {
    const req = buildConsumeRequest({ ...baseDraft(), timeoutMs: '', maxMessages: '' }, 'c');
    expect(req.timeoutMs).toBe(10000);
    expect(req.maxMessages).toBe(50);
  });

  it('includes groupId when set', () => {
    const req = buildConsumeRequest({ ...baseDraft(), groupId: 'my-group' }, 'c');
    expect(req.groupId).toBe('my-group');
  });

  it('omits groupId when blank', () => {
    const req = buildConsumeRequest({ ...baseDraft(), groupId: '' }, 'c');
    expect(req.groupId).toBeUndefined();
  });

  it('includes filter when set', () => {
    const req = buildConsumeRequest({ ...baseDraft(), keyEquals: 'k' }, 'c');
    expect(req.filter).toEqual({ keyEquals: 'k' });
  });

  it('omits filter when no fields set', () => {
    const req = buildConsumeRequest(baseDraft(), 'c');
    expect(req.filter).toBeUndefined();
  });

  it('omits sortOrder when asc (default)', () => {
    const req = buildConsumeRequest(baseDraft(), 'c');
    expect(req.sortOrder).toBeUndefined();
  });

  it('includes sortOrder when desc', () => {
    const req = buildConsumeRequest({ ...baseDraft(), sortOrder: 'desc' }, 'c');
    expect(req.sortOrder).toBe('desc');
  });

  it('omits seekOffsets when not provided', () => {
    const req = buildConsumeRequest(baseDraft(), 'c');
    expect(req.seekOffsets).toBeUndefined();
  });

  it('includes seekOffsets when provided', () => {
    const offsets = [{ partition: 0, offset: '50' }, { partition: 1, offset: '30' }];
    const req = buildConsumeRequest(baseDraft(), 'c', offsets);
    expect(req.seekOffsets).toEqual(offsets);
  });

  it('omits seekOffsets when empty array', () => {
    const req = buildConsumeRequest(baseDraft(), 'c', []);
    expect(req.seekOffsets).toBeUndefined();
  });
});

// ── valuePreview ───────────────────────────────────────────────────────────

describe('valuePreview', () => {
  it('returns (empty) for empty string', () => {
    expect(valuePreview('')).toBe('(empty)');
  });

  it('collapses whitespace', () => {
    expect(valuePreview('{ "a":\n  1 }')).toBe('{ "a": 1 }');
  });

  it('truncates long strings', () => {
    const long = 'x'.repeat(100);
    const result = valuePreview(long, 60);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(61);
  });

  it('does not truncate short strings', () => {
    expect(valuePreview('short', 60)).toBe('short');
  });
});

// ── buildSubscribeRequest ──────────────────────────────────────────────────

describe('buildSubscribeRequest', () => {
  it('includes topic, fromBeginning, maxMessages, clusterId', () => {
    const req = buildSubscribeRequest(baseDraft(), 'cluster-1');
    expect(req.clusterId).toBe('cluster-1');
    expect(req.topic).toBe('test');
    expect(req.fromBeginning).toBe(false);
    expect(req.maxMessages).toBe(50);
    expect(req.maxInMemoryMessages).toBe(50);
  });

  it('uses the form max when it is set', () => {
    const req = buildSubscribeRequest({ ...baseDraft(), maxMessages: '10' }, 'cluster-1');
    expect(req.maxMessages).toBe(10);
    expect(req.maxInMemoryMessages).toBe(10);
  });

  it('includes groupId when non-blank', () => {
    const draft = baseDraft();
    draft.groupId = 'my-group';
    const req = buildSubscribeRequest(draft, 'c');
    expect(req.groupId).toBe('my-group');
  });

  it('omits groupId when blank', () => {
    const draft = baseDraft();
    draft.groupId = '  ';
    const req = buildSubscribeRequest(draft, 'c');
    expect(req.groupId).toBeUndefined();
  });

  it('includes filter when filter fields set', () => {
    const draft = baseDraft();
    draft.keyEquals = 'order-1';
    const req = buildSubscribeRequest(draft, 'c');
    expect(req.filter).toEqual({ keyEquals: 'order-1' });
  });

  it('sets fromBeginning=true when startPosition=earliest', () => {
    const draft = baseDraft();
    draft.startPosition = 'earliest';
    const req = buildSubscribeRequest(draft, 'c');
    expect(req.fromBeginning).toBe(true);
  });
});
