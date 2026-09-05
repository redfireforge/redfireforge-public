/**
 * @vitest-environment node
 */
import http, { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeDemoHttpHealth } from './demoHttpHealthProbe';

describe('probeDemoHttpHealth', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  });

  function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
    return new Promise((resolve, reject) => {
      server = createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no port'));
      });
    });
  }

  it('returns ok on HTTP 200', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await expect(probeDemoHttpHealth(port, 1000)).resolves.toEqual({
      ok: true,
      statusCode: 200,
      reason: undefined,
    });
  });

  it('returns down on HTTP 503', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(503);
      res.end('no');
    });
    await expect(probeDemoHttpHealth(port, 1000)).resolves.toEqual({
      ok: false,
      statusCode: 503,
      reason: 'http_503',
    });
  });

  it('returns down when nothing listens', async () => {
    const result = await probeDemoHttpHealth(1, 400);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('returns down when the probe times out', async () => {
    const port = await listen((_req, _res) => { /* hold the socket */ });
    await expect(probeDemoHttpHealth(port, 50)).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('treats a missing statusCode as 0 / down', async () => {
    const spy = vi.spyOn(http, 'get').mockImplementation(((_opts, cb) => {
      (cb as ((res: { statusCode?: number; resume: () => void }) => void) | undefined)?.({
        resume: () => {},
      });
      return { on: () => undefined } as unknown as ReturnType<typeof http.get>;
    }) as typeof http.get);
    await expect(probeDemoHttpHealth(9, 1000)).resolves.toEqual({
      ok: false,
      statusCode: 0,
      reason: 'http_0',
    });
    spy.mockRestore();
  });

  it('probes / when the path is the Console root', async () => {
    const port = await listen((req, res) => {
      if (req.url === '/') {
        res.writeHead(200);
        res.end('console');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await expect(probeDemoHttpHealth(port, 1000, '/')).resolves.toEqual({
      ok: true,
      statusCode: 200,
      reason: undefined,
    });
  });
});
