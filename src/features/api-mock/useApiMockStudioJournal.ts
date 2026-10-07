import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ApiMockServerDefinitionV1, ApiMockTransactionV1 } from '@shared/api-mock/contracts';
import { mergeRecordedDraftsIntoRoutes } from '@shared/api-mock/proxyRecording';
import { apiMockControlClient } from './apiMockControlClient';
import type { ScenarioStateSnapshot } from './apiMockControlClient';
import { mergeRuntimeInfo } from './apiMockPageHelpers';
import type { RuntimeInfo } from './apiMockStudioFactory';
import type { ApiMockWorkspaceSnapshot } from './useApiMockStudioPersistence';

const JOURNAL_MAX_COMPANION_FAILURE_STREAK = 4;

export function useApiMockStudioJournal(opts: {
  activeServerId?: string;
  activeStatus?: RuntimeInfo['status'];
  latestRef: MutableRefObject<ApiMockWorkspaceSnapshot>;
  setTransactions: Dispatch<SetStateAction<ApiMockTransactionV1[]>>;
  setScenarioState: Dispatch<SetStateAction<ScenarioStateSnapshot | null>>;
  setRuntime: Dispatch<SetStateAction<Record<string, RuntimeInfo>>>;
  setServers: Dispatch<SetStateAction<ApiMockServerDefinitionV1[]>>;
  setLiveMessage: Dispatch<SetStateAction<string>>;
}): void {
  const {
    activeServerId, activeStatus, latestRef,
    setTransactions, setScenarioState, setRuntime, setServers, setLiveMessage,
  } = opts;

  useEffect(() => {
    setTransactions([]);
    setScenarioState(null);
  }, [activeServerId, setTransactions, setScenarioState]);

  useEffect(() => {
    if (!activeServerId || activeStatus !== 'running') return;
    let cancelled = false;
    let failureStreak = 0;
    let timer: number | null = null;

    const stopInterval = () => {
      cancelled = true;
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    };

    const poll = async () => {
      // Probe `state` first. A missing/unreachable listener answers 404 for every
      // endpoint, so firing transactions + state + drafts in parallel sprays three
      // 404s into the console before we can react. Gating the rest behind a live
      // `state` means at most one request touches a dead listener, and we reconcile
      // the (possibly stale "Running") badge to `stopped` so polling halts.
      const stRes = await apiMockControlClient.state(activeServerId);
      if (cancelled) return;
      if (!stRes.ok) {
        // A hard failure (wipe, crash, companion restart) is terminal — flip the
        // badge so the effect tears the interval down. A retryable failure (the
        // companion is briefly unreachable) keeps the badge; after enough consecutive
        // misses we stop polling to avoid flooding the console while companion is down.
        if (!stRes.error.retry) {
          setRuntime(prev => mergeRuntimeInfo(prev, activeServerId, { status: 'stopped', error: undefined }));
          stopInterval();
        } else {
          failureStreak++;
          if (failureStreak >= JOURNAL_MAX_COMPANION_FAILURE_STREAK) stopInterval();
        }
        return;
      }
      failureStreak = 0;
      setScenarioState(stRes.data);
      const [txRes, draftRes] = await Promise.all([
        apiMockControlClient.transactions(activeServerId),
        apiMockControlClient.recordedDrafts(activeServerId),
      ]);
      if (cancelled) return;
      if (txRes.ok) setTransactions([...txRes.data.transactions].reverse());
      if (draftRes.ok && draftRes.data.drafts.length > 0) {
        const drafts = draftRes.data.drafts;
        const current = latestRef.current.servers.find(s => s.id === activeServerId);
        if (current) {
          const merged = mergeRecordedDraftsIntoRoutes(current.routes, drafts);
          const updated = merged.updated ?? 0;
          if (merged.added > 0 || updated > 0) {
            setServers(prev => prev.map(s => (
              s.id === activeServerId
                ? { ...s, routes: merged.routes, updatedAt: new Date().toISOString() }
                : s
            )));
            const notes: string[] = [];
            if (merged.added > 0) {
              notes.push(`Recorded ${merged.added} proxied exchange(s) as inactive draft routes.`);
            }
            if (updated > 0) {
              notes.push(`Filled response headers on ${updated} recorded draft(s).`);
            }
            setLiveMessage(notes.join(' '));
          }
        }
        void apiMockControlClient.ackRecordedDrafts(activeServerId, drafts.map(d => d.id));
      }
    };
    void poll();
    timer = window.setInterval(() => void poll(), 1500);
    return stopInterval;
  }, [activeServerId, activeStatus, latestRef, setTransactions, setScenarioState, setRuntime, setServers, setLiveMessage]);
}
