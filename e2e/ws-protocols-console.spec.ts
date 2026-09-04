/**
 * WS Protocols — Console × Protocol E2E Tests (WP-C01 through WP-C05)
 * Requires:
 *   - Socket.IO Docker echo server on port 3100
 *     (docker compose -f docker/websocket/docker-compose.all.yml up -d)
 *   - Vite dev server on 5173
 *   - Backend on 3001
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWsStudio, switchWsLeftTab, switchWsRightTab, selectWsCustomSelect, selectWsConsoleCategory } from './ws-helpers';

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
      `Start it with: docker compose -f docker/websocket/docker-compose.all.yml up -d\n` +
      `Original error: ${err}`,
      { cause: err },
    );
  } finally {
    await ctx.close();
  }
});

/* ── Helpers ─────────────────────────────────────────── */

const switchLeftTab = (page: Page, tab: string) => switchWsLeftTab(page, tab);
const switchRightTab = (page: Page, tab: string) => switchWsRightTab(page, tab);

async function connectToSio(page: Page) {
  await switchLeftTab(page, 'connect');
  await selectWsCustomSelect(page, 'protocol-select', { value: 'socket-io', label: 'Socket.IO' });
  await page.waitForTimeout(200);

  const urlInput = page.locator('[aria-label="WebSocket URL"]');
  await urlInput.fill(SIO_URL);
  await page.locator('[data-testid="connect-btn"]').click();

  await page.locator('[data-testid="conn-tab-bar"] [aria-label*="connected"]').waitFor({ timeout: 10000 });
  // Give time for EIO handshake + console entries to populate
  await page.waitForTimeout(500);
}

async function typeConsoleCommand(page: Page, command: string) {
  const cmdInput = page.locator('[data-testid="ws-console-cmd-input"]');
  await expect(cmdInput).toBeVisible();
  await cmdInput.fill(command);
  await cmdInput.press('Enter');
  // Allow time for command dispatch and entry append
  await page.waitForTimeout(300);
}

/* ── WP-C01 through WP-C05 ──────────────────────────── */

