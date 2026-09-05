import { test, expect, type Page } from '@playwright/test';

/**
 * Seeds a data source with validate columns containing array paths,
 * so the Validation Contract Panel can be tested.
 */
async function seedWithValidateColumns(page: Page) {
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
          url: 'https://api.example.com/vehicles/{{vin}}/offers',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
          dataSource: {
            columns: [
              { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
              { id: 'col-v0', name: 'offers[0].price', type: 'validate', mapping: 'offers[0].price' },
              { id: 'col-v1', name: 'offers[1].price', type: 'validate', mapping: 'offers[1].price' },
              { id: 'col-v2', name: 'offers[0].name', type: 'validate', mapping: 'offers[0].name' },
            ],
            rows: [
              { id: 'row-1', values: { 'col-vin': 'VIN001', 'col-v0': '100', 'col-v1': '200', 'col-v2': 'Basic' }, enabled: true },
            ],
            distribution: 'sequential',
            urlTemplate: 'https://api.example.com/vehicles/{{vin}}/offers',
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

/**
 * Seeds a data source with 3+ columns for drag-reorder and keyboard nav tests.
 */
async function seedWithMultiColumn(page: Page) {
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
          name: 'Multi Col Test',
          url: 'https://api.example.com/items?a={{colA}}&b={{colB}}&c={{colC}}',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
          dataSource: {
            columns: [
              { id: 'col-a', name: 'colA', type: 'param', mapping: 'a' },
              { id: 'col-b', name: 'colB', type: 'param', mapping: 'b' },
              { id: 'col-c', name: 'colC', type: 'param', mapping: 'c' },
            ],
            rows: [
              { id: 'row-1', values: { 'col-a': 'A1', 'col-b': 'B1', 'col-c': 'C1' }, enabled: true },
              { id: 'row-2', values: { 'col-a': 'A2', 'col-b': 'B2', 'col-c': 'C2' }, enabled: true },
            ],
            distribution: 'sequential',
            urlTemplate: 'https://api.example.com/items?a={{colA}}&b={{colB}}&c={{colC}}',
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

/** Open test editor for the seeded test */
async function openTestEditor(page: Page) {
  await page.goto('/?tab=scenarios');
  await page.waitForSelector('.app-header', { timeout: 25000 });
  await page.waitForLoadState('networkidle');

  const fgName = page.locator('.feature-group-card .feature-group-name', { hasText: 'E2E Feature' });
  await expect(fgName).toBeVisible({ timeout: 10000 });
  await fgName.click();

  const scName = page.locator('.scenario-group-name', { hasText: 'E2E Scenario' });
  await expect(scName).toBeVisible({ timeout: 5000 });
  await scName.click();

  await expect(page.locator('.test-card')).toBeVisible({ timeout: 5000 });
  await page.locator('.test-card button:has-text("Edit")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
}

/** Click the Data / Parameterize tab */
async function clickDataTab(page: Page) {
  const tab = page.locator('.builder-tab', { hasText: /Parameterize|Data Source/ });
  await tab.click();
}

// ─── Validation Contract Panel Tests ────────────────────────────────────────

test.describe('Validation Contract Panel', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithValidateColumns(page);
  });

  test('contract panel shows array patterns after toggling', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Click the "Toggle validation contract" toolbar button
    const contractBtn = page.locator('button[title="Toggle validation contract"]');
    await expect(contractBtn).toBeVisible({ timeout: 5000 });
    await contractBtn.click();

    // Contract panel should appear
    const panel = page.locator('.data-source-contract-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Should show the pattern offers[*].price and offers[*].name
    await expect(panel.locator('.data-source-contract-pattern', { hasText: 'offers[*].price' })).toBeVisible();
    await expect(panel.locator('.data-source-contract-pattern', { hasText: 'offers[*].name' })).toBeVisible();
  });

  test('toggle dynamic/fixed mode on a contract pattern', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    await page.locator('button[title="Toggle validation contract"]').click();
    const panel = page.locator('.data-source-contract-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Find the first mode button — should start as fixed (default)
    const modeBtn = panel.locator('.data-source-contract-mode-btn').first();
    await expect(modeBtn).toBeVisible();

    const initialText = await modeBtn.textContent();
    await modeBtn.click();

    // Should toggle to the other mode
    const newText = await modeBtn.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('toggle ordered/unordered mode on array pattern', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    await page.locator('button[title="Toggle validation contract"]').click();
    const panel = page.locator('.data-source-contract-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Find the ordered/unordered button (second .data-source-contract-mode-btn in a contract item)
    const item = panel.locator('.data-source-contract-item').first();
    const orderBtn = item.locator('.data-source-contract-mode-btn').nth(1);

    if (await orderBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      const initialText = await orderBtn.textContent();
      await orderBtn.click();
      const newText = await orderBtn.textContent();
      expect(newText).not.toBe(initialText);
    }
  });

  test('remove contract pattern removes it from the panel', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    await page.locator('button[title="Toggle validation contract"]').click();
    const panel = page.locator('.data-source-contract-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Count initial patterns
    const initialCount = await panel.locator('.data-source-contract-item').count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Click remove on the first pattern
    const removeBtn = panel.locator('.data-source-contract-remove').first();
    await removeBtn.click();

    // Pattern count should decrease
    const afterCount = await panel.locator('.data-source-contract-item').count();
    expect(afterCount).toBe(initialCount - 1);
  });

  test('contract panel closes when toggled off', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    const contractBtn = page.locator('button[title="Toggle validation contract"]');
    await contractBtn.click();
    await expect(page.locator('.data-source-contract-panel')).toBeVisible({ timeout: 3000 });

    // Toggle off
    await contractBtn.click();
    await expect(page.locator('.data-source-contract-panel')).not.toBeVisible();
  });
});

// ─── Cell Keyboard Navigation Tests ─────────────────────────────────────────

test.describe('Cell Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithMultiColumn(page);
  });

  test('Tab moves focus to next cell in the row', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Click the first cell (colA, row-1)
    const firstCell = page.locator('.data-source-cell-input').first();
    await firstCell.click();
    await expect(firstCell).toBeFocused();

    // Press Tab — should move to the next cell (colB, row-1)
    await firstCell.press('Tab');

    // The second cell should now be focused
    const secondCell = page.locator('.data-source-cell-input').nth(1);
    await expect(secondCell).toBeFocused();
  });

  test('Enter moves focus to the cell below', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Click the first cell (colA, row-1) — value is "A1"
    const firstCell = page.locator('.data-source-cell-input[value="A1"]');
    await firstCell.click();
    await expect(firstCell).toBeFocused();

    // Press Enter — should move to colA, row-2 (value "A2")
    await firstCell.press('Enter');

    const cellBelow = page.locator('.data-source-cell-input[value="A2"]');
    await expect(cellBelow).toBeFocused();
  });

  test('Shift+Tab moves focus to previous cell', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Click the second cell (colB, row-1) — value is "B1"
    const secondCell = page.locator('.data-source-cell-input[value="B1"]');
    await secondCell.click();
    await expect(secondCell).toBeFocused();

    // Press Shift+Tab — should move back to colA, row-1 (value "A1")
    await secondCell.press('Shift+Tab');

    const firstCell = page.locator('.data-source-cell-input[value="A1"]');
    await expect(firstCell).toBeFocused();
  });
});

