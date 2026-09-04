/**
 * PrerequisiteGate — shown before a Docker-dependent demo lesson can start.
 *
 * Displays the required `docker compose` command and polls the endpoint every
 * 3 seconds. Calls `onServerReady` the moment the server becomes reachable so
 * the parent (LessonPlayer) can enable its single "Start Demo →" footer button.
 * There is intentionally NO second button here — one CTA only.
 *
 * When `tabBudget` is set for a GraphQL Studio lesson, also checks that the
 * user has enough free tab slots (§11.0.7).
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { checkEndpoint } from '../utils/checkEndpoint';
import { deriveEndpointHostPort, deriveEndpointLabel } from '../utils/endpointLabel';
import { isTauri } from '@shared/utils/platform';
import {
  CLONE_MARKER,
  DOCKER_DESKTOP_INSTALL_URL,
  formatDockerCommandForHost,
  isWindowsHost,
  stripCertGenerationFromCommand,
  withRepoClonePreamble,
} from '../utils/dockerCommandDisplay';
import {
  lessonWantsComposeBuild,
  resolveExtractedDockerStackPath,
  injectComposeProjectFlag,
  rewriteDockerCommandPath,
} from '../utils/dockerStack';
import type { DockerStackKey } from '../types';
import { useLocalDockerHelper } from '../hooks/useLocalDockerHelper';
import DockerStackControls from './DockerStackControls';
import {
  countUserTabsInStorage,
  MAX_TABS,
  userTabsToCloseForLesson,
} from '../adapters';

interface PrerequisiteGateProps {
  /** WS or HTTP URL to probe (e.g. ws://localhost:3100/socket.io/?EIO=4). Legacy single-endpoint lessons. */
  endpoint?: string;
  /** All endpoints that must be reachable. When set, every probe must succeed. */
  endpoints?: string[];
  /** Optional friendly names parallel to `endpoints` (e.g. ["Docker echo", "Express proxy"]). */
  endpointLabels?: string[];
  /** Human-readable docker compose command to display */
  dockerCommand: string;
  /** When set on desktop, the command is rewritten to the extracted stack dir. */
  stackKey?: DockerStackKey;
  /** Optional gate title (default: Docker Required). */
  gateLabel?: string;
  /** Called once when the server first becomes reachable — parent uses this to enable Start Demo */
  onServerReady: () => void;
  /** Called when a previously cleared gate finds endpoints down again (Settings Stop / Docker quit). */
  onServerLost?: () => void;
  /** Fires after every probe with the friendly names of services still unreachable (empty when all up). */
  onProbeStatusChange?: (downLabels: string[]) => void;
  /** GraphQL Studio tab slots this lesson reserves (§11.0). Omit when not a studio lesson. */
  tabBudget?: number;
  /** Called once when the user has closed enough tabs for this lesson. */
  onTabCapacityReady?: () => void;
  /** When true, the gate starts in 'up' and re-verifies once, then keeps the 3s probe. */
  initiallyCleared?: boolean;
}

type ProbeState = 'idle' | 'checking' | 'up' | 'down';
type TabCapacityState = 'idle' | 'checking' | 'ok' | 'blocked';

