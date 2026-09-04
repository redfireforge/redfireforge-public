/**
 * Shared helpers for GraphQL Studio live E2E specs (port 4010 test server).
 *
 * Requires Vite dev server (5173). Docker GraphQL server on 4010 when
 * E2E_GRAPHQL_SERVER=1 or E2E_WITH_DOCKER=1 (see e2e/global-setup.ts).
 */

import { buildSchema, introspectionFromSchema } from 'graphql';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { GQL } from '../src/shared/selectors';

export const GQL_STUDIO_URL = '/?tab=graphql-studio';
export const GQL_HTTP = 'http://localhost:4010/graphql';
export const GQL_HEALTH = 'http://localhost:4010/health';
export const GQL_DEMO_ENV_NAME = 'GraphQL Demo';
export const GQL_DEMO_SVC_NAME = 'graphql-demo';

async function chooseCustomSelectByTestId(page: Page, testId: string, label: string): Promise<void> {
  const wrapper = page.getByTestId(testId);
  await wrapper.locator('.cs-trigger').click();
  await page.locator('.cs-menu .cs-item', { hasText: label }).first().click();
  await expect(wrapper.locator('.cs-text')).toContainText(label);
}

/** Seed GraphQL Demo env/svc so GQL-2 {{graphqlUrl}} resolves without running GQL-1 first. */
export async function seedGqlDemoEnvironmentForE2e(page: Page): Promise<void> {
  await page.addInitScript(({ envName, svcName }) => {
    const envId = 'env-gql-demo';
    const svcId = 'svc-gql-demo';
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: envId, name: envName }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: svcId,
      name: svcName,
      baseUrls: { [envId]: 'http://localhost:4010' },
      enabledProtocols: ['graphql'],
      protocolEndpoints: {
        graphql: { [envId]: { baseUrl: 'http://localhost:4010', path: '/graphql' } },
      },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', '[]');
    localStorage.setItem('perf-test-v3-selected-env', envId);
    localStorage.setItem('perf-test-v3-selected-svc', svcId);
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
    localStorage.setItem('redfire-onboarding-dismissed', JSON.stringify([
      'palette-drag', 'command-palette', 'node-config', 'connect-nodes', 'quick-test',
    ]));
  }, { envName: GQL_DEMO_ENV_NAME, svcName: GQL_DEMO_SVC_NAME });
}

/** Select GraphQL Demo / graphql-demo in the app header. */
export async function ensureGqlDemoHeaderSelected(page: Page): Promise<void> {
  await chooseCustomSelectByTestId(page, 'header-env-select', GQL_DEMO_ENV_NAME);
  await chooseCustomSelectByTestId(page, 'header-svc-select', GQL_DEMO_SVC_NAME);
}

/** Ensure studio endpoint uses {{graphqlUrl}} with a resolved preview (GQL-2 E2E bootstrap). */
export async function ensureGql2StudioEndpoint(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="gql-endpoint-input"]', { timeout: 30_000 });
  const input = page.getByTestId('gql-endpoint-input');
  const val = await input.inputValue();
  if (!val.includes('graphqlUrl')) {
    await fillEndpoint(page, '{{graphqlUrl}}');
  }
  await expect(page.getByTestId('gql-endpoint-preview')).toBeVisible({ timeout: 15_000 });
}

/** Ensure studio endpoint is the literal Docker URL (GQL-3 E2E bootstrap). */
export async function ensureGql3StudioEndpoint(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="gql-endpoint-input"]', { timeout: 30_000 });
  const input = page.getByTestId('gql-endpoint-input');
  const val = await input.inputValue();
  // Must include /graphql — bare http://localhost:4010 POSTs to / and returns 404.
  if (val !== GQL_HTTP) {
    await fillEndpoint(page, GQL_HTTP);
  }
}

