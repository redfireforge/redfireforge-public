/**
 * WS Protocols — STOMP E2E Tests (WP-08 through WP-11)
 * Requires:
 *   - RabbitMQ Docker with web-stomp plugin on port 15674
 *     (docker compose -f docker/websocket/stomp/docker-compose.yml up -d)
 *   - Vite dev server on 5173
 *   - Backend on 3001
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWsStudio, listWsCustomSelectOptions, selectWsCustomSelect } from './ws-helpers';

const STOMP_URL = 'ws://localhost:15674/ws';
const RABBITMQ_HEALTH = 'http://localhost:15672/api/overview';

/* ── Ensure RabbitMQ Docker is running ───────────────── */

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({
    httpCredentials: { username: 'guest', password: 'guest' },
  });
  const page = await ctx.newPage();
  try {
    const resp = await page.request.get(RABBITMQ_HEALTH);
    expect(resp.ok(), 'RabbitMQ Docker must be running on port 15672').toBeTruthy();
  } catch (err) {
    throw new Error(
      `RabbitMQ Docker is not reachable at ${RABBITMQ_HEALTH}. ` +
      `Start it with: docker compose -f docker/websocket/stomp/docker-compose.yml up -d\n` +
      `Original error: ${err}`,
      { cause: err },
    );
  } finally {
    await ctx.close();
  }
});

/* ── Helpers ─────────────────────────────────────────── */

async function switchLeftTab(page: Page, tab: string) {
  await page.click(`[data-testid="left-tab-${tab}"]`);
  await page.waitForTimeout(200);
}

