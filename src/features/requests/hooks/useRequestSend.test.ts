/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resolveEffectiveAuth, buildRequestHeaders, useRequestSend, isSendAborted, buildCancelledSendResponse, REQUEST_CANCELLED_MESSAGE } from './useRequestSend';
import type { RequestItem, RequestCollection, AuthConfig, Scenario, GlobalAuthProfile } from '@shared/types';
import type { RequestFolder, Microservice } from '@shared/types';

vi.mock('../../../shared/utils/httpClient', () => ({
  httpFetch: vi.fn(async () => ({
    status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"ok":true}',
  })),
}));
vi.mock('../../../shared/utils/bodySerializer', () => ({
  serializeWithContentType: vi.fn(() => ({ body: '{}', contentType: 'application/json' })),
}));
vi.mock('../utils/requestUrlResolver', () => ({
  resolveFullSendUrl: vi.fn((url: string) => ({ url, error: undefined })),
  buildDisplayUrl: vi.fn((url: string) => url),
}));
vi.mock('../../../shared/utils/yieldToPaint', () => ({
  yieldToPaint: () => Promise.resolve(),
}));
vi.mock('../../../shared/utils/applyAuthHeaders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/utils/applyAuthHeaders')>();
  return { applyAuthHeaders: vi.fn(actual.applyAuthHeaders) };
});
vi.mock('../../../shared/utils/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/utils/platform')>();
  return { ...actual, isTauri: vi.fn(() => false) };
});

function makeRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: 'r1',
    name: 'Test',
    url: '/api/test',
    method: 'GET',
    headers: [],
    body: '',
    bodyType: 'none',
    auth: { type: 'none' },
    ...overrides,
  } as RequestItem;
}

function makeCollection(overrides: Partial<RequestCollection> = {}): RequestCollection {
  return {
    id: 'c1',
    name: 'Col',
    mode: 'direct',
    requests: [],
    ...overrides,
  } as RequestCollection;
}

describe('resolveEffectiveAuth', () => {
  it('returns request auth when type is not none/inherit', () => {
    const auth: AuthConfig = { type: 'bearer', token: 'abc' };
    const result = resolveEffectiveAuth(
      makeRequest({ auth }),
      undefined,
      makeCollection(),
      undefined,
      [],
    );
    expect(result).toEqual(auth);
  });

  it('inherits from parent sub-collection when request is inherit', () => {
    const subColAuth: AuthConfig = { type: 'basic', username: 'u', password: 'p' };
    const subCol: RequestFolder = { id: 'f1', name: 'Sub', requests: [], auth: subColAuth } as RequestFolder;
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'inherit' } }),
      subCol,
      makeCollection(),
      undefined,
      [],
    );
    expect(result).toEqual(subColAuth);
  });

  it('inherits from collection auth when sub-collection has none', () => {
    const colAuth: AuthConfig = { type: 'apikey', apiKey: 'key', apiKeyName: 'X-Key' };
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'none' } }),
      undefined,
      makeCollection({ auth: colAuth }),
      undefined,
      [],
    );
    expect(result).toEqual(colAuth);
  });

  it('uses per-env auth from collection when envId matches', () => {
    const envAuth: AuthConfig = { type: 'bearer', token: 'env-token' };
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'none' } }),
      undefined,
      makeCollection({ authPerEnv: { env1: envAuth } }),
      undefined,
      [],
      'env1',
    );
    expect(result).toEqual(envAuth);
  });

  it('skips per-env auth when type is none', () => {
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'none' } }),
      undefined,
      makeCollection({ authPerEnv: { env1: { type: 'none' } } }),
      undefined,
      [],
      'env1',
    );
    expect(result).toEqual({ type: 'none' });
  });

  it('inherits from linked microservice global auth profile', () => {
    const svc: Microservice = {
      id: 's1', name: 'Svc', baseUrls: {}, authProfileIds: { env1: 'gp1' },
    } as Microservice;
    const globalProfile: GlobalAuthProfile = {
      id: 'gp1', name: 'Profile', auth: { type: 'bearer', token: 'gp-token' },
    };
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'none' } }),
      undefined,
      makeCollection(),
      svc,
      [globalProfile],
      'env1',
    );
    expect(result).toEqual({ type: 'bearer', token: 'gp-token', globalProfileId: 'gp1' });
  });

  it('returns none when no auth source matches', () => {
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'none' } }),
      undefined,
      makeCollection(),
      undefined,
      [],
    );
    expect(result).toEqual({ type: 'none' });
  });

  it('skips sub-collection auth when type is none', () => {
    const subCol: RequestFolder = {
      id: 'f1', name: 'Sub', requests: [],
      auth: { type: 'none' },
    } as RequestFolder;
    const colAuth: AuthConfig = { type: 'bearer', token: 'col' };
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'inherit' } }),
      subCol,
      makeCollection({ auth: colAuth }),
      undefined,
      [],
    );
    expect(result).toEqual(colAuth);
  });

  it('skips sub-collection auth when type is inherit', () => {
    const subCol: RequestFolder = {
      id: 'f1', name: 'Sub', requests: [],
      auth: { type: 'inherit' },
    } as RequestFolder;
    const colAuth: AuthConfig = { type: 'bearer', token: 'col-token' };
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'inherit' } }),
      subCol,
      makeCollection({ auth: colAuth }),
      undefined,
      [],
    );
    expect(result).toEqual(colAuth);
  });

  it('prefers per-env auth over collection-level auth', () => {
    const envAuth: AuthConfig = { type: 'bearer', token: 'env' };
    const colAuth: AuthConfig = { type: 'bearer', token: 'col' };
    const result = resolveEffectiveAuth(
      makeRequest({ auth: { type: 'none' } }),
      undefined,
      makeCollection({ auth: colAuth, authPerEnv: { env1: envAuth } }),
      undefined,
      [],
      'env1',
    );
    expect(result).toEqual(envAuth);
  });
});

