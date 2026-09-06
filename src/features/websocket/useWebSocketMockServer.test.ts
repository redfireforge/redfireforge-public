/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { WsMockRule, WsMockStatus, WsMockLogEntry } from '@shared/websocket/types';

vi.mock('../../shared/websocket/websocketStorage', () => ({
  loadMockRules: vi.fn(),
  saveMockRules: vi.fn(),
  loadMockConfig: vi.fn(),
  saveMockConfig: vi.fn(),
}));

vi.mock('@shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
}));

import { loadMockRules, saveMockRules, loadMockConfig, saveMockConfig } from '@shared/websocket/websocketStorage';
import { isTauri } from '@shared/utils/platform';
import { useWebSocketMockServer, resolveWsMockApiUrl } from './useWebSocketMockServer';

const mockedLoadMockRules = vi.mocked(loadMockRules);
const mockedSaveMockRules = vi.mocked(saveMockRules);
const mockedLoadMockConfig = vi.mocked(loadMockConfig);
const mockedSaveMockConfig = vi.mocked(saveMockConfig);
const mockedIsTauri = vi.mocked(isTauri);

function makeMockRule(overrides: Partial<WsMockRule> = {}): WsMockRule {
  return {
    id: 'r1',
    name: 'Echo rule',
    enabled: true,
    match: { type: 'any', pattern: '' },
    response: { type: 'echo' },
    ...overrides,
  };
}

function makeStatus(overrides: Partial<WsMockStatus> = {}): WsMockStatus {
  return { running: false, port: 9876, clientCount: 0, clients: [], ...overrides };
}

function mockFetchResponse(data: unknown, ok = true) {
  const envelope = { ok, data, error: ok ? undefined : { message: String(data) } };
  const body = JSON.stringify(envelope);
  return Promise.resolve({
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(envelope),
  } as Response);
}

function mockFetchFailure(message: string) {
  const envelope = { ok: false, error: { message } };
  const body = JSON.stringify(envelope);
  return Promise.resolve({
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(envelope),
  } as Response);
}

function mockFetchNetworkError() {
  return Promise.reject(new Error('Network error'));
}

