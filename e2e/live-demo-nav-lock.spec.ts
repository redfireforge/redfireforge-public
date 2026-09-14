import { test, expect, type Page } from '@playwright/test';
import { openDemoHub, startLesson } from './demo-player-helpers';

/**
 * Human activity-bar clicks during a live lesson must prompt Stay / Leave
 * instead of silently ending the demo.
 */

async function openMultiEnvConcept(page: Page): Promise<void> {
  await openDemoHub(page);
  const apiDomain = page.locator('.demo-domain-card').filter({ hasText: /api/i }).first();
  await apiDomain.click();
  await page.waitForSelector('.demo-lesson-list', { timeout: 15_000 });
  const requestsTab = page.locator('.demo-category-tab').filter({ hasText: /requests/i }).first();
  if (await requestsTab.count()) {
    await requestsTab.click();
  }
  await page
    .locator('.demo-lesson-item')
    .filter({ hasText: /Multi-Environment Requests/i })
    .first()
    .click();
  await page.waitForSelector('.demo-lesson-player', { timeout: 15_000 });
}

test.describe('Live demo activity-bar lock', () => {
  test('Stay keeps the lesson; Leave demo exits then navigates', async ({ page }) => {
    test.setTimeout(90_000);
    await openMultiEnvConcept(page);
    await startLesson(page);
    await expect(page.locator('.demo-live-panel')).toBeVisible();

    await page.getByTestId('ab-workflow').click();
    await expect(page.getByTestId('live-demo-leave-overlay')).toBeVisible();
    await expect(page.locator('.demo-live-panel')).toBeVisible();

    await page.getByTestId('live-demo-leave-stay').click();
    await expect(page.getByTestId('live-demo-leave-overlay')).toHaveCount(0);
    await expect(page.locator('.demo-live-panel')).toBeVisible();

    await page.getByTestId('ab-demo-hub').click();
    await expect(page.getByTestId('live-demo-leave-overlay')).toBeVisible();
    await page.getByTestId('live-demo-leave-leave').click();
    await expect(page.locator('.demo-live-panel')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('ab-demo-hub')).toHaveClass(/active/);
    await expect(page.locator('.demo-lesson-player, .demo-hub-pane').first()).toBeVisible({ timeout: 15_000 });
  });
});
