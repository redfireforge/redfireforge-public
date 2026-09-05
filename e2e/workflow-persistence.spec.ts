import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { gotoAppTab, REDFIREFORGE_IDB_VERSION, reloadAppTab, waitForWorkflowReady } from './helpers';

// Persistence assertions depend on ordered localStorage/IndexedDB transitions.
test.describe.configure({ mode: 'serial' });

/**
 * Registers two init scripts that run at the very start of EVERY page navigation:
 *
 * 1. One-shot cleanup (sessionStorage-gated):
 *    - Deletes the redfireforge IDB via fire-and-forget `deleteDatabase`.
 *      Because init scripts run before any app module code (Vite emits deferred
 *      `<script type="module">`), there are NO existing IDB connections at this
 *      point. The IDB engine queues the delete request first, so when the app's
 *      `openDB()` runs later it re-creates a fresh database. No `onblocked` race.
 *    - Clears localStorage and sessionStorage (except the guard flag itself).
 *
 * 2. Data seeding (always):
 *    - Seeds environments, microservices, request collections, and (on first load
 *      only, gated by a separate sessionStorage key) workflow data.
 *
 * By using init scripts instead of imperative `page.evaluate` calls after `goto`,
 * we guarantee the cleanup runs before the app can open any IDB connection, and
 * the seeding runs before any React hook fires — eliminating the entire class of
 * "app wrote empty state to IDB before seed data arrived" race conditions.
 */
async function setupPersistenceTest(page: Page, context: BrowserContext): Promise<void> {
  await context.clearCookies();

  // Init script 1: One-shot cleanup.
  // Uses `__e2e_pers_init__` in sessionStorage as a guard so it runs only on the
  // FIRST navigation (not on test-internal reloads that verify persistence).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__e2e_pers_init__')) return;

    // Mark before clearing so the flag survives even if something throws below.
    sessionStorage.setItem('__e2e_pers_init__', '1');

    // Clear storage.  sessionStorage.clear() would remove the flag we just set,
    // so only clear localStorage here.
    localStorage.clear();

    // Fire-and-forget IDB deletion.  No existing connections exist at init-script
    // time, so this enqueues a delete request that the IDB engine processes before
    // the app's first openDB() call (IDB requests on the same database are FIFO).
    indexedDB.deleteDatabase('redfireforge');
  });

  // Init script 2: Data seeding (runs on every navigation — idempotent).
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([
      { id: 'env-1', name: 'test' },
    ]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([
      {
        id: 'ms-persist', name: 'PersistAPI',
        baseUrls: { 'env-1': 'https://api.example.com' },
      },
    ]));
    localStorage.setItem('perf-test-v3-feature-groups', '[]');
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'ms-persist');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
    localStorage.setItem('redfire-onboarding-dismissed', JSON.stringify([
      'palette-drag', 'command-palette', 'node-config', 'connect-nodes', 'quick-test',
    ]));

    // Requests collection — always seed so it's present even after IDB migration
    // removes it from localStorage during the test.
    localStorage.setItem('perf-test-requests', JSON.stringify({
      collections: [
        {
          id: 'col-persist',
          name: 'PersistColl',
          microserviceId: 'ms-persist',
          requests: [
            { id: 'req-a', name: 'Get Users',   url: 'https://api.example.com/users', method: 'GET',  headers: [], body: '' },
            { id: 'req-b', name: 'Get Posts',   url: 'https://api.example.com/posts', method: 'GET',  headers: [], body: '' },
            { id: 'req-c', name: 'Create User', url: 'https://api.example.com/users', method: 'POST', headers: [], body: '{"name":"test"}', bodyType: 'json' },
          ],
          folders: [],
        },
      ],
    }));

    // Workflow — seed only on the first load per test session.
    // Use a sessionStorage flag (persists across reloads within the same tab,
    // but is cleared at the start of each test by the cleanup script above).
    if (!sessionStorage.getItem('__e2e_wf_seeded__')) {
      sessionStorage.setItem('__e2e_wf_seeded__', '1');
      const startNodeId = crypto.randomUUID();
      localStorage.setItem('workflows', JSON.stringify([
        {
          id: 'wf-persist',
          name: 'Persist WF',
          schemaVersion: 6,
          variables: {},
          hostProfiles: [],
          authProfiles: [],
          services: [],
          nodes: [{ id: startNodeId, type: 'start', position: { x: 250, y: 50 }, data: { label: 'Start', inputVariables: {} } }],
          edges: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]));
      localStorage.setItem('selectedWorkflowId', JSON.stringify('wf-persist'));
    }
  });
}

