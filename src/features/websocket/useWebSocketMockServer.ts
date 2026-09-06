import { useCallback, useEffect, useRef, useState } from 'react';
import { toErrorMessage } from '@shared/utils/helpers';
import { resolveCompanionServerUrl } from '@shared/utils/httpClient';
import { isTauri } from '@shared/utils/platform';
import type {
  WsMockRule,
  WsMockFallbackMode,
  WsMockLogEntry,
  WsMockStatus,
} from '@shared/websocket/types';
import { loadMockRules, saveMockRules, loadMockConfig, saveMockConfig } from '@shared/websocket/websocketStorage';

export interface MockServerConfig {
  port: number;
  fallback: WsMockFallbackMode;
}

export interface UseWebSocketMockServerReturn {
  status: WsMockStatus;
  logs: WsMockLogEntry[];
  rules: WsMockRule[];
  config: MockServerConfig;
  starting: boolean;
  setRules: (rules: WsMockRule[]) => void;
  setConfig: (config: MockServerConfig) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  broadcast: (data: string) => Promise<number>;
  clearLogs: () => void;
  pushRulesToServer: (rules: WsMockRule[], fallback: WsMockFallbackMode) => Promise<void>;
}

const POLL_INTERVAL_MS = 500;
const WS_POLL_MAX_FAILURE_STREAK = 6;

function emptyStatus(port: number): WsMockStatus {
  return { running: false, port, clientCount: 0, clients: [] };
}

/** Tauri has no Vite /api proxy — hit the companion on :3001 directly. */
export function resolveWsMockApiUrl(path: string): string {
  return isTauri() ? resolveCompanionServerUrl(path) : path;
}

async function mockFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { Accept: 'application/json' },
  };
  if (method !== 'GET' && body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(resolveWsMockApiUrl(path), init);
  let parsed: { ok: boolean; data?: T; error?: { message: string } };
  let rawPreview = '';

  try {
    // Prefer text() so HTML SPA shells (Tauri asset origin) can be diagnosed.
    if (typeof resp.text === 'function') {
      const rawBody = await resp.text();
      rawPreview = rawBody.slice(0, 120);
      parsed = JSON.parse(rawBody) as typeof parsed;
    } else if (typeof resp.json === 'function') {
      parsed = await resp.json() as typeof parsed;
    } else {
      throw new Error('No JSON body parser available');
    }
  } catch {
    if (resp.status === 502) {
      throw new Error(
        'Backend API is unreachable (HTTP 502). Start the local API server on port 3001 and retry.',
      );
    }
    const looksLikeHtml = /<!DOCTYPE|<html/i.test(rawPreview);
    if (looksLikeHtml || resp.status === 200) {
      throw new Error(
        'WebSocket mock API is unreachable (got a non-JSON response). '
        + 'Ensure the companion server is running on port 3001 and retry.',
      );
    }
    throw new Error(`Server returned ${resp.status} (non-JSON response)`);
  }
  if (!parsed.ok) throw new Error(parsed.error?.message ?? 'Unknown mock server error');
  return parsed.data as T;
}

/**
 * Manages one mock server instance scoped to `port`.
 * Each WebSocket tab calls this with its own assigned port so servers are isolated.
 * `active` controls whether status/log polling runs (only poll when Mock Server tab is visible).
 */
