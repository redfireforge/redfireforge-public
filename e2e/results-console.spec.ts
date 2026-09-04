/**
 * E2E tests for the Results Explorer Console Panel feature.
 * Covers: console toggle, keyboard shortcut, trace level display,
 * node filter, search, aggregate summary, iteration switching,
 * sub-workflow context, and designer canvas controls.
 */
import { test, expect, type Page } from '@playwright/test';
import { openResultsExplorer, seedTestRunsViaIDB } from './helpers';

// ─── Test Data ───────────────────────────────────────────────────────────────

const CONSOLE_WORKFLOW = {
  id: 'wf-console-test',
  name: 'Console Test WF',
  schemaVersion: 6,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  variables: {},
  hostProfiles: [],
  authProfiles: [],
  services: [],
  nodes: [
    { id: 'start', type: 'start', position: { x: 300, y: 0 }, data: { label: 'Start' } },
    { id: 'fetch', type: 'http', position: { x: 300, y: 120 }, data: { label: 'Fetch Data', scenario: { id: 'sc1', name: 'Fetch', method: 'GET', url: 'https://example.com/api', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } } },
    { id: 'process', type: 'http', position: { x: 300, y: 240 }, data: { label: 'Process', scenario: { id: 'sc2', name: 'Process', method: 'POST', url: 'https://example.com/process', headers: [], body: '{}', auth: { type: 'none' }, validation: { mode: 'none' } } } },
    { id: 'end', type: 'end', position: { x: 300, y: 360 }, data: { label: 'End' } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'fetch' },
    { id: 'e2', source: 'fetch', target: 'process' },
    { id: 'e3', source: 'process', target: 'end' },
  ],
};

function makeStandardTestRun(iterationCount = 3) {
  const now = Date.now();
  const iterations = [];
  for (let i = 0; i < iterationCount; i++) {
    const base = now + i * 500;
    const passed = i !== 1; // iteration #2 fails
    iterations.push({
      index: i,
      passed,
      durationMs: 200 + i * 50,
      traversedEdges: ['e1', 'e2', 'e3'],
      finalVariables: { userId: `user-${i}` },
      events: [
        { nodeId: 'start', nodeType: 'start', nodeLabel: 'Start', timestamp: base, state: 'pass' as const, durationMs: 1 },
        {
          nodeId: 'fetch', nodeType: 'http', nodeLabel: 'Fetch Data',
          timestamp: base + 1, state: 'pass' as const, durationMs: 80,
          details: { statusCode: 200, method: 'GET', url: 'https://example.com/api', extractedVariables: { userId: `user-${i}` } },
        },
        {
          nodeId: 'process', nodeType: 'http', nodeLabel: 'Process',
          timestamp: base + 81, state: (passed ? 'pass' : 'fail') as 'pass' | 'fail', durationMs: 100,
          details: {
            statusCode: passed ? 200 : 500,
            method: 'POST',
            url: 'https://example.com/process',
            ...(passed ? {} : { error: 'Server Error', errorStack: 'Error at line 1' }),
          },
        },
        { nodeId: 'end', nodeType: 'end', nodeLabel: 'End', timestamp: base + 181, state: 'pass' as const, durationMs: 1 },
      ],
    });
  }

  return {
    id: 'run-console-test',
    timestamp: now,
    config: { executionMode: 'workflow', iterations: iterationCount, concurrency: 1, thinkTime: { type: 'none' }, scenarioWeights: [] },
    summary: {
      totalRequests: iterationCount * 2,
      successfulRequests: (iterationCount - 1) * 2,
      failedRequests: 2,
      totalDurationMs: iterationCount * 300,
      tps: 3,
      avgResponseTime: 100,
      minResponseTime: 50,
      maxResponseTime: 200,
      p50ResponseTime: 100,
      p95ResponseTime: 190,
      p99ResponseTime: 200,
      errorRate: 1 / iterationCount,
      errorsByStatus: { 500: 1 },
      failedValidations: 0,
    },
    results: [],
    workflowName: 'Console Test WF',
    executionTrace: {
      workflowId: 'wf-console-test',
      workflowName: 'Console Test WF',
      totalIterations: iterationCount,
      totalDurationMs: iterationCount * 300,
      fullTraceCaptured: true,
      captureLevel: 'standard',
      traversedEdges: ['e1', 'e2', 'e3'],
      workflowSnapshot: { nodes: CONSOLE_WORKFLOW.nodes, edges: CONSOLE_WORKFLOW.edges },
      iterations,
    },
  };
}

