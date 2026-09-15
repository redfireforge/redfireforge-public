import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedIsTauri = vi.fn(() => false);
const mockedIsNode = vi.fn(() => false);

const envHttpProxyAgentCtor = vi.hoisted(() =>
  vi.fn(function (this: unknown) {
    return { __kind: 'EnvHttpProxyAgent' };
  }),
);

vi.mock('./platform', () => ({
  isTauri: () => mockedIsTauri(),
  isNode: () => mockedIsNode(),
}));

/** Track EnvHttpProxyAgent usage; keep real ProxyAgent for fallback tests in `httpClient.proxyAgent.test.ts`. */
const undiciFetchSpy = vi.hoisted(() => vi.fn());
vi.mock('undici', async (importOriginal) => {
  const mod = await importOriginal<typeof import('undici')>();
  return { ...mod, EnvHttpProxyAgent: envHttpProxyAgentCtor, fetch: undiciFetchSpy };
});

const mockTFetch = vi.fn();
const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => mockTFetch(...args),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { httpFetch, setHttpTransport } from './httpClient';

describe('httpFetch', () => {
  beforeEach(() => {
    resetAllMocks();
    mockedIsTauri.mockReturnValue(false);
    mockedIsNode.mockReturnValue(false);
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error('studio_http_fetch unavailable'));
    globalThis.fetch = vi.fn();
  });

  describe('browser proxy mode', () => {
    it('sends request through proxy', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ status: 200, statusText: 'OK', headers: {}, body: 'ok' })),
      } as unknown as Response);

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(globalThis.fetch).toHaveBeenCalledWith('/__proxy', expect.objectContaining({ method: 'POST' }));
      expect(result.status).toBe(200);
    });

    it('includes body in proxy payload', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ status: 201, statusText: 'Created', headers: {}, body: '{}' })),
      } as unknown as Response);

      await httpFetch('http://example.com/api', 'POST', { 'Content-Type': 'application/json' }, '{"a":1}');
      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const parsed = JSON.parse(call[1].body);
      expect(parsed.url).toBe('http://example.com/api');
      expect(parsed.method).toBe('POST');
      expect(parsed.body).toBe('{"a":1}');
    });

    it('returns structured error when browser fetch to /__proxy fails', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = await httpFetch('https://idp.example/oauth/token', 'POST', {}, 'x=1');
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/POST \/__proxy/);
    });

    it('returns structured error when proxy responds with non-JSON', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<!doctype html>'),
      } as unknown as Response);

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/non-JSON/);
    });

    it('returns structured error when proxy responds with non-OK status', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: () => Promise.resolve('upstream timeout'),
      } as unknown as Response);

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/Vite HTTP proxy returned 502 Bad Gateway/);
      expect(result.error).toMatch(/upstream timeout/);
    });

    it('returns structured error when proxy JSON is invalid structure', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ invalid: 'structure' })),
      } as unknown as Response);

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/Invalid JSON from Vite HTTP proxy/);
    });

    it('handles non-TypeError non-fetch-failed errors', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Custom network error'));

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toBe('Custom network error');
    });
  });

  describe('tauri mode', () => {
    beforeEach(() => {
      mockedIsTauri.mockReturnValue(true);
    });

    it('uses tauri fetch plugin', async () => {
      const mockHeaders = new Map([['content-type', 'application/json']]);
      mockTFetch.mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { forEach: (fn: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => fn(v, k)) },
        text: () => Promise.resolve('{"result":"ok"}'),
      });

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(200);
      expect(result.body).toBe('{"result":"ok"}');
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('resolves relative /api routes to the companion server on port 3001', async () => {
      const mockHeaders = new Map([['content-type', 'application/json']]);
      mockTFetch.mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { forEach: (fn: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => fn(v, k)) },
        text: () => Promise.resolve('{"ok":true}'),
      });

      await httpFetch('/api/grpc/reflect', 'POST', {}, '{"requestId":"r1"}');
      expect(mockTFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/grpc/reflect',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('resolves relative /health/* demo probes to the companion server on port 3001', async () => {
      const mockHeaders = new Map([['content-type', 'application/json']]);
      mockTFetch.mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { forEach: (fn: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => fn(v, k)) },
        text: () => Promise.resolve('{"status":"ok"}'),
      });

      await httpFetch('/health/api-mock-echo', 'GET', {});
      expect(mockTFetch).toHaveBeenCalledWith(
        'http://localhost:3001/health/api-mock-echo',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('does not attach body to GET requests', async () => {
      const mockHeaders = new Map();
      mockTFetch.mockResolvedValueOnce({
        status: 200, statusText: 'OK',
        headers: { forEach: (fn: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => fn(v, k)) },
        text: () => Promise.resolve(''),
      });

      await httpFetch('http://example.com', 'GET', {}, 'should-be-ignored');
      expect(mockTFetch).toHaveBeenCalledWith('http://example.com', expect.not.objectContaining({ body: 'should-be-ignored' }));
    });

    it('includes body for POST requests', async () => {
      const mockHeaders = new Map();
      mockTFetch.mockResolvedValueOnce({
        status: 201, statusText: 'Created',
        headers: { forEach: (fn: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => fn(v, k)) },
        text: () => Promise.resolve('ok'),
      });

      await httpFetch('http://example.com', 'POST', {}, '{"data":1}');
      expect(mockTFetch).toHaveBeenCalledWith('http://example.com', expect.objectContaining({ body: '{"data":1}' }));
    });

    it('returns error response on network failure', async () => {
      mockTFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toBe('Connection refused');
    });

    it('includes cause chain in error message', async () => {
      const cause = new Error('getaddrinfo ENOTFOUND api.example.com');
      (cause as NodeJS.ErrnoException).code = 'ENOTFOUND';
      mockTFetch.mockRejectedValueOnce(new Error('fetch failed', { cause }));

      const result = await httpFetch('http://api.example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toBe('fetch failed — getaddrinfo ENOTFOUND api.example.com [ENOTFOUND]');
    });

    it('handles non-Error cause in error chain', async () => {
      // Create an error with a non-Error cause (string)
      const err = new Error('fetch failed');
      (err as { cause: unknown }).cause = 'string cause';
      mockTFetch.mockRejectedValueOnce(err);

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toBe('fetch failed — string cause');
    });
  });

  describe('node mode', () => {
    let nodeHttpFetch: typeof import('./httpClient').httpFetch;

    beforeEach(async () => {
      for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const) {
        delete process.env[k];
      }
      vi.resetModules();
      mockedIsNode.mockReturnValue(true);
      mockedIsTauri.mockReturnValue(false);
      resetAllMocks();
      globalThis.fetch = vi.fn();
      const mod = await import('./httpClient');
      nodeHttpFetch = mod.httpFetch;
    });

    it('uses global fetch in node mode', async () => {
      const mockHeaders = new Map([['x-custom', 'value']]);
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200, statusText: 'OK',
        headers: { forEach: (fn: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => fn(v, k)) },
        text: () => Promise.resolve('node-response'),
      } as unknown as Response);

      // Use a loopback URL — dispatcher is bypassed, so global fetch is called directly.
      const result = await nodeHttpFetch('http://localhost/api', 'GET', { 'Accept': 'application/json' });
      expect(result.status).toBe(200);
      expect(result.body).toBe('node-response');
    });

    it('handles node fetch errors', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('DNS lookup failed'));

      // Loopback URL — no dispatcher → global fetch → mock throws.
      const result = await nodeHttpFetch('http://localhost', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toBe('DNS lookup failed');
    });

    it('includes cause chain in node fetch error', async () => {
      const cause = new Error('connect ETIMEDOUT 10.0.0.1:443');
      (cause as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('fetch failed', { cause }));

      // Loopback URL — no dispatcher → global fetch → mock throws.
      const result = await nodeHttpFetch('http://localhost', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toBe('fetch failed — connect ETIMEDOUT 10.0.0.1:443 [ETIMEDOUT]');
    });

    it('uses EnvHttpProxyAgent when undici provides it and proxy env is set', async () => {
      process.env.HTTP_PROXY = 'http://proxy.local:8888';
      vi.resetModules();
      const mod = await import('./httpClient');
      // Node 22's global fetch does not support the undici `dispatcher` option.
      // httpClient now uses undici.fetch directly when a dispatcher is present.
      undiciFetchSpy.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { forEach: (_fn: (v: string, k: string) => void) => { /* empty */ } },
        text: () => Promise.resolve('via-env-agent'),
      });

      const result = await mod.httpFetch('https://api.example/data', 'GET', {});
      expect(envHttpProxyAgentCtor).toHaveBeenCalled();
      expect(result.body).toBe('via-env-agent');
      expect(undiciFetchSpy).toHaveBeenCalledWith(
        'https://api.example/data',
        expect.objectContaining({
          dispatcher: expect.objectContaining({ __kind: 'EnvHttpProxyAgent' }),
        }),
      );
    });
  });

  describe('abort signal handling', () => {
    beforeEach(() => {
      setHttpTransport(null);
    });

    it('returns Aborted immediately when signal is already aborted', async () => {
      const ac = new AbortController();
      ac.abort();
      const result = await httpFetch('https://api.example/test', 'GET', {}, undefined, ac.signal);
      expect(result.error).toBe('Aborted');
      expect(result.status).toBe(0);
    });

    it('returns result from transport override without signal', async () => {
      const mockTransport = vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: 'ok' });
      setHttpTransport(mockTransport);
      const result = await httpFetch('https://api.example/test', 'POST', { 'X-Custom': 'val' }, 'body');
      expect(mockTransport).toHaveBeenCalledWith('https://api.example/test', 'POST', { 'X-Custom': 'val' }, 'body');
      expect(result.body).toBe('ok');
      setHttpTransport(null);
    });

    it('races transport override against abort signal', async () => {
      const ac = new AbortController();
      const mockTransport = vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r({ status: 200, statusText: 'OK', headers: {}, body: 'late' }), 5000)));
      setHttpTransport(mockTransport);
      setTimeout(() => ac.abort(), 10);
      const result = await httpFetch('https://api.example/test', 'GET', {}, undefined, ac.signal);
      expect(result.error).toBe('Aborted');
      expect(result.status).toBe(0);
      setHttpTransport(null);
    });

    it('returns transport result when it resolves before abort', async () => {
      const ac = new AbortController();
      const mockTransport = vi.fn().mockResolvedValue({ status: 201, statusText: 'Created', headers: {}, body: 'done' });
      setHttpTransport(mockTransport);
      const result = await httpFetch('https://api.example/test', 'PUT', {}, 'data', ac.signal);
      expect(result.status).toBe(201);
      expect(result.body).toBe('done');
      setHttpTransport(null);
    });

    it('propagates non-abort errors from transport override', async () => {
      const ac = new AbortController();
      const mockTransport = vi.fn().mockRejectedValue(new Error('Network failure'));
      setHttpTransport(mockTransport);
      await expect(httpFetch('https://api.example/test', 'GET', {}, undefined, ac.signal)).rejects.toThrow('Network failure');
      setHttpTransport(null);
    });

    it('passes signal to Tauri fetch', async () => {
      mockedIsTauri.mockReturnValue(true);
      mockTFetch.mockResolvedValue({
        ok: true, status: 200, statusText: 'OK',
        headers: new Headers(), text: () => Promise.resolve('tauri-body'),
      });
      const ac = new AbortController();
      const result = await httpFetch('https://api.example/test', 'GET', {}, undefined, ac.signal);
      expect(result.status).toBe(200);
      expect(mockTFetch).toHaveBeenCalledWith(
        'https://api.example/test',
        expect.objectContaining({ signal: ac.signal }),
      );
    });
  });

  describe('relative-URL native fetch path', () => {
    it('uses native fetch for relative paths starting with /', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"ok":true}'),
      } as unknown as Response);

      const result = await httpFetch('/api/kafka/status', 'GET', {});

      expect(result.status).toBe(200);
      expect(result.body).toBe('{"ok":true}');
      // Should NOT go through /__proxy
      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(call[0]).toBe('/api/kafka/status');
    });

    it('uses native fetch for relative paths starting with ./', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve('result'),
      } as unknown as Response);

      const result = await httpFetch('./api/test', 'GET', {});
      expect(result.status).toBe(200);
      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(call[0]).toBe('./api/test');
    });

    it('includes body for POST but not for GET on relative path', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 201,
        statusText: 'Created',
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as unknown as Response);

      await httpFetch('/api/kafka/connect', 'POST', { 'Content-Type': 'application/json' }, '{"id":"c1"}');

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect((call[1] as RequestInit).body).toBe('{"id":"c1"}');
    });

    it('does not include body for GET on relative path', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve('ok'),
      } as unknown as Response);

      await httpFetch('/api/kafka/status', 'GET', {}, '{"ignored":true}');

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect((call[1] as RequestInit).body).toBeUndefined();
    });

    it('maps gateway error 502 to networkError string', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers(),
        text: () => Promise.resolve('upstream down'),
      } as unknown as Response);

      const result = await httpFetch('/api/kafka/status', 'GET', {});
      expect(result.status).toBe(502);
      expect(result.body).toBe('');
      expect(result.error).toMatch(/Server returned 502/);
    });

    it('maps gateway error 503 to networkError string', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        text: () => Promise.resolve(''),
      } as unknown as Response);

      const result = await httpFetch('/api/kafka/status', 'GET', {});
      expect(result.error).toMatch(/Server returned 503/);
    });

    it('preserves gateway response body when it is a valid API envelope', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":false,"op":"reflect","error":{"code":"GRPC_UNREACHABLE","message":"Could not reach localhost:50052"}}'),
      } as unknown as Response);

      const result = await httpFetch('/api/grpc/reflect', 'POST', { 'Content-Type': 'application/json' }, '{}');
      expect(result.status).toBe(503);
      expect(result.error).toBeUndefined();
      expect(result.body).toContain('"op":"reflect"');
      expect(result.body).toContain('"code":"GRPC_UNREACHABLE"');
    });

    it('maps gateway error 504 to networkError string', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 504,
        statusText: 'Gateway Timeout',
        headers: new Headers(),
        text: () => Promise.resolve(''),
      } as unknown as Response);

      const result = await httpFetch('/api/kafka/status', 'GET', {});
      expect(result.error).toMatch(/Server returned 504/);
    });

    it('returns body for non-gateway error responses (e.g. 400)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        text: () => Promise.resolve('{"error":"invalid"}'),
      } as unknown as Response);

      const result = await httpFetch('/api/kafka/status', 'GET', {});
      expect(result.status).toBe(400);
      expect(result.body).toBe('{"error":"invalid"}');
      expect(result.error).toBeUndefined();
    });

    it('returns error object when native fetch throws', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = await httpFetch('/api/kafka/status', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/Failed to fetch/);
    });

    it('passes AbortSignal to native fetch on relative path', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve('ok'),
      } as unknown as Response);

      const ac = new AbortController();
      await httpFetch('/api/kafka/status', 'GET', {}, undefined, ac.signal);

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect((call[1] as RequestInit).signal).toBe(ac.signal);
    });

    it('returns timing object with non-negative values', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve('pong'),
      } as unknown as Response);

      const result = await httpFetch('/api/ping', 'GET', {});
      expect(result.timing).toBeDefined();
      expect(result.timing!.ttfb).toBeGreaterThanOrEqual(0);
      expect(result.timing!.total).toBeGreaterThanOrEqual(0);
    });
  });
});
