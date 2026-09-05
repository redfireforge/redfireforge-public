/**
 * Probes whether a server endpoint is reachable before starting a Docker-dependent lesson.
 *
 * Strategy (in order):
 *  1. HTTP GET to `<httpBase>/health` — fast, reliable, works for servers that expose it.
 *  2. WebSocket handshake to the raw URL — fallback for WS-only endpoints.
 *
 * Returns true as soon as either probe succeeds, false if both time out or error.
 */
import { isTauri } from '@shared/utils/platform';
import { httpFetch, resolveCompanionServerUrl, type HttpResponse } from '@shared/utils/httpClient';
import { GRPC_SPRING_FIXTURE_HTTP_PORT } from '@shared/grpc/grpcSpringFixturePorts';
import { isDemoHttpHealthUrl } from '@shared/utils/demoHttpHealthPorts';
function loopbackProbeCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      const localhost = new URL(parsed.toString());
      localhost.hostname = 'localhost';
      const ipv4 = new URL(parsed.toString());
      ipv4.hostname = '127.0.0.1';
      const ordered = [localhost.toString(), ipv4.toString()];
      return [...new Set(ordered)];
    }
  } catch {
    /* fall back to original URL */
  }
  return [url];
}

function isSpringActuatorHealthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return isLoopback && parsed.port === String(GRPC_SPRING_FIXTURE_HTTP_PORT) && parsed.pathname === '/actuator/health';
  } catch {
    return false;
  }
}

/** Schema Registry endpoints (typically port 8081 or 8085) should be probed via server proxy. */
function isSchemaRegistryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    // Schema Registry commonly runs on 8081 or 8085; check if the path is root or /subjects
    return isLoopback && (parsed.port === '8085' || parsed.port === '8081') && (parsed.pathname === '/' || parsed.pathname === '');
  } catch {
    return false;
  }
}

/** API Mock Docker echo (:4017) — corporate proxy intercepts browser 127.0.0.1. */
function isApiMockEchoHealthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return isLoopback && parsed.port === '4017';
  } catch {
    return false;
  }
}

/** Envoy gRPC-Web sidecar (:50055) — bare GET returns 415; probe via Express proxy. */
function isEnvoyGrpcWebProbeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return isLoopback && parsed.port === '50055';
  } catch {
    return false;
  }
}

/**
 * Redpanda Admin API ports used by demo Docker stacks.
 * These are probed via the server-side proxy to avoid browser no-cors reliability issues
 * (e.g. Tauri webview may restrict direct HTTP fetch to arbitrary localhost ports).
 * Known ports: 19644 (plaintext), 19645 (secure), 19648 (TLS).
 */
const REDPANDA_ADMIN_PORTS = new Set(['19644', '19645', '19648']);

function isRedpandaAdminUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return isLoopback && REDPANDA_ADMIN_PORTS.has(parsed.port);
  } catch {
    return false;
  }
}

function companionStatusOk(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { status?: unknown };
    return parsed?.status === 'ok';
  } catch {
    return false;
  }
}

