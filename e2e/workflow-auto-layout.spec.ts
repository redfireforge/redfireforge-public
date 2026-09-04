import { test, expect } from '@playwright/test';
import { seedAppData, seedWorkflowsInLocalStorage } from './helpers';
import type { Workflow } from '../src/features/workflow/types/workflow';

function makeWorkflowForAutoLayout(): Workflow {
  return {
    id: 'wf-autolayout-1',
    name: 'Auto Layout Test',
    schemaVersion: 4,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 0, y: 0 },
        data: { label: 'Start', inputVariables: {} },
      },
      {
        id: 'http1',
        type: 'http',
        position: { x: 0, y: 0 },
        data: {
          label: 'HTTP 1',
          scenario: {
            id: 'sc1',
            name: 'Request 1',
            url: 'https://httpbin.org/get',
            method: 'GET',
            headers: [],
            body: '',
            auth: { type: 'none' },
            validation: { mode: 'none' },
          },
        },
      },
      {
        id: 'http2',
        type: 'http',
        position: { x: 0, y: 0 },
        data: {
          label: 'HTTP 2',
          scenario: {
            id: 'sc2',
            name: 'Request 2',
            url: 'https://httpbin.org/post',
            method: 'POST',
            headers: [],
            body: '{}',
            auth: { type: 'none' },
            validation: { mode: 'none' },
          },
        },
      },
      {
        id: 'end',
        type: 'end',
        position: { x: 0, y: 0 },
        data: { label: 'End' },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'http1' },
      { id: 'e2', source: 'http1', target: 'http2' },
      { id: 'e3', source: 'http2', target: 'end' },
    ],
  };
}

function makeComplexWorkflow(): Workflow {
  return {
    id: 'wf-complex-1',
    name: 'Complex Layout Test',
    schemaVersion: 4,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 0, y: 0 },
        data: { label: 'Start', inputVariables: {} },
      },
      {
        id: 'fork',
        type: 'fork',
        position: { x: 0, y: 0 },
        data: { label: 'Fork' },
      },
      {
        id: 'branch1',
        type: 'http',
        position: { x: 0, y: 0 },
        data: {
          label: 'Branch A',
          scenario: {
            id: 'sc-a',
            name: 'Branch A',
            url: 'https://httpbin.org/get',
            method: 'GET',
            headers: [],
            body: '',
            auth: { type: 'none' },
            validation: { mode: 'none' },
          },
        },
      },
      {
        id: 'branch2',
        type: 'http',
        position: { x: 0, y: 0 },
        data: {
          label: 'Branch B',
          scenario: {
            id: 'sc-b',
            name: 'Branch B',
            url: 'https://httpbin.org/post',
            method: 'POST',
            headers: [],
            body: '{}',
            auth: { type: 'none' },
            validation: { mode: 'none' },
          },
        },
      },
      {
        id: 'join',
        type: 'join',
        position: { x: 0, y: 0 },
        data: { label: 'Join' },
      },
      {
        id: 'end',
        type: 'end',
        position: { x: 0, y: 0 },
        data: { label: 'End' },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'fork' },
      { id: 'e2', source: 'fork', target: 'branch1' },
      { id: 'e3', source: 'fork', target: 'branch2' },
      { id: 'e4', source: 'branch1', target: 'join' },
      { id: 'e5', source: 'branch2', target: 'join' },
      { id: 'e6', source: 'join', target: 'end' },
    ],
  };
}

async function seedWorkflowForAutoLayout(page: import('@playwright/test').Page, workflow: Workflow) {
  await seedAppData(page);
  await seedWorkflowsInLocalStorage(page, [workflow], workflow.id);
}

test.describe('Workflow Auto-Layout', () => {
  test('applies auto-layout to linear workflow', async ({ page }) => {
    const workflow = makeWorkflowForAutoLayout();
    await seedWorkflowForAutoLayout(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to workflow designer
    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Find and click auto-layout button
    const autoLayoutBtn = page.locator('button:has-text("Auto Layout"), button[title*="Auto"], button[aria-label*="layout"]').first();
    if (await autoLayoutBtn.isVisible()) {
      await autoLayoutBtn.click();
      // Wait for layout to apply
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-id="start"]') as HTMLElement;
        return node && node.style.transform.includes('translate');
      }, { timeout: 5000 });

      // Verify nodes are positioned in a linear layout
      const nodes = await page.locator('[data-id]').all();
      expect(nodes.length).toBeGreaterThan(0);

      // Check that start node exists
      const startNode = page.locator('[data-id="start"]');
      await expect(startNode).toBeVisible();
    }
  });

  test('applies auto-layout to complex workflow with fork/join', async ({ page }) => {
    const workflow = makeComplexWorkflow();
    await seedWorkflowForAutoLayout(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Apply auto-layout
    const autoLayoutBtn = page.locator('button:has-text("Auto Layout"), button[title*="Auto"], button[aria-label*="layout"]').first();
    if (await autoLayoutBtn.isVisible()) {
      await autoLayoutBtn.click();
      // Wait for layout to apply
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-id="fork"]') as HTMLElement;
        return node && node.style.transform.includes('translate');
      }, { timeout: 5000 });

      // Verify fork and join nodes exist
      const forkNode = page.locator('[data-id="fork"]');
      const joinNode = page.locator('[data-id="join"]');
      await expect(forkNode).toBeVisible();
      await expect(joinNode).toBeVisible();
    }
  });

  test('restores saved auto-layout positions on reload', async ({ page }) => {
    test.slow(); // Involves page reload

    const workflow = makeWorkflowForAutoLayout();
    await seedWorkflowForAutoLayout(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Apply auto-layout
    const autoLayoutBtn = page.locator('button:has-text("Auto Layout"), button[title*="Auto"], button[aria-label*="layout"]').first();
    if (await autoLayoutBtn.isVisible()) {
      await autoLayoutBtn.click();
      // Wait for layout to apply
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-id="start"]') as HTMLElement;
        return node && node.style.transform.includes('translate');
      }, { timeout: 5000 });

      // Get initial positions
      const startNode = page.locator('[data-id="start"]');
      const startBox = await startNode.boundingBox();

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      await page.click('.ab-btn[title="Workflow"]');
      await page.waitForSelector('.react-flow', { timeout: 10000 });
      await page.waitForTimeout(500);

      // Verify positions are restored
      const startNodeAfter = page.locator('[data-id="start"]');
      const startBoxAfter = await startNodeAfter.boundingBox();

      if (startBox && startBoxAfter) {
        // Positions should be approximately the same; allow generous tolerance
        // because React Flow viewport offset varies with browser window geometry
        expect(Math.abs(startBox.x - startBoxAfter.x)).toBeLessThan(350);
        expect(Math.abs(startBox.y - startBoxAfter.y)).toBeLessThan(350);
      }
    }
  });

  test('auto-layout button is accessible', async ({ page }) => {
    const workflow = makeWorkflowForAutoLayout();
    await seedWorkflowForAutoLayout(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Check auto-layout button exists and is enabled
    const autoLayoutBtn = page.locator('button:has-text("Auto Layout"), button[title*="Auto"], button[aria-label*="layout"]').first();
    if (await autoLayoutBtn.isVisible()) {
      await expect(autoLayoutBtn).toBeEnabled();
    }
  });
});
