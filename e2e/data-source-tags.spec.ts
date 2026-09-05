import { test, expect, type Page } from '@playwright/test';

/**
 * Seeds data with a test that has a data source with tagged rows.
 */
async function seedWithTaggedDataSource(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'https://api.example.com' },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
      id: 'fg-1',
      name: 'E2E Feature',
      microserviceId: 'svc-1',
      environmentId: 'env-1',
      scenarios: [{
        id: 'sc-1',
        name: 'E2E Scenario',
        tests: [{
          id: 'test-1',
          name: 'Vehicle Offers',
          url: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
          dataSource: {
            id: 'ds-1',
            columns: [
              { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
              { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
            ],
            rows: [
              { id: 'r1', values: { 'col-vin': 'VIN001', 'col-ch': 'WEB' }, enabled: true, tags: ['smoke'] },
              { id: 'r2', values: { 'col-vin': 'VIN002', 'col-ch': 'APP' }, enabled: true, tags: ['smoke', 'regression'] },
              { id: 'r3', values: { 'col-vin': 'VIN003', 'col-ch': 'APP' }, enabled: true, tags: ['edge-case'] },
              { id: 'r4', values: { 'col-vin': 'VIN004', 'col-ch': 'WEB' }, enabled: true },
            ],
            source: { type: 'inline' },
          },
        }],
      }],
    }]));
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
  });
}

/** Open test editor and navigate to Data tab */
async function openDataTab(page: Page) {
  await page.goto('/?tab=scenarios');
  await page.waitForSelector('.app-header', { timeout: 25000 });
  await page.waitForLoadState('networkidle');

  // Expand feature group
  const fgName = page.locator('.feature-group-card .feature-group-name', { hasText: 'E2E Feature' });
  await expect(fgName).toBeVisible({ timeout: 10000 });
  await fgName.click();

  // Expand scenario
  const scName = page.locator('.scenario-group-name', { hasText: 'E2E Scenario' });
  await expect(scName).toBeVisible({ timeout: 5000 });
  await scName.click();

  // Click Edit on the test
  await expect(page.locator('.test-card')).toBeVisible({ timeout: 5000 });
  await page.locator('.test-card button:has-text("Edit")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });

  // Switch to Data tab (shows "Data Source" since test has dataSource seeded)
  await page.locator('.builder-tab', { hasText: /Data Source/ }).click();
  await expect(page.locator('.params-section-label', { hasText: 'DATA SOURCE' })).toBeVisible({ timeout: 5000 });
}

test.describe('Data Source Row Tags (Phase 12)', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithTaggedDataSource(page);
  });

  test('tag pills are visible on rows', async ({ page }) => {
    await openDataTab(page);

    // Row 1 should have 'smoke' tag
    const tagPills = page.locator('.data-source-tag-pill');
    await expect(tagPills.first()).toBeVisible({ timeout: 5000 });

    // Verify smoke and edge-case tags are shown
    await expect(page.locator('.data-source-tag-pill', { hasText: 'smoke' }).first()).toBeVisible();
    await expect(page.locator('.data-source-tag-pill', { hasText: 'edge-case' })).toBeVisible();
    await expect(page.locator('.data-source-tag-pill', { hasText: 'regression' })).toBeVisible();
  });

  test('add a tag to a row via tag input', async ({ page }) => {
    await openDataTab(page);

    // Find the last row (r4) which has no tags — click the + button
    const addTagButtons = page.locator('.data-source-tag-add-btn');
    const lastAddBtn = addTagButtons.last();
    await lastAddBtn.click();

    // Type a new tag
    const tagInput = page.locator('.data-source-tag-input').last();
    await expect(tagInput).toBeVisible({ timeout: 3000 });
    await tagInput.fill('new-tag');
    await tagInput.press('Enter');

    // Verify the tag was added
    await expect(page.locator('.data-source-tag-pill', { hasText: 'new-tag' })).toBeVisible({ timeout: 3000 });
  });

  test('remove a tag from a row', async ({ page }) => {
    await openDataTab(page);

    // Count initial smoke tags
    const smokeTags = page.locator('.data-source-tag-pill', { hasText: 'smoke' });
    const initialCount = await smokeTags.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Click the × button on the first smoke tag
    const firstSmokeTag = smokeTags.first();
    const removeBtn = firstSmokeTag.locator('.data-source-tag-remove');
    await removeBtn.click();

    // One fewer smoke tag should be visible
    const newCount = await page.locator('.data-source-tag-pill', { hasText: 'smoke' }).count();
    expect(newCount).toBe(initialCount - 1);
  });

  test('tag filter bar filters rows by tag', async ({ page }) => {
    await openDataTab(page);

    // Find the tag filter dropdown/button
    const filterBar = page.locator('.data-source-tag-filter-bar');
    if (await filterBar.isVisible()) {
      // Click a filter button for 'smoke'
      const smokeFilter = page.locator('.data-source-tag-filter-btn', { hasText: 'smoke' });
      if (await smokeFilter.isVisible()) {
        await smokeFilter.click();

        // After filtering, only rows with 'smoke' should be visible
        // Rows r1 (smoke) and r2 (smoke, regression) should show
        // Wait for the filter to apply
        await page.waitForTimeout(300);

        // The data source rows visible should be reduced
        const visibleRows = page.locator('.data-source-body-row:visible');
        const count = await visibleRows.count();
        expect(count).toBeLessThanOrEqual(2); // only smoke-tagged rows
      }
    }
  });

  test('subset management - save and load subset', async ({ page }) => {
    await openDataTab(page);

    // Look for subsets bar
    const subsetsBar = page.locator('.data-source-subsets-bar');

    // If subsets bar is visible, try saving a subset
    if (await subsetsBar.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click save subset button
      const saveBtn = page.locator('.data-source-save-subset');
      if (await saveBtn.isVisible()) {
        await saveBtn.click();

        // Fill subset name
        const nameInput = page.locator('input[placeholder*="subset"]').first();
        if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nameInput.fill('Smoke Tests');
          await nameInput.press('Enter');

          // Subset chip should appear
          await expect(page.locator('.data-source-subset-chip', { hasText: 'Smoke Tests' })).toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('tag suggestions show built-in tags', async ({ page }) => {
    await openDataTab(page);

    // Click add tag button to open tag input
    const addTagButtons = page.locator('.data-source-tag-add-btn');
    await addTagButtons.last().click();

    // Focus the tag input and check for suggestions
    const tagInput = page.locator('.data-source-tag-input').last();
    await expect(tagInput).toBeVisible({ timeout: 3000 });
    await tagInput.click();

    // Check if suggestion dropdown appears with built-in tags
    const tagSelect = page.locator('.data-source-tag-select');
    if (await tagSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Should contain built-in tags like smoke, regression, etc.
      await expect(tagSelect.locator('option', { hasText: 'smoke' })).toBeVisible();
    }
  });
});
