/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, renderHook, act } from '@testing-library/react';
import DockerImagePrefetchModal from './DockerImagePrefetchModal';
import { resetDockerPrefetchStore } from '../stores/dockerPrefetchStore';
import { resetPrefetchListenerForTests, useDockerImagePrefetch } from '../hooks/useDockerImagePrefetch';

const getPrefetchChoice = vi.fn();
const setPrefetchChoice = vi.fn();
const prefetchDockerImages = vi.fn();
const isPrefetchRunning = vi.fn();
const openDockerDesktop = vi.fn();
const listenDockerPull = vi.fn(async () => () => {});

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => true,
}));

vi.mock('../utils/dockerStackApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dockerStackApi')>();
  return {
    ...actual,
    getPrefetchChoice: (...a: unknown[]) => getPrefetchChoice(...a),
    setPrefetchChoice: (...a: unknown[]) => setPrefetchChoice(...a),
    prefetchDockerImages: (...a: unknown[]) => prefetchDockerImages(...a),
    cancelPrefetch: vi.fn(),
    isPrefetchRunning: (...a: unknown[]) => isPrefetchRunning(...a),
    listenDockerPull: (...a: unknown[]) => listenDockerPull(...a),
    openDockerDesktop: (...a: unknown[]) => openDockerDesktop(...a),
  };
});

describe('DockerImagePrefetchModal', () => {
  beforeEach(() => {
    resetDockerPrefetchStore();
    resetPrefetchListenerForTests();
    prefetchDockerImages.mockClear();
    setPrefetchChoice.mockClear();
    getPrefetchChoice.mockClear();
    getPrefetchChoice.mockResolvedValue(null);
    setPrefetchChoice.mockResolvedValue(undefined);
    prefetchDockerImages.mockResolvedValue(undefined);
    isPrefetchRunning.mockResolvedValue(false);
    listenDockerPull.mockReset();
    listenDockerPull.mockResolvedValue(() => {});
  });

  afterEach(() => {
    cleanup();
  });

  it('does not show when the user already chose Not now', async () => {
    getPrefetchChoice.mockResolvedValue('declined');
    render(<DockerImagePrefetchModal />);
    await waitFor(() => expect(getPrefetchChoice).toHaveBeenCalled());
    expect(screen.queryByTestId('docker-prefetch-modal')).toBeNull();
  });

  it('shows the first-launch prompt and records Not now', async () => {
    render(<DockerImagePrefetchModal />);
    expect(await screen.findByTestId('docker-prefetch-modal')).toBeTruthy();
    expect(screen.getByTestId('docker-prefetch-modal').textContent).toContain('About 2 GB');
    fireEvent.click(screen.getByTestId('docker-prefetch-not-now'));
    await waitFor(() => expect(setPrefetchChoice).toHaveBeenCalledWith('declined'));
    await waitFor(() => expect(screen.queryByTestId('docker-prefetch-modal')).toBeNull());
  });

  it('starts a download and hides after success', async () => {
    render(<DockerImagePrefetchModal />);
    fireEvent.click(await screen.findByTestId('docker-prefetch-download'));
    await waitFor(() => expect(prefetchDockerImages).toHaveBeenCalled());
    getPrefetchChoice.mockResolvedValue('done');
    await waitFor(() => expect(screen.queryByTestId('docker-prefetch-modal')).toBeNull());
  });

  it('keeps the modal open when Docker is not running', async () => {
    prefetchDockerImages.mockRejectedValue(new Error('DOCKER_NOT_RUNNING'));
    render(<DockerImagePrefetchModal />);
    fireEvent.click(await screen.findByTestId('docker-prefetch-download'));
    expect(await screen.findByTestId('docker-prefetch-error')).toHaveTextContent('not running');
    expect(screen.getByTestId('docker-prefetch-open-docker')).toBeTruthy();
    expect(setPrefetchChoice).not.toHaveBeenCalledWith('accepted');
    fireEvent.click(screen.getByTestId('docker-prefetch-open-docker'));
    expect(openDockerDesktop).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(setPrefetchChoice).toHaveBeenCalledWith('declined'));
  });

  it('does not reopen the first-launch modal after Cancel', async () => {
    prefetchDockerImages.mockRejectedValue(new Error('PREFETCH_CANCELLED'));
    getPrefetchChoice.mockResolvedValue(null);
    render(<DockerImagePrefetchModal />);
    fireEvent.click(await screen.findByTestId('docker-prefetch-download'));
    getPrefetchChoice.mockResolvedValue('accepted');
    await waitFor(() => expect(prefetchDockerImages).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('docker-prefetch-modal')).toBeNull());
    expect(screen.queryByTestId('docker-prefetch-error')).toBeNull();
  });

  it('ignores a second Download click while the first invoke is in flight', async () => {
    prefetchDockerImages.mockReturnValue(new Promise<void>(() => {}));
    render(<DockerImagePrefetchModal />);
    const download = await screen.findByTestId('docker-prefetch-download');
    fireEvent.click(download);
    fireEvent.click(download);
    await waitFor(() => expect(prefetchDockerImages).toHaveBeenCalledTimes(1));
  });

  it('retries the pull listener after listen() fails', async () => {
    let rejectListen: (err: Error) => void = () => {};
    listenDockerPull.mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectListen = reject;
      }),
    );
    const { result } = renderHook(() => useDockerImagePrefetch());
    await waitFor(() => expect(listenDockerPull).toHaveBeenCalledTimes(1));
    await act(async () => {
      rejectListen(new Error('listen failed'));
    });
    await act(async () => {
      await result.current.startPrefetch();
    });
    expect(listenDockerPull).toHaveBeenCalledTimes(2);
  });
});
