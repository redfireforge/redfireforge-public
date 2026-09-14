import { DEMO_HUB_ENABLED } from '../../config/features';
import { isDemoUiActionActive } from '@shared/utils/demoUiAction';
import { demoHubRuntimeRef } from './demoHubRuntimeRef';
import type { DemoHubLessonRef } from './demoHubApi';

/**
 * Whether switching to `tab` during live mode should tear down the demo overlay.
 * Returns false for same-tab re-selection (e.g. workflow sidebar pick) and for
 * lesson-declared initial/allowed tabs.
 */
export function shouldExitLiveDemoForTabChange(
  tab: string,
  activeTab: string,
  lesson: DemoHubLessonRef | null | undefined,
): boolean {
  if (tab === activeTab) return false;
  if (lesson?.initialTab === tab) return false;
  if (lesson?.allowedTabs?.includes(tab)) return false;
  return true;
}

/**
 * Human activity-bar / sub-nav click that would leave the live lesson.
 * Demo `ctx.click` / `ctx.navigateToTab` stay suppressed so lessons can switch
 * allowed surfaces without a prompt.
 */
export function isHumanLiveDemoTabExit(tab: string, activeTab: string): boolean {
  if (!DEMO_HUB_ENABLED) return false;
  const hub = demoHubRuntimeRef.current;
  if (hub.state.view !== 'live') return false;
  if (hub.suppressLiveTabExitRef?.current === true) return false;
  if (isDemoUiActionActive()) return false;
  return shouldExitLiveDemoForTabChange(tab, activeTab, hub.state.selectedLesson);
}