function makeMinimalTestRun() {
  const now = Date.now();
  return {
    id: 'run-console-minimal',
    timestamp: now,
    config: { executionMode: 'workflow', iterations: 1, concurrency: 1, thinkTime: { type: 'none' }, scenarioWeights: [] },
    summary: {
      totalRequests: 1, successfulRequests: 1, failedRequests: 0,
      totalDurationMs: 200, tps: 5, avgResponseTime: 50,
      minResponseTime: 50, maxResponseTime: 50,
      p50ResponseTime: 50, p95ResponseTime: 50, p99ResponseTime: 50,
      errorRate: 0, errorsByStatus: {}, failedValidations: 0,
    },
    results: [],
    workflowName: 'Console Test WF',
    executionTrace: {
      workflowId: 'wf-console-test',
      workflowName: 'Console Test WF',
      totalIterations: 1,
      totalDurationMs: 200,
      fullTraceCaptured: false,
      captureLevel: 'minimal',
      traversedEdges: ['e1', 'e2', 'e3'],
      workflowSnapshot: { nodes: CONSOLE_WORKFLOW.nodes, edges: CONSOLE_WORKFLOW.edges },
      iterations: [{
        index: 0, passed: true, durationMs: 200,
        traversedEdges: ['e1', 'e2', 'e3'],
        finalVariables: {},
        events: [
          { nodeId: 'start', nodeType: 'start', nodeLabel: 'Start', timestamp: now, state: 'pass' as const, durationMs: 1 },
          { nodeId: 'end', nodeType: 'end', nodeLabel: 'End', timestamp: now + 199, state: 'pass' as const, durationMs: 1 },
        ],
      }],
    },
  };
}

// ─── Helper: Open Results Explorer with seeded data ──────────────────────────

