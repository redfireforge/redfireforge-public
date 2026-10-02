import { describe, it, expect } from 'vitest';
import {
  validateConnectionConfig,
  validateKafkaProduceRequest,
  validateKafkaConsumeRequest,
  readKafkaJsonPath,
  matchesKafkaConsumeFilter,
  checkClusterMismatch,
} from './kafka-service-utils.js';

// ── minimal helpers ────────────────────────────────────────────────────────

const baseConnection = () => ({
  clusterId: 'cluster-1',
  clientId: 'client-1',
  brokers: ['localhost:9092'],
  auth: { mode: 'none' as const },
});

// ── validateConnectionConfig ───────────────────────────────────────────────

describe('validateConnectionConfig', () => {
  it('returns null for a valid plaintext connection', () => {
    expect(validateConnectionConfig(baseConnection())).toBeNull();
  });

  it('rejects missing clusterId', () => {
    const result = validateConnectionConfig({ ...baseConnection(), clusterId: '' });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('clusterId');
  });

  it('rejects whitespace-only clusterId', () => {
    const result = validateConnectionConfig({ ...baseConnection(), clusterId: '   ' });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
  });

  it('rejects missing clientId', () => {
    const result = validateConnectionConfig({ ...baseConnection(), clientId: '' });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('clientId');
  });

  it('rejects empty brokers array', () => {
    const result = validateConnectionConfig({ ...baseConnection(), brokers: [] });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('brokers');
  });

  it('rejects non-array brokers', () => {
    const result = validateConnectionConfig({ ...baseConnection(), brokers: 'localhost:9092' as unknown as string[] });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
  });

  it('rejects broker list containing an empty value', () => {
    const result = validateConnectionConfig({ ...baseConnection(), brokers: ['localhost:9092', ''] });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('empty values');
  });

  it('rejects broker list containing a whitespace-only value', () => {
    const result = validateConnectionConfig({ ...baseConnection(), brokers: ['  ', 'localhost:9092'] });
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
  });

  it('accepts auth mode none with no credentials', () => {
    const conn = { ...baseConnection(), auth: { mode: 'none' as const } };
    expect(validateConnectionConfig(conn)).toBeNull();
  });

  it('rejects authenticated mode missing username', () => {
    const conn = {
      ...baseConnection(),
      auth: { mode: 'plain' as const, username: '', password: 'secret' },
    };
    const result = validateConnectionConfig(conn);
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('username');
  });

  it('rejects authenticated mode missing password', () => {
    const conn = {
      ...baseConnection(),
      auth: { mode: 'plain' as const, username: 'user', password: '' },
    };
    const result = validateConnectionConfig(conn);
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('password');
  });

  it('accepts SCRAM auth with username and password', () => {
    const conn = {
      ...baseConnection(),
      auth: { mode: 'scram-sha-256' as const, username: 'user', password: 'pass' },
    };
    expect(validateConnectionConfig(conn)).toBeNull();
  });

  it('accepts TLS without cert/key (CA-only)', () => {
    const conn = {
      ...baseConnection(),
      tls: { enabled: true, rejectUnauthorized: true, caPem: '---cert---' },
    };
    expect(validateConnectionConfig(conn)).toBeNull();
  });

  it('rejects TLS with cert but no key', () => {
    const conn = {
      ...baseConnection(),
      tls: { enabled: true, rejectUnauthorized: true, certPem: '---cert---' },
    };
    const result = validateConnectionConfig(conn);
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('certPem');
    expect(result?.message).toContain('keyPem');
  });

  it('rejects TLS with key but no cert', () => {
    const conn = {
      ...baseConnection(),
      tls: { enabled: true, rejectUnauthorized: true, keyPem: '---key---' },
    };
    const result = validateConnectionConfig(conn);
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
  });

  it('rejects TLS passphrase without a key', () => {
    const conn = {
      ...baseConnection(),
      tls: { enabled: true, rejectUnauthorized: true, passphrase: 'secret' },
    };
    const result = validateConnectionConfig(conn);
    expect(result?.code).toBe('KAFKA_INVALID_CONNECTION');
    expect(result?.message).toContain('passphrase');
  });

  it('accepts TLS with cert, key and passphrase together', () => {
    const conn = {
      ...baseConnection(),
      tls: { enabled: true, rejectUnauthorized: true, certPem: '---cert---', keyPem: '---key---', passphrase: 'secret' },
    };
    expect(validateConnectionConfig(conn)).toBeNull();
  });

  it('accepts connection without tls field', () => {
    const { auth: _auth, ...rest } = baseConnection();
    const conn = { ...rest, auth: { mode: 'none' as const } };
    expect(validateConnectionConfig(conn)).toBeNull();
  });
});

