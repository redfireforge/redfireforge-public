import { expect, type Page } from '@playwright/test';
import type { Workflow, WorkflowFolder } from '../src/features/workflow/types/workflow';

import { DB_VERSION } from '../src/shared/utils/idbOpen';

/** Re-exported from app IDB module — single source of truth for E2E seeding */
export const REDFIREFORGE_IDB_VERSION = DB_VERSION;

async function safeReload(page: Page): Promise<void> {
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    return;
  } catch {
    await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
  }
}

export async function waitForAppShell(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
}

/** Expand the app unified sidebar when collapsed (▶ → ◀). */
export async function ensureAppSidebarExpanded(page: Page): Promise<void> {
  const toggle = page.locator('.usb-toggle-btn').first();
  if (!(await toggle.isVisible().catch(() => false))) {
    return;
  }
  const label = (await toggle.textContent()) ?? '';
  if (label.includes('▶')) {
    await toggle.click();
    await expect(page.locator('.unified-sidebar')).toBeVisible({ timeout: 10_000 });
  }
}

/** Visible WebSocket URL field — avoids strict-mode violations with multi-tab studio. */
export function visibleWsUrlInput(page: Page) {
  return page.locator('[aria-label="WebSocket URL"]').filter({ visible: true });
}

export async function waitForWorkflowReady(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const visible = await page.locator('.wf-designer').isVisible({ timeout: 15000 }).catch(() => false);
    if (visible) {
      return;
    }

    if (attempt === 0) {
      await page.goto('/?tab=workflow', { waitUntil: 'domcontentloaded' });
    }
  }

  await expect(page.locator('.wf-designer')).toBeVisible({ timeout: 20000 });
}

export async function openWorkflowBlocksTab(page: Page): Promise<void> {
  await expect(page.locator('.wf-palette')).toBeVisible({ timeout: 5000 });
  const blocksTab = page.getByTestId('wf-palette-tab-blocks');
  await blocksTab.click();
  await expect(page.locator('.wf-palette-block').first()).toBeVisible({ timeout: 5000 });
}

export async function gotoAppTab(page: Page, tab: string): Promise<void> {
  await page.goto(`/?tab=${tab}`, { waitUntil: 'domcontentloaded' });
  if (tab === 'workflow') {
    await waitForWorkflowReady(page);
    return;
  }
  await waitForAppShell(page);
}

export async function reloadAppTab(page: Page, tab?: string): Promise<void> {
  if (tab) {
    await page.goto(`/?tab=${tab}`, { waitUntil: 'domcontentloaded' });
  } else {
    await safeReload(page);
  }
  if (tab === 'workflow') {
    await waitForWorkflowReady(page);
    return;
  }
  await waitForAppShell(page);
}

/**
 * Seeds localStorage with flat v3 data so the app starts with an
 * environment and microservice already selected — prerequisite for most tests.
 * Also dismisses onboarding hints to prevent tooltip interference with tests.
 */
export async function seedAppData(page: Page) {
  // Silence the SSE log-stream endpoint — the backend is not running in E2E tests.
  // Without this mock, all 4 parallel workers fire concurrent ECONNREFUSED errors
  // through the vite proxy, which under high load can crash a worker's browser context.
  await page.route('**/api/logs/stream*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: '',
    }),
  );

  await page.addInitScript(() => {
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
    // Dismiss all onboarding hints to prevent tooltip interference with E2E tests
    localStorage.setItem('redfire-onboarding-dismissed', JSON.stringify([
      'palette-drag', 'command-palette', 'node-config', 'connect-nodes', 'quick-test',
    ]));
    // Promo banner takes vertical chrome and shifts viewport-sensitive assertions
    localStorage.setItem('cloud-waitlist-dismissed', 'true');
  });
}

/**
 * Seeds flat v3 data with a Feature Group, Scenario, and one Test already present.
 * Also dismisses onboarding hints to prevent tooltip interference with tests.
 */
export async function seedAppDataWithTest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'http://localhost:5173' },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
      id: 'fg-1',
      name: 'E2E Feature',
      microserviceId: 'svc-1',
      environmentId: 'env-1',
      scenarios: [{
        id: 'sc-1',
        name: 'E2E Scenario',
        tests: [{
          id: 'test-1',
          name: 'GET Homepage',
          url: 'http://localhost:5173/',
          method: 'GET',
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { mode: 'none' },
        }],
      }],
    }]));
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
    // Dismiss all onboarding hints to prevent tooltip interference with E2E tests
    localStorage.setItem('redfire-onboarding-dismissed', JSON.stringify([
      'palette-drag', 'command-palette', 'node-config', 'connect-nodes', 'quick-test',
    ]));
    localStorage.setItem('cloud-waitlist-dismissed', 'true');
  });
}

