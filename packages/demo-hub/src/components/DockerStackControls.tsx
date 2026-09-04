import { DOCKER_DESKTOP_INSTALL_URL, isWindowsHost } from '../utils/dockerCommandDisplay';
import type { DockerStackKey } from '../types';
import { useDockerStack } from '../hooks/useDockerStack';
import { requestOpenDockerSettings } from '../utils/dockerSettingsNav';
import { DOCKER_STACK_LABELS, MAX_CONCURRENT_DOCKER_STACKS, formatOtherRunningStacks } from '../utils/dockerStack';
import { formatPortConflictCopy, type PortConflictEntry } from '../utils/dockerStackApi';

function PortConflictMessage({
  entries,
  fallbackPorts,
}: {
  entries: PortConflictEntry[];
  fallbackPorts: string;
}) {
  const fromFallback = fallbackPorts
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((port) => Number.isFinite(port) && port > 0)
    .map((port) => ({ port }));
  const copy = formatPortConflictCopy(entries.length > 0 ? entries : fromFallback);
  if (copy.lines.length === 0) {
    return 'A required port is already in use. Free it and click Retry.';
  }
  if (copy.lines.length > 1) {
    return (
      <>
        <ul className="prereq-port-conflict-list">
          {copy.lines.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
        {copy.retry}
      </>
    );
  }
  return `${copy.lines[0] ?? `Port ${fallbackPorts} is already in use.`} ${copy.retry}`;
}

const MEMORY_DOCS_URL = 'https://docs.docker.com/desktop/settings/resources/';

interface DockerStackControlsProps {
  stackKey: DockerStackKey;
  buildOnStart?: boolean;
}

export default function DockerStackControls({ stackKey, buildOnStart }: DockerStackControlsProps) {
  const s = useDockerStack(stackKey, { buildOnStart });
  const startDisabled =
    !s.certReady
    || s.certExpired
    || s.controlState === 'not-installed'
    || s.controlState === 'not-running'
    || s.controlState === 'outdated-compose'
    || s.controlState === 'stack-starting'
    || s.controlState === 'stack-running'
    || s.controlState === 'checking'
    || s.stopBusy;

  return (
    <div className="prereq-docker-controls" data-testid="prereq-docker-controls">
      {s.controlState === 'checking' && (
        <div className="prereq-docker-status" data-testid="prereq-docker-state">
          Checking Docker…
        </div>
      )}

      {s.controlState === 'not-installed' && (
        <div className="prereq-docker-status prereq-docker-status--warn" data-testid="prereq-docker-state">
          Docker Desktop is not installed.{' '}
          <a href={DOCKER_DESKTOP_INSTALL_URL} target="_blank" rel="noopener noreferrer">
            Install Docker Desktop →
          </a>
          <p className="prereq-stack-hint">A restart may be required after installing.</p>
        </div>
      )}

      {s.controlState === 'not-running' && (
        <div className="prereq-docker-status prereq-docker-status--warn" data-testid="prereq-docker-state">
          Docker Desktop is not running. Open it and wait until it is ready.
          <button
            type="button"
            className="prereq-open-docker-btn"
            data-testid="prereq-open-docker"
            onClick={() => { void s.openDesktop(); }}
          >
            Open Docker Desktop
          </button>
          {isWindowsHost() && (
            <p className="prereq-stack-hint" data-testid="prereq-windows-start-hint">
              On Windows, Docker Desktop can take up to 90 seconds to become ready.
            </p>
          )}
        </div>
      )}

      {s.controlState === 'outdated-compose' && (
        <div className="prereq-docker-status prereq-docker-status--warn" data-testid="prereq-docker-state">
          Your Docker Compose is outdated. Update Docker Desktop to continue.{' '}
          <a href={DOCKER_DESKTOP_INSTALL_URL} target="_blank" rel="noopener noreferrer">
            Update Docker Desktop →
          </a>
        </div>
      )}

      {s.certExpiring && s.certExpiry?.daysRemaining != null && (
        <div className="prereq-docker-status prereq-docker-status--warn" data-testid="prereq-cert-expiring">
          Security certificate expires in {s.certExpiry.daysRemaining} days. Update the app soon.
          <button type="button" className="prereq-open-docker-btn" onClick={() => { void s.checkUpdates(); }}>
            Check for updates →
          </button>
        </div>
      )}

      {s.certExpired && (
        <div className="prereq-docker-status prereq-docker-status--error" data-testid="prereq-cert-expired">
          This lesson needs a security certificate that has expired. Update the app to continue.
          <button type="button" className="prereq-open-docker-btn" onClick={() => { void s.checkUpdates(); }}>
            Check for updates →
          </button>
        </div>
      )}

      {s.controlState === 'stack-stopped' && (
        <div className={`prereq-stack-status prereq-stack-status--stack-stopped`} data-testid="prereq-stack-status">
          ● Stack not running
        </div>
      )}
      {s.controlState === 'stack-starting' && (
        <div className="prereq-stack-status prereq-stack-status--stack-starting" data-testid="prereq-stack-status">
          Starting services… First run may download images (2–10 min).
        </div>
      )}
      {s.controlState === 'stack-running' && (
        <div className="prereq-stack-status prereq-stack-status--stack-running" data-testid="prereq-stack-status">
          All services running
        </div>
      )}
      {s.controlState === 'start-failed' && (
        <div className="prereq-stack-status prereq-stack-status--start-failed" data-testid="prereq-stack-status">
          Failed to start stack
        </div>
      )}
      {s.controlState === 'port-conflict' && (
        <div className="prereq-stack-status prereq-stack-status--start-failed" data-testid="prereq-port-conflict">
          <PortConflictMessage entries={s.conflictEntries} fallbackPorts={s.conflictPorts} />
        </div>
      )}
      {s.controlState === 'stack-limit-reached' && (
        <div className="prereq-stack-status prereq-stack-status--start-failed" data-testid="prereq-stack-limit">
          {MAX_CONCURRENT_DOCKER_STACKS} stacks are already running. Stop one before starting another.
          {s.limitKeys.length > 0 && (
            <div className="prereq-limit-stop-row">
              {s.limitKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="prereq-stop-btn"
                  data-testid={`prereq-stop-limit-${key}`}
                  disabled={s.stopBusy}
                  onClick={() => { void s.stopLimitStack(key); }}
                >
                  Stop {DOCKER_STACK_LABELS[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {s.controlState === 'oom-killed' && (
        <div className="prereq-stack-status prereq-stack-status--start-failed" data-testid="prereq-oom">
          A container was stopped due to low memory.
          {s.oomRecommendedMb ? ` Recommended: ${Math.round(s.oomRecommendedMb / 1024)} GB minimum.` : ''}
          {' '}
          <a href={MEMORY_DOCS_URL} target="_blank" rel="noopener noreferrer">Increase Docker memory →</a>
        </div>
      )}

      {s.otherRunning.length > 0 && s.controlState === 'stack-stopped' && (
        <p className="prereq-stack-hint" data-testid="prereq-other-stack">
          {formatOtherRunningStacks(s.otherRunning)}
        </p>
      )}

      {s.lowMemory && s.controlState === 'stack-stopped' && (
        <p className="prereq-stack-hint" data-testid="prereq-low-memory">
          Docker has only {(s.lowMemory.availableMb / 1024).toFixed(1)} GB — this stack recommends{' '}
          {(s.lowMemory.recommendedMb / 1024).toFixed(1)} GB.{' '}
          <a href={MEMORY_DOCS_URL} target="_blank" rel="noopener noreferrer">Increase Docker memory →</a>
        </p>
      )}

      <div className="prereq-btn-row">
        {s.controlState !== 'stack-running' && (
          <button
            type="button"
            className="prereq-start-btn"
            data-testid="prereq-start-stack"
            disabled={startDisabled}
            onClick={() => { void s.startStack(); }}
          >
            {s.controlState === 'start-failed'
              || s.controlState === 'port-conflict'
              || s.controlState === 'oom-killed'
              || s.controlState === 'stack-limit-reached'
              ? 'Retry'
              : 'Start Stack'}
          </button>
        )}
        {s.controlState === 'stack-running' && (
          <button
            type="button"
            className="prereq-stop-btn"
            data-testid="prereq-stop-stack"
            disabled={s.stopBusy}
            onClick={() => { void s.stopStack(); }}
          >
            {s.stopBusy ? 'Stopping…' : 'Stop Stack'}
          </button>
        )}
        <button
          type="button"
          className="prereq-logs-btn"
          data-testid="prereq-logs-toggle"
          onClick={() => s.setLogsOpen(!s.logsOpen)}
        >
          {s.logsOpen ? 'Hide logs' : 'Show logs'}
        </button>
        {s.controlState === 'stack-running' && (
          <button
            type="button"
            className="prereq-manage-link"
            data-testid="prereq-manage-docker"
            onClick={() => requestOpenDockerSettings()}
          >
            Manage Docker settings →
          </button>
        )}
      </div>

      {s.logsOpen && (
        <pre className="prereq-log-panel" data-testid="prereq-log-panel">
          {s.logs.length > 0
            ? s.logs.join('\n')
            : s.logsHydrated
              ? (
                <span className="prereq-log-empty" data-testid="prereq-log-empty">
                  {s.controlState === 'stack-running'
                    ? 'Stack is running from a previous session. No logs available.'
                    : 'No stack logs yet.'}
                </span>
              )
              : null}
        </pre>
      )}
    </div>
  );
}