describe('buildRequestHeaders', () => {
  const noAuth = (): AuthConfig => ({ type: 'none' });

  it('builds headers from scenario entries', async () => {
    const scenario = {
      headers: [
        { key: 'Accept', value: 'application/json' },
        { key: 'X-Custom', value: 'val' },
      ],
    } as Scenario;
    const result = await buildRequestHeaders(scenario, null, noAuth);
    expect(result).toEqual({
      Accept: 'application/json',
      'X-Custom': 'val',
    });
  });

  it('skips disabled headers', async () => {
    const scenario = {
      headers: [
        { key: 'Accept', value: 'text/html', enabled: false },
        { key: 'X-Active', value: 'yes' },
      ],
    } as Scenario;
    const result = await buildRequestHeaders(scenario, null, noAuth);
    expect(result).toEqual({ 'X-Active': 'yes' });
  });

  it('skips headers with empty key', async () => {
    const scenario = {
      headers: [
        { key: '', value: 'orphan' },
        { key: 'Real', value: 'header' },
      ],
    } as Scenario;
    const result = await buildRequestHeaders(scenario, null, noAuth);
    expect(result).toEqual({ Real: 'header' });
  });

  it('skips hop-by-hop headers that undici rejects on Send', async () => {
    const scenario = {
      headers: [
        { key: 'connection', value: 'keep-alive' },
        { key: 'host', value: '127.0.0.1:4500' },
        { key: 'accept', value: '*/*' },
      ],
    } as Scenario;
    const result = await buildRequestHeaders(scenario, null, noAuth);
    expect(result).toEqual({ accept: '*/*' });
  });

  it('sets Content-Type from contentType arg when not in headers', async () => {
    const scenario = { headers: [] } as unknown as Scenario;
    const result = await buildRequestHeaders(scenario, 'application/json', noAuth);
    expect(result['Content-Type']).toBe('application/json');
  });

  it('does not overwrite explicit Content-Type header', async () => {
    const scenario = {
      headers: [{ key: 'Content-Type', value: 'text/xml' }],
    } as Scenario;
    const result = await buildRequestHeaders(scenario, 'application/json', noAuth);
    expect(result['Content-Type']).toBe('text/xml');
  });

  it('always sets multipart/form-data Content-Type even when present', async () => {
    const scenario = {
      headers: [{ key: 'Content-Type', value: 'text/xml' }],
    } as Scenario;
    const result = await buildRequestHeaders(
      scenario,
      'multipart/form-data; boundary=abc',
      noAuth,
    );
    expect(result['Content-Type']).toBe('multipart/form-data; boundary=abc');
  });

  it('calls applyAuthHeaders when auth type is not none', async () => {
    const scenario = { headers: [] } as unknown as Scenario;
    const authFn = () => ({ type: 'bearer', token: 'tok' }) as AuthConfig;
    const result = await buildRequestHeaders(scenario, null, authFn, 'env1');
    expect(result['Authorization']).toBe('Bearer tok');
  });
});

