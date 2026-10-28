/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useKafkaMessageStudio } from './useKafkaMessageStudio';
import { loadKafkaConsumeForm, loadKafkaConsumeTopic, loadKafkaPublishForm, saveKafkaConsumeForm, saveKafkaConsumeTopic, saveKafkaPublishForm } from '@shared/kafka/kafkaStorage';
import type { UseKafkaStateReturn } from './useKafkaState';
import type { KafkaEnvelope } from '@shared/kafka/kafkaClient';

// ── Mock kafkaState ────────────────────────────────────────────────────────

function makeKafkaState(overrides?: Partial<UseKafkaStateReturn>): UseKafkaStateReturn {
  return {
    loaded: true,
    clusters: [],
    connection: { state: 'connected', clusterId: 'cluster-a' },
    selectedClusterId: 'cluster-a',
    selectedCluster: null,
    topics: [],
    includeInternalTopics: false,
    setIncludeInternalTopics: vi.fn(),
    setSelectedClusterId: vi.fn(),
    refreshTopics: vi.fn(),
    saveCluster: vi.fn(),
    removeCluster: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    lastError: null,
    ...overrides,
  } as unknown as UseKafkaStateReturn;
}

// ── Mock dispatch helper ───────────────────────────────────────────────────

function makeDispatch<T>(result: KafkaEnvelope<T>) {
  return vi.fn().mockResolvedValue(result);
}

function okEnvelope<T>(data: T): KafkaEnvelope<T> {
  return { ok: true, data } as KafkaEnvelope<T>;
}

function errEnvelope(message: string, code = 'ERR'): KafkaEnvelope<never> {
  return { ok: false, error: { message, code, retryable: true } } as unknown as KafkaEnvelope<never>;
}

beforeEach(() => {
  localStorage.clear();
});

// ── Initial state ──────────────────────────────────────────────────────────

describe('useKafkaMessageStudio — initial state', () => {
  it('initialises with empty publish draft', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    expect(result.current.publishDraft.topic).toBe('');
    expect(result.current.publishDraft.acks).toBe(-1);
    expect(result.current.publishDraft.headers).toEqual([]);
  });

  it('initialises groupId with redfireforge-debug prefix', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    expect(result.current.consumeDraft.groupId).toMatch(/^redfireforge-debug-[0-9a-f]{8}$/);
  });

  it('has no results on mount', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    expect(result.current.publishResult).toBeNull();
    expect(result.current.consumeResult).toBeNull();
    expect(result.current.selectedMessage).toBeNull();
  });
});

// ── setPublishDraft ────────────────────────────────────────────────────────

describe('setPublishDraft', () => {
  it('patches individual fields', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setPublishDraft({ topic: 'orders.events' }); });
    expect(result.current.publishDraft.topic).toBe('orders.events');
    expect(result.current.publishDraft.acks).toBe(-1); // unchanged
  });
});

// ── setConsumeDraft ────────────────────────────────────────────────────────

