// @vitest-environment jsdom
/**
 * Unit tests for the root composition component `App.tsx`.
 *
 * App imports ~30 feature components and ~20 hooks. Every heavy child and every
 * hook is mocked so the test stays fast and isolated and we exercise App's OWN
 * code: the tab render switch, callback/handler wiring, and useEffect branches.
 *
 * The real `./utils/appTabUtils` is NOT mocked — tab logic is driven through the
 * mocked AppActivityBar stub (which exposes a `goto-<tab>` button per tab) and
 * via `window.location` for the initial-tab read.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Ref } from 'react';
import { sampleWorkflowCatalog } from '../data/galleries/workflows';
import { API_MOCK_OPEN_IN_REQUESTS_EVENT } from '../features/api-mock/apiMockJournalActions';

/* ── Shared mutable mock state (hoisted above vi.mock factories) ────────── */
const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  /** Invoke a function prop captured on a stub, ignoring missing/non-fn. */
  const call = (p: Record<string, unknown>, k: string, ...args: unknown[]): void => {
    const f = p[k];
    if (typeof f === 'function') (f as (...a: unknown[]) => unknown)(...args);
  };

  const ALL_TABS = [
    'environments', 'preferences', 'kafka-settings', 'requests', 'catalog',
    'workflow', 'workflow-executions', 'webhook-deliveries', 'workflow-runner',
    'gallery', 'training', 'scenarios', 'runner', 'param-runner', 'results',
    'kafka-message-studio', 'websocket-studio', 'sse-studio', 'graphql-studio', 'grpc-studio',
    'demo-hub',
  ];

  return {
    call,
    ALL_TABS,
    storageFullCb: null as ((key: string) => void) | null,
    storageFullCleanup: vi.fn(),
    cleanupStale: vi.fn(),
    galleryArgs: {} as Record<string, unknown>,
    prefArgs: {} as Record<string, unknown>,
    wfIeArgs: {} as Record<string, unknown>,
    wbArgs: {} as Record<string, unknown>,
    rerunArgs: {} as Record<string, unknown>,
  confirm: vi.fn(),

  demoLive: {
    hasRestorable: vi.fn(() => false),
    purge: vi.fn(async () => undefined),
  },

  featureFlags: {
    demoHubEnabled: true,
  },

  projects: {
      loading: false,
      environments: [] as unknown[],
      setEnvironments: fn(),
      microservices: [] as unknown[],
      setMicroservices: fn(),
      featureGroups: [] as unknown[],
      setFeatureGroups: fn(),
      appGlobalAuthProfiles: [] as unknown[],
      setAppGlobalAuthProfiles: fn(),
      sharedDataSources: [] as unknown[],
      setSharedDataSources: fn(),
      workspaceDefaults: {} as Record<string, string>,
      setWorkspaceDefaults: fn(),
      selectedEnvId: 'env-1',
      setSelectedEnvId: fn(),
      selectedSvcId: 'svc-1',
      setSelectedSvcId: fn(),
      moveScenario: fn(),
      moveTest: fn(),
      initialTheme: 'midnight',
      initialTestRuns: [] as unknown[],
    },

    wb: {
      loaded: true,
      data: { environments: [] as unknown[], collections: [] as unknown[] },
      collections: [] as unknown[],
      environments: [] as unknown[],
      reconcileEnvironmentKeys: vi.fn(() => [] as string[]),
      selectedCollection: { id: 'c1' },
      selectedRequest: { id: 'r1' },
      selectCollection: fn(),
      selectRequest: fn(),
      removeCollection: fn(),
      duplicateCollection: fn(),
      removeRequest: fn(),
      duplicateRequest: fn(),
      addFolder: fn(),
      addSubCollection: fn(),
      renameFolder: fn(),
      removeFolder: fn(),
      duplicateFolder: fn(),
      moveFolder: fn(),
      moveFolderTo: fn(),
      moveRequest: fn(),
      moveRequestToCollection: fn(),
      moveFolderToCollection: fn(),
      moveCollectionAsSubCollection: fn(),
      countAllRequests: vi.fn(() => 0),
      importCollection: fn(),
      importFolder: fn(),
      addGroup: fn(),
      renameGroup: fn(),
      deleteGroup: fn(),
      moveToGroup: fn(),
      duplicateGroup: fn(),
      addCollection: vi.fn(() => 'new-col'),
      addRequest: vi.fn(() => 'new-req'),
      updateRequest: fn(),
      updateSubCollection: fn(),
    },

    reqTabs: {
      tabs: [] as unknown[],
      activeTabId: 'tab-1',
      activeTab: null as unknown,
      selectTab: fn(),
      closeTab: fn(),
      addTab: fn(),
      renameTab: fn(),
      reorderTabs: fn(),
      duplicateTab: fn(),
      closeOtherTabs: fn(),
      closeTabsToRight: fn(),
      envChange: fn(),
      selectRequest: fn(),
      openTabRequestIds: new Set<string>(),
      removeRequest: fn(),
      removeCollection: fn(),
      removeStaleTab: fn(),
      removeStaleTabsByCollection: fn(),
      syncTabLabel: fn(),
      updateTabUI: fn(),
    },

    catalog: {
      loaded: true,
      entries: [] as unknown[],
      selectedEntryId: null as string | null,
      selectEntry: fn(),
      removeEntry: fn(),
    },

    wfHook: {
      workflows: [] as Array<Record<string, unknown>>,
      selectedId: null as string | null,
      select: fn(),
      create: fn(),
      update: fn(),
      remove: fn(),
      duplicate: fn(),
      reorder: fn(),
      insert: fn(),
    },

    preview: {
      previewWorkflow: null as unknown,
      setPreviewWorkflow: fn(),
      pendingTemplateImport: null as unknown,
      setPendingTemplateImport: fn(),
      handleTemplatePickFolder: fn(),
      handleUseWorkflowAsTemplate: fn(),
      clearPreviewWorkflow: fn(),
    },

    wfFolders: {
      folders: [] as unknown[],
      loaded: true,
      toggleCollapse: fn(),
      setCollapsed: fn(),
      create: fn(),
      rename: fn(),
      remove: fn(),
      move: fn(),
    },

    theme: {
      theme: 'midnight',
      setTheme: fn(),
      showCustomizer: false,
      setShowCustomizer: fn(),
      themePickerOpen: false,
      setThemePickerOpen: fn(),
      themePickerRef: { current: null },
      reapplyTheme: fn(),
      THEMES: [] as unknown[],
      THEME_ICONS: {} as Record<string, unknown>,
    },

    toast: { show: vi.fn() },

    kafkaState: { connection: null, selectedCluster: null, clusters: [] as unknown[] },

    wfImportExport: {
      handleWorkflowExport: fn(),
      handleWorkflowImport: fn(),
      handleExportFolder: fn(),
    },

    prefImport: { handleImportData: fn() },

    sidebarResize: {
      sidebarWidth: 280,
      sidebarCollapsed: false,
      setSidebarCollapsed: fn(),
      handleResizeStart: fn(),
    },

    wbActions: {
      showWbCollectionModal: false,
      setShowWbCollectionModal: fn(),
      editingWbCollection: null as unknown,
      setEditingWbCollection: fn(),
      editingSubCol: null as null | { colId: string; folderId: string },
      setEditingSubCol: fn(),
      newColMode: undefined as unknown,
      setNewColMode: fn(),
      setNewColGroupId: fn(),
      subColForEdit: null as null | { folder: unknown; col: unknown },
      handleWbNewCollection: fn(),
      handleWbEditCollection: fn(),
      handleWbSaveCollection: fn(),
      handleWbNewRequest: fn(),
      handleEditSubCollection: fn(),
    },

    harness: {
      showSendToHarness: false,
      setShowSendToHarness: fn(),
      batchHarnessTarget: null as unknown,
      setBatchHarnessTarget: fn(),
      catalogHarnessEndpoint: null as unknown,
      setCatalogHarnessEndpoint: fn(),
      pendingEditTest: undefined as unknown,
      setPendingEditTest: fn(),
      handleSendToHarnessConfirm: fn(),
      handleBatchSendToHarnessConfirm: fn(),
      harnessPromotionContext: null as unknown,
      catalogHarnessPromotionCtx: null as unknown,
    },

    catalogExport: {
      sendToReqEntry: null as unknown,
      setSendToReqEntry: fn(),
      sendToReqEpValues: {} as Record<string, unknown>,
      sendToReqSingleEndpoint: null as unknown,
      setSendToReqSingleEndpoint: fn(),
      inlineExportEpValues: {} as Record<string, unknown>,
      handleSendToRequests: fn(),
      handleExportSingleEndpoint: fn(),
      handleSendToReqConfirm: fn(),
      handleInlineExportConfirm: fn(),
    },

    catalogState: {
      showCatalogImport: false,
      setShowCatalogImport: fn(),
      catalogReimportId: undefined as unknown,
      setCatalogReimportId: fn(),
      catalogInitialSpec: null as unknown,
      setCatalogInitialSpec: fn(),
      catalogVersionHistoryId: null as unknown,
      setCatalogVersionHistoryId: fn(),
      catalogEditId: null as unknown,
      setCatalogEditId: fn(),
      handleExportSpec: fn(),
      handleConvertToOpenApi: fn(),
    },

    derived: {
      selectedEnv: { name: 'Env A' },
      selectedSvc: { name: 'Svc A' },
      resolvedBaseUrl: 'http://localhost:9000',
      isAdditionalEnv: false,
      envFallbackAuth: null as unknown,
      filteredFeatureGroups: [] as unknown[],
      unassociatedFeatureGroups: [] as unknown[],
    },

    rerun: { isRerunning: false, handleRerunFailed: vi.fn() },

    gallery: {
      importedSamples: [] as unknown[],
      onImportRequest: fn(),
      onTryItRequest: fn(),
      onImportCatalog: fn(),
      onImportTest: fn(),
      onImportWorkflow: vi.fn(),
      onNavigateTo: fn(),
    },

    exportModalProps: {} as Record<string, unknown>,
    workbenchModalsProps: {} as Record<string, unknown>,
  };
});