export default function PrerequisiteGate({
  endpoint,
  endpoints,
  endpointLabels,
  dockerCommand,
  stackKey,
  gateLabel = '🐳 Docker Required',
  onServerReady,
  onServerLost,
  onProbeStatusChange,
  tabBudget,
  onTabCapacityReady,
  initiallyCleared,
}: PrerequisiteGateProps) {
  const probeEndpoints = useMemo(
    () => (endpoints?.length ? endpoints : endpoint ? [endpoint] : []),
    [endpoints, endpoint],
  );
  const probeLabels = useMemo(
    () => probeEndpoints.map((url, i) => endpointLabels?.[i] ?? deriveEndpointLabel(url)),
    [probeEndpoints, endpointLabels],
  );
  const { helperOk } = useLocalDockerHelper();
  const showDockerControls = Boolean(stackKey && (isTauri() || helperOk));
  const [probeState, setProbeState] = useState<ProbeState>(initiallyCleared ? 'up' : 'idle');
  const [serviceStates, setServiceStates] = useState<ProbeState[]>([]);
  const [tabCapacityState, setTabCapacityState] = useState<TabCapacityState>('idle');
  const [tabsToClose, setTabsToClose] = useState(0);
  const [copied, setCopied] = useState(false);
  const [extractedPath, setExtractedPath] = useState<string | null>(null);
  // Web never has an extracted stack path — show the clone preamble on first paint
  // (do not wait for the desktop resolve, which would flash compose-only first).
  const [pathResolved, setPathResolved] = useState(!stackKey || !isTauri());
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const notifiedRef = useRef(initiallyCleared ?? false);
  const tabNotifiedRef = useRef(false);
  const budget = tabBudget ?? 1;
  const needsTabGate = budget > 0 && Boolean(onTabCapacityReady);
  const showServiceBreakdown = probeEndpoints.length > 1;
  useEffect(() => {
    let cancelled = false;
    if (!stackKey || !isTauri()) {
      setExtractedPath(null);
      setPathResolved(true);
      return;
    }
    setPathResolved(false);
    void resolveExtractedDockerStackPath(stackKey)
      .then((path) => {
        if (!cancelled) setExtractedPath(path);
      })
      .catch(() => {
        if (!cancelled) setExtractedPath(null);
      })
      .finally(() => {
        if (!cancelled) setPathResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stackKey]);

  const commandPending = Boolean(stackKey && isTauri() && !pathResolved);

  const displayedCommand = useMemo(() => {
    const composeOnly = stripCertGenerationFromCommand(dockerCommand);
    const raw = extractedPath
      ? rewriteDockerCommandPath(composeOnly, extractedPath)
      // Avoid a clone-preamble flash while the desktop path is resolving.
      : !pathResolved
        ? composeOnly
        : withRepoClonePreamble(composeOnly);
    const withProject = stackKey ? injectComposeProjectFlag(raw, stackKey) : raw;
    return formatDockerCommandForHost(withProject);
  }, [dockerCommand, extractedPath, pathResolved, stackKey]);

  useEffect(() => {
    setCopied(false);
    if (copiedResetRef.current) {
      clearTimeout(copiedResetRef.current);
      copiedResetRef.current = null;
    }
  }, [displayedCommand]);

  const copyCommand = useCallback(async () => {
    try {
      if (commandPending || !navigator.clipboard?.writeText) {
        setCopied(false);
        return;
      }
      await navigator.clipboard.writeText(displayedCommand);
      setCopied(true);
      if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
      copiedResetRef.current = setTimeout(() => {
        setCopied(false);
        copiedResetRef.current = null;
      }, 2000);
    } catch {
      setCopied(false);
    }
  }, [commandPending, displayedCommand]);

  const checkTabCapacity = useCallback(async () => {
    if (!needsTabGate || !mountedRef.current) return;
    // Keep last known blocked/ok state during re-checks — avoid a 3s flicker
    // of the tab-capacity banner while the async count runs.
    setTabCapacityState((prev) => (prev === 'idle' ? 'checking' : prev));
    const userCount = await countUserTabsInStorage();
    const toClose = userTabsToCloseForLesson(userCount, budget);
    if (!mountedRef.current) return;
    setTabsToClose(toClose);
    if (toClose === 0) {
      setTabCapacityState('ok');
      if (!tabNotifiedRef.current) {
        tabNotifiedRef.current = true;
        onTabCapacityReady?.();
      }
    } else {
      setTabCapacityState('blocked');
    }
  }, [budget, needsTabGate, onTabCapacityReady]);

  const probe = useCallback(async () => {
    if (!mountedRef.current || probeEndpoints.length === 0) return;
    // Only show "Checking…" on the first probe (idle → checking). Subsequent
    // polls must keep the last known status (usually "down") so the Concept
    // page does not flash ✗ → ⏳ → ✗ every 3 seconds while Docker is offline.
    setProbeState((prev) => (prev === 'idle' ? 'checking' : prev));
    const results = await Promise.all(
      probeEndpoints.map((url) => checkEndpoint(url, 6000)),
    );
    const ok = results.every(Boolean);
    if (!mountedRef.current) return;
    setServiceStates(results.map((up) => (up ? 'up' : 'down')));
    setProbeState(ok ? 'up' : 'down');
    onProbeStatusChange?.(
      probeLabels.filter((_, i) => !results[i]),
    );
    if (ok) {
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        onServerReady();
      }
      return;
    }
    // Keep polling after a clear so Settings Stop / Docker quit disable Start Demo.
    if (notifiedRef.current) {
      notifiedRef.current = false;
      onServerLost?.();
    }
  }, [probeEndpoints, probeLabels, onServerReady, onServerLost, onProbeStatusChange]);

  useEffect(() => {
    mountedRef.current = true;
    if (initiallyCleared) {
      // Previously confirmed — do a single silent re-verification without visual flicker.
      // If the server went down since last session, reset to polling mode.
      notifiedRef.current = true;
      // Seed per-service rows as up immediately. Otherwise serviceStates stays []
      // and the breakdown shows "checking…" under "Server detected — ready to start".
      setServiceStates(probeEndpoints.map(() => 'up' as ProbeState));
      let cancelled = false;
      void (async () => {
        if (probeEndpoints.length === 0) return;
        const results = await Promise.all(
          probeEndpoints.map((url) => checkEndpoint(url, 6000)),
        );
        if (cancelled) return;
        setServiceStates(results.map((up) => (up ? 'up' : 'down')));
        if (!results.every(Boolean)) {
          // Server went down — reset state and start polling.
          notifiedRef.current = false;
          setProbeState('down');
          onProbeStatusChange?.(
            probeLabels.filter((_, i) => !results[i]),
          );
          onServerLost?.();
        }
        if (!cancelled) {
          intervalRef.current = setInterval(() => { void probe(); }, 3000);
        }
      })();
      void checkTabCapacity();
      return () => {
        cancelled = true;
        mountedRef.current = false;
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
      };
    }
    notifiedRef.current = false;
    tabNotifiedRef.current = false;
    void probe();
    void checkTabCapacity();
    intervalRef.current = setInterval(() => {
      void probe();
      void checkTabCapacity();
    }, 3000);
    return () => {
      mountedRef.current = false;
      clearInterval(intervalRef.current!);
      if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    };
  }, [probe, checkTabCapacity, initiallyCleared, probeEndpoints, onServerLost, onProbeStatusChange, probeLabels]);

  const statusIcon = {
    idle:     '⏳',
    checking: '⏳',
    up:       '✓',
    down:     '✗',
  }[probeState];

  const statusLabel = {
    idle:     'Checking…',
    checking: 'Checking…',
    up:       'Server detected — ready to start',
    down:     probeEndpoints.length > 1
      ? 'Required services not detected — complete the setup below'
      : 'Server not detected — start the container below',
  }[probeState];

  return (
    <div className="prereq-gate" data-testid="prereq-gate">
      <div className="prereq-gate-header">
        <span className="prereq-gate-label">{gateLabel}</span>
        {probeState === 'checking' && (
          <span className="prereq-spinner" aria-label="Checking server…" />
        )}
      </div>

      <div className={`prereq-status prereq-status--${probeState}`} data-testid="prereq-status">
        <span className="prereq-status-icon" aria-hidden="true">{statusIcon}</span>
        <span className="prereq-status-label">{statusLabel}</span>
      </div>

      {showServiceBreakdown && (
        <ul className="prereq-service-list" data-testid="prereq-service-list">
          {probeEndpoints.map((url, i) => {
            const state = serviceStates[i] ?? 'checking';
            const icon = state === 'up' ? '✓' : state === 'down' ? '✗' : '⏳';
            const stateLabel = state === 'up'
              ? 'reachable'
              : state === 'down'
                ? 'not detected'
                : 'checking…';
            return (
              <li
                key={url}
                className={`prereq-service prereq-service--${state}`}
                data-testid="prereq-service"
              >
                <span className="prereq-service-icon" aria-hidden="true">{icon}</span>
                <span className="prereq-service-name">{probeLabels[i]}</span>
                <span className="prereq-service-host">{deriveEndpointHostPort(url)}</span>
                <span className="prereq-service-state">{stateLabel}</span>
              </li>
            );
          })}
        </ul>
      )}

      {showDockerControls && stackKey && (
        <DockerStackControls
          stackKey={stackKey}
          buildOnStart={lessonWantsComposeBuild(dockerCommand)}
        />
      )}

      <div className="prereq-instruction">
        <p className="prereq-instruction-title">
          {showDockerControls
            ? 'Or run this command in a terminal:'
            : 'Run this command in a terminal:'}
        </p>
        <div className="prereq-command-wrapper">
          <pre
            className={`prereq-command${commandPending ? ' prereq-command--pending' : ''}`}
            data-testid="prereq-command"
            aria-busy={commandPending}
          >
            <code>{commandPending ? 'Resolving stack path…' : displayedCommand}</code>
          </pre>
          <button
            type="button"
            className="prereq-copy-btn"
            data-testid="prereq-copy-btn"
            disabled={commandPending}
            onClick={() => { void copyCommand(); }}
            aria-label={commandPending ? 'Resolving stack path' : 'Copy command to clipboard'}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="prereq-sr-only" aria-live="polite">
            {copied ? 'Command copied to clipboard' : ''}
          </span>
        </div>
        {isWindowsHost() && displayedCommand.includes(CLONE_MARKER) && (
          <p className="prereq-stack-hint" data-testid="prereq-windows-paste-hint">
            Paste this into PowerShell — Command Prompt does not treat # as a comment.
          </p>
        )}
        <p className="prereq-docker-hint" data-testid="prereq-docker-hint">
          Don't have Docker Desktop?{' '}
          <a
            href={DOCKER_DESKTOP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Install it free →
          </a>
          {' '}A restart may be required after installing on Windows.
        </p>
        <p className="prereq-instruction-note">
          This page will detect when all required services are reachable — the Start Demo button below will unlock.
        </p>
      </div>

      {needsTabGate && tabCapacityState === 'blocked' && (
        <div className="prereq-tab-capacity" data-testid="prereq-tab-capacity">
          <p className="prereq-tab-capacity-title">
            This lesson needs {budget} workspace tab slot{budget > 1 ? 's' : ''}.
          </p>
          <p className="prereq-tab-capacity-note">
            Close at least <strong>{tabsToClose}</strong> tab{tabsToClose > 1 ? 's' : ''} in GraphQL
            Studio (max {MAX_TABS - budget} user tabs while this lesson runs).
          </p>
        </div>
      )}

      {needsTabGate && tabCapacityState === 'ok' && tabsToClose === 0 && budget > 1 && (
        <div className="prereq-tab-capacity prereq-tab-capacity--ok" data-testid="prereq-tab-capacity-ok">
          <span className="prereq-status-icon" aria-hidden="true">✓</span>
          <span>Enough tab slots available for this lesson.</span>
        </div>
      )}
    </div>
  );
}
