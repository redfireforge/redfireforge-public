/**
 * @vitest-environment node
 */
import http from 'node:http';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { GRPC_SPRING_FIXTURE_ACTUATOR_HEALTH_LOOPBACK_URL } from '../src/shared/grpc/grpcSpringFixturePorts.js';
import { probeApiMockEcho } from '../src/shared/api-mock/echoHealthProbe.js';
import { probeDemoHttpHealth } from '../src/shared/utils/demoHttpHealthProbe.js';
import { app } from './webhook-server.js';
import type { Workflow } from '../src/features/workflow/types/workflow';

// Mock file storage
vi.mock('./file-storage.js', () => ({
  getWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  getExecutionHistory: vi.fn(),
  getWebhookDeliveries: vi.fn(),
  logWebhookDelivery: vi.fn(),
}));

vi.mock('./webhook-extractor.js', () => ({
  extractWebhookVariables: vi.fn(),
}));

vi.mock('../src/shared/api-mock/echoHealthProbe.js', () => ({
  probeApiMockEcho: vi.fn(),
  API_MOCK_ECHO_PORT: 4017,
  API_MOCK_ECHO_HEALTH_PATH: '/health',
}));

vi.mock('../src/shared/utils/demoHttpHealthProbe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/utils/demoHttpHealthProbe.js')>();
  return {
    ...actual,
    probeDemoHttpHealth: vi.fn(),
  };
});

vi.mock('./executeWorkflow.js', () => ({
  executeWorkflow: vi.fn(),
  saveErrorResult: vi.fn(),
}));

vi.mock('./correlation-handler.js', () => ({
  createCorrelationRouter: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  setCorrelationStore: vi.fn(),
}));

vi.mock('./kafka/kafkaTriggerSubscriptionManager.js', () => ({
  kafkaTriggerSubscriptionManager: {
    activateAll: vi.fn(async () => {}),
    deactivateAll: vi.fn(async () => {}),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
  },
}));

import {
  getWorkflow,
  saveWorkflow,
  getExecutionHistory,
  getWebhookDeliveries,
  logWebhookDelivery,
} from './file-storage.js';
import { extractWebhookVariables } from './webhook-extractor.js';
import { executeWorkflow, saveErrorResult } from './executeWorkflow.js';

const mockGetWorkflow = vi.mocked(getWorkflow);
const mockSaveWorkflow = vi.mocked(saveWorkflow);
const mockGetExecutionHistory = vi.mocked(getExecutionHistory);
const mockGetWebhookDeliveries = vi.mocked(getWebhookDeliveries);
const mockLogWebhookDelivery = vi.mocked(logWebhookDelivery);
const mockExtractWebhookVariables = vi.mocked(extractWebhookVariables);
const mockExecuteWorkflow = vi.mocked(executeWorkflow);
const mockSaveErrorResult = vi.mocked(saveErrorResult);

function createMockWorkflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    nodes: [
      {
        id: 'trigger-1',
        type: 'webhook',
        position: { x: 0, y: 0 },
        data: {
          label: 'Webhook Trigger',
          method: 'POST',
          path: '/api/webhook',
          samplePayload: '{}',
          extractVariables: [],
        },
      },
      {
        id: 'http-1',
        type: 'http',
        position: { x: 0, y: 100 },
        data: { label: 'HTTP', scenario: { id: 'sc-1', url: '/test', method: 'GET', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } },
      },
    ],
    edges: [],
    variables: { baseUrl: 'https://api.example.com' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function putWorkflowWithRetry(body: unknown) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request(app)
        .put('/api/workflows/wf-1')
        .timeout({ response: 5000, deadline: 7000 })
        .send(body);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = msg.includes('ECONNRESET') || msg.includes('Timeout');
      if (!retryable || attempt === 2) {
        throw err;
      }
    }
  }

  throw lastErr ?? new Error('PUT /api/workflows/wf-1 failed');
}

