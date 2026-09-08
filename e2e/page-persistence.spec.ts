import { test, expect } from '@playwright/test';

async function selectHeaderOption(page: import('@playwright/test').Page, testId: string, label: string) {
  const select = page.locator(`[data-testid="${testId}"]`);
  await select.locator('.cs-trigger').click();
  await page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]', { hasText: label }).click();
}

async function expectHeaderValue(select: import('@playwright/test').Locator, value: string) {
  await expect(select).toHaveAttribute('data-value', value);
}

/**
 * Seeds multi-env data via addInitScript so it is available on the FIRST page
 * load.  A localStorage guard prevents the initScript from overwriting
 * data that the app itself saved on subsequent reloads.
 */
function seedMultiEnv(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    // On the first load the guard key is absent → seed.
    // On every reload the guard is already set → skip so app-persisted
    // data (e.g. the newly-selected env) is not clobbered.
    if (localStorage.getItem('__e2e_seed_done__')) return;
    localStorage.setItem('__e2e_seed_done__', '1');

    localStorage.setItem('perf-test-v3-environments', JSON.stringify([
      { id: 'gal-env', name: 'Gallery Samples' },
      { id: 'test-env', name: 'test' },
      { id: 'staging-env', name: 'staging' },
    ]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([
      { id: 'gal-svc', name: 'Gallery Samples', baseUrls: { 'gal-env': '' } },
      { id: 'test-svc', name: 'order-api', baseUrls: { 'test-env': 'https://example.com' } },
      { id: 'staging-svc', name: 'another-service', baseUrls: { 'staging-env': 'https://example2.com' } },
    ]));
    localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([
      { id: 'fg-gal', name: 'Gallery: Sample', source: 'gallery', microserviceId: 'gal-svc', environmentId: 'gal-env', scenarios: [] },
      { id: 'fg-test', name: 'My Tests', microserviceId: 'test-svc', environmentId: 'test-env', scenarios: [{ id: 'sc-1', name: 'Scenario A', tests: [] }] },
      { id: 'fg-staging', name: 'Other Tests', microserviceId: 'staging-svc', environmentId: 'staging-env', scenarios: [] },
    ]));
    localStorage.setItem('perf-test-v3-selected-env', 'gal-env');
    localStorage.setItem('perf-test-v3-selected-svc', 'gal-svc');
    localStorage.setItem('perf-test-v3-migrated', 'true');
  });
}

