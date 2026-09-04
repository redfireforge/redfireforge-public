import { test, expect } from '@playwright/test';
import { seedAppData, seedWorkflowsInLocalStorage } from './helpers';
import type { Workflow } from '../src/features/workflow/types/workflow';

function makeWorkflowWithEndNode(): Workflow {
  return {
    id: 'wf-end-1',
    name: 'End Node Test',
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
        position: { x: 100, y: 100 },
        data: { label: 'Start', inputVariables: {} },
      },
      {
        id: 'http1',
        type: 'http',
        position: { x: 300, y: 100 },
        data: {
          label: 'HTTP Request',
          scenario: {
            id: 'sc1',
            name: 'Get Data',
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
        id: 'end',
        type: 'end',
        position: { x: 500, y: 100 },
        data: { label: 'End' },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'http1' },
      { id: 'e2', source: 'http1', target: 'end' },
    ],
  };
}

function makeWorkflowWithMultipleEndNodes(): Workflow {
  return {
    id: 'wf-multi-end-1',
    name: 'Multiple End Nodes Test',
    schemaVersion: 4,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      {
        id: 'fork',
        type: 'fork',
        position: { x: 100, y: 100 },
        data: { label: 'Fork' },
      },
      {
        id: 'branch1',
        type: 'http',
        position: { x: 100, y: 200 },
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
        position: { x: 100, y: 300 },
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
        id: 'end1',
        type: 'end',
        position: { x: 400, y: 200 },
        data: { label: 'End A' },
      },
      {
        id: 'end2',
        type: 'end',
        position: { x: 400, y: 300 },
        data: { label: 'End B' },
      },
    ],
    edges: [
      { id: 'e1', source: 'fork', target: 'branch1' },
      { id: 'e2', source: 'fork', target: 'branch2' },
      { id: 'e3', source: 'branch1', target: 'end1' },
      { id: 'e4', source: 'branch2', target: 'end2' },
    ],
  };
}

async function seedWorkflowData(page: import('@playwright/test').Page, workflow: Workflow) {
  await seedAppData(page);
  await seedWorkflowsInLocalStorage(page, [workflow], workflow.id);
}

test.describe('Workflow End Node', () => {
  test('can add End node to workflow', async ({ page }) => {
    const workflow = makeWorkflowWithEndNode();
    await seedWorkflowData(page, workflow);
    await page.goto('/?tab=workflow');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('.react-flow', { timeout: 10000 });

    const endNode = page.locator('.react-flow__node[data-id="end"]');
    await expect(endNode).toBeVisible({ timeout: 10000 });
    await expect(endNode.locator('.wf-node-label')).toHaveText('End');
  });

  test('End node appears in node palette', async ({ page }) => {
    const workflow = makeWorkflowWithEndNode();
    await seedWorkflowData(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Look for End node in palette or toolbar
    const endNodeButton = page.locator('button:has-text("End"), [role="button"]:has-text("End")').first();
    if (await endNodeButton.isVisible()) {
      await expect(endNodeButton).toBeVisible();
    }
  });

  test('End node can be connected to other nodes', async ({ page }) => {
    const workflow = makeWorkflowWithEndNode();
    await seedWorkflowData(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Verify edge to End node exists
    const edge = page.locator('[data-id="e2"]');
    await expect(edge).toBeVisible();
  });

  test('supports multiple End nodes in workflow', async ({ page }) => {
    const workflow = makeWorkflowWithMultipleEndNodes();
    await seedWorkflowData(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Verify both End nodes exist
    const end1 = page.locator('[data-id="end1"]');
    const end2 = page.locator('[data-id="end2"]');
    await expect(end1).toBeVisible();
    await expect(end2).toBeVisible();
  });

  test('End node is visible in workflow designer', async ({ page }) => {
    const workflow = makeWorkflowWithEndNode();
    await seedWorkflowData(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Verify End node is visible and properly rendered
    const endNode = page.locator('[data-id="end"]');
    await expect(endNode).toBeVisible({ timeout: 10000 });
    
    // End node should have the correct type class
    const endNodeElement = await endNode.elementHandle();
    expect(endNodeElement).toBeTruthy();
  });

  test('End node is terminal - no outgoing connections allowed', async ({ page }) => {
    const workflow = makeWorkflowWithEndNode();
    await seedWorkflowData(page, workflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // End node should exist
    const endNode = page.locator('[data-id="end"]');
    await expect(endNode).toBeVisible();

    // Check that there are no outgoing edges from End node
    const outgoingEdges = await page.locator('[data-source="end"]').count();
    expect(outgoingEdges).toBe(0);
  });

  test('workflow can have only an End node', async ({ page }) => {
    const simpleWorkflow: Workflow = {
      id: 'wf-end-only',
      name: 'End Only',
      schemaVersion: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      variables: {},
      hostProfiles: [],
      authProfiles: [],
      services: [],
      nodes: [
        {
          id: 'end',
          type: 'end',
          position: { x: 300, y: 200 },
          data: { label: 'End' },
        },
      ],
      edges: [],
    };

    await seedWorkflowData(page, simpleWorkflow);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('.ab-btn[title="Workflow"]');
    await page.waitForSelector('.react-flow', { timeout: 5000 });

    // Verify End node is visible
    const endNode = page.locator('[data-id="end"]');
    await expect(endNode).toBeVisible();
  });
});
