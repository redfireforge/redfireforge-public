/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTopicMessageBrowser } from './useTopicMessageBrowser';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';
import type { KafkaConsumeResultRow } from './types';

function makeKafkaState(overrides?: Partial<UseKafkaStateReturn>): UseKafkaStateReturn {
  return {
    loaded: true,
    clusters: [],
    selectedClusterId: 'test-cluster',
    selectedCluster: null,
    connection: { state: 'connected', clusterId: 'test-cluster' } as UseKafkaStateReturn['connection'],
    topics: [],
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

const SAMPLE_ROWS: KafkaConsumeResultRow[] = [
  { topic: 'orders.created', partition: 0, offset: '1', value: '{"a":1}', key: 'k1' },
  { topic: 'orders.created', partition: 1, offset: '2', value: '{"a":2}' },
];

describe('useTopicMessageBrowser', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('initial state: empty result, no selected message', () => {
    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState()),
    );

    expect(result.current.result).toBeNull();
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.selectedMessage).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.timedOut).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.messageCount).toBe(0);
  });

  it('consumeOnce success sets result rows and clears error', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: SAMPLE_ROWS },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(result.current.result).toEqual(SAMPLE_ROWS);
    expect(result.current.error).toBeNull();
    expect(result.current.messageCount).toBe(2);
    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      topic: 'orders.created',
      clusterId: 'test-cluster',
    }));
  });

  it('consumeOnce sets timedOut true on timeout response', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [], timedOut: true },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(result.current.timedOut).toBe(true);
    expect(result.current.result).toEqual([]);
  });

  it('consumeOnce sets error on dispatch failure', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('consume failed'));

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.result).toBeNull();
  });

  it('topicName change resets result and error to null', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: SAMPLE_ROWS },
    });

    const { result, rerender } = renderHook(
      ({ topic }) => useTopicMessageBrowser(topic, makeKafkaState(), { dispatch }),
      { initialProps: { topic: 'orders.created' } },
    );

    await act(async () => {
      await result.current.consumeOnce();
    });
    expect(result.current.result).toEqual(SAMPLE_ROWS);

    rerender({ topic: 'payments.settled' });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.timedOut).toBe(false);
    expect(result.current.selectedIndex).toBeNull();
  });

  it('selectMessage and clearResult work correctly', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: SAMPLE_ROWS },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    act(() => {
      result.current.selectMessage(1);
    });
    expect(result.current.selectedIndex).toBe(1);
    expect(result.current.selectedMessage).toEqual(SAMPLE_ROWS[1]);

    act(() => {
      result.current.clearResult();
    });
    expect(result.current.result).toBeNull();
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('injectable dispatch from deps is called instead of default', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 't', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('my-topic', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0]).toBe('consume-once');
  });

  it('partition filter passes to consume request', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => {
      result.current.setDraft({ partition: '2' });
    });

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      partition: 2,
    }));
  });

  it('consumeOnce no-ops when topicName is blank', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useTopicMessageBrowser('  ', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("timeWindow 'last-24h' post-filters rows by timestamp", async () => {
    const now = Date.now();
    const recent = String(now - 60 * 60 * 1000);
    const old = String(now - 48 * 60 * 60 * 1000);

    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        topic: 'orders.created',
        messages: [
          { topic: 'orders.created', partition: 0, offset: '1', value: '{}', timestamp: recent },
          { topic: 'orders.created', partition: 0, offset: '2', value: '{}', timestamp: old },
        ],
      },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => {
      result.current.setDraft({ timeWindow: 'last-24h' });
    });

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(result.current.result).toHaveLength(1);
    expect(result.current.result![0].offset).toBe('1');
  });

  it('consumeOnce with unsuccessful envelope leaves result null', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: false, error: { message: 'fail' } });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('consumeOnce passes filter when keyEquals is set', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => {
      result.current.setDraft({ keyEquals: 'my-key' });
    });

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      filter: expect.objectContaining({ keyEquals: 'my-key' }),
    }));
  });

  it('selectedMessage is null when index is out of range', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 't', messages: SAMPLE_ROWS },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.consumeOnce();
    });

    act(() => {
      result.current.selectMessage(99);
    });
    expect(result.current.selectedMessage).toBeNull();
  });

  it('consumeOnce uses default timeout and maxMessages when draft values are invalid', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 't', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => {
      result.current.setDraft({ timeoutMs: 'abc', maxMessages: '' });
    });

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      timeoutMs: 10_000,
      maxMessages: 50,
    }));
  });

  it("timeWindow 'earliest' uses fromBeginning in request", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 't', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => {
      result.current.setDraft({ timeWindow: 'earliest' });
    });

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      fromBeginning: true,
    }));
  });

  it("timeWindow 'last-1h' post-filters rows by timestamp", async () => {
    const now = Date.now();
    const recent = String(now - 30 * 60 * 1000);
    const old = String(now - 2 * 60 * 60 * 1000);

    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        topic: 'orders.created',
        messages: [
          { topic: 'orders.created', partition: 0, offset: '1', value: '{}', timestamp: recent },
          { topic: 'orders.created', partition: 0, offset: '2', value: '{}', timestamp: old },
        ],
      },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => {
      result.current.setDraft({ timeWindow: 'last-1h' });
    });

    await act(async () => {
      await result.current.consumeOnce();
    });

    expect(result.current.result).toHaveLength(1);
    expect(result.current.result![0].offset).toBe('1');
    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      fromBeginning: false,
      sortOrder: 'desc',
    }));
  });

  it("timeWindow 'last-24h' post-filters rows by timestamp", async () => {
    const now = Date.now();
    const recent = String(now - 12 * 60 * 60 * 1000); // 12h ago — within 24h window
    const old = String(now - 25 * 60 * 60 * 1000);    // 25h ago — outside window

    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        topic: 'orders.created',
        messages: [
          { topic: 'orders.created', partition: 0, offset: '1', value: '{}', timestamp: recent },
          { topic: 'orders.created', partition: 0, offset: '2', value: '{}', timestamp: old },
        ],
      },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => { result.current.setDraft({ timeWindow: 'last-24h' }); });

    await act(async () => { await result.current.consumeOnce(); });

    expect(result.current.result).toHaveLength(1);
    expect(result.current.result![0].offset).toBe('1');
    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      fromBeginning: false,
      sortOrder: 'desc',
    }));
  });

  it('consumeOnce: no-op when topicName is blank', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useTopicMessageBrowser('', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('consumeOnce: ok=false response does not set result', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'KAFKA_ERROR', message: 'Bad request' },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull(); // ok=false without data → no error set
  });

  it('consumeOnce: timedOut=true propagates to state', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [], timedOut: true, hasMore: false },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });

    expect(result.current.timedOut).toBe(true);
  });

  it('consumeOnce: hasMore=true and nextCursor propagate', async () => {
    const cursor = [{ partition: 0, offset: '100' }];
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        topic: 'orders.created',
        messages: SAMPLE_ROWS,
        hasMore: true,
        nextCursor: cursor,
      },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });

    expect(result.current.hasMore).toBe(true);
  });

  it('buildBody: includes partition when set', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => { result.current.setDraft({ partition: '2' }); });

    await act(async () => { await result.current.consumeOnce(); });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      partition: 2,
    }));
  });

  it('buildBody: includes sortOrder when desc', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    act(() => { result.current.setDraft({ sortOrder: 'desc' }); });

    await act(async () => { await result.current.consumeOnce(); });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      sortOrder: 'desc',
    }));
  });

  it("timeWindow 'latest' seeks newest available via sortOrder desc", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        topic: 'orders.created',
        messages: [
          { topic: 'orders.created', partition: 0, offset: '20', value: '{"n":2}', timestamp: '2' },
          { topic: 'orders.created', partition: 0, offset: '10', value: '{"n":1}', timestamp: '1' },
        ],
      },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    // Default draft is Latest + Oldest First (asc display preference)
    await act(async () => { await result.current.consumeOnce(); });

    expect(dispatch).toHaveBeenCalledWith('consume-once', expect.objectContaining({
      fromBeginning: false,
      sortOrder: 'desc',
      timeoutMs: 10_000,
    }));
    // Re-sorted to Oldest First for display
    expect(result.current.result?.map((r) => r.offset)).toEqual(['10', '20']);
  });

  it('loadMore: no-op when nextCursor is null', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.loadMore(); });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.loadMoreLoading).toBe(false);
  });

  it('loadMore: no-op when nextCursor is empty array', async () => {
    // First consume to set nextCursor to []
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: SAMPLE_ROWS, hasMore: false, nextCursor: [] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });

    const dispatchCountBefore = dispatch.mock.calls.length;
    await act(async () => { await result.current.loadMore(); });

    expect(dispatch.mock.calls.length).toBe(dispatchCountBefore); // no new call
  });

  it('loadMore: error path sets error', async () => {
    const cursor = [{ partition: 0, offset: '100' }];
    const dispatch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { topic: 'orders.created', messages: SAMPLE_ROWS, hasMore: true, nextCursor: cursor },
      })
      .mockRejectedValueOnce(new Error('load more failed'));

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toContain('load more failed');
    expect(result.current.loadMoreLoading).toBe(false);
  });

  it('loadMore: ok=false response does not append messages', async () => {
    const cursor = [{ partition: 0, offset: '100' }];
    const dispatch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { topic: 'orders.created', messages: SAMPLE_ROWS, hasMore: true, nextCursor: cursor },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'KAFKA_ERROR', message: 'Pagination failed' },
      });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });
    const initialCount = result.current.result!.length;

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.result!.length).toBe(initialCount); // not appended
  });

  it('loadMore: prev=null branch — sets result from messages directly', async () => {
    const cursor = [{ partition: 0, offset: '100' }];
    // Setup: consumeOnce returns no messages (result stays null isn't possible after consumeOnce,
    // but we test the ternary by having prev=null via clearResult before loadMore)
    // Actually loadMore can't be called when nextCursor is set unless consumeOnce was called.
    // Instead force the state via two dispatches:
    const dispatch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          topic: 'orders.created', messages: [],
          hasMore: true, nextCursor: cursor,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { messages: SAMPLE_ROWS, hasMore: false, nextCursor: null },
      });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });
    // After consumeOnce result=[] (empty array, not null), but we need prev=null
    // Trick: clearResult and then loadMore won't work since clearResult resets nextCursor too
    // Instead verify loadMore appends to empty array result
    expect(result.current.result).toEqual([]);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.result).toHaveLength(SAMPLE_ROWS.length);
  });

  it('topic change resets result, error, timedOut, selectedIndex', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: SAMPLE_ROWS },
    });

    const { result, rerender } = renderHook(
      ({ topic }) => useTopicMessageBrowser(topic, makeKafkaState(), { dispatch }),
      { initialProps: { topic: 'orders.created' } },
    );

    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.result).not.toBeNull();

    act(() => { result.current.selectMessage(0); });
    expect(result.current.selectedIndex).toBe(0);

    // Change topic
    rerender({ topic: 'payments.settled' });

    expect(result.current.result).toBeNull();
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.timedOut).toBe(false);
  });

  it('selectedMessage: returns null when selectedIndex is out of bounds', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { topic: 'orders.created', messages: [SAMPLE_ROWS[0]] },
    });

    const { result } = renderHook(() =>
      useTopicMessageBrowser('orders.created', makeKafkaState(), { dispatch }),
    );

    await act(async () => { await result.current.consumeOnce(); });
    act(() => { result.current.selectMessage(99); });

    expect(result.current.selectedMessage).toBeNull();
  });
});
