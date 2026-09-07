/**
 * Shared helpers for Environment Manager expansion E2E (Phases 2–4).
 * Reuses seed patterns from helpers.ts and EM data-testids from src/shared/selectors.ts.
 */

import { expect, type Page } from '@playwright/test';
import { seedAppData, gotoAppTab } from './helpers';

export interface ProtocolEndpointSeed {
  websocket?: Record<string, { baseUrl: string }>;
  sse?: Record<string, { baseUrl: string }>;
  graphql?: Record<string, { baseUrl?: string; path?: string }>;
  grpc?: Record<string, { baseUrl: string; tls?: boolean }>;
}

export type EmProtocol = 'http' | 'websocket' | 'sse' | 'graphql' | 'grpc';

export interface SeedEnvironmentManagerOptions {
  /** HTTP base URL per env id (defaults to localhost dev server). */
  baseUrls?: Record<string, string>;
  protocolEndpoints?: ProtocolEndpointSeed;
  /** When set, controls which protocol tabs are visible (all protocols are opt-in). */
  enabledProtocols?: EmProtocol[];
  envName?: string;
  svcName?: string;
}

/** Seed env + microservice with optional per-protocol endpoints for EM / studio E2E. */
export async function seedEnvironmentManagerData(
  page: Page,
  options: SeedEnvironmentManagerOptions = {},
) {
  const envId = 'env-1';
  const svcId = 'svc-1';
  const envName = options.envName ?? 'test';
  const svcName = options.svcName ?? 'test-service';
  const baseUrls = options.baseUrls ?? { [envId]: 'http://localhost:5173' };
  const protocolEndpoints = options.protocolEndpoints;
  const enabledProtocols = options.enabledProtocols;

  await seedAppData(page);
  await page.addInitScript(
    ({ envId: eid, svcId: sid, envName: en, svcName: sn, baseUrls: bu, protocolEndpoints: pe, enabledProtocols: ep }) => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: eid, name: en }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: sid,
        name: sn,
        baseUrls: bu,
        ...(pe ? { protocolEndpoints: pe } : {}),
        ...(ep ? { enabledProtocols: ep } : {}),
      }]));
      localStorage.setItem('perf-test-v3-selected-env', eid);
      localStorage.setItem('perf-test-v3-selected-svc', sid);
    },
    { envId, svcId, envName, svcName, baseUrls, protocolEndpoints, enabledProtocols },
  );
}

export async function gotoEnvironmentManager(page: Page): Promise<void> {
  await gotoAppTab(page, 'environments');
  await expect(page.locator('.env-manager')).toBeVisible({ timeout: 20000 });
}

export async function expandMicroservice(page: Page, svcId = 'svc-1'): Promise<void> {
  const btn = page.getByTestId(`em-svc-configure-${svcId}`);
  await expect(btn).toBeVisible({ timeout: 10000 });
  await btn.click();
  await expect(page.getByTestId('microservice-protocol-panel')).toBeVisible({ timeout: 10000 });
}

/** Add a protocol tab via the "+ Add protocol" menu. No-op if already visible. */
export async function addProtocolTab(
  page: Page,
  protocol: EmProtocol,
): Promise<void> {
  const tab = page.getByTestId(`em-protocol-tab-${protocol}`);
  if (await tab.isVisible({ timeout: 500 }).catch(() => false)) return;
  await page.getByTestId('em-add-protocol-btn').click();
  await expect(page.getByTestId('em-add-protocol-menu')).toBeVisible({ timeout: 5000 });
  await page.getByTestId(`em-add-protocol-item-${protocol}`).click();
  await expect(tab).toBeVisible({ timeout: 5000 });
}

/** Ensure a protocol tab exists (all protocols are added on demand). */
export async function ensureProtocolTab(page: Page, protocol: EmProtocol): Promise<void> {
  await addProtocolTab(page, protocol);
}

export async function ensureAllProtocolTabs(page: Page): Promise<void> {
  for (const protocol of ['http', 'websocket', 'sse', 'graphql', 'grpc'] as const) {
    await addProtocolTab(page, protocol);
  }
}

export async function selectProtocolTab(page: Page, protocol: EmProtocol): Promise<void> {
  await ensureProtocolTab(page, protocol);
  await page.getByTestId(`em-protocol-tab-${protocol}`).click();
}

export async function expectHeaderProtocolIndicator(
  page: Page,
  opts: { status: 'explicit' | 'fallback' | 'unresolved'; urlFragment?: string },
): Promise<void> {
  const badge = page.getByTestId('header-protocol-indicator');
  await expect(badge).toBeVisible({ timeout: 10000 });
  await expect(badge).toHaveAttribute('data-status', opts.status);
  if (opts.urlFragment) {
    await expect(badge).toContainText(opts.urlFragment);
  }
}

export async function gotoWebSocketStudio(page: Page): Promise<void> {
  await gotoAppTab(page, 'websocket-studio');
  await expect(page.getByTestId('ws-studio')).toBeVisible({ timeout: 20000 });
}

export async function gotoSseStudio(page: Page): Promise<void> {
  await gotoAppTab(page, 'sse-studio');
  await expect(page.getByTestId('sse-studio')).toBeVisible({ timeout: 20000 });
}

export async function gotoGraphqlStudio(page: Page): Promise<void> {
  await gotoAppTab(page, 'graphql-studio');
  await expect(page.getByTestId('gql-studio-page')).toBeVisible({ timeout: 20000 });
}
