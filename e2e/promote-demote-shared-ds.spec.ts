import { test, expect, type Page } from '@playwright/test';

/**
 * Seeds data with:
 * - A test that HAS a data source (for testing promote)
 * - Shared data sources (for testing link/detach)
 */
async function seedWithDataSourceAndSharedDs(page: Page) {
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
          name: 'Promote Test',
          url: 'https://api.example.com/users/{{userId}}',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
          dataSource: {
            columns: [
              { id: 'col-uid', name: 'userId', type: 'path', mapping: 'userId' },
              { id: 'col-name', name: 'userName', type: 'header', mapping: 'X-User-Name' },
            ],
            rows: [
              { id: 'row-1', values: { 'col-uid': 'user-001', 'col-name': 'Alice' }, enabled: true },
              { id: 'row-2', values: { 'col-uid': 'user-002', 'col-name': 'Bob' }, enabled: true },
            ],
            distribution: 'sequential',
            urlTemplate: 'https://api.example.com/users/{{userId}}',
          },
        }, {
          id: 'test-2',
          name: 'Detach Test',
          url: 'https://api.example.com/products',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
          sharedDataSourceId: 'shared-1',
        }],
      }],
    }]));
    localStorage.setItem('perf-test-v3-shared-data-sources', JSON.stringify([{
      id: 'shared-1',
      name: 'Products Shared DS',
      dataSource: {
        columns: [
          { id: 'col-pid', name: 'productId', type: 'path', mapping: 'productId' },
        ],
        rows: [
          { id: 'row-1', values: { 'col-pid': 'prod-001' }, enabled: true },
        ],
        distribution: 'sequential',
        urlTemplate: '',
      },
      tags: ['products'],
    }, {
      id: 'shared-2',
      name: 'Other Shared DS',
      dataSource: {
        columns: [
          { id: 'col-other', name: 'otherId', type: 'path', mapping: 'otherId' },
        ],
        rows: [
          { id: 'row-1', values: { 'col-other': 'other-001' }, enabled: true },
        ],
        distribution: 'sequential',
        urlTemplate: '',
      },
      tags: [],
    }]));
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
  });
}

/** Open test editor for a specific test */
async function openTestEditor(page: Page, testName: string) {
  await page.goto('/?tab=scenarios');
  await expect(page.locator('.app-header')).toBeVisible({ timeout: 5000 });

  // Expand feature group
  const fgName = page.locator('.feature-group-card .feature-group-name', { hasText: 'E2E Feature' });
  await expect(fgName).toBeVisible({ timeout: 5000 });
  await fgName.click();

  // Expand scenario
  const scName = page.locator('.scenario-group-name', { hasText: 'E2E Scenario' });
  await expect(scName).toBeVisible({ timeout: 5000 });
  await scName.click();

  // Wait for test card then click Edit
  const testCard = page.locator('.test-card', { hasText: testName });
  await expect(testCard).toBeVisible({ timeout: 5000 });
  await testCard.locator('button:has-text("Edit")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
}

/** Click the Data / Parameterize tab */
async function clickDataTab(page: Page) {
  const tab = page.locator('.builder-tab', { hasText: /Parameterize|Data Source/ });
  await tab.click();
}

/** Select a shared data source by partial name match */
async function selectSharedDs(page: Page, partialName: string) {
  const select = page.locator('.data-source-toolbar-select').first();
  await select.locator('.cs-trigger').click();
  const option = page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]', { hasText: partialName });
  await expect(option).toBeVisible();
  await option.click();
}

