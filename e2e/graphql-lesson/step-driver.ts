import type { Page } from '@playwright/test';
import { waitForReadingPhase } from '../demo-player-helpers';
import { DEMO_ACTION_TIMEOUT } from './constants';

export const DEMO_LIVE_PANEL = '[data-testid="demo-live-panel"]';

export async function currentStepNumber(page: Page): Promise<number> {
  const counter = await page.locator('.demo-live-step-counter').textContent();
  const match = counter?.match(/(\d+)\s*\/\s*\d+/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function waitForDemoStepReady(page: Page, timeout = DEMO_ACTION_TIMEOUT): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const p = document.querySelector(sel)?.getAttribute('data-step-phase');
      return p === 'reading' || p === 'done';
    },
    DEMO_LIVE_PANEL,
    { timeout },
  );
}

export async function waitForDemoStepDone(page: Page, timeout = DEMO_ACTION_TIMEOUT): Promise<void> {
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute('data-step-phase') === 'done',
    DEMO_LIVE_PANEL,
    { timeout },
  );
}

export async function skipDemoReading(page: Page): Promise<void> {
  const badge = page.locator('.demo-live-phase-badge.skippable');
  await badge.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  if (await badge.isVisible().catch(() => false)) {
    // Use JS dispatchEvent to avoid Playwright's retry loop when the element
    // briefly detaches due to React re-renders during lesson transitions.
    await page.evaluate(() => {
      const el = document.querySelector('.demo-live-phase-badge.skippable') as HTMLElement | null;
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }
}

export async function completeDemoStep(
  page: Page,
  lessonLabel: string,
  maxSteps: number,
  timeout = DEMO_ACTION_TIMEOUT,
): Promise<void> {
  const stepNum = await currentStepNumber(page);
  const title = (await page.locator('.demo-live-step-title').textContent())?.trim() ?? '';
  await waitForDemoStepReady(page, timeout);
  const phase = await page.locator(DEMO_LIVE_PANEL).getAttribute('data-step-phase');
  if (phase === 'done') return;
  await skipDemoReading(page);
  try {
    await waitForDemoStepDone(page, timeout);
  } catch (err) {
    const stuckPhase = await page.locator(DEMO_LIVE_PANEL).getAttribute('data-step-phase');
    throw new Error(
      `${lessonLabel} step ${stepNum}/${maxSteps} "${title}" stuck in phase "${stuckPhase}" after ${timeout}ms: ${err}`,
      { cause: err },
    );
  }
}

export async function advanceOneDemoStep(
  page: Page,
  lessonLabel: string,
  maxSteps: number,
  timeout = DEMO_ACTION_TIMEOUT,
): Promise<void> {
  const stepBefore = await currentStepNumber(page);
  await completeDemoStep(page, lessonLabel, maxSteps, timeout);

  if (stepBefore >= maxSteps) return;

  const enteringLastStep = stepBefore === maxSteps - 1;
  await page.locator('[aria-label="Next step"]').click();

  if (enteringLastStep) {
    await waitForDemoStepReady(page, timeout);
  } else {
    await waitForReadingPhase(page, timeout);
  }
}

export type DemoLessonWalkOptions = {
  lessonLabel: string;
  steps: number;
  stepTimeout?: (stepIndex: number) => number;
  finalTimeout?: number;
  beforeAdvance?: (page: Page, stepIndex: number) => Promise<void>;
};

/** Factory for full-lesson walks using reading-skip + phase=done advancement. */
export function makeDemoLessonWalk(options: DemoLessonWalkOptions) {
  const { lessonLabel, steps, stepTimeout, finalTimeout, beforeAdvance } = options;
  return async function walkFullLesson(page: Page): Promise<void> {
    for (let i = 0; i < steps - 1; i++) {
      const timeout = stepTimeout?.(i) ?? DEMO_ACTION_TIMEOUT;
      if (beforeAdvance) await beforeAdvance(page, i);
      await advanceOneDemoStep(page, lessonLabel, steps, timeout);
    }
    await completeDemoStep(page, lessonLabel, steps, finalTimeout ?? DEMO_ACTION_TIMEOUT);
  };
}