/* ── Hook mocks ─────────────────────────────────────────────────────────── */
vi.mock('../features/scenarios/hooks/useProjects', () => ({ useProjects: () => h.projects }));
vi.mock('../features/requests/hooks/useRequests', () => ({ useRequests: () => h.wb }));
vi.mock('../features/requests/hooks/useRequestTabCoordinator', () => ({ useRequestTabCoordinator: () => h.reqTabs }));
vi.mock('../features/catalog/hooks/useCatalog', () => ({ useCatalog: () => h.catalog }));
vi.mock('../features/workflow/hooks/useWorkflows', () => ({ useWorkflows: () => h.wfHook }));
vi.mock('../features/workflow/hooks/useWorkflowFolders', () => ({ useWorkflowFolders: () => h.wfFolders }));
vi.mock('../shared/hooks/useToast', () => ({ useToast: () => h.toast }));
vi.mock('./hooks/useTheme', () => ({ useTheme: () => h.theme }));
vi.mock('./hooks/useKafkaState', () => ({ useKafkaState: () => h.kafkaState }));
vi.mock('./hooks/useSidebarResize', () => ({ useSidebarResize: () => h.sidebarResize }));
vi.mock('./hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: h.confirm, confirmDialogElement: <div data-testid="confirm-dialog" /> }),
}));
vi.mock('./hooks/useWorkbenchActions', () => ({
  useWorkbenchActions: (args: Record<string, unknown>) => { h.wbArgs = args; return h.wbActions; },
}));
vi.mock('./hooks/useHarnessPromotion', () => ({ useHarnessPromotion: () => h.harness }));
vi.mock('./hooks/useCatalogExport', () => ({ useCatalogExport: () => h.catalogExport }));
vi.mock('./hooks/useCatalogState', () => ({ useCatalogState: () => h.catalogState }));
vi.mock('./hooks/useDerivedViewState', () => ({ useDerivedViewState: () => h.derived }));
vi.mock('./hooks/useRerunFailed', () => ({
  useRerunFailed: (args: Record<string, unknown>) => { h.rerunArgs = args; return h.rerun; },
}));
vi.mock('./hooks/useGalleryWorkflowPreviewState', () => ({ useGalleryWorkflowPreviewState: () => h.preview }));
vi.mock('./hooks/useWorkflowImportExport', () => ({
  useWorkflowImportExport: (args: Record<string, unknown>) => { h.wfIeArgs = args; return h.wfImportExport; },
}));
vi.mock('./hooks/usePreferencesImport', () => ({
  usePreferencesImport: (args: Record<string, unknown>) => { h.prefArgs = args; return h.prefImport; },
}));
vi.mock('./hooks/useGalleryImport', () => ({
  useGalleryImport: (args: Record<string, unknown>) => { h.galleryArgs = args; return h.gallery; },
}));
vi.mock('../shared/utils/storage', () => ({
  onStorageFull: vi.fn((cb: (key: string) => void) => { h.storageFullCb = cb; return h.storageFullCleanup; }),
  cleanupStaleStorageKeys: () => h.cleanupStale(),
  ensureBrowserLargeDataMigrated: vi.fn(async () => undefined),
  readKey: vi.fn(async () => null),
  writeKey: vi.fn(async () => undefined),
}));

vi.mock('../config/features', () => ({
  get DEMO_HUB_ENABLED() {
    return h.featureFlags.demoHubEnabled;
  },
}));

vi.mock('@redfireforge/demo-hub/demoLiveSession', () => ({
  hasRestorableDemoLiveSession: () => h.demoLive.hasRestorable(),
}));

vi.mock('@redfireforge/demo-hub/lessons/gql-demo-storage-cleanup', () => ({
  purgeGqlDemoEphemeralStorage: () => h.demoLive.purge(),
}));

