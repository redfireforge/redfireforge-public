import { isTauri, isNode } from './platform';
import { isLoopbackUrl, resolveLoopbackUrl } from './loopbackUrl';
import { withKeepAliveConnection } from './outboundRequestHeaders';
import type { TimingBreakdown } from '../types';

/** Walk the error `.cause` chain to build a detailed message string. */
function deepErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(code ? `${current.message} [${code}]` : current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' — ');
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  error?: string;
  timing?: TimingBreakdown;
  /** The actual request headers sent (including auth). Populated by auth-aware callers. */
  sentHeaders?: Record<string, string>;
}

export type HttpTransportFn = (
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
) => Promise<HttpResponse>;

// Prefer hostname `localhost` over `127.0.0.1`. Corporate ALL_PROXY intercepts
// `127.0.0.1` (NO_PROXY `127.*` is not honored by curl / WKWebView), while
// `localhost` is an exact NO_PROXY match. The companion binds 127.0.0.1, which
// `localhost` resolves to on IPv4. Tauri probes try both via loopbackProbeCandidates.
const COMPANION_SERVER_BASE = 'http://localhost:3001';

/** Tauri has no Vite /api proxy — resolve companion-server routes to :3001. */
export function resolveCompanionServerUrl(url: string): string {
  if (
    url.startsWith('/api/')
    || url === '/health'
    || url.startsWith('/health/')
    || url.startsWith('/health?')
  ) {
    return `${COMPANION_SERVER_BASE}${url}`;
  }
  return url;
}

let _transportOverride: HttpTransportFn | null = null;

/**
 * Override the HTTP transport used by httpFetch.
 * Pass `null` to restore the default auto-detection behaviour.
 * Used by the execution worker to route requests via postMessage.
 */
export function setHttpTransport(fn: HttpTransportFn | null): void {
  _transportOverride = fn;
}

/**
 * Browser / Web Worker: forwards the request through Vite’s POST /__proxy
 * (available with `npm run dev` and `npm run preview`, not on plain static hosting).
 */
export async function httpFetchViaViteProxy(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  try {
    const resp = await fetch('/__proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body }),
      signal,
    });
    const rawText = await resp.text();
    if (!resp.ok) {
      return {
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        error:
          `Vite HTTP proxy returned ${resp.status} ${resp.statusText}${rawText ? `: ${rawText.slice(0, 200)}` : ''}. `
          + 'Serve the app with npm run dev or npm run preview so POST /__proxy exists.',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return {
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        error:
          `Vite HTTP proxy returned non-JSON (${rawText.slice(0, 160).replace(/\s+/g, ' ') || '(empty)'}). `
          + 'Serve the app with npm run dev or npm run preview.',
      };
    }
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('status' in parsed)
      || typeof (parsed as HttpResponse).status !== 'number'
    ) {
      return {
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        error: 'Invalid JSON from Vite HTTP proxy.',
      };
    }
    return parsed as HttpResponse;
  } catch (err) {
    const hint =
      err instanceof TypeError || (err instanceof Error && err.message === 'Failed to fetch')
        ? 'Could not reach the app HTTP proxy (POST /__proxy). Start Vite with npm run dev or npm run preview; opening built files as static HTML has no proxy. For OAuth from a static bundle, use the desktop (Tauri) app.'
        : deepErrorMessage(err);
    return {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      error: hint,
    };
  }
}

/**
 * Makes an HTTP request using the best available transport:
 * - Custom override (set via setHttpTransport — used by workers)
 * - Tauri native HTTP plugin (desktop app, no CORS)
 * - Node native fetch (CLI runner)
 * - Vite dev/preview proxy (browser)
 */
export async function httpFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  if (signal?.aborted) {
    return { status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' };
  }
  if (_transportOverride) {
    if (!signal) return _transportOverride(url, method, headers, body);
    return Promise.race([
      _transportOverride(url, method, headers, body),
      new Promise<HttpResponse>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    ]).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' } as HttpResponse;
      }
      throw err;
    });
  }
  if (isNode()) {
    return nodeFetch(url, method, headers, body, signal);
  }
  if (isTauri()) {
    return tauriFetch(resolveCompanionServerUrl(url), method, headers, body, signal);
  }
  return proxyFetch(url, method, headers, body, signal);
}

interface StudioHttpFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

type StudioInvokeFn = (
  cmd: string,
  args: { request: { url: string; method: string; headers: Record<string, string>; body?: string } },
) => Promise<StudioHttpFetchResponse>;

let _studioInvoke: StudioInvokeFn | null | undefined;
let _pluginHttpFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null;

function isStudioHttpFetchResponse(value: unknown): value is StudioHttpFetchResponse {
  return typeof value === 'object'
    && value !== null
    && typeof (value as StudioHttpFetchResponse).status === 'number'
    && typeof (value as StudioHttpFetchResponse).body === 'string';
}

