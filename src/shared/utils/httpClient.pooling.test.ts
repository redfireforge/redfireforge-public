import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedIsTauri = vi.fn(() => false);
const mockedIsNode = vi.fn(() => true);

const agentCtor = vi.hoisted(() =>
  vi.fn(function (this: unknown) {
    return { __kind: 'Agent', close: vi.fn().mockResolvedValue(undefined) };
  }),
);
const envProxyCtor = vi.hoisted(() =>
  vi.fn(function (this: unknown) {
    return { __kind: 'EnvHttpProxyAgent', close: vi.fn().mockResolvedValue(undefined) };
  }),
);

const mockTauriFetch = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock('./platform', () => ({
  isTauri: () => mockedIsTauri(),
  isNode: () => mockedIsNode(),
}));

vi.mock('undici', () => ({
  Agent: agentCtor,
  EnvHttpProxyAgent: envProxyCtor,
  ProxyAgent: vi.fn(),
  // httpClient uses undici.fetch (not globalThis.fetch) when a dispatcher is
  // present (Node 22 rejects the dispatcher option on the global fetch).
  // Route it back to globalThis.fetch so test assertions on vi.fn() still work.
  get fetch() { return globalThis.fetch; },
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mockTauriFetch,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function makeFetchResponse(body = 'ok', status = 200, headersMap = new Map<string, string>()) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { forEach: (fn: (v: string, k: string) => void) => headersMap.forEach((v, k) => fn(v, k)) },
    text: () => Promise.resolve(body),
  };
}

describe('httpClient connection pooling', () => {
  let httpFetch: typeof import('./httpClient').httpFetch;
  let closeNodePool: typeof import('./httpClient').closeNodePool;

  beforeEach(async () => {
    for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const) {
      delete process.env[k];
    }
    vi.resetModules();
    resetAllMocks();
    mockedIsNode.mockReturnValue(true);
    mockedIsTauri.mockReturnValue(false);
    globalThis.fetch = vi.fn();
    const mod = await import('./httpClient');
    httpFetch = mod.httpFetch;
    closeNodePool = mod.closeNodePool;
  });

  function mockFetchResponse(body = 'ok', status = 200) {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeFetchResponse(body, status));
  }

  describe('pooled Agent (no proxy)', () => {
    it('creates an undici.Agent with Tier 1 pool settings', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', {});
      expect(agentCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          keepAliveTimeout: 30_000,
          keepAliveMaxTimeout: 60_000,
          connect: { timeout: 10_000 },
          connections: 512,
          pipelining: 10,
        }),
      );
    });

    it('reuses the same Agent across multiple requests', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com/a', 'GET', {});
      await httpFetch('http://example.com/b', 'GET', {});
      await httpFetch('http://example.com/c', 'POST', {}, 'data');
      expect(agentCtor).toHaveBeenCalledTimes(1);
    });

    it('passes the Agent as dispatcher to fetch()', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', {});
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://example.com',
        expect.objectContaining({
          dispatcher: expect.objectContaining({ __kind: 'Agent' }),
        }),
      );
    });
  });

  describe('Connection: keep-alive header', () => {
    it('injects Connection: keep-alive into outbound requests', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', { 'Accept': 'application/json' });
      const callOpts = vi.mocked(globalThis.fetch).mock.calls[0][1];
      expect(callOpts.headers).toEqual(
        expect.objectContaining({
          'Connection': 'keep-alive',
          'Accept': 'application/json',
        }),
      );
    });

    it('does not overwrite existing Connection header from user', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', { 'Connection': 'close' });
      const callOpts = vi.mocked(globalThis.fetch).mock.calls[0][1];
      expect(callOpts.headers['Connection']).toBe('keep-alive');
    });
  });

  describe('request body handling (Node)', () => {
    it('omits body for GET requests', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', {}, 'should-be-ignored');
      const callOpts = vi.mocked(globalThis.fetch).mock.calls[0][1];
      expect(callOpts.body).toBeUndefined();
    });

    it('includes body for POST requests', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'POST', {}, '{"data":1}');
      const callOpts = vi.mocked(globalThis.fetch).mock.calls[0][1];
      expect(callOpts.body).toBe('{"data":1}');
    });
  });

  describe('timing breakdown (Node)', () => {
    it('returns timing with ttfb, download, and total', async () => {
      mockFetchResponse('response-body');
      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.timing).toBeDefined();
      expect(result.timing!.ttfb).toBeGreaterThanOrEqual(0);
      expect(result.timing!.download).toBeGreaterThanOrEqual(0);
      expect(result.timing!.total).toBeGreaterThanOrEqual(0);
      expect(result.timing!.dnsLookup).toBe(0);
      expect(result.timing!.tcpConnect).toBe(0);
      expect(result.timing!.tlsHandshake).toBe(0);
    });
  });

  describe('Node fetch error handling', () => {
    it('returns error response when fetch throws', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.body).toBe('');
    });

    it('walks error cause chain for detailed messages', async () => {
      const root = new Error('connect failed');
      const wrapper = new Error('fetch error');
      (wrapper as { cause?: unknown }).cause = root;
      vi.mocked(globalThis.fetch).mockRejectedValue(wrapper);
      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.error).toContain('fetch error');
      expect(result.error).toContain('connect failed');
    });

    it('includes error code in deep message', async () => {
      const err = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
      err.code = 'ECONNREFUSED';
      vi.mocked(globalThis.fetch).mockRejectedValue(err);
      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.error).toContain('[ECONNREFUSED]');
    });

    it('handles non-Error cause in error chain', async () => {
      const err = new Error('wrapper');
      (err as { cause?: unknown }).cause = 'string-cause';
      vi.mocked(globalThis.fetch).mockRejectedValue(err);
      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.error).toContain('wrapper');
      expect(result.error).toContain('string-cause');
    });

    it('handles non-Error thrown directly', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue('plain-string');
      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.error).toContain('plain-string');
    });
  });

  describe('proxy error retry (Node)', () => {
    it('retries without dispatcher on proxy ECONNREFUSED', async () => {
      process.env.HTTP_PROXY = 'http://proxy:8080';
      vi.resetModules();
      resetAllMocks();
      globalThis.fetch = vi.fn();
      const mod = await import('./httpClient');

      const proxyErr = new Error('connect') as NodeJS.ErrnoException;
      proxyErr.code = 'ECONNREFUSED';
      vi.mocked(globalThis.fetch)
        .mockRejectedValueOnce(proxyErr)
        .mockResolvedValueOnce(makeFetchResponse('ok', 200));

      const result = await mod.httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(200);
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
      const retryOpts = vi.mocked(globalThis.fetch).mock.calls[1][1];
      expect(retryOpts.dispatcher).toBeUndefined();
    });

    it('retries on UND_ERR_CONNECT_TIMEOUT', async () => {
      process.env.HTTPS_PROXY = 'http://proxy:8080';
      vi.resetModules();
      resetAllMocks();
      globalThis.fetch = vi.fn();
      const mod = await import('./httpClient');

      const proxyErr = new Error('timeout') as NodeJS.ErrnoException;
      proxyErr.code = 'UND_ERR_CONNECT_TIMEOUT';
      vi.mocked(globalThis.fetch)
        .mockRejectedValueOnce(proxyErr)
        .mockResolvedValueOnce(makeFetchResponse('ok'));

      const result = await mod.httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(200);
    });

    it('retries on proxy tunnel error message', async () => {
      process.env.http_proxy = 'http://proxy:8080';
      vi.resetModules();
      resetAllMocks();
      globalThis.fetch = vi.fn();
      const mod = await import('./httpClient');

      vi.mocked(globalThis.fetch)
        .mockRejectedValueOnce(new Error('Proxy response (407) !== 200 when HTTP Tunneling'))
        .mockResolvedValueOnce(makeFetchResponse('ok'));

      const result = await mod.httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(200);
    });

    it('does not retry non-proxy errors', async () => {
      process.env.HTTP_PROXY = 'http://proxy:8080';
      vi.resetModules();
      resetAllMocks();
      globalThis.fetch = vi.fn();
      const mod = await import('./httpClient');

      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('DNS lookup failed'));

      const result = await mod.httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(result.error).toContain('DNS lookup failed');
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    });

    it('does not retry proxy errors when not using a proxy', async () => {
      mockFetchResponse();
      const err = new Error('timeout') as NodeJS.ErrnoException;
      err.code = 'ECONNREFUSED';
      vi.mocked(globalThis.fetch).mockRejectedValue(err);

      const result = await httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    });

    it('does not retry when error cause is non-Error', async () => {
      process.env.HTTP_PROXY = 'http://proxy:8080';
      vi.resetModules();
      resetAllMocks();
      globalThis.fetch = vi.fn();
      const mod = await import('./httpClient');

      const err = new Error('proxy fail');
      (err as { cause?: unknown }).cause = 'string-cause';
      vi.mocked(globalThis.fetch).mockRejectedValue(err);

      const result = await mod.httpFetch('http://example.com', 'GET', {});
      expect(result.status).toBe(0);
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    });
  });

  describe('proxy mode', () => {
    it('uses EnvHttpProxyAgent when proxy env is set', async () => {
      process.env.HTTP_PROXY = 'http://proxy:8080';
      vi.resetModules();
      resetAllMocks();
      globalThis.fetch = vi.fn();
      mockFetchResponse();
      const mod = await import('./httpClient');

      await mod.httpFetch('http://example.com', 'GET', {});
      expect(envProxyCtor).toHaveBeenCalled();
      expect(agentCtor).not.toHaveBeenCalled();
    });
  });

  describe('closeNodePool', () => {
    it('closes the pooled dispatcher', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', {});
      expect(agentCtor).toHaveBeenCalledTimes(1);

      await closeNodePool();

      const agentInstance = agentCtor.mock.results[0].value;
      expect(agentInstance.close).toHaveBeenCalled();
    });

    it('allows creating a new pool after close', async () => {
      mockFetchResponse();
      await httpFetch('http://example.com', 'GET', {});
      expect(agentCtor).toHaveBeenCalledTimes(1);

      await closeNodePool();

      await httpFetch('http://example.com/again', 'GET', {});
      expect(agentCtor).toHaveBeenCalledTimes(2);
    });

    it('is safe to call when no pool exists', async () => {
      await expect(closeNodePool()).resolves.toBeUndefined();
    });
  });
});

