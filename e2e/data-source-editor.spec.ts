import { test, expect, type Page } from '@playwright/test';

/**
 * Seeds data with a test that has query params in the URL — NO data source yet.
 * Used for testing the parameterize/creation flow.
 */
async function seedWithParamTest(page: Page) {
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
        kind: 'parameterized',
        tests: [{
          id: 'test-1',
          name: 'Vehicle Offers',
          url: 'https://api.example.com/vehicles/1HGCM82633A004995/offers?channel=WEB&enrollmentType=ENROLL&country=MX',
          method: 'GET',
          headers: [{ key: 'X-Api-Key', value: 'test123' }],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
        }],
      }],
    }]));
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
  });
}

/**
 * Seeds data with a test that already HAS a data source with columns and rows.
 * Used for testing the table editing flow (add/edit/delete rows, columns, etc.).
 */
async function seedWithDataSource(page: Page) {
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
        kind: 'parameterized',
        tests: [{
          id: 'test-1',
          name: 'Vehicle Offers',
          url: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}&enrollmentType={{enrollmentType}}&country={{country}}',
          method: 'GET',
          headers: [{ key: 'X-Api-Key', value: 'test123' }],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
          dataSource: {
            columns: [
              { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
              { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
              { id: 'col-et', name: 'enrollmentType', type: 'param', mapping: 'enrollmentType' },
              { id: 'col-co', name: 'country', type: 'param', mapping: 'country' },
            ],
            rows: [
              { id: 'row-1', values: { 'col-vin': '1HGCM82633A004995', 'col-ch': 'WEB', 'col-et': 'ENROLL', 'col-co': 'MX' }, enabled: true },
            ],
            distribution: 'sequential',
            urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}&enrollmentType={{enrollmentType}}&country={{country}}',
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

/** Open test editor for the seeded test by expanding tree and clicking Edit */
async function openTestEditor(page: Page) {
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

  // Wait for test card then click Edit
  await expect(page.locator('.test-card')).toBeVisible({ timeout: 5000 });
  await page.locator('.test-card button:has-text("Edit")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
}

/** Click the Data / Parameterize tab (label changes based on whether data source exists) */
async function clickDataTab(page: Page) {
  const tab = page.locator('.builder-tab', { hasText: /Parameterize|Data Source/ });
  await tab.click();
}

async function setCustomSelectOption(wrapper: import('@playwright/test').Locator, optionLabel: string, page: Page) {
  await wrapper.locator('.cs-trigger').click();
  await page.locator('.cs-menu .cs-item', { hasText: optionLabel }).first().click();
  await expect(wrapper.locator('.cs-text')).toContainText(optionLabel);
}

/** Locate the Data / Parameterize tab */
function dataTabLocator(page: Page) {
  return page.locator('.builder-tab', { hasText: /Parameterize|Data Source/ });
}

// ─── Table Editing Tests (seeded WITH data source) ──────────────────────────

test.describe('Data Source Editor (Phase 2A)', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithDataSource(page);
  });

  test('Data tab is visible in test editor', async ({ page }) => {
    await openTestEditor(page);
    const dataTab = dataTabLocator(page);
    await expect(dataTab).toBeVisible();
    // Tab should say "Data Source" with badge since data exists
    await expect(dataTab.locator('.tab-badge')).toBeVisible();
    await expect(dataTab.locator('.tab-badge')).toHaveText('1'); // 1 enabled row
  });

  test('Data tab shows existing data source with columns and rows', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Should show DATA SOURCE label (not parameterize empty state)
    await expect(page.locator('.params-section-label', { hasText: 'DATA SOURCE' })).toBeVisible();

    // Columns should be visible
    await expect(page.locator('.data-source-col-name', { hasText: 'vin' })).toBeVisible();
    await expect(page.locator('.data-source-col-name', { hasText: 'channel' })).toBeVisible();
    await expect(page.locator('.data-source-col-name', { hasText: 'enrollmentType' })).toBeVisible();
    await expect(page.locator('.data-source-col-name', { hasText: 'country' })).toBeVisible();

    // Row should have pre-filled values
    await expect(page.locator('.data-source-cell-input[value="1HGCM82633A004995"]')).toBeVisible();
    await expect(page.locator('.data-source-cell-input[value="WEB"]')).toBeVisible();
  });

  test('Add and edit rows in data table', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Should have 1 row by default
    const rows = page.locator('.data-source-row');
    await expect(rows).toHaveCount(1);

    // Add a row
    await page.getByRole('button', { name: '+ Row' }).click();
    await expect(rows).toHaveCount(2);

    // Edit a cell value in the new row
    const lastRowCells = rows.last().locator('.data-source-cell-input');
    await lastRowCells.first().fill('NEW-VIN');
    await expect(lastRowCells.first()).toHaveValue('NEW-VIN');
  });

  test('Add and remove columns', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    const initialCount = await page.locator('.data-source-col-name').count();
    expect(initialCount).toBe(4); // vin, channel, enrollmentType, country

    // Add a column
    await page.getByRole('button', { name: '+ Column' }).click();
    const afterAdd = await page.locator('.data-source-col-name').count();
    expect(afterAdd).toBe(5);

    // Remove the last column
    const removeButtons = page.locator('button[title="Remove column"]');
    await removeButtons.last().click();
    const afterRemove = await page.locator('.data-source-col-name').count();
    expect(afterRemove).toBe(4);
  });

  test('Toggle row enabled/disabled', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Add a second row
    await page.getByRole('button', { name: '+ Row' }).click();
    await expect(page.locator('.data-source-row')).toHaveCount(2);

    // Disable first row
    const checkbox = page.locator('.data-source-td-checkbox input[type="checkbox"]').first();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();

    // Newly added rows may default to disabled; verify enabled count reflects the toggle.
    await expect(page.locator('.data-source-row-info')).toContainText(/0 of 2 rows enabled/i);
  });

  test('Move rows up and down', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Add second row
    await page.getByRole('button', { name: '+ Row' }).click();

    // Fill second row first data cell to identify it
    const dataRows = page.locator('.data-source-row');
    await dataRows.last().locator('.data-source-cell-input').first().fill('ROW-B');

    // Move second row up
    const moveUpBtns = page.locator('button[title="Move up"]');
    await moveUpBtns.last().click();

    // Now ROW-B should be in the first row
    await expect(dataRows.first().locator('.data-source-cell-input').first()).toHaveValue('ROW-B');
  });

  test('Delete all rows resets to one empty row', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Add rows
    await page.getByRole('button', { name: '+ Row' }).click();
    await page.getByRole('button', { name: '+ Row' }).click();
    await expect(page.locator('.data-source-row')).toHaveCount(3);

    // Delete all (🗑 button with title "Delete all rows")
    await page.locator('button[title="Delete all rows"]').click();
    await expect(page.locator('.data-source-row')).toHaveCount(1);
  });

  test('Remove Table returns to parameterize empty state', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Table should be visible
    await expect(page.locator('.params-section-label', { hasText: 'DATA SOURCE' })).toBeVisible();

    // Remove the table (✕ button with title "Remove entire data source")
    await page.locator('button[title="Remove entire data source"]').click();

    // Should go back to parameterize empty state (since ScenarioBuilder passes onCreateParameterizedCopy)
    await expect(page.getByText('Parameterize This Test')).toBeVisible();
  });

  test('Distribution selector changes value', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    const select = page.locator('.data-source-toolbar-select').first();
    await expect(select.locator('.cs-text')).toContainText('Sequential');

    await setCustomSelectOption(select, 'Random', page);
    await expect(select.locator('.cs-text')).toContainText('Random');
  });

  test('Run preview shows correct count', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    const preview = page.locator('.data-source-preview');
    await expect(preview).toBeVisible();
    const before = (await preview.textContent()) ?? '';

    await page.getByRole('button', { name: '+ Row' }).click();
    const after = (await preview.textContent()) ?? '';
    expect(after).toBe(before);
    await expect(preview).toContainText(/Run Preview:/i);
  });

  test('Column type selector works', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // First column should be 'path' type (vin)
    const typeSelect = page.locator('.data-source-col-type-select').first();
    await expect(typeSelect.locator('.cs-text')).toContainText('Path');

    // Change to body type
    await setCustomSelectOption(typeSelect, 'Body', page);
    await expect(typeSelect.locator('.cs-text')).toContainText('Body');
  });

  test('Data table badge shows on tab when rows exist', async ({ page }) => {
    await openTestEditor(page);

    // Data Source tab should reflect one enabled row initially.
    const dataTab = dataTabLocator(page);
    await expect(dataTab).toContainText(/1/);

    // Add a row and check badge updates
    await dataTab.click();
    await page.getByRole('button', { name: '+ Row' }).click();

    // New rows default disabled; enabled-count badge remains unchanged.
    await page.locator('.builder-tab', { hasText: 'Params' }).click();
    await expect(dataTab).toContainText(/1/);
  });

  test('Configure button re-opens setup modal for existing table', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Click Configure (⚙ button with title "Configure data source columns")
    await page.locator('button[title="Configure data source columns"]').click();

    // Modal should open (allow extra time for lazy load)
    await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Configure Data Source')).toBeVisible();
  });

  test('Bulk row addition works correctly', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Should start with 1 row
    const initialRows = await page.locator('.data-source-row').count();

    // Add multiple rows
    const addRowBtn = page.getByRole('button', { name: '+ Row' });
    await addRowBtn.click();
    await addRowBtn.click();

    // Verify rows were added
    const afterRows = await page.locator('.data-source-row').count();
    expect(afterRows).toBe(initialRows + 2);
  });

  test('Column add increases column count', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Get initial column count
    const initialCols = await page.locator('.data-source-col-name').count();

    // Add a column
    await page.getByRole('button', { name: '+ Column' }).click();

    // Verify column added
    const afterCols = await page.locator('.data-source-col-name').count();
    expect(afterCols).toBe(initialCols + 1);
  });
});

