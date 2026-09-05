import { isDesktopRuntimeAvailable, isLocalWebHost, isTauri } from '@shared/utils/platform';
import type { DemoLesson } from '../types';

/** Playwright GQL-13 E2E sets this flag to exercise desktop mock flows in Chromium. */
function isGql13E2eDesktopShim(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as Record<string, unknown>).__RF_E2E_MOCK_DESKTOP__ === true;
}

/** True when a desktop-only lesson cannot be started in the current runtime. */
export function isLessonDesktopOnlyBlocked(lesson: DemoLesson): boolean {
  if (!lesson.desktopOnly) return false;
  if (isGql13E2eDesktopShim()) return false;
  return !isDesktopRuntimeAvailable();
}

/**
 * Local Vite / loopback hosts where the user can run Docker themselves.
 * Delegates to the shared loopback detector used by product feature gates.
 */
export function isLocalDemoWebHost(hostname: string): boolean {
  return isLocalWebHost(hostname);
}

/**
 * True when a Docker-dependent lesson is being viewed in a hosted web environment.
 * In this case the PrerequisiteGate should be replaced with DesktopOnlyGate
 * because users cannot run local Docker backends against a cloud-hosted demo.
 *
 * Local loopback hosts are treated as local dev — Docker lessons run
 * normally there since the developer can spin up Docker on their own machine.
 */
export function isDockerLessonBlockedOnWeb(lesson: DemoLesson): boolean {
  if (isGql13E2eDesktopShim()) return false;
  if (isTauri()) return false;

  if (typeof window !== 'undefined' && isLocalDemoWebHost(window.location.hostname)) {
    return false;
  }

  return Boolean(
    lesson.dockerEndpoint || (lesson.dockerEndpoints && lesson.dockerEndpoints.length > 0),
  );
}