/** Confirm save destination in FolderPickerModal (opened by "Use as Template" gallery flow). */
export async function confirmFolderPickerModal(page: Page, opts?: { timeout?: number }) {
  const timeout = opts?.timeout ?? 5000;
  await page.locator('.fp-dialog').waitFor({ state: 'visible', timeout });
  await page.locator('.fp-dialog .btn-primary').click();
  await page.waitForTimeout(500);
}

/** Navigate Harness → Results sub-tab (without opening Results Explorer). */
export async function navigateToHarnessResults(page: Page, waitMs = 0): Promise<void> {
  const harnessBtn = page.locator('button[title="Harness"]');
  await expect(harnessBtn).toBeVisible({ timeout: 10000 });
  await harnessBtn.click();

  const resultsTab = page.locator('button.sub-nav-tab:has-text("Results")');
  await expect(resultsTab).toBeVisible({ timeout: 5000 });
  await resultsTab.click();

  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
}

export type OpenResultsExplorerOptions = {
  /** Retry Harness click if Results sub-nav didn't appear */
  retryHarness?: boolean;
  /** Milliseconds to wait after clicking Results tab and Explorer button */
  waitAfterNavMs?: number;
};

/** Navigate Harness → Results → Results Explorer. */
export async function openResultsExplorer(page: Page, options?: OpenResultsExplorerOptions): Promise<void> {
  const harnessBtn = page.locator('button[title="Harness"]');
  await expect(harnessBtn).toBeVisible({ timeout: 10000 });
  await harnessBtn.click();

  const resultsTab = page.locator('button.sub-nav-tab:has-text("Results")');
  if (options?.retryHarness && !await resultsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await harnessBtn.click();
  }
  const resultsTimeout = options?.retryHarness ? 8000 : 5000;
  await expect(resultsTab).toBeVisible({ timeout: resultsTimeout });
  await resultsTab.click();

  if (options?.waitAfterNavMs) {
    await page.waitForTimeout(options.waitAfterNavMs);
  }

  const explorerBtn = page.locator('button:has-text("Results Explorer")');
  const explorerTimeout = options?.retryHarness ? 10000 : 8000;
  await expect(explorerBtn.first()).toBeVisible({ timeout: explorerTimeout });
  await explorerBtn.first().click();

  if (options?.waitAfterNavMs) {
    await page.waitForTimeout(options.waitAfterNavMs);
  }
}

