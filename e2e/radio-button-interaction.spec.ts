/**
 * E2E: Radio button interaction test
 * Verifies that clicking radio buttons in the Workflow Runner correctly
 * updates the selection (blue dot moves to the clicked option).
 * This tests the fix for the name collision bug where TestRunner's always-mounted
 * DOM would interfere with WorkflowRunner's radio group.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Workflow } from '../src/features/workflow/types/workflow';

function makeSimpleWorkflow(): Workflow {
  return {
    id: 'wf-interaction-test',
    name: 'Interaction Test Workflow',
    schemaVersion: 4,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      { id: 'start-1', type: 'start', position: { x: 300, y: 0 }, data: { label: 'Start', inputVariables: {} } },
      { id: 'http-1', type: 'http', position: { x: 280, y: 120 }, data: { label: 'Get', method: 'GET', url: 'https://httpbin.org/get', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } },
      { id: 'end-1', type: 'end', position: { x: 300, y: 260 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'start-1', target: 'http-1', type: 'default' },
      { id: 'e2', source: 'http-1', target: 'end-1', type: 'default' },
    ],
  };
}

async function seedAndOpenWorkflowRunner(page: Page): Promise<void> {
  const workflow = makeSimpleWorkflow();
  await page.addInitScript((wf) => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{ id: 'svc-1', name: 'test-service', baseUrls: { 'env-1': 'http://localhost:5173' } }]));
    localStorage.setItem('perf-test-v3-feature-groups', '[]');
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
    localStorage.setItem('workflows', JSON.stringify([wf]));
  }, workflow);

  await page.goto('/?tab=workflow-runner');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('workflow-select').click();
  await page.locator('.wfp-dropdown-item:has-text("Interaction Test Workflow")').click();
  await page.waitForTimeout(300);
  await page.locator('.workflow-runner-config-section').waitFor({ timeout: 5000 });
}

test.describe('Radio button click interaction', () => {
  test('Workflow Runner: clicking Execution Mode changes selection', async ({ page }) => {
    await seedAndOpenWorkflowRunner(page);

    const modes = ['Sequential', 'Batch', 'Continuous Pool', 'Load Profile'];

    for (const mode of modes) {
      // Click the label (the entire row including text is clickable)
      const label = page.locator('.workflow-runner-config-section .runner-option-box .radio-label').filter({ hasText: new RegExp(`^${mode}$`) });
      await label.click();
      
      const radio = label.locator('input[type="radio"]');
      await expect(radio, `"${mode}" should be checked after clicking`).toBeChecked({ timeout: 2000 });

      // Confirm all OTHER modes are unchecked
      for (const otherMode of modes) {
        if (otherMode !== mode) {
          const otherLabel = page.locator('.workflow-runner-config-section .runner-option-box .radio-label').filter({ hasText: new RegExp(`^${otherMode}$`) });
          const otherRadio = otherLabel.locator('input[type="radio"]');
          await expect(otherRadio, `"${otherMode}" should NOT be checked when "${mode}" is selected`).not.toBeChecked({ timeout: 1000 });
        }
      }
    }

    await page.screenshot({ path: 'playwright-report/radio-interaction-exec-mode.png', fullPage: false });
  });

  test('Workflow Runner: clicking On Error changes selection', async ({ page }) => {
    await seedAndOpenWorkflowRunner(page);

    const configSection = page.locator('.workflow-runner-config-section');
    const errorPolicies = [
      { label: 'Continue', value: 'continue' },
      { label: 'Stop 1st', value: 'stop-first' },
      { label: 'Threshold', value: 'stop-threshold' },
    ];

    for (const policy of errorPolicies) {
      const label = configSection.locator('.error-policy-options .radio-label').filter({ hasText: new RegExp(`^${policy.label}$`) }).first();
      await label.click();
      const radio = label.locator('input[type="radio"]');
      await expect(radio, `"${policy.label}" should be checked after clicking`).toBeChecked({ timeout: 2000 });
    }
  });

  test('Workflow Runner: clicking Think Time changes selection', async ({ page }) => {
    await seedAndOpenWorkflowRunner(page);

    const configSection = page.locator('.workflow-runner-config-section');
    const thinkModes = ['None', 'Constant', 'Uniform', 'Gaussian'];

    for (const mode of thinkModes) {
      // Think time radios are in the think-time-section's error-policy-options
      const label = configSection.locator('.think-time-section .radio-label').filter({ hasText: new RegExp(`^${mode}$`) });
      await label.click();
      const radio = label.locator('input[type="radio"]');
      await expect(radio, `"${mode}" should be checked after clicking`).toBeChecked({ timeout: 2000 });
    }

    await page.screenshot({ path: 'playwright-report/radio-interaction-think-time.png', fullPage: false });
  });

  test('Test Runner radio buttons work independently of Workflow Runner', async ({ page }) => {
    // Seed with workflow so both TestRunner and WorkflowRunner are loaded
    const workflow = makeSimpleWorkflow();
    await page.addInitScript((wf) => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{ id: 'svc-1', name: 'test-service', baseUrls: { 'env-1': 'http://localhost:5173' } }]));
      localStorage.setItem('perf-test-v3-feature-groups', '[]');
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
      localStorage.setItem('workflows', JSON.stringify([wf]));
    }, workflow);

    // Start on Runner tab — TestRunner is always mounted with hidden attribute
    await page.goto('/?tab=runner');
    await page.waitForLoadState('networkidle');

    // Click "Sequential" in the Test Runner
    const testRunnerSeq = page.locator('.runner-option-box .radio-label').filter({ hasText: /^Sequential$/ }).first();
    await testRunnerSeq.click();
    const seqRadio = testRunnerSeq.locator('input[name="test-runner-execMode"]');
    await expect(seqRadio).toBeChecked({ timeout: 2000 });

    // Click "Load Profile" in the Test Runner
    const testRunnerLP = page.locator('.runner-option-box .radio-label').filter({ hasText: /^Load Profile$/ }).first();
    await testRunnerLP.click();
    const lpRadio = testRunnerLP.locator('input[name="test-runner-execMode"]');
    await expect(lpRadio).toBeChecked({ timeout: 2000 });

    // Confirm Sequential is no longer checked
    await expect(seqRadio).not.toBeChecked();

    await page.screenshot({ path: 'playwright-report/radio-interaction-test-runner.png', fullPage: false });
  });
});
