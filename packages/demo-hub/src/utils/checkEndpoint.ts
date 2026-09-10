/**
 * Probes whether a server endpoint is reachable before starting a Docker-dependent lesson.
 *
 * Desktop (Tauri): native plugin-http to the Docker/service port. Reachability
 * must not depend on whichever process owns :3001 (installed app, stale sidecar,
 * or `server:dev`).
 *
 * Web: same-origin `/health` and `/health/*` proxies so Chrome does not log
 * ERR_CONNECTION_REFUSED every 3s while Docker or the companion is down.
 *
 * WS lessons: HTTP `/health` first, then a WebSocket handshake.
 */
import { isTauri } from '@shared/utils/platform';
import { httpFetch, type HttpResponse } from '@shared/utils/httpClient';
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

/** Express companion `GET /health` — gRPC lessons list this as a gate URL. */
function isCompanionHealthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const path = parsed.pathname === '/health' || parsed.pathname === '/health/';
    return isLoopback && parsed.port === '3001' && path;
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

type AcceptStatus = (status: number) => boolean;
const is2xx: AcceptStatus = (status) => status >= 200 && status < 300;
/** Any HTTP response means the listener accepted the connection (e.g. Envoy 415). */
const isHttpResponse: AcceptStatus = (status) => status > 0;
const isKafkaAdminOk: AcceptStatus = (status) => is2xx(status) || status === 404;

function withPath(url: string, pathname: string): string {
  const parsed = new URL(url);
  parsed.pathname = pathname;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/** Same path the Express `/health/demo-http` proxy forwards (Console `/`, else `/health`). */
function demoHttpProbeUrl(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname === '/' || parsed.pathname === '' ? '/' : '/health';
  return withPath(url, path);
}

async function checkHttpNative(
  url: string,
  timeoutMs: number,
  acceptStatus: AcceptStatus = is2xx,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res: HttpResponse = await httpFetch(url, 'GET', {}, undefined, controller.signal);
    return !res.error && acceptStatus(res.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttpDirect(
  url: string,
  timeoutMs: number,
  acceptStatus: AcceptStatus = is2xx,
): Promise<boolean> {
  for (const probeUrl of loopbackProbeCandidates(url)) {
    if (await checkHttpNative(probeUrl, timeoutMs, acceptStatus)) return true;
  }
  return false;
}

/** Try an HTTP GET health check. Resolves true on any 2xx response. */
async function checkHttp(url: string, timeoutMs: number): Promise<boolean> {
  const candidates = loopbackProbeCandidates(url);
  // WKWebView fetch cannot reach loopback Docker ports (and 127.0.0.1 is
  // intercepted by ALL_PROXY on this network). Desktop uses native plugin-http.
  if (isTauri()) {
    return checkHttpDirect(url, timeoutMs);
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

/**
 * Desktop talks to the real service port. Web keeps the same-origin proxy so
 * DevTools stays quiet and corporate proxies cannot intercept 127.0.0.1.
 */
async function checkDockerReachable(
  directUrl: string,
  proxyPath: string,
  timeoutMs: number,
  acceptStatus: AcceptStatus = is2xx,
): Promise<boolean> {
  if (isTauri()) {
    return checkHttpDirect(directUrl, timeoutMs, acceptStatus);
  }
  return readCompanionHealth(proxyPath, timeoutMs);
}

async function readCompanionHealth(probeUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
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
      return checkDockerReachable(url, '/health/spring', timeoutMs);
    }
    // Schema Registry: web uses Express; desktop hits /subjects directly.
    if (isSchemaRegistryUrl(url)) {
      return checkDockerReachable(
        withPath(url, '/subjects'),
        `/health/schema-registry?url=${encodeURIComponent(url)}`,
        timeoutMs,
      );
    }
    // Envoy :50055 returns HTTP 415 on GET / — that still means it is up.
    if (isEnvoyGrpcWebProbeUrl(url)) {
      return checkDockerReachable(url, '/health/envoy', timeoutMs, isHttpResponse);
    }
    if (isApiMockEchoHealthUrl(url)) {
      return checkDockerReachable(url, '/health/api-mock-echo', timeoutMs);
    }
    // Companion :3001/health — web must not fetch :3001 (Chrome ERR_CONNECTION_REFUSED).
    if (isCompanionHealthUrl(url)) {
      return checkDockerReachable(url, '/health', timeoutMs);
    }
    // GraphQL / gRPC echo / Kafka Console.
    if (isDemoHttpHealthUrl(url)) {
      const probeUrl = demoHttpProbeUrl(url);
      const parsed = new URL(probeUrl);
      return checkDockerReachable(
        probeUrl,
        `/health/demo-http?port=${parsed.port}&path=${encodeURIComponent(parsed.pathname)}`,
        timeoutMs,
      );
    }
    if (isRedpandaAdminUrl(url)) {
      const port = new URL(url).port;
      return checkDockerReachable(
        withPath(url, '/v1'),
        `/health/kafka-admin?port=${port}`,
        timeoutMs,
        isKafkaAdminOk,
      );
    }
    return checkHttp(url, timeoutMs);
  }

  // WS endpoint: try HTTP health first (faster), then raw WS handshake
  const httpResult = await checkHttp(wsToHttpHealth(url), timeoutMs);
  if (httpResult) return true;
  return checkWs(url, timeoutMs);
}
