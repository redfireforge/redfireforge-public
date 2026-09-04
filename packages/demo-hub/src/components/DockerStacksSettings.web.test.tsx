/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { DockerStacksSettings } from './DockerStacksSettings';
import { resetDockerStackStore } from '../stores/dockerStackStore';
import { resetDockerPrefetchStore } from '../stores/dockerPrefetchStore';

const helperState = vi.hoisted(() => ({ helperOk: false }));
const getStackStatus = vi.hoisted(() => vi.fn(async () => false as boolean | null));
const checkDockerState = vi.hoisted(() => vi.fn(async () => 'running' as const));

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => false,
}));

vi.mock('../hooks/useLocalDockerHelper', () => ({
  useLocalDockerHelper: () => ({ enabled: true, helperOk: helperState.helperOk }),
}));

vi.mock('../utils/dockerStackApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dockerStackApi')>();
  return {
    ...actual,
    getStackStatus: (...a: unknown[]) => getStackStatus(...a),
    checkDockerState: (...a: unknown[]) => checkDockerState(...a),
    getStopOnClose: vi.fn(async () => true),
    getDockerImageSizes: vi.fn(async () => []),
    getPrefetchChoice: vi.fn(async () => null),
    isPrefetchRunning: vi.fn(async () => false),
    listenDockerPull: vi.fn(async () => () => {}),
  };
});

describe('DockerStacksSettings on web', () => {
  beforeEach(() => {
    resetDockerStackStore();
    resetDockerPrefetchStore();
    helperState.helperOk = false;
    getStackStatus.mockResolvedValue(false);
    checkDockerState.mockResolvedValue('running');
  });

  afterEach(() => {
    cleanup();
  });

  it('disables Download images on web when the helper is absent', async () => {
    render(<DockerStacksSettings confirm={vi.fn()} />);
    expect(getStackStatus).not.toHaveBeenCalled();
    const btn = await screen.findByTestId('docker-settings-prefetch');
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain('Download images');
    await waitFor(() => expect(screen.getByTestId('docker-settings-web-note')).toBeTruthy());
    expect(screen.getByTestId('docker-settings-stop-on-close')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-uninstall')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('docker-settings-remove-all-images')).toBeDisabled());
    expect(screen.queryByTestId('docker-settings-stop-all')).toBeNull();
  });

  it('enables Stop / Stop all when the helper is up and a stack is running', async () => {
    helperState.helperOk = true;
    getStackStatus.mockImplementation(async (key) => key === 'graphql');
    render(<DockerStacksSettings confirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('docker-settings-stop-graphql')).toBeEnabled());
    expect(screen.getByTestId('docker-settings-stop-all')).toBeEnabled();
    expect(screen.getByTestId('docker-settings-prefetch')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-stop-on-close')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-uninstall')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-remove-all-images')).toBeDisabled();
    expect(screen.getByTestId('docker-settings-web-note').textContent).toMatch(/cloned this repo/i);
  });

  it('does not probe compose status when Docker Desktop is down', async () => {
    helperState.helperOk = true;
    checkDockerState.mockResolvedValue('notRunning');
    getStackStatus.mockImplementation(async (key) => key === 'graphql');
    render(<DockerStacksSettings confirm={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('docker-settings-row-graphql').textContent).toContain('Not running');
    });
    expect(screen.queryByTestId('docker-settings-stop-graphql')).toBeNull();
    expect(screen.queryByTestId('docker-settings-stop-all')).toBeNull();
  });
});
