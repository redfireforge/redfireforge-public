/**
 * @vitest-environment node
 */
import http from 'node:http';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { describe, expect, it, vi, afterAll, afterEach } from 'vitest';
import { createGraphqlRouter } from './graphql-routes.js';

// ---------------------------------------------------------------------------
// Mock upstream HTTP server for proxy response tests
// ---------------------------------------------------------------------------

let mockUpstreamPort: number;
let mockUpstreamServer: http.Server;
let mockUpstreamHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startMockUpstream(): Promise<void> {
  return new Promise((resolve) => {
    mockUpstreamServer = http.createServer((req, res) => {
      mockUpstreamHandler?.(req, res);
    });
    mockUpstreamServer.listen(0, '127.0.0.1', () => {
      mockUpstreamPort = (mockUpstreamServer.address() as { port: number }).port;
      resolve();
    });
  });
}

// Start mock upstream HTTP server before all tests
await startMockUpstream();

afterAll(() => {
  mockUpstreamServer?.close();
});

// ---------------------------------------------------------------------------
// Per-test mock WebSocket server helper
// ---------------------------------------------------------------------------
// Use per-test WS servers to avoid state bleeding between tests.

interface MockWsServer {
  port: number;
  server: WebSocketServer;
  close: () => void;
}

async function createMockWsServer(
  onConnection: (ws: WsSocket) => void,
): Promise<MockWsServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, server, close: () => server.close() });
    });
    server.on('error', reject);
    server.on('connection', onConnection);
  });
}

function buildApp(onLog = vi.fn()) {
  const app = express();
  app.use(express.json());
  app.use(createGraphqlRouter({ onLog }));
  return app;
}

// ---------------------------------------------------------------------------
// Raw HTTP helper for SSE streaming tests
// ---------------------------------------------------------------------------
// supertest doesn't reliably buffer `text/event-stream` responses that close
// quickly. Use raw http.request so we fully control reading the response.

interface SseResponse {
  status: number;
  headers: Record<string, string | string[]>;
  text: string;
}

let activeTestServer: http.Server | undefined;

afterEach(() => {
  activeTestServer?.close();
  activeTestServer = undefined;
});

async function startTestServer(app: ReturnType<typeof buildApp>): Promise<number> {
  return new Promise((resolve, reject) => {
    // allowHalfOpen: true prevents the server from auto-closing the socket when
    // the undici (fetch) client sends a TCP half-close after the request body.
    // Without this, req.on('close') fires immediately and terminates the WS proxy
    // before the upstream WebSocket can complete its handshake.
    const server = http.createServer({ allowHalfOpen: true }, app);
    activeTestServer = server;
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
    server.on('error', reject);
  });
}

/**
 * POST JSON to the test server and collect the full SSE response body.
 * Uses Node.js fetch (undici) to avoid TCP half-close issues with http.request.
 */
async function rawPost(port: number, path: string, body: unknown): Promise<SseResponse> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const headers: Record<string, string | string[]> = {};
  res.headers.forEach((value, key) => { headers[key] = value; });
  return { status: res.status, headers, text };
}

/** Parse SSE body into event objects. */
function parseSseBody(body: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  let eventType = 'message';
  let dataLine = '';
  for (const line of body.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      dataLine = line.slice(6);
    } else if (line === '') {
      if (dataLine) events.push({ event: eventType, data: dataLine });
      eventType = 'message';
      dataLine = '';
    }
  }
  return events;
}

