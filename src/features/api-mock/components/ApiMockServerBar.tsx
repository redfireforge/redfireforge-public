import { useState } from 'react';
import type { ApiMockServerDefinitionV1 } from '@shared/api-mock/contracts';
import type { ApiMockRuntimeStatus } from './ApiMockServerTabs';
import { CopyIcon, CheckIcon, SettingsIcon, RestartIcon, StopIcon, PlayIcon, PanelLeftIcon } from './ApiMockIcons';
import { mockClientOrigin } from '@shared/api-mock/harExport';
import { isDesktopRuntimeAvailable, isTauri } from '@shared/utils/platform';
import { analyzeNativeUnsupported } from '@shared/api-mock/nativeCapabilities';

interface Props {
  server: ApiMockServerDefinitionV1;
  onUpdate: (patch: Partial<ApiMockServerDefinitionV1>) => void;
  status?: ApiMockRuntimeStatus;
  dirty?: boolean;
  generation?: number;
  error?: string;
  onStart?: () => void;
  onStop?: () => void;
  onApply?: () => void;
  onRestart?: () => void;
  onSettings?: () => void;
  /** Mockup 08 — open rules drawer on narrow viewports. */
  onOpenRoutes?: () => void;
}

const STATUS_LABEL: Record<ApiMockRuntimeStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  draining: 'Draining…',
  applying: 'Applying…',
  error: 'Error',
};

export function ApiMockServerBar({
  server,
  onUpdate: _onUpdate,
  status = 'stopped',
  dirty = false,
  generation = 0,
  error,
  onStart,
  onStop,
  onApply,
  onRestart,
  onSettings,
  onOpenRoutes,
}: Props) {
  const [copied, setCopied] = useState(false);
  const address = `${mockClientOrigin(server.host, server.port, Boolean(server.settings.tls?.enabled))}${server.basePath}`;
  const running = status === 'running';
  const busy = status === 'starting' || status === 'draining' || status === 'applying';
  const labelClass = running ? 'running' : status === 'error' ? 'error' : 'stopped';
  const desktopRequired = !isDesktopRuntimeAvailable();
  const nativeWarnings = isTauri() ? analyzeNativeUnsupported(server) : [];
  const tlsEnabled = Boolean(server.settings.tls?.enabled);
  const emptyRules = server.routes.length === 0;
  const startTitle = desktopRequired
    ? 'Starting a mock server requires the RedfireForge desktop app'
    : emptyRules
      ? 'Start the listener. With no rules, every request returns 404 until you add one.'
      : 'Start this mock server';

  const handleCopy = () => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };

  return (
    <div className="api-mock-server-bar" data-testid="api-mock-server-bar">
      <div className="am-server-bar-main">
        <div className="am-listen-url" data-testid="api-mock-listen-url">
          <span className={`am-status-dot ${status}`} />
          <span className={`am-status-label ${labelClass}`} data-testid="api-mock-status-label">{STATUS_LABEL[status]}</span>
          <span className="am-address" data-testid="api-mock-address">{address}</span>
        </div>
        <button
          className="am-icon-btn"
          aria-label="Copy address"
          title={copied ? 'Copied!' : 'Copy address'}
          onClick={handleCopy}
          data-testid="api-mock-copy-address"
        >{copied ? <CheckIcon /> : <CopyIcon />}</button>
        {generation > 0 && (
          <span className="am-generation" data-testid="api-mock-generation">Generation {generation}</span>
        )}
        {tlsEnabled && (
          <span className="am-badge" title="HTTPS listeners accept HTTP/2 (h2) and HTTP/1.1" data-testid="api-mock-http2-badge">HTTP/2</span>
        )}
        {dirty && <span className="am-badge warning" data-testid="api-mock-dirty-badge">Draft changed</span>}
        <span className="am-spacer" />
        {!desktopRequired && dirty && running && (
          <button className="am-btn primary" onClick={onApply} data-testid="api-mock-apply"><CheckIcon /> Apply</button>
        )}
        {!desktopRequired && running ? (
          <>
            <button className="am-btn" onClick={onRestart} data-testid="api-mock-restart"><RestartIcon /> Restart</button>
            <button className="am-btn danger" onClick={onStop} data-testid="api-mock-stop"><StopIcon /> Stop</button>
          </>
        ) : (
          <button
            className="am-btn primary"
            onClick={desktopRequired ? undefined : onStart}
            disabled={busy || desktopRequired}
            title={startTitle}
            data-testid="api-mock-start"
          >
            <PlayIcon /> {status === 'starting' ? 'Starting…' : 'Start'}
          </button>
        )}
        <button className="am-icon-btn" aria-label="Server settings" title="Server settings" onClick={onSettings} data-testid="api-mock-settings"><SettingsIcon /></button>
        {onOpenRoutes && (
          <button
            className="am-icon-btn am-routes-drawer-toggle"
            aria-label="Open routes"
            title="Open routes"
            onClick={onOpenRoutes}
            data-testid="api-mock-open-routes"
          ><PanelLeftIcon /></button>
        )}
      </div>
      {error && (
        <div className="am-server-error" role="alert" data-testid="api-mock-server-error">
          {error}
        </div>
      )}
      {desktopRequired && (
        <div className="am-notice am-notice--desktop-required am-notice--flush" data-testid="api-mock-desktop-required" role="status">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          Server runtime requires the RedfireForge desktop app.{' '}
          <a
            href="https://github.com/redfireforge/redfireforge-public/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="am-notice-link"
          >
            Download the desktop app →
          </a>
          {' '}You can still configure routes, import specs, and use Simulate here.
        </div>
      )}
      {nativeWarnings.length > 0 && (
        <div className="am-notice warning am-notice--flush" data-testid="api-mock-native-warnings" role="status">
          {nativeWarnings.map(w => (
            <div key={w.code}>{w.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}