describe('webhook-server', { timeout: 30_000 }, () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('GET /health', () => {
    it('returns health status', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.port).toBe(3001);
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('GET /health/spring', () => {
    it('returns ok when Spring actuator reports UP', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'UP' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await request(app).get('/health/spring');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.source).toBe('spring-actuator');
      expect(fetchSpy).toHaveBeenCalledWith(
        GRPC_SPRING_FIXTURE_ACTUATOR_HEALTH_LOOPBACK_URL,
        expect.any(Object),
      );
    });

    it('returns down when Spring actuator is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const res = await request(app).get('/health/spring');

      // HTTP 200 + status:down — avoids Chrome DevTools 503 spam while Docker is offline
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.source).toBe('spring-actuator');
      expect(String(res.body.reason)).toContain('ECONNREFUSED');
    });

    it('returns down with http_ reason when actuator responds non-ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503 }),
      );
      const res = await request(app).get('/health/spring');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.reason).toBe('http_503');
    });

    it('returns down when Spring actuator reports non-UP status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'DOWN' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await request(app).get('/health/spring');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.springStatus).toBe('DOWN');
    });

    it('handles non-JSON actuator response (json() throws) gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('not-json-at-all', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );
      const res = await request(app).get('/health/spring');
      // payload = null branch → falls back to UP
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('spring-actuator');
    });

  });

  describe('GET /health/envoy', () => {
    it('returns ok when Envoy responds (including HTTP 415)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unsupported Media Type', { status: 415 }),
      );

      const res = await request(app).get('/health/envoy');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.source).toBe('envoy-grpc-web');
      expect(res.body.httpStatus).toBe(415);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:50055/',
        expect.any(Object),
      );
    });

    it('returns down when Envoy is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const res = await request(app).get('/health/envoy');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.source).toBe('envoy-grpc-web');
      expect(String(res.body.reason)).toContain('ECONNREFUSED');
    });

  });

  describe('GET /health/schema-registry', () => {
    it('returns ok when registry /subjects responds with 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('[]', { status: 200 }),
      );
      const res = await request(app).get('/health/schema-registry?url=http://localhost:8085');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.source).toBe('schema-registry');
    });

    it('returns down when registry responds non-ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('forbidden', { status: 403 }),
      );
      const res = await request(app).get('/health/schema-registry?url=http://localhost:8085');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.reason).toBe('http_403');
    });

    it('returns down when registry is unreachable (network error)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const res = await request(app).get('/health/schema-registry');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(String(res.body.reason)).toContain('ECONNREFUSED');
    });

  });

  describe('GET /__vitest_unhandled_error__', () => {
    it('routes through the error middleware in Vitest mode', async () => {
      const res = await request(app).get('/__vitest_unhandled_error__');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.message).toBe('vitest');
    });
  });

  describe('GET /health/kafka-admin', () => {
    it('returns ok when Admin API /v1 responds with 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{"swagger":"2.0"}', { status: 200 }),
      );
      const res = await request(app).get('/health/kafka-admin?port=19648');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.source).toBe('kafka-admin');
      expect(res.body.port).toBe(19648);
    });

    it('returns ok when Admin API /v1 responds with 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('not found', { status: 404 }),
      );
      const res = await request(app).get('/health/kafka-admin?port=19648');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('returns down when Admin API is unreachable (network error)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const res = await request(app).get('/health/kafka-admin?port=19648');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(String(res.body.reason)).toContain('ECONNREFUSED');
    });

    it('defaults to port 19648 when no port is provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{}', { status: 200 }),
      );
      await request(app).get('/health/kafka-admin');
      expect(String(fetchSpy.mock.calls[0][0])).toContain(':19648/');
    });

    it('returns down when Admin API responds with a non-ok, non-404 status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503 }),
      );
      const res = await request(app).get('/health/kafka-admin?port=19648');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.reason).toBe('http_503');
      expect(res.body.port).toBe(19648);
    });

    it('aborts the fetch and returns down when the 5s timeout fires', async () => {
      // Fire the abort timer immediately so the fetch rejects with AbortError.
      vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((fn: TimerHandler) => {
        if (typeof fn === 'function') (fn as () => void)();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, opts) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (opts as RequestInit).signal!;
          // Signal may already be aborted when setTimeout fires synchronously.
          const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort', onAbort);
        }),
      );
      const res = await request(app).get('/health/kafka-admin?port=19648');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(String(res.body.reason)).toContain('aborted');
    });
  });

  describe('GET /health/demo-http', () => {
    it('returns ok when the demo listener answers', async () => {
      vi.mocked(probeDemoHttpHealth).mockResolvedValueOnce({ ok: true, statusCode: 200 });
      const res = await request(app).get('/health/demo-http?port=4444');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', source: 'demo-http', port: 4444, httpStatus: 200 });
      expect(probeDemoHttpHealth).toHaveBeenCalledWith(4444, 2500, '/health');
    });

    it('returns down when the demo listener is unreachable', async () => {
      vi.mocked(probeDemoHttpHealth).mockResolvedValueOnce({ ok: false, reason: 'connect ECONNREFUSED' });
      const res = await request(app).get('/health/demo-http?port=4444');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.source).toBe('demo-http');
      expect(res.body.port).toBe(4444);
      expect(res.body.reason).toContain('ECONNREFUSED');
    });

    it('returns down with a fallback reason when the probe is empty', async () => {
      vi.mocked(probeDemoHttpHealth).mockResolvedValueOnce({ ok: false });
      const res = await request(app).get('/health/demo-http?port=4010');
      expect(res.status).toBe(200);
      expect(res.body.reason).toBe('unreachable');
    });

    it('forwards Console root path / to the probe', async () => {
      vi.mocked(probeDemoHttpHealth).mockResolvedValueOnce({ ok: true, statusCode: 200 });
      const res = await request(app).get('/health/demo-http?port=18080&path=%2F');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(probeDemoHttpHealth).toHaveBeenCalledWith(18080, 2500, '/');
    });

    it('returns down without probing an unsupported port', async () => {
      const res = await request(app).get('/health/demo-http?port=9999');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'down', source: 'demo-http', reason: 'unsupported_port' });
      expect(probeDemoHttpHealth).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/api-mock-echo', () => {
    it('returns ok when the Docker echo answers', async () => {
      vi.mocked(probeApiMockEcho).mockResolvedValueOnce({ ok: true, statusCode: 200 });
      const res = await request(app).get('/health/api-mock-echo');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', source: 'api-mock-echo', httpStatus: 200 });
    });

    it('returns down when the Docker echo is unreachable', async () => {
      vi.mocked(probeApiMockEcho).mockResolvedValueOnce({ ok: false, reason: 'connect ECONNREFUSED' });
      const res = await request(app).get('/health/api-mock-echo');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.source).toBe('api-mock-echo');
      expect(res.body.reason).toContain('ECONNREFUSED');
    });

    it('returns down with a fallback reason when the probe is empty', async () => {
      vi.mocked(probeApiMockEcho).mockResolvedValueOnce({ ok: false });
      const res = await request(app).get('/health/api-mock-echo');
      expect(res.status).toBe(200);
      expect(res.body.reason).toBe('unreachable');
    });
  });

  describe('GET /health/api-mock/:probe', () => {
    it('rejects unknown probe values', async () => {
      const res = await request(app).get('/health/api-mock/unknown?port=4600');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('probe must be');
    });

    it('rejects invalid or missing ports', async () => {
      const missingPort = await request(app).get('/health/api-mock/live');
      expect(missingPort.status).toBe(400);

      const invalidPort = await request(app).get('/health/api-mock/ready?port=99999');
      expect(invalidPort.status).toBe(400);
      expect(invalidPort.body.error).toContain('port query param is required');
    });

    it('returns ok for live probe when upstream health endpoint is healthy', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ probe: 'live' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await request(app).get('/health/api-mock/live?port=4600');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(String(res.body.source)).toContain('/__rff/health/live');
      expect(res.body.probe).toBe('live');
    });

    it('returns not_ready for ready probe when upstream returns non-ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'warming' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await request(app).get('/health/api-mock/ready?port=4600');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.detail).toBe('warming');
    });

    it('returns down when probe fetch throws a non-Error value', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('network unreachable');

      const res = await request(app).get('/health/api-mock/live?port=4600');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('down');
      expect(res.body.reason).toBe('unreachable');
    });
  });

  describe('GET /api/executions', () => {
    it('returns execution history', async () => {
      const mockExecutions = [{ id: 'exec-1', workflowId: 'wf-1', status: 'success' }];
      mockGetExecutionHistory.mockResolvedValue(mockExecutions);

      const res = await request(app).get('/api/executions');

      expect(res.status).toBe(200);
      expect(res.body.executions).toEqual(mockExecutions);
      expect(res.body.count).toBe(1);
      expect(mockGetExecutionHistory).toHaveBeenCalledWith(undefined, 50);
    });

    it('accepts limit parameter', async () => {
      mockGetExecutionHistory.mockResolvedValue([]);

      await request(app).get('/api/executions?limit=10');

      expect(mockGetExecutionHistory).toHaveBeenCalledWith(undefined, 10);
    });

    it('accepts workflowId filter', async () => {
      mockGetExecutionHistory.mockResolvedValue([]);

      await request(app).get('/api/executions?workflowId=wf-1');

      expect(mockGetExecutionHistory).toHaveBeenCalledWith('wf-1', 50);
    });

    it('handles errors', async () => {
      mockGetExecutionHistory.mockRejectedValue(new Error('Database error'));

      const res = await request(app).get('/api/executions');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to load execution history');
    });

    it('handles non-Error rejections in execution history', async () => {
      mockGetExecutionHistory.mockRejectedValue('db string failure');
      const res = await request(app).get('/api/executions');
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('db string failure');
    });
  });

  describe('PUT /api/workflows/:id', () => {
    it('registers a workflow', async () => {
      mockSaveWorkflow.mockResolvedValue(undefined);
      const workflow = createMockWorkflow();

      const res = await request(app)
        .put('/api/workflows/wf-1')
        .timeout({ response: 5000, deadline: 7000 })
        .send(workflow);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Workflow registered');
      expect(res.body.id).toBe('wf-1');
      expect(mockSaveWorkflow).toHaveBeenCalled();
    });

    it('rejects invalid workflow data', async () => {
      const res = await putWorkflowWithRetry({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid workflow data');
    });

    it('handles save errors', async () => {
      mockSaveWorkflow.mockRejectedValue(new Error('Save failed'));

      const res = await putWorkflowWithRetry(createMockWorkflow());

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to register workflow');
    });
  });

  describe('GET /api/webhook-deliveries', () => {
    it('returns webhook deliveries for today', async () => {
      const mockDeliveries = [{ id: 'd1', triggerId: 't1', status: 'success' }];
      mockGetWebhookDeliveries.mockResolvedValue(mockDeliveries);

      const res = await request(app).get('/api/webhook-deliveries');

      expect(res.status).toBe(200);
      expect(res.body.deliveries).toEqual(mockDeliveries);
      expect(res.body.count).toBe(1);
    });

    it('accepts date parameter', async () => {
      mockGetWebhookDeliveries.mockResolvedValue([]);

      await request(app).get('/api/webhook-deliveries?date=2024-01-15');

      expect(mockGetWebhookDeliveries).toHaveBeenCalledWith('2024-01-15');
    });

    it('rejects invalid date format', async () => {
      const res = await request(app).get('/api/webhook-deliveries?date=invalid');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid date format');
    });

    it('handles errors', async () => {
      mockGetWebhookDeliveries.mockRejectedValue(new Error('Read error'));

      const res = await request(app).get('/api/webhook-deliveries');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to load webhook deliveries');
    });

    it('handles non-Error rejections in webhook deliveries', async () => {
      mockGetWebhookDeliveries.mockRejectedValue('string-delivery-error');

      const res = await request(app).get('/api/webhook-deliveries');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('string-delivery-error');
    });
  });

  describe('POST /webhooks/:workflowId/:triggerId', () => {
    it('executes workflow on webhook trigger', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({ event: 'test' });
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 100,
        results: [],
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1')
        .send({ event: 'test' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Workflow executed successfully');
      expect(res.body.workflowId).toBe('wf-1');
      expect(mockExecuteWorkflow).toHaveBeenCalled();
      expect(mockLogWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
        triggerId: 'trigger-1',
        method: 'POST',
        status: 'success',
      }));
    });

    it('returns 404 when workflow not found', async () => {
      mockGetWorkflow.mockResolvedValue(null);

      let res: Awaited<ReturnType<typeof request>> | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await request(app)
            .post('/webhooks/unknown/trigger-1')
            .send({});
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const retryable = msg.includes('ECONNRESET');
          if (!retryable || attempt === 2) throw err;
        }
      }

      if (!res) throw lastErr ?? new Error('Request failed');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Workflow not found');
    });

    it('returns 404 when trigger not found', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);

      const res = await request(app)
        .post('/webhooks/wf-1/unknown-trigger')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Webhook trigger not found');
    });

    it('returns 405 for method mismatch', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);

      const res = await request(app)
        .get('/webhooks/wf-1/trigger-1');

      expect(res.status).toBe(405);
      expect(res.body.error).toContain('Method GET not allowed');
    });

    it('handles execution errors', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockRejectedValue(new Error('Execution failed'));
      mockLogWebhookDelivery.mockResolvedValue(undefined);
      mockSaveErrorResult.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Workflow execution failed');
      expect(mockSaveErrorResult).toHaveBeenCalled();
      expect(mockLogWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error',
      }));
    });
  });

  describe('CORS', () => {
    it('allows cross-origin requests', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('responds to OPTIONS preflight with 200', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });
  });

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown/path');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
      expect(res.body.hint).toBeDefined();
    });
  });

  describe('GET /api/logs/stream', () => {
    it('streams events and broadcasts webhook logs to connected clients', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 1,
        results: [],
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const server = await new Promise<http.Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
      });
      const { port } = server.address() as import('net').AddressInfo;

      const sseChunks: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const sseReq = http.get(`http://127.0.0.1:${port}/api/logs/stream`, (res) => {
          expect(String(res.headers['content-type'])).toContain('text/event-stream');
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => sseChunks.push(chunk));

          const agent = request(server);
          agent
            .post('/webhooks/wf-1/trigger-1')
            .send({})
            .end((err, webhookRes) => {
              if (err) return reject(err);
              expect(webhookRes?.status).toBe(200);
              setTimeout(() => {
                res.socket?.destroy();
                server.close(() => resolve());
              }, 40);
            });
        });
        sseReq.on('error', reject);
      });

      const joined = sseChunks.join('');
      expect(joined).toMatch(/data:.*Webhook/i);
    });

    it('replays a recently broadcast log line to a client that connects after it', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 1,
        results: [],
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const server = await new Promise<http.Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
      });
      const { port } = server.address() as import('net').AddressInfo;

      // Broadcast a log line BEFORE any SSE client is connected.
      await request(server).post('/webhooks/wf-1/trigger-1').send({}).expect(200);

      const sseChunks: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const sseReq = http.get(`http://127.0.0.1:${port}/api/logs/stream`, (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => sseChunks.push(chunk));
          setTimeout(() => {
            res.socket?.destroy();
            server.close(() => resolve());
          }, 40);
        });
        sseReq.on('error', reject);
      });

      // The line was broadcast before connect, yet the replay buffer delivers it.
      expect(sseChunks.join('')).toMatch(/data:.*Webhook/i);
    });

    it('skips stale replay entries older than the replay window', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 1,
        results: [],
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

      const server = await new Promise<http.Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
      });
      const { port } = server.address() as import('net').AddressInfo;

      // Seed replay buffer at an old timestamp.
      await request(server).post('/webhooks/wf-1/trigger-1').send({}).expect(200);

      // Move virtual time far beyond any prior test timestamps so all replay
      // entries (including cross-test residue) are stale.
      nowSpy.mockReturnValue(9_000_000_000_000_000);

      const sseChunks: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const sseReq = http.get(`http://127.0.0.1:${port}/api/logs/stream`, (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => sseChunks.push(chunk));
          setTimeout(() => {
            res.socket?.destroy();
            server.close(() => resolve());
          }, 40);
        });
        sseReq.on('error', reject);
      });

      expect(sseChunks.join('')).not.toMatch(/data:.*Webhook/i);
      nowSpy.mockRestore();
    });
  });

  describe('Express error handler (Vitest-only route)', () => {
    it('returns 500 JSON for next(err)', async () => {
      const res = await request(app).get('/__vitest_unhandled_error__');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.message).toBe('vitest');
    });
  });

  describe('Webhook trace capture', () => {
    it('includes iterationTrace when _trace=true', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 100,
        results: [
          {
            id: 'r1',
            scenarioId: 's1',
            url: '/test',
            method: 'GET',
            httpStatus: 200,
            responseTimeMs: 50,
            passed: true,
          },
        ],
        iterationTrace: {
          iterationId: 'iter-1',
          nodeResults: [],
        },
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1?_trace=true')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.iterationTrace).toBeDefined();
      expect(res.body.iterationTrace.iterationId).toBe('iter-1');
      expect(mockExecuteWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          traceOptions: { captureFullTrace: true, alwaysCaptureFailures: true },
        }),
      );
    });

    it('includes iterationTrace when _trace=1', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 100,
        results: [],
        iterationTrace: { iterationId: 'iter-2', nodeResults: [] },
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1?_trace=1')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.iterationTrace).toBeDefined();
    });

    it('does not include iterationTrace when trace not requested', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'success',
        passed: true,
        duration: 100,
        results: [],
        iterationTrace: { iterationId: 'iter-3', nodeResults: [] },
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.iterationTrace).toBeUndefined();
    });
  });

  describe('Webhook execution with failed status', () => {
    it('logs delivery with failed status when execution fails but does not throw', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockResolvedValue({
        status: 'failed',
        passed: false,
        duration: 100,
        results: [],
      });
      mockLogWebhookDelivery.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('failed');
      expect(mockLogWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });
  });

  describe('Webhook error handling edge cases', () => {
    it('handles logWebhookDelivery failure in error path gracefully', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockRejectedValue(new Error('Execution error'));
      mockLogWebhookDelivery.mockRejectedValue(new Error('Log delivery failed'));
      mockSaveErrorResult.mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1')
        .send({});

      expect(res.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledWith('[Webhook] Failed to log delivery:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('handles non-Error objects in error path', async () => {
      const workflow = createMockWorkflow();
      mockGetWorkflow.mockResolvedValue(workflow);
      mockExtractWebhookVariables.mockReturnValue({});
      mockExecuteWorkflow.mockRejectedValue('string error');
      mockLogWebhookDelivery.mockResolvedValue(undefined);
      mockSaveErrorResult.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/webhooks/wf-1/trigger-1')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('string error');
    });
  });
});

