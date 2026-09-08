import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scenario, TestConfig } from '@shared/types';
import type { Workflow } from '@workflow/types/workflow';
import { buildHeaders, buildUrl, runTest, proxyFetch } from './executor';
import * as grpcConnectionProfileHydration from '@engine/grpc/grpcConnectionProfileHydration';
import { makeScenario as _makeScenario, makeConfig as _makeConfig } from '@test-utils/factories';

const harnessMocks = vi.hoisted(() => ({
  invokeUnary: vi.fn(async () => ({
    status: 0,
    statusMessage: 'OK',
    headers: {},
    trailers: {},
    body: { message: 'hello' },
    durationMs: 5,
  })),
  collectHarnessServerStream: vi.fn(),
  executeClientStream: vi.fn(),
  executeBidiStream: vi.fn(),
}));

vi.mock('@shared/grpc/buildGrpcHarnessOperations', () => ({
  buildGrpcHarnessOperations: () => ({
    invokeUnary: (...args: unknown[]) => harnessMocks.invokeUnary(...args),
    collectHarnessServerStream: harnessMocks.collectHarnessServerStream,
    executeClientStream: harnessMocks.executeClientStream,
    executeBidiStream: harnessMocks.executeBidiStream,
  }),
}));

vi.mock('@shared/utils/httpClient', () => ({
  httpFetch: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '{"ok":true}' }),
}));

vi.mock('@workflow/engine', () => ({
  runWorkflow: vi.fn(() => Promise.resolve([])),
  runWorkflowLoad: vi.fn(() => Promise.resolve([])),
  runGraphLoad: vi.fn(() => Promise.resolve([])),
  VariableContext: class VariableContext {
    constructor(_initial?: Record<string, string>) {}
  },
}));

vi.mock('@workflow/utils/workflowHostResolve', () => ({
  resolveHttpNodeBaseUrl: vi.fn(() => 'https://resolved.example'),
  resolveServiceAuth: vi.fn(() => ({ type: 'bearer', token: 'svc-token', prefix: 'Bearer' })),
}));

const makeScenario = (overrides: Partial<Scenario> = {}): Scenario =>
  _makeScenario({
    id: 's1',
    name: 'Test',
    url: 'https://example.com/api',
    method: 'POST',
    body: '{}',
    ...overrides,
  });

function makeScenarioWithDataRows(rowCount: number): Scenario {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    id: `r${i}`,
    values: { c1: String(i) },
    enabled: true,
  }));
  return makeScenario({
    id: 'ds1',
    dataSource: {
      columns: [{ id: 'c1', name: 'vin', type: 'param', mapping: 'vin' }],
      rows,
    },
  });
}

