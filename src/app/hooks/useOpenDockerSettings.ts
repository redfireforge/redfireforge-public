import { useEffect } from 'react';
import { OPEN_DOCKER_SETTINGS_EVENT } from '@redfireforge/demo-hub/utils/dockerSettingsNav';
import { DEMO_HUB_ENABLED } from '../../config/features';
import type { Tab } from '../utils/appTabUtils';

/**
 * Lesson-gate "Manage Docker settings" dispatches a window event.
 * Switch to the Settings page; SettingsPage then selects the Docker tab.
 */
export function useOpenDockerSettings(setActiveTab: (tab: Tab) => void): void {
  useEffect(() => {
    if (!DEMO_HUB_ENABLED) return undefined;
    const onOpen = () => setActiveTab('preferences');
    window.addEventListener(OPEN_DOCKER_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DOCKER_SETTINGS_EVENT, onOpen);
  }, [setActiveTab]);
}
