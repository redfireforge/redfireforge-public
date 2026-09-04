/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDockerStack } from './useDockerStack';
import {
  appendStackLog,
  getStackLogs,
  isStackRunning,
  resetDockerStackStore,
  setStackRunning,
} from '../stores/dockerStackStore';

const readLastRunLog = vi.fn();
const startDockerStack = vi.fn();
const stopDockerStack = vi.fn();
const checkDockerState = vi.fn();
const getStackStatus = vi.fn();
const checkCertExpiry = vi.fn();
const getStackManifest = vi.fn();
const getDockerAvailableMemoryMb = vi.fn();

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => true,
}));

vi.mock('../utils/dockerStackApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dockerStackApi')>();
  return {
    ...actual,
    checkDockerState: (...a: unknown[]) => checkDockerState(...a),
    getStackStatus: (...a: unknown[]) => getStackStatus(...a),
    startDockerStack: (...a: unknown[]) => startDockerStack(...a),
    stopDockerStack: (...a: unknown[]) => stopDockerStack(...a),
    checkCertExpiry: (...a: unknown[]) => checkCertExpiry(...a),
    getStackManifest: (...a: unknown[]) => getStackManifest(...a),
    getDockerAvailableMemoryMb: (...a: unknown[]) => getDockerAvailableMemoryMb(...a),
    openDockerDesktop: vi.fn(),
    triggerAppUpdateCheck: vi.fn(),
    listenDockerLogs: vi.fn(async () => () => {}),
    listenDockerLowMemory: vi.fn(async () => () => {}),
    readLastRunLog: (...a: unknown[]) => readLastRunLog(...a),
  };
});

