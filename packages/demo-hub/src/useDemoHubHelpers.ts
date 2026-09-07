/** Pure helpers extracted from useDemoHub — DOM utilities, progress restore, GQL teardown. */
import type { DemoActionContext, DemoDomain, DemoHubState, DemoLesson, DemoProgress } from './types';
import { allDomains } from './lessons/index';
import { fillControlledInput } from './lessons/setup-helpers';
import { cleanupGqlDemoLessonEnvironment } from './lessons/env-manager-lesson-helpers';
import {
  dispatchGqlPageEndpointReload,
  dispatchGqlTabsReload,
  isGraphqlStudioLesson,
  loadDemoPriorPageEndpointBackup,
  loadDemoSession,
  purgeOrphanDemoTabs,
  restoreApiMockUserWorkspace,
  restorePageEndpointSnapshot,
} from './adapters';
import { clearDemoLiveSession, readDemoLiveSession } from './demoLiveSession';
import {
  DEMO_E2E_FAST_DELAY_MS,
  clampDemoPacing,
  isDemoE2EFastMode,
} from './demoE2EFastMode';
import { runWithDemoUiAction } from '@shared/utils/demoUiAction';

/** preAction is invisible — scale lesson delay() so Preparing does not linger. */
export const DEMO_QUIET_DELAY_FACTOR = 0.25;
export const DEMO_QUIET_DELAY_MIN_MS = 40;
export const DEMO_QUIET_DELAY_MAX_MS = 280;

export const DEMO_VISIBLE_RIPPLE_MS = 560;
export const DEMO_VISIBLE_FILL_PAUSE_MS = 420;

export {
  DEMO_E2E_FAST_MODE_KEY,
} from './demoE2EFastMode';
export { DEMO_E2E_FAST_DELAY_MS, clampDemoPacing, isDemoE2EFastMode };

/** Visible-pacing delay, collapsed to a tick under E2E fast mode. */
export function scaleVisibleDelay(ms: number): number {
  return clampDemoPacing(ms);
}

export const INITIAL_STATE: DemoHubState = {
  view: 'domains',
  selectedDomain: null,
  selectedLesson: null,
  stepIndex: 0,
  isPlaying: false,
  speed: 1,
};

export function scaleQuietDelay(ms: number): number {
  if (isDemoE2EFastMode()) return Math.min(ms, DEMO_E2E_FAST_DELAY_MS);
  return Math.min(
    DEMO_QUIET_DELAY_MAX_MS,
    Math.max(DEMO_QUIET_DELAY_MIN_MS, Math.round(ms * DEMO_QUIET_DELAY_FACTOR)),
  );
}

export async function runGqlDemoStorageHygiene(): Promise<void> {
  try {
    const { purgeGqlDemoEphemeralStorage } = await import('./lessons/gql-demo-storage-cleanup');
    const result = await purgeGqlDemoEphemeralStorage();
    if (result.profilesRemoved > 0 || result.runnerConfigsRemoved > 0 || result.staleKeysRemoved > 0) {
      console.info(
        `[DemoHub] GQL storage hygiene: ${result.profilesRemoved} profiles, `
        + `${result.runnerConfigsRemoved} runner configs, ${result.staleKeysRemoved} stale keys `
        + `(~${result.freedKB} KB)`,
      );
    }
  } catch (e) {
    console.warn('[DemoHub] GQL storage hygiene failed:', e);
  }
}

export async function runGrpcDemoStorageHygiene(): Promise<void> {
  try {
    const { purgeGrpcDemoEphemeralStorage } = await import('./lessons/grpc-demo-storage-cleanup');
    const result = await purgeGrpcDemoEphemeralStorage();
    console.info(
      `[DemoHub] gRPC storage hygiene: ${result.historyEntriesRemoved} call history entries removed, `
      + `${result.sessionKeysRemoved} session keys removed`,
    );
  } catch (e) {
    console.warn('[DemoHub] gRPC storage hygiene failed:', e);
  }
}

