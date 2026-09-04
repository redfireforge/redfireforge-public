import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertLocalDockerRequest } from './hostGuard.ts';
import type { LocalDockerLifecycle } from './lifecycle.ts';
import { LocalDockerError } from './lifecycle.ts';
import {
  LAST_RUN_HTTP_MAX_LINES,
  SSE_HEARTBEAT_MS,
  formatSseData,
  tailLogLines,
  type LocalDockerLogBus,
} from './logs.ts';
import { openDockerDesktopApp, type OpenDesktopResult } from './openDesktop.ts';
import { parseStackKey } from './stackIds.ts';
import type { DockerDaemonState } from './types.ts';

export const LOCAL_DOCKER_PREFIX = '/__rff-docker';
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_JSON_BODY_BYTES) {
      req.destroy?.();
      throw new Error('Invalid JSON body');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function safeDecodeURIComponent(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status: number, headers?: Record<string, string>): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, headers);
  res.end();
}

function startErrorStatus(message: string): number {
  if (
    message.startsWith('PORT_CONFLICT:')
    || message.startsWith('STACK_LIMIT:')
    || message.startsWith('CERT_EXPIRED:')
  ) {
    return 409;
  }
  return 500;
}

function requestPath(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  let path = raw.split('?')[0] ?? '/';
  if (path === LOCAL_DOCKER_PREFIX || path.startsWith(`${LOCAL_DOCKER_PREFIX}/`)) {
    path = path.slice(LOCAL_DOCKER_PREFIX.length) || '/';
  }
  return path;
}

function requestSearchParams(req: IncomingMessage): URLSearchParams {
  const raw = req.url ?? '/';
  const qIndex = raw.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
}

/** Gate polls only need `docker`. Skip 13× `compose ps` unless the caller asks. */
function wantsRunningList(req: IncomingMessage): boolean {
  const raw = requestSearchParams(req).get('running');
  return raw !== '0' && raw !== 'false';
}

function stackKeyFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const key = (body as { stackKey?: unknown }).stackKey;
  return typeof key === 'string' ? key : null;
}

export interface LocalDockerHttpContext {
  lifecycle: LocalDockerLifecycle;
  checkState: () => Promise<DockerDaemonState>;
  /** Last known daemon state for a non-blocking GET /health. */
  peekDocker?: () => DockerDaemonState | null;
  logs?: LocalDockerLogBus;
  openDesktop?: () => OpenDesktopResult;
}