/* ── Component stubs ───────────────────────────────────────────────────── */
vi.mock('./components/AppActivityBar', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="activity-bar">
      {h.ALL_TABS.map((t) => (
        <button key={t} data-testid={`goto-${t}`} onClick={() => h.call(props, 'setActiveTab', t)}>{t}</button>
      ))}
    </div>
  ),
}));
vi.mock('./components/AppSubNav', () => ({
  default: () => <div data-testid="sub-nav" />,
}));
vi.mock('./components/AppHeader', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="app-header" ref={props.headerRef as Ref<HTMLDivElement>}>
      <button data-testid="header-kafka" onClick={() => h.call(props, 'onNavigateToKafkaSettings')}>k</button>
      <button data-testid="header-customize" onClick={() => h.call(props, 'setShowCustomizer', true)}>c</button>
    </div>
  ),
}));
vi.mock('./ThemeCustomizer', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="theme-customizer">
      <button data-testid="theme-close" onClick={() => h.call(props, 'onClose')}>x</button>
      <button data-testid="theme-apply" onClick={() => h.call(props, 'onApply', 'ocean')}>a</button>
    </div>
  ),
}));
vi.mock('./components/AppWorkbenchModals', () => ({
  default: (props: Record<string, unknown>) => {
    h.workbenchModalsProps = props;
    return <div data-testid="workbench-modals" />;
  },
}));
vi.mock('../features/scenarios/ScenarioBuilder', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="scenario-builder">
      <button data-testid="sb-locate-found" onClick={() => h.call(props, 'onLocateRequest', 'req-1')}>f</button>
      <button data-testid="sb-locate-missing" onClick={() => h.call(props, 'onLocateRequest', 'nope')}>m</button>
      <button data-testid="sb-pending-consumed" onClick={() => h.call(props, 'onPendingEditConsumed')}>p</button>
    </div>
  ),
}));
vi.mock('../features/test-runner/TestRunner', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="test-runner">
      <button data-testid="runner-complete" onClick={() => h.call(props, 'onComplete', 'test')}>r</button>
    </div>
  ),
}));
vi.mock('../features/test-runner/ParameterizedRunner', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="parameterized-runner">
      <button data-testid="param-complete" onClick={() => h.call(props, 'onComplete', undefined)}>p</button>
    </div>
  ),
}));
vi.mock('../features/test-runner/WorkflowRunner', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="workflow-runner">
      <button data-testid="wfr-complete" onClick={() => h.call(props, 'onComplete', 'workflow')}>c</button>
      <button data-testid="wfr-clear-id" onClick={() => h.call(props, 'onClearInitialWorkflowId')}>i</button>
      <button data-testid="wfr-clear-vars" onClick={() => h.call(props, 'onClearInitialWorkflowVariables')}>v</button>
      <button data-testid="wfr-output" onClick={() => h.call(props, 'onWorkflowOutputAvailable', { out: '1' })}>o</button>
      <button
        data-testid="wfr-import-existing"
        onClick={() => h.call(props, 'onImportSample', { id: 'wf-existing', nodes: [], edges: [], variables: {}, name: 'n', description: 'd' })}
      >e</button>
      <button
        data-testid="wfr-import-new"
        onClick={() => h.call(props, 'onImportSample', { id: 'wf-new', nodes: [], edges: [], variables: {}, name: 'n', description: 'd' })}
      >n</button>
      <button data-testid="wfr-update" onClick={() => h.call(props, 'onUpdateWorkflow', 'wf-x', { name: 'z' })}>u</button>
    </div>
  ),
}));
vi.mock('../features/results/ResultsDashboard', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="results-dashboard">
      <button data-testid="results-rerun" onClick={() => h.call(props, 'onRerunFailed')}>r</button>
    </div>
  ),
}));
vi.mock('../features/requests/Requests', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="requests-page">
      <button data-testid="req-clear-preview" onClick={() => h.call(props, 'onClearPreview')}>c</button>
      <button data-testid="req-send-harness" onClick={() => h.call(props, 'onSendToHarness')}>h</button>
      <button data-testid="req-import-preview" onClick={() => h.call(props, 'onImportPreview')}>i</button>
      <button data-testid="req-close-all-tabs" onClick={() => h.call(props, 'onCloseAllTabs')}>a</button>
      <button data-testid="req-close-tabs-right" onClick={() => h.call(props, 'onCloseTabsToRight', 'tab-1')}>r</button>
      <button data-testid="req-reorder-tabs" onClick={() => h.call(props, 'onReorderTabs', 0, 1)}>o</button>
      <button data-testid="req-duplicate-tab" onClick={() => h.call(props, 'onDuplicateTab', 'tab-1')}>d</button>
      <button data-testid="req-env-change" onClick={() => h.call(props, 'onEnvChange', 'env-2')}>e</button>
      <button data-testid="req-update-tab-ui" onClick={() => h.call(props, 'onUpdateTabUI', 'tab-1', { dirty: true })}>u</button>
      <button data-testid="req-sync-tab-label" onClick={() => h.call(props, 'onSyncTabLabel', 'tab-1', 'Renamed')}>s</button>
    </div>
  ),
}));
vi.mock('../features/catalog/ApiCatalog', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="api-catalog">
      <button data-testid="ac-import" onClick={() => h.call(props, 'onImport')}>i</button>
      <button data-testid="ac-reimport" onClick={() => h.call(props, 'onReimport', 'e1')}>r</button>
      <button data-testid="ac-version" onClick={() => h.call(props, 'onVersionHistory', 'e1')}>v</button>
      <button data-testid="ac-edit" onClick={() => h.call(props, 'onEditEntry', 'e1')}>e</button>
      <button data-testid="ac-navigate" onClick={() => h.call(props, 'onNavigateToRequest', 'c1', 'r1')}>n</button>
      <button
        data-testid="ac-send-harness"
        onClick={() => h.call(props, 'onSendEndpointToHarness', { id: 'e1' }, { id: 'ep1' }, false)}
      >h</button>
      <button data-testid="ac-convert" onClick={() => h.call(props, 'onConvertToOpenApi', 'e1')}>c</button>
      <button data-testid="ac-send-req" onClick={() => h.call(props, 'onSendToRequests', { id: 'e1' })}>s</button>
      <button data-testid="ac-export-ep" onClick={() => h.call(props, 'onExportSingleEndpoint', { id: 'e1' }, { id: 'ep1' })}>x</button>
      <button data-testid="ac-export-confirm" onClick={() => h.call(props, 'onExportConfirm', { ok: true })}>f</button>
      <button data-testid="ac-previews-changed" onClick={() => h.call(props, 'onPreviewsChanged')}>p</button>
      <button
        data-testid="ac-export-mock-summary"
        onClick={() => h.call(props, 'onExportEndpointToApiMock', { method: 'GET', path: '/pets', summary: 'List pets' })}
      >m</button>
      <button
        data-testid="ac-export-mock-opid"
        onClick={() => h.call(props, 'onExportEndpointToApiMock', { method: 'POST', path: '/pets', operationId: 'createPet' })}
      >o</button>
    </div>
  ),
}));
vi.mock('../features/api-mock/components/ExportToApiMockModal', () => ({
  ExportToApiMockModal: (props: Record<string, unknown>) => {
    h.exportModalProps = props;
    return <div data-testid="export-to-mock-modal" />;
  },
}));
vi.mock('../features/catalog/components/CatalogSidebar', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="catalog-sidebar">
      <button data-testid="cs-select" onClick={() => h.call(props, 'onSelectEntry', 'e1')}>s</button>
      <button data-testid="cs-import" onClick={() => h.call(props, 'onImport')}>i</button>
      <button data-testid="cs-reimport" onClick={() => h.call(props, 'onReimport', 'e1')}>r</button>
      <button data-testid="cs-version" onClick={() => h.call(props, 'onVersionHistory', 'e1')}>v</button>
      <button data-testid="cs-edit" onClick={() => h.call(props, 'onEdit', 'e1')}>e</button>
      <button data-testid="cs-export" onClick={() => h.call(props, 'onExportSpec', 'e1')}>x</button>
      <button data-testid="cs-delete" onClick={() => h.call(props, 'onDeleteEntry', 'e1')}>d</button>
    </div>
  ),
}));
vi.mock('./Sidebar', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="harness-sidebar">
      <button data-testid="hs-view" onClick={() => h.call(props, 'onSidebarViewChange', 'svc')}>v</button>
      <button data-testid="hs-env" onClick={() => h.call(props, 'onEnvSelect', 'env-2')}>e</button>
    </div>
  ),
}));
vi.mock('../features/requests/components/RequestsSidebar', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="requests-sidebar">
      <button data-testid="rs-select-col" onClick={() => h.call(props, 'onSelectCollection', 'c1')}>c</button>
      <button data-testid="rs-select-req" onClick={() => h.call(props, 'onSelectRequest', 'c1', 'r1')}>r</button>
      <button data-testid="rs-new-col" onClick={() => h.call(props, 'onNewCollection')}>n</button>
      <button data-testid="rs-edit-col" onClick={() => h.call(props, 'onEditCollection', { id: 'c1' })}>e</button>
      <button data-testid="rs-send-col" onClick={() => h.call(props, 'onSendCollectionToHarness', 'c1')}>h</button>
      <button data-testid="rs-send-folder" onClick={() => h.call(props, 'onSendFolderToHarness', 'c1', 'f1')}>f</button>
    </div>
  ),
}));
vi.mock('../features/settings/SettingsModal', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="settings-page">
      <button data-testid="settings-import" onClick={() => h.call(props, 'onImport', { kind: 'x' })}>i</button>
    </div>
  ),
}));
vi.mock('../features/kafka/KafkaSettingsPage', () => ({
  default: () => <div data-testid="kafka-settings-page" />,
}));
vi.mock('../features/kafka/KafkaMessageStudioPage', () => ({
  KafkaMessageStudioPage: (props: Record<string, unknown>) => (
    <div data-testid="kafka-message-studio">
      <button data-testid="kms-nav" onClick={() => h.call(props, 'onNavigateToKafkaSettings')}>n</button>
      <button
        data-testid="kms-use"
        onClick={() => h.call(props, 'onUseAsWorkflowInput', 'payload', { topic: 't1', partition: 2, offset: '10' })}
      >u</button>
    </div>
  ),
}));
vi.mock('../features/websocket/WebSocketStudioPage', () => ({
  WebSocketStudioPage: () => <div data-testid="websocket-studio" />,
}));
vi.mock('../features/sse/SseStudioPage', () => ({
  SseStudioPage: () => <div data-testid="sse-studio" />,
}));
vi.mock('../features/environments/EnvironmentManager', () => ({
  default: () => <div data-testid="environment-manager" />,
}));
vi.mock('../features/workflow/WorkflowDesigner', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="workflow-designer">
      <button data-testid="wd-run-harness" onClick={() => h.call(props, 'onRunInHarness', 'wf1')}>h</button>
      <button data-testid="wd-browse" onClick={() => h.call(props, 'onBrowseGallery')}>b</button>
      <button data-testid="wd-clear-preview" onClick={() => h.call(props, 'onClearPreview')}>c</button>
      <button data-testid="wd-use-template" onClick={() => h.call(props, 'onUseAsTemplate', { id: 'w' })}>t</button>
      <button data-testid="wd-load-real" onClick={() => h.call(props, 'onLoadTemplate', h.realSampleId)}>r</button>
      <button data-testid="wd-load-missing" onClick={() => h.call(props, 'onLoadTemplate', 'does-not-exist')}>m</button>
      <button data-testid="wd-env" onClick={() => h.call(props, 'onEnvSelect', 'env-2')}>e</button>
    </div>
  ),
}));
vi.mock('../features/workflow/WorkflowExecutionHistory', () => ({
  default: () => <div data-testid="workflow-execution-history" />,
}));
vi.mock('../features/webhooks/WebhookDeliveryLogs', () => ({
  default: () => <div data-testid="webhook-delivery-logs" />,
}));
vi.mock('../features/workflow/components/panels/WorkflowSidebar', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="workflow-sidebar">
      <button data-testid="ws-select" onClick={() => h.call(props, 'onSelect', 'w1')}>s</button>
      <button data-testid="ws-new" onClick={() => h.call(props, 'onNew', 'New WF')}>n</button>
      <button data-testid="ws-browse" onClick={() => h.call(props, 'onBrowseTemplates')}>b</button>
      <button data-testid="ws-rename" onClick={() => h.call(props, 'onRename', 'w1', 'X')}>r</button>
      <button data-testid="ws-delete" onClick={() => h.call(props, 'onDelete', 'w1')}>d</button>
      <button data-testid="ws-duplicate" onClick={() => h.call(props, 'onDuplicate', 'w1')}>u</button>
      <button data-testid="ws-export" onClick={() => h.call(props, 'onExport', 'w1')}>e</button>
      <button data-testid="ws-export-folder" onClick={() => h.call(props, 'onExportFolder', 'f1')}>f</button>
      <button data-testid="ws-import" onClick={() => h.call(props, 'onImport')}>i</button>
      <button data-testid="ws-del-folder" onClick={() => h.call(props, 'onDeleteFolder', 'f1')}>g</button>
      <button data-testid="ws-create-folder" onClick={() => h.call(props, 'onCreateFolder', 'F')}>cf</button>
      <button data-testid="ws-rename-folder" onClick={() => h.call(props, 'onRenameFolder', 'f1', 'F2')}>rf</button>
      <button data-testid="ws-move-folder" onClick={() => h.call(props, 'onMoveFolder', 'f1', 0)}>mf</button>
      <button data-testid="ws-toggle-collapse" onClick={() => h.call(props, 'onToggleFolderCollapse', 'f1')}>tc</button>
      <button data-testid="ws-set-collapsed" onClick={() => h.call(props, 'onSetFolderCollapsed', 'f1', true)}>sc</button>
      <button data-testid="ws-move-one" onClick={() => h.call(props, 'onMoveWorkflowToFolder', 'w1', 'f1', 0)}>m1</button>
      <button data-testid="ws-move-many" onClick={() => h.call(props, 'onMoveWorkflowsToFolder', ['w1', 'w2'], 'f1', 0)}>m2</button>
    </div>
  ),
}));
vi.mock('../features/workflow/components/modals/FolderPickerModal', () => ({
  default: (props: Record<string, unknown>) =>
    props.open ? (
      <div data-testid="folder-picker">
        <button data-testid="fpm-cancel" onClick={() => h.call(props, 'onCancel')}>c</button>
        <button data-testid="fpm-pick" onClick={() => h.call(props, 'onPick', 'f1')}>p</button>
      </div>
    ) : null,
}));
vi.mock('../features/gallery/GalleryPage', () => ({
  GalleryPage: (props: Record<string, unknown>) => (
    <div data-testid="gallery-page">
      <button data-testid="gp-import-req" onClick={() => h.call(props, 'onImportRequest', { id: 'g1' })}>i</button>
      <button data-testid="gp-navigate" onClick={() => h.call(props, 'onNavigateTo', 'requests')}>n</button>
    </div>
  ),
}));
vi.mock('../features/training/TrainingTracksView', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="training-view">
      <button data-testid="tt-nav" onClick={() => h.call(props, 'onNavigateToSample', 's1')}>n</button>
    </div>
  ),
}));
vi.mock('../features/requests/components/RequestCollectionModal', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="request-collection-modal">
      <button data-testid="rcm-save" onClick={() => h.call(props, 'onSave', { name: 'x' })}>s</button>
      <button data-testid="rcm-close" onClick={() => h.call(props, 'onClose')}>c</button>
    </div>
  ),
}));
vi.mock('../features/requests/components/SubCollectionModal', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="sub-collection-modal">
      <button data-testid="scm-save" onClick={() => h.call(props, 'onSave', { name: 'p' })}>s</button>
      <button data-testid="scm-close" onClick={() => h.call(props, 'onClose')}>c</button>
    </div>
  ),
}));
vi.mock('../features/test-runner/components/RustExecutorTestPanel', () => ({
  default: () => <div data-testid="rust-panel" />,
}));

