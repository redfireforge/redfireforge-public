import { test, expect } from '@playwright/test';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { seedAppData } from './helpers';

const IMPORT_COLLECTION = {
  type: 'requests-collection',
  version: '1.0',
  exportedAt: '2026-09-15T00:00:00.000Z',
  data: {
    id: 'col-e2e-import',
    name: 'E2E Imported Collection',
    mode: 'direct',
    auth: { type: 'none' },
    requests: [
      {
        id: 'req-e2e-import',
        name: 'Imported ping',
        method: 'GET',
        url: 'https://example.com/e2e-import',
        headers: [],
        body: '',
        bodyType: 'none',
        bodyForm: [],
        auth: { type: 'inherit' },
      },
    ],
    folders: [],
  },
};

async function openRequestsStudio(page: import('@playwright/test').Page) {
  await seedAppData(page);
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-requests', JSON.stringify({
      collections: [
        {
          id: 'col-e2e-seed',
          name: 'E2E Seed Collection',
          mode: 'direct',
          auth: { type: 'none' },
          requests: [
            {
              id: 'req-e2e-seed',
              name: 'Seed ping',
              method: 'GET',
              url: 'https://example.com/e2e-seed',
              headers: [{ key: '', value: '' }],
              body: '',
              bodyType: 'none',
              bodyForm: [{ key: '', value: '' }],
              auth: { type: 'inherit' },
            },
          ],
          folders: [],
        },
      ],
      selectedCollectionId: 'col-e2e-seed',
      selectedRequestId: 'req-e2e-seed',
    }));
  });
  await page.goto('/?tab=requests');
  await expect(page.locator('[data-testid="req-sidebar"]')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('[data-testid="req-sidebar"] .req-col-name', { hasText: 'E2E Seed Collection' })).toBeVisible({ timeout: 15_000 });
}

async function openSeedRequest(page: import('@playwright/test').Page) {
  const send = page.locator('[data-testid="req-send-btn"]');
  if (await send.isVisible().catch(() => false)) return;
  await page.locator('[data-testid="req-req-item"][data-req-name="Seed ping"]').click();
  await expect(send).toBeVisible({ timeout: 10_000 });
}

test.describe('Requests web import / export', () => {
  test('Export All downloads a named JSON file, not a blob UUID', async ({ page }) => {
    await openRequestsStudio(page);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="req-sidebar-export-all"]').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('requests-all-collections.json');
    const path = await download.path();
    expect(path).toBeTruthy();
    const raw = JSON.parse(readFileSync(path!, 'utf-8')) as { type?: string; data?: { collections?: unknown[] } };
    expect(raw.type).toBe('requests-all');
    expect(Array.isArray(raw.data?.collections)).toBe(true);
    expect(raw.data!.collections!.length).toBeGreaterThan(0);
  });

  test('sidebar Import file input loads a collection without a programmatic picker', async ({ page }) => {
    await openRequestsStudio(page);

    const tmpPath = `/tmp/requests-e2e-import-${Date.now()}.json`;
    writeFileSync(tmpPath, JSON.stringify(IMPORT_COLLECTION, null, 2));

    await page.locator('[data-testid="req-sidebar-import-input"]').setInputFiles(tmpPath);
    const sidebar = page.locator('[data-testid="req-sidebar"]');
    const importedCol = sidebar.locator('.req-col-name', { hasText: 'E2E Imported Collection' });
    await expect(importedCol).toBeVisible({ timeout: 10_000 });
    await importedCol.click();
    await expect(sidebar.locator('[data-testid="req-req-item"][data-req-name="Imported ping"]')).toBeVisible({ timeout: 10_000 });

    unlinkSync(tmpPath);
  });

  test('Send shows the response and returns the button to Send', async ({ page }) => {
    await page.route('**/__proxy', async (route) => {
      const target = (() => {
        try {
          return String((route.request().postDataJSON() as { url?: string } | null)?.url ?? '');
        } catch {
          return '';
        }
      })();
      if (target.includes('e2e-seed')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: true, from: 'e2e-send' }),
          }),
        });
        return;
      }
      await route.continue();
    });
    await openRequestsStudio(page);
    await openSeedRequest(page);
    const send = page.locator('[data-testid="req-send-btn"]');
    await expect(send).toHaveText('Send');
    await send.click();
    await expect(page.locator('[data-testid="req-status-pill"]')).toContainText('200', { timeout: 15_000 });
    await expect(send).toHaveText('Send');
    await expect(page.locator('.req-pane-right')).toContainText('e2e-send', { timeout: 10_000 });
  });

  test('editor Import / Export menu exports the open request with its name', async ({ page }) => {
    await openRequestsStudio(page);
    await openSeedRequest(page);
    await expect(page.locator('[data-testid="req-url-input"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="req-action-menu-btn"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="req-json-export-btn"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Seed ping.json');
  });
});
