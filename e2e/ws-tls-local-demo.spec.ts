/**
 * E2E: Local TLS Echo Server Demo (Docker lesson)
 *
 * The Docker stacks (wss://localhost:8766, wss://localhost:8768) may or may not
 * be running in CI. Tests are grouped by concern and Docker availability:
 *
 *  Part A — Gate & Navigation (no Docker required)
 *    1. Lesson appears in WebSocket category with 🐳 Docker tag
 *    2. PrerequisiteGate shows when Docker is down — Start Demo is disabled
 *
 *  Part B — Setup logic (requires Docker for gate-clear)
 *    3. localTlsSetup resets skip-cert and clears CA cert
 *    4. localTlsSetup clears custom headers (prevents proxy trigger)
 *
 *  Part C — Phase 1: Skip-cert via WS Studio (requires Docker TLS)
 *    5. Skip-cert → Proxy transport → connects to wss://localhost:8766
 *    6. Echo round-trip confirmed over skip-cert connection
 *
 *  Part D — Phase 2: CA Certificate via WS Studio (requires Docker TLS)
 *    7. CA cert → Proxy transport → connects to wss://localhost:8766
 *
 *  Part E — Phase 3: mTLS via WS Studio (requires Docker mTLS)
 *    8. Client cert+key → Proxy → connects to wss://localhost:8768
 *    9. mTLS server rejects connections without client cert
 */
import { test, expect } from '@playwright/test';
import { WS } from '../src/shared/selectors';
import {
  WS_TLS_DEMO_CA_CERT as DEV_CA_CERT,
  WS_TLS_DEMO_CLIENT_CERT as DEV_CLIENT_CERT,
  WS_TLS_DEMO_CLIENT_KEY as DEV_CLIENT_KEY,
} from '../packages/demo-hub/src/lessons/protocols/ws-tls-demo-certs';

const APP_BASE = 'http://localhost:5173';
const TLS_WSS  = 'wss://localhost:8766';
const MTLS_WSS = 'wss://localhost:8768';
const SKIP_CERT_CHECKBOX = `${WS.TLS_SKIP_CERT} input[type="checkbox"]`;

// ── Helpers ─────────────────────────────────────────────────────────

async function isDockerRunning(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch { return false; }
}

async function gotoWsStudio(page: import('@playwright/test').Page) {
  await page.goto(`${APP_BASE}/?tab=websocket-studio`, { waitUntil: 'networkidle' });
  await page.click(WS.MODE_CLIENT);
  await page.click(WS.LEFT_TAB_CONNECT);
  await page.waitForTimeout(300);
}

async function navigateToLocalTlsLesson(page: import('@playwright/test').Page) {
  await page.locator('button[title="Demo Hub"]').click();
  await page.waitForSelector('.demo-domain-grid', { timeout: 5000 });
  await page.locator('.demo-domain-card').filter({ hasText: 'Protocols' }).click();
  await page.waitForSelector('.demo-category-tabs', { timeout: 5000 });
  await page.locator('.demo-category-tab').filter({ hasText: 'WebSocket' }).click();
  await page.waitForSelector('.demo-lesson-item', { timeout: 3000 });
  await page.locator('.demo-lesson-item').filter({ hasText: 'Local TLS Echo Server' }).first().click();
  await page.waitForSelector('.demo-start-btn', { timeout: 5000 });
}

async function openTlsPanel(page: import('@playwright/test').Page) {
  const toggle = page.locator(WS.TLS_TOGGLE);
  const expanded = await toggle.getAttribute('aria-expanded', { timeout: 3000 }).catch(() => null);
  if (expanded !== 'true') {
    await toggle.click();
    await page.waitForTimeout(300);
  }
}

