/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DockerStacksSettings } from './DockerStacksSettings';
import { resetDockerStackStore, setStackRunning } from '../stores/dockerStackStore';
import { resetDockerPrefetchStore } from '../stores/dockerPrefetchStore';
import { resetPrefetchListenerForTests } from '../hooks/useDockerImagePrefetch';

const getStackStatus = vi.fn();
const checkDockerState = vi.fn();
const stopDockerStack = vi.fn();
const stopAllStacks = vi.fn();
const getStopOnClose = vi.fn();
const setStopOnClose = vi.fn();
const getDockerImageSizes = vi.fn();
const removeDockerImages = vi.fn();
const uninstallCleanup = vi.fn();
const getPrefetchChoice = vi.fn();
const setPrefetchChoice = vi.fn();
const prefetchDockerImages = vi.fn();
const cancelPrefetch = vi.fn();
const isPrefetchRunning = vi.fn();

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => true,
}));

vi.mock('../utils/dockerStackApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dockerStackApi')>();
  return {
    ...actual,
    getStackStatus: (...a: unknown[]) => getStackStatus(...a),
    checkDockerState: (...a: unknown[]) => checkDockerState(...a),
    stopDockerStack: (...a: unknown[]) => stopDockerStack(...a),
    stopAllStacks: (...a: unknown[]) => stopAllStacks(...a),
    getStopOnClose: (...a: unknown[]) => getStopOnClose(...a),
    setStopOnClose: (...a: unknown[]) => setStopOnClose(...a),
    getDockerImageSizes: (...a: unknown[]) => getDockerImageSizes(...a),
    removeDockerImages: (...a: unknown[]) => removeDockerImages(...a),
    uninstallCleanup: (...a: unknown[]) => uninstallCleanup(...a),
    getPrefetchChoice: (...a: unknown[]) => getPrefetchChoice(...a),
    setPrefetchChoice: (...a: unknown[]) => setPrefetchChoice(...a),
    prefetchDockerImages: (...a: unknown[]) => prefetchDockerImages(...a),
    cancelPrefetch: (...a: unknown[]) => cancelPrefetch(...a),
    isPrefetchRunning: (...a: unknown[]) => isPrefetchRunning(...a),
    listenDockerPull: vi.fn(async () => () => {}),
    openDockerDesktop: vi.fn(),
  };
});

