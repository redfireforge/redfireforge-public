import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@shared/utils/platform';
import type { DockerStackKey } from '../types';
import { getStackLogs, useDockerStacks } from '../stores/dockerStackStore';
import { dockerStackSiblings, markDockerStackStopped } from '../utils/dockerStack';
import { useLocalDockerHelper } from './useLocalDockerHelper';
import { certExpiryFromIsoDate } from '../utils/localDockerApi';
import {
  checkDockerState,
  daemonStateFromStartFailed,
  getDockerAvailableMemoryMb,
  getStackManifest,
  getStackStatus,
  listenDockerLogs,
  listenDockerLowMemory,
  openDockerDesktop,
  parseLastRunLogText,
  parsePortConflictDetail,
  parseStackLimitKeys,
  parseStartError,
  readLastRunLog,
  startDockerStack,
  stopDockerStack,
  triggerAppUpdateCheck,
  type CertExpiryStatus,
  type DockerDaemonState,
  type LowMemoryWarning,
  type PortConflictEntry,
} from '../utils/dockerStackApi';

export const CERT_WARN_DAYS = 90;

export type DockerControlState =
  | 'checking'
  | 'not-installed'
  | 'not-running'
  | 'outdated-compose'
  | 'stack-stopped'
  | 'stack-starting'
  | 'stack-running'
  | 'start-failed'
  | 'port-conflict'
  | 'stack-limit-reached'
  | 'oom-killed';

export interface UseDockerStackResult {
  ready: boolean;
  daemon: DockerDaemonState | null;
  controlState: DockerControlState;
  certExpiry: CertExpiryStatus | null;
  certReady: boolean;
  certExpired: boolean;
  certExpiring: boolean;
  lowMemory: LowMemoryWarning | null;
  otherRunning: DockerStackKey[];
  logs: string[];
  logsHydrated: boolean;
  logsOpen: boolean;
  setLogsOpen: (open: boolean) => void;
  conflictPorts: string;
  conflictEntries: PortConflictEntry[];
  limitKeys: DockerStackKey[];
  oomRecommendedMb: number | null;
  startStack: () => Promise<void>;
  stopStack: () => Promise<void>;
  stopBusy: boolean;
  stopLimitStack: (key: DockerStackKey) => Promise<void>;
  openDesktop: () => Promise<void>;
  checkUpdates: () => Promise<void>;
}

