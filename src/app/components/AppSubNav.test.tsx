/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppSubNav from './AppSubNav';
import { demoHubRuntimeRef } from '../demo/demoHubRuntimeRef';

vi.mock('../../features/test-runner/components/MigrationBanner', () => ({
  default: ({ onNavigateToParamRunner }: { onNavigateToParamRunner: () => void }) => (
    <button type="button" onClick={onNavigateToParamRunner}>Open Migration Banner</button>
  ),
}));

vi.mock('../../features/workflow/components/panels/ServerStatusIndicator', () => ({
  default: () => <div data-testid="server-status-indicator">Server Status</div>,
}));

afterEach(() => {
  cleanup();
  demoHubRuntimeRef.current = {
    ...demoHubRuntimeRef.current,
    state: { ...demoHubRuntimeRef.current.state, view: 'domains', selectedLesson: null },
    suppressLiveTabExitRef: { current: false },
  };
});

describe('AppSubNav', () => {
  it('marks the active tab button in each major domain', () => {
    const setActiveTab = vi.fn();
    const { rerender } = render(<AppSubNav activeTab="requests" setActiveTab={setActiveTab} />);

    expect(screen.getByRole('button', { name: 'Requests' }).className).toContain('active');

    rerender(<AppSubNav activeTab="workflow" setActiveTab={setActiveTab} />);
    expect(screen.getByRole('button', { name: 'Designer' }).className).toContain('active');

    rerender(<AppSubNav activeTab="runner" setActiveTab={setActiveTab} />);
    expect(screen.getByRole('button', { name: 'Test Runner' }).className).toContain('active');

    rerender(<AppSubNav activeTab="param-runner" setActiveTab={setActiveTab} />);
    expect(screen.getByRole('button', { name: 'Parameterized Runner' }).className).toContain('active');

    rerender(<AppSubNav activeTab="gallery" setActiveTab={setActiveTab} />);
    expect(screen.getByRole('button', { name: 'Samples' }).className).toContain('active');
  });

  it('renders API tabs and switches between them', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();

    render(<AppSubNav activeTab="requests" setActiveTab={setActiveTab} />);

    expect(screen.getByRole('button', { name: 'Requests' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Catalog' }));
    expect(setActiveTab).toHaveBeenCalledWith('catalog');
  });

  it('renders workflow tabs and server status indicator', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();

    render(<AppSubNav activeTab="workflow" setActiveTab={setActiveTab} />);

    expect(screen.getByTestId('server-status-indicator')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Executions' }));
    await user.click(screen.getByRole('button', { name: 'Webhooks' }));

    expect(setActiveTab).toHaveBeenCalledWith('workflow-executions');
    expect(setActiveTab).toHaveBeenCalledWith('webhook-deliveries');
  });

  it('renders testing tabs and routes migration banner callback to parameterized runner', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();

    render(<AppSubNav activeTab="runner" setActiveTab={setActiveTab} />);

    await user.click(screen.getByRole('button', { name: 'Feature Groups' }));
    await user.click(screen.getByRole('button', { name: 'Workflow Runner' }));
    await user.click(screen.getByRole('button', { name: 'Results' }));
    await user.click(screen.getByRole('button', { name: 'Open Migration Banner' }));

    expect(setActiveTab).toHaveBeenCalledWith('scenarios');
    expect(setActiveTab).toHaveBeenCalledWith('workflow-runner');
    expect(setActiveTab).toHaveBeenCalledWith('results');
    expect(setActiveTab).toHaveBeenCalledWith('param-runner');
  });

  it('renders gallery tabs and switches to training tracks', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();

    render(<AppSubNav activeTab="gallery" setActiveTab={setActiveTab} />);

    await user.click(screen.getByRole('button', { name: 'Training Tracks' }));
    expect(setActiveTab).toHaveBeenCalledWith('training');
  });

  it('shows Kafka settings tab in settings domain and can switch to it', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();

    const { rerender } = render(<AppSubNav activeTab="environments" setActiveTab={setActiveTab} />);

    expect(screen.getByRole('button', { name: 'Environments' }).className).toContain('active');

    rerender(<AppSubNav activeTab="preferences" setActiveTab={setActiveTab} />);
    expect(screen.getByRole('button', { name: 'Preferences' }).className).toContain('active');

    const kafkaTab = screen.getByRole('button', { name: 'Kafka' });
    expect(kafkaTab).toBeTruthy();

    await user.click(kafkaTab);
    expect(setActiveTab).toHaveBeenCalledWith('kafka-settings');
  });

  it('renders Learning Hub tab in demo domain when demo is enabled', () => {
    const setActiveTab = vi.fn();
    render(<AppSubNav activeTab="demo-hub" setActiveTab={setActiveTab} />);
    expect(screen.getByRole('button', { name: 'Learning Hub' }).className).toContain('active');
  });

  it('hides the horizontal sub-nav on the API Mock domain', () => {
    const setActiveTab = vi.fn();
    const { container } = render(<AppSubNav activeTab="api-mock-studio" setActiveTab={setActiveTab} />);
    expect(container.querySelector('.sub-nav')).toBeNull();
  });

  it('marks off-lesson sub-nav items as locked during a live demo', () => {
    demoHubRuntimeRef.current = {
      ...demoHubRuntimeRef.current,
      state: {
        view: 'live',
        selectedLesson: { initialTab: 'requests', allowedTabs: ['requests', 'environments'] },
        stepIndex: 0,
        isPlaying: false,
        speed: 1,
      },
      suppressLiveTabExitRef: { current: false },
    };
    render(<AppSubNav activeTab="requests" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('nav-tab-catalog').className).toContain('sub-nav-tab--demo-locked');
    expect(screen.getByTestId('nav-tab-requests').className).not.toContain('sub-nav-tab--demo-locked');
  });
});