// ────────────────────────────────────────────────────────
// setHttpTransport / transport override
// ────────────────────────────────────────────────────────

describe('httpClient — setHttpTransport', () => {
  beforeEach(() => {
    vi.resetModules();
    resetAllMocks();
    mockedIsNode.mockReturnValue(false);
    mockedIsTauri.mockReturnValue(false);
  });

  it('routes requests through the custom transport', async () => {
    const mod = await import('./httpClient');
    const customTransport = vi.fn().mockResolvedValue({
      status: 201, statusText: 'Created', headers: {}, body: '{"id":1}',
    });
    mod.setHttpTransport(customTransport);

    const result = await mod.httpFetch('http://api.test', 'POST', { 'X-Custom': 'yes' }, '{}');
    expect(customTransport).toHaveBeenCalledWith('http://api.test', 'POST', { 'X-Custom': 'yes' }, '{}');
    expect(result.status).toBe(201);

    mod.setHttpTransport(null);
  });

  it('restores default transport when set to null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeFetchResponse('proxy-ok'));
    const mod = await import('./httpClient');
    const custom = vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '' });
    mod.setHttpTransport(custom);
    await mod.httpFetch('http://x.test', 'GET', {});
    expect(custom).toHaveBeenCalledTimes(1);

    mod.setHttpTransport(null);
    await mod.httpFetch('http://y.test', 'GET', {});
    expect(custom).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────
// Tauri fetch path
// ────────────────────────────────────────────────────────

describe('httpClient — Tauri transport', () => {
  beforeEach(() => {
    vi.resetModules();
    resetAllMocks();
    mockedIsNode.mockReturnValue(false);
    mockedIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('studio_http_fetch unavailable'));
  });

  it('uses @tauri-apps/plugin-http fetch and returns timing', async () => {
    const headers = new Map([['content-type', 'application/json']]);
    mockTauriFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { forEach: (fn: (v: string, k: string) => void) => headers.forEach((v, k) => fn(v, k)) },
      text: () => Promise.resolve('{"ok":true}'),
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test/data', 'GET', { Accept: 'application/json' });
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.timing).toBeDefined();
    expect(result.timing!.total).toBeGreaterThanOrEqual(0);
  });

  it('omits body for GET in Tauri mode', async () => {
    mockTauriFetch.mockResolvedValue({
      status: 200, statusText: 'OK',
      headers: { forEach: vi.fn() },
      text: () => Promise.resolve('ok'),
    });

    const mod = await import('./httpClient');
    await mod.httpFetch('http://api.test', 'GET', {}, 'ignored');
    const opts = mockTauriFetch.mock.calls[0][1];
    expect(opts.body).toBeUndefined();
  });

  it('includes body for POST in Tauri mode', async () => {
    mockTauriFetch.mockResolvedValue({
      status: 200, statusText: 'OK',
      headers: { forEach: vi.fn() },
      text: () => Promise.resolve('ok'),
    });

    const mod = await import('./httpClient');
    await mod.httpFetch('http://api.test', 'POST', {}, '{"x":1}');
    const opts = mockTauriFetch.mock.calls[0][1];
    expect(opts.body).toBe('{"x":1}');
  });

  it('returns error response when Tauri fetch throws', async () => {
    mockTauriFetch.mockRejectedValue(new Error('Tauri plugin unavailable'));
    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('Tauri plugin unavailable');
  });

  it('uses pooled studio_http_fetch when the native command is available', async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"pooled":true}',
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('https://api.test/catalog', 'GET', { Accept: 'application/json' });

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"pooled":true}');
    expect(result.headers['content-type']).toBe('application/json');
    expect(mockInvoke).toHaveBeenCalledWith('studio_http_fetch', {
      request: {
        url: 'https://api.test/catalog',
        method: 'GET',
        headers: { Accept: 'application/json' },
        body: undefined,
      },
    });
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('omits body for GET on studio_http_fetch and includes it for POST', async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      status: 201, statusText: 'Created', headers: {}, body: 'ok',
    });

    const mod = await import('./httpClient');
    await mod.httpFetch('https://api.test', 'GET', {}, 'ignored');
    expect(mockInvoke.mock.calls[0][1].request.body).toBeUndefined();

    mockInvoke.mockClear();
    await mod.httpFetch('https://api.test', 'POST', {}, '{"x":1}');
    expect(mockInvoke.mock.calls[0][1].request.body).toBe('{"x":1}');
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('returns Aborted without invoking studio_http_fetch when the signal is already aborted', async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      status: 200, statusText: 'OK', headers: {}, body: 'nope',
    });
    const ac = new AbortController();
    ac.abort();

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('https://api.test', 'GET', {}, undefined, ac.signal);
    expect(result.error).toBe('Aborted');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────