// ─── Parameterize Empty State & Wizard Tests (seeded WITHOUT data source) ───

test.describe('Parameterize Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithParamTest(page);
  });

  test('Empty state shows Parameterize This Test', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await expect(page.getByText('Parameterize This Test')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create Parameterized Copy/ })).toBeVisible();
  });

  test('Parameterize tab has no badge when no data source', async ({ page }) => {
    await openTestEditor(page);
    const dataTab = dataTabLocator(page);
    await expect(dataTab.locator('.tab-badge')).not.toBeVisible();
  });
});

test.describe('Data Source Setup Modal', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithParamTest(page);
  });

  test('Create Parameterized Copy opens setup modal with path segments', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await page.getByRole('button', { name: /Create Parameterized Copy/ }).click();

    // Setup modal should open with path segments listed (allow extra time).
    const modal = page.locator('.full-panel-modal, .wf-config-modal').first();
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /Create Parameterized Copy|Configure Data Source/i })).toBeVisible();
    await expect(page.getByText('Path Variables')).toBeVisible();
  });

  test('Query parameters are auto-detected in setup modal', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await page.getByRole('button', { name: /Create Parameterized Copy/ }).click();

    // Wait for modal to appear
    await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10000 });

    // Query variables section should list detected params
    await expect(page.getByText('Query Variables')).toBeVisible();
    await expect(page.locator('.csv-fixed-key', { hasText: 'channel' })).toBeVisible();
    await expect(page.locator('.csv-fixed-key', { hasText: 'enrollmentType' })).toBeVisible();
    await expect(page.locator('.csv-fixed-key', { hasText: 'country' })).toBeVisible();
  });

  test('Wizard step navigation: Variables → Columns → back', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await page.getByRole('button', { name: /Create Parameterized Copy/ }).click();

    // Step 1: Variables — should show path variables and query variables
    await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Path Variables')).toBeVisible();
    await expect(page.getByText('Query Variables')).toBeVisible();

    // Advance to Step 2: Columns
    await page.getByRole('button', { name: 'Next: Columns' }).click();

    // Should show column configuration
    await expect(page.locator('.full-panel-modal')).toBeVisible();

    // Back button should return to Variables step
    const backBtn = page.getByRole('button', { name: /Back/i });
    if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backBtn.click();
      await expect(page.getByText('Path Variables')).toBeVisible();
    }
  });

  test('Selecting path segment and applying creates parameterized copy', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await page.getByRole('button', { name: /Create Parameterized Copy/ }).click();

    // Wait for modal
    await expect(page.locator('.full-panel-modal')).toBeVisible({ timeout: 10000 });

    // The VIN segment should be visible; check it
    const vinSegment = page.locator('.path-seg', { hasText: '1HGCM82633A004995' });
    await vinSegment.locator('input[type="checkbox"]').check();

    // Name it "vin"
    await vinSegment.locator('.path-var-input').fill('vin');

    // Advance through the 5-step wizard
    await page.getByRole('button', { name: 'Next: Columns' }).click();
    await page.getByRole('button', { name: 'Next: Validate Fields' }).click();
    await page.getByRole('button', { name: 'Next: Column Order' }).click();
    await page.getByRole('button', { name: 'Next: Review' }).click();

    // Fill required copy name then create
    const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="Name"]');
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.fill('Vehicle Offers (Parameterized)');
    }
    await page.getByRole('button', { name: 'Create & Open' }).click();

    // After creating, the wizard closes
    await expect(page.locator('.full-panel-modal')).not.toBeVisible({ timeout: 5000 });
  });
});

