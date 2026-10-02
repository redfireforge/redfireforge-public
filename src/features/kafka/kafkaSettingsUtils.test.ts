import { describe, it, expect } from 'vitest';
import {
  parseOptionalTimeoutMs,
  buildTlsConfig,
  formatBrokers,
  formatSecurityProfile,
  getClusterStatus,
  formatDiagnosticHint,
  toDiagnosticBannerData,
  DIAGNOSTIC_LABELS,
} from './kafkaSettingsUtils';
import type { KafkaClusterDraft } from './kafkaClusterForm';

// ── helpers ────────────────────────────────────────────────────────────────

const makeDraft = (overrides: Partial<KafkaClusterDraft> = {}): KafkaClusterDraft => ({
  clusterId: 'cluster-1',
  name: 'Dev Kafka',
  clientId: 'client-1',
  brokers: ['localhost:9092'],
  authMode: 'none',
  authUsername: '',
  authPassword: '',
  tlsEnabled: false,
  tlsRejectUnauthorized: true,
  tlsServerName: '',
  tlsCaPem: '',
  tlsCertPem: '',
  tlsKeyPem: '',
  tlsPassphrase: '',
  connectionTimeoutMs: '',
  requestTimeoutMs: '',
  ...overrides,
});

// ── parseOptionalTimeoutMs ──────────────────────────────────────────────────

describe('parseOptionalTimeoutMs', () => {
  it('returns undefined for empty string', () => {
    expect(parseOptionalTimeoutMs('')).toBeUndefined();
    expect(parseOptionalTimeoutMs('   ')).toBeUndefined();
  });

  it('parses valid integer string', () => {
    expect(parseOptionalTimeoutMs('5000')).toBe(5000);
    expect(parseOptionalTimeoutMs('30000')).toBe(30000);
  });

  it('parses string with surrounding whitespace', () => {
    expect(parseOptionalTimeoutMs('  1000  ')).toBe(1000);
  });
});

// ── buildTlsConfig ──────────────────────────────────────────────────────────

describe('buildTlsConfig', () => {
  it('returns disabled TLS when tlsEnabled is false', () => {
    const tls = buildTlsConfig(makeDraft({ tlsEnabled: false }));
    expect(tls.enabled).toBe(false);
    expect(tls.rejectUnauthorized).toBe(true);
  });

  it('returns enabled TLS with populated fields', () => {
    const tls = buildTlsConfig(makeDraft({
      tlsEnabled: true,
      tlsRejectUnauthorized: false,
      tlsServerName: 'kafka.internal',
      tlsCaPem: '---CA---',
      tlsCertPem: '---CERT---',
      tlsKeyPem: '---KEY---',
      tlsPassphrase: 'secret',
    }));
    expect(tls.enabled).toBe(true);
    expect(tls.rejectUnauthorized).toBe(false);
    expect(tls.serverName).toBe('kafka.internal');
    expect(tls.caPem).toBe('---CA---');
    expect(tls.certPem).toBe('---CERT---');
    expect(tls.keyPem).toBe('---KEY---');
    expect(tls.passphrase).toBe('secret');
  });

  it('omits empty optional TLS fields', () => {
    const tls = buildTlsConfig(makeDraft({ tlsEnabled: true }));
    expect(tls.serverName).toBeUndefined();
    expect(tls.caPem).toBeUndefined();
    expect(tls.certPem).toBeUndefined();
    expect(tls.keyPem).toBeUndefined();
    expect(tls.passphrase).toBeUndefined();
  });

  it('trims whitespace from TLS string fields', () => {
    const tls = buildTlsConfig(makeDraft({
      tlsEnabled: true,
      tlsServerName: '  kafka.local  ',
    }));
    expect(tls.serverName).toBe('kafka.local');
  });
});

// ── formatBrokers ───────────────────────────────────────────────────────────

describe('formatBrokers', () => {
  it('returns single broker as-is', () => {
    expect(formatBrokers(['localhost:9092'])).toBe('localhost:9092');
  });

  it('joins two brokers with comma-space', () => {
    expect(formatBrokers(['b1:9092', 'b2:9092'])).toBe('b1:9092, b2:9092');
  });

  it('shows first two and +N more for more than 2 brokers', () => {
    expect(formatBrokers(['b1:9092', 'b2:9092', 'b3:9092'])).toBe('b1:9092, b2:9092, +1 more');
    expect(formatBrokers(['a:9092', 'b:9092', 'c:9092', 'd:9092'])).toBe('a:9092, b:9092, +2 more');
  });

  it('handles empty broker list', () => {
    expect(formatBrokers([])).toBe('');
  });
});

// ── formatSecurityProfile ───────────────────────────────────────────────────

