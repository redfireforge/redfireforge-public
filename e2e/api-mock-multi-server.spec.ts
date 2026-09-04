/**
 * Product E2E — API Mock Studio multi-server scenario (plan §12.2 / demo-doc §5.4).
 *
 * Run:
 *   npm run test:e2e:api-mock-multi-server
 *
 * Prereq: companion :3001 (Playwright webServer) + demo hub bridges (default `npm run dev`).
 */

import { test, expect, type Page } from '@playwright/test';
import { API_MOCK } from '../src/shared/selectors/apiMock';
import { installApiMockDesktopShim } from './demo-player-helpers';
import { silenceLogStream } from './grpc-helpers';
import {
  CONFLICT_NAME,
  MULTI_SERVER_TIMEOUT,
  PAYMENTS_BODY,
  PAYMENTS_NAME,
  PAYMENTS_PATH,
  PAYMENTS_PORT,
  USERS_BODY,
  USERS_BODY_V2,
  USERS_NAME,
  USERS_PATH,
  USERS_PORT,
  applyActiveServer,
  createConfiguredServer,
  expectJournalMatch,
  expectTabStatus,
  fetchMock,
  isApiMockCompanionReady,
  openApiMockStudio,
  readGeneration,
  selectServerTab,
  sendFromRequestsStudio,
  serverTab,
  startActiveServer,
  stopActiveServer,
  stopAllCompanionListeners,
  switchToApiMockStudio,
  wipeApiMockWorkspace,
} from './api-mock-multi-server-helpers';

test.describe.configure({ mode: 'serial', retries: 0 });

test.beforeEach(async ({ page }) => {
  await silenceLogStream(page);
  await installApiMockDesktopShim(page);
});

async function setUsersBodyV2(page: Page): Promise<void> {
  await selectServerTab(page, USERS_NAME);
  await page.locator(API_MOCK.VIEW_STUDIO).click();
  await expect(page.locator(API_MOCK.ROUTE_EXPLORER)).toBeVisible({ timeout: 10_000 });
  await page.locator(API_MOCK.FIRST_ROUTE).click();
  await page.locator(API_MOCK.BTAB_RESPONSE).click();
  await expect(page.locator(API_MOCK.VARIANT_BODY)).toBeVisible({ timeout: 10_000 });
  const ok = await page.evaluate((body) => {
    const fn = (window as unknown as {
      __demoPatchApiMockActiveRoute?: (patch: { body?: string }) => boolean;
    }).__demoPatchApiMockActiveRoute;
    return fn ? fn({ body }) : false;
  }, USERS_BODY_V2);
  expect(ok).toBe(true);
  await expect(page.locator(API_MOCK.DIRTY_BADGE)).toBeVisible({ timeout: 10_000 });
}