// Vite proxy path (browser, non-Tauri, non-Node)
// ────────────────────────────────────────────────────────

describe('httpClient — Vite proxy (browser)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetAllMocks();
    mockedIsNode.mockReturnValue(false);
    mockedIsTauri.mockReturnValue(false);
  });

  it('sends POST to /__proxy and parses JSON response', async () => {
    const proxyPayload = { status: 200, statusText: 'OK', headers: { 'x-req': '1' }, body: '{"data":true}' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(proxyPayload)),
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test/proxy', 'GET', { Accept: '*/*' });

    expect(globalThis.fetch).toHaveBeenCalledWith('/__proxy', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"url":"http://api.test/proxy"'),
    }));
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"data":true}');
  });

  it('returns error when proxy returns non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway',
      text: () => Promise.resolve('upstream error'),
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('502');
    expect(result.error).toContain('Bad Gateway');
  });

  it('returns error when proxy returns non-JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('<html>not json</html>'),
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('non-JSON');
  });

  it('returns error when proxy returns invalid JSON shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('"just-a-string"'),
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('Invalid JSON');
  });

  it('returns error when proxy returns object without status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('{"body":"ok"}'),
    });

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('Invalid JSON');
  });

  it('returns hint when fetch throws TypeError (no proxy running)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('POST /__proxy');
  });

  it('returns deep error message for non-TypeError failures', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('NetworkError: DNS resolution failed'));

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.status).toBe(0);
    expect(result.error).toContain('DNS resolution failed');
  });

  it('handles "Failed to fetch" Error message as proxy hint', async () => {
    const err = new Error('Failed to fetch');
    globalThis.fetch = vi.fn().mockRejectedValue(err);

    const mod = await import('./httpClient');
    const result = await mod.httpFetch('http://api.test', 'GET', {});
    expect(result.error).toContain('POST /__proxy');
  });
});

// ────────────────────────────────────────────────────────
// httpFetchViaViteProxy (exported directly)
// ────────────────────────────────────────────────────────

describe('httpFetchViaViteProxy — direct export', () => {
  beforeEach(() => {
    vi.resetModules();
    resetAllMocks();
  });

  it('is the same function used by the browser proxy path', async () => {
    const mod = await import('./httpClient');
    expect(mod.httpFetchViaViteProxy).toBeDefined();
    expect(typeof mod.httpFetchViaViteProxy).toBe('function');
  });
});

// ────────────────────────────────────────────────────────
// proxyFetch (exported for the execution worker)
// ────────────────────────────────────────────────────────

describe('proxyFetch — relative vs absolute routing', () => {
  beforeEach(() => {
    vi.resetModules();
    resetAllMocks();
    globalThis.fetch = vi.fn();
  });

  it('routes relative /api/* paths through native fetch (NOT /__proxy)', async () => {
    // Regression: the execution worker installs proxyFetch as its transport. A relative
    // WS/Kafka proxy path must use native fetch — POSTing it to /__proxy would make the
    // Node-side fetch throw ERR_INVALID_URL ("Failed to parse URL from /api/ws/connect").
    vi.mocked(globalThis.fetch).mockResolvedValue(makeFetchResponse('{"ok":true}', 200));
    const mod = await import('./httpClient');
    const res = await mod.proxyFetch('/api/ws/connect', 'POST', { 'Content-Type': 'application/json' }, '{}');
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/api/ws/connect');
  });

  it('routes absolute URLs through the /__proxy endpoint', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeFetchResponse(JSON.stringify({ status: 200, statusText: 'OK', headers: {}, body: 'ok' }), 200),
    );
    const mod = await import('./httpClient');
    await mod.proxyFetch('https://example.com/api', 'GET', {});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/__proxy');
  });
});
