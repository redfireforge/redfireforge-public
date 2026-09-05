/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
}));

vi.mock('@shared/utils/httpClient', () => ({
  resolveCompanionServerUrl: (url: string) => (
    url.startsWith('/') ? `http://localhost:3001${url}` : url
  ),
  httpFetch: vi.fn(),
}));

import { checkEndpoint } from './checkEndpoint';
import { isTauri } from '@shared/utils/platform';
import { httpFetch } from '@shared/utils/httpClient';

// ─── Helpers ────────────────────────────────────────────────────

function mockFetch(ok: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: ok ? 200 : 503 }),
  );
}

function mockFetchReject() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
}

// ─── Tests ──────────────────────────────────────────────────────

describe('checkEndpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(httpFetch).mockReset();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('returns true when HTTP health check succeeds', async () => {
    mockFetch(true);
    const promise = checkEndpoint('ws://localhost:3100/socket.io/?EIO=4');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
  });

  it('falls back to WS probe when HTTP health fails, returns true on WS open', async () => {
    mockFetchReject();

    class FakeWS {
      onopen:  (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) { setTimeout(() => this.onopen?.(), 50); }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWS);

    const promise = checkEndpoint('ws://localhost:3100/socket.io/?EIO=4', 3000);
    await vi.advanceTimersByTimeAsync(200);
    expect(await promise).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns false when both HTTP and WS fail', async () => {
    mockFetchReject();
    class FakeWS {
      onopen:  (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) { setTimeout(() => this.onerror?.(), 50); }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWS);

    const promise = checkEndpoint('ws://localhost:3100/', 3000);
    await vi.advanceTimersByTimeAsync(200);
    expect(await promise).toBe(false);
    vi.unstubAllGlobals();
  });

  it('returns false when WS times out', async () => {
    mockFetchReject();
    class FakeWS {
      onopen:  (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) { /* never fires */ }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWS);

    const promise = checkEndpoint('ws://localhost:3100/', 500);
    await vi.advanceTimersByTimeAsync(600);
    expect(await promise).toBe(false);
    vi.unstubAllGlobals();
  });

  it('accepts http:// URL and uses HTTP path directly', async () => {
    const spy = mockFetch(true);
    const promise = checkEndpoint('http://localhost:4100/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('http://localhost:4100/health', expect.any(Object));
  });

  it('uses localhost for WS health fallback before trying IPv4 loopback', async () => {
    const spy = mockFetch(true);
    const promise = checkEndpoint('ws://localhost:3100/socket.io/?EIO=4');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('http://localhost:3100/health', expect.any(Object));
  });

  it('falls back to 127.0.0.1 when localhost probe fails', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('localhost unreachable'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const promise = checkEndpoint('http://localhost:3001/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenNthCalledWith(1, 'http://localhost:3001/health', expect.any(Object));
    expect(spy).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3001/health', expect.any(Object));
  });

  it('uses Express Spring health proxy for actuator checks when available', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const promise = checkEndpoint('http://localhost:8081/actuator/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/spring', expect.any(Object));
  });

  it('treats Express /health/spring status:down as Spring down (not no-cors false-positive)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'down' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const promise = checkEndpoint('http://localhost:8081/actuator/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(false);
    expect(spy).toHaveBeenCalledWith('/health/spring', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://localhost:8081/actuator/health', expect.any(Object));
  });

  it('treats legacy Express /health/spring HTTP 503 as Spring down', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'down' }), { status: 503 }));

    const promise = checkEndpoint('http://localhost:8081/actuator/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(false);
    expect(spy).toHaveBeenCalledWith('/health/spring', expect.any(Object));
  });

  it('routes Schema Registry probes through Express /health/schema-registry', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const promise = checkEndpoint('http://localhost:8085');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      '/health/schema-registry?url=http%3A%2F%2Flocalhost%3A8085',
      expect.any(Object),
    );
  });

  it('treats Schema Registry proxy status:down as unreachable without relying on HTTP 503', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'down' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const promise = checkEndpoint('http://localhost:8085');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/health/schema-registry'),
      expect.any(Object),
    );
  });

  it('routes Envoy :50055 probes through Express /health/envoy (avoids browser 415 noise)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://localhost:50055/');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/envoy', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://localhost:50055/', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://127.0.0.1:50055/', expect.any(Object));
  });

  it('routes GraphQL TLS :4444 probes through Express /health/demo-http', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://127.0.0.1:4444/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/demo-http?port=4444&path=%2Fhealth', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://127.0.0.1:4444/health', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://localhost:4444/health', expect.any(Object));
  });

  it('routes GraphQL mTLS :4446 and plain :4010 probes through the same proxy', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );

    expect(await checkEndpoint('http://127.0.0.1:4446/health')).toBe(true);
    expect(await checkEndpoint('http://localhost:4010/graphql')).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/demo-http?port=4446&path=%2Fhealth', expect.any(Object));
    expect(spy).toHaveBeenCalledWith('/health/demo-http?port=4010&path=%2Fhealth', expect.any(Object));
  });

  it('treats /health/demo-http status:down as unreachable without a browser fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'down' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const promise = checkEndpoint('http://127.0.0.1:4444/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(false);
    expect(spy).toHaveBeenCalledWith('/health/demo-http?port=4444&path=%2Fhealth', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://127.0.0.1:4444/health', expect.any(Object));
  });

  it('routes gRPC echo :50052 probes through Express /health/demo-http', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://localhost:50052/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/demo-http?port=50052&path=%2Fhealth', expect.any(Object));
  });

  it('routes Kafka Console :18080 root probes through Express /health/demo-http', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://localhost:18080');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/demo-http?port=18080&path=%2F', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://localhost:18080', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://127.0.0.1:18080/', expect.any(Object));
  });

  it('routes AM-17 echo :4017 probes through Express /health/api-mock-echo', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://localhost:4017/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/api-mock-echo', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://localhost:4017/health', expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith('http://127.0.0.1:4017/health', expect.any(Object));
  });

  it('routes AM-17 echo 127.0.0.1:4017 probes through the same Express proxy', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://127.0.0.1:4017/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/api-mock-echo', expect.any(Object));
  });

  it('on Tauri, probes AM-17 echo via native httpFetch to the companion (not webview fetch)', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ status: 'ok' }),
    });
    const spy = vi.spyOn(globalThis, 'fetch');

    const promise = checkEndpoint('http://localhost:4017/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(httpFetch).toHaveBeenCalledWith(
      'http://localhost:3001/health/api-mock-echo',
      'GET',
      {},
      undefined,
      expect.any(AbortSignal),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('on Tauri, generic HTTP probes use native httpFetch not webview fetch', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: 'ok',
    });
    const spy = vi.spyOn(globalThis, 'fetch');

    const promise = checkEndpoint('http://localhost:4100/health');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(httpFetch).toHaveBeenCalledWith(
      'http://localhost:4100/health',
      'GET',
      {},
      undefined,
      expect.any(AbortSignal),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes Envoy 127.0.0.1:50055 probes through the same Express proxy', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const promise = checkEndpoint('http://127.0.0.1:50055/');
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe(true);
    expect(spy).toHaveBeenCalledWith('/health/envoy', expect.any(Object));
  });

  it('settle guard prevents double-resolve when both timeout and open fire', async () => {
    mockFetchReject();

    class FakeWS {
      onopen:  (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        // Fire onopen at 50ms AND the timeout at 100ms — settle must only resolve once
        setTimeout(() => this.onopen?.(), 50);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWS);

    const promise = checkEndpoint('ws://localhost:3100/', 100);
    // Advance past both the onopen timer (50ms) and the settle timer (100ms)
    await vi.advanceTimersByTimeAsync(300);
    // Should resolve true (from onopen) — settle guard prevents second resolve from timeout
    expect(await promise).toBe(true);
    vi.unstubAllGlobals();
  });

  it('settle guard fires when onopen and onerror both fire in same tick (line 32 true branch)', async () => {
    mockFetchReject();

    class FakeWS {
      onopen:  (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        // Fire both callbacks in the same tick — second settle call must hit the guard
        setTimeout(() => {
          this.onopen?.();   // settle(true) — settled = true
          this.onerror?.();  // settle(false) — if (settled) return; (line 32 true branch)
        }, 50);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWS);

    const promise = checkEndpoint('ws://localhost:3100/', 3000);
    await vi.advanceTimersByTimeAsync(200);
    expect(await promise).toBe(true); // resolves from onopen
    vi.unstubAllGlobals();
  });

  it('ignores ws.close() throwing (defensive catch branch)', async () => {
    mockFetchReject();

    class FakeWS {
      onopen:  (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) { setTimeout(() => this.onerror?.(), 50); }
      close() { throw new Error('already closed'); }
    }
    vi.stubGlobal('WebSocket', FakeWS);

    const promise = checkEndpoint('ws://localhost:3100/', 3000);
    await vi.advanceTimersByTimeAsync(200);
    // ws.close() throws but the error is swallowed — should still resolve false
    expect(await promise).toBe(false);
    vi.unstubAllGlobals();
  });
});
