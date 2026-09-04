/**
 * Shared WebSocket Studio E2E helpers.
 *
 * Extracted from ws-core-connect, ws-mock-server, ws-multi-mock-investigate,
 * ws-protocols-console, ws-protocols-graphql, ws-protocols-socketio, and
 * demo-selector-guard to eliminate copy-paste duplication.
 */
import { expect, type Page, type Browser } from '@playwright/test';

export const WS_STUDIO_BASE = 'http://localhost:5173/?tab=websocket-studio';
export const WS_DEFAULT_MOCK_PORT = 9876;
export const WS_DEFAULT_MOCK_URL = `ws://localhost:${WS_DEFAULT_MOCK_PORT}`;
export const WS_SECONDARY_MOCK_PORT = WS_DEFAULT_MOCK_PORT + 1;
export const WS_TERTIARY_MOCK_PORT = WS_DEFAULT_MOCK_PORT + 2;

/** Navigate to the WebSocket Studio tab and wait for the mode selector. */
export async function gotoWsStudio(page: Page, opts?: { timeout?: number }): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await page.goto(WS_STUDIO_BASE, { waitUntil: 'networkidle' });
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ERR_CONNECTION_REFUSED') || attempt === 5) {
        throw error;
      }
      await page.waitForTimeout(1_000);
    }
  }
  if (lastError && page.url() !== WS_STUDIO_BASE) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  await page.waitForSelector('[data-testid="mode-client"]', { timeout: opts?.timeout ?? 8000 });
}

/** Switch the active connection pane to a mode (client / mock / saved). */
export async function switchWsMode(page: Page, mode: 'client' | 'mock' | 'saved'): Promise<void> {
  await page.click(`[data-testid="mode-${mode}"]`);
  await page.waitForTimeout(300);
}

/** Click a left-panel tab (connect / headers / send / auth / templates). */
export async function switchWsLeftTab(page: Page, tab: string): Promise<void> {
  await page.click(`[data-testid="left-tab-${tab}"]`);
  await page.waitForTimeout(200);
}

/** Click a right-panel tab (console / filters / diff / etc.). */
export async function switchWsRightTab(page: Page, tab: string): Promise<void> {
  await page.click(`[data-testid="right-tab-${tab}"]`);
  await page.waitForTimeout(200);
}

/**
 * Tab aria-label is `"<host> — connected"` / `"<host> — disconnected"`.
 * `aria-label*="connected"` also matches **disconnected** — always use this.
 */
export function wsConnectedTab(page: Page) {
  return page.locator('[data-testid="conn-tab-bar"] [role="tab"][aria-label*="— connected"]');
}

/**
 * Connect to a WebSocket URL.
 * Retries once if the initial wait times out (mock server may have been
 * stopped by a parallel spec — restarts it and tries again).
 */
export async function connectWsTo(
  page: Page,
  url = WS_DEFAULT_MOCK_URL,
  mockPort = WS_DEFAULT_MOCK_PORT,
): Promise<void> {
  await switchWsLeftTab(page, 'connect');
  const urlInput = page.locator('[aria-label="WebSocket URL"]');
  await urlInput.fill(url);
  await page.click('[data-testid="connect-btn"]');
  const connected = wsConnectedTab(page);
  try {
    await connected.waitFor({ timeout: 8000 });
  } catch {
    // Mock server may have been stopped by a parallel spec — restart and retry
    await page.request.post('http://localhost:3001/api/ws/mock/start', {
      data: { port: mockPort },
    }).catch(() => {});
    await page.waitForTimeout(500);
    const disconnectBtn = page.locator('[data-testid="disconnect-btn"]');
    if (await disconnectBtn.isEnabled().catch(() => false)) {
      await disconnectBtn.click();
      await page.waitForTimeout(200);
    }
    await page.click('[data-testid="connect-btn"]');
    await connected.waitFor({ timeout: 10000 });
  }
  await page.waitForTimeout(300);
}