vi.mock('../features/graphql/GraphqlStudioPage', () => ({
  GraphqlStudioPage: () => <div data-testid="graphql-studio-page" />,
}));
vi.mock('../features/grpc/GrpcStudioPage', () => ({
  GrpcStudioPage: () => <div data-testid="grpc-studio-page" />,
}));

vi.mock('./demo/DemoShellHost', () => {
  // Off by default — only 'DemoShellHost navigateToTab uses flushSync tab switch'
  // opts in. Auto-navigating on every mount would leak an unflushed async state
  // update into every other test that renders <App /> without an explicit flush.
  let autoNavigateOnMount = false;
  return {
    DemoShellHost: (props: Record<string, unknown>) => {
      if (autoNavigateOnMount) {
        queueMicrotask(() => {
          const navigate = props.navigateToTab as ((tab: string) => void) | undefined;
          navigate?.('workflow');
        });
      }
      return <div id="demo-hub-mount" data-testid="demo-shell-host" />;
    },
    __setDemoShellHostAutoNavigate: (value: boolean) => { autoNavigateOnMount = value; },
  };
});

import App from './App';
import { demoHubRuntimeRef } from './demo/demoHubRuntimeRef';
import { readKey, ensureBrowserLargeDataMigrated } from '@shared/utils/storage';
import { __setDemoShellHostAutoNavigate } from './demo/DemoShellHost';

// real sample workflow id for the load-template happy path
(h as unknown as { realSampleId: string }).realSampleId = sampleWorkflowCatalog[0]?.id ?? 'unknown';

function resetState() {
  h.projects.loading = false;
  h.projects.environments = [];
  h.projects.microservices = [];
  h.projects.featureGroups = [];
  h.theme.showCustomizer = false;
  h.sidebarResize.sidebarCollapsed = false;
  h.wbActions.showWbCollectionModal = false;
  h.wbActions.editingSubCol = null;
  h.wbActions.subColForEdit = null;
  h.preview.pendingTemplateImport = null;
  h.wb.collections = [];
  h.wb.loaded = true;
  h.catalog.loaded = true;
  h.wfHook.workflows = [];
  h.catalogState.showCatalogImport = false;
  h.storageFullCb = null;
  h.featureFlags.demoHubEnabled = true;
  h.demoLive.hasRestorable.mockReset();
  h.demoLive.hasRestorable.mockReturnValue(false);
  h.demoLive.purge.mockClear();
}