export function useDockerStack(
  stackKey: DockerStackKey | undefined,
  opts?: { buildOnStart?: boolean },
): UseDockerStackResult {
  const { setRunning, isRunning, running, appendLog, clearLogs, replaceLogs, otherRunning, stackLogs } = useDockerStacks();
  const [daemon, setDaemon] = useState<DockerDaemonState | null>(null);
  const [controlState, setControlState] = useState<DockerControlState>('checking');
  const [certExpiry, setCertExpiry] = useState<CertExpiryStatus | null>(null);
  const [certReady, setCertReady] = useState(!isTauri());
  const [lowMemory, setLowMemory] = useState<LowMemoryWarning | null>(null);
  const [memorySpec, setMemorySpec] = useState<{ stackKey: DockerStackKey; min: number } | null>(null);
  const memGenRef = useRef(0);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsHydrated, setLogsHydrated] = useState(!isTauri());
  const [conflictPorts, setConflictPorts] = useState('');
  const [conflictEntries, setConflictEntries] = useState<PortConflictEntry[]>([]);
  const [limitKeys, setLimitKeys] = useState<DockerStackKey[]>([]);
  const [oomRecommendedMb, setOomRecommendedMb] = useState<number | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const actionLockRef = useRef(false);
  const hadLimitKeysRef = useRef(false);
  const controlStateRef = useRef<DockerControlState>(controlState);
  controlStateRef.current = controlState;
  const hydrateGenRef = useRef(0);
  const externalStopGenRef = useRef(0);
  const storeKeyRef = useRef<DockerStackKey | undefined>(undefined);
  const wasStoreRunningRef = useRef(false);
  const f3SeenRunningRef = useRef<Set<DockerStackKey>>(new Set());
  const { helperOk } = useLocalDockerHelper();
  const ready = Boolean(stackKey && (isTauri() || helperOk));

  const waitingForDaemon = (state: DockerControlState) =>
    state === 'checking'
    || state === 'not-installed'
    || state === 'not-running'
    || state === 'outdated-compose'
    || state === 'stack-stopped'
    || state === 'stack-running';

  const isStartOutcome = (state: DockerControlState) =>
    state === 'stack-starting'
    || state === 'start-failed'
    || state === 'port-conflict'
    || state === 'stack-limit-reached'
    || state === 'oom-killed';

  const isBlockedDaemonState = (state: DockerControlState) =>
    state === 'not-installed'
    || state === 'not-running'
    || state === 'outdated-compose';

  const applyBlockedDaemon = (state: DockerDaemonState): boolean => {
    if (state === 'notInstalled') {
      setDaemon(state);
      setControlState('not-installed');
      return true;
    }
    if (state === 'notRunning') {
      setDaemon(state);
      setControlState('not-running');
      return true;
    }
    if (state === 'outdatedCompose') {
      setDaemon(state);
      setControlState('outdated-compose');
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!ready || !stackKey) {
      setLogsHydrated(true);
      return;
    }
    const gen = ++hydrateGenRef.current;
    const existingCount = getStackLogs(stackKey).length;
    setLogsHydrated(existingCount > 0);
    let cancelled = false;
    void readLastRunLog(stackKey)
      .then((content) => {
        if (cancelled || gen !== hydrateGenRef.current) return;
        const lines = parseLastRunLogText(content);
        const current = getStackLogs(stackKey);
        // File can grow while this lesson is unmounted (Settings → Stop).
        // Never replace a longer live buffer with a shorter file.
        if (lines.length > current.length) replaceLogs(stackKey, lines);
      })
      .finally(() => {
        if (!cancelled && gen === hydrateGenRef.current) {
          setLogsHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, stackKey, replaceLogs]);

  useEffect(() => {
    if (!ready || !stackKey) return;
    let cancelled = false;
    let inFlight = false;

    const applyDaemon = async () => {
      // GET /state?running=0 waits on docker info only. Overlapping 3s polls
      // pile up and a late failure can overwrite a newer reading.
      if (inFlight) return false;
      inFlight = true;
      try {
        const stopGen = externalStopGenRef.current;
        const abandonIfExternallyStopped = () => {
          if (externalStopGenRef.current === stopGen) return false;
          setRunning(stackKey, false);
          if (
            !isStartOutcome(controlStateRef.current)
            && !isBlockedDaemonState(controlStateRef.current)
          ) {
            setControlState('stack-stopped');
          }
          return true;
        };
        const state = await checkDockerState();
        if (cancelled) return false;
        if (abandonIfExternallyStopped()) return true;
        // A late daemon probe must not wipe F3 / F2 / OOM / start-failed / starting.
        if (isStartOutcome(controlStateRef.current)) {
          if (state) setDaemon(state);
          return true;
        }
        if (!state) {
          // null = probe failed (helper/network/invoke) — not Docker Desktop down.
          setDaemon(null);
          // Stay on a known gate. Dropping to `checking` disables Start
          // (State C) / Open Docker Desktop (State B), and a later flaky
          // `compose ps` can mark a live stack stopped.
          if (
            isStartOutcome(controlStateRef.current)
            || isBlockedDaemonState(controlStateRef.current)
            || controlStateRef.current === 'stack-running'
            || controlStateRef.current === 'stack-stopped'
          ) {
            return false;
          }
          setControlState('checking');
          return false;
        }
        if (applyBlockedDaemon(state)) {
          // Docker quit during State E — do not leave Stop enabled.
          setRunning(stackKey, false);
          return false;
        }
        setDaemon(state);
        // State E: docker-info only. A flaky compose ps would look like a crash.
        if (controlStateRef.current === 'stack-running') {
          return true;
        }
        const status = await getStackStatus(stackKey);
        if (cancelled) return false;
        if (isStartOutcome(controlStateRef.current)) {
          return true;
        }
        if (abandonIfExternallyStopped()) return true;
        // `null` is a failed probe — do not pretend the stack is stopped
        // (that offered Start on a live stack / a third slot). Stay on
        // checking so the 3s interval retries. An explicit `false` wins
        // over a stale in-memory running flag (crashed / stopped elsewhere).
        if (status === true) {
          setRunning(stackKey, true);
          setControlState('stack-running');
        } else if (status === false) {
          setRunning(stackKey, false);
          setControlState('stack-stopped');
        } else if (isRunning(stackKey)) {
          setControlState('stack-running');
        }
        return true;
      } finally {
        inFlight = false;
      }
    };

    void applyDaemon();

    // State B / C / E: keep probing the daemon (State E is docker-info only).
    const interval = window.setInterval(() => {
      if (cancelled || !waitingForDaemon(controlStateRef.current)) return;
      void applyDaemon();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ready, stackKey, isRunning, setRunning]);

  // Settings Stop / Stale Restart write the shared store. applyDaemon only
  // re-runs while waiting on the daemon, so the lesson gate must follow
  // this key's running flag — including a Stop that lands during the
  // first status probe (do not wait until we leave `checking`).
  useEffect(() => {
    if (!ready || !stackKey) {
      storeKeyRef.current = undefined;
      wasStoreRunningRef.current = false;
      return;
    }
    if (storeKeyRef.current !== stackKey) {
      storeKeyRef.current = stackKey;
      wasStoreRunningRef.current = running.has(stackKey);
      return;
    }
    const up = running.has(stackKey);
    if (wasStoreRunningRef.current && !up) {
      externalStopGenRef.current += 1;
      // Stop-after-quit already mapped to State A / B / B2 — do not overwrite.
      if (!isStartOutcome(controlStateRef.current) && !isBlockedDaemonState(controlStateRef.current)) {
        setControlState('stack-stopped');
      }
      // Settings Stop writes last-run but does not call this hook's stopStack.
      const key = stackKey;
      const gen = ++hydrateGenRef.current;
      void readLastRunLog(key).then((content) => {
        if (hydrateGenRef.current !== gen) return;
        const lines = parseLastRunLogText(content);
        const current = getStackLogs(key);
        if (lines.length > current.length) replaceLogs(key, lines);
      });
    } else if (up && controlStateRef.current === 'stack-stopped') {
      setControlState('stack-running');
    }
    wasStoreRunningRef.current = up;
  }, [ready, stackKey, running, replaceLogs]);

  useEffect(() => {
    if (!ready || !stackKey) {
      setCertReady(true);
      setMemorySpec(null);
      return;
    }
    setCertReady(false);
    setCertExpiry(null);
    setLowMemory(null);
    setMemorySpec(null);
    let cancelled = false;
    let interval: number | undefined;

    const run = async (): Promise<boolean> => {
      let probeKnown = false;
      try {
        // One manifest read. checkCertExpiry on web is a second GET /manifest
        // (and on desktop a second invoke) — derive UTC days here instead.
        // Do not wait on GET /memory (`docker info`, up to 10s).
        const manifest = await getStackManifest(stackKey);
        if (cancelled) return true;
        const cert = manifest ? certExpiryFromIsoDate(manifest.certExpiresAt) : null;
        if (cert) {
          setCertExpiry(cert);
          probeKnown = true;
        } else if (manifest?.certExpiresAt) {
          // Unreadable date on a TLS stack — keep Start disabled.
          // Do not fake daysRemaining 0 (that showed State H for a valid cert).
          probeKnown = false;
        } else if (manifest) {
          probeKnown = true;
        } else {
          // Manifest unknown — do not treat that as non-TLS.
          probeKnown = false;
        }
        const min = manifest?.minMemoryMb ?? null;
        setMemorySpec((prev) => {
          if (min == null) return null;
          if (prev && prev.stackKey === stackKey && prev.min === min) return prev;
          return { stackKey, min };
        });
        if (min == null) setLowMemory(null);
      } finally {
        if (!cancelled) setCertReady(probeKnown);
      }
      return probeKnown;
    };

    void run().then((known) => {
      if (cancelled || known) return;
      interval = window.setInterval(() => {
        void run().then((ok) => {
          if (ok && interval != null) {
            window.clearInterval(interval);
            interval = undefined;
          }
        });
      }, 3000);
    });
    return () => {
      cancelled = true;
      if (interval != null) window.clearInterval(interval);
    };
  }, [ready, stackKey]);

  // Banner is advisory before Start. Skip docker info while Desktop is down
  // (State B) and re-probe once the daemon is running.
  useEffect(() => {
    if (
      !ready
      || !stackKey
      || memorySpec == null
      || memorySpec.stackKey !== stackKey
      || daemon !== 'running'
    ) {
      if (memorySpec == null || memorySpec.stackKey !== stackKey || daemon !== 'running') {
        setLowMemory(null);
      }
      return;
    }
    const min = memorySpec.min;
    let cancelled = false;
    const thisMem = ++memGenRef.current;
    void getDockerAvailableMemoryMb()
      .then((avail) => {
        if (cancelled || thisMem !== memGenRef.current) return;
        if (avail != null) {
          setLowMemory(avail < min ? { availableMb: avail, recommendedMb: min } : null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, stackKey, memorySpec, daemon]);

  useEffect(() => {
    if (!ready || !stackKey) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const ac = new AbortController();
    const attachLogs = () =>
      listenDockerLogs((event) => {
        if (event.stackKey === stackKey) appendLog(stackKey, event.line);
      }, ac.signal).then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      });
    void attachLogs().catch(() => {
      if (cancelled || ac.signal.aborted) return;
      void attachLogs().catch(() => {});
    });
    return () => {
      cancelled = true;
      ac.abort();
      unlisten?.();
    };
  }, [ready, stackKey, appendLog]);

  useEffect(() => {
    if (controlState === 'stack-limit-reached' && limitKeys.length === 0 && hadLimitKeysRef.current) {
      setControlState('stack-stopped');
      hadLimitKeysRef.current = false;
      return;
    }
    if (limitKeys.length > 0) hadLimitKeysRef.current = true;
  }, [controlState, limitKeys]);

  // Settings Stop writes the store but does not call stopLimitStack. Drop an
  // F3 key only when we saw that project running during this F3 display —
  // do not treat “never in the store” as stopped (Rust still listed it).
  useEffect(() => {
    if (controlState !== 'stack-limit-reached') {
      f3SeenRunningRef.current.clear();
      return;
    }
    for (const key of running) {
      f3SeenRunningRef.current.add(key);
    }
    setLimitKeys((prev) => {
      const next = prev.filter((key) => {
        const siblings = dockerStackSiblings(key);
        const sawWhileF3 = siblings.some((s) => f3SeenRunningRef.current.has(s));
        const stillUp = siblings.some((s) => running.has(s));
        return !(sawWhileF3 && !stillUp);
      });
      return next.length === prev.length ? prev : next;
    });
  }, [controlState, running]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const attachLowMemory = () =>
      listenDockerLowMemory((event) => {
        if (!event.stackKey || event.stackKey === stackKey) {
          setLowMemory(event);
        }
      }).then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      });
    void attachLowMemory().catch(() => {
      if (cancelled) return;
      void attachLowMemory().catch(() => {});
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ready, stackKey]);

  const startStack = useCallback(async () => {
    if (!stackKey || actionLockRef.current) return;
    actionLockRef.current = true;
    hadLimitKeysRef.current = false;
    const startGen = ++hydrateGenRef.current;
    const applyLastRunIfLonger = async () => {
      if (hydrateGenRef.current !== startGen) return;
      const content = await readLastRunLog(stackKey);
      if (hydrateGenRef.current !== startGen) return;
      const lines = parseLastRunLogText(content);
      const current = getStackLogs(stackKey);
      // Spawn ENOENT restores the previous file after SSE already sent
      // `=== Starting`. Empty-only restore left Show logs on that one line.
      if (lines.length > current.length) replaceLogs(stackKey, lines);
    };
    setLogsHydrated(true);
    setControlState('stack-starting');
    clearLogs(stackKey);
    setLogsOpen(true);
    setConflictEntries([]);
    setConflictPorts('');
    setLimitKeys([]);
    let restorePreviousRun = false;
    try {
      try {
        if (opts?.buildOnStart) {
          await startDockerStack(stackKey, { build: true });
        } else {
          await startDockerStack(stackKey);
        }
        setRunning(stackKey, true);
        setControlState('stack-running');
      } catch (err) {
        const message = typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : (err && typeof err === 'object' && 'message' in err)
              ? String((err as { message: unknown }).message)
              : String(err);
        const parsed = parseStartError(message);
        if (parsed.kind === 'port-conflict') {
          const entries = parsePortConflictDetail(parsed.detail);
          setConflictEntries(entries);
          setConflictPorts(entries.map((e) => String(e.port)).join(', '));
          setControlState('port-conflict');
          restorePreviousRun = true;
        } else if (parsed.kind === 'stack-limit') {
          setLimitKeys(parseStackLimitKeys(parsed.detail));
          setControlState('stack-limit-reached');
          restorePreviousRun = true;
        } else if (parsed.kind === 'oom-killed') {
          const n = Number(parsed.detail);
          setOomRecommendedMb(Number.isFinite(n) ? n : null);
          setControlState('oom-killed');
        } else if (parsed.kind === 'cert-expired') {
          setCertExpiry({
            expiresAt: parsed.detail || null,
            daysRemaining: 0,
          });
          setCertReady(true);
          setControlState('stack-stopped');
        } else if (parsed.kind === 'start-cancelled') {
          markDockerStackStopped(stackKey, setRunning);
          setControlState('stack-stopped');
        } else if (parsed.kind === 'start-failed') {
          const daemonFromStart = daemonStateFromStartFailed(parsed.detail);
          if (!daemonFromStart || !applyBlockedDaemon(daemonFromStart)) {
            setControlState('start-failed');
          }
        } else {
          setControlState('start-failed');
        }
        setLogsOpen(true);
      }
    } finally {
      // Release before last-run restore so Retry is not blocked on a hung read.
      actionLockRef.current = false;
    }
    // PORT_CONFLICT / STACK_LIMIT return before truncate — restore the previous
    // file so Start's clearLogs does not blank Show logs in this session.
    if (restorePreviousRun) {
      await applyLastRunIfLonger();
    }
    // start-failed / success persist this attempt. If docker-log was not
    // subscribed yet the store can still be empty — fill from the file.
    void applyLastRunIfLonger();
  }, [stackKey, opts?.buildOnStart, setRunning, clearLogs, replaceLogs]);

  const stopStack = useCallback(async () => {
    if (!stackKey || actionLockRef.current) return;
    actionLockRef.current = true;
    const stopGen = ++hydrateGenRef.current;
    setStopBusy(true);
    setLogsOpen(true);
    try {
      await stopDockerStack(stackKey);
      markDockerStackStopped(stackKey, setRunning);
      setControlState('stack-stopped');
    } catch {
      // Docker quit during State E — compose down fails; show A / B / B2 not Stop.
      const state = await checkDockerState();
      if (state && applyBlockedDaemon(state)) {
        markDockerStackStopped(stackKey, setRunning);
      } else {
        setControlState('stack-running');
      }
    } finally {
      actionLockRef.current = false;
      setStopBusy(false);
    }
    // Settings / a dropped EventSource can miss === Stack stopped ===.
    const content = await readLastRunLog(stackKey);
    if (hydrateGenRef.current !== stopGen) return;
    const lines = parseLastRunLogText(content);
    const current = getStackLogs(stackKey);
    if (lines.length > current.length) replaceLogs(stackKey, lines);
  }, [stackKey, setRunning, replaceLogs]);

  const stopLimitStack = useCallback(async (key: DockerStackKey) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setStopBusy(true);
    setLogsOpen(true);
    try {
      await stopDockerStack(key);
      markDockerStackStopped(key, setRunning);
      const siblings = dockerStackSiblings(key);
      setLimitKeys((prev) => prev.filter((k) => !siblings.includes(k)));
    } catch {
      const state = await checkDockerState();
      if (state && applyBlockedDaemon(state)) {
        markDockerStackStopped(key, setRunning);
        setLimitKeys([]);
      }
    } finally {
      actionLockRef.current = false;
      setStopBusy(false);
    }
  }, [setRunning]);

  const days = certExpiry?.daysRemaining;
  const certExpired = days != null && days <= 0;
  const certExpiring = days != null && days > 0 && days <= CERT_WARN_DAYS;

  return {
    ready,
    daemon,
    controlState,
    certExpiry,
    certReady,
    certExpired,
    certExpiring,
    lowMemory,
    otherRunning: stackKey ? otherRunning(stackKey) : [],
    logs: stackKey ? (stackLogs[stackKey] ?? []) : [],
    logsHydrated,
    logsOpen,
    setLogsOpen,
    conflictPorts,
    conflictEntries,
    limitKeys,
    oomRecommendedMb,
    startStack,
    stopStack,
    stopBusy,
    stopLimitStack,
    openDesktop: openDockerDesktop,
    checkUpdates: triggerAppUpdateCheck,
  };
}