// ── SSE test endpoint ─────────────────────────────────────────────────────

describe('GET /api/sse-test', () => {
  it('sends initial greeting event with correct headers', async () => {
    const chunks: string[] = [];
    let contentType = '';

    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' ? addr?.port : 0;
        const req = http.get(`http://localhost:${port}/api/sse-test`, (res) => {
          contentType = res.headers['content-type'] ?? '';
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk.toString());
            req.destroy();
          });
          res.on('close', () => {
            server.close();
            resolve();
          });
        });
      });
    });

    const allData = chunks.join('');
    expect(contentType).toBe('text/event-stream');
    expect(allData).toContain('event: message');
    expect(allData).toContain('Hello from SSE test server');
    expect(allData).toContain('"counter":1');
  });

  it('resumes from last-event-id header', async () => {
    const chunks: string[] = [];

    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' ? addr?.port : 0;
        const req = http.get({
          hostname: 'localhost',
          port,
          path: '/api/sse-test',
          headers: { 'Last-Event-ID': '5' },
        }, (res) => {
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk.toString());
            req.destroy();
          });
          res.on('close', () => {
            server.close();
            resolve();
          });
        });
      });
    });

    const allData = chunks.join('');
    expect(allData).toContain('"counter":6');
  });

  it('treats invalid last-event-id as zero', async () => {
    const chunks: string[] = [];

    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' ? addr?.port : 0;
        const req = http.get({
          hostname: 'localhost',
          port,
          path: '/api/sse-test',
          headers: { 'Last-Event-ID': 'not-a-number' },
        }, (res) => {
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk.toString());
            req.destroy();
          });
          res.on('close', () => {
            server.close();
            resolve();
          });
        });
      });
    });

    const allData = chunks.join('');
    expect(allData).toContain('"counter":1');
  });

  it('emits status events on interval counter divisible by three', async () => {
    const chunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('net').AddressInfo;
        let settled = false;
        const closeAll = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          req.destroy();
          server.close(() => resolve());
        };
        const req = http.get({
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/api/sse-test?intervalMs=40',
          headers: { 'Last-Event-ID': '5' },
        }, (res) => {
          res.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            chunks.push(text);
            if (chunks.join('').includes('event: status')) {
              closeAll();
            }
          });
          res.on('error', (err) => {
            if (settled && (err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
            reject(err);
          });
        });
        req.on('error', (err) => {
          if (settled && (err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
          reject(err);
        });
        const fallbackTimer = setTimeout(closeAll, 450);
      });
      server.on('error', reject);
    });

    const allData = chunks.join('');
    expect(allData).toContain('event: status');
  }, 10_000);

  it('sends additional interval events after the greeting', async () => {
    const chunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('net').AddressInfo;
        let settled = false;
        const closeAll = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          req.destroy();
          server.close(() => resolve());
        };
        const req = http.get(`http://127.0.0.1:${addr.port}/api/sse-test?intervalMs=40`, (res) => {
          res.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            chunks.push(text);
            if (chunks.join('').includes('Event #2')) {
              closeAll();
            }
          });
          res.on('error', (err) => {
            if (settled && (err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
            reject(err);
          });
        });
        req.on('error', (err) => {
          if (settled && (err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
          reject(err);
        });
        const fallbackTimer = setTimeout(closeAll, 300);
      });
      server.on('error', reject);
    });

    const allData = chunks.join('');
    expect(allData).toContain('Event #2');
    expect(allData).toMatch(/event: (message|update|status)/);
  }, 10_000);
});

// ── shutdown / graceful cleanup ────────────────────────────────────────────

describe('webhook-server — shutdown', () => {
  it('shutdown deactivates Kafka subscriptions and exits on SIGTERM', async () => {
    const { kafkaTriggerSubscriptionManager } = await import('./kafka/kafkaTriggerSubscriptionManager.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Emit SIGTERM to trigger shutdown
    process.emit('SIGTERM');

    // Allow the async shutdown to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(vi.mocked(kafkaTriggerSubscriptionManager.deactivateAll)).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('shutdown deactivates Kafka subscriptions and exits on SIGINT', async () => {
    const { kafkaTriggerSubscriptionManager } = await import('./kafka/kafkaTriggerSubscriptionManager.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    process.emit('SIGINT');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(vi.mocked(kafkaTriggerSubscriptionManager.deactivateAll)).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
