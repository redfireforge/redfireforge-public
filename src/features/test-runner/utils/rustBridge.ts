/**
 * Bridge between the React frontend and the Rust executor backend via Tauri IPC.
 *
 * This module wraps Tauri's invoke/listen APIs to provide a typed interface for:
 *   - Detecting Rust executor availability
 *   - Sending execution plans to the Rust backend
 *   - Receiving streaming progress events
 *   - Aborting running tests
 *   - Converting TestConfig+Scenario[] → RustExecutionPlan (Phase 2C)
 *   - Mapping RustExecutionResult → RequestResult with JS-side validation (Phase 2C)
 *
 * Only usable inside a Tauri desktop shell — callers must guard with isTauri().
 */

import { isTauri } from '@shared/utils/platform';
import type { TestConfig, Scenario, RequestResult, ScenarioWeight, FailureDetail } from '@shared/types';
import type { ProgressMeta } from '@engine/core/executor';
import type { TestResult } from '@engine/core/executor';
import { buildHeaders, buildUrl } from '@engine/core/executor';
import { serializeWithContentType } from '@shared/utils/bodySerializer';
import { expandQueue } from '@engine/core/dataSourceExpander';
import { computeAllocation } from '@engine/core/allocationEngine';
import {
  mapRustResult,
  buildScenarioLookup,
  findScenario,
  mapRustResultWithoutValidation,
} from './rustBridgeResultMapping';
export {
  mapRustResult,
  buildScenarioLookup,
  findScenario,
  mapRustResultWithoutValidation,
} from './rustBridgeResultMapping';

/* ── Rust-side types (must match src-tauri/src/types.rs) ─────────── */

export interface RustScenarioValidation {
  mode: string;
  expectedJson?: string;
  expectedFields?: Array<{
    jsonPath: string;
    expectedValue: string;
    operator?: string;
    operatorValue?: string;
    negate?: boolean;
  }>;
  unorderedArrays?: boolean;
}

export interface RustScenario {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  featureGroupName?: string | null;
  groupName?: string | null;
  weight?: number | null;
  dataRowId?: string | null;
  dataRowLabel?: string | null;
  validation?: RustScenarioValidation;
  assertions?: Record<string, unknown>[];
}

export type RustThinkTimeConfig =
  | { type: 'none' }
  | { type: 'constant'; delayMs: number }
  | { type: 'uniform'; minMs: number; maxMs: number }
  | { type: 'gaussian'; meanMs: number; stdDevMs: number };

export type RustCircuitBreakerConfig =
  | { policy: 'continue' }
  | { policy: 'stop-first' }
  | { policy: 'stop-threshold'; maxErrors: number; maxErrorRate: number; minSampleSize: number };

export type DetailLevel = 'full' | 'metrics-only' | 'sampled';

export type RustExecutionPlan =
  | {
      mode: 'pool';
      scenarios: RustScenario[];
      concurrency: number;
      timeoutMs: number;
      retryCount: number;
      retryDelayMs: number;
      thinkTime: RustThinkTimeConfig;
      circuitBreaker: RustCircuitBreakerConfig;
      detailLevel?: DetailLevel;
    }
  | {
      mode: 'sequential';
      scenarios: RustScenario[];
      timeoutMs: number;
      retryCount: number;
      retryDelayMs: number;
      thinkTime: RustThinkTimeConfig;
      circuitBreaker: RustCircuitBreakerConfig;
      detailLevel?: DetailLevel;
    }
  | {
      mode: 'load-profile';
      scenarios: RustScenario[];
      concurrency: number;
      durationSec: number;
      timeoutMs: number;
      retryCount: number;
      retryDelayMs: number;
      thinkTime: RustThinkTimeConfig;
      circuitBreaker: RustCircuitBreakerConfig;
      profileType: string;
      rampUpSec?: number | null;
      spikeConcurrency?: number | null;
      spikeStartSec?: number | null;
      spikeDurationSec?: number | null;
      detailLevel?: DetailLevel;
    }
  | {
      mode: 'constant-arrival';
      scenarios: RustScenario[];
      targetRps: number;
      durationSec: number;
      maxInFlight: number;
      timeoutMs: number;
      retryCount: number;
      retryDelayMs: number;
      thinkTime: RustThinkTimeConfig;
      circuitBreaker: RustCircuitBreakerConfig;
      rampConfig?: { startRps: number; endRps: number; rampDurationSec: number };
      detailLevel?: DetailLevel;
    };

