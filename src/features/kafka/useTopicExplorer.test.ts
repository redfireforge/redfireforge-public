/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useTopicExplorer,
  type KafkaTopicDetail,
} from './useTopicExplorer';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';

function makeKafkaState(overrides?: Partial<UseKafkaStateReturn>): UseKafkaStateReturn {
  return {
    loaded: true,
    clusters: [],
    selectedClusterId: 'test-cluster',
    selectedCluster: null,
    connection: { state: 'connected', clusterId: 'test-cluster' } as UseKafkaStateReturn['connection'],
    topics: [
      { name: 'orders.created', partitions: 3, isInternal: false },
      { name: 'orders.updated', partitions: 6, isInternal: false },
      { name: 'payments.settled', partitions: 12, isInternal: false },
      { name: '__consumer_offsets', partitions: 50, isInternal: true },
    ],
    topicsLoading: false,
    topicsError: null,
    includeInternalTopics: false,
    lastError: null,
    lastErrorDetail: null,
    statusPollFailureStreak: 0,
    autoConnectOnStartup: false,
    setAutoConnectOnStartup: vi.fn(),
    setIncludeInternalTopics: vi.fn(),
    setSelectedClusterId: vi.fn(),
    upsertCluster: vi.fn(),
    removeCluster: vi.fn(),
    replaceClusters: vi.fn(),
    connectSelectedCluster: vi.fn(),
    disconnectActiveCluster: vi.fn(),
    testSelectedClusterConnection: vi.fn(),
    refreshConnectionStatus: vi.fn(),
    refreshTopics: vi.fn(),
    setConnectionState: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  } as unknown as UseKafkaStateReturn;
}

function makeDetail(name: string, overrides?: Partial<KafkaTopicDetail>): KafkaTopicDetail {
  return {
    name,
    partitionCount: 3,
    replicationFactor: 3,
    isInternal: false,
    partitions: [{
      partitionId: 0,
      leader: 1,
      replicas: [1, 2, 3],
      isr: [1, 2, 3],
      earliestOffset: '0',
      latestOffset: '1000',
      messageCount: 1000,
    }],
    consumerGroups: [],
    config: { 'retention.ms': '604800000', 'cleanup.policy': 'delete' },
    healthStatus: 'healthy',
    ...overrides,
  };
}