test.describe('Promote & Demote Shared Data Sources', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithDataSourceAndSharedDs(page);
  });

  test.describe('Promote to Shared', () => {
    test('Promote button is visible for test with inline data', async ({ page }) => {
      await openTestEditor(page, 'Promote Test');
      await clickDataTab(page);

      // Test has inline data source (2 rows)
      await expect(page.locator('.data-source-row')).toHaveCount(2);

      // Promote button should be visible
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' })).toBeVisible();
    });

    test('Promote button is hidden for test linked to shared DS', async ({ page }) => {
      await openTestEditor(page, 'Detach Test');
      await clickDataTab(page);

      // Test is linked to shared DS
      await expect(page.locator('.shared-ds-badge', { hasText: 'Products Shared DS' })).toBeVisible();

      // Promote button should NOT be visible
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' })).not.toBeVisible();
    });

    test('Promote modal opens with test name as default', async ({ page }) => {
      await openTestEditor(page, 'Promote Test');
      await clickDataTab(page);

      // Click Promote button
      await page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' }).click();

      // Modal should appear with default name
      const promoteModal = page.locator('.popup-modal');
      await expect(promoteModal).toBeVisible();
      await expect(promoteModal.locator('input[type="text"]').first()).toHaveValue('Promote Test Data');
    });

    test('Promote modal shows preview with column and row counts', async ({ page }) => {
      await openTestEditor(page, 'Promote Test');
      await clickDataTab(page);

      await page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' }).click();

      const preview = page.locator('.popup-modal-preview');
      await expect(preview).toBeVisible();
      await expect(preview).toContainText('2'); // 2 columns
      await expect(preview).toContainText('2'); // 2 rows
    });

    test('Promoting links test to new shared DS and clears inline data', async ({ page }) => {
      await openTestEditor(page, 'Promote Test');
      await clickDataTab(page);

      // Click Promote
      await page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' }).click();

      // Fill in name and confirm
      const promoteModal = page.locator('.popup-modal');
      await promoteModal.locator('input[type="text"]').first().fill('My New Shared DS');
      await promoteModal.locator('button', { hasText: 'Promote & Link' }).click();

      // Modal should close
      await expect(promoteModal).not.toBeVisible();

      // Test should now be linked
      await expect(page.locator('.shared-ds-badge', { hasText: 'My New Shared DS' })).toBeVisible();

      // Detach button should replace Promote
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Detach' })).toBeVisible();
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' })).not.toBeVisible();
    });
  });

  test.describe('Detach with Options', () => {
    test('Detach button is visible for linked test', async ({ page }) => {
      await openTestEditor(page, 'Detach Test');
      await clickDataTab(page);

      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Detach' })).toBeVisible();
    });

    test('Detach dropdown shows Copy to Inline and Unlink Only options', async ({ page }) => {
      await openTestEditor(page, 'Detach Test');
      await clickDataTab(page);

      // Click Detach to open dropdown
      await page.locator('.data-source-toolbar-btn', { hasText: 'Detach' }).click();

      const dropdown = page.locator('.detach-dropdown-menu');
      await expect(dropdown).toBeVisible();
      await expect(dropdown.locator('.detach-dropdown-item', { hasText: 'Copy to Inline' })).toBeVisible();
      await expect(dropdown.locator('.detach-dropdown-item', { hasText: 'Unlink Only' })).toBeVisible();
    });

    test('Copy to Inline copies shared data and unlinks', async ({ page }) => {
      await openTestEditor(page, 'Detach Test');
      await clickDataTab(page);

      // Verify initially linked with 1 row
      await expect(page.locator('.shared-ds-badge', { hasText: 'Products Shared DS' })).toBeVisible();
      await expect(page.locator('.data-source-row')).toHaveCount(1);

      // Click Detach → Copy to Inline
      await page.locator('.data-source-toolbar-btn', { hasText: 'Detach' }).click();
      await page.locator('.detach-dropdown-item', { hasText: 'Copy to Inline' }).click();

      // Should no longer be linked
      await expect(page.locator('.shared-ds-badge')).not.toBeVisible();

      // Data should still be present (copied)
      await expect(page.locator('.data-source-row')).toHaveCount(1);

      // Promote button should now be visible
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' })).toBeVisible();
    });

    test('Unlink Only removes link without copying data', async ({ page }) => {
      await openTestEditor(page, 'Detach Test');
      await clickDataTab(page);

      // Verify initially linked with 1 row
      await expect(page.locator('.shared-ds-badge', { hasText: 'Products Shared DS' })).toBeVisible();
      await expect(page.locator('.data-source-row')).toHaveCount(1);

      // Click Detach → Unlink Only
      await page.locator('.data-source-toolbar-btn', { hasText: 'Detach' }).click();
      await page.locator('.detach-dropdown-item', { hasText: 'Unlink Only' }).click();

      // Should no longer be linked
      await expect(page.locator('.shared-ds-badge')).not.toBeVisible();

      // Should show parameterize empty state (no data)
      await expect(page.getByText('Parameterize This Test')).toBeVisible();
    });
  });

  test.describe('Use Shared dropdown', () => {
    test('Use Shared dropdown shows available shared data sources', async ({ page }) => {
      await openTestEditor(page, 'Promote Test');
      await clickDataTab(page);

      const select = page.locator('.data-source-toolbar-select').first();
      await select.locator('.cs-trigger').click();
      const options = page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]');
      await expect(options.filter({ hasText: 'Products Shared DS' })).toBeVisible();
      await expect(options.filter({ hasText: 'Other Shared DS' })).toBeVisible();
    });

    test('Selecting shared DS links test to it', async ({ page }) => {
      await openTestEditor(page, 'Promote Test');
      await clickDataTab(page);

      // Select shared DS
      await selectSharedDs(page, 'Other Shared DS');

      // Should show linked badge
      await expect(page.locator('.shared-ds-badge', { hasText: 'Other Shared DS' })).toBeVisible();

      // Detach should be visible, Promote should be hidden
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Detach' })).toBeVisible();
      await expect(page.locator('.data-source-toolbar-btn', { hasText: 'Promote to Shared' })).not.toBeVisible();
    });
  });
});