// ── validateKafkaProduceRequest ────────────────────────────────────────────

describe('validateKafkaProduceRequest', () => {
  it('returns null for a valid produce request', () => {
    const req = { topic: 'orders', messages: [{ value: '{"orderId":1}' }] };
    expect(validateKafkaProduceRequest(req)).toBeNull();
  });

  it('rejects missing topic', () => {
    const result = validateKafkaProduceRequest({ topic: '', messages: [{ value: 'v' }] });
    expect(result?.code).toBe('KAFKA_INVALID_PRODUCE');
    expect(result?.message).toContain('topic');
  });

  it('rejects whitespace topic', () => {
    expect(validateKafkaProduceRequest({ topic: '   ', messages: [{ value: 'v' }] })).not.toBeNull();
  });

  it('rejects empty messages array', () => {
    const result = validateKafkaProduceRequest({ topic: 'orders', messages: [] });
    expect(result?.code).toBe('KAFKA_INVALID_PRODUCE');
    expect(result?.message).toContain('messages');
  });

  it('rejects non-array messages', () => {
    const result = validateKafkaProduceRequest({ topic: 'orders', messages: null as unknown as [] });
    expect(result?.code).toBe('KAFKA_INVALID_PRODUCE');
  });

  it('rejects messages with non-string value', () => {
    const result = validateKafkaProduceRequest({ topic: 'orders', messages: [{ value: 42 as unknown as string }] });
    expect(result?.code).toBe('KAFKA_INVALID_PRODUCE');
    expect(result?.message).toContain('string');
  });

  it('accepts multiple messages', () => {
    const req = { topic: 'orders', messages: [{ value: 'a' }, { value: 'b' }] };
    expect(validateKafkaProduceRequest(req)).toBeNull();
  });
});

// ── validateKafkaConsumeRequest ────────────────────────────────────────────

describe('validateKafkaConsumeRequest', () => {
  it('returns null for minimal valid request', () => {
    expect(validateKafkaConsumeRequest({ topic: 'orders' })).toBeNull();
  });

  it('returns null with valid maxMessages and timeoutMs', () => {
    expect(validateKafkaConsumeRequest({ topic: 'orders', maxMessages: 5, timeoutMs: 3000 })).toBeNull();
  });

  it('rejects missing topic', () => {
    const result = validateKafkaConsumeRequest({ topic: '' });
    expect(result?.code).toBe('KAFKA_INVALID_CONSUME_ONCE');
    expect(result?.message).toContain('topic');
  });

  it('rejects maxMessages below 1', () => {
    const result = validateKafkaConsumeRequest({ topic: 'orders', maxMessages: 0 });
    expect(result?.code).toBe('KAFKA_INVALID_CONSUME_ONCE');
    expect(result?.message).toContain('maxMessages');
  });

  it('rejects negative maxMessages', () => {
    expect(validateKafkaConsumeRequest({ topic: 'orders', maxMessages: -1 })).not.toBeNull();
  });

  it('rejects timeoutMs below 1', () => {
    const result = validateKafkaConsumeRequest({ topic: 'orders', timeoutMs: 0 });
    expect(result?.code).toBe('KAFKA_INVALID_CONSUME_ONCE');
    expect(result?.message).toContain('timeoutMs');
  });

  it('accepts null/undefined maxMessages and timeoutMs (optional)', () => {
    expect(validateKafkaConsumeRequest({ topic: 'orders', maxMessages: undefined, timeoutMs: undefined })).toBeNull();
  });
});

// ── readKafkaJsonPath ──────────────────────────────────────────────────────

