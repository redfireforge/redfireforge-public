import { test, expect } from '@playwright/test';
import { seedAppData } from './helpers';

test.describe('IDB loading', () => {
  test('app loads past Loading screen (clean IDB)', async ({ page }) => {
    await seedAppData(page);
    await page.goto('/');
    await page.waitForSelector('text=Loading...', { state: 'hidden', timeout: 10_000 });
    expect(await page.locator('text=Loading...').count()).toBe(0);
  });

  test('app loads with feature groups in localStorage (IDB migration)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'http://localhost:5173' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([
        { id: 'fg-1', name: 'Test FG', scenarios: [{ id: 'sc-1', name: 'Scenario 1', tests: [] }] },
      ]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });
    await page.goto('/');
    await page.waitForSelector('text=Loading...', { state: 'hidden', timeout: 10_000 });
    expect(await page.locator('text=Loading...').count()).toBe(0);
  });

  test('app loads even when IDB is blocked (timeout fallback)', async ({ page }) => {
    test.slow(); // Waits for a single 10s IDB open timeout, then fast-fails subsequent opens
    // Sabotage IDB: intercept open() for 'redfireforge' so no events ever fire
    await page.addInitScript(() => {
      const origOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = function (name: string, version?: number): IDBOpenDBRequest {
        if (name === 'redfireforge') {
          const fake = Object.create(IDBOpenDBRequest.prototype);
          Object.defineProperties(fake, {
            result: { get: () => undefined },
            error: { get: () => null },
            readyState: { get: () => 'pending' as IDBRequestReadyState },
            onsuccess: { set: () => {}, get: () => null },
            onerror: { set: () => {}, get: () => null },
            onupgradeneeded: { set: () => {}, get: () => null },
            onblocked: { set: () => {}, get: () => null },
            addEventListener: { value: () => {} },
            removeEventListener: { value: () => {} },
            dispatchEvent: { value: () => false },
            transaction: { get: () => null },
          });
          return fake;
        }
        return origOpen(name, version);
      } as typeof indexedDB.open;
    });

    await seedAppData(page);
    await page.goto('/');
    // Measure only the post-load time (excludes network/bundle load time).
    // IDB open times out after 10s; subsequent opens fail fast and localStorage fallback loads.
    const start = Date.now();
    await page.waitForSelector('text=Loading...', { state: 'hidden', timeout: 20_000 });
    const elapsed = Date.now() - start;
    console.log(`Blocked IDB test: post-load loading-dismiss time ${elapsed}ms`);
    expect(await page.locator('text=Loading...').count()).toBe(0);
    expect(elapsed).toBeLessThan(18_000);
  });
});
