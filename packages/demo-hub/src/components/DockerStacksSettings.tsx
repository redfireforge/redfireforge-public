import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@shared/utils/platform';
import type { DockerStackKey } from '../types';
import { useDockerImagePrefetch } from '../hooks/useDockerImagePrefetch';
import { useLocalDockerHelper } from '../hooks/useLocalDockerHelper';
import { useDockerStacks } from '../stores/dockerStackStore';
import {
  DOCKER_STACK_KEYS,
  DOCKER_STACK_LABELS,
  dockerStackBlockedByRunning,
  dockerStackSiblings,
  dockerStackStopBusy,
  markDockerStackStopped,
} from '../utils/dockerStack';
import {
  checkDockerState,
  getDockerImageSizes,
  getStackStatus,
  getStopOnClose,
  removeDockerImages,
  setStopOnClose,
  stopAllStacks,
  stopDockerStack,
  uninstallCleanup,
  type StackDiskUsage,
} from '../utils/dockerStackApi';

export interface DockerConfirmOptions {
  title?: string;
  confirmLabel?: string;
  finalNote?: string;
}

export interface DockerStacksSettingsProps {
  confirm: (
    message: string,
    onConfirm: () => void,
    detail?: string,
    options?: DockerConfirmOptions,
  ) => void;
}

function formatTotalBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export function DockerStacksSettings({ confirm }: DockerStacksSettingsProps) {
  const { running, setRunning } = useDockerStacks();
  const [stopOnClose, setStopOnCloseState] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [usages, setUsages] = useState<StackDiskUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallDone, setUninstallDone] = useState(false);
  const [uninstallMessage, setUninstallMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusKnown, setStatusKnown] = useState<Set<string>>(() => new Set());
  const desktop = isTauri();
  const { helperOk } = useLocalDockerHelper();
  const canControl = desktop || (!desktop && helperOk);
  const prefetch = useDockerImagePrefetch();
  const actionLockRef = useRef(false);
  const refreshGenRef = useRef(0);

  const refreshRunning = useCallback(async () => {
    const gen = ++refreshGenRef.current;
    const docker = await checkDockerState();
    if (gen !== refreshGenRef.current) return;
    if (docker !== 'running') {
      // Docker-down `compose ps` fails 13 times and leaves stale Stop rows.
      if (
        docker === 'notInstalled'
        || docker === 'notRunning'
        || docker === 'outdatedCompose'
      ) {
        for (const key of DOCKER_STACK_KEYS) {
          setRunning(key, false);
        }
        setStatusKnown(new Set(DOCKER_STACK_KEYS));
      }
      return;
    }
    const results = await Promise.all(
      DOCKER_STACK_KEYS.map(async (key) => {
        const up = await getStackStatus(key);
        return [key, up] as const;
      }),
    );
    if (gen !== refreshGenRef.current) return;
    const known: DockerStackKey[] = [];
    for (const [key, up] of results) {
      // A failed probe is not “stopped” — keep the last known row so Stop
      // stays available. Do not treat “never probed” as stopped either
      // (that enabled Remove on first load while compose ps was failing).
      if (up != null) {
        setRunning(key, up);
        known.push(key);
      }
    }
    if (known.length > 0) {
      setStatusKnown((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const key of known) {
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [setRunning]);

  const refreshUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      setUsages(await getDockerImageSizes());
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : String(err));
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void getStopOnClose().then(setStopOnCloseState);
    void refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    // Loopback web without a helper still has isLocalWebDockerEnabled — do not
    // fire 13× GET /status 404s on first paint / hosted-looking localhost.
    if (!desktop && !helperOk) return;
    void refreshRunning();
    return () => {
      refreshGenRef.current += 1;
    };
  }, [desktop, helperOk, refreshRunning]);

  const toggleStopOnClose = async (enabled: boolean) => {
    setStopOnCloseState(enabled);
    setActionError(null);
    try {
      await setStopOnClose(enabled);
    } catch (err) {
      setStopOnCloseState(!enabled);
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopStack = async (key: DockerStackKey) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusyKey(key);
    setActionError(null);
    try {
      await stopDockerStack(key);
      markDockerStackStopped(key, setRunning);
      setStatusKnown((prev) => {
        const siblings = dockerStackSiblings(key);
        const next = new Set(prev);
        let changed = false;
        for (const sibling of siblings) {
          if (!next.has(sibling)) {
            next.add(sibling);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      // Compose may already be down (or Docker quit) — refresh so the row
      // does not stay on Stop until the next Settings visit.
      await refreshRunning();
    } finally {
      actionLockRef.current = false;
      setBusyKey(null);
    }
  };

  const handleStopAll = async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusyKey('all');
    setActionError(null);
    try {
      const ran = await stopAllStacks();
      if (!ran) {
        setActionError('Docker helper unavailable');
        await refreshRunning();
        return;
      }
      // Do not optimistic-clear: compose ls can return [] / a down can fail
      // while getStackStatus then returns null and the gate would lie.
      await refreshRunning();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      await refreshRunning();
    } finally {
      actionLockRef.current = false;
      setBusyKey(null);
    }
  };

  const handleRemoveImages = (key: DockerStackKey | null) => {
    const label = key ? DOCKER_STACK_LABELS[key] : 'all stacks';
    confirm(
      `Remove Docker images for ${label}? They will be re-downloaded the next time you start a lesson.`,
      () => {
        if (actionLockRef.current) return;
        void (async () => {
          actionLockRef.current = true;
          setBusyKey(key ? `rmi-${key}` : 'rmi-all');
          let removeError: string | null = null;
          try {
            await removeDockerImages(key);
          } catch (err) {
            removeError = err instanceof Error ? err.message : String(err);
          } finally {
            actionLockRef.current = false;
            setBusyKey(null);
          }
          try {
            setUsages(await getDockerImageSizes());
            setUsageError(removeError);
          } catch (err) {
            setUsageError(
              removeError ?? (err instanceof Error ? err.message : String(err)),
            );
          }
        })();
      },
      undefined,
      {
        title: 'Remove Docker images',
        confirmLabel: 'Remove',
        finalNote: '',
      },
    );
  };

  const handlePrepareUninstall = () => {
    confirm(
      'This will stop all running Docker stacks, remove their images, and delete Learning Hub Docker data.',
      () => {
        if (actionLockRef.current || uninstalling) return;
        void (async () => {
          actionLockRef.current = true;
          setUninstalling(true);
          setUninstallMessage(null);
          try {
            await prefetch.stopPrefetch();
            const report = await uninstallCleanup();
            if (report.errors.length > 0) {
              await refreshUsage();
              setUninstallMessage(
                `Cleanup finished with some errors:\n${report.errors.join('\n')}\n\nYou may need to stop remaining containers in Docker Desktop. Images could not be removed if Docker was not running.`,
              );
              await refreshRunning();
            } else {
              // Do not refreshUsage — that re-extracts the tree we just wiped.
              setUsages([]);
              setUsageError(null);
              DOCKER_STACK_KEYS.forEach((k) => setRunning(k, false));
              setUninstallDone(true);
            }
          } catch (err) {
            setUninstallMessage(err instanceof Error ? err.message : String(err));
          } finally {
            actionLockRef.current = false;
            setUninstalling(false);
          }
        })();
      },
      undefined,
      {
        title: 'Prepare to uninstall',
        confirmLabel: 'Continue',
        finalNote: 'Use this before deleting the Learning Hub app. Windows and Linux installers also wipe leftover stack files.',
      },
    );
  };

  const totalBytes = usages.reduce((sum, u) => sum + (u.imageBytes ?? 0), 0);
  const removalBlocked = (key: DockerStackKey) =>
    !statusKnown.has(key) || Boolean(dockerStackBlockedByRunning(key, running));
  const removeAllBlocked = DOCKER_STACK_KEYS.some((key) => {
    const bytes = usages.find((u) => u.stackKey === key)?.imageBytes ?? 0;
    if (bytes === 0) return false;
    return removalBlocked(key);
  });

  return (
    <div className="docker-settings" data-testid="docker-settings">
      <div className="settings-section">
        <h4>Docker stacks</h4>
        <p className="settings-section-desc">
          Lesson stacks started from the Learning Hub. Stopping a stack here also updates the lesson gate.
        </p>
        {!desktop && (
          <p className="docker-settings__web-note" data-testid="docker-settings-web-note">
            Start, stop, and logs work if you cloned this repo and run <code>npm run dev</code> on
            this machine. They are not available on the hosted demo or in a downloaded Learning Hub
            app (that app has its own Start Stack). Image download, remove, and uninstall stay in
            the desktop app.
          </p>
        )}
        {actionError && (
          <div className="docker-settings__error" data-testid="docker-settings-action-error">
            {actionError}
          </div>
        )}
        <div className="docker-settings__stack-list" data-testid="docker-settings-stack-list">
          {DOCKER_STACK_KEYS.map((key) => {
            const isRunning = running.has(key);
            const known = statusKnown.has(key);
            const dotClass = isRunning ? 'running' : known ? 'stopped' : 'checking';
            return (
              <div key={key} className="docker-settings__stack-row" data-testid={`docker-settings-row-${key}`}>
                <span
                  className={`docker-settings__stack-dot ${dotClass}`}
                  aria-hidden="true"
                />
                <span className="docker-settings__stack-name">{DOCKER_STACK_LABELS[key]}</span>
                {isRunning ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid={`docker-settings-stop-${key}`}
                    disabled={!canControl || uninstalling || busyKey != null || dockerStackStopBusy(key, busyKey)}
                    onClick={() => { void handleStopStack(key); }}
                  >
                    Stop
                  </button>
                ) : (
                  <span className="docker-settings__stack-idle">
                    {known ? 'Not running' : 'Checking…'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {running.size > 0 && (
          <button
            type="button"
            className="btn btn-sm docker-settings__stop-all"
            data-testid="docker-settings-stop-all"
            disabled={!canControl || uninstalling || busyKey != null}
            onClick={() => { void handleStopAll(); }}
          >
            Stop all running stacks
          </button>
        )}
      </div>

      <div className="settings-divider" />

      <div className="settings-section">
        <h4>Lesson images</h4>
        <p className="settings-section-desc">
          Pre-download compose images so the first Start Stack is faster (about 2 GB).
        </p>
        {prefetch.error && (
          <div className="docker-settings__error" data-testid="docker-settings-prefetch-error">
            {prefetch.error}
          </div>
        )}
        {(prefetch.running || prefetch.lines.length > 0) && (
          <pre className="docker-settings__prefetch-log" data-testid="docker-settings-prefetch-log">
            {prefetch.lines.join('\n') || 'Starting download…'}
          </pre>
        )}
        <button
          type="button"
          className="btn btn-sm"
          data-testid="docker-settings-prefetch"
          disabled={!desktop || (uninstalling && !prefetch.running) || (busyKey != null && !prefetch.running)}
          onClick={() => {
            if (prefetch.running) void prefetch.stopPrefetch();
            else void prefetch.startPrefetch();
          }}
        >
          {!desktop
            ? 'Download images…'
            : prefetch.running
              ? 'Cancel'
              : prefetch.choice === 'accepted'
                ? 'Resume'
                : 'Download images…'}
        </button>
      </div>

      <div className="settings-divider" />

      <div className="settings-section">
        <h4>Disk usage</h4>
        <p className="settings-section-desc">
          Image sizes for stacks that have been pulled. Shared images may appear in more than one row.
        </p>
        {usageLoading && (
          <div className="docker-settings__loading" data-testid="docker-settings-usage-loading">
            Loading disk usage…
          </div>
        )}
        {usageError && (
          <div className="docker-settings__error" data-testid="docker-settings-usage-error">
            {usageError}
          </div>
        )}
        {!usageLoading && (
          <table className="docker-settings__usage-table" data-testid="docker-settings-usage-table">
            <tbody>
              {DOCKER_STACK_KEYS.map((key) => {
                const usage = usages.find((u) => u.stackKey === key);
                const blockedBy = dockerStackBlockedByRunning(key, running);
                const unknown = !statusKnown.has(key);
                const bytes = usage?.imageBytes ?? 0;
                const label = blockedBy
                  ? '— (running)'
                  : (usage?.sizeLabel ?? '—');
                return (
                  <tr key={key} data-testid={`docker-settings-usage-${key}`}>
                    <td>{DOCKER_STACK_LABELS[key]}</td>
                    <td>{label}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={!desktop || uninstalling || Boolean(blockedBy) || unknown || bytes === 0 || busyKey != null || prefetch.running}
                        title={blockedBy ? 'Stop the stack before removing images' : unknown ? 'Confirm the stack is stopped before removing images' : undefined}
                        onClick={() => handleRemoveImages(key)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="docker-settings__usage-total">
                <td><strong>Total</strong></td>
                <td><strong>{totalBytes > 0 ? formatTotalBytes(totalBytes) : '—'}</strong></td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid="docker-settings-remove-all-images"
                    disabled={!desktop || uninstalling || totalBytes === 0 || removeAllBlocked || busyKey != null || prefetch.running}
                    onClick={() => handleRemoveImages(null)}
                  >
                    Remove all images
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="docker-settings__usage-note">
          Images are re-downloaded the next time you start a lesson. Running lessons are not affected.
        </p>
      </div>

      <div className="settings-divider" />

      <div className="settings-section">
        <h4>On app quit</h4>
        <p className="settings-section-desc">
          Choose what happens to lesson Docker stacks when you quit the desktop app.
        </p>
        <label
          className="docker-settings__pref-card"
          htmlFor="docker-settings-stop-on-close"
        >
          <input
            id="docker-settings-stop-on-close"
            type="checkbox"
            data-testid="docker-settings-stop-on-close"
            checked={stopOnClose}
            disabled={!desktop || uninstalling}
            onChange={(e) => { void toggleStopOnClose(e.target.checked); }}
          />
          <span className="docker-settings__pref-copy">
            <span className="docker-settings__pref-title">Stop running stacks</span>
            <span className="docker-settings__pref-hint">
              Frees ports and RAM when RedfireForge closes. Turn this off if you want
              stacks to keep running after you quit.
            </span>
          </span>
        </label>
      </div>

      <div className="settings-divider" />

      <div className="settings-section">
        <h4>Uninstall</h4>
        <p className="settings-section-desc">
          Use this before deleting the Learning Hub app (macOS Trash or AppImage).
          Windows and Linux installers also wipe leftover stack files.
        </p>
        {!uninstallDone ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            data-testid="docker-settings-uninstall"
            disabled={!desktop || uninstalling || busyKey != null}
            onClick={handlePrepareUninstall}
          >
            {uninstalling ? 'Cleaning up…' : 'Prepare to uninstall'}
          </button>
        ) : (
          <div className="docker-settings__uninstall-done" data-testid="docker-settings-uninstall-done">
            {uninstallMessage
              ? 'Cleanup finished with some issues. Review the notes below before removing the app.'
              : 'Cleanup complete. You can now remove the Learning Hub app.'}
          </div>
        )}
        {uninstallMessage && (
          <pre className="docker-settings__uninstall-errors" data-testid="docker-settings-uninstall-errors">
            {uninstallMessage}
          </pre>
        )}
      </div>
    </div>
  );
}

export default DockerStacksSettings;
