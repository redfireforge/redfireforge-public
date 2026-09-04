/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import DockerStackControls from './DockerStackControls';

const startDockerStack = vi.fn();
const stopDockerStack = vi.fn();
const checkDockerState = vi.fn();
const getStackStatus = vi.fn();
const checkCertExpiry = vi.fn();
const getStackManifest = vi.fn();
const getDockerAvailableMemoryMb = vi.fn();
const readLastRunLog = vi.fn();

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

import { resetDockerStackStore, setStackRunning } from '../stores/dockerStackStore';

describe('DockerStackControls', () => {
  beforeEach(() => {
    resetDockerStackStore();
    checkDockerState.mockResolvedValue('running');
    getStackStatus.mockResolvedValue(false);
    checkCertExpiry.mockResolvedValue({ expiresAt: null, daysRemaining: null });
    getStackManifest.mockResolvedValue({ minMemoryMb: 512 });
    getDockerAvailableMemoryMb.mockResolvedValue(4096);
    startDockerStack.mockReset();
    stopDockerStack.mockReset();
    startDockerStack.mockResolvedValue(undefined);
    stopDockerStack.mockResolvedValue(undefined);
    readLastRunLog.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
  });

  it('shows State A when Docker is not installed', async () => {
    checkDockerState.mockResolvedValue('notInstalled');
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-docker-state').textContent).toContain('not installed');
    expect(screen.getByTestId('prereq-start-stack')).toBeDisabled();
  });

  it('shows State B when the daemon is down', async () => {
    checkDockerState.mockResolvedValue('notRunning');
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-docker-state').textContent).toContain('not running');
    expect(screen.getByTestId('prereq-open-docker')).toBeTruthy();
  });

  it('shows a 90s Windows start hint on State B when the host is Windows', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    checkDockerState.mockResolvedValue('notRunning');
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-windows-start-hint').textContent).toContain('90 seconds');
  });

  it('does not show the 90s hint on macOS State B', async () => {
    checkDockerState.mockResolvedValue('notRunning');
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.queryByTestId('prereq-windows-start-hint')).toBeNull();
  });

  it('shows State B2 when Compose V2 is missing', async () => {
    checkDockerState.mockResolvedValue('outdatedCompose');
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-docker-state').textContent).toContain('outdated');
  });

  it('starts a stopped stack and then offers Stop', async () => {
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-stack-status').textContent).toContain('not running');
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(startDockerStack).toHaveBeenCalledWith('graphql');
    expect(screen.getByTestId('prereq-stop-stack')).toBeTruthy();
  });

  it('passes lesson-level --build through to start', async () => {
    render(<DockerStackControls stackKey="graphql" buildOnStart />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(startDockerStack).toHaveBeenCalledWith('graphql', { build: true });
  });

  it('labels other running stacks in State C', async () => {
    setStackRunning('kafka-plaintext', true);
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-other-stack').textContent).toContain('Kafka is running');
    expect(screen.getByTestId('prereq-other-stack').textContent).not.toContain('kafka-plaintext');
  });

  it('uses are when several other stacks are running', async () => {
    setStackRunning('kafka-plaintext', true);
    setStackRunning('api-mock', true);
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-other-stack').textContent).toContain(
      'Kafka, API Mock are running',
    );
  });

  it('shows port-conflict from start errors', async () => {
    startDockerStack.mockRejectedValue(new Error('PORT_CONFLICT:4010'));
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-port-conflict').textContent).toContain('4010');
    expect(screen.getByTestId('prereq-port-conflict').textContent).toContain('already in use');
    expect(screen.getByTestId('prereq-start-stack').textContent).toBe('Retry');
  });

  it('names the process holding a conflicting port', async () => {
    startDockerStack.mockRejectedValue(
      new Error('PORT_CONFLICT:[{"port":4010,"process":"Python","pid":72363}]'),
    );
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-port-conflict').textContent).toContain('Python');
    expect(screen.getByTestId('prereq-port-conflict').textContent).toContain('72363');
    expect(screen.getByTestId('prereq-start-stack').textContent).toBe('Retry');
  });

  it('shows PID when the occupant name is missing', async () => {
    startDockerStack.mockRejectedValue(
      new Error('PORT_CONFLICT:[{"port":4010,"pid":88}]'),
    );
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-port-conflict').textContent).toContain('PID 88');
    expect(screen.getByTestId('prereq-port-conflict').textContent).toContain('4010');
  });

  it('shows OOM state from start errors', async () => {
    startDockerStack.mockRejectedValue(new Error('OOM_KILLED:2048'));
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-oom').textContent).toContain('low memory');
  });

  it('shows State F3 with Stop labels when two stacks are already running', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    render(<DockerStackControls stackKey="ws-socketio" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-stack-limit').textContent).toContain('2 stacks are already running');
    expect(screen.getByTestId('prereq-stop-limit-graphql').textContent).toContain('GraphQL');
    expect(screen.getByTestId('prereq-stop-limit-kafka-plaintext').textContent).toContain('Kafka');
    expect(screen.getByTestId('prereq-start-stack').textContent).toBe('Retry');
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-stop-limit-graphql'));
      await Promise.resolve();
    });
    expect(stopDockerStack).toHaveBeenCalledWith('graphql');
    expect(screen.queryByTestId('prereq-other-stack')).toBeNull();
  });

  it('disables F3 Stop and Retry while a listed stack is stopping', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    stopDockerStack.mockReturnValue(new Promise<void>(() => {}));
    render(<DockerStackControls stackKey="ws-socketio" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-stop-limit-graphql'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-start-stack')).toBeDisabled();
    expect(screen.getByTestId('prereq-stop-limit-graphql')).toBeDisabled();
    expect(screen.getByTestId('prereq-stop-limit-kafka-plaintext')).toBeDisabled();
  });

  it('returns to State C after every F3 stack is stopped', async () => {
    startDockerStack.mockRejectedValue(new Error('STACK_LIMIT:graphql,kafka-plaintext'));
    stopDockerStack.mockResolvedValue(undefined);
    render(<DockerStackControls stackKey="ws-socketio" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-start-stack'));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-stop-limit-graphql'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-stack-limit')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-stop-limit-kafka-plaintext'));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('prereq-stack-limit')).toBeNull();
    expect(screen.getByTestId('prereq-stack-status').textContent).toContain('Stack not running');
    expect(screen.getByTestId('prereq-start-stack').textContent).toBe('Start Stack');
  });

  it('keeps Start disabled until cert expiry is known', async () => {
    let resolveManifest: (value: { certExpiresAt: string }) => void = () => {};
    getStackManifest.mockReturnValue(new Promise((resolve) => {
      resolveManifest = resolve;
    }));
    render(<DockerStackControls stackKey="graphql-tls" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-start-stack')).toBeDisabled();
    await act(async () => {
      resolveManifest({ certExpiresAt: '2000-01-01' });
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-cert-expired')).toBeTruthy();
    expect(screen.getByTestId('prereq-start-stack')).toBeDisabled();
  });

  it('warns when a cert is expiring and blocks when expired', async () => {
    const now = new Date();
    const soon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8));
    const soonAt = [
      soon.getUTCFullYear(),
      String(soon.getUTCMonth() + 1).padStart(2, '0'),
      String(soon.getUTCDate()).padStart(2, '0'),
    ].join('-');
    getStackManifest.mockResolvedValue({ certExpiresAt: soonAt, minMemoryMb: 512 });
    const { unmount } = render(<DockerStackControls stackKey="graphql-tls" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-cert-expiring').textContent).toContain('8 days');
    unmount();
    getStackManifest.mockResolvedValue({ certExpiresAt: '2000-01-01', minMemoryMb: 512 });
    render(<DockerStackControls stackKey="graphql-tls" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-cert-expired')).toBeTruthy();
    expect(screen.getByTestId('prereq-start-stack')).toBeDisabled();
  });

  it('shows a low-memory note in State C', async () => {
    getDockerAvailableMemoryMb.mockResolvedValue(256);
    getStackManifest.mockResolvedValue({ minMemoryMb: 2048 });
    render(<DockerStackControls stackKey="kafka-plaintext" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-low-memory').textContent).toContain('recommends');
  });

  it('opens Docker settings from the State E manage link', async () => {
    getStackStatus.mockResolvedValue(true);
    const seen = vi.fn();
    window.addEventListener('rff-open-docker-settings', seen);
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByTestId('prereq-manage-docker'));
    expect(seen).toHaveBeenCalled();
    window.removeEventListener('rff-open-docker-settings', seen);
  });

  it('keeps Stop available when docker compose down fails', async () => {
    getStackStatus.mockResolvedValue(true);
    stopDockerStack.mockRejectedValue(new Error('docker compose down failed'));
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('prereq-stop-stack')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-stop-stack'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-stop-stack')).toBeTruthy();
    expect(screen.getByTestId('prereq-stop-stack').textContent).toBe('Stop Stack');
    expect(screen.getByTestId('prereq-log-panel')).toBeTruthy();
    expect(screen.queryByTestId('prereq-start-stack')).toBeNull();
  });

  it('disables Stop while compose down is in flight', async () => {
    getStackStatus.mockResolvedValue(true);
    let resolveStop: () => void = () => {};
    stopDockerStack.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveStop = resolve;
      }),
    );
    render(<DockerStackControls stackKey="graphql" />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByTestId('prereq-stop-stack'));
    });
    expect(screen.getByTestId('prereq-stop-stack').textContent).toBe('Stopping…');
    expect((screen.getByTestId('prereq-stop-stack') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('prereq-stop-stack'));
    expect(stopDockerStack).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveStop();
      await Promise.resolve();
    });
    expect(screen.getByTestId('prereq-start-stack')).toBeTruthy();
  });

  it('shows last-run file lines after hydrate when the stack is already up', async () => {
    getStackStatus.mockResolvedValue(true);
    readLastRunLog.mockResolvedValue('=== Starting graphql ===\n=== Stack started ===\n');
    render(<DockerStackControls stackKey="graphql" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('prereq-logs-toggle'));
    expect(screen.getByTestId('prereq-log-panel').textContent).toContain('=== Starting graphql ===');
    expect(screen.queryByTestId('prereq-log-empty')).toBeNull();
  });

  it('shows the previous-session empty copy when running with no file', async () => {
    getStackStatus.mockResolvedValue(true);
    readLastRunLog.mockResolvedValue(null);
    render(<DockerStackControls stackKey="graphql" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('prereq-logs-toggle'));
    expect(screen.getByTestId('prereq-log-empty').textContent).toContain('previous session');
  });
});