export interface RustTimingBreakdown {
  dnsLookup: number;
  tcpConnect: number;
  tlsHandshake: number;
  ttfb: number;
  download: number;
  total: number;
}

export interface RustRequestLog {
  headers: Record<string, string>;
  body?: string | null;
}

export interface RustExecutionResult {
  id: string;
  scenarioId: string;
  scenarioName: string;
  featureGroupName?: string | null;
  groupName?: string | null;
  url: string;
  method: string;
  httpStatus: number;
  responseTimeMs: number;
  responseBody: string;
  responseHeaders: Record<string, string>;
  timestamp: number;
  errorMessage?: string | null;
  dataRowId?: string | null;
  dataRowLabel?: string | null;
  requestLog: RustRequestLog;
  timing: RustTimingBreakdown;
  retryCount: number;
  passed?: boolean;
  failureDetails?: FailureDetail[];
  validationMode?: string;
}

export interface RustMetricsSnapshot {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  min: number;
  max: number;
  avg: number;
  total: number;
  errors: number;
  tps: number;
}

export interface RustProgressBatch {
  completed: number;
  total: number;
  results: RustExecutionResult[];
  elapsedMs: number;
  currentInFlight: number;
  targetConcurrency: number;
  breakerTripped: boolean;
  metrics?: RustMetricsSnapshot;
  targetRps?: number;
  actualRps?: number;
  droppedRequests?: number;
}

export interface RustCompletionSummary {
  totalResults: number;
  durationMs: number;
  breakerTripped: boolean;
  finalMetrics?: RustMetricsSnapshot;
}

export interface RustFinalResults {
  results: RustExecutionResult[];
}

/* ── Availability check ──────────────────────────────────────────── */

let _available: boolean | null = null;

export async function isRustExecutorAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  if (!isTauri()) {
    _available = false;
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    _available = await invoke<boolean>('is_rust_executor_available');
  } catch {
    _available = false;
  }
  return _available;
}

/** Reset the cached availability flag (for testing). */
export function resetAvailabilityCache(): void {
  _available = null;
}

/* ── Start / Abort ───────────────────────────────────────────────── */

export async function startRustLoadTest(
  plan: RustExecutionPlan,
  onProgress: (batch: RustProgressBatch) => void,
  onComplete: (summary: RustCompletionSummary) => void,
  onError?: (err: unknown) => void,
  onFinalResults?: (payload: RustFinalResults) => void,
): Promise<{ unlisten: () => void }> {
  if (!isTauri()) {
    const err = new Error('startRustLoadTest called outside Tauri');
    if (onError) onError(err); else throw err;
    return { unlisten: () => {} };
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    unlistenProgress();
    unlistenComplete();
    unlistenFinalResults();
  };

  const unlistenProgress = await listen<RustProgressBatch>('load-test-progress', (event) => {
    onProgress(event.payload);
  });

  const unlistenFinalResults = onFinalResults
    ? await listen<RustFinalResults>('load-test-final-results', (event) => {
        onFinalResults(event.payload);
      })
    : () => {};

  const unlistenComplete = await listen<RustCompletionSummary>('load-test-complete', (event) => {
    cleanup();
    onComplete(event.payload);
  });

  invoke<RustCompletionSummary>('start_load_test', { plan }).catch((err) => {
    console.error('[rustBridge] start_load_test failed:', err);
    cleanup();
    if (onError) {
      onError(err);
    } else {
      onComplete({ totalResults: 0, durationMs: 0, breakerTripped: false });
    }
  });

  return { unlisten: cleanup };
}

export async function abortRustLoadTest(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('abort_load_test');
}

/* ── Phase 2C: Execution plan builder ────────────────────────────── */

/**
 * Check whether Rust executor can handle this test configuration.
 * Falls back to JS when: workflow mode, unresolved OAuth2 auth, or sub-workflow resolver needed.
 * Constant-arrival pre-resolves OAuth2 to bearer in useTestExecution before this check.
 */
