import { describe, expect, it } from 'vitest';
import type { KafkaClusterConfig } from '@shared/kafka/kafkaConfig';
import {
  authConfigFromDraft,
  clusterIdFromName,
  defaultClusterDraft,
  draftFromCluster,
  hasDraftErrors,
  normalizeBrokerEntries,
  validateKafkaClusterDraft,
} from './kafkaClusterForm';

const EXISTING_CLUSTER: KafkaClusterConfig = {
  clusterId: 'local-dev',
  name: 'Local Dev',
  clientId: 'redfireforge-local-dev',
  brokers: ['127.0.0.1:19092'],
  auth: { mode: 'none' },
  tls: { enabled: false, rejectUnauthorized: true },
  createdAt: 1,
  updatedAt: 1,
};

describe('kafkaClusterForm helpers', () => {
  it('normalizes cluster id from name', () => {
    expect(clusterIdFromName('  QA Cluster #1  ')).toBe('qa-cluster-1');
    expect(clusterIdFromName('Prod_Cluster.Main')).toBe('prod_cluster.main');
  });

  it('creates deterministic default draft when seed is provided', () => {
    const draft = defaultClusterDraft(42);
    expect(draft.clusterId).toBe('kafka-cluster-42');
    expect(draft.clientId).toBe('redfireforge-kafka-cluster-42');
    expect(draft.brokers).toEqual(['127.0.0.1:19092']);
    expect(draft.authMode).toBe('none');
    expect(draft.tlsEnabled).toBe(false);
  });

  it('hydrates draft fields from an existing secure cluster', () => {
    const draft = draftFromCluster({
      ...EXISTING_CLUSTER,
      connectionTimeoutMs: 5000,
      requestTimeoutMs: 8000,
      auth: { mode: 'scram-sha-512', username: 'svc-user', password: 'svc-pass' },
      tls: {
        enabled: true,
        rejectUnauthorized: false,
        serverName: 'kafka.local',
        caPem: 'ca-pem',
        certPem: 'cert-pem',
        keyPem: 'key-pem',
        passphrase: 'secret',
      },
    });

    expect(draft.connectionTimeoutMs).toBe('5000');
    expect(draft.requestTimeoutMs).toBe('8000');
    expect(draft.authMode).toBe('scram-sha-512');
    expect(draft.authUsername).toBe('svc-user');
    expect(draft.tlsEnabled).toBe(true);
    expect(draft.tlsServerName).toBe('kafka.local');
  });

  it('flags required and format errors', () => {
    const errors = validateKafkaClusterDraft({
      clusterId: 'Bad ID',
      name: '',
      clientId: '',
      brokers: ['broker-without-port', ''],
    }, [EXISTING_CLUSTER], null);

    expect(errors.name).toBeTruthy();
    expect(errors.clusterId).toContain('only lowercase letters');
    expect(errors.clientId).toBeTruthy();
    expect(errors.brokerRows?.[0]).toContain('host:port');
    expect(errors.brokerRows?.[1]).toContain('required');
    expect(hasDraftErrors(errors)).toBe(true);
  });

  it('flags duplicate cluster id only when editing a different cluster', () => {
    const duplicate = validateKafkaClusterDraft({
      clusterId: 'local-dev',
      name: 'Duplicate',
      clientId: 'dup',
      brokers: ['127.0.0.1:9092'],
    }, [EXISTING_CLUSTER], null);

    const editingSelf = validateKafkaClusterDraft({
      clusterId: 'local-dev',
      name: 'Same cluster',
      clientId: 'same',
      brokers: ['127.0.0.1:9092'],
    }, [EXISTING_CLUSTER], 'local-dev');

    expect(duplicate.clusterId).toContain('unique');
    expect(editingSelf.clusterId).toBeUndefined();
  });

  it('flags invalid auth, TLS, and timeout combinations', () => {
    const errors = validateKafkaClusterDraft({
      clusterId: 'secure-cluster',
      name: 'Secure Cluster',
      clientId: 'secure-client',
      brokers: ['127.0.0.1:9092'],
      connectionTimeoutMs: 'abc',
      requestTimeoutMs: '0',
      authMode: 'plain',
      authUsername: '',
      authPassword: '',
      tlsEnabled: true,
      tlsRejectUnauthorized: true,
      tlsServerName: '',
      tlsCaPem: '',
      tlsCertPem: 'cert-only',
      tlsKeyPem: '',
      tlsPassphrase: 'secret',
    }, [EXISTING_CLUSTER], null);

    expect(errors.connectionTimeoutMs).toContain('whole number');
    expect(errors.requestTimeoutMs).toContain('at least 1');
    expect(errors.authUsername).toContain('required');
    expect(errors.authPassword).toContain('required');
    expect(errors.tlsCertPem).toContain('provided together');
    expect(errors.tlsKeyPem).toContain('provided together');
    expect(errors.tlsPassphrase).toContain('requires a TLS private key');
  });

  it('accepts valid draft without errors', () => {
    const errors = validateKafkaClusterDraft({
      clusterId: 'staging-main',
      name: 'Staging Main',
      clientId: 'redfireforge-staging',
      brokers: ['kafka1.example.com:9092', 'kafka2.example.com:9093'],
      connectionTimeoutMs: '5000',
      requestTimeoutMs: '10000',
      authMode: 'scram-sha-256',
      authUsername: 'svc-user',
      authPassword: 'svc-pass',
      tlsEnabled: true,
      tlsRejectUnauthorized: true,
      tlsServerName: 'kafka.local',
      tlsCaPem: 'ca-pem',
      tlsCertPem: 'cert-pem',
      tlsKeyPem: 'key-pem',
      tlsPassphrase: 'secret',
    }, [EXISTING_CLUSTER], null);

    expect(errors).toEqual({});
    expect(hasDraftErrors(errors)).toBe(false);
  });

  it('accepts Azure OAUTHBEARER without a username or password', () => {
    const errors = validateKafkaClusterDraft({
      ...defaultClusterDraft(1),
      clusterId: 'a218876-t01-musea2-evhns',
      name: 'a218876-t01-musea2-evhns',
      brokers: ['a218876-t01-musea2-evhns.servicebus.windows.net:9093'],
      authMode: 'oauthbearer',
      authUsername: '',
      authPassword: '',
      tlsEnabled: true,
    }, [], null);

    expect(errors).toEqual({});
    expect(authConfigFromDraft({
      ...defaultClusterDraft(1),
      authMode: 'oauthbearer',
      authUsername: 'leftover',
      authPassword: 'leftover',
    })).toEqual({ mode: 'oauthbearer' });
  });

  it('requires an Event Hubs broker and TLS for Azure OAUTHBEARER', () => {
    const errors = validateKafkaClusterDraft({
      ...defaultClusterDraft(1),
      authMode: 'oauthbearer',
      tlsEnabled: false,
      brokers: ['127.0.0.1:19092'],
    }, [], null);

    expect(errors.tlsEnabled).toContain('TLS');
    expect(errors.brokers).toContain('servicebus.windows.net');
    expect(errors.authUsername).toBeUndefined();
  });

  it('rejects duplicate cluster ID when creating a new cluster with existing id', () => {
    const draft = defaultClusterDraft(99);
    draft.clusterId = 'existing-id';
    const errors = validateKafkaClusterDraft(
      draft,
      [{ ...EXISTING_CLUSTER, clusterId: 'existing-id' }],
      null,
    );
    expect(errors.clusterId).toContain('unique');
  });

  it('flags invalid broker host:port format', () => {
    const draft = defaultClusterDraft(99);
    draft.brokers = ['not-valid-format'];
    const errors = validateKafkaClusterDraft(draft, [], null);
    expect(errors.brokerRows?.[0]).toContain('host:port');
  });

  it('flags missing/blank broker entry', () => {
    const draft = defaultClusterDraft(99);
    draft.brokers = ['  '];
    const errors = validateKafkaClusterDraft(draft, [], null);
    // blank broker should trigger a row-level or top-level brokers error
    expect(errors.brokerRows?.[0] ?? errors.brokers).toBeTruthy();
  });

  it('flags empty brokers array', () => {
    const draft = defaultClusterDraft(99);
    draft.brokers = [];
    const errors = validateKafkaClusterDraft(draft, [], null);
    expect(errors.brokers).toContain('At least one broker');
  });

  it('flags empty clusterId (line 118: Cluster ID is required)', () => {
    // Covers the `if (!clusterId)` true branch — clusterId is blank after trim
    const draft = defaultClusterDraft(99);
    draft.clusterId = '   ';
    const errors = validateKafkaClusterDraft(draft, [], null);
    expect(errors.clusterId).toBe('Cluster ID is required');
  });

  it('draftFromCluster uses empty string defaults when cluster has no optional fields', () => {
    // Covers the `?? ''` null branches in draftFromCluster for optional tls/auth fields
    const minimalCluster = {
      ...EXISTING_CLUSTER,
      auth: { mode: 'none' as const },
      tls: { enabled: false, rejectUnauthorized: true },
      connectionTimeoutMs: undefined as unknown as number,
      requestTimeoutMs: undefined as unknown as number,
    };
    const draft = draftFromCluster(minimalCluster);
    expect(draft.connectionTimeoutMs).toBe('');
    expect(draft.requestTimeoutMs).toBe('');
    expect(draft.tlsServerName).toBe('');
    expect(draft.tlsCaPem).toBe('');
  });

  it('validateKafkaClusterDraft deduplicates brokers silently', () => {
    // Covers the `if (!normalizedBrokers.includes(trimmed))` false branch — duplicate brokers
    const draft = defaultClusterDraft(99);
    draft.brokers = ['127.0.0.1:9092', '127.0.0.1:9092'];
    const errors = validateKafkaClusterDraft(draft, [], null);
    // No error for duplicates (they're silently deduplicated) but draft is valid
    expect(errors.brokers).toBeUndefined();
    expect(errors.brokerRows).toBeUndefined();
  });

  it('normalizeBrokerEntries supports comma-delimited broker rows', () => {
    const normalized = normalizeBrokerEntries([
      'kafka1.example.com:9092, kafka2.example.com:9092',
      'kafka2.example.com:9092',
      '  kafka3.example.com:9093  ',
    ]);
    expect(normalized).toEqual([
      'kafka1.example.com:9092',
      'kafka2.example.com:9092',
      'kafka3.example.com:9093',
    ]);
  });

  it('validateKafkaClusterDraft accepts comma-delimited brokers in a single row', () => {
    const draft = defaultClusterDraft(99);
    draft.brokers = ['kafka1.example.com:9092, kafka2.example.com:9092'];
    const errors = validateKafkaClusterDraft(draft, [], null);
    expect(errors.brokerRows).toBeUndefined();
    expect(errors.brokers).toBeUndefined();
  });
});
