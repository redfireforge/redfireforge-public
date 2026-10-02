import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock @tauri-apps/api/core (invoke) ────────────────────────────────────────
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// ── Mock @tauri-apps/api/event (listen) ───────────────────────────────────────
const listenMock = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

// ── Mock httpClient so server-proxy tests don't hit the network ───────────────
const httpFetchMock = vi.fn();
vi.mock('../utils/httpClient', () => ({
  httpFetch: (...args: unknown[]) => httpFetchMock(...args),
}));

import {
  kafkaNativeTauriTransport,
  listenKafkaSubscriptionEnded,
  listenKafkaSubscriptionError,
  listenKafkaSubscriptionMessage,
  type KafkaSubscriptionMessage,
} from './kafkaNativeTauriTransport';
import {
  KafkaClientError,
  setKafkaClientTransport,
  dispatchKafkaOperation,
  type KafkaDispatchRequest,
  type KafkaOperation,
} from './kafkaClient';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  op: KafkaOperation,
  method: 'GET' | 'POST',
  overrides: Partial<KafkaDispatchRequest> = {},
): KafkaDispatchRequest {
  return {
    op,
    method,
    path: `/api/kafka/${op}`,
    query: {},
    body: method === 'POST' ? {} : undefined,
    ...overrides,
  };
}

function okEnvelope(op: KafkaOperation, data: unknown = {}): unknown {
  return { ok: true, op, data, meta: { timestamp: '2026-06-03T00:00:00.000Z' } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('kafkaNativeTauriTransport — command name routing', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setKafkaClientTransport(null);
  });

  it.each([
    ['connect', 'kafka_connect', 'POST'] as const,
    ['disconnect', 'kafka_disconnect', 'POST'] as const,
    ['status', 'kafka_status', 'GET'] as const,
    ['topics', 'kafka_topics', 'GET'] as const,
    ['produce', 'kafka_produce', 'POST'] as const,
    ['consume-once', 'kafka_consume_once', 'POST'] as const,
    ['subscribe', 'kafka_subscribe', 'POST'] as const,
    ['subscriptions', 'kafka_subscriptions', 'GET'] as const,
    ['unsubscribe', 'kafka_unsubscribe', 'POST'] as const,
  ])('routes %s → %s', async (op, expectedCommand, method) => {
    invokeMock.mockResolvedValue(okEnvelope(op));
    await kafkaNativeTauriTransport(makeRequest(op, method));
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith(expectedCommand, expect.anything());
  });

  it('maps consume-once (hyphen) to kafka_consume_once (underscore)', async () => {
    invokeMock.mockResolvedValue(okEnvelope('consume-once'));
    await kafkaNativeTauriTransport(makeRequest('consume-once', 'POST'));
    expect(invokeMock).toHaveBeenCalledWith('kafka_consume_once', expect.anything());
  });

  it('topic-detail invokes kafka_topic_detail with the topic from the path', async () => {
    invokeMock.mockResolvedValue(okEnvelope('topic-detail'));
    await kafkaNativeTauriTransport(makeRequest('topic-detail', 'GET', {
      path: '/api/kafka/topics/221498-ons-retail-enrollment-event/detail',
      query: { clusterId: 'abc' },
    }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_topic_detail', {
      topicName: '221498-ons-retail-enrollment-event',
      clusterId: 'abc',
    });
  });

  it('keeps a topic name when the path encoding cannot be decoded', async () => {
    invokeMock.mockResolvedValue(okEnvelope('topic-detail'));
    await kafkaNativeTauriTransport(makeRequest('topic-detail', 'GET', {
      path: '/api/kafka/topics/%E0%A4%A/detail',
      query: { clusterId: 'abc' },
    }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_topic_detail', {
      topicName: '%E0%A4%A',
      clusterId: 'abc',
    });
  });

  it('topic-groups invokes kafka_topic_groups with the topic from the path', async () => {
    invokeMock.mockResolvedValue(okEnvelope('topic-groups'));
    await kafkaNativeTauriTransport(makeRequest('topic-groups', 'GET', {
      path: '/api/kafka/topics/221498-ons-retail-enrollment-event/groups',
      query: { clusterId: 'abc' },
    }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_topic_groups', {
      topicName: '221498-ons-retail-enrollment-event',
      clusterId: 'abc',
    });
  });

  it('maps subscriptions to kafka_subscriptions (not kafka_subscription)', async () => {
    invokeMock.mockResolvedValue(okEnvelope('subscriptions'));
    await kafkaNativeTauriTransport(makeRequest('subscriptions', 'GET'));
    expect(invokeMock).toHaveBeenCalledWith('kafka_subscriptions', expect.anything());
  });
});

