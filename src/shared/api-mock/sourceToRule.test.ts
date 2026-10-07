import { describe, it, expect } from 'vitest';
import { convertSourceToRule, convertBatch, type SourceRequest, type ConversionOptions } from './sourceToRule';

const opts: ConversionOptions = { sourceKind: 'curl', sourceLabel: 'test' };

describe('convertSourceToRule', () => {
  it('converts a simple GET to an inactive route', () => {
    const input: SourceRequest = { method: 'GET', path: '/users' };
    const result = convertSourceToRule(input, opts);
    expect(result.route.method).toBe('GET');
    expect(result.route.path.value).toBe('/users');
    expect(result.route.enabled).toBe(false);
    expect(result.route.responseMode).toBe('rules');
    expect(result.route.responses).toHaveLength(1);
  });

  it('creates a matching sample with expected outcome', () => {
    const result = convertSourceToRule({ method: 'POST', path: '/data' }, opts);
    expect(result.sample.routeId).toBe(result.route.id);
    expect(result.sample.expected?.outcome).toBe('matched');
    expect(result.sample.request.method).toBe('POST');
  });

  it('normalizes method to uppercase', () => {
    const result = convertSourceToRule({ method: 'post', path: '/' }, opts);
    expect(result.route.method).toBe('POST');
  });

  it('warns on unknown method', () => {
    const result = convertSourceToRule({ method: 'PURGE', path: '/' }, opts);
    expect(result.route.method).toBe('GET');
    expect(result.diagnostics.some(d => d.code === 'AMS-IMPORT-UNSUPPORTED-FIELD')).toBe(true);
  });

  it('adds exact header predicates', () => {
    const input: SourceRequest = { method: 'GET', path: '/', headers: { 'X-Tenant': 'acme', 'Accept': 'application/json' } };
    const result = convertSourceToRule(input, opts);
    const preds = result.route.predicates.children;
    expect(preds.length).toBeGreaterThanOrEqual(1);
    expect(preds.some(p => 'selector' in p && p.selector === 'accept')).toBe(true);
  });

  it('skips host, user-agent, content-length headers', () => {
    const input: SourceRequest = { method: 'GET', path: '/', headers: { Host: 'example.com', 'User-Agent': 'curl', 'Content-Length': '42', 'X-Custom': 'val' } };
    const result = convertSourceToRule(input, opts);
    const preds = result.route.predicates.children.filter(p => 'selector' in p);
    expect(preds).toHaveLength(1);
  });

  it('keeps the authorization header as an exact match', () => {
    const input: SourceRequest = { method: 'GET', path: '/', headers: { Authorization: 'Bearer tok' }, authScheme: 'Bearer' };
    const result = convertSourceToRule(input, opts);
    const auth = result.route.predicates.children.find(p => 'selector' in p && p.selector === 'authorization');
    expect(auth && 'expected' in auth && auth.expected).toBe('Bearer tok');
    expect(result.sample.request.headers.authorization).toEqual(['Bearer tok']);
  });

  it('adds exact query predicates', () => {
    const input: SourceRequest = { method: 'GET', path: '/orders', query: { vin: 'VIN123', dataSync: 'false' } };
    const result = convertSourceToRule(input, opts);
    const query = result.route.predicates.children.filter(p => 'source' in p && p.source === 'query');
    expect(query.map(p => ('selector' in p ? p.selector : ''))).toEqual(['vin', 'dataSync']);
  });

  it('creates json_subset predicate for JSON body', () => {
    const input: SourceRequest = { method: 'POST', path: '/', body: '{"name":"Alice"}', contentType: 'application/json' };
    const result = convertSourceToRule(input, opts);
    const bodyPred = result.route.predicates.children.find(p => 'source' in p && p.source === 'body');
    expect(bodyPred).toBeDefined();
    expect('operator' in bodyPred! && bodyPred.operator).toBe('json_subset');
  });

  it('falls back to exact match for invalid JSON body', () => {
    const input: SourceRequest = { method: 'POST', path: '/', body: 'not json', contentType: 'application/json' };
    const result = convertSourceToRule(input, opts);
    expect(result.diagnostics.some(d => d.code === 'AMS-IMPORT-LOSS')).toBe(true);
    const bodyPred = result.route.predicates.children.find(p => 'source' in p && p.source === 'body');
    expect('operator' in bodyPred! && bodyPred.operator).toBe('exact');
  });

  it('uses custom priority and status', () => {
    const result = convertSourceToRule({ method: 'GET', path: '/' }, { ...opts, defaultPriority: 50, defaultStatus: 201 });
    expect(result.route.priority).toBe(50);
    expect(result.route.responses[0].status).toBe(201);
  });

  it('assigns to folder when provided', () => {
    const result = convertSourceToRule({ method: 'GET', path: '/' }, { ...opts, folderId: 'folder-1' });
    expect(result.route.folderId).toBe('folder-1');
  });

  it('sets source metadata', () => {
    const result = convertSourceToRule({ method: 'GET', path: '/' }, opts);
    expect(result.source.kind).toBe('curl');
    expect(result.source.label).toBe('test');
    expect(result.source.importedAt).toBeTruthy();
  });

  it('infers parameterized kind for OpenAPI {id} and :id paths', () => {
    const openApi = convertSourceToRule({ method: 'GET', path: '/orders/{id}' }, { ...opts, sourceKind: 'openapi' });
    expect(openApi.route.path).toEqual({
      kind: 'parameterized',
      value: '/orders/{id}',
      paramNames: ['id'],
    });
    const colon = convertSourceToRule({ method: 'GET', path: '/users/:id' }, opts);
    expect(colon.route.path.kind).toBe('parameterized');
    expect(colon.route.path.paramNames).toEqual(['id']);
  });

  it('keeps literal paths exact', () => {
    const result = convertSourceToRule({ method: 'GET', path: '/users' }, opts);
    expect(result.route.path).toEqual({ kind: 'exact', value: '/users' });
  });

  it('produces query in sample rawPath', () => {
    const input: SourceRequest = { method: 'GET', path: '/search', query: { q: 'hello' } };
    const result = convertSourceToRule(input, opts);
    expect(result.sample.request.rawPath).toContain('q=hello');
  });
});

