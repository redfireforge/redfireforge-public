import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedAppData } from './helpers';

const sampleResponse = {
  userId: 1,
  id: 42,
  title: 'sunt aut facere repellat provident',
};

/**
 * Seed with a test that already has selective validation expectedFields
 * but sampleJson is empty (simulates the user's actual state where mappings
 * exist from a previous session but sample data was not persisted).
 */
async function seedWithExistingValidationRules(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'http://localhost:5173' },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
      id: 'fg-1',
      name: 'Validation FG',
      microserviceId: 'svc-1',
      environmentId: 'env-1',
      scenarios: [{
        id: 'sc-1',
        name: 'Validation Scenario',
        tests: [{
          id: 'test-1',
          name: 'GET with Fields',
          url: 'https://api.example.com/posts/1',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: {
            mode: 'selective',
            expectedFields: [
              { jsonPath: 'userId', expectedValue: '1', operator: 'equals' },
              { jsonPath: 'id', expectedValue: '0', operator: 'greater_than' },
              { jsonPath: 'title', expectedValue: 'sunt', operator: 'contains' },
            ],
            sampleJson: '',
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

async function openTestEditor(page: Page): Promise<void> {
  await page.goto('/?tab=scenarios');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-header')).toBeVisible({ timeout: 25000 });

  // Expand feature group
  const fgCard = page.locator('.feature-group-card', { hasText: 'Validation FG' });
  await fgCard.locator('.feature-group-name').click();

  // Expand scenario
  const scName = page.locator('.scenario-group-name', { hasText: 'Validation Scenario' });
  await expect(scName).toBeVisible({ timeout: 5000 });
  await scName.click();

  // Click Edit on the test
  await expect(page.locator('.test-card')).toBeVisible({ timeout: 5000 });
  const editBtn = page.locator('.test-card button:has-text("Edit")').first();
  await expect(editBtn).toBeVisible({ timeout: 10000 });
  await editBtn.click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
  await page.locator('.builder-tab:has-text("Validation")').click();
}

async function openDataMapper(page: Page): Promise<Locator> {
  await page.locator('button:has-text("⚡ Data Mapper")').click();
  const mapper = page.locator('.dm-modal-overlay');
  await expect(mapper).toBeVisible();
  return mapper;
}

test.describe('Validation Data Mapper — source panel sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/__proxy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sampleResponse),
        }),
      });
    });
  });

  test('source panel is populated when sampleJson is empty but target has existing rules', async ({ page }) => {
    await seedWithExistingValidationRules(page);
    await openTestEditor(page);
    const mapper = await openDataMapper(page);

    // The target panel should show mapped fields (from deserialized expectedFields)
    const targetPanel = mapper.locator('.dm-panel--target');
    await expect(targetPanel.locator('.dm-tree-node')).not.toHaveCount(0, { timeout: 5000 });

    // Source panel should NOT show "No sample data yet" (auto-synced from target)
    const sourcePanel = mapper.locator('.dm-panel--source');
    const emptyState = sourcePanel.locator('.dm-empty-state');
    await expect(emptyState).toHaveCount(0);

    // Source tree should have nodes
    await expect(sourcePanel.locator('.dm-tree-node')).not.toHaveCount(0);

    // Target value overlay should not show "undefined"
    const errorValues = targetPanel.locator('.dm-trace-value--error');
    await expect(errorValues).toHaveCount(0);
  });

  test('Fetch & Verify populates source panel and resolves target values', async ({ page }) => {
    await seedWithExistingValidationRules(page);
    await openTestEditor(page);
    const mapper = await openDataMapper(page);

    // Click "Fetch & Verify" in the toolbar
    const fetchVerifyBtn = mapper.locator('button:has-text("Fetch & Verify")');
    await fetchVerifyBtn.click();

    // After fetch: source panel should show JSON tree nodes (not empty)
    const sourcePanel = mapper.locator('.dm-panel--source');
    await expect(sourcePanel.locator('.dm-tree-node')).not.toHaveCount(0, { timeout: 10000 });

    // Source should have userId, id, title nodes
    await expect(sourcePanel.locator('.dm-tree-node[data-path="userId"]')).toBeVisible();
    await expect(sourcePanel.locator('.dm-tree-node[data-path="id"]')).toBeVisible();
    await expect(sourcePanel.locator('.dm-tree-node[data-path="title"]')).toBeVisible();

    // Target value overlay should NOT show "undefined" anymore
    const targetPanel = mapper.locator('.dm-panel--target');
    const traceValues = targetPanel.locator('.dm-trace-value');
    const traceCount = await traceValues.count();
    for (let i = 0; i < traceCount; i++) {
      const text = await traceValues.nth(i).textContent();
      expect(text).not.toContain('undefined');
    }
  });

  test('Verify All populates source panel when target has sample data', async ({ page }) => {
    await seedAppData(page);
    await page.goto('/?tab=scenarios');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 25000 });

    // Create a new test and set up validation via Fetch Response (which stores sampleJson)
    await page.click('button:has-text("+ Add Feature Group")');
    await page.locator('input[placeholder="Feature group name (e.g. Onboarding)"]').fill('VerifyAll-FG');
    await page.locator('.inline-name-form button:has-text("Create")').click();
    await page.click('button:has-text("+ Scenario")');
    await page.locator('input[placeholder="Scenario name (e.g. Happy Path)"]').fill('VerifyAll-Sc');
    await page.locator('.feature-group-card button:has-text("Create")').click();
    await page.click('button:has-text("+ Test")');
    await expect(page.locator('.modal-overlay')).toBeVisible();

    await page.locator('.url-input').fill('https://api.example.com/posts/1');
    await page.locator('.builder-tab:has-text("Validation")').click();
    await page.locator('label:has-text("Selective Fields") input[type="radio"]').check();
    await page.locator('button:has-text("Fetch Response")').click();
    await expect(page.locator('.validation-response-preview')).toBeVisible();

    // Open Data Mapper — source should already have data since we just fetched
    await page.locator('button:has-text("⚡ Data Mapper")').click();
    const mapper = page.locator('.dm-modal-overlay');
    await expect(mapper).toBeVisible();

    // Auto-map to create some mappings
    await mapper.locator('.dm-toolbar-cluster--core button', { hasText: 'Auto-map' }).click();

    // Source panel should have data (from the fetch)
    const sourcePanel = mapper.locator('.dm-panel--source');
    await expect(sourcePanel.locator('.dm-tree-node')).not.toHaveCount(0, { timeout: 5000 });

    // Click Verify All
    const verifyAllBtn = mapper.locator('button:has-text("Verify All")');
    await verifyAllBtn.click();

    // Source panel should still have data (not wiped)
    await expect(sourcePanel.locator('.dm-tree-node')).not.toHaveCount(0);

    // Verify results should appear (pass count in toolbar)
    await expect(mapper.locator('.dm-toolbar-verify-summary')).toBeVisible({ timeout: 5000 });
  });

  test('fresh Fetch Response then Data Mapper opens with source populated', async ({ page }) => {
    await seedAppData(page);
    await page.goto('/?tab=scenarios');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 25000 });

    await page.click('button:has-text("+ Add Feature Group")');
    await page.locator('input[placeholder="Feature group name (e.g. Onboarding)"]').fill('Fresh-FG');
    await page.locator('.inline-name-form button:has-text("Create")').click();
    await page.click('button:has-text("+ Scenario")');
    await page.locator('input[placeholder="Scenario name (e.g. Happy Path)"]').fill('Fresh-Sc');
    await page.locator('.feature-group-card button:has-text("Create")').click();
    await page.click('button:has-text("+ Test")');
    await expect(page.locator('.modal-overlay')).toBeVisible();

    await page.locator('.url-input').fill('https://api.example.com/posts/1');
    await page.locator('.builder-tab:has-text("Validation")').click();
    await page.locator('label:has-text("Selective Fields") input[type="radio"]').check();
    await page.locator('button:has-text("Fetch Response")').click();
    await expect(page.locator('.validation-response-preview')).toBeVisible();

    await page.locator('button:has-text("⚡ Data Mapper")').click();
    const mapper = page.locator('.dm-modal-overlay');
    await expect(mapper).toBeVisible();

    // Source panel should be populated from the fetched sampleJson
    const sourcePanel = mapper.locator('.dm-panel--source');
    await expect(sourcePanel.locator('.dm-tree-node[data-path="userId"]')).toBeVisible({ timeout: 5000 });
    await expect(sourcePanel.locator('.dm-tree-node[data-path="id"]')).toBeVisible();
    await expect(sourcePanel.locator('.dm-tree-node[data-path="title"]')).toBeVisible();

    // No "undefined" trace values on target nodes
    const targetPanel = mapper.locator('.dm-panel--target');
    const undefinedValues = targetPanel.locator('.dm-trace-value--error');
    await expect(undefinedValues).toHaveCount(0);
  });
});