export function canUseRustExecutor(
  config: TestConfig,
  scenarios: Scenario[],
  resolveSubWorkflow?: (id: string) => unknown,
): boolean {
  if (config.executionMode === 'workflow') return false;
  if (resolveSubWorkflow) return false;
  if (scenarios.some((s) => s.auth.type === 'oauth2')) return false;
  if (scenarios.some((s) => s.actionType && s.actionType !== 'http')) return false;
  return true;
}

function mapThinkTime(config: TestConfig): RustThinkTimeConfig {
  const tt = config.thinkTime;
  if (!tt || tt.mode === 'none') return { type: 'none' };
  switch (tt.mode) {
    case 'constant':
      return { type: 'constant', delayMs: Math.max(0, Math.round(tt.constantMs ?? 1000)) };
    case 'uniform':
      return { type: 'uniform', minMs: Math.max(0, Math.round(tt.minMs ?? 500)), maxMs: Math.max(0, Math.round(tt.maxMs ?? 2000)) };
    case 'gaussian':
      return { type: 'gaussian', meanMs: Math.max(0, Math.round(tt.meanMs ?? 1000)), stdDevMs: Math.max(0, Math.round(tt.stdDevMs ?? 300)) };
    default:
      return { type: 'none' };
  }
}

function mapCircuitBreaker(config: TestConfig): RustCircuitBreakerConfig {
  const policy = config.errorPolicy ?? 'continue';
  if (policy === 'continue') return { policy: 'continue' };
  if (policy === 'stop-first') return { policy: 'stop-first' };
  const jsRate = config.maxErrorRate ?? 50;
  return {
    policy: 'stop-threshold',
    maxErrors: config.maxErrors ?? 10,
    maxErrorRate: jsRate / 100,
    minSampleSize: 10,
  };
}

/**
 * Normalize assertion objects to match the Rust Assertion enum field names.
 * Handles legacy imports that may use UI form field names instead of type field names.
 */
function normalizeAssertionForRust(a: Record<string, unknown>): Record<string, unknown> {
  const raw = a as Record<string, unknown>;
  if (raw.type === 'header') {
    return {
      ...raw,
      name: raw.name || raw.headerName || '',
      operator: raw.operator || raw.headerOp || 'equals',
      value: raw.value ?? raw.headerValue ?? undefined,
    };
  }
  if (raw.type === 'numeric' || raw.type === 'arrayLength') {
    return {
      ...raw,
      operator: raw.operator || raw.comparison || '>',
    };
  }
  if (raw.type === 'existence') {
    const expectExists = raw.expectExists ?? (raw.existsMode === 'exists' ? true : raw.existsMode === 'does_not_exist' ? false : true);
    return { ...raw, expectExists };
  }
  return raw;
}

/**
 * Prepare a single Scenario into a RustScenario with fully resolved headers, URL, and body.
 * Reuses the same logic as the JS executor (prepareScenario) but outputs a flat struct.
 */
export function prepareRustScenario(scenario: Scenario): RustScenario {
  const { body, contentType } = serializeWithContentType(scenario);
  const headers = buildHeaders(scenario, undefined, contentType);
  const url = buildUrl(scenario);

  const allAssertions = scenario.validation.assertions ?? [];
  const rustAssertions = allAssertions
    .filter(a => a.type !== 'custom')
    .map(a => normalizeAssertionForRust(a as unknown as Record<string, unknown>));

  return {
    id: scenario.id,
    name: scenario.name,
    url,
    method: scenario.method,
    headers,
    body: body ?? null,
    featureGroupName: scenario.featureGroupName ?? null,
    groupName: scenario.groupName ?? null,
    weight: null,
    dataRowId: scenario.dataRowId ?? null,
    dataRowLabel: scenario.dataRowLabel ?? null,
    validation: {
      mode: scenario.validation.mode,
      expectedJson: scenario.validation.expectedJson,
      expectedFields: scenario.validation.expectedFields?.map(f => ({
        jsonPath: f.jsonPath || (f as unknown as Record<string, string>).path || '',
        expectedValue: f.expectedValue || (f as unknown as Record<string, string>).value || '',
        operator: f.operator,
        operatorValue: f.operatorValue,
        negate: f.negate,
      })),
      unorderedArrays: scenario.validation.unorderedArrays,
    },
    assertions: rustAssertions.length > 0
      ? rustAssertions
      : undefined,
  };
}

