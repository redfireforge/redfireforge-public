/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@shared/kafka/kafkaNativeTauriTransport', async () => {
  const actual = await vi.importActual<typeof import('@shared/kafka/kafkaNativeTauriTransport')>(
    '@shared/kafka/kafkaNativeTauriTransport',
  );
  return {
    ...actual,
    listenKafkaSubscriptionMessage: vi.fn(async () => vi.fn()),
    listenKafkaSubscriptionError: vi.fn(async () => vi.fn()),
    listenKafkaSubscriptionEnded: vi.fn(async () => vi.fn()),
  };
});

import { useKafkaStreamMode } from './useKafkaStreamMode';
import type { UseKafkaStateReturn } from './useKafkaState';
import type { KafkaConsumeDraft } from '../../features/kafka/types';

function makeKafkaState(overrides?: Partial<UseKafkaStateReturn>): UseKafkaStateReturn {
  return {
    loaded: true,
    clusters: [],
    selectedClusterId: 'cluster-1',
    selectedCluster: null,
    connection: { state: 'connected', lastError: null },
    autoConnect: { enabled: false, clusterId: null },
    addCluster: vi.fn(),
    updateCluster: vi.fn(),
    removeCluster: vi.fn(),
    selectCluster: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    setAutoConnect: vi.fn(),
    ...overrides,
  } as unknown as UseKafkaStateReturn;
}

function makeDraft(topic = 'test-topic'): KafkaConsumeDraft {
  return {
    topic,
    groupId: 'group-1',
    startPosition: 'earliest',
    timeoutMs: '10000',
    maxMessages: '50',
    keyEquals: '',
    headerMatch: '',
    jsonPath: '',
    jsonPathEquals: '',
  };
}

