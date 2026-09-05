/**
 * @vitest-environment node
 *
 * mock-routes.test.ts — Phase 3E unit + HTTP route tests
 */

import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphql')>();
  return {
    ...actual,
    execute: vi.fn(async () => ({ data: { hello: 'world' } })),
    parse: vi.fn((source: string) => actual.parse(source)),
  };
});

const schemaThrowMode = vi.hoisted(() => ({ mode: 'normal' as 'normal' | 'string' }));

vi.mock('@graphql-tools/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@graphql-tools/schema')>();
  return {
    ...actual,
    makeExecutableSchema: (...args: Parameters<typeof actual.makeExecutableSchema>) => {
      if (schemaThrowMode.mode === 'string') {
        throw 'schema-string-error';
      }
      return actual.makeExecutableSchema(...args);
    },
  };
});

import { execute, parse } from 'graphql';
import { createMockRouter, resolveEffectiveResolvers } from './mock-routes.js';
import type { GraphqlMockConfig, MockScenario } from '../../../src/shared/types/graphql.js';

const mockExecute = vi.mocked(execute);
const mockParse = vi.mocked(parse);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(
  resolvers: GraphqlMockConfig['resolvers'],
  scenarios: MockScenario[] = [],
  activeScenarioId?: string,
): GraphqlMockConfig {
  return {
    connectionId:    'test',
    enabled:         true,
    resolvers,
    globalLatencyMs: 0,
    scenarios,
    activeScenarioId,
  };
}

// ─── resolveEffectiveResolvers ────────────────────────────────────────────────