// DemoShellHost is lazy-loaded (React.lazy + Suspense) and always mounted when
// DEMO_HUB_ENABLED is true. The first `render(<App />)` in the whole file to
// resolve that dynamic import does so outside any single test's act() scope,
// tripping a false-positive "not wrapped in act(...)" warning on whichever test
// happens to run first. Warm it up once here so every test after this already
// sees a resolved module and a settled Suspense boundary.
beforeAll(async () => {
  const { unmount } = render(<App />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  unmount();
});

beforeEach(() => {
  resetAllMocks();
  resetState();
  window.history.pushState({}, '', '/');
  __setDemoShellHostAutoNavigate(false);
});

afterEach(async () => {
  // Several App mount effects are genuinely async (storage readKey/
  // ensureBrowserLargeDataMigrated resolution, DemoShellHost's lazy Suspense
  // settling, demoLive.hasRestorable). A test that doesn't explicitly await
  // its own render leaves these pending; if they resolve after this test
  // already returned, React attributes the "not wrapped in act(...)" warning
  // to whichever test happens to be running next. Flush them here — while
  // the tree is still mounted, so any resulting update lands on a live
  // component instead of triggering a *different* unmounted-update warning —
  // before tearing down.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  cleanup();
});

function goto(tab: string) {
  fireEvent.click(screen.getByTestId(`goto-${tab}`));
}

describe('App — loading state', () => {
  it('renders the loading screen while projects are loading', () => {
    h.projects.loading = true;
    render(<App />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(screen.queryByTestId('activity-bar')).toBeNull();
  });
});

describe('App — initial render and mount effects', () => {
  it('renders the shell, applies the initial theme, and registers storage effects', () => {
    render(<App />);
    expect(screen.getByTestId('app-header')).toBeTruthy();
    expect(screen.getByTestId('activity-bar')).toBeTruthy();
    expect(screen.getByTestId('sub-nav')).toBeTruthy();
    expect(screen.getByTestId('workbench-modals')).toBeTruthy();
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    // default tab is requests
    expect(screen.getByTestId('requests-sidebar')).toBeTruthy();
    // theme sync effect
    expect(h.theme.setTheme).toHaveBeenCalledWith('midnight');
    // stale-key cleanup effect
    expect(h.cleanupStale).toHaveBeenCalled();
    // storage-full handler registered
    expect(typeof h.storageFullCb).toBe('function');
    // sidebar CSS var set (expanded branch: 48 + 280)
    expect(document.documentElement.style.getPropertyValue('--sidebar-w')).toBe('328px');
  });

  it('honours ?tab= from the URL on first render', () => {
    window.history.pushState({}, '', '/?tab=results');
    render(<App />);
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });

  it('invokes the storage-full toast handler and cleans up on unmount', () => {
    const { unmount } = render(<App />);
    act(() => { h.storageFullCb?.('config'); });
    expect(h.toast.show).toHaveBeenCalledWith('error', 'Storage Full', expect.stringContaining('config'));
    unmount();
    expect(h.storageFullCleanup).toHaveBeenCalled();
  });

  it('uses the collapsed branch of the sidebar width effect', () => {
    h.sidebarResize.sidebarCollapsed = true;
    render(<App />);
    expect(document.documentElement.style.getPropertyValue('--sidebar-w')).toBe('48px');
    // no sidebar aside when collapsed
    expect(screen.queryByTestId('requests-sidebar')).toBeNull();
  });
});

describe('App — tab render switch', () => {
  it('renders the correct primary surface for each tab', () => {
    render(<App />);

    goto('scenarios');
    expect(screen.getByTestId('scenario-builder')).toBeTruthy();

    goto('results');
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();

    goto('gallery');
    expect(screen.getByTestId('gallery-page')).toBeTruthy();

    goto('training');
    expect(screen.getByTestId('training-view')).toBeTruthy();

    goto('workflow-runner');
    expect(screen.getByTestId('workflow-runner')).toBeTruthy();

    goto('workflow-executions');
    expect(screen.getByTestId('workflow-execution-history')).toBeTruthy();

    goto('webhook-deliveries');
    expect(screen.getByTestId('webhook-delivery-logs')).toBeTruthy();

    goto('environments');
    expect(screen.getByTestId('environment-manager')).toBeTruthy();

    goto('preferences');
    expect(screen.getByTestId('settings-page')).toBeTruthy();

    goto('kafka-settings');
    expect(screen.getByTestId('kafka-settings-page')).toBeTruthy();

    goto('kafka-message-studio');
    expect(screen.getByTestId('kafka-message-studio')).toBeTruthy();

    goto('websocket-studio');
    expect(screen.getByTestId('websocket-studio')).toBeTruthy();

    goto('sse-studio');
    expect(screen.getByTestId('sse-studio')).toBeTruthy();

    goto('workflow');
    expect(screen.getByTestId('workflow-sidebar')).toBeTruthy();

    goto('catalog');
    expect(screen.getByTestId('catalog-sidebar')).toBeTruthy();

    goto('requests');
    expect(screen.getByTestId('requests-sidebar')).toBeTruthy();
  });

  it('always keeps TestRunner / ParameterizedRunner / WorkflowDesigner / ApiCatalog / Requests mounted', () => {
    render(<App />);
    expect(screen.getByTestId('test-runner')).toBeTruthy();
    expect(screen.getByTestId('parameterized-runner')).toBeTruthy();
    expect(screen.getByTestId('workflow-designer')).toBeTruthy();
    expect(screen.getByTestId('api-catalog')).toBeTruthy();
    expect(screen.getByTestId('requests-page')).toBeTruthy();
  });
});

describe('App — sidebar branches', () => {
  it('shows the harness sidebar for harness tabs', () => {
    render(<App />);
    goto('scenarios');
    expect(screen.getByTestId('harness-sidebar')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hs-view'));
    fireEvent.click(screen.getByTestId('hs-env'));
    expect(h.projects.setSelectedEnvId).toHaveBeenCalledWith('env-2');
  });

  it('hides the sidebar for settings / gallery / protocols domains', () => {
    render(<App />);
    goto('preferences');
    expect(screen.queryByTestId('requests-sidebar')).toBeNull();
    expect(screen.queryByTestId('harness-sidebar')).toBeNull();
    goto('gallery');
    expect(screen.queryByTestId('workflow-sidebar')).toBeNull();
    goto('websocket-studio');
    expect(screen.queryByTestId('workflow-sidebar')).toBeNull();
  });

  it('hides the catalog sidebar when catalog is not loaded and requests sidebar when wb not loaded', () => {
    h.catalog.loaded = false;
    h.wb.loaded = false;
    render(<App />);
    goto('catalog');
    expect(screen.queryByTestId('catalog-sidebar')).toBeNull();
    expect(screen.queryByTestId('requests-sidebar')).toBeNull();
  });

  it('toggles the sidebar collapse and opens settings from the sidebar button', () => {
    render(<App />);
    fireEvent.click(screen.getByTitle('Hide sidebar'));
    expect(h.sidebarResize.setSidebarCollapsed).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('⚙ Settings'));
    expect(screen.getByTestId('settings-page')).toBeTruthy();
  });

  it('starts a resize drag via the resize handle', () => {
    const { container } = render(<App />);
    const handle = container.querySelector('.usb-resize-handle') as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.mouseDown(handle);
    expect(h.sidebarResize.handleResizeStart).toHaveBeenCalled();
  });
});

describe('App — header / theme handlers', () => {
  it('navigates to kafka settings from the header', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('header-kafka'));
    expect(screen.getByTestId('kafka-settings-page')).toBeTruthy();
  });

  it('opens the theme customizer and wires its close/apply callbacks', () => {
    h.theme.showCustomizer = true;
    render(<App />);
    expect(screen.getByTestId('theme-customizer')).toBeTruthy();
    fireEvent.click(screen.getByTestId('theme-apply'));
    expect(h.theme.setTheme).toHaveBeenCalledWith('ocean');
    fireEvent.click(screen.getByTestId('theme-close'));
    expect(h.theme.setShowCustomizer).toHaveBeenCalledWith(false);
    expect(h.theme.reapplyTheme).toHaveBeenCalled();
  });

  it('opens the customizer via the header button', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('header-customize'));
    expect(h.theme.setShowCustomizer).toHaveBeenCalledWith(true);
  });
});

describe('App — completion / navigation handlers', () => {
  it('routes to results when a test run completes', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('runner-complete'));
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });

  it('routes to results when a parameterized run completes', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('param-complete'));
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });

  it('routes a workflow run-in-harness to the workflow runner', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('wd-run-harness'));
    expect(screen.getByTestId('workflow-runner')).toBeTruthy();
  });

  it('routes Kafka "use as workflow input" to the workflow runner', () => {
    render(<App />);
    goto('kafka-message-studio');
    fireEvent.click(screen.getByTestId('kms-use'));
    expect(screen.getByTestId('workflow-runner')).toBeTruthy();
    goto('kafka-message-studio');
    fireEvent.click(screen.getByTestId('kms-nav'));
    expect(screen.getByTestId('kafka-settings-page')).toBeTruthy();
  });

  it('browses the gallery from the workflow designer', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('wd-browse'));
    expect(screen.getByTestId('gallery-page')).toBeTruthy();
  });

  it('loads a workflow template only when the sample id exists', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('wd-load-real'));
    expect(h.gallery.onImportWorkflow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('wd-load-missing'));
    expect(h.gallery.onImportWorkflow).toHaveBeenCalledTimes(1);
  });

  it('wires designer clear-preview and use-as-template callbacks', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('wd-clear-preview'));
    expect(h.preview.clearPreviewWorkflow).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wd-use-template'));
    expect(h.preview.handleUseWorkflowAsTemplate).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wd-env'));
    expect(h.projects.setSelectedEnvId).toHaveBeenCalledWith('env-2');
  });

  it('triggers rerun-failed from the results dashboard', () => {
    render(<App />);
    goto('results');
    fireEvent.click(screen.getByTestId('results-rerun'));
    expect(h.rerun.handleRerunFailed).toHaveBeenCalled();
  });

  it('navigates from the training view to the gallery', () => {
    render(<App />);
    goto('training');
    fireEvent.click(screen.getByTestId('tt-nav'));
    expect(screen.getByTestId('gallery-page')).toBeTruthy();
  });

  it('forwards preferences import to the import handler', () => {
    render(<App />);
    goto('preferences');
    fireEvent.click(screen.getByTestId('settings-import'));
    expect(h.prefImport.handleImportData).toHaveBeenCalledWith({ kind: 'x' });
  });
});

