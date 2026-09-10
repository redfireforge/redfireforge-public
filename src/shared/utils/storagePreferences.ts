import { isTauri } from './platform';
import {
  THEME_KEY,
  MAX_RUNS_KEY,
  RUNNER_CONFIG_KEY,
  FLAT_SEL_ENV_KEY,
  FLAT_SEL_SVC_KEY,
  SELECTED_PROJECT_KEY,
} from './storageKeys';

/**
 * Exact preference / UI-state keys plus prefixes.
 * Data keys (requests, scenarios, workflows, catalog, mocks) are never listed here.
 */
export const PREFERENCE_KEY_PREFIXES = [
  THEME_KEY,
  'perf-test-custom-theme',
  'perf-test-custom-themes',
  MAX_RUNS_KEY,
  RUNNER_CONFIG_KEY,
  FLAT_SEL_ENV_KEY,
  FLAT_SEL_SVC_KEY,
  SELECTED_PROJECT_KEY,
  'perf-test-catalog-selected-entry',
  'perf-test-catalog-convert',
  'perf-test-last-progress',
  'perf-test-wf-undo-',
  'app-last-protocols-tab',
  'pref-',
  'theme',
  'layout',
  'replayLayout:',
  'rff-update-dismissed-',
  'cloud-waitlist-dismissed',
  'redfire-onboarding-dismissed',
  'migration-v4-',
  'workflow_console_open',
  'wf-console-run-behavior',
  'workflow_preview_sample_id',
  'workflows_sample_dismissed',
  'vr-modal-',
  're-console-default-mode',
  'gql_rv_data_only',
  'gql_history_max_items',
  'gql_adv_settings',
  'grpc-studio-density',
] as const;

export function isPreferenceStorageKey(key: string): boolean {
  return PREFERENCE_KEY_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix));
}

export async function listStorageKeys(): Promise<string[]> {
  if (isTauri()) {
    const { listKeys } = await import('./tauriStore');
    return listKeys();
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

async function deleteStorageKey(key: string): Promise<void> {
  if (isTauri()) {
    const { removeItem } = await import('./tauriStore');
    await removeItem(key);
    return;
  }
  localStorage.removeItem(key);
}

/** Clear preference / UI-state keys only. Does not delete test or workspace data. */
export async function resetPreferences(): Promise<string[]> {
  const keys = await listStorageKeys();
  const removed: string[] = [];
  for (const key of keys) {
    if (!isPreferenceStorageKey(key)) continue;
    await deleteStorageKey(key);
    removed.push(key);
  }
  try {
    sessionStorage.removeItem('workflow_preview_sample_id');
  } catch {
    /* sessionStorage may be unavailable */
  }
  return removed;
}
