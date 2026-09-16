/**
 * graphql-mock-server.spec.ts — E2E tests for GraphQL Studio mock server (Phase 4, task 4F-10).
 *
 * ── What is tested ────────────────────────────────────────────────────────────
 *
 * 1. Mock activity tab is enabled on local Vite (localhost is a desktop runtime)
 * 2. Mock server enabled via proxy API — query returns schema-aware mock data
 * 3. Fixed resolver override (API config) returns the configured value in UI response
 * 4. Global latency (API config) adds measurable delay to responses
 * 5. Mock disabled — queries to the real endpoint work again
 *
 * ── Architecture notes ────────────────────────────────────────────────────────
 *
 * The mock panel UI is gated by `isDesktopRuntimeAvailable()` (Tauri, E2E
 * desktop shim, or a local clone on localhost). Hosted / remote web stays
 * disabled — that path is covered by unit tests.
 * E2E configures the mock server through the real Node proxy API at port 3001
 * (same path the desktop app uses) and verifies behavior via GraphQL Studio
 * query execution UI.
 *
 * Introspection / real-endpoint traffic is intercepted on POST /__proxy; mock
 * endpoint traffic (localhost:3001/api/graphql/mock) passes through.
 *
 * Requires: Vite dev server (5173) + Node proxy (3001).
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { makeProxyEnvelope, makeProxyResponse, silenceLogStream } from './graphql-helpers';

const GQL_URL = '/?tab=graphql-studio';
const TEST_ENDPOINT = 'https://api.example.com/graphql';
// Absolute URL so the UI routes through /__proxy (httpFetchViaViteProxy).
// Playwright's **/__proxy route interception is reliable; Vite's /api proxy can hang
// in headless Chromium for POST requests.
const MOCK_ENDPOINT = 'http://localhost:3001/api/graphql/mock';
const PROXY_HEALTH = 'http://localhost:3001/health';
const MOCK_CONFIG_URL = 'http://localhost:3001/api/graphql/mock/config';

const USER_QUERY = 'query GetUser { user(id: "u1") { name email } }';

const MOCK_SDL = `
  type Query {
    user(id: ID!): User
  }
  type User {
    id: ID!
    name: String
    email: String
  }
`;

/** Real-endpoint response used when mock mode is OFF */
const REAL_ENDPOINT_RESPONSE = {
  data: {
    user: { id: 'u-123', name: 'Alice Tester', email: 'alice@example.com' },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// silenceLogStream, makeProxyEnvelope, makeProxyResponse imported from graphql-helpers

let backendAvailable = false;
function isMockEndpointUrl(url: string): boolean {
  return url.includes('/api/graphql/mock') || url.includes('localhost:3001') || url.includes('127.0.0.1:3001');
}

function isRealTestEndpointUrl(url: string): boolean {
  return url.includes('api.example.com');
}

function parseProxyPayload(bodyStr: string): ProxyPayload | null {
  try {
    return JSON.parse(bodyStr) as ProxyPayload;
  } catch {
    return null;
  }
}

/**
 * Intercept all /__proxy requests:
 * - Mock endpoint (localhost:3001/api/graphql/mock): forward directly to backend via test
 *   API context and return a properly-shaped /__proxy envelope. This avoids Vite's proxy
 *   layer entirely for the mock endpoint, which can hang in Playwright headless Chromium.
 * - Real test endpoint (api.example.com): return hardcoded mock data.
 * - Everything else: pass through to the real Vite proxy middleware.
 */
async function setupSmartProxy(page: Page, request: APIRequestContext) {
  await page.route('**/__proxy', async (route) => {
    const bodyStr = route.request().postData() ?? '';
    const payload = parseProxyPayload(bodyStr);
    const targetUrl = payload?.url ?? '';

    // Mock endpoint: forward to backend via Playwright API context (not Vite proxy).
    // Vite's /__proxy passthrough can hang in headless Chromium for localhost POSTs.
    if (isMockEndpointUrl(targetUrl) || bodyStr.includes('/api/graphql/mock')) {
      try {
        let gqlBody: Record<string, unknown> = {};
        if (payload?.body) {
          try {
            gqlBody = JSON.parse(payload.body) as Record<string, unknown>;
          } catch { /* use empty body */ }
        }
        const res = await request.post(MOCK_ENDPOINT, {
          headers: { 'Content-Type': 'application/json', ...(payload?.headers ?? {}) },
          data: gqlBody,
        });
        const gqlText = await res.text();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeProxyEnvelope(res.status(), gqlText),
        });
      } catch {
        return route.abort('failed');
      }
    }

    if (isRealTestEndpointUrl(targetUrl) || bodyStr.includes('api.example.com')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: makeProxyResponse(REAL_ENDPOINT_RESPONSE),
      });
    }

    // Never route.continue() — it can hang on /__proxy in Playwright. Fetch + fulfill instead.
    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } catch {
      await route.abort('failed');
    }
  });
}