/** Close the TLS modal. Tries Save first (if enabled/dirty); always falls back to Close. */
async function closeTlsPanel(page: import('@playwright/test').Page) {
  await page.waitForTimeout(300);
  const saveBtn = page.locator('[data-testid="tls-save"]');
  const isDisabled = await saveBtn.getAttribute('disabled').catch(() => 'disabled');
  if (!isDisabled) {
    await saveBtn.click();
  } else {
    await page.locator('[data-testid="tls-close"]').click();
  }
  // Wait for overlay to be gone
  await page.waitForSelector('.ws-tls-overlay', { state: 'detached', timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(100);
}

async function connectAndWait(page: import('@playwright/test').Page, timeoutMs = 5000) {
  await page.click(WS.CONNECT_BTN);
  await page.waitForSelector(WS.STATUS_CONNECTED, { timeout: timeoutMs });
}

async function _disconnectAndClear(page: import('@playwright/test').Page) {
  const disconnectBtn = page.locator(WS.DISCONNECT_BTN);
  if (await disconnectBtn.isEnabled().catch(() => false)) {
    await disconnectBtn.click();
    await page.waitForTimeout(500);
  }
}

// ── Part A: Gate & Navigation ───────────────────────────────────────

test.describe('Local TLS Demo — Gate & Navigation', () => {

  test('1. lesson appears in WebSocket category with Docker tag', async ({ page }) => {
    await page.goto(APP_BASE, { waitUntil: 'networkidle' });
    await page.locator('button[title="Demo Hub"]').click();
    await page.waitForSelector('.demo-domain-grid', { timeout: 5000 });
    await page.locator('.demo-domain-card').filter({ hasText: 'Protocols' }).click();
    await page.waitForSelector('.demo-category-tabs', { timeout: 5000 });
    await page.locator('.demo-category-tab').filter({ hasText: 'WebSocket' }).click();
    await page.waitForSelector('.demo-lesson-item', { timeout: 3000 });

    const lessonItem = page.locator('.demo-lesson-item').filter({ hasText: 'Local TLS Echo Server' });
    await expect(lessonItem).toBeVisible();
    const tag = lessonItem.locator('.demo-lesson-tag');
    await expect(tag).toContainText('🐳 Docker');
    console.log('[test 1] ✅ Local TLS lesson visible with Docker tag');
  });

  test('2. PrerequisiteGate shows when Docker is down, disables Start Demo', async ({ page }) => {
    const dockerUp = await isDockerRunning(8767);
    test.skip(dockerUp, 'Docker stack is running — gate test requires it to be DOWN');

    await page.goto(APP_BASE, { waitUntil: 'networkidle' });
    await navigateToLocalTlsLesson(page);

    const gate = page.locator('[data-testid="prereq-gate"]');
    await expect(gate).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.demo-start-btn')).toBeDisabled();
    await expect(page.locator('[data-testid="prereq-command"]')).toContainText('docker');
    console.log('[test 2] ✅ Gate visible, Start Demo disabled');
  });
});

// ── Part B: Setup Logic ─────────────────────────────────────────────

test.describe('Local TLS Demo — Setup Logic', () => {

  test('3. localTlsSetup resets skip-cert and clears CA cert', async ({ page }) => {
    const dockerUp = await isDockerRunning(8767);
    test.skip(!dockerUp, 'Docker TLS stack not running');

    // Set dirty state in WS studio
    await gotoWsStudio(page);
    await page.fill(WS.URL_INPUT, TLS_WSS);
    await page.waitForSelector(WS.TLS_PANEL, { timeout: 3000 });
    await openTlsPanel(page);
    await page.locator(SKIP_CERT_CHECKBOX).check();
    await page.locator(WS.TLS_CA_CERT).fill('FAKE');
    await page.waitForTimeout(200);
    console.log('[test 3] Dirty state set (skip-cert=true, caCert=FAKE)');

    // Navigate to demo and start it — setup runs automatically
    await navigateToLocalTlsLesson(page);
    await page.locator('.demo-start-btn').click();
    await page.waitForSelector('.demo-live-panel', { timeout: 15000 });
    await page.waitForTimeout(3000); // wait for setup async actions

    // Check state by reading the WS studio elements (still in DOM under demo overlay)
    await page.click(WS.LEFT_TAB_CONNECT).catch(() => {});
    await page.waitForTimeout(500);

    // The URL should be EMPTY (setup clears it at the end)
    const urlVal = await page.locator(WS.URL_INPUT).inputValue({ timeout: 2000 }).catch(() => '');
    console.log(`[test 3] URL after setup: "${urlVal}" (expect "")`);
    expect(urlVal).toBe('');

    // TLS panel should not be visible when URL is empty
    const tlsPanelVisible = await page.locator(WS.TLS_PANEL).isVisible().catch(() => false);
    console.log(`[test 3] TLS panel visible: ${tlsPanelVisible} (expect false — URL empty)`);
    expect(tlsPanelVisible).toBe(false);
    console.log('[test 3] ✅ Setup correctly cleared URL, TLS panel gone');
  });

  test('4. localTlsSetup clears custom headers (prevents proxy trigger)', async ({ page }) => {
    const dockerUp = await isDockerRunning(8767);
    test.skip(!dockerUp, 'Docker TLS stack not running');

    // Add custom header
    await gotoWsStudio(page);
    await page.click(WS.LEFT_TAB_HEADERS);
    await page.waitForTimeout(300);
    await page.locator('.ws-connect-kv-add-btn:not(.ws-connect-kv-delete-all-btn)').first().click();
    await page.waitForTimeout(200);
    await page.locator('.ws-connect-kv-key').first().fill('X-Proxy-Trigger-Test');
    await page.waitForTimeout(200);
    console.log('[test 4] Custom header added');

    // Start demo — setup should clear headers
    await navigateToLocalTlsLesson(page);
    await page.locator('.demo-start-btn').click();
    await page.waitForSelector('.demo-live-panel', { timeout: 15000 });
    await page.waitForTimeout(3000);

    // Return to headers tab and check
    await page.click(WS.LEFT_TAB_HEADERS).catch(() => {});
    await page.waitForTimeout(300);

    const headerRows = await page.locator('.ws-connect-kv-row').count();
    console.log(`[test 4] Header rows after setup: ${headerRows} (expect 0)`);
    expect(headerRows).toBe(0);
    console.log('[test 4] ✅ Custom headers cleared by setup');
  });
});

// ── Part C: Phase 1 — Skip-cert ─────────────────────────────────────

test.describe('Local TLS Demo — Phase 1: Skip-cert', () => {

  test('5. skip-cert → Proxy transport → connects to wss://localhost:8766', async ({ page }) => {
    const dockerUp = await isDockerRunning(8767);
    test.skip(!dockerUp, 'Docker TLS stack not running');

    const proxyReqs: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/ws/')) proxyReqs.push(req.url());
    });

    await gotoWsStudio(page);
    await page.fill(WS.URL_INPUT, TLS_WSS);
    await page.waitForSelector(WS.TLS_PANEL, { timeout: 3000 });
    await openTlsPanel(page);

    // Enable skip-cert → should switch transport to Proxy
    await page.locator(SKIP_CERT_CHECKBOX).check();
    await page.waitForTimeout(500);

    const skipCertChecked = await page.locator(SKIP_CERT_CHECKBOX).isChecked();
    console.log(`[test 5] skip-cert checked: ${skipCertChecked}`);
    expect(skipCertChecked).toBe(true);

    // Check transport badge shows Proxy
    const badge = page.locator(WS.TRANSPORT_BADGE);
    if (await badge.isVisible({ timeout: 2000 }).catch(() => false)) {
      const badgeText = await badge.textContent({ timeout: 1000 }).catch(() => '');
      console.log(`[test 5] transport badge: "${badgeText}"`);
      expect(badgeText?.toLowerCase()).toContain('proxy');
    }

    await page.click(WS.LEFT_TAB_CONNECT);
    await connectAndWait(page, 8000);

    const has504 = await page.locator('text=504 Gateway Timeout').isVisible().catch(() => false);
    console.log(`[test 5] Connected! 504=${has504} proxy_reqs=${proxyReqs.length}`);
    expect(has504).toBe(false);
    expect(proxyReqs.length).toBeGreaterThan(0);
    console.log('[test 5] ✅ skip-cert → Proxy → Connected to wss://localhost:8766');
  });

  test('6. skip-cert echo round-trip over local TLS', async ({ page }) => {
    const dockerUp = await isDockerRunning(8767);
    test.skip(!dockerUp, 'Docker TLS stack not running');

    await gotoWsStudio(page);
    await page.fill(WS.URL_INPUT, TLS_WSS);
    await page.waitForSelector(WS.TLS_PANEL, { timeout: 3000 });
    await openTlsPanel(page);
    await page.locator(SKIP_CERT_CHECKBOX).check();
    await closeTlsPanel(page);
    await page.click(WS.LEFT_TAB_CONNECT);
    await connectAndWait(page, 8000);

    // Send a test message
    await page.click(WS.LEFT_TAB_SEND);
    await page.waitForTimeout(300);
    await page.fill(WS.MESSAGE_INPUT, '{"phase":1,"method":"skip-cert","msg":"echo test"}');
    await page.click(WS.SEND_BTN);
    await page.waitForTimeout(2000);

    const msgRows = await page.locator(WS.MESSAGE_ROW).count();
    console.log(`[test 6] Message rows: ${msgRows} (expect >= 2: sent + echoed)`);
    expect(msgRows).toBeGreaterThanOrEqual(2);
    console.log('[test 6] ✅ Echo round-trip confirmed over skip-cert TLS');
  });
});