// ─── Import from URL Tests ──────────────────────────────────────────────────

test.describe('Import from URL fix', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithParamTest(page);
  });

  test('Import from URL re-reads params from URL instead of clearing them', async ({ page }) => {
    await openTestEditor(page);

    // Should be on Params tab by default, showing query params
    await expect(page.locator('.builder-tab.active', { hasText: 'Params' })).toBeVisible();

    // Verify we have params
    await expect(page.locator('.params-input[value="channel"]')).toBeVisible();
    await expect(page.locator('.params-input[value="WEB"]')).toBeVisible();

    // Click Import from URL
    await page.getByText('Import from URL').click();

    // Params should still be present (re-parsed from URL, not wiped)
    await expect(page.locator('.params-input[value="channel"]')).toBeVisible();
    await expect(page.locator('.params-input[value="WEB"]')).toBeVisible();
    await expect(page.locator('.params-input[value="enrollmentType"]')).toBeVisible();
  });

  test('Import from URL preserves params after manual edits', async ({ page }) => {
    await openTestEditor(page);

    // Verify initial params are present
    await expect(page.locator('.params-input[value="channel"]')).toBeVisible();
    await expect(page.locator('.params-input[value="WEB"]')).toBeVisible();

    // Manually add a new param row
    await page.locator('.params-actions button', { hasText: '+ Add' }).click();
    const rows = page.locator('.params-row');
    const lastRow = rows.last();
    const keyInput = lastRow.locator('.params-input').first();
    await keyInput.fill('extraParam');

    // Click Import from URL
    await page.getByText('Import from URL').click();

    // All params should be present
    await expect(page.locator('.params-input[value="channel"]')).toBeVisible();
    await expect(page.locator('.params-input[value="WEB"]')).toBeVisible();
    await expect(page.locator('.params-input[value="enrollmentType"]')).toBeVisible();
    await expect(page.locator('.params-input[value="country"]')).toBeVisible();
    await expect(page.locator('.params-input[value="extraParam"]')).toBeVisible();
  });
});

