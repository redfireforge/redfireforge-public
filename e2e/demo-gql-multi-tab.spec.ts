/**
 * Demo — GQL-14 Multi-Tab Workspaces: smoke validation
 *
 * ONLY this lesson — run via:
 *   npm run test:e2e:demo:gql14
 *
 * Full lesson needs Docker GraphQL on port 4010:
 *   cd docker/graphql && docker compose up -d
 *
 * Last-step rule: step 12 disables Next — use walkFullGql14Lesson, not runNextStep on the final step.
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
  GQL14_LESSON,
  MUTATION_TIMEOUT,
  prepareGql14DockerLesson,
  walkFullGql14Lesson,
} from './graphql-lesson-smoke-helpers';

const LESSON_NAME = GQL14_LESSON.name;
const TOTAL_STEPS = GQL14_LESSON.steps;
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
  const deadline = Date.now() + 840_000;
  while (Date.now() < deadline) {
    const info = await getStepInfo(page);
    const phase = await page.locator(LIVE_PANEL).getAttribute('data-step-phase');
    console.log(`[GQL-14 auto-play] ${info.counter} — ${info.title} (phase=${phase})`);
    const match = info.counter.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (current === TOTAL_STEPS && total === TOTAL_STEPS && phase === 'done') return;
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error('GQL-14 auto-play did not reach step 12/12 done within 14 minutes');
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

test.describe('GQL-14 — lesson shell', () => {
  test(`lesson has ${TOTAL_STEPS} steps`, async ({ page }) => {
    await launchGqlLesson(page, LESSON_NAME);
    const counter = await page.locator('.demo-live-step-counter').textContent();
    expect(counter).toMatch(new RegExp(`1\\s*[/]\\s*${TOTAL_STEPS}`));
  });
});

test.describe('GQL-14 — full lesson (Docker)', () => {
  test('auto-play completes without errors', async ({ page, request }) => {
    const healthy = await isGraphqlServerHealthy(request);
    test.skip(!healthy, 'GraphQL test server not running on port 4010 — start docker/graphql');

    test.setTimeout(900_000);
    await prepareGql14DockerLesson(page, request);
    await walkFullGql14Lesson(page);

    const { counter, title } = await getStepInfo(page);
    expect(counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(title).toMatch(/Per-Tab Schema Polling/i);

    await expect(page.locator('[data-testid="gql-tab-bar"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /Staging/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /Production/i })).toBeVisible({ timeout: 15_000 });

    await takeNamedScreenshot(page, 'gql14-multi-tab-lesson-complete');
    await exitLesson(page);
  });

  test('Phase 8 — 1× auto-play completes all 12 steps', async ({ page, request }) => {
    const healthy = await isGraphqlServerHealthy(request);
    test.skip(!healthy, 'GraphQL test server not running on port 4010 — start docker/graphql');

    test.setTimeout(900_000);
    await prepareGql14DockerLesson(page, request);
    await restartLesson(page);
    await waitForReadingPhase(page, MUTATION_TIMEOUT);

    const step10Shot = page
      .waitForSelector('[data-testid="gql-profile-modal"]', { timeout: MUTATION_TIMEOUT })
      .then(() => takeNamedScreenshot(page, 'gql14-step10-profiles-load'))
      .catch(() => undefined);

    const step11Shot = page
      .waitForSelector('[data-testid="gql-auth-inherit-banner"]', { timeout: MUTATION_TIMEOUT })
      .then(() => takeNamedScreenshot(page, 'gql14-step11-inherit-banner'))
      .catch(() => undefined);

    const step12Shot = page
      .waitForSelector('[data-testid="gql-polling-popover"]', { timeout: MUTATION_TIMEOUT })
      .then(() => takeNamedScreenshot(page, 'gql14-step12-polling-popover'))
      .catch(() => undefined);

    await enableAutoPlay(page);
    await waitForAutoPlayComplete(page);
    await Promise.all([step10Shot, step11Shot, step12Shot]);

    const { counter, title } = await getStepInfo(page);
    expect(counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(title).toMatch(/Per-Tab Schema Polling/i);

    const phase = await page.locator(LIVE_PANEL).getAttribute('data-step-phase');
    expect(phase).toBe('done');

    await expect(page.getByRole('tab', { name: /Staging/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /Production/i })).toBeVisible({ timeout: 15_000 });

    await takeNamedScreenshot(page, 'gql14-autoplay-complete');
    await exitLesson(page);
  });

  test('Phase 8 — rapid Next preAction guards recover on step 12', async ({ page, request }) => {
    const healthy = await isGraphqlServerHealthy(request);
    test.skip(!healthy, 'GraphQL test server not running on port 4010 — start docker/graphql');

    test.setTimeout(900_000);
    await prepareGql14DockerLesson(page, request);
    await restartLesson(page);

    await rapidAdvanceToLastStepReading(page, TOTAL_STEPS - 1, MUTATION_TIMEOUT);

    const before = await getStepInfo(page);
    expect(before.counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));

    // Last step: Next stays disabled — use finishDemoStep, not completeCurrentStepAction.
    await finishDemoStep(page, MUTATION_TIMEOUT);
    const after = await getStepInfo(page);
    expect(after.counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(after.title).toMatch(/Per-Tab Schema Polling/i);

    const phase = await page.locator(LIVE_PANEL).getAttribute('data-step-phase');
    expect(phase).toBe('done');

    await expect(page.getByRole('tab', { name: /Staging/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /Production/i })).toBeVisible({ timeout: 15_000 });
    // Step 12 preAction links profiles when prior steps were skipped.
    await expect(page.getByRole('button', { name: /saved profiles/i })).toContainText('2');

    // Polling is configured on the Staging demo tab (not the default 127.0.0.1 tab).
    await page.getByRole('tab', { name: /Staging/i }).click();
    await expect(page.getByRole('tab', { name: /Staging/i })).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator('[data-testid="gql-polling-config-btn"], [data-testid="gql-polling-config-btn-standalone"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const btn = document.querySelector(
              '[data-testid="gql-polling-config-btn"], [data-testid="gql-polling-config-btn-standalone"]',
            );
            return btn?.className.includes('gql-polling-config-btn--active') ?? false;
          }),
        { timeout: 120_000 },
      )
      .toBe(true);
    await takeNamedScreenshot(page, 'gql14-rapid-next-step12-recovery');
    await exitLesson(page);
  });
});
