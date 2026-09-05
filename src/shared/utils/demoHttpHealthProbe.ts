import http from 'node:http';
import { normalizeDemoHttpHealthPath } from './demoHttpHealthPorts';

export interface DemoHttpHealthProbeResult {
  ok: boolean;
  statusCode?: number;
  reason?: string;
}

/**
 * Probe a demo HTTP /health with Node's http client (no HTTP_PROXY).
 * Browser fetch to 127.0.0.1 is intercepted on some networks and floods DevTools.
 */
export function probeDemoHttpHealth(
  port: number,
  timeoutMs = 2500,
  path?: string,
): Promise<DemoHttpHealthProbeResult> {
  const probePath = normalizeDemoHttpHealthPath(path);
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: probePath,
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      const statusCode = res.statusCode ?? 0;
      resolve({
        ok: statusCode >= 200 && statusCode < 300,
        statusCode,
        reason: statusCode >= 200 && statusCode < 300 ? undefined : `http_${statusCode}`,
      });
    });
    req.on('error', (err) => resolve({ ok: false, reason: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'timeout' });
    });
  });
}
