/**
 * E2E: Radio button styling diagnostic
 * Verifies that radio buttons in both Test Runner and Workflow Runner
 * have the correct blue accent-color styling when checked.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Workflow } from '../src/features/workflow/types/workflow';

function makeSimpleWorkflow(): Workflow {
  return {
    id: 'wf-radio-test',
    name: 'Radio Button Test Workflow',
    schemaVersion: 4,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      {
        id: 'start-1', type: 'start', position: { x: 300, y: 0 },
        data: { label: 'Start', inputVariables: {} },
      },
      {
        id: 'http-1', type: 'http', position: { x: 280, y: 120 },
        data: {
          label: 'Get Post',
          method: 'GET',
          url: 'https://jsonplaceholder.typicode.com/posts/1',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
        },
      },
      {
        id: 'end-1', type: 'end', position: { x: 300, y: 260 },
        data: { label: 'End' },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-1', target: 'http-1', type: 'default' },
      { id: 'e2', source: 'http-1', target: 'end-1', type: 'default' },
    ],
  };
}

/** Seeds data with a workflow so the Workflow Runner has something to select */
async function seedWithWorkflow(page: Page, workflow: Workflow) {
  await page.addInitScript((wf) => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'http://localhost:5173' },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', '[]');
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
    localStorage.setItem('workflows', JSON.stringify([wf]));
  }, workflow);
}

/** Read the computed accent-color of an element via CSS */
async function getAccentColor(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) return 'NOT_FOUND';
    return window.getComputedStyle(el).accentColor;
  }, selector);
}

/** Check if a color value represents blue #3b82f6 */
function isBlue(color: string): boolean {
  // rgb(59, 130, 246) = #3b82f6
  return /rgb\(59,?\s*130,?\s*246\)/i.test(color) || /#3b82f6/i.test(color);
}

