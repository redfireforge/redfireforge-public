import { useCallback, useEffect, useState } from 'react';
import type { ApiMockConflictFindingV1, ApiMockServerDefinitionV1, ApiMockSimulationSampleV1, ApiMockTransactionV1 } from '@shared/api-mock/contracts';
import { setApiMockServerList } from './ApiMockServerListBridge';
import { ApiMockStudioTitleBar } from './components/ApiMockStudioTitleBar';
import { type ApiMockDockTab } from './components/ApiMockDock';
import { type ApiMockMainView } from './components/ApiMockWorkspaceNav';
import { ApiMockStudioModals } from './components/ApiMockStudioModals';
import { ApiMockStudioActivePanel } from './components/ApiMockStudioActivePanel';
import { isApiMockDemoPersistenceActive, publishApiMockRuntimeChanged, rememberApiMockDemoImportedServer } from './apiMockPersistence';
import { nextApiMockDemoServerName } from './apiMockDemoServers';
import { apiMockControlClient } from './apiMockControlClient';
import type { ScenarioStateSnapshot } from './apiMockControlClient';
import type { ApiMockExportRequest } from './components/ApiMockWorkspaceNav';
import type { ApiMockRouteFolderV1 } from '@shared/api-mock/contracts';
import {
  applyRouteUpdate,
  buildRuntimeMaps,
  duplicateServerDefinition,
  findSelectedRoute,
  formatImportedRoutesMessage,
  formatTabLimitMessage,
  TAB_LIMIT_CONFIRM_OPTIONS,
  isLiveRuntimeStatus,
  mergeConflictAcknowledgements,
  mergeRuntimeInfo,
  API_MOCK_MAX_TABS,
  tryPickNextAutoPort,
  reorderServers,
  runConflictAnalysis,
} from './apiMockPageHelpers';
import { useApiMockServerLibrary } from './useApiMockServerLibrary';
import { useDemoApiMockRoutePatch } from './useDemoApiMockRoutePatch';
import { useApiMockStudioJournal } from './useApiMockStudioJournal';
import { useApiMockStudioPersistence } from './useApiMockStudioPersistence';
import { ApiMockLibraryLanding } from './components/ApiMockLibraryLanding';
import { useApiMockRouteUndo } from './useApiMockRouteUndo';
import { createRoute, createServer, nowIso, type RuntimeInfo } from './apiMockStudioFactory';
import { handleApiMockExport } from './apiMockExportActions';
import type { ApiMockExportResult } from './apiMockExportActions';
import { prepareImportedRoutes, type ImportRoutesOptions } from './apiMockImportRoutes';
import {
  capturedRequestPath,
  copyTransactionToClipboard,
  dispatchOpenInRequests,
  sampleToOpenInRequestsDetail,
  transactionToOpenInRequestsDetail,
  transactionToRouteDraft,
  transactionToSample,
} from './apiMockJournalActions';
import { useApiMockConsole } from './useApiMockConsole';
import { analyzeConflicts } from '@shared/api-mock/conflictAnalyzer';
import { useConfirmDialog } from '@app/hooks/useConfirmDialog';
import { buildRuntimeActionBindings } from './apiMockRuntimeActionBindings';
import { useApiMockRuntimeActions } from './useApiMockRuntimeActions';
import './api-mock-studio.css';
const ts = nowIso;
export function ApiMockStudioPage() {
  const [servers, setServers] = useState<ApiMockServerDefinitionV1[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | undefined>();
  const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
  const [liveMessage, setLiveMessage] = useState('');
  const [runtime, setRuntime] = useState<Record<string, RuntimeInfo>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateSeed, setSimulateSeed] = useState<{ path: string; method: string; sampleId?: string } | undefined>();
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState<'curl' | 'catalog' | 'requests' | 'openapi' | 'wiremock' | 'native' | 'har'>('curl');
  const [exportResult, setExportResult] = useState<ApiMockExportResult | null>(null);
  const [lastNativeExport, setLastNativeExport] = useState('');
  const [conflictIds, setConflictIds] = useState<string[]>([]);
  const [conflictFindings, setConflictFindings] = useState<ApiMockConflictFindingV1[]>([]);
  const [conflictStats, setConflictStats] = useState<{ analyzedRules: number; durationMs: number } | undefined>();
  const [mainView, setMainView] = useState<ApiMockMainView>('studio');
  const [runtimeTabRequest, setRuntimeTabRequest] = useState<ApiMockDockTab | undefined>();
  const [routesDrawerOpen, setRoutesDrawerOpen] = useState(false);
  const [transactions, setTransactions] = useState<ApiMockTransactionV1[]>([]);
  const [scenarioState, setScenarioState] = useState<ScenarioStateSnapshot | null>(null);
  const consoleStreamActive = Object.values(runtime).some(
    r => r.status === 'running'
      || r.status === 'starting'
      || r.status === 'applying'
      || r.status === 'draining',
  );
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const { lines: consoleLines, clear: clearConsole } = useApiMockConsole(consoleStreamActive);

  const forgetRuntime = useCallback((ids: string[]) => {
    setRuntime(prev => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  const library = useApiMockServerLibrary({
    servers,
    setServers,
    activeServerId,
    setActiveServerId,
    setSelectedRouteId,
    setLiveMessage,
    confirm,
    isLive: useCallback((id: string) => isLiveRuntimeStatus(runtime[id]?.status), [runtime]),
    stopServer: useCallback(async (id: string) => { await apiMockControlClient.stop(id); }, []),
    forgetRuntime,
  });
  const { openTabIds, setOpenTabIds, openServers, trackOpenedServer } = library;
  const dismissStudioOverlays = useCallback(() => {
    setExportResult(null);
    setImportOpen(false);
    setSimulateOpen(false);
    setSettingsOpen(false);
    setConflictIds([]);
    setConflictFindings([]);
    setConflictStats(undefined);
  }, []);

  const { latestRef, isHydrated } = useApiMockStudioPersistence({
    servers,
    activeServerId,
    openTabIds,
    setServers,
    setActiveServerId,
    setOpenTabIds,
    setRuntime,
    setTransactions,
    setScenarioState,
    setMainView,
    setLiveMessage,
    onWorkspaceReplaced: dismissStudioOverlays,
  });

  useDemoApiMockRoutePatch({
    getState: useCallback(() => latestRef.current, [latestRef]),
    selectedRouteId,
    setServers,
  });

  useEffect(() => {
    setConflictIds([]);
    setConflictFindings([]);
    setConflictStats(undefined);
    setSimulateOpen(false);
    setSimulateSeed(undefined);
  }, [activeServerId]);
  const activeServerForSelection = servers.find(s => s.id === activeServerId);
  useEffect(() => {
    if (!activeServerForSelection) return;
    if (selectedRouteId && activeServerForSelection.routes.some(r => r.id === selectedRouteId)) return;
    setSelectedRouteId(activeServerForSelection.routes[0]?.id);
  }, [activeServerForSelection, selectedRouteId]);

  const activeStatus = runtime[activeServerId ?? '']?.status;
  useApiMockStudioJournal({
    activeServerId,
    activeStatus,
    latestRef,
    setTransactions,
    setScenarioState,
    setRuntime,
    setServers,
    setLiveMessage,
  });

  const handleClearTransactions = useCallback(async () => {
    /* c8 ignore next */
    if (!activeServerId) return;
    await apiMockControlClient.clearTransactions(activeServerId);
    setTransactions([]);
  }, [activeServerId]);

  const handleResetState = useCallback(async () => {
    /* c8 ignore next */
    if (!activeServerId) return;
    await apiMockControlClient.resetState(activeServerId);
    const res = await apiMockControlClient.state(activeServerId);
    setScenarioState(res.ok ? res.data : { states: {}, counters: {} });
  }, [activeServerId]);

  const activeServer = servers.find(s => s.id === activeServerId);

  const handleCreateServer = useCallback(() => {
    if (openTabIds.length >= API_MOCK_MAX_TABS) {
      confirm(formatTabLimitMessage(), () => {}, undefined, TAB_LIMIT_CONFIRM_OPTIONS);
      return;
    }
    void (async () => {
      const portRes = await apiMockControlClient.nextAutoPort(servers.map(s => s.port));
      const port = portRes.ok ? portRes.data.port : tryPickNextAutoPort(servers);
      if (port == null) {
        confirm(formatTabLimitMessage(), () => {}, undefined, TAB_LIMIT_CONFIRM_OPTIONS);
        return;
      }
      const srv = createServer(servers.length + 1, port);
      if (isApiMockDemoPersistenceActive()) {
        srv.name = nextApiMockDemoServerName(servers.map(s => s.name));
        rememberApiMockDemoImportedServer(srv.id);
      }
      setServers(prev => [...prev, srv]);
      trackOpenedServer(srv.id);
      setActiveServerId(srv.id);
      setSelectedRouteId(undefined);
      setLiveMessage(`${srv.name} created on port ${port}.`);
    })();
  }, [servers, openTabIds, confirm, trackOpenedServer]);

  const handleUpdateServer = useCallback((id: string, patch: Partial<ApiMockServerDefinitionV1>) => {
    setServers(prev => prev.map(s => s.id === id ? { ...s, ...patch, updatedAt: ts() } : s));
  }, []);

  const handleRenameServer = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    handleUpdateServer(id, { name: trimmed });
    setLiveMessage(`Renamed to ${trimmed}.`);
  }, [handleUpdateServer]);

  const handleMoveServerToFolder = useCallback((id: string, folder: string | undefined) => {
    /* c8 ignore next */
    handleUpdateServer(id, { serverFolder: folder });
    setLiveMessage(folder ? `Moved to "${folder}".` : 'Removed from folder.');
  }, [handleUpdateServer]);

  const handleDuplicateServer = useCallback((id: string) => {
    if (openTabIds.length >= API_MOCK_MAX_TABS) {
      confirm(formatTabLimitMessage(), () => {}, undefined, TAB_LIMIT_CONFIRM_OPTIONS);
      return;
    }
    const source = servers.find(s => s.id === id);
    if (!source) return;
    void (async () => {
      const portRes = await apiMockControlClient.nextAutoPort(servers.map(s => s.port));
      const port = portRes.ok ? portRes.data.port : tryPickNextAutoPort(servers);
      if (port == null) {
        confirm(formatTabLimitMessage(), () => {}, undefined, TAB_LIMIT_CONFIRM_OPTIONS);
        return;
      }
      const copy = duplicateServerDefinition(source, port);
      if (isApiMockDemoPersistenceActive()) {
        rememberApiMockDemoImportedServer(copy.id);
      }
      setServers(prev => {
        const idx = prev.findIndex(s => s.id === id);
        const next = [...prev];
        const insertIndex = Math.max(0, idx) + 1;
        next.splice(insertIndex, 0, copy);
        return next;
      });
      trackOpenedServer(copy.id, id);
      setActiveServerId(copy.id);
      setSelectedRouteId(undefined);
      setLiveMessage(`${copy.name} duplicated on port ${port}.`);
    })();
  }, [servers, openTabIds, confirm, trackOpenedServer]);

  // Dragging reorders the tab bar only — the saved library keeps its own order.
  const handleReorderServers = useCallback((fromIndex: number, toIndex: number) => {
    setOpenTabIds(prev => reorderServers(prev, fromIndex, toIndex));
  }, [setOpenTabIds]);

  // Sidebar drag reorders the master server list (persisted order).
  const handleReorderLibrary = useCallback((fromId: string, toId: string) => {
    setServers(prev => {
      const from = prev.findIndex(s => s.id === fromId);
      const to = prev.findIndex(s => s.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      return reorderServers(prev, from, to);
    });
  }, []);

  const handleUpdateSample = useCallback((sample: ApiMockSimulationSampleV1) => {
    /* c8 ignore next */
    if (!activeServerId) return;
    setServers(prev => prev.map(s => (
      s.id === activeServerId
        ? { ...s, samples: (s.samples ?? []).map(x => x.id === sample.id ? sample : x), updatedAt: ts() }
        : s
    )));
  }, [activeServerId]);

  const handleDeleteSample = useCallback((sampleId: string) => {
    /* c8 ignore next */
    if (!activeServerId) return;
    setServers(prev => prev.map(s => (
      s.id === activeServerId
        ? { ...s, samples: (s.samples ?? []).filter(x => x.id !== sampleId), updatedAt: ts() }
        : s
    )));
    setLiveMessage('Example deleted.');
  }, [activeServerId]);

  const handleSetSimulateOpen = useCallback((open: boolean) => {
    if (open) setSimulateSeed(undefined);
    setSimulateOpen(open);
  }, []);
  const handleSimulateSample = useCallback((sample: ApiMockSimulationSampleV1) => {
    const method = sample.request.method && sample.request.method !== 'ANY' ? sample.request.method : 'GET';
    setSimulateSeed({
      path: capturedRequestPath(sample.request),
      method,
      sampleId: sample.id,
    });
    setSimulateOpen(true);
  }, []);

  const handleTrySampleInRequests = useCallback((sample: ApiMockSimulationSampleV1) => {
    /* c8 ignore next */
    if (!activeServer) return;
    dispatchOpenInRequests(sampleToOpenInRequestsDetail(sample, {
      host: activeServer.host,
      port: activeServer.port,
      tls: Boolean(activeServer.settings.tls?.enabled),
    }));
    setLiveMessage('Opened example in Requests.');
  }, [activeServer]);

  const handleAddSample = useCallback((sample: ApiMockSimulationSampleV1) => {
    /* c8 ignore next */
    if (!activeServerId) return;
    setServers(prev => prev.map(s => (
      s.id === activeServerId
        ? { ...s, samples: [...(s.samples ?? []), sample], updatedAt: ts() }
        : s
    )));
    setLiveMessage(`Saved sample “${sample.name}”.`);
  }, [activeServerId]);

  const handleSaveSampleFromTransaction = useCallback((tx: ApiMockTransactionV1) => {
    /* c8 ignore next */
    if (!activeServerId) return;
    const sample = transactionToSample(tx, { routeId: tx.matchedRouteId });
    setServers(prev => prev.map(s => (
      s.id === activeServerId
        ? { ...s, samples: [...(s.samples ?? []), sample], updatedAt: ts() }
        : s
    )));
    setLiveMessage(sample.routeId
      ? `Saved example “${sample.name}” on the matched rule.`
      : `Saved example “${sample.name}” (unassociated — pick a rule to attach it).`);
  }, [activeServerId]);

  const handleCreateRoute = useCallback((folderId?: string) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    const currentRoutes = activeServer.routes ?? [];
    const currentFolders = activeServer.folders ?? [];
    const route = {
      ...createRoute(`New Route ${currentRoutes.length + 1}`),
      ...(folderId ? { folderId } : {}),
    };
    const folders = folderId
      ? currentFolders.map(f => f.id === folderId ? { ...f, expanded: true } : f)
      : currentFolders;
    handleUpdateServer(activeServerId, {
      routes: [...currentRoutes, route],
      ...(folders ? { folders } : {}),
    });
    setSelectedRouteId(route.id);
    setLiveMessage(folderId ? `${route.name} added to folder.` : `${route.name} added.`);
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleMoveRoute = useCallback((routeId: string, folderId: string | undefined) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    const folders = folderId
      ? activeServer.folders.map(f => f.id === folderId ? { ...f, expanded: true } : f)
      : activeServer.folders;
    handleUpdateServer(activeServerId, {
      folders,
      routes: activeServer.routes.map(r => (
        r.id === routeId
          ? { ...r, folderId, updatedAt: ts() }
          : r
      )),
    });
    const folderName = folderId
      ? activeServer.folders.find(f => f.id === folderId)?.name ?? 'folder'
      : 'Ungrouped';
    setLiveMessage(`Moved rule to ${folderName}.`);
  }, [activeServerId, activeServer, handleUpdateServer]);

  const { handleDeleteRoute, undoToast } = useApiMockRouteUndo({
    // Only open tabs: undo must not silently restore a rule onto a parked server.
    servers: openServers,
    activeServerId,
    activeServer,
    selectedRouteId,
    handleUpdateServer,
    setSelectedRouteId,
    setLiveMessage,
    setActiveServerId,
  });

  const handleUpdateRoute = useCallback((routeId: string, patch: Partial<ApiMockServerDefinitionV1['routes'][0]>) => {
    applyRouteUpdate(activeServerId, activeServer, routeId, patch, handleUpdateServer);
  }, [activeServerId, activeServer, handleUpdateServer]);

  const patchRuntime = useCallback((id: string, patch: Partial<RuntimeInfo>) => {
    setRuntime(prev => mergeRuntimeInfo(prev, id, patch));
    if (patch.status === 'running' || patch.status === 'stopped' || patch.status === 'error') {
      publishApiMockRuntimeChanged();
    }
  }, []);
  const { handleStart, handleStop, handleApply, handleRestart } = useApiMockRuntimeActions({
    getServers: () => latestRef.current.servers,
    patchRuntime,
    setLiveMessage,
  });

  const confirmDeleteRoute = useCallback((route: ApiMockServerDefinitionV1['routes'][0]) => {
    confirm(`Delete route "${route.name}"? Samples associated with this route will become unassociated. You can Undo for a few seconds.`, () => handleDeleteRoute(route.id), undefined, { finalNote: '', confirmLabel: 'Delete' });
  }, [confirm, handleDeleteRoute]);

  const handleImportRoutes = useCallback((
    routes: ApiMockServerDefinitionV1['routes'],
    options: ImportRoutesOptions = { mode: 'merge' },
    samples?: ApiMockSimulationSampleV1[],
  ) => {
    if (!activeServerId || !activeServer || routes.length === 0) return;
    const prepared = prepareImportedRoutes({ activeServer, routes, options });
    const serverPatch: Partial<ApiMockServerDefinitionV1> = {
      routes: prepared.nextRoutes,
      folders: prepared.nextFolders,
    };
    if (samples && samples.length > 0) {
      serverPatch.samples = [...(activeServer.samples ?? []), ...samples];
    }
    handleUpdateServer(activeServerId, serverPatch);
    setSelectedRouteId(prepared.selectedRouteId);
    setImportOpen(false);
    setLiveMessage(formatImportedRoutesMessage(prepared.importedCount));
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleAnalyzeConflicts = useCallback(async () => {
    await runConflictAnalysis(
      activeServer,
      analyzeConflicts,
      setConflictIds,
      setLiveMessage,
      findings => setConflictFindings(prev => mergeConflictAcknowledgements(prev, findings as ApiMockConflictFindingV1[])),
      setConflictStats,
    );
  }, [activeServer]);

  const handleAcknowledgeConflict = useCallback((finding: ApiMockConflictFindingV1) => {
    const at = ts();
    setConflictFindings(prev => prev.map(f => (
      f.id === finding.id
        ? { ...f, acknowledgedAt: at, acknowledgementStale: false }
        : f
    )));
    setLiveMessage(finding.acknowledgementStale ? 'Stale conflict re-acknowledged.' : 'Conflict acknowledged.');
  }, []);

  const handleSimulateWitness = useCallback((finding?: ApiMockConflictFindingV1) => {
    const path = finding?.witnessRequest ? capturedRequestPath(finding.witnessRequest) : '/';
    const method = finding?.witnessRequest?.method && finding.witnessRequest.method !== 'ANY'
      ? finding.witnessRequest.method
      : 'GET';
    setSimulateSeed({ path, method });
    setSimulateOpen(true);
  }, []);

  const handleAdjustPriority = useCallback((routeId: string, delta: number) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    const routes = activeServer.routes.map(r => (
      r.id === routeId ? { ...r, priority: r.priority + delta, updatedAt: ts() } : r
    ));
    handleUpdateServer(activeServerId, { routes });
    setLiveMessage(`Priority adjusted for ${routeId}.`);
    void runConflictAnalysis(
      { ...activeServer, routes },
      analyzeConflicts,
      setConflictIds,
      setLiveMessage,
      findings => setConflictFindings(prev => mergeConflictAcknowledgements(prev, findings as ApiMockConflictFindingV1[])),
      setConflictStats,
    );
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleOpenInRequests = useCallback((tx: ApiMockTransactionV1) => {
    /* c8 ignore next */
    if (!activeServer) return;
    dispatchOpenInRequests(transactionToOpenInRequestsDetail(tx, {
      host: activeServer.host,
      port: activeServer.port,
      tls: Boolean(activeServer.settings.tls?.enabled),
    }));
    setLiveMessage('Opened captured request in Requests.');
  }, [activeServer]);

  const handleCreateRouteFromTransaction = useCallback((tx: ApiMockTransactionV1) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    const route = transactionToRouteDraft(tx);
    handleUpdateServer(activeServerId, { routes: [...activeServer.routes, route] });
    setSelectedRouteId(route.id);
    setLiveMessage(`Draft route created from journal: ${route.name}.`);
    return route.id;
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleCopyTransaction = useCallback((tx: ApiMockTransactionV1) => {
    void copyTransactionToClipboard(tx).then(ok => {
      setLiveMessage(ok ? 'Transaction copied to clipboard.' : 'Could not copy transaction.');
    });
  }, []);

  const openRuntime = useCallback((tab: ApiMockDockTab = 'transactions') => {
    setMainView('runtime');
    setRuntimeTabRequest(tab);
  }, []);

  const openConflictInspector = useCallback(() => {
    setMainView('conflicts');
    if (conflictFindings.length === 0) void handleAnalyzeConflicts();
  }, [conflictFindings.length, handleAnalyzeConflicts]);

  const handleAddFolder = useCallback(() => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    const folder: ApiMockRouteFolderV1 = {
      id: `fld-${crypto.randomUUID().slice(0, 8)}`,
      name: `Folder ${activeServer.folders.length + 1}`,
      expanded: true,
      sortOrder: activeServer.folders.length,
    };
    handleUpdateServer(activeServerId, { folders: [...activeServer.folders, folder] });
    setLiveMessage(`${folder.name} added.`);
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleToggleFolder = useCallback((folderId: string) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    handleUpdateServer(activeServerId, {
      folders: activeServer.folders.map(f => f.id === folderId ? { ...f, expanded: !f.expanded } : f),
    });
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleRenameFolder = useCallback((folderId: string, name: string) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    handleUpdateServer(activeServerId, {
      folders: activeServer.folders.map(f => f.id === folderId ? { ...f, name } : f),
    });
    setLiveMessage(`Folder renamed to ${name}.`);
  }, [activeServerId, activeServer, handleUpdateServer]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    /* c8 ignore next */
    if (!activeServerId || !activeServer) return;
    /* c8 ignore next */
    const folder = activeServer.folders.find(f => f.id === folderId);
    if (!folder) return;
    confirm(`Delete folder "${folder.name}"? Rules inside it move to Ungrouped.`, () => {
      handleUpdateServer(activeServerId, {
        folders: activeServer.folders.filter(f => f.id !== folderId),
        routes: activeServer.routes.map(r => r.folderId === folderId ? { ...r, folderId: undefined, updatedAt: ts() } : r),
      });
      setLiveMessage(`${folder.name} deleted.`);
    });
  }, [activeServerId, activeServer, handleUpdateServer, confirm]);

  const handleExport = useCallback(async (req: ApiMockExportRequest) => {
    const result = await handleApiMockExport({
      request: req,
      servers,
      activeServerId,
      transactions,
      setLiveMessage,
    });
    setExportResult(result);
    if (result.nativeJson) setLastNativeExport(result.nativeJson);
  }, [servers, activeServerId, transactions]);

  const selectedRoute = findSelectedRoute(activeServer, selectedRouteId);
  const selectedFolderName = selectedRoute?.folderId
    ? activeServer?.folders.find(f => f.id === selectedRoute.folderId)?.name
    : undefined;

  // ─── Publish server list to the left sidebar ───────────────────────────────
  const { handleOpenFromLibrary } = library;
  useEffect(() => {
    setApiMockServerList({
      entries: servers.map(s => ({
        id: s.id,
        name: s.name,
        port: s.port,
        isOpen: openTabIds.includes(s.id),
        isActive: s.id === activeServerId,
        status: runtime[s.id]?.status ?? 'stopped',
        ruleCount: s.routes?.length ?? 0,
        serverFolder: s.serverFolder,
      })),
      // Library helper reads openTabIds from a ref, so a stale sidebar
      // callback still reopens a parked server after Close.
      onSelect: handleOpenFromLibrary,
      onCreate: handleCreateServer,
      onReorder: handleReorderLibrary,
      onDelete: library.handleDeleteServer,
      onRename: handleRenameServer,
      onMoveToFolder: handleMoveServerToFolder,
    });
  }, [servers, openTabIds, activeServerId, runtime, handleOpenFromLibrary, handleCreateServer, handleReorderLibrary, library.handleDeleteServer, handleRenameServer, handleMoveServerToFolder]);
  // Separate unmount cleanup so the sync effect above doesn't flash null on every deps change
  useEffect(() => () => { setApiMockServerList(null); }, []);

  const { statusById, dirtyById } = buildRuntimeMaps(openServers, runtime);
  const modalRuntimeStatus = runtime[activeServer?.id ?? '']?.status ?? 'stopped';
  const runtimeActionBindings = activeServer
    ? buildRuntimeActionBindings({
      latestRef,
      activeServer,
      onStartServer: handleStart,
      onStopServer: handleStop,
      onApplyServer: handleApply,
      onRestartServer: handleRestart,
    })
    : null;

  return (
    <div className="api-mock-root api-mock-studio" data-testid="api-mock-studio">
      <div className="am-sr-only" role="status" aria-live="polite" data-testid="api-mock-live-region">{liveMessage}</div>
      <ApiMockStudioTitleBar
        servers={openServers}
        activeServerId={activeServerId}
        onSelect={setActiveServerId}
        onCreate={handleCreateServer}
        onClose={library.handleCloseServer}
        onCloseMany={library.handleCloseServers}
        onDelete={library.handleDeleteServer}
        onRename={handleRenameServer}
        onDuplicate={handleDuplicateServer}
        onReorder={handleReorderServers}
        statusById={statusById}
        dirtyById={dirtyById}
      />
      {isHydrated && !activeServer && (
        <ApiMockLibraryLanding onCreate={handleCreateServer} />
      )}
      {activeServer && (
        <ApiMockStudioActivePanel
          activeServer={activeServer}
          mainView={mainView}
          setMainView={setMainView}
          transactions={transactions}
          conflictFindings={conflictFindings}
          conflictIds={conflictIds}
          conflictStats={conflictStats}
          runtimeTabRequest={runtimeTabRequest}
          onRuntimeTabConsumed={() => setRuntimeTabRequest(undefined)}
          runtimeRunning={runtime[activeServer.id]?.status === 'running'}
          dirty={!!dirtyById[activeServer.id]}
          scenarioState={scenarioState}
          consoleLines={consoleLines}
          selectedRouteId={selectedRouteId}
          setSelectedRouteId={setSelectedRouteId}
          selectedRoute={selectedRoute}
          selectedFolderName={selectedFolderName}
          routesDrawerOpen={routesDrawerOpen}
          setRoutesDrawerOpen={setRoutesDrawerOpen}
          onImportOpen={(source) => {
            setExportResult(null);
            setImportSource(source ?? 'curl');
            setImportOpen(true);
          }}
          onExport={handleExport}
          onAnalyzeConflicts={() => { void handleAnalyzeConflicts(); }}
          onStart={runtimeActionBindings!.onStart}
          onStop={runtimeActionBindings!.onStop}
          onApply={runtimeActionBindings!.onApply}
          onRestart={runtimeActionBindings!.onRestart}
          onSettings={() => setSettingsOpen(true)}
          onCreateRoute={handleCreateRoute}
          onConfirmDeleteRoute={confirmDeleteRoute}
          onUpdateRoute={handleUpdateRoute}
          onAddFolder={handleAddFolder}
          onToggleFolder={handleToggleFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onMoveRoute={handleMoveRoute}
          onSetSimulateOpen={handleSetSimulateOpen}
          onSimulateSample={handleSimulateSample}
          onOpenConflictInspector={openConflictInspector}
          onOpenRuntime={openRuntime}
          onResetState={() => { void handleResetState(); }}
          onClearTransactions={() => { void handleClearTransactions(); }}
          onClearConsole={clearConsole}
          onAcknowledgeConflict={handleAcknowledgeConflict}
          onAdjustPriority={handleAdjustPriority}
          onOpenInRequests={handleOpenInRequests}
          onCreateRouteFromTransaction={handleCreateRouteFromTransaction}
          onSaveSampleFromTransaction={handleSaveSampleFromTransaction}
          onCopyTransaction={handleCopyTransaction}
          onUpdateSample={handleUpdateSample}
          onDeleteSample={handleDeleteSample}
          onTrySampleInRequests={handleTrySampleInRequests}
          onSimulateWitness={handleSimulateWitness}
          onUpdateServer={patch => handleUpdateServer(activeServer.id, patch)}
          status={runtime[activeServer.id]?.status ?? 'stopped'}
          generation={runtime[activeServer.id]?.generation ?? 0}
          error={runtime[activeServer.id]?.error}
        />
      )}
      <ApiMockStudioModals
        activeServer={activeServer}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
          runtimeStatus={modalRuntimeStatus}
        libraryServers={servers}
        onUpdateServer={(patch) => {
          if (activeServer) handleUpdateServer(activeServer.id, patch);
        }}
        simulateOpen={simulateOpen}
        setSimulateOpen={setSimulateOpen}
        selectedRoute={selectedRoute}
        simulateSeed={simulateSeed}
        setSimulateSeed={setSimulateSeed}
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        importSource={importSource}
        lastNativeExport={lastNativeExport}
        exportResult={exportResult}
        onCloseExport={() => setExportResult(null)}
        onImportRoutes={handleImportRoutes}
        folders={activeServer?.folders ?? []}
        onSaveSample={handleAddSample}
        onUpdateSample={handleUpdateSample}
      />
      {/* c8 ignore next */}
      {undoToast}
      {library.serverUndoToast}
      {confirmDialogElement}
    </div>
  );
}