export async function isGraphqlServerHealthy(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(GQL_HEALTH, { timeout: 5_000 });
    if (!res.ok()) return false;
    const body = (await res.json()) as { status?: string };
    if (body.status !== 'ok') return false;

    // Guard Docker-gated E2E against partial startup states where /health is up
    // but /graphql still refuses connections.
    const gql = await request.post(GQL_HTTP, {
      timeout: 5_000,
      headers: { 'Content-Type': 'application/json' },
      data: { query: 'query __E2EHealth { __typename }' },
    });
    return gql.ok();
  } catch {
    return false;
  }
}

export async function silenceLogStream(page: Page) {
  await page.route('**/api/logs/stream*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: '',
    }),
  );
}

/**
 * Build a raw /__proxy envelope from upstream HTTP status and body.
 *
 * The /__proxy bridge always returns HTTP 200 to the browser; the real
 * upstream HTTP status and body are encoded as JSON inside the response body.
 * This is the exact format that `httpFetchViaViteProxy` (src) expects.
 */
export function makeProxyEnvelope(
  upstreamStatus: number,
  upstreamBody: string,
  upstreamHeaders: Record<string, string> = { 'content-type': 'application/json' },
): string {
  return JSON.stringify({
    status: upstreamStatus,
    statusText: upstreamStatus === 200 ? 'OK' : String(upstreamStatus),
    headers: upstreamHeaders,
    body: upstreamBody,
    timing: { dnsLookup: 0, tcpConnect: 0, tlsHandshake: 0, ttfb: 1, download: 1, total: 2 },
  });
}

/**
 * Wrap a GraphQL JSON response object in the /__proxy envelope.
 *
 * Usage:
 *   await mockProxy(page, { data: { user: { id: '1' } } });
 *   await mockProxy(page, { error: 'Unauthorized' }, 401);
 */
export function makeProxyResponse(gqlBody: object, httpStatus = 200): string {
  return makeProxyEnvelope(httpStatus, JSON.stringify(gqlBody));
}

/**
 * Mock the /__proxy endpoint so all outbound GQL requests return the given body.
 *
 * In web mode, ALL outbound HTTP goes through POST /__proxy. This intercepts
 * browser→proxy requests and returns a response in HttpResponse format.
 * The `httpStatus` param is the upstream server's HTTP status (200, 401, etc.).
 */
export async function mockProxy(page: Page, gqlBody: object, httpStatus = 200): Promise<void> {
  await page.route('**/__proxy', (route) =>
    route.fulfill({
      status: 200, // /__proxy bridge always returns 200; upstream status is in body.status
      contentType: 'application/json',
      body: makeProxyResponse(gqlBody, httpStatus),
    }),
  );
}

/**
 * Navigate to GraphQL Studio (offline/mocked mode — no live server needed).
 * Silences the log stream to prevent ECONNREFUSED errors in CI.
 */
export async function gotoGqlStudioOffline(page: Page): Promise<void> {
  await silenceLogStream(page);
  await page.goto(GQL_STUDIO_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="gql-studio-page"]')).toBeVisible({ timeout: 15_000 });
}

interface ProxyPayload {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function isLiveGraphqlUrl(url: string): boolean {
  return url.includes('localhost:4010') || url.includes('127.0.0.1:4010');
}

/** Passthrough WebSocket for the live GraphQL test server (subscriptions). */
export async function setupLiveWebSocket(page: Page) {
  const passthrough = (ws: Parameters<Parameters<Page['routeWebSocket']>[1]>[0]) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(message));
  };
  // Web app normalizes loopback to 127.0.0.1 — route both hostnames.
  await page.routeWebSocket('ws://localhost:4010/graphql', passthrough);
  await page.routeWebSocket('ws://127.0.0.1:4010/graphql', passthrough);
}

/**
 * Intercept /__proxy: forward localhost:4010 via Playwright request (never route.fetch).
 */
