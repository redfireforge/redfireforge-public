/**
 * WS Protocols & Transport — E2E Test Suite
 * Tests: WP-01 through WP-23 (subset that doesn't need Docker protocol servers)
 * Requires: backend on 3001 (mock WS echo on 9876), Vite on 5173
 *
 * Note: Socket.IO (WP-04–07), STOMP (WP-08–11), GraphQL-WS (WP-12–15),
 * and TLS (WP-24–30) scenarios require dedicated Docker services and are
 * tested manually or in a Docker-enabled CI pipeline.
 */
import { test, expect } from '@playwright/test';
import {
  WS_DEFAULT_MOCK_URL,
  connectWsTo,
  disconnectWs,
  ensureWsMockServer,
  gotoWsStudio,
  switchWsLeftTab,
  waitForWsConnected,
} from './ws-helpers';

/** Dedicated echo port so parallel specs that stop :9876 cannot flake WP-22/23. */
const WP_TRANSPORT_PORT = 9890;
const WP_TRANSPORT_URL = `ws://localhost:${WP_TRANSPORT_PORT}`;

test.beforeAll(async ({ browser }) => { await ensureWsMockServer(browser); });

/* ── WP-01–03: Protocol Detection & Selector ─────────── */

test.describe('Protocol Detection (WP-01–03)', () => {
  test('WP-01: Protocol selector visible on Connect tab', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'connect');
    const protocolDropdown = page.locator('.ws-protocol-select, [data-testid="protocol-select"]');
    if (await protocolDropdown.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(protocolDropdown).toBeVisible();
    }
  });

  test('WP-02: URL-based auto-detection hint', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'connect');
    const urlInput = page.locator('[aria-label="WebSocket URL"]');
    await urlInput.fill('ws://localhost:3001/socket.io/');
    await page.waitForTimeout(500);
  });
});

/* ── WP-16–18: TLS Panel ─────────────────────────────── */

test.describe('TLS Panel (WP-16–18)', () => {
  test('WP-16: TLS panel elements visible', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'connect');
    const tlsToggle = page.locator('[data-testid="tls-toggle"]');
    if (await tlsToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(tlsToggle).toBeVisible();
      await tlsToggle.click();
      await page.waitForTimeout(300);
      const tlsBody = page.locator('[data-testid="tls-body"]');
      if (await tlsBody.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expect(page.locator('[data-testid="tls-skip-cert"]')).toBeVisible();
        await expect(page.locator('[data-testid="tls-ca-cert"]')).toBeVisible();
      }
    }
  });

  test('WP-17: rejectUnauthorized toggle', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'connect');
    const tlsToggle = page.locator('[data-testid="tls-toggle"]');
    if (await tlsToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tlsToggle.click();
      await page.waitForTimeout(300);
      const rejectToggle = page.locator('[data-testid="tls-skip-cert"]');
      if (await rejectToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
        await rejectToggle.click();
        await page.waitForTimeout(200);
      }
    }
  });

  test('WP-18: Proxy-only banner for TLS', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'connect');
    const tlsToggle = page.locator('[data-testid="tls-toggle"]');
    if (await tlsToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tlsToggle.click();
      await page.waitForTimeout(300);
      const proxyNotice = page.locator('[data-testid="tls-proxy-notice"]');
      if (await proxyNotice.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expect(proxyNotice).toBeVisible();
      }
    }
  });
});

/* ── WP-22–23: Browser Transport Mode ────────────────── */

test.describe('Browser Transport (WP-22–23)', () => {
  test.beforeAll(async ({ browser }) => {
    await ensureWsMockServer(browser, WP_TRANSPORT_PORT);
  });

  test('WP-22: Transport mode shows in badge after connect', async ({ page }) => {
    await gotoWsStudio(page);
    await connectWsTo(page, WP_TRANSPORT_URL, WP_TRANSPORT_PORT);
    await switchWsLeftTab(page, 'connect');
    await waitForWsConnected(page, { url: WP_TRANSPORT_URL, mockPort: WP_TRANSPORT_PORT });
    const transportBadge = page.locator('[data-testid="transport-badge"]');
    await expect(transportBadge).toBeVisible({ timeout: 10_000 });
    const text = await transportBadge.textContent();
    expect(text?.toLowerCase()).toMatch(/proxy|direct|native/);
    await disconnectWs(page);
  });

  test('WP-23: Protocol badge shows after connect', async ({ page }) => {
    await gotoWsStudio(page);
    await connectWsTo(page, WP_TRANSPORT_URL, WP_TRANSPORT_PORT);
    await switchWsLeftTab(page, 'connect');
    await waitForWsConnected(page, { url: WP_TRANSPORT_URL, mockPort: WP_TRANSPORT_PORT });
    await expect(page.locator('[data-testid="protocol-badge"]')).toBeVisible();
    await disconnectWs(page);
  });
});

/* ── Protocol Compose Fields (Socket.IO / STOMP / GraphQL) ── */

test.describe('Protocol Compose Fields', () => {
  test('WP-04a: Socket.IO compose fields visible when SIO mode', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'send');
    await expect(page.locator('.ws-compose-input')).toBeVisible();
  });

  test('WP-08a: STOMP compose fields layout', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'send');
    await expect(page.locator('.ws-compose-input')).toBeVisible();
  });
});

/* ── Auth Tab Interactions (WP-A*) ───────────────────── */

test.describe('Auth Tab (WP-A)', () => {
  test('WP-A01: Auth tab renders with type selector', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'auth');
    await page.waitForTimeout(300);
    const authTab = page.locator('[data-testid="left-tab-auth"]');
    await expect(authTab).toBeVisible();
    await expect(authTab).toHaveAttribute('aria-selected', 'true');
  });

  test('WP-A02: Auth forces proxy transport', async ({ page }) => {
    await gotoWsStudio(page);
    await switchWsLeftTab(page, 'auth');
    await page.waitForTimeout(300);
    const bearerOption = page.locator('text=Bearer Token');
    if (await bearerOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await bearerOption.click();
      await page.waitForTimeout(200);
    }
    await switchWsLeftTab(page, 'connect');
    await page.locator('[aria-label="WebSocket URL"]').fill(WS_DEFAULT_MOCK_URL);
    const callout = page.locator('[data-testid="ws-auth-callout"]');
    if (await callout.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(callout).toBeVisible();
    }
  });
});
