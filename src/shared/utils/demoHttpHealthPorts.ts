/**
 * Demo Docker HTTP /health ports that PrerequisiteGate used to fetch from the
 * browser. Direct `fetch` to a stopped stack logs ERR_CONNECTION_REFUSED in
 * Chrome every 3s. Route these through Express `/health/demo-http`.
 *
 * Browser-safe — no Node builtins. The Node probe lives in demoHttpHealthProbe.
 */
export const DEMO_HTTP_HEALTH_PORTS = new Set([
  4010, // GraphQL plain
  4444, // GraphQL TLS health
  4446, // GraphQL mTLS health
  50052, // gRPC Go echo HTTP health
  18080, // Redpanda Console (Kafka plaintext)
]);

/** Only `/` (Console UI) and `/health` are forwarded — no open proxy. */
export function normalizeDemoHttpHealthPath(path: string | undefined): '/' | '/health' {
  return path === '/' || path === '' ? '/' : '/health';
}

export function isDemoHttpHealthPort(port: number): boolean {
  return Number.isInteger(port) && DEMO_HTTP_HEALTH_PORTS.has(port);
}

/** True for loopback URLs whose port is a proxied demo HTTP health listener. */
export function isDemoHttpHealthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return isLoopback && isDemoHttpHealthPort(Number(parsed.port));
  } catch {
    return false;
  }
}
