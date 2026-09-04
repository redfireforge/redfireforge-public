/**
 * demo-player-helpers.ts
 *
 * Reusable Playwright helpers for demo lesson validation.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Agents were repeatedly discovering the Demo Hub DOM from scratch using the
 * Playwright MCP tool in a trial-and-error loop (navigate → evaluate → sleep →
 * screenshot). This is fragile, slow, and non-reusable.
 *
 * Instead: write one reusable spec and run it repeatedly:
 *
 *   npx playwright test e2e/demo-ws-workflow-builder.spec.ts --reporter=html
 *
 * The HTML report opens automatically and shows every screenshot + assertion
 * result in one page.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   import { launchLesson, advanceSteps, runNextStep, assertNodeNotSelected }
 *     from './demo-player-helpers';
 *
 *   test('node is not selected when config modal opens', async ({ page }) => {
 *     await launchLesson(page, 'WebSocket', 'Workflow Builder');
 *     await advanceSteps(page, 3);                   // steps 1-3
 *     await skipReadingPause(page);                  // start step 4 action
 *     await waitForActionPhase(page);
 *     await page.waitForSelector('.wf-config-modal');
 *     await assertNodeNotSelected(page, '.react-flow__node-wsConnect');
 *   });
 *
 * ─── KEY SYNCHRONISATION CONTRACT ───────────────────────────────────────────
 * Per step phases (see data-step-phase on [data-testid="demo-live-panel"]):
 *   READING  — Next disabled; skip via ".demo-live-phase-badge.skippable"
 *   ACTION / VERIFY / PRE — Next disabled (pipeline running)
 *   DONE     — Next enabled (except last step)
 *
 * waitForReadingPhase() waits for data-step-phase === 'reading'.
 * To run a step's action(), use completeCurrentStepAction() or runNextStep() —
 * skip reading via the badge, then click Next only after phase is done.
 */

import { type Page, expect } from '@playwright/test';
import { PHASE8_E2E_GUARD_BYPASS_KEY } from '../packages/demo-hub/src/demoLiveGuard';
import { DEMO_E2E_FAST_MODE_KEY } from '../packages/demo-hub/src/demoE2EFastMode';
import * as fs from 'fs';
import * as path from 'path';

/** Prevent Phase 8 Playwright live-demo walks from writing the manual demo guard file. */
export async function installPhase8DemoGuardBypass(page: Page): Promise<void> {
  if (process.env.PHASE8_E2E_SWEEP !== '1') return;
  await page.addInitScript((key) => {
    (window as Window & Record<string, unknown>)[key] = true;
  }, PHASE8_E2E_GUARD_BYPASS_KEY);
}

/**
 * Collapse lesson pacing to a tick. Steps are authored with presentation holds
 * (ring, payoff, pre-Run) that add minutes to a walk without asserting anything.
 * Opt out with `DEMO_E2E_REAL_PACING=1` when validating the pacing itself.
 */
export async function installDemoFastMode(page: Page): Promise<void> {
  if (process.env.DEMO_E2E_REAL_PACING === '1') return;
  await page.addInitScript((key) => {
    (window as Window & Record<string, unknown>)[key] = true;
  }, DEMO_E2E_FAST_MODE_KEY);
}

// ─── Timeouts ─────────────────────────────────────────────────────────────────

const HUB_TIMEOUT       = 10_000;  // demo hub DOM ready
const STEP_TIMEOUT      = 25_000;  // one step action (some steps have long waits)
const RESTART_TIMEOUT   = 30_000;  // restart includes cleanup + setup
const APP_NAV_ATTEMPTS  = 5;
const APP_NAV_DELAY_MS  = 2_000;
// Vite cold-start on a fresh CI runner can take 60-120s to pre-bundle and serve
// the full module graph. React mounts only after JS executes, so waitUntil:
// 'domcontentloaded' is not sufficient — we must wait for the app shell explicitly.
// Lesson-shell tests run first (cold start) — 300s gives enough headroom.
const APP_SHELL_TIMEOUT = 300_000;