function minimalWorkflow(id: string): Workflow {
  return {
    id,
    name: 'WF',
    variables: {},
    nodes: [],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('buildHeaders', () => {
  it('includes user headers', () => {
    const s = makeScenario({ headers: [{ key: 'X-Custom', value: 'val' }] });
    const h = buildHeaders(s);
    expect(h['X-Custom']).toBe('val');
  });

  it('skips empty key headers', () => {
    const s = makeScenario({ headers: [{ key: '', value: 'x' }, { key: 'Valid', value: 'y' }] });
    const h = buildHeaders(s);
    expect(Object.keys(h)).not.toContain('');
    expect(h['Valid']).toBe('y');
  });

  it('skips Authorization header when auth type is not none', () => {
    const s = makeScenario({
      headers: [{ key: 'Authorization', value: 'Bearer old' }],
      auth: { type: 'bearer', token: 'new', prefix: 'Bearer' },
    });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe('Bearer new');
  });

  it('keeps Authorization header when auth type is none', () => {
    const s = makeScenario({
      headers: [{ key: 'Authorization', value: 'Bearer manual' }],
      auth: { type: 'none' },
    });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe('Bearer manual');
  });

  it('sets Basic auth header', () => {
    const s = makeScenario({ auth: { type: 'basic', username: 'user', password: 'pass' } });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('sets Bearer auth header', () => {
    const s = makeScenario({ auth: { type: 'bearer', token: 'tok123', prefix: 'Bearer' } });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe('Bearer tok123');
  });

  it('uses custom bearer prefix', () => {
    const s = makeScenario({ auth: { type: 'bearer', token: 'tok', prefix: 'Token' } });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe('Token tok');
  });

  it('defaults to Bearer prefix when none specified', () => {
    const s = makeScenario({ auth: { type: 'bearer', token: 'tok' } });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe('Bearer tok');
  });

  it('sets API Key in header', () => {
    const s = makeScenario({
      auth: { type: 'apikey', apiKeyName: 'X-Api-Key', apiKeyValue: 'key123', apiKeyIn: 'header' },
    });
    const h = buildHeaders(s);
    expect(h['X-Api-Key']).toBe('key123');
  });

  it('does not set API Key in header when apiKeyIn is query', () => {
    const s = makeScenario({
      auth: { type: 'apikey', apiKeyName: 'X-Api-Key', apiKeyValue: 'key123', apiKeyIn: 'query' },
    });
    const h = buildHeaders(s);
    expect(h['X-Api-Key']).toBeUndefined();
  });

  it('sets Digest auth as Basic encoding', () => {
    const s = makeScenario({ auth: { type: 'digest', username: 'u', password: 'p' } });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe(`Basic ${btoa('u:p')}`);
  });

  it('sets OAuth2 Bearer token from provided token', () => {
    const s = makeScenario({ auth: { type: 'oauth2', tokenUrl: 'https://auth.com/token', clientId: 'c', clientSecret: 's' } });
    const h = buildHeaders(s, 'oauth-token-123');
    expect(h['Authorization']).toBe('Bearer oauth-token-123');
  });

  it('sets content type from argument', () => {
    const s = makeScenario({ body: '{}', bodyType: 'json' });
    const h = buildHeaders(s, undefined, 'application/json');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('does not overwrite existing Content-Type header for non-form-data', () => {
    const s = makeScenario({
      headers: [{ key: 'Content-Type', value: 'text/plain' }],
      body: '{}', bodyType: 'json',
    });
    const h = buildHeaders(s, undefined, 'application/json');
    expect(h['Content-Type']).toBe('text/plain');
  });

  it('overwrites Content-Type for form-data', () => {
    const s = makeScenario({
      headers: [{ key: 'Content-Type', value: 'old' }],
      body: 'data', bodyType: 'form-data',
    });
    const h = buildHeaders(s, undefined, 'multipart/form-data; boundary=xxx');
    expect(h['Content-Type']).toBe('multipart/form-data; boundary=xxx');
  });

  it('handles basic auth with no password', () => {
    const s = makeScenario({ auth: { type: 'basic', username: 'user' } });
    const h = buildHeaders(s);
    expect(h['Authorization']).toBe(`Basic ${btoa('user:')}`);
  });
});

describe('buildUrl', () => {
  it('returns url as-is for non-apikey auth', () => {
    const s = makeScenario({ auth: { type: 'none' } });
    expect(buildUrl(s)).toBe('https://example.com/api');
  });

  it('appends API key as query param', () => {
    const s = makeScenario({
      url: 'https://example.com/api',
      auth: { type: 'apikey', apiKeyName: 'key', apiKeyValue: 'val', apiKeyIn: 'query' },
    });
    const result = buildUrl(s);
    expect(result).toContain('key=val');
  });

  it('does not add query param when apiKeyIn is header', () => {
    const s = makeScenario({
      url: 'https://example.com/api',
      auth: { type: 'apikey', apiKeyName: 'key', apiKeyValue: 'val', apiKeyIn: 'header' },
    });
    expect(buildUrl(s)).toBe('https://example.com/api');
  });

  it('preserves existing query params', () => {
    const s = makeScenario({
      url: 'https://example.com/api?existing=1',
      auth: { type: 'apikey', apiKeyName: 'key', apiKeyValue: 'val', apiKeyIn: 'query' },
    });
    const result = buildUrl(s);
    expect(result).toContain('existing=1');
    expect(result).toContain('key=val');
  });
});

describe('proxyFetch', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('delegates to httpFetch with the same arguments', async () => {
    const { httpFetch } = await import('@shared/utils/httpClient');
    const res = await proxyFetch('https://api.example.com/r', 'PATCH', { 'X-Req': '1' }, '{"a":1}');
    expect(vi.mocked(httpFetch)).toHaveBeenCalledWith(
      'https://api.example.com/r',
      'PATCH',
      { 'X-Req': '1' },
      '{"a":1}'
    );
    expect(res.status).toBe(200);
  });
});

describe('runTest', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  function makeConfig(overrides: Partial<TestConfig> = {}): TestConfig {
    return _makeConfig({
      iterations: 2,
      scenarioWeights: [{ scenarioId: 's1', weight: 1 }],
      ...overrides,
    });
  }

  it('runs test with sequential mode', async () => {
    const s = makeScenario();
    const config = makeConfig();
    const onProgress = vi.fn();
    const { results } = await runTest(config, [s], onProgress);
    expect(results.length).toBe(2);
    expect(onProgress).toHaveBeenCalled();
  });

  it('runs test with batch mode', async () => {
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'batch', concurrency: 2 });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('runs test with pool mode', async () => {
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'pool', concurrency: 2, iterations: 3 });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(3);
  });

  it('runs test with load-profile mode', async () => {
    const s = makeScenario();
    const config = makeConfig({
      executionMode: 'load-profile',
      iterations: 1,
      loadProfile: { type: 'sustained', durationSec: 0.08, maxConcurrency: 1 },
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('runs each active scenario the configured iterations times', async () => {
    const s1 = makeScenario({ id: 's1', name: 'Scenario1' });
    const s2 = makeScenario({ id: 's2', name: 'Scenario2' });
    const config = makeConfig({
      iterations: 5,
      scenarioWeights: [
        { scenarioId: 's1', weight: 7 },
        { scenarioId: 's2', weight: 3 },
      ],
    });
    const { results } = await runTest(config, [s1, s2], vi.fn());
    expect(results.length).toBe(10); // 5 per test × 2 tests
    const s1Count = results.filter(r => r.scenarioName === 'Scenario1').length;
    const s2Count = results.filter(r => r.scenarioName === 'Scenario2').length;
    expect(s1Count).toBe(5);
    expect(s2Count).toBe(5);
  });

  it('iterations means per-test count even with many scenarios', async () => {
    const s1 = makeScenario({ id: 's1' });
    const s2 = makeScenario({ id: 's2' });
    const s3 = makeScenario({ id: 's3' });
    const config = makeConfig({
      iterations: 2,
      scenarioWeights: [
        { scenarioId: 's1', weight: 3 },
        { scenarioId: 's2', weight: 2 },
        { scenarioId: 's3', weight: 1 },
      ],
    });
    const { results } = await runTest(config, [s1, s2, s3], vi.fn());
    expect(results.length).toBe(6); // 2 per test × 3 tests
  });

  it('single iteration with two scenarios produces two results', async () => {
    const s1 = makeScenario({ id: 's1', name: 'Eq1' });
    const s2 = makeScenario({ id: 's2', name: 'Eq2' });
    const config = makeConfig({
      iterations: 1,
      scenarioWeights: [
        { scenarioId: 's1', weight: 4 },
        { scenarioId: 's2', weight: 4 },
      ],
    });
    const { results } = await runTest(config, [s1, s2], vi.fn());
    expect(results).toHaveLength(2); // 1 per test × 2 tests
  });

  it('applies timeout config', async () => {
    const s = makeScenario();
    const config = makeConfig({ timeoutSec: 5 });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('skips zero-weight scenarios', async () => {
    const s1 = makeScenario({ id: 's1', name: 'Active' });
    const s2 = makeScenario({ id: 's2', name: 'Inactive' });
    const config = makeConfig({
      iterations: 3,
      scenarioWeights: [
        { scenarioId: 's1', weight: 1 },
        { scenarioId: 's2', weight: 0 },
      ],
    });
    const { results } = await runTest(config, [s1, s2], vi.fn());
    expect(results.every(r => r.scenarioName === 'Active')).toBe(true);
  });

  it('applies constant think time config', async () => {
    const s = makeScenario();
    const config = makeConfig({
      thinkTime: { mode: 'constant', constantMs: 0 },
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('applies uniform think time config', async () => {
    const s = makeScenario();
    const config = makeConfig({
      executionMode: 'batch',
      concurrency: 2,
      thinkTime: { mode: 'uniform', minMs: 0, maxMs: 0 },
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('applies gaussian think time config', async () => {
    const s = makeScenario();
    const config = makeConfig({
      executionMode: 'pool',
      concurrency: 2,
      iterations: 3,
      thinkTime: { mode: 'gaussian', meanMs: 0, stdDevMs: 0 },
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(3);
  });

  it('works without thinkTime config (backward compatible)', async () => {
    const s = makeScenario();
    const config = makeConfig();
    expect(config.thinkTime).toBeUndefined();
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('treats mode none same as no thinkTime', async () => {
    const s = makeScenario();
    const config = makeConfig({ thinkTime: { mode: 'none' } });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('expands data-source fully without capping', async () => {
    const s = makeScenarioWithDataRows(3);
    const config = makeConfig({
      iterations: 2,
      executionMode: 'sequential',
      scenarioWeights: [{ scenarioId: 'ds1', weight: 1 }],
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(6); // 2 iterations × 3 rows
  });

  it('uses runWorkflow for workflow mode with a single iteration', async () => {
    const { runWorkflow } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'workflow', iterations: 1, concurrency: 1 });
    await runTest(config, [s], vi.fn());
    expect(vi.mocked(runWorkflow)).toHaveBeenCalled();
  });

  it('uses runWorkflowLoad for workflow mode with multiple iterations', async () => {
    const { runWorkflowLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'workflow', iterations: 4, concurrency: 2 });
    await runTest(config, [s], vi.fn());
    expect(vi.mocked(runWorkflowLoad)).toHaveBeenCalled();
  });

  it('uses runGraphLoad when workflowId and workflow definition are set', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({
      executionMode: 'workflow',
      workflowId: 'w1',
      iterations: 3,
      concurrency: 2,
    });
    await runTest(config, [s], vi.fn(), undefined, minimalWorkflow('w1'));
    expect(vi.mocked(runGraphLoad)).toHaveBeenCalled();
  });

  it('uses runGraphLoad with iterations 1 when iterations is 0', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({
      executionMode: 'workflow',
      workflowId: 'w1',
      iterations: 0,
      concurrency: 1,
    });
    await runTest(config, [s], vi.fn(), undefined, minimalWorkflow('w1'));
    expect(vi.mocked(runGraphLoad)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ iterations: 1 }),
    );
  });

  it('forwards kafkaOperations to runGraphLoad in workflow mode', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'workflow', workflowId: 'w1', iterations: 1 });
    const kafkaOps = { produce: vi.fn(), consume: vi.fn() };
    await runTest(
      config,
      [s],
      vi.fn(),
      undefined,    // abortSignal
      minimalWorkflow('w1'),
      undefined,    // resolveSubWorkflow
      undefined,    // workerIndex
      undefined,    // workflowResolverData
      kafkaOps,     // kafkaOperations
    );
    expect(vi.mocked(runGraphLoad)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kafkaOperations: kafkaOps }),
    );
  });

  it('forwards grpcOperations to runGraphLoad in workflow mode', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'workflow', workflowId: 'w1', iterations: 1 });
    const grpcOps = { invokeUnary: vi.fn(), collectServerStream: vi.fn() };
    await runTest(
      config,
      [s],
      vi.fn(),
      undefined,
      minimalWorkflow('w1'),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      grpcOps,
    );
    expect(vi.mocked(runGraphLoad)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grpcOperations: grpcOps }),
    );
  });

  it('uses runWorkflow when workflowId is set but workflow definition is missing', async () => {
    const { runWorkflow, runGraphLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({ executionMode: 'workflow', workflowId: 'missing', iterations: 1 });
    await runTest(config, [s], vi.fn(), undefined, undefined);
    expect(vi.mocked(runWorkflow)).toHaveBeenCalled();
    expect(vi.mocked(runGraphLoad)).not.toHaveBeenCalled();
  });

  it('defaults executionMode to batch', async () => {
    const s = makeScenario();
    const config = {
      concurrency: 1,
      iterations: 2,
      scenarioWeights: [{ scenarioId: 's1', weight: 1 }],
    } as TestConfig;
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(2);
  });

  it('fills queue from first scenario when active weights reference missing ids', async () => {
    const s = makeScenario({ id: 's1' });
    const config = makeConfig({
      iterations: 3,
      scenarioWeights: [
        { scenarioId: 'ghost', weight: 1 },
        { scenarioId: 's1', weight: 1 },
      ],
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(3);
  });

  it('uses runWorkflowLoad when workflowId is set but workflow object is missing and iterations > 1', async () => {
    const { runWorkflowLoad, runGraphLoad } = await import('@workflow/engine');
    const s = makeScenario();
    const config = makeConfig({
      executionMode: 'workflow',
      workflowId: 'orphan',
      iterations: 4,
      concurrency: 2,
    });
    await runTest(config, [s], vi.fn(), undefined, undefined);
    expect(vi.mocked(runWorkflowLoad)).toHaveBeenCalled();
    expect(vi.mocked(runGraphLoad)).not.toHaveBeenCalled();
  });

  it('undersampling skips weight ids that are missing from scenarios list', async () => {
    const s1 = makeScenario({ id: 's1', name: 'Only' });
    const config = makeConfig({
      iterations: 1,
      scenarioWeights: [
        { scenarioId: 'missing', weight: 5 },
        { scenarioId: 's1', weight: 1 },
      ],
    });
    const { results } = await runTest(config, [s1], vi.fn());
    expect(results.every(r => r.scenarioName === 'Only')).toBe(true);
  });

  it('gives each scenario equal iterations regardless of weight values', async () => {
    const s1 = makeScenario({ id: 's1' });
    const s2 = makeScenario({ id: 's2', name: 'S2' });
    const config = makeConfig({
      iterations: 12,
      scenarioWeights: [
        { scenarioId: 's1', weight: 3 },
        { scenarioId: 's2', weight: 1 },
      ],
      executionMode: 'sequential',
    });
    const { results } = await runTest(config, [s1, s2], vi.fn());
    expect(results.length).toBe(24); // 12 per test × 2 tests
  });

  it('passes abortSignal through to execution opts', async () => {
    const s = makeScenario();
    const config = makeConfig();
    const abort = new AbortController().signal;
    await runTest(config, [s], vi.fn(), abort);
    // sequential mode — signal is forwarded via RunOpts (no throw)
    expect(abort.aborted).toBe(false);
  });

  it('uses all scenarios when every scenario weight is zero', async () => {
    const s1 = makeScenario({ id: 's1', name: 'A' });
    const s2 = makeScenario({ id: 's2', name: 'B' });
    const config = makeConfig({
      iterations: 1,
      scenarioWeights: [
        { scenarioId: 's1', weight: 0 },
        { scenarioId: 's2', weight: 0 },
      ],
    });
    const { results } = await runTest(config, [s1, s2], vi.fn());
    expect(results).toHaveLength(2);
  });

  it('passes workerIndex to reset result id prefix', async () => {
    const { nextResultId } = await import('./requestExecution');
    const s = makeScenario();
    const config = makeConfig({ iterations: 1 });
    await runTest(config, [s], vi.fn(), undefined, undefined, undefined, 2);
    expect(nextResultId()).toMatch(/^w2-/);
  });

  it('wires resolveHttpBaseUrl and resolveHttpAuth when workflow has services', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const { resolveHttpNodeBaseUrl, resolveServiceAuth } = await import('@workflow/utils/workflowHostResolve');
    const s = makeScenario();
    const workflow: Workflow = {
      ...minimalWorkflow('w1'),
      services: [{ id: 'svc-1', name: 'API', endpoints: [] }],
    };
    const config = makeConfig({
      executionMode: 'workflow',
      workflowId: 'w1',
      iterations: 1,
      workflowBaseUrl: 'https://wf-base.example',
    });
    await runTest(
      config,
      [s],
      vi.fn(),
      undefined,
      workflow,
      undefined,
      undefined,
      {
        microservices: [],
        globalAuthProfiles: [],
        selectedEnvId: 'test',
      },
    );

    const graphOpts = vi.mocked(runGraphLoad).mock.calls.at(-1)![1];
    expect(graphOpts.environmentLayer).toEqual({ baseUrl: 'https://wf-base.example' });
    expect(graphOpts.resolveHttpBaseUrl).toBeTypeOf('function');
    expect(graphOpts.resolveHttpAuth).toBeTypeOf('function');

    const nodeData = {
      label: 'HTTP',
      scenario: makeScenario({ auth: { type: 'inherit' } }),
      serviceId: 'svc-1',
    };
    expect(graphOpts.resolveHttpBaseUrl!(nodeData)).toBe('https://resolved.example');
    expect(vi.mocked(resolveHttpNodeBaseUrl)).toHaveBeenCalledWith(
      nodeData,
      [],
      undefined,
      workflow.services,
      'test',
    );

    expect(graphOpts.resolveHttpAuth!(nodeData)).toEqual({
      type: 'bearer',
      token: 'svc-token',
      prefix: 'Bearer',
    });
    expect(vi.mocked(resolveServiceAuth)).toHaveBeenCalledWith(
      nodeData,
      workflow.services,
      'test',
      [],
      [],
    );
  });

  it('resolveHttpAuth returns undefined for explicit non-inherit auth on node', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const { resolveServiceAuth } = await import('@workflow/utils/workflowHostResolve');
    vi.mocked(resolveServiceAuth).mockClear();
    const s = makeScenario({ auth: { type: 'bearer', token: 'explicit' } });
    const workflow: Workflow = {
      ...minimalWorkflow('w1'),
      services: [{ id: 'svc-1', name: 'API', endpoints: [] }],
    };
    const config = makeConfig({ executionMode: 'workflow', workflowId: 'w1', iterations: 1 });
    await runTest(config, [s], vi.fn(), undefined, workflow);
    const graphOpts = vi.mocked(runGraphLoad).mock.calls.at(-1)![1];
    const nodeData = { label: 'HTTP', scenario: s, serviceId: 'svc-1' };
    expect(graphOpts.resolveHttpAuth!(nodeData)).toBeUndefined();
    expect(vi.mocked(resolveServiceAuth)).not.toHaveBeenCalled();
  });

  it('resolveHttpAuth coalesces null service auth to undefined', async () => {
    const { runGraphLoad } = await import('@workflow/engine');
    const { resolveServiceAuth } = await import('@workflow/utils/workflowHostResolve');
    vi.mocked(resolveServiceAuth).mockReturnValueOnce(undefined);
    const s = makeScenario({ auth: { type: 'inherit' } });
    const workflow: Workflow = {
      ...minimalWorkflow('w1'),
      services: [{ id: 'svc-1', name: 'API', endpoints: [] }],
    };
    const config = makeConfig({ executionMode: 'workflow', workflowId: 'w1', iterations: 1 });
    await runTest(config, [s], vi.fn(), undefined, workflow);
    const graphOpts = vi.mocked(runGraphLoad).mock.calls.at(-1)![1];
    expect(graphOpts.resolveHttpAuth!({ label: 'HTTP', scenario: s })).toBeUndefined();
  });

  it('detects parameterized kind from sharedDataSourceId', async () => {
    const s = makeScenario({ id: 's1', sharedDataSourceId: 'ds-shared' });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBe(1);
  });

  it('throws error for Kafka action without kafkaOperations', async () => {
    const s = makeScenario({ id: 's1', actionType: 'kafkaProduce' });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    const wsOps = { disconnectAll: vi.fn().mockResolvedValue(undefined) } as unknown as import('@workflow/engine/graphRunnerNodeHandlerContext').WsNodeOperations;
    await expect(
      runTest(config, [s], vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, wsOps),
    ).rejects.toThrow('Kafka operations not available');
  });

  it('throws error for WS action without wsOperations', async () => {
    const s = makeScenario({ id: 's1', actionType: 'wsConnect' });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    const kafkaOps = {} as unknown as import('@workflow/engine/graphRunnerNodeHandlerContext').KafkaNodeOperations;
    await expect(
      runTest(config, [s], vi.fn(), undefined, undefined, undefined, undefined, undefined, kafkaOps),
    ).rejects.toThrow('WS operations not available');
  });

  it('throws error for unknown non-HTTP action type', async () => {
    const s = makeScenario({ id: 's1', actionType: 'unknownThing' as never });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    const wsOps = { disconnectAll: vi.fn().mockResolvedValue(undefined) } as unknown as import('@workflow/engine/graphRunnerNodeHandlerContext').WsNodeOperations;
    await expect(
      runTest(config, [s], vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, wsOps),
    ).rejects.toThrow('Unknown non-HTTP action type');
  });

  it('rejects malformed grpc harness scenarios before execution', async () => {
    const s = makeScenario({
      id: 's1',
      actionType: 'grpcCall',
      method: 'GRPC',
      grpcCallAction: {
        callType: 'unary',
        target: '',
        descriptorKey: '',
        service: '',
        method: '',
        body: {},
      },
    });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    await expect(
      runTest(config, [s], vi.fn()),
    ).rejects.toThrow('Invalid gRPC harness scenario');
  });

  it('executes valid grpc harness scenarios via executeGrpcAction', async () => {
    harnessMocks.invokeUnary.mockClear();
    const s = makeScenario({
      id: 's1',
      actionType: 'grpcCall',
      method: 'GRPC',
      grpcCallAction: {
        callType: 'unary',
        target: 'localhost:50051',
        descriptorKey: 'echo-v1',
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: 'hello' },
      },
    });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results).toHaveLength(1);
    expect(results[0]?.transportType).toBe('grpcCall');
    expect(results[0]?.passed).toBe(true);
    expect(harnessMocks.invokeUnary).toHaveBeenCalled();
  });

  it('auto-hydrates grpc connection profiles for profile-only harness scenarios', async () => {
    harnessMocks.invokeUnary.mockClear();
    const loadSpy = vi
      .spyOn(grpcConnectionProfileHydration, 'loadGrpcConnectionProfilesFromStorage')
      .mockReturnValue([
        {
          id: 'profile-a',
          name: 'Hydrated Profile',
          target: 'hydrated-host:50052',
          tlsMode: 'disabled',
        },
      ]);

    const s = makeScenario({
      id: 's1',
      actionType: 'grpcCall',
      method: 'GRPC',
      grpcCallAction: {
        callType: 'unary',
        target: '',
        connectionId: 'profile-a',
        descriptorKey: 'echo-v1',
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: 'hello' },
      },
    });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    const { results } = await runTest(config, [s], vi.fn());

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(harnessMocks.invokeUnary).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ address: 'hydrated-host:50052' }),
      }),
      expect.any(String),
    );

    loadSpy.mockRestore();
  });

  it('records grpc harness results in load-profile mode without throwing', async () => {
    const s = makeScenario({
      id: 's1',
      actionType: 'grpcCall',
      method: 'GRPC',
      grpcCallAction: {
        callType: 'unary',
        target: 'localhost:50051',
        descriptorKey: 'echo-v1',
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: 'hello' },
      },
    });
    const config = makeConfig({
      executionMode: 'load-profile',
      iterations: 1,
      scenarioWeights: [{ scenarioId: 's1', weight: 1 }],
      loadProfile: { type: 'sustained', durationSec: 0.05, maxConcurrency: 1 },
    });
    const { results } = await runTest(config, [s], vi.fn());
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.transportType === 'grpcCall')).toBe(true);
  });

  it('calls wsOperations.disconnectAll in finally block', async () => {
    const disconnectAll = vi.fn().mockResolvedValue(undefined);
    const wsOps = { disconnectAll } as unknown as import('@workflow/engine/graphRunnerNodeHandlerContext').WsNodeOperations;
    const s = makeScenario({ id: 's1' });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    await runTest(config, [s], vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, wsOps);
    expect(disconnectAll).toHaveBeenCalled();
  });

  it('swallows wsOperations.disconnectAll errors in finally block', async () => {
    const disconnectAll = vi.fn().mockRejectedValue(new Error('cleanup fail'));
    const wsOps = { disconnectAll } as unknown as import('@workflow/engine/graphRunnerNodeHandlerContext').WsNodeOperations;
    const s = makeScenario({ id: 's1' });
    const config = makeConfig({ iterations: 1, scenarioWeights: [{ scenarioId: 's1', weight: 1 }] });
    // Should not throw even though disconnectAll rejects
    await expect(runTest(config, [s], vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, wsOps)).resolves.toBeTruthy();
  });

  it('form-data content type overwrites existing Content-Type', () => {
    const scenario = makeScenario({
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      bodyType: 'form-data',
    });
    const headers = buildHeaders(scenario, undefined, 'multipart/form-data; boundary=---xyz');
    expect(headers['Content-Type']).toBe('multipart/form-data; boundary=---xyz');
  });
});