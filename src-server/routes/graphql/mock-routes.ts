/**
 * mock-routes.ts — Phase 3E (tasks 3E-1 + 3E-2)
 *
 * GraphQL mock server routes. The mock server is a schema-aware fake API
 * that runs entirely inside the Tauri proxy process (desktop-only).
 *
 * Routes:
 *   POST /api/graphql/mock           — execute { query, variables } against mock schema
 *   POST /api/graphql/mock/config    — configure the mock server (SDL + resolvers + settings)
 *   GET  /api/graphql/mock/status    — return current mock server status
 *   GET  /api/graphql/mock/log       — return the last N mock request log entries
 *
 * Configuration schema:
 *   {
 *     enabled:          boolean        — master switch
 *     sdl:              string         — GraphQL SDL (schema definition language)
 *     resolvers:        Record<string, Record<string, MockResolver>>
 *     globalLatencyMs?: number         — ms added to each response
 *     jitterMs?:        number         — random 0–jitterMs added to latency
 *     seed?:            number         — (stored; deterministic PRNG not yet implemented)
 *     scenarios?:       MockScenario[]
 *     activeScenarioId?: string
 *     scalarFactories?: MockScalarFactory[]
 *   }
 *
 * Request log: ring buffer of last 200 entries (trimmed to 200 on insert).
 */

import { Router, type Request, type Response } from 'express';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { addMocksToSchema } from '@graphql-tools/mock';
import { execute, parse, type GraphQLSchema, type ExecutionResult } from 'graphql';
import { buildMockMap } from '../../utils/buildMockMap.js';
import type { GraphqlMockConfig, MockScenario } from '../../../src/shared/types/graphql.js';
import { toErrorMessage } from '../../../src/shared/utils/helpers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockRequestLogEntry {
  id:               string;
  timestamp:        number;
  operationName:    string | null;
  query:            string;
  variables:        unknown;
  result:           ExecutionResult;
  latencyMs:        number;
  activeScenarioId: string | null;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let mockSchema: GraphQLSchema | null   = null;
let mockConfig: GraphqlMockConfig | null = null;
const requestLog: MockRequestLogEntry[]  = [];
let requestCount = 0;