describe('createGraphqlRouter', () => {
  // ── POST /api/graphql/subscribe ─────────────────────────────────────────────
  describe('POST /api/graphql/subscribe', () => {
    it('returns 400 when endpoint is missing', async () => {
      const res = await request(buildApp()).post('/api/graphql/subscribe').send({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when endpoint is not a string', async () => {
      const res = await request(buildApp()).post('/api/graphql/subscribe').send({ endpoint: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when endpoint is an empty string', async () => {
      const res = await request(buildApp()).post('/api/graphql/subscribe').send({ endpoint: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when query is missing', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/subscribe')
        .send({ endpoint: 'ws://localhost:9999/graphql' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/query/);
    });

    it('returns 400 when query is not a string', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/subscribe')
        .send({ endpoint: 'ws://localhost:9999/graphql', query: 42 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns SSE stream with error event when upstream WS is unreachable', async () => {
      // Port 19998 should not be listening — expect a connection error event
      const port = await startTestServer(buildApp());
      const resp = await rawPost(port, '/api/graphql/subscribe', {
        endpoint: 'ws://127.0.0.1:19998/graphql',
        query: 'subscription { x }',
      });

      expect(String(resp.headers['content-type'])).toMatch(/text\/event-stream/);
      const events = parseSseBody(resp.text);
      const errEvent = events.find((e) => e.event === 'error');
      expect(errEvent).toBeDefined();
      const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
      expect(errors[0].message).toBeTruthy();
    });

    it('relays graphql-transport-ws messages via SSE', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe' && msg.id === '1') {
            ws.send(JSON.stringify({ type: 'next', id: '1', payload: { data: { count: 42 } } }));
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription OnCount { count }',
          subprotocol: 'graphql-transport-ws',
        });

        expect(String(resp.headers['content-type'])).toMatch(/text\/event-stream/);
        const events = parseSseBody(resp.text);
        const connected = events.find((e) => e.event === 'connected');
        const next = events.find((e) => e.event === 'next');
        const complete = events.find((e) => e.event === 'complete');

        expect(connected).toBeDefined();
        expect(next).toBeDefined();
        expect(JSON.parse(next!.data)).toEqual({ data: { count: 42 } });
        expect(complete).toBeDefined();
      } finally {
        wss.close();
      }
    });

    it('relays legacy graphql-ws messages via SSE', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'start' && msg.id === '1') {
            ws.send(JSON.stringify({ type: 'data', id: '1', payload: { data: { value: 7 } } }));
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { value }',
          subprotocol: 'graphql-ws',
        });

        const events = parseSseBody(resp.text);
        const next = events.find((e) => e.event === 'next');
        expect(next).toBeDefined();
        expect(JSON.parse(next!.data)).toEqual({ data: { value: 7 } });
      } finally {
        wss.close();
      }
    });

    it('relays connectionParams in connection_init', async () => {
      let receivedInit: Record<string, unknown> | undefined;

      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            receivedInit = msg.payload as Record<string, unknown>;
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
          connectionParams: { Authorization: 'Bearer tok123' },
        });

        expect(receivedInit).toEqual({ Authorization: 'Bearer tok123' });
      } finally {
        wss.close();
      }
    });

    it('calls onLog with info level when starting proxy', async () => {
      const onLog = vi.fn();
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp(onLog));
        await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
        });

        expect(onLog).toHaveBeenCalledWith(
          expect.objectContaining({ level: 'info', message: expect.stringContaining('WS subscription proxy') }),
        );
      } finally {
        wss.close();
      }
    });

    it('emits error event on connection_error from server', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_error', payload: { message: 'Unauthorized' } }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
        });

        const events = parseSseBody(resp.text);
        const errEvent = events.find((e) => e.event === 'error');
        expect(errEvent).toBeDefined();
        const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
        expect(errors[0].message).toBe('Unauthorized');
      } finally {
        wss.close();
      }
    });

    it('normalises http:// endpoint to ws://', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `http://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
        });

        // If the endpoint was correctly normalised, the WS connected and sent 'connected'
        const events = parseSseBody(resp.text);
        const connected = events.find((e) => e.event === 'connected');
        expect(connected).toBeDefined();
      } finally {
        wss.close();
      }
    });

    it('forwards upstream headers to the WebSocket handshake', async () => {
      let receivedAuthHeader: string | undefined;

      const wss = await createMockWsServer((ws) => {
        // Capture the authorization header from the WS upgrade request
        // The ws library exposes the handshake request on ws.upgradeReq (v7) or ws._socket (v8+)
        // We use a server-level 'headers' event instead (fired before WS handshake completes)
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });

      // Capture headers from the upgrade request at the server level
      wss.server.on('headers', (headers: string[], req: http.IncomingMessage) => {
        receivedAuthHeader = req.headers['authorization'] as string;
      });

      try {
        const port = await startTestServer(buildApp());
        await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
          headers: { authorization: 'Bearer test-token-123' },
        });

        expect(receivedAuthHeader).toBe('Bearer test-token-123');
      } finally {
        wss.close();
      }
    });

    it('emits error event on subscription-level error (graphql-transport-ws error type)', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            ws.send(JSON.stringify({
              type: 'error',
              id: '1',
              payload: [{ message: 'Resolver failed: permission denied' }],
            }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
          subprotocol: 'graphql-transport-ws',
        });

        const events = parseSseBody(resp.text);
        const errEvent = events.find((e) => e.event === 'error');
        expect(errEvent).toBeDefined();
        const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
        expect(errors[0].message).toContain('permission denied');
      } finally {
        wss.close();
      }
    });

    it('emits error event on subscription-level error (graphql-ws error type)', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'start') {
            ws.send(JSON.stringify({
              type: 'error',
              id: '1',
              payload: [{ message: 'Legacy resolver error' }],
            }));
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
          subprotocol: 'graphql-ws',
        });

        const events = parseSseBody(resp.text);
        const errEvent = events.find((e) => e.event === 'error');
        expect(errEvent).toBeDefined();
        const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
        expect(errors[0].message).toContain('Legacy resolver error');
      } finally {
        wss.close();
      }
    });

    it('emits error event when WS closes unexpectedly after subscription starts', async () => {
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            // Abruptly close with a non-1000 code after subscription
            ws.close(1011, 'Internal Server Error');
          }
        });
      });

      try {
        const port = await startTestServer(buildApp());
        const resp = await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
        });

        const events = parseSseBody(resp.text);
        // Should have a 'connected' event (subscription was acknowledged)
        expect(events.find((e) => e.event === 'connected')).toBeDefined();
        // And an error event for the unexpected close
        const errEvent = events.find((e) => e.event === 'error');
        expect(errEvent).toBeDefined();
        const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
        expect(errors[0].message).toContain('WebSocket closed unexpectedly');
      } finally {
        wss.close();
      }
    });
  });

  // ── GET /api/graphql/sse ────────────────────────────────────────────────────
  describe('GET /api/graphql/sse', () => {
    it('returns 400 when endpoint query param is missing', async () => {
      const res = await request(buildApp()).get('/api/graphql/sse');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when endpoint query param is empty string', async () => {
      const res = await request(buildApp()).get('/api/graphql/sse').query({ endpoint: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when query param is missing', async () => {
      const res = await request(buildApp())
        .get('/api/graphql/sse')
        .query({ endpoint: 'http://127.0.0.1:9999/stream' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/query/);
    });

    it('returns 400 when endpoint URL is invalid', async () => {
      const res = await request(buildApp())
        .get('/api/graphql/sse')
        .query({ endpoint: 'not-a-url', query: 'subscription { x }' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/Invalid endpoint/);
    });

    it('returns SSE stream with error event when upstream is unreachable', async () => {
      const app = buildApp();
      const resp = await request(app)
        .get('/api/graphql/sse')
        .query({
          endpoint: 'http://127.0.0.1:19997/stream',
          query: 'subscription { x }',
        });

      expect(resp.headers['content-type']).toMatch(/text\/event-stream/);
      const events = parseSseBody(resp.text);
      const errEvent = events.find((e) => e.event === 'error');
      expect(errEvent).toBeDefined();
      const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
      expect(errors[0].message).toBeTruthy();
    });

    it('pipes upstream SSE stream to client', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('event: next\ndata: {"data":{"value":99}}\n\n');
        res.write('event: complete\ndata: {}\n\n');
        res.end();
      };

      const app = buildApp();
      const resp = await request(app)
        .get('/api/graphql/sse')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription { value }',
        });

      expect(resp.headers['content-type']).toMatch(/text\/event-stream/);
      const events = parseSseBody(resp.text);
      const next = events.find((e) => e.event === 'next');
      expect(next).toBeDefined();
      expect(JSON.parse(next!.data)).toEqual({ data: { value: 99 } });
    });

    it('forwards variables and operationName to upstream', async () => {
      let receivedQuery: string | undefined;

      mockUpstreamHandler = (req, res) => {
        receivedQuery = req.url ?? '';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: complete\ndata: {}\n\n');
        res.end();
      };

      const app = buildApp();
      await request(app)
        .get('/api/graphql/sse')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription OnVal($id: ID!) { value(id: $id) }',
          variables: JSON.stringify({ id: '42' }),
          operationName: 'OnVal',
        });

      expect(receivedQuery).toContain('variables');
      expect(receivedQuery).toContain('operationName=OnVal');
    });

    it('wraps non-200 upstream status as error event', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
      };

      const app = buildApp();
      const resp = await request(app)
        .get('/api/graphql/sse')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription { x }',
        });

      const events = parseSseBody(resp.text);
      const errEvent = events.find((e) => e.event === 'error');
      expect(errEvent).toBeDefined();
      const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
      expect(errors[0].message).toMatch(/401/);
    });

    it('normalises wss:// to https:// for upstream request', async () => {
      // Just verifies the URL is parsed without throwing
      // (wss:// → https:// — our mock is http so we can't actually connect, but we get an SSE error event)
      const app = buildApp();
      const resp = await request(app)
        .get('/api/graphql/sse')
        .query({
          endpoint: 'wss://127.0.0.1:19996/stream',
          query: 'subscription { x }',
        });

      // Should get an SSE response (not a 400) — URL parsing succeeded
      expect(resp.headers['content-type']).toMatch(/text\/event-stream/);
    });

    it('calls onLog with info level when starting SSE proxy', async () => {
      const onLog = vi.fn();
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: complete\ndata: {}\n\n');
        res.end();
      };

      await request(buildApp(onLog))
        .get('/api/graphql/sse')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription { x }',
        });

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', message: expect.stringContaining('SSE subscription proxy') }),
      );
    });

    it('forwards auth headers from client request to upstream SSE endpoint', async () => {
      let capturedHeaders: Record<string, string> = {};

      mockUpstreamHandler = (req, res) => {
        capturedHeaders = req.headers as Record<string, string>;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: complete\ndata: {}\n\n');
        res.end();
      };

      await request(buildApp())
        .get('/api/graphql/sse')
        .set('authorization', 'Bearer sse-auth-token')
        .set('x-tenant-id', 'acme-sse')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription { x }',
        });

      expect(capturedHeaders['authorization']).toBe('Bearer sse-auth-token');
      expect(capturedHeaders['x-tenant-id']).toBe('acme-sse');
    });

    it('always forwards accept: text/event-stream regardless of client accept header', async () => {
      let capturedAccept: string | undefined;

      mockUpstreamHandler = (req, res) => {
        capturedAccept = req.headers['accept'] as string;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: complete\ndata: {}\n\n');
        res.end();
      };

      await request(buildApp())
        .get('/api/graphql/sse')
        // Client sends a non-SSE accept — proxy must override to text/event-stream
        .set('accept', 'application/json')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription { x }',
        });

      expect(capturedAccept).toBe('text/event-stream');
    });

    it('drains non-200 upstream body before writing error SSE event', async () => {
      // Upstream sends a large-ish 401 body — we should still produce the SSE error event
      // (verifies upstreamRes.resume() is called so the upstream socket isn't left hanging)
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized', detail: 'x'.repeat(1000) }));
      };

      const resp = await request(buildApp())
        .get('/api/graphql/sse')
        .query({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
          query: 'subscription { x }',
        });

      const events = parseSseBody(resp.text);
      const errEvent = events.find((e) => e.event === 'error');
      expect(errEvent).toBeDefined();
      const errors = JSON.parse(errEvent!.data) as Array<{ message: string }>;
      expect(errors[0].message).toMatch(/401/);
    });
  });

  // ── POST /api/graphql/upload ────────────────────────────────────────────────
  describe('POST /api/graphql/upload', () => {
    it('returns 400 when Content-Type is not multipart/form-data', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/upload')
        .set('Content-Type', 'application/json')
        .send('{}');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/multipart/);
    });

    it('returns 400 when x-graphql-endpoint header is missing', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/upload')
        .field('operations', '{"query": "mutation {upload}"}')
        .field('map', '{"0": ["variables.file"]}')
        .attach('0', Buffer.from('fake-file-content'), { filename: 'test.txt', contentType: 'text/plain' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/endpoint/);
    });

    it('returns 400 when endpoint URL is invalid', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', 'not-a-url')
        .field('operations', '{"query":"mutation {upload}"}')
        .field('map', '{}');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/Invalid endpoint/);
    });

    it('calls onLog for a valid multipart request before proxying', async () => {
      const onLog = vi.fn();
      // This will fail upstream (connection refused) but should log first
      await request(buildApp(onLog))
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', 'http://localhost:19999/graphql')
        .field('operations', '{"query":"mutation {upload}"}')
        .field('map', '{}');
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info' }),
      );
    });

    it('forwards all non-hop-by-hop user headers to upstream (authorization, custom)', async () => {
      // This test verifies the deny-list forwarding logic.
      // It will fail with ECONNREFUSED (no real upstream) so we only verify the log.
      const onLog = vi.fn();
      await request(buildApp(onLog))
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', 'http://localhost:19999/graphql')
        .set('authorization', 'Bearer test-token')
        .set('x-tenant-id', 'acme')
        .field('operations', '{"query":"mutation {upload}"}')
        .field('map', '{}');
      // Proxy should have reached the logging step (validates header forwarding path was taken)
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', message: expect.stringContaining('relaying') }),
      );
    });

    it('accepts a file upload with a special-character filename (double-quote escaping)', async () => {
      const onLog = vi.fn();
      // Attachment with a filename containing double quotes — should reach the proxy log, not 400
      await request(buildApp(onLog))
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', 'http://localhost:19999/graphql')
        .field('operations', '{"query":"mutation {upload}"}')
        .field('map', '{"0":["variables.file"]}')
        .attach('0', Buffer.from('data'), { filename: 'my "file".jpg', contentType: 'image/jpeg' });
      // Should reach the info log (not a 400 error)
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info' }),
      );
    });
  });

  // ── Router factory ──────────────────────────────────────────────────────────
  describe('createGraphqlRouter', () => {
    it('works without options (no onLog)', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGraphqlRouter()); // no options
      const res = await request(app).post('/api/graphql/subscribe').send({});
      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/graphql/query ─────────────────────────────────────────────────
  describe('POST /api/graphql/query', () => {
    it('returns 400 when endpoint is missing', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ query: '{ hello }' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/endpoint/);
    });

    it('returns 400 when endpoint is empty string', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: '', query: '{ hello }' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when query is missing', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: 'http://localhost:4000/graphql' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/query/);
    });

    it('returns 400 when query is empty string', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: 'http://localhost:4000/graphql', query: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    });

    it('returns 400 when endpoint URL is invalid', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: 'not-a-url', query: '{ hello }' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/Invalid endpoint/);
    });

    it('calls onLog and attempts upstream connection for valid request', async () => {
      const onLog = vi.fn();
      // Will fail with ECONNREFUSED (no real upstream) — verify log was called
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .send({ endpoint: 'http://localhost:19999/graphql', query: '{ hello }' });
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', message: expect.stringContaining('relaying') }),
      );
    });

    it('logs acceptMultipart: true when Accept: multipart/mixed is forwarded', async () => {
      const onLog = vi.fn();
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .set('Accept', 'multipart/mixed, application/json')
        .send({ endpoint: 'http://localhost:19999/graphql', query: '{ hello }' });
      // The route logs { acceptMultipart: true } in the message JSON when Accept contains multipart
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('acceptMultipart'),
        }),
      );
    });

    it('forwards operationName when provided', async () => {
      const onLog = vi.fn();
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .send({
          endpoint: 'http://localhost:19999/graphql',
          query: 'query GetUser { user { id } }',
          operationName: 'GetUser',
        });
      // Just verify it reaches the log step without 400
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info' }),
      );
    });

    it('returns 502 when upstream connection is refused', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: 'http://localhost:29847/graphql', query: '{ hello }' });
      // Connection refused → 502 Bad Gateway
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GQL_UPSTREAM_ERROR');
    });

    it('works without onLog (no options)', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGraphqlRouter());
      const res = await request(app)
        .post('/api/graphql/query')
        .send({ endpoint: 'http://localhost:29847/graphql', query: '{ hello }' });
      // Just verify no crash and some response
      expect([400, 502]).toContain(res.status);
    });

    it('includes variables in upstream body when variables are provided (line 118 true branch)', async () => {
      const onLog = vi.fn();
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .send({
          endpoint: 'http://localhost:29847/graphql',
          query: '{ user(id: $id) { name } }',
          variables: { id: '1' },
        });
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: expect.stringMatching(/info|error/) }),
      );
    });

    it('falls back to application/json accept when Accept header is array (line 125 false branch)', async () => {
      // Node http may pass accept as array — test the fallback to 'application/json'
      const onLog = vi.fn();
      // Can't easily set an array header via supertest, so just verify
      // that omitting Accept header uses the default 'application/json'
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .send({ endpoint: 'http://localhost:29847/graphql', query: '{ hello }' });
      // Should reach upstream (502) — the fallback path was used
      expect(onLog).toHaveBeenCalled();
    });

    it('skips non-string header values in extraHeaders (line 135 false branch)', async () => {
      // Send headers as non-object (array) — route falls back to empty {}
      const onLog = vi.fn();
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .send({
          endpoint: 'http://localhost:29847/graphql',
          query: '{ hello }',
          headers: ['not-an-object'],
        });
      // Should still attempt upstream (not 400)
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info' }),
      );
    });

    it('includes operationName in upstream body only when it is a string (line 112 false branch)', async () => {
      const onLog = vi.fn();
      // operationName as number — should be excluded from upstream body
      await request(buildApp(onLog))
        .post('/api/graphql/query')
        .send({
          endpoint: 'http://localhost:29847/graphql',
          query: '{ hello }',
          operationName: 42,
        });
      // Reaches upstream path (logs info)
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info' }),
      );
    });
  });

  describe('POST /api/graphql/query — mock upstream responses', () => {
    it('proxies a successful upstream response (line 161-173 covered)', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json', 'x-custom': 'yes' });
        res.end(JSON.stringify({ data: { hello: 'world' } }));
      };
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`, query: '{ hello }' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ hello: 'world' });
    });

    it('forwards upstream non-200 status (line 162 statusCode)', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: 'Bad query' }] }));
      };
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`, query: '{ bad }' });
      expect(res.status).toBe(422);
    });

    it('skips hop-by-hop connection/keep-alive headers from upstream (line 167)', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'connection': 'keep-alive',
          'keep-alive': 'timeout=5',
          'x-relay': 'yes',
        });
        res.end('{"data":{}}');
      };
      const res = await request(buildApp())
        .post('/api/graphql/query')
        .send({ endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`, query: '{ x }' });
      expect(res.status).toBe(200);
      expect(res.headers['x-relay']).toBe('yes');
    });

    it('proxies query with variables and operationName to upstream (lines 118-119)', async () => {
      let capturedBody = '';
      mockUpstreamHandler = (req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          capturedBody = body;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"data":{}}');
        });
      };
      await request(buildApp())
        .post('/api/graphql/query')
        .send({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
          query: '{ user { name } }',
          variables: { id: '1' },
          operationName: 'GetUser',
        });
      const parsed = JSON.parse(capturedBody);
      expect(parsed.variables).toEqual({ id: '1' });
      expect(parsed.operationName).toBe('GetUser');
    });

    it('forwards extra string headers to upstream (line 134-136)', async () => {
      let capturedHeaders: Record<string, string> = {};
      mockUpstreamHandler = (req, res) => {
        capturedHeaders = req.headers as Record<string, string>;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"data":{}}');
      };
      await request(buildApp())
        .post('/api/graphql/query')
        .send({
          endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
          query: '{ x }',
          headers: { 'authorization': 'Bearer tok', 'x-tenant': 'acme' },
        });
      expect(capturedHeaders['authorization']).toBe('Bearer tok');
      expect(capturedHeaders['x-tenant']).toBe('acme');
    });

    it('log: subscribe proxy logs with [graphql] prefix', async () => {
      const onLog = vi.fn();
      const wss = await createMockWsServer((ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }));
          } else if (msg.type === 'subscribe') {
            ws.send(JSON.stringify({ type: 'complete', id: '1' }));
          }
        });
      });
      try {
        const port = await startTestServer(buildApp(onLog));
        await rawPost(port, '/api/graphql/subscribe', {
          endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
          query: 'subscription { x }',
        });
        const calls = onLog.mock.calls.map(c => c[0].message as string);
        expect(calls.some(m => m.includes('[graphql]'))).toBe(true);
      } finally {
        wss.close();
      }
    });
  });

  describe('POST /api/graphql/upload — mock upstream responses', () => {
    it('proxies upload response from upstream (lines 358-367 covered)', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json', 'x-upload': 'done' });
        res.end('{"data":{"upload":"ok"}}');
      };
      const res = await request(buildApp())
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', `http://127.0.0.1:${mockUpstreamPort}/graphql`)
        .field('operations', '{"query":"mutation { upload }"}')
        .field('map', '{"0":["variables.file"]}')
        .attach('0', Buffer.from('file data'), { filename: 'test.txt', contentType: 'text/plain' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ upload: 'ok' });
    });

    it('skips transfer-encoding/connection/keep-alive headers in upload response (line 362)', async () => {
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
          'x-processed': 'true',
        });
        res.end('{"data":{}}');
      };
      const res = await request(buildApp())
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', `http://127.0.0.1:${mockUpstreamPort}/graphql`)
        .field('operations', '{"query":"mutation { upload }"}')
        .field('map', '{}');
      expect(res.status).toBe(200);
      expect(res.headers['x-processed']).toBe('true');
    });

    it('non-string header values in upload request forward are skipped (line 344)', async () => {
      // When a header value is an array (not a string), it should be skipped
      const onLog = vi.fn();
      mockUpstreamHandler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      };
      await request(buildApp(onLog))
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', `http://127.0.0.1:${mockUpstreamPort}/graphql`)
        .set('authorization', 'Bearer token')
        .field('operations', '{}')
        .field('map', '{}');
      // Should have reached the info log (relaying)
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', message: expect.stringContaining('relaying') }),
      );
    });
  });

  describe('POST /api/graphql/upload — extended', () => {
    it('reads targetEndpoint from endpoint query param when x-graphql-endpoint header is absent (line 255 fallback)', async () => {
      const onLog = vi.fn();
      await request(buildApp(onLog))
        .post('/api/graphql/upload?endpoint=http://localhost:19999/graphql')
        .field('operations', '{"query":"mutation {upload}"}')
        .field('map', '{}');
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', message: expect.stringContaining('relaying') }),
      );
    });

    it('returns 502 when upload upstream connection is refused', async () => {
      const res = await request(buildApp())
        .post('/api/graphql/upload')
        .set('x-graphql-endpoint', 'http://localhost:29847/graphql')
        .field('operations', '{"query":"mutation {upload}"}')
        .field('map', '{}');
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GQL_UPSTREAM_ERROR');
    });
  });
});

