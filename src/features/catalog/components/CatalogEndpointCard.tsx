import { useState, useCallback, useEffect, useRef, useMemo, type MouseEvent, type ReactNode } from 'react';
import { CustomSelect } from '@shared/components/CustomSelect';
import { SWAGGER_METHOD_COLORS } from '@shared/constants/httpMethodColors';
import { useCopyToClipboard } from '@shared/hooks/useCopyToClipboard';
import type { CatalogEndpoint, CatalogServer, HostConfig, CatalogResponse, CatalogParameter, SavedEndpointValues, CatalogEnvironment } from '../types/catalog';
import type { AuthConfig, Microservice } from '@shared/types';
import type { EndpointCoverage } from '../utils/coverageChecker';
import type { PublishPermission } from '../hooks/usePublishPermission';
import { generateStubJson } from '../utils/schemaStubGenerator';
import { prettyJson, toErrorMessage } from '@shared/utils/helpers';
import { buildCatalogCurlCommand, buildCatalogCurlSingleLine, buildDefaultCurlCommand, resolveBaseUrl, buildFullUrl } from '../utils/catalogCurlGenerator';
import { httpFetch } from '@shared/utils/httpClient';
import { applyAuthHeaders } from '@shared/utils/applyAuthHeaders';
import { highlightJson } from '@shared/utils/jsonHighlighter';

interface Props {
  endpoint: CatalogEndpoint;
  servers: CatalogServer[];
  hostConfig: HostConfig;
  auth: AuthConfig;
  savedValues?: SavedEndpointValues;
  onValuesChange?: (vals: SavedEndpointValues) => void;
  environments?: CatalogEnvironment[];
  linkedMicroservice?: Microservice;
  onExportSingle?: (endpoint: CatalogEndpoint, savedValues?: SavedEndpointValues) => void;
  onSendToHarness?: (endpoint: CatalogEndpoint, fromTryItOut?: boolean) => void;
  onExportToApiMock?: (endpoint: CatalogEndpoint) => void;
  onSetWorkflowExposure?: (endpoint: CatalogEndpoint, mode: 'preview' | 'published' | undefined, values: SavedEndpointValues) => void;
  /** Merged exposure mode from both CatalogEndpoint (published) and user-local preview storage. */
  currentExposureMode?: 'preview' | 'published';
  /** True when published endpoint's spec has been updated since publication. */
  isPublicationStale?: boolean;
  /** Access control for publish/unpublish actions. All-true when not provided. */
  publishPermission?: PublishPermission;
  coverage?: EndpointCoverage;
  onNavigateToRequest?: (collectionId: string, requestId: string) => void;
}

const MBG: Record<string, string> = {
  GET: 'rgba(73,204,144,0.1)', POST: 'rgba(252,161,48,0.1)',
  PUT: 'rgba(97,175,254,0.1)', PATCH: 'rgba(80,227,194,0.1)',
  DELETE: 'rgba(249,62,62,0.1)',
};

function oauthSourceLabel(auth: AuthConfig): string {
  if (auth.__globalProfileName) return `Global profile ${auth.__globalProfileName}`;
  if (auth.__inherit) return auth.__schemeName ? `OpenAPI scheme ${auth.__schemeName}` : 'OpenAPI security scheme';
  return 'Saved on this catalog entry';
}

function AuthStatusLine({ auth }: { auth: AuthConfig }) {
  if (auth.type === 'oauth2') {
    if (!auth.tokenUrl) {
      return <span className="sw-auth-status">OAuth2 not configured</span>;
    }
    return (
      <span className="sw-auth-status sw-auth-oauth" data-testid="catalog-oauth-status">
        <span className="sw-auth-oauth-title">OAuth2 client credentials</span>
        <span className="sw-auth-oauth-row">{oauthSourceLabel(auth)}</span>
        <span className="sw-auth-oauth-row">Client ID {auth.clientId || '—'}</span>
        <span className="sw-auth-oauth-row">Token URL {auth.tokenUrl}</span>
      </span>
    );
  }
  const text = auth.type === 'none' ? 'No auth' :
    auth.type === 'bearer' ? (auth.token ? `Bearer ${auth.token.slice(0, 8)}…` : 'Bearer token empty') :
    auth.type === 'basic' ? (auth.username ? `Basic ${auth.username}` : 'Basic creds empty') :
    auth.type === 'apikey' ? (auth.apiKeyValue ? `${auth.apiKeyName}: ${auth.apiKeyValue.slice(0, 8)}…` : `${auth.apiKeyName ?? 'API Key'} value empty`) :
    `? type=${auth.type}`;
  return <span className="sw-auth-status">{text}</span>;
}