describe('App — workflow runner handlers', () => {
  it('wires complete, clears, output and update callbacks', () => {
    render(<App />);
    goto('workflow-runner');
    fireEvent.click(screen.getByTestId('wfr-clear-id'));
    fireEvent.click(screen.getByTestId('wfr-clear-vars'));
    fireEvent.click(screen.getByTestId('wfr-output'));
    fireEvent.click(screen.getByTestId('wfr-update'));
    expect(h.wfHook.update).toHaveBeenCalledWith('wf-x', { name: 'z' });
    fireEvent.click(screen.getByTestId('wfr-complete'));
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });

  it('imports an existing sample via update', () => {
    h.wfHook.workflows = [{ id: 'wf-existing' }];
    render(<App />);
    goto('workflow-runner');
    fireEvent.click(screen.getByTestId('wfr-import-existing'));
    expect(h.wfHook.update).toHaveBeenCalledWith('wf-existing', expect.objectContaining({ name: 'n' }));
  });

  it('imports a new sample via insert', () => {
    render(<App />);
    goto('workflow-runner');
    fireEvent.click(screen.getByTestId('wfr-import-new'));
    expect(h.wfHook.insert).toHaveBeenCalled();
  });
});

describe('App — workflow sidebar handlers', () => {
  it('wires the full set of workflow sidebar callbacks', () => {
    render(<App />);
    goto('workflow');
    fireEvent.click(screen.getByTestId('ws-new'));
    expect(h.wfHook.create).toHaveBeenCalledWith('New WF');
    fireEvent.click(screen.getByTestId('ws-select'));
    expect(h.wfHook.select).toHaveBeenCalledWith('w1');
    fireEvent.click(screen.getByTestId('ws-rename'));
    expect(h.wfHook.update).toHaveBeenCalledWith('w1', { name: 'X' });
    fireEvent.click(screen.getByTestId('ws-delete'));
    expect(h.wfHook.remove).toHaveBeenCalledWith('w1');
    fireEvent.click(screen.getByTestId('ws-duplicate'));
    expect(h.wfHook.duplicate).toHaveBeenCalledWith('w1');
    fireEvent.click(screen.getByTestId('ws-export'));
    expect(h.wfImportExport.handleWorkflowExport).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ws-export-folder'));
    expect(h.wfImportExport.handleExportFolder).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ws-import'));
    expect(h.wfImportExport.handleWorkflowImport).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ws-del-folder'));
    expect(h.wfFolders.remove).toHaveBeenCalledWith('f1', h.wfFolders.folders);
    fireEvent.click(screen.getByTestId('ws-create-folder'));
    expect(h.wfFolders.create).toHaveBeenCalledWith('F');
    fireEvent.click(screen.getByTestId('ws-rename-folder'));
    expect(h.wfFolders.rename).toHaveBeenCalledWith('f1', 'F2');
    fireEvent.click(screen.getByTestId('ws-move-folder'));
    expect(h.wfFolders.move).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ws-toggle-collapse'));
    expect(h.wfFolders.toggleCollapse).toHaveBeenCalledWith('f1');
    fireEvent.click(screen.getByTestId('ws-set-collapsed'));
    expect(h.wfFolders.setCollapsed).toHaveBeenCalledWith('f1', true);
    fireEvent.click(screen.getByTestId('ws-move-one'));
    expect(h.wfHook.reorder).toHaveBeenCalledWith('w1', 'f1', 0);
    fireEvent.click(screen.getByTestId('ws-move-many'));
    expect(h.wfHook.reorder).toHaveBeenCalledTimes(3); // one + two
    fireEvent.click(screen.getByTestId('ws-browse'));
    expect(screen.getByTestId('gallery-page')).toBeTruthy();
  });
});

describe('App — requests / catalog sidebar handlers', () => {
  it('wires the requests sidebar callbacks', () => {
    render(<App />);
    goto('requests');
    fireEvent.click(screen.getByTestId('rs-select-col'));
    expect(h.wb.selectCollection).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByTestId('rs-select-req'));
    expect(h.reqTabs.selectRequest).toHaveBeenCalledWith('c1', 'r1');
    fireEvent.click(screen.getByTestId('rs-new-col'));
    expect(h.wbActions.handleWbNewCollection).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('rs-edit-col'));
    expect(h.wbActions.handleWbEditCollection).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('rs-send-col'));
    expect(h.harness.setBatchHarnessTarget).toHaveBeenCalledWith({ colId: 'c1' });
    fireEvent.click(screen.getByTestId('rs-send-folder'));
    expect(h.harness.setBatchHarnessTarget).toHaveBeenCalledWith({ colId: 'c1', folderId: 'f1' });
  });

  it('wires the catalog sidebar callbacks', () => {
    render(<App />);
    goto('catalog');
    fireEvent.click(screen.getByTestId('cs-select'));
    expect(h.catalog.selectEntry).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('cs-import'));
    expect(h.catalogState.setShowCatalogImport).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('cs-reimport'));
    expect(h.catalogState.setCatalogReimportId).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('cs-version'));
    expect(h.catalogState.setCatalogVersionHistoryId).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('cs-edit'));
    expect(h.catalogState.setCatalogEditId).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('cs-export'));
    expect(h.catalogState.handleExportSpec).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('cs-delete'));
    expect(h.catalog.removeEntry).toHaveBeenCalledWith('e1');
  });

  it('toggles the API sidebar Requests/Catalog sub-toggle', () => {
    render(<App />);
    goto('catalog');
    // toggle row buttons exist in the API sidebar
    fireEvent.click(screen.getByText('Requests'));
    expect(screen.getByTestId('requests-page')).toBeTruthy();
    // and back to Catalog via the toggle button
    fireEvent.click(screen.getByText('Catalog'));
    expect(screen.getByTestId('api-catalog')).toBeTruthy();
  });
});

describe('App — ApiCatalog page handlers', () => {
  it('wires the ApiCatalog callbacks', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('ac-import'));
    expect(h.catalogState.setShowCatalogImport).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('ac-reimport'));
    expect(h.catalogState.setCatalogReimportId).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('ac-version'));
    expect(h.catalogState.setCatalogVersionHistoryId).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('ac-edit'));
    expect(h.catalogState.setCatalogEditId).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('ac-navigate'));
    expect(h.reqTabs.selectRequest).toHaveBeenCalledWith('c1', 'r1');
    fireEvent.click(screen.getByTestId('ac-send-harness'));
    expect(h.harness.setCatalogHarnessEndpoint).toHaveBeenCalled();
    expect(h.harness.setShowSendToHarness).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('ac-convert'));
    expect(h.catalogState.handleConvertToOpenApi).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByTestId('ac-send-req'));
    expect(h.catalogExport.handleSendToRequests).toHaveBeenCalledWith({ id: 'e1' });
    fireEvent.click(screen.getByTestId('ac-export-ep'));
    expect(h.catalogExport.handleExportSingleEndpoint).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ac-export-confirm'));
    expect(h.catalogExport.handleInlineExportConfirm).toHaveBeenCalledWith({ ok: true });
    // refreshWfPreviews() → loadWorkflowPreviews().then(setWfPreviewEndpoints)
    // is a genuine async chain — flush it inside act() so its state update
    // doesn't resolve after this test has already returned.
    await act(async () => {
      fireEvent.click(screen.getByTestId('ac-previews-changed'));
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  // AppWorkbenchModals renders the modal itself and is mocked here, so this
  // asserts the state App owns and hands down. Modal rendering is covered by
  // AppWorkbenchModals.test.tsx.
  it('feeds export-to-api-mock items down from catalog endpoint export', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('ac-export-mock-summary'));
    expect(h.workbenchModalsProps.exportToMockItems).toEqual([{
      method: 'GET',
      path: '/pets',
      label: 'List pets',
    }]);
    expect(h.workbenchModalsProps.exportToMockSourceKind).toBe('catalog');
    act(() => { h.call(h.workbenchModalsProps, 'onClearExportToMock'); });
    expect(h.workbenchModalsProps.exportToMockItems).toBeNull();

    fireEvent.click(screen.getByTestId('ac-export-mock-opid'));
    expect(h.workbenchModalsProps.exportToMockItems).toEqual([{
      method: 'POST',
      path: '/pets',
      label: 'createPet',
    }]);
  });
});

describe('App — scenario builder handlers', () => {
  it('locates a request that exists and navigates to requests', () => {
    h.wb.collections = [{ id: 'c1', requests: [{ id: 'req-1' }], folders: [] }];
    render(<App />);
    goto('scenarios');
    fireEvent.click(screen.getByTestId('sb-locate-found'));
    expect(h.reqTabs.selectRequest).toHaveBeenCalledWith('c1', 'req-1');
    expect(screen.getByTestId('requests-page')).toBeTruthy();
  });

  it('warns when the located request cannot be found', () => {
    h.wb.collections = [{ id: 'c1', requests: [{ id: 'req-1' }], folders: [] }];
    render(<App />);
    goto('scenarios');
    fireEvent.click(screen.getByTestId('sb-locate-missing'));
    expect(h.toast.show).toHaveBeenCalledWith('warning', 'Source request not found', expect.any(String));
  });

  it('consumes the pending edit test', () => {
    render(<App />);
    goto('scenarios');
    fireEvent.click(screen.getByTestId('sb-pending-consumed'));
    expect(h.harness.setPendingEditTest).toHaveBeenCalledWith(undefined);
  });
});