const LOG_MAX = 200;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateLogId(): string {
  return `ml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolve effective resolvers for the active scenario.
 *
 * Spec (3E-9): "switching scenario **replaces** active resolvers" — when a scenario
 * is active its resolver map is used exclusively. The base resolvers act as a
 * fallback only when no scenario is active.
 *
 * Per-type semantics: if a scenario defines overrides for type T, *only* the scenario's
 * fields for T are used (the base config's fields for T are not merged in). This ensures
 * scenario fixtures produce deterministic, isolated responses. Fields on types *not*
 * mentioned by the scenario fall back to the base config as-is.
 *
 * Exported for unit testing.
 */
export function resolveEffectiveResolvers(
  config: GraphqlMockConfig,
  scenario?: MockScenario,
): GraphqlMockConfig['resolvers'] {
  // No active scenario → use base resolvers.
  if (!scenario) {
    return config.resolvers;
  }
  // Scenario with empty resolvers → return empty map (all fields use graphql-tools defaults).
  // Per spec (3E-9), activating a scenario with no overrides "replaces" active resolvers
  // with nothing, clearing all base overrides for that scenario.
  if (!scenario.resolvers || Object.keys(scenario.resolvers).length === 0) {
    return {};
  }
  const scenarioResolvers = scenario.resolvers;
  // Start with all base types not overridden by the scenario.
  const result: GraphqlMockConfig['resolvers'] = {};
  for (const [typeName, fields] of Object.entries(config.resolvers)) {
    if (!(typeName in scenarioResolvers)) {
      result[typeName] = { ...fields };
    }
  }
  // Add scenario overrides (replacing entire type resolver maps, not merging).
  for (const [typeName, fields] of Object.entries(scenarioResolvers)) {
    result[typeName] = { ...fields };
  }
  return result;
}

/**
 * Rebuild the mock schema from current config + SDL.
 * Called when config changes.
 */
function configureMock(sdl: string, config: GraphqlMockConfig): void {
  const activeScenario = config.scenarios?.find((s) => s.id === config.activeScenarioId);
  const effectiveResolvers = resolveEffectiveResolvers(config, activeScenario);
  const mocks = buildMockMap(effectiveResolvers, config.scalarFactories);
  const baseSchema = makeExecutableSchema({ typeDefs: sdl });
  mockSchema = addMocksToSchema({ schema: baseSchema, mocks });
  mockConfig = config;
}

/**
 * Execute a GraphQL query against the mock schema and record it in the log.
 */
async function executeMock(
  query: string,
  variables: unknown,
  operationName?: string | null,
): Promise<{ result: ExecutionResult; latencyMs: number }> {
  if (!mockSchema || !mockConfig?.enabled) {
    throw new Error('Mock server is not configured or is disabled');
  }

  const start = Date.now();

  // Apply global latency + jitter
  const base   = mockConfig.globalLatencyMs ?? 0;
  const jitter = mockConfig.jitterMs ?? 0;
  if (base > 0 || jitter > 0) {
    await delay(base + Math.random() * jitter);
  }

  let doc;
  try {
    doc = parse(query);
  } catch (err) {
    const parseLatencyMs = Date.now() - start;
    requestCount++;
    // Log parse failures so they appear in the request log tab with a clear error result
    const parseEntry: MockRequestLogEntry = {
      id:               generateLogId(),
      timestamp:        Date.now(),
      // Use || instead of ?? so empty string falls through to extracted name
      operationName:    operationName || extractOperationName(query),
      query,
      variables,
      result:           { errors: [{ message: `GraphQL parse error: ${toErrorMessage(err)}` } as import('graphql').GraphQLError] },
      latencyMs:        parseLatencyMs,
      activeScenarioId: mockConfig.activeScenarioId ?? null,
    };
    requestLog.push(parseEntry);
    if (requestLog.length > LOG_MAX) requestLog.shift();
    throw new Error(`GraphQL parse error: ${toErrorMessage(err)}`, { cause: err });
  }

  const result = await execute({
    schema:         mockSchema,
    document:       doc,
    variableValues: variables as Record<string, unknown>,
    // Coerce null → undefined (execute() expects undefined to mean "no name")
    operationName:  operationName || undefined,
  });

  const latencyMs = Date.now() - start;
  requestCount++;

  // Append to ring buffer
  const entry: MockRequestLogEntry = {
    id:               generateLogId(),
    timestamp:        Date.now(),
    // Use || so empty string falls through to the extracted name from the query
    operationName:    operationName || extractOperationName(query),
    query,
    variables,
    result,
    latencyMs,
    activeScenarioId: mockConfig.activeScenarioId ?? null,
  };
  requestLog.push(entry);
  if (requestLog.length > LOG_MAX) requestLog.shift();

  return { result, latencyMs };
}

/** Extract the first operation name from a query string (for log display) */
function extractOperationName(query: string): string | null {
  const m = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/m);
  return m ? m[1] : null;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createMockRouter(): Router {
  const router = Router();

  // ── POST /api/graphql/mock — execute query against mock schema ────────────
  router.post('/api/graphql/mock', async (req: Request, res: Response) => {
    if (!mockConfig?.enabled || !mockSchema) {
      res.status(503).json({
        ok: false,
        error: { code: 'MOCK_NOT_ENABLED', message: 'Mock server is not enabled. POST /api/graphql/mock/config first.' },
      });
      return;
    }

    const { query, variables, operationName } = req.body as {
      query?: unknown;
      variables?: unknown;
      operationName?: unknown;
    };

    if (typeof query !== 'string' || !query) {
      res.status(400).json({
        ok: false,
        error: { code: 'MOCK_INVALID_REQUEST', message: '`query` (string) is required' },
      });
      return;
    }

    try {
      const { result, latencyMs } = await executeMock(
        query,
        variables ?? {},
        // Treat empty string the same as null — GraphQL.js would try to find an
        // operation named "" (which never exists) causing an avoidable error.
        typeof operationName === 'string' && operationName ? operationName : null,
      );
      res.json({ ...result, extensions: { ...result.extensions, latencyMs } });
    } catch (err) {
      // Return a GraphQL-shaped error response (not HTTP 500) so clients get
      // a consistent { errors: [...] } body regardless of whether the query
      // executed successfully or failed at the parse/execution stage.
      const message = toErrorMessage(err);
      res.json({ errors: [{ message }] });
    }
  });

  // ── POST /api/graphql/mock/config — configure the mock server ────────────
  router.post('/api/graphql/mock/config', (req: Request, res: Response) => {
    const body = req.body as {
      enabled?: boolean;
      sdl?: string;
      config?: Partial<GraphqlMockConfig>;
    };

    // Support both { enabled: false } (disable-only) and { sdl, config, ... }
    if (body.enabled === false && !body.sdl) {
      if (mockConfig) mockConfig = { ...mockConfig, enabled: false };
      res.json({ ok: true, enabled: false });
      return;
    }

    const sdl: unknown = body.sdl;
    if (typeof sdl !== 'string' || !sdl.trim()) {
      res.status(400).json({
        ok: false,
        error: { code: 'MOCK_INVALID_CONFIG', message: '`sdl` (non-empty string) is required' },
      });
      return;
    }

    const rawConfig = body.config;
    if (!rawConfig || typeof rawConfig !== 'object') {
      res.status(400).json({
        ok: false,
        error: { code: 'MOCK_INVALID_CONFIG', message: '`config` object is required' },
      });
      return;
    }

    try {
      const fullConfig: GraphqlMockConfig = {
        connectionId:    rawConfig.connectionId    ?? mockConfig?.connectionId ?? '',
        enabled:         rawConfig.enabled         ?? true,
        resolvers:       rawConfig.resolvers        ?? {},
        globalLatencyMs: rawConfig.globalLatencyMs ?? 0,
        jitterMs:        rawConfig.jitterMs,
        seed:            rawConfig.seed,
        scenarios:       rawConfig.scenarios,
        activeScenarioId: rawConfig.activeScenarioId,
        scalarFactories: rawConfig.scalarFactories,
      };
      configureMock(sdl, fullConfig);
      res.json({ ok: true, enabled: fullConfig.enabled });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: { code: 'MOCK_SCHEMA_ERROR', message: toErrorMessage(err) },
      });
    }
  });

  // ── GET /api/graphql/mock/status ──────────────────────────────────────────
  router.get('/api/graphql/mock/status', (_req: Request, res: Response) => {
    if (!mockConfig) {
      res.json({
        enabled:            false,
        configured:         false,
        schemaHash:         null,
        activeResolverCount: 0,
        latencyMs:          0,
        jitterMs:           0,
        requestCount:       0,
        activeScenarioId:   null,
      });
      return;
    }

    // Count non-random resolver overrides in the *effective* resolver map (respects active scenario)
    const activeScenarioForStatus = mockConfig.scenarios?.find((s) => s.id === mockConfig!.activeScenarioId);
    const effectiveForStatus = resolveEffectiveResolvers(mockConfig, activeScenarioForStatus);
    const resolverCount = Object.values(effectiveForStatus).reduce(
      (sum, fields) => sum + Object.values(fields).filter((r) => r.type !== 'random').length, 0,
    );

    res.json({
      enabled:            mockConfig.enabled,
      configured:         mockSchema !== null,
      schemaHash:         null,    // reserved
      activeResolverCount: resolverCount,
      latencyMs:          mockConfig.globalLatencyMs ?? 0,
      jitterMs:           mockConfig.jitterMs ?? 0,
      requestCount,
      activeScenarioId:   mockConfig.activeScenarioId ?? null,
    });
  });

  // ── GET /api/graphql/mock/log ─────────────────────────────────────────────
  router.get('/api/graphql/mock/log', (req: Request, res: Response) => {
    const limitParam = req.query.limit;
    const limit = typeof limitParam === 'string' ? Math.min(parseInt(limitParam, 10) || 50, LOG_MAX) : 50;
    // Return newest first
    const entries = requestLog.slice(-limit).reverse();
    res.json({ ok: true, entries, total: requestLog.length });
  });

  return router;
}