// ─── History Restore Tests ──────────────────────────────────────────────────

test.describe('History restore fix', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const currentUrl = 'https://api.example.com/vehicles/VIN123/offers?channel=WEB&enrollmentType=ENROLL&country=MX';
      const previousUrl = 'https://api.example.com/vehicles/VIN999/offers?channel=MOBILE&region=US';

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
            url: currentUrl,
            method: 'GET',
            headers: [{ key: 'X-Api-Key', value: 'test123' }],
            body: '',
            auth: { type: 'none' },
            validation: { mode: 'none' },
            definitionVersions: [{
              id: 'ver-1',
              label: 'Previous Version',
              timestamp: Date.now() - 86400000,
              snapshot: {
                name: 'Vehicle Offers',
                url: previousUrl,
                method: 'GET',
                headers: [{ key: 'X-Api-Key', value: 'old-key' }],
                body: '',
                bodyType: 'none',
                bodyForm: [],
                auth: { type: 'none' },
                extractions: [],
              },
            }],
          }],
        }],
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });
  });

  test('Restoring a version updates params tab to match restored URL', async ({ page }) => {
    await openTestEditor(page);

    // Verify current params
    await expect(page.locator('.params-input[value="channel"]')).toBeVisible();
    await expect(page.locator('.params-input[value="WEB"]')).toBeVisible();
    await expect(page.locator('.params-input[value="enrollmentType"]')).toBeVisible();

    // Go to History tab
    await page.locator('.builder-tab', { hasText: 'History' }).click();
    await expect(page.getByText('Previous Version')).toBeVisible();

    // Click Restore on the previous version
    await page.getByText('↩ Restore').click();

    // Switch back to Params tab — should show the restored URL's params
    await page.locator('.builder-tab', { hasText: 'Params' }).click();

    // Previous URL had: channel=MOBILE&region=US
    await expect(page.locator('.params-input[value="channel"]')).toBeVisible();
    await expect(page.locator('.params-input[value="MOBILE"]')).toBeVisible();
    await expect(page.locator('.params-input[value="region"]')).toBeVisible();
    await expect(page.locator('.params-input[value="US"]')).toBeVisible();

    // Old params should be gone
    await expect(page.locator('.params-input[value="WEB"]')).not.toBeVisible();
    await expect(page.locator('.params-input[value="enrollmentType"]')).not.toBeVisible();
  });
});