export default function CatalogEndpointCard({ endpoint, servers, hostConfig, auth, savedValues, onValuesChange, environments, linkedMicroservice, onExportSingle, onSendToHarness, onExportToApiMock, onSetWorkflowExposure, currentExposureMode, isPublicationStale, publishPermission, coverage, onNavigateToRequest }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tryItOpen, setTryItOpen] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => savedValues?.params ?? {});
  const [headerValues, setHeaderValues] = useState<Record<string, string>>(() => savedValues?.headers ?? {});
  const [bodyText, setBodyText] = useState(() => savedValues?.body ?? '');
  const [bodyInited, setBodyInited] = useState(() => !!savedValues?.body);
  const [liveResponse, setLiveResponse] = useState<{
    status: number; statusText: string;
    headers: Record<string, string>; body: string; timeMs: number;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCurl, setShowCurl] = useState(false);
  const [curlMultiline, setCurlMultiline] = useState(true);
  const [copied, copyToClipboard] = useCopyToClipboard(1500);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCoveragePopover, setShowCoveragePopover] = useState(false);

  const valuesChanged = useRef(false);
  useEffect(() => {
    if (!valuesChanged.current) return;
    valuesChanged.current = false;
    const hasData = Object.values(paramValues).some(v => v) || Object.values(headerValues).some(v => v) || bodyText;
    if (hasData && onValuesChange) {
      onValuesChange({ params: paramValues, headers: headerValues, body: bodyText });
    }
  }, [paramValues, headerValues, bodyText, onValuesChange]);

  const updateParam = useCallback((name: string, val: string, isHeader: boolean) => {
    valuesChanged.current = true;
    if (isHeader) {
      setHeaderValues(prev => ({ ...prev, [name]: val }));
    } else {
      setParamValues(prev => ({ ...prev, [name]: val }));
    }
  }, []);

  const updateBody = useCallback((val: string) => {
    valuesChanged.current = true;
    setBodyText(val);
  }, []);

  const hostWarning = useMemo(() => {
    if (hostConfig.strategy !== 'inherited') return null;
    const base = resolveBaseUrl(hostConfig, servers, environments, linkedMicroservice);
    if (!base) return 'No server URL configured. Switch to "Custom URL" mode and enter a valid base URL.';
    try {
      const host = new URL(base).hostname;
      if (/\bexample\.(com|org|net)\b/i.test(host) || host === 'localhost' || host.endsWith('.invalid') || host.endsWith('.test') || host.endsWith('.local'))
        return `Server URL "${host}" from the spec is likely a placeholder. Switch to "Custom URL" or "Environment" mode to use your real server.`;
    } catch { /* ignore parse errors */ }
    return null;
  }, [hostConfig, servers, environments, linkedMicroservice]);

  const jsonCT = endpoint.requestBody?.contentTypes.find(ct => ct.mediaType.includes('json'));
  const hasBody = !!(endpoint.requestBody && jsonCT);

  const initBody = useCallback(() => {
    if (!bodyInited && jsonCT?.schema) {
      valuesChanged.current = true;
      setBodyText(generateStubJson(jsonCT.schema));
      setBodyInited(true);
    }
  }, [bodyInited, jsonCT]);

  const handleTryIt = useCallback(() => {
    if (!tryItOpen) initBody();
    setTryItOpen(v => !v);
    setLiveResponse(null);
  }, [tryItOpen, initBody]);

  const handleExecute = useCallback(async () => {
    setLoading(true);
    setLiveResponse(null);
    const baseUrl = resolveBaseUrl(hostConfig, servers, environments, linkedMicroservice);
    const url = buildFullUrl(baseUrl, endpoint.path, paramValues, endpoint.parameters);
    const hdrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(headerValues)) {
      if (k.trim() && v.trim()) hdrs[k.trim()] = v.trim();
    }

    try {
      await applyAuthHeaders(auth, hdrs);
    } catch (err) {
      setLiveResponse({ status: 0, statusText: '', headers: {}, body: '', timeMs: 0,
        error: `Auth failed: ${toErrorMessage(err)}` });
      setLoading(false);
      return;
    }
    if (bodyText.trim() && endpoint.method !== 'GET')
      hdrs['Content-Type'] = hdrs['Content-Type'] || 'application/json';

    const t0 = performance.now();
    const r = await httpFetch(url, endpoint.method, hdrs,
      bodyText.trim() && endpoint.method !== 'GET' ? bodyText : undefined);
    setLiveResponse({ ...r, timeMs: Math.round(performance.now() - t0) });
    setLoading(false);
  }, [endpoint, servers, hostConfig, paramValues, headerValues, bodyText, auth, environments, linkedMicroservice]);

  const [curlCmd, setCurlCmd] = useState('');
  useEffect(() => {
    if (!showCurl) { setCurlCmd(''); return; }  
    let cancelled = false;
    const params = { endpoint, hostConfig, servers, paramValues, headerValues, bodyText, auth, environments, linkedMicroservice };
    const builder = curlMultiline ? buildCatalogCurlCommand : buildCatalogCurlSingleLine;
    builder(params).then(cmd => { if (!cancelled) setCurlCmd(cmd); });
    return () => { cancelled = true; };
  }, [showCurl, curlMultiline, endpoint, hostConfig, servers, paramValues, headerValues, bodyText, auth, environments, linkedMicroservice]);

  const copy = copyToClipboard;

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
    const close = () => { setCtxMenu(null); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  }, []);

  const handleCopyDefaultCurl = useCallback(async () => {
    const cmd = await buildDefaultCurlCommand(endpoint, hostConfig, servers, auth, environments, linkedMicroservice);
    await copy(cmd);
    setCtxMenu(null);
  }, [endpoint, hostConfig, servers, auth, environments, linkedMicroservice, copy]);

  const hasSec = endpoint.security && endpoint.security.length > 0;
  const color = SWAGGER_METHOD_COLORS[endpoint.method] ?? '#888';

  return (
    <div className="sw-card" data-testid="catalog-endpoint-card" data-endpoint-path={endpoint.path} data-endpoint-method={endpoint.method} style={{ borderColor: color }}>
      {/* ── HEADER ────────────────────────────────── */}
      <div className="sw-header" role="button" tabIndex={0} style={{ background: MBG[endpoint.method] }}
        onClick={() => setExpanded(v => !v)}
        onContextMenu={handleContextMenu}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}>
        <span className="sw-method" style={{ background: color }}>{endpoint.method}</span>
        <span className="sw-path">{endpoint.path}</span>
        <span className="sw-summary">{endpoint.summary}</span>
        {coverage?.exported && (
          <span className="sw-coverage-badge" data-testid="catalog-coverage-badge"
            title={`Exported to Requests (${coverage.count})`}
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); setShowCoveragePopover(v => !v); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setShowCoveragePopover(v => !v); } }}>
            IN REQUESTS{coverage.count > 1 ? ` (${coverage.count})` : ''}
          </span>
        )}
        {currentExposureMode === 'published' && isPublicationStale && (
          <span className="sw-stale-badge" data-testid="catalog-stale-badge" title="Spec updated since publication">⚠ Stale</span>
        )}
        {endpoint.deprecated && <span className="sw-deprecated">deprecated</span>}
        {hasSec && <span className="sw-lock">🔒</span>}
        <span className={`sw-chevron ${expanded ? 'open' : ''}`}>&#9662;</span>
      </div>

      {/* ── COVERAGE POPOVER ────────────────────────── */}
      {showCoveragePopover && coverage?.locations && coverage.locations.length > 0 && (
        <div className="sw-coverage-popover" data-testid="catalog-coverage-popover">
          <div className="sw-coverage-popover-header">
            <span>Exported to {coverage.count} request{coverage.count > 1 ? 's' : ''}</span>
          </div>
          <div className="sw-coverage-popover-list">
            {coverage.locations.map(loc => (
              <button
                key={`${loc.collectionId}-${loc.requestId}`}
                className="sw-coverage-popover-item"
                onClick={() => {
                  if (onNavigateToRequest) {
                    onNavigateToRequest(loc.collectionId, loc.requestId);
                    setShowCoveragePopover(false);
                  }
                }}
                title={loc.folderPath}
              >
                <span className="sw-coverage-popover-path">{loc.folderPath}</span>
                <span className="sw-coverage-popover-arrow" data-testid="catalog-coverage-goto">Go to →</span>
              </button>
            ))}
          </div>
          <div className="sw-coverage-popover-footer">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCoveragePopover(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU ─────────────────────────── */}
      {ctxMenu && (
        <div className="sw-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button className="sw-ctx-item" onClick={handleCopyDefaultCurl}>
            Copy as cURL
          </button>
        </div>
      )}

      {expanded && (
        <div className="sw-body">
          {endpoint.description && <p className="sw-desc">{endpoint.description}</p>}

          {/* ── PARAMETERS ────────────────────────── */}
          {endpoint.parameters.length > 0 && (
            <div className="sw-section">
              <div className="sw-section-bar">
                <span className="sw-section-title">Parameters</span>
                <button className={`sw-tryit-btn ${tryItOpen ? 'cancel' : ''}`} data-testid="catalog-tryit-btn" onClick={handleTryIt}>
                  {tryItOpen ? 'Cancel' : 'Try it out'}
                </button>
              </div>
              <div className="sw-param-table">
                <div className="sw-param-thead">
                  <div className="sw-param-col-name">Name</div>
                  <div className="sw-param-col-desc">Description</div>
                </div>
                {endpoint.parameters.map(p => (
                  <ParamRow
                    key={`${p.in}:${p.name}`}
                    param={p}
                    tryItOpen={tryItOpen}
                    value={p.in === 'header' ? (headerValues[p.name] ?? '') : (paramValues[p.name] ?? '')}
                    onChange={val => updateParam(p.name, val, p.in === 'header')}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Try it out when there are no parameters (body-only / no-input endpoints) */}
          {endpoint.parameters.length === 0 && !hasBody && (
            <div className="sw-section sw-section--tryit-only">
              <div className="sw-section-bar">
                <button className={`sw-tryit-btn ${tryItOpen ? 'cancel' : ''}`} data-testid="catalog-tryit-btn" onClick={handleTryIt}>
                  {tryItOpen ? 'Cancel' : 'Try it out'}
                </button>
              </div>
            </div>
          )}

          {/* ── REQUEST BODY ──────────────────────── */}
          {hasBody && (
            <div className="sw-section">
              <div className="sw-section-bar">
                <span className="sw-section-title">Request body</span>
                <span className="sw-ct-badge">{jsonCT!.mediaType}</span>
                {endpoint.requestBody!.required && <span className="sw-req-label">required</span>}
                {endpoint.parameters.length === 0 && (
                  <button className={`sw-tryit-btn ${tryItOpen ? 'cancel' : ''}`} data-testid="catalog-tryit-btn" onClick={handleTryIt}>
                    {tryItOpen ? 'Cancel' : 'Try it out'}
                  </button>
                )}
              </div>
              {tryItOpen ? (
                <textarea className="sw-body-editor" data-testid="catalog-body-editor" rows={12} value={bodyText}
                  onChange={e => updateBody(e.target.value)} spellCheck={false} />
              ) : (
                <JsonBlock json={generateStubJson(jsonCT!.schema)} label="Example Value" />
              )}
            </div>
          )}

          {/* ── HOST WARNING ─────────────────────── */}
          {tryItOpen && hostWarning && (
            <div className="sw-host-warning">{hostWarning}</div>
          )}

          {/* ── EXECUTE BAR ───────────────────────── */}
          {tryItOpen && (
            <div className="sw-exec-bar">
              <button className="sw-exec-btn" data-testid="catalog-execute-btn" style={{ background: color }}
                onClick={handleExecute} disabled={loading}>
                {loading ? 'Executing...' : 'Execute'}
              </button>
              <button className="sw-curl-btn" data-testid="catalog-curl-btn" onClick={() => setShowCurl(v => !v)}>
                {showCurl ? 'Hide cURL' : 'cURL'}
              </button>
              {onExportSingle && (
                <button className="sw-export-btn" data-testid="catalog-export-to-req-btn" onClick={() => onExportSingle(endpoint, {
                  params: paramValues,
                  headers: headerValues,
                  body: bodyText,
                })}>
                  Export to Requests
                </button>
              )}
              {onSendToHarness && (
                <button className="sw-export-btn" data-testid="catalog-send-to-harness-btn" style={{ borderColor: '#6c63ff44', color: '#6c63ff' }} onClick={() => onSendToHarness(endpoint)}>
                  Send to Harness
                </button>
              )}
              {onExportToApiMock && (
                <button className="sw-export-btn" data-testid="catalog-export-to-mock-btn" style={{ borderColor: '#f59e0b44', color: '#f59e0b' }} onClick={() => onExportToApiMock(endpoint)}>
                  Export to API Mock
                </button>
              )}
              {onSetWorkflowExposure && (
                <WorkflowExposureDropdown
                  mode={currentExposureMode}
                  permission={publishPermission}
                  onChange={(mode) => onSetWorkflowExposure(endpoint, mode, {
                    params: paramValues,
                    headers: headerValues,
                    body: bodyText,
                  })}
                />
              )}
              <AuthStatusLine auth={auth} />
            </div>
          )}

          {showCurl && tryItOpen && (
            <div className="sw-curl-box" data-testid="catalog-curl-box">
              <div className="sw-curl-bar">
                <span>Curl</span>
                <div className="sw-curl-actions">
                  <button className={`sw-curl-toggle ${curlMultiline ? 'active' : ''}`} onClick={() => setCurlMultiline(true)}
                    title="Multi-line">⏎</button>
                  <button className={`sw-curl-toggle ${!curlMultiline ? 'active' : ''}`} onClick={() => setCurlMultiline(false)}
                    title="Single line">―</button>
                  <button className="sw-copy-btn" onClick={() => copy(curlCmd)}>{copied ? '✓ Copied' : 'Copy'}</button>
                </div>
              </div>
              <pre className="sw-code-block sw-curl-hl">{highlightCurl(curlCmd)}</pre>
            </div>
          )}

          {/* ── LIVE RESPONSE ─────────────────────── */}
          {liveResponse && tryItOpen && (
            <div className="sw-section" data-testid="catalog-live-response">
              <div className="sw-section-bar">
                <span className="sw-section-title">Server response</span>
              </div>

              {liveResponse.error ? (
                <div className="sw-error-block">
                  <div className="sw-error-title">Request failed</div>
                  <div className="sw-error-message">{liveResponse.error}</div>
                  <div className="sw-error-hint">
                    {liveResponse.error.includes('ENOTFOUND') || liveResponse.error.includes('ECONNREFUSED')
                      ? hostConfig.strategy === 'inherited'
                        ? 'The spec server URL is unreachable. Switch to "Custom URL" or "Environment" mode in the host bar above to use a real server.'
                        : 'The server could not be reached. Check the hostname and ensure you are connected to the correct network/VPN.'
                      : liveResponse.error.includes('CERT') || liveResponse.error.includes('SSL') || liveResponse.error.includes('certificate')
                        ? 'SSL/TLS certificate error. The server may use a self-signed or corporate certificate.'
                        : liveResponse.error.includes('CORS') || liveResponse.error.includes('Failed to fetch')
                          ? 'CORS error. In web mode, requests go through a server-side proxy. Try using the Tauri desktop app for direct requests.'
                          : liveResponse.error.includes('TIMEOUT') || liveResponse.error.includes('timeout')
                            ? 'The request timed out. The server may be slow or unreachable.'
                            : 'Check the URL, network connection, and server status.'}
                  </div>
                </div>
              ) : (
                <div className="sw-resp-table">
                  <div className="sw-resp-thead">
                    <div className="sw-resp-col-code">Code</div>
                    <div className="sw-resp-col-desc">Details</div>
                  </div>
                  <div className="sw-resp-row">
                    <div className={`sw-resp-code sw-sc-${String(liveResponse.status)[0]}`}>{liveResponse.status}</div>
                    <div className="sw-resp-detail">
                      <div className="sw-resp-description">
                        {liveResponse.statusText}
                        <span className="sw-resp-time">{liveResponse.timeMs}ms</span>
                        <button className="sw-copy-btn" onClick={() => copy(liveResponse.body)}>Copy</button>
                      </div>
                      {Object.keys(liveResponse.headers).length > 0 && (
                        <details className="sw-resp-headers-details">
                          <summary>Response headers</summary>
                          <pre className="sw-code-block sw-code-sm">
                            {Object.entries(liveResponse.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
                          </pre>
                        </details>
                      )}
                      {liveResponse.body ? (
                        <JsonBlock json={fmtBody(liveResponse.body)} label="Response body" />
                      ) : (
                        <div className="sw-no-params">No response body</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {!liveResponse.error && onSendToHarness && liveResponse.status >= 200 && liveResponse.status < 300 && (
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <button
                    className="sw-export-btn"
                    style={{ borderColor: '#6c63ff44', color: '#6c63ff' }}
                    onClick={() => onSendToHarness(endpoint, true)}
                    data-testid="catalog-save-as-test-btn"
                  >
                    Send to Harness
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── RESPONSES (spec-defined) ──────────── */}
          {endpoint.responses.length > 0 && (
            <div className="sw-section">
              <div className="sw-section-bar">
                <span className="sw-section-title">Responses</span>
              </div>
              <div className="sw-resp-table">
                <div className="sw-resp-thead">
                  <div className="sw-resp-col-code">Code</div>
                  <div className="sw-resp-col-desc">Description</div>
                </div>
                {endpoint.responses.map(r => (
                  <RespRow key={r.statusCode} resp={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Parameter row ────────────────────────────────── */

function ParamRow({ param: p, tryItOpen, value, onChange }: {
  param: CatalogParameter; tryItOpen: boolean; value: string; onChange: (v: string) => void;
}) {
  const enumVals = p.schema?.enum as string[] | undefined;
  const hasEnum = enumVals && enumVals.length > 0;
  const defaultVal = p.schema?.default != null ? String(p.schema.default) : undefined;
  const exampleVal = p.example != null ? String(p.example) : (p.schema?.example != null ? String(p.schema.example) : undefined);

  return (
    <div className="sw-param-row">
      <div className="sw-param-col-name">
        <div className="sw-pname">
          {p.name}
          {p.required && <span className="sw-pname-req"> *<span className="sw-req-text"> required</span></span>}
        </div>
        <div className="sw-ptype">
          {p.schema?.type ?? 'string'}{p.schema?.format ? <span className="sw-pformat">(${ p.schema.format})</span> : ''}
        </div>
        <div className={`sw-pin sw-pin-${p.in}`}>({p.in})</div>
      </div>
      <div className="sw-param-col-desc">
        {p.description && <div className="sw-pdesc">{p.description}</div>}
        {hasEnum && !tryItOpen && (
          <div className="sw-penum">Available values: {enumVals!.join(', ')}</div>
        )}
        {defaultVal && !tryItOpen && (
          <div className="sw-pdefault">Default value: {defaultVal}</div>
        )}
        {tryItOpen ? (
          hasEnum ? (
            <CustomSelect
              className="sw-pinput"
              value={value || defaultVal || ''}
              onChange={onChange}
              options={enumVals!.map(v => ({ value: v, label: v }))}
              placeholder="--"
            />
          ) : (
            <input className="sw-pinput" data-testid={`catalog-param-${p.name}`} placeholder={exampleVal ?? defaultVal ?? p.name}
              value={value} onChange={e => onChange(e.target.value)} />
          )
        ) : (
          <div className="sw-pinput-ro">{exampleVal ?? defaultVal ?? p.name}</div>
        )}
      </div>
    </div>
  );
}

/* ── Response row (spec-defined) ──────────────────── */

function RespRow({ resp: r }: { resp: CatalogResponse }) {
  const [tab, setTab] = useState<'example' | 'model'>('example');
  const hasSchema = !!r.schema;
  const exJson = r.example
    ? JSON.stringify(r.example, null, 2)
    : (r.schema ? generateStubJson(r.schema) : null);

  return (
    <div className="sw-resp-row">
      <div className={`sw-resp-code sw-sc-${r.statusCode[0]}`}>{r.statusCode}</div>
      <div className="sw-resp-detail">
        <div className="sw-resp-description">{r.description}</div>
        {(exJson || hasSchema) && (
          <div className="sw-example-box">
            <div className="sw-example-tabs">
              <button className={`sw-etab ${tab === 'example' ? 'active' : ''}`} onClick={() => setTab('example')}>
                Example Value
              </button>
              {hasSchema && (
                <button className={`sw-etab ${tab === 'model' ? 'active' : ''}`} onClick={() => setTab('model')}>
                  Model
                </button>
              )}
            </div>
            {tab === 'example' && exJson && (
              <pre className="sw-code-block sw-json">{highlightJson(exJson)}</pre>
            )}
            {tab === 'model' && hasSchema && (
              <pre className="sw-code-block sw-model">{buildModel(r.schema!, 0)}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── JSON example block ───────────────────────────── */

function JsonBlock({ json, label }: { json: string; label: string }) {
  return (
    <div className="sw-example-box">
      <div className="sw-example-tabs">
        <button className="sw-etab active">{label}</button>
      </div>
      <pre className="sw-code-block sw-json">{highlightJson(json)}</pre>
    </div>
  );
}

/* ── Model view builder ───────────────────────────── */

function buildModel(s: NonNullable<CatalogResponse['schema']>, d: number): string {
  if (d > 6) return '...';
  const pad = '  '.repeat(d);
  if (s.type === 'object' || s.properties) {
    const lines = [`${pad}{`];
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      const opt = s.required?.includes(k) ? '' : '?';
      const desc = v.description ? `  // ${v.description}` : '';
      if (v.type === 'object' || v.properties)
        lines.push(`${pad}  ${k}${opt}: ${buildModel(v, d + 1).trim()}${desc}`);
      else if (v.type === 'array')
        lines.push(`${pad}  ${k}${opt}: [${v.items ? (v.items.properties ? buildModel(v.items, d + 2).trim() : v.items.type ?? 'any') : 'any'}]${desc}`);
      else {
        const enm = v.enum ? ` enum:[${v.enum.join(',')}]` : '';
        lines.push(`${pad}  ${k}${opt}: ${v.type ?? 'any'}${v.format ? `(${v.format})` : ''}${enm}${desc}`);
      }
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
  }
  if (s.type === 'array')
    return `[${s.items ? buildModel(s.items, d + 1).trim() : 'any'}]`;
  return `${s.type ?? 'any'}${s.format ? `(${s.format})` : ''}`;
}

const fmtBody = prettyJson;

/* ── cURL syntax highlighting ────────────────────── */

function highlightCurl(cmd: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let key = 0;
  const lines = cmd.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) parts.push('\n');

    const tokens = line.match(/(curl|-X\s+\w+|-H|-d|'[^']*'|\\|\S+)/g);
    if (!tokens) { parts.push(line); continue; }

    let first = true;
    for (const tok of tokens) {
      if (!first) parts.push(' ');
      first = false;

      if (tok === 'curl') {
        parts.push(<span key={key++} className="sw-hl-cmd">{tok}</span>);
      } else if (/^-X\s+\w+$/.test(tok)) {
        parts.push(<span key={key++} className="sw-hl-method">{tok}</span>);
      } else if (tok === '-H' || tok === '-d') {
        parts.push(<span key={key++} className="sw-hl-flag">{tok}</span>);
      } else if (tok.startsWith("'") && tok.endsWith("'")) {
        if (tok.includes('://')) {
          parts.push(<span key={key++} className="sw-hl-url">{tok}</span>);
        } else if (tok.includes(':')) {
          parts.push(<span key={key++} className="sw-hl-string">{tok}</span>);
        } else {
          parts.push(<span key={key++} className="sw-hl-string">{tok}</span>);
        }
      } else if (tok === '\\') {
        parts.push(<span key={key++} className="sw-hl-escape">{tok}</span>);
      } else {
        parts.push(tok);
      }
    }
  }
  return parts;
}

// ── Workflow Exposure Dropdown ────────────────────────────

const EXPOSURE_OPTIONS: { value: 'preview' | 'published' | undefined; label: string; icon: string; hint: string }[] = [
  { value: undefined,   label: 'Not Exposed', icon: '—', hint: 'Not available in Workflow Designer' },
  { value: 'preview',   label: 'Preview',     icon: '◇', hint: 'Temporarily available for testing' },
  { value: 'published', label: 'Published',   icon: '📌', hint: 'Permanently registered as a workflow block' },
];

function WorkflowExposureDropdown({ mode, permission, onChange }: {
  mode: 'preview' | 'published' | undefined;
  permission?: PublishPermission;
  onChange: (mode: 'preview' | 'published' | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const current = EXPOSURE_OPTIONS.find(o => o.value === mode) ?? EXPOSURE_OPTIONS[0];
  const cls = mode === 'published' ? 'sw-wf-exposure published' : mode === 'preview' ? 'sw-wf-exposure preview' : 'sw-wf-exposure';

  const isOptionDisabled = (optValue: 'preview' | 'published' | undefined): boolean => {
    if (!permission) return false;
    if (optValue === 'published' && !permission.canPublish) return true;
    if (mode === 'published' && optValue !== 'published' && !permission.canUnpublish) return true;
    return false;
  };

  return (
    <div className={cls} ref={ref} data-testid="catalog-expose-to-workflow">
      <button
        type="button"
        className="sw-wf-exposure-trigger"
        onClick={() => setOpen(p => !p)}
        title={current.hint}
      >
        <span className="sw-wf-exposure-icon">{current.icon}</span>
        <span className="sw-wf-exposure-label">{current.label}</span>
        <span className="sw-wf-exposure-caret">▾</span>
      </button>
      {open && (
        <div className="sw-wf-exposure-menu">
          {EXPOSURE_OPTIONS.map(opt => {
            const disabled = isOptionDisabled(opt.value);
            return (
              <button
                key={opt.label}
                type="button"
                className={`sw-wf-exposure-option${opt.value === mode ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                data-testid={`catalog-expose-option-${opt.value ?? 'none'}`}
                onClick={() => { if (!disabled) { onChange(opt.value); setOpen(false); } }}
                disabled={disabled}
                title={disabled ? (permission?.reason ?? 'Insufficient permission') : opt.hint}
              >
                <span className="sw-wf-exposure-opt-icon">{opt.icon}</span>
                <div className="sw-wf-exposure-opt-text">
                  <span className="sw-wf-exposure-opt-label">{opt.label}</span>
                  <span className="sw-wf-exposure-opt-hint">{disabled ? (permission?.reason ?? 'Insufficient permission') : opt.hint}</span>
                </div>
                {opt.value === mode && <span className="sw-wf-exposure-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