describe('readKafkaJsonPath', () => {
  it('reads a simple top-level string field', () => {
    expect(readKafkaJsonPath('{"orderId":"ORD-1"}', '$.orderId')).toBe('ORD-1');
  });

  it('reads a nested field', () => {
    expect(readKafkaJsonPath('{"order":{"id":"ORD-1"}}', '$.order.id')).toBe('ORD-1');
  });

  it('reads an array element by index', () => {
    expect(readKafkaJsonPath('{"items":["a","b","c"]}', '$.items[1]')).toBe('b');
  });

  it('reads a deeply nested value via array bracket notation', () => {
    expect(readKafkaJsonPath('[{"id":"X"}]', '$.[0].id')).toBe('X');
  });

  it('serializes non-string values to JSON string', () => {
    const result = readKafkaJsonPath('{"count":42}', '$.count');
    expect(result).toBe('42');
  });

  it('serializes object values to JSON string', () => {
    const result = readKafkaJsonPath('{"nested":{"a":1}}', '$.nested');
    expect(result).toBe('{"a":1}');
  });

  it('returns null for missing field', () => {
    expect(readKafkaJsonPath('{"a":1}', '$.b')).toBeNull();
  });

  it('returns null when path leads through a null node', () => {
    expect(readKafkaJsonPath('{"a":null}', '$.a.b')).toBeNull();
  });

  it('returns null when intermediate node is not an object', () => {
    expect(readKafkaJsonPath('{"a":"string"}', '$.a.b')).toBeNull();
  });

  it('returns null for out-of-bounds array index', () => {
    expect(readKafkaJsonPath('{"items":["a"]}', '$.items[5]')).toBeNull();
  });

  it('returns null for invalid JSON input', () => {
    expect(readKafkaJsonPath('not-json', '$.key')).toBeNull();
  });

  it('returns null for paths not starting with $.', () => {
    expect(readKafkaJsonPath('{"a":1}', 'a')).toBeNull();
    expect(readKafkaJsonPath('{"a":1}', '$a')).toBeNull();
    expect(readKafkaJsonPath('{"a":1}', '')).toBeNull();
  });

  it('returns null for path to explicit null value', () => {
    expect(readKafkaJsonPath('{"a":null}', '$.a')).toBeNull();
  });

  it('returns null for negative array index', () => {
    expect(readKafkaJsonPath('{"items":["a"]}', '$.items[-1]')).toBeNull();
  });
});

// ── matchesKafkaConsumeFilter ──────────────────────────────────────────────

