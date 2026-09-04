import { useLayoutEffect, useState } from 'react';
import { DEMO_HUB_STUB, type DemoHubApi } from './demoHubApi';

export const DEMO_HUB_MOUNT_ID = 'demo-hub-mount';

/** Live demo hub handle — updated by lazy `DemoShellHost`; no demo-player imports. */
export const demoHubRuntimeRef: { current: DemoHubApi } = { current: DEMO_HUB_STUB };

export function syncDemoHubRuntimeRef(hub: DemoHubApi): void {
  demoHubRuntimeRef.current = hub;
}

export function resetDemoHubRuntimeRef(): void {
  demoHubRuntimeRef.current = DEMO_HUB_STUB;
}

/** Callback-ref registry so DemoShellHost portals into the live pane node. */
let demoHubMountNode: HTMLElement | null = null;
const demoHubMountListeners = new Set<(el: HTMLElement | null) => void>();

export function registerDemoHubMount(el: HTMLElement | null): void {
  demoHubMountNode = el;
  for (const listener of demoHubMountListeners) listener(el);
}

export function getDemoHubMountNode(): HTMLElement | null {
  return demoHubMountNode;
}

/** Subscribe to the Demo Hub pane node. Updates when the tab mounts or unmounts. */
export function useDemoHubMountEl(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(() => demoHubMountNode);
  useLayoutEffect(() => {
    setEl(demoHubMountNode);
    demoHubMountListeners.add(setEl);
    return () => {
      demoHubMountListeners.delete(setEl);
    };
  }, []);
  return el;
}
