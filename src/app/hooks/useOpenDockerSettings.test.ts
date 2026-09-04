/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_DOCKER_SETTINGS_EVENT, requestOpenDockerSettings, resetDockerSettingsNav } from '@redfireforge/demo-hub/utils/dockerSettingsNav';

const features = { enabled: true };
vi.mock('../../config/features', () => ({
  get DEMO_HUB_ENABLED() { return features.enabled; },
}));

import { useOpenDockerSettings } from './useOpenDockerSettings';

describe('useOpenDockerSettings', () => {
  it('navigates to preferences when the docker settings event fires', () => {
    features.enabled = true;
    resetDockerSettingsNav();
    const setActiveTab = vi.fn();
    const { unmount } = renderHook(() => useOpenDockerSettings(setActiveTab));
    window.dispatchEvent(new CustomEvent(OPEN_DOCKER_SETTINGS_EVENT));
    expect(setActiveTab).toHaveBeenCalledWith('preferences');
    unmount();
    setActiveTab.mockClear();
    requestOpenDockerSettings();
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('does not listen when Learning Hub is disabled', () => {
    features.enabled = false;
    resetDockerSettingsNav();
    const setActiveTab = vi.fn();
    renderHook(() => useOpenDockerSettings(setActiveTab));
    window.dispatchEvent(new CustomEvent(OPEN_DOCKER_SETTINGS_EVENT));
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});