describe('setConsumeDraft', () => {
  beforeEach(() => { localStorage.clear(); });

  it('patches individual fields', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setConsumeDraft({ topic: 'events.created' }); });
    expect(result.current.consumeDraft.topic).toBe('events.created');
    expect(result.current.consumeDraft.startPosition).toBe('latest'); // unchanged
  });

  it('restores the publish form after a restart and keeps later edits', async () => {
    await saveKafkaPublishForm('cluster-a', {
      topic: '221498-ons-retail-enrollment-event',
      key: 'order-1',
      keyFormat: 'string',
      partition: '',
      acks: -1,
      timeoutMs: '30000',
      headers: [{ id: 'h-1', key: 'application.name', value: 'ons-enrollment-core', enabled: true }],
      body: '{"messagingMode":"PRODUCTION"}',
      bodyFormat: 'json',
    });
    const { result } = renderHook(() => useKafkaMessageStudio(makeKafkaState()));
    await waitFor(() => {
      expect(result.current.publishDraft.topic).toBe('221498-ons-retail-enrollment-event');
    });
    expect(result.current.publishDraft.headers[0]?.key).toBe('application.name');
    expect(result.current.publishDraft.body).toContain('PRODUCTION');
    act(() => { result.current.setPublishDraft({ body: '{"messagingMode":"TEST"}' }); });
    await waitFor(async () => {
      expect((await loadKafkaPublishForm('cluster-a'))?.body).toBe('{"messagingMode":"TEST"}');
    });
  });

  it('restores the consume topic after a restart', async () => {
    await saveKafkaConsumeTopic('cluster-a', '222043-sales-offer');
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    await waitFor(() => {
      expect(result.current.consumeDraft.topic).toBe('222043-sales-offer');
    });
  });

  it('saves the consume topic for the selected cluster', async () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    await waitFor(() => expect(result.current.consumeDraft.topic).toBe(''));
    act(() => { result.current.setConsumeDraft({ topic: 'orders.events' }); });
    await waitFor(async () => {
      expect(await loadKafkaConsumeTopic('cluster-a')).toBe('orders.events');
    });
  });

  it('keeps a topic typed before the saved value loads', async () => {
    let release: (saved: Awaited<ReturnType<typeof loadKafkaConsumeForm>>) => void = () => {};
    const pending = new Promise<Awaited<ReturnType<typeof loadKafkaConsumeForm>>>((resolve) => { release = resolve; });
    const storage = await import('@shared/kafka/kafkaStorage');
    const load = vi.spyOn(storage, 'loadKafkaConsumeForm').mockReturnValue(pending);
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setConsumeDraft({ topic: 'typed-first' }); });
    await act(async () => {
      release({
        topic: 'saved-topic',
        groupId: '',
        startPosition: 'latest',
        timeoutMs: '',
        maxMessages: '',
        keyEquals: '',
        headerMatch: '',
        jsonPath: '$.saved',
        jsonPathEquals: 'saved',
        bodyContains: 'saved',
        sortOrder: 'asc',
      });
    });
    try {
      await waitFor(() => {
        expect(result.current.consumeDraft.topic).toBe('typed-first');
        expect(result.current.consumeDraft.jsonPath).toBe('');
      });
    } finally {
      load.mockRestore();
    }
  });

  it('restores consume filters after a restart', async () => {
    await saveKafkaConsumeForm('cluster-a', {
      topic: 'orders.events',
      groupId: 'redfireforge-debug-kept',
      startPosition: 'earliest',
      timeoutMs: '100000',
      maxMessages: '500',
      keyEquals: 'order-1',
      headerMatch: 'source=hub',
      jsonPath: '$.event.header.name',
      jsonPathEquals: 'OrderCreated',
      bodyContains: 'status',
      sortOrder: 'desc',
    });
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    await waitFor(() => {
      expect(result.current.consumeDraft.jsonPath).toBe('$.event.header.name');
    });
    expect(result.current.consumeDraft.jsonPathEquals).toBe('OrderCreated');
    expect(result.current.consumeDraft.bodyContains).toBe('status');
    expect(result.current.consumeDraft.headerMatch).toBe('source=hub');
    expect(result.current.consumeDraft.keyEquals).toBe('order-1');
    expect(result.current.consumeDraft.groupId).toBe('redfireforge-debug-kept');
    expect(result.current.consumeDraft.startPosition).toBe('earliest');
    expect(result.current.consumeDraft.maxMessages).toBe('500');
    expect(result.current.consumeDraft.sortOrder).toBe('desc');
  });

  it('saves consume filters for the selected cluster', async () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    await waitFor(() => expect(result.current.consumeDraft.topic).toBe(''));
    act(() => {
      result.current.setConsumeDraft({
        jsonPath: '$.event.header.name',
        jsonPathEquals: 'OrderCreated',
        bodyContains: 'status',
      });
    });
    await waitFor(async () => {
      const saved = await loadKafkaConsumeForm('cluster-a');
      expect(saved?.jsonPath).toBe('$.event.header.name');
      expect(saved?.jsonPathEquals).toBe('OrderCreated');
      expect(saved?.bodyContains).toBe('status');
    });
  });

  it('loads the topic for a newly selected cluster', async () => {
    await saveKafkaConsumeTopic('cluster-a', 'orders');
    await saveKafkaConsumeTopic('cluster-b', 'payments');
    const { result, rerender } = renderHook(
      ({ clusterId }: { clusterId: string }) => useKafkaMessageStudio(makeKafkaState({ selectedClusterId: clusterId })),
      { initialProps: { clusterId: 'cluster-a' } },
    );
    await waitFor(() => expect(result.current.consumeDraft.topic).toBe('orders'));
    rerender({ clusterId: 'cluster-b' });
    await waitFor(() => {
      expect(result.current.consumeDraft.topic).toBe('payments');
    });
  });

  it('clears the topic when the next cluster has none saved', async () => {
    await saveKafkaConsumeTopic('cluster-a', 'orders');
    const { result, rerender } = renderHook(
      ({ clusterId }: { clusterId: string }) => useKafkaMessageStudio(makeKafkaState({ selectedClusterId: clusterId })),
      { initialProps: { clusterId: 'cluster-a' } },
    );
    await waitFor(() => expect(result.current.consumeDraft.topic).toBe('orders'));
    rerender({ clusterId: 'cluster-b' });
    await waitFor(() => {
      expect(result.current.consumeDraft.topic).toBe('');
    });
  });
});