interface MockConfigOptions {
  enabled?: boolean;
  resolvers?: Record<string, Record<string, { type: 'fixed' | 'random' | 'error' | 'script'; value?: unknown; message?: string; code?: string }>>;
  globalLatencyMs?: number;
  jitterMs?: number;
}

async function configureMockServer(request: APIRequestContext, options: MockConfigOptions = {}) {
  const {
    enabled = true,
    resolvers = {},
    globalLatencyMs = 0,
    jitterMs = 0,
  } = options;

  const res = await request.post(MOCK_CONFIG_URL, {
    data: {
      sdl: MOCK_SDL,
      config: {
        connectionId: 'e2e-mock',
        enabled,
        resolvers,
        globalLatencyMs,
        jitterMs,
      },
    },
  });
  expect(res.ok()).toBeTruthy();
}

async function resetMockServer(request: APIRequestContext) {
  await request.post(MOCK_CONFIG_URL, { data: { enabled: false } }).catch(() => {});
}

async function seedGqlStudioSettings(page: Page) {
  // Disable dedup/APQ so execute sends a single predictable POST through /__proxy.
  await page.addInitScript(() => {
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
        subscriptionTransport: 'auto',
        sseMode: 'distinct',
        wsEndpointOverride: '',
        historyMaxItems: 100,
        subscriptionBufferSize: 5000,
        maxFileSizeMb: 50,
      }),
    );
  });
}