function getWorkflowFromStorage(page: Page) {
  return page.evaluate(async (dbVersion) => {
    // Try IndexedDB first (v5+), fall back to localStorage
    let raw: string | null = null;
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('redfireforge', dbVersion);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (db.objectStoreNames.contains('workflows')) {
        const idbVal = await new Promise<unknown>((_resolve) => {
          const t = db.transaction('workflows', 'readonly');
          const r = t.objectStore('workflows').get('all');
          r.onsuccess = () => _resolve(r.result ?? null);
          r.onerror = () => _resolve(null);
        });
        raw = idbVal ? JSON.stringify(idbVal) : null;
      }
      db.close();
    } catch { /* fallback */ }
    if (!raw) raw = localStorage.getItem('workflows');
    if (!raw) return null;
    const wfs = JSON.parse(raw);
    const wf = wfs.find((w: { id: string }) => w.id === 'wf-persist');
    if (!wf) return null;
    return {
      nodeCount: (wf.nodes as unknown[]).length,
      nodeTypes: (wf.nodes as { type: string }[]).map(n => n.type),
      nodeLabels: (wf.nodes as { data?: { label?: string } }[]).map(n => n.data?.label ?? '(no label)'),
      serviceCount: (wf.services as unknown[] ?? []).length,
    };
  }, REDFIREFORGE_IDB_VERSION);
}

test.describe('Workflow persistence across hard refresh', () => {
  test.describe.configure({ timeout: 120_000 });
  test('nodes added from BLOCKS palette persist after reload', async ({ page, context }) => {
    await setupPersistenceTest(page, context);
    // Single navigation — init scripts run, cleanup and seeding happen atomically
    // before any app code, so IDB is guaranteed clean.
    await gotoAppTab(page, 'workflow');

    // Wait for canvas to load
    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 10000 });

    // Navigate to Actions category to find HTTP block
    await page.locator('[data-testid="wf-palette-rail-actions"]').click();

    // Add 3 HTTP nodes from the blocks palette
    const httpBlock = page.locator('.wf-palette-block-http');
    for (let i = 0; i < 3; i++) {
      await httpBlock.click();
      await page.waitForTimeout(300);
    }

    // Should now have 4 nodes on canvas
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 5000 });

    // Wait for persistence to flush
    await page.waitForTimeout(1000);

    // Verify storage before reload
    const before = await getWorkflowFromStorage(page);
    expect(before?.nodeCount).toBe(4);

    // Hard refresh
    await reloadAppTab(page, 'workflow');
    await waitForWorkflowReady(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10000 });

    const after = await getWorkflowFromStorage(page);
    expect(after?.nodeCount).toBe(4);
  });

  test('nodes added from REQUESTS palette persist after reload', async ({ page, context }) => {
    await setupPersistenceTest(page, context);
    await gotoAppTab(page, 'workflow');

    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 10000 });

    // Switch to REQUESTS tab
    await page.locator('.wf-palette-tabs button:nth-child(2)').click();

    // Wait for the REQUESTS palette to load the seeded collections.
    // The initScript seeds 'perf-test-requests' which is migrated to IDB on first load;
    // use a generous timeout to allow async migration to complete before asserting.
    await expect(
      page.locator('.wf-palette-group-header:has-text("PersistColl")'),
    ).toBeVisible({ timeout: 15000 });

    // Expand PersistColl collection
    await page.locator('.wf-palette-group-header:has-text("PersistColl")').click();
    await page.waitForTimeout(300);

    // Click on each of the 3 requests to add them
    const requestItems = page.locator('button.wf-palette-item');
    await expect(requestItems).toHaveCount(3, { timeout: 5000 });

    for (let i = 0; i < 3; i++) {
      await requestItems.nth(i).click();
      await page.waitForTimeout(300);
    }

    // Should have 4 nodes (start + 3 requests)
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 5000 });

    // Verify storage
    const before = await getWorkflowFromStorage(page);
    expect(before?.nodeCount).toBe(4);

    // Hard refresh
    await reloadAppTab(page, 'workflow');
    await waitForWorkflowReady(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10000 });

    const after = await getWorkflowFromStorage(page);
    expect(after?.nodeCount).toBe(4);
  });

  test('rapidly added nodes from palette all persist', async ({ page, context }) => {
    await setupPersistenceTest(page, context);
    await gotoAppTab(page, 'workflow');

    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 10000 });

    // Navigate to Actions category for HTTP block
    await page.locator('[data-testid="wf-palette-rail-actions"]').click();

    // Rapidly add 5 HTTP nodes with minimal delay
    const httpBlock = page.locator('.wf-palette-block-http');
    for (let i = 0; i < 5; i++) {
      await httpBlock.click();
    }

    // Wait for all nodes to appear
    await expect(page.locator('.react-flow__node')).toHaveCount(6, { timeout: 10000 });

    // Small delay for persistence to flush
    await page.waitForTimeout(500);

    const before = await getWorkflowFromStorage(page);
    expect(before?.nodeCount).toBe(6);

    // Hard refresh
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(6, { timeout: 10000 });

    const after = await getWorkflowFromStorage(page);
    expect(after?.nodeCount).toBe(6);
  });
});
