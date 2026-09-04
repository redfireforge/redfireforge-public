import { useState, useCallback } from 'react';
import { useAppLayoutSync } from './hooks/useAppLayoutSync';
import { useAppStartupEffects } from './hooks/useAppStartupEffects';
import { useGalleryMigration } from './hooks/useGalleryMigration';
import { useAppTabSync } from './hooks/useAppTabSync';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useGalleryImport } from './hooks/useGalleryImport';
import { useWorkbenchActions } from './hooks/useWorkbenchActions';
import ThemeCustomizer from './ThemeCustomizer';
import { useWorkflowImportExport } from './hooks/useWorkflowImportExport';
import { useDerivedViewState } from './hooks/useDerivedViewState';
import { useHarnessPromotion } from './hooks/useHarnessPromotion';
import { useCatalogExport } from './hooks/useCatalogExport';
import { useCatalogState } from './hooks/useCatalogState';
import { usePreferencesImport } from './hooks/usePreferencesImport';
import { useGalleryWorkflowPreviewState } from './hooks/useGalleryWorkflowPreviewState';
import { useAppNavigationCallbacks } from './hooks/useAppNavigationCallbacks';
import AppWorkbenchModals from './components/AppWorkbenchModals';
import AppDemoShellMount from './components/AppDemoShellMount';
import AppHeader from './components/AppHeader';
import AppActivityBar from './components/AppActivityBar';
import AppSubNav from './components/AppSubNav';
import AppSidebarRegion from './components/AppSidebarRegion';
import AppShellOverlays from './components/AppShellOverlays';
import AppProtocolStudios from './components/AppProtocolStudios';
import type { ExportToApiMockItem } from '../features/api-mock/components/ExportToApiMockModal';
import { AppShellBanners } from './components/AppShellBanners';
import { DesktopRequiredModal } from './components/DesktopRequiredModal';
import { useDesktopFeatureGate } from './hooks/useDesktopFeatureGate';
import { useRerunFailed } from './hooks/useRerunFailed';
import { useTheme } from './hooks/useTheme';
import { useProjects } from '../features/scenarios/hooks/useProjects';
import { useRequests } from '../features/requests/hooks/useRequests';
import { useRequestTabCoordinator } from '../features/requests/hooks/useRequestTabCoordinator';
import { useCatalog } from '../features/catalog/hooks/useCatalog';
import { useSidebarResize } from './hooks/useSidebarResize';
import ScenarioBuilder from '../features/scenarios/ScenarioBuilder';
import TestRunner from '../features/test-runner/TestRunner';
import ParameterizedRunner from '../features/test-runner/ParameterizedRunner';
import WorkflowRunner from '../features/test-runner/WorkflowRunner';
import ResultsDashboard from '../features/results/ResultsDashboard';
import Requests from '../features/requests/Requests';
import type { PreviewRequest } from '../features/requests/Requests';
import ApiCatalog from '../features/catalog/ApiCatalog';
import SettingsPage from '../features/settings/SettingsModal';
import KafkaSettingsPage from '../features/kafka/KafkaSettingsPage';
import EnvironmentManager from '../features/environments/EnvironmentManager';
import WorkflowDesigner from '@workflow/WorkflowDesigner';
import WorkflowExecutionHistory from '@workflow/WorkflowExecutionHistory';
import WebhookDeliveryLogs from '../features/webhooks/WebhookDeliveryLogs';
import { AppDiscoveryPanes } from './components/AppDiscoveryPanes';
import { useWorkflows } from '@workflow/hooks/useWorkflows';
import { useWorkflowFolders } from '@workflow/hooks/useWorkflowFolders';
import { useToast } from '@shared/hooks/useToast';
import {
  type Tab,
  readTabFromUrl,
} from './utils/appTabUtils';
import { useKafkaState } from './hooks/useKafkaState';
import { loadWorkflowPreviews, getPreviewEntriesForPalette } from '@shared/utils/workflowPreviewStorage';
import type { WorkflowPreviewEntry } from '@shared/utils/workflowPreviewStorage';
import AppLoadingScreen from './components/AppLoadingScreen';
import { useApiMockOpenInRequestsBridge } from './hooks/useApiMockOpenInRequestsBridge';
import { useCatalogPreviewMigrations } from './hooks/useCatalogPreviewMigrations';
import { useHarnessRequestIds } from './hooks/useHarnessRequestIds';
import '../styles/index.css';
import { DEMO_HUB_ENABLED } from '../config/features';
import { useDemoWorkflowBridge } from './hooks/useDemoWorkflowBridge';
import { useDemoWorkspaceDefaultsBridge } from './hooks/useDemoWorkspaceDefaultsBridge';
import { useDemoHarnessBridge } from './hooks/useDemoHarnessBridge';
import { useDemoCatalogBridge } from './hooks/useDemoCatalogBridge';
import { useDemoRequestsBridge } from './hooks/useDemoRequestsBridge';
import { useDemoApiMockBridge } from './hooks/useDemoApiMockBridge';
import { RustExecutorTestPanel } from './rustExecutorDevPanel';

