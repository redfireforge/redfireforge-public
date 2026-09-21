/**
 * @vitest-environment jsdom
 */
import {
  createMockScenario,
  createMockConfig,
  createMockResult,
  createMockSummary,
  registerUseTestExecutionTestLifecycle,
  mockRunTest,
  mockRunTestInWorker,
  mockRunTestViaRust,
  mockSupportsWorkers,
  mockCanUseRust,
  mockIsRustAvailable,
  mockComputeMetrics,
  mockSaveTestRun,
  mockResolveOAuth2ForRust,
} from './__test-utils__/useTestExecutionTestSetup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTestExecution } from './useTestExecution';
import { TestConfig } from '@shared/types';

vi.mock('@engine/core/executor', async () => {
  const { mockRunTest } = await import('./__test-utils__/useTestExecutionTestSetup');
  return { runTest: mockRunTest };
});
vi.mock('@engine/core/workerBridge', async () => {
  const { mockRunTestInWorker } = await import('./__test-utils__/useTestExecutionTestSetup');
  return { runTestMultiWorker: mockRunTestInWorker };
});
vi.mock('@engine/core/metrics', async () => {
  const { mockComputeMetrics } = await import('./__test-utils__/useTestExecutionTestSetup');
  return { computeMetrics: mockComputeMetrics };
});
vi.mock('@shared/utils/storage', async () => {
  const { mockSaveTestRun, mockForceSaveTestRun } = await import(
    './__test-utils__/useTestExecutionTestSetup'
  );
  return { saveTestRun: mockSaveTestRun, forceSaveTestRun: mockForceSaveTestRun };
});
vi.mock('@shared/utils/platform', async () => {
  const { mockSupportsWorkers } = await import('./__test-utils__/useTestExecutionTestSetup');
  return { supportsWorkers: mockSupportsWorkers, isTauri: vi.fn(() => false) };
});
vi.mock('../utils/rustBridge', async () => {
  const { mockIsRustAvailable, mockCanUseRust, mockRunTestViaRust } = await import(
    './__test-utils__/useTestExecutionTestSetup'
  );
  return {
    isRustExecutorAvailable: mockIsRustAvailable,
    canUseRustExecutor: mockCanUseRust,
    runTestViaRust: mockRunTestViaRust,
  };
});
vi.mock('../utils/resolveOAuth2ForRust', async () => {
  const { mockResolveOAuth2ForRust } = await import(
    './__test-utils__/useTestExecutionTestSetup'
  );
  return { resolveOAuth2ScenariosForRust: mockResolveOAuth2ForRust };
});
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

const mockSetupApiMockFixture = vi.fn();
const mockTeardownApiMockFixture = vi.fn();
const mockApplyApiMockFixtureBaseUrl = vi.fn((scenarios: unknown[]) => scenarios);

vi.mock('../utils/apiMockTestFixture', () => ({
  setupApiMockFixture: (...args: unknown[]) => mockSetupApiMockFixture(...args),
  teardownApiMockFixture: (...args: unknown[]) => mockTeardownApiMockFixture(...args),
  applyApiMockFixtureBaseUrl: (...args: unknown[]) => mockApplyApiMockFixtureBaseUrl(...args),
}));

