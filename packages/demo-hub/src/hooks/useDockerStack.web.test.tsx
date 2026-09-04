/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { resetDockerStackStore } from '../stores/dockerStackStore';

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => false,
}));

vi.mock('./useLocalDockerHelper', () => ({
  useLocalDockerHelper: () => ({ enabled: true, helperOk: true }),
}));

const checkDockerState = vi.fn();
const getStackStatus = vi.fn();
const checkCertExpiry = vi.fn();
const getStackManifest = vi.fn();
const getDockerAvailableMemoryMb = vi.fn();
const readLastRunLog = vi.fn();

vi.mock('../utils/dockerStackApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dockerStackApi')>();
  return {
    ...actual,
    checkDockerState: (...a: unknown[]) => checkDockerState(...a),
    getStackStatus: (...a: unknown[]) => getStackStatus(...a),
    checkCertExpiry: (...a: unknown[]) => checkCertExpiry(...a),
    getStackManifest: (...a: unknown[]) => getStackManifest(...a),
    getDockerAvailableMemoryMb: (...a: unknown[]) => getDockerAvailableMemoryMb(...a),
    startDockerStack: vi.fn(),
    stopDockerStack: vi.fn(),
    openDockerDesktop: vi.fn(),
    triggerAppUpdateCheck: vi.fn(),
    listenDockerLogs: vi.fn(async () => () => {}),
    listenDockerLowMemory: vi.fn(async () => () => {}),
    readLastRunLog: (...a: unknown[]) => readLastRunLog(...a),
  };
});

import { useDockerStack } from './useDockerStack';

describe('useDockerStack on local web + helper', () => {
  beforeEach(() => {
    resetDockerStackStore();
    checkDockerState.mockResolvedValue('notRunning');
    getStackStatus.mockResolvedValue(false);
    checkCertExpiry.mockResolvedValue({ expiresAt: null, daysRemaining: null });
    getStackManifest.mockResolvedValue({ minMemoryMb: 512, certExpiresAt: null });
    getDockerAvailableMemoryMb.mockResolvedValue(null);
    readLastRunLog.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stays on checking when the daemon probe fails', async () => {
    checkDockerState.mockResolvedValue(null);
    const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
    await waitFor(() => {
      expect(checkDockerState).toHaveBeenCalled();
    });
    expect(result.current.controlState).toBe('checking');
    expect(result.current.daemon).toBeNull();
  });

  it('does not start a second daemon poll while GET /state is in flight', async () => {
    vi.useFakeTimers();
    let release!: (state: 'running') => void;
    const blocked = new Promise<'running'>((resolve) => {
      release = resolve;
    });
    checkDockerState.mockReturnValue(blocked);
    const { unmount } = renderHook(() => useDockerStack('kafka-plaintext'));
    expect(checkDockerState).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(checkDockerState).toHaveBeenCalledTimes(1);
    release('running');
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
  });

  it('is ready and shows State B when Docker is not running', async () => {
    const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
    expect(result.current.ready).toBe(true);
    await waitFor(() => {
      expect(result.current.controlState).toBe('not-running');
    });
    expect(checkDockerState).toHaveBeenCalled();
  });

  it('moves from State C to State B when a later poll sees Docker quit', async () => {
    vi.useFakeTimers();
    try {
      checkDockerState.mockResolvedValue('running');
      getStackStatus.mockResolvedValue(false);
      const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.controlState).toBe('stack-stopped');
      checkDockerState.mockResolvedValue('notRunning');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.controlState).toBe('not-running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves from State E to State B when Docker quits without a Stop click', async () => {
    vi.useFakeTimers();
    try {
      checkDockerState.mockResolvedValue('running');
      getStackStatus.mockResolvedValue(true);
      const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.controlState).toBe('stack-running');
      const statusCalls = getStackStatus.mock.calls.length;
      checkDockerState.mockResolvedValue('notRunning');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.controlState).toBe('not-running');
      expect(getStackStatus.mock.calls.length).toBe(statusCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps State B when a later daemon probe fails', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.controlState).toBe('not-running');
      checkDockerState.mockResolvedValue(null);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.controlState).toBe('not-running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps State C when a later daemon probe fails', async () => {
    vi.useFakeTimers();
    try {
      checkDockerState.mockResolvedValue('running');
      getStackStatus.mockResolvedValue(false);
      const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.controlState).toBe('stack-stopped');
      checkDockerState.mockResolvedValue(null);
      getStackStatus.mockResolvedValue(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.controlState).toBe('stack-stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Stop when a later daemon probe fails during State E', async () => {
    vi.useFakeTimers();
    try {
      checkDockerState.mockResolvedValue('running');
      getStackStatus.mockResolvedValue(true);
      const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.controlState).toBe('stack-running');
      checkDockerState.mockResolvedValue(null);
      getStackStatus.mockResolvedValue(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.controlState).toBe('stack-running');
    } finally {
      vi.useRealTimers();
    }
  });
});
