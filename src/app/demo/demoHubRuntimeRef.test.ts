/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEMO_HUB_STUB } from './demoHubApi';
import {
  demoHubRuntimeRef,
  getDemoHubMountNode,
  registerDemoHubMount,
  resetDemoHubRuntimeRef,
  syncDemoHubRuntimeRef,
  useDemoHubMountEl,
} from './demoHubRuntimeRef';

describe('demoHubRuntimeRef', () => {
  beforeEach(() => {
    resetDemoHubRuntimeRef();
    registerDemoHubMount(null);
  });

  it('starts as stub and syncs live hub without replacing the ref object', () => {
    expect(demoHubRuntimeRef.current).toBe(DEMO_HUB_STUB);
    const liveHub = {
      ...DEMO_HUB_STUB,
      state: { ...DEMO_HUB_STUB.state, view: 'live' as const },
    };
    syncDemoHubRuntimeRef(liveHub);
    expect(demoHubRuntimeRef.current.state.view).toBe('live');
    expect(demoHubRuntimeRef.current).toBe(liveHub);
  });

  it('resetDemoHubRuntimeRef restores stub', () => {
    syncDemoHubRuntimeRef({
      ...DEMO_HUB_STUB,
      exitLiveDemo: async () => {},
    });
    resetDemoHubRuntimeRef();
    expect(demoHubRuntimeRef.current).toBe(DEMO_HUB_STUB);
  });

  it('registerDemoHubMount notifies useDemoHubMountEl subscribers', () => {
    const node = document.createElement('div');
    const { result, unmount } = renderHook(() => useDemoHubMountEl());
    expect(result.current).toBeNull();
    act(() => {
      registerDemoHubMount(node);
    });
    expect(getDemoHubMountNode()).toBe(node);
    expect(result.current).toBe(node);
    act(() => {
      registerDemoHubMount(null);
    });
    expect(result.current).toBeNull();
    unmount();
  });

  it('useDemoHubMountEl reads the current node on first render', () => {
    const node = document.createElement('div');
    registerDemoHubMount(node);
    const { result, unmount } = renderHook(() => useDemoHubMountEl());
    expect(result.current).toBe(node);
    unmount();
  });
});