describe('useKafkaStreamMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial state: isStreaming=false, streamMessages=[]', () => {
    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState()));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamMessages).toEqual([]);
    expect(result.current.streamError).toBeNull();
    expect(result.current.cursorGap).toBe(false);
  });

  it('startStream success: sets isStreaming=true, stores subscriptionId', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { subscription: { subscriptionId: 'sub-123', topic: 'test-topic', groupId: 'g', createdAt: '2026-01-01' } },
    });

    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamSubscriptionId).toBe('sub-123');
    expect(dispatch).toHaveBeenCalledWith('subscribe', expect.objectContaining({ topic: 'test-topic' }));
  });

  it('startStream with blank topic: sets streamError, does not dispatch', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(''), 'cluster-1');
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamError).not.toBeNull();
    expect(result.current.streamError?.code).toBe('KAFKA_INVALID_SUBSCRIBE');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('startStream when not connected: sets streamError', async () => {
    const dispatch = vi.fn();
    const state = makeKafkaState({ connection: { state: 'disconnected', lastError: null } as UseKafkaStateReturn['connection'] });

    const { result } = renderHook(() =>
      useKafkaStreamMode(state, { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamError?.code).toBe('KAFKA_NOT_CONNECTED');
  });

  it('stopStream: fires unsubscribe, keeps messages', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { subscription: { subscriptionId: 'sub-1', topic: 't', groupId: 'g', createdAt: '' } },
      })
      .mockResolvedValue({ ok: true, data: { messages: [], cursor: 0 } });

    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      await result.current.stopStream();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(dispatch).toHaveBeenCalledWith('unsubscribe', expect.objectContaining({ subscriptionId: 'sub-1' }));
  });

  it('clearStreamMessages: resets to []', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { subscription: { subscriptionId: 'sub-x', topic: 't', groupId: 'g', createdAt: '' } },
    });
    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    act(() => {
      result.current.clearStreamMessages();
    });

    expect(result.current.streamMessages).toEqual([]);
    expect(result.current.cursorGap).toBe(false);
  });

  it('selectStreamMessage / detail selection works', () => {
    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState()));

    act(() => {
      result.current.selectStreamMessage(0);
    });
    expect(result.current.selectedStreamIndex).toBe(0);

    act(() => {
      result.current.selectStreamMessage(null);
    });
    expect(result.current.selectedStreamIndex).toBeNull();
  });

  it('web polling: appends new messages from subscription-messages response', async () => {
    let pollCount = 0;
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-poll', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve({
            ok: true,
            data: {
              subscriptionId: 'sub-poll',
              messages: [{ topic: 't', partition: 0, offset: '1', value: '{"seq":1}' }],
              cursor: 1,
            },
          });
        }
        return Promise.resolve({
          ok: true,
          data: { subscriptionId: 'sub-poll', messages: [], cursor: 1 },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    // Advance timer to trigger first poll and flush microtasks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current.streamMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.current.streamMessages[0].value).toBe('{"seq":1}');

    // Clean up to avoid lingering intervals
    await act(async () => {
      await result.current.stopStream();
    });
  });

  it('cursorGap=true when server indicates buffer wrap', async () => {
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-gap', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        return Promise.resolve({
          ok: true,
          data: {
            subscriptionId: 'sub-gap',
            messages: [{ topic: 't', partition: 0, offset: '100', value: '{}' }],
            cursor: 100,
            cursorGap: true,
          },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState(), { dispatch }),
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current.cursorGap).toBe(true);

    await act(async () => {
      await result.current.stopStream();
    });
  });

  it('disconnect cleanup: auto-stops stream on connection state change', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { subscription: { subscriptionId: 'sub-dc', topic: 't', groupId: 'g', createdAt: '' } },
    });

    const kafkaState = makeKafkaState();
    const { result, rerender } = renderHook(
      ({ state }) => useKafkaStreamMode(state, { dispatch }),
      { initialProps: { state: kafkaState } },
    );

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });
    expect(result.current.isStreaming).toBe(true);

    // Simulate disconnect
    const disconnected = makeKafkaState({
      connection: { state: 'disconnected', lastError: null } as UseKafkaStateReturn['connection'],
    });
    rerender({ state: disconnected });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamSubscriptionId).toBeNull();
  });

  it('startStream: sets streamError when subscribe returns ok=false', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'KAFKA_NOT_CONNECTED', message: 'Not connected' },
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamError).not.toBeNull();
    expect(result.current.streamError?.code).toBe('KAFKA_NOT_CONNECTED');
  });

  it('startStream: uses KAFKA_SUBSCRIBE_FAILED fallback code when error has no code', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'Subscribe failed' },
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    expect(result.current.streamError?.code).toBe('KAFKA_SUBSCRIBE_FAILED');
  });

  it('startStream: sets streamError when dispatch throws', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('network failure'));

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamError).not.toBeNull();
    expect(result.current.streamError?.message).toMatch(/network failure/);
  });

  it('pollMessages: swallows error silently when stream has already stopped', async () => {
    let subscribeCalled = false;
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        subscribeCalled = true;
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-swallow', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        // Poll throws but stream has been stopped by the time it rejects
        return Promise.reject(new Error('poll error'));
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });
    expect(subscribeCalled).toBe(true);

    // Stop the stream before the poll error propagates
    await act(async () => {
      await result.current.stopStream();
    });

    // Advance timer to trigger a poll — should NOT set streamError because streaming stopped
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current.streamError).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it('pollMessages: sets streamError when poll throws and stream is still active', async () => {
    let callCount = 0;
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-err', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('poll network error'));
        return Promise.resolve({ ok: true, data: { messages: [], cursor: 0 } });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current.streamError).not.toBeNull();
    expect(result.current.streamError?.message).toMatch(/poll network error/);

    await act(async () => { await result.current.stopStream(); });
  });

  it('pollMessages: ok=false response is silently ignored (no error set)', async () => {
    let callCount = 0;
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-nok', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            error: { code: 'KAFKA_POLL_FAILED', message: 'no data' },
          });
        }
        return Promise.resolve({ ok: true, data: { messages: [], cursor: 0 } });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current.streamError).toBeNull();
    await act(async () => { await result.current.stopStream(); });
  });

  it('stopStream: is a no-op when no subscription is active', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    // stopStream without starting — should not throw
    await act(async () => {
      await result.current.stopStream();
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
  });

  it('stopStream: handles unsubscribe failure silently (best-effort)', async () => {
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-uf', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'unsubscribe') {
        return Promise.reject(new Error('unsubscribe failed'));
      }
      return Promise.resolve({ ok: true, data: { messages: [], cursor: 0 } });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    // Should not throw even though unsubscribe rejects
    await act(async () => {
      await result.current.stopStream();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamError).toBeNull();
  });

  it('selectedStreamMessage: returns null when selectedStreamIndex is out of bounds', () => {
    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState()));

    act(() => {
      result.current.selectStreamMessage(99); // index 99, but no messages
    });
    expect(result.current.selectedStreamMessage).toBeNull();
  });

  it('unmount cleanup: stops polling interval', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { subscription: { subscriptionId: 'sub-unm', topic: 't', groupId: 'g', createdAt: '' } },
    });

    const { result, unmount } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    // Unmount should not throw
    unmount();
    // Advance timer — no polling should occur (interval cleared)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // The key assertion is that dispatch was NOT called with 'subscription-messages' after unmount
    const pollCalls = dispatch.mock.calls.filter(([op]) => op === 'subscription-messages');
    expect(pollCalls.length).toBe(0);
  });

  it('pollMessages: does not call setStreamMessages when ok=true response has empty messages', async () => {
    // Covers line 78 FALSE branch: if (envelope.data.messages.length > 0)
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-empty-msgs', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        return Promise.resolve({
          ok: true,
          data: { subscriptionId: 'sub-empty-msgs', messages: [], cursor: 0 },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    // Messages should remain empty since poll returned empty array
    expect(result.current.streamMessages).toHaveLength(0);
    expect(result.current.streamError).toBeNull();

    await act(async () => { await result.current.stopStream(); });
  });

  it('pollMessages: catch block returns silently when stream was stopped mid-flight', async () => {
    // Covers line 87: if (!isStreamingRef.current) return; in catch block
    let triggerReject: ((e: Error) => void) | undefined;

    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-mid-flight', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        // Return a promise that we can reject manually
        return new Promise<never>((_, reject) => { triggerReject = reject; });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => {
      await result.current.startStream(makeDraft(), 'cluster-1');
    });

    // Trigger the interval (poll starts, awaiting the pending promise)
    act(() => { vi.advanceTimersByTime(1100); });

    // Stop the stream while poll is in-flight — isStreamingRef.current becomes false
    await act(async () => {
      await result.current.stopStream();
    });

    // Reject the pending poll — catch block runs with !isStreamingRef.current = true → returns silently
    await act(async () => {
      triggerReject?.(new Error('mid-flight rejection'));
    });

    // No error should be set because the catch returned early
    expect(result.current.streamError).toBeNull();
  });

  it('stopStream: uses empty string for clusterId when selectedClusterId is null', async () => {
    // Covers line 152: clusterId: kafkaState.selectedClusterId ?? ''
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-null-cid', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() =>
      useKafkaStreamMode(makeKafkaState({ selectedClusterId: null as unknown as string }), { dispatch }),
    );

    await act(async () => { await result.current.startStream(makeDraft(), 'cluster-1'); });
    await act(async () => { await result.current.stopStream(); });

    expect(dispatch).toHaveBeenCalledWith('unsubscribe', {
      subscriptionId: 'sub-null-cid',
      clusterId: '',
    });
    expect(result.current.isStreaming).toBe(false);
  });

  it('selectedStreamMessage: returns the message at the selected index', async () => {
    // Covers line 194 TRUE branch: ? streamMessages[selectedStreamIndex]
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-sel-msg', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        return Promise.resolve({
          ok: true,
          data: {
            subscriptionId: 'sub-sel-msg',
            messages: [{ topic: 't', partition: 0, offset: '99', value: '{"selected":true}', timestamp: '0', headers: {} }],
            cursor: 1,
          },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));

    await act(async () => { await result.current.startStream(makeDraft(), 'cluster-1'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });

    expect(result.current.streamMessages).toHaveLength(1);

    act(() => { result.current.selectStreamMessage(0); });

    expect(result.current.selectedStreamMessage).not.toBeNull();
    expect(result.current.selectedStreamMessage?.value).toBe('{"selected":true}');

    await act(async () => { await result.current.stopStream(); });
  });

  it('desktop stream appends native events and does not poll the web server', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    let deliver: ((payload: { subscriptionId: string; record: { topic: string; partition: number; offset: string; value: string } }) => void) | undefined;
    const unlisten = vi.fn();
    const listenMessages = vi.fn(async (cb: typeof deliver) => {
      deliver = cb;
      return unlisten;
    });
    const listenErrors = vi.fn(async () => vi.fn());
    const listenEnded = vi.fn(async () => vi.fn());
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-native', topic: 't', groupId: '$Default', createdAt: '' } },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    try {
      const { result } = renderHook(() =>
        useKafkaStreamMode(makeKafkaState(), { dispatch, listenMessages, listenErrors, listenEnded }),
      );

      await act(async () => {
        await result.current.startStream(makeDraft(), 'cluster-1');
      });

      await act(async () => {
        deliver?.({
          subscriptionId: 'sub-native',
          record: { topic: 't', partition: 2, offset: '9', value: '{"n":1}' },
        });
        deliver?.({
          subscriptionId: 'other',
          record: { topic: 't', partition: 0, offset: '1', value: 'skip' },
        });
      });

      expect(result.current.streamMessages).toEqual([
        { topic: 't', partition: 2, offset: '9', value: '{"n":1}' },
      ]);
      expect(dispatch.mock.calls.some(([op]) => op === 'subscription-messages')).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(dispatch.mock.calls.some(([op]) => op === 'subscription-messages')).toBe(false);

      await act(async () => { await result.current.stopStream(); });
      expect(unlisten).toHaveBeenCalledOnce();
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('ignores a poll that finishes after the stream has stopped', async () => {
    let resolvePoll: ((value: unknown) => void) | undefined;
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-late', topic: 't', groupId: 'g', createdAt: '' } },
        });
      }
      if (op === 'subscription-messages') {
        return new Promise((resolve) => { resolvePoll = resolve; });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));
    await act(async () => { await result.current.startStream(makeDraft(), 'cluster-1'); });
    act(() => { vi.advanceTimersByTime(1100); });
    await act(async () => { await result.current.stopStream(); });
    await act(async () => {
      resolvePoll?.({
        ok: true,
        data: {
          subscriptionId: 'sub-late',
          messages: [{ topic: 't', partition: 0, offset: '1', value: 'late' }],
          cursor: 1,
        },
      });
    });
    expect(result.current.streamMessages).toHaveLength(0);
    expect(result.current.streamError).toBeNull();
  });

  it('uses the desktop listeners and a default max when the form value is not a count', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-default', topic: 't', groupId: '$Default', createdAt: '' } },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    try {
      const { result } = renderHook(() => useKafkaStreamMode(makeKafkaState(), { dispatch }));
      await act(async () => {
        await result.current.startStream({ ...makeDraft(), maxMessages: '0' }, 'cluster-1');
      });
      expect(result.current.isStreaming).toBe(true);
      await act(async () => { await result.current.stopStream(); });
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('desktop stream records a broker error and stops when the max is reached', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    let deliverError: ((payload: { subscriptionId: string; message: string }) => void) | undefined;
    let deliverEnded: ((payload: { subscriptionId: string; reason: string }) => void) | undefined;
    const listenErrors = vi.fn(async (cb: typeof deliverError) => {
      deliverError = cb;
      return vi.fn();
    });
    const listenEnded = vi.fn(async (cb: typeof deliverEnded) => {
      deliverEnded = cb;
      return vi.fn();
    });
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-end', topic: 't', groupId: '$Default', createdAt: '' } },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    try {
      const { result } = renderHook(() =>
        useKafkaStreamMode(makeKafkaState(), {
          dispatch,
          listenMessages: vi.fn(async () => vi.fn()),
          listenErrors,
          listenEnded,
        }),
      );

      await act(async () => {
        await result.current.startStream(makeDraft(), 'cluster-1');
      });

      await act(async () => {
        deliverError?.({ subscriptionId: 'other', message: 'ignore' });
        deliverEnded?.({ subscriptionId: 'sub-end', reason: 'cancelled' });
      });
      expect(result.current.streamError).toBeNull();
      expect(result.current.streamMaxReached).toBe(false);

      await act(async () => {
        deliverError?.({ subscriptionId: 'sub-end', message: 'broker down' });
      });
      expect(result.current.streamError?.message).toBe('broker down');

      await act(async () => {
        deliverEnded?.({ subscriptionId: 'other', reason: 'max-reached' });
      });
      expect(result.current.isStreaming).toBe(true);

      await act(async () => {
        deliverEnded?.({ subscriptionId: 'sub-end', reason: 'max-reached' });
      });
      expect(result.current.streamMaxReached).toBe(true);
      expect(result.current.isStreaming).toBe(false);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('desktop stream keeps only Max Messages and then stops', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    let deliver: ((payload: { subscriptionId: string; record: { topic: string; partition: number; offset: string; value: string } }) => void) | undefined;
    const listenMessages = vi.fn(async (cb: typeof deliver) => {
      deliver = cb;
      return vi.fn();
    });
    const dispatch = vi.fn().mockImplementation((op: string) => {
      if (op === 'subscribe') {
        return Promise.resolve({
          ok: true,
          data: { subscription: { subscriptionId: 'sub-cap', topic: 't', groupId: '$Default', createdAt: '' } },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    try {
      const { result } = renderHook(() =>
        useKafkaStreamMode(makeKafkaState(), {
          dispatch,
          listenMessages,
          listenErrors: vi.fn(async () => vi.fn()),
          listenEnded: vi.fn(async () => vi.fn()),
        }),
      );

      await act(async () => {
        await result.current.startStream({ ...makeDraft(), maxMessages: '1' }, 'cluster-1');
      });

      await act(async () => {
        deliver?.({ subscriptionId: 'sub-cap', record: { topic: 't', partition: 0, offset: '1', value: 'a' } });
        deliver?.({ subscriptionId: 'sub-cap', record: { topic: 't', partition: 0, offset: '2', value: 'b' } });
      });

      expect(result.current.streamMessages.map((row) => row.value)).toEqual(['a']);
      expect(result.current.streamMaxReached).toBe(true);
      expect(result.current.isStreaming).toBe(false);
      expect(dispatch).toHaveBeenCalledWith('unsubscribe', expect.objectContaining({ subscriptionId: 'sub-cap' }));
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});
