/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  certExpiryFromIsoDate,
  fetchLocalDockerLastRun,
  isLocalWebDockerEnabled,
  localDockerFetch,
  peekLocalDockerHelper,
  probeLocalDockerHelper,
  resetLocalDockerHelperCache,
  subscribeLocalDockerLogs,
} from './localDockerApi';

// Spread the real module so new platform exports (e.g. isLocalWebHost) stay wired.
vi.mock('@shared/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/utils/platform')>()),
  isTauri: vi.fn(() => false),
}));

import { isTauri } from '@shared/utils/platform';

describe('localDockerApi', () => {
  beforeEach(() => {
    resetLocalDockerHelperCache();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    });
    Object.defineProperty(navigator, 'webdriver', {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLocalDockerHelperCache();
  });

  it('enables only on loopback non-webdriver web', () => {
    expect(isLocalWebDockerEnabled()).toBe(true);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'app.localhost' },
    });
    expect(isLocalWebDockerEnabled()).toBe(true);
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: true });
    expect(isLocalWebDockerEnabled()).toBe(false);
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'demo.redfireforge.com' },
    });
    expect(isLocalWebDockerEnabled()).toBe(false);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'app.redfireforge.com' },
    });
    expect(isLocalWebDockerEnabled()).toBe(false);
    vi.mocked(isTauri).mockReturnValue(true);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    });
    expect(isLocalWebDockerEnabled()).toBe(false);
  });

  it('probes health and caches the result', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, docker: 'running' }),
    } as Response);
    await expect(probeLocalDockerHelper()).resolves.toBe(true);
    expect(peekLocalDockerHelper()).toBe(true);
    await expect(probeLocalDockerHelper()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a missing helper as false', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    await expect(probeLocalDockerHelper()).resolves.toBe(false);
    expect(peekLocalDockerHelper()).toBe(false);
  });

  it('shares one in-flight health probe across callers', async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValueOnce(pending as Promise<Response>);
    const first = probeLocalDockerHelper();
    const second = probeLocalDockerHelper();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    resolveFetch({
      ok: true,
      json: async () => ({ ok: true, docker: null }),
    } as Response);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed probe so the next call hits the network', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(probeLocalDockerHelper()).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, docker: 'running' }),
    } as Response);
    await expect(probeLocalDockerHelper()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns undefined for HTTP 204 and throws prefixed API errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 204,
      ok: true,
      text: async () => '',
    } as Response);
    await expect(localDockerFetch('/start', { method: 'POST', body: '{}' })).resolves.toBeUndefined();

    vi.mocked(fetch).mockResolvedValueOnce({
      status: 409,
      ok: false,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ error: 'PORT_CONFLICT:[{"port":4010}]' }),
    } as Response);
    await expect(localDockerFetch('/start', { method: 'POST', body: '{}' })).rejects.toThrow(
      'PORT_CONFLICT:[{"port":4010}]',
    );
  });

  it('reads last-run as text and treats 404 as null', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => '=== Starting graphql stack ===\n',
    } as Response);
    await expect(fetchLocalDockerLastRun('graphql')).resolves.toBe('=== Starting graphql stack ===\n');
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/__rff-docker/last-run/graphql');
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'no-store' });

    vi.mocked(fetch).mockResolvedValueOnce({
      status: 404,
      ok: false,
      text: async () => '',
    } as Response);
    await expect(fetchLocalDockerLastRun('graphql')).resolves.toBeNull();
  });

  it('opens EventSource on /logs and closes on unsubscribe', async () => {
    const instances: MockEventSource[] = [];
    class MockEventSource {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(url: string) {
        this.url = url;
        instances.push(this);
        queueMicrotask(() => this.onopen?.());
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);
    const lines: string[] = [];
    const close = await subscribeLocalDockerLogs((event) => {
      lines.push(`${event.stackKey}:${event.line}`);
    });
    expect(instances[0]?.url).toBe('/__rff-docker/logs');
    instances[0]?.onmessage?.({ data: JSON.stringify({ stackKey: 'graphql', line: 'hello' }) });
    expect(lines).toEqual(['graphql:hello']);
    close();
    expect(instances[0]?.close).toHaveBeenCalled();
  });

  it('rejects when EventSource construction throws', async () => {
    vi.stubGlobal('EventSource', class {
      constructor() {
        throw new Error('no sse');
      }
    });
    await expect(subscribeLocalDockerLogs(() => {})).rejects.toThrow('START_FAILED:Docker helper unavailable');
  });

  it('closes EventSource when aborted before open', async () => {
    const instances: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    class HangEventSource {
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor() {
        instances.push(this);
      }
    }
    vi.stubGlobal('EventSource', HangEventSource);
    const ac = new AbortController();
    const pending = subscribeLocalDockerLogs(() => {}, ac.signal);
    expect(instances[0]).toBeDefined();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(instances[0]?.close).toHaveBeenCalled();
  });

  it('rejects EventSource before open so attachLogs can retry', async () => {
    class FailEventSource {
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('EventSource', FailEventSource);
    await expect(subscribeLocalDockerLogs(() => {})).rejects.toThrow('START_FAILED:Docker helper unavailable');
  });

  it('computes UTC cert days and rejects unreadable dates', () => {
    expect(certExpiryFromIsoDate(null)).toEqual({ expiresAt: null, daysRemaining: null });
    expect(certExpiryFromIsoDate('not-a-date')).toBeNull();
    const noon = Date.UTC(2026, 8, 3);
    expect(certExpiryFromIsoDate('2026-09-03', noon)?.daysRemaining).toBe(0);
    expect(certExpiryFromIsoDate('2026-10-03', noon)?.daysRemaining).toBe(30);
    expect(certExpiryFromIsoDate('2027-03-22', noon)?.daysRemaining).toBe(200);
    expect(certExpiryFromIsoDate('2036-08-30', noon)?.daysRemaining).toBeGreaterThan(90);
    expect(certExpiryFromIsoDate('2000-01-01', noon)?.daysRemaining).toBeLessThanOrEqual(0);
  });
});