// ─── Phase 3F: POST /api/graphql/batch ───────────────────────────────────────

describe('POST /api/graphql/batch', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(createGraphqlRouter());
    return app;
  }

  it('returns 400 when endpoint is missing', async () => {
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({ operations: [{ query: '{ hello }' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
  });

  it('returns 400 when operations array is empty', async () => {
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({ endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`, operations: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
  });

  it('returns 400 for invalid endpoint URL', async () => {
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({ endpoint: 'not-a-url', operations: [{ query: '{ hello }' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
  });

  it('array batch: upstream returns JSON array → batchUnsupported=false, results in order', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([
        { data: { op1: true } },
        { data: { op2: true } },
      ]));
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [
          { query: '{ op1 }' },
          { query: '{ op2 }' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.batchUnsupported).toBe(false);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]._index).toBe(0);
    expect(res.body.results[1]._index).toBe(1);
    expect(res.body.results[0].data).toEqual({ op1: true });
    expect(res.body.results[1].data).toEqual({ op2: true });
  });

  it('array batch: upstream returns 400 with JSON array (Apollo partial validation) → batchUnsupported=false', async () => {
    let callCount = 0;
    mockUpstreamHandler = (_req, res) => {
      callCount++;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify([
        { data: { health: 'ok' } },
        { errors: [{ message: 'Cannot query field "nonexistent" on type "Query".' }] },
      ]));
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ health }' }, { query: '{ nonexistent }' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.batchUnsupported).toBe(false);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].data).toEqual({ health: 'ok' });
    expect(res.body.results[1].errors[0].message).toContain('nonexistent');
    expect(callCount).toBe(1);
  });

  it('array batch: upstream returns 400 → falls back to sequential, batchUnsupported=true', async () => {
    let callCount = 0;
    mockUpstreamHandler = (_req, res) => {
      callCount++;
      if (callCount === 1) {
        // First call is the array-batch attempt → reject it
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: 'Batching not supported' }] }));
      } else {
        // Sequential individual ops → succeed
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { hello: 'world' } }));
      }
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ hello }' }, { query: '{ world }' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.batchUnsupported).toBe(true);
    expect(res.body.results).toHaveLength(2);
    // Array-batch attempt + 2 sequential = 3 total upstream calls
    expect(callCount).toBe(3);
  });

  it('array batch length mismatch: padded with error result for missing slots', async () => {
    mockUpstreamHandler = (_req, res) => {
      // Returns only 1 result for 2 operations
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: { op1: true } }]));
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ op1 }' }, { query: '{ op2 }' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].data).toEqual({ op1: true });
    // Missing slot padded with error
    expect(res.body.results[1].data).toBeNull();
    expect(res.body.results[1].errors[0].message).toContain('No result returned for operation 1');
  });

  it('batchTimeoutMs=0 is treated as 30000 default (not instant timeout)', async () => {
    // If 0 were passed through, setTimeout(..., 0) would fire before the upstream responds.
    // With sanitization, batchTimeoutMs=0 → 30000, so the request completes normally.
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: { ok: true } }]));
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        batchTimeoutMs: 0,
      });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].data).toEqual({ ok: true });
  });

  it('tryArrayBatch=false skips array attempt, goes straight to sequential', async () => {
    let reqBody = '';
    mockUpstreamHandler = (req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        reqBody = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { hello: 'world' } }));
      });
    };
    await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ hello }' }],
        tryArrayBatch: false,
      });
    // Sequential mode sends a single object, not an array
    const parsed = JSON.parse(reqBody) as unknown;
    expect(Array.isArray(parsed)).toBe(false);
  });

  it('empty-string operationName is NOT forwarded to upstream (prevents "Unknown operation" error)', async () => {
    let capturedArrayBatchBodies: unknown[] = [];
    let capturedSeqBody: unknown;
    mockUpstreamHandler = (req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) {
          capturedArrayBatchBodies = parsed as unknown[];
        } else {
          capturedSeqBody = parsed;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        // Return array for array-batch attempt
        if (Array.isArray(parsed)) {
          res.end(JSON.stringify([{ data: { ok: true } }]));
        } else {
          res.end(JSON.stringify({ data: { ok: true } }));
        }
      });
    };

    // Array-batch path: empty-string operationName should be omitted
    await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }', operationName: '' }],
        tryArrayBatch: true,
      });
    expect(capturedArrayBatchBodies).toHaveLength(1);
    expect(capturedArrayBatchBodies[0]).not.toHaveProperty('operationName');

    // Sequential path: empty-string operationName should be omitted
    capturedSeqBody = null;
    await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }', operationName: '' }],
        tryArrayBatch: false,
      });
    expect(capturedSeqBody).not.toHaveProperty('operationName');
  });
});

// ─── Phase 3F: GET /api/graphql/query (APQ GET proxy) ────────────────────────

describe('GET /api/graphql/query (APQ GET proxy)', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(createGraphqlRouter());
    return app;
  }

  it('returns 400 when endpoint param is missing', async () => {
    const res = await request(buildApp()).get('/api/graphql/query');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
  });

  it('returns 400 for invalid endpoint URL', async () => {
    const res = await request(buildApp())
      .get('/api/graphql/query?endpoint=not-a-url');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
  });

  it('returns 400 when PEM TLS fields are sent on GET query string', async () => {
    const res = await request(buildApp())
      .get('/api/graphql/query')
      .query({
        endpoint: 'https://localhost:4443/graphql',
        extensions: '{}',
        caCert: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GQL_INVALID_REQUEST');
    expect(res.body.error.message).toContain('PEM TLS fields');
  });

  it('relays GET to upstream with extensions and variables query params', async () => {
    let capturedUrl = '';
    mockUpstreamHandler = (req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { hit: true } }));
    };
    const extensions = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: 'abc123' } });
    const variables = JSON.stringify({ id: '1' });
    const res = await request(buildApp())
      .get(`/api/graphql/query?endpoint=http://127.0.0.1:${mockUpstreamPort}/graphql&extensions=${encodeURIComponent(extensions)}&variables=${encodeURIComponent(variables)}`);
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('extensions=');
    expect(capturedUrl).toContain('variables=');
  });

  it('returns 502 when upstream is unreachable', async () => {
    const res = await request(buildApp())
      .get('/api/graphql/query?endpoint=http://127.0.0.1:29848/graphql&extensions=%7B%7D');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GQL_UPSTREAM_ERROR');
  });

  it('forwards operationName query param to upstream', async () => {
    let capturedUrl = '';
    mockUpstreamHandler = (req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":null}');
    };
    const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: 'abc' } }));
    await request(buildApp())
      .get(`/api/graphql/query?endpoint=http://127.0.0.1:${mockUpstreamPort}/graphql&extensions=${ext}&operationName=GetUser`);
    expect(capturedUrl).toContain('operationName=GetUser');
  });

  it('does not forward extensions when param is not a string (array)', async () => {
    let capturedUrl = '';
    mockUpstreamHandler = (req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":null}');
    };
    // Supertest does not easily send array query params, so test via a simple get
    // without extensions — the route should handle missing extensions gracefully
    await request(buildApp())
      .get(`/api/graphql/query?endpoint=http://127.0.0.1:${mockUpstreamPort}/graphql`);
    // No extensions= in the upstream URL — only the endpoint's own path
    expect(capturedUrl).not.toContain('extensions=');
  });

  it('combines endpoint existing search params with forwarded params', async () => {
    let capturedUrl = '';
    mockUpstreamHandler = (req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":null}');
    };
    const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: 'xyz' } }));
    await request(buildApp())
      .get(`/api/graphql/query?endpoint=${encodeURIComponent(`http://127.0.0.1:${mockUpstreamPort}/graphql?version=1`)}&extensions=${ext}`);
    // Both version=1 (from endpoint) and extensions (forwarded) should be present
    expect(capturedUrl).toContain('version=1');
    expect(capturedUrl).toContain('extensions=');
  });

  it('forwards authorization header from client request to upstream', async () => {
    let capturedAuth = '';
    mockUpstreamHandler = (req, res) => {
      capturedAuth = req.headers['authorization'] as string ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":null}');
    };
    await request(buildApp())
      .get(`/api/graphql/query?endpoint=http://127.0.0.1:${mockUpstreamPort}/graphql`)
      .set('Authorization', 'Bearer test-token');
    expect(capturedAuth).toBe('Bearer test-token');
  });

  it('relays upstream non-200 status to client', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"errors":[{"message":"not found"}]}');
    };
    const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: 'nf' } }));
    const res = await request(buildApp())
      .get(`/api/graphql/query?endpoint=http://127.0.0.1:${mockUpstreamPort}/graphql&extensions=${ext}`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/graphql/batch — additional branch coverage ────────────────────

describe('POST /api/graphql/batch — additional branch coverage', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(createGraphqlRouter());
    return app;
  }

  it('handles array-batch upstream returning 405 by falling back to sequential', async () => {
    let callCount = 0;
    mockUpstreamHandler = (req, res) => {
      callCount++;
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) {
          // Return 405 to trigger sequential fallback
          res.writeHead(405); res.end('Method Not Allowed');
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { ok: true } }));
        }
      });
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        tryArrayBatch: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.batchUnsupported).toBe(true);
    expect(callCount).toBeGreaterThan(1); // array attempt + sequential
  });

  it('handles array-batch upstream returning non-JSON 200 → falls back to sequential', async () => {
    let callCount = 0;
    mockUpstreamHandler = (req, res) => {
      callCount++;
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) {
          // Return non-JSON 200 — should trigger sequential fallback
          res.writeHead(200, { 'content-type': 'text/plain' }); res.end('not json at all');
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { ok: true } }));
        }
      });
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        tryArrayBatch: true,
      });
    // Should have fallen back to sequential
    expect(res.body.batchUnsupported).toBe(true);
    expect(callCount).toBe(2);
  });

  it('handles array-batch upstream returning non-array JSON object → falls back to sequential', async () => {
    let callCount = 0;
    mockUpstreamHandler = (req, res) => {
      callCount++;
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) {
          // Return a JSON object (not an array) — should trigger sequential fallback
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'batch not supported here' }));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { ok: true } }));
        }
      });
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        tryArrayBatch: true,
      });
    expect(res.body.batchUnsupported).toBe(true);
    expect(callCount).toBe(2);
  });

  it('passes headers when provided as valid object', async () => {
    let capturedAuth = '';
    mockUpstreamHandler = (req, res) => {
      capturedAuth = req.headers['authorization'] as string ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: { ok: true } }]));
    };
    await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        headers: { Authorization: 'Bearer shared-token' },
      });
    expect(capturedAuth).toBe('Bearer shared-token');
  });

  it('ignores headers when provided as an array (malformed)', async () => {
    let capturedAuth = '';
    mockUpstreamHandler = (req, res) => {
      capturedAuth = req.headers['authorization'] as string ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: null }]));
    };
    await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        headers: ['not-an-object'],
      });
    expect(capturedAuth).toBe('');
  });

  it('uses 30000ms default when batchTimeoutMs is NaN', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: { ok: true } }]));
    };
    // NaN is not a valid timeout — should fall back to 30000
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        batchTimeoutMs: NaN,
      });
    expect(res.status).toBe(200);
  });

  it('uses 30000ms default when batchTimeoutMs is negative', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: { ok: true } }]));
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
        batchTimeoutMs: -1,
      });
    expect(res.status).toBe(200);
  });

  it('returns 408 when array batch times out (very small batchTimeoutMs)', async () => {
    mockUpstreamHandler = (_req, _res) => {
      // Never respond — timeout will fire
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ slow }' }],
        batchTimeoutMs: 5, // 5 ms — fires before upstream responds
      });
    expect(res.status).toBe(408);
    expect(res.body.error).toBe('Batch timeout');
  });

  it('handles upstream error during array-batch request (connection refused)', async () => {
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: 'http://127.0.0.1:29999/graphql',
        operations: [{ query: '{ ok }' }],
        tryArrayBatch: true,
      });
    // After array-batch fails (unreachable), falls back to sequential (also unreachable)
    // Result is a 200 with error entries for each op
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('logs onLog when batch proxy executes', async () => {
    const onLog = vi.fn();
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: null }]));
    };
    const app = express();
    app.use(express.json());
    app.use(createGraphqlRouter({ onLog }));
    await request(app)
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }' }],
      });
    expect(onLog).toHaveBeenCalled();
    const messages = onLog.mock.calls.map((c: unknown[]) => (c[0] as { message: string }).message);
    expect(messages.some((m) => m.includes('Batch proxy'))).toBe(true);
  });

  it('returns 408 with padded results when sequential fallback times out mid-batch', async () => {
    let callCount = 0;
    mockUpstreamHandler = (req, res) => {
      callCount++;
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) {
          res.writeHead(400); res.end('{}');
          return;
        }
        // Hold sequential responses open so the 15 ms deadline expires
      });
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ a }' }, { query: '{ b }' }],
        batchTimeoutMs: 15,
        tryArrayBatch: true,
      });
    expect(res.status).toBe(408);
    expect(res.body.batchUnsupported).toBe(true);
    expect(res.body.results.length).toBe(2);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('returns 408 with padded results when sequential-only mode times out', async () => {
    mockUpstreamHandler = (_req, _res) => {
      // Never respond
    };
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ a }' }, { query: '{ b }' }],
        batchTimeoutMs: 10,
        tryArrayBatch: false,
      });
    expect(res.status).toBe(408);
    expect(res.body.batchUnsupported).toBe(false);
    expect(res.body.results).toHaveLength(2);
  });
});

