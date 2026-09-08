import type { Tab } from './appTabUtils';
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';

/** Hosted web only — never show download CTAs on Tauri, local clone, or E2E shim. */
export function shouldShowWebDownloadCta(): boolean {
  return !isDesktopRuntimeAvailable();
}

const DESKTOP_ONLY_TABS: ReadonlySet<Tab> = new Set([
  'api-mock-studio',
  'grpc-studio',
  'kafka-message-studio',
]);

const FEATURE_LABELS: Partial<Record<Tab, string>> = {
  'api-mock-studio': 'API Mock Server',
  'grpc-studio': 'gRPC Studio',
  'kafka-message-studio': 'Kafka Studio',
};

export function isDesktopOnlyTab(tab: Tab): boolean {
  return DESKTOP_ONLY_TABS.has(tab);
}

/** Returns the feature display name when navigation should be blocked on hosted web. */
export function getBlockedDesktopFeature(tab: Tab): string | null {
  if (!shouldShowWebDownloadCta()) return null;
  if (!isDesktopOnlyTab(tab)) return null;
  return FEATURE_LABELS[tab]!;
}

export function featureRequiresDesktopReason(featureName: string): string {
  switch (featureName) {
    case 'API Mock Server':
      return 'API Mock Server requires the RedfireForge desktop app. The browser cannot bind to local ports or run background server processes.';
    case 'gRPC Studio':
      return 'gRPC Studio requires the RedfireForge desktop app. Native gRPC transport is not available in the browser.';
    case 'Kafka Studio':
      return 'Kafka Studio requires the RedfireForge desktop app. Direct broker connections are not available in the browser.';
    default:
      return `${featureName} requires the RedfireForge desktop app.`;
  }
}