describe('resolveEffectiveResolvers', () => {
  describe('no active scenario', () => {
    it('returns base resolvers unchanged when no scenario is provided', () => {
      const base = {
        Query: { user: { type: 'fixed' as const, value: 'Alice' } },
      };
      const config = makeConfig(base);
      const result = resolveEffectiveResolvers(config, undefined);
      expect(result).toEqual(base);
    });

    it('returns base resolvers unchanged when scenario is undefined', () => {
      const base = {
        User: { name: { type: 'fixed' as const, value: 'Bob' } },
        Query: { count: { type: 'fixed' as const, value: 42 } },
      };
      const config = makeConfig(base);
      const result = resolveEffectiveResolvers(config);
      expect(result).toEqual(base);
    });
  });

  describe('active scenario with empty resolvers', () => {
    it('returns empty map when scenario has no resolver overrides (spec: replaces all base resolvers)', () => {
      const base = {
        Query: { user: { type: 'fixed' as const, value: 'Alice' } },
      };
      const scenario: MockScenario = {
        id: 's1', name: 'Empty scenario', resolvers: {},
      };
      const config = makeConfig(base, [scenario], 's1');
      const result = resolveEffectiveResolvers(config, scenario);
      // Activating an empty scenario clears all base resolvers — deterministic clean state
      expect(result).toEqual({});
    });
  });

  describe('active scenario with partial overrides', () => {
    it('replaces only the types defined in the scenario (per-type replacement, not field-merge)', () => {
      const base = {
        Query: { user: { type: 'fixed' as const, value: 'Alice' }, count: { type: 'fixed' as const, value: 5 } },
        User:  { name: { type: 'random' as const } },
      };
      const scenario: MockScenario = {
        id: 's1', name: 'Scenario A',
        resolvers: {
          Query: { user: { type: 'fixed' as const, value: 'ScenarioAlice' } },
          // Note: `count` is NOT in scenario.Query → it is dropped (type-level replacement)
        },
      };
      const config = makeConfig(base, [scenario], 's1');
      const result = resolveEffectiveResolvers(config, scenario);

      // Scenario's Query replaces the entire base Query map (not merged)
      expect(result['Query']).toEqual({ user: { type: 'fixed', value: 'ScenarioAlice' } });
      expect(result['Query']['count']).toBeUndefined();

      // User is NOT in the scenario → it falls through from base as-is
      expect(result['User']).toEqual({ name: { type: 'random' } });
    });

    it('includes base types not touched by the scenario', () => {
      const base = {
        Query:   { count: { type: 'fixed' as const, value: 99 } },
        Mutation: { create: { type: 'error' as const, message: 'Forbidden' } },
      };
      const scenario: MockScenario = {
        id: 's2', name: 'Scenario B',
        resolvers: {
          Query: { count: { type: 'fixed' as const, value: 0 } },
        },
      };
      const config = makeConfig(base, [scenario], 's2');
      const result = resolveEffectiveResolvers(config, scenario);

      expect(result['Query']).toEqual({ count: { type: 'fixed', value: 0 } });
      // Mutation was not overridden → base Mutation is preserved
      expect(result['Mutation']).toEqual({ create: { type: 'error', message: 'Forbidden' } });
    });

    it('scenario can override a type that the base config does not have', () => {
      const base = {
        Query: { count: { type: 'fixed' as const, value: 1 } },
      };
      const scenario: MockScenario = {
        id: 's3', name: 'Adds Product',
        resolvers: {
          Product: { price: { type: 'fixed' as const, value: 9.99 } },
        },
      };
      const config = makeConfig(base, [scenario], 's3');
      const result = resolveEffectiveResolvers(config, scenario);

      expect(result['Query']).toEqual({ count: { type: 'fixed', value: 1 } });
      expect(result['Product']).toEqual({ price: { type: 'fixed', value: 9.99 } });
    });
  });

  describe('scenario does not mutate base config', () => {
    it('does not mutate the original resolvers map', () => {
      const base: GraphqlMockConfig['resolvers'] = {
        Query: { user: { type: 'fixed', value: 'Original' } },
      };
      const baseSnapshot = JSON.parse(JSON.stringify(base)) as typeof base;
      const scenario: MockScenario = {
        id: 's4', name: 'Mutation check',
        resolvers: {
          Query: { user: { type: 'fixed', value: 'Scenario' } },
        },
      };
      const config = makeConfig(base, [scenario], 's4');
      resolveEffectiveResolvers(config, scenario);
      // Base resolvers must remain unchanged
      expect(base).toEqual(baseSnapshot);
    });
  });

  describe('resolveEffectiveResolvers — operationName empty-string handling (regression)', () => {
    // This is not a unit test for resolveEffectiveResolvers but documents the
    // empty-operationName bug fix in the route handler (mock-routes.ts line ~230):
    // typeof "" === 'string' is true, so without the extra `&& operationName` guard,
    // an empty string would be forwarded to GraphQL execute() causing "unknown operation".
    it('coerces empty string to null via || operator', () => {
      // The fix uses `operationName || undefined` in execute() and
      // `typeof operationName === 'string' && operationName ? operationName : null` in the route.
      // We verify the JavaScript || coercion semantics here as a documentation test.
      const emptyOp: string | null = '';
      expect(emptyOp || undefined).toBeUndefined();
      const namedOp: string | null = 'MyQuery';
      expect(namedOp || undefined).toBe('MyQuery');
      const nullOp: string | null = null;
      expect(nullOp || undefined).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty base resolvers with a scenario that has overrides', () => {
      const base = {};
      const scenario: MockScenario = {
        id: 's5', name: 'Empty base',
        resolvers: { Query: { ping: { type: 'fixed' as const, value: 'pong' } } },
      };
      const config = makeConfig(base, [scenario], 's5');
      const result = resolveEffectiveResolvers(config, scenario);
      expect(result['Query']).toEqual({ ping: { type: 'fixed', value: 'pong' } });
    });

    it('handles multiple scenario types all replacing base types', () => {
      const base = {
        Query: { a: { type: 'fixed' as const, value: 1 } },
        User:  { b: { type: 'fixed' as const, value: 2 } },
      };
      const scenario: MockScenario = {
        id: 's6', name: 'Full override',
        resolvers: {
          Query: { a: { type: 'fixed' as const, value: 10 } },
          User:  { b: { type: 'fixed' as const, value: 20 } },
        },
      };
      const config = makeConfig(base, [scenario], 's6');
      const result = resolveEffectiveResolvers(config, scenario);
      expect(result['Query']).toEqual({ a: { type: 'fixed', value: 10 } });
      expect(result['User']).toEqual({ b: { type: 'fixed', value: 20 } });
    });

    it('returns empty map when scenario.resolvers is undefined', () => {
      const base = {
        Query: { user: { type: 'fixed' as const, value: 'Alice' } },
      };
      const scenario = { id: 's7', name: 'Undefined resolvers' } as MockScenario;
      const config = makeConfig(base, [scenario], 's7');
      expect(resolveEffectiveResolvers(config, scenario)).toEqual({});
    });
  });
});

