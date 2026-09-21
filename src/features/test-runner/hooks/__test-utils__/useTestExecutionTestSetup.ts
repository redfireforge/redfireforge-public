/**
 * Shared mocks, fixtures, and lifecycle helpers for useTestExecution test splits.
 *
 * Vitest mock calls declarations must remain in each test file (Vitest hoisting).
 * Wire mocks via async `vi.mock` factories that import this module (see
 * useTestExecution.test.ts).
 */
import { vi, beforeEach, afterEach } from 'vitest';
import type { TestConfig, RequestResult, TestSummary } from '@shared/types';
import {
  makeScenario,
  makeResult,
  makeConfig,
} from '@test-utils/factories';

export const mockRunTest = vi.fn();
export const mockRunTestInWorker = vi.fn();
export const mockComputeMetrics = vi.fn();
export const mockSaveTestRun = vi.fn();
export const mockForceSaveTestRun = vi.fn();
export const mockSupportsWorkers = vi.fn();
export const mockIsRustAvailable = vi.fn(async () => false);
export const mockCanUseRust = vi.fn(() => false);
export const mockRunTestViaRust = vi.fn();
export const mockResolveOAuth2ForRust = vi.fn(async (scenarios: unknown[]) => scenarios);

export function createMockSummary(
  overrides: Partial<TestSummary> = {},
): TestSummary {
  return {
    tps: 10,
    avgResponseTime: 100,
    minResponseTime: 50,
    maxResponseTime: 200,
    p50ResponseTime: 100,
    p95ResponseTime: 180,
    p99ResponseTime: 195,
    errorRate: 0,
    errorsByStatus: {},
    totalRequests: 10,
    successfulRequests: 10,
    failedRequests: 0,
    failedValidations: 0,
    totalDurationMs: 1000,
    ...overrides,
  };
}

export const createMockScenario = (id = 'sc-1') => makeScenario({ id });
export const createMockConfig = (overrides: Partial<TestConfig> = {}) =>
  makeConfig(overrides);
export const createMockResult = (overrides: Partial<RequestResult> = {}) =>
  makeResult(overrides);

/** Registers shared fake-timer beforeEach/afterEach for useTestExecution suites. */
export function registerUseTestExecutionTestLifecycle(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSupportsWorkers.mockReturnValue(false);
    mockCanUseRust.mockReturnValue(false);
    mockIsRustAvailable.mockResolvedValue(false);
    mockResolveOAuth2ForRust.mockImplementation(async (scenarios: unknown[]) => scenarios);
    mockComputeMetrics.mockReturnValue(createMockSummary());
    mockSaveTestRun.mockResolvedValue({ ok: true, quotaError: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