describe('formatSecurityProfile', () => {
  const makeCluster = (auth: { mode: string }, tls: { enabled: boolean; rejectUnauthorized?: boolean }) => ({
    clusterId: 'c',
    name: 'n',
    clientId: 'ci',
    brokers: ['b:9092'],
    auth: auth as never,
    tls: tls as never,
    createdAt: 0,
    updatedAt: 0,
  });

  it('shows no auth and no TLS label for plaintext/no-auth cluster', () => {
    const label = formatSecurityProfile(makeCluster({ mode: 'none' }, { enabled: false }));
    expect(label).toBe('No authentication');
  });

  it('shows SASL/PLAIN with TLS enabled', () => {
    const label = formatSecurityProfile(makeCluster(
      { mode: 'plain' },
      { enabled: true, rejectUnauthorized: true },
    ));
    expect(label).toContain('SASL / PLAIN');
    expect(label).toContain('TLS enabled');
  });

  it('shows Azure OAUTHBEARER', () => {
    const label = formatSecurityProfile(makeCluster(
      { mode: 'oauthbearer' },
      { enabled: true, rejectUnauthorized: true },
    ));
    expect(label).toContain('Azure OAUTHBEARER');
    expect(label).toContain('TLS enabled');
  });

  it('shows TLS without cert verification when rejectUnauthorized is false', () => {
    const label = formatSecurityProfile(makeCluster(
      { mode: 'none' },
      { enabled: true, rejectUnauthorized: false },
    ));
    expect(label).toContain('TLS without cert verification');
  });
});

// ── getClusterStatus ────────────────────────────────────────────────────────

describe('getClusterStatus', () => {
  it('returns connected when state=connected and clusterId matches connectedClusterId', () => {
    const result = getClusterStatus('c1', 'c1', 'connected', 'c1');
    expect(result.kind).toBe('connected');
    expect(result.label).toBe('Connected');
  });

  it('returns idle when state=connected but connectedClusterId is a different cluster', () => {
    const result = getClusterStatus('c1', 'c1', 'connected', 'other');
    expect(result.kind).toBe('idle');
  });

  it('returns failed when state=error and selectedClusterId matches', () => {
    const result = getClusterStatus('c1', 'c1', 'error');
    expect(result.kind).toBe('failed');
    expect(result.label).toBe('Failed');
  });

  it('returns idle when state=error but selectedClusterId is a different cluster', () => {
    const result = getClusterStatus('c1', 'other', 'error');
    expect(result.kind).toBe('idle');
  });

  it('returns idle for disconnected state', () => {
    const result = getClusterStatus('c1', 'c1', 'disconnected');
    expect(result.kind).toBe('idle');
    expect(result.label).toBe('Idle');
  });

  it('returns idle for testing state', () => {
    const result = getClusterStatus('c1', 'c1', 'testing');
    expect(result.kind).toBe('idle');
  });
});

// ── formatDiagnosticHint ────────────────────────────────────────────────────

describe('formatDiagnosticHint', () => {
  it('returns auth hint for auth kind', () => {
    const hint = formatDiagnosticHint('auth', true);
    expect(hint).toContain('auth mode');
  });

  it('returns TLS hint for tls kind', () => {
    const hint = formatDiagnosticHint('tls', true);
    expect(hint).toContain('certificate');
  });

  it('returns timeout hint for timeout kind', () => {
    const hint = formatDiagnosticHint('timeout', true);
    expect(hint).toContain('timeout');
  });

  it('returns network hint for network kind', () => {
    const hint = formatDiagnosticHint('network', true);
    expect(hint).toContain('broker');
  });

  it('returns validation hint for validation kind', () => {
    const hint = formatDiagnosticHint('validation', true);
    expect(hint).toContain('configuration');
  });

  it('returns cluster hint for cluster kind', () => {
    const hint = formatDiagnosticHint('cluster', false);
    expect(hint).toContain('Refresh');
  });

  it('returns retryable default hint for unknown kind with retryable=true', () => {
    const hint = formatDiagnosticHint('unknown', true);
    expect(hint).toContain('retry');
  });

  it('returns non-retryable default hint for unknown kind with retryable=false', () => {
    const hint = formatDiagnosticHint('unknown', false);
    expect(hint).not.toContain('retry after');
    expect(hint).toContain('before retrying');
  });

  it('covers every key in DIAGNOSTIC_LABELS', () => {
    // ensure no label key returns an empty hint
    for (const key of Object.keys(DIAGNOSTIC_LABELS) as Array<keyof typeof DIAGNOSTIC_LABELS>) {
      const hint = formatDiagnosticHint(key, true);
      expect(typeof hint).toBe('string');
      expect(hint.length).toBeGreaterThan(0);
    }
  });
});

// ── toDiagnosticBannerData ──────────────────────────────────────────────────

describe('toDiagnosticBannerData', () => {
  it('maps a KafkaUiSafeError to banner data', () => {
    const err = { kind: 'auth' as const, code: 'AUTH_FAIL', message: 'bad creds', retryable: true };
    const banner = toDiagnosticBannerData(err);
    expect(banner.kind).toBe('auth');
    expect(banner.code).toBe('AUTH_FAIL');
    expect(banner.message).toBe('bad creds');
    expect(banner.retryable).toBe(true);
  });

  it('preserves retryable=false', () => {
    const err = { kind: 'network' as const, code: 'CONN_FAIL', message: 'offline', retryable: false };
    const banner = toDiagnosticBannerData(err);
    expect(banner.retryable).toBe(false);
  });
});