describe('kafkaNativeTauriTransport — invoke args', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setKafkaClientTransport(null);
  });

  it('POST: wraps request.body in the Rust parameter name (paramKey)', async () => {
    invokeMock.mockResolvedValue(okEnvelope('produce'));
    const body = { clusterId: 'c1', topic: 'orders', messages: [{ value: 'hello' }] };
    await kafkaNativeTauriTransport(makeRequest('produce', 'POST', { body }));
    // kafka_produce(state, request: KafkaProduceRequest) → { request: body }
    expect(invokeMock).toHaveBeenCalledWith('kafka_produce', { request: body });
  });

  it('POST: connect passes body as-is — caller already wraps KafkaConnectionConfig in {connection:{...}}', async () => {
    invokeMock.mockResolvedValue(okEnvelope('connect'));
    // useKafkaState.toConnectRequest returns { connection: KafkaConnectionConfig }.
    // The transport must NOT re-wrap with paramKey — that would double-nest as
    // { connection: { connection: {...} } }.  No paramKey: body passed directly.
    const connConfig = { clusterId: 'c1', clientId: 'rf', brokers: ['localhost:9092'] };
    const body = { connection: connConfig }; // mimics toConnectRequest output
    await kafkaNativeTauriTransport(makeRequest('connect', 'POST', { body }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_connect', body); // = { connection: connConfig }
  });

  it('POST: connect passes empty object as-is when body is undefined (no paramKey)', async () => {
    invokeMock.mockResolvedValue(okEnvelope('connect'));
    await kafkaNativeTauriTransport(makeRequest('connect', 'POST', { body: undefined }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_connect', {});
  });

  it('POST: disconnect passes body flat (no paramKey — cluster_id is a primitive param)', async () => {
    invokeMock.mockResolvedValue(okEnvelope('disconnect'));
    const body = { clusterId: 'c1' };
    await kafkaNativeTauriTransport(makeRequest('disconnect', 'POST', { body }));
    // kafka_disconnect(state, cluster_id: Option<String>) → Tauri camelCases to { clusterId }
    expect(invokeMock).toHaveBeenCalledWith('kafka_disconnect', { clusterId: 'c1' });
  });

  it('POST: consume-once wraps body in "request" paramKey', async () => {
    invokeMock.mockResolvedValue(okEnvelope('consume-once'));
    const body = { topic: 'events', maxMessages: 5 };
    await kafkaNativeTauriTransport(makeRequest('consume-once', 'POST', { body }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_consume_once', { request: body });
  });

  it('POST: subscribe wraps body in "request" paramKey', async () => {
    invokeMock.mockResolvedValue(okEnvelope('subscribe'));
    const body = { topic: 'orders.created', groupId: 'rf-sub-1' };
    await kafkaNativeTauriTransport(makeRequest('subscribe', 'POST', { body }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_subscribe', { request: body });
  });

  it('POST: unsubscribe wraps body in "request" paramKey', async () => {
    invokeMock.mockResolvedValue(okEnvelope('unsubscribe'));
    const body = { subscriptionId: 'sub-uuid-1234' };
    await kafkaNativeTauriTransport(makeRequest('unsubscribe', 'POST', { body }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_unsubscribe', { request: body });
  });

  it('GET: passes string query values as-is', async () => {
    invokeMock.mockResolvedValue(okEnvelope('status'));
    await kafkaNativeTauriTransport(
      makeRequest('status', 'GET', { query: { clusterId: 'dev-cluster' } }),
    );
    expect(invokeMock).toHaveBeenCalledWith('kafka_status', { clusterId: 'dev-cluster' });
  });

  it('GET: restores string "true" to boolean true for Rust Option<bool>', async () => {
    invokeMock.mockResolvedValue(okEnvelope('topics'));
    await kafkaNativeTauriTransport(
      makeRequest('topics', 'GET', {
        query: { clusterId: 'dev-cluster', includeInternal: 'true' },
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith('kafka_topics', {
      clusterId: 'dev-cluster',
      includeInternal: true,  // boolean, not string
    });
  });

  it('GET: restores string "false" to boolean false', async () => {
    invokeMock.mockResolvedValue(okEnvelope('topics'));
    await kafkaNativeTauriTransport(
      makeRequest('topics', 'GET', { query: { includeInternal: 'false' } }),
    );
    expect(invokeMock).toHaveBeenCalledWith('kafka_topics', { includeInternal: false });
  });

  it('GET: leaves non-boolean strings unchanged', async () => {
    invokeMock.mockResolvedValue(okEnvelope('status'));
    await kafkaNativeTauriTransport(
      makeRequest('status', 'GET', { query: { clusterId: 'my-cluster' } }),
    );
    expect(invokeMock).toHaveBeenCalledWith('kafka_status', { clusterId: 'my-cluster' });
  });

  it('GET: empty query passes empty object', async () => {
    invokeMock.mockResolvedValue(okEnvelope('status'));
    await kafkaNativeTauriTransport(makeRequest('status', 'GET', { query: {} }));
    expect(invokeMock).toHaveBeenCalledWith('kafka_status', {});
  });
});

describe('kafkaNativeTauriTransport — error handling', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setKafkaClientTransport(null);
  });

  it('throws KafkaClientError when ok === false (application error)', async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      op: 'connect',
      error: { code: 'KAFKA_CONNECT_FAILED', message: 'Broker unreachable', retryable: true },
      meta: { timestamp: '2026-06-03T00:00:00.000Z' },
    });

    await expect(kafkaNativeTauriTransport(makeRequest('connect', 'POST'))).rejects.toThrow(
      KafkaClientError,
    );
    await expect(kafkaNativeTauriTransport(makeRequest('connect', 'POST'))).rejects.toThrow(
      'Broker unreachable',
    );
  });

  it('preserves error code and retryable from ok:false envelope', async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      op: 'produce',
      error: { code: 'KAFKA_AUTH_FAILED', message: 'Bad credentials', retryable: false },
      meta: { timestamp: '2026-06-03T00:00:00.000Z' },
    });

    let caught: KafkaClientError | null = null;
    try {
      await kafkaNativeTauriTransport(makeRequest('produce', 'POST'));
    } catch (e) {
      caught = e as KafkaClientError;
    }

    expect(caught).toBeInstanceOf(KafkaClientError);
    expect(caught?.code).toBe('KAFKA_AUTH_FAILED');
    expect(caught?.retryable).toBe(false);
    expect(caught?.operation).toBe('produce');
  });

  it('uses fallback message when ok:false envelope has empty message', async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      op: 'status',
      error: { code: 'BROKER_DOWN' },
      meta: { timestamp: '2026-06-03T00:00:00.000Z' },
    });

    await expect(kafkaNativeTauriTransport(makeRequest('status', 'GET'))).rejects.toThrow(
      'Kafka status failed (BROKER_DOWN)',
    );
  });

  it('throws KafkaClientError with KAFKA_INVOKE_ERROR when invoke itself throws', async () => {
    invokeMock.mockRejectedValue(new Error('IPC channel closed'));

    let caught: KafkaClientError | null = null;
    try {
      await kafkaNativeTauriTransport(makeRequest('connect', 'POST'));
    } catch (e) {
      caught = e as KafkaClientError;
    }

    expect(caught).toBeInstanceOf(KafkaClientError);
    expect(caught?.code).toBe('KAFKA_INVOKE_ERROR');
    expect(caught?.message).toBe('IPC channel closed');
    expect(caught?.retryable).toBe(true);
  });

  it('wraps non-Error invoke exceptions in KafkaClientError', async () => {
    invokeMock.mockRejectedValue('Command not found');

    let caught: KafkaClientError | null = null;
    try {
      await kafkaNativeTauriTransport(makeRequest('topics', 'GET'));
    } catch (e) {
      caught = e as KafkaClientError;
    }

    expect(caught).toBeInstanceOf(KafkaClientError);
    expect(caught?.code).toBe('KAFKA_INVOKE_ERROR');
    expect(caught?.message).toBe('Command not found');
  });
});