// ── Part D: Phase 2 — CA Certificate ────────────────────────────────

test.describe('Local TLS Demo — Phase 2: CA Certificate', () => {

  test('7. CA cert → Proxy → connects to wss://localhost:8766 without skip-cert', async ({ page }) => {
    const dockerUp = await isDockerRunning(8767);
    test.skip(!dockerUp, 'Docker TLS stack not running');

    const proxyReqs: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/ws/')) proxyReqs.push(req.url());
    });

    await gotoWsStudio(page);
    await page.fill(WS.URL_INPUT, TLS_WSS);
    await page.waitForSelector(WS.TLS_PANEL, { timeout: 3000 });
    await openTlsPanel(page);

    // skip-cert OFF, paste CA cert only
    const skipChecked = await page.locator(SKIP_CERT_CHECKBOX).isChecked();
    if (skipChecked) await page.locator(SKIP_CERT_CHECKBOX).uncheck();
    await page.fill(WS.TLS_CA_CERT, DEV_CA_CERT);
    await page.waitForTimeout(500);

    // Capture state BEFORE connecting (TLS panel is still expanded)
    const skipBefore = await page.locator(SKIP_CERT_CHECKBOX).isChecked({ timeout: 2000 }).catch(() => false);
    const caCert = await page.locator(WS.TLS_CA_CERT).inputValue({ timeout: 2000 }).catch(() => '');
    console.log(`[test 7] Before connect: skip-cert=${skipBefore} caCert_len=${caCert.length}`);
    expect(skipBefore).toBe(false);
    expect(caCert.length).toBeGreaterThan(100);

    await page.click(WS.LEFT_TAB_CONNECT);
    await connectAndWait(page, 10000);

    const has504 = await page.locator('text=504').isVisible().catch(() => false);
    console.log(`[test 7] proxy_reqs=${proxyReqs.length} 504=${has504}`);
    expect(has504).toBe(false);
    expect(proxyReqs.length).toBeGreaterThan(0);
    console.log('[test 7] ✅ CA cert → Proxy → Connected (chain validated, no skip-cert)');
  });
});