function attachSse(
  req: IncomingMessage,
  res: ServerResponse,
  logs: LocalDockerLogBus | undefined,
  filterKey: string | null,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  req.socket?.setTimeout?.(0);
  req.socket?.setNoDelay?.(true);

  let cleaned = false;
  let unsub: () => void = () => {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    unsub();
  };

  const safeWrite = (chunk: string): void => {
    if (cleaned || res.writableEnded || res.destroyed) {
      cleanup();
      return;
    }
    try {
      res.write(chunk);
    } catch {
      cleanup();
    }
  };

  const onEvent = (event: { stackKey: string; line: string }) => {
    if (filterKey && event.stackKey !== filterKey) return;
    safeWrite(formatSseData(event));
  };
  unsub = logs?.subscribe(onEvent) ?? (() => {});
  const heartbeat = setInterval(() => {
    if (cleaned || res.writableEnded || res.destroyed) {
      cleanup();
      return;
    }
    safeWrite(': ping\n\n');
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  safeWrite(': connected\n\n');
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

/**
 * Handle a request already mounted at `/__rff-docker` (`req.url` is `/health`, …).
 * Returns true when the request was answered.
 */
export async function handleLocalDockerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: LocalDockerHttpContext,
): Promise<boolean> {
  if (!assertLocalDockerRequest(req)) {
    sendEmpty(res, 404);
    return true;
  }

  const method = req.method ?? 'GET';
  const path = requestPath(req);

  try {
    if (path === '/health' || path === '/' || path === '') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      // Helper presence only — do not await docker info (browser probe is 800ms).
      // Do not refresh on every /health: the gate probes every 2s and that used
      // to start another `docker info` after each reading, starving Start.
      const peek = ctx.peekDocker?.() ?? null;
      sendJson(res, 200, { ok: true, docker: peek });
      if (peek == null) {
        void ctx.checkState().catch(() => {});
      }
      return true;
    }

    if (path === '/state') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const docker = await ctx.checkState();
      // Docker-down `compose ps` just fails 13 times and delays Start / State B.
      const running = docker === 'running' && wantsRunningList(req)
        ? await ctx.lifecycle.listRunningBestEffort()
        : [];
      sendJson(res, 200, { docker, running });
      return true;
    }

    const manifestMatch = path.match(/^\/manifest\/([^/]+)$/);
    if (manifestMatch) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const decoded = safeDecodeURIComponent(manifestMatch[1] ?? '');
      const key = decoded ? parseStackKey(decoded) : null;
      if (!key) {
        sendJson(res, 400, { error: 'Unknown docker stack' });
        return true;
      }
      sendJson(res, 200, ctx.lifecycle.loadManifestDto(key));
      return true;
    }

    const statusMatch = path.match(/^\/status\/([^/]+)$/);
    if (statusMatch) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const decoded = safeDecodeURIComponent(statusMatch[1] ?? '');
      const key = decoded ? parseStackKey(decoded) : null;
      if (!key) {
        sendJson(res, 400, { error: 'Unknown docker stack' });
        return true;
      }
      const running = await ctx.lifecycle.getStackStatus(key);
      sendJson(res, 200, { running });
      return true;
    }

    if (path === '/start') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return true;
      }
      const stackKey = stackKeyFromBody(body);
      if (!stackKey || !parseStackKey(stackKey)) {
        sendJson(res, 400, { error: 'Unknown docker stack' });
        return true;
      }
      const build = Boolean(body && typeof body === 'object' && (body as { build?: unknown }).build === true);
      try {
        await ctx.lifecycle.startStack(stackKey, build);
        sendEmpty(res, 204);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'START_FAILED:unknown';
        sendJson(res, err instanceof LocalDockerError ? startErrorStatus(message) : 500, { error: message });
      }
      return true;
    }

    if (path === '/stop') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return true;
      }
      const stackKey = stackKeyFromBody(body);
      if (!stackKey || !parseStackKey(stackKey)) {
        sendJson(res, 400, { error: 'Unknown docker stack' });
        return true;
      }
      try {
        await ctx.lifecycle.stopStack(stackKey);
        sendEmpty(res, 204);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'docker compose down failed';
        sendJson(res, 500, { error: message });
      }
      return true;
    }

    if (path === '/memory') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const availableMb = await ctx.lifecycle.getAvailableMemoryMb();
      sendJson(res, 200, { availableMb });
      return true;
    }

    if (path === '/stop-all') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const stopped = await ctx.lifecycle.stopAllRffProjects();
      sendJson(res, 200, { stopped });
      return true;
    }

    if (path === '/open-desktop') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      try {
        const result = (ctx.openDesktop ?? openDockerDesktopApp)();
        if (result === 'unsupported') {
          sendJson(res, 501, { error: 'Not implemented' });
          return true;
        }
        sendEmpty(res, 204);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to open Docker Desktop';
        sendJson(res, 500, { error: message });
      }
      return true;
    }

    if (path === '/logs' || path.startsWith('/logs/')) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      let filterKey: string | null = null;
      if (path !== '/logs') {
        const raw = safeDecodeURIComponent(path.slice('/logs/'.length));
        const key = raw ? parseStackKey(raw) : null;
        if (!key) {
          sendJson(res, 400, { error: 'Unknown docker stack' });
          return true;
        }
        filterKey = key;
      }
      attachSse(req, res, ctx.logs, filterKey);
      return true;
    }

    const lastRunMatch = path.match(/^\/last-run\/([^/]+)$/);
    if (lastRunMatch) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const decoded = safeDecodeURIComponent(lastRunMatch[1] ?? '');
      const key = decoded ? parseStackKey(decoded) : null;
      if (!key) {
        sendJson(res, 400, { error: 'Unknown docker stack' });
        return true;
      }
      const text = ctx.logs?.read(key) ?? null;
      if (text == null || text.length === 0) {
        sendEmpty(res, 404, { 'Cache-Control': 'no-store' });
        return true;
      }
      const body = tailLogLines(text, LAST_RUN_HTTP_MAX_LINES);
      if (res.writableEnded || res.destroyed) return true;
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return true;
    }

    sendEmpty(res, 404);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    if (message === 'Unknown docker stack' || message.startsWith('Unknown docker stack')) {
      sendJson(res, 400, { error: 'Unknown docker stack' });
      return true;
    }
    sendJson(res, 500, { error: message });
    return true;
  }
}