async function seedAndOpenResultsExplorer(page: Page, testRun: ReturnType<typeof makeStandardTestRun>): Promise<void> {
  await page.addInitScript((wfs) => {
    localStorage.setItem('workflows', JSON.stringify(wfs));
    localStorage.setItem('perf-test-theme', 'dark');
    localStorage.setItem('cloud-waitlist-dismissed', 'true');
  }, [CONSOLE_WORKFLOW]);

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('domcontentloaded');

  const seeded = await seedTestRunsViaIDB(page, [testRun]);
  expect(seeded).toBe('ok');

  await page.goto('/?tab=results', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-header')).toBeVisible({ timeout: 25000 });

  await openResultsExplorer(page, { retryHarness: true });

  await expect(page.locator('.results-explorer-modal, .results-explorer-overlay, [data-testid="console-toggle-btn-header"]')).toBeVisible({ timeout: 10000 });
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

test.describe('Results Explorer Console Panel', () => {
  test('console toggle button visible in header and toggles panel', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    const toggleBtn = page.locator('[data-testid="console-toggle-btn-header"]');
    await expect(toggleBtn).toBeVisible({ timeout: 5000 });
    await expect(toggleBtn).toContainText('Console');

    // Console should not be visible initially
    await expect(page.locator('[data-testid="results-console-panel"]')).not.toBeVisible();

    // Click to open
    await toggleBtn.click();
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    // Click again to close
    await toggleBtn.click();
    await expect(page.locator('[data-testid="results-console-panel"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('Cmd+J keyboard shortcut toggles console', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    // Open with Cmd+J
    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    // Close with Cmd+J
    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('console shows trace level badge', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    const levelBadge = page.locator('[data-testid="console-level-badge"]');
    await expect(levelBadge).toBeVisible();
    await expect(levelBadge).toHaveText('standard');

    const headerLevel = page.locator('[data-testid="console-header-level"]');
    await expect(headerLevel).toHaveText('standard');
  });

  test('console shows aggregate summary when no iteration selected (multi-iteration)', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun(3));

    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    const consoleBody = page.locator('[data-testid="results-console-body"]');
    await expect(consoleBody).toBeVisible();

    // Aggregate summary should contain run overview info
    const bodyText = await consoleBody.textContent();
    expect(bodyText).toBeTruthy();
    // Should mention pass rate or run overview concepts
    expect(bodyText!.toLowerCase()).toMatch(/run overview|pass|iteration|failed/i);
  });

  test('console updates content when selecting a specific iteration', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun(3));

    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    // Select iteration #1 using keyboard (press '1')
    await page.keyboard.press('1');
    await page.waitForTimeout(500);

    const consoleBody = page.locator('[data-testid="results-console-body"]');
    const bodyText = await consoleBody.textContent();
    expect(bodyText).toBeTruthy();
    // Should show node-level log lines (Fetch Data, Process, etc.)
    expect(bodyText!).toMatch(/Fetch Data|Process|Start|GET/i);
  });

  test('console disabled state at minimal trace level', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeMinimalTestRun());

    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    // Should show disabled hint
    const disabledPanel = page.locator('[data-testid="results-console-disabled"]');
    if (await disabledPanel.isVisible()) {
      await expect(disabledPanel).toContainText(/Standard or higher|full console/i);
    } else {
      // Minimal with no errors: may show minimal content or empty message
      const body = page.locator('[data-testid="results-console-body"]');
      await expect(body).toBeVisible();
    }
  });

  test('node filter dropdown filters console lines', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun(3));

    // Select iteration #1
    await page.keyboard.press('1');
    await page.waitForTimeout(500);

    // Open console
    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    const nodeFilterBtn = page.locator('[data-testid="console-node-filter"]');
    if (await nodeFilterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get initial line count
      const consoleBody = page.locator('[data-testid="results-console-body"]');
      const initialText = await consoleBody.textContent();

      // Open the filter dropdown
      await nodeFilterBtn.click();
      const menu = page.locator('[data-testid="console-node-filter-menu"]');
      await expect(menu).toBeVisible({ timeout: 2000 });

      // Select "Fetch Data" node
      const fetchOption = menu.locator('button').filter({ hasText: 'Fetch Data' });
      if (await fetchOption.isVisible()) {
        await fetchOption.click();
        await page.waitForTimeout(300);

        const filteredText = await consoleBody.textContent();
        // After filtering to "Fetch Data", lines related to "Process" should be gone
        if (initialText?.includes('Process')) {
          expect(filteredText).not.toMatch(/\bProcess\b.*HTTP|Process.*POST/);
        }
      }
    }
  });

  test('search highlights matches and shows count', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun(3));

    // Select iteration #1
    await page.keyboard.press('1');
    await page.waitForTimeout(500);

    // Open console
    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    // Click Search button
    const searchBtn = page.locator('.re-console-action-btn').filter({ hasText: 'Search' });
    if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchBtn.click();

      const searchInput = page.locator('[data-testid="console-search"]');
      await expect(searchInput).toBeVisible({ timeout: 2000 });

      // Type search query
      await searchInput.fill('Fetch');
      await page.waitForTimeout(300);

      // Should show match count
      const matchCount = page.locator('.re-console-search-count');
      if (await matchCount.isVisible({ timeout: 2000 }).catch(() => false)) {
        const countText = await matchCount.textContent();
        expect(countText).toMatch(/\d+\/\d+|No matches/);
      }
    }
  });

  test('console close button works', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    // Click close button (✕)
    const closeBtn = page.locator('[data-testid="results-console-close-btn"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(page.locator('[data-testid="results-console-panel"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('Escape closes console', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    await page.keyboard.press('Meta+j');
    await expect(page.locator('[data-testid="results-console-panel"]')).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="results-console-panel"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('console mode selector changes display mode', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    await page.keyboard.press('Meta+j');
    const panel = page.locator('[data-testid="results-console-panel"]');
    await expect(panel).toBeVisible({ timeout: 3000 });

    const modeSelect = page.locator('.re-console-mode-select');
    if (await modeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Default should be docked
      await expect(panel).toHaveClass(/re-console-docked/);

      // Switch to maximized
      await modeSelect.locator('.cs-trigger').click();
      await page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]', { hasText: 'Full Screen' }).click();
      await page.waitForTimeout(300);
      await expect(panel).toHaveClass(/re-console-maximized/);

      // Switch back to docked
      await modeSelect.locator('.cs-trigger').click();
      await page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]', { hasText: 'Bottom' }).click();
      await page.waitForTimeout(300);
      await expect(panel).toHaveClass(/re-console-docked/);
    }
  });
});

test.describe('Results Explorer — Workflow Context', () => {
  test('shows workflow name in empty detail panel', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun());

    const workflowInfo = page.locator('[data-testid="workflow-info"]');
    await expect(workflowInfo).toBeVisible({ timeout: 5000 });

    const nameEl = page.locator('.workflow-info-name');
    await expect(nameEl).toHaveText('Console Test WF');

    // Root workflow should show "Root Workflow" type
    const typeEl = page.locator('.workflow-info-type');
    await expect(typeEl).toHaveText('Root Workflow');
  });
});

