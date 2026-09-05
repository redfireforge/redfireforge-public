import { test, expect } from '@playwright/test';

test.describe('View Results flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'http://localhost:5173' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
        id: 'fg-1', name: 'E2E Feature', microserviceId: 'svc-1', environmentId: 'env-1',
        scenarios: [{ id: 'sc-1', name: 'E2E Scenario', tests: [{
          id: 'test-1', name: 'GET Health', url: 'http://localhost:5173/',
          method: 'GET', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' },
        }] }],
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');

      const testRun = {
        id: 'run-e2e-1', timestamp: Date.now(),
        envName: 'test', svcName: 'test-service',
        baseUrl: 'http://localhost:5173',
        config: { concurrency: 1, iterations: 3, scenarioWeights: [], executionMode: 'sequential' },
        summary: {
          tps: 10, avgResponseTime: 50, minResponseTime: 20, maxResponseTime: 80,
          p95ResponseTime: 75, p99ResponseTime: 79, errorRate: 0,
          errorsByStatus: {}, totalRequests: 3, successfulRequests: 3,
          failedRequests: 0, failedValidations: 0, totalDurationMs: 300,
        },
        results: [
          { id: 'r1', scenarioId: 'test-1', scenarioName: 'GET Health', featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200, responseTimeMs: 20,
            responseBody: '{"ok":true}', timestamp: Date.now(), passed: true, validationMode: 'none', failureDetails: [] },
          { id: 'r2', scenarioId: 'test-1', scenarioName: 'GET Health', featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200, responseTimeMs: 50,
            responseBody: '{"ok":true}', timestamp: Date.now(), passed: true, validationMode: 'none', failureDetails: [] },
          { id: 'r3', scenarioId: 'test-1', scenarioName: 'GET Health', featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200, responseTimeMs: 80,
            responseBody: '{"ok":true}', timestamp: Date.now(), passed: true, validationMode: 'none', failureDetails: [] },
        ],
      };
      localStorage.setItem('perf-test-runs', JSON.stringify([testRun]));
      localStorage.setItem('perf-test-theme', 'dark');
    });
    await page.goto('/?tab=results');
    await page.waitForSelector('.app-header', { timeout: 25000 });
    await page.waitForLoadState('networkidle');
  });

  test('navigate to Results tab and see metrics', async ({ page }) => {
    // Already on Results tab from beforeEach
    await expect(page.locator('.sub-nav-tab.active')).toHaveText('Results');

    await expect(page.locator('.metric-label:has-text("TPS")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.metric-label:has-text("Avg Response")')).toBeVisible();
  });

  test('results show run history dropdown', async ({ page }) => {
    // Already on Results tab from beforeEach
    // ResultsRunSelect is a custom div-based dropdown (not a native <select>)
    const dropdown = page.locator('.results-run-select');
    await expect(dropdown).toBeVisible();
    const trigger = dropdown.locator('.results-run-select-trigger');
    await expect(trigger).toBeVisible();
  });

  test('results show request count in metrics', async ({ page }) => {
    // Already on Results tab from beforeEach

    await expect(page.locator('.metric-label:has-text("Total Requests")')).toBeVisible({ timeout: 5000 });
  });

  test('group by controls are present', async ({ page }) => {
    // Group by controls are in the Request Details tab
    await page.getByRole('tab', { name: 'Request Details' }).click();
    await expect(page.getByText('Group by')).toBeVisible({ timeout: 5000 });
  });
});
