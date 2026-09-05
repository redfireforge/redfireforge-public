/**
 * API Mock Studio — Phase 12A performance benchmarks (engine).
 *
 * Measures p95 for startup validation and request matching across 100/500/2,000
 * route sets and representative exact/regex/JSON operator mixes, and asserts the
 * bounded-cache invariants. Hard p95 assertions apply PERF_CI_SLACK so shared CI
 * runners do not flake; the raw budgets in perfBudgets.ts are the true targets.
 */
import { describe, it, expect } from 'vitest';
import type { ApiMockServerDefinitionV1, ApiMockRouteV1 } from './contracts';
import { DEFAULT_SETTINGS, createDefaultResponse } from './defaults';
import { validateServer } from './validation';
import { selectRoute } from './routeSelector';
import { normalizeRequest } from './requestNormalization';
import {
  API_MOCK_PERF_BUDGETS,
  PERF_CI_SLACK,
  percentile,
  BoundedCache,
} from './perfBudgets';
import { compileRegexCached, _clearPatternCache } from './patternCache';

const ts = '2026-08-12T00:00:00.000Z';

type Mix = 'exact' | 'regex' | 'json';

function makeRoute(i: number, mix: Mix): ApiMockRouteV1 {
  const base = {
    id: `r${i}`,
    name: `Route ${i}`,
    enabled: true,
    priority: 10 + (i % 50),
    responseMode: 'rules' as const,
    responses: [createDefaultResponse(`resp${i}`)],
    tags: [],
    createdAt: ts,
    updatedAt: ts,
  };
  if (mix === 'exact') {
    return {
      ...base,
      method: 'GET',
      path: { kind: 'exact', value: `/api/resource/${i}` },
      predicates: { id: `pg${i}`, combinator: 'all', children: [] },
    };
  }
  if (mix === 'regex') {
    return {
      ...base,
      method: 'GET',
      path: { kind: 'regex', value: `^/api/regex/${i}/[0-9]+$` },
      predicates: { id: `pg${i}`, combinator: 'all', children: [] },
    };
  }
  // json: all routes share one method+path so every route evaluates the body predicate.
  return {
    ...base,
    method: 'POST',
    path: { kind: 'exact', value: '/api/json' },
    predicates: {
      id: `pg${i}`,
      combinator: 'all',
      children: [{ id: `p${i}`, source: 'body', operator: 'json_subset', expected: JSON.stringify({ [`key_${i}`]: i }) }],
    },
  };
}

function makeDef(count: number, mix: Mix): ApiMockServerDefinitionV1 {
  const routes: ApiMockRouteV1[] = [];
  for (let i = 0; i < count; i++) routes.push(makeRoute(i, mix));
  return {
    id: 'srv-perf', name: 'Perf', enabled: true, host: '127.0.0.1',
    port: 4600, basePath: '', folders: [], variables: [], samples: [],
    routes, settings: { ...DEFAULT_SETTINGS }, createdAt: ts, updatedAt: ts,
  };
}

function measure(iterations: number, fn: () => void): number[] {
  const samples = new Array<number>(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples[i] = performance.now() - t0;
  }
  return samples;
}

function report(label: string, samples: number[], budgetMs: number): number {
  const p95 = percentile(samples, 95);
  console.log(`[perf] ${label}: p95=${p95.toFixed(3)}ms budget=${budgetMs}ms slack=${PERF_CI_SLACK}x`);
  return p95;
}

describe('percentile helper', () => {
  it('computes nearest-rank percentiles', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 100)).toBe(10);
    expect(percentile(s, 50)).toBe(5);
    expect(percentile(s, 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([42], 95)).toBe(42);
  });
});