describe('useTopicExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initial state: all filters default, filteredTopics matches topics minus internals', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    expect(result.current.searchText).toBe('');
    expect(result.current.healthFilter).toBe('all');
    expect(result.current.partitionFilter).toBe('any');
    expect(result.current.retentionFilter).toBe('any');
    expect(result.current.showInternal).toBe(false);
    expect(result.current.domainChip).toBeNull();

    const names = result.current.filteredTopics.map((t) => t.name);
    expect(names).toEqual(['orders.created', 'orders.updated', 'payments.settled']);
    expect(names).not.toContain('__consumer_offsets');
  });

  it('searchText substring filters topic names', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    act(() => {
      result.current.setSearchText('payment');
    });

    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['payments.settled']);
  });

  it('healthFilter keeps healthy/degraded strict, but unknown includes unloaded topics', async () => {
    const dispatch = vi.fn().mockImplementation((op: string, body: { topicName?: string }) => {
      if (op === 'topic-detail' && body.topicName === 'orders.created') {
        return Promise.resolve({ ok: true, data: makeDetail('orders.created', { healthStatus: 'healthy' }) });
      }
      if (op === 'topic-detail' && body.topicName === 'payments.settled') {
        return Promise.resolve({ ok: true, data: makeDetail('payments.settled', { healthStatus: 'degraded' }) });
      }
      return Promise.resolve({ ok: true, data: makeDetail(body.topicName ?? '') });
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });
    await act(async () => {
      await result.current.selectTopic('payments.settled');
    });

    act(() => {
      result.current.setHealthFilter('healthy');
    });

    const names = result.current.filteredTopics.map((t) => t.name);
    expect(names).toContain('orders.created');
    expect(names).not.toContain('orders.updated');
    expect(names).not.toContain('payments.settled');

    act(() => {
      result.current.setHealthFilter('unknown');
    });

    const unknownNames = result.current.filteredTopics.map((t) => t.name);
    expect(unknownNames).toContain('orders.updated');
    expect(unknownNames).not.toContain('orders.created');
    expect(unknownNames).not.toContain('payments.settled');
  });

  it('partitionFilter 12+ includes topics with more than 12 partitions', () => {
    const state = makeKafkaState({
      topics: [{ name: 'big.topic', partitions: 13, isInternal: false }],
    });
    const { result } = renderHook(() => useTopicExplorer(state));

    act(() => {
      result.current.setPartitionFilter('12+');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['big.topic']);
  });

  it('partitionFilter bucket correctly categorizes counts (1-4, 5-12, 12+)', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    act(() => {
      result.current.setPartitionFilter('1-4');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.created']);

    act(() => {
      result.current.setPartitionFilter('5-12');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.updated', 'payments.settled']);

    act(() => {
      result.current.setShowInternal(true);
      result.current.setPartitionFilter('12+');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['__consumer_offsets']);
  });

  it('retentionFilter is strict and hides topics without loaded detail', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    act(() => {
      result.current.setRetentionFilter('<1d');
    });

    expect(result.current.filteredTopics.map((t) => t.name)).toEqual([]);
  });

  it('retentionFilter bucket correctly categorizes retention.ms values', async () => {
    const dispatch = vi.fn().mockImplementation((op: string, body: { topicName?: string }) => {
      if (body.topicName === 'orders.created') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('orders.created', { config: { 'retention.ms': '43200000' } }),
        });
      }
      if (body.topicName === 'orders.updated') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('orders.updated', { config: { 'retention.ms': '604800000' } }),
        });
      }
      if (body.topicName === 'payments.settled') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('payments.settled', { config: { 'retention.ms': '1209600000' } }),
        });
      }
      return Promise.resolve({ ok: true, data: makeDetail(body.topicName ?? '') });
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
      await result.current.selectTopic('orders.updated');
      await result.current.selectTopic('payments.settled');
    });

    act(() => {
      result.current.setRetentionFilter('<1d');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.created']);

    act(() => {
      result.current.setRetentionFilter('1-7d');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.updated']);

    act(() => {
      result.current.setRetentionFilter('>7d');
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['payments.settled']);
  });

  it('showInternal toggle shows/hides internal topics', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    act(() => {
      result.current.setShowInternal(true);
    });
    expect(result.current.filteredTopics.map((t) => t.name)).toContain('__consumer_offsets');

    act(() => {
      result.current.setShowInternal(false);
    });
    expect(result.current.filteredTopics.map((t) => t.name)).not.toContain('__consumer_offsets');
  });

  it('domainChip prefix filter narrows list', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    act(() => {
      result.current.setDomainChip('orders');
    });

    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.created', 'orders.updated']);
  });

  it('selectTopic fires topic-detail dispatch and caches result', async () => {
    const detail = makeDetail('orders.created');
    const dispatch = vi.fn().mockResolvedValue({ ok: true, data: detail });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });

    expect(dispatch).toHaveBeenCalledWith('topic-detail', {
      topicName: 'orders.created',
      clusterId: 'test-cluster',
    });
    expect(result.current.selectedTopicName).toBe('orders.created');
    expect(result.current.selectedDetail).toEqual(detail);
    expect(result.current.detailCache.get('orders.created')).toEqual(detail);
  });

  it('selectTopic loads consumer groups after a pending topic detail', async () => {
    const detail = { ...makeDetail('orders.created'), consumerGroups: [], groupsPending: true };
    const dispatch = vi.fn(async (op: string) => {
      if (op === 'topic-groups') {
        return { ok: true, data: { consumerGroups: [{ groupId: 'billing', state: 'Stable', totalLag: 2 }] } };
      }
      return { ok: true, data: detail };
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });

    await waitFor(() => {
      expect(result.current.selectedDetail?.consumerGroups).toEqual([
        { groupId: 'billing', state: 'Stable', totalLag: 2 },
      ]);
    });
    expect(result.current.detailLoading).toBe(false);
    expect(result.current.selectedDetail?.groupsPending).toBe(false);
  });

  it('clears the pending flag when the consumer-group load fails', async () => {
    const detail = { ...makeDetail('orders.created'), consumerGroups: [], groupsPending: true };
    const dispatch = vi.fn(async (op: string) => {
      if (op === 'topic-groups') throw new Error('groups down');
      return { ok: true, data: detail };
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });

    await waitFor(() => {
      expect(result.current.selectedDetail?.groupsPending).toBe(false);
    });
    expect(result.current.selectedDetail?.consumerGroups).toEqual([]);
  });

  it('selectTopic returns cached detail without re-dispatching on second call', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: makeDetail('orders.created'),
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });
    expect(dispatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.current.selectedDetail?.name).toBe('orders.created');
  });

  it('__lagging chip filters to topics with totalLag > 0', async () => {
    const dispatch = vi.fn().mockImplementation((op: string, body: { topicName?: string }) => {
      if (body.topicName === 'orders.created') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('orders.created', {
            consumerGroups: [{ groupId: 'g1', state: 'Stable', totalLag: 100 }],
          }),
        });
      }
      if (body.topicName === 'orders.updated') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('orders.updated', {
            consumerGroups: [{ groupId: 'g2', state: 'Stable', totalLag: 0 }],
          }),
        });
      }
      return Promise.resolve({ ok: true, data: makeDetail(body.topicName ?? '') });
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
      await result.current.selectTopic('orders.updated');
    });

    act(() => {
      result.current.setDomainChip('__lagging');
    });

    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.created']);
  });

  it('__active chip filters to topics with messageCount > 0', async () => {
    const dispatch = vi.fn().mockImplementation((op: string, body: { topicName?: string }) => {
      if (body.topicName === 'orders.created') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('orders.created', {
            partitions: [{
              partitionId: 0, leader: 1, replicas: [1], isr: [1],
              earliestOffset: '0', latestOffset: '10', messageCount: 500,
            }],
          }),
        });
      }
      if (body.topicName === 'payments.settled') {
        return Promise.resolve({
          ok: true,
          data: makeDetail('payments.settled', {
            partitions: [{
              partitionId: 0, leader: 1, replicas: [1], isr: [1],
              earliestOffset: '0', latestOffset: '0', messageCount: 0,
            }],
          }),
        });
      }
      return Promise.resolve({ ok: true, data: makeDetail(body.topicName ?? '') });
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
      await result.current.selectTopic('payments.settled');
    });

    act(() => {
      result.current.setDomainChip('__active');
    });

    expect(result.current.filteredTopics.map((t) => t.name)).toEqual(['orders.created']);
  });

  it('domainChips computed from topic name prefixes', () => {
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState()));

    expect(result.current.domainChips).toEqual(['orders', 'payments']);
  });

  it('selectTopic(null) clears selection without dispatch', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });
    const callsBefore = dispatch.mock.calls.length;

    await act(async () => {
      await result.current.selectTopic(null);
    });

    expect(result.current.selectedTopicName).toBeNull();
    expect(dispatch.mock.calls.length).toBe(callsBefore);
  });

  it('detailError set on dispatch failure', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('broker down'));

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });

    expect(result.current.detailError).not.toBeNull();
    expect(result.current.detailError?.message).toBeTruthy();
    expect(result.current.selectedDetail).toBeNull();
  });

  it('hasCachedDetails is false initially and true after a detail load', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: makeDetail('orders.created'),
    });

    const { result } = renderHook(() => useTopicExplorer(makeKafkaState(), { dispatch }));

    expect(result.current.hasCachedDetails).toBe(false);

    await act(async () => {
      await result.current.selectTopic('orders.created');
    });

    expect(result.current.hasCachedDetails).toBe(true);
  });
});
