/**
 * WS Protocols — GraphQL-WS E2E Tests (WP-12 through WP-15)
 * Requires:
 *   - GraphQL-WS Docker server on port 4100
 *     (docker compose -f docker/websocket/graphql/docker-compose.yml up -d)
 *   - Vite dev server on 5173
 *   - Backend on 3001
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWsStudio, switchWsLeftTab, disconnectWs, selectWsCustomSelect } from './ws-helpers';

const GQL_URL = 'ws://localhost:4100/graphql';
const GQL_HEALTH = 'http://localhost:4100/health';

/* ── Ensure GraphQL-WS Docker is running ─────────────── */

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const resp = await page.request.get(GQL_HEALTH);
    expect(resp.ok(), 'GraphQL-WS Docker must be running on port 4100').toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe('ok');
  } catch (err) {
    throw new Error(
      `GraphQL-WS Docker is not reachable at ${GQL_HEALTH}. ` +
      `Start it with: docker compose -f docker/websocket/graphql/docker-compose.yml up -d\n` +
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

async function connectToGql(page: Page) {
  await switchLeftTab(page, 'connect');
  await selectWsCustomSelect(page, 'protocol-select', { value: 'graphql-ws', label: 'GraphQL-WS' });
  await page.waitForTimeout(200);

  const urlInput = page.locator('[aria-label="WebSocket URL"]');
  await urlInput.fill(GQL_URL);

  // GraphQL-WS server requires 'graphql-transport-ws' subprotocol
  const subprotocolInput = page.locator('[aria-label="Subprotocols"]');
  await expect(subprotocolInput).toBeVisible({ timeout: 2000 });
  await subprotocolInput.fill('graphql-transport-ws');

  await page.locator('[data-testid="connect-btn"]').click();

  // Wait for connected state via conn-tab-bar (always visible)
  await page.locator('[data-testid="conn-tab-bar"] [aria-label*="connected"]').waitFor({ timeout: 10000 });

  // Give time for connection_init → connection_ack handshake
  await page.waitForTimeout(500);
}


/* ── GraphQL-WS Live Tests (WP-12–15) ────────────────── */

test.describe('GraphQL-WS Live (WP-12–15)', () => {
  test('WP-12: Connect to GraphQL-WS server and verify connection_init/ack', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToGql(page);

    // Switch to Connect tab — verify protocol badge
    await switchLeftTab(page, 'connect');
    const protocolBadge = page.locator('[data-testid="protocol-badge"]');
    await expect(protocolBadge).toBeVisible();
    await expect(protocolBadge).toContainText('GraphQL-WS');

    // Status badge shows Connected
    await expect(page.locator('[data-testid="status-badge"]')).toHaveText('Connected');

    // Message log should show connection_init and connection_ack
    const rows = page.locator('.ws-message-row');
    await expect(rows.first()).toBeVisible({ timeout: 3000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2); // At least connection_init + connection_ack
    const allText = await rows.allTextContents();

    // connection_init auto-sent (◆ system direction)
    const initSent = allText.some((t) => t.includes('connection_init') && t.includes('◆'));
    expect(initSent).toBe(true);

    // connection_ack received (◆ system direction)
    const ackReceived = allText.some((t) => t.includes('connection_ack') && t.includes('◆'));
    expect(ackReceived).toBe(true);

    await disconnect(page);
  });

  /* ── WP-13: Subscription with countdown events ────── */

  test('WP-13: GraphQL subscription receives countdown events', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToGql(page);

    // Count messages before sending subscription
    const rowsBefore = await page.locator('.ws-message-row').count();

    // Switch to Send tab
    await switchLeftTab(page, 'send');

    // GQL compose fields should be visible
    await expect(page.locator('[data-testid="gql-compose-fields"]')).toBeVisible({ timeout: 3000 });

    // Enter countdown subscription query
    await page.locator('[aria-label="Message input"]').fill('subscription { countdown(from: 3) }');
    await page.locator('[data-testid="send-btn"]').click();

    // Wait for the server-sent 'complete' message (countdown 3→0 at 500ms = ~2s)
    // This is more robust than a fixed timeout
    await expect(
      page.locator('.ws-message-row', { hasText: 'complete' }).first(),
    ).toBeVisible({ timeout: 10000 });
    // Small buffer to ensure all rows have rendered
    await page.waitForTimeout(300);

    // Verify messages in the log
    const allText = await page.locator('.ws-message-row').allTextContents();

    // subscribe frame sent (↑ direction, not system)
    const subscribeSent = allText.some((t) => t.includes('subscribe') && t.includes('↑'));
    expect(subscribeSent).toBe(true);

    // next frames received (↓ direction) — at least one with countdown data
    const nextReceived = allText.filter((t) => t.includes('next') && t.includes('↓'));
    expect(nextReceived.length).toBeGreaterThanOrEqual(4); // 3, 2, 1, 0

    // complete frame received (↓ direction) — server sends complete after countdown finishes
    const completeReceived = allText.some((t) => t.includes('complete') && t.includes('↓'));
    expect(completeReceived).toBe(true);

    // Total rows should have grown significantly
    const rowsAfter = await page.locator('.ws-message-row').count();
    expect(rowsAfter).toBeGreaterThan(rowsBefore);

    await disconnect(page);
  });

  /* ── WP-14: GraphQL-WS compose fields layout ──────── */

  test('WP-14: GraphQL-WS compose fields layout and operation ID', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToGql(page);

    // Switch to Send tab
    await switchLeftTab(page, 'send');

    // GQL compose fields should be visible
    await expect(page.locator('[data-testid="gql-compose-fields"]')).toBeVisible({ timeout: 3000 });

    // Operation name input should be visible
    await expect(page.locator('[data-testid="gql-operation-name"]')).toBeVisible();

    // Variables textarea is in a tab — switch to it before asserting
    await page.locator('[data-testid="gql-tab-variables"]').click();
    await expect(page.locator('[data-testid="gql-variables"]')).toBeVisible();

    // Operation ID badge should be visible and show "#1"
    const opId = page.locator('[data-testid="gql-op-id"]');
    await expect(opId).toBeVisible();
    await expect(opId).toHaveText('#1');

    // Switch back to Query tab — message input is hidden while Variables tab is active
    await page.locator('[data-testid="gql-tab-query"]').click();

    // Send a subscription to verify op ID increments
    await page.locator('[aria-label="Message input"]').fill('subscription { countdown(from: 0) }');
    await page.locator('[data-testid="send-btn"]').click();
    await page.waitForTimeout(500);

    // Op ID should now show "#2" (incremented after send)
    await expect(opId).toHaveText('#2');

    await disconnect(page);
  });

  /* ── WP-15: Clean GraphQL-WS disconnect ────────────── */

  test('WP-15: Clean GraphQL-WS disconnect', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToGql(page);

    // Verify we're connected with GraphQL-WS protocol badge
    await switchLeftTab(page, 'connect');
    await expect(page.locator('[data-testid="protocol-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="protocol-badge"]')).toContainText('GraphQL-WS');

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