export async function setupLiveProxy(page: Page, request: APIRequestContext) {
  await page.route('**/__proxy', async (route) => {
    const bodyStr = route.request().postData() ?? '';
    let payload: ProxyPayload | null;
    try {
      payload = JSON.parse(bodyStr) as ProxyPayload;
    } catch {
      payload = null;
    }

    const targetUrl = payload?.url ?? '';
    const shouldForward =
      isLiveGraphqlUrl(targetUrl) ||
      bodyStr.includes('localhost:4010') ||
      bodyStr.includes('127.0.0.1:4010');

    if (!shouldForward) {
      return route.abort('failed');
    }

    try {
      const url = targetUrl || GQL_HTTP;
      const method = (payload?.method ?? 'POST').toUpperCase();
      const headers = { ...(payload?.headers ?? {}) };
      if (method === 'GET') {
        const res = await request.get(url, { headers });
        const text = await res.text();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeProxyEnvelope(res.status(), text),
        });
      }
      const res = await request.post(url, {
        headers: { 'Content-Type': 'application/json', ...headers },
        data: payload?.body ? JSON.parse(payload.body) : {},
      });
      const text = await res.text();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: makeProxyEnvelope(res.status(), text),
      });
    } catch {
      return route.abort('failed');
    }
  });
}

export async function seedGqlStudioSettings(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript((extra) => {
    localStorage.setItem(
      'gql_adv_settings_v1',
      JSON.stringify({
        apqEnabled: false,
        apqUseGet: false,
        batchEnabled: false,
        batchTimeoutMs: 30000,
        dedupEnabled: false,
        complexityBlockEnabled: false,
        complexityBlockThreshold: 1000,
        subscriptionTransport: 'graphql-transport-ws',
        sseMode: 'distinct',
        wsEndpointOverride: '',
        historyMaxItems: 100,
        subscriptionBufferSize: 5000,
        maxFileSizeMb: 50,
        ...extra,
      }),
    );
  }, overrides);
}