test('API Mock multi-server lifecycle (§12.2)', async ({ page, request }) => {
  const ready = await isApiMockCompanionReady(request);
  test.skip(!ready, 'Express companion (:3001) not running');

  test.setTimeout(MULTI_SERVER_TIMEOUT);

  await stopAllCompanionListeners(request);
  await openApiMockStudio(page);
  await wipeApiMockWorkspace(page, request);

  await createConfiguredServer(page, {
    name: USERS_NAME,
    port: USERS_PORT,
    path: USERS_PATH,
    body: USERS_BODY,
  });
  await createConfiguredServer(page, {
    name: PAYMENTS_NAME,
    port: PAYMENTS_PORT,
    path: PAYMENTS_PATH,
    body: PAYMENTS_BODY,
  });

  await selectServerTab(page, USERS_NAME);
  await startActiveServer(page);
  await expectTabStatus(page, USERS_NAME, 'running');

  await selectServerTab(page, PAYMENTS_NAME);
  await startActiveServer(page);
  await expectTabStatus(page, PAYMENTS_NAME, 'running');

  await sendFromRequestsStudio(
    page,
    `http://localhost:${USERS_PORT}${USERS_PATH}`,
    'users',
    request,
  );
  await sendFromRequestsStudio(
    page,
    `http://localhost:${PAYMENTS_PORT}${PAYMENTS_PATH}`,
    'payments',
    request,
  );

  await switchToApiMockStudio(page);
  await selectServerTab(page, USERS_NAME);
  await expectTabStatus(page, USERS_NAME, 'running');
  const usersHit = await fetchMock(request, USERS_PORT, USERS_PATH);
  expect(usersHit.status).toBe(200);
  expect(usersHit.body).toContain('users');
  await expectJournalMatch(page);

  await selectServerTab(page, PAYMENTS_NAME);
  await expectTabStatus(page, PAYMENTS_NAME, 'running');
  const paymentsHit = await fetchMock(request, PAYMENTS_PORT, PAYMENTS_PATH);
  expect(paymentsHit.status).toBe(200);
  expect(paymentsHit.body).toContain('payments');
  await expectJournalMatch(page);

  const paymentsGenBefore = await readGeneration(page);

  await selectServerTab(page, USERS_NAME);
  const usersGenBefore = await readGeneration(page);
  await setUsersBodyV2(page);
  await applyActiveServer(page);
  const usersGenAfter = await readGeneration(page);
  expect(usersGenAfter).toBeGreaterThan(usersGenBefore);

  const usersV2 = await fetchMock(request, USERS_PORT, USERS_PATH);
  expect(usersV2.body).toContain('"v":2');

  await selectServerTab(page, PAYMENTS_NAME);
  expect(await readGeneration(page)).toBe(paymentsGenBefore);
  const paymentsStill = await fetchMock(request, PAYMENTS_PORT, PAYMENTS_PATH);
  expect(paymentsStill.body).toContain('payments');
  expect(paymentsStill.body).not.toContain('"v":2');

  await createConfiguredServer(page, {
    name: CONFLICT_NAME,
    port: USERS_PORT + 2,
    path: '/conflict',
    body: '{"conflict":true}',
  });
  await page.locator(API_MOCK.SETTINGS).click();
  await expect(page.locator(API_MOCK.SETTINGS_MODAL)).toBeVisible({ timeout: 10_000 });
  await page.locator(API_MOCK.SETTINGS_PORT).fill(String(USERS_PORT));
  await expect(page.locator(API_MOCK.SETTINGS_PORT_TAKEN)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(API_MOCK.SETTINGS_SAVE)).toBeDisabled();
  await page.locator(API_MOCK.SETTINGS_CANCEL).click();
  await expect(page.locator(API_MOCK.SETTINGS_MODAL)).toBeHidden({ timeout: 10_000 });

  const conflictTab = serverTab(page, CONFLICT_NAME);
  const serverId = await conflictTab.getAttribute('data-server-id');
  expect(serverId).toBeTruthy();
  await page.locator(`[data-testid="api-mock-tab-close-${serverId}"]`).click();
  const confirmBtn = page.locator(API_MOCK.CONFIRM_ACCEPT).first();
  if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await expect(page.locator('[data-testid^="api-mock-tab-"]').filter({ hasText: CONFLICT_NAME })).toHaveCount(0);

  // Closing parks the definition — it must still be reachable from the sidebar.
  const sidebarItem = page.locator(`[data-testid="api-mock-sidebar-item-${serverId}"]`);
  await expect(sidebarItem).toBeVisible({ timeout: 10_000 });
  await expect(sidebarItem).toHaveClass(/am-sidebar-item-parked/);

  await selectServerTab(page, USERS_NAME);
  await stopActiveServer(page);
  await expectTabStatus(page, USERS_NAME, 'stopped');
  await expectTabStatus(page, PAYMENTS_NAME, 'running');
  const paymentsAfterStop = await fetchMock(request, PAYMENTS_PORT, PAYMENTS_PATH);
  expect(paymentsAfterStop.status).toBe(200);

  // 9. Reload app → reconcile Payments running, Users stopped
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.locator(API_MOCK.STUDIO).or(page.locator(API_MOCK.EMPTY)),
  ).toBeVisible({ timeout: 30_000 });
  await expectTabStatus(page, PAYMENTS_NAME, 'running');
  await expectTabStatus(page, USERS_NAME, 'stopped');
  const paymentsAfterReload = await fetchMock(request, PAYMENTS_PORT, PAYMENTS_PATH);
  expect(paymentsAfterReload.status).toBe(200);
  expect(paymentsAfterReload.body).toContain('payments');

  await wipeApiMockWorkspace(page, request);
});
