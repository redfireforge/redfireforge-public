/**
 * Demo — GQL-16 Workflow Integration: smoke validation
 *
 * ONLY this lesson — run via:
 *   npm run test:e2e:demo:gql16
 *
 * Full lesson needs Docker GraphQL on port 4010:
 *   cd docker/graphql && docker compose up -d
 *
 * Last-step rule: step 12 disables Next — use walkFullGql16Lesson, not runNextStep on the final step.
 */

import { test, expect } from '@playwright/test';
import {
  exitLesson,
  finishDemoStep,
  getStepInfo,
  launchGqlLesson,
  rapidAdvanceToLastStepReading,
  restartLesson,
  takeNamedScreenshot,
  waitForReadingPhase,
} from './demo-player-helpers';
import { GQL_HEALTH, isGraphqlServerHealthy, silenceLogStream } from './graphql-helpers';
import {
  GQL16_LESSON,
  MUTATION_TIMEOUT,
  prepareGql16DockerLesson,
  walkFullGql16Lesson,
} from './graphql-lesson-smoke-helpers';

const LESSON_NAME = GQL16_LESSON.name;
const TOTAL_STEPS = GQL16_LESSON.steps;
const WF_NAME = 'GraphQL Latency Demo';
const LIVE_PANEL = '[data-testid="demo-live-panel"]';

async function enableAutoPlay(page: Parameters<typeof waitForReadingPhase>[0]): Promise<void> {
  const playBtn = page.locator('.demo-live-play-btn');
  const title = await playBtn.getAttribute('title');
  if (title?.includes('Play')) {
    await playBtn.click();
  }
}

/** Wait until auto-play reaches the last step and its action finishes (1× — no reading skip). */
async function waitForAutoPlayComplete(page: Parameters<typeof waitForReadingPhase>[0]): Promise<void> {
  const deadline = Date.now() + 720_000;
  while (Date.now() < deadline) {
    const info = await getStepInfo(page);
    const phase = await page.locator(LIVE_PANEL).getAttribute('data-step-phase');
    console.log(`[GQL-16 auto-play] ${info.counter} — ${info.title} (phase=${phase})`);
    const match = info.counter.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (current === TOTAL_STEPS && total === TOTAL_STEPS && phase === 'done') return;
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error(`GQL-16 auto-play did not reach step ${TOTAL_STEPS}/${TOTAL_STEPS} done within 12 minutes`);
}

async function mockGraphqlHealthProbe(page: Parameters<typeof silenceLogStream>[0]): Promise<void> {
  await page.route(GQL_HEALTH, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    }),
  );
}

test.describe.configure({ retries: 0 });

test.beforeEach(async ({ page }) => {
  await silenceLogStream(page);
  await mockGraphqlHealthProbe(page);
});

test.describe('GQL-16 — lesson shell', () => {
  test(`lesson has ${TOTAL_STEPS} steps`, async ({ page }) => {
    await launchGqlLesson(page, LESSON_NAME);
    const counter = await page.locator('.demo-live-step-counter').textContent();
    expect(counter).toMatch(new RegExp(`1\\s*[/]\\s*${TOTAL_STEPS}`));
  });
});

test.describe('GQL-16 — full lesson (Docker)', () => {
  test('auto-play completes without errors', async ({ page, request }) => {
    const healthy = await isGraphqlServerHealthy(request);
    test.skip(!healthy, 'GraphQL test server not running on port 4010 — start docker/graphql');

    test.setTimeout(900_000);
    await prepareGql16DockerLesson(page, request);
    await walkFullGql16Lesson(page);

    const { counter, title } = await getStepInfo(page);
    expect(counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(title).toMatch(/Step Through with Debug Mode/i);

    await expect(page.locator('.wf-canvas-area')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="gql-canvas-query-node"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="gql-canvas-assert-node"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="wf-toolbar-select"]')).toContainText(WF_NAME, { timeout: 15_000 });

    await takeNamedScreenshot(page, 'gql16-workflow-integration-lesson-complete');
    await exitLesson(page);
  });

  test('Phase 8 — 1× auto-play completes all 12 steps', async ({ page, request }) => {
    const healthy = await isGraphqlServerHealthy(request);
    test.skip(!healthy, 'GraphQL test server not running on port 4010 — start docker/graphql');

    test.setTimeout(900_000);
    await prepareGql16DockerLesson(page, request);
    await restartLesson(page);
    await waitForReadingPhase(page, MUTATION_TIMEOUT);

    const consoleShot = page
      .waitForSelector('[data-testid="wf-console-panel"]', { timeout: MUTATION_TIMEOUT })
      .then(() => takeNamedScreenshot(page, 'gql16-step8-console-open'))
      .catch(() => undefined);

    const debugShot = page
      .waitForSelector('[data-testid="wf-debug-toolbar"]', { timeout: MUTATION_TIMEOUT })
      .then(() => takeNamedScreenshot(page, 'gql16-step12-debug-mode'))
      .catch(() => undefined);

    await enableAutoPlay(page);
    await waitForAutoPlayComplete(page);
    await Promise.all([consoleShot, debugShot]);

    const { counter, title } = await getStepInfo(page);
    expect(counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(title).toMatch(/Step Through with Debug Mode/i);

    const phase = await page.locator(LIVE_PANEL).getAttribute('data-step-phase');
    expect(phase).toBe('done');

    await expect(page.locator('.wf-canvas-area')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="gql-canvas-query-node"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="gql-canvas-assert-node"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="wf-toolbar-select"]')).toContainText(WF_NAME, { timeout: 15_000 });

    await takeNamedScreenshot(page, 'gql16-autoplay-complete');
    await exitLesson(page);
  });

  test('Phase 8 — rapid Next preAction guards recover on step 12', async ({ page, request }) => {
    const healthy = await isGraphqlServerHealthy(request);
    test.skip(!healthy, 'GraphQL test server not running on port 4010 — start docker/graphql');

    test.setTimeout(900_000);
    await prepareGql16DockerLesson(page, request);
    await restartLesson(page);

    await rapidAdvanceToLastStepReading(page, TOTAL_STEPS - 1, MUTATION_TIMEOUT);

    const before = await getStepInfo(page);
    expect(before.counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));

    await finishDemoStep(page, MUTATION_TIMEOUT);
    const after = await getStepInfo(page);
    expect(after.counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(after.title).toMatch(/Step Through with Debug Mode/i);

    await expect(page.locator('[data-testid="gql-canvas-query-node"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="gql-canvas-assert-node"]')).toBeVisible({ timeout: 15_000 });
    await takeNamedScreenshot(page, 'gql16-rapid-next-step12-recovery');
    await exitLesson(page);
  });
});