export async function closeGraphqlDemoWorkspaceQuiet(lessonId: string): Promise<void> {
  const { closeGqlDemoWorkspaceQuiet } = await import(
    './lessons/protocols/graphql-lesson-helpers/gql-demo-tab'
  );
  await closeGqlDemoWorkspaceQuiet(lessonId);
}

/** Lesson cleanup, then put the user's mock library back. */
export async function runApiMockStudioLessonTeardown(
  lesson: DemoLesson,
  ctx: DemoActionContext,
): Promise<void> {
  try {
    if (lesson.cleanup) {
      await lesson.cleanup(ctx);
    }
  } catch (e) {
    console.warn('[DemoHub] Lesson cleanup failed:', e);
  }
  try {
    await restoreApiMockUserWorkspace();
  } catch (e) {
    console.warn('[DemoHub] API Mock user library restore failed:', e);
  }
}

/** Lesson-specific cleanup + GraphQL Studio demo env / EM teardown. */
export async function runGqlStudioLessonTeardown(
  lesson: DemoLesson,
  ctx: DemoActionContext,
): Promise<void> {
  const sessionBefore = await loadDemoSession();
  const endpointToRestore = sessionBefore?.priorPageEndpoint !== undefined
    ? sessionBefore.priorPageEndpoint
    : await loadDemoPriorPageEndpointBackup();

  try {
    if (lesson.cleanup) {
      await lesson.cleanup(ctx);
    } else {
      await closeGraphqlDemoWorkspaceQuiet(lesson.id);
    }
  } catch (e) {
    console.warn('[DemoHub] Lesson cleanup failed:', e);
  }
  if (!isGraphqlStudioLesson(lesson)) return;
  try {
    await cleanupGqlDemoLessonEnvironment(ctx);
  } catch (e) {
    console.warn('[DemoHub] GQL demo environment cleanup failed:', e);
  }
  // Env cleanup can trigger a stale React persist of `{{graphqlUrl}}` after
  // closeDemoWorkspace restored the user's page endpoint (§11.0 gql110).
  if (endpointToRestore !== undefined) {
    try {
      await restorePageEndpointSnapshot(endpointToRestore);
      dispatchGqlPageEndpointReload();
    } catch (e) {
      console.warn('[DemoHub] GQL page endpoint re-restore failed:', e);
    }
  }
  try {
    await purgeOrphanDemoTabs();
    dispatchGqlTabsReload();
  } catch (e) {
    console.warn('[DemoHub] GQL orphan demo tab purge failed:', e);
  }
}

import { firstVisibleElement as firstVisible } from './utils/domVisibility';

export { firstVisible };

/**
 * Restore the hub navigation position from persisted progress.
 * When a live session exists in sessionStorage (page reload / HMR), restore live mode
 * so the demo overlay can resume after setup re-runs.
 */
export function findLessonById(lessonId: string): { domain: DemoDomain; lesson: DemoLesson } | null {
  for (const domain of allDomains) {
    const lesson = domain.lessons.find(l => l.id === lessonId);
    if (lesson && domain.available) return { domain, lesson };
  }
  return null;
}

export function restoreStateFromProgress(progress: DemoProgress): DemoHubState {
  const liveSession = readDemoLiveSession();
  if (liveSession) {
    const found = findLessonById(liveSession.lessonId);
    if (found) {
      return {
        ...INITIAL_STATE,
        speed: liveSession.speed ?? progress.speed,
        view: 'live',
        selectedDomain: found.domain,
        selectedLesson: found.lesson,
        stepIndex: liveSession.stepIndex,
        isPlaying: liveSession.isPlaying ?? false,
      };
    }
    clearDemoLiveSession();
  }

  const base: DemoHubState = { ...INITIAL_STATE, speed: progress.speed };
  const { lastView, lastDomain, lastLesson } = progress;

  // Restore to concept view if we have a lesson and were on concept/live
  if (lastLesson && (lastView === 'concept' || lastView === undefined)) {
    for (const domain of allDomains) {
      const lesson = domain.lessons.find(l => l.id === lastLesson);
      if (lesson && domain.available) {
        return { ...base, view: 'concept', selectedDomain: domain, selectedLesson: lesson };
      }
    }
  }

  // Restore to lessons view if we have a domain (with or without a lastLesson)
  if (lastView === 'lessons' || (lastDomain && !lastLesson)) {
    const domain = allDomains.find(d => d.id === lastDomain);
    if (domain?.available) {
      // Keep lastLesson reference so the category tab is correctly highlighted
      const lesson = lastLesson ? domain.lessons.find(l => l.id === lastLesson) ?? null : null;
      return { ...base, view: 'lessons', selectedDomain: domain, selectedLesson: lesson };
    }
  }

  return base;
}