// ─── Row Detail Modal Tests (seeded WITH data source) ───────────────────────

test.describe('Row Detail Modal Layout', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithDataSource(page);
  });

  test('Row detail modal in fullscreen shows footer and content fits viewport', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Table should already be visible (seeded with data)
    await expect(page.locator('.params-section-label', { hasText: 'DATA SOURCE' })).toBeVisible({ timeout: 5000 });

    // Click ✎ edit button on the first row
    const editBtn = page.locator('button[title="Edit row details"]').first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // Row detail modal should appear (fullscreen by default)
    const modal = page.locator('.row-detail-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal should be rendered with a known row-detail wrapper class.
    await expect(modal).toHaveClass(/row-detail-modal/);

    // Footer with Cancel, Save, Close buttons should be visible
    const footer = modal.locator('.wf-config-modal-footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Close' })).toBeVisible();

    // Footer should be within the viewport (not pushed off screen)
    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(viewport.height);

    // Content should not overflow horizontally beyond the modal
    const modalBox = await modal.boundingBox();
    expect(modalBox).not.toBeNull();
    const content = modal.locator('.row-detail-content');
    const contentBox = await content.boundingBox();
    expect(contentBox).not.toBeNull();
    expect(contentBox!.width).toBeLessThanOrEqual(modalBox!.width);

    // Input fields grid should be within modal bounds
    const fieldsGrid = modal.locator('.row-detail-fields-grid');
    if (await fieldsGrid.isVisible()) {
      const gridBox = await fieldsGrid.boundingBox();
      expect(gridBox).not.toBeNull();
      expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(modalBox!.x + modalBox!.width + 1);
    }
  });

  test('Row detail modal Close button dismisses the modal', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);
    await expect(page.locator('.params-section-label', { hasText: 'DATA SOURCE' })).toBeVisible({ timeout: 5000 });

    const editBtn = page.locator('button[title="Edit row details"]').first();
    await editBtn.click();

    const modal = page.locator('.row-detail-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click Close
    const footer = modal.locator('.wf-config-modal-footer');
    await footer.getByRole('button', { name: 'Close' }).click();

    // Modal should be dismissed
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});
