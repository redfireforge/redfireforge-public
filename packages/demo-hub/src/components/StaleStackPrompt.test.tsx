/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import StaleStackPrompt from './StaleStackPrompt';
import { isStackRunning, resetDockerStackStore, setStackRunning } from '../stores/dockerStackStore';

const checkStaleStacks = vi.fn();
const startDockerStack = vi.fn();
const stopDockerStack = vi.fn();

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => true,
}));

vi.mock('../utils/dockerStackApi', () => ({
  checkStaleStacks: (...a: unknown[]) => checkStaleStacks(...a),
  startDockerStack: (...a: unknown[]) => startDockerStack(...a),
  stopDockerStack: (...a: unknown[]) => stopDockerStack(...a),
}));

describe('StaleStackPrompt', () => {
  beforeEach(() => {
    checkStaleStacks.mockReset();
    startDockerStack.mockReset();
    stopDockerStack.mockReset();
    checkStaleStacks.mockResolvedValue([]);
    startDockerStack.mockResolvedValue(undefined);
    stopDockerStack.mockResolvedValue(undefined);
    resetDockerStackStore();
  });

  it('renders nothing when no stack is stale', async () => {
    const { container } = render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    expect(container.querySelector('[data-testid="stale-stack-prompt"]')).toBeNull();
  });

  it('restarts a stale stack and dismisses the card', async () => {
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'graphql', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId('stale-stack-prompt').textContent).toContain('graphql');
    await act(async () => {
      fireEvent.click(screen.getByText('Restart Stack Now'));
      await Promise.resolve();
    });
    expect(stopDockerStack).toHaveBeenCalledWith('graphql');
    expect(startDockerStack).toHaveBeenCalledWith('graphql', { build: true });
    expect(screen.queryByTestId('stale-stack-prompt')).toBeNull();
  });

  it('Keep Running dismisses without restarting', async () => {
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'graphql', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByText('Keep Running'));
    expect(startDockerStack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stale-stack-prompt')).toBeNull();
  });

  it('disables every Restart while one restart is in flight', async () => {
    let resolveStop: () => void = () => {};
    stopDockerStack.mockReturnValue(new Promise<void>((resolve) => {
      resolveStop = resolve;
    }));
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'graphql', startedWith: '0.8.2', sinceVersion: '0.8.3' },
      { stackKey: 'ws-tls', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    const buttons = screen.getAllByText('Restart Stack Now');
    expect(buttons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(buttons[0]!);
      await Promise.resolve();
    });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
    for (const keep of screen.getAllByText('Keep Running')) {
      expect(keep).toBeDisabled();
    }
    await act(async () => {
      resolveStop();
      await Promise.resolve();
    });
  });

  it('keeps the card and shows an error when Restart start fails after stop', async () => {
    startDockerStack.mockRejectedValue(new Error('PORT_CONFLICT:4010'));
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'graphql', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByText('Restart Stack Now'));
      await Promise.resolve();
    });
    expect(stopDockerStack).toHaveBeenCalledWith('graphql');
    expect(screen.getByTestId('stale-stack-restart-error').textContent).toContain('PORT_CONFLICT');
    expect(screen.getByTestId('stale-stack-prompt')).toBeTruthy();
    expect(isStackRunning('graphql')).toBe(false);
    expect(screen.getByText('Dismiss')).toBeTruthy();
    expect(screen.queryByText('Keep Running')).toBeNull();
    expect(screen.getByTestId('stale-stack-restart-error').textContent).toContain('was stopped');
  });

  it('keeps Keep Running when Restart fails before compose down', async () => {
    stopDockerStack.mockRejectedValue(new Error('compose down failed'));
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'graphql', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByText('Restart Stack Now'));
      await Promise.resolve();
    });
    expect(screen.getByText('Keep Running')).toBeTruthy();
    expect(screen.queryByText('Dismiss')).toBeNull();
    expect(screen.getByTestId('stale-stack-restart-error').textContent).toContain('still running');
  });

  it('does not show a failed Restart error on a sibling card', async () => {
    startDockerStack.mockRejectedValue(new Error('PORT_CONFLICT:4010'));
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'graphql', startedWith: '0.8.2', sinceVersion: '0.8.3' },
      { stackKey: 'ws-tls', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getAllByText('Restart Stack Now')[0]!);
      await Promise.resolve();
    });
    const items = screen.getByTestId('stale-stack-prompt').querySelectorAll('.stale-stack-prompt__item');
    expect(items[0]?.textContent).toContain('PORT_CONFLICT');
    expect(items[1]?.textContent).not.toContain('PORT_CONFLICT');
    expect(items[1]?.textContent).toContain('Keep Running');
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByTestId('stale-stack-restart-error')).toBeNull();
    expect(screen.getByText('Keep Running')).toBeTruthy();
  });

  it('clears grpc siblings in the store when Restart downs the shared project', async () => {
    setStackRunning('grpc', true);
    setStackRunning('grpc-spring', true);
    checkStaleStacks.mockResolvedValue([
      { stackKey: 'grpc-spring', startedWith: '0.8.2', sinceVersion: '0.8.3' },
    ]);
    render(<StaleStackPrompt />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByText('Restart Stack Now'));
      await Promise.resolve();
    });
    expect(stopDockerStack).toHaveBeenCalledWith('grpc-spring');
    expect(isStackRunning('grpc')).toBe(false);
    expect(isStackRunning('grpc-spring')).toBe(true);
  });
});
