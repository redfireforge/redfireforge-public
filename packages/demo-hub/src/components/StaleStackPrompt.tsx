import { useEffect, useState } from 'react';
import { isTauri } from '@shared/utils/platform';
import { useDockerStacks } from '../stores/dockerStackStore';
import {
  checkStaleStacks,
  startDockerStack,
  stopDockerStack,
  type StaleStackInfo,
} from '../utils/dockerStackApi';
import type { DockerStackKey } from '../types';
import { DOCKER_STACK_KEYS, markDockerStackStopped } from '../utils/dockerStack';

function isStackKey(key: string): key is DockerStackKey {
  return (DOCKER_STACK_KEYS as readonly string[]).includes(key);
}

export default function StaleStackPrompt() {
  const { setRunning } = useDockerStacks();
  const [stale, setStale] = useState<StaleStackInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [restartErrors, setRestartErrors] = useState<
    Partial<Record<string, { message: string; stopped: boolean }>>
  >({});

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void checkStaleStacks().then((list) => {
      if (!cancelled) setStale(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (stale.length === 0) return null;

  const restart = async (info: StaleStackInfo) => {
    if (!isStackKey(info.stackKey)) return;
    setBusy(info.stackKey);
    setRestartErrors((prev) => {
      if (!prev[info.stackKey]) return prev;
      const next = { ...prev };
      delete next[info.stackKey];
      return next;
    });
    let stopped = false;
    try {
      await stopDockerStack(info.stackKey);
      markDockerStackStopped(info.stackKey, setRunning);
      stopped = true;
      // Rebuild local images so a version-bump Restart picks up Dockerfile /
      // COPY source changes, not only bind-mounted compose/certs.
      await startDockerStack(info.stackKey, { build: true });
      setRunning(info.stackKey, true);
      setStale((prev) => prev.filter((s) => s.stackKey !== info.stackKey));
    } catch (err) {
      setRestartErrors((prev) => ({
        ...prev,
        [info.stackKey]: {
          message: err instanceof Error ? err.message : String(err),
          stopped,
        },
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stale-stack-prompt" role="alert" data-testid="stale-stack-prompt">
      {stale.map((info) => {
        const restartError = restartErrors[info.stackKey];
        return (
        <div key={info.stackKey} className="stale-stack-prompt__item">
          <div className="stale-stack-prompt__header">Stack update available</div>
          <p className="stale-stack-prompt__body">
            The <strong>{info.stackKey}</strong> stack has been updated
            (was v{info.startedWith || 'unknown'}, now requires v{info.sinceVersion}).
            Restart it to use the latest config.
          </p>
          {restartError && (
            <p className="stale-stack-prompt__error" data-testid="stale-stack-restart-error">
              Restart failed: {restartError.message}
              {restartError.stopped
                ? ' The previous stack was stopped — start it from the lesson if you still need it.'
                : ' The previous stack is still running.'}
            </p>
          )}
          <div className="stale-stack-prompt__actions">
            <button
              type="button"
              className="stale-stack-prompt__restart-btn"
              disabled={busy !== null}
              onClick={() => { void restart(info); }}
            >
              Restart Stack Now
            </button>
            <button
              type="button"
              className="stale-stack-prompt__keep-btn"
              disabled={busy !== null}
              onClick={() => {
                setStale((prev) => prev.filter((s) => s.stackKey !== info.stackKey));
                setRestartErrors((prev) => {
                  if (!prev[info.stackKey]) return prev;
                  const next = { ...prev };
                  delete next[info.stackKey];
                  return next;
                });
              }}
            >
              {restartError?.stopped ? 'Dismiss' : 'Keep Running'}
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