async function gotoAppWithRetry(page: Page, url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= APP_NAV_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ERR_CONNECTION_REFUSED') || attempt === APP_NAV_ATTEMPTS) {
        break;
      }
      await page.waitForTimeout(APP_NAV_DELAY_MS);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to open ${url}: ${String(lastError)}`);
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

/** Clear browser storage between Phase 8 sweep lessons (avoids QuotaExceededError). */
export async function clearDemoE2EStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      localStorage.clear();
    } catch {
      /* quota or security — best effort */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    // Drop IDB between sweep lessons — stale GraphQL tabs/snapshots cause hangs (GQL-12).
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase('redfireforge');
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    });
  });
}

/** Navigate to the root page and open the Demo Hub pane. */
export async function openDemoHub(page: Page): Promise<void> {
  await installPhase8DemoGuardBypass(page);
  await installDemoFastMode(page);
  await gotoAppWithRetry(page, 'http://localhost:5173');
  if (process.env.PHASE8_E2E_SWEEP === '1') {
    await clearDemoE2EStorage(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  // 'domcontentloaded' fires before React hydrates. On a cold CI Vite start the
  // activity bar may not appear for 60-90s while Vite pre-bundles the module graph.
  // Wait for the shell nav to mount before clicking the Demo Hub button.
  await page.waitForSelector('.activity-bar', { state: 'visible', timeout: APP_SHELL_TIMEOUT });
  await page.locator('[title="Demo Hub"]').click();
  await page.waitForSelector('.demo-domain-card', { timeout: HUB_TIMEOUT });
}

/** Click the Protocols domain card (by name, not position). */
export async function selectProtocolsDomain(page: Page): Promise<void> {
  const card = page
    .locator('.demo-domain-card')
    .filter({ hasNot: page.locator('.coming-soon') })
    .filter({ hasText: 'Protocols' });
  await card.click();
  await page.waitForSelector('.demo-lesson-list', { timeout: HUB_TIMEOUT });
}

/** Click a category tab by name. */
export async function selectCategory(
  page: Page,
  category: 'Kafka' | 'WebSocket' | 'SSE' | 'GraphQL' | 'gRPC',
): Promise<void> {
  const tab = page
    .locator('.demo-category-tab')
    .filter({ hasText: new RegExp(category, 'i') });
  if (await tab.count() > 0) {
    await tab.click();
    await page.waitForTimeout(300);
  }
}

/** Click a lesson item by name fragment and wait for the lesson player. */
export async function openLesson(
  page: Page,
  lessonNameFragment: string,
): Promise<void> {
  const item = page
    .locator('.demo-lesson-item')
    .filter({ hasText: lessonNameFragment })
    .first();
  await expect(item).toBeVisible({ timeout: HUB_TIMEOUT });
  await item.click();
  await page.waitForSelector('.demo-lesson-player', { timeout: HUB_TIMEOUT });
}

/** Click "Start Demo" and wait for the live panel + first step reading phase. */
export async function startLesson(page: Page): Promise<void> {
  const startBtn = page.locator('.demo-start-btn');
  await expect(startBtn).toBeEnabled({ timeout: HUB_TIMEOUT });
  await startBtn.click();
  await page.waitForSelector('.demo-live-panel', { timeout: HUB_TIMEOUT });
  // startLiveDemo kicks off step 0 asynchronously. Fast mode can leave
  // `reading` in a 30ms window, so also accept `done` on the first step.
  await page.waitForFunction(
    (sel) => {
      const phase = document.querySelector(sel)?.getAttribute('data-step-phase');
      return phase === 'reading' || phase === 'done';
    },
    '[data-testid="demo-live-panel"]',
    { timeout: RESTART_TIMEOUT },
  );
}

/**
 * Full one-call navigation: Demo Hub → Protocols → category → lesson → Start.
 * This is the entry point for almost every demo validation spec.
 */
export async function launchLesson(
  page: Page,
  category: 'Kafka' | 'WebSocket' | 'SSE' | 'GraphQL' | 'gRPC',
  lessonNameFragment: string,
): Promise<void> {
  await openDemoHub(page);
  await selectProtocolsDomain(page);
  await selectCategory(page, category);
  await openLesson(page, lessonNameFragment);
  await startLesson(page);
}

/**
 * Demo Hub → API Mock domain card → lesson → Start.
 * API Mock is now its own top-level Learning Hub card.
 */
export async function launchApiMockLesson(
  page: Page,
  lessonNameFragment: string,
): Promise<void> {
  await installApiMockDesktopShim(page);
  await openDemoHub(page);
  await page.getByTestId('demo-domain-card-api-mock').click();
  await page.waitForSelector('.demo-lesson-list', { timeout: HUB_TIMEOUT });
  await openLesson(page, lessonNameFragment);
  await startLesson(page);
}

/** Wait for a Docker PrerequisiteGate to report the server is up (enables Start Demo). */
export async function waitForPrerequisiteGateUp(
  page: Page,
  timeout = 20_000,
): Promise<void> {
  // LessonPlayer keeps the gate mounted (hidden) on step/notes so polling
  // continues. Only wait when the concept-slide gate is actually visible.
  const gate = page.locator('[data-testid="prereq-gate"]:visible');
  if ((await gate.count()) === 0) return;
  await expect(page.locator('[data-testid="prereq-status"]:visible')).toHaveClass(
    /prereq-status--up/,
    { timeout },
  );
}

/** Unlock desktop-gated API Mock Start while still using the web companion. */
export async function installApiMockDesktopShim(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RF_E2E_MOCK_DESKTOP__ = true;
  });
}

/**
 * Demo Hub → Protocols → GraphQL → lesson → prerequisite gate → Start.
 * Use for Docker-gated GraphQL demo lessons (e.g. gql-first-query on port 4010).
 */
export async function launchGqlLesson(
  page: Page,
  lessonNameFragment: string,
): Promise<void> {
  await openDemoHub(page);
  await selectProtocolsDomain(page);
  await selectCategory(page, 'GraphQL');
  await openLesson(page, lessonNameFragment);
  await waitForPrerequisiteGateUp(page);
  await startLesson(page);
}

/**
 * Demo Hub → Protocols → gRPC → lesson → prerequisite gate → Start.
 * Use for Docker-gated gRPC demo lessons (echo server on port 50051).
 */
export async function launchGrpcLesson(
  page: Page,
  lessonNameFragment: string,
): Promise<void> {
  await openDemoHub(page);
  await selectProtocolsDomain(page);
  await selectCategory(page, 'gRPC');
  await openLesson(page, lessonNameFragment);
  await waitForPrerequisiteGateUp(page);
  await startLesson(page);
}

// ─── Step control ─────────────────────────────────────────────────────────────

/**
 * Wait until the demo step is ready for E2E interaction.
 * Accepts `pre` (waits through it), `reading`, or any post-reading pipeline phase —
 * fast mode can skip past `reading` before Playwright polls.
 */
export async function waitForReadingPhase(
  page: Page,
  timeout = STEP_TIMEOUT,
): Promise<void> {
  const panelSel = '[data-testid="demo-live-panel"]';
  await page.waitForFunction(
    (sel) => {
      const phase = document.querySelector(sel)?.getAttribute('data-step-phase');
      return (
        phase === 'pre'
        || phase === 'reading'
        || phase === 'action'
        || phase === 'verify'
        || phase === 'done'
      );
    },
    panelSel,
    { timeout },
  );
  const phase = await page.locator(panelSel).getAttribute('data-step-phase');
  if (phase === 'pre') {
    await page.waitForFunction(
      (sel) => {
        const p = document.querySelector(sel)?.getAttribute('data-step-phase');
        return p === 'reading' || p === 'action' || p === 'verify' || p === 'done';
      },
      panelSel,
      { timeout },
    );
  }
}

/** Click the skippable reading badge when the step is still in reading phase. */
export async function skipReadingPause(page: Page): Promise<void> {
  const badge = page.locator('.demo-live-phase-badge.skippable');
  if (await badge.isVisible({ timeout: 5_000 }).catch(() => false)) {
    // The reading phase may complete between visibility and click; a detached
    // badge means there is nothing left to skip.
    await badge.click({ timeout: 1_000 }).catch(() => undefined);
  }
}

/** Wait until the step action pipeline is running (not reading/done).
 * Observation-only steps may never reach action/verify; in that case the step is
 * considered valid once it reaches reading or done without any user action.
 */
export async function waitForActionPhase(page: Page, timeout = 5_000): Promise<void> {
  const panel = page.locator('[data-testid="demo-live-panel"]');
  const currentPhase = await panel.getAttribute('data-step-phase').catch(() => null);

  if (currentPhase === 'reading' || currentPhase === 'done') {
    return;
  }

  await page.waitForFunction(
    (sel) => {
      const phase = document.querySelector(sel)?.getAttribute('data-step-phase');
      return phase === 'action' || phase === 'verify' || phase === 'pre';
    },
    '[data-testid="demo-live-panel"]',
    { timeout },
  ).catch(() => { /* zero-action observation step */ });
}

/**
 * Skip the reading pause (if skippable) and wait for the current step's action
 * to finish. Does not advance the step index — use runNextStep for that.
 *
 * Next is disabled during reading — always skip via the badge (or wait out the
 * pause), then click Next only after phase is done.
 */
export async function completeCurrentStepAction(
  page: Page,
  actionTimeoutMs = STEP_TIMEOUT,
): Promise<void> {
  const panelSel = '[data-testid="demo-live-panel"]';
  // Fast mode can skip past `reading` before the waiter polls. Do not require it.
  await page.waitForFunction(
    (sel) => {
      const phase = document.querySelector(sel)?.getAttribute('data-step-phase');
      return phase === 'reading' || phase === 'action' || phase === 'verify' || phase === 'done';
    },
    panelSel,
    { timeout: actionTimeoutMs },
  );
  const phase = await page.locator(panelSel).getAttribute('data-step-phase');
  if (phase === 'reading') {
    await skipReadingPause(page);
    const stillReading = await page.locator(panelSel).getAttribute('data-step-phase');
    if (stillReading === 'reading') {
      await page.evaluate(async () => {
        const fn = (window as Window & { __demoFinishStepFromReading?: () => Promise<void> })
          .__demoFinishStepFromReading;
        if (fn) await fn();
      });
    }
  }
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute('data-step-phase') === 'done',
    panelSel,
    { timeout: actionTimeoutMs },
  );
}

/**
 * Complete the current step (reading + action), click Next, and wait for the
 * following step to reach its reading phase.
 */
export async function runNextStep(
  page: Page,
  actionTimeoutMs = STEP_TIMEOUT,
): Promise<void> {
  const panelSel = '[data-testid="demo-live-panel"]';
  const nextBtn = page.locator('[aria-label="Next step"]');
  let phase = await page.locator(panelSel).getAttribute('data-step-phase');
  if (phase === 'done') {
    await nextBtn.click();
    await waitForReadingPhase(page, actionTimeoutMs);
    return;
  }

  // Next is disabled during reading — always complete the step action first.
  if (phase !== 'reading') {
    await waitForReadingPhase(page, actionTimeoutMs);
    phase = await page.locator(panelSel).getAttribute('data-step-phase');
    if (phase === 'done') {
      await nextBtn.click();
      await waitForReadingPhase(page, actionTimeoutMs);
      return;
    }
  }

  await completeCurrentStepAction(page, actionTimeoutMs);
  await nextBtn.click();
  await waitForReadingPhase(page, actionTimeoutMs);
}

/**
 * Advance through N steps in sequence, waiting for each action to complete.
 * Use this to reach a specific step quickly without caring about intermediate
 * state (e.g. advance to step 4 to test the config modal fix).
 */
export async function advanceSteps(
  page: Page,
  count: number,
  actionTimeoutMs = STEP_TIMEOUT,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await runNextStep(page, actionTimeoutMs);
  }
}

/**
 * Simulate rapid Next through all prior steps — land on the final step's reading
 * phase with only its preAction recovery (no intermediate step actions).
 * Next is disabled during reading in the live UI, so this uses the E2E bridge.
 */
export async function rapidAdvanceToLastStepReading(
  page: Page,
  lastStepIndex: number,
  timeout = STEP_TIMEOUT,
): Promise<void> {
  await page.evaluate(async (index) => {
    const fn = (window as Window & { __demoGoToStepReadingOnly?: (i: number) => Promise<void> })
      .__demoGoToStepReadingOnly;
    if (!fn) {
      throw new Error('__demoGoToStepReadingOnly bridge missing — enable demo hub for Playwright');
    }
    await fn(index);
  }, lastStepIndex);
  await waitForReadingPhase(page, timeout);
}

/**
 * Finish the current demo step (skip reading → wait for action/verify → done).
 * Safe on the last step where Next stays disabled after done.
 *
 * Demo E2E: on step N/N, Next is NEVER enabled — use this instead of runNextStep.
 * See e2e/DEMO-LESSON-E2E-MEMO.md §1.
 */
export async function finishDemoStep(
  page: Page,
  actionTimeoutMs = STEP_TIMEOUT,
): Promise<void> {
  const panelSel = '[data-testid="demo-live-panel"]';
  const readPhase = async () =>
    page.locator(panelSel).getAttribute('data-step-phase');

  let phase = await readPhase();
  if (phase === 'done') return;

  if (phase !== 'reading') {
    await page.waitForFunction(
      (sel) => {
        const p = document.querySelector(sel)?.getAttribute('data-step-phase');
        return p === 'reading' || p === 'done';
      },
      panelSel,
      { timeout: actionTimeoutMs },
    );
    phase = await readPhase();
    if (phase === 'done') return;
  }

  if (phase === 'reading') {
    await skipReadingPause(page);
    const stillReading = await readPhase();
    if (stillReading === 'reading') {
      await page.evaluate(async () => {
        const fn = (window as Window & { __demoFinishStepFromReading?: () => Promise<void> })
          .__demoFinishStepFromReading;
        if (fn) await fn();
      });
    }
  }

  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute('data-step-phase') === 'done',
    panelSel,
    { timeout: actionTimeoutMs },
  );
}

/** Advance through every step of a live demo lesson (reading skipped via badge). */
export async function playThroughLesson(
  page: Page,
  totalSteps: number,
  actionTimeoutMs = STEP_TIMEOUT,
): Promise<void> {
  // runNextStep ends with waitForReadingPhase, but Next is always disabled on the
  // last step (isLast). Advance through penultimate step, then finish the final one.
  for (let i = 0; i < totalSteps - 2; i++) {
    await runNextStep(page, actionTimeoutMs);
  }
  await completeCurrentStepAction(page, actionTimeoutMs);
  await page.locator('[aria-label="Next step"]').click();
  await finishDemoStep(page, actionTimeoutMs);
}

/** Click the restart button and wait for setup + reading phase. */
export async function restartLesson(page: Page): Promise<void> {
  await page.locator('.demo-live-restart-btn').click();
  await waitForReadingPhase(page, RESTART_TIMEOUT);
}

/** Click exit and wait for the lesson player to reappear. */
export async function exitLesson(page: Page): Promise<void> {
  await page.locator('.demo-live-exit-btn').click();
  await expect(page.locator('.demo-lesson-player')).toBeVisible({ timeout: 15_000 });
}

// ─── State inspection ─────────────────────────────────────────────────────────

/** Return `{ counter, title }` for the current live step (e.g. "4 / 11", "Configure the Connection"). */
export async function getStepInfo(page: Page): Promise<{ counter: string; title: string }> {
  const counter = await page.locator('.demo-live-step-counter').textContent().catch(() => '?/?');
  const title   = await page.locator('.demo-live-step-title').textContent().catch(() => '');
  return { counter: (counter ?? '').trim(), title: (title ?? '').trim() };
}

// ─── Assertions ───────────────────────────────────────────────────────────────

/**
 * Assert that a ReactFlow canvas node does NOT have the `.selected` class.
 * Use this to verify a node's highlight/selection ring was cleared before its
 * config modal was opened.
 */
export async function assertNodeNotSelected(
  page: Page,
  nodeSelector: string,
): Promise<void> {
  const hasSelected = await page
    .locator(nodeSelector)
    .evaluate((el) => el.classList.contains('selected'))
    .catch(() => false);
  expect(
    hasSelected,
    `Expected node "${nodeSelector}" to NOT have .selected class`,
  ).toBe(false);
}

/**
 * Assert a workflow config modal IS visible.
 * Useful to confirm the double-click opened it correctly.
 */
export async function assertConfigModalOpen(page: Page): Promise<void> {
  await expect(page.locator('.wf-config-modal')).toBeVisible({ timeout: 5_000 });
}

/**
 * Assert a workflow config modal is NOT visible.
 * Useful to confirm Save/Close dismissed it cleanly.
 */
export async function assertConfigModalClosed(page: Page): Promise<void> {
  await expect(page.locator('.wf-config-modal')).not.toBeVisible({ timeout: 3_000 });
}

// ─── Screenshot helpers ───────────────────────────────────────────────────────

/**
 * Take a named screenshot into e2e/screenshots/.
 * The filename is sanitised and timestamped so screenshots don't overwrite
 * each other across runs.
 *
 * Screenshots are gitignored; they exist only for local debugging.
 */
export async function takeNamedScreenshot(page: Page, name: string): Promise<void> {
  const dir = path.resolve(process.cwd(), 'e2e/screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safe = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await page.screenshot({ path: path.join(dir, `${safe}-${ts}.png`) });
}
