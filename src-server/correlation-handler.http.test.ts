/**
 * Correlation handler — HTTP route integration tests.
 *
 * Store/utility coverage lives in `correlation-handler.test.ts`. Security /
 * idempotency / notifyResume coverage lives in
 * `correlation-handler.security.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearAllCorrelations,
  setCorrelationStore,
  getUnmatchedWebhooks,
  createCorrelationRouter,
  notifyResume,
  runResumeQueueCleanup,
  type ServerPausedEntry,
} from './correlation-handler.js';
import { InMemoryServerStore } from './correlation-store-memory.js';
import { configureWebhookSecurity, generateHmacSignature } from './webhook-security.js';
import { clearIdempotency } from './webhook-idempotency.js';
import { TEST_HMAC_SECRET } from './__test-utils__/correlationTestHelpers.js';

describe('correlation-handler — HTTP routes', () => {
  let request: ReturnType<typeof import('supertest')['default']>;

  beforeEach(async () => {
    setCorrelationStore(new InMemoryServerStore());
    clearAllCorrelations();
    clearIdempotency();
    configureWebhookSecurity({ enabled: false, ipWhitelist: [] });
    const express = await import('express');
    const supertest = await import('supertest');
    const localApp = express.default();
    localApp.use(express.default.json());
    localApp.use(createCorrelationRouter());
    request = supertest.default(localApp) as typeof request;
  });

  it('POST /api/correlations/pause — registers a paused workflow', async () => {
    const res = await request
      .post('/api/correlations/pause')
      .send({
        correlationId: 'pay_123',
        webhookPath: '/webhooks/callback/payment',
        executionId: 'exec-1',
        workflowId: 'wf-1',
        pausedNodeId: 'cw1',
        timeoutMs: 60000,
        correlationSource: 'body',
        correlationJsonPath: 'paymentId',
      });

    expect(res.status).toBe(201);
    expect(res.body.paused).toBe(true);
    expect(res.body.correlationId).toBe('pay_123');
  });

  it('POST /api/correlations/pause — rejects missing fields', async () => {
    const res = await request.post('/api/correlations/pause').send({ correlationId: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing required fields');
  });

  it('POST /api/correlations/pause — rejects duplicate', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'dup', webhookPath: '/wh', executionId: 'e1',
    });
    const res = await request.post('/api/correlations/pause').send({
      correlationId: 'dup', webhookPath: '/wh', executionId: 'e2',
    });
    expect(res.status).toBe(409);
  });

  it('POST /api/correlations/resume — resumes a paused workflow', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'resume-me',
      webhookPath: '/wh',
      executionId: 'e1',
      workflowId: 'wf-1',
    });

    const res = await request.post('/api/correlations/resume').send({
      correlationId: 'resume-me',
      webhookData: { status: 'approved' },
    });

    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(res.body.executionId).toBe('e1');
  });

  it('POST /api/correlations/resume — returns false for no match', async () => {
    const res = await request.post('/api/correlations/resume').send({ correlationId: 'nonexistent' });
    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(false);
  });

  it('POST /api/correlations/resume — rejects missing correlationId', async () => {
    const res = await request.post('/api/correlations/resume').send({});
    expect(res.status).toBe(400);
  });

  it('GET /api/correlations — lists all paused', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'c1', webhookPath: '/wh', executionId: 'e1',
    });
    await request.post('/api/correlations/pause').send({
      correlationId: 'c2', webhookPath: '/wh', executionId: 'e2',
    });

    const res = await request.get('/api/correlations');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.correlations).toHaveLength(2);
  });

  it('DELETE /api/correlations/:id — cancels a correlation', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'cancel-me', webhookPath: '/wh', executionId: 'e1',
    });

    const res = await request.delete('/api/correlations/cancel-me');
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });

  it('DELETE /api/correlations/:id — 404 for nonexistent', async () => {
    const res = await request.delete('/api/correlations/nope');
    expect(res.status).toBe(404);
  });

  it('POST /api/correlations/cleanup — removes expired', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'exp', webhookPath: '/wh', executionId: 'e1', timeoutMs: 1,
    });
    await new Promise(r => setTimeout(r, 10));
    const res = await request.post('/api/correlations/cleanup');
    expect(res.status).toBe(200);
    expect(res.body.cleaned).toBe(1);
  });

  it('POST /webhooks/callback/* — treats stripped parsed body as empty object when security is off', async () => {
    const express = await import('express');
    const supertest = await import('supertest');
    const app = express.default();
    app.use(express.default.json());
    app.use((req, _res, next) => {
      if (req.method !== 'GET' && req.path.startsWith('/webhooks/callback')) {
        req.body = undefined;
      }
      next();
    });
    app.use(createCorrelationRouter());
    const http = supertest.default(app);

    await http.post('/api/correlations/pause').send({
      correlationId: 'undef-body',
      webhookPath: '/webhooks/callback/undef-body',
      executionId: 'e-ud',
      correlationSource: 'header',
      correlationHeader: 'X-Cid',
    });

    const res = await http
      .post('/webhooks/callback/undef-body')
      .set('X-Cid', 'undef-body')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(res.body.webhookData).toEqual({});
  });

  it('POST /webhooks/callback/* — matches and resumes', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'wh_match',
      webhookPath: '/webhooks/callback/payment',
      executionId: 'e1',
      workflowId: 'wf-1',
      correlationSource: 'body',
      correlationJsonPath: 'paymentId',
    });

    const res = await request
      .post('/webhooks/callback/payment')
      .send({ paymentId: 'wh_match', status: 'approved', amount: 99.99 });

    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(res.body.correlationId).toBe('wh_match');
    expect(res.body.webhookData.status).toBe('approved');
  });

  it('POST /webhooks/callback/* — 404 when no match', async () => {
    const res = await request.post('/webhooks/callback/unknown').send({ paymentId: 'no_match' });
    expect(res.status).toBe(404);
    expect(res.body.resumed).toBe(false);
  });

  it('POST /webhooks/callback/* — unmatched records correlation_id and id hints', async () => {
    // Use sequential requests to avoid connection issues
    const res1 = await request.post('/webhooks/callback/unmatched-corr-id').send({ correlation_id: 'hint-corr-id' });
    expect(res1.status).toBe(404);
    const res2 = await request.post('/webhooks/callback/unmatched-plain-id').send({ id: 'hint-plain-id' });
    expect(res2.status).toBe(404);
    const unmatched = getUnmatchedWebhooks();
    expect(unmatched.some(e => e.correlationId === 'hint-corr-id')).toBe(true);
    expect(unmatched.some(e => e.correlationId === 'hint-plain-id')).toBe(true);
  }, 10000);

  it('GET /api/correlations/unmatched — returns unmatched log', async () => {
    await request.post('/webhooks/callback/nowhere').send({ correlationId: 'orphan' });
    const res = await request.get('/api/correlations/unmatched');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.unmatched[0].path).toBe('/webhooks/callback/nowhere');
  }, 10000);

  it('GET /api/correlations/idempotency — reports store size', async () => {
    const res = await request.get('/api/correlations/idempotency');
    expect(res.status).toBe(200);
    expect(typeof res.body.size).toBe('number');
  });

  it('POST /webhooks/callback/* — processes a new pause when idempotency cache exists but the new correlation is still paused', async () => {
    const path = '/webhooks/callback/idempotency-bypass';
    const idem = { 'x-idempotency-key': 'idem-bypass-shared' };

    await request.post('/api/correlations/pause').send({
      correlationId: 'idem-first',
      webhookPath: path,
      executionId: 'e-first',
      correlationSource: 'body',
      correlationJsonPath: 'cid',
    });

    const r1 = await request.post(path).set(idem).send({ cid: 'idem-first', round: 1 });
    expect(r1.status).toBe(200);
    expect(r1.body.correlationId).toBe('idem-first');

    await request.post('/api/correlations/pause').send({
      correlationId: 'idem-second',
      webhookPath: path,
      executionId: 'e-second',
      correlationSource: 'body',
      correlationJsonPath: 'cid',
    });

    const r2 = await request.post(path).set(idem).send({ cid: 'idem-second', round: 2 });
    expect(r2.status).toBe(200);
    expect(r2.body.correlationId).toBe('idem-second');
    expect(r2.body.executionId).toBe('e-second');
  }, 15000);

  it('POST /webhooks/callback/* — rejects payload when webhook filter fails', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'flt-1',
      webhookPath: '/webhooks/callback/flt-path',
      executionId: 'e1',
      correlationSource: 'body',
      correlationJsonPath: 'id',
      webhookFilter: '{{status}} == ok',
    });

    const res = await request.post('/webhooks/callback/flt-path').send({ id: 'flt-1', status: 'bad' });
    expect(res.status).toBe(422);
    expect(res.body.resumed).toBe(false);
  });

  describe('GET /api/correlations/:id/wait', () => {
    it('uses configured default wait window when timeoutMs query is empty', async () => {
      const express = await import('express');
      const supertest = await import('supertest');
      const localApp = express.default();
      localApp.use(express.default.json());
      localApp.use(createCorrelationRouter({ defaultWaitMs: 30, minWaitMs: 10, maxWaitMs: 120000 }));
      const localRequest = supertest.default(localApp);

      const res = await localRequest.get('/api/correlations/empty-timeout-qs/wait?timeoutMs=');
      expect(res.body.timedOut).toBe(true);
      expect(res.body.resumed).toBe(false);
    }, 10000);

    it('returns timedOut=true when no resume occurs within the wait window', async () => {
      const express = await import('express');
      const supertest = await import('supertest');
      const localApp = express.default();
      localApp.use(express.default.json());
      localApp.use(createCorrelationRouter({ defaultWaitMs: 30, minWaitMs: 10, maxWaitMs: 120000 }));
      const localRequest = supertest.default(localApp);

      const res = await localRequest.get('/api/correlations/never/wait?timeoutMs=30');
      expect(res.status).toBe(200);
      expect(res.body.resumed).toBe(false);
      expect(res.body.timedOut).toBe(true);
      expect(res.body.correlationId).toBe('never');
    }, 15_000);

    it('returns queued resume data immediately if already resumed', async () => {
      await request.post('/api/correlations/pause').send({
        correlationId: 'q1',
        webhookPath: '/wh',
        executionId: 'e1',
        workflowId: 'wf-1',
      });
      await request.post('/api/correlations/resume').send({
        correlationId: 'q1',
        webhookData: { foo: 'bar' },
      });

      const res = await request.get('/api/correlations/q1/wait?timeoutMs=2000');
      expect(res.status).toBe(200);
      expect(res.body.resumed).toBe(true);
      expect(res.body.webhookData).toEqual({ foo: 'bar' });
      expect(res.body.executionId).toBe('e1');
    });

    it('parks the request and resolves when a webhook arrives', async () => {
      await request.post('/api/correlations/pause').send({
        correlationId: 'park-1',
        webhookPath: '/webhooks/callback/payment',
        executionId: 'e1',
        workflowId: 'wf-1',
        correlationSource: 'body',
        correlationJsonPath: 'correlationId',
      });

      // SuperTest 7.3 shares one server per app and closes it when the
      // in-flight count hits zero. Calling `.then()` starts the long-poll
      // so the webhook POST below cannot close the server first.
      const waitPromise = request
        .get('/api/correlations/park-1/wait?timeoutMs=5000')
        .then(res => res);

      await new Promise(r => setTimeout(r, 50));
      const cb = await request
        .post('/webhooks/callback/payment')
        .send({ correlationId: 'park-1', value: 42 });
      expect(cb.status).toBe(200);
      expect(cb.body.resumed).toBe(true);

      const res = await waitPromise;
      expect(res.status).toBe(200);
      expect(res.body.resumed).toBe(true);
      expect(res.body.webhookData).toMatchObject({ correlationId: 'park-1', value: 42 });
    });

    it('cleans up waiters when the client disconnects before resume', async () => {
      const http = await import('node:http');
      const express = await import('express');
      const supertest = await import('supertest');
      const localApp = express.default();
      localApp.use(express.default.json());
      localApp.use(createCorrelationRouter({ defaultWaitMs: 30, minWaitMs: 10, maxWaitMs: 120000 }));
      const server = http.createServer(localApp);
      await new Promise<void>(r => server.listen(0, r));
      const port = (server.address() as import('net').AddressInfo).port;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/correlations/tcp-close/wait?timeoutMs=9000',
          method: 'GET',
        },
        res => {
          res.resume();
        },
      );
      req.on('error', () => {});
      req.end();
      await new Promise(r => setTimeout(r, 40));
      req.destroy();

      await new Promise(r => setTimeout(r, 120));

      const fin = await supertest.default(localApp).get('/api/correlations/tcp-close/wait?timeoutMs=20');
      expect(fin.body.timedOut).toBe(true);
      expect(fin.body.resumed).toBe(false);

      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    });

    it('enforces a minimum 1000ms wait when given a tiny positive timeoutMs', async () => {
      const express = await import('express');
      const supertest = await import('supertest');
      const localApp = express.default();
      localApp.use(express.default.json());
      localApp.use(createCorrelationRouter({ defaultWaitMs: 30, minWaitMs: 25, maxWaitMs: 120000 }));
      const localRequest = supertest.default(localApp);

      const start = Date.now();
      const res = await localRequest.get('/api/correlations/clamp/wait?timeoutMs=1');
      const elapsed = Date.now() - start;
      expect(res.body.timedOut).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(20);
    }, 5000);

    it('clamps large timeoutMs to configured max window (returns within timeout)', async () => {
      const express = await import('express');
      const supertest = await import('supertest');
      const localApp = express.default();
      localApp.use(express.default.json());
      localApp.use(createCorrelationRouter({ defaultWaitMs: 30, minWaitMs: 10, maxWaitMs: 40 }));
      const localRequest = supertest.default(localApp);

      const start = Date.now();
      const res = await localRequest.get('/api/correlations/big-timeout/wait?timeoutMs=999999');
      const elapsed = Date.now() - start;
      expect(res.body.timedOut).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    }, 5000);
  });

  it('POST /api/correlations/pause — uses unknown for missing workflowId and pausedNodeId', async () => {
    const res = await request.post('/api/correlations/pause').send({
      correlationId: 'no-wf-node',
      webhookPath: '/webhooks/callback/test',
      executionId: 'exec-1',
      correlationSource: 'body',
      correlationJsonPath: 'id',
    });

    expect(res.status).toBe(201);

    const listRes = await request.get('/api/correlations');
    expect(listRes.body.correlations).toBeDefined();
    const entry = listRes.body.correlations.find((e: ServerPausedEntry) => e.correlationId === 'no-wf-node');
    expect(entry).toBeDefined();
    expect(entry!.workflowId).toBe('unknown');
    expect(entry!.pausedNodeId).toBe('unknown');
  });

  it('POST /api/correlations/pause — sets timeoutAt to 0 when timeoutMs is 0', async () => {
    const res = await request.post('/api/correlations/pause').send({
      correlationId: 'zero-timeout',
      webhookPath: '/webhooks/callback/test',
      executionId: 'exec-1',
      timeoutMs: 0,
      correlationSource: 'body',
      correlationJsonPath: 'id',
    });

    expect(res.status).toBe(201);
    expect(res.body.timeoutAt).toBe(0);
  });

  it('POST /api/correlations/pause — omits webhookToken when security is disabled', async () => {
    const res = await request.post('/api/correlations/pause').send({
      correlationId: 'no-sec-token',
      webhookPath: '/webhooks/callback/test',
      executionId: 'exec-1',
      correlationSource: 'body',
      correlationJsonPath: 'id',
    });

    expect(res.status).toBe(201);
    expect(res.body.webhookToken).toBeUndefined();
  });

  it('POST /api/correlations/resume — uses empty object when webhookData is omitted', async () => {
    await request.post('/api/correlations/pause').send({
      correlationId: 'no-data-resume',
      webhookPath: '/webhooks/callback/test',
      executionId: 'exec-1',
      correlationSource: 'body',
      correlationJsonPath: 'id',
    });

    const res = await request.post('/api/correlations/resume').send({ correlationId: 'no-data-resume' });

    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(res.body.webhookData).toEqual({});
  });
});

describe('correlation-handler — webhook callback string body', () => {
  beforeEach(() => {
    setCorrelationStore(new InMemoryServerStore());
    clearAllCorrelations();
    clearIdempotency();
    configureWebhookSecurity({
      enabled: true,
      secret: TEST_HMAC_SECRET,
      ipWhitelist: [],
    });
  });

  afterEach(() => {
    configureWebhookSecurity({ enabled: false, ipWhitelist: [] });
    clearIdempotency();
  });

  it('POST /webhooks/callback/* — validates HMAC using string req.body', async () => {
    const express = await import('express');
    const supertest = await import('supertest');
    const app = express.default();
    app.use((req, res, next) => {
      if (req.path.startsWith('/webhooks/callback')) {
        return express.default.text({ type: '*/*' })(req, res, next);
      }
      return express.default.json()(req, res, next);
    });
    app.use(createCorrelationRouter());
    const http = supertest.default(app);

    await http.post('/api/correlations/pause').send({
      correlationId: 'str-body-corr',
      webhookPath: '/webhooks/callback/str-body',
      executionId: 'e-str',
      correlationSource: 'header',
      correlationHeader: 'X-Cid',
    });

    const raw = JSON.stringify({ note: 'raw-payload' });
    const sig = generateHmacSignature(raw);
    const res = await http
      .post('/webhooks/callback/str-body')
      .set('Content-Type', 'text/plain; charset=utf-8')
      .set('X-Cid', 'str-body-corr')
      .set('x-webhook-signature', sig)
      .send(raw);

    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
  });
});

describe('correlation-handler — resume queue TTL (real clock)', () => {
  it(
    'expires queued resume data after the periodic cleanup interval',
    async () => {
      const express = await import('express');
      const supertest = await import('supertest');
      const app = express.default();
      app.use(express.default.json());
      app.use(createCorrelationRouter({ defaultWaitMs: 30, minWaitMs: 10, maxWaitMs: 120000 }));
      const http = supertest.default(app);

      const staleTs = Date.now() - 10 * 60 * 1000;
      notifyResume('queue-real-ttl', {
        webhookData: { stale: true },
        executionId: 'e-ttl',
        workflowId: 'w-ttl',
        ts: staleTs,
      });
      runResumeQueueCleanup();

      const res = await http.get('/api/correlations/queue-real-ttl/wait').query({ timeoutMs: 30 });
      expect(res.status).toBe(200);
      expect(res.body.resumed).toBe(false);
      expect(res.body.timedOut).toBe(true);
    },
    90_000,
  );
});