describe('DockerStacksSettings', () => {
  const confirm = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());

  beforeEach(() => {
    resetDockerStackStore();
    resetDockerPrefetchStore();
    resetPrefetchListenerForTests();
    getPrefetchChoice.mockResolvedValue('declined');
    setPrefetchChoice.mockResolvedValue(undefined);
    prefetchDockerImages.mockResolvedValue(undefined);
    cancelPrefetch.mockResolvedValue(undefined);
    isPrefetchRunning.mockResolvedValue(false);
    getStackStatus.mockResolvedValue(false);
    checkDockerState.mockResolvedValue('running');
    stopDockerStack.mockResolvedValue(undefined);
    stopAllStacks.mockResolvedValue(true);
    getStopOnClose.mockResolvedValue(true);
    setStopOnClose.mockResolvedValue(undefined);
    getDockerImageSizes.mockResolvedValue([
      { stackKey: 'graphql', imageBytes: 512_000_000, sizeLabel: '512 MB' },
    ]);
    removeDockerImages.mockResolvedValue(['graphql']);
    uninstallCleanup.mockResolvedValue({ stopped: ['graphql'], errors: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('lists all 13 stacks and marks running ones', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-row-graphql')).toBeTruthy());
    expect(screen.getAllByTestId(/docker-settings-row-/)).toHaveLength(13);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-row-kafka-plaintext').textContent).toContain('Not running');
  });

  it('does not probe compose status when Docker Desktop is down', async () => {
    checkDockerState.mockResolvedValue('notRunning');
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => {
      expect(screen.getByTestId('docker-settings-row-graphql').textContent).toContain('Not running');
    });
    expect(screen.queryByTestId('docker-settings-stop-graphql')).toBeNull();
    expect(screen.queryByTestId('docker-settings-stop-all')).toBeNull();
  });

  it('stops one stack and stop-all', async () => {
    getStackStatus.mockResolvedValue(true);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-all')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docker-settings-stop-graphql'));
    await waitFor(() => expect(stopDockerStack).toHaveBeenCalledWith('graphql'));
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(stopAllStacks).toHaveBeenCalled());
  });

  it('does not mark stacks stopped when stop-all did not run', async () => {
    getStackStatus.mockResolvedValue(true);
    stopAllStacks.mockResolvedValue(false);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-all')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error').textContent).toMatch(/helper unavailable/i));
    expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy();
  });

  it('does not mark stacks stopped when stop-all ran but status is unknown', async () => {
    getStackStatus.mockResolvedValue(true);
    stopAllStacks.mockResolvedValue(true);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-all')).toBeTruthy());
    getStackStatus.mockResolvedValue(null);
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(stopAllStacks).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
  });

  it('hides Stop all after stop-all when status reports every stack down', async () => {
    getStackStatus.mockResolvedValue(true);
    stopAllStacks.mockResolvedValue(true);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-all')).toBeTruthy());
    getStackStatus.mockResolvedValue(false);
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(screen.queryByTestId('docker-settings-stop-all')).toBeNull());
  });

  it('clears grpc siblings when Stop downs the shared project', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'grpc' || key === 'grpc-spring');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-grpc')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-stop-grpc-spring')).toBeTruthy();
    fireEvent.click(screen.getByTestId('docker-settings-stop-grpc'));
    await waitFor(() => expect(stopDockerStack).toHaveBeenCalledWith('grpc'));
    await waitFor(() => {
      expect(screen.queryByTestId('docker-settings-stop-grpc')).toBeNull();
      expect(screen.queryByTestId('docker-settings-stop-grpc-spring')).toBeNull();
    });
  });

  it('keeps a stack marked running when stop fails', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    stopDockerStack.mockRejectedValue(new Error('docker compose down failed'));
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docker-settings-stop-graphql'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error').textContent).toContain('down failed'));
    expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy();
  });

  it('clears a Stop row after a failed down if compose is already gone', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    stopDockerStack.mockRejectedValue(new Error('docker compose down failed'));
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    getStackStatus.mockResolvedValue(false);
    fireEvent.click(screen.getByTestId('docker-settings-stop-graphql'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error').textContent).toContain('down failed'));
    await waitFor(() => expect(screen.queryByTestId('docker-settings-stop-graphql')).toBeNull());
  });

  it('persists the stop-on-close toggle', async () => {
    render(<DockerStacksSettings confirm={confirm} />);
    const toggle = await screen.findByTestId('docker-settings-stop-on-close');
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Stop running stacks')).toBeInTheDocument();
    expect(screen.getByText(/Frees ports and RAM/)).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => expect(setStopOnClose).toHaveBeenCalledWith(false));
  });

  it('disables Remove on grpc while grpc-spring is running', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'grpc-spring');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-grpc').textContent).toContain('running'));
    const removeGrpc = screen.getByTestId('docker-settings-usage-grpc').querySelector('button') as HTMLButtonElement;
    expect(removeGrpc.disabled).toBe(true);
  });

  it('removes images after confirm and shows usage', async () => {
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-graphql').textContent).toContain('512 MB'));
    const removeGraphql = screen.getByTestId('docker-settings-usage-graphql').querySelector('button');
    expect(removeGraphql).toBeTruthy();
    fireEvent.click(removeGraphql!);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Remove Docker images'),
      expect.any(Function),
      undefined,
      expect.objectContaining({ title: 'Remove Docker images', confirmLabel: 'Remove' }),
    );
    await waitFor(() => expect(removeDockerImages).toHaveBeenCalledWith('graphql'));
  });

  it('disables stack actions while prepare-to-uninstall is running', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    let finishUninstall: (value: { stopped: string[]; errors: string[] }) => void = () => {};
    uninstallCleanup.mockImplementation(
      () => new Promise((resolve) => { finishUninstall = resolve; }),
    );
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docker-settings-uninstall'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-uninstall')).toHaveTextContent('Cleaning up'));
    expect(screen.getByTestId('docker-settings-stop-graphql')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-stop-on-close')).toBeDisabled();
    finishUninstall({ stopped: ['graphql'], errors: [] });
    await waitFor(() => expect(screen.getByTestId('docker-settings-uninstall-done')).toBeTruthy());
  });

  it('runs prepare-to-uninstall and shows completion', async () => {
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-table')).toBeTruthy());
    const sizesBeforeUninstall = getDockerImageSizes.mock.calls.length;
    fireEvent.click(await screen.findByTestId('docker-settings-uninstall'));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('stop all running Docker stacks'),
      expect.any(Function),
      undefined,
      expect.objectContaining({ title: 'Prepare to uninstall', confirmLabel: 'Continue' }),
    );
    await waitFor(() => expect(uninstallCleanup).toHaveBeenCalled());
    expect(cancelPrefetch).toHaveBeenCalled();
    expect(screen.getByTestId('docker-settings-uninstall-done').textContent).toContain('Cleanup complete');
    expect(getDockerImageSizes.mock.calls.length).toBe(sizesBeforeUninstall);
  });

  it('does not claim every stack stopped when Stop all probe fails', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-all')).toBeTruthy());
    stopAllStacks.mockRejectedValue(new Error('graphql: compose ps failed'));
    getStackStatus.mockImplementation(async () => null);
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error').textContent).toContain('compose ps failed'));
    expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy();
  });

  it('surfaces uninstall errors without claiming a clean success', async () => {
    uninstallCleanup.mockResolvedValue({
      stopped: [],
      errors: ['Docker Desktop was not running'],
    });
    render(<DockerStacksSettings confirm={confirm} />);
    fireEvent.click(await screen.findByTestId('docker-settings-uninstall'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-uninstall-errors').textContent).toContain('not running'));
    expect(screen.queryByTestId('docker-settings-uninstall-done')).toBeNull();
    expect(screen.getByTestId('docker-settings-uninstall').textContent).toContain('Prepare to uninstall');
    expect(screen.getByTestId('docker-settings-uninstall-errors').textContent).not.toContain('Cleanup complete');
  });

  it('reverts the stop-on-close toggle and shows an error when persist fails', async () => {
    setStopOnClose.mockRejectedValue(new Error('cannot write preference'));
    render(<DockerStacksSettings confirm={confirm} />);
    const toggle = await screen.findByTestId('docker-settings-stop-on-close');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error').textContent).toContain('cannot write'));
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it('disables sibling Stop, Stop all, and uninstall while a stop is in flight', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'grpc' || key === 'grpc-spring');
    let finishStop: () => void = () => {};
    stopDockerStack.mockImplementation(
      () => new Promise<void>((resolve) => { finishStop = resolve; }),
    );
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-grpc')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docker-settings-stop-grpc'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-grpc')).toBeDisabled());
    expect(screen.getByTestId('docker-settings-stop-grpc-spring')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-stop-all')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-uninstall')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-prefetch')).toBeDisabled();
    finishStop();
    await waitFor(() => expect(screen.queryByTestId('docker-settings-stop-grpc')).toBeNull());
  });

  it('disables Stop, Stop all, and uninstall while image remove is in flight', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    getDockerImageSizes.mockResolvedValue([
      { stackKey: 'graphql', imageBytes: 512_000_000, sizeLabel: '512 MB' },
      { stackKey: 'kafka-plaintext', imageBytes: 256_000_000, sizeLabel: '256 MB' },
    ]);
    let finishRmi: () => void = () => {};
    removeDockerImages.mockImplementation(
      () => new Promise<string[]>((resolve) => { finishRmi = () => resolve([]); }),
    );
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-kafka-plaintext')).toBeTruthy());
    const kafkaRemove = screen.getByTestId('docker-settings-usage-kafka-plaintext').querySelector('button');
    expect(kafkaRemove).toBeTruthy();
    fireEvent.click(kafkaRemove!);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeDisabled());
    expect(screen.getByTestId('docker-settings-stop-all')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-uninstall')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-prefetch')).toBeDisabled();
    finishRmi();
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).not.toBeDisabled());
  });

  it('ignores a second Stop click while compose down is in flight', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    let finishStop: () => void = () => {};
    stopDockerStack.mockImplementation(
      () => new Promise<void>((resolve) => { finishStop = resolve; }),
    );
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    stopDockerStack.mockClear();
    fireEvent.click(screen.getByTestId('docker-settings-stop-graphql'));
    fireEvent.click(screen.getByTestId('docker-settings-stop-graphql'));
    expect(stopDockerStack).toHaveBeenCalledTimes(1);
    finishStop();
    await waitFor(() => expect(screen.queryByTestId('docker-settings-stop-graphql')).toBeNull());
  });

  it('disables Remove all when any imaged stack is running', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    getDockerImageSizes.mockResolvedValue([
      { stackKey: 'graphql', imageBytes: 512_000_000, sizeLabel: '512 MB' },
      { stackKey: 'kafka-plaintext', imageBytes: 256_000_000, sizeLabel: '256 MB' },
    ]);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-remove-all-images')).toBeDisabled();
  });

  it('disables Remove all when every imaged stack is running', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-remove-all-images')).toBeDisabled();
  });

  it('does not enable Remove when stack status has never been confirmed', async () => {
    getStackStatus.mockResolvedValue(null);
    getDockerImageSizes.mockResolvedValue([
      { stackKey: 'graphql', imageBytes: 512_000_000, sizeLabel: '512 MB' },
      { stackKey: 'kafka-plaintext', imageBytes: 256_000_000, sizeLabel: '256 MB' },
    ]);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-graphql').textContent).toContain('512 MB'));
    expect(screen.getByTestId('docker-settings-row-graphql').textContent).toContain('Checking');
    expect(screen.getByTestId('docker-settings-usage-graphql').querySelector('button')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-remove-all-images')).toBeDisabled();
    expect(screen.queryByTestId('docker-settings-stop-graphql')).toBeNull();
  });

  it('enables Remove for a gRPC sibling after Stop downs the shared project', async () => {
    setStackRunning('grpc', true);
    setStackRunning('grpc-spring', true);
    getStackStatus.mockResolvedValue(null);
    getDockerImageSizes.mockResolvedValue([
      { stackKey: 'grpc', imageBytes: 512_000_000, sizeLabel: '512 MB' },
      { stackKey: 'grpc-spring', imageBytes: 512_000_000, sizeLabel: '512 MB' },
    ]);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-grpc')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docker-settings-stop-grpc'));
    await waitFor(() => expect(stopDockerStack).toHaveBeenCalledWith('grpc'));
    await waitFor(() => {
      expect(screen.getByTestId('docker-settings-usage-grpc').querySelector('button')).not.toBeDisabled();
      expect(screen.getByTestId('docker-settings-usage-grpc-spring').querySelector('button')).not.toBeDisabled();
    });
  });

  it('enables Remove after a successful Stop even when the first probe failed', async () => {
    setStackRunning('graphql', true);
    getStackStatus.mockResolvedValue(null);
    getDockerImageSizes.mockResolvedValue([
      { stackKey: 'graphql', imageBytes: 512_000_000, sizeLabel: '512 MB' },
    ]);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-usage-graphql').querySelector('button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('docker-settings-stop-graphql'));
    await waitFor(() => expect(stopDockerStack).toHaveBeenCalledWith('graphql'));
    await waitFor(() => {
      expect(screen.queryByTestId('docker-settings-stop-graphql')).toBeNull();
      expect(screen.getByTestId('docker-settings-usage-graphql').querySelector('button')).not.toBeDisabled();
    });
  });

  it('does not mark a running stack stopped when status probe fails', async () => {
    getStackStatus.mockImplementation(async (key: string) => (key === 'graphql' ? true : false));
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy());
    stopAllStacks.mockRejectedValue(new Error('compose down failed'));
    getStackStatus.mockImplementation(async () => null);
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy();
    const graphqlRemove = screen.getByTestId('docker-settings-usage-graphql').querySelector('button');
    expect(graphqlRemove).toBeDisabled();
  });

  it('refreshes disk usage after a failed remove so partial --rmi is visible', async () => {
    removeDockerImages.mockRejectedValue(new Error('Removed graphql; also: kafka-plaintext is running'));
    getDockerImageSizes
      .mockResolvedValueOnce([{ stackKey: 'graphql', imageBytes: 512_000_000, sizeLabel: '512 MB' }])
      .mockResolvedValueOnce([]);
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-graphql').textContent).toContain('512 MB'));
    fireEvent.click(screen.getByTestId('docker-settings-usage-graphql').querySelector('button')!);
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-error').textContent).toContain('Removed graphql'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-usage-graphql').textContent).not.toContain('512 MB'));
  });

  it('refreshes running rows when Stop all fails', async () => {
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    stopAllStacks.mockRejectedValue(new Error('compose down failed'));
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-all')).toBeTruthy());
    getStackStatus.mockClear();
    getStackStatus.mockImplementation(async (key: string) => key === 'graphql');
    fireEvent.click(screen.getByTestId('docker-settings-stop-all'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-action-error').textContent).toContain('down failed'));
    expect(getStackStatus).toHaveBeenCalled();
    expect(screen.getByTestId('docker-settings-stop-graphql')).toBeTruthy();
  });

  it('labels the prefetch button Resume after an interrupted download', async () => {
    getPrefetchChoice.mockResolvedValue('accepted');
    render(<DockerStacksSettings confirm={confirm} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-prefetch').textContent).toBe('Resume'));
  });

  it('starts a prefetch from Settings', async () => {
    render(<DockerStacksSettings confirm={confirm} />);
    fireEvent.click(await screen.findByTestId('docker-settings-prefetch'));
    await waitFor(() => expect(prefetchDockerImages).toHaveBeenCalled());
  });

  it('disables Remove while prefetch is running', async () => {
    prefetchDockerImages.mockReturnValue(new Promise<void>(() => {}));
    render(<DockerStacksSettings confirm={confirm} />);
    fireEvent.click(await screen.findByTestId('docker-settings-prefetch'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-prefetch').textContent).toBe('Cancel'));
    const graphqlRemove = screen.getByTestId('docker-settings-usage-graphql').querySelector('button');
    expect(graphqlRemove).toBeDisabled();
    expect(screen.getByTestId('docker-settings-remove-all-images')).toBeDisabled();
  });

  it('does not let a late Settings hydrate clear an in-flight prefetch', async () => {
    prefetchDockerImages.mockReturnValue(new Promise<void>(() => {}));
    const { rerender } = render(<DockerStacksSettings confirm={confirm} />);
    fireEvent.click(await screen.findByTestId('docker-settings-prefetch'));
    await waitFor(() => expect(screen.getByTestId('docker-settings-prefetch').textContent).toBe('Cancel'));
    isPrefetchRunning.mockResolvedValue(false);
    getPrefetchChoice.mockResolvedValue(null);
    rerender(
      <>
        <DockerStacksSettings confirm={confirm} />
        <DockerStacksSettings confirm={confirm} />
      </>,
    );
    await waitFor(() => {
      const buttons = screen.getAllByTestId('docker-settings-prefetch');
      expect(buttons.every((btn) => btn.textContent === 'Cancel')).toBe(true);
    });
  });
});