async function getStudioInvoke(): Promise<StudioInvokeFn | null> {
  if (_studioInvoke !== undefined) return _studioInvoke;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    _studioInvoke = (cmd, args) => invoke<StudioHttpFetchResponse>(cmd, args);
  } catch {
    _studioInvoke = null;
  }
  return _studioInvoke;
}

function studioResponseToHttp(
  native: StudioHttpFetchResponse,
  t0: number,
  tDone: number,
): HttpResponse {
  return {
    status: native.status,
    statusText: native.statusText ?? '',
    headers: native.headers ?? {},
    body: native.body ?? '',
    error: native.error,
    timing: {
      dnsLookup: 0, tcpConnect: 0, tlsHandshake: 0,
      ttfb: round2(tDone - t0),
      download: 0,
      total: round2(tDone - t0),
    },
  };
}

async function tauriFetchViaPooledCommand(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse | null> {
  if (signal?.aborted) {
    return { status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' };
  }
  const invoke = await getStudioInvoke();
  if (!invoke) return null;

  const request = {
    url,
    method,
    headers,
    body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
  };

  const t0 = performance.now();
  const invokePromise = invoke('studio_http_fetch', { request });

  const run = async (): Promise<HttpResponse | null> => {
    try {
      const native = await invokePromise;
      if (!isStudioHttpFetchResponse(native)) return null;
      return studioResponseToHttp(native, t0, performance.now());
    } catch {
      return null;
    }
  };

  if (!signal) return run();

  return new Promise<HttpResponse | null>((resolve) => {
    const onAbort = () => {
      resolve({ status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void run().then((result) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        resolve({ status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' });
        return;
      }
      resolve(result);
    });
  });
}

async function tauriFetchViaPlugin(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  if (!_pluginHttpFetch) {
    const { fetch: tFetch } = await import('@tauri-apps/plugin-http');
    _pluginHttpFetch = tFetch;
  }
  const opts: RequestInit & { headers: Record<string, string> } = {
    method,
    headers,
  };
  if (body && method !== 'GET') {
    opts.body = body;
  }
  if (signal) {
    opts.signal = signal;
  }

  const t0 = performance.now();
  const response = await _pluginHttpFetch(url, opts);
  const tFirstByte = performance.now();
  const responseBody = await response.text();
  const tDone = performance.now();

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => { responseHeaders[k] = v; });

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: responseBody,
    timing: {
      dnsLookup: 0, tcpConnect: 0, tlsHandshake: 0,
      ttfb: round2(tFirstByte - t0),
      download: round2(tDone - tFirstByte),
      total: round2(tDone - t0),
    },
  };
}

async function tauriFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  try {
    const pooled = await tauriFetchViaPooledCommand(url, method, headers, body, signal);
    if (pooled) return pooled;
    return await tauriFetchViaPlugin(url, method, headers, body, signal);
  } catch (err) {
    return {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      error: deepErrorMessage(err),
    };
  }
}

/**
 * Browser / Web Worker default transport.
 *
 * - Relative `/api/*` paths use the native `fetch` (resolved against the page/worker
 *   origin; Vite's dev/preview proxy forwards `/api` → the backend). These MUST NOT
 *   go through `/__proxy`, whose Node-side `fetch` rejects relative URLs (ERR_INVALID_URL).
 * - Absolute external URLs are routed through `/__proxy` to avoid CORS.
 *
 * Exported so the execution worker can install it via `setHttpTransport` and get the
 * same relative-vs-absolute routing the main thread uses.
 */
export async function proxyFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  // Relative paths (e.g. /api/kafka/status) must NOT go through /__proxy because
  // the Vite middleware runs in Node.js and Node's fetch requires absolute URLs.
  // Use the browser's native fetch instead — Vite's dev/preview server proxy
  // config handles forwarding /api → localhost:3001 transparently.
  if (url.startsWith('/') || url.startsWith('./')) {
    try {
      const opts: RequestInit = { method, headers: headers as HeadersInit };
      if (body && method !== 'GET') opts.body = body;
      if (signal) opts.signal = signal;
      const t0 = performance.now();
      const response = await fetch(url, opts);
      const tFirstByte = performance.now();
      const responseBody = await response.text();
      const tDone = performance.now();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });
      const trimmedBody = responseBody.trim();
      const looksLikeApiEnvelope = trimmedBody.startsWith('{')
        && trimmedBody.includes('"ok"')
        && trimmedBody.includes('"op"');
      // Treat gateway / server-not-running responses as network errors so the
      // caller classifies them as KAFKA_NETWORK_ERROR (retryable) rather than
      // KAFKA_INVALID_ENVELOPE (configuration error).
      const networkError =
        response.status === 0
          || ((response.status === 502 || response.status === 503 || response.status === 504)
            && !looksLikeApiEnvelope)
          ? `Server returned ${response.status} ${response.statusText || 'error'} — is the backend server running?`
          : undefined;
      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: networkError ? '' : responseBody,
        error: networkError,
        timing: {
          dnsLookup: 0, tcpConnect: 0, tlsHandshake: 0,
          ttfb: round2(tFirstByte - t0),
          download: round2(tDone - tFirstByte),
          total: round2(tDone - t0),
        },
      };
    } catch (err) {
      return { status: 0, statusText: '', headers: {}, body: '', error: deepErrorMessage(err) };
    }
  }
  return httpFetchViaViteProxy(url, method, headers, body, signal);
}