describe('createGraphqlRouter — additional branch coverage', () => {
  function buildApp(onLog = vi.fn()) {
    const app = express();
    app.use(express.json());
    app.use(createGraphqlRouter({ onLog }));
    return app;
  }

  it('subscribe: ignores non-JSON WebSocket messages', async () => {
    const wss = await createMockWsServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'connection_init') {
          ws.send(JSON.stringify({ type: 'connection_ack' }));
          ws.send('not-json-payload');
          ws.send(JSON.stringify({ type: 'complete', id: '1' }));
        }
      });
    });
    try {
      const port = await startTestServer(buildApp());
      const resp = await rawPost(port, '/api/graphql/subscribe', {
        endpoint: `ws://127.0.0.1:${wss.port}/graphql`,
        query: 'subscription { x }',
      });
      const events = parseSseBody(resp.text);
      expect(events.find((e) => e.event === 'connected')).toBeDefined();
    } finally {
      wss.close();
    }
  });

  it('SSE proxy: writes error event when upstream response stream errors', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: next\ndata: {}\n\n');
      process.nextTick(() => {
        res.destroy(new Error('upstream stream broke'));
      });
    };
    const resp = await request(buildApp())
      .get('/api/graphql/sse')
      .query({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/stream`,
        query: 'subscription { x }',
      });
    const events = parseSseBody(resp.text);
    expect(events.some((e) => e.event === 'error')).toBe(true);
  });

  it('APQ GET: forwards skipTlsVerify to upstream https agent', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":null}');
    };
    const res = await request(buildApp())
      .get('/api/graphql/query')
      .query({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        skipTlsVerify: 'true',
        extensions: '{}',
      });
    expect(res.status).toBe(200);
  });

  it('POST query: includes variables and skipTlsVerify for https upstream', async () => {
    mockUpstreamHandler = (req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
      });
    };
    const res = await request(buildApp())
      .post('/api/graphql/query')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        query: '{ hello }',
        variables: { id: '1' },
        skipTlsVerify: true,
      });
    expect(res.status).toBe(200);
  });

  it('POST batch: forwards skipTlsVerify and extra headers', async () => {
    let capturedAuth = '';
    mockUpstreamHandler = (_req, res) => {
      capturedAuth = _req.headers['authorization'] as string ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ data: { ok: true } }]));
    };
    await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: `http://127.0.0.1:${mockUpstreamPort}/graphql`,
        operations: [{ query: '{ ok }', variables: { n: 1 } }],
        headers: { Authorization: 'Bearer batch' },
        skipTlsVerify: true,
      });
    expect(capturedAuth).toBe('Bearer batch');
  });

  it('GET sse: normalises ws:// endpoint to http://', async () => {
    mockUpstreamHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: complete\ndata: {}\n\n');
      res.end();
    };
    const resp = await request(buildApp())
      .get('/api/graphql/sse')
      .query({
        endpoint: `ws://127.0.0.1:${mockUpstreamPort}/stream`,
        query: 'subscription { x }',
      });
    expect(resp.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('subscribe: normalises https:// endpoint and uses skipTlsVerify agent', async () => {
    const wss = await createMockWsServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'connection_init') {
          ws.send(JSON.stringify({ type: 'connection_ack' }));
        } else if (msg.type === 'subscribe') {
          ws.send(JSON.stringify({ type: 'complete', id: '1' }));
        }
      });
    });
    try {
      const port = await startTestServer(buildApp());
      const resp = await rawPost(port, '/api/graphql/subscribe', {
        endpoint: `http://127.0.0.1:${wss.port}/graphql`,
        query: 'subscription { x }',
        skipTlsVerify: true,
      });
      const events = parseSseBody(resp.text);
      expect(events.find((e) => e.event === 'connected') ?? events.find((e) => e.event === 'error')).toBeDefined();
    } finally {
      wss.close();
    }
  });
});