describe('BoundedCache', () => {
  it('evicts least-recently-used beyond capacity', () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' becomes most-recent
    cache.set('c', 3); // evicts 'b'
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('stays bounded under many unique keys', () => {
    const cache = new BoundedCache<number, number>(64);
    for (let i = 0; i < 10_000; i++) cache.set(i, i);
    expect(cache.size).toBe(64);
  });
});

describe('compiled pattern cache', () => {
  it('caches invalid patterns as null without throwing', () => {
    expect(compileRegexCached('[')).toBeNull();
    expect(compileRegexCached('[')).toBeNull();
    expect(compileRegexCached('^a$')?.test('a')).toBe(true);
  });
});

/** V8 coverage instrumentation invalidates wall-clock budgets on CI shards. */
const skipTimingBudgets = process.env.PRODUCT_COVERAGE === '1';

describe.skipIf(skipTimingBudgets)('startup validation budget', () => {
  const cases: Array<[number, number]> = [
    [100, API_MOCK_PERF_BUDGETS.startup100.p95Ms],
    [500, API_MOCK_PERF_BUDGETS.startup500.p95Ms],
    [2000, API_MOCK_PERF_BUDGETS.startup2000.p95Ms],
  ];
  for (const [count, budget] of cases) {
    it(`validates ${count}-route definition within budget`, () => {
      const def = makeDef(count, 'exact');
      measure(3, () => validateServer(def)); // warmup
      const samples = measure(20, () => validateServer(def));
      const p95 = report(`startup ${count}`, samples, budget);
      expect(p95).toBeLessThan(budget * PERF_CI_SLACK);
    });
  }
});

describe('matching budget (2,000 routes)', () => {
  it.skipIf(skipTimingBudgets)('exact-heavy match within budget', () => {
    _clearPatternCache();
    const def = makeDef(2000, 'exact');
    const { captured } = normalizeRequest({ method: 'GET', url: '/api/resource/1000', headers: {} });
    measure(20, () => selectRoute(def.routes, captured, def.settings, def.basePath));
    const samples = measure(200, () => selectRoute(def.routes, captured, def.settings, def.basePath));
    const p95 = report('match exact 2000', samples, API_MOCK_PERF_BUDGETS.matchExact2000.p95Ms);
    expect(p95).toBeLessThan(API_MOCK_PERF_BUDGETS.matchExact2000.p95Ms * PERF_CI_SLACK);
  });

  it.skipIf(skipTimingBudgets)('regex-heavy match within budget', () => {
    _clearPatternCache();
    const def = makeDef(2000, 'regex');
    const { captured } = normalizeRequest({ method: 'GET', url: '/api/regex/1000/42', headers: {} });
    measure(20, () => selectRoute(def.routes, captured, def.settings, def.basePath)); // warm cache
    const samples = measure(200, () => selectRoute(def.routes, captured, def.settings, def.basePath));
    const p95 = report('match regex 2000', samples, API_MOCK_PERF_BUDGETS.matchRegex2000.p95Ms);
    expect(p95).toBeLessThan(API_MOCK_PERF_BUDGETS.matchRegex2000.p95Ms * PERF_CI_SLACK);
  });

  it.skipIf(skipTimingBudgets)('json_subset match within budget (body parsed once per request)', () => {
    _clearPatternCache();
    const def = makeDef(2000, 'json');
    const body = JSON.stringify({ user: { id: 123, name: 'Alice' }, items: [1, 2, 3], meta: { a: 1, b: 2 } });
    const { captured } = normalizeRequest({
      method: 'POST', url: '/api/json',
      headers: { 'content-type': 'application/json' }, body,
    });
    measure(20, () => selectRoute(def.routes, captured, def.settings, def.basePath));
    const samples = measure(200, () => selectRoute(def.routes, captured, def.settings, def.basePath));
    const p95 = report('match json 2000', samples, API_MOCK_PERF_BUDGETS.matchJson2000.p95Ms);
    expect(p95).toBeLessThan(API_MOCK_PERF_BUDGETS.matchJson2000.p95Ms * PERF_CI_SLACK);
  });

  it('produces a correct match under the exact mix', () => {
    const def = makeDef(500, 'exact');
    const { captured } = normalizeRequest({ method: 'GET', url: '/api/resource/250', headers: {} });
    const result = selectRoute(def.routes, captured, def.settings, def.basePath);
    expect(result.outcome).toBe('matched');
    expect(result.selectedRouteId).toBe('r250');
  });
});