test.describe('Console × Protocol (WP-C01–C05)', () => {
  test('WP-C01: Console shows connection lifecycle entries', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);

    // Switch to Console right-pane tab
    await switchRightTab(page, 'console');

    // Console pane should be visible
    await expect(page.locator('[data-testid="ws-studio-console-pane"]')).toBeVisible();

    // Count badge should show entries (n/n where n ≥ 3: connecting + handshake + connected)
    const countBadge = page.locator('[data-testid="ws-console-count"]');
    await expect(countBadge).toBeVisible();
    const countText = await countBadge.textContent();
    const match = countText?.match(/^(\d+)\/(\d+)$/);
    expect(match, `Console count "${countText}" should be n/n`).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(3);

    // Check for lifecycle entries by reading all console messages
    const messages = page.locator('.ws-console-row .ws-console-msg');
    await expect(messages.first()).toBeVisible({ timeout: 3000 });
    const allMessages = await messages.allTextContents();

    // Must include "Connecting to" (lifecycle category)
    expect(
      allMessages.some((m) => m.includes('Connecting to')),
      `Expected "Connecting to" entry. Got: ${JSON.stringify(allMessages)}`,
    ).toBeTruthy();

    // Must include "101 Switching Protocols" (handshake category)
    expect(
      allMessages.some((m) => m.includes('101 Switching Protocols')),
      `Expected "101 Switching Protocols" entry. Got: ${JSON.stringify(allMessages)}`,
    ).toBeTruthy();

    // Must include "Connected" (lifecycle category)
    expect(
      allMessages.some((m) => m.includes('Connected')),
      `Expected "Connected" entry. Got: ${JSON.stringify(allMessages)}`,
    ).toBeTruthy();

    // Note: "Protocol detected" entry is NOT emitted when the protocol is
    // detected via URL pattern before the console hook observes a transition
    // (the hook seeds prevProtocolRef on first observation without emitting).
    // SIO is detected early via the EIO query string, so no protocol entry.

    // Verify categories are present in the structured view
    const categories = page.locator('.ws-console-row .ws-console-cat');
    const allCats = await categories.allTextContents();
    expect(allCats).toContain('lifecycle');
    expect(allCats).toContain('handshake');
  });

  test('WP-C02: /send from Console sends raw message', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);
    await switchRightTab(page, 'console');

    // Type /send hello in the console command input
    await typeConsoleCommand(page, '/send hello');

    // Console should show the echo of the command and "Message sent." result
    const messages = page.locator('.ws-console-row .ws-console-msg');
    // Wait for the "Message sent." entry to appear (command echo + result)
    await expect(page.locator('.ws-console-row .ws-console-msg', { hasText: 'Message sent.' })).toBeVisible({ timeout: 3000 });
    const allMessages = await messages.allTextContents();

    // The typed command is echoed first
    expect(
      allMessages.some((m) => m.includes('/send hello')),
      `Expected command echo "/send hello". Got: ${JSON.stringify(allMessages)}`,
    ).toBeTruthy();

    // Then the result entry confirms the message was sent
    expect(
      allMessages.some((m) => m.includes('Message sent.')),
      `Expected "Message sent." entry. Got: ${JSON.stringify(allMessages)}`,
    ).toBeTruthy();

    // Note: We do NOT switch to Events to check for the sent message because
    // /send sends raw text which violates SIO's Engine.IO framing, causing
    // the server to disconnect. The Console /send is intentionally raw — it
    // bypasses protocol framing (that's the Compose panel's job).
  });

  test('WP-C03: /ping not supported on direct transport', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);
    await switchRightTab(page, 'console');

    // Type /ping — should fail because direct transport cannot send ping frames
    await typeConsoleCommand(page, '/ping');

    // Console should show error about ping not being supported
    const messages = page.locator('.ws-console-row .ws-console-msg');
    // Wait for the error entry to appear
    await expect(page.locator('.ws-console-row .ws-console-msg', { hasText: 'not supported' })).toBeVisible({ timeout: 3000 });
    const allMessages = await messages.allTextContents();
    expect(
      allMessages.some((m) => m.includes('not supported')),
      `Expected "/ping is not supported here." error. Got: ${JSON.stringify(allMessages)}`,
    ).toBeTruthy();
  });

  test('WP-C04: Console structured vs raw view toggle', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);
    await switchRightTab(page, 'console');

    // Structured view is the default
    const structuredBtn = page.locator('[data-testid="ws-console-view-structured"]');
    await expect(structuredBtn).toBeVisible();
    await expect(structuredBtn).toHaveClass(/active/);

    // Verify structured rows are rendered with level badges and category spans
    const structuredRows = page.locator('.ws-console-row');
    await expect(structuredRows.first()).toBeVisible();
    const levelBadges = page.locator('.ws-console-row .ws-console-level-badge');
    expect(await levelBadges.count()).toBeGreaterThan(0);
    const catSpans = page.locator('.ws-console-row .ws-console-cat');
    expect(await catSpans.count()).toBeGreaterThan(0);

    // Switch to Raw view
    const rawBtn = page.locator('[data-testid="ws-console-view-raw"]');
    await rawBtn.click();
    await page.waitForTimeout(200);
    await expect(rawBtn).toHaveClass(/active/);

    // Verify raw rows are rendered with glyph prefixes
    const rawRows = page.locator('.ws-console-raw-row');
    await expect(rawRows.first()).toBeVisible();
    const glyphs = page.locator('.ws-console-raw-row .ws-console-raw-pfx');
    const glyphTexts = await glyphs.allTextContents();
    expect(glyphTexts.length).toBeGreaterThan(0);
    // Raw glyphs should be one of: * > < $ (or empty for continuation lines)
    for (const g of glyphTexts) {
      expect(['*', '>', '<', '$', '']).toContain(g.trim());
    }

    // Structured rows should NOT be visible in raw mode
    await expect(page.locator('.ws-console-row').first()).not.toBeVisible();

    // Switch back to structured
    await structuredBtn.click();
    await page.waitForTimeout(200);
    await expect(structuredBtn).toHaveClass(/active/);
    await expect(page.locator('.ws-console-row').first()).toBeVisible();
  });

  test('WP-C05: Console category filter', async ({ page }) => {
    await gotoWsStudio(page);
    await connectToSio(page);
    await switchRightTab(page, 'console');

    // Run /help to generate a "command" category entry
    await typeConsoleCommand(page, '/help');

    // Get the full entry count
    const countBadge = page.locator('[data-testid="ws-console-count"]');
    const fullCountText = await countBadge.textContent();
    const fullMatch = fullCountText?.match(/^(\d+)\/(\d+)$/);
    expect(fullMatch).toBeTruthy();
    const fullCount = Number(fullMatch![1]);
    expect(fullCount).toBeGreaterThanOrEqual(4); // lifecycle + handshake + connected + help entries

    // Filter to "handshake" category — we know it exists from WP-C01
    await selectWsConsoleCategory(page, 'handshake');
    await page.waitForTimeout(200);

    // Count should decrease — only handshake entries visible
    const filteredCountText = await countBadge.textContent();
    const filteredMatch = filteredCountText?.match(/^(\d+)\/(\d+)$/);
    expect(filteredMatch).toBeTruthy();
    const filteredCount = Number(filteredMatch![1]);
    const totalCount = Number(filteredMatch![2]);
    expect(filteredCount).toBeLessThan(totalCount);
    expect(filteredCount).toBeGreaterThanOrEqual(1); // At least the 101 handshake entry

    // Verify visible entries contain "101 Switching Protocols"
    const messages = page.locator('.ws-console-row .ws-console-msg');
    await expect(messages.first()).toBeVisible({ timeout: 3000 });
    const filteredMessages = await messages.allTextContents();
    expect(
      filteredMessages.some((m) => m.includes('101 Switching Protocols')),
      `Expected "101 Switching Protocols" in filtered entries. Got: ${JSON.stringify(filteredMessages)}`,
    ).toBeTruthy();

    // Reset to "all"
    await selectWsConsoleCategory(page, 'all');
    await page.waitForTimeout(200);

    // Full count restored
    const restoredCountText = await countBadge.textContent();
    const restoredMatch = restoredCountText?.match(/^(\d+)\/(\d+)$/);
    expect(restoredMatch).toBeTruthy();
    expect(Number(restoredMatch![1])).toBe(totalCount);
  });
});
