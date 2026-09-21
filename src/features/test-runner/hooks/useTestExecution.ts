import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Scenario, TestConfig, RequestResult, TestSummary, TestRun } from '@shared/types';
import type { Workflow } from '@workflow/types/workflow';
import { runTest } from '@engine/core/executor';
import type { ProgressMeta, StreamingMetrics, WorkflowResolverData } from '@engine/core/executor';
import { runTestMultiWorker } from '@engine/core/workerBridge';
import { computeMetrics } from '@engine/core/metrics';
import { saveTestRun, forceSaveTestRun } from '@shared/utils/storage';
import { supportsWorkers } from '@shared/utils/platform';
import { isRustExecutorAvailable, canUseRustExecutor, runTestViaRust } from '../utils/rustBridge';
import { resolveOAuth2ScenariosForRust } from '../utils/resolveOAuth2ForRust';
import { toErrorMessage } from '@shared/utils/helpers';
import { buildKafkaNodeOperations } from '@shared/kafka/buildKafkaNodeOperations';
import { buildWsNodeOperations } from '@shared/websocket/buildWsNodeOperations';
import { buildGrpcNodeOperations } from '@shared/grpc/buildGrpcNodeOperations';
import { resolveGrpcHarnessEnv } from '@shared/grpc/grpcHarnessRuntimeContext';
import type { KafkaResultsPublishConfig } from '@shared/types';
import { publishRunResults } from '@shared/kafka/kafkaResultsPublisher';
import {
  applyApiMockFixtureBaseUrl,
  setupApiMockFixture,
  teardownApiMockFixture,
  type ApiMockFixtureHandle,
  type ApiMockFixtureRunStatus,
  type ApiMockTestFixtureConfig,
} from '../utils/apiMockTestFixture';
import { capResults, ensureChartableTimeSeries } from './useTestExecutionHelpers';

export interface TimeSeriesPoint {
  elapsedSec: number;
  avgResponseTime: number;
  tps: number;
  errorRate: number;
  concurrency: number;
  targetRps?: number;
  actualRps?: number;
}

interface TestExecutionState {
  isRunning: boolean;
  completed: number;
  total: number;
  liveResults: RequestResult[];
  liveSummary: TestSummary | null;
  finalRun: TestRun | null;
  error: string | null;
  pendingRun: TestRun | null;
  profileMeta: ProgressMeta | null;
  timeSeries: TimeSeriesPoint[];
  fixtureStatus: ApiMockFixtureRunStatus | null;
}

const PROGRESS_THROTTLE_MS = 500;
export { ensureChartableTimeSeries };