test.describe('Radio button CSS styling', () => {
  test('Test Runner: execution mode radio buttons have blue accent-color', async ({ page }) => {
    await page.goto('/?tab=runner');
    await page.waitForLoadState('networkidle');

    const radioSelector = '.runner-option-box .radio-label input[type="radio"]';
    await page.waitForSelector(radioSelector, { timeout: 5000 });

    const accentColor = await getAccentColor(page, radioSelector);
    console.log('[TestRunner] execution mode radio accent-color:', accentColor);

    expect(accentColor, 'Test Runner execution mode radios should have blue accent-color').not.toBe('NOT_FOUND');
    expect(isBlue(accentColor), `Expected blue but got: ${accentColor}`).toBe(true);
  });

  test('Test Runner: On Error radio buttons have blue accent-color', async ({ page }) => {
    await page.goto('/?tab=runner');
    await page.waitForLoadState('networkidle');

    const radioSelector = '.error-policy-options .radio-label input[type="radio"]';
    await page.waitForSelector(radioSelector, { timeout: 5000 });

    const accentColor = await getAccentColor(page, radioSelector);
    console.log('[TestRunner] On Error radio accent-color:', accentColor);

    expect(isBlue(accentColor), `Expected blue but got: ${accentColor}`).toBe(true);
  });

  test('Test Runner: Think Time radio buttons have blue accent-color', async ({ page }) => {
    await page.goto('/?tab=runner');
    await page.waitForLoadState('networkidle');

    const radioSelector = '.think-time-section .radio-label input[type="radio"]';
    await page.waitForSelector(radioSelector, { timeout: 5000 });

    const accentColor = await getAccentColor(page, radioSelector);
    console.log('[TestRunner] Think Time radio accent-color:', accentColor);

    expect(isBlue(accentColor), `Expected blue but got: ${accentColor}`).toBe(true);
  });

  test('Workflow Runner: DIAGNOSTIC dump all radio computed styles', async ({ page }) => {
    await seedWithWorkflow(page, makeSimpleWorkflow());
    await page.goto('/?tab=workflow-runner');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('workflow-select').waitFor({ timeout: 5000 });
    await page.getByTestId('workflow-select').click();
    const options = await page.locator('.wfp-dropdown-item').allTextContents();
    console.log('Workflow select options:', options);
    await page.locator('.wfp-dropdown-item:has-text("Radio Button Test Workflow")').click();
    await page.waitForTimeout(500);

    // Dump all radio buttons with full CSS computed info
    const allRadioInfo = await page.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
      return radios.map((el) => {
        const computed = window.getComputedStyle(el);
        const ancestors: string[] = [];
        let node: Element | null = el.parentElement;
        for (let i = 0; i < 5 && node; i++) {
          ancestors.push(`${node.tagName.toLowerCase()}.${Array.from(node.classList).join('.')}`);
          node = node.parentElement;
        }
        return {
          name: (el as HTMLInputElement).name,
          checked: (el as HTMLInputElement).checked,
          accentColor: computed.accentColor,
          width: computed.width,
          height: computed.height,
          opacity: computed.opacity,
          visibility: computed.visibility,
          pointerEvents: computed.pointerEvents,
          ancestors: ancestors.slice(0, 3),
        };
      });
    });

    console.log('\n=== ALL RADIO BUTTONS IN WORKFLOW RUNNER ===');
    allRadioInfo.forEach((r, i) => {
      console.log(`[${i}] name=${r.name} checked=${r.checked} accent=${r.accentColor} size=${r.width}x${r.height} opacity=${r.opacity} vis=${r.visibility}`);
      console.log(`     ancestors: ${r.ancestors.join(' > ')}`);
    });

    await page.screenshot({ path: 'playwright-report/radio-button-diagnostic.png', fullPage: false });

    // Separate visible from hidden radios
    const visible = allRadioInfo.filter(r =>
      r.opacity !== '0' && r.visibility !== 'hidden' && r.width !== '0px' && r.pointerEvents !== 'none'
    );
    const hidden = allRadioInfo.filter(r =>
      r.opacity === '0' || r.visibility === 'hidden' || r.width === '0px' || r.pointerEvents === 'none'
    );

    console.log(`\nVisible radios: ${visible.length}, Hidden (custom-styled) radios: ${hidden.length}`);

    // All visible radios should be blue
    for (const radio of visible) {
      expect(
        isBlue(radio.accentColor),
        `Radio name="${radio.name}" ancestors="${radio.ancestors.join(' > ')}" has accent-color="${radio.accentColor}" — expected blue`
      ).toBe(true);
    }
  });

  test('Workflow Runner: execution mode radio buttons have blue accent-color', async ({ page }) => {
    await seedWithWorkflow(page, makeSimpleWorkflow());
    await page.goto('/?tab=workflow-runner');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('workflow-select').waitFor({ timeout: 5000 });
    await page.getByTestId('workflow-select').click();
    await page.locator('.wfp-dropdown-item:has-text("Radio Button Test Workflow")').click();
    await page.waitForTimeout(300);

    const radioSelector = '.runner-option-box .radio-label input[type="radio"]';
    await page.waitForSelector(radioSelector, { timeout: 5000 });

    const accentColor = await getAccentColor(page, radioSelector);
    console.log('[WorkflowRunner] execution mode radio accent-color:', accentColor);

    expect(isBlue(accentColor), `Expected blue but got: ${accentColor}`).toBe(true);
  });

  test('Workflow Runner: On Error radio buttons have blue accent-color', async ({ page }) => {
    await seedWithWorkflow(page, makeSimpleWorkflow());
    await page.goto('/?tab=workflow-runner');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('workflow-select').waitFor({ timeout: 15000 });
    await page.getByTestId('workflow-select').click();
    await page.locator('.wfp-dropdown-item:has-text("Radio Button Test Workflow")').click();
    await page.waitForTimeout(300);

    const radioSelector = '.error-policy-options .radio-label input[type="radio"]';
    await page.waitForSelector(radioSelector, { timeout: 10000 });

    const accentColor = await getAccentColor(page, radioSelector);
    console.log('[WorkflowRunner] On Error radio accent-color:', accentColor);

    expect(isBlue(accentColor), `Expected blue but got: ${accentColor}`).toBe(true);
  });

  test('Workflow Runner: Think Time radio buttons have blue accent-color', async ({ page }) => {
    await seedWithWorkflow(page, makeSimpleWorkflow());
    await page.goto('/?tab=workflow-runner');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('workflow-select').waitFor({ timeout: 15000 });
    await page.getByTestId('workflow-select').click();
    await page.locator('.wfp-dropdown-item:has-text("Radio Button Test Workflow")').click();
    await page.waitForTimeout(300);

    const radioSelector = '.think-time-section .radio-label input[type="radio"]';
    await page.waitForSelector(radioSelector, { timeout: 10000 });

    const accentColor = await getAccentColor(page, radioSelector);
    console.log('[WorkflowRunner] Think Time radio accent-color:', accentColor);

    expect(isBlue(accentColor), `Expected blue but got: ${accentColor}`).toBe(true);
  });

  test('Workflow Runner: execution config renders correct radio structure', async ({ page }) => {
    await seedWithWorkflow(page, makeSimpleWorkflow());
    await page.goto('/?tab=workflow-runner');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('workflow-select').waitFor({ timeout: 15000 });
    await page.getByTestId('workflow-select').click();
    await page.locator('.wfp-dropdown-item:has-text("Radio Button Test Workflow")').click();
    await page.waitForTimeout(300);

    // Scope to the Workflow Runner config section
    const configSection = page.locator('.workflow-runner-config-section');
    await configSection.waitFor({ timeout: 15000 });

    // Scope to the execution mode option box (contains "Execution Mode:" label)
    const execModeBox = configSection.locator('.runner-option-box:has-text("Execution Mode:")');
    await execModeBox.waitFor({ timeout: 15000 });

    // Verify all 5 execution mode radio buttons are present (name is prefixed to avoid cross-instance collisions)
    const allExecRadios = execModeBox.locator('input[type="radio"][name="workflow-runner-execMode"]');
    await expect(allExecRadios).toHaveCount(5);

    // Verify exactly one is checked initially
    let checkedCount = 0;
    for (let i = 0; i < 5; i++) {
      if (await allExecRadios.nth(i).isChecked()) checkedCount++;
    }
    expect(checkedCount, 'Exactly one execution mode should be selected by default').toBe(1);

    // Verify the mode labels are correct
    const labels = execModeBox.locator('.radio-label');
    await expect(labels).toHaveCount(5);
    await expect(labels.nth(0)).toContainText('Sequential');
    await expect(labels.nth(1)).toContainText('Batch');
    await expect(labels.nth(2)).toContainText('Continuous Pool');
    await expect(labels.nth(3)).toContainText('Load Profile');
    await expect(labels.nth(4)).toContainText('Constant Arrival');

    // Verify all radio inputs have blue accent-color
    for (let i = 0; i < 5; i++) {
      const accentColor = await allExecRadios.nth(i).evaluate(
        (el) => window.getComputedStyle(el).accentColor
      );
      expect(isBlue(accentColor), `Execution mode radio ${i} should have blue accent-color but got: ${accentColor}`).toBe(true);
    }

    await page.screenshot({ path: 'playwright-report/radio-button-workflow-runner.png', fullPage: false });
  });
});