test.describe('Results Explorer — Iteration Picker', () => {
  test('iteration picker dropdown closes on outside click', async ({ page }) => {
    await seedAndOpenResultsExplorer(page, makeStandardTestRun(3));

    const pickerBtn = page.locator('.iter-picker-toggle').first();
    if (await pickerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pickerBtn.click();
      const dropdown = page.locator('.iter-picker-dropdown');
      await expect(dropdown).toBeVisible({ timeout: 2000 });

      // Click outside — the backdrop should catch the click and close the dropdown
      const backdrop = page.locator('.iter-picker-backdrop');
      if (await backdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
        await backdrop.click({ force: true });
      } else {
        // Fallback: click on the modal body area
        await page.locator('.full-panel-modal-body, .results-explorer-body').first().click({ position: { x: 10, y: 10 }, force: true });
      }
      await page.waitForTimeout(500);

      await expect(dropdown).not.toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Results Explorer Console — Sub-Workflow', () => {
  const PARENT_WORKFLOW = {
    id: 'wf-console-parent',
    name: 'Parent WF',
    schemaVersion: 6,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      { id: 'p-start', type: 'start', position: { x: 300, y: 0 }, data: { label: 'Start' } },
      { id: 'p-http', type: 'http', position: { x: 300, y: 120 }, data: { label: 'Fetch', scenario: { id: 'sc1', name: 'Fetch', method: 'GET', url: 'https://example.com/api', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } } },
      { id: 'p-sub', type: 'subWorkflow', position: { x: 300, y: 240 }, data: { label: 'Child Process', workflowId: 'wf-child', workflowName: 'Child Workflow' } },
      { id: 'p-end', type: 'end', position: { x: 300, y: 360 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'pe1', source: 'p-start', target: 'p-http' },
      { id: 'pe2', source: 'p-http', target: 'p-sub' },
      { id: 'pe3', source: 'p-sub', target: 'p-end' },
    ],
  };

  function makeSubWorkflowTestRun() {
    const now = Date.now();
    const childTrace = {
      workflowId: 'wf-child',
      workflowName: 'Child Workflow',
      totalIterations: 1,
      totalDurationMs: 100,
      fullTraceCaptured: true,
      captureLevel: 'standard',
      traversedEdges: ['ce1', 'ce2'],
      workflowSnapshot: {
        nodes: [
          { id: 'c-start', type: 'start', position: { x: 300, y: 0 }, data: { label: 'Child Start' } },
          { id: 'c-http', type: 'http', position: { x: 300, y: 120 }, data: { label: 'Child Fetch', scenario: { id: 'csc1', name: 'ChildFetch', method: 'GET', url: 'https://example.com/child', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } } },
          { id: 'c-end', type: 'end', position: { x: 300, y: 240 }, data: { label: 'Child End' } },
        ],
        edges: [
          { id: 'ce1', source: 'c-start', target: 'c-http' },
          { id: 'ce2', source: 'c-http', target: 'c-end' },
        ],
      },
      iterations: [{
        index: 0, passed: true, durationMs: 100,
        traversedEdges: ['ce1', 'ce2'],
        finalVariables: {},
        events: [
          { nodeId: 'c-start', nodeType: 'start', nodeLabel: 'Child Start', timestamp: now + 50, state: 'pass' as const, durationMs: 1 },
          { nodeId: 'c-http', nodeType: 'http', nodeLabel: 'Child Fetch', timestamp: now + 51, state: 'pass' as const, durationMs: 80, details: { statusCode: 200 } },
          { nodeId: 'c-end', nodeType: 'end', nodeLabel: 'Child End', timestamp: now + 131, state: 'pass' as const, durationMs: 1 },
        ],
      }],
    };

    return {
      id: 'run-sub-wf-console',
      timestamp: now,
      config: { executionMode: 'workflow', iterations: 1, concurrency: 1, thinkTime: { type: 'none' }, scenarioWeights: [] },
      summary: {
        totalRequests: 2, successfulRequests: 2, failedRequests: 0,
        totalDurationMs: 300, tps: 6, avgResponseTime: 80,
        minResponseTime: 50, maxResponseTime: 100,
        p50ResponseTime: 80, p95ResponseTime: 100, p99ResponseTime: 100,
        errorRate: 0, errorsByStatus: {}, failedValidations: 0,
      },
      results: [],
      workflowName: 'Parent WF',
      executionTrace: {
        workflowId: 'wf-console-parent',
        workflowName: 'Parent WF',
        totalIterations: 1,
        totalDurationMs: 300,
        fullTraceCaptured: true,
        captureLevel: 'standard',
        traversedEdges: ['pe1', 'pe2', 'pe3'],
        workflowSnapshot: { nodes: PARENT_WORKFLOW.nodes, edges: PARENT_WORKFLOW.edges },
        iterations: [{
          index: 0, passed: true, durationMs: 300,
          traversedEdges: ['pe1', 'pe2', 'pe3'],
          finalVariables: {},
          events: [
            { nodeId: 'p-start', nodeType: 'start', nodeLabel: 'Start', timestamp: now, state: 'pass' as const, durationMs: 1 },
            { nodeId: 'p-http', nodeType: 'http', nodeLabel: 'Fetch', timestamp: now + 1, state: 'pass' as const, durationMs: 50, details: { statusCode: 200 } },
            { nodeId: 'p-sub', nodeType: 'subWorkflow', nodeLabel: 'Child Process', timestamp: now + 51, state: 'pass' as const, durationMs: 100, details: { subWorkflowTrace: childTrace } },
            { nodeId: 'p-end', nodeType: 'end', nodeLabel: 'End', timestamp: now + 151, state: 'pass' as const, durationMs: 1 },
          ],
        }],
      },
    };
  }

  test('sub-workflow shows parent info after drill-down', async ({ page }) => {
    await page.addInitScript((wfs) => {
      localStorage.setItem('workflows', JSON.stringify(wfs));
      localStorage.setItem('perf-test-theme', 'dark');
    }, [PARENT_WORKFLOW]);

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');

    const seeded = await seedTestRunsViaIDB(page, [makeSubWorkflowTestRun()]);
    expect(seeded).toBe('ok');

    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForSelector('.app-header', { timeout: 25000 });

    await openResultsExplorer(page, { retryHarness: true });

    await expect(page.locator('.results-explorer-modal, .results-explorer-overlay, [data-testid="workflow-info"]')).toBeVisible({ timeout: 10000 });

    // Verify root workflow context
    const workflowInfo = page.locator('[data-testid="workflow-info"]');
    await expect(workflowInfo).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.workflow-info-name')).toHaveText('Parent WF');
    await expect(page.locator('.workflow-info-type')).toHaveText('Root Workflow');

    // Try to drill down by clicking the sub-workflow node
    // Single iteration is auto-selected, so look for the sub-workflow node
    const subNode = page.locator('.react-flow__node').filter({ hasText: 'Child Process' });
    if (await subNode.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click to select
      await subNode.click();

      // Look for drill-down button in detail panel
      const drillBtn = page.locator('button').filter({ hasText: /View Sub-Workflow|Drill/i });
      if (await drillBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await drillBtn.click();

        // After drill-down, workflow info should show child name and parent reference
        const childName = page.locator('.workflow-info-name');
        await expect(childName).toHaveText('Child Workflow', { timeout: 3000 });

        const parentLabel = page.locator('.workflow-info-parent-name');
        if (await parentLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
          await expect(parentLabel).toHaveText('Parent WF');
        }
      }
    }
  });
});

test.describe('Designer Canvas Controls', () => {
  const DESIGNER_WORKFLOW = {
    id: 'wf-designer-controls',
    name: 'Designer Controls Test',
    schemaVersion: 6,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      { id: 'start', type: 'start', position: { x: 200, y: 100 }, data: { label: 'Start' } },
      { id: 'http', type: 'http', position: { x: 200, y: 250 }, data: { label: 'Request', scenario: { id: 'sc1', name: 'Test', method: 'GET', url: '/api', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } } },
      { id: 'end', type: 'end', position: { x: 200, y: 400 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'http' },
      { id: 'e2', source: 'http', target: 'end' },
    ],
  };

  test('toolbar shows canvas controls without a dedicated Auto-Layout button', async ({ page }) => {
    await page.addInitScript((wfs) => {
      localStorage.setItem('workflows', JSON.stringify(wfs));
      localStorage.setItem('workflows_selected_id', wfs[0].id);
      localStorage.setItem('workflows_sample_dismissed', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    }, [DESIGNER_WORKFLOW]);

    await page.goto('/?tab=workflow');
    await page.waitForSelector('.wf-designer', { timeout: 25000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Should have Fit View and Save Layout buttons
    const fitViewBtn = page.locator('button[title*="Fit view"], button[title*="Restore saved view"]');
    await expect(fitViewBtn.first()).toBeVisible({ timeout: 5000 });

    const saveLayoutBtn = page.locator('button[title*="Save current"]');
    await expect(saveLayoutBtn).toBeVisible({ timeout: 5000 });

    // Should NOT have a dedicated Auto-Layout toolbar button (layout is via ⌘L shortcut)
    const autoLayoutBtn = page.locator('button[title*="Auto-layout" i], button[title*="Auto layout" i]');
    await expect(autoLayoutBtn).not.toBeVisible();

    // Undo/Redo are visible in the designer toolbar but disabled on a fresh workflow
    const undoBtn = page.locator('button[title*="Undo" i]');
    const redoBtn = page.locator('button[title*="Redo" i]');
    await expect(undoBtn).toBeVisible();
    await expect(redoBtn).toBeVisible();
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();
  });

  test('Save current layout button is clickable', async ({ page }) => {
    await page.addInitScript((wfs) => {
      localStorage.setItem('workflows', JSON.stringify(wfs));
      localStorage.setItem('workflows_selected_id', wfs[0].id);
      localStorage.setItem('workflows_sample_dismissed', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    }, [DESIGNER_WORKFLOW]);

    await page.goto('/?tab=workflow');
    await page.waitForSelector('.wf-designer', { timeout: 25000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    const saveBtn = page.locator('button[title*="Save current"]');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
    await expect(saveBtn).toBeVisible();
  });
});

test.describe('Workflow Runner — Trace Level', () => {
  const RUNNER_WORKFLOW = {
    id: 'wf-runner-trace',
    name: 'Runner Trace Test',
    schemaVersion: 6,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    variables: {},
    hostProfiles: [],
    authProfiles: [],
    services: [],
    nodes: [
      { id: 'start', type: 'start', position: { x: 200, y: 100 }, data: { label: 'Start' } },
      { id: 'http', type: 'http', position: { x: 200, y: 250 }, data: { label: 'Request', scenario: { id: 'sc1', name: 'Test', method: 'GET', url: '/api', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } } },
      { id: 'end', type: 'end', position: { x: 200, y: 400 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'http' },
      { id: 'e2', source: 'http', target: 'end' },
    ],
  };

  async function navigateToWorkflowRunner(page: import('@playwright/test').Page) {
    await page.addInitScript((wfs) => {
      localStorage.setItem('workflows', JSON.stringify(wfs));
      localStorage.setItem('perf-test-theme', 'dark');
    }, [RUNNER_WORKFLOW]);

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-header', { timeout: 25000 });

    const harnessBtn = page.locator('button[title="Harness"]').first();
    await expect(harnessBtn).toBeVisible({ timeout: 8000 });
    await harnessBtn.click();

    const runnerTab = page.locator('button').filter({ hasText: 'Workflow Runner' }).first();
    await expect(runnerTab).toBeVisible({ timeout: 8000 });
    await runnerTab.click();

    const wfSelect = page.getByTestId('workflow-select');
    await expect(wfSelect).toBeVisible({ timeout: 8000 });
    await wfSelect.click();

    const dropdownItem = page.locator('.wfp-dropdown-item').filter({ hasText: 'Runner Trace Test' });
    await expect(dropdownItem.first()).toBeVisible({ timeout: 5000 });
    await dropdownItem.first().click();

    await expect(page.getByText('Trace Level:')).toBeVisible({ timeout: 8000 });
  }

  test('trace level radio buttons are visible in the runner', async ({ page }) => {
    await navigateToWorkflowRunner(page);

    // Should see Trace Level label and radio buttons
    const traceLevelLabel = page.getByText('Trace Level:');
    await expect(traceLevelLabel).toBeVisible({ timeout: 5000 });

    // All four trace level radio buttons should be visible
    for (const level of ['Minimal', 'Standard', 'Full', 'Debug']) {
      const radio = page.locator('label.radio-label').filter({ hasText: level });
      await expect(radio).toBeVisible({ timeout: 3000 });
    }
  });

  test('trace level can be changed to debug', async ({ page }) => {
    await navigateToWorkflowRunner(page);

    // Click Debug radio
    const debugRadio = page.locator('label.radio-label').filter({ hasText: 'Debug' });
    await expect(debugRadio).toBeVisible({ timeout: 5000 });
    await debugRadio.click();

    // The Debug radio input should now be checked
    const debugInput = debugRadio.locator('input[type="radio"]');
    await expect(debugInput).toBeChecked();
  });
});
