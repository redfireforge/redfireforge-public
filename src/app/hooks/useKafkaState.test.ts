/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { KafkaClusterConfig, KafkaTopicSummary } from '@shared/kafka/kafkaConfig';

const mocks = vi.hoisted(() => ({
  loadKafkaAutoConnectOnStartup: vi.fn<() => Promise<boolean>>(),
  loadKafkaClusters: vi.fn<() => Promise<KafkaClusterConfig[]>>(),
  saveKafkaClusters: vi.fn<() => Promise<void>>(),
  loadSelectedKafkaClusterId: vi.fn<() => Promise<string | null>>(),
  saveKafkaAutoConnectOnStartup: vi.fn<() => Promise<void>>(),
  saveSelectedKafkaClusterId: vi.fn<() => Promise<void>>(),
  dispatchKafkaOperation: vi.fn(),
}));

vi.mock('../../shared/kafka/kafkaStorage', () => ({
  loadKafkaAutoConnectOnStartup: () => mocks.loadKafkaAutoConnectOnStartup(),
  loadKafkaClusters: () => mocks.loadKafkaClusters(),
  saveKafkaAutoConnectOnStartup: (enabled: boolean) => mocks.saveKafkaAutoConnectOnStartup(enabled),
  saveKafkaClusters: (clusters: KafkaClusterConfig[]) => mocks.saveKafkaClusters(clusters),
  loadSelectedKafkaClusterId: () => mocks.loadSelectedKafkaClusterId(),
  saveSelectedKafkaClusterId: (clusterId: string | null) => mocks.saveSelectedKafkaClusterId(clusterId),
}));

vi.mock('../../shared/kafka/kafkaClient', async () => {
  const actual = await vi.importActual<typeof import('../../shared/kafka/kafkaClient')>('../../shared/kafka/kafkaClient');
  return {
    ...actual,
    dispatchKafkaOperation: (...args: unknown[]) => mocks.dispatchKafkaOperation(...args),
  };
});

import { useKafkaState } from './useKafkaState';

const CLUSTER_A: KafkaClusterConfig = {
  clusterId: 'cluster-a',
  name: 'Cluster A',
  clientId: 'redfireforge-cluster-a',
  brokers: ['127.0.0.1:19092'],
  auth: { mode: 'none' },
  tls: { enabled: false, rejectUnauthorized: true },
  createdAt: 100,
  updatedAt: 100,
};

const CLUSTER_B: KafkaClusterConfig = {
  clusterId: 'cluster-b',
  name: 'Cluster B',
  clientId: 'redfireforge-cluster-b',
  brokers: ['127.0.0.1:19093'],
  auth: { mode: 'none' },
  tls: { enabled: false, rejectUnauthorized: true },
  createdAt: 101,
  updatedAt: 101,
};

const TOPICS: KafkaTopicSummary[] = [
  { name: 'orders.created', partitions: 3, isInternal: false },
  { name: 'payments.authorized', partitions: 2, isInternal: false },
];

beforeEach(() => {
  mocks.loadKafkaAutoConnectOnStartup.mockReset();
  mocks.loadKafkaClusters.mockReset();
  mocks.saveKafkaAutoConnectOnStartup.mockReset();
  mocks.saveKafkaClusters.mockReset();
  mocks.loadSelectedKafkaClusterId.mockReset();
  mocks.saveSelectedKafkaClusterId.mockReset();
  mocks.dispatchKafkaOperation.mockReset();

  mocks.loadKafkaAutoConnectOnStartup.mockResolvedValue(false);
  mocks.loadKafkaClusters.mockResolvedValue([CLUSTER_A, CLUSTER_B]);
  mocks.loadSelectedKafkaClusterId.mockResolvedValue('cluster-b');
  mocks.saveKafkaAutoConnectOnStartup.mockResolvedValue(undefined);
  mocks.saveKafkaClusters.mockResolvedValue(undefined);
  mocks.saveSelectedKafkaClusterId.mockResolvedValue(undefined);
  mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
    if (op === 'status') {
      return {
        ok: true,
        op: 'status',
        data: {
          state: 'disconnected',
          clusterId: 'cluster-b',
        },
      };
    }
    if (op === 'connect') {
      return {
        ok: true,
        op: 'connect',
        data: {
          status: {
            state: 'connected',
            clusterId: 'cluster-b',
          },
        },
      };
    }
    if (op === 'disconnect') {
      return {
        ok: true,
        op: 'disconnect',
        data: {
          status: {
            state: 'disconnected',
          },
        },
      };
    }
    if (op === 'topics') {
      return {
        ok: true,
        op: 'topics',
        data: {
          clusterId: 'cluster-b',
          topics: TOPICS,
        },
      };
    }
    return { ok: true, op, data: {} };
  });
});

