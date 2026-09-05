/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../shared/utils/platform', () => ({
  isTauri: vi.fn().mockReturnValue(false),
  isDesktopRuntimeAvailable: vi.fn().mockReturnValue(false),
}));

import { isDesktopRuntimeAvailable } from '@shared/utils/platform';
import { loadPersistedActivityTab, persistActivityTab } from './gqlActivityBarUtils';

const STORAGE_KEY = 'gql-studio-activity-tab';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('loadPersistedActivityTab', () => {
  it('returns null when nothing is stored', () => {
    expect(loadPersistedActivityTab()).toBeNull();
  });

  it('returns "history" when stored', () => {
    localStorage.setItem(STORAGE_KEY, 'history');
    expect(loadPersistedActivityTab()).toBe('history');
  });

  it('returns "collections" when stored', () => {
    localStorage.setItem(STORAGE_KEY, 'collections');
    expect(loadPersistedActivityTab()).toBe('collections');
  });

  it('returns "mock" when stored and desktop runtime is available', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
    localStorage.setItem(STORAGE_KEY, 'mock');
    expect(loadPersistedActivityTab()).toBe('mock');
  });

  it('returns null for "mock" on hosted web', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(false);
    localStorage.setItem(STORAGE_KEY, 'mock');
    expect(loadPersistedActivityTab()).toBeNull();
  });

  it('returns null for an unknown/invalid stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'unknown-tab');
    expect(loadPersistedActivityTab()).toBeNull();
  });

  it('returns null and does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => loadPersistedActivityTab()).not.toThrow();
    expect(loadPersistedActivityTab()).toBeNull();
  });
});

describe('persistActivityTab', () => {
  it('writes the tab to localStorage', () => {
    persistActivityTab('history');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('history');
  });

  it('removes the key when tab is null', () => {
    localStorage.setItem(STORAGE_KEY, 'history');
    persistActivityTab(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => persistActivityTab('history')).not.toThrow();
  });

  it('does not throw on removeItem failure when tab is null', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => persistActivityTab(null)).not.toThrow();
  });
});
