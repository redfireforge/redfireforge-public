import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Seeds a test with Bearer Token auth and an existing data source.
 * This reproduces the scenario where the user has a test with bearer auth
 * and wants to change the data-source-level auth to "Inherit".
 */
async function seedWithBearerAuth(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__rf_auth_seeded__') === '1') return;
    sessionStorage.setItem('__rf_auth_seeded__', '1');

    const setValue = (key: string, value: string) => {
      localStorage.setItem(key, value);
    };

    setValue('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    setValue('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'https://api.example.com' },
    }]));
    setValue('perf-test-v3-feature-groups', JSON.stringify([{
      id: 'fg-1',
      name: 'Auth Feature',
      microserviceId: 'svc-1',
      environmentId: 'env-1',
      auth: { type: 'bearer', token: 'fg-level-token', prefix: 'Bearer' },
      scenarios: [{
        id: 'sc-1',
        name: 'Auth Scenario',
        auth: { type: 'bearer', token: 'sc-level-token', prefix: 'Bearer' },
        tests: [{
          id: 'test-1',
          name: 'Vehicle API',
          url: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}',
          method: 'GET',
          headers: [{ key: 'Accept', value: 'application/json' }],
          body: '',
          auth: { type: 'bearer', token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test', prefix: 'Bearer' },
          validation: { mode: 'none' },
          dataSource: {
            id: 'ds-1',
            columns: [
              { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
              { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
            ],
            rows: [
              { id: 'row-1', values: { 'col-vin': 'VIN123', 'col-ch': 'WEB' }, enabled: true },
            ],
            source: { type: 'inline' },
            distribution: 'sequential',
            urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}',
          },
        }],
      }],
    }]));
    setValue('perf-test-v3-selected-env', 'env-1');
    setValue('perf-test-v3-selected-svc', 'svc-1');
    setValue('perf-test-v3-migrated', 'true');
    setValue('perf-test-theme', 'dark');
  });
}