/** Wait until the connect tab status bar shows a connected state. */
export async function waitForWsConnected(
  page: Page,
  opts?: { timeout?: number; url?: string; mockPort?: number },
): Promise<void> {
  const badge = page.locator('[data-testid="status-badge"]');
  const port = opts?.mockPort ?? WS_DEFAULT_MOCK_PORT;
  const url = opts?.url ?? `ws://localhost:${port}`;
  try {
    await expect(badge).toHaveText(/^Connected$/i, {
      timeout: opts?.timeout ?? 10_000,
    });
  } catch {
    // Parallel specs stop a shared mock port after connectWsTo succeeds.
    await startWsMockViaApi(page, port);
    await connectWsTo(page, url, port);
    await expect(badge).toHaveText(/^Connected$/i, {
      timeout: opts?.timeout ?? 10_000,
    });
  }
}

/** Disconnect from the current WebSocket connection. */
export async function disconnectWs(page: Page): Promise<void> {
  const disconnectBtn = page.locator('[data-testid="disconnect-btn"]');
  if (!(await disconnectBtn.isVisible({ timeout: 500 }).catch(() => false))) {
    await switchWsLeftTab(page, 'connect');
  }
  await disconnectBtn.click();
  await page.locator('[data-testid="conn-tab-bar"] [aria-label*="disconnected"]').waitFor({ timeout: 5000 });
}

/**
 * Type and send a WebSocket message via the compose panel.
 * Reconnects automatically if the compose input is not enabled.
 */
export async function sendWsMessage(page: Page, msg: string): Promise<void> {
  await switchWsLeftTab(page, 'send');
  const input = page.locator('.ws-compose-input');
  try {
    await expect(input).toBeEnabled({ timeout: 5000 });
  } catch {
    await connectWsTo(page);
    await switchWsLeftTab(page, 'send');
    await expect(input).toBeEnabled({ timeout: 10000 });
  }
  await input.fill(msg);
  await page.click('[data-testid="send-btn"]');
  await page.waitForTimeout(500);
}

/**
 * Start the mock WS server via the backend helper API.
 * Optionally stops any existing server on that port first.
 */
export async function startWsMockViaApi(page: Page, port = WS_DEFAULT_MOCK_PORT): Promise<void> {
  await page.request.post('http://localhost:3001/api/ws/mock/start', {
    data: { port },
  }).catch(() => {});
  await page.waitForTimeout(500);
}

/** Stop the mock WS server via the backend helper API. */
export async function stopWsMockViaApi(page: Page, port = WS_DEFAULT_MOCK_PORT): Promise<void> {
  await page.request.post('http://localhost:3001/api/ws/mock/stop', {
    data: { port },
  }).catch(() => {});
}

/**
 * Start the mock server from within the Mock mode UI.
 * Switches to mock mode, stops any running server, then starts fresh.
 */
export async function startWsMockFromUI(page: Page): Promise<void> {
  const stopBtn = page.locator('[data-testid="mock-stop-btn"]');
  if (await stopBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await stopBtn.click();
    await page.waitForTimeout(500);
  }
  await page.click('[data-testid="mock-start-btn"]');
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid="mock-status-label"]')).toContainText(/running/i, { timeout: 5000 });
}

/** Stop the mock server from within the Mock mode UI (if running). */
export async function stopWsMockFromUI(page: Page): Promise<void> {
  const stopBtn = page.locator('[data-testid="mock-stop-btn"]');
  if (await stopBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await stopBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Reset mock server to a stopped state (UI + backend API).
 * Stops common mock ports used across WS E2E specs.
 */
export async function ensureWsMockStopped(
  page: Page,
  ports: number[] = [WS_DEFAULT_MOCK_PORT, WS_SECONDARY_MOCK_PORT, WS_TERTIARY_MOCK_PORT],
): Promise<void> {
  for (const port of ports) {
    await page.request.post('http://localhost:3001/api/ws/mock/stop', { data: { port } }).catch(() => {});
  }
  await stopWsMockFromUI(page);
  await page.waitForTimeout(400);
}

/**
 * Fail fast when a leftover HTTP process (e.g. `python -m http.server 9876`)
 * owns the mock echo port. Browsers resolve `localhost` to IPv6 first, so an
 * IPv6 HTTP server makes every `ws://localhost:9876` connect fail while the
 * Node mock may still report `running` on 127.0.0.1.
 */
export async function assertWsPortIsNotPlainHttp(port = WS_DEFAULT_MOCK_PORT): Promise<void> {
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${port}/`, {
        signal: AbortSignal.timeout(400),
      });
      const server = res.headers.get('server') ?? '';
      const contentType = res.headers.get('content-type') ?? '';
      if (server.includes('SimpleHTTP') || contentType.includes('text/html')) {
        throw new Error(
          `Port ${port} on ${host} is a plain HTTP server, not the WebSocket mock. ` +
          `Stop leftover processes (e.g. python -m http.server ${port}) and re-run.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('plain HTTP')) throw err;
    }
  }
}