describe('useRequestSend hook', () => {
  function makeHookOpts(overrides: Partial<Parameters<typeof useRequestSend>[0]> = {}) {
    return {
      request: makeRequest(),
      collection: makeCollection(),
      parentSubCollection: undefined,
      appGlobalAuthProfiles: [],
      appMicroservices: [],
      selectedEnvId: undefined,
      subColEnvId: undefined,
      urlCtx: { collectionMode: 'direct' as const, resolvedColBaseUrls: {} },
      asDraftScenario: () => ({
        id: 'r1', name: 'Test', url: 'http://localhost:4000/api', method: 'GET',
        headers: [{ key: 'Accept', value: 'json' }], body: '', bodyType: 'none',
        auth: { type: 'none' }, validation: { mode: 'none' },
      }) as Scenario,
      setResponse: vi.fn(),
      setResponseTime: vi.fn(),
      setSendAllResults: vi.fn(),
      setConsoleLines: vi.fn(),
      pushHistory: vi.fn(() => 'h1'),
      setActiveHistoryId: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('handleSend sends request and sets response/history', async () => {
    const opts = makeHookOpts();
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    expect(setSending).toHaveBeenCalledWith(true);
    expect(setSending).toHaveBeenCalledWith(false);
    expect(opts.setResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(opts.setResponseTime).toHaveBeenCalledWith(expect.any(Number));
    expect(opts.pushHistory).toHaveBeenCalled();
    expect(opts.setActiveHistoryId).toHaveBeenCalledWith('h1');
  });

  it('clears sending before committing the response so the spinner can paint away', async () => {
    const order: string[] = [];
    const opts = makeHookOpts({
      setResponse: vi.fn(() => { order.push('response'); }),
    });
    const setSending = vi.fn((v: boolean) => { order.push(v ? 'start' : 'stop'); });
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    expect(order[0]).toBe('start');
    expect(order.indexOf('stop')).toBeGreaterThan(-1);
    expect(order.indexOf('stop')).toBeLessThan(order.indexOf('response'));
  });

  it('marks sending only around httpFetch, not during prep', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    const order: string[] = [];
    vi.mocked(httpFetch).mockImplementationOnce(async () => {
      order.push('fetch');
      return { status: 200, statusText: 'OK', headers: {}, body: '{}' };
    });
    const opts = makeHookOpts();
    const setSending = vi.fn((v: boolean) => { order.push(v ? 'start' : 'stop'); });
    const setBusy = vi.fn((v: boolean) => { order.push(v ? 'busy' : 'idle'); });
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending, setBusy); });
    expect(order[0]).toBe('busy');
    expect(order.indexOf('start')).toBeGreaterThan(order.indexOf('busy'));
    expect(order.indexOf('fetch')).toBeGreaterThan(order.indexOf('start'));
    expect(order.indexOf('stop')).toBeGreaterThan(order.indexOf('fetch'));
    expect(order[order.length - 1]).toBe('idle');
  });

  it('handleSend writes console lines for OAuth2', async () => {
    const opts = makeHookOpts({
      request: makeRequest({ auth: { type: 'oauth2', tokenUrl: 'http://auth/token', clientId: 'cid', clientSecret: 'cs' } as AuthConfig }),
    });
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    expect(opts.setConsoleLines).toHaveBeenCalled();
    const lines = opts.setConsoleLines.mock.calls[0][0];
    expect(lines.some((l: { text: string }) => l.text.includes('OAuth2'))).toBe(true);
  });

  it('handleSend writes console lines for bearer auth', async () => {
    const opts = makeHookOpts({
      request: makeRequest({ auth: { type: 'bearer', token: 'xyz' } }),
    });
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    const lines = opts.setConsoleLines.mock.calls[0][0];
    expect(lines.some((l: { text: string }) => l.text.includes('Bearer'))).toBe(true);
  });

  it('handleSend writes console lines for basic auth', async () => {
    const opts = makeHookOpts({
      request: makeRequest({ auth: { type: 'basic', username: 'u', password: 'p' } }),
    });
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    const lines = opts.setConsoleLines.mock.calls[0][0];
    expect(lines.some((l: { text: string }) => l.text.includes('Basic'))).toBe(true);
  });

  it('handleSend writes console lines for apikey auth', async () => {
    const opts = makeHookOpts({
      request: makeRequest({ auth: { type: 'apikey', apiKey: 'k', apiKeyName: 'X-Key' } }),
    });
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    const lines = opts.setConsoleLines.mock.calls[0][0];
    expect(lines.some((l: { text: string }) => l.text.includes('API Key'))).toBe(true);
  });

  it('handleSend handles URL resolution error', async () => {
    const { resolveFullSendUrl } = await import('../utils/requestUrlResolver');
    (resolveFullSendUrl as ReturnType<typeof vi.fn>).mockReturnValueOnce({ url: '', error: 'No base URL' });
    const opts = makeHookOpts();
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    expect(opts.setResponse).toHaveBeenCalledWith(expect.objectContaining({ error: 'No base URL' }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('handleSend handles httpFetch errors', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    (httpFetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
    const opts = makeHookOpts();
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    expect(opts.setResponse).toHaveBeenCalledWith(expect.objectContaining({ error: 'Network error' }));
    expect(opts.pushHistory).toHaveBeenCalled();
  });

  it('handleSend includes body info in console for requests with body', async () => {
    const { serializeWithContentType } = await import('../../../shared/utils/bodySerializer');
    (serializeWithContentType as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      body: '{"data":"x"}', contentType: 'application/json',
    });
    const opts = makeHookOpts({
      asDraftScenario: () => ({
        id: 'r1', name: 'Test', url: 'http://localhost:4000/api', method: 'POST',
        headers: [], body: '{"data":"x"}', bodyType: 'json',
        auth: { type: 'none' }, validation: { mode: 'none' },
      }) as Scenario,
    });
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    const lines = opts.setConsoleLines.mock.calls[0][0];
    expect(lines.some((l: { text: string }) => l.text.includes('Request body'))).toBe(true);
  });

  it('handleSend truncates large request bodies', async () => {
    const bigBody = 'x'.repeat(600);
    const { serializeWithContentType } = await import('../../../shared/utils/bodySerializer');
    (serializeWithContentType as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      body: bigBody, contentType: 'text/plain',
    });
    const opts = makeHookOpts();
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    const lines = opts.setConsoleLines.mock.calls[0][0];
    const bodyLine = lines.find((l: { prefix: string; text: string }) => l.prefix === '#' && l.text.includes('more bytes'));
    expect(bodyLine).toBeDefined();
  });

  it('handleSend logs HTTPS/SSL info', async () => {
    const opts = makeHookOpts({
      asDraftScenario: () => ({
        id: 'r1', name: 'Test', url: 'https://secure.api.com/v1', method: 'GET',
        headers: [], body: '', bodyType: 'none',
        auth: { type: 'none' }, validation: { mode: 'none' },
      }) as Scenario,
    });
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending); });
    const lines = opts.setConsoleLines.mock.calls[0][0];
    expect(lines.some((l: { text: string }) => l.text.includes('SSL/TLS'))).toBe(true);
  });

  it('resolveAuth uses linked microservice auth', () => {
    const svc: Microservice = {
      id: 's1', name: 'Svc', baseUrls: {}, authProfileIds: { env1: 'gp1' },
    } as Microservice;
    const globalProfile: GlobalAuthProfile = {
      id: 'gp1', name: 'Profile', auth: { type: 'bearer', token: 'svc-tok' },
    };
    const opts = makeHookOpts({
      collection: makeCollection({ microserviceId: 's1' }),
      appMicroservices: [svc],
      appGlobalAuthProfiles: [globalProfile],
    });
    const { result } = renderHook(() => useRequestSend(opts));
    const auth = result.current.resolveAuth('env1');
    expect(auth.type).toBe('bearer');
  });

  it('logs TTFB and download timing when the response includes timing', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    vi.mocked(httpFetch).mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      timing: { dnsLookup: 1, tcpConnect: 2, tlsHandshake: 3, ttfb: 12.4, download: 3.6, total: 20 },
    });
    const opts = makeHookOpts();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(vi.fn()); });
    const lines = (opts.setConsoleLines as ReturnType<typeof vi.fn>).mock.calls[0][0] as { text: string }[];
    expect(lines.some((l) => l.text.includes('TTFB 12 ms') && l.text.includes('download 4 ms'))).toBe(true);
  });

  describe('isSendAborted', () => {
    it('detects abort signal, Aborted response, and abort errors', () => {
      const ac = new AbortController();
      expect(isSendAborted(ac.signal)).toBe(false);
      ac.abort();
      expect(isSendAborted(ac.signal)).toBe(true);
      expect(isSendAborted(undefined, { error: 'Aborted' })).toBe(true);
      expect(isSendAborted(undefined, null, new DOMException('Aborted', 'AbortError'))).toBe(true);
      expect(isSendAborted(undefined, null, new Error('connection aborted'))).toBe(true);
      expect(isSendAborted(undefined, null, new Error('timeout'))).toBe(false);
    });
  });

  it('buildCancelledSendResponse is an Error with an empty body', () => {
    expect(buildCancelledSendResponse()).toEqual({
      status: 0,
      statusText: 'Error',
      headers: {},
      body: '',
      error: REQUEST_CANCELLED_MESSAGE,
    });
  });

  it('cancelSend records a detailed Error result instead of keeping the last response', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    vi.mocked(httpFetch).mockImplementationOnce((_url, _method, _headers, _body, signal) => (
      new Promise((resolve) => {
        signal?.addEventListener('abort', () => {
          resolve({ status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' });
        }, { once: true });
      })
    ));
    const opts = makeHookOpts();
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    let done!: Promise<void>;
    await act(async () => {
      done = result.current.handleSend(setSending);
    });
    await act(async () => {
      result.current.cancelSend();
      await done;
    });
    const cancelled = (opts.setResponse as ReturnType<typeof vi.fn>).mock.calls[0][0] as { error?: string; status: number };
    expect(cancelled.status).toBe(0);
    expect(cancelled.error).toContain(REQUEST_CANCELLED_MESSAGE);
    expect(cancelled.error).toContain('GET http://localhost:4000/api');
    expect(cancelled.error).toContain('Stopped during: Sending request');
    expect(cancelled.error).toContain('Received: 0 B');
    expect(opts.setResponseTime).toHaveBeenCalledWith(expect.any(Number));
    const lines = (opts.setConsoleLines as ReturnType<typeof vi.fn>).mock.calls[0][0] as { text: string }[];
    expect(lines.some((l) => l.text === REQUEST_CANCELLED_MESSAGE)).toBe(true);
    expect(lines.some((l) => l.text.includes('Stopped by user during Sending request'))).toBe(true);
    expect(lines.some((l) => l.text === 'No response received')).toBe(true);
    expect(opts.pushHistory).toHaveBeenCalledWith(expect.objectContaining({
      response: expect.objectContaining({ error: cancelled.error }),
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('a replacement Send does not record cancelled for the replaced call', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    vi.mocked(httpFetch)
      .mockImplementationOnce((_url, _method, _headers, _body, signal) => (
        new Promise((resolve) => {
          signal?.addEventListener('abort', () => {
            resolve({ status: 0, statusText: '', headers: {}, body: '', error: 'Aborted' });
          }, { once: true });
        })
      ))
      .mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: {}, body: '{}' });
    const opts = makeHookOpts();
    const { result } = renderHook(() => useRequestSend(opts));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleSend(vi.fn());
    });
    await act(async () => {
      await result.current.handleSend(vi.fn());
    });
    await act(async () => { await first; });
    const responses = (opts.setResponse as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as { error?: string; status?: number });
    expect(responses.some((r) => r?.error?.startsWith(REQUEST_CANCELLED_MESSAGE))).toBe(false);
    expect(responses.at(-1)).toEqual(expect.objectContaining({ status: 200 }));
  });

  it('cancel during auth prep records a Preparing request Error', async () => {
    const { applyAuthHeaders } = await import('../../../shared/utils/applyAuthHeaders');
    let release!: () => void;
    vi.mocked(applyAuthHeaders).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve();
    }));
    const opts = makeHookOpts({
      request: makeRequest({ auth: { type: 'bearer', token: 't' } }),
    });
    const { result } = renderHook(() => useRequestSend(opts));
    let done!: Promise<void>;
    await act(async () => {
      done = result.current.handleSend(vi.fn(), vi.fn());
    });
    await act(async () => {
      result.current.cancelSend();
      release();
      await done;
    });
    const cancelled = (opts.setResponse as ReturnType<typeof vi.fn>).mock.calls[0][0] as { error?: string };
    expect(cancelled.error).toContain('Stopped during: Preparing request');
    expect(cancelled.error).toContain(REQUEST_CANCELLED_MESSAGE);
  });

  it('a transport Aborted result without Cancel does not write a cancelled Error', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    vi.mocked(httpFetch).mockResolvedValueOnce({
      status: 0, statusText: '', headers: {}, body: '', error: 'Aborted',
    });
    const opts = makeHookOpts();
    const setSending = vi.fn();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(setSending, vi.fn()); });
    expect(opts.setResponse).not.toHaveBeenCalled();
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('cancel during draft throw records cancelled with the request URL fallback', async () => {
    let cancel = () => {};
    const opts = makeHookOpts({
      asDraftScenario: () => {
        cancel();
        throw new DOMException('Aborted', 'AbortError');
      },
    });
    const { result } = renderHook(() => useRequestSend(opts));
    cancel = () => result.current.cancelSend();
    await act(async () => { await result.current.handleSend(vi.fn(), vi.fn()); });
    const cancelled = (opts.setResponse as ReturnType<typeof vi.fn>).mock.calls[0][0] as { error?: string };
    expect(cancelled.error).toContain(REQUEST_CANCELLED_MESSAGE);
    expect(cancelled.error).toContain('GET /api/test');
    expect(cancelled.error).toContain('Stopped during: Preparing request');
  });

  it('logs native HTTP and TLS when running in Tauri', async () => {
    const { isTauri } = await import('../../../shared/utils/platform');
    vi.mocked(isTauri).mockReturnValue(true);
    const opts = makeHookOpts({
      asDraftScenario: () => ({
        id: 'r1', name: 'Test', url: 'https://secure.api.com/v1', method: 'GET',
        headers: [], body: '', bodyType: 'none',
        auth: { type: 'none' }, validation: { mode: 'none' },
      }) as Scenario,
    });
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(vi.fn()); });
    const lines = (opts.setConsoleLines as ReturnType<typeof vi.fn>).mock.calls[0][0] as { text: string }[];
    expect(lines.some((l) => l.text.includes('native HTTP'))).toBe(true);
    expect(lines.some((l) => l.text.includes('native client'))).toBe(true);
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('treats a missing response body as 0 B and uses GET when the draft throws', async () => {
    const { httpFetch } = await import('../../../shared/utils/httpClient');
    vi.mocked(httpFetch).mockResolvedValueOnce({
      status: 204, statusText: 'No Content', headers: {}, body: undefined as unknown as string,
    });
    const opts = makeHookOpts();
    const { result } = renderHook(() => useRequestSend(opts));
    await act(async () => { await result.current.handleSend(vi.fn()); });
    const lines = (opts.setConsoleLines as ReturnType<typeof vi.fn>).mock.calls[0][0] as { text: string }[];
    expect(lines.some((l) => l.text.includes('Received 0 B'))).toBe(true);

    const boom = makeHookOpts({
      asDraftScenario: () => { throw new Error('draft failed'); },
    });
    const boomHook = renderHook(() => useRequestSend(boom));
    await act(async () => { await boomHook.result.current.handleSend(vi.fn()); });
    expect(boom.pushHistory).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: '/api/test',
    }));
  });
});
