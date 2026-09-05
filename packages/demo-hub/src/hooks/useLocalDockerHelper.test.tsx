/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Spread the real module so new platform exports (e.g. isLocalWebHost) stay wired.
vi.mock('@shared/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/utils/platform')>()),
  isTauri: vi.fn(() => false),
}));

import { isTauri } from '@shared/utils/platform';
import { resetLocalDockerHelperCache } from '../utils/localDockerApi';
import { HELPER_FAIL_THRESHOLD, HELPER_PROBE_INTERVAL_MS, useLocalDockerHelper } from './useLocalDockerHelper';

describe('useLocalDockerHelper', () => {
  beforeEach(() => {
    resetLocalDockerHelperCache();
    vi.mocked(isTauri).mockReturnValue(false);
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetLocalDockerHelperCache();
  });

  it('becomes helperOk after a successful health probe', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, docker: 'running' }),
    } as Response);
    const { result } = renderHook(() => useLocalDockerHelper());
    expect(result.current.enabled).toBe(true);
    await waitFor(() => expect(result.current.helperOk).toBe(true));
  });

  it('retries after a failed probe and becomes helperOk', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, docker: 'running' }),
      } as Response);
    const { result } = renderHook(() => useLocalDockerHelper());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.helperOk).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HELPER_PROBE_INTERVAL_MS);
    });
    expect(result.current.helperOk).toBe(true);
    vi.useRealTimers();
  });

  it('keeps helperOk after one failed probe so Start/Stop stay mounted', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, docker: 'running' }),
    } as Response);
    const { result } = renderHook(() => useLocalDockerHelper());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.helperOk).toBe(true);
    fetchMock.mockRejectedValue(new Error('down'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HELPER_PROBE_INTERVAL_MS);
    });
    expect(result.current.helperOk).toBe(true);
    for (let i = 1; i < HELPER_FAIL_THRESHOLD; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HELPER_PROBE_INTERVAL_MS);
      });
    }
    expect(result.current.helperOk).toBe(false);
    vi.useRealTimers();
  });

  it('stays off on hosted hostnames', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'app.redfireforge.com' },
    });
    const { result } = renderHook(() => useLocalDockerHelper());
    expect(result.current.enabled).toBe(false);
    expect(result.current.helperOk).toBe(false);
  });
});
