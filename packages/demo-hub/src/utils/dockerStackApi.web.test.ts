/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => false,
}));

import {
  checkCertExpiry,
  checkDockerState,
  getDockerAvailableMemoryMb,
  getStackManifest,
  getStackStatus,
  listenDockerLogs,
  openDockerDesktop,
  readLastRunLog,
  startDockerStack,
  stopAllStacks,
  stopDockerStack,
} from './dockerStackApi';
import { resetLocalDockerHelperCache } from './localDockerApi';
import { DOCKER_DESKTOP_INSTALL_URL } from './dockerCommandDisplay';

describe('dockerStackApi with a local helper', () => {
  beforeEach(() => {
    resetLocalDockerHelperCache();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    });
    Object.defineProperty(navigator, 'webdriver', {
      configurable: true,
      value: false,
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLocalDockerHelperCache();
  });

  it('startDockerStack POSTs JSON and does not import Tauri', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 204,
      ok: true,
      text: async () => '',
    } as Response);
    await startDockerStack('kafka-plaintext', { build: true });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/__rff-docker/start');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
    });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).toContain('"stackKey":"kafka-plaintext"');
    expect(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).toContain('"build":true');
  });

  it('startDockerStack keeps PORT_CONFLICT prefixes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 409,
      ok: false,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ error: 'PORT_CONFLICT:[{"port":4010}]' }),
    } as Response);
    await expect(startDockerStack('graphql')).rejects.toThrow('PORT_CONFLICT:[{"port":4010}]');
  });

  it('startDockerStack remaps a network failure to helper unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(startDockerStack('graphql')).rejects.toThrow('START_FAILED:Docker helper unavailable');
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(startDockerStack('graphql')).rejects.toThrow('START_FAILED:Docker helper unavailable');
  });

  it('startDockerStack remaps a missing helper to START_FAILED', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 404,
      ok: false,
      statusText: 'Not Found',
      text: async () => '',
    } as Response);
    await expect(startDockerStack('graphql')).rejects.toThrow('START_FAILED:Docker helper unavailable');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/__rff-docker/start');
  });

  it('reads daemon, status, and manifest from the helper', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ docker: 'notRunning', running: [] }),
    } as Response);
    await expect(checkDockerState()).resolves.toBe('notRunning');
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/__rff-docker/state?running=0');

    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ running: true }),
    } as Response);
    await expect(getStackStatus('graphql')).resolves.toBe(true);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/__rff-docker/status/graphql');

    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ stackKey: 'graphql', certExpiresAt: null }),
    } as Response);
    await expect(getStackManifest('graphql')).resolves.toMatchObject({ stackKey: 'graphql' });
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/__rff-docker/manifest/graphql');
  });

  it('derives cert expiry from the helper manifest', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ stackKey: 'graphql-tls', certExpiresAt: '2000-01-01' }),
    } as Response);
    const cert = await checkCertExpiry('graphql-tls');
    expect(cert?.expiresAt).toBe('2000-01-01');
    expect(cert?.daysRemaining).toBeLessThanOrEqual(0);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it('stop and stop-all POST to the helper', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 204,
      ok: true,
      text: async () => '',
    } as Response);
    await stopDockerStack('graphql');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/__rff-docker/stop');

    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ stopped: ['rff-graphql'] }),
    } as Response);
    await expect(stopAllStacks()).resolves.toBe(true);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/__rff-docker/stop-all');
  });

  it('stop-all rethrows compose down failures so Settings does not say helper unavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 500,
      ok: false,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ error: 'docker compose down failed' }),
    } as Response);
    await expect(stopAllStacks()).rejects.toThrow('docker compose down failed');
  });

  it('stop-all returns false when the helper POST fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 404,
      ok: false,
      statusText: 'Not Found',
      text: async () => '',
    } as Response);
    await expect(stopAllStacks()).resolves.toBe(false);
  });

  it('openDockerDesktop POSTs then skips the docs URL on 204', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 204,
      ok: true,
      text: async () => '',
    } as Response);
    await openDockerDesktop();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/__rff-docker/open-desktop');
    expect(open).not.toHaveBeenCalled();
  });

  it('openDockerDesktop falls back to the docs URL on 501', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 501,
      ok: false,
      statusText: 'Not Implemented',
      text: async () => JSON.stringify({ error: 'Not implemented' }),
    } as Response);
    await openDockerDesktop();
    expect(open).toHaveBeenCalledWith(DOCKER_DESKTOP_INSTALL_URL, '_blank', 'noopener,noreferrer');
  });

  it('listenDockerLogs attaches EventSource without probing /health', async () => {
    class MockEventSource {
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(public url: string) {
        queueMicrotask(() => this.onopen?.());
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);
    const close = await listenDockerLogs(() => {});
    expect(close).toBeTypeOf('function');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    close();
  });

  it('reads available memory from the helper', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ availableMb: 2048 }),
    } as Response);
    await expect(getDockerAvailableMemoryMb()).resolves.toBe(2048);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/__rff-docker/memory');
  });

  it('readLastRunLog GETs text from the helper', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => '=== Starting graphql stack ===\n',
    } as Response);
    await expect(readLastRunLog('graphql')).resolves.toBe('=== Starting graphql stack ===\n');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/__rff-docker/last-run/graphql');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });
});
