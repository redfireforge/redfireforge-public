/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import DockerStackControls from './DockerStackControls';
import { resetDockerStackStore } from '../stores/dockerStackStore';

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => false,
}));

vi.mock('../hooks/useLocalDockerHelper', () => ({
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

describe('DockerStackControls on local web + helper', () => {
  beforeEach(() => {
    resetDockerStackStore();
    checkDockerState.mockResolvedValue('running');
    getStackStatus.mockResolvedValue(false);
    checkCertExpiry.mockResolvedValue({ expiresAt: null, daysRemaining: null });
    getStackManifest.mockResolvedValue({ minMemoryMb: 512, certExpiresAt: null });
    getDockerAvailableMemoryMb.mockResolvedValue(null);
    readLastRunLog.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows Start Stack when the helper reports a stopped stack', async () => {
    render(<DockerStackControls stackKey="kafka-plaintext" />);
    await waitFor(() => {
      expect(screen.getByTestId('prereq-start-stack')).toBeTruthy();
    });
    expect(screen.getByTestId('prereq-start-stack')).not.toBeDisabled();
  });
});
