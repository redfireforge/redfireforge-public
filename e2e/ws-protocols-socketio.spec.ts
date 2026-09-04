/**
 * WS Protocols — Socket.IO E2E Tests (WP-04 through WP-07)
 * Requires:
 *   - Socket.IO Docker echo server on port 3100
 *     (docker compose -f docker/websocket/socketio/docker-compose.yml up -d)
 *   - Vite dev server on 5173
 *   - Backend on 3001
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWsStudio, switchWsLeftTab, disconnectWs, selectWsCustomSelect } from './ws-helpers';

const SIO_URL = 'ws://localhost:3100/socket.io/?EIO=4&transport=websocket';
const SIO_HEALTH = 'http://localhost:3100/health';

/* ── Ensure Socket.IO Docker is running ──────────────── */

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const resp = await page.request.get(SIO_HEALTH);
    expect(resp.ok(), 'Socket.IO Docker must be running on port 3100').toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe('ok');
  } catch (err) {
    throw new Error(
      `Socket.IO Docker is not reachable at ${SIO_HEALTH}. ` +
      `Start it with: docker compose -f docker/websocket/socketio/docker-compose.yml up -d\n` +
      `Original error: ${err}`,
      { cause: err },
    );
  } finally {
    await ctx.close();
  }
});

/* ── Helpers ─────────────────────────────────────────── */

const switchLeftTab = (page: Page, tab: string) => switchWsLeftTab(page, tab);
const disconnect = (page: Page) => disconnectWs(page);

async function connectToSio(page: Page) {
  await switchLeftTab(page, 'connect');
  await selectWsCustomSelect(page, 'protocol-select', { value: 'socket-io', label: 'Socket.IO' });
  await page.waitForTimeout(200);

  const urlInput = page.locator('[aria-label="WebSocket URL"]');
  await urlInput.fill(SIO_URL);
  await page.locator('[data-testid="connect-btn"]').click();

  // Wait for connected state — use conn-tab-bar aria-label (always visible, matches existing E2E pattern)
  await page.locator('[data-testid="conn-tab-bar"] [aria-label*="connected"]').waitFor({ timeout: 10000 });

  // Give time for EIO handshake (open → 40 connect → 40{sid} connected)
  await page.waitForTimeout(500);
}


/* ── WP-04: Connect to Socket.IO server ──────────────── */

test.describe('Socket.IO Live (WP-04–07)', () => {
  test('WP-04: Connect to Socket.IO server and verify EIO handshake', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);

    // Switch to Connect tab to check protocol badge
    await switchLeftTab(page, 'connect');

    // Protocol badge shows Socket.IO
    const protocolBadge = page.locator('[data-testid="protocol-badge"]');
    await expect(protocolBadge).toBeVisible();
    await expect(protocolBadge).toContainText('Socket.IO');

    // Status badge shows Connected
    await expect(page.locator('[data-testid="status-badge"]')).toHaveText('Connected');

    // Message log should have messages from the EIO/SIO handshake
    const rows = page.locator('.ws-message-row');
    await expect(rows.first()).toBeVisible({ timeout: 3000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2); // At least EIO open + SIO connect

    // Verify at least one message contains "sid" (from EIO open packet)
    const allText = await page.locator('.ws-message-row').allTextContents();
    const hasSid = allText.some((t) => t.includes('sid'));
    expect(hasSid).toBe(true);

    await disconnect(page);
  });

  /* ── WP-05: Send Socket.IO event and receive echo ──── */

  test('WP-05: Send Socket.IO event and receive echo', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);

    // Count messages before send (handshake messages)
    const rowsBefore = await page.locator('.ws-message-row').count();

    // Switch to Send tab
    await switchLeftTab(page, 'send');

    // SIO compose fields should be visible
    await expect(page.locator('[data-testid="sio-event-name"]')).toBeVisible({ timeout: 3000 });

    // Enter event name
    await page.locator('[data-testid="sio-event-name"]').fill('chat');

    // Enter payload
    await page.locator('[aria-label="Message input"]').fill('{"message":"hello"}');

    // Click Send
    await page.locator('[data-testid="send-btn"]').click();
    await page.waitForTimeout(500);

    // Should have at least 2 new messages: sent event + echo response
    const rowsAfter = await page.locator('.ws-message-row').count();
    expect(rowsAfter).toBeGreaterThanOrEqual(rowsBefore + 2);

    // Verify message log rows contain the event name "chat"
    // Rows display decoded summary like "EVENT: chat" (not raw payload)
    const allText = await page.locator('.ws-message-row').allTextContents();
    const chatRows = allText.filter((t) => t.includes('chat'));
    // At least 2 rows with "chat": the sent event and the echoed event
    expect(chatRows.length).toBeGreaterThanOrEqual(2);

    // Verify the chat rows include both sent (↑) and received (↓) directions
    const sentChat = chatRows.some((t) => t.includes('↑'));
    const receivedChat = chatRows.some((t) => t.includes('↓'));
    expect(sentChat).toBe(true);
    expect(receivedChat).toBe(true);

    await disconnect(page);
  });

  /* ── WP-06: Socket.IO server params visible ────────── */

  test('WP-06: Socket.IO server params displayed from EIO open packet', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);

    // Switch to Connect tab to see server params
    await switchLeftTab(page, 'connect');

    // SIO server params should be visible showing pingInterval/pingTimeout
    const sioParams = page.locator('[data-testid="sio-server-params"]');
    await expect(sioParams).toBeVisible({ timeout: 3000 });

    // Should contain "ping" and "timeout" text
    const paramsText = await sioParams.textContent();
    expect(paramsText).toContain('ping');
    expect(paramsText).toContain('timeout');

    // Title attribute should contain sid and timing info
    const title = await sioParams.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title).toContain('SID');
    expect(title).toContain('Ping interval');
    expect(title).toContain('Ping timeout');

    await disconnect(page);
  });

  /* ── WP-07: Clean Socket.IO disconnect ─────────────── */

  test('WP-07: Clean Socket.IO disconnect', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);

    // Switch to Connect tab and verify protocol badge visible
    await switchLeftTab(page, 'connect');
    await expect(page.locator('[data-testid="protocol-badge"]')).toBeVisible();

    // Disconnect
    await page.locator('[data-testid="disconnect-btn"]').click();

    // Tab bar should show disconnected
    await page.locator('[data-testid="conn-tab-bar"] [aria-label*="disconnected"]').waitFor({ timeout: 5000 });

    // Status badge on connect panel should show Disconnected
    await expect(page.locator('[data-testid="status-badge"]')).toHaveText('Disconnected');

    // No connection error should be visible
    await expect(page.locator('[data-testid="connection-error"]')).not.toBeVisible();

    // Protocol badge and SIO params should be hidden (only shown when connected)
    await expect(page.locator('[data-testid="protocol-badge"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="sio-server-params"]')).not.toBeVisible();

    // Connect button should be visible and enabled
    await expect(page.locator('[data-testid="connect-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="connect-btn"]')).toBeEnabled();

    // Disconnect button should be disabled (visible but greyed out)
    await expect(page.locator('[data-testid="disconnect-btn"]')).toBeDisabled();
  });
});
