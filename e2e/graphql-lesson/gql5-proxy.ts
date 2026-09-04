import type { APIRequestContext, Page } from '@playwright/test';
import { GQL_HTTP, makeProxyEnvelope } from '../graphql-helpers';
import { GQL_TLS_HEALTH, GQL_TLS_HTTPS, GQL_TLS_MTLS_HEALTH, GQL_TLS_MTLS_HTTPS } from './constants';

type Gql5ProxyPayload = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/** Resolves whether a Playwright __proxy payload targets TLS, mTLS, or Docker GraphQL. */
export function resolveGql5ProxyTarget(
  url: string,
  bodyStr: string,
): { forward: boolean; url: string } {
  if (url.includes('4445') || bodyStr.includes('4445')) {
    return { forward: true, url: url.includes('4445') ? url : GQL_TLS_MTLS_HTTPS };
  }
  if (url.includes('4443') || bodyStr.includes('4443')) {
    return { forward: true, url: url.includes('4443') ? url : GQL_TLS_HTTPS };
  }
  if (url.includes('4010') || bodyStr.includes('4010')) {
    return { forward: true, url: url.includes('4010') ? url : GQL_HTTP };
  }
  return { forward: false, url };
}

/**
 * Legacy Playwright __proxy mock for environments without real Docker TLS stacks.
 * Full GQL-5 E2E uses the real Vite __proxy middleware (see prepareGql5DockerLesson).
 */
export async function _setupGql5LiveProxy(page: Page, request: APIRequestContext): Promise<void> {
  await page.route('**/__proxy', async (route) => {
    const bodyStr = route.request().postData() ?? '';
    let payload: Gql5ProxyPayload | null;
    try {
      payload = JSON.parse(bodyStr) as Gql5ProxyPayload;
    } catch {
      payload = null;
    }

    const targetUrl = payload?.url ?? '';
    const { forward, url } = resolveGql5ProxyTarget(targetUrl, bodyStr);
    if (!forward) {
      return route.abort('failed');
    }

    const method = (payload?.method ?? 'POST').toUpperCase();
    const headers = { ...(payload?.headers ?? {}) };
    const tlsOpts = { ignoreHTTPSErrors: true };

    try {
      if (method === 'GET') {
        const res = await request.get(url, { headers, ...tlsOpts });
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
        ...tlsOpts,
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

/** True when docker/graphql/tls health probe responds on port 4444. */
export async function isGqlTlsServerHealthy(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(GQL_TLS_HEALTH, { timeout: 5_000 });
    if (!res.ok()) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  }
}

/** True when mTLS stack health probe responds on port 4446. */
export async function isGqlMtlsServerHealthy(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(GQL_TLS_MTLS_HEALTH, { timeout: 5_000 });
    if (!res.ok()) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  }
}
