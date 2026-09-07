import { test, expect } from '@playwright/test';
import { seedAppDataWithTest as _seedAppDataWithTest } from './helpers';

/**
 * E2E tests for popup modals (CopyTestModal, MoveModal).
 * Verifies modal opens, overlay renders, user can interact, and modal closes.
 */
test.describe('Popup Modals', () => {
  test.beforeEach(async ({ page }) => {
    // Seed with 2 feature groups so copy/move have targets
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'http://localhost:5173' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([
        {
          id: 'fg-1', name: 'Feature A', microserviceId: 'svc-1', environmentId: 'env-1',
          scenarios: [
            { id: 'sc-1', name: 'Scenario One', tests: [
              { id: 'test-1', name: 'GET Health', url: 'http://localhost:5173/', method: 'GET', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } },
            ]},
            { id: 'sc-2', name: 'Scenario Two', tests: [] },
          ],
        },
        {
          id: 'fg-2', name: 'Feature B', microserviceId: 'svc-1', environmentId: 'env-1',
          scenarios: [
            { id: 'sc-3', name: 'Scenario Three', tests: [] },
          ],
        },
      ]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });
    await page.goto('/');
    // Navigate to Harness tab via activity bar button
    await page.click('.ab-btn[title="Harness"]');
  });

  test.describe('CopyTestModal', () => {
    test('opens copy modal and shows test name', async ({ page }) => {
      // Expand the feature group and scenario
      await page.click('text=Feature A');
      await page.click('text=Scenario One');
      // Click Copy button on the test row
      const copyBtn = page.locator('button[title*="Copy"]').first();
      await copyBtn.click();

      // Modal should appear with title
      await expect(page.locator('.popup-modal')).toBeVisible();
      await expect(page.locator('.popup-modal-banner')).toContainText('GET Health');
    });

    test('copy modal has semi-transparent overlay', async ({ page }) => {
      await page.click('text=Feature A');
      await page.click('text=Scenario One');
      await page.locator('button[title*="Copy"]').first().click();

      const overlay = page.locator('.popup-modal-overlay');
      await expect(overlay).toBeVisible();
    });

    test('copy modal closes on Cancel', async ({ page }) => {
      await page.click('text=Feature A');
      await page.click('text=Scenario One');
      await page.locator('button[title*="Copy"]').first().click();

      await expect(page.locator('.popup-modal')).toBeVisible();
      await page.click('.popup-modal >> text=Cancel');
      await expect(page.locator('.popup-modal')).not.toBeVisible();
    });

    test('copy modal has no resize handles or expand button', async ({ page }) => {
      await page.click('text=Feature A');
      await page.click('text=Scenario One');
      await page.locator('button[title*="Copy"]').first().click();

      await expect(page.locator('.popup-modal')).toBeVisible();
      await expect(page.locator('.popup-modal .modal-resize-corner')).not.toBeVisible();
      await expect(page.locator('.popup-modal .modal-expand-btn').first()).not.toBeVisible();
    });
  });

  test.describe('MoveModal', () => {
    test('opens move scenario modal and shows item name', async ({ page }) => {
      await page.click('text=Feature A');
      const moveBtn = page.locator('button[title*="Move"]').first();
      await moveBtn.click();

      await expect(page.locator('.popup-modal')).toBeVisible();
      await expect(page.locator('.popup-modal-banner')).toContainText('Moving');
    });

    test('move modal disables Move button initially', async ({ page }) => {
      await page.click('text=Feature A');
      await page.locator('button[title*="Move"]').first().click();

      const moveBtn = page.locator('.popup-modal >> button:has-text("Move")');
      await expect(moveBtn).toBeDisabled();
    });

    test('move modal closes on Cancel', async ({ page }) => {
      await page.click('text=Feature A');
      await page.locator('button[title*="Move"]').first().click();

      await expect(page.locator('.popup-modal')).toBeVisible();
      await page.click('.popup-modal >> text=Cancel');
      await expect(page.locator('.popup-modal')).not.toBeVisible();
    });
  });
});
