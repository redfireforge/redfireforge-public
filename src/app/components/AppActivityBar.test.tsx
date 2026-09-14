// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import AppActivityBar from './AppActivityBar';
import { type Tab, setLastProtocolsTab, PROTOCOLS_DEFAULT_TAB } from '../utils/appTabUtils';
import { demoHubRuntimeRef } from '../demo/demoHubRuntimeRef';

afterEach(() => {
  cleanup();
  demoHubRuntimeRef.current = {
    ...demoHubRuntimeRef.current,
    state: { ...demoHubRuntimeRef.current.state, view: 'domains', selectedLesson: null },
    suppressLiveTabExitRef: { current: false },
  };
});

beforeEach(() => {
  setLastProtocolsTab(PROTOCOLS_DEFAULT_TAB);
});

function renderBar(activeTab: Tab) {
  const setActiveTab = vi.fn();
  render(<AppActivityBar activeTab={activeTab} setActiveTab={setActiveTab} />);
  return { setActiveTab };
}

describe('AppActivityBar', () => {
  it('marks the API domain active and routes other domains on click', () => {
    const { setActiveTab } = renderBar('requests');

    expect(screen.getByTitle('API').className).toContain('active');
    expect(screen.getByTitle('Workflow').className).not.toContain('active');

    // Clicking the already-active API domain is a no-op (isApiTab branch true)
    fireEvent.click(screen.getByTitle('API'));
    expect(setActiveTab).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Workflow'));
    fireEvent.click(screen.getByTitle('Harness'));
    fireEvent.click(screen.getByTitle('Gallery'));
    fireEvent.click(screen.getByTitle('Protocols'));
    fireEvent.click(screen.getByTitle('Settings'));

    expect(setActiveTab).toHaveBeenCalledWith('workflow');
    expect(setActiveTab).toHaveBeenCalledWith('scenarios');
    expect(setActiveTab).toHaveBeenCalledWith('gallery');
    expect(setActiveTab).toHaveBeenCalledWith('kafka-message-studio');
    expect(setActiveTab).toHaveBeenCalledWith('environments');
  });

  it('marks the Workflow domain active and does not re-route when already in it', () => {
    const { setActiveTab } = renderBar('workflow-executions');
    expect(screen.getByTitle('Workflow').className).toContain('active');
    fireEvent.click(screen.getByTitle('Workflow'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('marks the Harness domain active and does not re-route when already in it', () => {
    const { setActiveTab } = renderBar('runner');
    expect(screen.getByTitle('Harness').className).toContain('active');
    fireEvent.click(screen.getByTitle('Harness'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('marks the Gallery domain active and does not re-route when already in it', () => {
    const { setActiveTab } = renderBar('training');
    expect(screen.getByTitle('Gallery').className).toContain('active');
    fireEvent.click(screen.getByTitle('Gallery'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('marks the Protocols domain active and does not re-route when already in it', () => {
    const { setActiveTab } = renderBar('websocket-studio');
    expect(screen.getByTitle('Protocols').className).toContain('active');
    fireEvent.click(screen.getByTitle('Protocols'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('marks the Settings domain active and does not re-route when already in it', () => {
    const { setActiveTab } = renderBar('preferences');
    expect(screen.getByTitle('Settings').className).toContain('active');
    fireEvent.click(screen.getByTitle('Settings'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('renders all five domain labels plus settings', () => {
    renderBar('requests');
    for (const label of ['API', 'Workflow', 'Harness', 'Gallery', 'Protocols', 'Settings', 'Demo Hub']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('marks the Demo Hub domain active and does not re-route when already in it', () => {
    const { setActiveTab } = renderBar('demo-hub');
    expect(screen.getByTitle('Demo Hub').className).toContain('active');
    fireEvent.click(screen.getByTitle('Demo Hub'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('routes to demo-hub when clicking Demo Hub from another domain', () => {
    const { setActiveTab } = renderBar('requests');
    fireEvent.click(screen.getByTitle('Demo Hub'));
    expect(setActiveTab).toHaveBeenCalledWith('demo-hub');
  });

  it('routes to last protocols sub-tab when clicking Protocols from another domain', () => {
    setLastProtocolsTab('graphql-studio');
    const { setActiveTab } = renderBar('demo-hub');
    fireEvent.click(screen.getByTitle('Protocols'));
    expect(setActiveTab).toHaveBeenCalledWith('graphql-studio');
  });

  it('routes to API Mock Studio from the dedicated activity-bar domain', () => {
    const { setActiveTab } = renderBar('requests');
    fireEvent.click(screen.getByTitle('API Mock'));
    expect(setActiveTab).toHaveBeenCalledWith('api-mock-studio');
  });

  it('marks off-lesson activity items as locked during a live demo', () => {
    demoHubRuntimeRef.current = {
      ...demoHubRuntimeRef.current,
      state: {
        view: 'live',
        selectedLesson: { initialTab: 'requests', allowedTabs: ['requests'] },
        stepIndex: 0,
        isPlaying: false,
        speed: 1,
      },
      suppressLiveTabExitRef: { current: false },
    };
    renderBar('requests');
    expect(screen.getByTitle('Workflow — finish or exit the live demo first').className).toContain('ab-btn--demo-locked');
    expect(screen.getByTitle('API').className).not.toContain('ab-btn--demo-locked');
  });

  it('does not re-route when API Mock is already active', () => {
    const { setActiveTab } = renderBar('api-mock-studio');
    expect(screen.getByTitle('API Mock').className).toContain('active');
    fireEvent.click(screen.getByTitle('API Mock'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});
