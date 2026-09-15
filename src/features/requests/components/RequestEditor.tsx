import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type {
  RequestCollection, RequestItem, RequestEnv,
  GlobalAuthProfile, HttpMethod, Scenario,
} from '@shared/types';
import RequestResponsePlaceholder from './RequestResponsePlaceholder';
import RequestEnvHint from './RequestEnvHint';
import { useResponseCache } from '../hooks/useResponseCache';
import { buildDisplayUrl } from '../utils/requestUrlResolver';
import { formatBytes } from '@shared/utils/helpers';
import { HttpMethodSelect } from './HttpMethodSelect';
import type { UrlResolverContext } from '../utils/requestUrlResolver';
import { BodyEditor } from './BodyEditor';
import { ParamsEditor } from './ParamsEditor';
import type { ParamEntry } from './ParamsEditor';
import { KeyValueEditor } from '../../websocket/KeyValueEditor';
import type { WsKeyValueEntry } from '@shared/websocket/types';
import { PathParamsEditor } from './PathParamsEditor';
import type { PathParamEntry } from './PathParamsEditor';
import { resolvePathParamUrl } from '../utils/pathParamResolver';
import RequestAuthEditor from './RequestAuthEditor';
import JsonPreview, { buildJTreeFromBody, collectJTreePaths, collectDefaultCollapsedPaths, type JNode } from './JsonTreePreview';
import ConsoleLog from './ConsoleLog';
import MultiEnvResultRow from './MultiEnvResultRow';
import { ResponseHistoryDropdown } from './ResponseHistoryDropdown';
import { useJsonTreeCollapseState, useMatchCountChange } from '@shared/hooks/useJsonTreeCollapseState';

import { createSnapshot, restoreFromVersion, deleteVersion, renameVersion } from '../utils/requestDefinitionVersioning';
import RequestDefinitionVersionPanel from './RequestDefinitionVersionPanel';
import RequestDefinitionVersionDiff from './RequestDefinitionVersionDiff';
import type { RequestDefinitionVersion } from '@shared/types';
import { SpecVersionSwitcher } from './SpecVersionSwitcher';
import { SpecVersionCompareModal } from './SpecVersionCompareModal';
import RequestCatalogApiInfoDrawer from './RequestCatalogApiInfoDrawer';
import { parseQueryParams, rebuildUrlEncoded } from '@shared/utils/queryParams';
import ResponseBodySearchBar from './ResponseBodySearchBar';
import { useSearchMatchNavigation } from '@shared/hooks/useSearchMatchNavigation';
import { useRequestSend } from '../hooks/useRequestSend';
import { useRequestImportExport } from '../hooks/useRequestImportExport';
import RequestImportExportMenu from './RequestImportExportMenu';

import type { RequestSubTab, ResponseSubTab, RequestInputMode } from '@shared/types';

type EditorTab = RequestSubTab;
type InputMode = RequestInputMode;
type ResponseTab = ResponseSubTab;

interface Props {
  collection: RequestCollection;
  request: RequestItem;
  parentSubCollection?: import('../../../shared/types').RequestFolder;
  environments: RequestEnv[];
  appMicroservices?: import('../../../shared/types').Microservice[];
  selectedEnvId?: string;
  onEnvChange: (envId: string | undefined) => void;
  onUpdateRequest: (patch: Partial<RequestItem>) => void;
  appGlobalAuthProfiles: GlobalAuthProfile[];
  onSendToHarness?: () => void;
  isInHarness?: boolean;
  activeSubTab?: EditorTab;
  responseSubTab?: ResponseTab;
  inputMode?: InputMode;
  activeHistoryId?: string | null;
  onActiveSubTabChange?: (tab: EditorTab) => void;
  onResponseSubTabChange?: (tab: ResponseTab) => void;
  onInputModeChange?: (mode: InputMode) => void;
  onActiveHistoryIdChange?: (id: string | null) => void;
}