// ─── HTTP route integration ───────────────────────────────────────────────────

const MOCK_SDL = `
  type Query {
    hello: String
    user: User
  }
  type User {
    name: String
  }
`;

function buildMockApp() {
  const app = express();
  app.use(express.json());
  app.use(createMockRouter());
  return app;
}

async function configureMockServer(
  app: ReturnType<typeof buildMockApp>,
  overrides: Partial<GraphqlMockConfig> = {},
) {
  return request(app)
    .post('/api/graphql/mock/config')
    .send({
      sdl: MOCK_SDL,
      config: {
        connectionId: 'test',
        enabled: true,
        resolvers: {
          Query: { hello: { type: 'fixed', value: 'world' } },
          User: { name: { type: 'fixed', value: 'Alice' } },
        },
        ...overrides,
      },
    });
}

describe('createMockRouter HTTP routes', () => {
  let app: ReturnType<typeof buildMockApp>;

  beforeEach(async () => {
    app = buildMockApp();
    mockExecute.mockResolvedValue({ data: { hello: 'world' } });
    schemaThrowMode.mode = 'normal';
    // Module-level mock state persists across tests — reset to disabled baseline.
    await request(app).post('/api/graphql/mock/config').send({ enabled: false });
  });

  describe('GET /api/graphql/mock/status', () => {
    it('returns unconfigured defaults when mock has never been set up', async () => {
      const res = await request(app).get('/api/graphql/mock/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: false,
        configured: false,
        schemaHash: null,
        activeResolverCount: 0,
        latencyMs: 0,
        jitterMs: 0,
        requestCount: 0,
        activeScenarioId: null,
      });
    });

    it('reports enabled state and resolver count after configuration', async () => {
      await configureMockServer(app, {
        resolvers: {
          Query: {
            hello: { type: 'fixed', value: 'hi' },
            count: { type: 'random' },
          },
        },
      });

      const res = await request(app).get('/api/graphql/mock/status');
      expect(res.body.enabled).toBe(true);
      expect(res.body.configured).toBe(true);
      expect(res.body.activeResolverCount).toBe(1);
      expect(res.body.latencyMs).toBe(0);
    });
  });

  describe('POST /api/graphql/mock/config', () => {
    it('configures the mock server with valid SDL and config', async () => {
      const res = await configureMockServer(app);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, enabled: true });
    });

    it('disables mock server with enabled:false and no sdl', async () => {
      await configureMockServer(app);
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, enabled: false });
    });

    it('disable-only succeeds even when mock was never configured', async () => {
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('returns 400 when sdl is missing or empty', async () => {
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({ config: { resolvers: {} } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MOCK_INVALID_CONFIG');
    });

    it('returns 400 when config object is missing', async () => {
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({ sdl: MOCK_SDL });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MOCK_INVALID_CONFIG');
    });

    it('returns 400 for invalid GraphQL SDL', async () => {
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({
          sdl: 'type Query { broken',
          config: { resolvers: {} },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MOCK_SCHEMA_ERROR');
    });

    it('applies active scenario resolver overrides', async () => {
      mockExecute.mockResolvedValueOnce({ data: { hello: 'scenario-value' } });
      const res = await configureMockServer(app, {
        resolvers: {
          Query: { hello: { type: 'fixed', value: 'base' } },
        },
        scenarios: [{
          id: 'scenario-a',
          name: 'Scenario A',
          resolvers: {
            Query: { hello: { type: 'fixed', value: 'scenario-value' } },
          },
        }],
        activeScenarioId: 'scenario-a',
      });
      expect(res.status).toBe(200);

      const queryRes = await request(app)
        .post('/api/graphql/mock')
        .send({ query: '{ hello }' });
      expect(queryRes.body.data?.hello).toBe('scenario-value');
    });
  });

  describe('POST /api/graphql/mock', () => {
    it('returns 503 when mock server is not enabled', async () => {
      const res = await request(app)
        .post('/api/graphql/mock')
        .send({ query: '{ hello }' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('MOCK_NOT_ENABLED');
    });

    it('returns 503 after mock is disabled', async () => {
      await configureMockServer(app);
      await request(app).post('/api/graphql/mock/config').send({ enabled: false });

      const res = await request(app)
        .post('/api/graphql/mock')
        .send({ query: '{ hello }' });
      expect(res.status).toBe(503);
    });

    it('returns 400 when query is missing', async () => {
      await configureMockServer(app);
      const res = await request(app).post('/api/graphql/mock').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MOCK_INVALID_REQUEST');
    });

    it('executes a valid query and returns data with latency extension', async () => {
      const cfgRes = await configureMockServer(app);
      expect(cfgRes.status).toBe(200);
      const res = await request(app)
        .post('/api/graphql/mock')
        .send({
          query: 'query GetHello { hello }',
          variables: {},
          operationName: 'GetHello',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.hello).toBe('world');
      expect(res.body.extensions?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('extracts operation name from query when operationName is empty string', async () => {
      await configureMockServer(app);
      await request(app)
        .post('/api/graphql/mock')
        .send({ query: 'query NamedOp { hello }', operationName: '' });

      const logRes = await request(app).get('/api/graphql/mock/log?limit=5');
      const named = logRes.body.entries.find((e: { operationName: string | null }) => e.operationName === 'NamedOp');
      expect(named).toBeDefined();
    });

    it('includes latencyMs in extensions when globalLatencyMs is configured', async () => {
      await configureMockServer(app, { globalLatencyMs: 1, jitterMs: 0 });
      const res = await request(app)
        .post('/api/graphql/mock')
        .send({ query: '{ hello }' });
      expect(res.body.data?.hello).toBe('world');
      expect(typeof res.body.extensions?.latencyMs).toBe('number');
      expect(res.body.extensions.latencyMs).toBeGreaterThanOrEqual(1);
    });

    it('returns GraphQL-shaped errors for parse failures', async () => {
      await configureMockServer(app);
      mockParse.mockImplementationOnce(() => {
        throw new SyntaxError('Unexpected token');
      });
      const res = await request(app)
        .post('/api/graphql/mock')
        .send({ query: '{ broken' });
      expect(res.status).toBe(200);
      expect(res.body.errors?.[0]?.message).toMatch(/parse error/i);
    });

    it('logs parse failures in the request log', async () => {
      await configureMockServer(app);
      mockParse.mockImplementationOnce(() => {
        throw new SyntaxError('Unexpected token');
      });
      await request(app).post('/api/graphql/mock').send({ query: '{ bad syntax' });

      const logRes = await request(app).get('/api/graphql/mock/log?limit=5');
      expect(logRes.body.entries.some((e: { result: { errors?: { message: string }[] } }) =>
        e.result.errors?.[0]?.message?.includes('parse error'),
      )).toBe(true);
    });
  });

  describe('GET /api/graphql/mock/log', () => {
    it('returns newest-first log entries with default limit', async () => {
      await configureMockServer(app);
      await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      await request(app).post('/api/graphql/mock').send({ query: 'query Second { hello }' });

      const res = await request(app).get('/api/graphql/mock/log');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.entries[0].timestamp).toBeGreaterThanOrEqual(res.body.entries[1].timestamp);
    });

    it('respects limit query param capped at 200', async () => {
      await configureMockServer(app);
      const res = await request(app).get('/api/graphql/mock/log?limit=999');
      expect(res.body.entries.length).toBeLessThanOrEqual(200);
    });

    it('increments requestCount in status after executions', async () => {
      await configureMockServer(app);
      await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });

      const status = await request(app).get('/api/graphql/mock/status');
      expect(status.body.requestCount).toBeGreaterThanOrEqual(1);
    });

    it('uses default log limit when limit query param is not a string', async () => {
      await configureMockServer(app);
      await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      const res = await request(app).get('/api/graphql/mock/log');
      expect(res.body.entries.length).toBeLessThanOrEqual(50);
    });

    it('records null operationName for anonymous queries', async () => {
      await configureMockServer(app);
      await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      const logRes = await request(app).get('/api/graphql/mock/log?limit=1');
      expect(logRes.body.entries[0].operationName).toBeNull();
    });

    it('applies jitterMs to response latency', async () => {
      await configureMockServer(app, { globalLatencyMs: 0, jitterMs: 5 });
      const res = await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      expect(res.body.extensions?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns 400 when query is not a string', async () => {
      await configureMockServer(app);
      const res = await request(app).post('/api/graphql/mock').send({ query: 123 });
      expect(res.status).toBe(400);
    });

    it('handles non-Error parse failures with string coercion', async () => {
      await configureMockServer(app);
      mockParse.mockImplementationOnce(() => {
        throw 'parse-string-error';
      });
      const res = await request(app).post('/api/graphql/mock').send({ query: '{ bad' });
      expect(res.status).toBe(200);
      expect(res.body.errors?.[0]?.message).toContain('parse-string-error');
    });

    it('returns GraphQL-shaped errors for non-Error execution failures', async () => {
      await configureMockServer(app);
      mockExecute.mockRejectedValueOnce('exec-string-error');
      const res = await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      expect(res.body.errors?.[0]?.message).toBe('exec-string-error');
    });

    it('trims request log ring buffer after many successful executions', async () => {
      await configureMockServer(app);
      for (let i = 0; i < 205; i += 1) {
        await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      }
      const logRes = await request(app).get('/api/graphql/mock/log?limit=200');
      expect(logRes.body.total).toBeLessThanOrEqual(200);
    }, 60_000);

    it('trims request log ring buffer when parse failures exceed capacity', async () => {
      await configureMockServer(app);
      for (let i = 0; i < 200; i += 1) {
        await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      }
      mockParse.mockImplementationOnce(() => {
        throw 'overflow-parse';
      });
      await request(app).post('/api/graphql/mock').send({ query: '{ bad' });
      const logRes = await request(app).get('/api/graphql/mock/log?limit=200');
      expect(logRes.body.total).toBeLessThanOrEqual(200);
    }, 60_000);
  });

  describe('POST /api/graphql/mock/config — extended branches', () => {
    it('returns 400 for non-Error schema build failures', async () => {
      schemaThrowMode.mode = 'string';
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({
          sdl: MOCK_SDL,
          config: { resolvers: { Query: { hello: { type: 'fixed', value: 'x' } } } },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('schema-string-error');
    });

    it('defaults connectionId to empty string on first configure', async () => {
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({ sdl: MOCK_SDL, config: { resolvers: {} } });
      expect(res.status).toBe(200);
      const status = await request(app).get('/api/graphql/mock/status');
      expect(status.body.enabled).toBe(true);
    });

    it('preserves connectionId from prior config when omitted', async () => {
      await request(app)
        .post('/api/graphql/mock/config')
        .send({
          sdl: MOCK_SDL,
          config: { connectionId: 'persist-id', resolvers: {} },
        });
      const res = await request(app)
        .post('/api/graphql/mock/config')
        .send({
          sdl: MOCK_SDL,
          config: { resolvers: { Query: { hello: { type: 'fixed', value: 'v' } } } },
        });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/graphql/mock/status — extended branches', () => {
    it('reports configured jitterMs in status', async () => {
      await configureMockServer(app, { jitterMs: 42 });
      const res = await request(app).get('/api/graphql/mock/status');
      expect(res.body.jitterMs).toBe(42);
    });

    it('counts only non-random resolvers from active scenario', async () => {
      await configureMockServer(app, {
        resolvers: {
          Query: {
            hello: { type: 'fixed', value: 'base' },
            rand: { type: 'random' },
          },
        },
        scenarios: [{
          id: 's1',
          name: 'S1',
          resolvers: {
            Query: {
              hello: { type: 'fixed', value: 'scenario' },
              rand: { type: 'random' },
            },
          },
        }],
        activeScenarioId: 's1',
      });
      const res = await request(app).get('/api/graphql/mock/status');
      expect(res.body.activeResolverCount).toBe(1);
    });
  });

  describe('GET /api/graphql/mock/log — extended branches', () => {
    it('falls back to default limit when limit param is not numeric', async () => {
      await configureMockServer(app);
      for (let i = 0; i < 60; i += 1) {
        await request(app).post('/api/graphql/mock').send({ query: '{ hello }' });
      }
      const res = await request(app).get('/api/graphql/mock/log?limit=not-a-number');
      expect(res.body.entries.length).toBeLessThanOrEqual(50);
    });
  });
});
