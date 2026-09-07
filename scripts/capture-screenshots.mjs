#!/usr/bin/env node
/**
 * Capture step-by-step screenshots showing a complete RedfireForge workflow:
 * Settings → Add Env/Svc → Create Feature Group → Add Scenario → Add Test →
 * Run Test → View Results
 *
 * Uses the existing data in the running web app at localhost:5173.
 * Requires: npm install --save-dev playwright && npx playwright install chromium
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(__dirname, '..', 'training-ppt', 'manual', 'images');
mkdirSync(IMG_DIR, { recursive: true });

const BASE = 'http://localhost:5173';
let stepNum = 0;

async function shot(page, name) {
  stepNum++;
  const padded = String(stepNum).padStart(2, '0');
  const filename = `${padded}-${name}.png`;
  await page.screenshot({ path: join(IMG_DIR, filename) });
  console.log(`  ✅ ${filename}`);
  return filename;
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('🚀 Launching browser...\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  });

  try {
    // ═══════════════════════════════════════════
    // SECTION 1: APP OVERVIEW
    // ═══════════════════════════════════════════
    console.log('📸 1. App Overview');
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await wait(1500);
    await shot(page, 'app-launch');

    // ═══════════════════════════════════════════
    // SECTION 2: SETTINGS — Add Environment & Microservice
    // ═══════════════════════════════════════════
    console.log('📸 2. Settings — Environment & Microservice');

    await page.click('button:has-text("⚙ Settings")');
    await wait(800);
    await shot(page, 'settings-open');

    // Add an environment
    const envInput = page.locator('input[placeholder*="dev, test"]');
    await envInput.fill('demo-env');
    await shot(page, 'settings-env-type');

    // Click the Add button next to the env input (inside the same settings-add-row)
    await envInput.locator('..').locator('button:has-text("Add")').click({ timeout: 5000 });
    await wait(500);
    await shot(page, 'settings-env-added');

    // Add a microservice
    const svcInput = page.locator('input[placeholder*="order-api"]');
    await svcInput.fill('demo-api-service');
    await shot(page, 'settings-svc-type');

    await svcInput.locator('..').locator('button:has-text("Add")').click({ timeout: 5000 });
    await wait(500);
    await shot(page, 'settings-svc-added');

    // Show Global Auth section
    await page.evaluate(() => {
      const modal = document.querySelector('.settings-modal');
      if (modal) modal.scrollTop += 300;
    });
    await wait(300);
    await shot(page, 'settings-global-auth');

    // Scroll to storage / export-import
    await page.evaluate(() => {
      const modal = document.querySelector('.settings-modal');
      if (modal) modal.scrollTop += 400;
    });
    await wait(300);
    await shot(page, 'settings-storage-export');

    // Close settings
    await page.click('button:has-text("Close")');
    await wait(500);

    // ═══════════════════════════════════════════
    // SECTION 3: SIDEBAR — Select Environment & Microservice
    // ═══════════════════════════════════════════
    console.log('📸 3. Sidebar Navigation');

    // Click the environment in sidebar
    const sidebarEnvItems = page.locator('.sidebar-item-name');
    const envCount = await sidebarEnvItems.count();

    // Find and click "demo-env" or the first available env
    let clickedEnv = false;
    for (let i = 0; i < envCount; i++) {
      const text = await sidebarEnvItems.nth(i).textContent();
      if (text?.includes('demo-env') || text?.includes('test') || text?.includes('dev')) {
        await sidebarEnvItems.nth(i).click();
        await wait(500);
        clickedEnv = true;
        break;
      }
    }
    if (!clickedEnv && envCount > 0) {
      await sidebarEnvItems.first().click();
      await wait(500);
    }
    await shot(page, 'sidebar-env-click');

    // Now click a microservice in the expanded tree
    const svcItems = page.locator('.sidebar-children .sidebar-item-name');
    const svcCount = await svcItems.count();
    if (svcCount > 0) {
      await svcItems.first().click();
      await wait(500);
    }
    await shot(page, 'sidebar-svc-selected');

    // Switch to Microservices tab in sidebar
    await page.click('button:has-text("Microservices")');
    await wait(500);
    await shot(page, 'sidebar-microservices-tab');

    // Switch back to Environments
    await page.click('button:has-text("Environments")');
    await wait(500);

    // ═══════════════════════════════════════════
    // SECTION 4: FEATURE GROUPS — Create Feature Group
    // ═══════════════════════════════════════════
    console.log('📸 4. Create Feature Group');

    // Make sure we have env+svc selected - use the header selects if sidebar didn't work
    const headerSelects = page.locator('.header-select-group select');
    const selectCount = await headerSelects.count();
    if (selectCount >= 2) {
      // Select environment from dropdown
      const envSelect = headerSelects.nth(0);
      const envOptions = await envSelect.locator('option').allTextContents();
      if (envOptions.length > 1) {
        await envSelect.selectOption({ index: 1 });
        await wait(300);
      }
      // Select microservice from dropdown
      const svcSelect = headerSelects.nth(1);
      const svcOptions = await svcSelect.locator('option').allTextContents();
      if (svcOptions.length > 1) {
        await svcSelect.selectOption({ index: 1 });
        await wait(300);
      }
    }
    await shot(page, 'feature-groups-env-svc-selected');

    // Check if "+ Add Feature Group" is enabled
    const addFgBtn = page.locator('button:has-text("+ Add Feature Group")');
    if (await addFgBtn.isVisible() && !(await addFgBtn.isDisabled())) {
      await addFgBtn.click();
      await wait(500);
      await shot(page, 'feature-group-naming');

      // Type a name
      const nameInput = page.locator('.inline-name-form input');
      await nameInput.fill('Demo API Tests');
      await shot(page, 'feature-group-name-typed');

      // Click Create
      await page.click('.inline-name-form button:has-text("Create")');
      await wait(800);
      await shot(page, 'feature-group-created');
    }

    // ═══════════════════════════════════════════
    // SECTION 5: ADD SCENARIO
    // ═══════════════════════════════════════════
    console.log('📸 5. Add Scenario');

    // Click "+ Scenario" button on the newly created (or existing) feature group
    const addScBtn = page.locator('button:has-text("+ Scenario")').first();
    if (await addScBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addScBtn.click();
      await wait(500);
      await shot(page, 'scenario-naming');

      const scInput = page.locator('.inline-name-form.nested input, .inline-name-form input').first();
      if (await scInput.isVisible()) {
        await scInput.fill('Health Check Flow');
        await shot(page, 'scenario-name-typed');

        await page.click('.inline-name-form button:has-text("Create")');
        await wait(800);
        await shot(page, 'scenario-created');
      }
    }

    // ═══════════════════════════════════════════
    // SECTION 6: ADD TEST
    // ═══════════════════════════════════════════
    console.log('📸 6. Add Test');

    const addTestBtn = page.locator('button:has-text("+ Test")').first();
    if (await addTestBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addTestBtn.click();
      await wait(800);
      await shot(page, 'test-editor-open');

      // Fill in test name
      const nameField = page.locator('input[placeholder*="Get User Profile"]');
      if (await nameField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nameField.fill('GET Health Check');
        await wait(300);
      }

      // Fill URL using .url-input
      const urlField = page.locator('.url-input');
      if (await urlField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await urlField.fill('https://httpbin.org/get');
        await wait(300);
      }
      await shot(page, 'test-name-url-filled');

      // Scroll down in the test editor to see more fields
      await page.evaluate(() => {
        const editor = document.querySelector('.test-editor-pane, .editor-panel, .rf-builder-panel');
        if (editor) editor.scrollTop += 300;
        else window.scrollBy(0, 300);
      });
      await wait(300);
      await shot(page, 'test-editor-more-fields');

      // Save the test
      const saveBtn = page.locator('.rf-builder-top-actions button:has-text("Save")');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const disabled = await saveBtn.isDisabled();
        if (!disabled) {
          await saveBtn.click();
          await wait(800);
          await shot(page, 'test-saved');
        } else {
          await shot(page, 'test-save-ready');
        }
      }
    }

    // ═══════════════════════════════════════════
    // SECTION 7: SHOW EXISTING FEATURE GROUPS (with data)
    // ═══════════════════════════════════════════
    console.log('📸 7. Existing Feature Groups with Data');

    // Use the header selects to pick an env/svc that has existing data
    if (selectCount >= 2) {
      const envSelect = headerSelects.nth(0);
      const envOptions = await envSelect.locator('option').allTextContents();
      // Try different envs to find one with data
      for (let i = 1; i < envOptions.length; i++) {
        await envSelect.selectOption({ index: i });
        await wait(300);
        const svcSelect = headerSelects.nth(1);
        await wait(200);
        const svcOpts = await svcSelect.locator('option').allTextContents();
        if (svcOpts.length > 1) {
          await svcSelect.selectOption({ index: 1 });
          await wait(500);
          const fgNodes = page.locator('.feature-group-header');
          if (await fgNodes.count() > 0) break;
        }
      }
    }
    await shot(page, 'existing-feature-groups');

    // Expand all
    const expandBtn = page.locator('button:has-text("Expand All")');
    if (await expandBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expandBtn.click();
      await wait(800);
    }
    await shot(page, 'feature-groups-all-expanded');

    // Click on a test to show the editor
    const existingTest = page.locator('.test-entry, .test-item').first();
    if (await existingTest.isVisible({ timeout: 1000 }).catch(() => false)) {
      await existingTest.click();
      await wait(800);
      await shot(page, 'existing-test-details');

      // Scroll to see validation/auth
      await page.evaluate(() => {
        const editor = document.querySelector('.test-editor-pane, .editor-panel, .rf-builder-panel, .rf-builder-layout');
        if (editor) editor.scrollTop += 400;
        else window.scrollBy(0, 400);
      });
      await wait(300);
      await shot(page, 'existing-test-scroll');

      // Close test editor if there's an X
      const closeTest = page.locator('.editor-close, button:has-text("✕")').first();
      if (await closeTest.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeTest.click();
        await wait(300);
      }
    }

    // ═══════════════════════════════════════════
    // SECTION 8: TEST RUNNER
    // ═══════════════════════════════════════════
    console.log('📸 8. Test Runner');

    await page.click('.tab:has-text("Test Runner")');
    await wait(1000);
    await shot(page, 'test-runner-tab');

    // Show the config area
    const runnerSelects = page.locator('.test-runner select, .runner-config select');
    const runnerSelectCount = await runnerSelects.count();
    if (runnerSelectCount > 0) {
      // Select first available feature group
      const fgSelect = runnerSelects.first();
      const fgOpts = await fgSelect.locator('option').allTextContents();
      if (fgOpts.length > 1) {
        await fgSelect.selectOption({ index: 1 });
        await wait(500);
      }
    }
    await shot(page, 'test-runner-configured');

    // Scroll to see the Run button and mode selection
    await page.evaluate(() => window.scrollBy(0, 200));
    await wait(300);
    await shot(page, 'test-runner-run-button');

    // Try to run a test (only if it won't cause issues)
    const runBtn = page.locator('button:has-text("Run Test")');
    if (await runBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (!(await runBtn.isDisabled())) {
        await runBtn.click();
        await wait(2000);
        await shot(page, 'test-running-progress');

        // Wait for completion
        await wait(5000);
        await shot(page, 'test-run-complete');
      }
    }

    // ═══════════════════════════════════════════
    // SECTION 9: RESULTS DASHBOARD
    // ═══════════════════════════════════════════
    console.log('📸 9. Results Dashboard');

    await page.click('.tab:has-text("Results")');
    await wait(1000);
    await shot(page, 'results-dashboard');

    // Click on a result to see details
    const resultRows = page.locator('.run-card, .result-row, .result-item, tr');
    const resultCount = await resultRows.count();
    if (resultCount > 1) {
      await resultRows.nth(1).click();
      await wait(800);
      await shot(page, 'results-detail-view');
    }

    // Scroll to see charts/metrics
    await page.evaluate(() => window.scrollBy(0, 400));
    await wait(300);
    await shot(page, 'results-metrics-scroll');

    // ═══════════════════════════════════════════
    // SECTION 10: EXPORT CENTER
    // ═══════════════════════════════════════════
    console.log('📸 10. Export & Import');

    // Go back to Feature Groups and open Settings
    await page.click('.tab:has-text("Feature Groups")');
    await wait(500);
    await page.click('button:has-text("⚙ Settings")');
    await wait(800);

    // Scroll to Export/Import buttons
    await page.evaluate(() => {
      const modal = document.querySelector('.settings-modal');
      if (modal) modal.scrollTop = modal.scrollHeight;
    });
    await wait(300);

    // Try Export Data button
    const exportDataBtn = page.locator('button:has-text("Export Data")');
    if (await exportDataBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (!(await exportDataBtn.isDisabled())) {
        await exportDataBtn.click();
        await wait(800);
        await shot(page, 'export-center');

        // Close it
        const closeExport = page.locator('button:has-text("Close")').first();
        if (await closeExport.isVisible({ timeout: 500 }).catch(() => false)) {
          await closeExport.click();
          await wait(500);
        }
      }
    }

    // Try Import Data button
    const importDataBtn = page.locator('button:has-text("Import Data")');
    if (await importDataBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await importDataBtn.click();
      await wait(800);
      await shot(page, 'import-center');

      const closeImport = page.locator('button:has-text("Close")').first();
      if (await closeImport.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeImport.click();
        await wait(500);
      }
    }

    console.log(`\n✅ Done! ${stepNum} screenshots saved to training-ppt/manual/images/`);

  } catch (err) {
    console.error(`\n❌ Error at step ${stepNum + 1}:`, err.message);
    await shot(page, 'error-state').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