async function checkHttpNative(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res: HttpResponse = await httpFetch(url, 'GET', {}, undefined, controller.signal);
    return !res.error && res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Try an HTTP GET health check. Resolves true on any 2xx response. */
async function checkHttp(url: string, timeoutMs: number): Promise<boolean> {
  const candidates = loopbackProbeCandidates(url);
  // WKWebView fetch cannot reach loopback Docker ports (and 127.0.0.1 is
  // intercepted by ALL_PROXY on this network). Desktop uses native plugin-http.
  if (isTauri()) {
    for (const probeUrl of candidates) {
      if (await checkHttpNative(probeUrl, timeoutMs)) return true;
    }
    return false;
  }
  for (const probeUrl of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(probeUrl, { signal: controller.signal, mode: 'no-cors' });
      // no-cors means opaque response — if fetch didn't throw, the server is up
      void res;
      return true;
    } catch {
      // try the next loopback candidate before failing
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

async function readCompanionHealth(probeUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (isTauri()) {
      const res = await httpFetch(probeUrl, 'GET', {}, undefined, controller.signal);
      if (res.error || res.status < 200 || res.status >= 300) return false;
      return companionStatusOk(res.body);
    }
    const res = await fetch(probeUrl, { signal: controller.signal });
    if (!res.ok) return false;
    try {
      const body = await res.json() as { status?: unknown };
      return body?.status === 'ok';
    } catch {
      return false;
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same-origin Express health-proxy check.
 * Proxies always respond HTTP 200 with `{ status: 'ok' | 'down' }` so DevTools
 * stays quiet while Docker is offline. Treat legacy non-2xx as down too.
 *
 * Web: relative `/health/...` hits Vite middleware (or the Vite→:3001 proxy).
 * Tauri: there is no Vite origin — rewrite to the companion and probe with
 * native plugin-http. WKWebView `fetch()` cannot reach loopback servers.
 */
async function checkProxyHealth(url: string, timeoutMs: number): Promise<boolean> {
  if (!isTauri()) {
    return readCompanionHealth(url, timeoutMs);
  }
  const absolute = resolveCompanionServerUrl(url);
  for (const probeUrl of loopbackProbeCandidates(absolute)) {
    if (await readCompanionHealth(probeUrl, timeoutMs)) return true;
  }
  return false;
}

/** Try a WebSocket handshake. Resolves true on open, false on error or timeout. */
async function checkWs(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(v);
    };
    const ws = new WebSocket(url);
    const timer = setTimeout(() => settle(false), timeoutMs);
    ws.onopen  = () => settle(true);
    ws.onerror = () => settle(false);
  });
}

/**
 * Derives an HTTP health URL from a WS endpoint URL.
 * e.g. ws://localhost:3100/socket.io/... → http://127.0.0.1:3100/health
 */
function wsToHttpHealth(wsUrl: string): string {
  try {
    const parsed = new URL(wsUrl);
    parsed.protocol = 'http:';
    parsed.pathname = '/health';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return `${wsUrl.replace(/^wss?:\/\//, 'http://').split('/')[0]}/health`;
  }
}

/**
 * Check whether a server endpoint is reachable.
 *
 * @param url      WebSocket or HTTP URL to probe (e.g. ws://localhost:3100/...)
 * @param timeoutMs Per-probe timeout in ms (default 3000)
 */
export async function checkEndpoint(url: string, timeoutMs = 3000): Promise<boolean> {
  if (url.startsWith('http')) {
    // Spring actuator (:8081) — probe via Express so the browser never hits :8081
    // directly. Read JSON `status` (proxies return HTTP 200 even when down).
    if (isSpringActuatorHealthUrl(url)) {
      return checkProxyHealth('/health/spring', timeoutMs);
    }
    // Schema Registry probes are unreliable via browser no-cors; route through server proxy.
    // Use relative URL so Vite proxy handles it (same-origin, no CORS).
    if (isSchemaRegistryUrl(url)) {
      return checkProxyHealth(
        `/health/schema-registry?url=${encodeURIComponent(url)}`,
        timeoutMs,
      );
    }
    // Envoy :50055 returns HTTP 415 on GET / — browser probes log Failed-to-load.
    // Route through Express so PrerequisiteGate stays quiet in DevTools.
    if (isEnvoyGrpcWebProbeUrl(url)) {
      return checkProxyHealth('/health/envoy', timeoutMs);
    }
    // AM-17 echo :4017 — same-origin proxy so DevTools stays quiet and the
    // corporate proxy cannot intercept 127.0.0.1 loopback candidates.
    if (isApiMockEchoHealthUrl(url)) {
      return checkProxyHealth('/health/api-mock-echo', timeoutMs);
    }
    // GraphQL / gRPC / Kafka Console demo HTTP — same-origin proxy so a
    // stopped Docker stack does not flood Chrome with ERR_CONNECTION_REFUSED.
    if (isDemoHttpHealthUrl(url)) {
      const parsed = new URL(url);
      const path = parsed.pathname === '/' || parsed.pathname === '' ? '/' : '/health';
      return checkProxyHealth(
        `/health/demo-http?port=${parsed.port}&path=${encodeURIComponent(path)}`,
        timeoutMs,
      );
    }
    // Redpanda Admin API probes are routed through the server proxy for the same reason.
    if (isRedpandaAdminUrl(url)) {
      const port = new URL(url).port;
      return checkProxyHealth(`/health/kafka-admin?port=${port}`, timeoutMs);
    }
    return checkHttp(url, timeoutMs);
  }

  // WS endpoint: try HTTP health first (faster), then raw WS handshake
  const httpResult = await checkHttp(wsToHttpHealth(url), timeoutMs);
  if (httpResult) return true;
  return checkWs(url, timeoutMs);
}