export function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // During live-demo boot, under-cover descendants stay findable so waitFor /
  // highlight resolve while the React Flow viewport is opacity-0.
  if (document.body.getAttribute('data-demo-bootstrapping') === '1') return true;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return style.opacity !== '0';
}

import { showClickRipple } from './demoRipple';
export { showClickRipple };

/** Retry-based element wait — finds first visible match in multi-tab DOM. */
export async function waitForElement(
  selector: string,
  timeoutMs = 2000,
  signal?: AbortSignal,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return false;
    const els = document.querySelectorAll(selector);
    const visible = Array.from(els).find(e => isElementVisible(e));
    if (visible) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

/** Abortable sleep — resolves early if signal fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** How long an action beat waits for its target before giving up. */
export const DEMO_TARGET_WAIT_MS = 2_000;

function isElementDisabled(el: HTMLElement): boolean {
  if ('disabled' in el && (el as HTMLButtonElement).disabled) return true;
  return el.getAttribute('aria-disabled') === 'true';
}

/**
 * Resolve an action target, polling until it paints and (for clicks) stops being
 * disabled.
 *
 * Without this a beat whose target has not rendered — or whose Apply button is still
 * validating — silently no-ops, so the step reports success while the edit never
 * landed. Lesson pacing used to hide that: the ring holds gave React time to commit
 * and validate. That made the bug reappear whenever pacing was reduced or the machine
 * was slow. Falls through with whatever was found at the deadline so a genuinely
 * disabled control still behaves as before.
 */
async function resolveActionTarget(
  selector: string,
  signal?: AbortSignal,
  options?: { requireEnabled?: boolean; timeoutMs?: number },
): Promise<HTMLElement | null> {
  const deadline = Date.now() + (options?.timeoutMs ?? DEMO_TARGET_WAIT_MS);
  let found: HTMLElement | null = null;
  for (;;) {
    if (signal?.aborted) return null;
    found = firstVisible(selector) ?? found;
    if (found && !(options?.requireEnabled && isElementDisabled(found))) return found;
    if (Date.now() >= deadline) return found;
    await abortableSleep(50, signal);
  }
}

/** Visible demo action context — click ripple and paced delays for live steps. */
export function buildDemoActionContext(
  navigateToTab: (tab: string) => void,
  signal?: AbortSignal,
): DemoActionContext {
  const sleep = (ms: number) => abortableSleep(scaleVisibleDelay(ms), signal);
  return {
    navigateToTab: (tab: string) => runWithDemoUiAction(() => navigateToTab(tab)),
    click: async (selector: string) => {
      if (signal?.aborted) return;
      const el = await resolveActionTarget(selector, signal, { requireEnabled: true });
      if (el) {
        showClickRipple(el);
        await sleep(DEMO_VISIBLE_RIPPLE_MS);
        if (signal?.aborted) return;
        runWithDemoUiAction(() => el.click());
      }
    },
    fill: async (selector: string, value: string) => {
      if (signal?.aborted) return;
      const el = await resolveActionTarget(selector, signal);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        showClickRipple(el);
        await sleep(DEMO_VISIBLE_FILL_PAUSE_MS);
        if (signal?.aborted) return;
        fillControlledInput(el, value);
      }
    },
    selectOption: async (selector: string, value: string) => {
      if (signal?.aborted) return;
      const el = await resolveActionTarget(selector, signal);
      if (!el) return;

      if (el instanceof HTMLSelectElement) {
        if (el.value === value) return;
        showClickRipple(el);
        await sleep(DEMO_VISIBLE_FILL_PAUSE_MS);
        if (signal?.aborted) return;
        const nativeSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        nativeSet?.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      const wrapper = el.classList.contains('cs-wrapper')
        ? el
        : el.closest('.cs-wrapper');
      if (!wrapper) return;

      // Already on the target — opening the menu would only flicker.
      if (wrapper.getAttribute('data-value') === value) return;

      const trigger = wrapper.querySelector<HTMLButtonElement>('.cs-trigger');
      if (!trigger || trigger.disabled) return;
      showClickRipple(trigger);
      await sleep(DEMO_VISIBLE_FILL_PAUSE_MS);
      if (signal?.aborted) return;
      runWithDemoUiAction(() => trigger.click());
      // The CustomSelect menu is rendered via a React portal into document.body,
      // so we must search document — not wrapper — for the option item.
      // Pause so the user can see all available options before we select one.
      await sleep(700);
      if (signal?.aborted) return;
      const escValue = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const item = document.querySelector<HTMLButtonElement>(`.cs-item[data-value="${escValue}"]`);
      if (!item) {
        // Menu failed to open — close stray trigger state and bail (no silent flicker loop).
        if (trigger.getAttribute('aria-expanded') === 'true') {
          runWithDemoUiAction(() => trigger.click());
        }
        return;
      }
      // Highlight the target item so the user can see it before it's selected.
      item.classList.add('cs-item--demo-highlight');
      showClickRipple(item);
      await sleep(500);
      if (signal?.aborted) return;
      item.classList.remove('cs-item--demo-highlight');
      runWithDemoUiAction(() => item.click());
    },
    waitFor: async (selector: string, timeout = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (signal?.aborted) return;
        if (document.querySelector(selector)) return;
        await sleep(100);
      }
    },
    delay: (ms: number) => sleep(ms),
  };
}