/**
 * Shared `beforeAll` helper: ensures the WS mock echo server is running on the
 * given port. Call from `test.beforeAll` in any spec that needs the mock server.
 *
 * @example
 * test.beforeAll(async ({ browser }) => { await ensureWsMockServer(browser); });
 */
export async function ensureWsMockServer(
  browser: Browser,
  port = WS_DEFAULT_MOCK_PORT,
): Promise<void> {
  await assertWsPortIsNotPlainHttp(port);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const resp = await page.request.post('http://localhost:3001/api/ws/mock/start', {
    data: { port, rules: [], fallback: 'echo' },
  });
  if (!resp.ok()) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `Failed to start WS mock on port ${port} (${resp.status()}): ${body}. ` +
      `If the port is in use, stop the other process and re-run.`,
    );
  }
  await ctx.close();
}

/** Returns the active (visible) WebSocket connection pane locator. */
export function getActiveWsPane(page: Page) {
  return page.locator('[data-testid^="conn-tab-pane-"]:visible');
}

/** Returns the WS tab bar locator. */
export function getWsTabBar(page: Page) {
  return page.locator('[data-testid="conn-tab-bar"]');
}

/** Returns all WS connection tab locators. */
export function getWsTabs(page: Page) {
  return getWsTabBar(page).locator('[role="tab"]');
}

/** Returns the "add tab" button locator in the WS tab bar. */
export function getWsAddTabBtn(page: Page) {
  return page.locator('[data-testid="conn-tab-add"]');
}

/**
 * Select a CustomSelect option (portaled `.cs-menu`).
 * Prefer `value` (data-value) when known; otherwise match visible label text.
 */
export async function selectWsCustomSelect(
  page: Page,
  testId: string,
  option: { value?: string; label?: string },
): Promise<void> {
  const wrapper = page.getByTestId(testId);
  await wrapper.locator('.cs-trigger').click();
  const menu = page.locator('.cs-menu[role="listbox"]');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  if (option.value) {
    await menu.locator(`.cs-item[data-value="${option.value}"]`).click();
  } else if (option.label) {
    await menu.locator('.cs-item', { hasText: option.label }).first().click();
  } else {
    throw new Error('selectWsCustomSelect requires value or label');
  }
}

/** Open a portaled CustomSelect and return option `data-value` strings. */
export async function listWsCustomSelectOptions(page: Page, testId: string): Promise<string[]> {
  const wrapper = page.getByTestId(testId);
  await wrapper.locator('.cs-trigger').click();
  const menu = page.locator('.cs-menu[role="listbox"]');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  const values = await menu.locator('.cs-item[data-value]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-value')).filter((v): v is string => Boolean(v)),
  );
  await page.keyboard.press('Escape');
  return values;
}

/** Select a CustomSelect by the trigger's aria-label (no data-testid). */
export async function selectWsCustomSelectByAriaLabel(
  page: Page,
  ariaLabel: string,
  label: string,
): Promise<void> {
  await page.locator(`button[aria-label="${ariaLabel}"]`).first().click();
  const menu = page.locator('.cs-menu[role="listbox"]');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  await menu.locator('.cs-item', { hasText: label }).first().click();
}

/**
 * Select a WS filter-bar dropdown option (Size / Time / Content type).
 * These are custom button menus, not native `<select>` elements.
 */
export async function selectWsFilterDropdown(
  page: Page,
  testId: string,
  value: string,
): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByTestId(`${testId}-opt-${value}`).click();
}

/** Select a console category filter option (Handshake, All, …). */
export async function selectWsConsoleCategory(
  page: Page,
  value: string,
  variant: 'ws' | 'sse' = 'ws',
): Promise<void> {
  await page.getByTestId(`${variant}-console-category`).click();
  await page.getByTestId(`${variant}-console-category-opt-${value}`).click();
}