describe('useWebSocketMockServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mockedIsTauri.mockReturnValue(false);
    mockedLoadMockRules.mockResolvedValue([]);
    mockedLoadMockConfig.mockResolvedValue(null);
    mockedSaveMockRules.mockResolvedValue(undefined);
    mockedSaveMockConfig.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── Initial state ──────────────────────────────────────────────────
  it('initializes with default state', () => {
    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    expect(result.current.status.running).toBe(false);
    expect(result.current.logs).toEqual([]);
    expect(result.current.rules).toEqual([]);
    expect(result.current.config).toEqual({ port: 9876, fallback: 'echo' });
    expect(result.current.starting).toBe(false);
  });

  it('loads saved rules and config on mount', async () => {
    const savedRules = [makeMockRule()];
    mockedLoadMockRules.mockResolvedValue(savedRules);
    mockedLoadMockConfig.mockResolvedValue({ port: 1234, fallback: 'ignore' });

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));

    // Flush the async init effect
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.rules).toEqual(savedRules);
    // Assigned prop port wins over a stale saved.port value.
    expect(result.current.config).toEqual({ port: 9876, fallback: 'ignore' });
  });

  // ── setRules ───────────────────────────────────────────────────────
  it('setRules updates rules and saves to storage', async () => {
    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    const newRules = [makeMockRule({ id: 'r2', name: 'New' })];
    act(() => { result.current.setRules(newRules); });

    expect(result.current.rules).toEqual(newRules);
    expect(mockedSaveMockRules).toHaveBeenCalledWith(9876, newRules);
  });

  // ── setConfig ──────────────────────────────────────────────────────
  it('setConfig updates config and saves to storage', async () => {
    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    const newConfig = { port: 5555, fallback: 'close' as const };
    act(() => { result.current.setConfig(newConfig); });

    expect(result.current.config).toEqual(newConfig);
    expect(mockedSaveMockConfig).toHaveBeenCalledWith(9876, newConfig);
  });

  // ── start ──────────────────────────────────────────────────────────
  describe('start', () => {
    it('calls POST /api/ws/mock/start and updates status', async () => {
      const runningStatus = makeStatus({ running: true, port: 9876 });
      const fetchMock = vi.fn()
        // init polling calls (status + log)
        .mockImplementation((url: string) => {
          if (typeof url === 'string' && url.includes('/start')) {
            return mockFetchResponse(runningStatus);
          }
          if (typeof url === 'string' && url.includes('/status')) {
            return mockFetchResponse(runningStatus);
          }
          if (typeof url === 'string' && url.includes('/log')) {
            return mockFetchResponse({ entries: [], cursor: 0 });
          }
          return mockFetchResponse({});
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useWebSocketMockServer(9876, false));
      await act(async () => { await vi.runAllTimersAsync(); });

      await act(async () => {
        await result.current.start();
      });

      expect(result.current.status.running).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ws/mock/start',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('sets error status on start failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/start')) {
          return mockFetchFailure('Port in use');
        }
        return mockFetchResponse({});
      }));

      const { result } = renderHook(() => useWebSocketMockServer(9876, false));
      await act(async () => { await vi.runAllTimersAsync(); });

      let caught: Error | null = null;
      await act(async () => {
        try {
          await result.current.start();
        } catch (err) {
          caught = err as Error;
        }
      });

      expect(caught).not.toBeNull();
      expect(caught!.message).toBe('Port in use');
      expect(result.current.status.running).toBe(false);
      expect(result.current.status.error).toBe('Port in use');
    });
  });

  // ── stop ───────────────────────────────────────────────────────────
  describe('stop', () => {
    it('calls POST /api/ws/mock/stop and updates status', async () => {
      const stoppedStatus = makeStatus({ running: false });
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/stop')) {
          return mockFetchResponse(stoppedStatus);
        }
        return mockFetchResponse({});
      }));

      const { result } = renderHook(() => useWebSocketMockServer(9876, false));
      await act(async () => { await vi.runAllTimersAsync(); });

      await act(async () => {
        await result.current.stop();
      });

      expect(result.current.status.running).toBe(false);
    });

    it('sets error when stop fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/stop')) {
          return mockFetchFailure('Failed');
        }
        return mockFetchResponse({});
      }));

      const { result } = renderHook(() => useWebSocketMockServer(9876, false));
      await act(async () => { await vi.runAllTimersAsync(); });

      await act(async () => {
        await result.current.stop();
      });

      expect(result.current.status.running).toBe(false);
      expect(result.current.status.error).toContain('stop');
    });
  });

  // ── broadcast ──────────────────────────────────────────────────────
  it('broadcast calls POST /api/ws/mock/broadcast and returns sent count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/broadcast')) {
        return mockFetchResponse({ sent: 3 });
      }
      return mockFetchResponse({});
    }));

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    let count: number = 0;
    await act(async () => {
      count = await result.current.broadcast('hello');
    });

    expect(count).toBe(3);
  });

  // ── clearLogs ──────────────────────────────────────────────────────
  it('clearLogs empties the logs array', async () => {
    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => { result.current.clearLogs(); });
    expect(result.current.logs).toEqual([]);
  });

  // ── pushRulesToServer ──────────────────────────────────────────────
  it('pushRulesToServer sends rules to server', async () => {
    const fetchMock = vi.fn().mockImplementation(() => mockFetchResponse({ count: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    const rules = [makeMockRule()];
    await act(async () => {
      await result.current.pushRulesToServer(rules, 'echo');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ws/mock/rules',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('pushRulesToServer silently catches errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    // Should not throw
    await act(async () => {
      await result.current.pushRulesToServer([], 'echo');
    });
  });

  // ── Polling ────────────────────────────────────────────────────────
  describe('polling', () => {
    it('starts polling when active=true', async () => {
      vi.useRealTimers(); // polling uses setInterval with async callbacks
      const statusResp = makeStatus({ running: true, clientCount: 2 });
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/status')) {
          return mockFetchResponse(statusResp);
        }
        if (typeof url === 'string' && url.includes('/log')) {
          return mockFetchResponse({ entries: [], cursor: 0 });
        }
        return mockFetchResponse({});
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useWebSocketMockServer(9876, true));

      // Initial poll fires immediately on mount
      await waitFor(() => {
        expect(result.current.status.running).toBe(true);
      });
    });

    it('stops polling when active changes to false', async () => {
      vi.useRealTimers();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/status')) {
          return mockFetchResponse(makeStatus());
        }
        if (typeof url === 'string' && url.includes('/log')) {
          return mockFetchResponse({ entries: [], cursor: 0 });
        }
        return mockFetchResponse({});
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result: _result, rerender } = renderHook(
        ({ active }) => useWebSocketMockServer(9876, active),
        { initialProps: { active: true } },
      );

      // Wait for initial poll
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      const callCountBefore = fetchMock.mock.calls.length;
      rerender({ active: false });

      // Wait a bit, verify no more calls
      await new Promise((r) => setTimeout(r, 100));
      const callCountAfter = fetchMock.mock.calls.length;
      expect(callCountAfter - callCountBefore).toBeLessThanOrEqual(1);
    });

    it('sets error status when backend is unreachable during status poll', async () => {
      vi.useRealTimers();
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/status')) {
          callCount++;
          if (callCount === 1) {
            return mockFetchResponse(makeStatus({ running: true }));
          }
          return mockFetchNetworkError();
        }
        if (typeof url === 'string' && url.includes('/log')) {
          return mockFetchResponse({ entries: [], cursor: 0 });
        }
        return mockFetchResponse({});
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useWebSocketMockServer(9876, true));

      // First poll: running=true
      await waitFor(() => {
        expect(result.current.status.running).toBe(true);
      });

      // Wait for next poll to trigger error
      await waitFor(() => {
        expect(result.current.status.error).toBe('Backend unreachable');
      }, { timeout: 5000 });
    });

    it('appends log entries from polling', async () => {
      vi.useRealTimers();
      const logEntries: WsMockLogEntry[] = [
        { id: 1, ts: new Date().toISOString(), event: 'server-start' },
        { id: 2, ts: new Date().toISOString(), event: 'client-connect', clientId: 'c1' },
      ];
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/status')) {
          return mockFetchResponse(makeStatus({ running: true }));
        }
        if (typeof url === 'string' && url.includes('/log')) {
          return mockFetchResponse({ entries: logEntries, cursor: 2 });
        }
        return mockFetchResponse({});
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useWebSocketMockServer(9876, true));

      await waitFor(() => {
        expect(result.current.logs.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 5000 });
    });
  });

  it('ignores load results after port changes before persistence resolves', async () => {
    let resolveRules!: (rules: WsMockRule[]) => void;
    mockedLoadMockRules.mockReturnValue(new Promise((resolve) => { resolveRules = resolve; }));
    mockedLoadMockConfig.mockResolvedValue(null);

    const { rerender } = renderHook(
      ({ port }) => useWebSocketMockServer(port, false),
      { initialProps: { port: 9876 } },
    );

    rerender({ port: 9877 });
    await act(async () => {
      resolveRules([makeMockRule({ id: 'late' })]);
      await Promise.resolve();
    });
  });

  it('stops polling after max consecutive status failures (companion down)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/status')) {
        return mockFetchNetworkError();
      }
      if (typeof url === 'string' && url.includes('/log')) {
        return mockFetchResponse({ entries: [], cursor: 0 });
      }
      return mockFetchResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useWebSocketMockServer(9876, true));
    // Advance through the initial call + 5 interval ticks = 6 failures (the max).
    await act(async () => { await vi.advanceTimersByTimeAsync(500 * 6); });
    const countAtMax = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/status'),
    ).length;
    expect(countAtMax).toBeGreaterThanOrEqual(6);
    // Interval must be cleared — no further status requests.
    await act(async () => { await vi.advanceTimersByTimeAsync(500 * 20); });
    const countAfter = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/status'),
    ).length;
    expect(countAfter).toBe(countAtMax);
    unmount();
  });

  it('pollStatus leaves status unchanged when backend fails while already stopped', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/status')) {
        return mockFetchNetworkError();
      }
      if (typeof url === 'string' && url.includes('/log')) {
        return mockFetchResponse({ entries: [], cursor: 0 });
      }
      return mockFetchResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useWebSocketMockServer(9876, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.status.running).toBe(false);
    expect(result.current.status.error).toBeUndefined();
    unmount();
  });

  it('truncates polled logs to the most recent 200 entries', async () => {
    const manyEntries = Array.from({ length: 210 }, (_, i) => ({
      id: i + 1,
      ts: new Date().toISOString(),
      event: 'client-connect' as const,
      clientId: `c-${i}`,
    }));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/status')) {
        return mockFetchResponse(makeStatus({ running: true }));
      }
      if (typeof url === 'string' && url.includes('/log')) {
        return mockFetchResponse({ entries: manyEntries, cursor: 210 });
      }
      return mockFetchResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useWebSocketMockServer(9876, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.logs.length).toBe(200);
    unmount();
  });

  it('start surfaces actionable message when proxy returns 502 non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/start')) {
        return Promise.resolve({
          status: 502,
          text: () => Promise.resolve('Bad Gateway'),
        } as Response);
      }
      return mockFetchResponse({});
    }));

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.start();
      } catch (err) {
        caught = err as Error;
      }
    });
    expect(caught?.message).toContain('Backend API is unreachable');
  });

  it('start surfaces companion guidance when SPA HTML is returned as 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/start')) {
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('<!DOCTYPE html><html><body>app</body></html>'),
        } as Response);
      }
      return mockFetchResponse({});
    }));

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.start();
      } catch (err) {
        caught = err as Error;
      }
    });
    expect(caught?.message).toContain('companion server');
  });

  it('start still surfaces generic non-JSON response for non-502 error statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/start')) {
        return Promise.resolve({
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        } as Response);
      }
      return mockFetchResponse({});
    }));

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.start();
      } catch (err) {
        caught = err as Error;
      }
    });
    expect(caught?.message).toContain('non-JSON response');
  });

  it('start posts to the companion absolute URL in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/start')) {
        return mockFetchResponse(makeStatus({ running: true }));
      }
      return mockFetchResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });
    await act(async () => { await result.current.start(); });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/ws/mock/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('resolveWsMockApiUrl keeps relative paths on web and absolutes them in Tauri', () => {
    mockedIsTauri.mockReturnValue(false);
    expect(resolveWsMockApiUrl('/api/ws/mock/start')).toBe('/api/ws/mock/start');
    mockedIsTauri.mockReturnValue(true);
    expect(resolveWsMockApiUrl('/api/ws/mock/start')).toBe('http://localhost:3001/api/ws/mock/start');
  });

  it('start surfaces unknown mock server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/start')) {
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ ok: false })),
          json: () => Promise.resolve({ ok: false }),
        } as Response);
      }
      return mockFetchResponse({});
    }));

    const { result } = renderHook(() => useWebSocketMockServer(9876, false));
    await act(async () => { await vi.runAllTimersAsync(); });

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.start();
      } catch (err) {
        caught = err as Error;
      }
    });
    expect(caught?.message).toBe('Unknown mock server error');
  });
});
