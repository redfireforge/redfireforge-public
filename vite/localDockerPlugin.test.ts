import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_JSON_BODY_BYTES, handleLocalDockerRequest } from './localDocker/http.ts';
import { LocalDockerError, type LocalDockerLifecycle } from './localDocker/lifecycle.ts';
import { SSE_HEARTBEAT_MS, createLogBus } from './localDocker/logs.ts';
import * as localDockerHttp from './localDocker/http.ts';
import { attachLocalDockerMiddleware, localDockerPlugin, shouldAttachLocalDocker } from './localDockerPlugin.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmpDirs: string[] = [];

function tempLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rff-plugin-logs-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function getReq(url: string, remote = '127.0.0.1', host = 'localhost:5176'): IncomingMessage {
  const listeners = new Map<string, Array<() => void>>();
  return {
    method: 'GET',
    url,
    headers: { host },
    socket: { remoteAddress: remote, setTimeout() {}, setNoDelay() {} },
    on(event: string, fn: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
      return this;
    },
  } as IncomingMessage;
}

function postReq(url: string, body: unknown, remote = '127.0.0.1', host = 'localhost'): IncomingMessage {
  const raw = Buffer.from(JSON.stringify(body));
  return {
    method: 'POST',
    url,
    headers: { host },
    socket: { remoteAddress: remote },
    async *[Symbol.asyncIterator]() {
      yield raw;
    },
  } as IncomingMessage;
}

function mockRes() {
  const listeners = new Map<string, Array<() => void>>();
  const out = { status: 0, body: '', ended: false, chunks: [] as string[], headers: {} as Record<string, string> };
  const res = {
    writableEnded: false,
    destroyed: false,
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      if (headers) out.headers = headers;
    },
    flushHeaders() {},
    write(chunk?: string) {
      out.chunks.push(chunk ?? '');
      out.body += chunk ?? '';
      return true;
    },
    end(chunk?: string) {
      if (chunk) {
        out.body += chunk;
        out.chunks.push(chunk);
      }
      out.ended = true;
      this.writableEnded = true;
    },
    on(event: string, fn: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
      return this;
    },
  };
  return {
    res: res as unknown as ServerResponse,
    out,
    emitClose() {
      for (const fn of listeners.get('close') ?? []) fn();
    },
    emitError() {
      for (const fn of listeners.get('error') ?? []) fn();
    },
  };
}

function fakeLifecycle(overrides: Partial<LocalDockerLifecycle> = {}): LocalDockerLifecycle {
  return {
    getStackStatus: vi.fn(async () => false),
    loadManifestDto: vi.fn(() => ({
      stackKey: 'graphql',
      composeFiles: ['docker-compose.yml'],
      buildOnStart: false,
      composeProfile: null,
      requiresCompanionProbe: false,
      ports: [4010],
      minMemoryMb: 512,
      certExpiresAt: null,
    })),
    startStack: vi.fn(async () => undefined),
    stopStack: vi.fn(async () => undefined),
    stopAllRffProjects: vi.fn(async () => ['rff-graphql']),
    listRunningBestEffort: vi.fn(async () => []),
    listRunningStrict: vi.fn(async () => []),
    cancelInflightForStack: vi.fn(),
    cancelAllInflight: vi.fn(),
    getAvailableMemoryMb: vi.fn(async () => null),
    ...overrides,
  };
}

