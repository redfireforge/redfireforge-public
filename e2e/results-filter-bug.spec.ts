import { test, expect } from '@playwright/test';
import { REDFIREFORGE_IDB_VERSION } from './helpers';

async function selectCustomOption(page: import('@playwright/test').Page, select: import('@playwright/test').Locator, label: string) {
  await select.locator('.cs-trigger').click();
  await page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]', { hasText: label }).click();
}

test.describe('Results Dashboard — Failed Only filter', () => {
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

      const now = Date.now();
      const testRun = {
        id: 'run-filter-test',
        timestamp: now,
        envName: 'test',
        svcName: 'test-service',
        baseUrl: 'http://localhost:5173',
        config: { concurrency: 1, iterations: 6, scenarioWeights: [], executionMode: 'sequential' },
        summary: {
          tps: 10, avgResponseTime: 50, minResponseTime: 20, maxResponseTime: 200,
          p95ResponseTime: 150, p99ResponseTime: 190, errorRate: 33.33,
          errorsByStatus: { '500': 2 }, totalRequests: 6, successfulRequests: 4,
          failedRequests: 2, failedValidations: 0, totalDurationMs: 600,
        },
        results: [
          {
            id: 'r1', scenarioId: 'test-1', scenarioName: 'GET Health',
            featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200,
            responseTimeMs: 20, responseBody: '{"ok":true}', timestamp: now,
            passed: true, validationMode: 'none', failureDetails: [],
          },
          {
            id: 'r2', scenarioId: 'test-1', scenarioName: 'GET Health',
            featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200,
            responseTimeMs: 30, responseBody: '{"ok":true}', timestamp: now,
            passed: true, validationMode: 'none', failureDetails: [],
          },
          {
            id: 'r3', scenarioId: 'test-1', scenarioName: 'GET Health',
            featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 500,
            responseTimeMs: 100, responseBody: 'Internal Server Error', timestamp: now,
            passed: false, errorMessage: 'HTTP 500', validationMode: 'none', failureDetails: [],
          },
          {
            id: 'r4', scenarioId: 'test-1', scenarioName: 'GET Health',
            featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200,
            responseTimeMs: 40, responseBody: '{"ok":true}', timestamp: now,
            passed: true, validationMode: 'none', failureDetails: [],
          },
          {
            id: 'r5', scenarioId: 'test-1', scenarioName: 'GET Health',
            featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 500,
            responseTimeMs: 200, responseBody: 'Internal Server Error', timestamp: now,
            passed: false, errorMessage: 'HTTP 500', validationMode: 'none', failureDetails: [],
          },
          {
            id: 'r6', scenarioId: 'test-1', scenarioName: 'GET Health',
            featureGroupName: 'E2E Feature', groupName: 'E2E Scenario',
            url: 'http://localhost:5173/', method: 'GET', httpStatus: 200,
            responseTimeMs: 50, responseBody: '{"ok":true}', timestamp: now,
            passed: true, validationMode: 'none', failureDetails: [],
          },
        ],
      };
      localStorage.setItem('perf-test-runs', JSON.stringify([testRun]));
      localStorage.setItem('perf-test-theme', 'dark');
    });
    await page.goto('/?tab=results');
    await page.waitForSelector('.app-header', { timeout: 25000 });
    await page.waitForLoadState('networkidle');

    // Navigate to Request Details tab where filter-count and group-by-controls live
    await page.getByRole('tab', { name: 'Request Details' }).click();
    const filterCount = page.locator('.filter-count').filter({ hasText: 'results' });
    await expect(filterCount).toBeVisible({ timeout: 5000 });
  });

  test('Failed Only filter hides passed results in grouped view', async ({ page }) => {
    // Use the specific filter-count in the results section (not the sidebar one)
    const filterCount = page.locator('.filter-count').filter({ hasText: 'results' });
    await expect(filterCount).toBeVisible({ timeout: 5000 });
    await expect(filterCount).toContainText('6 results');

    // All 6 detail rows visible initially
    const allDetailRows = page.locator('.group-detail-row');
    await expect(allDetailRows).toHaveCount(6);

    // Select "Failed Only" from the filter dropdown
    await selectCustomOption(page, page.locator('.filter-row > .cs-wrapper').first(), 'Failed Only');

    // Wait for filter to apply
    await expect(filterCount).toContainText('2 results');

    // Only failed detail rows should remain
    const detailRows = page.locator('.group-detail-row');
    await expect(detailRows).toHaveCount(2);

    // Every visible detail row must be a failed row
    for (let i = 0; i < 2; i++) {
      const row = detailRows.nth(i);
      await expect(row).toHaveClass(/row-failed/);
    }

    // No non-failed rows should be visible
    const passingRows = page.locator('.group-detail-row:not(.row-failed)');
    await expect(passingRows).toHaveCount(0);
  });

  test('Failed Only filter works when passed is non-boolean truthy', async ({ page }) => {
    // Wait for initial data to load and migrate
    const filterCount = page.locator('.filter-count').filter({ hasText: 'results' });
    await expect(filterCount).toBeVisible({ timeout: 5000 });

    // Corrupt IDB data: set passed=1 (truthy but not boolean true)
    // and remove localStorage to prevent re-migration
    await page.evaluate((dbVersion) => {
      return new Promise<void>((resolve, reject) => {
        const dbOpen = indexedDB.open('redfireforge', dbVersion);
        dbOpen.onsuccess = () => {
          const db = dbOpen.result;
          const tx = db.transaction('testRuns', 'readwrite');
          const store = tx.objectStore('testRuns');
          const getReq = store.get('run-filter-test');
          getReq.onsuccess = () => {
            const run = getReq.result;
            if (!run) { reject(new Error('run not found')); return; }
            for (const r of run.results) {
              if (r.passed === true) r.passed = 1;
            }
            store.put(run);
            tx.oncomplete = () => {
              localStorage.removeItem('perf-test-runs');
              resolve();
            };
          };
          getReq.onerror = () => reject(getReq.error);
        };
        dbOpen.onerror = () => reject(dbOpen.error);
      });
    }, REDFIREFORGE_IDB_VERSION);

    // Navigate without addInitScript re-seeding localStorage
    // Use page.reload() instead of page.goto() — addInitScript still fires,
    // but we need to clear perf-test-runs AFTER addInitScript runs
    await page.addInitScript(() => {
      localStorage.removeItem('perf-test-runs');
    });
    await page.goto('/?tab=results');
    await page.waitForSelector('.app-header', { timeout: 25000 });
    await page.waitForLoadState('networkidle');

    // Re-navigate to Request Details tab after page reload
    await page.getByRole('tab', { name: 'Request Details' }).click();
    await expect(filterCount).toBeVisible({ timeout: 5000 });

    // Verify we still have 6 results (all loaded from corrupted IDB)
    await expect(filterCount).toContainText('6 results');

    // Select "Failed Only"
    await selectCustomOption(page, page.locator('.filter-row > .cs-wrapper').first(), 'Failed Only');

    // BUG REPRODUCTION: with strict r.passed === true, passed=1 is treated
    // as "not passed", so ALL 6 results appear under "Failed Only".
    // CORRECT: should show only 2 (the ones with httpStatus=500)
    await expect(filterCount).toContainText('2 results');

    const detailRows = page.locator('.group-detail-row');
    await expect(detailRows).toHaveCount(2);
  });

  test('Flat view Failed Only filter also works', async ({ page }) => {
    const filterCount = page.locator('.filter-count').filter({ hasText: 'results' });
    await expect(filterCount).toBeVisible({ timeout: 5000 });

    // Switch to flat view
    await selectCustomOption(page, page.locator('.group-by-controls .cs-wrapper').first(), 'Test Name (flat)');

    // Select "Failed Only"
    await selectCustomOption(page, page.locator('.filter-row > .cs-wrapper').first(), 'Failed Only');

    // Should show 2 results
    await expect(filterCount).toContainText('2 results');

    // In flat view, table body should have exactly 2 rows
    const tableRows = page.locator('table tbody tr');
    await expect(tableRows).toHaveCount(2);

    for (let i = 0; i < 2; i++) {
      await expect(tableRows.nth(i)).toHaveClass(/row-failed/);
    }
  });
});