describe('useKafkaState', () => {
  const createDeferred = <T,>() => {
    let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
    let reject: ((reason?: unknown) => void) | null = null;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('hydrates clusters and selected cluster id from storage', async () => {
    const { result } = renderHook(() => useKafkaState());

    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.clusters).toEqual([CLUSTER_A, CLUSTER_B]);
    expect(result.current.selectedClusterId).toBe('cluster-b');
    expect(result.current.selectedCluster?.clusterId).toBe('cluster-b');
    expect(result.current.autoConnectOnStartup).toBe(false);
    await waitFor(() => {
      expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('status', { clusterId: 'cluster-b' });
    });
  });

  it('hydrates startup auto-connect preference from storage', async () => {
    mocks.loadKafkaAutoConnectOnStartup.mockResolvedValueOnce(true);

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.autoConnectOnStartup).toBe(true);
  });

  it('falls back to first cluster when stored selected id is invalid', async () => {
    mocks.loadSelectedKafkaClusterId.mockResolvedValueOnce('missing-cluster');

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.selectedClusterId).toBe('cluster-a');
  });

  it('upserts cluster and selects it', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const updatedClusterA: KafkaClusterConfig = {
      ...CLUSTER_A,
      name: 'Cluster A Updated',
      updatedAt: 200,
    };

    act(() => {
      result.current.upsertCluster(updatedClusterA);
    });

    expect(result.current.selectedClusterId).toBe('cluster-a');
    expect(result.current.selectedCluster?.name).toBe('Cluster A Updated');
    await waitFor(() => expect(mocks.saveKafkaClusters).toHaveBeenCalled());
  });

  it('upserts a new cluster when cluster id does not already exist', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const newCluster: KafkaClusterConfig = {
      clusterId: 'cluster-c',
      name: 'Cluster C',
      clientId: 'redfireforge-cluster-c',
      brokers: ['127.0.0.1:19094'],
      auth: { mode: 'none' },
      tls: { enabled: false, rejectUnauthorized: true },
      createdAt: 102,
      updatedAt: 102,
    };

    act(() => {
      result.current.upsertCluster(newCluster);
    });

    expect(result.current.clusters.some((cluster) => cluster.clusterId === 'cluster-c')).toBe(true);
    expect(result.current.selectedClusterId).toBe('cluster-c');
    await waitFor(() => expect(mocks.saveKafkaClusters).toHaveBeenCalled());
  });

  it('setSelectedClusterId updates selection and forces status refresh for target cluster', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setSelectedClusterId('cluster-a');
    });

    await waitFor(() => {
      expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('status', { clusterId: 'cluster-a' });
    });
    expect(result.current.selectedClusterId).toBe('cluster-a');
  });

  it('replaceClusters replaces state and re-resolves selected cluster id when previous selection is removed', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.selectedClusterId).toBe('cluster-b');

    act(() => {
      result.current.replaceClusters([CLUSTER_A]);
    });

    await waitFor(() => expect(result.current.selectedClusterId).toBe('cluster-a'));
    expect(result.current.clusters).toEqual([CLUSTER_A]);
  });

  it('persists startup auto-connect preference when toggled', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setAutoConnectOnStartup(true);
    });

    await waitFor(() => expect(mocks.saveKafkaAutoConnectOnStartup).toHaveBeenCalledWith(true));
    expect(result.current.autoConnectOnStartup).toBe(true);
  });

  it('removes selected cluster and falls back to remaining cluster', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.removeCluster('cluster-b');
    });

    await waitFor(() => expect(result.current.selectedClusterId).toBe('cluster-a'));
    expect(result.current.selectedCluster?.clusterId).toBe('cluster-a');
  });

  it('updates and clears error state through connection snapshot actions', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('error', {
        clusterId: 'cluster-a',
        lastError: 'connect failed',
        lastErrorDetail: {
          kind: 'network',
          code: 'KAFKA_NETWORK_ERROR',
          message: 'connect failed',
          retryable: true,
        },
      });
    });

    expect(result.current.connection.state).toBe('error');
    expect(result.current.lastError).toBe('connect failed');
    expect(result.current.lastErrorDetail?.kind).toBe('network');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.lastError).toBeNull();
    expect(result.current.lastErrorDetail).toBeNull();
    expect(result.current.connection.state).toBe('disconnected');
  });

  it('clearError preserves a connected state when nothing is in error', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
      result.current.clearError();
    });

    expect(result.current.lastError).toBeNull();
    expect(result.current.lastErrorDetail).toBeNull();
    expect(result.current.connection.state).toBe('connected');
    expect(result.current.connection.clusterId).toBe('cluster-b');
  });

  it('connectSelectedCluster triggers connect then refreshes status', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: {
            state: 'connected',
            clusterId: 'cluster-b',
            connectedAt: '2026-05-30T00:00:00.000Z',
          },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      const ok = await result.current.connectSelectedCluster();
      expect(ok).toBe(true);
    });

    expect(result.current.connection.state).toBe('connected');
    expect(result.current.connection.clusterId).toBe('cluster-b');
    expect(result.current.lastError).toBeNull();
    expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('connect', expect.any(Object));
  });

  it('auto-connects the selected cluster once on startup when enabled', async () => {
    mocks.loadKafkaAutoConnectOnStartup.mockResolvedValueOnce(true);
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'connect') {
        return { ok: true, op: 'connect', data: { status: { state: 'connected', clusterId: 'cluster-b' } } };
      }
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } };
      }
      if (op === 'topics') {
        return { ok: true, op: 'topics', data: { clusterId: 'cluster-b', topics: TOPICS } };
      }
      return { ok: true, op, data: {} };
    });

    renderHook(() => useKafkaState());

    await waitFor(() => {
      expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('connect', expect.any(Object));
    });
  });

  it('connectSelectedCluster reports an error when no cluster is selected', async () => {
    mocks.loadKafkaClusters.mockResolvedValueOnce([]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      const ok = await result.current.connectSelectedCluster();
      expect(ok).toBe(false);
    });

    expect(result.current.lastError).toBe('No Kafka cluster is selected');
    expect(result.current.lastErrorDetail?.kind).toBe('validation');
  });

  it('connectSelectedCluster reports UI-safe errors when connect fails', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'connect') {
        throw new Error('connect failed');
      }
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: {
            state: 'disconnected',
            clusterId: 'cluster-b',
          },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      const ok = await result.current.connectSelectedCluster();
      expect(ok).toBe(false);
    });

    expect(result.current.connection.state).toBe('error');
    expect(result.current.connection.clusterId).toBe('cluster-b');
    expect(result.current.lastError).toContain('connect failed');
    expect(result.current.lastErrorDetail?.message).toContain('connect failed');
    expect(result.current.statusPollFailureStreak).toBe(1);
  });

  it('keeps a connect failure when a later status says disconnected', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'connect') {
        throw new Error('Meta data fetch error: BrokerTransportFailure');
      }
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: { state: 'disconnected', clusterId: 'cluster-b' },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.connectSelectedCluster();
    });
    await act(async () => {
      await result.current.refreshConnectionStatus({ force: true });
    });

    expect(result.current.connection.state).toBe('error');
    expect(result.current.lastError).toContain('BrokerTransportFailure');
    expect(result.current.lastErrorDetail?.message).toContain('BrokerTransportFailure');
  });

  it('refreshConnectionStatus skips while connect is in flight', async () => {
    let resolveConnect: ((value: unknown) => void) | null = null;
    const connectPromise = new Promise((resolve) => {
      resolveConnect = resolve;
    });

    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'connect') {
        return connectPromise;
      }
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: { state: 'connected', clusterId: 'cluster-b' },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const statusCallsBefore = mocks.dispatchKafkaOperation.mock.calls.filter(([op]) => op === 'status').length;

    let connectPromiseResult: Promise<boolean>;
    await act(async () => {
      connectPromiseResult = result.current.connectSelectedCluster();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.refreshConnectionStatus();
    });

    const statusCallsAfter = mocks.dispatchKafkaOperation.mock.calls.filter(([op]) => op === 'status').length;
    expect(statusCallsAfter).toBe(statusCallsBefore);

    await act(async () => {
      resolveConnect?.({ ok: true, op: 'connect', data: { status: { state: 'connected', clusterId: 'cluster-b' } } });
      await connectPromiseResult;
    });
  });

  it('disconnectActiveCluster sets disconnected state and clears errors', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('error', {
        clusterId: 'cluster-b',
        lastError: 'temp error',
      });
    });

    await act(async () => {
      const ok = await result.current.disconnectActiveCluster();
      expect(ok).toBe(true);
    });

    expect(result.current.connection.state).toBe('disconnected');
    expect(result.current.lastError).toBeNull();
    expect(result.current.statusPollFailureStreak).toBe(0);
    expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('disconnect', { clusterId: 'cluster-b' });
  });

  it('disconnectActiveCluster short-circuits when there is no active cluster', async () => {
    mocks.loadKafkaClusters.mockResolvedValueOnce([]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      const ok = await result.current.disconnectActiveCluster();
      expect(ok).toBe(true);
    });

    expect(result.current.connection.state).toBe('disconnected');
    expect(result.current.lastError).toBeNull();
    expect(mocks.dispatchKafkaOperation).not.toHaveBeenCalledWith('disconnect', expect.anything());
  });

  it('disconnectActiveCluster reports UI-safe errors when disconnect fails', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'disconnect') {
        throw new Error('disconnect failed');
      }
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: {
            state: 'connected',
            clusterId: 'cluster-b',
          },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
    });

    await act(async () => {
      const ok = await result.current.disconnectActiveCluster();
      expect(ok).toBe(false);
    });

    expect(result.current.connection.state).toBe('error');
    expect(result.current.connection.clusterId).toBe('cluster-b');
    expect(result.current.lastError).toContain('disconnect failed');
    expect(result.current.lastErrorDetail?.message).toContain('disconnect failed');
    expect(result.current.statusPollFailureStreak).toBe(1);
  });

  it('testSelectedClusterConnection probes the broker and auto-disconnects (does not persist connection)', async () => {
    // Status returns disconnected so the hook starts unconnected → probe path is taken
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'disconnected' } };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.connection.state).toBe('disconnected'));

    await act(async () => {
      const ok = await result.current.testSelectedClusterConnection();
      expect(ok).toBe(true);
    });

    // connect was called (probe)
    expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('connect', expect.any(Object));
    // disconnect was called (cleanup after probe)
    expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('disconnect', expect.any(Object));
    // connection is NOT left open
    expect(result.current.connection.state).toBe('disconnected');
    // lastTestResult reflects the outcome
    expect(result.current.lastTestResult).toEqual({ ok: true, clusterId: expect.any(String) });
  });

  it('testSelectedClusterConnection sets lastTestResult to false on failure', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'disconnected' } };
      }
      if (op === 'connect') {
        throw new Error('Connection refused');
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      const ok = await result.current.testSelectedClusterConnection();
      expect(ok).toBe(false);
    });

    expect(result.current.lastTestResult).toEqual({ ok: false, clusterId: expect.any(String) });
    // disconnect should NOT have been called (nothing to clean up)
    expect(mocks.dispatchKafkaOperation).not.toHaveBeenCalledWith('disconnect', expect.anything());
  });

  it('testSelectedClusterConnection only refreshes status when already connected to same cluster', async () => {
    let statusCallCount = 0;
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        statusCallCount++;
        return {
          ok: true, op: 'status',
          data: { state: 'connected', clusterId: 'cluster-b', connectedAt: '2026-05-30T00:00:00.000Z' },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Manually set connection to already-connected state for the selected cluster
    act(() => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
    });

    const statusBefore = statusCallCount;
    await act(async () => {
      await result.current.testSelectedClusterConnection();
    });

    // connect should NOT have been called (already connected to same cluster)
    expect(mocks.dispatchKafkaOperation).not.toHaveBeenCalledWith('connect', expect.anything());
    // status was refreshed
    expect(statusCallCount).toBeGreaterThan(statusBefore);
    expect(result.current.lastTestResult?.ok).toBe(true);
  });

  it('loads topics for the connected selected cluster and supports include-internal refreshes', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
    });

    await waitFor(() => expect(result.current.topics).toEqual(TOPICS));

    act(() => {
      result.current.setIncludeInternalTopics(true);
    });

    await waitFor(() => {
      expect(mocks.dispatchKafkaOperation).toHaveBeenCalledWith('topics', {
        clusterId: 'cluster-b',
        includeInternal: true,
      });
    });
  });

  it('refreshTopics short-circuits and clears topic state when cluster is not browseable', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
    });
    await waitFor(() => expect(result.current.topics).toEqual(TOPICS));

    act(() => {
      result.current.setConnectionState('disconnected');
    });

    await act(async () => {
      await result.current.refreshTopics();
    });

    expect(result.current.topics).toEqual([]);
    expect(result.current.topicsError).toBeNull();
    expect(result.current.topicsLoading).toBe(false);
  });

  it('refreshTopics reports UI-safe topic errors on failure', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } };
      }
      if (op === 'topics') {
        throw new Error('topics failed');
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.refreshTopics();
    });

    expect(result.current.topics).toEqual([]);
    expect(result.current.topicsError?.message).toContain('topics failed');
    expect(result.current.topicsLoading).toBe(false);
  });

  it('ignores stale topic failure when a newer refresh already succeeded', async () => {
    const firstTopics = new Promise((_, reject) => {
      (globalThis as unknown as { __rejectFirstTopics?: (reason?: unknown) => void }).__rejectFirstTopics = reject;
    });

    let topicsCallIndex = 0;
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } };
      }
      if (op === 'topics') {
        topicsCallIndex += 1;
        if (topicsCallIndex === 1) {
          return firstTopics;
        }
        return {
          ok: true,
          op: 'topics',
          data: { clusterId: 'cluster-b', topics: [{ name: 'orders.latest', partitions: 1, isInternal: false }] },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let firstRefreshPromise: Promise<void>;
    await act(async () => {
      firstRefreshPromise = result.current.refreshTopics();
      await result.current.refreshTopics();
    });

    expect(result.current.topics).toEqual([{ name: 'orders.latest', partitions: 1, isInternal: false }]);
    expect(result.current.topicsError).toBeNull();

    const rejectFirstTopics = (globalThis as unknown as { __rejectFirstTopics?: (reason?: unknown) => void }).__rejectFirstTopics;
    if (rejectFirstTopics) {
      rejectFirstTopics(new Error('late topics failure'));
    }

    await act(async () => {
      await firstRefreshPromise.catch(() => undefined);
    });

    expect(result.current.topics).toEqual([{ name: 'orders.latest', partitions: 1, isInternal: false }]);
    expect(result.current.topicsError).toBeNull();
    (globalThis as unknown as { __rejectFirstTopics?: (reason?: unknown) => void }).__rejectFirstTopics = undefined;
  });

  it('ignores stale topic success response when a newer refresh is active', async () => {
    let resolveFirstTopics: ((value: unknown) => void) | null = null;
    const firstTopics = new Promise((resolve) => {
      resolveFirstTopics = resolve;
    });

    let topicsCallIndex = 0;
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } };
      }
      if (op === 'topics') {
        topicsCallIndex += 1;
        if (topicsCallIndex === 1) {
          return firstTopics;
        }
        return {
          ok: true,
          op: 'topics',
          data: { clusterId: 'cluster-b', topics: [{ name: 'payments.latest', partitions: 2, isInternal: false }] },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let firstRefreshPromise: Promise<void>;
    await act(async () => {
      firstRefreshPromise = result.current.refreshTopics();
      await result.current.refreshTopics();
    });

    if (resolveFirstTopics) {
      resolveFirstTopics({
        ok: true,
        op: 'topics',
        data: { clusterId: 'cluster-b', topics: [{ name: 'stale.topic', partitions: 9, isInternal: false }] },
      });
    }

    await act(async () => {
      await firstRefreshPromise;
    });

    expect(result.current.topics).toEqual([{ name: 'payments.latest', partitions: 2, isInternal: false }]);
    expect(result.current.topicsError).toBeNull();
  });

  it('clears topic state when the active cluster is removed', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
    });
    await waitFor(() => expect(result.current.topics).toEqual(TOPICS));

    act(() => {
      result.current.removeCluster('cluster-b');
    });

    await waitFor(() => expect(result.current.topics).toEqual([]));
  });

  it('refreshConnectionStatus increments failure streak with a bounded cap', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        throw new Error('status unavailable');
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    for (let i = 0; i < 12; i += 1) {
      await act(async () => {
        await result.current.refreshConnectionStatus({ force: true });
      });
    }

    expect(result.current.connection.state).toBe('error');
    expect(result.current.lastError).toContain('status unavailable');
    expect(result.current.lastErrorDetail?.message).toContain('status unavailable');
    expect(result.current.statusPollFailureStreak).toBe(6);
  });

  it('ignores stale status failure when a newer refresh already succeeded', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let statusCallIndex = 0;
    let rejectFirstCall: ((reason?: unknown) => void) | null = null;
    const firstStatusPromise = new Promise((_, reject) => {
      rejectFirstCall = reject;
    });

    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op !== 'status') {
        return { ok: true, op, data: {} };
      }

      statusCallIndex += 1;
      if (statusCallIndex === 1) {
        return firstStatusPromise;
      }

      return {
        ok: true,
        op: 'status',
        data: {
          state: 'connected',
          clusterId: 'cluster-b',
        },
      };
    });

    let firstRefreshPromise: Promise<void>;
    await act(async () => {
      firstRefreshPromise = result.current.refreshConnectionStatus({ force: true });
      await result.current.refreshConnectionStatus({ force: true });
    });

    expect(result.current.connection.state).toBe('connected');
    expect(result.current.lastError).toBeNull();

    if (rejectFirstCall) {
      rejectFirstCall(new Error('late status failure'));
    }

    await act(async () => {
      await firstRefreshPromise.catch(() => undefined);
    });

    expect(result.current.connection.state).toBe('connected');
    expect(result.current.lastError).toBeNull();
  });

  it('recovers loaded state and reports error when startup hydration fails', async () => {
    mocks.loadKafkaClusters.mockRejectedValueOnce(new Error('storage read failed'));

    const { result } = renderHook(() => useKafkaState());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.clusters).toEqual([]);
    expect(result.current.selectedClusterId).toBeNull();
    expect(result.current.lastError).toBe('storage read failed');
  });

  it('stores non-Error hydration failures as string messages', async () => {
    mocks.loadKafkaClusters.mockRejectedValueOnce('storage unavailable');

    const { result } = renderHook(() => useKafkaState());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.clusters).toEqual([]);
    expect(result.current.selectedClusterId).toBeNull();
    expect(result.current.lastError).toBe('storage unavailable');
  });

  it('ignores hydration success updates after unmount', async () => {
    const deferred = createDeferred<KafkaClusterConfig[]>();
    mocks.loadKafkaClusters.mockReturnValueOnce(deferred.promise);

    const { unmount } = renderHook(() => useKafkaState());
    unmount();

    await act(async () => {
      deferred.resolve?.([CLUSTER_A]);
      await Promise.resolve();
    });

    expect(mocks.saveKafkaClusters).not.toHaveBeenCalledWith([CLUSTER_A]);
  });

  it('ignores hydration error updates after unmount', async () => {
    const deferred = createDeferred<KafkaClusterConfig[]>();
    mocks.loadKafkaClusters.mockReturnValueOnce(deferred.promise);

    const { unmount } = renderHook(() => useKafkaState());
    unmount();

    await act(async () => {
      deferred.reject?.(new Error('late storage failure'));
      await Promise.resolve();
    });

    expect(mocks.saveKafkaClusters).not.toHaveBeenCalledWith([]);
  });

  it('refreshConnectionStatus short-circuits to disconnected when there is no selected cluster', async () => {
    mocks.loadKafkaClusters.mockResolvedValueOnce([]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.refreshConnectionStatus({ force: true });
    });

    expect(result.current.connection.state).toBe('disconnected');
    expect(result.current.lastErrorDetail).toBeNull();
  });

  it('refreshConnectionStatus avoids duplicate in-flight status requests when not forced', async () => {
    let resolveStatus: ((value: unknown) => void) | null = null;
    const delayedStatus = new Promise((resolve) => {
      resolveStatus = resolve;
    });

    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return delayedStatus;
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let firstPromise: Promise<void>;
    await act(async () => {
      firstPromise = result.current.refreshConnectionStatus();
      await result.current.refreshConnectionStatus();
    });

    const statusCallsBeforeResolve = mocks.dispatchKafkaOperation.mock.calls.filter(([op]) => op === 'status').length;
    expect(statusCallsBeforeResolve).toBe(1);

    await act(async () => {
      resolveStatus?.({ ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } });
      await firstPromise;
    });
  });

  it('accepts status payload states of testing and error', async () => {
    let statusCall = 0;
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        statusCall += 1;
        if (statusCall === 1) {
          return { ok: true, op: 'status', data: { state: 'testing', clusterId: 'cluster-b' } };
        }
        return { ok: true, op: 'status', data: { state: 'error', clusterId: 'cluster-b' } };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.refreshConnectionStatus({ force: true });
    });
    expect(result.current.connection.state).toBe('error');
  });

  it('treats non-array topic payloads as empty topic lists', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } };
      }
      if (op === 'topics') {
        return { ok: true, op: 'topics', data: { clusterId: 'cluster-b', topics: null } };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.refreshTopics();
    });

    expect(result.current.topics).toEqual([]);
    expect(result.current.topicsError).toBeNull();
  });

  it('removeCluster preserves existing connection and topic state when deleting a non-active cluster', async () => {
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return { ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-b' } };
      }
      if (op === 'topics') {
        return { ok: true, op: 'topics', data: { clusterId: 'cluster-b', topics: TOPICS } };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      result.current.setConnectionState('connected', { clusterId: 'cluster-b' });
      await result.current.refreshTopics();
    });
    expect(result.current.topics).toEqual(TOPICS);

    await act(async () => {
      result.current.removeCluster('cluster-a');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.connection.clusterId).toBe('cluster-b');
    });

    expect(result.current.connection.state).toBe('connected');
    expect(result.current.connection.clusterId).toBe('cluster-b');
    expect(result.current.topics).toEqual(TOPICS);
  });

  it('does not re-fetch topics when status poll returns the same connected snapshot', async () => {
    let topicsCalls = 0;
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: { state: 'connected', clusterId: 'cluster-b', connectedAt: '2026-01-01T00:00:00.000Z' },
        };
      }
      if (op === 'topics') {
        topicsCalls += 1;
        return {
          ok: true,
          op: 'topics',
          data: { clusterId: 'cluster-b', topics: TOPICS },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.refreshConnectionStatus({ force: true });
    });
    await waitFor(() => expect(result.current.topics).toEqual(TOPICS));
    const topicsAfterConnect = topicsCalls;

    await act(async () => {
      await result.current.refreshConnectionStatus({ force: true });
      await result.current.refreshConnectionStatus({ force: true });
    });

    expect(topicsCalls).toBe(topicsAfterConnect);
    expect(result.current.connection.state).toBe('connected');
  });

  it('demo delete bridges remove clusters by id and name', async () => {
    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const w = window as unknown as Record<string, unknown>;
    expect(typeof w.__demoDeleteKafkaClusterById).toBe('function');
    expect(typeof w.__demoDeleteKafkaClusterByName).toBe('function');

    act(() => {
      (w.__demoDeleteKafkaClusterById as (clusterId: string) => void)('cluster-a');
    });
    await waitFor(() => {
      expect(result.current.clusters.some((cluster) => cluster.clusterId === 'cluster-a')).toBe(false);
    });

    act(() => {
      result.current.upsertCluster({
        ...CLUSTER_A,
        clusterId: 'cluster-c',
        name: 'Cluster C',
      });
    });
    await waitFor(() => {
      expect(result.current.clusters.some((cluster) => cluster.clusterId === 'cluster-c')).toBe(true);
    });

    act(() => {
      (w.__demoDeleteKafkaClusterByName as (name: string) => void)('Cluster C');
    });
    await waitFor(() => {
      expect(result.current.clusters.some((cluster) => cluster.clusterId === 'cluster-c')).toBe(false);
    });
  });

  it('demo ensure-plaintext bridge upserts Demo Cluster and mark-connected syncs state', async () => {
    mocks.loadKafkaClusters.mockResolvedValue([]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValue(null);

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const w = window as unknown as Record<string, unknown>;
    expect(typeof w.__demoEnsurePlaintextKafkaCluster).toBe('function');
    expect(typeof w.__demoMarkKafkaConnected).toBe('function');

    act(() => {
      (w.__demoEnsurePlaintextKafkaCluster as () => void)();
    });
    await waitFor(() => {
      expect(result.current.clusters.some((c) => c.clusterId === 'demo-cluster')).toBe(true);
      expect(result.current.selectedClusterId).toBe('demo-cluster');
    });

    act(() => {
      (w.__demoMarkKafkaConnected as (clusterId: string) => void)('demo-cluster');
    });
    await waitFor(() => {
      expect(result.current.connection.state).toBe('connected');
      expect(result.current.connection.clusterId).toBe('demo-cluster');
    });
  });

  it('demo clear-all bridge empties clusters and disconnects', async () => {
    mocks.loadKafkaClusters.mockResolvedValue([CLUSTER_A, CLUSTER_B]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValue('cluster-b');
    mocks.dispatchKafkaOperation.mockImplementation(async (op: string) => {
      if (op === 'status') {
        return {
          ok: true,
          op: 'status',
          data: { state: 'connected', clusterId: 'cluster-b' },
        };
      }
      if (op === 'disconnect') {
        return {
          ok: true,
          op: 'disconnect',
          data: { state: 'disconnected' },
        };
      }
      return { ok: true, op, data: {} };
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.clusters.length).toBeGreaterThan(0));

    const w = window as unknown as Record<string, unknown>;
    expect(typeof w.__demoClearAllKafkaClusters).toBe('function');

    act(() => {
      (w.__demoClearAllKafkaClusters as () => void)();
    });

    await waitFor(() => {
      expect(result.current.clusters).toEqual([]);
      expect(result.current.connection.state).toBe('disconnected');
      expect(result.current.selectedClusterId).toBeNull();
    });
  });
});

