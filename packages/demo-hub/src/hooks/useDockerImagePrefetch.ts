import { useCallback, useEffect } from 'react';
import { isTauri } from '@shared/utils/platform';
import {
  appendPrefetchLine,
  clearPrefetchLines,
  setPrefetchChoiceState,
  setPrefetchError,
  setPrefetchHydrated,
  setPrefetchRunning,
  useDockerPrefetchStore,
} from '../stores/dockerPrefetchStore';
import {
  cancelPrefetch,
  getPrefetchChoice,
  isPrefetchRunning,
  listenDockerPull,
  openDockerDesktop,
  parsePrefetchError,
  prefetchDockerImages,
  prefetchErrorCopy,
  setPrefetchChoice,
} from '../utils/dockerStackApi';

let pullListenStarted = false;
let startInFlight = false;

function ensurePullListener() {
  if (pullListenStarted || !isTauri()) return;
  pullListenStarted = true;
  void listenDockerPull((event) => {
    appendPrefetchLine(event.line);
  }).catch(() => {
    pullListenStarted = false;
  });
}

/** Test-only: allow a new listener after store reset. */
export function resetPrefetchListenerForTests() {
  pullListenStarted = false;
  startInFlight = false;
}

export function useDockerImagePrefetch() {
  const state = useDockerPrefetchStore();

  useEffect(() => {
    if (!isTauri()) return;
    ensurePullListener();
    let cancelled = false;
    void (async () => {
      const [choice, running] = await Promise.all([getPrefetchChoice(), isPrefetchRunning()]);
      if (cancelled) return;
      // A late Settings mount must not wipe Download's optimistic state
      // before Rust has set BUSY / written `accepted`.
      if (!startInFlight) {
        setPrefetchChoiceState(choice);
        setPrefetchRunning(running);
      }
      setPrefetchHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const declinePrefetch = useCallback(async () => {
    await setPrefetchChoice('declined');
    setPrefetchChoiceState('declined');
    setPrefetchError(null);
  }, []);

  const startPrefetch = useCallback(async () => {
    if (startInFlight) return;
    // Mount listen() can fail once; Download must still attach before pull.
    ensurePullListener();
    startInFlight = true;
    setPrefetchError(null);
    clearPrefetchLines();
    setPrefetchRunning(true);
    setPrefetchChoiceState('accepted');
    try {
      // Rust persists `accepted` only after Docker is running, so a
      // Docker-down click does not skip the first-launch prompt next time.
      await prefetchDockerImages();
      const choice = await getPrefetchChoice();
      setPrefetchChoiceState(choice ?? 'accepted');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const parsed = parsePrefetchError(message);
      // Cancel is user-requested — do not reopen the first-launch modal.
      if (parsed.kind !== 'prefetch-cancelled') {
        setPrefetchError(prefetchErrorCopy(parsed.kind));
      }
      const choice = await getPrefetchChoice();
      setPrefetchChoiceState(choice);
    } finally {
      startInFlight = false;
      setPrefetchRunning(false);
    }
  }, []);

  const stopPrefetch = useCallback(async () => {
    try {
      await cancelPrefetch();
    } catch {
      /* keep Resume available */
    }
  }, []);

  return {
    ...state,
    ready: isTauri(),
    showFirstLaunch: isTauri() && state.hydrated && state.choice === null && !state.running,
    declinePrefetch,
    startPrefetch,
    stopPrefetch,
    openDesktop: openDockerDesktop,
  };
}
