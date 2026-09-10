/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_KEY, MAX_RUNS_KEY, RUNNER_CONFIG_KEY, REQUESTS_KEY, FLAT_FGS_KEY } from './storageKeys';

const tauriListKeys = vi.fn();
const tauriRemoveItem = vi.fn();

vi.mock('./platform', () => ({ isTauri: () => mockIsTauri }));
vi.mock('./tauriStore', () => ({
  listKeys: (...args: unknown[]) => tauriListKeys(...args),
  removeItem: (...args: unknown[]) => tauriRemoveItem(...args),
}));

let mockIsTauri = false;

import { isPreferenceStorageKey, resetPreferences } from './storagePreferences';

describe('isPreferenceStorageKey', () => {
  it('matches theme, layout, pref-, and known UI keys', () => {
    expect(isPreferenceStorageKey(THEME_KEY)).toBe(true);
    expect(isPreferenceStorageKey('perf-test-custom-themes')).toBe(true);
    expect(isPreferenceStorageKey(`${RUNNER_CONFIG_KEY}:env-1`)).toBe(true);
    expect(isPreferenceStorageKey('pref-editor-font')).toBe(true);
    expect(isPreferenceStorageKey('theme-accent')).toBe(true);
    expect(isPreferenceStorageKey('layout-sidebar')).toBe(true);
    expect(isPreferenceStorageKey('replayLayout:wf1')).toBe(true);
    expect(isPreferenceStorageKey('rff-update-dismissed-v1.0.0')).toBe(true);
  });

  it('does not match workspace or test data keys', () => {
    expect(isPreferenceStorageKey(REQUESTS_KEY)).toBe(false);
    expect(isPreferenceStorageKey(FLAT_FGS_KEY)).toBe(false);
    expect(isPreferenceStorageKey('api-mock-workspace-v1')).toBe(false);
    expect(isPreferenceStorageKey('perf-test-v3-environments')).toBe(false);
    expect(isPreferenceStorageKey('perf-test-catalog')).toBe(false);
  });
});

describe('resetPreferences', () => {
  beforeEach(() => {
    mockIsTauri = false;
    localStorage.clear();
    sessionStorage.clear();
    tauriListKeys.mockReset();
    tauriRemoveItem.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('removes preference keys and keeps test data', async () => {
    localStorage.setItem(THEME_KEY, 'light');
    localStorage.setItem(MAX_RUNS_KEY, '10');
    localStorage.setItem(REQUESTS_KEY, '[]');
    localStorage.setItem(FLAT_FGS_KEY, '[]');
    localStorage.setItem('api-mock-workspace-v1', '{}');
    sessionStorage.setItem('workflow_preview_sample_id', 's1');

    const removed = await resetPreferences();

    expect(removed.sort()).toEqual([MAX_RUNS_KEY, THEME_KEY].sort());
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(localStorage.getItem(MAX_RUNS_KEY)).toBeNull();
    expect(localStorage.getItem(REQUESTS_KEY)).toBe('[]');
    expect(localStorage.getItem(FLAT_FGS_KEY)).toBe('[]');
    expect(localStorage.getItem('api-mock-workspace-v1')).toBe('{}');
    expect(sessionStorage.getItem('workflow_preview_sample_id')).toBeNull();
  });

  it('uses the Tauri store when running in desktop mode', async () => {
    mockIsTauri = true;
    tauriListKeys.mockResolvedValue([THEME_KEY, REQUESTS_KEY]);
    tauriRemoveItem.mockResolvedValue(undefined);

    const removed = await resetPreferences();

    expect(removed).toEqual([THEME_KEY]);
    expect(tauriRemoveItem).toHaveBeenCalledWith(THEME_KEY);
    expect(tauriRemoveItem).not.toHaveBeenCalledWith(REQUESTS_KEY);
  });

  it('ignores sessionStorage errors when clearing the preview sample', async () => {
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    localStorage.setItem(THEME_KEY, 'dim');
    await expect(resetPreferences()).resolves.toEqual([THEME_KEY]);
    vi.restoreAllMocks();
  });
});