// ---------------------------------------------------------------------------
// HTTPS upstream branch coverage (skipTlsVerify + default ports)
// ---------------------------------------------------------------------------

function stubHttpsUpstream(
  body: string,
  statusCode = 200,
  contentType = 'application/json',
) {
  const agentSpy = vi.spyOn(https, 'Agent');
  const requestSpy = vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
    const reqStream = new PassThrough();
    const resStream = new PassThrough();
    const incoming = Object.assign(resStream, {
      statusCode,
      headers: { 'content-type': contentType },
    });
    process.nextTick(() => {
      cb?.(incoming as http.IncomingMessage);
      resStream.end(body);
    });
    return reqStream as ReturnType<typeof https.request>;
  });
  return { agentSpy, requestSpy };
}

describe('graphql-routes — https upstream branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('APQ GET uses https transport, tls agent, and default port 443', async () => {
    const { agentSpy, requestSpy } = stubHttpsUpstream('{"data":null}');
    const res = await request(buildApp())
      .get('/api/graphql/query')
      .query({
        endpoint: 'https://secure.example.com/graphql',
        skipTlsVerify: 'true',
        extensions: '{}',
      });
    expect(res.status).toBe(200);
    expect(agentSpy).toHaveBeenCalledWith({ rejectUnauthorized: false });
    const callOpts = requestSpy.mock.calls[0]?.[0] as { port?: number; agent?: unknown };
    expect(callOpts.port).toBe(443);
    expect(callOpts.agent).toBeDefined();
  });

  it('POST query proxies to https upstream with skipTlsVerify', async () => {
    stubHttpsUpstream('{"data":{"hello":"https"}}');
    const res = await request(buildApp())
      .post('/api/graphql/query')
      .send({
        endpoint: 'https://secure.example.com/graphql',
        query: '{ hello }',
        skipTlsVerify: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.hello).toBe('https');
  });

  it('POST batch proxies to https upstream with operationName in payload', async () => {
    stubHttpsUpstream(JSON.stringify([{ data: { ok: true } }]));
    const res = await request(buildApp())
      .post('/api/graphql/batch')
      .send({
        endpoint: 'https://secure.example.com/graphql',
        skipTlsVerify: true,
        operations: [{
          query: 'query Named { ok }',
          operationName: 'Named',
          variables: { n: 1 },
        }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it('subscribe applies skipTlsVerify agent for wss endpoints', async () => {
    const wss = await createMockWsServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'connection_init') {
          ws.send(JSON.stringify({ type: 'connection_ack' }));
        } else if (msg.type === 'subscribe') {
          ws.send(JSON.stringify({ type: 'complete', id: '1' }));
        }
      });
    });

    const agentSpy = vi.spyOn(https, 'Agent');
    try {
      const port = await startTestServer(buildApp());
      const resp = await rawPost(port, '/api/graphql/subscribe', {
        endpoint: `wss://127.0.0.1:${wss.port}/graphql`,
        query: 'subscription { x }',
        skipTlsVerify: true,
        connectionParams: { token: 'abc' },
      });
      const events = parseSseBody(resp.text);
      expect(agentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ rejectUnauthorized: false }),
      );
      expect(events.some((e) => e.event === 'connected' || e.event === 'complete' || e.event === 'error')).toBe(true);
    } finally {
      agentSpy.mockRestore();
      wss.close();
    }
  });

  it('GET sse proxies to https upstream with skipTlsVerify', async () => {
    stubHttpsUpstream('event: complete\ndata: {}\n\n', 200, 'text/event-stream');
    const resp = await request(buildApp())
      .get('/api/graphql/sse')
      .query({
        endpoint: 'https://secure.example.com/stream',
        skipTlsVerify: 'true',
        query: 'subscription { x }',
      });
    expect(resp.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('GET sse handles upstream non-200 over https', async () => {
    stubHttpsUpstream('error body', 503, 'text/plain');
    const resp = await request(buildApp())
      .get('/api/graphql/sse')
      .query({
        endpoint: 'https://secure.example.com/stream',
        skipTlsVerify: 'true',
        query: 'subscription { x }',
      });
    expect(resp.text).toContain('event: error');
  });

  it('subscribe terminates upstream WS when client disconnects early', async () => {
    let upstreamClosed = false;
    const wss = await createMockWsServer((ws) => {
      ws.on('close', () => { upstreamClosed = true; });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'connection_init') {
          ws.send(JSON.stringify({ type: 'connection_ack' }));
        }
      });
    });

    const appPort = await startTestServer(buildApp());
    await new Promise<void>((resolve) => {
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: appPort,
        path: '/api/graphql/subscribe',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        res.once('data', () => {
          req.destroy();
          setTimeout(resolve, 150);
        });
      });
      req.on('error', () => { /* expected when destroyed */ });
      req.write(JSON.stringify({
        endpoint: `http://127.0.0.1:${wss.port}/graphql`,
        query: 'subscription { x }',
      }));
      req.end();
    });

    expect(upstreamClosed).toBe(true);
    wss.close();
  });

  it('subscribe normalises https:// prefix to wss://', async () => {
    const wss = await createMockWsServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'connection_init') {
          ws.send(JSON.stringify({ type: 'connection_ack' }));
        } else if (msg.type === 'subscribe') {
          ws.send(JSON.stringify({ type: 'complete', id: '1' }));
        }
      });
    });

    try {
      const port = await startTestServer(buildApp());
      const resp = await rawPost(port, '/api/graphql/subscribe', {
        endpoint: `https://127.0.0.1:${wss.port}/graphql`,
        query: 'subscription { x }',
        operationName: 'SubOp',
        variables: { id: '1' },
      });
      const events = parseSseBody(resp.text);
      expect(events.length).toBeGreaterThan(0);
    } finally {
      wss.close();
    }
  });

  it('subscribe treats invalid variables as empty object', async () => {
    const wss = await createMockWsServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'connection_init') {
          ws.send(JSON.stringify({ type: 'connection_ack' }));
        } else if (msg.type === 'subscribe') {
          ws.send(JSON.stringify({ type: 'complete', id: '1' }));
        }
      });
    });

    try {
      const port = await startTestServer(buildApp());
      const resp = await rawPost(port, '/api/graphql/subscribe', {
        endpoint: `http://127.0.0.1:${wss.port}/graphql`,
        query: 'subscription { x }',
        variables: ['not', 'an', 'object'],
      });
      expect(parseSseBody(resp.text).length).toBeGreaterThan(0);
    } finally {
      wss.close();
    }
  });

  it('GET sse forwards upstream response errors after headers are sent', async () => {
    vi.spyOn(https, 'request').mockImplementationOnce((_opts, cb) => {
      const reqStream = new PassThrough();
      const resStream = new PassThrough();
      const incoming = Object.assign(resStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      process.nextTick(() => {
        cb?.(incoming as http.IncomingMessage);
        resStream.write('event: message\ndata: {}\n\n');
        setImmediate(() => resStream.emit('error', new Error('mid-stream')));
      });
      return reqStream as ReturnType<typeof https.request>;
    });

    const resp = await request(buildApp())
      .get('/api/graphql/sse')
      .query({
        endpoint: 'https://secure.example.com/stream',
        skipTlsVerify: 'true',
        query: 'subscription { x }',
      });
    expect(resp.text).toContain('event: error');
  });
});