test.describe('Page persistence across refresh', () => {
  // All tests in this describe block involve page reloads
  test.describe.configure({ mode: 'serial' });

  test('selecting test via sidebar persists after refresh', async ({ page }) => {
    test.slow(); // Involves page reload
    await seedMultiEnv(page);
    await page.goto('http://localhost:5173/?tab=scenarios');
    await page.waitForLoadState('networkidle');

    // Wait for the app to fully load - header dropdown must be visible
    const envDropdown = page.locator('[data-testid="header-env-select"]');
    await expect(envDropdown).toBeVisible({ timeout: 10_000 });
    await expectHeaderValue(envDropdown, 'gal-env');

    // Click test in sidebar
    await page.locator('.sidebar-item-name', { hasText: 'test' }).click();

    // Verify selection changed
    await expectHeaderValue(envDropdown, 'test-env');

    // Check localStorage was updated
    const stored = await page.evaluate(() => ({
      envId: localStorage.getItem('perf-test-v3-selected-env'),
      svcId: localStorage.getItem('perf-test-v3-selected-svc'),
    }));
    expect(stored.envId).toBe('test-env');
    expect(stored.svcId).toBe('test-svc');

    // Feature groups should show test's FGs
    await expect(page.locator('.feature-group-card', { hasText: 'My Tests' })).toBeVisible();

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // After reload: wait for dropdown to be ready, then verify test is selected
    await expect(envDropdown).toBeVisible({ timeout: 10_000 });
    await expectHeaderValue(envDropdown, 'test-env');

    // Sidebar should show test as selected and expanded
    await expect(page.locator('.sidebar-item.selected .sidebar-item-name')).toHaveText('test');

    // Feature groups should show test's FGs, NOT gallery
    await expect(page.locator('.feature-group-card', { hasText: 'My Tests' })).toBeVisible();
    await expect(page.locator('.feature-group-card', { hasText: 'Gallery' })).not.toBeVisible();
  });

  test('selecting test via header dropdowns persists after refresh', async ({ page }) => {
    test.slow(); // Involves page reload
    await seedMultiEnv(page);
    await page.goto('http://localhost:5173/?tab=scenarios');
    await page.waitForLoadState('networkidle');

    // Wait for dropdowns to be ready
    const envDropdown = page.locator('[data-testid="header-env-select"]');
    const svcDropdown = page.locator('[data-testid="header-svc-select"]');
    await expect(envDropdown).toBeVisible({ timeout: 10_000 });

    // Select test via header dropdown
    await selectHeaderOption(page, 'header-env-select', 'test');
    await selectHeaderOption(page, 'header-svc-select', 'order-api');

    // Wait for the selection to propagate (feature card should appear)
    await expect(page.locator('.feature-group-card', { hasText: 'My Tests' })).toBeVisible({ timeout: 5_000 });

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for dropdown to be ready, then verify persistence
    await expect(envDropdown).toBeVisible({ timeout: 10_000 });
    await expectHeaderValue(envDropdown, 'test-env');
    await expectHeaderValue(svcDropdown, 'test-svc');
    await expect(page.locator('.feature-group-card', { hasText: 'My Tests' })).toBeVisible({ timeout: 5_000 });
  });

  test('activeTab=scenarios persists via URL across refresh', async ({ page }) => {
    test.slow(); // Involves page reload
    await seedMultiEnv(page);
    await page.goto('http://localhost:5173/?tab=scenarios');
    await page.waitForLoadState('networkidle');

    // Should be on scenarios tab
    await expect(page.locator('.feature-group-card').first()).toBeVisible({ timeout: 10_000 });

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on scenarios tab
    expect(page.url()).toContain('tab=scenarios');
    await expect(page.locator('.feature-group-card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('localStorage selectedEnvId is NOT overwritten on load', async ({ page }) => {
    test.slow(); // Involves localStorage seeding and full app load
    // Seed with test pre-selected (not gallery) to verify the app respects it.
    await page.addInitScript(() => {
      if (localStorage.getItem('__e2e_seed_done__')) return;
      localStorage.setItem('__e2e_seed_done__', '1');

      localStorage.setItem('perf-test-v3-environments', JSON.stringify([
        { id: 'gal-env', name: 'Gallery Samples' },
        { id: 'test-env', name: 'test' },
        { id: 'staging-env', name: 'staging' },
      ]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([
        { id: 'gal-svc', name: 'Gallery Samples', baseUrls: { 'gal-env': '' } },
        { id: 'test-svc', name: 'order-api', baseUrls: { 'test-env': 'https://example.com' } },
        { id: 'staging-svc', name: 'another-service', baseUrls: { 'staging-env': 'https://example2.com' } },
      ]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([
        { id: 'fg-gal', name: 'Gallery: Sample', source: 'gallery', microserviceId: 'gal-svc', environmentId: 'gal-env', scenarios: [] },
        { id: 'fg-test', name: 'My Tests', microserviceId: 'test-svc', environmentId: 'test-env', scenarios: [{ id: 'sc-1', name: 'Scenario A', tests: [] }] },
        { id: 'fg-staging', name: 'Other Tests', microserviceId: 'staging-svc', environmentId: 'staging-env', scenarios: [] },
      ]));
      // Pre-select test (not gal-env) to verify the app won't overwrite it
      localStorage.setItem('perf-test-v3-selected-env', 'test-env');
      localStorage.setItem('perf-test-v3-selected-svc', 'test-svc');
      localStorage.setItem('perf-test-v3-migrated', 'true');
    });

    await page.goto('http://localhost:5173/?tab=scenarios');
    await page.waitForLoadState('networkidle');

    // Wait for app to fully load
    const envDropdown = page.locator('[data-testid="header-env-select"]');
    await expect(envDropdown).toBeVisible({ timeout: 10_000 });

    // Check that localStorage still has test, not overwritten to gallery or empty
    const stored = await page.evaluate(() => ({
      envId: localStorage.getItem('perf-test-v3-selected-env'),
      svcId: localStorage.getItem('perf-test-v3-selected-svc'),
    }));
    expect(stored.envId).toBe('test-env');
    expect(stored.svcId).toBe('test-svc');

    // Header should show test
    await expectHeaderValue(envDropdown, 'test-env');

    // Feature groups for test should be visible
    await expect(page.locator('.feature-group-card', { hasText: 'My Tests' })).toBeVisible();
  });
});
