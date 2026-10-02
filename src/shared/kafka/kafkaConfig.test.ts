import { describe, it, expect } from 'vitest';
import { normalizeKafkaClusterConfig } from './kafkaConfig';

// Minimal valid source to pass the clusterId + brokers guard
const base = () => ({
  clusterId: 'cluster-1',
  name: 'Dev Kafka',
  clientId: 'client-1',
  brokers: ['localhost:9092'],
  auth: { mode: 'none' },
  tls: { enabled: false },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
});

describe('normalizeKafkaClusterConfig', () => {
  it('returns null for null input', () => {
    expect(normalizeKafkaClusterConfig(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(normalizeKafkaClusterConfig('string')).toBeNull();
    expect(normalizeKafkaClusterConfig(42)).toBeNull();
    expect(normalizeKafkaClusterConfig(true)).toBeNull();
  });

  it('returns null when clusterId is missing', () => {
    const { clusterId: _id, ...rest } = base();
    expect(normalizeKafkaClusterConfig(rest)).toBeNull();
  });

  it('returns null when clusterId is empty string', () => {
    expect(normalizeKafkaClusterConfig({ ...base(), clusterId: '' })).toBeNull();
  });

  it('falls back to source.id when clusterId is absent', () => {
    const { clusterId: _id, ...rest } = base();
    const result = normalizeKafkaClusterConfig({ ...rest, id: 'fallback-id' });
    expect(result?.clusterId).toBe('fallback-id');
  });

  it('returns null when brokers array is empty', () => {
    expect(normalizeKafkaClusterConfig({ ...base(), brokers: [] })).toBeNull();
  });

  it('returns null when brokers produces no usable entries', () => {
    expect(normalizeKafkaClusterConfig({ ...base(), brokers: ['  ', ''] })).toBeNull();
  });

  it('accepts brokers as a comma-separated string', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), brokers: 'broker1:9092,broker2:9092' });
    expect(result?.brokers).toEqual(['broker1:9092', 'broker2:9092']);
  });

  it('deduplicates broker entries', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), brokers: ['b:9092', 'b:9092', 'b:9092'] });
    expect(result?.brokers).toEqual(['b:9092']);
  });

  it('parses valid createdAt/updatedAt timestamps', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), createdAt: 1_000, updatedAt: 2_000 });
    expect(result?.createdAt).toBe(1_000);
    expect(result?.updatedAt).toBe(2_000);
  });

  it('falls back to now for missing createdAt', () => {
    const { createdAt: _c, ...rest } = base();
    const now = 1_750_000_000_000;
    const result = normalizeKafkaClusterConfig(rest, now);
    expect(result?.createdAt).toBe(now);
  });

  it('clamps updatedAt to createdAt when updatedAt is before createdAt', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), createdAt: 2_000, updatedAt: 1_000 });
    expect(result?.updatedAt).toBe(2_000);
  });

  it('falls back to clusterId as name when name is absent', () => {
    const { name: _n, ...rest } = base();
    const result = normalizeKafkaClusterConfig(rest);
    expect(result?.name).toBe('cluster-1');
  });

  it('generates clientId fallback from clusterId when clientId is absent', () => {
    const { clientId: _c, ...rest } = base();
    const result = normalizeKafkaClusterConfig(rest);
    expect(result?.clientId).toBe('redfireforge-cluster-1');
  });

  it('parses auth.mode = none', () => {
    const result = normalizeKafkaClusterConfig(base());
    expect(result?.auth.mode).toBe('none');
  });

  it('parses SASL/PLAIN auth', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      auth: { mode: 'plain', username: 'user', password: 'pass' },
    });
    expect(result?.auth.mode).toBe('plain');
    expect(result?.auth.username).toBe('user');
    expect(result?.auth.password).toBe('pass');
  });

  it('parses auth from a plain string mode value', () => {
    // parseAuth receives string 'plain' when source.auth is a string
    const result = normalizeKafkaClusterConfig({ ...base(), auth: 'plain', username: 'user', password: 'pass' });
    expect(result?.auth.mode).toBe('plain');
    // username/password lifted from top-level source
    expect(result?.auth.username).toBe('user');
    expect(result?.auth.password).toBe('pass');
  });

  it('falls back to auth.mode=none for unknown auth mode string', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), auth: 'unsupported-mode' });
    expect(result?.auth.mode).toBe('none');
  });

  it('keeps Azure OAUTHBEARER without stored credentials', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      auth: { mode: 'oauthbearer', username: 'leftover', password: 'leftover' },
      username: 'top',
      password: 'top',
    });
    expect(result?.auth).toEqual({ mode: 'oauthbearer' });
  });

  it('falls back to auth.mode=none when auth is null', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), auth: null });
    expect(result?.auth.mode).toBe('none');
  });

  it('parses TLS disabled (default)', () => {
    const result = normalizeKafkaClusterConfig(base());
    expect(result?.tls.enabled).toBe(false);
    expect(result?.tls.rejectUnauthorized).toBe(true);
  });

  it('parses TLS enabled with rejectUnauthorized: false', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      tls: { enabled: true, rejectUnauthorized: false },
    });
    expect(result?.tls.enabled).toBe(true);
    expect(result?.tls.rejectUnauthorized).toBe(false);
  });

  it('parses TLS with cert, key, passphrase and serverName', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      tls: {
        enabled: true,
        rejectUnauthorized: true,
        serverName: 'kafka.internal',
        caPem: '---CA---',
        certPem: '---CERT---',
        keyPem: '---KEY---',
        passphrase: 'secret',
      },
    });
    expect(result?.tls.serverName).toBe('kafka.internal');
    expect(result?.tls.caPem).toBe('---CA---');
    expect(result?.tls.certPem).toBe('---CERT---');
    expect(result?.tls.keyPem).toBe('---KEY---');
    expect(result?.tls.passphrase).toBe('secret');
  });

  it('returns undefined for tls optional fields when not provided', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), tls: { enabled: true } });
    expect(result?.tls.serverName).toBeUndefined();
    expect(result?.tls.caPem).toBeUndefined();
  });

  it('parses connectionTimeoutMs and requestTimeoutMs when valid positive numbers', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      connectionTimeoutMs: 5000,
      requestTimeoutMs: 3000,
    });
    expect(result?.connectionTimeoutMs).toBe(5000);
    expect(result?.requestTimeoutMs).toBe(3000);
  });

  it('floors non-integer timeout values', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), connectionTimeoutMs: 5999.9 });
    expect(result?.connectionTimeoutMs).toBe(5999);
  });

  it('returns undefined for zero or negative timeouts', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), connectionTimeoutMs: 0, requestTimeoutMs: -1 });
    expect(result?.connectionTimeoutMs).toBeUndefined();
    expect(result?.requestTimeoutMs).toBeUndefined();
  });

  it('returns undefined for string timeout values', () => {
    const result = normalizeKafkaClusterConfig({ ...base(), connectionTimeoutMs: '5000' });
    expect(result?.connectionTimeoutMs).toBeUndefined();
  });

  it('trims whitespace from name, clientId, clusterId', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      clusterId: '  trimmed-id  ',
      name: '  My Cluster  ',
      clientId: '  my-client  ',
    });
    expect(result?.clusterId).toBe('trimmed-id');
    expect(result?.name).toBe('My Cluster');
    expect(result?.clientId).toBe('my-client');
  });

  it('filters and deduplicates brokers provided as array', () => {
    const result = normalizeKafkaClusterConfig({
      ...base(),
      brokers: ['  broker1:9092  ', 'broker2:9092', '  broker1:9092  '],
    });
    expect(result?.brokers).toEqual(['broker1:9092', 'broker2:9092']);
  });

  it('parseBrokers returns [] when brokers is neither a string nor an array (line 80)', () => {
    // parseBrokers(42) returns [] → normalizeKafkaClusterConfig returns null (empty brokers)
    const result = normalizeKafkaClusterConfig({
      clusterId: 'c',
      label: 'Test',
      // @ts-expect-error intentionally passing a non-string, non-array value
      brokers: 42,
    });
    expect(result).toBeNull();
  });

  it('parseTls returns disabled TLS defaults when tls is null/falsy (line 107)', () => {
    // When tls field is null, parseTls's early-return path is hit
    const result = normalizeKafkaClusterConfig({ ...base(), tls: null });
    expect(result?.tls.enabled).toBe(false);
    expect(result?.tls.rejectUnauthorized).toBe(true);
  });
});