/**
 * Build a RustExecutionPlan from TestConfig + Scenario[].
 * Performs the same allocation → shuffle → expand pipeline as the JS executor,
 * then maps each expanded scenario through prepareRustScenario().
 *
 * Returns null if the configuration can't be handled by Rust (e.g., workflow mode).
 */
export function buildExecutionPlan(
  config: TestConfig,
  scenarios: Scenario[],
): RustExecutionPlan | null {
  if (config.executionMode === 'workflow') return null;

  const mode = config.executionMode ?? 'batch';
  const timeoutMs = (config.timeoutSec ?? 0) > 0 ? Math.round(config.timeoutSec! * 1000) : 0;
  const retryCount = config.retryCount ?? 0;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  const thinkTime = mapThinkTime(config);
  const circuitBreaker = mapCircuitBreaker(config);

  if (mode === 'constant-arrival' && config.arrivalRate) {
    const ar = config.arrivalRate;
    const weightMap = new Map(config.scenarioWeights.map((w) => [w.scenarioId, w.weight]));
    const rustScenarios = scenarios.map((s) => {
      const rs = prepareRustScenario(s);
      rs.weight = weightMap.get(s.id) ?? null;
      return rs;
    });
    return {
      mode: 'constant-arrival',
      scenarios: rustScenarios,
      targetRps: ar.targetRps,
      durationSec: ar.durationSec,
      maxInFlight: ar.maxInFlight ?? Math.ceil(ar.targetRps * 10),
      timeoutMs,
      retryCount,
      retryDelayMs,
      thinkTime,
      circuitBreaker,
      rampConfig: ar.ramp ? {
        startRps: ar.ramp.startRps,
        endRps: ar.ramp.endRps,
        rampDurationSec: ar.ramp.rampDurationSec,
      } : undefined,
      detailLevel: 'sampled',
    };
  }

  if (mode === 'load-profile' && config.loadProfile) {
    const weightMap = new Map(config.scenarioWeights.map((w) => [w.scenarioId, w.weight]));
    const rustScenarios = scenarios.map((s) => {
      const rs = prepareRustScenario(s);
      rs.weight = weightMap.get(s.id) ?? null;
      return rs;
    });
    return {
      mode: 'load-profile',
      scenarios: rustScenarios,
      concurrency: config.loadProfile.maxConcurrency,
      durationSec: config.loadProfile.durationSec,
      timeoutMs,
      retryCount,
      retryDelayMs,
      thinkTime,
      circuitBreaker,
      profileType: config.loadProfile.type,
      rampUpSec: config.loadProfile.rampUpSec ?? null,
      spikeConcurrency: config.loadProfile.spikeConcurrency ?? null,
      spikeStartSec: config.loadProfile.spikeStartSec ?? null,
      spikeDurationSec: config.loadProfile.spikeDurationSec ?? null,
      detailLevel: 'sampled',
    };
  }

  const expandedQueue = buildExpandedQueue(config, scenarios);

  if (mode === 'sequential') {
    return {
      mode: 'sequential',
      scenarios: expandedQueue.map(prepareRustScenario),
      timeoutMs,
      retryCount,
      retryDelayMs,
      thinkTime,
      circuitBreaker,
    };
  }

  // pool and batch both map to pool (batch = pool with same concurrency semantics)
  return {
    mode: 'pool',
    scenarios: expandedQueue.map(prepareRustScenario),
    concurrency: Math.max(1, config.concurrency),
    timeoutMs,
    retryCount,
    retryDelayMs,
    thinkTime,
    circuitBreaker,
  };
}

/**
 * Replicates the allocation → shuffle → expand pipeline from the JS executor.
 */
