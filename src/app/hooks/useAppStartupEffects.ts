import { useEffect, useRef } from 'react';
import {
  onStorageFull,
  cleanupStaleStorageKeys,
  ensureBrowserLargeDataMigrated,
  readKey,
} from '@shared/utils/storage';
import { isProtocolsTab, setLastProtocolsTab, type Tab, LAST_PROTOCOLS_TAB_STORAGE_KEY } from '../utils/appTabUtils';
import type { UseRequestsReturn } from '../../features/requests/hooks/useRequests';
import type { ToastApi } from '@workflow/components/WorkflowToastProvider';
import { DEMO_HUB_ENABLED } from '../../config/features';
import { useOpenDockerSettings } from './useOpenDockerSettings';

type Params = {
  loading: boolean;
  wb: UseRequestsReturn;
  environments: { id: string; name: string }[];
  toast: ToastApi;
  initialTheme: string;
  setTheme: (theme: string) => void;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
};

/**
 * App bootstrapping and migration effects used by the root app shell.
 * Kept in one hook to keep App.tsx focused on composition/rendering.
 */
export function useAppStartupEffects({
  loading,
  wb,
  environments,
  toast,
  initialTheme,
  setTheme,
  activeTab,
  setActiveTab,
}: Params): void {
  useOpenDockerSettings(setActiveTab);
  const envReconciledRef = useRef(false);
  useEffect(() => {
    if (loading || !wb.loaded || envReconciledRef.current) return;
    const legacyCount = wb.data.environments?.length ?? 0;
    if (legacyCount === 0) {
      envReconciledRef.current = true;
      return;
    }
    // Wait until Settings environments have loaded so we don't drop keys prematurely.
    if (environments.length === 0) return;
    const dropped = wb.reconcileEnvironmentKeys(environments);
    envReconciledRef.current = true;
    if (dropped.length > 0) {
      toast.show(
        'info',
        'Environments updated',
        `Requests now use Settings environments. Dropped ${dropped.length} unmatched: ${dropped.join(', ')}. Re-add base URLs in Settings → Environments if needed.`,
      );
    }
  }, [loading, wb.loaded, wb.data.environments, environments, wb, toast]);

  useEffect(() => {
    if (!loading) {
      setTheme(initialTheme);
    }
  }, [loading, initialTheme, setTheme]);

  const lastStorageFullToastRef = useRef(0);
  useEffect(() => {
    return onStorageFull((key) => {
      const now = Date.now();
      if (now - lastStorageFullToastRef.current < 8_000) return;
      lastStorageFullToastRef.current = now;
      toast.show(
        'error',
        'Storage Full',
        `Cannot save ${key}. Browser storage is full. Go to Settings → Storage to free up space.`,
      );
    });
  }, [toast]);

  useEffect(() => {
    cleanupStaleStorageKeys();
    void ensureBrowserLargeDataMigrated().catch(() => {
      /* best effort */
    });
    if (DEMO_HUB_ENABLED) {
      void import('@redfireforge/demo-hub/demoLiveSession')
        .then(({ hasRestorableDemoLiveSession }) => {
          if (hasRestorableDemoLiveSession()) return;
          return import('@redfireforge/demo-hub/lessons/gql-demo-storage-cleanup')
            .then((m) => m.purgeGqlDemoEphemeralStorage())
            .catch(() => {
              /* best effort */
            });
        })
        .catch(() => {
          /* best effort */
        });
    }
  }, []);

  useEffect(() => {
    if (!DEMO_HUB_ENABLED && activeTab === 'demo-hub') {
      setActiveTab('requests');
    }
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    void readKey(LAST_PROTOCOLS_TAB_STORAGE_KEY).then((saved) => {
      if (saved && isProtocolsTab(saved as Tab)) {
        setLastProtocolsTab(saved as Tab);
      }
    });
  }, []);
}
