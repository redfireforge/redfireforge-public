/**
 * Demo lesson smoke — AM-02 `am-02-multi-server` (Multi-Server Workspace).
 *
 * Run: npm run test:e2e:demo:am02
 * Prereqs: companion :3001 + dev server :5173 (Playwright `webServer`).
 *
 * Proves the lesson's own beats end to end: a second server added and renamed,
 * a base path applied, two listeners bound at once, a tab duplicated, and a
 * running tab closed through the Stop-and-close confirm.
 */
import { test, expect } from '@playwright/test';
import { API_MOCK } from '../src/shared/selectors/apiMock';
import { advanceSteps, completeCurrentStepAction, launchApiMockLesson } from './demo-player-helpers';
import {
  AM_LESSON_NAMES,
  AM_LESSON_STEPS,
  AM_LESSON_STEP_TIMEOUT,
  AM_LESSON_TIMEOUT,
  cleanupApiMockLessonRun,
  prepareApiMockLessonRun,
  readStepCounter,
  walkApiMockLesson,
} from './api-mock-lesson-smoke-helpers';
import { isApiMockCompanionReady } from './api-mock-multi-server-helpers';

const CORPUS_NAME = 'Users API';
const PAYMENTS_NAME = 'Payments';
const COPY_NAME = 'Users API copy';

const tabTitled = (name: string) => API_MOCK.tabTitled(name);

test.describe('Demo lesson AM-02 — Multi-Server Workspace', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await isApiMockCompanionReady(request)), 'API Mock companion (:3001) not reachable');
    await prepareApiMockLessonRun(page, request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupApiMockLessonRun(request);
  });

  test('walks all 8 steps and ends with the payments tab closed', async ({ page }) => {
    test.setTimeout(AM_LESSON_TIMEOUT);

    await walkApiMockLesson(page, 'am02');

    expect(await readStepCounter(page)).toContain(`${AM_LESSON_STEPS.am02} / ${AM_LESSON_STEPS.am02}`);
    // Final beat stops and closes the live-authored server; the others survive.
    await expect(page.locator(tabTitled(PAYMENTS_NAME))).toHaveCount(0, { timeout: AM_LESSON_STEP_TIMEOUT });
    await expect(page.locator(tabTitled(COPY_NAME))).toHaveCount(1);
    await expect(page.locator(tabTitled(CORPUS_NAME))).not.toHaveCount(0);
  });

  test('renames the new tab and applies the base path to its address', async ({ page }) => {
    test.setTimeout(AM_LESSON_TIMEOUT);

    await launchApiMockLesson(page, AM_LESSON_NAMES.am02);
    // 2 advances from step 1 → step 3 reading: tabs-and-new, then rename.
    await advanceSteps(page, 2, AM_LESSON_STEP_TIMEOUT);

    await expect(page.locator(tabTitled(PAYMENTS_NAME))).toHaveCount(1, { timeout: AM_LESSON_STEP_TIMEOUT });

    // Step 3 configures General settings and saves.
    await completeCurrentStepAction(page, AM_LESSON_STEP_TIMEOUT);
    await expect(page.locator(API_MOCK.SETTINGS_MODAL)).toHaveCount(0);
    await expect(page.locator(API_MOCK.ADDRESS)).toContainText('/payments/v1');
  });

  test('binds both listeners, then duplicates a tab onto a fresh port', async ({ page }) => {
    test.setTimeout(AM_LESSON_TIMEOUT);

    await launchApiMockLesson(page, AM_LESSON_NAMES.am02);
    // 5 advances from step 1 → step 6 reading: through start-both and switch-tab.
    await advanceSteps(page, 5, AM_LESSON_STEP_TIMEOUT);

    await expect(page.locator(API_MOCK.TAB_STATUS_DOT_RUNNING)).toHaveCount(2, {
      timeout: AM_LESSON_STEP_TIMEOUT,
    });

    // Step 6 duplicates the corpus tab through its context menu.
    await completeCurrentStepAction(page, AM_LESSON_STEP_TIMEOUT);
    const copyTab = page.locator(API_MOCK.SERVER_TABS)
      .locator('[role="tab"]')
      .filter({ has: page.locator('.am-server-tab-name', { hasText: COPY_NAME }) });
    await expect(copyTab).toHaveCount(1, { timeout: AM_LESSON_STEP_TIMEOUT });
    // A clone is a draft: rules cloned, listener not.
    await expect(copyTab.locator('.am-status-dot.running')).toHaveCount(0);
    await expect(page.locator(API_MOCK.FIRST_ROUTE).first()).toBeVisible();
  });
});