/** Click Fit view when the canvas control is visible. */
export async function clickFitViewIfVisible(page: Page, timeout = 3000): Promise<void> {
  const fitBtn = page.locator('button[title="Fit view"]').first();
  if (await fitBtn.isVisible({ timeout }).catch(() => false)) {
    await fitBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Seed a workflow in localStorage, seed a test run in IndexedDB, and reload
 * so the app picks up both.
 */
export async function seedWorkflowAndTestRun(
  page: Page,
  workflow: unknown,
  testRun: unknown,
): Promise<void> {
  await page.addInitScript((wfs) => {
    localStorage.setItem('workflows', JSON.stringify(wfs));
  }, [workflow]);

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('domcontentloaded');

  const seeded = await seedTestRunsViaIDB(page, [testRun]);
  expect(seeded).toBe('ok');

  await reloadAppTab(page);
}

/**
 * Seeds test runs into IndexedDB via page.evaluate so E2E tests can
 * start with pre-populated results data. Creates all required object
 * stores if they don't already exist (matching src/shared/utils/idbOpen.ts).
 */
export function makeWorkflowForE2E(
  id: string,
  name: string,
  folderId?: string,
  folderOrder?: number,
): Workflow {
  const ts = Date.now();
  return {
    id,
    name,
    schemaVersion: 5,
    createdAt: ts,
    updatedAt: ts,
    variables: {},
    nodes: [
      { id: 'n1', type: 'http', position: { x: 100, y: 100 }, data: { label: 'Step' } },
    ],
    edges: [],
    folderId,
    folderOrder,
  } as Workflow;
}

export function makeFolderForE2E(
  id: string,
  name: string,
  parentId?: string,
): WorkflowFolder {
  return { id, name, parentId, order: 0 };
}

export async function seedTestRunsViaIDB(page: Page, runs: unknown[]): Promise<string> {
  return await page.evaluate(({ testRuns, dbVersion }) => {
    return new Promise<string>((resolve) => {
      const req = indexedDB.open('redfireforge', dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('testRuns')) {
          const store = db.createObjectStore('testRuns', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('featureGroups')) db.createObjectStore('featureGroups');
        if (!db.objectStoreNames.contains('sharedDataSources')) db.createObjectStore('sharedDataSources');
        if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash');
        if (!db.objectStoreNames.contains('workflows')) db.createObjectStore('workflows');
        if (!db.objectStoreNames.contains('workflowFolders')) db.createObjectStore('workflowFolders');
        if (!db.objectStoreNames.contains('requests')) db.createObjectStore('requests');
        if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog');
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
        if (!db.objectStoreNames.contains('graphql-history')) {
          const hs = db.createObjectStore('graphql-history', { keyPath: 'id' });
          hs.createIndex('connectionId', 'connectionId', { unique: false });
          hs.createIndex('timestamp', 'timestamp', { unique: false });
          hs.createIndex('connectionId_timestamp', ['connectionId', 'timestamp'], { unique: false });
        }
        if (!db.objectStoreNames.contains('graphql-collections')) {
          const cs = db.createObjectStore('graphql-collections', { keyPath: 'id' });
          cs.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('graphql-collection-folders')) {
          const fs = db.createObjectStore('graphql-collection-folders', { keyPath: 'id' });
          fs.createIndex('collectionId', 'collectionId', { unique: false });
          fs.createIndex('parentId', 'parentId', { unique: false });
          fs.createIndex('collectionId_sortOrder', ['collectionId', 'sortOrder'], { unique: false });
        }
        if (!db.objectStoreNames.contains('graphql-collection-items')) {
          const is = db.createObjectStore('graphql-collection-items', { keyPath: 'id' });
          is.createIndex('collectionId', 'collectionId', { unique: false });
          is.createIndex('folderId', 'folderId', { unique: false });
          is.createIndex('collectionId_sortOrder', ['collectionId', 'sortOrder'], { unique: false });
        }
        if (!db.objectStoreNames.contains('graphql-schema-snapshots')) {
          const ss = db.createObjectStore('graphql-schema-snapshots', { keyPath: 'id' });
          ss.createIndex('connectionId', 'connectionId', { unique: false });
          ss.createIndex('capturedAt', 'capturedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('graphql-diff-acknowledgements')) {
          const as = db.createObjectStore('graphql-diff-acknowledgements', { keyPath: 'id' });
          as.createIndex('connectionId', 'connectionId', { unique: false });
          as.createIndex('snapshotId', 'snapshotId', { unique: false });
        }
        if (!db.objectStoreNames.contains('environments')) db.createObjectStore('environments');
        if (!db.objectStoreNames.contains('microservices')) db.createObjectStore('microservices');
        if (!db.objectStoreNames.contains('globalAuthProfiles')) db.createObjectStore('globalAuthProfiles');
        if (!db.objectStoreNames.contains('gqlStudioTabs')) db.createObjectStore('gqlStudioTabs');
        if (!db.objectStoreNames.contains('gqlStudioEnvironments')) db.createObjectStore('gqlStudioEnvironments');
        if (!db.objectStoreNames.contains('gqlConnectionProfiles')) db.createObjectStore('gqlConnectionProfiles');
        if (!db.objectStoreNames.contains('gqlPageAuth')) db.createObjectStore('gqlPageAuth');
        if (!db.objectStoreNames.contains('gqlSchemaCache')) db.createObjectStore('gqlSchemaCache');
        if (!db.objectStoreNames.contains('runnerConfigs')) db.createObjectStore('runnerConfigs');
        if (!db.objectStoreNames.contains('grpc-collections')) {
          const grpcColStore = db.createObjectStore('grpc-collections', { keyPath: 'id' });
          grpcColStore.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('grpc-collection-items')) {
          const grpcItemStore = db.createObjectStore('grpc-collection-items', { keyPath: 'id' });
          grpcItemStore.createIndex('collectionId', 'collectionId', { unique: false });
          grpcItemStore.createIndex('collectionId_sortOrder', ['collectionId', 'sortOrder'], { unique: false });
        }
        if (!db.objectStoreNames.contains('grpc-call-history')) {
          const grpcHistStore = db.createObjectStore('grpc-call-history', { keyPath: 'id' });
          grpcHistStore.createIndex('capturedAt', 'capturedAt', { unique: false });
          grpcHistStore.createIndex('service', 'service', { unique: false });
          grpcHistStore.createIndex('method', 'method', { unique: false });
          grpcHistStore.createIndex('grpcStatus', 'grpcStatus', { unique: false });
        }
        if (!db.objectStoreNames.contains('grpc-load-test-profiles')) {
          const profileStore = db.createObjectStore('grpc-load-test-profiles', { keyPath: 'id' });
          profileStore.createIndex('name', 'name', { unique: false });
          profileStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('grpc-schema-diff-acks')) {
          const ackStore = db.createObjectStore('grpc-schema-diff-acks', { keyPath: 'id' });
          ackStore.createIndex('baselineDescriptorKey', 'baselineDescriptorKey', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('testRuns', 'readwrite');
        const store = tx.objectStore('testRuns');
        for (const run of testRuns) store.put(run);
        tx.oncomplete = () => resolve('ok');
      };
      req.onerror = () => resolve('idb-error');
    });
  }, { testRuns: runs, dbVersion: REDFIREFORGE_IDB_VERSION });
}

/**
 * Reliably delete the redfireforge IndexedDB.
 *
 * Strategy: open the DB at a very high version (9999) to force a `versionchange`
 * event on every existing connection. The app's `onversionchange` handler
 * (in idbOpen.ts) responds by calling `db.close()`, which unblocks any pending
 * `deleteDatabase`. Once our high-version open succeeds we close it and issue
 * the delete — by then no other connection is open, so `onsuccess` fires
 * immediately.
 *
 * We deliberately do NOT resolve inside `onblocked`. The IDB spec guarantees
 * that `del.onsuccess` fires once all connections handle `versionchange` and
 * close. Resolving early (before onsuccess) is the classic flakiness bug:
 * the promise resolves before the database is actually gone.
 */
export async function clearRedfireIDB(page: Page): Promise<void> {
  await page.evaluate(() =>
    new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      // Safety: give up after 5 s so a hung IDB never freezes the test suite.
      const safeguard = setTimeout(done, 5000);

      // Open at a high version to trigger `versionchange` on the app's existing
      // connection, forcing it to close (app's onversionchange: db.close()).
      const bump = indexedDB.open('redfireforge', 9999);

      bump.onupgradeneeded = () => { /* intentional no-op */ };

      bump.onsuccess = () => {
        bump.result.close();
        const del = indexedDB.deleteDatabase('redfireforge');
        del.onsuccess = () => { clearTimeout(safeguard); done(); };
        del.onerror   = () => { clearTimeout(safeguard); done(); };
        // onblocked: intentionally empty.
        // The IDB spec guarantees del.onsuccess fires once all connections
        // handle versionchange and close — no manual retry needed.
      };

      // bump itself blocked: an existing open() is racing us; wait for it to settle.
      bump.onblocked = () => {
        // onsuccess will still fire once the blocker clears; nothing to do here.
      };

      bump.onerror = () => {
        // Couldn't bump the version — just try a direct delete as fallback.
        clearTimeout(safeguard);
        const del = indexedDB.deleteDatabase('redfireforge');        del.onsuccess = done;
        del.onerror   = done;
        // Again, do not resolve in onblocked; wait for onsuccess.
        const fallbackSafeguard = setTimeout(done, 3000);
        del.onsuccess = () => { clearTimeout(fallbackSafeguard); done(); };
        del.onerror   = () => { clearTimeout(fallbackSafeguard); done(); };
      };
    }),
  );
}

/**
 * Seeds workflow data into localStorage so the app loads with a workflow ready.
 *
 * The app migrates localStorage → IndexedDB on first load, so seeding via
 * localStorage works as long as it happens before navigation.
 *
 * @param page      Playwright page
 * @param workflows Array of workflow objects to store
 * @param selectedId ID of the workflow to pre-select (defaults to workflows[0].id)
 */
export async function seedWorkflowsInLocalStorage(
  page: Page,
  workflows: unknown[],
  selectedId?: string,
): Promise<void> {
  await page.addInitScript(
    ({ workflowJson, id }: { workflowJson: string; id: string }) => {
      localStorage.setItem('workflows', workflowJson);
      localStorage.setItem('workflows_selected_id', id);
    },
    {
      workflowJson: JSON.stringify(workflows),
      id: selectedId ?? (workflows[0] as { id: string }).id,
    },
  );
}

/**
 * Reads a single value from the redfireforge IndexedDB.
 *
 * @param page      Playwright page
 * @param storeName IDB object store name (e.g. 'workflows', 'testRuns')
 * @param key       IDB key to look up
 * @returns         The stored value, or undefined if not found / error
 */
export async function readRedfireIDBStore<T = unknown>(
  page: Page,
  storeName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return page.evaluate(
    ({ store, k, version }) =>
      new Promise<T | undefined>((resolve) => {
        const req = indexedDB.open('redfireforge', version);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction(store, 'readonly');
            const getReq = tx.objectStore(store).get(k as IDBValidKey);
            getReq.onsuccess = () => { db.close(); resolve(getReq.result as T | undefined); };
            getReq.onerror  = () => { db.close(); resolve(undefined); };
          } catch {
            db.close();
            resolve(undefined);
          }
        };
        req.onerror = () => resolve(undefined);
      }),
    { store: storeName, k: key, version: REDFIREFORGE_IDB_VERSION },
  );
}

/**
 * Returns all workflow objects stored in the redfireforge IDB (key = 'all').
 * Convenience wrapper around readRedfireIDBStore for the common workflow case.
 */
export async function getPersistedWorkflowsFromIDB(page: Page): Promise<unknown[]> {
  const result = await readRedfireIDBStore<unknown[]>(page, 'workflows', 'all');
  return result ?? [];
}
