/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppUpdater } from './useAppUpdater';

const mockIsTauri = vi.fn(() => false);
const mockIsLocalhost = vi.fn(() => false);
vi.mock('../../shared/utils/platform', () => ({
  isTauri: () => mockIsTauri(),
  isLocalhost: () => mockIsLocalhost(),
}));

const mockFetchLatestRelease = vi.fn();
const mockIsNewerVersion = vi.fn(() => false);
vi.mock('../../shared/utils/latestRelease', () => ({
  fetchLatestRelease: (...args: unknown[]) => mockFetchLatestRelease(...args),
  getCurrentVersion: () => '1.0.0',
  isNewerVersion: (...args: unknown[]) => mockIsNewerVersion(...args),
  isOfficialStableRelease: (v: string) => /^\d+\.\d+\.\d+$/.test(v.replace(/^v/, '')),
}));

const mockCheck = vi.fn();
const mockRelaunch = vi.fn();
const mockWriteKey = vi.fn(async () => undefined);
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args),
}));
vi.mock('../../shared/utils/storage', () => ({
  writeKey: (...args: unknown[]) => mockWriteKey(...args),
}));

const CHECK_DELAY_MS = 3000;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAppUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsTauri.mockReturnValue(false);
    mockIsLocalhost.mockReturnValue(false);
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    mockFetchLatestRelease.mockReset();
    mockIsNewerVersion.mockReturnValue(false);
    mockWriteKey.mockReset();
    mockWriteKey.mockResolvedValue(undefined);
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('does not schedule a Tauri update check in non-test desktop dev', async () => {
    vi.stubEnv('MODE', 'development');
    mockIsTauri.mockReturnValue(true);
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(mockCheck).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    vi.unstubAllEnvs();
  });

  it('does not schedule an update check outside of Tauri or localhost', async () => {
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockFetchLatestRelease).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('clears the scheduled check on unmount before it fires', async () => {
    mockIsTauri.mockReturnValue(true);
    const { unmount } = renderHook(() => useAppUpdater());
    unmount();
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('marks an update available after the delayed check resolves', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3', body: 'release notes' });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('available');
    expect(result.current.mode).toBe('tauri');
    expect(result.current.updateInfo).toEqual({ version: '1.2.3', body: 'release notes' });
  });

  it('defaults body to null when the update has no body', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3' });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.updateInfo).toEqual({ version: '1.2.3', body: null });
  });

  it('stays idle when no update is available', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: false });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('idle');
    expect(result.current.updateInfo).toBeNull();
  });

  it('stays idle when check() resolves undefined', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('idle');
  });

  it('stays idle when the check throws', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('idle');
  });

  it('skips showing a version dismissed only in sessionStorage (Tauri)', async () => {
    mockIsTauri.mockReturnValue(true);
    sessionStorage.setItem('rff-update-dismissed-v1.2.3', '1');
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('idle');
  });

  it('skips showing a previously dismissed version (Tauri)', async () => {
    mockIsTauri.mockReturnValue(true);
    localStorage.setItem('rff-update-dismissed-v1.2.3', '1');
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('idle');
  });

  it('skips Tauri updates for beta/alpha versions', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3-beta.1', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('idle');
    expect(result.current.updateInfo).toBeNull();
  });

  it('installUpdate is a no-op when there is no pending update', async () => {
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.installUpdate(); });
    expect(mockCheck).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('downloads, tracks progress, and relaunches on install', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '2.0.0', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('available');

    const downloadAndInstall = vi.fn(async (cb: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
      cb({ event: 'Started', data: { contentLength: 100 } });
      cb({ event: 'Progress', data: { chunkLength: 50 } });
      cb({ event: 'Progress', data: { chunkLength: 50 } });
      cb({ event: 'Finished' });
    });
    mockCheck.mockResolvedValue({ available: true, downloadAndInstall });

    await act(async () => { await result.current.installUpdate(); });

    expect(downloadAndInstall).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalled();
    expect(result.current.status).toBe('downloading');
    expect(result.current.downloadProgress).toBe(100);
  });

  it('does not track progress when contentLength is absent (total stays zero)', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '2.0.0', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();

    const downloadAndInstall = vi.fn(async (cb: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
      cb({ event: 'Started', data: {} });
      cb({ event: 'Progress', data: { chunkLength: 50 } });
      cb({ event: 'Finished' });
    });
    mockCheck.mockResolvedValue({ available: true, downloadAndInstall });

    await act(async () => { await result.current.installUpdate(); });

    expect(result.current.downloadProgress).toBe(100);
  });

  it('stops installing when a re-check reports the update is no longer available', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '2.0.0', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();

    mockCheck.mockResolvedValue({ available: false });
    await act(async () => { await result.current.installUpdate(); });

    expect(mockRelaunch).not.toHaveBeenCalled();
    expect(result.current.status).toBe('downloading');
  });

  it('sets an error status with the thrown message when install fails', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '2.0.0', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();

    mockCheck.mockRejectedValue(new Error('disk full'));
    await act(async () => { await result.current.installUpdate(); });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('disk full');
  });

  it('falls back to a generic error message for non-Error throws', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '2.0.0', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();

    mockCheck.mockRejectedValue('nope');
    await act(async () => { await result.current.installUpdate(); });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('Update failed');
  });

  it('keeps dismiss working when the Tauri store write fails', async () => {
    mockIsTauri.mockReturnValue(true);
    mockWriteKey.mockRejectedValue(new Error('no store'));
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    act(() => { result.current.dismissUpdate(); });
    await flush();
    expect(result.current.status).toBe('idle');
    expect(mockWriteKey).toHaveBeenCalled();
  });

  it('dismissUpdate resets status, clears updateInfo, and stores dismiss key in localStorage', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3', body: null });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(result.current.status).toBe('available');

    act(() => { result.current.dismissUpdate(); });

    expect(result.current.status).toBe('idle');
    expect(result.current.updateInfo).toBeNull();
    expect(localStorage.getItem('rff-update-dismissed-v1.2.3')).toBe('1');
    expect(sessionStorage.getItem('rff-update-dismissed-v1.2.3')).toBe('1');
  });

  it('does not resurrect a dismissed banner when a late check resolves', async () => {
    mockIsTauri.mockReturnValue(true);
    let finishCheck: (value: { available: boolean; version: string; body: string | null }) => void = () => {};
    mockCheck.mockReturnValue(new Promise((resolve) => {
      finishCheck = resolve;
    }));
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();

    act(() => { result.current.dismissUpdate(); });
    expect(result.current.status).toBe('idle');

    await act(async () => {
      finishCheck({ available: true, version: '9.9.9', body: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.updateInfo).toBeNull();
  });

  it('stays dismissed across remount when the version was already dismissed', async () => {
    mockIsTauri.mockReturnValue(true);
    mockCheck.mockResolvedValue({ available: true, version: '1.2.3', body: null });
    const first = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    act(() => { first.result.current.dismissUpdate(); });
    first.unmount();

    const second = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
    await flush();
    expect(second.result.current.status).toBe('idle');
    expect(second.result.current.updateInfo).toBeNull();
  });

  describe('localhost path', () => {
    it('sets mode to localhost and checks GitHub API', async () => {
      mockIsLocalhost.mockReturnValue(true);
      mockIsNewerVersion.mockReturnValue(true);
      mockFetchLatestRelease.mockResolvedValue({ version: '2.0.0', body: 'what is new' });
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
      await flush();
      expect(result.current.mode).toBe('localhost');
      expect(result.current.status).toBe('available');
      expect(result.current.updateInfo).toEqual({ version: '2.0.0', body: 'what is new' });
    });

    it('stays idle when no newer version is on GitHub', async () => {
      mockIsLocalhost.mockReturnValue(true);
      mockIsNewerVersion.mockReturnValue(false);
      mockFetchLatestRelease.mockResolvedValue({ version: '1.0.0', body: '' });
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
      await flush();
      expect(result.current.status).toBe('idle');
    });

    it('stays idle when GitHub API returns null', async () => {
      mockIsLocalhost.mockReturnValue(true);
      mockFetchLatestRelease.mockResolvedValue(null);
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
      await flush();
      expect(result.current.status).toBe('idle');
    });

    it('skips showing a previously dismissed version', async () => {
      mockIsLocalhost.mockReturnValue(true);
      localStorage.setItem('rff-update-dismissed-v2.0.0', '1');
      mockIsNewerVersion.mockReturnValue(true);
      mockFetchLatestRelease.mockResolvedValue({ version: '2.0.0', body: '' });
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
      await flush();
      expect(result.current.status).toBe('idle');
    });

    it('stays idle when fetchLatestRelease throws', async () => {
      mockIsLocalhost.mockReturnValue(true);
      mockFetchLatestRelease.mockRejectedValue(new Error('network'));
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS); });
      await flush();
      expect(result.current.status).toBe('idle');
    });
  });
});