describe('useTestExecution - Execute', () => {
  registerUseTestExecutionTestLifecycle();

  beforeEach(() => {
    mockSetupApiMockFixture.mockResolvedValue({
      ok: true,
      handle: { port: 4010, serverId: 'mock-1', generation: 1, restoreRunning: false, stop: vi.fn() },
    });
    mockTeardownApiMockFixture.mockResolvedValue(undefined);
    mockApplyApiMockFixtureBaseUrl.mockImplementation((scenarios: unknown[]) => scenarios);
  });

  it('sets isRunning to true during execution', async () => {
    const results = [createMockResult()];
    mockRunTest.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { results };
    });

    const { result } = renderHook(() => useTestExecution());

    act(() => {
      result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });
  });

  it('uses runTestMultiWorker when workers are supported', async () => {
    mockSupportsWorkers.mockReturnValue(true);
    mockRunTestInWorker.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(mockRunTestInWorker).toHaveBeenCalled();
    expect(mockRunTest).not.toHaveBeenCalled();
  });

  it('uses runTest instead of worker when resolveSubWorkflow is provided even if workers supported', async () => {
    mockSupportsWorkers.mockReturnValue(true);
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const workflow = {
      id: 'wf-resolve',
      name: 'Resolvable Workflow',
      nodes: [],
      edges: [],
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const resolveSubWorkflow = vi.fn((_id: string) => workflow);

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(
        createMockConfig(),
        [createMockScenario()],
        undefined,
        workflow,
        resolveSubWorkflow,
      );
    });

    expect(mockRunTest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      expect.anything(),
      workflow,
      resolveSubWorkflow,
      undefined,
      undefined,
      expect.objectContaining({ consume: expect.any(Function), produce: expect.any(Function) }),
      expect.objectContaining({ connect: expect.any(Function), send: expect.any(Function) }),
      expect.objectContaining({ invokeUnary: expect.any(Function), collectServerStream: expect.any(Function) }),
      {},
    );
    expect(mockRunTestInWorker).not.toHaveBeenCalled();
  });

  it('uses runTestViaRust when Rust executor is available', async () => {
    mockCanUseRust.mockReturnValue(true);
    mockIsRustAvailable.mockResolvedValue(true);
    mockRunTestViaRust.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(mockRunTestViaRust).toHaveBeenCalled();
    expect(mockRunTest).not.toHaveBeenCalled();
    expect(mockRunTestInWorker).not.toHaveBeenCalled();
  });

  it('uses streaming metrics from Rust for live summary (O(1) bypass)', async () => {
    mockCanUseRust.mockReturnValue(true);
    mockIsRustAvailable.mockResolvedValue(true);
    const mockResult = createMockResult({ responseTimeMs: 150 });
    mockRunTestViaRust.mockImplementation((_config, _scenarios, onProgress) => {
      onProgress(1, 1, [mockResult], {
        elapsedMs: 500,
        targetConcurrency: 1,
        currentInFlight: 0,
        durationMs: 0,
        metrics: {
          p50: 120, p95: 180, p99: 195, p999: 199,
          min: 50, max: 200, avg: 130, total: 1, errors: 0, tps: 2.0,
        },
      });
      return Promise.resolve({ results: [mockResult] });
    });
    mockComputeMetrics.mockReturnValue(createMockSummary());

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    const final_ = result.current.finalRun;
    expect(final_).toBeTruthy();
    expect(final_!.summary.p50ResponseTime).toBe(120);
    expect(final_!.summary.p95ResponseTime).toBe(180);
    expect(final_!.summary.p99ResponseTime).toBe(195);
    expect(final_!.summary.p999ResponseTime).toBe(199);
    expect(final_!.summary.minResponseTime).toBe(50);
    expect(final_!.summary.maxResponseTime).toBe(200);
    expect(final_!.summary.avgResponseTime).toBe(130);
    expect(final_!.summary.tps).toBe(2.0);
  });

  it('uses runTest when workers are not supported', async () => {
    mockSupportsWorkers.mockReturnValue(false);
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(mockRunTest).toHaveBeenCalled();
    expect(mockRunTestInWorker).not.toHaveBeenCalled();
  });

  it('passes config and scenarios to runTest', async () => {
    const config = createMockConfig();
    const scenarios = [createMockScenario()];
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, scenarios);
    });

    expect(mockRunTest).toHaveBeenCalledWith(
      config,
      scenarios,
      expect.any(Function),
      expect.anything(),
      undefined,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ produce: expect.any(Function), consume: expect.any(Function) }),
      expect.objectContaining({ connect: expect.any(Function), send: expect.any(Function) }),
      expect.objectContaining({ invokeUnary: expect.any(Function), collectServerStream: expect.any(Function) }),
      {},
    );
  });

  it('passes workflow to runTest when provided', async () => {
    const config = createMockConfig();
    const scenarios = [createMockScenario()];
    const workflow = {
      id: 'wf-1',
      name: 'Test Workflow',
      nodes: [],
      edges: [],
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, scenarios, undefined, workflow);
    });

    expect(mockRunTest).toHaveBeenCalledWith(
      config,
      scenarios,
      expect.any(Function),
      expect.anything(),
      workflow,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ consume: expect.any(Function), produce: expect.any(Function) }),
      expect.objectContaining({ connect: expect.any(Function), send: expect.any(Function) }),
      expect.objectContaining({ invokeUnary: expect.any(Function), collectServerStream: expect.any(Function) }),
      {},
    );
  });

  it('saves test run on completion', async () => {
    const results = [createMockResult()];
    mockRunTest.mockResolvedValue({ results });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(mockSaveTestRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-uuid',
        results,
      })
    );
  });

  it('includes metadata in saved test run', async () => {
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()], {
        projectName: 'My Project',
        envName: 'Production',
        svcName: 'API Service',
        baseUrl: 'https://api.example.com',
      });
    });

    expect(mockSaveTestRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'My Project',
        envName: 'Production',
        svcName: 'API Service',
        baseUrl: 'https://api.example.com',
      })
    );
  });

  it('sets finalRun on successful completion', async () => {
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.finalRun).not.toBeNull();
    expect(result.current.finalRun?.id).toBe('test-uuid');
  });

  it('uses workflow iterations for completed and total counters', async () => {
    mockSupportsWorkers.mockReturnValue(false);
    const workflowConfig = {
      ...createMockConfig(),
      executionMode: 'workflow' as const,
      iterations: 4,
    };
    mockRunTest.mockResolvedValue({ results: [createMockResult({ id: 'w1' })] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(workflowConfig, [createMockScenario()]);
    });

    expect(result.current.completed).toBe(4);
    expect(result.current.total).toBe(4);
  });

  it('defaults workflow completed total to 1 when iterations omitted at runtime', async () => {
    mockSupportsWorkers.mockReturnValue(false);
    mockRunTest.mockResolvedValue({ results: [createMockResult({ id: 'w3' })] });

    const { result } = renderHook(() => useTestExecution());

    const wfCfg = {
      ...createMockConfig(),
      executionMode: 'workflow' as const,
    };
    Reflect.deleteProperty(wfCfg, 'iterations');

    await act(async () => {
      await result.current.execute(wfCfg as TestConfig, [createMockScenario()]);
    });

    expect(result.current.completed).toBe(1);
    expect(result.current.total).toBe(1);
  });

  it('defaults workflow counters to 1 when iterations property is explicitly zero', async () => {
    mockSupportsWorkers.mockReturnValue(false);
    const wfZeroIter = {
      ...createMockConfig(),
      executionMode: 'workflow' as const,
      iterations: 0,
    };
    mockRunTest.mockResolvedValue({ results: [createMockResult({ id: 'w0' })] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(wfZeroIter, [createMockScenario()]);
    });

    expect(result.current.completed).toBe(1);
    expect(result.current.total).toBe(1);
  });

  it('reflects quota error using workflow iterations for totals', async () => {
    mockSupportsWorkers.mockReturnValue(false);
    const wf = {
      ...createMockConfig(),
      executionMode: 'workflow' as const,
      iterations: 9,
    };
    mockRunTest.mockResolvedValue({ results: [createMockResult({ id: 'q1' })] });
    mockSaveTestRun.mockResolvedValue({ ok: false, quotaError: true });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(wf, [createMockScenario()]);
    });

    expect(result.current.completed).toBe(9);
    expect(result.current.total).toBe(9);
    expect(result.current.pendingRun).not.toBeNull();
  });

  it('sets pendingRun on quota error', async () => {
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });
    mockSaveTestRun.mockResolvedValue({ ok: false, quotaError: true });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.finalRun).toBeNull();
    expect(result.current.pendingRun).not.toBeNull();
  });

  it('sets error state on exception', async () => {
    mockRunTest.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBe('Network failure');
  });

  it('clears pending throttle timer when execute throws after progress scheduled deferred flush', async () => {
    mockRunTest.mockImplementation(async (_config, _scenarios, onProgress) => {
      // lastFlushRef is 0: small sinceLast schedules setTimeout flush, no immediate flush
      onProgress(1, 10, [createMockResult({ id: 'p1' })]);
      throw new Error('aborted after throttle schedule');
    });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.error).toBe('aborted after throttle schedule');
    expect(result.current.isRunning).toBe(false);
  });

  it('falls back to direct execution when worker path throws after deferred flush was scheduled', async () => {
    mockSupportsWorkers.mockReturnValue(true);
    mockRunTestInWorker.mockRejectedValue(new Error('worker failed after schedule'));
    mockRunTest.mockImplementation(async (_config, _scenarios, onProgress) => {
      onProgress(1, 1, [createMockResult({ id: 'fallback-1' })]);
      return { results: [createMockResult({ id: 'fallback-1' })] };
    });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.finalRun).not.toBeNull();
  });

  it('clears pending throttle timer when runTest resolves before deferred flush fires', async () => {
    mockRunTest.mockImplementation(async (_config, _scenarios, onProgress) => {
      onProgress(1, 10, [createMockResult({ id: 'resolved-1' })]);
      return { results: [createMockResult({ id: 'final-1' })] };
    });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.finalRun).not.toBeNull();
  });

  it('clears pending throttle timer when runTestMultiWorker resolves before deferred flush fires', async () => {
    mockSupportsWorkers.mockReturnValue(true);
    mockRunTestInWorker.mockImplementation(async (_config, _scenarios, onProgress) => {
      onProgress(1, 10, [createMockResult({ id: 'wr-1' })]);
      return { results: [createMockResult({ id: 'wr-final' })] };
    });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()]);
    });

    expect(result.current.finalRun).not.toBeNull();
  });

  it('sets total to -1 for load-profile mode', async () => {
    const config = { ...createMockConfig(), executionMode: 'load-profile' as const };
    mockRunTest.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { results: [] };
    });

    const { result } = renderHook(() => useTestExecution());

    act(() => {
      result.current.execute(config, [createMockScenario()]);
    });

    expect(result.current.total).toBe(-1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  });

  it('sets total to results count after load-profile run completes', async () => {
    const config = { ...createMockConfig(), executionMode: 'load-profile' as const };
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, [createMockScenario()]);
    });

    expect(result.current.total).toBe(1);
    expect(result.current.completed).toBe(1);
  });

  it('sets total to results count on load-profile quota error', async () => {
    const config = { ...createMockConfig(), executionMode: 'load-profile' as const };
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });
    mockSaveTestRun.mockResolvedValue({ ok: false, quotaError: true });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, [createMockScenario()]);
    });

    expect(result.current.total).toBe(1);
    expect(result.current.pendingRun).not.toBeNull();
  });

  it('sets total to -1 for constant-arrival mode', async () => {
    const config = {
      ...createMockConfig(),
      executionMode: 'constant-arrival' as const,
      arrivalRate: { targetRps: 50, durationSec: 30 },
    };
    mockCanUseRust.mockReturnValue(true);
    mockIsRustAvailable.mockResolvedValue(true);
    mockRunTestViaRust.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { results: [] };
    });

    const { result } = renderHook(() => useTestExecution());

    act(() => {
      result.current.execute(config, [createMockScenario()]);
    });

    expect(result.current.total).toBe(-1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  });

  it('errors when constant-arrival mode without Rust executor', async () => {
    const config = {
      ...createMockConfig(),
      executionMode: 'constant-arrival' as const,
      arrivalRate: { targetRps: 50, durationSec: 30 },
    };
    mockCanUseRust.mockReturnValue(true);
    mockIsRustAvailable.mockResolvedValue(false);

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, [createMockScenario()]);
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBe('Constant Arrival Rate requires the desktop app (Tauri)');
  });

  it('tracks peak RPS and dropped requests for constant-arrival via Rust progress', async () => {
    const config = {
      ...createMockConfig(),
      executionMode: 'constant-arrival' as const,
      arrivalRate: { targetRps: 50, durationSec: 30 },
    };
    mockCanUseRust.mockReturnValue(true);
    mockIsRustAvailable.mockResolvedValue(true);
    const mockResult = createMockResult();
    mockRunTestViaRust.mockImplementation((_config, _scenarios, onProgress) => {
      onProgress(0, -1, [], {
        elapsedMs: 100,
        targetConcurrency: 1,
        currentInFlight: 0,
        durationMs: 0,
      });
      onProgress(0, -1, [], {
        elapsedMs: 150,
        targetConcurrency: 1,
        currentInFlight: 0,
        durationMs: 0,
        actualRps: 40,
      });
      onProgress(0, -1, [], {
        elapsedMs: 175,
        targetConcurrency: 1,
        currentInFlight: 0,
        durationMs: 0,
        droppedRequests: 2,
      });
      onProgress(1, -1, [mockResult], {
        elapsedMs: 200,
        targetConcurrency: 1,
        currentInFlight: 0,
        durationMs: 0,
        actualRps: 55,
        droppedRequests: 7,
      });
      return Promise.resolve({ results: [mockResult] });
    });
    mockComputeMetrics.mockReturnValue(createMockSummary());

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, [createMockScenario()]);
    });

    expect(result.current.finalRun?.summary.peakRps).toBe(55);
    expect(result.current.finalRun?.summary.droppedRequests).toBe(7);
    expect(result.current.finalRun?.summary.targetRps).toBe(50);
  });

  it('applies api mock fixture base url override when enabled', async () => {
    const scenarios = [createMockScenario('sc-fixture')];
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });
    mockApplyApiMockFixtureBaseUrl.mockReturnValue([createMockScenario('sc-overridden')]);

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), scenarios, {
        apiMockFixture: { enabled: true, serverId: 'mock-1', overrideBaseUrl: true },
      });
    });

    expect(mockSetupApiMockFixture).toHaveBeenCalled();
    expect(mockApplyApiMockFixtureBaseUrl).toHaveBeenCalledWith(scenarios, 'http://127.0.0.1:4010');
    expect(mockTeardownApiMockFixture).toHaveBeenCalled();
    expect(result.current.finalRun).not.toBeNull();
    expect(result.current.fixtureStatus).toEqual({
      phase: 'stopped',
      port: 4010,
      serverId: 'mock-1',
    });
  });

  it('does not mark the fixture stopped when isolate is off and Studio was already running', async () => {
    mockSetupApiMockFixture.mockResolvedValueOnce({
      ok: true,
      handle: { port: 4010, serverId: 'mock-1', generation: 1, restoreRunning: true },
    });
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()], {
        apiMockFixture: { enabled: true, serverId: 'mock-1', isolateRun: false },
      });
    });

    expect(mockTeardownApiMockFixture).toHaveBeenCalled();
    expect(result.current.fixtureStatus).toEqual({
      phase: 'running',
      port: 4010,
      serverId: 'mock-1',
    });
  });

  it('marks the fixture stopped when isolate is off and Studio was down before the run', async () => {
    mockSetupApiMockFixture.mockResolvedValueOnce({
      ok: true,
      handle: { port: 4010, serverId: 'mock-1', generation: 1, restoreRunning: false },
    });
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()], {
        apiMockFixture: { enabled: true, serverId: 'mock-1', isolateRun: false },
      });
    });

    expect(result.current.fixtureStatus).toEqual({
      phase: 'stopped',
      port: 4010,
      serverId: 'mock-1',
    });
  });

  it('rewrites scenario URLs to the mock even if a persisted fixture opted out', async () => {
    mockRunTest.mockResolvedValue({ results: [createMockResult()] });
    const scenarios = [createMockScenario()];
    mockApplyApiMockFixtureBaseUrl.mockReturnValue([createMockScenario('sc-overridden')]);

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), scenarios, {
        baseUrl: 'http://original.test',
        apiMockFixture: { enabled: true, serverId: 'mock-1', overrideBaseUrl: false },
      });
    });

    expect(mockApplyApiMockFixtureBaseUrl).toHaveBeenCalledWith(scenarios, 'http://127.0.0.1:4010');
    expect(mockSetupApiMockFixture).toHaveBeenCalled();
    expect(result.current.finalRun?.baseUrl).toBe('http://127.0.0.1:4010');
  });

  it('surfaces api mock fixture setup failure as execution error', async () => {
    mockSetupApiMockFixture.mockResolvedValueOnce({ ok: false, error: 'port busy' });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(createMockConfig(), [createMockScenario()], {
        apiMockFixture: { enabled: true, serverId: 'mock-1' },
      });
    });

    expect(result.current.error).toBe('API Mock fixture failed: port busy');
    expect(result.current.isRunning).toBe(false);
    expect(mockRunTest).not.toHaveBeenCalled();
  });

  it('uses rust-executor constant-arrival error on desktop when rust is unavailable', async () => {
    const config = {
      ...createMockConfig(),
      executionMode: 'constant-arrival' as const,
      arrivalRate: { targetRps: 50, durationSec: 30 },
    };
    (window as unknown as { __TAURI__: Record<string, unknown> }).__TAURI__ = {};
    mockCanUseRust.mockReturnValue(false);
    mockIsRustAvailable.mockResolvedValue(false);

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, [createMockScenario()]);
    });

    expect(mockResolveOAuth2ForRust).toHaveBeenCalled();
    expect(result.current.error).toBe(
      'Constant Arrival Rate requires the Rust executor',
    );

    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('pre-resolves OAuth2 to bearer then runs constant-arrival on Rust', async () => {
    const config = {
      ...createMockConfig(),
      executionMode: 'constant-arrival' as const,
      arrivalRate: { targetRps: 10, durationSec: 30 },
    };
    const oauthScenario = createMockScenario();
    oauthScenario.auth = {
      type: 'oauth2',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'csec',
    };
    const bearerScenario = {
      ...oauthScenario,
      auth: { type: 'bearer' as const, token: 'access-token', prefix: 'Bearer' },
    };
    mockResolveOAuth2ForRust.mockResolvedValueOnce([bearerScenario]);
    mockCanUseRust.mockReturnValue(true);
    mockIsRustAvailable.mockResolvedValue(true);
    mockRunTestViaRust.mockResolvedValue({ results: [createMockResult()] });

    const { result } = renderHook(() => useTestExecution());

    await act(async () => {
      await result.current.execute(config, [oauthScenario]);
    });

    expect(mockResolveOAuth2ForRust).toHaveBeenCalledWith([oauthScenario]);
    expect(mockCanUseRust).toHaveBeenCalledWith(config, [bearerScenario]);
    expect(mockRunTestViaRust).toHaveBeenCalled();
    expect(mockRunTestViaRust.mock.calls[0][1]).toEqual([bearerScenario]);
    expect(result.current.error).toBeNull();
  });
});