// ── validateJsonBody ───────────────────────────────────────────────────────

describe('validateJsonBody', () => {
  it('returns true and formats body for valid JSON', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setPublishDraft({ body: '{"a":1}' }); });
    let valid: boolean = false;
    act(() => { valid = result.current.validateJsonBody(); });
    expect(valid).toBe(true);
    expect(result.current.publishDraft.body).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(result.current.publishError).toBeNull();
  });

  it('returns false and sets publishError for invalid JSON', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setPublishDraft({ body: '{bad json}' }); });
    let valid: boolean = true;
    act(() => { valid = result.current.validateJsonBody(); });
    expect(valid).toBe(false);
    expect(result.current.publishError?.code).toBe('INVALID_JSON');
    expect(result.current.publishError?.retryable).toBe(false);
  });

  it('returns true for blank body', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    let valid: boolean = false;
    act(() => { valid = result.current.validateJsonBody(); });
    expect(valid).toBe(true);
  });
});

// ── sendOnce ──────────────────────────────────────────────────────────────

describe('sendOnce', () => {
  beforeEach(() => { resetAllMocks(); });

  it('sets publishResult on success', async () => {
    const mockResult = { topic: 'orders.events', sentCount: 1, records: [{ partition: 0, offset: '42' }] };
    const dispatch = makeDispatch(okEnvelope(mockResult));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 'orders.events', body: '{"hello":"world"}' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishResult).toEqual(mockResult);
    expect(result.current.publishError).toBeNull();
    expect(result.current.publishLoading).toBe(false);
    expect(dispatch).toHaveBeenCalledWith('produce', expect.objectContaining({ topic: 'orders.events', clusterId: 'cluster-a' }));
  });

  it('sets publishError on server error', async () => {
    const dispatch = makeDispatch(errEnvelope('Produce failed', 'TOPIC_MISSING'));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 't' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishResult).toBeNull();
    expect(result.current.publishError?.code).toBe('TOPIC_MISSING');
  });

  it('sets publishError on thrown exception', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('network failure'));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishError).not.toBeNull();
    expect(result.current.publishLoading).toBe(false);
  });

  it('clears previous result/error before new request', async () => {
    const dispatch = makeDispatch(okEnvelope({ topic: 't', sentCount: 1, records: [] }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    // Set a prior error
    act(() => { result.current.setPublishDraft({ body: '{bad}' }); });
    act(() => { result.current.validateJsonBody(); });
    expect(result.current.publishError).not.toBeNull();
    // Send should clear it then set result
    act(() => { result.current.setPublishDraft({ body: '{}', topic: 't' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishError).toBeNull();
  });

  it('rejects invalid JSON body before sending', async () => {
    const dispatch = vi.fn().mockResolvedValue(okEnvelope({}));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 't', body: '{bad json}' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.publishError?.code).toBe('INVALID_JSON');
    expect(result.current.publishError?.retryable).toBe(false);
  });

  it('allows empty body through to dispatch (server decides)', async () => {
    const dispatch = makeDispatch(okEnvelope({ topic: 't', sentCount: 1, records: [] }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 't', body: '' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(dispatch).toHaveBeenCalled();
  });
});

// ── consumeOnce ───────────────────────────────────────────────────────────

describe('consumeOnce', () => {
  beforeEach(() => { resetAllMocks(); });

  it('sets consumeResult on success', async () => {
    const messages = [
      { topic: 'orders', partition: 0, offset: '10', value: '{"id":1}', key: 'k1' },
    ];
    const dispatch = makeDispatch(okEnvelope({ messageCount: 1, messages, timedOut: false }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setConsumeDraft({ topic: 'orders' }); });
    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.consumeResult).toEqual(messages);
    expect(result.current.consumeTimedOut).toBe(false);
    expect(result.current.consumeError).toBeNull();
    expect(result.current.consumeMessageCount).toBe(1);
  });

  it('sets consumeTimedOut=true when server reports timedOut', async () => {
    const dispatch = makeDispatch(okEnvelope({ messageCount: 0, messages: [], timedOut: true }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.consumeTimedOut).toBe(true);
    expect(result.current.consumeResult).toEqual([]);
  });

  it('sets consumeError on server error', async () => {
    const dispatch = makeDispatch(errEnvelope('Consumer failed', 'GROUP_ERROR'));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.consumeResult).toBeNull();
    expect(result.current.consumeError?.code).toBe('GROUP_ERROR');
  });

  it('resets selectedMessageIndex on re-run', async () => {
    const messages = [
      { topic: 'o', partition: 0, offset: '1', value: '{}' },
      { topic: 'o', partition: 0, offset: '2', value: '{}' },
    ];
    const dispatch = makeDispatch(okEnvelope({ messageCount: 2, messages, timedOut: false }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    act(() => { result.current.selectMessage(1); });
    expect(result.current.selectedMessageIndex).toBe(1);
    // Re-run
    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.selectedMessageIndex).toBeNull();
  });
});

// ── selectMessage ─────────────────────────────────────────────────────────

describe('selectMessage', () => {
  it('returns the selected row', async () => {
    const messages = [
      { topic: 'o', partition: 0, offset: '1', value: '{"a":1}' },
    ];
    const dispatch = makeDispatch(okEnvelope({ messageCount: 1, messages, timedOut: false }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    act(() => { result.current.selectMessage(0); });
    expect(result.current.selectedMessage).toEqual(messages[0]);
  });

  it('returns null when index is null', async () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.selectMessage(null); });
    expect(result.current.selectedMessage).toBeNull();
  });
});

// ── clearPublishResult / clearConsumeResult ────────────────────────────────

describe('clearPublishResult', () => {
  it('clears result and error', async () => {
    const dispatch = makeDispatch(okEnvelope({ topic: 't', sentCount: 1, records: [] }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 't' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishResult).not.toBeNull();
    act(() => { result.current.clearPublishResult(); });
    expect(result.current.publishResult).toBeNull();
    expect(result.current.publishError).toBeNull();
  });
});

describe('clearConsumeResult', () => {
  it('clears result, error, timedOut and selection', async () => {
    const messages = [{ topic: 'o', partition: 0, offset: '1', value: '{}' }];
    const dispatch = makeDispatch(okEnvelope({ messageCount: 1, messages, timedOut: true }));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    act(() => { result.current.selectMessage(0); });
    act(() => { result.current.clearConsumeResult(); });
    expect(result.current.consumeResult).toBeNull();
    expect(result.current.consumeTimedOut).toBe(false);
    expect(result.current.consumeError).toBeNull();
    expect(result.current.selectedMessageIndex).toBeNull();
  });
});

// ── loadMore (pagination) ─────────────────────────────────────────────────

describe('loadMore', () => {
  beforeEach(() => { resetAllMocks(); });

  it('appends messages to existing result on success', async () => {
    const page1 = [{ topic: 'o', partition: 0, offset: '0', value: '{"p":1}' }];
    const page2 = [{ topic: 'o', partition: 0, offset: '1', value: '{"p":2}' }];

    const dispatch = vi.fn()
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1,
        messages: page1,
        timedOut: false,
        hasMore: true,
        nextCursor: [{ partition: 0, offset: '1' }],
      }))
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1,
        messages: page2,
        timedOut: false,
        hasMore: false,
        nextCursor: [],
      }));

    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setConsumeDraft({ topic: 'o' }); });
    await act(async () => { await result.current.consumeOnce(); });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.consumeResult).toHaveLength(1);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.consumeResult).toHaveLength(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('sets consumeError on server error during loadMore', async () => {
    const page1 = [{ topic: 'o', partition: 0, offset: '0', value: '{}' }];
    const dispatch = vi.fn()
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1,
        messages: page1,
        timedOut: false,
        hasMore: true,
        nextCursor: [{ partition: 0, offset: '1' }],
      }))
      .mockResolvedValueOnce(errEnvelope('Load more failed', 'PAGE_ERR'));

    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    await act(async () => { await result.current.loadMore(); });

    expect(result.current.consumeError?.code).toBe('PAGE_ERR');
  });

  it('does nothing when nextCursor is empty', async () => {
    const dispatch = vi.fn()
      .mockResolvedValue(okEnvelope({
        messageCount: 1,
        messages: [{ topic: 'o', partition: 0, offset: '0', value: '{}' }],
        timedOut: false,
        hasMore: false,
      }));

    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    // dispatch was called once for consumeOnce; no nextCursor so loadMore is no-op
    const callsBefore = dispatch.mock.calls.length;
    await act(async () => { await result.current.loadMore(); });
    expect(dispatch.mock.calls.length).toBe(callsBefore);
  });

  it('sets consumeError when loadMore dispatch throws', async () => {
    const page1 = [{ topic: 'o', partition: 0, offset: '0', value: '{}' }];
    const dispatch = vi.fn()
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1, messages: page1, timedOut: false,
        hasMore: true, nextCursor: [{ partition: 0, offset: '1' }],
      }))
      .mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    await act(async () => { await result.current.loadMore(); });

    expect(result.current.consumeError?.message).toBe('network error');
  });
});