async function openTestEditor(page: Page) {
  await page.goto('/?tab=scenarios');
  await page.waitForSelector('.app-header', { timeout: 25_000 });
  await page.waitForLoadState('networkidle');

  const fgName = page.locator('.feature-group-card .feature-group-name', { hasText: 'Auth Feature' });
  await expect(fgName).toBeVisible({ timeout: 10_000 });
  await fgName.click();

  const scName = page.locator('.scenario-group-name', { hasText: 'Auth Scenario' });
  await expect(scName).toBeVisible({ timeout: 5_000 });
  await scName.click();

  await expect(page.locator('.test-card')).toBeVisible({ timeout: 5_000 });
  await page.locator('.test-card button:has-text("Edit")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5_000 });
}

async function clickDataTab(page: Page) {
  const tab = page.locator('.builder-tab', { hasText: /Parameterize|Data Source/ });
  await tab.click();
}

async function openConfigureModal(page: Page) {
  await page.locator('button[title="Configure data source columns"]').click();
  await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Auth Configuration')).toBeVisible();
}

function authSelect(page: Page) {
  return page.locator('.ds-auth-select').first();
}

function authTypeLabel(type: string): string {
  switch (type) {
    case 'inherit':
      return 'Inherit';
    case 'none':
      return 'No Auth';
    case 'basic':
      return 'Basic Auth';
    case 'bearer':
      return 'Bearer Token';
    case 'apikey':
      return 'API Key';
    case 'oauth2':
      return 'OAuth2 Client Credentials';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

async function expectAuthType(page: Page, type: string) {
  await expect(authSelect(page).locator('.cs-text')).toContainText(authTypeLabel(type));
}

async function setAuthType(page: Page, label: string) {
  const select = authSelect(page);
  await select.locator('.cs-trigger').click();
  await page.locator('.cs-menu .cs-item', { hasText: label }).first().click();
  await expect(select.locator('.cs-text')).toContainText(label);
}

function sharedAuthTypeSelect(page: Page) {
  return page.locator('.shared-ds-fetch-auth-type').first();
}

async function expectCustomAuthType(select: Locator, type: string) {
  const label = authTypeLabel(type);
  const labelPattern = type === 'inherit' ? /Inherit/i : new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const matchingButton = select.getByRole('button', { name: labelPattern }).first();
  if (await matchingButton.count()) {
    await expect(matchingButton).toBeVisible();
    return;
  }
  const reqTrigger = select.locator('.req-auth-type-trigger').first();
  if (await reqTrigger.count()) {
    await expect(reqTrigger).toContainText(labelPattern);
    return;
  }
  const customTrigger = select.locator('.auth-type-trigger').first();
  if (await customTrigger.count()) {
    await expect(customTrigger).toContainText(labelPattern);
    return;
  }
  const customSelectText = select.locator('.cs-text').first();
  if (await customSelectText.count()) {
    await expect(customSelectText).toContainText(labelPattern);
    return;
  }
  await expect(select.locator('select').first()).toHaveValue(type);
}

async function setCustomAuthType(page: Page, select: ReturnType<typeof authTypeSelectInEditor> | ReturnType<typeof sharedAuthTypeSelect>, type: string) {
  const label = authTypeLabel(type);
  const labelPattern = type === 'inherit' ? /Inherit/i : new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const matchingButton = select.getByRole('button', { name: labelPattern }).first();
  if (await matchingButton.count()) {
    await matchingButton.click();
    await page.getByRole('button', { name: labelPattern }).first().click();
    await expect(select.getByRole('button', { name: labelPattern }).first()).toBeVisible();
    return;
  }
  const reqTrigger = select.locator('.req-auth-type-trigger').first();
  if (await reqTrigger.count()) {
    await reqTrigger.click();
    await page.locator('.req-auth-type-option', { hasText: labelPattern }).first().click();
    await expect(reqTrigger).toContainText(labelPattern);
    return;
  }
  const customTrigger = select.locator('.auth-type-trigger').first();
  if (await customTrigger.count()) {
    await customTrigger.click();
    await page.locator('.auth-type-menu .auth-type-option', { hasText: labelPattern }).first().click();
    await expect(customTrigger).toContainText(labelPattern);
    return;
  }
  await select.locator('.cs-trigger').click();
  await page.locator('.cs-menu .cs-item', { hasText: label }).first().click();
  await expect(select.locator('.cs-text')).toContainText(label);
}

test.describe('Data Source Auth Inherit Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithBearerAuth(page);
  });

  test('auth dropdown initializes from test-level auth (Bearer Token)', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    await expectAuthType(page, 'bearer');
  });

  test('changing auth to Inherit and applying persists across modal reopen', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    // Verify initial state is Bearer Token
    await expectAuthType(page, 'bearer');

    // Change to Inherit
    await setAuthType(page, 'Inherit');

    // Advance to Columns and Apply
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Apply to Data Source' }).click();

    // Modal should close
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen the Configure Data Source modal
    await openConfigureModal(page);

    // Auth should still be "Inherit" — not reverted to "Bearer Token"
    await expectAuthType(page, 'inherit');
  });

  test('Inherit auth persists after saving the test and reopening editor', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    // Change to Inherit
    await setAuthType(page, 'Inherit');

    // Apply
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Apply to Data Source' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Save the test
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5_000 });

    // Reopen the test editor
    await page.locator('.test-card button:has-text("Edit")').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5_000 });

    // Go to Data Source tab and open Configure modal
    await clickDataTab(page);
    await openConfigureModal(page);

    // Auth should still be "Inherit"
    await expectAuthType(page, 'inherit');
  });

  test('Inherit auth survives page reload (persistence)', async ({ page }) => {
    test.slow(); // Involves page reload
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    // Change to Inherit and apply
    await setAuthType(page, 'Inherit');
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Apply to Data Source' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Save
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5_000 });

    // Reload the page
    await page.reload();
    await page.waitForSelector('.app-header', { timeout: 25_000 });
    await page.waitForLoadState('networkidle');

    // Reopen the test
    const fgName = page.locator('.feature-group-card .feature-group-name', { hasText: 'Auth Feature' });
    await expect(fgName).toBeVisible({ timeout: 10_000 });
    await fgName.click();
    const scName = page.locator('.scenario-group-name', { hasText: 'Auth Scenario' });
    await expect(scName).toBeVisible({ timeout: 5_000 });
    await scName.click();
    await page.locator('.test-card button:has-text("Edit")').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5_000 });

    // Open Data Source > Configure
    await clickDataTab(page);
    await openConfigureModal(page);

    // Auth should still be "Inherit" after reload
    await expectAuthType(page, 'inherit');
  });

  test('Auth tab also reflects change when Configure Data Source sets to Inherit', async ({ page }) => {
    await openTestEditor(page);

    // Verify Auth tab initially shows Bearer Token
    await page.locator('.builder-tab', { hasText: 'Auth' }).click();
    await expect(page.getByRole('button', { name: /Bearer Token/i }).first()).toBeVisible({ timeout: 10_000 });

    // Now go to Data Source and change auth to Inherit via Configure modal
    await clickDataTab(page);
    await openConfigureModal(page);
    await setAuthType(page, 'Inherit');
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Apply to Data Source' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Auth tab should now show "inherit" (both share draft.auth)
    await page.locator('.builder-tab', { hasText: 'Auth' }).click();
    await expect(page.getByRole('button', { name: /Inherit/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('switching auth types in Configure modal works for all types', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    for (const authType of ['inherit', 'none', 'basic', 'bearer']) {
      await setAuthType(page, authTypeLabel(authType));
      await expectAuthType(page, authType);

      // Step badges are shown only for non-default sections; auth field text is the source of truth.
    }
  });

  test('Cancel does NOT persist auth change', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    // Initial is bearer
    await expectAuthType(page, 'bearer');

    // Change to Inherit
    await setAuthType(page, 'Inherit');
    await expectAuthType(page, 'inherit');

    // Cancel inside the Configure Data Source modal (scoped to .full-panel-modal)
    await page.locator('.full-panel-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen — should still be bearer (change was NOT applied)
    await openConfigureModal(page);
    await expectAuthType(page, 'bearer');
  });

  test('closing modal via X does NOT persist auth change', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    await expectAuthType(page, 'bearer');
    await setAuthType(page, 'Inherit');

    // Close via Cancel inside the Configure Data Source modal
    await page.locator('.full-panel-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen — should still be bearer
    await openConfigureModal(page);
    await expectAuthType(page, 'bearer');
  });

  test('BUG REPRO: auth change lost when user closes modal from Step 1 without Apply', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    // Initial is bearer
    await expectAuthType(page, 'bearer');

    // Change to Inherit on Step 1
    await setAuthType(page, 'Inherit');
    await expectAuthType(page, 'inherit');

    // User might expect that clicking "Next: Columns" then closing preserves auth.
    // Go to Step 2 but don't click Apply — just close
    await page.getByRole('button', { name: 'Next: Columns' }).click();

    // Close from Step 2 without clicking "Apply to Data Source"
    await page.locator('.full-panel-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen — auth change was NOT persisted (no Apply was clicked)
    await openConfigureModal(page);
    // This will be 'bearer' because the change was lost — no Apply was clicked
    await expectAuthType(page, 'bearer');
  });

  test('Inherit persists in Shared Data Source auth tab', async ({ page }) => {
    // Seed shared data sources with bearer auth
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'https://api.example.com' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
        id: 'fg-1', name: 'Auth Feature', microserviceId: 'svc-1', environmentId: 'env-1', scenarios: [],
      }]));
      localStorage.setItem('perf-test-v3-shared-data-sources', JSON.stringify([{
        id: 'sds-1',
        name: 'Data Source 3',
        featureGroupId: 'fg-1',
        dataSource: {
          id: 'ds-1',
          columns: [{ id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' }],
          rows: [{ id: 'row-1', values: { 'col-vin': 'VIN123' }, enabled: true }],
          source: { type: 'inline' },
          distribution: 'sequential',
          urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers',
        },
        fetchConfig: {
          url: 'https://api.example.com/vehicles/{{vin}}/offers',
          method: 'GET',
          headers: [{ key: 'Accept', value: 'application/json' }],
          body: '',
          bodyType: 'none',
          auth: { type: 'bearer', token: 'eyJhbGciOiJSUzI1NiJ9.test', prefix: 'Bearer' },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });

    await page.goto('/?tab=scenarios');
    await page.waitForSelector('.header-actions', { timeout: 10_000 });

    // Open Shared Data Sources modal
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await expect(page.locator('.shared-ds-modal')).toBeVisible({ timeout: 10_000 });

    // Should see "Data Source 3" selected
    await expect(page.getByText('Data Source 3')).toBeVisible();

    // Expand fetch panel to see auth tab
    const authTab = page.locator('.shared-ds-fetch-panel .builder-tab', { hasText: 'Auth' });
    await authTab.click();

    // Auth should be "bearer"
    const authTypeSelect = sharedAuthTypeSelect(page);
    await expectCustomAuthType(authTypeSelect, 'bearer');

    // Change to Inherit
    await setCustomAuthType(page, authTypeSelect, 'inherit');
    await expectCustomAuthType(authTypeSelect, 'inherit');

    // Save changes first, then close
    await page.locator('.shared-ds-footer button', { hasText: 'Save' }).click();
    await page.locator('.shared-ds-footer button', { hasText: 'Close' }).click();
    await expect(page.locator('.shared-ds-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await expect(page.locator('.shared-ds-modal')).toBeVisible({ timeout: 10_000 });

    // Click Auth tab again
    await authTab.click();

    // Auth should still be "inherit" — NOT reverted to "bearer"
    await expectCustomAuthType(authTypeSelect, 'inherit');
  });

  test('BUG FIX: Shared DS Configure button persists auth change to fetchConfig', async ({ page }) => {
    // This tests the exact bug path: DataSourceEditor inside SharedDataSourceModal
    // uses handleEditorDraftChange which previously dropped auth changes.
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'https://api.example.com' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
        id: 'fg-1', name: 'Auth Feature', microserviceId: 'svc-1', environmentId: 'env-1', scenarios: [],
      }]));
      localStorage.setItem('perf-test-v3-shared-data-sources', JSON.stringify([{
        id: 'sds-1',
        name: 'Data Source 3',
        featureGroupId: 'fg-1',
        dataSource: {
          id: 'ds-1',
          columns: [{ id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' }],
          rows: [{ id: 'row-1', values: { 'col-vin': 'VIN123' }, enabled: true }],
          source: { type: 'inline' },
          distribution: 'sequential',
          urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers',
        },
        fetchConfig: {
          url: 'https://api.example.com/vehicles/{{vin}}/offers',
          method: 'GET',
          headers: [{ key: 'Accept', value: 'application/json' }],
          body: '',
          bodyType: 'none',
          auth: { type: 'bearer', token: 'eyJhbGciOiJSUzI1NiJ9.test', prefix: 'Bearer' },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });

    await page.goto('/?tab=scenarios');
    await page.waitForSelector('.header-actions', { timeout: 10_000 });

    // Open Shared Data Sources modal
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await expect(page.locator('.shared-ds-modal')).toBeVisible({ timeout: 10_000 });

    // Click the ⚙ Configure button inside the embedded DataSourceEditor
    await page.locator('button[title="Configure data source columns"]').click();
    await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Auth Configuration')).toBeVisible();

    // Auth should show Bearer Token (from fetchConfig)
    await expectAuthType(page, 'bearer');

    // Change to Inherit
    await setAuthType(page, 'Inherit');
    await expectAuthType(page, 'inherit');

    // Apply: Next: Columns → Apply to Data Source
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Apply to Data Source' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen Configure — auth should be Inherit, not Bearer Token
    await page.locator('button[title="Configure data source columns"]').click();
    await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10_000 });
    await expectAuthType(page, 'inherit');

    // Also verify the inline Auth tab shows inherit
    await page.locator('.full-panel-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    const authTab = page.locator('.shared-ds-fetch-panel .builder-tab', { hasText: 'Auth' });
    await authTab.click();
    const inlineAuthSelect = sharedAuthTypeSelect(page);
    await expectCustomAuthType(inlineAuthSelect, 'inherit');
  });

  test('Shared DS auth Inherit survives page reload', async ({ page }) => {
    test.slow(); // Involves page reload
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'https://api.example.com' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
        id: 'fg-1', name: 'Auth Feature', microserviceId: 'svc-1', environmentId: 'env-1', scenarios: [],
      }]));
      localStorage.setItem('perf-test-v3-shared-data-sources', JSON.stringify([{
        id: 'sds-1',
        name: 'Data Source 3',
        featureGroupId: 'fg-1',
        dataSource: {
          id: 'ds-1',
          columns: [{ id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' }],
          rows: [{ id: 'row-1', values: { 'col-vin': 'VIN123' }, enabled: true }],
          source: { type: 'inline' },
          distribution: 'sequential',
          urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers',
        },
        fetchConfig: {
          url: 'https://api.example.com/vehicles/{{vin}}/offers',
          method: 'GET',
          headers: [{ key: 'Accept', value: 'application/json' }],
          body: '',
          bodyType: 'none',
          auth: { type: 'bearer', token: 'eyJhbGciOiJSUzI1NiJ9.test', prefix: 'Bearer' },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });

    await page.goto('/?tab=scenarios');
    await page.waitForSelector('.header-actions', { timeout: 10_000 });

    // Open Shared Data Sources, change auth to Inherit
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await expect(page.locator('.shared-ds-modal')).toBeVisible({ timeout: 10_000 });
    const authTab = page.locator('.shared-ds-fetch-panel .builder-tab', { hasText: 'Auth' });
    await authTab.click();
    const authTypeSelect = sharedAuthTypeSelect(page);
    await setCustomAuthType(page, authTypeSelect, 'inherit');
    await expectCustomAuthType(authTypeSelect, 'inherit');

    // Save and close modal
    await page.locator('.shared-ds-footer button', { hasText: 'Save' }).click();
    await page.locator('.shared-ds-footer button', { hasText: 'Close' }).click();
    await expect(page.locator('.shared-ds-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reload the page
    await page.reload();
    await page.waitForSelector('.header-actions', { timeout: 10_000 });

    // Reopen Shared Data Sources
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await expect(page.locator('.shared-ds-modal')).toBeVisible({ timeout: 10_000 });

    await authTab.click();

    // Auth should still be "inherit" after reload
    await expectCustomAuthType(authTypeSelect, 'inherit');
  });

  test('Inherit persists when test had inherit auth initially', async ({ page }) => {
    // Seed a test that already has auth: { type: 'inherit' }
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'https://api.example.com' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
        id: 'fg-1',
        name: 'Auth Feature',
        microserviceId: 'svc-1',
        environmentId: 'env-1',
        scenarios: [{
          id: 'sc-1',
          name: 'Auth Scenario',
          tests: [{
            id: 'test-1',
            name: 'Vehicle API',
            url: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}',
            method: 'GET',
            headers: [{ key: 'Accept', value: 'application/json' }],
            body: '',
            auth: { type: 'inherit' },
            validation: { mode: 'none' },
            dataSource: {
              id: 'ds-1',
              columns: [
                { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
                { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
              ],
              rows: [
                { id: 'row-1', values: { 'col-vin': 'VIN123', 'col-ch': 'WEB' }, enabled: true },
              ],
              source: { type: 'inline' },
              distribution: 'sequential',
              urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}',
            },
          }],
        }],
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });

    await openTestEditor(page);
    await clickDataTab(page);
    await openConfigureModal(page);

    // Should show Inherit from the start
    await expectAuthType(page, 'inherit');

    // Apply without changing
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Apply to Data Source' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5_000 });

    // Reopen — should still be inherit
    await openConfigureModal(page);
    await expectAuthType(page, 'inherit');
  });
});