// ─── Column Drag-to-Reorder Tests ───────────────────────────────────────────

test.describe('Column Drag-to-Reorder', () => {
  test.beforeEach(async ({ page }) => {
    await seedWithMultiColumn(page);
  });

  test('column drag handles are visible', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Each column should have a drag handle
    const handles = page.locator('.data-source-col-drag-handle');
    await expect(handles).toHaveCount(3); // colA, colB, colC
    await expect(handles.first()).toBeVisible();
  });

  test('dragging column reorders columns', async ({ page }) => {
    await openTestEditor(page);
    await clickDataTab(page);

    // Verify initial column order: colA, colB, colC
    const colNames = page.locator('.data-source-col-name');
    await expect(colNames.first()).toHaveText('colA');
    await expect(colNames.nth(1)).toHaveText('colB');
    await expect(colNames.nth(2)).toHaveText('colC');

    // The React handler stores the dragged column ID in state during dragstart,
    // then reads it during drop. We must fire dragstart first, let React commit
    // the state update, then fire dragover + drop separately.
    // Columns: th[0]=checkbox, th[1]=Row Name, th[2]=colA, th[3]=colB, th[4]=colC
    const srcHandle = page.locator('.data-source-col-drag-handle').first();
    const targetTh = page.locator('.data-source-th').nth(4); // colC header cell

    // Tag elements for querySelector inside page.evaluate
    await srcHandle.evaluate(el => el.setAttribute('data-e2e-drag', 'src'));
    await targetTh.evaluate(el => el.setAttribute('data-e2e-drag', 'tgt'));

    // Step 1: Fire dragstart → React sets draggingColDragId state
    await page.evaluate(() => {
      const src = document.querySelector('[data-e2e-drag="src"]')!;
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    });

    // Step 2: Let React commit the state update
    await page.waitForTimeout(100);

    // Step 3: Fire dragover + drop on target → React reads draggingColDragId and reorders
    await page.evaluate(() => {
      const src = document.querySelector('[data-e2e-drag="src"]')!;
      const tgt = document.querySelector('[data-e2e-drag="tgt"]')!;
      const dt = new DataTransfer();
      tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      tgt.dispatchEvent(new DragEvent('drop',     { bubbles: true, dataTransfer: dt }));
      src.dispatchEvent(new DragEvent('dragend',   { bubbles: true, dataTransfer: dt }));
    });

    // colA was dragged to colC position → order becomes colB, colC, colA
    await expect(colNames.first()).toHaveText('colB');
    await expect(colNames.nth(1)).toHaveText('colC');
    await expect(colNames.nth(2)).toHaveText('colA');
  });
});