// ── validateJsonBody ───────────────────────────────────────────────────────

describe('validateJsonBody', () => {
  it('returns true and formats valid JSON', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setPublishDraft({ body: '{"a":1}' }); });
    let valid = false;
    act(() => { valid = result.current.validateJsonBody(); });
    expect(valid).toBe(true);
    expect(result.current.publishDraft.body).toBe('{\n  "a": 1\n}');
    expect(result.current.publishError).toBeNull();
  });

  it('returns false and sets INVALID_JSON error for malformed JSON', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    act(() => { result.current.setPublishDraft({ body: '{bad json}' }); });
    let valid = true;
    act(() => { valid = result.current.validateJsonBody(); });
    expect(valid).toBe(false);
    expect(result.current.publishError?.code).toBe('INVALID_JSON');
    expect(result.current.publishError?.retryable).toBe(false);
  });

  it('clears prior INVALID_JSON error when JSON becomes valid', () => {
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState()),
    );
    // First invalidate
    act(() => { result.current.setPublishDraft({ body: 'bad' }); });
    act(() => { result.current.validateJsonBody(); });
    expect(result.current.publishError?.code).toBe('INVALID_JSON');
    // Then fix
    act(() => { result.current.setPublishDraft({ body: '{"fixed":true}' }); });
    act(() => { result.current.validateJsonBody(); });
    expect(result.current.publishError).toBeNull();
  });

  it('preserves non-INVALID_JSON errors when JSON is valid', async () => {
    const dispatch = makeDispatch(errEnvelope('Server error', 'SERVER_ERR'));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 't', body: '' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishError?.code).toBe('SERVER_ERR');
    // validateJsonBody with valid JSON should NOT clear non-INVALID_JSON errors
    act(() => { result.current.setPublishDraft({ body: '{"ok":true}' }); });
    act(() => { result.current.validateJsonBody(); });
    expect(result.current.publishError?.code).toBe('SERVER_ERR');
  });
});