/** Quiet demo action context — for preAction, setup, cleanup (scaled delays, no ripple). */
export function buildQuietDemoActionContext(
  navigateToTab: (tab: string) => void,
  signal?: AbortSignal,
): DemoActionContext {
  const sleep = (ms: number) => abortableSleep(scaleQuietDelay(ms), signal);
  return {
    navigateToTab: (tab: string) => runWithDemoUiAction(() => navigateToTab(tab)),
    click: async (selector: string) => {
      if (signal?.aborted) return;
      const el = firstVisible(selector);
      if (el) runWithDemoUiAction(() => el.click());
    },
    fill: async (selector: string, value: string) => {
      if (signal?.aborted) return;
      const el = firstVisible(selector);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        fillControlledInput(el, value);
      }
    },
    selectOption: async (selector: string, value: string) => {
      if (signal?.aborted) return;
      const el = firstVisible(selector);
      if (!el) return;

      if (el instanceof HTMLSelectElement) {
        if (el.value === value) return;
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        if (desc?.set) desc.set.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      const wrapper = el.classList.contains('cs-wrapper')
        ? el
        : el.closest('.cs-wrapper');
      if (!wrapper) return;
      if (wrapper.getAttribute('data-value') === value) return;

      // Quiet path: set value via CustomSelect event — never open the portal menu
      // (open→pick→close in ~40ms is the "quick blink" viewers see during Preparing).
      wrapper.dispatchEvent(
        new CustomEvent('custom-select:set-value', { detail: { value } }),
      );
    },
    waitFor: async (selector: string, timeout = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (signal?.aborted) return;
        if (document.querySelector(selector)) return;
        // Poll interval stays short; do not scaleQuietDelay here or long waits
        // balloon when many polls stack during Preparing.
        await abortableSleep(100, signal);
      }
    },
    delay: (ms: number) => sleep(ms),
  };
}