export async function gotoGqlStudio(page: Page, request?: APIRequestContext) {
  await seedGqlStudioSettings(page);
  await silenceLogStream(page);
  if (request) {
    await setupLiveProxy(page, request);
    await setupLiveWebSocket(page);
  }
  await page.goto(GQL_STUDIO_URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[data-testid="gql-studio-page"]')).toBeVisible({ timeout: 15_000 });
}

export async function fillEndpoint(page: Page, url: string) {
  const input = page.locator('[data-testid="gql-endpoint-input"]');
  await input.fill(url);
  await input.press('Tab');
  await page.waitForTimeout(300);
}

export async function fillMonacoEditor(page: Page, query: string, editorTestId = 'gql-editor') {
  await page.waitForSelector(`[data-testid="${editorTestId}"] .monaco-editor`, { timeout: 8_000 });
  const editor = page.locator(`[data-testid="${editorTestId}"] .monaco-editor`).first();
  await editor.click();
  const wroteViaMonacoModel = await page.evaluate((args: { query: string }) => {
    const w = window as unknown as Record<string, unknown>;
    const monaco = w['monaco'] as {
      editor?: { getModels?: () => { uri: { toString: () => string }; getValue: () => string; setValue: (value: string) => void }[] };
    };
    const models = monaco?.editor?.getModels?.() ?? [];
    const model = models.find((mod) => mod.uri.toString().includes('inmemory://graphql/'));
    if (!model) return false;
    model.setValue(args.query);
    return true;
  }, { query });

  if (!wroteViaMonacoModel) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(query, { delay: 15 });
  }

  const needle = query.slice(0, Math.min(24, query.length));
  await page.waitForFunction(
    (args: { snippet: string; testId: string }) => {
      const w = window as unknown as Record<string, unknown>;
      const monaco = w['monaco'] as {
        editor?: { getModels?: () => { uri: { toString: () => string }; getValue: () => string }[] };
      };
      const models = monaco?.editor?.getModels?.() ?? [];
      const model = models.find((mod) => mod.uri.toString().includes('inmemory://graphql/'));
      if ((model?.getValue() ?? '').includes(args.snippet)) {
        return true;
      }

      const textarea = document
        .querySelector(`[data-testid="${args.testId}"] .monaco-editor textarea`) as HTMLTextAreaElement | null;
      return (textarea?.value ?? '').includes(args.snippet);
    },
    { snippet: needle, testId: editorTestId },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
}

export async function introspectSchema(page: Page) {
  await page.locator('[data-testid="gql-introspect-btn"]').click();
  await expect(page.locator('[data-testid="gql-schema-badge-ok"]')).toBeVisible({ timeout: 25_000 });
}

/** Introspect via Schema tab (idle or re-introspect) — reliable with /__proxy mocks. */
export async function introspectSchemaFromPanel(page: Page) {
  await gotoSchemaTab(page);
  const idleBtn = page.locator('[data-testid="gql-se-idle-introspect-btn"]');
  const reBtn = page.locator('[data-testid="gql-se-reintrospect-btn"]');
  if (await idleBtn.isVisible().catch(() => false)) {
    await idleBtn.click();
  } else if (await reBtn.isVisible().catch(() => false)) {
    await reBtn.click();
  } else {
    await page.locator('[data-testid="gql-introspect-btn"]').click();
  }
  await expect(page.locator('[data-testid="gql-schema-badge-ok"]')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('[data-testid="gql-se-type-list"]')).toBeVisible({ timeout: 10_000 });
}

export async function gotoSchemaTab(page: Page) {
  await page.locator('[data-testid="gql-right-tab-schema"]').click();
  await expect(page.locator('[data-testid="gql-schema-explorer"]')).toBeVisible({ timeout: 5_000 });
}

export async function executeQuery(page: Page, query: string) {
  await fillMonacoEditor(page, query);
  await page.locator('[data-testid="gql-execute-btn"]:not([disabled])').waitFor({ timeout: 5_000 }).catch(() => {});
  await page.locator('[data-testid="gql-execute-btn"]').click();
  await expect(page.locator('[data-testid="gql-response-viewer"]')).toBeVisible({ timeout: 15_000 });
}

export async function openBuilderMode(page: Page) {
  await page.locator('[data-testid="gql-mode-builder"]').click();
  await expect(page.locator('[data-testid="gql-qb-field-tree"]')).toBeVisible({ timeout: 8_000 });
}

/** Create an order via the live test server and return its id. */
export async function createTestOrder(request: APIRequestContext): Promise<string> {
  const resp = await request.post(GQL_HTTP, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      query: 'mutation($input: OrderInput!) { createOrder(input: $input) { id status } }',
      variables: { input: { customerId: 'cust-e2e', items: ['widget'] } },
    },
  });
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as { data?: { createOrder?: { id: string } }; errors?: unknown[] };
  expect(body.errors).toBeUndefined();
  const id = body.data?.createOrder?.id;
  expect(id).toBeTruthy();
  return id!;
}

export function subscriptionQuery(orderId: string): string {
  return `subscription { orderStatus(orderId: "${orderId}") { status updatedAt } }`;
}

// ── Phase 6 multi-tab E2E helpers (6B-4) ─────────────────────────────────────

/** Build a full introspection payload that `buildClientSchema` can parse. */
function buildE2eIntrospection(sdl: string): Record<string, unknown> {
  return introspectionFromSchema(buildSchema(sdl)) as unknown as Record<string, unknown>;
}

/** Distinct staging schema — StagingWidget type visible in explorer. */
export const GQL_E2E_INTROSPECT_STAGING = buildE2eIntrospection(`
  type Query {
    stagingHealth: String
  }
  type StagingWidget {
    id: ID!
  }
`);

/** Distinct prod schema — ProdGadget type visible in explorer. */
export const GQL_E2E_INTROSPECT_PROD = buildE2eIntrospection(`
  type Query {
    prodHealth: String
  }
  type ProdGadget {
    id: ID!
  }
`);

/** Clear persisted tabs/endpoint so each spec starts with one blank tab. */
export async function seedGqlStudioCleanState(page: Page) {
  await seedGqlStudioSettings(page);
  await page.addInitScript(() => {
    localStorage.removeItem('gql_tabs_v1');
    localStorage.removeItem('gql_endpoint_v1');
    localStorage.removeItem('gql_endpoint_base_v1');
  });
}