export function useWebSocketMockServer(port: number, active: boolean): UseWebSocketMockServerReturn {
  const [status, setStatus] = useState<WsMockStatus>(() => emptyStatus(port));
  const [logs, setLogs] = useState<WsMockLogEntry[]>([]);
  const [rules, setRulesState] = useState<WsMockRule[]>([]);
  const [config, setConfigState] = useState<MockServerConfig>({ port, fallback: 'echo' });
  const [starting, setStarting] = useState(false);
  const logCursorRef = useRef(-1);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollLogsInFlightRef = useRef(false);
  const pollFailureStreakRef = useRef(0);

  // Sync config.port whenever the port prop changes (e.g. user edits port while server is stopped).
  // The async load below may override this if there is a saved config for the new port.
  useEffect(() => {
    setConfigState((prev) => ({ ...prev, port }));
    setStatus(emptyStatus(port));
    setLogs([]);
    logCursorRef.current = -1;
  }, [port]);

  // Load persisted rules + config for this port on mount or port change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedRules = await loadMockRules(port);
      const saved = await loadMockConfig(port);
      if (cancelled) return;
      setRulesState(savedRules);
      if (saved) {
        // Always keep the tab-assigned port — never let a stale saved.port
        // (e.g. 9878 stored under a 9876 key) override the prop and desync
        // the URL preview from the port field.
        setConfigState({ port, fallback: saved.fallback as WsMockFallbackMode });
      }
    })();
    return () => { cancelled = true; };
  }, [port]);

  const setRules = useCallback((next: WsMockRule[]) => {
    setRulesState(next);
    void saveMockRules(port, next);
  }, [port]);

  const setConfig = useCallback((next: MockServerConfig) => {
    setConfigState(next);
    void saveMockConfig(port, next);
  }, [port]);

  const pushRulesToServer = useCallback(async (nextRules: WsMockRule[], nextFallback: WsMockFallbackMode) => {
    try {
      await mockFetch<{ count: number }>('POST', '/api/ws/mock/rules', {
        port,
        rules: nextRules,
        fallback: nextFallback,
      });
    } catch { /* server may not be running */ }
  }, [port]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const s = await mockFetch<WsMockStatus>('GET', `/api/ws/mock/status?port=${port}`);
      pollFailureStreakRef.current = 0;
      setStatus(s);
    } catch {
      setStatus((prev) => prev.running ? { ...prev, running: false, error: 'Backend unreachable' } : prev);
      pollFailureStreakRef.current++;
      if (pollFailureStreakRef.current >= WS_POLL_MAX_FAILURE_STREAK) {
        stopPolling();
      }
    }
  }, [port, stopPolling]);

  const pollLogs = useCallback(async () => {
    // Prevent overlapping concurrent polls — avoids duplicate entries.
    if (pollLogsInFlightRef.current) return;
    pollLogsInFlightRef.current = true;
    try {
      const resp = await mockFetch<{ entries: WsMockLogEntry[]; cursor: number }>(
        'GET',
        `/api/ws/mock/log?port=${port}&sinceCursor=${logCursorRef.current}`,
      );
      if (resp.entries.length > 0) {
        logCursorRef.current = resp.cursor;
        setLogs((prev) => {
          const combined = [...prev, ...resp.entries];
          return combined.length > 200 ? combined.slice(-200) : combined;
        });
      }
    } catch { /* ignore */ }
    finally {
      pollLogsInFlightRef.current = false;
    }
  }, [port]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      pollStatus();
      pollLogs();
    }, POLL_INTERVAL_MS);
  }, [pollStatus, pollLogs]);

  useEffect(() => {
    if (!active) {
      stopPolling();
      return;
    }
    pollFailureStreakRef.current = 0;
    pollStatus();
    pollLogs();
    startPolling();
    return stopPolling;
  }, [active, pollStatus, pollLogs, startPolling, stopPolling]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const s = await mockFetch<WsMockStatus>('POST', '/api/ws/mock/start', {
        port,
        rules,
        fallback: config.fallback,
      });
      setStatus(s);
      logCursorRef.current = -1;
      setLogs([]);
      pollLogs();
    } catch (err) {
      setStatus((prev) => ({ ...prev, running: false, error: toErrorMessage(err) }));
      throw err;
    } finally {
      setStarting(false);
    }
  }, [port, config.fallback, rules, pollLogs]);

  const stop = useCallback(async () => {
    try {
      const s = await mockFetch<WsMockStatus>('POST', '/api/ws/mock/stop', { port });
      setStatus(s);
    } catch {
      setStatus((prev) => ({ ...prev, running: false, error: 'Failed to stop server — it may already be stopped' }));
    }
  }, [port]);

  const broadcast = useCallback(async (data: string): Promise<number> => {
    const resp = await mockFetch<{ sent: number }>('POST', '/api/ws/mock/broadcast', { port, data });
    return resp.sent;
  }, [port]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    status,
    logs,
    rules,
    config,
    starting,
    setRules,
    setConfig,
    start,
    stop,
    broadcast,
    clearLogs,
    pushRulesToServer,
  };
}