describe('convertBatch', () => {
  it('converts multiple inputs', () => {
    const inputs: SourceRequest[] = [
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
    ];
    const results = convertBatch(inputs, opts);
    expect(results).toHaveLength(2);
    expect(results[0].route.path.value).toBe('/a');
    expect(results[1].route.path.value).toBe('/b');
  });

  it('each route gets a unique ID', () => {
    const results = convertBatch([{ method: 'GET', path: '/' }, { method: 'GET', path: '/' }], opts);
    expect(results[0].route.id).not.toBe(results[1].route.id);
  });
});

describe('harSourceEntry population (B-3a)', () => {
  const harOpts: ConversionOptions = { sourceKind: 'har' };

  it('populates harSourceEntry when sourceKind is har and status is present', () => {
    const input: SourceRequest = {
      method: 'POST', path: '/api/orders', status: 201,
      responseBody: '{"id":"order-1"}', responseContentType: 'application/json',
      body: '{"item":"widget"}',
    };
    const { route } = convertSourceToRule(input, harOpts);
    expect(route.harSourceEntry).toBeDefined();
    expect(route.harSourceEntry?.originalStatus).toBe(201);
    expect(route.harSourceEntry?.originalContentType).toBe('application/json');
    expect(route.harSourceEntry?.originalBody).toBe('{"id":"order-1"}');
    expect(route.harSourceEntry?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not populate harSourceEntry when sourceKind is not har', () => {
    const input: SourceRequest = { method: 'GET', path: '/users', status: 200 };
    const { route } = convertSourceToRule(input, { sourceKind: 'curl' });
    expect(route.harSourceEntry).toBeUndefined();
  });

  it('does not populate harSourceEntry when status is absent', () => {
    const input: SourceRequest = { method: 'GET', path: '/users' };
    const { route } = convertSourceToRule(input, harOpts);
    expect(route.harSourceEntry).toBeUndefined();
  });

  it('truncates originalBody to 4096 characters', () => {
    const longBody = 'x'.repeat(5000);
    const input: SourceRequest = { method: 'GET', path: '/big', status: 200, responseBody: longBody };
    const { route } = convertSourceToRule(input, harOpts);
    expect(route.harSourceEntry?.originalBody?.length).toBe(4096);
  });

  it('generates a consistent requestFingerprint for same method+path+body', () => {
    const input: SourceRequest = { method: 'POST', path: '/api/orders', status: 200, body: '{"q":1}' };
    const r1 = convertSourceToRule(input, harOpts);
    const r2 = convertSourceToRule(input, harOpts);
    expect(r1.route.harSourceEntry?.requestFingerprint).toBe(r2.route.harSourceEntry?.requestFingerprint);
  });

  it('fingerprint differs when body differs', () => {
    const r1 = convertSourceToRule({ method: 'POST', path: '/api', status: 200, body: '{"a":1}' }, harOpts);
    const r2 = convertSourceToRule({ method: 'POST', path: '/api', status: 200, body: '{"b":2}' }, harOpts);
    expect(r1.route.harSourceEntry?.requestFingerprint).not.toBe(r2.route.harSourceEntry?.requestFingerprint);
  });

  it('uses normalized uppercase method in fingerprint so lowercase input still matches', () => {
    // Lowercase 'post' at import time should produce same fingerprint as uppercase 'POST' at journal time
    const rLower = convertSourceToRule({ method: 'post', path: '/api', status: 200, body: '{"a":1}' }, harOpts);
    const rUpper = convertSourceToRule({ method: 'POST', path: '/api', status: 200, body: '{"a":1}' }, harOpts);
    expect(rLower.route.harSourceEntry?.requestFingerprint).toBe(rUpper.route.harSourceEntry?.requestFingerprint);
  });
});

describe('convertSourceToRule — uncovered branch coverage', () => {
  it('sets body kind to text when responseContentType is not JSON (covers line 80 text branch)', () => {
    const result = convertSourceToRule(
      { method: 'GET', path: '/stream', responseBody: 'data:event\n\n', responseContentType: 'text/event-stream' },
      { sourceKind: 'curl', sourceLabel: 'test' },
    );
    expect(result.route.responses[0].body.kind).toBe('text');
    expect(result.route.responses[0].body.contentType).toBe('text/event-stream');
  });

  it('sets fault on response behavior when input.fault is set (covers line 87)', () => {
    const result = convertSourceToRule(
      { method: 'GET', path: '/slow', fault: 'timeout' },
      { sourceKind: 'curl', sourceLabel: 'test' },
    );
    expect(result.route.responses[0].behavior.fault).toBe('timeout');
  });

  it('adds scenario tags and state transition when scenario fields are set (covers lines 89-105)', () => {
    const result = convertSourceToRule(
      {
        method: 'POST',
        path: '/orders',
        scenario: { name: 'CreateOrder', requiredState: 'Idle', newState: 'Created' },
      },
      { sourceKind: 'wiremock', sourceLabel: 'test' },
    );
    expect(result.route.responses[0].transition).toEqual({
      currentState: 'Idle',
      targetState: 'Created',
    });
    expect(result.route.tags).toContain('scenario:CreateOrder');
    expect(result.route.tags).toContain('scenario-required:Idle');
    expect(result.route.tags).toContain('scenario-new:Created');
    expect(result.route.name).toContain('[CreateOrder]');
  });

  it('includes extra predicates in route when input.predicates is set (covers line 237)', () => {
    const pred = {
      id: 'pred-1',
      source: 'query' as const,
      operator: 'exact' as const,
      expected: 'val',
    };
    const result = convertSourceToRule(
      { method: 'GET', path: '/search', predicates: [pred] },
      { sourceKind: 'wiremock', sourceLabel: 'test' },
    );
    const childIds = result.route.predicates.children.map((c: { id: string }) => c.id);
    expect(childIds).toContain('pred-1');
  });
});