describe('kafkaNativeTauriTransport — dispatchKafkaOperation integration', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    httpFetchMock.mockReset();
    setKafkaClientTransport(null);
  });

  it('is used by dispatchKafkaOperation when set as override', async () => {
    setKafkaClientTransport(kafkaNativeTauriTransport);
    invokeMock.mockResolvedValue({
      ok: true,
      op: 'status',
      data: { state: 'connected', clusterId: 'c1' },
      meta: { timestamp: '2026-06-03T00:00:00.000Z' },
    });

    const envelope = await dispatchKafkaOperation('status', { clusterId: 'c1' });

    expect(httpFetchMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('kafka_status', { clusterId: 'c1' });
    expect(envelope.ok).toBe(true);
    expect(envelope.op).toBe('status');
  });

  it('POST via dispatchKafkaOperation: connect passes toConnectRequest body as-is end-to-end', async () => {
    // Verifies the full pipeline: dispatchKafkaOperation → body → transport → invoke
    // useKafkaState.toConnectRequest wraps: { connection: KafkaConnectionConfig }
    // dispatchKafkaOperation sets body = request = { connection: {...} }
    // transport (no paramKey for connect): args = body = { connection: {...} }  ← correct
    setKafkaClientTransport(kafkaNativeTauriTransport);
    const connConfig = { clusterId: 'c1', clientId: 'rf-client', brokers: ['localhost:9092'] };
    const connectRequest = { connection: connConfig }; // matches toConnectRequest output
    invokeMock.mockResolvedValue({
      ok: true,
      op: 'connect',
      data: { status: { state: 'connected' }, reusedExistingConnection: false },
      meta: { timestamp: '2026-06-03T00:00:00.000Z' },
    });

    await dispatchKafkaOperation('connect', connectRequest);

    expect(httpFetchMock).not.toHaveBeenCalled();
    // invoke receives { connection: KafkaConnectionConfig } — not double-wrapped
    expect(invokeMock).toHaveBeenCalledWith('kafka_connect', { connection: connConfig });
  });

  it('POST via dispatchKafkaOperation: produce wraps body in "request" end-to-end', async () => {
    setKafkaClientTransport(kafkaNativeTauriTransport);
    const produceReq = { clusterId: 'c1', topic: 'orders', messages: [{ value: 'hello' }] };
    invokeMock.mockResolvedValue({
      ok: true,
      op: 'produce',
      data: { topic: 'orders', sentCount: 1, records: [] },
      meta: { timestamp: '2026-06-03T00:00:00.000Z' },
    });

    await dispatchKafkaOperation('produce', produceReq);

    // kafka_produce(state, request: KafkaProduceRequest) must receive { request: {...} }
    expect(invokeMock).toHaveBeenCalledWith('kafka_produce', { request: produceReq });
  });

  it('restores server-proxy after setKafkaClientTransport(null)', async () => {
    setKafkaClientTransport(kafkaNativeTauriTransport);
    setKafkaClientTransport(null); // restore

    httpFetchMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ ok: true, op: 'status', data: {}, meta: { timestamp: '' } }),
    });

    await dispatchKafkaOperation('status', { clusterId: 'c1' });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(httpFetchMock).toHaveBeenCalledWith(
      '/api/kafka/status?clusterId=c1',
      'GET',
      { Accept: 'application/json' },
      undefined,
    );
  });
});