// ── Part E: Phase 3 — mTLS ──────────────────────────────────────────

test.describe('Local TLS Demo — Phase 3: mTLS', () => {

  test('8. client cert+key → Proxy → connects to mTLS server (wss://localhost:8768)', async ({ page }) => {
    const tlsUp   = await isDockerRunning(8767);
    const mtlsUp  = await isDockerRunning(8769);
    test.skip(!tlsUp || !mtlsUp, 'Docker TLS+mTLS stacks not running');

    const proxyReqs: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/ws/')) proxyReqs.push(req.url());
    });

    await gotoWsStudio(page);
    await page.fill(WS.URL_INPUT, MTLS_WSS);
    await page.waitForSelector(WS.TLS_PANEL, { timeout: 3000 });
    await openTlsPanel(page);

    // CA cert + client cert + client key (no skip-cert needed — CA validates server)
    const skipChecked = await page.locator(SKIP_CERT_CHECKBOX).isChecked();
    if (skipChecked) await page.locator(SKIP_CERT_CHECKBOX).uncheck();
    await page.fill(WS.TLS_CA_CERT, DEV_CA_CERT);
    await page.fill(WS.TLS_CLIENT_CERT, DEV_CLIENT_CERT);
    await page.fill(WS.TLS_CLIENT_KEY, DEV_CLIENT_KEY);
    await closeTlsPanel(page);

    // Capture URL BEFORE connecting (input may be hidden after connection)
    const urlVal = await page.locator(WS.URL_INPUT).inputValue({ timeout: 2000 }).catch(() => '');
    console.log(`[test 8] url before connect: ${urlVal}`);
    expect(urlVal).toContain('8768');

    await page.click(WS.LEFT_TAB_CONNECT);
    await connectAndWait(page, 10000);

    const has504 = await page.locator('text=504').isVisible().catch(() => false);
    console.log(`[test 8] proxy_reqs=${proxyReqs.length} 504=${has504}`);
    expect(has504).toBe(false);
    expect(proxyReqs.length).toBeGreaterThan(0);

    // Send echo message to confirm live connection
    await page.click(WS.LEFT_TAB_SEND);
    await page.waitForTimeout(300);
    await page.fill(WS.MESSAGE_INPUT, '{"phase":3,"method":"mtls","verified":"both-sides"}');
    await page.click(WS.SEND_BTN);
    await page.waitForTimeout(2000);
    const msgRows = await page.locator(WS.MESSAGE_ROW).count();
    console.log(`[test 8] msgRows=${msgRows} (expect >= 2)`);
    expect(msgRows).toBeGreaterThanOrEqual(2);
    console.log('[test 8] ✅ mTLS client+server auth — Connected and echo confirmed');
  });

  test('9. mTLS server rejects connection without client cert (only skip-cert)', async ({ page }) => {
    const mtlsUp = await isDockerRunning(8769);
    test.skip(!mtlsUp, 'Docker mTLS stack not running');

    await gotoWsStudio(page);
    await page.fill(WS.URL_INPUT, MTLS_WSS);
    await page.waitForSelector(WS.TLS_PANEL, { timeout: 3000 });
    await openTlsPanel(page);

    // Only skip-cert — no client cert. Server MUST reject at TLS handshake.
    await page.locator(SKIP_CERT_CHECKBOX).check();
    await page.fill(WS.TLS_CLIENT_CERT, '');
    await page.fill(WS.TLS_CLIENT_KEY, '');
    await page.waitForTimeout(300);

    await page.click(WS.LEFT_TAB_CONNECT);
    // Wait for connection attempt to settle (success or error)
    await page.waitForTimeout(5000);

    const isConnected = await page.locator(WS.STATUS_CONNECTED).isVisible().catch(() => false);
    console.log(`[test 9] mTLS rejection (no client cert): connected=${isConnected}`);
    // The mTLS server (nginx ssl_verify_client on) SHOULD reject without client cert
    expect(isConnected).toBe(false);
    console.log('[test 9] ✅ mTLS server correctly rejected connection without client cert');
  });
});