/** Seed named connection profiles for Phase 6F E2E (gql_profiles_v1). Call before goto. */
export async function seedGqlConnectionProfiles(
  page: Page,
  profiles: Array<{ id: string; name: string; endpoint: string; auth: { type: string; token?: string } | null; createdAt: number }>,
) {
  await page.addInitScript((profList) => {
    localStorage.setItem('gql_profiles_v1', JSON.stringify(profList));
  }, profiles);
}

export async function openGqlProfileModal(page: Page) {
  await page.locator('[data-testid="gql-profile-badge"]').click();
  await expect(page.locator('[data-testid="gql-profile-modal"]')).toBeVisible({ timeout: 5_000 });
}

/** Load a saved profile onto the active tab (Phase 6F). */
export async function loadGqlProfileOnActiveTab(page: Page, profileName: string) {
  await openGqlProfileModal(page);
  await page.getByRole('button', { name: `Load profile: ${profileName}` }).click();
  await expect(page.locator('[data-testid="gql-profile-loaded-badge"]').first()).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="gql-profile-close-btn"]').click();
  await expect(page.locator('[data-testid="gql-profile-modal"]')).toBeHidden({ timeout: 5_000 });
}

/** Returns true when schema polling toggle is active on the connection bar. */
export async function isGqlPollingEnabled(page: Page): Promise<boolean> {
  const btn = page.locator('[data-testid="gql-polling-config-btn"], [data-testid="gql-polling-config-btn-standalone"]').first();
  if (!(await btn.isVisible().catch(() => false))) return false;
  const cls = await btn.getAttribute('class') ?? '';
  return cls.includes('gql-polling-config-btn--active');
}

/** Enable or disable schema polling on the active tab via the connection bar popover. */
export async function setGqlPollingEnabled(page: Page, enabled: boolean) {
  const btn = page.locator('[data-testid="gql-polling-config-btn"], [data-testid="gql-polling-config-btn-standalone"]').first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
  await expect(page.locator('[data-testid="gql-polling-popover"]')).toBeVisible({ timeout: 5_000 });
  const toggle = page.locator('[data-testid="gql-polling-toggle"]');
  const isOn = (await toggle.getAttribute('class') ?? '').includes('gql-polling-switch--on');
  if (isOn !== enabled) {
    await toggle.click();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="gql-polling-popover"]')).toBeHidden({ timeout: 5_000 });
}

export async function gotoGqlStudioFresh(page: Page) {
  await seedGqlStudioCleanState(page);
  await silenceLogStream(page);
  await page.goto(GQL_STUDIO_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="gql-studio-page"]')).toBeVisible({ timeout: 15_000 });
}

export async function addGqlTab(page: Page) {
  const tabs = page.locator('[data-testid="gql-tab-bar"] [role="tab"]');
  const before = await tabs.count();
  await page.locator('[data-testid="gql-tab-add-btn"]').click();
  await expect(tabs).toHaveCount(before + 1, { timeout: 5_000 });
}

export async function clickGqlTabByIndex(page: Page, index: number) {
  const tab = page.locator('[data-testid="gql-tab-bar"] [role="tab"]').nth(index);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
}

/** Tab ids from the tab bar (e.g. `gql-tab-1`). */
export async function getGqlTabIds(page: Page): Promise<string[]> {
  const tabs = page.locator('[data-testid="gql-tab-bar"] [role="tab"]');
  const count = await tabs.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await tabs.nth(i).getAttribute('data-testid');
    if (testId?.startsWith('gql-tab-')) {
      ids.push(testId.slice('gql-tab-'.length));
    }
  }
  return ids;
}

/** Set Monaco query text for a specific tab model. */
export async function fillMonacoEditorForTab(page: Page, tabId: string, query: string) {
  const modelUri = `inmemory://graphql/${tabId}`;
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      const monaco = w['monaco'] as { editor?: { getModels?: () => unknown[] } } | undefined;
      return (monaco?.editor?.getModels?.()?.length ?? 0) > 0;
    },
    { timeout: 8_000 },
  );
  await page.evaluate(
    ({ uri, q }: { uri: string; q: string }) => {
      const w = window as unknown as Record<string, unknown>;
      const monaco = w['monaco'] as {
        editor?: { getModels?: () => { uri: { toString: () => string }; setValue: (v: string) => void }[] };
      };
      const model = monaco?.editor?.getModels?.().find((m) => m.uri.toString() === uri);
      model?.setValue(q);
    },
    { uri: modelUri, q: query },
  );
  await page.waitForTimeout(300);
}