describe('localDockerPlugin', () => {
  it('does not attach when VITE_LOCAL_DOCKER=0', () => {
    expect(shouldAttachLocalDocker({ VITE_LOCAL_DOCKER: '0' }, true)).toBe(false);
  });

  it('does not attach when docker/ is missing', () => {
    expect(shouldAttachLocalDocker({}, false)).toBe(false);
  });

  it('attaches for a full clone with the helper enabled', () => {
    expect(shouldAttachLocalDocker({}, true)).toBe(true);
    expect(shouldAttachLocalDocker({ VITE_LOCAL_DOCKER: '1' }, true)).toBe(true);
  });

  it('is serve-only and has no preview hook', () => {
    const plugin = localDockerPlugin();
    expect(plugin.apply).toBe('serve');
    expect(plugin.configurePreviewServer).toBeUndefined();
  });

  it('configureServer is a no-op when the kill switch is on', async () => {
    const prev = process.env.VITE_LOCAL_DOCKER;
    process.env.VITE_LOCAL_DOCKER = '0';
    try {
      const use = vi.fn();
      await localDockerPlugin().configureServer?.({
        config: { root: repoRoot },
        middlewares: { use },
      } as never);
      expect(use).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.VITE_LOCAL_DOCKER;
      else process.env.VITE_LOCAL_DOCKER = prev;
    }
  });

  it('configureServer is a no-op when docker/ is missing', async () => {
    const prev = process.env.VITE_LOCAL_DOCKER;
    delete process.env.VITE_LOCAL_DOCKER;
    try {
      const use = vi.fn();
      const emptyRoot = tempLogDir();
      await localDockerPlugin().configureServer?.({
        config: { root: emptyRoot },
        middlewares: { use },
      } as never);
      expect(use).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.VITE_LOCAL_DOCKER;
      else process.env.VITE_LOCAL_DOCKER = prev;
    }
  });

  it('configureServer mounts the helper when docker/ exists', async () => {
    const prev = process.env.VITE_LOCAL_DOCKER;
    delete process.env.VITE_LOCAL_DOCKER;
    try {
      const use = vi.fn();
      await localDockerPlugin().configureServer?.({
        config: { root: repoRoot },
        middlewares: { use },
      } as never);
      expect(use).toHaveBeenCalledWith('/__rff-docker', expect.any(Function));
    } finally {
      if (prev === undefined) delete process.env.VITE_LOCAL_DOCKER;
      else process.env.VITE_LOCAL_DOCKER = prev;
    }
  });

  it('writes 500 when the request handler rejects', async () => {
    const spy = vi.spyOn(localDockerHttp, 'handleLocalDockerRequest').mockRejectedValueOnce(new Error('boom'));
    const use = vi.fn();
    await attachLocalDockerMiddleware({ middlewares: { use } } as never, repoRoot);
    const handler = use.mock.calls[0]?.[1] as (req: IncomingMessage, res: ServerResponse) => void;
    const { res, out } = mockRes();
    handler(getReq('/health'), res as unknown as ServerResponse);
    await vi.waitFor(() => {
      expect(out.status).toBe(500);
    });
    spy.mockRestore();
  });

  it('mounted middleware serves health and open-desktop', async () => {
    const use = vi.fn();
    await attachLocalDockerMiddleware({ middlewares: { use } } as never, repoRoot);
    const handler = use.mock.calls[0]?.[1] as (req: IncomingMessage, res: ServerResponse) => void;
    const health = mockRes();
    handler(getReq('/health'), health.res as unknown as ServerResponse);
    await vi.waitFor(() => {
      expect(health.out.status).toBe(200);
    });
    const open = mockRes();
    handler(postReq('/open-desktop', {}), open.res as unknown as ServerResponse);
    await vi.waitFor(() => {
      expect([204, 501, 500]).toContain(open.out.status);
    });
  });

  it('does not write 500 when a rejected handler already ended the response', async () => {
    const spy = vi.spyOn(localDockerHttp, 'handleLocalDockerRequest').mockRejectedValueOnce(new Error('boom'));
    const use = vi.fn();
    await attachLocalDockerMiddleware({ middlewares: { use } } as never, repoRoot);
    const handler = use.mock.calls[0]?.[1] as (req: IncomingMessage, res: ServerResponse) => void;
    const { res, out } = mockRes();
    res.writableEnded = true;
    handler(getReq('/health'), res as unknown as ServerResponse);
    await Promise.resolve();
    await Promise.resolve();
    expect(out.status).toBe(0);
    spy.mockRestore();
  });

  it('does not write 500 when a rejected handler already destroyed the response', async () => {
    const spy = vi.spyOn(localDockerHttp, 'handleLocalDockerRequest').mockRejectedValueOnce(new Error('boom'));
    const use = vi.fn();
    await attachLocalDockerMiddleware({ middlewares: { use } } as never, repoRoot);
    const handler = use.mock.calls[0]?.[1] as (req: IncomingMessage, res: ServerResponse) => void;
    const { res, out } = mockRes();
    res.destroyed = true;
    handler(getReq('/health'), res as unknown as ServerResponse);
    await Promise.resolve();
    await Promise.resolve();
    expect(out.status).toBe(0);
    spy.mockRestore();
  });

  it('returns availableMb from GET /memory', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/memory'), res, {
      lifecycle: fakeLifecycle({
        getAvailableMemoryMb: async () => 2048,
      }),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ availableMb: 2048 });
  });

  it('returns 404 empty for a non-loopback client', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/health', '192.168.1.10'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(404);
    expect(out.body).toBe('');
  });

  it('accepts a full /__rff-docker/health URL', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/__rff-docker/health'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      peekDocker: () => 'running',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, docker: 'running' });
  });

  it('returns 400 for a malformed stack-key encoding', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/status/%'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body)).toEqual({ error: 'Unknown docker stack' });
  });

  it('returns 400 when the JSON body is larger than 64 KiB', async () => {
    const { res, out } = mockRes();
    const req = {
      method: 'POST',
      url: '/start',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(MAX_JSON_BODY_BYTES + 1, 0x61);
      },
    } as IncomingMessage;
    await handleLocalDockerRequest(req, res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns health for a loopback client', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/health'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'notRunning',
      peekDocker: () => 'notRunning',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, docker: 'notRunning' });
  });

  it('does not refresh docker info on /health when peek is already known', async () => {
    const checkState = vi.fn(async () => 'running' as const);
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/health'), res, {
      lifecycle: fakeLifecycle(),
      checkState,
      peekDocker: () => 'running',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, docker: 'running' });
    expect(checkState).not.toHaveBeenCalled();
  });

  it('answers /health without waiting for docker info', async () => {
    let release!: (state: 'running') => void;
    const blocked = new Promise<'running'>((resolve) => {
      release = resolve;
    });
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/health'), res, {
      lifecycle: fakeLifecycle(),
      checkState: () => blocked,
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, docker: null });
    release('running');
    await blocked;
  });

  it('waits for docker info on GET /state', async () => {
    const listRunningBestEffort = vi.fn(async () => ['graphql']);
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/state'), res, {
      lifecycle: fakeLifecycle({ listRunningBestEffort }),
      checkState: async () => 'notRunning',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ docker: 'notRunning', running: [] });
    expect(listRunningBestEffort).not.toHaveBeenCalled();
  });

  it('lists running stacks on GET /state only when Docker is up', async () => {
    const listRunningBestEffort = vi.fn(async () => ['graphql']);
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/state'), res, {
      lifecycle: fakeLifecycle({ listRunningBestEffort }),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ docker: 'running', running: ['graphql'] });
    expect(listRunningBestEffort).toHaveBeenCalledTimes(1);
  });

  it('skips the running list on GET /state?running=0', async () => {
    const listRunningBestEffort = vi.fn(async () => ['graphql']);
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/state?running=0'), res, {
      lifecycle: fakeLifecycle({ listRunningBestEffort }),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ docker: 'running', running: [] });
    expect(listRunningBestEffort).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown stack key', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'not-a-stack' }), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body)).toEqual({ error: 'Unknown docker stack' });
  });

  it('returns 400 for invalid JSON on start', async () => {
    const { res, out } = mockRes();
    const req = {
      method: 'POST',
      url: '/start',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{nope');
      },
    } as IncomingMessage;
    await handleLocalDockerRequest(req, res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 500 when stop-all cannot down any rff project', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(postReq('/stop-all', {}), res, {
      lifecycle: fakeLifecycle({
        stopAllRffProjects: async () => {
          throw new Error('docker compose down failed');
        },
      }),
      checkState: async () => 'running',
    });
    expect(out.status).toBe(500);
    expect(JSON.parse(out.body)).toEqual({ error: 'docker compose down failed' });
  });

  it('returns 204 after a successful start', async () => {
    const lifecycle = fakeLifecycle();
    const { res, out } = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'graphql', build: true }), res, {
      lifecycle,
      checkState: async () => 'running',
    });
    expect(out.status).toBe(204);
    expect(lifecycle.startStack).toHaveBeenCalledWith('graphql', true);
  });

  it('keeps the repo docker tree available for the plugin root', () => {
    expect(repoRoot.replace(/\\/g, '/')).toMatch(/forge-public$/);
  });

  it('returns 404 for last-run when no file exists', async () => {
    const logs = createLogBus({ logDir: tempLogDir() });
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/last-run/graphql'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs,
    });
    expect(out.status).toBe(404);
    expect(out.headers['Cache-Control']).toBe('no-store');
  });

  it('returns 400 for an unknown last-run / logs stack key', async () => {
    const logs = createLogBus({ logDir: tempLogDir() });
    const last = mockRes();
    await handleLocalDockerRequest(getReq('/last-run/not-a-stack'), last.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs,
    });
    expect(last.out.status).toBe(400);
    const sse = mockRes();
    await handleLocalDockerRequest(getReq('/logs/not-a-stack'), sse.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs,
    });
    expect(sse.out.status).toBe(400);
  });

  it('returns last-run text/plain after a log line', async () => {
    const isolated = createLogBus({ logDir: tempLogDir() });
    isolated.emit('graphql', '=== Starting graphql stack ===');
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/last-run/graphql'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs: isolated,
    });
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toContain('text/plain');
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.body).toContain('=== Starting graphql stack ===');
  });

  it('streams SSE lines and 404s a LAN client', async () => {
    const isolated = createLogBus({ logDir: tempLogDir() });
    const { res, out, emitClose } = mockRes();
    await handleLocalDockerRequest(getReq('/logs'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs: isolated,
    });
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toContain('text/event-stream');
    expect(out.ended).toBe(false);
    isolated.emit('graphql', 'hello-sse');
    expect(out.body).toContain('data: {"stackKey":"graphql","line":"hello-sse"}');
    const { res: filteredRes, out: filtered, emitClose: closeFiltered } = mockRes();
    await handleLocalDockerRequest(getReq('/logs/graphql'), filteredRes, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs: isolated,
    });
    isolated.emit('graphql', 'keep');
    isolated.emit('kafka-plaintext', 'drop');
    expect(filtered.body).toContain('keep');
    expect(filtered.body).not.toContain('drop');
    closeFiltered();
    emitClose();

    const lan = mockRes();
    await handleLocalDockerRequest(getReq('/logs', '192.168.1.10'), lan.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs: isolated,
    });
    expect(lan.out.status).toBe(404);
    expect(lan.out.body).toBe('');
  });

  it('stops SSE heartbeats when the socket errors', async () => {
    vi.useFakeTimers();
    try {
      const isolated = createLogBus({ logDir: tempLogDir() });
      const { res, out, emitError } = mockRes();
      await handleLocalDockerRequest(getReq('/logs'), res, {
        lifecycle: fakeLifecycle(),
        checkState: async () => 'running',
        logs: isolated,
      });
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
      expect(out.body).toContain(': ping');
      emitError();
      const afterError = out.body;
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
      expect(out.body).toBe(afterError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends SSE heartbeats and stops them on close', async () => {
    vi.useFakeTimers();
    try {
      const isolated = createLogBus({ logDir: tempLogDir() });
      const { res, out, emitClose } = mockRes();
      await handleLocalDockerRequest(getReq('/logs'), res, {
        lifecycle: fakeLifecycle(),
        checkState: async () => 'running',
        logs: isolated,
      });
      expect(out.body).toContain(': connected');
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
      expect(out.body).toContain(': ping');
      emitClose();
      const afterClose = out.body;
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
      expect(out.body).toBe(afterClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens Docker Desktop on Mac and returns 501 on Linux', async () => {
    const opened = mockRes();
    await handleLocalDockerRequest(postReq('/open-desktop', {}), opened.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      openDesktop: () => 'opened',
    });
    expect(opened.out.status).toBe(204);

    const unsupported = mockRes();
    await handleLocalDockerRequest(postReq('/open-desktop', {}), unsupported.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      openDesktop: () => 'unsupported',
    });
    expect(unsupported.out.status).toBe(501);
    expect(JSON.parse(unsupported.out.body)).toEqual({ error: 'Not implemented' });
  });

  it('covers remaining helper routes, 405s, and start/stop errors', async () => {
    const life = fakeLifecycle();
    const ctx = { lifecycle: life, checkState: async () => 'running' as const };

    const healthPost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/health'), method: 'POST' } as IncomingMessage, healthPost.res, ctx);
    expect(healthPost.out.status).toBe(405);

    const root = mockRes();
    await handleLocalDockerRequest(getReq('/'), root.res, { ...ctx, peekDocker: () => 'running' });
    expect(root.out.status).toBe(200);

    const noMethod = mockRes();
    await handleLocalDockerRequest({ ...getReq('/health'), method: undefined } as IncomingMessage, noMethod.res, {
      ...ctx,
      peekDocker: () => 'running',
    });
    expect(noMethod.out.status).toBe(200);

    const noUrl = mockRes();
    await handleLocalDockerRequest({ ...getReq('/health'), url: undefined } as IncomingMessage, noUrl.res, {
      ...ctx,
      peekDocker: () => 'running',
    });
    expect(noUrl.out.status).toBe(200);

    const stateFalse = mockRes();
    await handleLocalDockerRequest(getReq('/state?running=false'), stateFalse.res, ctx);
    expect(JSON.parse(stateFalse.out.body)).toEqual({ docker: 'running', running: [] });

    const statePost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/state'), method: 'POST' } as IncomingMessage, statePost.res, ctx);
    expect(statePost.out.status).toBe(405);

    const manifest = mockRes();
    await handleLocalDockerRequest(getReq('/manifest/graphql'), manifest.res, ctx);
    expect(manifest.out.status).toBe(200);
    expect(JSON.parse(manifest.out.body).stackKey).toBe('graphql');

    const manifestBad = mockRes();
    await handleLocalDockerRequest(getReq('/manifest/nope'), manifestBad.res, ctx);
    expect(manifestBad.out.status).toBe(400);

    const manifestPost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/manifest/graphql'), method: 'POST' } as IncomingMessage, manifestPost.res, ctx);
    expect(manifestPost.out.status).toBe(405);

    const status = mockRes();
    await handleLocalDockerRequest(getReq('/status/graphql'), status.res, ctx);
    expect(status.out.status).toBe(200);
    expect(JSON.parse(status.out.body)).toEqual({ running: false });

    const statusPost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/status/graphql'), method: 'POST' } as IncomingMessage, statusPost.res, ctx);
    expect(statusPost.out.status).toBe(405);

    const startGet = mockRes();
    await handleLocalDockerRequest(getReq('/start'), startGet.res, ctx);
    expect(startGet.out.status).toBe(405);

    const startEmpty = mockRes();
    await handleLocalDockerRequest({
      method: 'POST',
      url: '/start',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {},
    } as IncomingMessage, startEmpty.res, ctx);
    expect(startEmpty.out.status).toBe(400);

    const startStringChunk = mockRes();
    await handleLocalDockerRequest({
      method: 'POST',
      url: '/start',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield '{"stackKey":"graphql"}';
      },
    } as IncomingMessage, startStringChunk.res, ctx);
    expect(startStringChunk.out.status).toBe(204);

    const startNoKey = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 1 }), startNoKey.res, ctx);
    expect(startNoKey.out.status).toBe(400);

    const conflict = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'graphql' }), conflict.res, {
      lifecycle: fakeLifecycle({
        startStack: async () => {
          throw new LocalDockerError('PORT_CONFLICT:[{"port":4010}]');
        },
      }),
      checkState: async () => 'running',
    });
    expect(conflict.out.status).toBe(409);

    const limit = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'graphql' }), limit.res, {
      lifecycle: fakeLifecycle({
        startStack: async () => {
          throw new LocalDockerError('STACK_LIMIT:graphql');
        },
      }),
      checkState: async () => 'running',
    });
    expect(limit.out.status).toBe(409);

    const cert = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'graphql' }), cert.res, {
      lifecycle: fakeLifecycle({
        startStack: async () => {
          throw new LocalDockerError('CERT_EXPIRED:2000-01-01');
        },
      }),
      checkState: async () => 'running',
    });
    expect(cert.out.status).toBe(409);

    const startBoom = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'graphql' }), startBoom.res, {
      lifecycle: fakeLifecycle({
        startStack: async () => {
          throw new Error('START_FAILED:compose');
        },
      }),
      checkState: async () => 'running',
    });
    expect(startBoom.out.status).toBe(500);

    const startUnknown = mockRes();
    await handleLocalDockerRequest(postReq('/start', { stackKey: 'graphql' }), startUnknown.res, {
      lifecycle: fakeLifecycle({
        startStack: async () => {
          throw 'nope';
        },
      }),
      checkState: async () => 'running',
    });
    expect(startUnknown.out.status).toBe(500);
    expect(JSON.parse(startUnknown.out.body)).toEqual({ error: 'START_FAILED:unknown' });

    const stop = mockRes();
    await handleLocalDockerRequest(postReq('/stop', { stackKey: 'graphql' }), stop.res, ctx);
    expect(stop.out.status).toBe(204);
    expect(life.stopStack).toHaveBeenCalledWith('graphql');

    const stopGet = mockRes();
    await handleLocalDockerRequest(getReq('/stop'), stopGet.res, ctx);
    expect(stopGet.out.status).toBe(405);

    const stopBadJson = mockRes();
    await handleLocalDockerRequest({
      method: 'POST',
      url: '/stop',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{');
      },
    } as IncomingMessage, stopBadJson.res, ctx);
    expect(stopBadJson.out.status).toBe(400);

    const stopUnknown = mockRes();
    await handleLocalDockerRequest(postReq('/stop', {}), stopUnknown.res, ctx);
    expect(stopUnknown.out.status).toBe(400);

    const stopErr = mockRes();
    await handleLocalDockerRequest(postReq('/stop', { stackKey: 'graphql' }), stopErr.res, {
      lifecycle: fakeLifecycle({
        stopStack: async () => {
          throw new Error('docker compose down failed');
        },
      }),
      checkState: async () => 'running',
    });
    expect(stopErr.out.status).toBe(500);

    const stopUnknownThrow = mockRes();
    await handleLocalDockerRequest(postReq('/stop', { stackKey: 'graphql' }), stopUnknownThrow.res, {
      lifecycle: fakeLifecycle({
        stopStack: async () => {
          throw 1;
        },
      }),
      checkState: async () => 'running',
    });
    expect(JSON.parse(stopUnknownThrow.out.body)).toEqual({ error: 'docker compose down failed' });

    const memoryPost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/memory'), method: 'POST' } as IncomingMessage, memoryPost.res, ctx);
    expect(memoryPost.out.status).toBe(405);

    const stopAllGet = mockRes();
    await handleLocalDockerRequest(getReq('/stop-all'), stopAllGet.res, ctx);
    expect(stopAllGet.out.status).toBe(405);

    const openGet = mockRes();
    await handleLocalDockerRequest(getReq('/open-desktop'), openGet.res, ctx);
    expect(openGet.out.status).toBe(405);

    const openErr = mockRes();
    await handleLocalDockerRequest(postReq('/open-desktop', {}), openErr.res, {
      ...ctx,
      openDesktop: () => {
        throw new Error('Failed to open Docker Desktop');
      },
    });
    expect(openErr.out.status).toBe(500);

    const openUnknown = mockRes();
    await handleLocalDockerRequest(postReq('/open-desktop', {}), openUnknown.res, {
      ...ctx,
      openDesktop: () => {
        throw 1;
      },
    });
    expect(JSON.parse(openUnknown.out.body)).toEqual({ error: 'Failed to open Docker Desktop' });

    const logsPost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/logs'), method: 'POST' } as IncomingMessage, logsPost.res, ctx);
    expect(logsPost.out.status).toBe(405);

    const lastPost = mockRes();
    await handleLocalDockerRequest({ ...getReq('/last-run/graphql'), method: 'POST' } as IncomingMessage, lastPost.res, ctx);
    expect(lastPost.out.status).toBe(405);

    const lastEnded = mockRes();
    lastEnded.res.writableEnded = true;
    const logs = createLogBus({ logDir: tempLogDir() });
    logs.emit('graphql', 'line');
    await handleLocalDockerRequest(getReq('/last-run/graphql'), lastEnded.res, { ...ctx, logs });
    expect(lastEnded.out.status).toBe(0);

    const lastNoLogs = mockRes();
    await handleLocalDockerRequest(getReq('/last-run/graphql'), lastNoLogs.res, ctx);
    expect(lastNoLogs.out.status).toBe(404);

    const missing = mockRes();
    await handleLocalDockerRequest(getReq('/nope'), missing.res, ctx);
    expect(missing.out.status).toBe(404);

    const unknownStack = mockRes();
    await handleLocalDockerRequest(getReq('/manifest/graphql'), unknownStack.res, {
      lifecycle: fakeLifecycle({
        loadManifestDto: () => {
          throw new Error('Unknown docker stack');
        },
      }),
      checkState: async () => 'running',
    });
    expect(unknownStack.out.status).toBe(400);

    const unknownPrefix = mockRes();
    await handleLocalDockerRequest(getReq('/manifest/graphql'), unknownPrefix.res, {
      lifecycle: fakeLifecycle({
        loadManifestDto: () => {
          throw new Error('Unknown docker stack: graphql');
        },
      }),
      checkState: async () => 'running',
    });
    expect(unknownPrefix.out.status).toBe(400);

    const innerBoom = mockRes();
    await handleLocalDockerRequest(getReq('/manifest/graphql'), innerBoom.res, {
      lifecycle: fakeLifecycle({
        loadManifestDto: () => {
          throw new Error('read failed');
        },
      }),
      checkState: async () => 'running',
    });
    expect(innerBoom.out.status).toBe(500);

    const innerUnknown = mockRes();
    await handleLocalDockerRequest(getReq('/manifest/graphql'), innerUnknown.res, {
      lifecycle: fakeLifecycle({
        loadManifestDto: () => {
          throw 1;
        },
      }),
      checkState: async () => 'running',
    });
    expect(JSON.parse(innerUnknown.out.body)).toEqual({ error: 'Internal error' });
  });

  it('swallows a rejected background docker refresh on /health', async () => {
    const { res, out } = mockRes();
    await handleLocalDockerRequest(getReq('/health'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => {
        throw new Error('docker info failed');
      },
    });
    expect(out.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('destroys an oversized JSON body and opens SSE without a log bus', async () => {
    const destroy = vi.fn();
    const { res, out } = mockRes();
    const req = {
      method: 'POST',
      url: '/start',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      destroy,
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(MAX_JSON_BODY_BYTES + 1, 0x61);
      },
    } as IncomingMessage;
    await handleLocalDockerRequest(req, res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(destroy).toHaveBeenCalled();
    expect(out.status).toBe(400);

    const sse = mockRes();
    await handleLocalDockerRequest(getReq('/logs'), sse.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
    });
    expect(sse.out.status).toBe(200);
    expect(sse.out.body).toContain(': connected');
    sse.emitClose();
  });

  it('does not write JSON after the response is already ended', async () => {
    const { res, out } = mockRes();
    res.writableEnded = true;
    await handleLocalDockerRequest(getReq('/health'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      peekDocker: () => 'running',
    });
    expect(out.status).toBe(0);
  });

  it('cleans up SSE when write throws or the response is already gone', async () => {
    const isolated = createLogBus({ logDir: tempLogDir() });
    const { res, emitClose } = mockRes();
    let writes = 0;
    (res as unknown as { write: (chunk?: string) => boolean }).write = () => {
      writes += 1;
      if (writes > 1) throw new Error('broken pipe');
      return true;
    };
    await handleLocalDockerRequest(getReq('/logs'), res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs: isolated,
    });
    isolated.emit('graphql', 'line');
    emitClose();

    const gone = mockRes();
    gone.res.destroyed = true;
    await handleLocalDockerRequest(getReq('/logs'), gone.res, {
      lifecycle: fakeLifecycle(),
      checkState: async () => 'running',
      logs: isolated,
    });

    vi.useFakeTimers();
    try {
      const beating = mockRes();
      await handleLocalDockerRequest(getReq('/logs'), beating.res, {
        lifecycle: fakeLifecycle(),
        checkState: async () => 'running',
        logs: isolated,
      });
      beating.res.destroyed = true;
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});