describe('kafkaNativeTauriTransport — Phase 10C schema registry routing', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    httpFetchMock.mockReset();
    setKafkaClientTransport(null);
  });

  // Minimal valid HttpResponse for server-proxy path assertions
  function proxyOkResponse(op: KafkaOperation, data: unknown = {}) {
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ ok: true, op, data, meta: { timestamp: '' } }),
    };
  }

  it('schema-subjects routes to server proxy (httpFetch), not invoke', async () => {
    httpFetchMock.mockResolvedValueOnce(proxyOkResponse('schema-subjects', { subjects: [] }));
    const req = makeRequest('schema-subjects', 'POST', {
      body: { schemaConfig: { registryUrl: 'http://r:8081', format: 'avro' } },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(httpFetchMock).toHaveBeenCalledOnce();
  });

  it('schema-versions routes to server proxy (httpFetch), not invoke', async () => {
    httpFetchMock.mockResolvedValueOnce(proxyOkResponse('schema-versions', { versions: [] }));
    const req = makeRequest('schema-versions', 'POST', {
      body: { schemaConfig: { registryUrl: 'http://r:8081', format: 'avro' }, subject: 'orders-value' },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(httpFetchMock).toHaveBeenCalledOnce();
  });

  it('schema-fetch routes to server proxy (httpFetch), not invoke', async () => {
    httpFetchMock.mockResolvedValueOnce(proxyOkResponse('schema-fetch', { schema: '{}' }));
    const req = makeRequest('schema-fetch', 'POST', {
      body: { schemaConfig: { registryUrl: 'http://r:8081', format: 'avro' }, subject: 'orders-value' },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(httpFetchMock).toHaveBeenCalledOnce();
  });

  it('produce WITH schemaConfig routes to server proxy, not invoke', async () => {
    httpFetchMock.mockResolvedValueOnce(
      proxyOkResponse('produce', { topic: 'orders', sentCount: 1, records: [] }),
    );
    const req = makeRequest('produce', 'POST', {
      body: {
        clusterId: 'c1',
        topic: 'orders',
        messages: [{ value: '{"id":1}' }],
        schemaConfig: { registryUrl: 'http://r:8081', format: 'avro' },
      },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(httpFetchMock).toHaveBeenCalledOnce();
  });

  it('produce WITHOUT schemaConfig still routes to invoke, not server proxy', async () => {
    invokeMock.mockResolvedValue(okEnvelope('produce'));
    const req = makeRequest('produce', 'POST', {
      body: { clusterId: 'c1', topic: 'orders', messages: [{ value: '{"id":1}' }] },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).toHaveBeenCalledWith('kafka_produce', expect.anything());
    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('consume-once WITH schemaConfig routes to server proxy, not invoke', async () => {
    httpFetchMock.mockResolvedValueOnce(
      proxyOkResponse('consume-once', { messageCount: 0, messages: [] }),
    );
    const req = makeRequest('consume-once', 'POST', {
      body: {
        clusterId: 'c1',
        topic: 'orders',
        maxMessages: 1,
        schemaConfig: { registryUrl: 'http://r:8081', format: 'avro' },
      },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(httpFetchMock).toHaveBeenCalledOnce();
  });

  it('consume-once WITHOUT schemaConfig still routes to invoke, not server proxy', async () => {
    invokeMock.mockResolvedValue(okEnvelope('consume-once'));
    const req = makeRequest('consume-once', 'POST', {
      body: { clusterId: 'c1', topic: 'orders', maxMessages: 1 },
    });
    await kafkaNativeTauriTransport(req);
    expect(invokeMock).toHaveBeenCalledWith('kafka_consume_once', expect.anything());
    expect(httpFetchMock).not.toHaveBeenCalled();
  });
});

describe('listenKafkaSubscriptionMessage', () => {
  beforeEach(() => {
    listenMock.mockReset();
  });

  it('calls listen with the kafka-subscription-message event name', async () => {
    const unlistenFn = vi.fn();
    listenMock.mockResolvedValue(unlistenFn);

    const callback = vi.fn();
    const unlisten = await listenKafkaSubscriptionMessage(callback);

    expect(listenMock).toHaveBeenCalledOnce();
    expect(listenMock).toHaveBeenCalledWith(
      'kafka-subscription-message',
      expect.any(Function),
    );
    expect(unlisten).toBe(unlistenFn);
  });

  it('forwards event payload to callback', async () => {
    let capturedHandler: ((e: { payload: KafkaSubscriptionMessage }) => void) | null = null;
    listenMock.mockImplementation(
      (_event: string, handler: (e: { payload: KafkaSubscriptionMessage }) => void) => {
        capturedHandler = handler;
        return Promise.resolve(vi.fn());
      },
    );

    const callback = vi.fn();
    await listenKafkaSubscriptionMessage(callback);

    const payload: KafkaSubscriptionMessage = {
      subscriptionId: 'sub-uuid-1234',
      record: {
        topic: 'orders.created',
        partition: 0,
        offset: '42',
        key: 'order-1',
        value: '{"id":1}',
        headers: { 'x-trace': 'abc' },
      },
    };

    capturedHandler!({ payload });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(payload);
  });

  it('listens for desktop stream errors and the max-reached end', async () => {
    let errorHandler: ((e: { payload: { subscriptionId: string; message: string } }) => void) | null = null;
    let endedHandler: ((e: { payload: { subscriptionId: string; reason: string } }) => void) | null = null;
    listenMock.mockImplementation((event: string, handler: (e: { payload: never }) => void) => {
      if (event === 'kafka-subscription-error') errorHandler = handler;
      if (event === 'kafka-subscription-ended') endedHandler = handler;
      return Promise.resolve(vi.fn());
    });
    const onError = vi.fn();
    const onEnded = vi.fn();
    await listenKafkaSubscriptionError(onError);
    await listenKafkaSubscriptionEnded(onEnded);
    errorHandler?.({ payload: { subscriptionId: 'sub', message: 'down' } });
    endedHandler?.({ payload: { subscriptionId: 'sub', reason: 'max-reached' } });
    expect(onError).toHaveBeenCalledWith({ subscriptionId: 'sub', message: 'down' });
    expect(onEnded).toHaveBeenCalledWith({ subscriptionId: 'sub', reason: 'max-reached' });
  });

  it('returns the unlisten function from the listen call', async () => {
    const unlisten = vi.fn().mockName('unlisten');
    listenMock.mockResolvedValue(unlisten);

    const returned = await listenKafkaSubscriptionMessage(vi.fn());
    expect(returned).toBe(unlisten);
  });
});
