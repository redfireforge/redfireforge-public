/**
 * gqlActivityBarUtils — persistence helpers for the GraphQL Studio activity bar.
 * Extracted to a separate module so GraphqlStudioActivityBar.tsx exports only
 * React components (required by Fast Refresh / react-refresh/only-export-components).
 */
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';
import type { GraphqlStudioActivityTab } from '@shared/types/graphql';

const STORAGE_KEY = 'gql-studio-activity-tab';

/** Read and validate the persisted activity tab from localStorage. */
export function loadPersistedActivityTab(): GraphqlStudioActivityTab | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'history' || raw === 'collections') return raw;
    // Restore 'mock' when the companion / desktop runtime is available.
    if (raw === 'mock' && isDesktopRuntimeAvailable()) return raw;
  } catch { /* silent */ }
  return null;
}

/** Persist the currently active activity tab (or remove if null). */
export function persistActivityTab(tab: GraphqlStudioActivityTab | null): void {
  try {
    if (tab) localStorage.setItem(STORAGE_KEY, tab);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* quota — silent */ }
}