async function connectToStomp(page: Page) {
  await switchLeftTab(page, 'connect');
  await selectWsCustomSelect(page, 'protocol-select', { value: 'stomp', label: 'STOMP' });
  await page.waitForTimeout(200);

  const urlInput = page.locator('[aria-label="WebSocket URL"]');
  await urlInput.fill(STOMP_URL);
  await page.locator('[data-testid="connect-btn"]').click();

  // Wait for WebSocket connected state via conn-tab-bar (always visible)
  await page.locator('[data-testid="conn-tab-bar"] [aria-label*="connected"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
}

async function sendStompConnect(page: Page) {
  await switchLeftTab(page, 'send');

  // Wait for STOMP compose fields to appear
  await expect(page.locator('[data-testid="stomp-compose-fields"]')).toBeVisible({ timeout: 3000 });

  // Select CONNECT command
  await selectWsCustomSelect(page, 'stomp-command', { value: 'CONNECT', label: 'CONNECT' });
  await page.waitForTimeout(200);

  // Set host (vhost) to /
  await page.locator('[data-testid="stomp-destination"]').fill('/');

  // Send CONNECT frame
  await page.locator('[data-testid="send-btn"]').click();
  await page.waitForTimeout(1000); // Wait for CONNECTED response from RabbitMQ
}

async function disconnect(page: Page) {
  const disconnectBtn = page.locator('[data-testid="disconnect-btn"]');
  if (!(await disconnectBtn.isVisible({ timeout: 500 }).catch(() => false))) {
    await switchLeftTab(page, 'connect');
  }
  await disconnectBtn.click();
  await page.locator('[data-testid="conn-tab-bar"] [aria-label*="disconnected"]').waitFor({ timeout: 5000 });
}

/* ── STOMP Live Tests (WP-08–11) ─────────────────────── */

test.describe('STOMP Live (WP-08–11)', () => {
  test('WP-08: Connect to STOMP server and verify CONNECT/CONNECTED handshake', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToStomp(page);

    // Switch to Connect tab — verify protocol badge
    await switchLeftTab(page, 'connect');
    const protocolBadge = page.locator('[data-testid="protocol-badge"]');
    await expect(protocolBadge).toBeVisible();
    await expect(protocolBadge).toContainText('STOMP');

    // Status badge shows Connected
    await expect(page.locator('[data-testid="status-badge"]')).toHaveText('Connected');

    // Now send STOMP CONNECT frame manually
    await sendStompConnect(page);

    // Verify message log shows the STOMP CONNECT/CONNECTED exchange
    const allText = await page.locator('.ws-message-row').allTextContents();

    // Should have a sent CONNECT frame (↑)
    const connectSent = allText.some((t) => t.includes('CONNECT') && t.includes('↑'));
    expect(connectSent).toBe(true);

    // Should have a received CONNECTED frame (◆ = system packet, not ↓)
    // CONNECTED is marked isSystemPacket in buildStompMeta, so direction shows ◆
    const connectedReceived = allText.some((t) => t.includes('CONNECTED') && t.includes('◆'));
    expect(connectedReceived).toBe(true);

    // CONNECTED frame should show version info (e.g. "CONNECTED (v1.2)")
    const connectedText = allText.find((t) => t.includes('CONNECTED') && t.includes('v1'));
    expect(connectedText).toBeTruthy();

    await disconnect(page);
  });

  /* ── WP-09: SUBSCRIBE + SEND message round-trip ────── */

  test('WP-09: SUBSCRIBE and SEND message round-trip with echo', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToStomp(page);
    await sendStompConnect(page);

    // Count messages before SUBSCRIBE
    const rowsBefore = await page.locator('.ws-message-row').count();

    // Use unique queue name to avoid stale messages from prior test runs
    const queueName = `/queue/e2e-test-${Date.now()}`;

    // SUBSCRIBE to the unique queue
    await switchLeftTab(page, 'send');
    await selectWsCustomSelect(page, 'stomp-command', { value: 'SUBSCRIBE', label: 'SUBSCRIBE' });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="stomp-destination"]').fill(queueName);
    await page.locator('[data-testid="send-btn"]').click();
    await page.waitForTimeout(500);

    // Verify SUBSCRIBE frame was sent
    let allText = await page.locator('.ws-message-row').allTextContents();
    const subscribeSent = allText.some((t) => t.includes('SUBSCRIBE') && t.includes('↑'));
    expect(subscribeSent).toBe(true);

    // SEND a message to the same queue
    await selectWsCustomSelect(page, 'stomp-command', { value: 'SEND', label: 'SEND' });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="stomp-destination"]').fill(queueName);
    await page.locator('[aria-label="Message input"]').fill('Hello STOMP');
    await page.locator('[data-testid="send-btn"]').click();
    await page.waitForTimeout(1000); // Wait for message delivery

    // Verify SEND frame was sent
    allText = await page.locator('.ws-message-row').allTextContents();
    const sendSent = allText.some((t) => t.includes('SEND') && t.includes('↑'));
    expect(sendSent).toBe(true);

    // Verify MESSAGE frame was received (server delivers subscribed message)
    const messageReceived = allText.some((t) => t.includes('MESSAGE') && t.includes('↓'));
    expect(messageReceived).toBe(true);

    // Total rows should have grown
    const rowsAfter = await page.locator('.ws-message-row').count();
    expect(rowsAfter).toBeGreaterThan(rowsBefore);

    await disconnect(page);
  });

  /* ── WP-10: STOMP compose fields and command switching ─ */

  test('WP-10: STOMP compose fields layout and command switching', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToStomp(page);

    // Switch to Send tab
    await switchLeftTab(page, 'send');

    // STOMP compose fields should be visible
    await expect(page.locator('[data-testid="stomp-compose-fields"]')).toBeVisible({ timeout: 3000 });

    // Command select should be visible with default value SEND
    const commandSelect = page.locator('[data-testid="stomp-command"]');
    await expect(commandSelect).toBeVisible();
    await expect(commandSelect.locator('.cs-trigger')).toContainText('SEND');

    // Verify all expected command options exist (portaled CustomSelect menu)
    const optionValues = await listWsCustomSelectOptions(page, 'stomp-command');
    expect(optionValues).toEqual(expect.arrayContaining([
      'SEND', 'SUBSCRIBE', 'UNSUBSCRIBE', 'CONNECT', 'DISCONNECT', 'ACK', 'NACK',
    ]));

    // Destination input should be visible
    const destInput = page.locator('[data-testid="stomp-destination"]');
    await expect(destInput).toBeVisible();

    // Switch to CONNECT — placeholder should change to Host
    await selectWsCustomSelect(page, 'stomp-command', { value: 'CONNECT', label: 'CONNECT' });
    await page.waitForTimeout(200);
    const connectPlaceholder = await destInput.getAttribute('placeholder');
    expect(connectPlaceholder?.toLowerCase()).toContain('host');

    // Switch to UNSUBSCRIBE — placeholder should change to ID
    await selectWsCustomSelect(page, 'stomp-command', { value: 'UNSUBSCRIBE', label: 'UNSUBSCRIBE' });
    await page.waitForTimeout(200);
    const unsubPlaceholder = await destInput.getAttribute('placeholder');
    expect(unsubPlaceholder?.toLowerCase()).toContain('id');

    // Switch to SEND — placeholder should change to Destination
    await selectWsCustomSelect(page, 'stomp-command', { value: 'SEND', label: 'SEND' });
    await page.waitForTimeout(200);
    const sendPlaceholder = await destInput.getAttribute('placeholder');
    expect(sendPlaceholder?.toLowerCase()).toContain('destination');

    await disconnect(page);
  });

  /* ── WP-11: Clean STOMP disconnect ─────────────────── */

  test('WP-11: Clean STOMP disconnect', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToStomp(page);

    // Verify we're connected with STOMP protocol badge
    await switchLeftTab(page, 'connect');
    await expect(page.locator('[data-testid="protocol-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="protocol-badge"]')).toContainText('STOMP');

    // Disconnect
    await page.locator('[data-testid="disconnect-btn"]').click();

    // Tab bar should show disconnected
    await page.locator('[data-testid="conn-tab-bar"] [aria-label*="disconnected"]').waitFor({ timeout: 5000 });

    // Status badge shows Disconnected
    await expect(page.locator('[data-testid="status-badge"]')).toHaveText('Disconnected');

    // No connection error
    await expect(page.locator('[data-testid="connection-error"]')).not.toBeVisible();

    // Protocol badge should be hidden
    await expect(page.locator('[data-testid="protocol-badge"]')).not.toBeVisible();

    // Connect button enabled, disconnect button disabled
    await expect(page.locator('[data-testid="connect-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="connect-btn"]')).toBeEnabled();
    await expect(page.locator('[data-testid="disconnect-btn"]')).toBeDisabled();
  });
});