describe('matchesKafkaConsumeFilter', () => {
  const record = (overrides: Partial<{ key: string; value: string; headers: Record<string, string> }> = {}) => ({
    key: 'key-1',
    value: '{"orderId":"ORD-1","status":"pending"}',
    headers: { 'event-type': 'order.created' },
    topic: 'orders',
    partition: 0,
    offset: '0',
    timestamp: '0',
    ...overrides,
  });

  it('returns true when no filter provided', () => {
    expect(matchesKafkaConsumeFilter(record())).toBe(true);
    expect(matchesKafkaConsumeFilter(record(), undefined)).toBe(true);
  });

  it('matches by keyEquals', () => {
    expect(matchesKafkaConsumeFilter(record(), { keyEquals: 'key-1' })).toBe(true);
    expect(matchesKafkaConsumeFilter(record(), { keyEquals: 'other-key' })).toBe(false);
  });

  it('matches when record.key is undefined and keyEquals is not', () => {
    expect(matchesKafkaConsumeFilter(record({ key: undefined as unknown as string }), { keyEquals: 'key-1' })).toBe(false);
  });

  it('matches by headersMatch — all headers present', () => {
    expect(matchesKafkaConsumeFilter(record(), { headersMatch: { 'event-type': 'order.created' } })).toBe(true);
  });

  it('rejects when header value does not match', () => {
    expect(matchesKafkaConsumeFilter(record(), { headersMatch: { 'event-type': 'order.updated' } })).toBe(false);
  });

  it('rejects when required header is absent', () => {
    expect(matchesKafkaConsumeFilter(record(), { headersMatch: { 'missing-header': 'value' } })).toBe(false);
  });

  it('uses empty object when record.headers is undefined', () => {
    const r = record({ headers: undefined as unknown as Record<string, string> });
    expect(matchesKafkaConsumeFilter(r, { headersMatch: { 'event-type': 'order.created' } })).toBe(false);
  });

  it('matches by jsonPath existence only (no jsonEquals)', () => {
    expect(matchesKafkaConsumeFilter(record(), { jsonPath: '$.orderId' })).toBe(true);
  });

  it('returns false when jsonPath is present but value not found (no jsonEquals)', () => {
    expect(matchesKafkaConsumeFilter(record(), { jsonPath: '$.missing' })).toBe(false);
  });

  it('matches by jsonPath + jsonEquals', () => {
    expect(matchesKafkaConsumeFilter(record(), { jsonPath: '$.orderId', jsonEquals: 'ORD-1' })).toBe(true);
  });

  it('rejects when jsonPath + jsonEquals values differ', () => {
    expect(matchesKafkaConsumeFilter(record(), { jsonPath: '$.orderId', jsonEquals: 'ORD-2' })).toBe(false);
  });

  it('rejects when jsonPath yields null but jsonEquals is set', () => {
    expect(matchesKafkaConsumeFilter(record(), { jsonPath: '$.missing', jsonEquals: 'anything' })).toBe(false);
  });

  it('matches accountType inside an escaped event body string', () => {
    const value = '{"event":{"body":"{\\"accountType\\":\\"PN\\",\\"vin\\":\\"1\\"}"}}';
    expect(matchesKafkaConsumeFilter(record({ value }), { bodyContains: '"accountType":"PN"' })).toBe(true);
    expect(matchesKafkaConsumeFilter(record({ value }), { bodyContains: '\\"accountType\\":\\"PN\\"' })).toBe(true);
    expect(matchesKafkaConsumeFilter(record({ value }), { bodyContains: '"accountType":"FL"' })).toBe(false);
  });

  it('accepts a record matching all combined filter fields', () => {
    const filter = {
      keyEquals: 'key-1',
      headersMatch: { 'event-type': 'order.created' },
      jsonPath: '$.status',
      jsonEquals: 'pending',
    };
    expect(matchesKafkaConsumeFilter(record(), filter)).toBe(true);
  });

  it('rejects when only one combined filter field fails', () => {
    const filter = {
      keyEquals: 'key-1',
      headersMatch: { 'event-type': 'order.created' },
      jsonPath: '$.status',
      jsonEquals: 'shipped', // wrong value
    };
    expect(matchesKafkaConsumeFilter(record(), filter)).toBe(false);
  });
});

// ── checkClusterMismatch ───────────────────────────────────────────────────

describe('checkClusterMismatch', () => {
  it('returns null when requestClusterId is undefined', () => {
    expect(checkClusterMismatch('produce', undefined, 'active-1')).toBeNull();
  });

  it('returns null when activeClusterId is undefined', () => {
    expect(checkClusterMismatch('produce', 'req-1', undefined)).toBeNull();
  });

  it('returns null when both are undefined', () => {
    expect(checkClusterMismatch('produce', undefined, undefined)).toBeNull();
  });

  it('returns null when clusters match', () => {
    expect(checkClusterMismatch('produce', 'cluster-1', 'cluster-1')).toBeNull();
  });

  it('returns error envelope when clusters differ', () => {
    const result = checkClusterMismatch('produce', 'req-cluster', 'active-cluster');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.error.code).toBe('KAFKA_CLUSTER_MISMATCH');
      expect(result!.error.message).toContain('req-cluster');
      expect(result!.error.message).toContain('active-cluster');
    }
  });

  it('preserves the operation name in the envelope', () => {
    const result = checkClusterMismatch('consume-once', 'a', 'b');
    expect(result).not.toBeNull();
    if (result && !result.ok) {
      expect(result.op).toBe('consume-once');
    }
  });

  it('returns null when requestClusterId is empty string', () => {
    expect(checkClusterMismatch('topics', '', 'active-1')).toBeNull();
  });

  it('returns null when activeClusterId is empty string', () => {
    expect(checkClusterMismatch('topics', 'req-1', '')).toBeNull();
  });
});