describe('useDockerStack last-run hydrate', () => {
  beforeEach(() => {
    resetDockerStackStore();
    checkDockerState.mockResolvedValue('running');
    getStackStatus.mockResolvedValue(false);
    checkCertExpiry.mockResolvedValue({ expiresAt: null, daysRemaining: null });
    getStackManifest.mockResolvedValue({ minMemoryMb: 512 });
    getDockerAvailableMemoryMb.mockResolvedValue(4096);
    startDockerStack.mockResolvedValue(undefined);
    stopDockerStack.mockResolvedValue(undefined);
    readLastRunLog.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates empty store from the last-run file', async () => {
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\n✓ compose project started\n');
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logsHydrated).toBe(true);
    });
    expect(result.current.logs).toEqual([
      '=== Starting graphql ===',
      '✓ compose project started',
    ]);
    expect(readLastRunLog).toHaveBeenCalledTimes(1);
  });

  it('hydrates last-run after Stop when the live buffer is shorter', async () => {
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logsHydrated).toBe(true);
    });
    readLastRunLog.mockResolvedValue('=== Stopping graphql stack ===\n=== Stack stopped ===\n');
    await act(async () => {
      await result.current.stopStack();
    });
    await waitFor(() => {
      expect(result.current.logs).toEqual([
        '=== Stopping graphql stack ===',
        '=== Stack stopped ===',
      ]);
    });
    expect(result.current.controlState).toBe('stack-stopped');
  });

  it('refreshes store from the file when last-run grew', async () => {
    appendStackLog('graphql', '=== Starting graphql ===');
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\n=== Stack stopped ===\n');
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logs).toEqual([
        '=== Starting graphql ===',
        '=== Stack stopped ===',
      ]);
    });
    expect(readLastRunLog).toHaveBeenCalled();
  });

  it('does not replace live lines with a shorter last-run file', async () => {
    appendStackLog('graphql', 'one');
    appendStackLog('graphql', 'two');
    readLastRunLog.mockResolvedValue('one\n');
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logsHydrated).toBe(true);
    });
    expect(result.current.logs).toEqual(['one', 'two']);
  });

  it('ignores a late file read after Start Stack', async () => {
    let resolveRead: (value: string | null) => void = () => {};
    let reads = 0;
    readLastRunLog.mockImplementation(
      () => {
        reads += 1;
        if (reads === 1) {
          return new Promise<string | null>((resolve) => {
            resolveRead = resolve;
          });
        }
        return Promise.resolve(null);
      },
    );
    const { result } = renderHook(() => useDockerStack('graphql'));
    await act(async () => {
      await result.current.startStack();
    });
    expect(getStackLogs('graphql')).toEqual([]);
    await act(async () => {
      resolveRead('stale file from previous run\n');
    });
    expect(getStackLogs('graphql')).toEqual([]);
    expect(result.current.logs).toEqual([]);
  });

  it('marks hydrated with no lines when the file is missing', async () => {
    readLastRunLog.mockResolvedValue(null);
    getStackStatus.mockResolvedValue(true);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logsHydrated).toBe(true);
      expect(result.current.controlState).toBe('stack-running');
    });
    expect(result.current.logs).toEqual([]);
  });

  it('restores last-run lines after PORT_CONFLICT so Show logs is not blank', async () => {
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\n✓ compose project started\n');
    startDockerStack.mockRejectedValue(new Error('PORT_CONFLICT:4010'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logs).toEqual([
        '=== Starting graphql ===',
        '✓ compose project started',
      ]);
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('port-conflict');
    expect(result.current.logs).toEqual([
      '=== Starting graphql ===',
      '✓ compose project started',
    ]);
  });

  it('restores last-run lines after STACK_LIMIT', async () => {
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\n=== Stack started ===\n');
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:kafka-plaintext,ws-socketio'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logsHydrated).toBe(true);
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    expect(result.current.logs).toEqual([
      '=== Starting graphql ===',
      '=== Stack started ===',
    ]);
  });

  it('ignores a late PORT_CONFLICT restore after a second Start', async () => {
    readLastRunLog.mockResolvedValue('old file\n');
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logs).toEqual(['old file']);
    });
    let resolveConflictRead: (value: string | null) => void = () => {};
    let conflictReads = 0;
    readLastRunLog.mockImplementation(
      () => {
        conflictReads += 1;
        if (conflictReads === 1) {
          return new Promise<string | null>((resolve) => {
            resolveConflictRead = resolve;
          });
        }
        return Promise.resolve(null);
      },
    );
    startDockerStack.mockRejectedValueOnce(new Error('PORT_CONFLICT:4010'));
    let firstStart: Promise<void> = Promise.resolve();
    await act(async () => {
      firstStart = result.current.startStack();
    });
    await waitFor(() => {
      expect(result.current.controlState).toBe('port-conflict');
    });
    startDockerStack.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-running');
    expect(getStackLogs('graphql')).toEqual([]);
    await act(async () => {
      resolveConflictRead('old file\n');
      await firstStart;
    });
    expect(getStackLogs('graphql')).toEqual([]);
  });

  it('replaces a short live Starting line with the restored last-run file after spawn fail', async () => {
    readLastRunLog.mockResolvedValue('previous-run\n');
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logs).toEqual(['previous-run']);
    });
    startDockerStack.mockImplementation(async () => {
      appendStackLog('graphql', '=== Starting graphql stack ===');
      throw new Error('START_FAILED:Docker is not installed.');
    });
    readLastRunLog.mockResolvedValue('previous-run\nkeep-me\nthird\n');
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('not-installed');
    await waitFor(() => {
      expect(result.current.logs).toEqual(['previous-run', 'keep-me', 'third']);
    });
  });

  it('shows this attempt from the file after start-failed when the live stream was empty', async () => {
    readLastRunLog.mockResolvedValue('stale previous run\n');
    startDockerStack.mockRejectedValue(new Error('START_FAILED:compose exploded'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.logs).toEqual(['stale previous run']);
    });
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\ncompose exploded\n');
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('start-failed');
    await waitFor(() => {
      expect(result.current.logs).toEqual([
        '=== Starting graphql ===',
        'compose exploded',
      ]);
    });
  });

  it('passes build: true when the lesson asked for --build', async () => {
    const { result } = renderHook(() => useDockerStack('graphql', { buildOnStart: true }));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(startDockerStack).toHaveBeenCalledWith('graphql', { build: true });
  });

  it('opens logs on Stop and ignores a second click while compose down is in flight', async () => {
    getStackStatus.mockResolvedValue(true);
    let resolveStop: () => void = () => {};
    stopDockerStack.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveStop = resolve;
      }),
    );
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-running');
    });
    await act(async () => {
      void result.current.stopStack();
    });
    expect(result.current.logsOpen).toBe(true);
    expect(result.current.stopBusy).toBe(true);
    await act(async () => {
      void result.current.stopStack();
    });
    expect(stopDockerStack).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveStop();
    });
    await waitFor(() => {
      expect(result.current.stopBusy).toBe(false);
      expect(result.current.controlState).toBe('stack-stopped');
    });
  });

  it('clears grpc siblings in the store when Stop downs the shared project', async () => {
    getStackStatus.mockResolvedValue(true);
    setStackRunning('grpc', true);
    setStackRunning('grpc-spring', true);
    const { result } = renderHook(() => useDockerStack('grpc-spring'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-running');
    });
    await act(async () => {
      await result.current.stopStack();
    });
    expect(isStackRunning('grpc')).toBe(false);
    expect(isStackRunning('grpc-spring')).toBe(false);
  });
});