async function gotoGqlStudio(page: Page) {
  await seedGqlStudioSettings(page);
  await silenceLogStream(page);
  await page.goto(GQL_URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[data-testid="gql-studio-page"]')).toBeVisible({ timeout: 15000 });
}

/**
 * Studio mount posts `{ enabled: false }` (connection switch). Configure the
 * companion after the page is up so that disable does not clobber E2E setup.
 */
async function openStudioAndEnableMock(
  page: Page,
  request: APIRequestContext,
  options: MockConfigOptions = {},
) {
  await setupSmartProxy(page, request);
  await gotoGqlStudio(page);
  // Connection-switch disable is async; wait for it before we re-enable.
  await page.waitForTimeout(400);
  await configureMockServer(request, { enabled: true, ...options });
  await expect.poll(async () => {
    const res = await request.get('http://localhost:3001/api/graphql/mock/status');
    if (!res.ok()) return false;
    const status = await res.json() as { enabled?: boolean };
    return status.enabled === true;
  }, { timeout: 8_000 }).toBe(true);
  await fillEndpoint(page, MOCK_ENDPOINT);
}

async function fillEndpoint(page: Page, url: string) {
  const input = page.locator('[data-testid="gql-endpoint-input"]');
  await input.fill(url);
  await page.waitForTimeout(300);
}

async function fillMonacoEditor(page: Page, query: string) {
  await page.waitForSelector('[data-testid="gql-editor"] .monaco-editor', { timeout: 8000 });
  const editor = page.locator('[data-testid="gql-editor"] .monaco-editor').first();
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(query, { delay: 15 });
  // Confirm Monaco model reflects the typed query before Execute reads React tab state.
  const needle = query.slice(0, Math.min(24, query.length));
  await page.waitForFunction(
    (snippet: string) => {
      const w = window as unknown as Record<string, unknown>;
      const monaco = w['monaco'] as { editor?: { getModels?: () => { uri: { toString: () => string }; getValue: () => string }[] } };
      const models = monaco?.editor?.getModels?.() ?? [];
      const model = models.find((mod) => mod.uri.toString().includes('inmemory://graphql/'));
      return (model?.getValue() ?? '').includes(snippet);
    },
    needle,
    { timeout: 5000 },
  );
  await page.waitForTimeout(300);
}

async function executeQuery(page: Page, query = USER_QUERY) {
  await fillMonacoEditor(page, query);
  await page.locator('[data-testid="gql-execute-btn"]:not([disabled])').waitFor({ timeout: 5000 }).catch(() => {});
  await page.locator('[data-testid="gql-execute-btn"]').click();
  await expect(page.locator('[data-testid="gql-response-viewer"]')).toBeVisible({ timeout: 15000 });
}

function parseLatencyMs(text: string): number {
  const match = text.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

// ── Suite setup ───────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial', timeout: 90_000 });

test.beforeAll(async ({ request }) => {
  const res = await request.get(PROXY_HEALTH).catch(() => null);
  backendAvailable = res?.ok() ?? false;
});

test.beforeEach(async ({ request }) => {
  if (!backendAvailable) {
    test.skip();
    return;
  }
  await resetMockServer(request);
});

test.afterEach(async ({ request }) => {
  if (backendAvailable) {
    await resetMockServer(request);
  }
});

// ── Suite 1: Web guard ────────────────────────────────────────────────────────

test.describe('GraphQL Mock Server — local web runtime', () => {
  test('mock activity tab is enabled on localhost (local clone)', async ({ page }) => {
    await gotoGqlStudio(page);
    const mockTab = page.locator('[data-testid="gql-activity-mock"]');
    await expect(mockTab).toBeEnabled();
    await expect(mockTab).toHaveAttribute('aria-label', /^Mock$/);
  });
});

// ── Suite 2: Mock server API + UI execution ─────────────────────────────────

test.describe('GraphQL Mock Server — mock mode ON', () => {
  test.beforeEach(async ({ page, request }) => {
    await openStudioAndEnableMock(page, request);
  });

  test('query against mock endpoint returns schema-aware data', async ({ page }) => {
    await executeQuery(page);

    const body = page.locator('[data-testid="gql-response-body"]');
    await expect(body).toContainText('"user"', { timeout: 12000 });
    await expect(body).not.toContainText('MOCK_NOT_ENABLED');
    await expect(page.locator('[data-testid="gql-response-status"]')).toContainText('200');
  });

  test('mock status API reports enabled after configuration', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/graphql/mock/status');
    expect(res.ok()).toBeTruthy();
    const status = await res.json() as { enabled: boolean; configured: boolean };
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(true);
  });
});

// ── Suite 3: Fixed resolver override ────────────────────────────────────────

test.describe('GraphQL Mock Server — fixed resolver override', () => {
  test('fixed User.name resolver returns configured value in UI response', async ({ page, request }) => {
    await openStudioAndEnableMock(page, request, {
      resolvers: {
        User: { name: { type: 'fixed', value: 'MockAlice' } },
      },
    });
    await executeQuery(page);

    await expect(page.locator('[data-testid="gql-response-body"]')).toContainText('MockAlice', { timeout: 12000 });
  });
});

// ── Suite 4: Latency ──────────────────────────────────────────────────────────

test.describe('GraphQL Mock Server — latency', () => {
  test('global latency adds measurable delay to mock responses', async ({ page, request }) => {
    await openStudioAndEnableMock(page, request, { globalLatencyMs: 0, jitterMs: 0 });
    await executeQuery(page);
    const baselineText = await page.locator('[data-testid="gql-response-latency"]').textContent() ?? '0';
    expect(parseLatencyMs(baselineText)).toBeLessThan(200);

    await configureMockServer(request, { enabled: true, globalLatencyMs: 500, jitterMs: 0 });
    const directStart = Date.now();
    const directRes = await request.post(MOCK_ENDPOINT, {
      data: { query: USER_QUERY },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(directRes.ok()).toBeTruthy();
    const directBody = await directRes.json() as { extensions?: { latencyMs?: number } };
    const directElapsed = Date.now() - directStart;
    const serverLatency = directBody.extensions?.latencyMs ?? directElapsed;
    expect(serverLatency).toBeGreaterThanOrEqual(450);

    await page.waitForTimeout(400);
    await executeQuery(page, `${USER_QUERY}\n`);

    const logRes = await request.get('http://localhost:3001/api/graphql/mock/log?limit=1');
    expect(logRes.ok()).toBeTruthy();
    const log = await logRes.json() as { entries: Array<{ latencyMs: number }> };
    expect(log.entries[0]?.latencyMs ?? 0).toBeGreaterThanOrEqual(450);

    expect(log.entries[0]?.latencyMs ?? 0).toBeGreaterThanOrEqual(450);
  });
});

// ── Suite 5: Mock OFF restores real endpoint ───────────────────────────────────

test.describe('GraphQL Mock Server — restore real endpoint', () => {
  test('disabling mock allows queries to the real endpoint again', async ({ page, request }) => {
    await openStudioAndEnableMock(page, request);
    await executeQuery(page);
    await expect(page.locator('[data-testid="gql-response-body"]')).toContainText('"user"');

    await resetMockServer(request);
    await fillEndpoint(page, TEST_ENDPOINT);
    await executeQuery(page);

    await expect(page.locator('[data-testid="gql-response-body"]')).toContainText('Alice Tester', { timeout: 12000 });
    await expect(page.locator('[data-testid="gql-response-body"]')).not.toContainText('MOCK_NOT_ENABLED');
  });
});