export default function App() {
  const {
    loading,
    environments, setEnvironments,
    microservices, setMicroservices,
    featureGroups, setFeatureGroups,
    appGlobalAuthProfiles, setAppGlobalAuthProfiles,
    sharedDataSources, setSharedDataSources,
    workspaceDefaults, setWorkspaceDefaults,
    selectedEnvId, setSelectedEnvId,
    selectedSvcId, setSelectedSvcId,
    moveScenario, moveTest,
    initialTheme,
  } = useProjects();
  useDemoWorkspaceDefaultsBridge(setWorkspaceDefaults);
  useDemoHarnessBridge(environments, microservices, setEnvironments, setMicroservices, setFeatureGroups, setSelectedEnvId, setSelectedSvcId, setSharedDataSources);

  const [sidebarView, setSidebarView] = useState<'env' | 'svc'>('env');

  const wb = useRequests();
  const reqTabs = useRequestTabCoordinator(wb);
  const catalog = useCatalog();
  useDemoCatalogBridge(catalog, DEMO_HUB_ENABLED);
  useDemoApiMockBridge(DEMO_HUB_ENABLED);

  const [wfPreviewEndpoints, setWfPreviewEndpoints] = useState<WorkflowPreviewEntry[]>([]);
  const refreshWfPreviews = useCallback(() => {
    loadWorkflowPreviews().then(map => setWfPreviewEndpoints(getPreviewEntriesForPalette(map)));
  }, []);
  useCatalogPreviewMigrations(catalog, setWfPreviewEndpoints);
  useDemoRequestsBridge(
    { collections: wb.collections, removeCollection: reqTabs.removeCollection, importCollection: wb.importCollection },
    DEMO_HUB_ENABLED,
  );

  const [workflowRunnerInitialId, setWorkflowRunnerInitialId] = useState<string | null>(null);
  const [workflowRunnerInitialVariables, setWorkflowRunnerInitialVariables] = useState<Record<string, string> | null>(null);
  const wfHook = useWorkflows();
  const selectRunnerWorkflowByName = useCallback((name: string): boolean => {
    const bridge = (window as unknown as { __wfRunnerApplySelection?: (n: string) => boolean })
      .__wfRunnerApplySelection;
    if (bridge?.(name)) return true;
    const wf = wfHook.workflows.find((w) => w.name === name);
    if (!wf) return false;
    setWorkflowRunnerInitialId(wf.id);
    return true;
  }, [wfHook.workflows]);
  const {
    previewWorkflow,
    setPreviewWorkflow,
    pendingTemplateImport,
    setPendingTemplateImport,
    handleTemplatePickFolder,
    handleUseWorkflowAsTemplate,
    clearPreviewWorkflow,
  } = useGalleryWorkflowPreviewState(wfHook);
  useDemoWorkflowBridge(
    wfHook.workflows,
    wfHook.remove,
    DEMO_HUB_ENABLED ? wfHook.insert : undefined,
    DEMO_HUB_ENABLED ? wfHook.select : undefined,
    DEMO_HUB_ENABLED ? wfHook.loaded : false,
    DEMO_HUB_ENABLED ? wfHook.update : undefined,
    DEMO_HUB_ENABLED ? selectRunnerWorkflowByName : undefined,
    DEMO_HUB_ENABLED ? clearPreviewWorkflow : undefined,
  );
  const wfFolders = useWorkflowFolders();
  const { theme, setTheme, showCustomizer, setShowCustomizer, themePickerOpen, setThemePickerOpen, themePickerRef, reapplyTheme, THEMES, THEME_ICONS } = useTheme();
  const toast = useToast();
  const kafkaState = useKafkaState();
  const [activeTab, setActiveTab] = useState<Tab>(() => readTabFromUrl());
  const {
    gatedSetActiveTab,
    desktopRequiredFeature,
    dismissDesktopRequired,
  } = useDesktopFeatureGate(setActiveTab);

  useApiMockOpenInRequestsBridge(wb, reqTabs, (tab) => gatedSetActiveTab(tab));

  const { handleWorkflowExport, handleWorkflowImport, handleExportFolder } = useWorkflowImportExport({
    wfHook, folders: wfFolders.folders, setActiveTab: (t) => gatedSetActiveTab(t as Tab), showToast: toast.show,
  });
  const { handleImportData } = usePreferencesImport({
    setEnvironments,
    setMicroservices,
    setFeatureGroups,
    setAppGlobalAuthProfiles,
    setActiveTab: gatedSetActiveTab,
  });
  const [resultsRunTypeFilter, setResultsRunTypeFilter] = useState<'all' | 'test' | 'workflow' | undefined>();
  const [lastWorkflowOutput, setLastWorkflowOutput] = useState<Record<string, string> | null>(null);

  const { sidebarWidth, sidebarCollapsed, setSidebarCollapsed, handleResizeStart } = useSidebarResize();
  const navigateToTab = useCallback((t: string) => {
    gatedSetActiveTab(t as Tab);
  }, [gatedSetActiveTab]);

  const { confirm, confirmDialogElement } = useConfirmDialog();
  const wbActions = useWorkbenchActions({ wb, activeTab, setActiveTab: (t) => gatedSetActiveTab(t as Tab) });
  const {
    showWbCollectionModal, setShowWbCollectionModal,
    editingWbCollection, setEditingWbCollection,
    editingSubCol, setEditingSubCol,
    newColMode, setNewColMode, setNewColGroupId, subColForEdit,
    handleWbNewCollection, handleWbEditCollection, handleWbSaveCollection,
    handleWbNewRequest, handleEditSubCollection,
  } = wbActions;
  const {
    showSendToHarness,
    setShowSendToHarness,
    batchHarnessTarget,
    setBatchHarnessTarget,
    catalogHarnessEndpoint,
    setCatalogHarnessEndpoint,
    pendingEditTest,
    setPendingEditTest,
    handleSendToHarnessConfirm,
    handleBatchSendToHarnessConfirm,
    harnessPromotionContext,
    catalogHarnessPromotionCtx,
  } = useHarnessPromotion({
    wb,
    featureGroups,
    setFeatureGroups,
    selectedEnvId,
    selectedSvcId,
    setSelectedEnvId,
    setSelectedSvcId,
    appGlobalAuthProfiles,
    microservices,
    environments,
    toast,
    setActiveTab: gatedSetActiveTab,
  });
  const {
    sendToReqEntry,
    setSendToReqEntry,
    sendToReqEpValues,
    sendToReqSingleEndpoint,
    setSendToReqSingleEndpoint,
    inlineExportEpValues,
    handleSendToRequests,
    handleExportSingleEndpoint,
    handleSendToReqConfirm,
    handleInlineExportConfirm,
  } = useCatalogExport({ wb, catalog, appEnvironments: environments, setEnvironments, setActiveTab: gatedSetActiveTab });
  const {
    showCatalogImport,
    setShowCatalogImport,
    catalogReimportId,
    setCatalogReimportId,
    catalogInitialSpec,
    setCatalogInitialSpec,
    catalogVersionHistoryId,
    setCatalogVersionHistoryId,
    catalogEditId,
    setCatalogEditId,
    catalogConvert,
    setCatalogConvert,
    handleExportSpec,
    handleConvertToOpenApi,
    handleSaveConvertedVersion,
    handleBatchConvertToOpenApi,
  } = useCatalogState(catalog, { showToast: toast.show });
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const [exportToMockItems, setExportToMockItems] = useState<ExportToApiMockItem[] | null>(null);
  const [exportToMockSourceKind, setExportToMockSourceKind] = useState<'requests' | 'catalog'>('catalog');
  useAppStartupEffects({
    loading,
    wb,
    environments,
    toast,
    initialTheme,
    setTheme,
    activeTab,
    setActiveTab: gatedSetActiveTab,
  });

  const [galleryInitialDomain, setGalleryInitialDomain] = useState<import('../data/galleries/types').GalleryDomain | undefined>(undefined);

  useAppTabSync(activeTab, setExportToMockItems, setGalleryInitialDomain);

  const headerRef = useAppLayoutSync({ sidebarWidth, sidebarCollapsed });

  useGalleryMigration({ loading, environments, microservices, setMicroservices });

  const {
    selectedEnv, selectedSvc, resolvedBaseUrl, isAdditionalEnv,
    envFallbackAuth, filteredFeatureGroups, unassociatedFeatureGroups,
  } = useDerivedViewState({
    environments, microservices, featureGroups,
    globalAuthProfiles: appGlobalAuthProfiles, selectedEnvId, selectedSvcId,
  });

  const harnessRequestIds = useHarnessRequestIds(featureGroups);

  const { isRerunning, handleRerunFailed } = useRerunFailed({
    featureGroups, resolvedBaseUrl, globalAuthProfiles: appGlobalAuthProfiles, envFallbackAuth,
    onComplete: () => handleCompleteToResults('test'),
  });

  const gallery = useGalleryImport({
    wb, featureGroups, environments, microservices, previewWorkflow, workflows: wfHook.workflows,
    setActiveTab: gatedSetActiveTab, setPreviewRequest, setPreviewWorkflow,
    setCatalogInitialSpec, setShowCatalogImport,
    setFeatureGroups, setEnvironments, setMicroservices,
    setSelectedEnvId, setSelectedSvcId,
  });

  const {
    handleSetActiveTab,
    handleCompleteToResults,
    handleNavigateToKafkaSettings,
    handleUseAsWorkflowInput,
    handleRunInHarness,
    handleImportPreview,
    handleLoadWorkflowTemplate,
    handleBrowseGallery,
  } = useAppNavigationCallbacks({
    activeTab,
    setActiveTab: gatedSetActiveTab,
    setResultsRunTypeFilter,
    setWorkflowRunnerInitialId,
    setWorkflowRunnerInitialVariables,
    wb,
    previewRequest,
    setPreviewRequest,
    setGalleryInitialDomain,
    gallery,
  });

  if (loading) {
    return <AppLoadingScreen />;
  }

  return (
    <>
      <AppDemoShellMount
        enabled={DEMO_HUB_ENABLED}
        navigateToTab={navigateToTab}
        activeTab={activeTab}
        setSidebarCollapsed={setSidebarCollapsed}
        setAppGlobalAuthProfiles={setAppGlobalAuthProfiles}
        setWorkspaceDefaults={setWorkspaceDefaults}
        selectedEnvId={selectedEnvId}
        selectedSvcId={selectedSvcId}
        setEnvironments={setEnvironments}
        setMicroservices={setMicroservices}
        setSelectedEnvId={setSelectedEnvId}
        setSelectedSvcId={setSelectedSvcId}
      />
    <div className={`app ${sidebarCollapsed ? '' : 'sidebar-visible'}`}>
      <AppShellBanners />
      {desktopRequiredFeature && (
        <DesktopRequiredModal
          featureName={desktopRequiredFeature}
          onClose={dismissDesktopRequired}
        />
      )}
      <AppHeader
        headerRef={headerRef}
        activeTab={activeTab}
        environments={environments}
        microservices={microservices}
        selectedEnvId={selectedEnvId}
        setSelectedEnvId={setSelectedEnvId}
        selectedSvcId={selectedSvcId}
        setSelectedSvcId={setSelectedSvcId}
        theme={theme}
        setTheme={setTheme}
        themePickerOpen={themePickerOpen}
        setThemePickerOpen={setThemePickerOpen}
        themePickerRef={themePickerRef}
        THEMES={THEMES}
        THEME_ICONS={THEME_ICONS}
        setShowCustomizer={setShowCustomizer}
        kafkaConnection={kafkaState.connection}
        kafkaClusterName={kafkaState.selectedCluster?.name ?? null}
        kafkaHasClusters={kafkaState.clusters.length > 0}
        onNavigateToKafkaSettings={handleNavigateToKafkaSettings}
      />
      {showCustomizer && (
        <ThemeCustomizer
          currentTheme={theme}
          onClose={() => {
            setShowCustomizer(false);
            reapplyTheme();
          }}
          onApply={(id) => setTheme(id)}
        />
      )}

      <div className="app-body">
      {/* ── Activity Bar ── */}
      <AppActivityBar activeTab={activeTab} setActiveTab={handleSetActiveTab} />

      <AppSidebarRegion
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarWidth={sidebarWidth}
        handleResizeStart={handleResizeStart}
        catalog={catalog}
        wb={wb}
        wfHook={wfHook}
        wfFolders={wfFolders}
        environments={environments}
        microservices={microservices}
        featureGroups={featureGroups}
        selectedEnvId={selectedEnvId}
        selectedSvcId={selectedSvcId}
        setSelectedEnvId={setSelectedEnvId}
        setSelectedSvcId={setSelectedSvcId}
        sidebarView={sidebarView}
        setSidebarView={setSidebarView}
        harnessRequestIds={harnessRequestIds}
        setGalleryInitialDomain={setGalleryInitialDomain}
        setCatalogReimportId={setCatalogReimportId}
        setShowCatalogImport={setShowCatalogImport}
        setCatalogVersionHistoryId={setCatalogVersionHistoryId}
        setCatalogEditId={setCatalogEditId}
        setBatchHarnessTarget={setBatchHarnessTarget}
        handleExportSpec={handleExportSpec}
        handleConvertToOpenApi={handleConvertToOpenApi}
        handleBatchConvertToOpenApi={handleBatchConvertToOpenApi}
        handleWorkflowExport={handleWorkflowExport}
        handleExportFolder={handleExportFolder}
        handleWorkflowImport={handleWorkflowImport}
        handleWbNewCollection={handleWbNewCollection}
        handleWbEditCollection={handleWbEditCollection}
        handleWbNewRequest={handleWbNewRequest}
        handleEditSubCollection={handleEditSubCollection}
        reqTabs={reqTabs}
      />

        <main className="app-main">
          {/* ── Contextual sub-nav ── */}
          {!showCatalogImport && <AppSubNav activeTab={activeTab} setActiveTab={handleSetActiveTab} />}
          {/* Keep mounted when hidden so canvas state (per-step initial variables, etc.) survives tab switches; still persisted via Save + storage on refresh. */}
          <div hidden={activeTab !== 'workflow'} className="workflow-designer-mount">
            <WorkflowDesigner
              collections={wb.collections}
              catalogEntries={catalog.entries}
              previewEndpoints={wfPreviewEndpoints}
              wfHook={wfHook}
              folders={wfFolders.folders}
              environments={environments}
              microservices={microservices}
              globalAuthProfiles={appGlobalAuthProfiles}
              selectedEnvId={selectedEnvId}
              selectedSvcId={selectedSvcId}
              onEnvSelect={setSelectedEnvId}
              onSvcSelect={setSelectedSvcId}
              resolvedBaseUrl={resolvedBaseUrl}
              previewWorkflow={previewWorkflow}
              onClearPreview={clearPreviewWorkflow}
              onUseAsTemplate={handleUseWorkflowAsTemplate}
              onRunInHarness={handleRunInHarness}
              onLoadTemplate={handleLoadWorkflowTemplate}
              onBrowseGallery={handleBrowseGallery}
            />
          </div>
          <AppDiscoveryPanes
            activeTab={activeTab}
            gallery={gallery}
            galleryInitialDomain={galleryInitialDomain}
            onOpenGallery={() => { setGalleryInitialDomain(undefined); gatedSetActiveTab('gallery'); }}
          />
          {activeTab === 'workflow-runner' && (
            <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
              <WorkflowRunner
                workflows={wfHook.workflows}
                folders={wfFolders.folders}
                onComplete={handleCompleteToResults}
                initialWorkflowId={workflowRunnerInitialId}
                onClearInitialWorkflowId={() => setWorkflowRunnerInitialId(null)}
                initialWorkflowVariables={workflowRunnerInitialVariables}
                onClearInitialWorkflowVariables={() => setWorkflowRunnerInitialVariables(null)}
                onWorkflowOutputAvailable={setLastWorkflowOutput}
                resolvedBaseUrl={resolvedBaseUrl}
                microservices={microservices}
                globalAuthProfiles={appGlobalAuthProfiles}
                selectedEnvId={selectedEnvId}
                selectedSvcId={selectedSvcId}
                onImportSample={(wf) => {
                  const existing = wfHook.workflows.find(w => w.id === wf.id);
                  if (existing) {
                    wfHook.update(wf.id, { nodes: wf.nodes, edges: wf.edges, variables: wf.variables, name: wf.name, description: wf.description });
                  } else {
                    wfHook.insert(wf);
                  }
                  return wf.id;
                }}
                onUpdateWorkflow={(id, patch) => wfHook.update(id, patch)}
              />
            </div>
          )}
          {activeTab === 'workflow-executions' && (
            <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column' }}>
              <WorkflowExecutionHistory />
            </div>
          )}
          {activeTab === 'webhook-deliveries' && (
            <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column' }}>
              <WebhookDeliveryLogs />
            </div>
          )}
          {activeTab === 'environments' && (
            <EnvironmentManager
              environments={environments}
              setEnvironments={setEnvironments}
              microservices={microservices}
              setMicroservices={setMicroservices}
              workspaceDefaults={workspaceDefaults}
              setWorkspaceDefaults={setWorkspaceDefaults}
              appGlobalAuthProfiles={appGlobalAuthProfiles}
              featureGroups={featureGroups}
              selectedEnvId={selectedEnvId}
              selectedSvcId={selectedSvcId}
              setSelectedEnvId={setSelectedEnvId}
              setSelectedSvcId={setSelectedSvcId}
              confirm={confirm}
            />
          )}

          {activeTab === 'preferences' && (
            <SettingsPage
              appGlobalAuthProfiles={appGlobalAuthProfiles}
              setAppGlobalAuthProfiles={setAppGlobalAuthProfiles}
              environments={environments}
              microservices={microservices}
              featureGroups={featureGroups}
              onImport={handleImportData}
              confirm={confirm}
            />
          )}

          {activeTab === 'kafka-settings' && (
            <KafkaSettingsPage kafkaState={kafkaState} />
          )}
          <AppProtocolStudios
            activeTab={activeTab}
            kafkaState={kafkaState}
            onNavigateToKafkaSettings={handleNavigateToKafkaSettings}
            onUseAsWorkflowInput={handleUseAsWorkflowInput}
            lastWorkflowOutput={lastWorkflowOutput}
            resolvedBaseUrl={resolvedBaseUrl}
            selectedEnvName={selectedEnv?.name}
            selectedSvcName={selectedSvc?.name}
            selectedSvc={selectedSvc}
            selectedEnvId={selectedEnvId}
            appGlobalAuthProfiles={appGlobalAuthProfiles}
            workspaceDefaults={workspaceDefaults}
          />

          {activeTab === 'scenarios' && (
            <ScenarioBuilder
              featureGroups={filteredFeatureGroups}
              setFeatureGroups={setFeatureGroups}
              sharedDataSources={sharedDataSources}
              setSharedDataSources={setSharedDataSources}
              resolvedBaseUrl={resolvedBaseUrl}
              selectedSvcId={selectedSvcId}
              selectedSvcName={selectedSvc?.name}
              selectedEnvId={selectedEnvId}
              selectedEnvName={selectedEnv?.name}
              isAdditionalEnv={isAdditionalEnv}
              unassociatedFeatureGroups={unassociatedFeatureGroups}
              microservices={microservices}
              environments={environments}
              globalAuthProfiles={appGlobalAuthProfiles}
              onMoveScenario={moveScenario}
              onMoveTest={moveTest}
              pendingEditTest={pendingEditTest}
              onPendingEditConsumed={() => setPendingEditTest(undefined)}
              onLocateRequest={(requestId) => {
                for (const col of wb.collections) {
                  const found = col.requests.find(r => r.id === requestId)
                    || col.folders?.flatMap(f => f.requests).find(r => r.id === requestId);
                  if (found) {
                    reqTabs.selectRequest(col.id, found.id);
                    setActiveTab('requests');
                    return;
                  }
                }
                toast.show('warning', 'Source request not found', 'The originating request may have been deleted');
              }}
            />
          )}
          {/* Keep TestRunner mounted so in-flight tests survive tab switches */}
          <div hidden={activeTab !== 'runner'}>
            <TestRunner
              featureGroups={filteredFeatureGroups}
              onComplete={handleCompleteToResults}
              envName={selectedEnv?.name}
              svcName={selectedSvc?.name}
              envId={selectedEnvId}
              svcId={selectedSvcId}
              isAdditionalEnv={isAdditionalEnv}
              resolvedBaseUrl={resolvedBaseUrl}
              microservices={microservices}
              globalAuthProfiles={appGlobalAuthProfiles}
              envFallbackAuth={envFallbackAuth}
              sharedDataSources={sharedDataSources}
              visible={activeTab === 'runner'}
            />
          </div>
          {/* Keep ParameterizedRunner mounted so in-flight tests survive tab switches */}
          <div hidden={activeTab !== 'param-runner'}>
            <ParameterizedRunner
              featureGroups={filteredFeatureGroups}
              onComplete={handleCompleteToResults}
              envName={selectedEnv?.name}
              svcName={selectedSvc?.name}
              envId={selectedEnvId}
              svcId={selectedSvcId}
              isAdditionalEnv={isAdditionalEnv}
              resolvedBaseUrl={resolvedBaseUrl}
              microservices={microservices}
              globalAuthProfiles={appGlobalAuthProfiles}
              envFallbackAuth={envFallbackAuth}
              sharedDataSources={sharedDataSources}
              visible={activeTab === 'param-runner'}
            />
          </div>
          {activeTab === 'results' && (
            <ResultsDashboard
              envName={selectedEnv?.name}
              svcName={selectedSvc?.name}
              onRerunFailed={handleRerunFailed}
              isRerunning={isRerunning}
              initialRunTypeFilter={resultsRunTypeFilter}
              onNavigate={navigateToTab}
            />
          )}
          <div className="app-tab-pane" style={{ display: activeTab === 'catalog' ? 'flex' : 'none' }}>
            <ApiCatalog
              catalog={catalog}
              onImport={() => { setCatalogReimportId(undefined); setShowCatalogImport(true); }}
              onReimport={(entryId) => { setCatalogReimportId(entryId); setShowCatalogImport(true); }}
              onVersionHistory={(entryId) => setCatalogVersionHistoryId(entryId)}
              onExportSpec={handleExportSpec}
              onConvertToOpenApi={handleConvertToOpenApi}
              onSendToRequests={handleSendToRequests}
              onExportSingleEndpoint={handleExportSingleEndpoint}
              onEditEntry={(entryId) => setCatalogEditId(entryId)}
              globalAuthProfiles={appGlobalAuthProfiles}
              appEnvironments={environments}
              appMicroservices={microservices}
              collections={wb.collections}
              onNavigateToRequest={(colId, reqId) => { reqTabs.selectRequest(colId, reqId); setActiveTab('requests'); }}
              savedEpValues={inlineExportEpValues}
              onExportConfirm={handleInlineExportConfirm}
              onSendEndpointToHarness={(entry, endpoint, fromTryItOut) => {
                setCatalogHarnessEndpoint({ entry, endpoint, fromTryItOut });
                setShowSendToHarness(true);
              }}
              onExportEndpointToApiMock={(endpoint) => {
                setExportToMockItems([{
                  method: endpoint.method,
                  path: endpoint.path,
                  label: endpoint.summary ?? endpoint.operationId,
                }]);
                setExportToMockSourceKind('catalog');
              }}
              onPreviewsChanged={refreshWfPreviews}
            />
          </div>
          <div className="app-tab-pane" style={{ display: activeTab === 'requests' ? 'flex' : 'none' }}>
            <Requests
              wb={wb}
              appGlobalAuthProfiles={appGlobalAuthProfiles}
              appMicroservices={microservices}
              appEnvironments={environments}
              previewRequest={previewRequest}
              onClearPreview={() => { setPreviewRequest(null); setGalleryInitialDomain(undefined); setActiveTab('gallery'); }}
              onSendToHarness={() => setShowSendToHarness(true)}
              harnessRequestIds={harnessRequestIds}
              onImportPreview={handleImportPreview}
              tabs={reqTabs.tabs}
              activeTabId={reqTabs.activeTabId}
              activeTab={reqTabs.activeTab}
              onSelectTab={reqTabs.selectTab}
              onCloseTab={reqTabs.closeTab}
              onAddTab={reqTabs.addTab}
              onRenameTab={reqTabs.renameTab}
              onReorderTabs={reqTabs.reorderTabs}
              onDuplicateTab={reqTabs.duplicateTab}
              onCloseOtherTabs={reqTabs.closeOtherTabs}
              onCloseTabsToRight={reqTabs.closeTabsToRight}
              onCloseAllTabs={() => reqTabs.closeOtherTabs(reqTabs.activeTabId)}
              onEnvChange={reqTabs.envChange}
              onUpdateTabUI={reqTabs.updateTabUI}
              onSyncTabLabel={reqTabs.syncTabLabel}
            />
          </div>
          <AppWorkbenchModals
            catalog={catalog}
            wb={wb}
            environments={environments}
            microservices={microservices}
            featureGroups={featureGroups}
            sendToReqEntry={sendToReqEntry}
            setSendToReqEntry={setSendToReqEntry}
            sendToReqEpValues={sendToReqEpValues}
            sendToReqSingleEndpoint={sendToReqSingleEndpoint}
            setSendToReqSingleEndpoint={setSendToReqSingleEndpoint}
            handleSendToReqConfirm={handleSendToReqConfirm}
            showSendToHarness={showSendToHarness}
            setShowSendToHarness={setShowSendToHarness}
            catalogHarnessEndpoint={catalogHarnessEndpoint}
            setCatalogHarnessEndpoint={setCatalogHarnessEndpoint}
            catalogHarnessPromotionCtx={catalogHarnessPromotionCtx}
            handleSendToHarnessConfirm={handleSendToHarnessConfirm}
            harnessPromotionContext={harnessPromotionContext}
            batchHarnessTarget={batchHarnessTarget}
            setBatchHarnessTarget={setBatchHarnessTarget}
            handleBatchSendToHarnessConfirm={handleBatchSendToHarnessConfirm}
            showCatalogImport={showCatalogImport}
            catalogReimportId={catalogReimportId}
            catalogInitialSpec={catalogInitialSpec}
            setShowCatalogImport={setShowCatalogImport}
            setCatalogReimportId={setCatalogReimportId}
            setCatalogInitialSpec={setCatalogInitialSpec}
            setActiveTab={gatedSetActiveTab}
            catalogVersionHistoryId={catalogVersionHistoryId}
            setCatalogVersionHistoryId={setCatalogVersionHistoryId}
            catalogEditId={catalogEditId}
            setCatalogEditId={setCatalogEditId}
            catalogConvert={catalogConvert}
            setCatalogConvert={setCatalogConvert}
            handleSaveConvertedVersion={handleSaveConvertedVersion}
            showToast={toast.show}
            exportToMockItems={exportToMockItems}
            exportToMockSourceKind={exportToMockSourceKind}
            onClearExportToMock={() => setExportToMockItems(null)}
          />
        </main>
      </div>

      <AppShellOverlays
        showWbCollectionModal={showWbCollectionModal}
        setShowWbCollectionModal={setShowWbCollectionModal}
        editingWbCollection={editingWbCollection}
        setEditingWbCollection={setEditingWbCollection}
        newColMode={newColMode}
        setNewColGroupId={setNewColGroupId}
        setNewColMode={setNewColMode}
        wb={wb}
        environments={environments}
        microservices={microservices}
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        handleWbSaveCollection={handleWbSaveCollection}
        editingSubCol={editingSubCol}
        setEditingSubCol={setEditingSubCol}
        subColForEdit={subColForEdit}
        confirmDialogElement={confirmDialogElement}
        pendingTemplateImport={pendingTemplateImport}
        setPendingTemplateImport={setPendingTemplateImport}
        wfFolders={wfFolders}
        handleTemplatePickFolder={handleTemplatePickFolder}
        RustExecutorTestPanel={RustExecutorTestPanel}
      />

    </div>
    </>
  );
}