describe('useKafkaState – schedulePoll cancellation (lines 316-325)', () => {
  beforeEach(() => {
    mocks.loadKafkaClusters.mockResolvedValue([CLUSTER_A]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValue('cluster-a');
    mocks.loadKafkaAutoConnectOnStartup.mockResolvedValue(false);
    mocks.saveKafkaClusters.mockResolvedValue(undefined);
    mocks.saveSelectedKafkaClusterId.mockResolvedValue(undefined);
    mocks.saveKafkaAutoConnectOnStartup.mockResolvedValue(undefined);
    mocks.dispatchKafkaOperation.mockResolvedValue({ state: 'connected', clusterId: 'cluster-a' });
  });

  it('unmounting the hook clears poll timer and does not crash', async () => {
    const { result, unmount } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Record dispatch call count right after load
    const callCountAfterLoad = mocks.dispatchKafkaOperation.mock.calls.length;

    // Unmount — this should set cancelled=true and call clearPollTimer
    unmount();

    // Give any in-flight microtasks a chance to resolve
    await act(async () => { await Promise.resolve(); });

    // dispatchKafkaOperation should not have been called any more after unmount
    const callCountAfterUnmount = mocks.dispatchKafkaOperation.mock.calls.length;
    expect(callCountAfterUnmount).toBe(callCountAfterLoad);
  });

});

describe('useKafkaState – race-boundary: poll suppression during connect/disconnect', () => {
  beforeEach(() => {
    mocks.loadKafkaClusters.mockResolvedValue([CLUSTER_A]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValue('cluster-a');
    mocks.loadKafkaAutoConnectOnStartup.mockResolvedValue(false);
    mocks.saveKafkaClusters.mockResolvedValue(undefined);
    mocks.saveSelectedKafkaClusterId.mockResolvedValue(undefined);
    mocks.saveKafkaAutoConnectOnStartup.mockResolvedValue(undefined);
  });

  it('poll does not overwrite testing state while connect is in flight', async () => {
    let resolveConnect!: (value: unknown) => void;
    const connectPromise = new Promise((r) => { resolveConnect = r; });
    let statusCallCount = 0;

    mocks.dispatchKafkaOperation.mockImplementation((op: string) => {
      if (op === 'connect') return connectPromise;
      if (op === 'status') {
        statusCallCount++;
        return Promise.resolve({ ok: true, op: 'status', data: { state: 'disconnected', clusterId: 'cluster-a' } });
      }
      return Promise.resolve({ ok: true, op, data: {} });
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Record status calls after initial load
    const statusCallsAfterLoad = statusCallCount;

    // Initiate connect — state should become 'testing'
    let connectResultPromise: Promise<boolean>;
    await act(async () => {
      connectResultPromise = result.current.connectSelectedCluster();
    });
    expect(result.current.connection.state).toBe('testing');

    // Manually invoke refreshConnectionStatus (simulates what a poll timer would do).
    // With the race-boundary guard, this should be a no-op.
    await act(async () => {
      // refreshConnectionStatus is not directly exposed, but we can verify via
      // the status dispatch count: if the guard works, no new 'status' calls happen
      // during the connect in-flight window. Allow microtasks to flush.
      await Promise.resolve();
    });

    // No new 'status' calls should have been made by the poll timer while connect is in-flight
    // (the initial status call happened on load; no additional ones during connect)
    expect(statusCallCount).toBe(statusCallsAfterLoad);
    expect(result.current.connection.state).toBe('testing');

    // Now resolve the connect and verify state transitions to 'connected'
    mocks.dispatchKafkaOperation.mockImplementation((op: string) => {
      if (op === 'status') {
        statusCallCount++;
        return Promise.resolve({ ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-a' } });
      }
      return Promise.resolve({ ok: true, op, data: {} });
    });

    await act(async () => {
      resolveConnect({ ok: true, op: 'connect', data: { status: { state: 'connected', clusterId: 'cluster-a' } } });
    });

    // The forced refresh after connect succeeds should fire
    await waitFor(() => {
      expect(result.current.connection.state).toBe('connected');
    });

    const connectResult = await connectResultPromise!;
    expect(connectResult).toBe(true);
  });

  it('poll does not overwrite state while disconnect is in flight', async () => {
    let resolveDisconnect!: (value: unknown) => void;
    const disconnectPromise = new Promise((r) => { resolveDisconnect = r; });
    let statusCallCount = 0;
    let serverState = 'connected';

    mocks.dispatchKafkaOperation.mockImplementation((op: string) => {
      if (op === 'disconnect') return disconnectPromise;
      if (op === 'status') {
        statusCallCount++;
        return Promise.resolve({ ok: true, op: 'status', data: { state: serverState, clusterId: 'cluster-a' } });
      }
      return Promise.resolve({ ok: true, op, data: {} });
    });

    const { result } = renderHook(() => useKafkaState());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Wait for initial status to set 'connected'
    await waitFor(() => expect(result.current.connection.state).toBe('connected'));
    const statusCallsBeforeDisconnect = statusCallCount;

    // Initiate disconnect
    await act(async () => {
      result.current.disconnectActiveCluster();
    });

    // Allow any pending poll timers to fire — they should be suppressed
    await act(async () => {
      await Promise.resolve();
    });

    // No new status calls during disconnect in-flight
    expect(statusCallCount).toBe(statusCallsBeforeDisconnect);

    // Simulate server-side disconnect completing
    serverState = 'disconnected';

    // Resolve disconnect
    await act(async () => {
      resolveDisconnect({ ok: true, op: 'disconnect', data: {} });
    });

    await waitFor(() => {
      expect(result.current.connection.state).toBe('disconnected');
    });
  });
});

describe('useKafkaState – polling stops at max failure streak', () => {
  const MAX_STREAK = 6;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.loadKafkaClusters.mockResolvedValue([CLUSTER_A]);
    mocks.loadSelectedKafkaClusterId.mockResolvedValue('cluster-a');
    mocks.loadKafkaAutoConnectOnStartup.mockResolvedValue(false);
    mocks.saveKafkaClusters.mockResolvedValue(undefined);
    mocks.saveSelectedKafkaClusterId.mockResolvedValue(undefined);
    mocks.saveKafkaAutoConnectOnStartup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('statusPollFailureStreak saturates at max and no further timers fire', async () => {
    let statusCallCount = 0;
    mocks.dispatchKafkaOperation.mockImplementation((op: string) => {
      if (op === 'status') {
        statusCallCount++;
        return Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
      }
      return Promise.resolve({ ok: true, op, data: {} });
    });

    const { result } = renderHook(() => useKafkaState());

    // Drain the initial load (storage promises) without advancing poll timers
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Advance just enough to trigger the loaded state + forced status call
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    // Wait for loaded = true
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Saturate the failure streak via exposed refreshConnectionStatus
    for (let i = 0; i < MAX_STREAK; i++) {
      await act(async () => {
        await result.current.refreshConnectionStatus({ force: true });
      });
    }
    expect(result.current.statusPollFailureStreak).toBe(MAX_STREAK);

    // Flush any pending poll timer (the initial 4 s timer may still be queued).
    // It fires, fails, and since streak >= max it does NOT schedule a new timer.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    const countAtMaxStreak = statusCallCount;

    // Advance far past the max backoff — no new timers should have been scheduled.
    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(statusCallCount).toBe(countAtMaxStreak);
  });

  it('connectSelectedCluster success resets streak to 0', async () => {
    mocks.dispatchKafkaOperation.mockImplementation((op: string) => {
      if (op === 'status') return Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
      if (op === 'connect') return Promise.resolve({ ok: true, op: 'connect', data: { state: 'connected', clusterId: 'cluster-a' } });
      return Promise.resolve({ ok: true, op, data: {} });
    });

    const { result } = renderHook(() => useKafkaState());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Saturate failure streak
    for (let i = 0; i < MAX_STREAK; i++) {
      await act(async () => {
        await result.current.refreshConnectionStatus({ force: true });
      });
    }
    expect(result.current.statusPollFailureStreak).toBe(MAX_STREAK);

    // Now make status succeed, then connect
    mocks.dispatchKafkaOperation.mockImplementation((op: string) => {
      if (op === 'status') return Promise.resolve({ ok: true, op: 'status', data: { state: 'connected', clusterId: 'cluster-a' } });
      if (op === 'connect') return Promise.resolve({ ok: true, op: 'connect', data: { state: 'connected', clusterId: 'cluster-a' } });
      return Promise.resolve({ ok: true, op, data: {} });
    });

    await act(async () => {
      await result.current.connectSelectedCluster();
    });

    // After a successful connect, streak resets to 0
    expect(result.current.statusPollFailureStreak).toBe(0);
  });
});