export default function RequestEditor({
  collection, request, parentSubCollection, environments, appMicroservices,
  selectedEnvId, onEnvChange, onUpdateRequest, appGlobalAuthProfiles, onSendToHarness, isInHarness,
  activeSubTab: activeSubTabProp, responseSubTab: responseSubTabProp,
  inputMode: inputModeProp, activeHistoryId: activeHistoryIdProp,
  onActiveSubTabChange, onResponseSubTabChange, onInputModeChange, onActiveHistoryIdChange,
}: Props) {
  const [activeTabLocal, setActiveTabLocal] = useState<EditorTab>('params');
  const [inputModeLocal, setInputModeLocal] = useState<InputMode>('builder');
  const [sending, setSending] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [responseTabLocal, setResponseTabLocal] = useState<ResponseTab>('preview');
  const [reqNameEditing, setReqNameEditing] = useState(false);

  const activeTab = activeSubTabProp ?? activeTabLocal;
  const setActiveTab = useCallback((tab: EditorTab) => {
    if (onActiveSubTabChange) onActiveSubTabChange(tab);
    else setActiveTabLocal(tab);
  }, [onActiveSubTabChange]);

  const inputMode = inputModeProp ?? inputModeLocal;
  const setInputMode = useCallback((mode: InputMode) => {
    if (onInputModeChange) onInputModeChange(mode);
    else setInputModeLocal(mode);
  }, [onInputModeChange]);

  const responseTab = responseSubTabProp ?? responseTabLocal;
  const setResponseTab = useCallback((tab: ResponseTab) => {
    if (onResponseSubTabChange) onResponseSubTabChange(tab);
    else setResponseTabLocal(tab);
  }, [onResponseSubTabChange]);
  const [diffVersions, setDiffVersions] = useState<{ older: RequestDefinitionVersion; newer: RequestDefinitionVersion } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [showApiInfo, setShowApiInfo] = useState(false);
  const [showVersionCompare, setShowVersionCompare] = useState(false);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const {
    searchQuery: responseSearch,
    setSearchQuery: setResponseSearch,
    currentMatchIndex: searchMatchIdx,
    setCurrentMatchIndex: setSearchMatchIdx,
    goNext: goNextSearchMatch,
    goPrev: goPrevSearchMatch,
    clear: clearResponseSearch,
  } = useSearchMatchNavigation(searchMatchCount);

  const {
    response, setResponse,
    responseTime, setResponseTime,
    sendAllResults, setSendAllResults,
    consoleLines, setConsoleLines,
    history, pushHistory, restoreFromHistory, deleteHistoryEntry, clearHistory,
  } = useResponseCache(request.id);
  const [activeHistoryIdLocal, setActiveHistoryIdLocal] = useState<string | null>(null);

  const activeHistoryId = activeHistoryIdProp !== undefined ? activeHistoryIdProp : activeHistoryIdLocal;
  const setActiveHistoryId = useCallback((id: string | null) => {
    if (onActiveHistoryIdChange) onActiveHistoryIdChange(id);
    else setActiveHistoryIdLocal(id);
  }, [onActiveHistoryIdChange]);

  const prevReqIdForUI = useRef<string>(request.id);
  useEffect(() => {
    if (prevReqIdForUI.current !== request.id) {
      prevReqIdForUI.current = request.id;
      setResponseSearch('');
      if (!onInputModeChange) setInputModeLocal('builder');
      setShowApiInfo(false);
    }
  }, [request.id, setResponseSearch, onInputModeChange]);

  const [lazyTree, setLazyTree] = useState<{ body: string; tree: JNode } | null>(null);
  useEffect(() => {
    const body = response?.error ? undefined : response?.body;
    if (!body) {
      setLazyTree(null);
      return;
    }
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      const tree = buildJTreeFromBody(body);
      if (!cancelled) setLazyTree(tree ? { body, tree } : null);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [response?.body, response?.error]);

  const responseTree = lazyTree && lazyTree.body === response?.body ? lazyTree.tree : null;
  const defaultCollapsed = useMemo(
    () => (responseTree ? new Set(collectDefaultCollapsedPaths(responseTree)) : new Set<string>()),
    [responseTree],
  );
  const { collapsedSet, expandAllActive, handleTreeToggle, handleCollapseAll: collapseAll, handleExpandAll } = useJsonTreeCollapseState(
    responseTree ? (history[0]?.id ?? response?.body) : undefined,
    defaultCollapsed,
  );
  const handleCollapseAll = () => {
    if (!responseTree) return;
    collapseAll(new Set(['', ...collectJTreePaths(responseTree, '')]));
  };
  const searchMatchIdxRef = useRef(searchMatchIdx);
  searchMatchIdxRef.current = searchMatchIdx;
  const handleMatchCountChange = useMatchCountChange(setSearchMatchCount, setSearchMatchIdx, searchMatchIdxRef);

  const queryParams = useMemo(() => {
    if (request.savedQueryParams && request.savedQueryParams.length > 0) {
      return request.savedQueryParams.map(p => ({
        key: p.key, value: p.value, enabled: p.enabled, description: p.description ?? '',
      }));
    }
    const parsed = parseQueryParams(request.url);
    if (parsed.length === 0) return [{ key: '', value: '', enabled: true, description: '' }];
    return parsed.map(kv => ({ ...kv, enabled: true, description: '' }));
  }, [request.url, request.savedQueryParams]);

  const pathParams: PathParamEntry[] = useMemo(() => {
    return request.savedPathParams ?? [];
  }, [request.savedPathParams]);

  const headerCount = useMemo(() => request.headers.filter((h) => h.key.trim() && h.enabled !== false).length, [request.headers]);
  const paramCount = useMemo(() => queryParams.filter(p => p.key.trim() && p.enabled).length + pathParams.length, [queryParams, pathParams]);

  const handleMethodChange = (method: HttpMethod) => onUpdateRequest({ method });

  const headerEntries: WsKeyValueEntry[] = useMemo(
    () => request.headers.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled !== false })),
    [request.headers],
  );

  const handleHeadersChange = useCallback((entries: WsKeyValueEntry[]) => {
    onUpdateRequest({
      headers: entries.map((e) =>
        e.enabled === false ? { key: e.key, value: e.value, enabled: false } : { key: e.key, value: e.value },
      ),
    });
  }, [onUpdateRequest]);

  const subColEnvId = useMemo(() => {
    if (!parentSubCollection) return undefined;
    if (parentSubCollection.selectedEnvId) return parentSubCollection.selectedEnvId;
    const matched = environments.find(e => e.name.toLowerCase() === parentSubCollection.name.toLowerCase());
    return matched?.id;
  }, [parentSubCollection, environments]);

  const linkedSvc = useMemo(
    () => collection.microserviceId ? appMicroservices?.find(s => s.id === collection.microserviceId) : undefined,
    [collection.microserviceId, appMicroservices],
  );

  const resolvedColBaseUrls = useMemo(() => {
    if (linkedSvc) {
      const allSvcEnvs = [...(environments ?? []), ...(linkedSvc.customEnvs ?? [])];
      const mapped: Record<string, string> = {};
      for (const [svcEnvId, url] of Object.entries(linkedSvc.baseUrls)) {
        const svcEnv = allSvcEnvs.find(e => e.id === svcEnvId);
        if (!svcEnv) continue;
        const settingsEnv = environments.find(e => e.name === svcEnv.name);
        if (settingsEnv) mapped[settingsEnv.id] = url as string;
      }
      return mapped;
    }
    return collection.baseUrls ?? {};
  }, [linkedSvc, collection.baseUrls, environments]);

  const allKnownBaseUrls = useMemo(() => {
    const urls: string[] = [];
    for (const u of Object.values(resolvedColBaseUrls)) urls.push(u.replace(/\/+$/, ''));
    if (parentSubCollection?.baseUrls) {
      for (const u of Object.values(parentSubCollection.baseUrls)) urls.push((u as string).replace(/\/+$/, ''));
    }
    return urls.sort((a, b) => b.length - a.length);
  }, [resolvedColBaseUrls, parentSubCollection?.baseUrls]);

  const stripToRelative = useCallback((url: string): string => {
    if (collection.mode !== 'multi-env') return url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
    const matched = allKnownBaseUrls.find(b => url.startsWith(b));
    if (matched) return url.slice(matched.length) || '/';
    try { return new URL(url).pathname + new URL(url).search + new URL(url).hash; } catch { /* intentionally empty */ }
    return url;
  }, [collection.mode, allKnownBaseUrls]);

  const handleUrlChange = useCallback((url: string) => {
    onUpdateRequest({ url: stripToRelative(url) });
  }, [onUpdateRequest, stripToRelative]);

  const handleParamsChange = useCallback((params: ParamEntry[]) => {
    const hasDisabled = params.some(p => !p.enabled && p.key.trim());
    const nonEmpty = params.filter(p => p.key.trim());
    const hasEmptyTrailing = params.length > 0 && !params[params.length - 1].key.trim();
    const toSave = hasEmptyTrailing
      ? [...nonEmpty, { key: '', value: '', enabled: true, description: '' }]
      : nonEmpty;
    onUpdateRequest({
      url: rebuildUrlEncoded(request.url, params.filter(p => p.enabled).map(p => ({ key: p.key, value: p.value }))),
      savedQueryParams: hasDisabled || toSave.length > 0
        ? toSave.map(p => ({ key: p.key, value: p.value, enabled: p.enabled, description: p.description }))
        : undefined,
    });
  }, [request.url, onUpdateRequest]);

  const handlePathParamsChange = useCallback((params: PathParamEntry[]) => {
    const originalPath = request.catalogMeta?.originalPath;
    if (!originalPath) {
      onUpdateRequest({ savedPathParams: params.length > 0 ? params : undefined });
      return;
    }

    const newUrl = resolvePathParamUrl(request.url, originalPath, params);
    const stripped = stripToRelative(newUrl);
    onUpdateRequest({
      url: stripped,
      savedPathParams: params.length > 0 ? params : undefined,
    });
  }, [request.url, request.catalogMeta, onUpdateRequest, stripToRelative]);

  const relativePath = useMemo(() => stripToRelative(request.url), [request.url, stripToRelative]);

  const urlCtx: UrlResolverContext = useMemo(() => ({
    collectionMode: collection.mode,
    resolvedColBaseUrls,
    parentSubCollection,
    subColEnvId,
    selectedEnvId,
  }), [collection.mode, resolvedColBaseUrls, parentSubCollection, subColEnvId, selectedEnvId]);

  const displayUrl = useMemo(
    () => buildDisplayUrl(relativePath, urlCtx),
    [relativePath, urlCtx],
  );

  const asDraftScenario = useCallback((): Scenario => ({
    id: request.id, name: request.name, url: displayUrl,
    method: request.method, headers: request.headers, body: request.body,
    bodyType: request.bodyType, bodyForm: request.bodyForm,
    auth: request.auth, validation: { mode: 'none' },
  }), [request, displayUrl]);

  const { handleSend: doSend, resolveAuth } = useRequestSend({
    request, collection, parentSubCollection, appGlobalAuthProfiles, appMicroservices,
    selectedEnvId, subColEnvId, urlCtx, asDraftScenario,
    setResponse, setResponseTime, setSendAllResults, setConsoleLines,
    pushHistory, setActiveHistoryId,
  });

  const importExport = useRequestImportExport({
    request, onUpdateRequest, stripToRelative, resolveAuth,
    asDraftScenario, subColEnvId, selectedEnvId,
    setInputMode, setActiveTab,
  });

  const handleDraftChange = useCallback((draft: Scenario) => {
    onUpdateRequest({ body: draft.body, bodyType: draft.bodyType, bodyForm: draft.bodyForm });
  }, [onUpdateRequest]);

  const draftScenario = asDraftScenario();
  const responseHeaderCount = response ? Object.keys(response.headers).length : 0;

  return (
    <>
    <div className="req-editor" data-testid="req-editor">
      {/* ── Request name ── */}
      <div className="req-req-name-bar">
        {reqNameEditing ? (
          <input ref={nameInputRef} className="req-req-name-input" value={request.name}
            onChange={(e) => onUpdateRequest({ name: e.target.value })}
            onBlur={() => setReqNameEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') setReqNameEditing(false); }} autoFocus />
        ) : (
          <span className="req-req-name-display" onClick={() => setReqNameEditing(true)}>
            {request.name || 'Untitled Request'} <span className="req-edit-hint">&#9998;</span>
          </span>
        )}
        {isInHarness && (
          <span className="req-req-harness-badge" title="Promoted to Harness">IN HARNESS</span>
        )}
        <div className="req-name-bar-actions">
          {request.catalogMeta && (
            <button
              className={`req-api-info-btn ${showApiInfo ? 'active' : ''}`}
              onClick={() => setShowApiInfo(!showApiInfo)}
              title={showApiInfo ? 'Hide API Info' : 'Show API Info'}
            >&#9432; API Info</button>
          )}
          <SpecVersionSwitcher request={request} onUpdateRequest={onUpdateRequest} onCompare={() => setShowVersionCompare(true)} />
          {onSendToHarness && (
            <button className="req-send-harness-btn" data-testid="req-send-harness-btn" onClick={onSendToHarness} title="Send to Harness as a test">
              Send to Harness
            </button>
          )}
        </div>
      </div>

      {/* ── URL bar + status ── */}
      <div className="req-url-row">
        <HttpMethodSelect
          value={request.method}
          onChange={(m) => handleMethodChange(m as HttpMethod)}
        />
        <input className="req-url-input"
          value={relativePath}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder={collection.mode === 'multi-env' ? '/v1/endpoint' : 'https://api.example.com/v1/endpoint'}
          data-testid="req-url-input" />
        <button
          className="req-send-btn"
          onClick={() => void doSend(setSending, setSendBusy)}
          disabled={sending || sendBusy}
          aria-busy={sending || sendBusy}
          data-testid="req-send-btn"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        <div className="req-status-row">
          {response && (
            <>
              <span className={`req-status-pill ${response.status >= 200 && response.status < 300 ? 'success' : response.status >= 400 ? 'error' : 'warn'}`} data-testid="req-status-pill">
                {response.status} {response.statusText}
              </span>
              <span className="req-stat" data-testid="req-response-time">{responseTime} ms</span>
              <span className="req-stat" data-testid="req-response-size">{formatBytes(response.body?.length ?? 0)}</span>
            </>
          )}
          <ResponseHistoryDropdown
            history={history}
            currentEntryId={activeHistoryId}
            onRestore={(id) => { restoreFromHistory(id); setActiveHistoryId(id); }}
            onDeleteEntry={(id) => {
              deleteHistoryEntry(id);
              if (id === activeHistoryId) {
                setActiveHistoryId(null);
                setResponse(null);
              }
            }}
            onClearHistory={() => { clearHistory(); setActiveHistoryId(null); }}
          />
        </div>
      </div>

      {/* ── Env bar + resolved URL (multi-env only) ── */}
      {collection.mode === 'multi-env' && (environments.length > 0 || parentSubCollection) && (() => {
        const envName = subColEnvId
          ? environments.find(e => e.id === subColEnvId)?.name
          : parentSubCollection?.name ?? null;
        const hasBaseUrls = Object.keys(resolvedColBaseUrls).length > 0
          || Object.keys(parentSubCollection?.baseUrls ?? {}).length > 0;
        const isOrphanSubCol = !!parentSubCollection && !subColEnvId
          && Object.keys(parentSubCollection.baseUrls ?? {}).length === 0;
        return (
        <div className="req-env-bar" data-testid="req-env-bar">
          <span className="req-env-bar-label">Env:</span>
          {parentSubCollection ? (
            <span className="req-env-pill active pinned" data-testid="req-env-pill">{envName ?? parentSubCollection.name}</span>
          ) : (
            <div className="req-env-pills">
              {environments
                .filter(env => {
                  const url = resolvedColBaseUrls[env.id];
                  return typeof url === 'string' && url.trim().length > 0;
                })
                .map((env) => (
                <button key={env.id} className={`req-env-pill ${selectedEnvId === env.id ? 'active' : ''}`}
                  data-testid="req-env-pill" data-env-name={env.name}
                  onClick={() => onEnvChange(env.id)}>{env.name}</button>
              ))}
            </div>
          )}
          {displayUrl !== relativePath && (
            <>
              <span className="req-resolved-url-arrow">&#8594;</span>
              <span className="req-resolved-url-full" data-testid="req-resolved-url" title={displayUrl}>{displayUrl}</span>
            </>
          )}
          <RequestEnvHint hasBaseUrls={hasBaseUrls} isOrphanSubCol={isOrphanSubCol} />
        </div>
        );
      })()}

      {/* ── Split pane: request (left) + response (right) ── */}
      <div className="req-split-pane">

        {/* LEFT: Request editor */}
        <div className="req-pane-left">
          {/* Tabs row with action menu */}
          <div className="req-tabs">
            <button className={`req-tab ${activeTab === 'params' ? 'active' : ''}`} data-testid="req-tab-params" onClick={() => { setActiveTab('params'); setInputMode('builder'); }}>
              Params {paramCount > 0 && <span className="tab-badge">{paramCount}</span>}
            </button>
            <button className={`req-tab ${activeTab === 'body' ? 'active' : ''}`} data-testid="req-tab-body" onClick={() => { setActiveTab('body'); setInputMode('builder'); }}>Body</button>
            <button className={`req-tab ${activeTab === 'auth' ? 'active' : ''}`} data-testid="req-tab-auth" onClick={() => { setActiveTab('auth'); setInputMode('builder'); }}>
              Auth {request.auth.type !== 'none' && request.auth.type !== 'inherit' && <span className="req-tab-dot" />}
            </button>
            <button className={`req-tab ${activeTab === 'headers' ? 'active' : ''}`} data-testid="req-tab-headers" onClick={() => { setActiveTab('headers'); setInputMode('builder'); }}>
              Headers {headerCount > 0 && <span className="tab-badge">{headerCount}</span>}
            </button>
            <button className={`req-tab ${activeTab === 'history' ? 'active' : ''}`} data-testid="req-tab-definition-history" onClick={() => { setActiveTab('history'); setInputMode('builder'); }}>
              History {(request.definitionVersions?.length ?? 0) > 0 && <span className="tab-badge">{request.definitionVersions!.length}</span>}
            </button>

            <RequestImportExportMenu
              onCurlImport={() => setInputMode('curlImport')}
              onCurlExport={() => { setInputMode('curlExport'); void importExport.triggerCurlGeneration(); }}
              onJsonImport={importExport.handleJsonImport}
              onJsonExport={() => { void importExport.handleJsonExport(); }}
            />
          </div>

          {/* Tab / cURL content */}
          <div className="req-tab-content">
            {inputMode === 'curlImport' && (
              <div className="req-curl-panel" data-testid="req-curl-import-panel">
                <label className="req-curl-label">Paste your cURL command</label>
                <textarea className="req-curl-textarea" data-testid="req-curl-textarea" rows={8} autoFocus value={importExport.curlText}
                  onChange={(e) => importExport.setCurlText(e.target.value)}
                  placeholder={`curl -X POST https://api.example.com \\
  -H 'Authorization: Bearer token' \\
  -d '{"key": "value"}'`} />
                <div className="req-curl-actions">
                  <button className="btn btn-primary" data-testid="req-curl-apply-btn" disabled={!importExport.curlText.trim()} onClick={importExport.handleCurlImport}>Import &amp; Apply</button>
                  <button className="btn btn-ghost" onClick={() => setInputMode('builder')}>Cancel</button>
                </div>
              </div>
            )}

            {inputMode === 'curlExport' && (
              <div className="req-curl-panel" data-testid="req-curl-export-panel">
                <label className="req-curl-label">Generated cURL command</label>
                {request.url.trim() ? (<>
                  <textarea className="req-curl-textarea req-curl-export" data-testid="req-curl-export-textarea" rows={10} readOnly
                    value={importExport.curlGenerating ? 'Generating...' : importExport.generatedCurl}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
                  <div className="req-curl-actions">
                    <button className="btn btn-primary" disabled={importExport.curlGenerating || !importExport.generatedCurl} onClick={importExport.handleCopyToClipboard}>
                      {importExport.curlCopied ? 'Copied!' : 'Copy'}</button>
                    <button className="btn" disabled={importExport.curlGenerating} onClick={() => void importExport.triggerCurlGeneration()}>Refresh</button>
                    <button className="btn btn-ghost" onClick={() => setInputMode('builder')}>Close</button>
                  </div>
                </>) : <div className="req-curl-empty">Set a URL first.</div>}
              </div>
            )}

            {inputMode === 'builder' && (<>
              {activeTab === 'params' && (
                <>
                  {pathParams.length > 0 && <PathParamsEditor params={pathParams} onChange={handlePathParamsChange} />}
                  <ParamsEditor params={queryParams} onChange={handleParamsChange} />
                </>
              )}
              {activeTab === 'body' && <BodyEditor draft={draftScenario} onDraftChange={handleDraftChange} />}

              {activeTab === 'headers' && (
                <div className="req-headers-editor req-headers-kv">
                  <KeyValueEditor
                    entries={headerEntries}
                    onChange={handleHeadersChange}
                    onDeleteAll={() => onUpdateRequest({ headers: [{ key: '', value: '' }] })}
                    label="Headers"
                    toggleVerb="send"
                    testIdPrefix="req-headers"
                  />
                </div>
              )}

              {activeTab === 'auth' && (
                <RequestAuthEditor
                  auth={request.auth}
                  collection={collection}
                  globalAuthProfiles={appGlobalAuthProfiles}
                  onUpdate={(auth) => onUpdateRequest({ auth })}
                />
              )}

              {activeTab === 'history' && (
                <RequestDefinitionVersionPanel
                  versions={request.definitionVersions ?? []}
                  currentSnapshot={createSnapshot(request)}
                  onRestore={(v) => onUpdateRequest(restoreFromVersion(v))}
                  onDelete={(vId) => onUpdateRequest({ definitionVersions: deleteVersion(request.definitionVersions ?? [], vId) })}
                  onRename={(vId, label) => onUpdateRequest({ definitionVersions: renameVersion(request.definitionVersions ?? [], vId, label) })}
                  onCompare={(older, newer) => setDiffVersions({ older, newer })}
                />
              )}
            </>)}
          </div>
        </div>

        {/* RIGHT: Response panel or API Info drawer */}
        <div className="req-pane-right">
          {showApiInfo && request.catalogMeta ? (
            <RequestCatalogApiInfoDrawer
              method={request.method}
              catalogMeta={request.catalogMeta}
              onClose={() => setShowApiInfo(false)}
            />
          ) : (<>
          <div className="req-tabs req-resp-tabs">
            <button className={`req-tab ${responseTab === 'preview' ? 'active' : ''}`} onClick={() => setResponseTab('preview')} data-testid="req-resp-tab-preview">Preview</button>
            <button className={`req-tab ${responseTab === 'headers' ? 'active' : ''}`} onClick={() => setResponseTab('headers')} data-testid="req-resp-tab-headers">
              Headers {responseHeaderCount > 0 && <span className="tab-badge">{responseHeaderCount}</span>}
            </button>
            <button className={`req-tab ${responseTab === 'console' ? 'active' : ''}`} onClick={() => setResponseTab('console')} data-testid="req-resp-tab-console">
              Console
            </button>
          </div>

          {responseTab === 'preview' && (
            <ResponseBodySearchBar
              value={responseSearch}
              onChange={setResponseSearch}
              currentMatch={searchMatchIdx + 1}
              totalMatches={searchMatchCount}
              onPrev={goPrevSearchMatch}
              onNext={goNextSearchMatch}
              onClear={() => { clearResponseSearch(); setSearchMatchCount(0); }}
              onExpandAll={handleExpandAll}
              onCollapseAll={handleCollapseAll}
              copyText={response?.body}
            />
          )}

          <div className="req-resp-content">
            {!response && !sendAllResults && (
              <RequestResponsePlaceholder />
            )}

            {response && !sendAllResults && responseTab === 'preview' && (
              <JsonPreview body={response.body} error={response.error} search={responseSearch}
                collapsedSet={collapsedSet} onToggle={handleTreeToggle} prebuiltTree={responseTree}
                forceExpandAll={expandAllActive}
                currentMatchIdx={searchMatchIdx} onMatchCountChange={handleMatchCountChange} />
            )}

            {response && !sendAllResults && responseTab === 'headers' && (
              <div className="req-resp-headers-list">
                {Object.entries(response.headers).map(([k, v]) => (
                  <div key={k} className="req-resp-header-row">
                    <span className="req-resp-header-key">{k}</span>
                    <span className="req-resp-header-val">{v}</span>
                  </div>
                ))}
                {Object.keys(response.headers).length === 0 && (
                  <div className="req-response-placeholder">No response headers</div>
                )}
              </div>
            )}

            {responseTab === 'console' && (
              <ConsoleLog lines={consoleLines} />
            )}

            {sendAllResults && responseTab !== 'console' && (
              <div className="req-multi-results">
                {sendAllResults.map((r, i) => <MultiEnvResultRow key={i} {...r} />)}
              </div>
            )}
          </div>
          </>)}
        </div>
      </div>

    </div>

    {diffVersions && (
      <RequestDefinitionVersionDiff
        open
        older={diffVersions.older}
        newer={diffVersions.newer}
        onClose={() => setDiffVersions(null)}
      />
    )}
    {showVersionCompare && request.specVersions && request.specVersions.length > 1 && (
      <SpecVersionCompareModal request={request} onClose={() => setShowVersionCompare(false)} />
    )}
    </>
  );
}
