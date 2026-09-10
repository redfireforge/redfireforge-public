/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpFetch } from '../utils/httpClient';
import { isTauri } from '../utils/platform';
import { GrpcApiClientError } from './grpcApiClient';
import {
  buildGrpcStreamQuery,
  expressGrpcProxyDispatchJson,
  expressGrpcProxyJsonFetch,
  resolveGrpcExpressProxyUrl,
  resolveGrpcExpressStreamJsonTransport,
  setGrpcExpressStreamJsonTransportOverride,
} from './grpcExpressProxyJsonTransport';

vi.mock('../utils/httpClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/httpClient')>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

vi.mock('../utils/platform', () => ({
  isTauri: vi.fn(() => false),
  isNode: vi.fn(() => false),
}));

const mockHttpFetch = vi.mocked(httpFetch);
const mockIsTauri = vi.mocked(isTauri);

describe('grpcExpressProxyJsonTransport', () => {
  beforeEach(() => {
    mockHttpFetch.mockReset();
    mockIsTauri.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps relative /api URLs on web', () => {
    expect(resolveGrpcExpressProxyUrl('/api/grpc/stream/start?tabId=t1'))
      .toBe('/api/grpc/stream/start?tabId=t1');
  });

  it('rewrites /api URLs to the companion on Tauri', () => {
    mockIsTauri.mockReturnValue(true);
    expect(resolveGrpcExpressProxyUrl('/api/grpc/stream/start?tabId=t1'))
      .toBe('http://localhost:3001/api/grpc/stream/start?tabId=t1');
  });

  it('parses JSON envelopes through httpFetch (Tauri companion path)', async () => {
    mockIsTauri.mockReturnValue(true);
    mockHttpFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ ok: true, op: 'stream_start', data: { streamId: 's1' } }),
    });
    const envelope = await expressGrpcProxyJsonFetch(
      '/api/grpc/stream/start?tabId=t1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ requestId: 'r1' }),
      },
      'stream_start',
    );
    expect(mockHttpFetch).toHaveBeenCalledWith(
      '/api/grpc/stream/start?tabId=t1',
      'POST',
      expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      JSON.stringify({ requestId: 'r1' }),
      undefined,
    );
    expect(envelope).toMatchObject({ ok: true, op: 'stream_start' });
  });

  it('maps httpFetch network errors', async () => {
    mockIsTauri.mockReturnValue(true);
    mockHttpFetch.mockResolvedValueOnce({
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      error: 'companion down',
    });
    await expect(expressGrpcProxyJsonFetch('/api/grpc/stream/start', { method: 'POST' }, 'stream_start'))
      .rejects.toMatchObject({
        name: 'GrpcApiClientError',
        code: 'GRPC_NETWORK_ERROR',
        message: 'companion down',
      });
  });

  it('keeps the HTTP 200 non-JSON error when the body is HTML', async () => {
    mockIsTauri.mockReturnValue(true);
    mockHttpFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '<!doctype html><html></html>',
    });
    await expect(expressGrpcProxyJsonFetch('/api/grpc/stream/start', { method: 'POST' }, 'stream_start'))
      .rejects.toSatisfy((err: unknown) => (
        err instanceof GrpcApiClientError
        && /non-JSON response \(HTTP 200\)/.test(err.message)
      ));
  });

  it('uses window fetch on web and copies plain header records', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, op: 'stream_start', data: {} }), { status: 200 }),
    );
    const envelope = await expressGrpcProxyJsonFetch(
      '/api/grpc/stream/start',
      {
        method: 'POST',
        headers: { 'X-Tab': 't1' },
        body: JSON.stringify({ requestId: 'r1' }),
      },
      'stream_start',
    );
    expect(fetchSpy).toHaveBeenCalledWith('/api/grpc/stream/start', expect.objectContaining({
      method: 'POST',
    }));
    expect(envelope).toMatchObject({ ok: true, op: 'stream_start' });
    fetchSpy.mockRestore();
  });

  it('defaults the Tauri method to GET when init.method is omitted', async () => {
    mockIsTauri.mockReturnValue(true);
    mockHttpFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ ok: true, op: 'stream_start', data: {} }),
    });
    await expressGrpcProxyJsonFetch('/api/grpc/stream/start', {}, 'stream_start');
    expect(mockHttpFetch).toHaveBeenCalledWith(
      '/api/grpc/stream/start',
      'GET',
      { Accept: 'application/json' },
      undefined,
      undefined,
    );
  });

  it('dispatches a matching success envelope and rejects mismatches / errors', async () => {
    const ok = await expressGrpcProxyDispatchJson<{ streamId: string }>(
      'stream_start',
      '/api/grpc/stream/start',
      { method: 'POST' },
      async () => ({ ok: true, op: 'stream_start', data: { streamId: 's1' } }),
    );
    expect(ok.data.streamId).toBe('s1');

    await expect(expressGrpcProxyDispatchJson(
      'stream_start',
      '/api/grpc/stream/start',
      { method: 'POST' },
      async () => ({ ok: true, op: 'stream_cancel', data: {} }),
    )).rejects.toMatchObject({ code: 'GRPC_MISMATCHED_ENVELOPE' });

    await expect(expressGrpcProxyDispatchJson(
      'stream_start',
      '/api/grpc/stream/start',
      { method: 'POST' },
      async () => ({
        ok: false,
        op: 'stream_start',
        error: { code: '  ', message: '  ', retryable: true },
      }),
    )).rejects.toSatisfy((err: unknown) => (
      err instanceof GrpcApiClientError
      && err.code === 'GRPC_CLIENT_ERROR'
      && /stream_start failed/.test(err.message)
    ));
  });

  it('builds stream query strings and honors the JSON transport override', () => {
    expect(buildGrpcStreamQuery('tab-1')).toBe('tabId=tab-1');
    expect(buildGrpcStreamQuery('tab-1', { lastSequence: 4, skip: undefined }))
      .toBe('tabId=tab-1&lastSequence=4');

    const override = vi.fn(async () => ({ ok: true, op: 'stream_start', data: {} }));
    setGrpcExpressStreamJsonTransportOverride(override);
    expect(resolveGrpcExpressStreamJsonTransport()).toBe(override);
    setGrpcExpressStreamJsonTransportOverride(null);
    expect(resolveGrpcExpressStreamJsonTransport()).toBe(expressGrpcProxyJsonFetch);
  });
});
