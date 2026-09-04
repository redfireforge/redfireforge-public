/**
 * Kafka Schema Registry demo — first step settles on the Schema tab once.
 *
 * Requires Schema Registry on :8085. This spec is in the `docker` project
 * (not demo-stepthrough). Global-setup starts `docker/kafka/schema-registry`
 * when `E2E_WITH_DOCKER=1`.
 *
 *   E2E_WITH_DOCKER=1 npx playwright test --project=docker e2e/demo-kafka-schema-registry.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  completeCurrentStepAction,
  openDemoHub,
  openLesson,
  selectCategory,
  selectProtocolsDomain,
  startLesson,
  takeNamedScreenshot,
  waitForPrerequisiteGateUp,
} from './demo-player-helpers';

test.describe('Kafka Schema Registry demo', () => {
  test('first step opens the Schema Registry tab once and then stays settled', async ({ page }) => {
    test.setTimeout(180_000);
    await openDemoHub(page);
    await selectProtocolsDomain(page);
    await selectCategory(page, 'Kafka');
    await openLesson(page, 'Schema Registry');
    await waitForPrerequisiteGateUp(page, 60_000);

    await page.evaluate(() => {
      (window as Window & { __schemaTabClickCount?: number }).__schemaTabClickCount = 0;
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('[data-testid="tab-schema"]')) {
          (window as Window & { __schemaTabClickCount?: number }).__schemaTabClickCount! += 1;
        }
      }, { capture: true });
    });

    await startLesson(page);

    await expect(page.locator('.demo-live-step-title')).toHaveText('The Schema Registry Tab');
    await completeCurrentStepAction(page);
    await expect(page.locator('[data-testid="tab-schema"]')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(
      () => (window as Window & { __schemaTabClickCount?: number }).__schemaTabClickCount,
    )).toBe(1);
    await takeNamedScreenshot(page, 'kafka-schema-registry-step-1-settled');
  });
});
