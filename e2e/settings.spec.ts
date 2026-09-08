import { test, expect } from '@playwright/test';
import { seedAppData } from './helpers';

test.describe('Settings and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await seedAppData(page);
    await page.goto('/?tab=scenarios');
    await page.waitForSelector('.app-header', { timeout: 25000 });
    await page.waitForLoadState('networkidle');
  });

  test('sidebar shows environment items', async ({ page }) => {
    // exact: the sidebar also lists the "test-service" microservice, which a
    // substring match would collide with.
    const sidebar = page.locator('.config-sidebar-inner');
    await expect(sidebar.getByText('test', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('can switch between tabs', async ({ page }) => {
    await page.click('.sub-nav-tab:has-text("Test Runner")');
    await expect(page.locator('.sub-nav-tab.active')).toHaveText('Test Runner');

    await page.click('.sub-nav-tab:has-text("Results")');
    await expect(page.locator('.sub-nav-tab.active')).toHaveText('Results');

    await page.click('.sub-nav-tab:has-text("Feature Groups")');
    await expect(page.locator('.sub-nav-tab.active')).toHaveText('Feature Groups');
  });

  test('toggle dark/light theme', async ({ page }) => {
    const themeBtn = page.locator('.theme-toggle');
    await themeBtn.click();

    const body = page.locator('.app');
    await expect(body).toBeVisible();
  });

  test('sidebar toggle collapses and expands', async ({ page }) => {
    const sidebar = page.locator('.config-sidebar-inner');
    await expect(sidebar).toBeVisible();

    // Click the USB toggle to collapse
    const toggleBtn = page.locator('.usb-toggle-btn');
    await toggleBtn.click();

    // Sidebar should disappear
    await expect(sidebar).toBeHidden();

    // Click again to expand
    await toggleBtn.click();
    await expect(sidebar).toBeVisible();
  });

  test('context tags show service and environment', async ({ page }) => {
    // Context tags are in the builder header at the top
    await expect(page.locator('.context-tag:has-text("test-service")').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.context-tag:has-text("test")').first()).toBeVisible();
  });
});