export function useTestExecution(publishConfig?: KafkaResultsPublishConfig) {
  const publishConfigRef = useRef(publishConfig);
  publishConfigRef.current = publishConfig;

  const [state, setState] = useState<TestExecutionState>({
    isRunning: false,
    completed: 0,
    total: 0,
    liveResults: [],
    liveSummary: null,
    finalRun: null,
    error: null,
    pendingRun: null,
    profileMeta: null,
    timeSeries: [],
    fixtureStatus: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastSnapshotRef = useRef<number>(0);
  const prevCompletedRef = useRef<number>(0);
  const prevSnapshotTimeRef = useRef<number>(0);

  const lastFlushRef = useRef<number>(0);
  const latestStreamingMetricsRef = useRef<StreamingMetrics | undefined>(undefined);
  const pendingUpdateRef = useRef<{
    completed: number;
    total: number;
    allResults: RequestResult[];
    profileMeta?: ProgressMeta;
  } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeSeriesRef = useRef<TimeSeriesPoint[]>([]);
  const incrementalRef = useRef({
    sum: 0,
    min: Infinity,
    max: -Infinity,
    failedRequests: 0,
    failedValidations: 0,
    errorsByStatus: {} as Record<number, number>,
    count: 0,
    times: [] as number[],
  });

  const resetIncrementals = () => {
    incrementalRef.current = {
      sum: 0, min: Infinity, max: -Infinity,
      failedRequests: 0, failedValidations: 0,
      errorsByStatus: {}, count: 0, times: [],
    };
    latestStreamingMetricsRef.current = undefined;
    timeSeriesRef.current = [];
  };

  const computeIncrementalSummary = (elapsedMs: number, streaming?: StreamingMetrics): TestSummary => {
    const inc = incrementalRef.current;
    const n = inc.count;
    if (n === 0) {
      return {
        tps: 0, avgResponseTime: 0, minResponseTime: 0, maxResponseTime: 0,
        p50ResponseTime: 0, p95ResponseTime: 0, p99ResponseTime: 0, p999ResponseTime: 0,
        errorRate: 0, errorsByStatus: {},
        totalRequests: 0, successfulRequests: 0, failedRequests: 0, failedValidations: 0,
        totalDurationMs: Math.round(elapsedMs),
      };
    }

    const errorRate = n > 0 ? (inc.failedRequests / n) * 100 : 0;

    if (streaming) {
      return {
        tps: streaming.tps,
        avgResponseTime: streaming.avg,
        minResponseTime: streaming.min,
        maxResponseTime: streaming.max,
        p50ResponseTime: streaming.p50,
        p95ResponseTime: streaming.p95,
        p99ResponseTime: streaming.p99,
        p999ResponseTime: streaming.p999,
        errorRate: Math.round(errorRate * 100) / 100,
        errorsByStatus: { ...inc.errorsByStatus },
        totalRequests: n,
        successfulRequests: n - inc.failedRequests,
        failedRequests: inc.failedRequests,
        failedValidations: inc.failedValidations,
        totalDurationMs: Math.round(elapsedMs),
      };
    }

    const sorted = [...inc.times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(n * 0.95)] ?? inc.max;
    const p99 = sorted[Math.floor(n * 0.99)] ?? inc.max;
    const p999 = sorted[Math.ceil(n * 0.999) - 1] ?? inc.max;
    const tps = elapsedMs > 0 ? (n / elapsedMs) * 1000 : 0;

    return {
      tps: Math.round(tps * 100) / 100,
      avgResponseTime: Math.round((inc.sum / n) * 100) / 100,
      minResponseTime: Math.round(inc.min * 100) / 100,
      maxResponseTime: Math.round(inc.max * 100) / 100,
      p50ResponseTime: Math.round(sorted[Math.floor(n * 0.5)] * 100) / 100,
      p95ResponseTime: Math.round(p95 * 100) / 100,
      p99ResponseTime: Math.round(p99 * 100) / 100,
      p999ResponseTime: Math.round(p999 * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      errorsByStatus: { ...inc.errorsByStatus },
      totalRequests: n,
      successfulRequests: n - inc.failedRequests,
      failedRequests: inc.failedRequests,
      failedValidations: inc.failedValidations,
      totalDurationMs: Math.round(elapsedMs),
    };
  };

  const trackResult = (r: RequestResult, hasStreamingMetrics?: boolean) => {
    if (r.cancelled) return;
    const inc = incrementalRef.current;
    inc.count++;
    inc.sum += r.responseTimeMs;
    if (r.responseTimeMs < inc.min) inc.min = r.responseTimeMs;
    if (r.responseTimeMs > inc.max) inc.max = r.responseTimeMs;
    if (!hasStreamingMetrics) inc.times.push(r.responseTimeMs);
    const isHttpTransport = (r.transportType ?? 'http') === 'http';
    if (isHttpTransport && (r.httpStatus >= 400 || r.httpStatus === 0)) {
      inc.failedRequests++;
      inc.errorsByStatus[r.httpStatus] = (inc.errorsByStatus[r.httpStatus] || 0) + 1;
    } else if (!isHttpTransport && !r.passed) {
      inc.failedRequests++;
    }
    if (!r.passed && r.failureDetails.length > 0) {
      inc.failedValidations++;
    }
  };

  const flushToState = useCallback(() => {
    const pending = pendingUpdateRef.current;
    if (!pending) return;
    pendingUpdateRef.current = null;

    const now = performance.now();
    const elapsed = now - startTimeRef.current;
    const streaming = pending.profileMeta?.metrics;
    if (streaming) latestStreamingMetricsRef.current = streaming;
    const summary = computeIncrementalSummary(elapsed, streaming);

    const elapsedSec = Math.round(elapsed / 1000);

    if (elapsedSec > lastSnapshotRef.current && pending.allResults.length > 0) {
      const intervalMs = now - prevSnapshotTimeRef.current;
      const intervalCompleted = pending.completed - prevCompletedRef.current;
      const intervalTps = intervalMs > 0 ? (intervalCompleted / intervalMs) * 1000 : 0;

      const recentWindow = pending.allResults.slice(-Math.max(intervalCompleted, 1));
      const avgRecent = recentWindow.reduce((s, r) => s + r.responseTimeMs, 0) / recentWindow.length;

      const activeInWindow = recentWindow.filter(r => !r.cancelled);
      const failedInWindow = activeInWindow.filter(r => {
        const isHttp = (r.transportType ?? 'http') === 'http';
        return isHttp ? (r.httpStatus >= 400 || r.httpStatus === 0) : !r.passed;
      }).length;
      const errorPct = activeInWindow.length > 0 ? (failedInWindow / activeInWindow.length) * 100 : 0;

      const point: TimeSeriesPoint = {
        elapsedSec,
        avgResponseTime: Math.round(avgRecent * 10) / 10,
        tps: Math.round(intervalTps * 10) / 10,
        errorRate: Math.round(errorPct * 10) / 10,
        concurrency: pending.profileMeta
          ? (pending.total === -1
              ? pending.profileMeta.currentInFlight
              : pending.profileMeta.targetConcurrency)
          : 0,
        ...(pending.profileMeta?.targetRps !== undefined ? { targetRps: Math.round(pending.profileMeta.targetRps * 10) / 10 } : {}),
        ...(pending.profileMeta?.actualRps !== undefined ? { actualRps: Math.round(pending.profileMeta.actualRps * 10) / 10 } : {}),
      };

      lastSnapshotRef.current = elapsedSec;
      prevCompletedRef.current = pending.completed;
      prevSnapshotTimeRef.current = now;

      timeSeriesRef.current = [...timeSeriesRef.current, point];
    }

    setState((prev) => ({
      ...prev,
      completed: pending.completed,
      total: pending.total,
      liveResults: capResults(pending.allResults),
      liveSummary: {
        ...summary,
        avgIterationTime: pending.profileMeta?.avgIterationTimeMs ?? prev.liveSummary?.avgIterationTime ?? summary.avgIterationTime,
      },
      profileMeta: pending.profileMeta ?? prev.profileMeta,
      timeSeries: timeSeriesRef.current,
    }));
    lastFlushRef.current = now;
  }, []);

  const execute = useCallback(async (config: TestConfig, scenarios: Scenario[], meta?: {
    projectName?: string;
    envName?: string;
    svcName?: string;
    baseUrl?: string;
    grpcHarnessEnv?: Record<string, string>;
    apiMockFixture?: ApiMockTestFixtureConfig;
  }, workflow?: Workflow, resolveSubWorkflow?: (id: string) => Workflow | undefined, workflowResolverData?: WorkflowResolverData) => {
    abortRef.current = new AbortController();
    startTimeRef.current = performance.now();
    lastSnapshotRef.current = 0;
    prevCompletedRef.current = 0;
    prevSnapshotTimeRef.current = performance.now();
    lastFlushRef.current = 0;
    pendingUpdateRef.current = null;
    resetIncrementals();

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    setState({
      isRunning: true,
      completed: 0,
      total: (config.executionMode === 'load-profile' || config.executionMode === 'constant-arrival') ? -1 : config.iterations,
      liveResults: [],
      liveSummary: null,
      finalRun: null,
      error: null,
      pendingRun: null,
      profileMeta: null,
      timeSeries: [],
      fixtureStatus: meta?.apiMockFixture?.enabled ? { phase: 'starting' } : null,
    });

    let lastTrackedCount = 0;
    const useWorker = supportsWorkers() && !resolveSubWorkflow;

    const onProgress = (completed: number, total: number, allResults: RequestResult[], profileMeta?: ProgressMeta) => {
      const hasStreaming = !!profileMeta?.metrics;
      for (let i = lastTrackedCount; i < allResults.length; i++) {
        trackResult(allResults[i], hasStreaming);
      }
      lastTrackedCount = allResults.length;

      pendingUpdateRef.current = { completed, total, allResults, profileMeta };

      const now = performance.now();
      const sinceLast = now - lastFlushRef.current;

      if (sinceLast >= PROGRESS_THROTTLE_MS) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushToState();
      } else if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushToState();
        }, PROGRESS_THROTTLE_MS - sinceLast);
      }
    };

    let peakRps = 0;
    let lastDroppedRequests = 0;
    const isConstantArrival = config.executionMode === 'constant-arrival';
    const fixtureConfig = meta?.apiMockFixture;
    let fixtureHandle: ApiMockFixtureHandle | undefined;
    let runBaseUrl = meta?.baseUrl;
    let scenariosToRun = scenarios;

    try {
      if (fixtureConfig?.enabled) {
        const runId = uuidv4();
        const setup = await setupApiMockFixture(fixtureConfig, runId);
        if (!setup.ok) {
          throw new Error(`API Mock fixture failed: ${setup.error}`);
        }
        fixtureHandle = setup.handle;
        setState((prev) => ({
          ...prev,
          fixtureStatus: { phase: 'running', port: setup.handle.port, serverId: setup.handle.serverId },
        }));
        runBaseUrl = `http://127.0.0.1:${setup.handle.port}`;
        scenariosToRun = applyApiMockFixtureBaseUrl(scenarios, runBaseUrl);
      }

      // Rust cannot acquire OAuth2 tokens. For CAR (Rust-only) preload them as bearer.
      const rustScenarios = isConstantArrival
        ? await resolveOAuth2ScenariosForRust(scenariosToRun)
        : scenariosToRun;

      const useRust = !workflow && !resolveSubWorkflow
        && canUseRustExecutor(config, rustScenarios)
        && await isRustExecutorAvailable();

      if (isConstantArrival && !useRust) {
        const isTauriEnv = typeof window !== 'undefined' && '__TAURI__' in window;
        const reason = !isTauriEnv
          ? 'Constant Arrival Rate requires the desktop app (Tauri)'
          : 'Constant Arrival Rate requires the Rust executor';
        throw new Error(reason);
      }

      const wrappedOnProgress = isConstantArrival
        ? (completed: number, total: number, allResults: RequestResult[], profileMeta?: ProgressMeta) => {
            if (profileMeta?.actualRps != null) {
              peakRps = Math.max(peakRps, profileMeta.actualRps);
            }
            if (profileMeta?.droppedRequests != null) {
              lastDroppedRequests = profileMeta.droppedRequests;
            }
            onProgress(completed, total, allResults, profileMeta);
          }
        : onProgress;

      let testResult;
      // Build Kafka operations for both workflow-mode and harness-mode Kafka scenarios.
      const kafkaOps = buildKafkaNodeOperations();
      const wsOps = buildWsNodeOperations();
      const grpcOps = buildGrpcNodeOperations();
      const grpcHarnessEnv = resolveGrpcHarnessEnv({
        grpcHarnessEnv: meta?.grpcHarnessEnv,
        microservices: workflowResolverData?.microservices,
        svcId: workflowResolverData?.selectedSvcId,
        envId: workflowResolverData?.selectedEnvId,
        envName: meta?.envName,
      });
      if (useRust) {
        testResult = await runTestViaRust(config, rustScenarios, wrappedOnProgress, abortRef.current.signal);
      } else if (useWorker) {
        try {
          testResult = await runTestMultiWorker(config, scenariosToRun, wrappedOnProgress, abortRef.current.signal, workflow, grpcHarnessEnv);
        } catch (workerErr) {
          // Worker failed (common in Tauri WebView) — fall back to direct execution
          console.warn('Worker execution failed, falling back to direct execution:', workerErr);
          testResult = await runTest(config, scenariosToRun, wrappedOnProgress, abortRef.current.signal, workflow, resolveSubWorkflow, undefined, workflowResolverData, kafkaOps, wsOps, grpcOps, grpcHarnessEnv);
        }
      } else {
        testResult = await runTest(config, scenariosToRun, wrappedOnProgress, abortRef.current.signal, workflow, resolveSubWorkflow, undefined, workflowResolverData, kafkaOps, wsOps, grpcOps, grpcHarnessEnv);
      }

      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushToState();

      const totalDuration = performance.now() - startTimeRef.current;
      const summary = computeMetrics(testResult.results, totalDuration);

      const finalStreaming = latestStreamingMetricsRef.current;
      if (finalStreaming) {
        summary.p50ResponseTime = finalStreaming.p50;
        summary.p95ResponseTime = finalStreaming.p95;
        summary.p99ResponseTime = finalStreaming.p99;
        summary.p999ResponseTime = finalStreaming.p999;
        summary.minResponseTime = finalStreaming.min;
        summary.maxResponseTime = finalStreaming.max;
        summary.avgResponseTime = finalStreaming.avg;
        summary.tps = finalStreaming.tps;
      }

      if (isConstantArrival) {
        summary.droppedRequests = lastDroppedRequests;
        summary.peakRps = Math.round(peakRps * 100) / 100;
        summary.targetRps = config.arrivalRate?.targetRps;
      }

      if (testResult.trace && testResult.trace.iterations.length > 0) {
        const iterationDurations = testResult.trace.iterations.map((iter: { durationMs: number }) => iter.durationMs);
        summary.avgIterationTime = Math.round(
          iterationDurations.reduce((a: number, b: number) => a + b, 0) / iterationDurations.length * 100
        ) / 100;
      }

      const testRun: TestRun = {
        id: uuidv4(),
        timestamp: Date.now(),
        config,
        summary,
        results: testResult.results,
        projectName: meta?.projectName,
        envName: meta?.envName,
        svcName: meta?.svcName,
        baseUrl: runBaseUrl,
        workflowName: workflow?.name,
        executionTrace: testResult.trace, // Phase 7e: Store execution trace
      };

      const saveResult = await saveTestRun(testRun);

      if (!saveResult.quotaError && publishConfigRef.current?.enabled) {
        void publishRunResults(testRun, publishConfigRef.current).then((outcome) => {
          if (outcome.status === 'failed') {
            console.warn('[RedfireForge] Kafka results publish failed', outcome);
          }
        });
      }

      const wasAborted = abortRef.current?.signal.aborted ?? false;
      const activeResults = testResult.results.filter(r => !r.cancelled);
      const finalCompleted = wasAborted
        ? activeResults.length
        : (config.executionMode === 'workflow' ? (config.iterations || 1) : testResult.results.length);
      const finalTotal = wasAborted
        ? (config.executionMode === 'workflow' ? (config.iterations || 1) : testResult.results.length)
        : finalCompleted;

      if (saveResult.quotaError) {
        timeSeriesRef.current = ensureChartableTimeSeries(
          timeSeriesRef.current,
          summary,
          summary.totalDurationMs,
        );
        setState((prev) => ({
          ...prev,
          isRunning: false,
          completed: finalCompleted,
          total: finalTotal,
          pendingRun: testRun,
          liveSummary: summary,
          liveResults: capResults(testResult.results),
          timeSeries: timeSeriesRef.current,
        }));
      } else {
        timeSeriesRef.current = ensureChartableTimeSeries(
          timeSeriesRef.current,
          summary,
          summary.totalDurationMs,
        );
        setState((prev) => ({
          ...prev,
          isRunning: false,
          completed: finalCompleted,
          total: finalTotal,
          finalRun: testRun,
          liveSummary: summary,
          liveResults: capResults(testResult.results),
          pendingRun: null,
          timeSeries: timeSeriesRef.current,
        }));
      }
    } catch (err) {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setState((prev) => ({
        ...prev,
        isRunning: false,
        error: toErrorMessage(err),
        fixtureStatus: fixtureHandle ? prev.fixtureStatus : null,
      }));
    } finally {
      const stoppedPort = fixtureHandle?.port;
      const stoppedServerId = fixtureHandle?.serverId;
      const leaveStudioServer = fixtureConfig?.isolateRun === false && fixtureHandle?.restoreRunning;
      await teardownApiMockFixture(fixtureHandle, fixtureConfig).catch(() => { /* best-effort */ });
      if (stoppedPort != null && !leaveStudioServer) {
        setState((prev) => ({
          ...prev,
          fixtureStatus: { phase: 'stopped', port: stoppedPort, serverId: stoppedServerId },
        }));
      }
    }
  }, [flushToState]);

  const confirmSavePendingRun = useCallback(async () => {
    const pending = state.pendingRun;
    if (!pending) return;
    const result = await forceSaveTestRun(pending);
    if (result.ok) {
      if (publishConfigRef.current?.enabled) {
        void publishRunResults(pending, publishConfigRef.current).then((outcome) => {
          if (outcome.status === 'failed') {
            console.warn('[RedfireForge] Kafka results publish failed (confirmSave)', outcome);
          }
        });
      }
      setState((prev) => ({ ...prev, finalRun: prev.pendingRun, pendingRun: null }));
    } else {
      setState((prev) => ({ ...prev, error: 'Storage is full. Please clear data manually in Settings → Storage.', pendingRun: null }));
    }
  }, [state.pendingRun]);

  const dismissPendingRun = useCallback(() => {
    setState((prev) => ({ ...prev, pendingRun: null }));
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Start tracking progress for an external execution (e.g., webhook load driver).
   * Returns callbacks to report progress and completion.
   */
  const startExternalExecution = useCallback((total: number, meta?: { projectName?: string }) => {
    abortRef.current = new AbortController();
    startTimeRef.current = performance.now();
    lastSnapshotRef.current = 0;
    prevCompletedRef.current = 0;
    prevSnapshotTimeRef.current = performance.now();
    lastFlushRef.current = 0;
    pendingUpdateRef.current = null;
    resetIncrementals();

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    setState({
      isRunning: true,
      completed: 0,
      total,
      liveResults: [],
      liveSummary: null,
      finalRun: null,
      error: null,
      pendingRun: null,
      profileMeta: null,
      timeSeries: [],
      fixtureStatus: null,
    });

    let lastTrackedCount = 0;
    const allResults: RequestResult[] = [];

    const reportProgress = (results: RequestResult[], completed: number) => {
      // Add new results
      for (const r of results) {
        if (!allResults.find(existing => existing.id === r.id)) {
          allResults.push(r);
        }
      }

      // Track metrics for new results
      for (let i = lastTrackedCount; i < allResults.length; i++) {
        trackResult(allResults[i]);
      }
      lastTrackedCount = allResults.length;

      const profileMeta: ProgressMeta = {
        elapsedMs: performance.now() - startTimeRef.current,
        targetConcurrency: 1,
        currentInFlight: 0,
        durationMs: 0,
      };

      pendingUpdateRef.current = { completed, total, allResults, profileMeta };

      const now = performance.now();
      const sinceLast = now - lastFlushRef.current;

      if (sinceLast >= PROGRESS_THROTTLE_MS) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushToState();
      } else if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushToState();
        }, PROGRESS_THROTTLE_MS - sinceLast);
      }
    };

    const complete = async (config: TestConfig, executionTrace?: import('../../../shared/types').WorkflowExecutionTrace) => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      const totalDuration = performance.now() - startTimeRef.current;
      const summary = computeMetrics(allResults, totalDuration);
      
      // Calculate avgIterationTime from trace for workflow runs (reuse existing pattern)
      if (executionTrace && executionTrace.iterations.length > 0) {
        const iterationDurations = executionTrace.iterations.map(iter => iter.durationMs);
        summary.avgIterationTime = Math.round(
          iterationDurations.reduce((a, b) => a + b, 0) / iterationDurations.length * 100
        ) / 100;
      }

      const testRun: TestRun = {
        id: uuidv4(),
        timestamp: Date.now(),
        config,
        summary,
        results: allResults,
        projectName: meta?.projectName,
        executionTrace, // Include execution trace for Results Explorer
      };

      const saveResult = await saveTestRun(testRun);

      if (!saveResult.quotaError && publishConfigRef.current?.enabled) {
        void publishRunResults(testRun, publishConfigRef.current).then((outcome) => {
          if (outcome.status === 'failed') {
            console.warn('[RedfireForge] Kafka results publish failed (externalExec)', outcome);
          }
        });
      }

      if (saveResult.quotaError) {
        timeSeriesRef.current = ensureChartableTimeSeries(
          timeSeriesRef.current,
          summary,
          summary.totalDurationMs,
        );
        setState((prev) => ({
          ...prev,
          isRunning: false,
          completed: allResults.length,
          total: allResults.length,
          pendingRun: testRun,
          liveSummary: summary,
          liveResults: capResults(allResults),
          timeSeries: timeSeriesRef.current,
        }));
      } else {
        timeSeriesRef.current = ensureChartableTimeSeries(
          timeSeriesRef.current,
          summary,
          summary.totalDurationMs,
        );
        setState((prev) => ({
          ...prev,
          isRunning: false,
          completed: allResults.length,
          total: allResults.length,
          finalRun: testRun,
          liveSummary: summary,
          liveResults: capResults(allResults),
          pendingRun: null,
          timeSeries: timeSeriesRef.current,
        }));
      }
    };

    const fail = (error: string) => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setState((prev) => ({
        ...prev,
        isRunning: false,
        error,
      }));
    };

    return {
      reportProgress,
      complete,
      fail,
      abortSignal: abortRef.current.signal,
    };
  }, [flushToState]);

  return { ...state, execute, abort, confirmSavePendingRun, dismissPendingRun, startExternalExecution };
}
