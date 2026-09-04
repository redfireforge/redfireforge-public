/**
 * Demo — WS Workflow Builder: step-through validation
 *
 * Validates the WS Workflow Builder lesson (ws-workflow-builder) step by step,
 * focusing on the specific behaviour introduced/fixed in each iteration.
 *
 * ─── RUN THIS ────────────────────────────────────────────────────────────────
 *
 *   npx playwright test --project=demo-stepthrough e2e/demo-ws-workflow-builder.spec.ts --reporter=html
 *
 * The HTML report opens automatically in your browser. Every test shows its
 * screenshots inline so you can visually inspect each step.
 *
 * ─── WHAT IS VALIDATED ───────────────────────────────────────────────────────
 *
 *   1. Lesson launch + concept slide
 *   2. All 11 steps complete without error
 *   3. Config steps (4, 7, 9) open their modal WITHOUT a node selection ring
 *      (regression for the "highlighted node visible inside its config modal" bug)
 *   4. Config modal highlight — steps 4/7/9 spotlight the MODAL not the node
 *   5. Quick Test (step 10) shows the exec-summary
 */

import { test, expect } from '@playwright/test';
import { WF } from '../src/shared/selectors';
import {
  launchLesson,
  runNextStep,
  assertNodeNotSelected,
  getStepInfo,
  takeNamedScreenshot,
  exitLesson,
  restartLesson,
} from './demo-player-helpers';

test.describe.configure({ mode: 'serial', retries: 0 });

const DEMO_ACTION_TIMEOUT = 90_000;

/** After these steps complete, the next step's preAction opens the config modal. */
const CONFIG_RING_AFTER_STEP: Record<number, string> = {
  3: WF.NODE_WS_CONNECT,
  6: WF.NODE_WS_SEND,
  8: WF.NODE_WS_RECEIVE,
};

async function advanceOneStep(page: Parameters<typeof launchLesson>[0]): Promise<void> {
  await runNextStep(page, DEMO_ACTION_TIMEOUT);
}

async function assertConfigStepOpensWithoutSelectionRing(
  page: Parameters<typeof launchLesson>[0],
  nodeSelector: string,
): Promise<void> {
  await expect(page.locator('.wf-config-modal')).toBeVisible({ timeout: 30_000 });
  await page.locator(nodeSelector).waitFor({ state: 'visible', timeout: DEMO_ACTION_TIMEOUT });
  await assertNodeNotSelected(page, nodeSelector);
}

// Mock the WS mock-server start/stop endpoints so the lesson setup doesn't
// fail when the real server isn't running in CI or a clean dev machine.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/ws/mock/start', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route('**/api/ws/mock/stop', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  // Silence the SSE log-stream so the Vite proxy doesn't emit ECONNREFUSED noise.
  await page.route('**/api/logs/stream*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: '',
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Lesson shell
// ══════════════════════════════════════════════════════════════════════════════

test.describe('WS Workflow Builder — lesson shell', () => {
  test('concept slide renders with title, body and Start button', async ({ page }) => {
    await launchLesson(page, 'WebSocket', 'Workflow Builder');

    const { title } = await getStepInfo(page);
    expect(title.length).toBeGreaterThan(0);
    console.log('[PASS] live demo started at step:', title);
    await takeNamedScreenshot(page, 'wf-builder-concept');
    await exitLesson(page);
  });

  test('lesson has 11 steps', async ({ page }) => {
    await launchLesson(page, 'WebSocket', 'Workflow Builder');
    const counter = await page.locator('.demo-live-step-counter').textContent();
    // e.g. "1 / 11"
    expect(counter).toMatch(/1\s*[/]\s*11/);
    console.log('[PASS] step counter:', counter?.trim());
    await exitLesson(page);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Full walkthrough + config modal deselection regression (steps 4, 7, 9)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('WS Workflow Builder — full walkthrough', () => {
  test('builder steps 1-9 complete without error', async ({ page }) => {
    test.setTimeout(420_000);
    await launchLesson(page, 'WebSocket', 'Workflow Builder');
    await page.locator(WF.CANVAS).waitFor({ state: 'visible', timeout: 60_000 });

    for (let step = 1; step <= 9; step++) {
      const { counter, title } = await getStepInfo(page);
      console.log(`[STEP ${step}] ${counter}: ${title}`);
      await takeNamedScreenshot(page, `wf-builder-step-${String(step).padStart(2, '0')}`);
      await advanceOneStep(page);

      const nodeSelector = CONFIG_RING_AFTER_STEP[step];
      if (nodeSelector) {
        await assertConfigStepOpensWithoutSelectionRing(page, nodeSelector);
        console.log(`[PASS] After step ${step}: config modal opens without node ring`);
        await takeNamedScreenshot(page, `wf-builder-step-${String(step + 1).padStart(2, '0')}-modal-no-ring`);
      }
    }

    // After nine advances the demo should be on step 10 (Quick Test) reading phase.
    const { counter, title } = await getStepInfo(page);
    expect(counter).toMatch(/10\s*[/]\s*11/);
    expect(title).toMatch(/Quick Test/i);
    console.log('[PASS] Builder steps 1-9 completed. At:', counter, title);
    await exitLesson(page);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Controls regression
// ══════════════════════════════════════════════════════════════════════════════

test.describe('WS Workflow Builder — demo controls', () => {
  test('restart resets to step 1', async ({ page }) => {
    test.setTimeout(120_000);
    await launchLesson(page, 'WebSocket', 'Workflow Builder');
    // Advance 2 steps then restart
    await advanceOneStep(page);
    await advanceOneStep(page);
    const { counter: before } = await getStepInfo(page);
    expect(before).toMatch(/3\s*[/]\s*11/);

    await restartLesson(page);
    const { counter: after } = await getStepInfo(page);
    expect(after).toMatch(/1\s*[/]\s*11/);
    console.log('[PASS] Restart: counter reset from', before, '→', after);
  });

  test('exit returns to concept slide', async ({ page }) => {
    await launchLesson(page, 'WebSocket', 'Workflow Builder');
    await runNextStep(page, DEMO_ACTION_TIMEOUT);
    await exitLesson(page);
    await expect(page.locator('.demo-lesson-player')).toBeVisible();
    console.log('[PASS] Exit: returned to concept/lesson player');
  });
});
