import { describe, expect, it } from 'vitest';
import type { KafkaClusterConfig, KafkaConnectionSnapshot } from '@shared/kafka/kafkaConfig';
import {
  canBrowseTopics,
  connectionSnapshotsEqual,
  nextBackoffDelayMs,
  parseConnectionState,
  resolveSelectedClusterId,
  toConnectRequest,
} from './kafkaStateHelpers';

const CLUSTER_A: KafkaClusterConfig = {
  clusterId: 'cluster-a',
  name: 'Cluster A',
  clientId: 'client-a',
  brokers: ['127.0.0.1:19092'],
  connectionTimeoutMs: 8000,
  requestTimeoutMs: 10000,
  auth: { mode: 'none' },
  tls: { enabled: false, rejectUnauthorized: true },
  createdAt: 1,
  updatedAt: 1,
};

const CLUSTER_B: KafkaClusterConfig = { ...CLUSTER_A, clusterId: 'cluster-b', name: 'Cluster B' };

function snapshot(overrides: Partial<KafkaConnectionSnapshot> = {}): KafkaConnectionSnapshot {
  return { state: 'connected', clusterId: 'cluster-a', ...overrides };
}

describe('kafkaStateHelpers', () => {
  it('keeps a selected cluster that still exists and falls back otherwise', () => {
    expect(resolveSelectedClusterId([CLUSTER_A, CLUSTER_B], 'cluster-b')).toBe('cluster-b');
    expect(resolveSelectedClusterId([CLUSTER_A], 'missing')).toBe('cluster-a');
    expect(resolveSelectedClusterId([], 'cluster-a')).toBeNull();
    expect(resolveSelectedClusterId([], null)).toBeNull();
  });

  it('backs off status polls and caps the delay', () => {
    expect(nextBackoffDelayMs(0)).toBe(4_000);
    expect(nextBackoffDelayMs(-2)).toBe(4_000);
    expect(nextBackoffDelayMs(2)).toBe(16_000);
    expect(nextBackoffDelayMs(6)).toBe(30_000);
    expect(nextBackoffDelayMs(20)).toBe(30_000);
  });

  it('wraps a cluster as a connect request', () => {
    expect(toConnectRequest(CLUSTER_A)).toEqual({
      connection: {
        clusterId: 'cluster-a',
        clientId: 'client-a',
        brokers: ['127.0.0.1:19092'],
        connectionTimeoutMs: 8000,
        requestTimeoutMs: 10000,
        auth: { mode: 'none' },
        tls: { enabled: false, rejectUnauthorized: true },
      },
    });
  });

  it('accepts known connection states and treats anything else as disconnected', () => {
    expect(parseConnectionState('connected')).toBe('connected');
    expect(parseConnectionState('testing')).toBe('testing');
    expect(parseConnectionState('error')).toBe('error');
    expect(parseConnectionState('nope')).toBe('disconnected');
    expect(parseConnectionState(undefined)).toBe('disconnected');
  });

  it('allows topic browse only for the connected selected cluster', () => {
    expect(canBrowseTopics(true, 'cluster-a', snapshot())).toBe(true);
    expect(canBrowseTopics(false, 'cluster-a', snapshot())).toBe(false);
    expect(canBrowseTopics(true, null, snapshot())).toBe(false);
    expect(canBrowseTopics(true, '', snapshot())).toBe(false);
    expect(canBrowseTopics(true, 'cluster-a', snapshot({ state: 'disconnected' }))).toBe(false);
    expect(canBrowseTopics(true, 'cluster-a', snapshot({ clusterId: 'other' }))).toBe(false);
  });

  it('treats matching connection snapshots as the same poll result', () => {
    const left = snapshot({ connectedAt: 't', lastError: 'x' });
    expect(connectionSnapshotsEqual(left, { ...left })).toBe(true);
    expect(connectionSnapshotsEqual(left, snapshot({ state: 'error', connectedAt: 't', lastError: 'x' }))).toBe(false);
    expect(connectionSnapshotsEqual(left, snapshot({ clusterId: 'other', connectedAt: 't', lastError: 'x' }))).toBe(false);
    expect(connectionSnapshotsEqual(left, snapshot({ connectedAt: 'other', lastError: 'x' }))).toBe(false);
    expect(connectionSnapshotsEqual(left, snapshot({ connectedAt: 't', lastError: 'other' }))).toBe(false);
  });
});