export async function executeQueryOnTab(
  page: Page,
  tabId: string,
  endpoint: string,
  query: string,
) {
  await fillEndpoint(page, endpoint);
  await fillMonacoEditorForTab(page, tabId, query);
  await page.locator('[data-testid="gql-execute-btn"]:not([disabled])').waitFor({ timeout: 8_000 }).catch(() => {});
  await page.locator('[data-testid="gql-execute-btn"]').click();
  await expect(page.locator('[data-testid="gql-response-viewer"]')).toBeVisible({ timeout: 15_000 });
}

interface DualEndpointProxyOptions {
  stagingQueryData: Record<string, unknown>;
  prodQueryData: Record<string, unknown>;
  stagingSchema?: Record<string, unknown>;
  prodSchema?: Record<string, unknown>;
  /** Artificial delay (ms) for staging query responses — Phase 6E background loading E2E. */
  stagingQueryDelayMs?: number;
}

/**
 * Route /__proxy responses by upstream URL — staging vs prod endpoints (Phase 6B-4).
 */
export async function setupDualEndpointGraphqlProxy(page: Page, opts: DualEndpointProxyOptions) {
  const {
    stagingQueryData,
    prodQueryData,
    stagingSchema = GQL_E2E_INTROSPECT_STAGING,
    prodSchema = GQL_E2E_INTROSPECT_PROD,
    stagingQueryDelayMs = 0,
  } = opts;

  await page.route('**/__proxy', async (route) => {
    const bodyStr = route.request().postData() ?? '';
    let targetUrl: string;
    try {
      const payload = JSON.parse(bodyStr) as { url?: string };
      targetUrl = payload.url ?? '';
    } catch {
      targetUrl = '';
    }

    const isIntrospection = bodyStr.includes('__schema') || bodyStr.includes('IntrospectionQuery');
    const isProd = targetUrl.includes('prod.example.com');
    const isStaging = targetUrl.includes('staging.example.com');

    let gqlResponse: Record<string, unknown>;
    if (isIntrospection) {
      gqlResponse = { data: isProd ? prodSchema : stagingSchema };
    } else if (isProd) {
      gqlResponse = prodQueryData;
    } else if (isStaging) {
      if (stagingQueryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, stagingQueryDelayMs));
      }
      gqlResponse = stagingQueryData;
    } else {
      gqlResponse = stagingQueryData;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: makeProxyResponse(gqlResponse),
    });
  });
}

/** Open Advanced Settings → Batch tab (Phase 6G). */
export async function openGqlAdvancedSettingsBatchTab(page: Page): Promise<void> {
  await page.locator(GQL.ADV_SETTINGS_BTN).click();
  await expect(page.locator(GQL.ADV_SETTINGS_TAB_BATCH)).toBeVisible({ timeout: 15_000 });
  await page.locator(GQL.ADV_SETTINGS_TAB_BATCH).click();
  await expect(page.locator(GQL.ADV_BATCH_ENABLE_TOGGLE)).toBeVisible({ timeout: 10_000 });
}

/** Enable batch mode and wait for the batch settings panel (Phase 6G-7). */
export async function enableGqlBatchInAdvancedSettings(page: Page): Promise<void> {
  await openGqlAdvancedSettingsBatchTab(page);
  const checkbox = page.locator(GQL.ADV_BATCH_ENABLE);
  if (!(await checkbox.isChecked())) {
    await page.locator(GQL.ADV_BATCH_ENABLE_TOGGLE).click();
  }
  await expect(page.locator(GQL.ADV_BATCH_PANEL)).toBeVisible({ timeout: 10_000 });
}