export function buildExpandedQueue(config: TestConfig, scenarios: Scenario[]): Scenario[] {
  const activeIds = new Set(
    config.scenarioWeights.filter((w: ScenarioWeight) => w.weight > 0).map((w: ScenarioWeight) => w.scenarioId),
  );
  const activeScenarios = activeIds.size > 0
    ? scenarios.filter((s) => activeIds.has(s.id))
    : scenarios;

  const kind = activeScenarios.some((s) => s.dataSource || s.sharedDataSourceId)
    ? ('parameterized' as const)
    : ('standard' as const);

  const allocation = computeAllocation(activeScenarios, config.iterations, kind);

  const queue: Scenario[] = [];
  for (const item of allocation.items) {
    const scenario = activeScenarios.find((s) => s.id === item.testId);
    if (!scenario) continue;
    for (let i = 0; i < item.iterations; i++) queue.push(scenario);
  }

  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  return expandQueue(queue);
}

/* ── Phase 2C: Result mapping + full Rust execution flow ─────────── */

/**
 * Execute a test plan via the Rust executor with streaming progress.
 *
 * Calls buildExecutionPlan(), sends to Rust via startRustLoadTest(), accumulates results
 * across progress batches, runs mapRustResult() on each result (passthrough when Rust
 * validated, JS fallback otherwise), and calls the standard onProgress() callback.
 */
export function runTestViaRust(
  config: TestConfig,
  scenarios: Scenario[],
  onProgress: (completed: number, total: number, results: RequestResult[], meta?: ProgressMeta) => void,
  abortSignal?: AbortSignal,
): Promise<TestResult> {
  const plan = buildExecutionPlan(config, scenarios);
  if (!plan) {
    return Promise.reject(new Error('Cannot build Rust execution plan for this configuration'));
  }

  const isTimeBased = config.executionMode === 'load-profile' || config.executionMode === 'constant-arrival';
  const expandedQueue = isTimeBased ? scenarios : buildExpandedQueue(config, scenarios);
  const scenarioLookup = buildScenarioLookup(scenarios, expandedQueue);
  const allResults: RequestResult[] = [];

  if (abortSignal?.aborted) {
    return Promise.resolve({ results: [] });
  }

  const onAbort = () => {
    abortRustLoadTest().catch(() => {});
  };

  if (abortSignal) {
    abortSignal.addEventListener('abort', onAbort, { once: true });
  }

  return new Promise<TestResult>((resolve, reject) => {
    let unlistenFn: (() => void) | null = null;
    let settled = false;

    const cleanup = () => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const mapAndAppendRustResults = (rustResults: RustExecutionResult[]) => {
      for (const rustResult of rustResults) {
        const scenario = findScenario(scenarioLookup, rustResult);
        if (scenario) {
          allResults.push(mapRustResult(rustResult, scenario));
        } else {
          allResults.push(mapRustResultWithoutValidation(rustResult));
        }
      }
    };

    startRustLoadTest(
      plan,
      (batch: RustProgressBatch) => {
        mapAndAppendRustResults(batch.results);

        const total = isTimeBased ? -1 : plan.scenarios.length;
        const durationMs = config.executionMode === 'constant-arrival' && config.arrivalRate
          ? config.arrivalRate.durationSec * 1000
          : config.executionMode === 'load-profile' && config.loadProfile
            ? config.loadProfile.durationSec * 1000
            : 0;
        const meta: ProgressMeta = {
          elapsedMs: batch.elapsedMs,
          targetConcurrency: batch.targetConcurrency,
          currentInFlight: batch.currentInFlight,
          durationMs,
          metrics: batch.metrics,
          targetRps: batch.targetRps,
          actualRps: batch.actualRps,
          droppedRequests: batch.droppedRequests,
        };
        const completed = Math.max(allResults.length, Number(batch.completed));
        onProgress(completed, total, allResults, meta);
      },
      (_summary: RustCompletionSummary) => {
        settle(() => resolve({ results: allResults }));
      },
      (err: unknown) => {
        settle(() => reject(err instanceof Error ? err : new Error(String(err))));
      },
      (payload: RustFinalResults) => {
        allResults.length = 0;
        mapAndAppendRustResults(payload.results);
      },
    ).then((handle) => {
      unlistenFn = handle.unlisten;
    }).catch((err) => {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}