// ── sendOnce throw path ────────────────────────────────────────────────────

describe('sendOnce — throw path', () => {
  it('sets publishError when dispatch throws', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    act(() => { result.current.setPublishDraft({ topic: 't' }); });
    await act(async () => { await result.current.sendOnce(); });
    expect(result.current.publishError?.message).toBe('network down');
    expect(result.current.publishLoading).toBe(false);
  });
});

// ── consumeOnce throw path ────────────────────────────────────────────────

describe('consumeOnce — throw path', () => {
  it('sets consumeError when dispatch throws', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('timeout'));
    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState(), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    expect(result.current.consumeError?.message).toBe('timeout');
    expect(result.current.consumeLoading).toBe(false);
  });
});

// ── loadMore branch coverage ──────────────────────────────────────────────

describe('loadMore — branch coverage', () => {
  beforeEach(() => { resetAllMocks(); });

  it('is a no-op when nextCursor is an empty array (length === 0)', async () => {
    // Covers the || nextCursor.length === 0 branch at line 212
    const dispatch = vi.fn().mockResolvedValueOnce(okEnvelope({
      messageCount: 1,
      messages: [{ topic: 'o', partition: 0, offset: '0', value: '{}' }],
      timedOut: false,
      hasMore: false,
      nextCursor: [], // empty array → loadMore should no-op
    }));

    const { result } = renderHook(() => useKafkaMessageStudio(makeKafkaState(), { dispatch }));
    await act(async () => { await result.current.consumeOnce(); });

    const callsBefore = dispatch.mock.calls.length;
    await act(async () => { await result.current.loadMore(); });
    expect(dispatch.mock.calls.length).toBe(callsBefore);
  });

  it('uses empty string clusterId when selectedClusterId is null', async () => {
    // Covers line 213: const clusterId = kafkaState.selectedClusterId ?? ''
    const page1 = [{ topic: 'o', partition: 0, offset: '0', value: '{}' }];
    const page2 = [{ topic: 'o', partition: 0, offset: '1', value: '{}' }];

    const dispatch = vi.fn()
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1, messages: page1, timedOut: false,
        hasMore: true, nextCursor: [{ partition: 0, offset: '1' }],
      }))
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1, messages: page2, timedOut: false,
        hasMore: false, nextCursor: undefined,
      }));

    const { result } = renderHook(() =>
      useKafkaMessageStudio(makeKafkaState({ selectedClusterId: null as unknown as string }), { dispatch }),
    );
    await act(async () => { await result.current.consumeOnce(); });
    await act(async () => { await result.current.loadMore(); });

    // loadMore should have run (dispatch called twice)
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.current.consumeResult).toHaveLength(2);
    // clusterId should be '' (empty string) since selectedClusterId was null
    const loadMoreCall = dispatch.mock.calls[1];
    expect(loadMoreCall[1]).toMatchObject({ clusterId: '' });
  });

  it('handles loadMore response with undefined hasMore and nextCursor', async () => {
    // Covers lines 231-232: ?? false and ?? null in loadMore success path
    const page1 = [{ topic: 'o', partition: 0, offset: '0', value: '{}' }];
    const page2 = [{ topic: 'o', partition: 0, offset: '1', value: '{}' }];

    const dispatch = vi.fn()
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1, messages: page1, timedOut: false,
        hasMore: true, nextCursor: [{ partition: 0, offset: '1' }],
      }))
      .mockResolvedValueOnce(okEnvelope({
        messageCount: 1, messages: page2, timedOut: false,
        // hasMore and nextCursor intentionally omitted → triggers ?? false and ?? null
      }));

    const { result } = renderHook(() => useKafkaMessageStudio(makeKafkaState(), { dispatch }));
    await act(async () => { await result.current.consumeOnce(); });
    await act(async () => { await result.current.loadMore(); });

    expect(result.current.hasMore).toBe(false);   // ?? false applied
    expect(result.current.consumeResult).toHaveLength(2);
    // nextCursor was undefined → ?? null → no more loadMore possible
    const callsBefore = dispatch.mock.calls.length;
    await act(async () => { await result.current.loadMore(); });
    expect(dispatch.mock.calls.length).toBe(callsBefore); // loadMore no-op (nextCursor=null)
  });
});

// ── selectedMessage out-of-bounds ─────────────────────────────────────────

describe('selectedMessage — out-of-bounds', () => {
  it('returns null when selectedMessageIndex is within consumeResult bounds check but index is out of range', async () => {
    // Covers line 261: ? (consumeResult[selectedMessageIndex] ?? null)
    // consumeResult = [] (empty array, truthy), selectedMessageIndex = 0
    // consumeResult[0] = undefined → ?? null → selectedMessage = null
    const dispatch = makeDispatch(okEnvelope({ messageCount: 0, messages: [], timedOut: false }));
    const { result } = renderHook(() => useKafkaMessageStudio(makeKafkaState(), { dispatch }));
    await act(async () => { await result.current.consumeOnce(); });
    // consumeResult = [] (empty array) — truthy in the ternary
    act(() => { result.current.selectMessage(0); });
    // consumeResult[0] = undefined → ?? null
    expect(result.current.selectedMessage).toBeNull();
  });
});