describe('App — requests page handlers', () => {
  it('clears preview, sends to harness, and imports preview (no preview is a no-op)', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('req-send-harness'));
    expect(h.harness.setShowSendToHarness).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('req-clear-preview'));
    expect(screen.getByTestId('gallery-page')).toBeTruthy();
    // import-preview with no preview set returns early without touching wb
    goto('requests');
    fireEvent.click(screen.getByTestId('req-import-preview'));
    expect(h.wb.addRequest).not.toHaveBeenCalled();
  });

  it('imports a preview request into an existing Gallery Samples collection', () => {
    h.wb.collections = [{ id: 'gal', name: 'Gallery Samples', requests: [], folders: [] }];
    render(<App />);
    const preview = {
      collection: { id: 'gal' },
      entryName: 'sample',
      request: { name: 'R', method: 'GET', url: '/x', headers: [], body: '', bodyType: 'none', auth: null },
    };
    act(() => { h.call(h.galleryArgs, 'setPreviewRequest', preview); });
    fireEvent.click(screen.getByTestId('req-import-preview'));
    expect(h.wb.addRequest).toHaveBeenCalledWith('gal');
    expect(h.wb.updateRequest).toHaveBeenCalled();
  });

  it('imports a preview request creating the Gallery Samples collection when missing', () => {
    render(<App />);
    const preview = {
      collection: { id: 'x' },
      entryName: 'sample',
      request: { name: 'R', method: 'POST', url: '/y', headers: [], body: '', bodyType: 'none', auth: null },
    };
    act(() => { h.call(h.galleryArgs, 'setPreviewRequest', preview); });
    fireEvent.click(screen.getByTestId('req-import-preview'));
    expect(h.wb.addCollection).toHaveBeenCalledWith({ name: 'Gallery Samples', mode: 'direct' });
    expect(h.wb.addRequest).toHaveBeenCalledWith('new-col');
  });

  it('wires request tab coordinator callbacks', () => {
    render(<App />);
    goto('requests');
    fireEvent.click(screen.getByTestId('req-close-all-tabs'));
    expect(h.reqTabs.closeOtherTabs).toHaveBeenCalledWith('tab-1');
    fireEvent.click(screen.getByTestId('req-close-tabs-right'));
    expect(h.reqTabs.closeTabsToRight).toHaveBeenCalledWith('tab-1');
    fireEvent.click(screen.getByTestId('req-reorder-tabs'));
    expect(h.reqTabs.reorderTabs).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getByTestId('req-duplicate-tab'));
    expect(h.reqTabs.duplicateTab).toHaveBeenCalledWith('tab-1');
    fireEvent.click(screen.getByTestId('req-env-change'));
    expect(h.reqTabs.envChange).toHaveBeenCalledWith('env-2');
    fireEvent.click(screen.getByTestId('req-update-tab-ui'));
    expect(h.reqTabs.updateTabUI).toHaveBeenCalledWith('tab-1', { dirty: true });
    fireEvent.click(screen.getByTestId('req-sync-tab-label'));
    expect(h.reqTabs.syncTabLabel).toHaveBeenCalledWith('tab-1', 'Renamed');
  });
});

describe('App — modals', () => {
  it('renders and wires the request collection modal', () => {
    h.wbActions.showWbCollectionModal = true;
    render(<App />);
    expect(screen.getByTestId('request-collection-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rcm-save'));
    expect(h.wbActions.handleWbSaveCollection).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('rcm-close'));
    expect(h.wbActions.setShowWbCollectionModal).toHaveBeenCalledWith(false);
  });

  it('renders and wires the sub-collection modal', () => {
    h.wbActions.editingSubCol = { colId: 'c1', folderId: 'f1' };
    h.wbActions.subColForEdit = { folder: { id: 'f1' }, col: { id: 'c1' } };
    render(<App />);
    expect(screen.getByTestId('sub-collection-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('scm-save'));
    expect(h.wb.updateSubCollection).toHaveBeenCalledWith('c1', 'f1', { name: 'p' });
    fireEvent.click(screen.getByTestId('scm-close'));
    expect(h.wbActions.setEditingSubCol).toHaveBeenCalledWith(null);
  });

  it('renders and wires the folder picker modal when a template import is pending', () => {
    h.preview.pendingTemplateImport = { wf: { id: 'w' } };
    render(<App />);
    expect(screen.getByTestId('folder-picker')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fpm-pick'));
    expect(h.preview.handleTemplatePickFolder).toHaveBeenCalledWith('f1');
    fireEvent.click(screen.getByTestId('fpm-cancel'));
    expect(h.preview.setPendingTemplateImport).toHaveBeenCalledWith(null);
  });

  it('hides the sub-nav while the catalog import modal is open', () => {
    h.catalogState.showCatalogImport = true;
    render(<App />);
    expect(screen.queryByTestId('sub-nav')).toBeNull();
  });
});

describe('App — gallery data migration effect', () => {
  it('back-fills the Gallery Samples microservice base URL', () => {
    h.projects.environments = [{ id: 'genv', name: 'Gallery Samples' }];
    h.projects.microservices = [{ id: 'gsvc', name: 'Gallery Samples', baseUrls: {} }];
    // Invoke the functional state updater so the map/back-fill closures run.
    h.projects.setMicroservices.mockImplementation((upd: unknown) => {
      if (typeof upd === 'function') (upd as (p: unknown[]) => unknown)(h.projects.microservices);
    });
    render(<App />);
    expect(h.projects.setMicroservices).toHaveBeenCalled();
  });

  it('does not back-fill when the base URL already exists', () => {
    h.projects.environments = [{ id: 'genv', name: 'Gallery Samples' }];
    h.projects.microservices = [{ id: 'gsvc', name: 'Gallery Samples', baseUrls: { genv: '' } }];
    render(<App />);
    expect(h.projects.setMicroservices).not.toHaveBeenCalled();
  });
});

describe('App — harness request id memo', () => {
  it('collects source request ids from feature groups', () => {
    h.projects.featureGroups = [
      { scenarios: [{ tests: [{ sourceRequestId: 'req-9' }, { sourceRequestId: undefined }] }] },
    ];
    render(<App />);
    // memo runs without throwing; requests sidebar receives the set
    expect(screen.getByTestId('requests-sidebar')).toBeTruthy();
  });
});

describe('App — gallery page handlers', () => {
  it('wires the gallery import/navigate callbacks', () => {
    render(<App />);
    goto('gallery');
    fireEvent.click(screen.getByTestId('gp-import-req'));
    expect(h.gallery.onImportRequest).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('gp-navigate'));
    expect(h.gallery.onNavigateTo).toHaveBeenCalledWith('requests');
  });
});

describe('App — inline hook callback wrappers', () => {
  it('routes the workflow import/export setActiveTab wrapper to a tab', () => {
    render(<App />);
    act(() => { h.call(h.wfIeArgs, 'setActiveTab', 'results'); });
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });

  it('routes the workbench-actions setActiveTab wrapper to a tab', () => {
    render(<App />);
    act(() => { h.call(h.wbArgs, 'setActiveTab', 'results'); });
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });

  it('routes the rerun-failed onComplete wrapper to the results surface', () => {
    render(<App />);
    act(() => { h.call(h.rerunArgs, 'onComplete'); });
    expect(screen.getByTestId('results-dashboard')).toBeTruthy();
  });
});

describe('App — locate request inside a collection folder', () => {
  it('finds a request nested in a folder via flatMap and navigates to requests', () => {
    h.wb.collections = [
      { id: 'c1', requests: [], folders: [{ requests: [{ id: 'req-1' }] }] },
    ];
    render(<App />);
    goto('scenarios');
    fireEvent.click(screen.getByTestId('sb-locate-found'));
    expect(h.reqTabs.selectRequest).toHaveBeenCalledWith('c1', 'req-1');
    expect(screen.getByTestId('requests-page')).toBeTruthy();
  });
});

describe('App — dev-only Rust executor overlay', () => {
  it('shows the rust test panel when ?rust-test is present and closes via the button', async () => {
    window.history.pushState({}, '', '/?rust-test');
    render(<App />);
    // In DEV builds the lazy panel resolves and the overlay is shown.
    if (import.meta.env.DEV) {
      const panel = await screen.findByTestId('rust-panel');
      expect(panel).toBeTruthy();
      // Close via the overlay button (covers the close onClick handler).
      fireEvent.click(screen.getByText(/Close \(Cmd\+Shift\+T\)/));
      expect(screen.queryByTestId('rust-panel')).toBeNull();
    } else {
      // production build: overlay is not rendered (RustExecutorTestPanel === null)
      expect(screen.queryByTestId('rust-panel')).toBeNull();
    }
  });

  it('toggles the rust test panel via the Ctrl/Cmd+Shift+T shortcut', async () => {
    render(<App />);
    if (!import.meta.env.DEV) {
      expect(screen.queryByTestId('rust-panel')).toBeNull();
      return;
    }
    // Hidden initially (no ?rust-test).
    expect(screen.queryByTestId('rust-panel')).toBeNull();
    // Ctrl+Shift+T toggles it on (covers the keydown handler + setShow updater).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true }));
    });
    const panel = await screen.findByTestId('rust-panel');
    expect(panel).toBeTruthy();
    // Toggle off again with the Meta variant.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', metaKey: true, shiftKey: true }));
    });
    expect(screen.queryByTestId('rust-panel')).toBeNull();
  });
});

