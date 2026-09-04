import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@shared/utils/platform';
import {
  isLocalWebDockerEnabled,
  peekLocalDockerHelper,
  probeLocalDockerHelper,
} from '../utils/localDockerApi';

/** Retry /health while the helper is down (or dies after a success). */
export const HELPER_PROBE_INTERVAL_MS = 2000;
/** One flaky /health must not unmount Start/Stop (compose up can stall Node). */
export const HELPER_FAIL_THRESHOLD = 2;

export function useLocalDockerHelper(): { enabled: boolean; helperOk: boolean } {
  const enabled = !isTauri() && isLocalWebDockerEnabled();
  const [helperOk, setHelperOk] = useState(() => enabled && peekLocalDockerHelper() === true);
  const failStreakRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      failStreakRef.current = 0;
      setHelperOk(false);
      return;
    }
    let cancelled = false;
    const run = () => {
      void probeLocalDockerHelper().then((ok) => {
        if (cancelled) return;
        if (ok) {
          failStreakRef.current = 0;
          setHelperOk(true);
          return;
        }
        failStreakRef.current += 1;
        if (failStreakRef.current >= HELPER_FAIL_THRESHOLD) {
          setHelperOk(false);
        }
      });
    };
    run();
    const interval = window.setInterval(run, HELPER_PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  return { enabled, helperOk };
}
