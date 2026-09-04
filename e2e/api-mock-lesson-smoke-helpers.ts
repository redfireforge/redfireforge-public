/**
 * Shared harness for API Mock demo lesson smoke specs (curriculum v2, AM-01 … AM-24).
 *
 * One spec per lesson (`e2e/demo-api-mock-am01.spec.ts` …) runs in its own Playwright
 * project (`demo-am01` …) so a stuck listener never cascades. Keep per-lesson logic in
 * the spec; anything two lessons would share belongs here.
 *
 * Prereqs: companion :3001 + dev server :5173 (both Playwright `webServer` entries).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  clearDemoE2EStorage,
  installApiMockDesktopShim,
  installPhase8DemoGuardBypass,
  installDemoFastMode,
  launchApiMockLesson,
  playThroughLesson,
} from './demo-player-helpers';
import { stopAllCompanionListeners } from './api-mock-multi-server-helpers';

export const AM_ECHO_HEALTH = 'http://localhost:4017/health';

/** True when the AM-17 Docker echo on :4017 answers GET /health. */
export async function isApiMockEchoReady(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(AM_ECHO_HEALTH, { timeout: 3_000 });
    return res.ok();
  } catch {
    return false;
  }
}

/** Mock start/stop + real traffic + journal writes are slow — give steps room. */
export const AM_LESSON_STEP_TIMEOUT = 120_000;
/** Whole-lesson budget for a 6–12 step walk of multi-beat steps. */
export const AM_LESSON_TIMEOUT = 600_000;

/** Canonical step counts — kept in sync with each lesson wrapper. */
export const AM_LESSON_STEPS: Record<string, number> = {
  am01: 8,
  am02: 8,
  am03: 8,
  am04: 7,
  am05: 8,
  am06: 6,
  am07: 7,
  am08: 8,
  am09: 12,
  am10: 8,
  am11: 9,
  am12: 8,
  am13: 8,
  am14: 8,
  am15: 12,
  am16: 6,
  am17: 8,
  am18: 8,
  am19: 8,
  am20: 8,
  am21: 8,
  am22: 9,
  am23: 7,
  am24: 10,
};

/**
 * Lesson-card name fragments used to open each lesson from the hub.
 * Lesson names carry no `AM-xx` prefix, so match on a distinctive title fragment.
 */
export const AM_LESSON_NAMES: Record<string, string> = {
  am01: 'Studio Tour',
  am02: 'Multi-Server Workspace',
  am03: 'Rule Library',
  am04: 'Path Matching',
  am05: 'Security Conditions',
  am06: 'Body Matching',
  am07: 'Forms, Multipart',
  am08: 'Boolean Groups',
  am09: 'Conflict Inspector',
  am10: 'Response Content',
  am11: 'Dynamic Responses',
  am12: 'Response Variants',
  am13: 'Stateful Mocks',
  am14: 'Connection Faults',
  am15: 'Import Everything',
  am16: 'Export & Round-Trip',
  am17: 'Proxy Passthrough',
  am18: 'Journal Forensics',
  am19: 'Runtime Ops',
  am20: 'HTTPS, HTTP/2',
  am21: 'Simulation as a Test Suite',
  am22: 'Workflow Orchestration',
  am23: 'Test Runner Fixtures',
  am24: 'Ship a Contract Mock',
};

/**
 * Free ports, bypass the live-demo guard, and clear demo storage.
 *
 * Storage APIs are origin-scoped, so the page must load the app before
 * `clearDemoE2EStorage` — calling it on `about:blank` throws a SecurityError.
 */
export async function prepareApiMockLessonRun(page: Page, request: APIRequestContext): Promise<void> {
  await stopAllCompanionListeners(request);
  await installPhase8DemoGuardBypass(page);
  await installDemoFastMode(page);
  await installApiMockDesktopShim(page);
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await clearDemoE2EStorage(page);
}

/** Free every port the run bound, so the next project starts clean. */
export async function cleanupApiMockLessonRun(request: APIRequestContext): Promise<void> {
  await stopAllCompanionListeners(request);
}

/** The live panel's step counter, e.g. `14 / 14`. */
export async function readStepCounter(page: Page): Promise<string> {
  return (await page.locator('.demo-live-step-counter').first().textContent()) ?? '';
}

/** Launch a lesson by key and walk every step (safe on the final step). */
export async function walkApiMockLesson(
  page: Page,
  key: keyof typeof AM_LESSON_STEPS,
  stepTimeoutMs = AM_LESSON_STEP_TIMEOUT,
): Promise<void> {
  const steps = AM_LESSON_STEPS[key];
  const name = AM_LESSON_NAMES[key];
  expect(steps, `unknown AM lesson key ${key}`).toBeGreaterThan(0);
  await launchApiMockLesson(page, name);
  await playThroughLesson(page, steps, stepTimeoutMs);
}