describe('useDockerStack State F3', () => {
  beforeEach(() => {
    resetDockerStackStore();
    checkDockerState.mockResolvedValue('running');
    getStackStatus.mockResolvedValue(false);
    checkCertExpiry.mockResolvedValue({ expiresAt: null, daysRemaining: null });
    getStackManifest.mockResolvedValue({ minMemoryMb: 512 });
    getDockerAvailableMemoryMb.mockResolvedValue(4096);
    readLastRunLog.mockResolvedValue(null);
    stopDockerStack.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses STACK_LIMIT into limit keys', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    expect(result.current.limitKeys).toEqual(['graphql', 'kafka-plaintext']);
  });

  it('returns to State C after the last listed stack is stopped', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    await act(async () => {
      await result.current.stopLimitStack('graphql');
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    expect(result.current.limitKeys).toEqual(['kafka-plaintext']);
    await act(async () => {
      await result.current.stopLimitStack('kafka-plaintext');
    });
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    expect(result.current.limitKeys).toEqual([]);
  });

  it('maps F3 Stop failure after Docker quit to State B', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    stopDockerStack.mockRejectedValue(new Error('docker compose down failed'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    checkDockerState.mockResolvedValue('notRunning');
    await act(async () => {
      await result.current.stopLimitStack('graphql');
    });
    expect(result.current.controlState).toBe('not-running');
    expect(result.current.limitKeys).toEqual([]);
  });

  it('does not let a late daemon probe overwrite F3', async () => {
    let resolveDaemon: (value: string) => void = () => {};
    checkDockerState.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveDaemon = resolve;
      }),
    );
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    await act(async () => {
      resolveDaemon('notRunning');
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    expect(result.current.limitKeys).toEqual(['graphql', 'kafka-plaintext']);
  });

  it('does not let a late status probe overwrite F3', async () => {
    let resolveStatus: (value: boolean) => void = () => {};
    getStackStatus.mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveStatus = resolve;
      }),
    );
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    await act(async () => {
      resolveStatus(false);
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    expect(result.current.limitKeys).toEqual(['graphql', 'kafka-plaintext']);
  });

  it('keeps F3 when STACK_LIMIT lists no known keys', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:not-a-stack'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
    expect(result.current.limitKeys).toEqual([]);
  });

  it('ignores a second F3 Stop and Retry while compose down is in flight', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    let resolveStop: () => void = () => {};
    stopDockerStack.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveStop = resolve;
      }),
    );
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    startDockerStack.mockClear();
    await act(async () => {
      void result.current.stopLimitStack('graphql');
    });
    expect(result.current.stopBusy).toBe(true);
    expect(result.current.logsOpen).toBe(true);
    await act(async () => {
      void result.current.stopLimitStack('kafka-plaintext');
      void result.current.startStack();
    });
    expect(stopDockerStack).toHaveBeenCalledTimes(1);
    expect(startDockerStack).not.toHaveBeenCalled();
    await act(async () => {
      resolveStop();
    });
    await waitFor(() => {
      expect(result.current.stopBusy).toBe(false);
    });
    expect(result.current.limitKeys).toEqual(['kafka-plaintext']);
  });

  it('drops an F3 key when Settings Stop clears it from the store', async () => {
    setStackRunning('graphql', true);
    setStackRunning('kafka-plaintext', true);
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.limitKeys).toEqual(['graphql', 'kafka-plaintext']);
    act(() => {
      setStackRunning('graphql', false);
    });
    await waitFor(() => {
      expect(result.current.limitKeys).toEqual(['kafka-plaintext']);
    });
    expect(result.current.controlState).toBe('stack-limit-reached');
  });

  it('keeps F3 keys the store never tracked', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    const { result } = renderHook(() => useDockerStack('ws-socketio'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.limitKeys).toEqual(['graphql', 'kafka-plaintext']);
    act(() => {
      setStackRunning('ws-socketio', false);
    });
    expect(result.current.limitKeys).toEqual(['graphql', 'kafka-plaintext']);
    expect(result.current.controlState).toBe('stack-limit-reached');
  });

  it('clears the gRPC sibling from F3 when either key is stopped', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:grpc,grpc-spring,graphql'));
    const { result } = renderHook(() => useDockerStack('kafka-plaintext'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.limitKeys).toEqual(['graphql', 'grpc', 'grpc-spring']);
    await act(async () => {
      await result.current.stopLimitStack('grpc');
    });
    expect(stopDockerStack).toHaveBeenCalledWith('grpc');
    expect(result.current.limitKeys).toEqual(['graphql']);
  });

  it('does not treat a failed daemon probe as Docker Desktop down', async () => {
    checkDockerState.mockResolvedValue(null);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(checkDockerState).toHaveBeenCalled();
    });
    expect(result.current.controlState).toBe('checking');
    expect(result.current.daemon).toBeNull();
  });

  it('does not treat a failed stack-status probe as stopped', async () => {
    getStackStatus.mockResolvedValue(null);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(getStackStatus).toHaveBeenCalled();
    });
    expect(result.current.controlState).toBe('checking');
    expect(result.current.daemon).toBe('running');
  });

  it('trusts Compose stopped over a stale in-memory running flag', async () => {
    setStackRunning('graphql', true);
    getStackStatus.mockResolvedValue(false);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    expect(isStackRunning('graphql')).toBe(false);
  });

  it('keeps Stop when the status probe fails but the store says running', async () => {
    setStackRunning('graphql', true);
    getStackStatus.mockResolvedValue(null);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(getStackStatus).toHaveBeenCalled();
    });
    expect(result.current.controlState).toBe('stack-running');
    expect(isStackRunning('graphql')).toBe(true);
  });

  it('moves from State E to State B when Docker quits without a Stop click', async () => {
    vi.useFakeTimers();
    try {
      getStackStatus.mockResolvedValue(true);
      const { result } = renderHook(() => useDockerStack('graphql'));
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
      expect(isStackRunning('graphql')).toBe(false);
      expect(getStackStatus.mock.calls.length).toBe(statusCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps State B when a later daemon probe fails', async () => {
    vi.useFakeTimers();
    try {
      checkDockerState.mockResolvedValue('notRunning');
      const { result } = renderHook(() => useDockerStack('graphql'));
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
      getStackStatus.mockResolvedValue(false);
      const { result } = renderHook(() => useDockerStack('graphql'));
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
      getStackStatus.mockResolvedValue(true);
      const { result } = renderHook(() => useDockerStack('graphql'));
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
      expect(isStackRunning('graphql')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates last-run after Settings Stop when the live buffer is shorter', async () => {
    getStackStatus.mockResolvedValue(true);
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\n');
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-running');
      expect(result.current.logs).toEqual(['=== Starting graphql ===']);
    });
    readLastRunLog.mockResolvedValue(
      '=== Starting graphql ===\n=== Stopping graphql stack ===\n=== Stack stopped ===\n',
    );
    act(() => {
      setStackRunning('graphql', false);
    });
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
      expect(result.current.logs).toEqual([
        '=== Starting graphql ===',
        '=== Stopping graphql stack ===',
        '=== Stack stopped ===',
      ]);
    });
  });

  it('follows Settings Stop so the lesson gate leaves stack-running', async () => {
    getStackStatus.mockResolvedValue(true);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-running');
    });
    act(() => {
      setStackRunning('graphql', false);
    });
    expect(result.current.controlState).toBe('stack-stopped');
  });

  it('follows an external Start so the lesson gate shows running', async () => {
    getStackStatus.mockResolvedValue(false);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    act(() => {
      setStackRunning('graphql', true);
    });
    expect(result.current.controlState).toBe('stack-running');
  });

  it('does not resurrect stack-running when Settings Stop races a status probe', async () => {
    let finishStatus: (value: boolean | null) => void = () => {};
    getStackStatus.mockImplementation(
      () => new Promise<boolean | null>((resolve) => {
        finishStatus = resolve;
      }),
    );
    setStackRunning('graphql', true);
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(getStackStatus).toHaveBeenCalled();
    });
    act(() => {
      setStackRunning('graphql', false);
    });
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      finishStatus(true);
    });
    expect(result.current.controlState).toBe('stack-stopped');
    expect(isStackRunning('graphql')).toBe(false);
  });

  it('maps START_FAILED daemon copy to State A / B / B2 instead of Retry', async () => {
    startDockerStack.mockRejectedValue(new Error('START_FAILED:Docker Desktop is not running.'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('not-running');
    expect(result.current.daemon).toBe('notRunning');
    startDockerStack.mockRejectedValue(new Error('START_FAILED:Docker Compose V2 is required.'));
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('outdated-compose');
  });

  it('maps Stop failure after Docker quit to State B instead of leaving Stop up', async () => {
    getStackStatus.mockResolvedValue(true);
    stopDockerStack.mockRejectedValue(new Error('docker compose down failed'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-running');
    });
    checkDockerState.mockResolvedValue('notRunning');
    await act(async () => {
      await result.current.stopStack();
    });
    expect(result.current.controlState).toBe('not-running');
    expect(result.current.daemon).toBe('notRunning');
    expect(isStackRunning('graphql')).toBe(false);
  });

  it('keeps Stop after a compose-down failure while Docker is still up', async () => {
    getStackStatus.mockResolvedValue(true);
    stopDockerStack.mockRejectedValue(new Error('docker compose down failed'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-running');
    });
    await act(async () => {
      await result.current.stopStack();
    });
    expect(result.current.controlState).toBe('stack-running');
    expect(isStackRunning('graphql')).toBe(true);
  });

  it('maps START_CANCELLED to State C instead of start-failed', async () => {
    startDockerStack.mockRejectedValue(new Error('START_CANCELLED'));
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-stopped');
  });

  it('keeps Start disabled when the TLS cert date is unreadable', async () => {
    getStackManifest.mockResolvedValue({ certExpiresAt: 'not-a-date', minMemoryMb: 512 });
    const { result } = renderHook(() => useDockerStack('graphql-tls'));
    await waitFor(() => {
      expect(getStackManifest).toHaveBeenCalled();
    });
    expect(result.current.certReady).toBe(false);
    expect(result.current.certExpired).toBe(false);
    expect(result.current.certExpiry).toBeNull();
  });

  it('ignores a stale docker memory reading after a newer cert retry', async () => {
    let releaseFirst!: (n: number | null) => void;
    getDockerAvailableMemoryMb
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValue(4096);
    getStackManifest.mockResolvedValue({ certExpiresAt: 'not-a-date', minMemoryMb: 2048 });
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDockerStack('graphql-tls'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.lowMemory).toBeNull();
      getStackManifest.mockResolvedValue({ minMemoryMb: 512 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.certReady).toBe(true);
      expect(result.current.lowMemory).toBeNull();
      await act(async () => {
        releaseFirst(256);
      });
      expect(result.current.lowMemory).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables Start on a non-TLS stack before docker memory returns', async () => {
    let releaseMem!: (n: number | null) => void;
    getDockerAvailableMemoryMb.mockReturnValue(new Promise((resolve) => {
      releaseMem = resolve;
    }));
    getStackManifest.mockResolvedValue({ minMemoryMb: 2048, certExpiresAt: null });
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.certReady).toBe(true);
    });
    expect(result.current.lowMemory).toBeNull();
    expect(result.current.certExpired).toBe(false);
    await act(async () => {
      releaseMem(256);
    });
    await waitFor(() => {
      expect(result.current.lowMemory).toEqual({ availableMb: 256, recommendedMb: 2048 });
    });
  });

  it('does not fetch docker memory when the stack has no minMemoryMb', async () => {
    getStackManifest.mockResolvedValue({ certExpiresAt: null });
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.certReady).toBe(true);
    });
    expect(getDockerAvailableMemoryMb).not.toHaveBeenCalled();
    expect(result.current.lowMemory).toBeNull();
  });

  it('does not fetch docker memory while Docker Desktop is down', async () => {
    checkDockerState.mockResolvedValue('notRunning');
    getStackManifest.mockResolvedValue({ minMemoryMb: 2048, certExpiresAt: null });
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('not-running');
      expect(result.current.certReady).toBe(true);
    });
    expect(getDockerAvailableMemoryMb).not.toHaveBeenCalled();
    expect(result.current.lowMemory).toBeNull();
  });

  it('probes docker memory after Docker Desktop becomes running', async () => {
    vi.useFakeTimers();
    try {
      checkDockerState.mockResolvedValue('notRunning');
      getStackManifest.mockResolvedValue({ minMemoryMb: 2048, certExpiresAt: null });
      getDockerAvailableMemoryMb.mockResolvedValue(256);
      const { result } = renderHook(() => useDockerStack('graphql'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.controlState).toBe('not-running');
      expect(getDockerAvailableMemoryMb).not.toHaveBeenCalled();
      checkDockerState.mockResolvedValue('running');
      getStackStatus.mockResolvedValue(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.controlState).toBe('stack-stopped');
      expect(getDockerAvailableMemoryMb).toHaveBeenCalled();
      expect(result.current.lowMemory).toEqual({ availableMb: 256, recommendedMb: 2048 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables Start when a non-TLS stack has a manifest and no cert date', async () => {
    getStackManifest.mockResolvedValue({ minMemoryMb: 512 });
    const { result } = renderHook(() => useDockerStack('graphql'));
    await waitFor(() => {
      expect(result.current.certReady).toBe(true);
    });
    expect(result.current.certExpired).toBe(false);
  });

  it('keeps Start disabled when the manifest probe fails', async () => {
    getStackManifest.mockResolvedValue(null);
    const { result } = renderHook(() => useDockerStack('graphql-tls'));
    await waitFor(() => {
      expect(getStackManifest).toHaveBeenCalled();
    });
    expect(result.current.certReady).toBe(false);
    expect(result.current.certExpired).toBe(false);
  });

  it('clears expired cert and low-memory when the stack key changes', async () => {
    getStackManifest.mockResolvedValue({ certExpiresAt: '2000-01-01', minMemoryMb: 2048 });
    getDockerAvailableMemoryMb.mockResolvedValue(256);
    const { result, rerender } = renderHook(
      ({ key }) => useDockerStack(key),
      { initialProps: { key: 'graphql-tls' as const } },
    );
    await waitFor(() => {
      expect(result.current.certExpired).toBe(true);
      expect(result.current.lowMemory).toEqual({ availableMb: 256, recommendedMb: 2048 });
    });
    getStackManifest.mockResolvedValue({ certExpiresAt: null, minMemoryMb: null });
    getDockerAvailableMemoryMb.mockResolvedValue(4096);
    rerender({ key: 'kafka-plaintext' });
    await waitFor(() => {
      expect(result.current.certExpired).toBe(false);
      expect(result.current.lowMemory).toBeNull();
      expect(result.current.certReady).toBe(true);
    });
    expect(getDockerAvailableMemoryMb).toHaveBeenCalledTimes(1);
  });

  it('clears the low-memory banner when a later probe is above minMemoryMb', async () => {
    vi.useFakeTimers();
    try {
      getStackManifest.mockResolvedValue({ certExpiresAt: 'not-a-date', minMemoryMb: 2048 });
      getDockerAvailableMemoryMb.mockResolvedValue(256);
      const { result } = renderHook(() => useDockerStack('graphql-tls'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.lowMemory).toEqual({ availableMb: 256, recommendedMb: 2048 });
      getDockerAvailableMemoryMb.mockResolvedValue(4096);
      getStackManifest.mockResolvedValue({ minMemoryMb: 512 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.lowMemory).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps CERT_EXPIRED to State H instead of Retry', async () => {
    startDockerStack.mockRejectedValue(new Error('CERT_EXPIRED:2020-01-01'));
    const { result } = renderHook(() => useDockerStack('graphql-tls'));
    await waitFor(() => {
      expect(result.current.controlState).toBe('stack-stopped');
      expect(result.current.certReady).toBe(true);
    });
    await act(async () => {
      await result.current.startStack();
    });
    expect(result.current.controlState).toBe('stack-stopped');
    expect(result.current.certExpired).toBe(true);
    expect(result.current.certExpiry).toEqual({
      expiresAt: '2020-01-01',
      daysRemaining: 0,
    });
  });
});
