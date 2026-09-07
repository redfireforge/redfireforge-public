/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_ECHO_PROTO } from '../../src/shared/grpc/contractFixtures.js';
import { encodeRootAsProtosetBase64, parseProtoFiles } from './protoDescriptorParser.js';
import {
  BsrFetchGatewayError,
  buildBsrDescriptorUrl,
  buildBsrDescriptorUrlLegacy,
  fetchBsrDescriptorSet,
  parseBsrModuleReference,
  shouldBypassProxyForUrl,
} from './bsrFetchGateway.js';

describe('bsrFetchGateway coverage gaps', () => {
  it('rejects invalid module references', () => {
    expect(() => parseBsrModuleReference('acme-only')).toThrow(BsrFetchGatewayError);
  });

  it('parses owner/repo without buf.build prefix', () => {
    expect(parseBsrModuleReference('acme/echo').fullName).toBe('buf.build/acme/echo');
  });

  it('fetches JSON protoset payloads and bearer tokens', async () => {
    const fetchPort = {
      fetch: vi.fn(async (_url, init) => {
        expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' });
        return new Response(JSON.stringify({ protosetBase64: 'abc123' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-bsr-digest': '"digest-json"' },
        });
      }),
    };

    const result = await fetchBsrDescriptorSet({
      module: 'acme/echo',
      token: 'secret',
      digest: 'pinned-digest',
    }, { fetchPort });

    expect(result.protosetBase64).toBe('abc123');
    expect(result.digest).toBe('pinned-digest');
  });

  it('surfaces HTTP, empty payload, and missing JSON field errors', async () => {
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => new Response('', { status: 500 })) },
    })).rejects.toThrow(/HTTP 500/);

    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => new Response('', { status: 200 })) },
    })).rejects.toThrow(/empty descriptor/i);

    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) },
    })).rejects.toThrow(/missing protosetBase64/i);
  });

  it('accepts octet-stream payloads and strips quoted digest headers', async () => {
    const payload = Buffer.from('binary-protoset');
    const fetchPort = {
      fetch: vi.fn(async () => new Response(payload, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', etag: '"etag-123"' },
      })),
    };

    const result = await fetchBsrDescriptorSet({ module: 'acme/echo' }, { fetchPort });
    expect(result.protosetBase64).toBe(payload.toString('base64'));
    expect(result.digest).toBe('etag-123');
  });

  it('buildBsrDescriptorUrl encodes version ref query param', () => {
    const url = buildBsrDescriptorUrl(
      { owner: 'acme', repo: 'echo', fullName: 'buf.build/acme/echo' },
      'v1.2.0',
    );
    expect(url).toContain('/acme/echo/descriptor/v1.2.0');
  });

  it('buildBsrDescriptorUrlLegacy uses api/v1 modules path', () => {
    const url = buildBsrDescriptorUrlLegacy(
      { owner: 'acme', repo: 'echo', fullName: 'buf.build/acme/echo' },
      'main',
    );
    expect(url).toContain('/api/v1/modules/acme/echo/descriptor?ref=main');
  });

  it('shouldBypassProxyForUrl honors NO_PROXY host entries', () => {
    const prev = process.env.NO_PROXY;
    process.env.NO_PROXY = 'buf.build,localhost';
    expect(shouldBypassProxyForUrl('https://buf.build/connectrpc/eliza/descriptor/main')).toBe(true);
    expect(shouldBypassProxyForUrl('https://example.com/data')).toBe(false);
    process.env.NO_PROXY = prev;
  });

  it('shouldBypassProxyForUrl supports wildcard and dotted NO_PROXY entries', () => {
    const prev = process.env.NO_PROXY;
    process.env.NO_PROXY = '*.internal.example,.corp.local,*';
    expect(shouldBypassProxyForUrl('https://api.internal.example/x')).toBe(true);
    expect(shouldBypassProxyForUrl('https://host.corp.local/x')).toBe(true);
    expect(shouldBypassProxyForUrl('https://anything.example/x')).toBe(true);
    expect(shouldBypassProxyForUrl('not-a-url')).toBe(false);
    process.env.NO_PROXY = prev;
  });

  it('retries direct fetch when proxy tunnel response is not HTTP 200', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.local:8080';
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => ({
        ProxyAgent: class {
          constructor(public proxyUrl: string) {}
        },
      }),
    }));

    const payload = Buffer.from('direct-after-tunnel-fail');
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      callCount += 1;
      if ((init as { dispatcher?: unknown } | undefined)?.dispatcher) {
        throw new Error('Proxy response (403) !== 200 when HTTP Tunneling');
      }
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    });

    try {
      const mod = await import('./bsrFetchGateway.js');
      const result = await mod.fetchBsrDescriptorSet({ module: 'acme/echo' });
      expect(callCount).toBe(2);
      expect(result.protosetBase64).toBe(payload.toString('base64'));
    } finally {
      fetchSpy.mockRestore();
      process.env.HTTPS_PROXY = prevHttps;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('rethrows non-proxy fetch errors from default fetch port', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.local:8080';
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => ({
        ProxyAgent: class {
          constructor(public proxyUrl: string) {}
        },
      }),
    }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if ((init as { dispatcher?: unknown } | undefined)?.dispatcher) {
        throw new Error('unexpected application failure');
      }
      throw new Error('should not reach direct fetch');
    });

    try {
      const mod = await import('./bsrFetchGateway.js');
      await expect(mod.fetchBsrDescriptorSet({ module: 'acme/echo' })).rejects.toThrow(/unexpected application failure/);
    } finally {
      fetchSpy.mockRestore();
      process.env.HTTPS_PROXY = prevHttps;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('retries legacy BSR URL when canonical descriptor URL returns 404', async () => {
    const root = parseProtoFiles([{ path: 'echo.proto', content: FIXTURE_ECHO_PROTO }]);
    const protosetBase64 = encodeRootAsProtosetBase64(root);
    const bytes = Buffer.from(protosetBase64, 'base64');
    const fetchPort = {
      fetch: vi.fn(async (url: string) => {
        if (url.includes('/api/v1/modules/')) {
          return new Response(bytes, {
            status: 200,
            headers: { 'content-type': 'application/octet-stream', etag: '"legacy"' },
          });
        }
        return new Response('missing', { status: 404 });
      }),
    };

    const result = await fetchBsrDescriptorSet({ module: 'acme/echo', version: 'main' }, { fetchPort });
    expect(fetchPort.fetch).toHaveBeenCalledTimes(2);
    expect(result.protosetBase64).toBe(protosetBase64);
    expect(result.digest).toBe('legacy');
  });

  it('rejects HTML responses to avoid decoding rewritten portal pages as protosets', async () => {
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: {
        fetch: vi.fn(async () => new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        })),
      },
    })).rejects.toThrow(/returned HTML instead of descriptor bytes/i);
  });

  it('accepts descriptorBase64 alias in JSON responses', async () => {
    const fetchPort = {
      fetch: vi.fn(async () => new Response(JSON.stringify({ descriptorBase64: 'alias123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    };
    const result = await fetchBsrDescriptorSet({ module: 'acme/echo' }, { fetchPort });
    expect(result.protosetBase64).toBe('alias123');
  });

  it('wraps abort and unknown fetch failures', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo', version: 'main' }, {
      fetchPort: { fetch: vi.fn(async () => { throw abortError; }) },
      timeoutMs: 5,
    })).rejects.toThrow(/timed out after 5ms/i);

    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => { throw 'network down'; }) },
    })).rejects.toThrow(/BSR fetch failed for buf\.build\/acme\/echo@main: network down/);
  });

  it('includes nested network cause details when fetch throws generic TypeError', async () => {
    const lowLevel = Object.assign(new Error('getaddrinfo ENOTFOUND buf.build'), { code: 'ENOTFOUND' });
    const wrapped = new TypeError('fetch failed', { cause: lowLevel });
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => { throw wrapped; }) },
    })).rejects.toThrow(/ENOTFOUND/);
  });

  it('adds timeout network hint when error chain contains ETIMEDOUT', async () => {
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => { throw new Error('socket ETIMEDOUT'); }) },
    })).rejects.toThrow(/Connection to buf\.build timed out/i);
  });

  it('adds TLS network hint when error chain contains certificate failures', async () => {
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => { throw new Error('SELF_SIGNED_CERT_IN_CHAIN'); }) },
    })).rejects.toThrow(/TLS certificate validation failed/i);
  });

  it('adds proxy network hint when error chain contains PROXY', async () => {
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => { throw new Error('PROXY CONNECT FAILED'); }) },
    })).rejects.toThrow(/Proxy configuration blocked the request to buf\.build/i);
  });

  it('adds unreachable network hint for ECONNREFUSED-style errors', async () => {
    await expect(fetchBsrDescriptorSet({ module: 'acme/echo' }, {
      fetchPort: { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED 127.0.0.1:443'); }) },
    })).rejects.toThrow(/Network path to buf\.build was refused\/unreachable/i);
  });

  it('default fetch path omits dispatcher when no proxy env is configured', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    const prevHttp = process.env.HTTP_PROXY;
    const prevHttpsLower = process.env.https_proxy;
    const prevHttpLower = process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;
    vi.resetModules();
    try {
      const payload = Buffer.from('plain');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(payload, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      );
      const mod = await import('./bsrFetchGateway.js');
      await mod.fetchBsrDescriptorSet({ module: 'acme/echo' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    } finally {
      process.env.HTTPS_PROXY = prevHttps;
      process.env.HTTP_PROXY = prevHttp;
      process.env.https_proxy = prevHttpsLower;
      process.env.http_proxy = prevHttpLower;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('default fetch path prefers EnvHttpProxyAgent when undici exposes it', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    const prevHttpsLower = process.env.https_proxy;
    process.env.HTTPS_PROXY = 'http://proxy.local:8080';
    delete process.env.https_proxy;
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => ({
        EnvHttpProxyAgent: class {},
        ProxyAgent: class {
          constructor(public proxyUrl: string) {}
        },
      }),
    }));

    try {
      const payload = Buffer.from('env-proxy');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(payload, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      );
      const mod = await import('./bsrFetchGateway.js');
      await mod.fetchBsrDescriptorSet({ module: 'acme/echo' });
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown };
      expect(init?.dispatcher).toBeTruthy();
      fetchSpy.mockRestore();
    } finally {
      process.env.HTTPS_PROXY = prevHttps;
      process.env.https_proxy = prevHttpsLower;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('default fetch path uses undici ProxyAgent when proxy env is configured', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    const prevHttpsLower = process.env.https_proxy;
    process.env.HTTPS_PROXY = 'http://proxy.local:8080';
    delete process.env.https_proxy;
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => ({
        ProxyAgent: class {
          constructor(public proxyUrl: string) {}
        },
      }),
    }));

    try {
      const payload = Buffer.from('with-proxy');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(payload, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      );
      const mod = await import('./bsrFetchGateway.js');
      await mod.fetchBsrDescriptorSet({ module: 'acme/echo' });
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit & { dispatcher?: { proxyUrl?: string } };
      expect(init?.dispatcher).toBeTruthy();
      fetchSpy.mockRestore();
    } finally {
      process.env.HTTPS_PROXY = prevHttps;
      process.env.https_proxy = prevHttpsLower;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('retries BSR fetch without proxy when corporate proxy DNS fails', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    const prevHttpsLower = process.env.https_proxy;
    const prevNoProxy = process.env.NO_PROXY;
    const prevNoProxyLower = process.env.no_proxy;
    process.env.HTTPS_PROXY = 'http://proxy.example.com:80';
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => ({
        ProxyAgent: class {
          constructor(public proxyUrl: string) {}
        },
      }),
    }));

    const payload = Buffer.from('eliza-protoset-bytes');
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      callCount += 1;
      if ((init as { dispatcher?: unknown } | undefined)?.dispatcher) {
        const cause = Object.assign(new Error('getaddrinfo ENOTFOUND proxy.example.com'), { code: 'ENOTFOUND' });
        throw new TypeError('fetch failed', { cause });
      }
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', etag: '"digest-eliza"' },
      });
    });

    try {
      const mod = await import('./bsrFetchGateway.js');
      const result = await mod.fetchBsrDescriptorSet({
        module: 'buf.build/connectrpc/eliza',
        version: 'main',
      });
      expect(callCount).toBe(2);
      expect(result.protosetBase64).toBe(payload.toString('base64'));
      expect(result.module.fullName).toBe('buf.build/connectrpc/eliza');
    } finally {
      fetchSpy.mockRestore();
      process.env.HTTPS_PROXY = prevHttps;
      process.env.https_proxy = prevHttpsLower;
      process.env.NO_PROXY = prevNoProxy;
      process.env.no_proxy = prevNoProxyLower;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('falls back to regular fetch when proxy env is set but undici cannot be required', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    const prevHttpsLower = process.env.https_proxy;
    process.env.HTTPS_PROXY = 'http://proxy.local:8080';
    delete process.env.https_proxy;
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => {
        throw new Error('undici missing');
      },
    }));

    try {
      const payload = Buffer.from('fallback');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(payload, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      );
      const mod = await import('./bsrFetchGateway.js');
      await mod.fetchBsrDescriptorSet({ module: 'acme/echo' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    } finally {
      process.env.HTTPS_PROXY = prevHttps;
      process.env.https_proxy = prevHttpsLower;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('uses the default global fetch port when fetchPort is omitted', async () => {
    const payload = Buffer.from('binary-protoset');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const result = await fetchBsrDescriptorSet({ module: 'acme/echo' });
    expect(result.protosetBase64).toBe(payload.toString('base64'));
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reuses cached node dispatcher on subsequent default fetches', async () => {
    const prevHttps = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.local:8080';
    delete process.env.https_proxy;
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => () => ({
        EnvHttpProxyAgent: class {},
      }),
    }));

    const payload = Buffer.from('cached-dispatcher');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      payload,
      { status: 200, headers: { 'content-type': 'application/octet-stream' } },
    ));

    try {
      const mod = await import('./bsrFetchGateway.js');
      await mod.fetchBsrDescriptorSet({ module: 'acme/echo' });
      await mod.fetchBsrDescriptorSet({ module: 'acme/other' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
      process.env.HTTPS_PROXY = prevHttps;
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('fires the default timeout timer when BSR fetch hangs', async () => {
    vi.useFakeTimers();
    try {
      const fetchPort = {
        fetch: vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })),
      };
      const promise = fetchBsrDescriptorSet({ module: 'acme/echo' }, {
        fetchPort,
        timeoutMs: 500,
      });
      const assertion = expect(promise).rejects.toThrow(/timed out after 500ms/i);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