let _nodeDispatcher: unknown = undefined;
let _nodeDispatcherInited = false;
let _nodeDispatcherIsProxy = false;

async function getNodeDispatcher(): Promise<{ dispatcher: unknown; isProxy: boolean }> {
  if (_nodeDispatcherInited) return { dispatcher: _nodeDispatcher, isProxy: _nodeDispatcherIsProxy };
  _nodeDispatcherInited = true;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — vite-ignore prevents Vite from bundling undici into the browser chunk;
    // the try-catch handles the graceful miss in non-Node (browser/Tauri) contexts.
    const undici = await import(/* @vite-ignore */ 'undici');
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy;
    if (proxy) {
      _nodeDispatcher = undici.EnvHttpProxyAgent
        ? new undici.EnvHttpProxyAgent()
        : new undici.ProxyAgent(proxy);
      _nodeDispatcherIsProxy = true;
    } else {
      _nodeDispatcher = new undici.Agent({
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connect: { timeout: 10_000 },
        connections: 512,
        pipelining: 10,
      });
      _nodeDispatcherIsProxy = false;
    }
  } catch { /* undici not available — use default global dispatcher */ }
  return { dispatcher: _nodeDispatcher, isProxy: _nodeDispatcherIsProxy };
}

/** Closes the shared Node dispatcher and resets the cache. */
export async function closeNodePool(): Promise<void> {
  if (_nodeDispatcher && typeof (_nodeDispatcher as { close?: () => Promise<void> }).close === 'function') {
    await (_nodeDispatcher as { close: () => Promise<void> }).close();
  }
  _nodeDispatcher = undefined;
  _nodeDispatcherInited = false;
  _nodeDispatcherIsProxy = false;
}

const PROXY_RETRY_CODES = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
  'UND_ERR_ABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

function isProxyError(err: unknown): boolean {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) {
      const code = (cur as NodeJS.ErrnoException).code;
      if (code && PROXY_RETRY_CODES.has(code)) return true;
      if (/Proxy response \(\d+\) !== 200 when HTTP Tunneling/i.test(cur.message)) return true;
      cur = cur.cause;
    } else break;
  }
  return false;
}

async function nodeFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<HttpResponse> {
  try {
    const targetUrl = resolveLoopbackUrl(url);
    const { dispatcher, isProxy } = await getNodeDispatcher();
    const pooledHeaders = withKeepAliveConnection(headers);
    const opts: Record<string, unknown> = { method, headers: pooledHeaders };
    if (body && method !== 'GET') opts.body = body;
    const useProxyDispatcher = Boolean(dispatcher) && !isLoopbackUrl(targetUrl);
    if (useProxyDispatcher) opts.dispatcher = dispatcher;
    if (signal) opts.signal = signal;

    const doFetch = async (fetchOpts: Record<string, unknown>) => {
      const t0 = performance.now();
      // Node 22's global fetch does not accept the undici `dispatcher` option
      // (throws UND_ERR_INVALID_ARG / "fetch failed"). Use undici.fetch directly
      // when a dispatcher is present so the Agent/ProxyAgent is honoured.
      // vite-ignore prevents Vite/rolldown from bundling undici into the browser
      // chunk; this code path only runs in Node.js (dispatcher is only set by
      // getDispatcher() which is Node-only).
      const fetchFn: typeof fetch = fetchOpts.dispatcher
        ? (await import(/* @vite-ignore */ 'undici')).fetch as unknown as typeof fetch
        : fetch;
      const response = await fetchFn(targetUrl, fetchOpts as RequestInit);
      const tFirstByte = performance.now();
      const responseBody = await response.text();
      const tDone = performance.now();

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      return {
        status: response.status, statusText: response.statusText,
        headers: responseHeaders, body: responseBody,
        timing: {
          dnsLookup: 0, tcpConnect: 0, tlsHandshake: 0,
          ttfb: round2(tFirstByte - t0),
          download: round2(tDone - tFirstByte),
          total: round2(tDone - t0),
        },
      };
    };

    try {
      return await doFetch(opts);
    } catch (proxyErr) {
      if (useProxyDispatcher && isProxy && isProxyError(proxyErr)) {
        const directOpts = { ...opts };
        delete directOpts.dispatcher;
        return await doFetch(directOpts);
      }
      throw proxyErr;
    }
  } catch (err) {
    return { status: 0, statusText: '', headers: {}, body: '', error: deepErrorMessage(err) };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