describe('App — coverage gaps', () => {
  beforeEach(() => {
    resetState();
    demoHubRuntimeRef.current = {
      ...demoHubRuntimeRef.current,
      state: {
        view: 'domains',
        selectedLesson: null,
        stepIndex: 0,
        isPlaying: false,
        speed: 1,
      },
      exitLiveDemo: vi.fn(async () => {}),
      suppressLiveTabExitRef: { current: false },
    };
  });

  it('selectRunnerWorkflowByName uses window bridge when available', () => {
    const bridge = vi.fn(() => true);
    (window as unknown as { __wfRunnerApplySelection?: typeof bridge }).__wfRunnerApplySelection = bridge;
    render(<App />);
    expect((window as unknown as { __wfRunnerSelectByName: (n: string) => boolean }).__wfRunnerSelectByName('Demo WF')).toBe(true);
    expect(bridge).toHaveBeenCalledWith('Demo WF');
    delete (window as unknown as { __wfRunnerApplySelection?: typeof bridge }).__wfRunnerApplySelection;
  });

  it('selectRunnerWorkflowByName falls back to workflow list by name', () => {
    delete (window as unknown as { __wfRunnerApplySelection?: unknown }).__wfRunnerApplySelection;
    h.wfHook.workflows = [{ id: 'wf-99', name: 'Runner Target' }];
    render(<App />);
    let result = false;
    act(() => {
      result = (window as unknown as { __wfRunnerSelectByName: (n: string) => boolean }).__wfRunnerSelectByName('Runner Target');
    });
    expect(result).toBe(true);
    goto('workflow-runner');
    expect(screen.getByTestId('workflow-runner')).toBeTruthy();
  });

  it('debounces repeated storage-full toasts within 8 seconds', () => {
    render(<App />);
    act(() => { h.storageFullCb?.('first'); });
    act(() => { h.storageFullCb?.('second'); });
    expect(h.toast.show).toHaveBeenCalledTimes(1);
  });

  it('restores last protocols tab from storage on mount', async () => {
    vi.mocked(readKey).mockResolvedValueOnce('graphql-studio');
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(readKey).toHaveBeenCalled();
  });

  it('handleSetActiveTab cancels navigation when live demo exit is declined', () => {
    demoHubRuntimeRef.current = {
      ...demoHubRuntimeRef.current,
      state: {
        view: 'live',
        selectedLesson: { initialTab: 'graphql-studio', allowedTabs: ['graphql-studio'] },
        stepIndex: 0,
        isPlaying: true,
        speed: 1,
      },
      suppressLiveTabExitRef: { current: false },
    };
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    goto('results');
    expect(screen.getByTestId('requests-sidebar')).toBeTruthy();
    vi.mocked(window.confirm).mockRestore();
  });

  it('handleSetActiveTab exits live demo when navigation is confirmed', async () => {
    const exitLiveDemo = vi.fn(async () => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    demoHubRuntimeRef.current = {
      ...demoHubRuntimeRef.current,
      state: {
        view: 'live',
        selectedLesson: { initialTab: 'graphql-studio', allowedTabs: ['graphql-studio'] },
        stepIndex: 0,
        isPlaying: true,
        speed: 1,
      },
      exitLiveDemo,
      suppressLiveTabExitRef: { current: false },
    };
    goto('results');
    await act(async () => { await Promise.resolve(); });
    expect(exitLiveDemo).toHaveBeenCalled();
    vi.mocked(window.confirm).mockRestore();
  });

  it('calls ensureBrowserLargeDataMigrated on mount', async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(ensureBrowserLargeDataMigrated).toHaveBeenCalled();
  });

  it('loads DemoShellHost via lazy import when demo hub is enabled', async () => {
    render(<App />);
    goto('demo-hub');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.getElementById('demo-hub-mount')).toBeTruthy();
  });

  it('handleSetActiveTab navigates directly when not in live demo', () => {
    render(<App />);
    goto('scenarios');
    expect(screen.getByTestId('scenario-builder')).toBeTruthy();
  });

  it('selectRunnerWorkflowByName returns false when workflow is missing', () => {
    delete (window as unknown as { __wfRunnerApplySelection?: unknown }).__wfRunnerApplySelection;
    h.wfHook.workflows = [];
    render(<App />);
    expect((window as unknown as { __wfRunnerSelectByName: (n: string) => boolean }).__wfRunnerSelectByName('Missing')).toBe(false);
  });

  it('DemoShellHost navigateToTab uses flushSync tab switch', async () => {
    __setDemoShellHostAutoNavigate(true);
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('workflow-sidebar')).toBeTruthy();
  });
});

describe('App — coverage gaps', () => {
  it('purges gql demo ephemeral storage when no restorable live session exists', async () => {
    h.demoLive.hasRestorable.mockReturnValue(false);
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(h.demoLive.purge).toHaveBeenCalled();
  });

  it('skips gql demo purge when a restorable live session exists', async () => {
    h.demoLive.hasRestorable.mockReturnValue(true);
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(h.demoLive.purge).not.toHaveBeenCalled();
  });

  it('redirects away from demo-hub tab when demo hub feature is disabled', async () => {
    h.featureFlags.demoHubEnabled = false;
    render(<App />);
    goto('demo-hub');
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('requests-sidebar')).toBeTruthy();
    expect(document.getElementById('demo-hub-mount')).toBeNull();
  });

  it('opens api mock journal entry in requests using existing collection', async () => {
    h.wb.collections = [{ id: 'journal-col', name: 'API Mock Journal', requests: [], folders: [] }];
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => {
      window.dispatchEvent(new CustomEvent(API_MOCK_OPEN_IN_REQUESTS_EVENT, {
        detail: {
          name: 'Mock GET /pets',
          method: 'GET',
          url: 'http://127.0.0.1:4010/pets',
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          body: '{"limit":10}',
        },
      }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(h.wb.addCollection).not.toHaveBeenCalled();
    expect(h.wb.addRequest).toHaveBeenCalledWith('journal-col', undefined, 'Mock GET /pets');
    expect(h.wb.updateRequest).toHaveBeenCalledWith('journal-col', 'new-req', expect.objectContaining({
      bodyType: 'json',
      auth: { type: 'none' },
    }));
    expect(h.reqTabs.selectRequest).toHaveBeenCalledWith('journal-col', 'new-req');
    expect(screen.getByTestId('requests-page')).toBeTruthy();
  });

  it('creates API Mock Journal collection when opening mock entry in requests', async () => {
    h.wb.collections = [];
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => {
      window.dispatchEvent(new CustomEvent(API_MOCK_OPEN_IN_REQUESTS_EVENT, {
        detail: {
          name: 'Mock POST /pets',
          method: 'POST',
          url: 'http://127.0.0.1:4010/pets',
          headers: [],
          body: '',
        },
      }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(h.wb.addCollection).toHaveBeenCalledWith({ name: 'API Mock Journal', mode: 'direct' });
    expect(h.wb.updateRequest).toHaveBeenCalledWith('new-col', 'new-req', expect.objectContaining({
      bodyType: 'none',
    }));
  });

  it('ignores api mock open-in-requests events without detail', async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => {
      window.dispatchEvent(new CustomEvent(API_MOCK_OPEN_IN_REQUESTS_EVENT));
    });
    expect(h.wb.addRequest).not.toHaveBeenCalled();
  });

  it('removes api mock open-in-requests listener on unmount', async () => {
    const { unmount } = render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(API_MOCK_OPEN_IN_REQUESTS_EVENT, expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
