/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const makeActiveTab = (overrides: Record<string, unknown> = {}) => ({
    id: 'tab-1',
    query: 'query { hello }',
    variables: '{}',
    headers: [] as Array<{ key: string; value: string; enabled: boolean }>,
    modelUri: 'model://1',
    label: 'Untitled',
    operationType: 'query' as const,
    selectedOperation: null as string | null,
    subscriptionAssertions: [] as unknown[],
    subscriptionTransport: 'auto' as const,
    ...overrides,
  });

  const defaultAdvSettings = {
    apqEnabled: false,
    apqUseGet: false,
    apqUnsupportedDetected: false,
    batchEnabled: false,
    batchTimeoutMs: 30000,
    batchUnsupportedDetected: false,
    dedupEnabled: true,
    complexityBlockEnabled: false,
    complexityBlockThreshold: 1000,
  };

  const pendingExecuteAfterGateRef = { current: null as (() => void) | null };
  const skipComplexityGateRef = { current: false };
  const sessionBypassComplexityGateRef = { current: false };
  const advSettingsRef = { current: defaultAdvSettings };
  const connectionIdRef = { current: null as string | null };
  const executingRef = { current: false };
  type TabExecutionStateMock = {
    status: 'idle' | 'loading' | 'success' | 'error';
    response: unknown;
    apqInfo?: { hash: string; cacheHit: boolean; unsupported: boolean; connectionId?: string } | null;
    isDuplicate?: boolean;
    duplicateSourceTabId?: string | null;
  };
  const tabExecutionStates = new Map<string, TabExecutionStateMock>();
  const responseCache = new Map<string, {
    status: 'idle' | 'loading' | 'success' | 'error';
    response: unknown;
    apqInfo?: { hash: string; cacheHit: boolean; unsupported: boolean; connectionId?: string } | null;
    uploadProgress?: number | null;
  }>();
  const setTabUploadProgress = vi.fn((tabId: string, progress: number | null) => {
    const existing = responseCache.get(tabId);
    responseCache.set(tabId, {
      status: existing?.status ?? 'loading',
      response: existing?.response ?? null,
      apqInfo: existing?.apqInfo,
      uploadProgress: progress === null ? undefined : progress,
    });
  });
  const cacheExecutionResult = vi.fn((
    tabId: string,
    status: 'idle' | 'loading' | 'success' | 'error',
    resp: unknown,
    apqInfo?: { hash: string; cacheHit: boolean; unsupported: boolean; connectionId?: string } | null,
  ) => {
    const existing = tabExecutionStates.get(tabId);
    tabExecutionStates.set(tabId, {
      status,
      response: resp,
      apqInfo: apqInfo !== undefined ? apqInfo : existing?.apqInfo,
      isDuplicate: existing?.isDuplicate ?? false,
      duplicateSourceTabId: existing?.duplicateSourceTabId ?? null,
    });
    const cached = responseCache.get(tabId);
    responseCache.set(tabId, {
      status,
      response: resp,
      apqInfo: apqInfo !== undefined ? apqInfo : cached?.apqInfo,
      uploadProgress: undefined,
    });
  });
  const removeTabFromCache = vi.fn((tabId: string) => {
    tabExecutionStates.delete(tabId);
    responseCache.delete(tabId);
  });
  const toastBaselineSnapshotIdRef = { current: 'snap-1' };
  let pageEndpoint = 'https://api.example.com/graphql';
  let pageSkipTlsVerify = false;

  return {
    pageEndpoint,
    getPageEndpoint: () => pageEndpoint,
    setPageEndpoint: (ep: string) => { pageEndpoint = ep; },
    getPageSkipTlsVerify: () => pageSkipTlsVerify,
    setPageSkipTlsVerify: (skip: boolean) => { pageSkipTlsVerify = skip; },
    makeActiveTab,
    defaultAdvSettings,
    pendingExecuteAfterGateRef,
    skipComplexityGateRef,
    sessionBypassComplexityGateRef,
    advSettingsRef,
    connectionIdRef,
    executingRef,
    tabExecutionStates,
    responseCache,
    setTabUploadProgress,
    cacheExecutionResult,
    removeTabFromCache,
    toastBaselineSnapshotIdRef,
    isTauri: vi.fn(() => false),
    loadPersistedActivityTab: vi.fn(() => null as 'history' | 'collections' | 'mock' | null),
    buildAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer token' })),
    findUnresolvedVars: vi.fn(() => [] as string[]),
    resolveVars: vi.fn((v: string) => v),
    buildMultipartFormData: vi.fn(() => new FormData()),
    computeQueryComplexity: vi.fn(() => null as {
      score: number;
      level: 'ok' | 'warn' | 'danger';
      shouldBlock: boolean;
      threshold: number;
      fieldBreakdown: unknown[];
    } | null),
    buildAssertionResultMap: vi.fn(() => ({})),
    setGraphqlSchema: vi.fn(),
    clearGraphqlSchema: vi.fn(),
    buildVarsModelUri: vi.fn((id: string) => `inmemory://graphql/vars/${id}`),
    buildClientSchema: vi.fn(() => ({})),
    validate: vi.fn(() => [] as unknown[]),
    gqlParseDoc: vi.fn(() => ({})),
    captured: {
      connectionBar: null as Record<string, unknown> | null,
      historyPanel: null as Record<string, unknown> | null,
      bottomPanel: null as Record<string, unknown> | null,
      complexityWarning: null as Record<string, unknown> | null,
      complexityGate: null as Record<string, unknown> | null,
      collections: null as Record<string, unknown> | null,
      pageToasts: null as Record<string, unknown> | null,
      schemaDiff: null as Record<string, unknown> | null,
      saveToCollection: null as Record<string, unknown> | null,
      batchResults: null as Record<string, unknown> | null,
      rightPane: null as Record<string, unknown> | null,
      tabBar: null as Record<string, unknown> | null,
      runnerPanel: null as Record<string, unknown> | null,
      gqlStudioTabsArgs: [] as unknown[],
      collectionRunParams: null as Record<string, unknown> | null,
      gqlItemLoadersParams: null as Record<string, unknown> | null,
      tabExecutionArgs: null as Record<string, unknown> | null,
      batchExecutionArgs: null as Record<string, unknown> | null,
    },
    useGraphqlConnectionSettings: vi.fn(() => ({
      endpoint: 'https://api.example.com/graphql',
      setEndpoint: vi.fn(),
      historyConnectionId: 'conn-1',
      prevBaseUrlRef: { current: undefined },
      skipTlsVerify: false,
      handleSkipTlsVerifyChange: vi.fn(),
      pollingEnabled: false,
      pollingIntervalSeconds: 30,
      pollingIntervalMs: 0,
      handlePollingChange: vi.fn(),
      auth: null,
      handleAuthChange: vi.fn(),
      recentEndpoints: [] as string[],
      pushRecentEndpoint: vi.fn(),
      removeRecentEndpoint: vi.fn(),
      profiles: [],
      profilesReady: true,
      saveProfile: vi.fn(),
      updateProfile: vi.fn(),
      deleteProfile: vi.fn(),
      profileModalOpen: false,
      setProfileModalOpen: vi.fn(),
      environments: [],
      activeEnvironment: { id: 'env-1', name: 'Dev', variables: [{ key: 'API_KEY', value: 'secret', enabled: true }] },
      createEnvironment: vi.fn(),
      deleteEnvironment: vi.fn(),
      setActiveEnvironment: vi.fn(),
      updateEnvironmentName: vi.fn(),
      updateVariables: vi.fn(),
      importEnvironment: vi.fn(),
      exportEnvironment: vi.fn(),
      envModalOpen: false,
      setEnvModalOpen: vi.fn(),
    })),
    useGraphqlHistory: vi.fn(() => ({
      items: [] as Array<{ id: string; response: string; latencyMs: number }>,
      recentItems: [],
      saveHistory: vi.fn().mockResolvedValue(undefined),
      deleteItem: vi.fn(),
      clearAll: vi.fn(),
      search: vi.fn(() => []),
      loading: false,
    })),
    useGraphqlCollections: vi.fn(() => ({
      trees: [] as Array<{ collection: { id: string; name: string }; folders: unknown[]; items: unknown[] }>,
      loading: false,
      addItem: vi.fn().mockResolvedValue(undefined),
      markItemExecuted: vi.fn().mockResolvedValue(undefined),
    })),
    useGraphqlCollectionRunner: vi.fn(() => ({
      state: 'idle',
      results: [],
      reset: vi.fn(),
    })),
    useGraphqlExecution: vi.fn(() => ({
      status: 'idle' as 'idle' | 'loading' | 'success' | 'error',
      response: null as { data?: unknown; errors?: unknown[] } | null,
      execute: vi.fn(),
      cancel: vi.fn(),
      isDuplicate: false,
      duplicateSourceTabId: null,
      apqInfo: null,
      resolveDedupChoice: vi.fn(),
    })),
    cancelTabMock: vi.fn(),
    tabExecuteBridgeMock: vi.fn(),
    useGraphqlStudioTabExecution: vi.fn((args: {
      activeTabId: string;
      onExecutionCompleted?: (
        tabId: string,
        status: 'idle' | 'loading' | 'success' | 'error',
        response: unknown,
        apqInfo?: unknown,
      ) => void;
      profiles?: unknown[];
      pageDefaults?: Record<string, unknown>;
    }) => {
      mocks.captured.tabExecutionArgs = args as Record<string, unknown>;
      const activeTabId = args.activeTabId;
      const onExecutionCompleted = args.onExecutionCompleted;
      const exec = mocks.useGraphqlExecution();
      const fromMap = mocks.tabExecutionStates.get(activeTabId);

      const execute = (params: Record<string, unknown>) => {
        mocks.tabExecuteBridgeMock(params);
        return (exec.execute as ReturnType<typeof vi.fn>)({
          ...params,
          sourceTabId: activeTabId,
          onExecutionCompleted,
        });
      };

      const activeState = fromMap
        ? {
            status: fromMap.status,
            response: fromMap.response,
            apqInfo: fromMap.apqInfo ?? null,
            isDuplicate: fromMap.isDuplicate ?? false,
            duplicateSourceTabId: fromMap.duplicateSourceTabId ?? null,
          }
        : {
            status: exec.status,
            response: exec.response,
            apqInfo: exec.apqInfo,
            isDuplicate: exec.isDuplicate,
            duplicateSourceTabId: exec.duplicateSourceTabId,
          };

      return {
        activeState,
        execute,
        cancel: exec.cancel,
        cancelTab: mocks.cancelTabMock,
        resolveDedupChoice: exec.resolveDedupChoice,
        isTabExecuting: (tabId: string) =>
          (mocks.tabExecutionStates.get(tabId)?.status ?? (tabId === activeTabId ? exec.status : 'idle')) === 'loading',
        executionLayers: null,
      };
    }),
    useGqlTabResponseCache: vi.fn(() => ({
      cacheExecutionResult,
      removeTabFromCache,
      responseCache,
      setTabUploadProgress,
      resolvePaneState: (
        tabId: string,
        status: 'idle' | 'loading' | 'success' | 'error',
        response: unknown,
      ) => ({
        response,
        execStatus: status,
        executing: status === 'loading',
      }),
    })),
    useGraphqlSubscription: vi.fn(() => ({
      state: 'idle' as 'idle' | 'connecting' | 'active',
      messages: [] as unknown[],
      stats: {},
      connectedSince: 0,
      isPaused: false,
      pausedBufferCount: 0,
      errorMessage: null,
      reconnectAttempt: 0,
      transport: 'auto',
      reset: vi.fn(),
      disconnect: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    })),
    useGraphqlAdvancedSettings: vi.fn(() => ({
      advSettingsOpen: false,
      setAdvSettingsOpen: vi.fn(),
      advSettingsBtnRef: { current: null },
      advSettings: { ...defaultAdvSettings },
      advSettingsRef,
      setAdvSettings: vi.fn(),
      apqUnsupportedToast: false,
      setApqUnsupportedToast: vi.fn(),
      batchUnsupportedToast: false,
      setBatchUnsupportedToast: vi.fn(),
      connectionIdRef,
      handleAdvSettingsChange: vi.fn(),
    })),
    useGqlStudioTabs: vi.fn(() => {
      const activeTab = makeActiveTab();
      const tabEndpointOverride = typeof activeTab.endpoint === 'string' ? activeTab.endpoint : undefined;
      return {
        tabs: [activeTab],
        activeTabId: 'tab-1',
        activeTab,
        operations: ['MyQuery'],
        selectedOperation: 'MyQuery',
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        renameTab: vi.fn(),
        resolvedTabEndpoint: tabEndpointOverride ?? pageEndpoint,
        hasActiveTabEndpointOverride: tabEndpointOverride !== undefined,
        hasActiveTabProfileLink: Boolean(activeTab.connectionId),
        hasResolvedProfileLink: false,
        hasPendingProfileEndpoint: Boolean(activeTab.connectionId),
        applyProfileToActiveTab: vi.fn(),
        clearConnectionIdsForProfile: vi.fn(),
        clearActiveTabProfileLink: vi.fn(),
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
        updateActiveTabEndpoint: vi.fn(),
        clearActiveTabEndpoint: vi.fn(),
        updateActiveTabSkipTlsVerify: vi.fn(),
        updateActiveTabTlsSettings: vi.fn(),
        updateActiveTabAuth: vi.fn(),
        clearActiveTabAuth: vi.fn(),
        hasActiveTabSkipTlsOverride: activeTab.skipTlsVerify !== undefined,
        hasActiveTabTlsCertOverride: false,
        hasActiveTabAuthOverride: Boolean(
          activeTab.auth !== undefined
          && !(activeTab.auth?.type === 'inherit' && !activeTab.auth.globalProfileId),
        ),
        updateActiveTabPolling: vi.fn(),
        clearActiveTabPolling: vi.fn(),
        hasActiveTabPollingOverride: activeTab.pollingEnabled !== undefined
          || activeTab.pollingIntervalSeconds !== undefined,
      };
    }),
    useGqlStudioEditorActions: vi.fn(() => ({
      editorMountRef: { current: null },
      prettifyError: false,
      insertToast: null as string | null,
      handlePrettify: vi.fn(),
      handleInsertField: vi.fn(),
    })),
    useGraphqlSchema: vi.fn(() => ({
      status: 'none' as 'none' | 'loaded' | 'error' | 'introspection-disabled',
      schemaInfo: null as { types?: unknown[]; sdl?: string } | null,
      rawIntrospection: null as unknown,
      errorMessage: null,
      introspecting: false,
      introspect: vi.fn(),
      pollErrorMessage: null,
    })),
    useGraphqlMockServer: vi.fn(() => ({
      running: false,
      start: vi.fn(),
      stop: vi.fn(),
    })),
    useGraphqlSchemaSnapshots: vi.fn(() => ({
      snapshots: [],
      deprecatedUsages: [],
      diffModal: null as {
        result: unknown;
        oldSdl: string;
        newSdl: string;
        oldLabel: string;
        newLabel: string;
        snapshotId: string;
      } | null,
      setDiffModal: vi.fn(),
      schemaDiffToast: false,
      setSchemaDiffToast: vi.fn(),
      toastBaselineSnapshotIdRef,
      handleSaveSnapshot: vi.fn(),
      handleDeleteSnapshot: vi.fn(),
      handleOpenDiff: vi.fn(),
      handleAcknowledge: vi.fn(),
      handleUnacknowledge: vi.fn(),
    })),
    useQueryValidation: vi.fn(() => 0),
    useMonacoExecutionMarkers: vi.fn(),
    useGraphqlBatchExecution: vi.fn(() => ({
      batchResult: null as unknown,
      setBatchResult: vi.fn(),
      batchResultsOpen: false,
      dismissBatchResults: vi.fn(),
      openBatchResults: vi.fn(),
      batchExecuting: false,
      complexityGatePending: false,
      setComplexityGatePending: vi.fn(),
      pendingExecuteAfterGateRef,
      skipComplexityGateRef,
      sessionBypassComplexityGateRef,
      effectiveBatchedTabs: [] as unknown[],
      batchedTabIdsSet: new Set<string>(),
      batchTabOverrides: new Map<string, unknown>(),
      setBatchTabOverrides: vi.fn(),
      batchGroups: [] as unknown[],
      activeBatchGroupKey: null as string | null,
      activeBatchGroup: null as unknown,
      handleSetActiveBatchGroup: vi.fn(),
      handleToggleBatch: vi.fn(),
      handleSendBatch: vi.fn(),
    })),
    useGraphqlCollectionRun: vi.fn(() => ({
      handleRunCollection: vi.fn(),
    })),
    useGqlItemLoaders: vi.fn(() => ({
      handleLoadCollectionItem: vi.fn(),
      handleOpenCollectionItem: vi.fn(),
      handleLoadHistoryItem: vi.fn(),
      handleRunHistoryItem: vi.fn(),
      handleEditInEditor: vi.fn(),
      handleBuilderExecute: vi.fn(),
    })),
    useSubscriptionOrchestration: vi.fn(() => ({
      handleSubscribe: vi.fn(),
      handleStopSubscription: vi.fn(),
      handleExportSubscription: vi.fn(),
    })),
    useGqlKeyboardShortcuts: vi.fn(),
  };
});

// ─── Utility mocks ────────────────────────────────────────────────────────────

vi.mock('../../shared/utils/platform', () => ({
  isTauri: mocks.isTauri,
  isDesktopRuntimeAvailable: mocks.isTauri,
}));

vi.mock('./utils/gqlActivityBarUtils', () => ({
  loadPersistedActivityTab: mocks.loadPersistedActivityTab,
}));

vi.mock('./utils/authUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/authUtils')>();
  return {
    ...actual,
    buildAuthHeaders: mocks.buildAuthHeaders,
  };
});

vi.mock('./utils/envUtils', () => ({
  findUnresolvedVars: mocks.findUnresolvedVars,
  resolveVars: mocks.resolveVars,
}));

vi.mock('./utils/multipartBuilder', () => ({
  buildMultipartFormData: mocks.buildMultipartFormData,
}));

vi.mock('./utils/complexityEstimator', () => ({
  computeQueryComplexity: mocks.computeQueryComplexity,
}));

vi.mock('./utils/subscriptionAssertions', () => ({
  buildAssertionResultMap: mocks.buildAssertionResultMap,
}));

vi.mock('./utils/monacoGraphqlSetup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/monacoGraphqlSetup')>();
  return {
    ...actual,
    setGraphqlSchema: mocks.setGraphqlSchema,
    clearGraphqlSchema: mocks.clearGraphqlSchema,
    buildVarsModelUri: mocks.buildVarsModelUri,
  };
});

vi.mock('graphql', () => ({
  buildClientSchema: mocks.buildClientSchema,
  validate: mocks.validate,
  parse: mocks.gqlParseDoc,
}));

vi.mock('@monaco-editor/react', () => ({
  useMonaco: vi.fn(() => null),
}));

// ─── Child component mocks ────────────────────────────────────────────────────

function captureProps(
  testId: string,
  key: keyof typeof mocks.captured,
  extra?: (props: Record<string, unknown>) => ReactNode,
) {
  return (props: Record<string, unknown>) => {
    mocks.captured[key] = props;
    return (
      <div data-testid={testId}>
        {extra?.(props)}
      </div>
    );
  };
}

vi.mock('./components/GraphqlConnectionBar', () => ({
  GraphqlConnectionBar: captureProps('gql-connection-bar-mock', 'connectionBar', (props) => (
    <>
      <button type="button" data-testid="gql-mock-execute" onClick={props.onExecute as () => void}>Execute</button>
      <button type="button" data-testid="gql-mock-cancel" onClick={props.onCancel as () => void}>Cancel</button>
      <button type="button" data-testid="gql-mock-subscribe" onClick={props.onSubscribe as () => void}>Subscribe</button>
      <button type="button" data-testid="gql-mock-adv-settings" onClick={props.onAdvancedSettingsClick as () => void}>AdvSettings</button>
      <button type="button" data-testid="gql-mock-env-badge" onClick={props.onEnvBadgeClick as () => void}>EnvBadge</button>
      <button type="button" data-testid="gql-mock-profile-badge" onClick={props.onProfileBadgeClick as () => void}>ProfileBadge</button>
      <span data-testid="gql-mock-schema-status">{String(props.schemaStatus)}</span>
      <span data-testid="gql-mock-complexity-score">{String(props.complexityScore ?? 'none')}</span>
    </>
  )),
}));

vi.mock('./components/GraphqlEditor', () => ({
  GraphqlEditor: () => <div data-testid="gql-editor-mock" />,
}));

vi.mock('./components/GqlTabBar', () => ({
  GqlTabBar: captureProps('gql-tab-bar-mock', 'tabBar'),
}));

vi.mock('./components/GqlBottomPanel', () => ({
  GqlBottomPanel: captureProps('gql-bottom-panel-mock', 'bottomPanel', (props) => (
    <>
      <button
        type="button"
        data-testid="gql-mock-set-files"
        onClick={() => (props.onFileEntriesChange as (entries: unknown[]) => void)([
          { id: 'f1', file: new File(['x'], 'a.txt'), varPath: 'file', error: null },
        ])}
      >
        SetFiles
      </button>
      <button
        type="button"
        data-testid="gql-mock-set-bad-files"
        onClick={() => (props.onFileEntriesChange as (entries: unknown[]) => void)([
          { id: 'f1', file: new File(['x'], 'a.txt'), varPath: 'file', error: 'bad file' },
        ])}
      >
        SetBadFiles
      </button>
      <button
        type="button"
        data-testid="gql-mock-bottom-tab"
        onClick={() => (props.onTabChange as (tab: string) => void)('headers')}
      >
        BottomTab
      </button>
    </>
  )),
}));

vi.mock('./components/GqlRightPane', () => ({
  GqlRightPane: captureProps('gql-right-pane-mock', 'rightPane'),
}));

vi.mock('./components/GraphqlQueryBuilder', () => ({
  GraphqlQueryBuilder: () => <div data-testid="gql-query-builder-mock" />,
}));

vi.mock('./components/GraphqlSubscriptionAssertionPanel', () => ({
  GraphqlSubscriptionAssertionPanel: () => <div data-testid="gql-sub-assertions-mock" />,
}));

vi.mock('./components/GraphqlStudioActivityBar', () => ({
  GraphqlStudioActivityBar: ({ activeTab, onTabChange }: { activeTab: string | null; onTabChange: (t: string) => void }) => (
    <div data-testid="gql-activity-bar-mock">
      <button type="button" data-testid="activity-history" onClick={() => onTabChange('history')}>History</button>
      <button type="button" data-testid="activity-collections" onClick={() => onTabChange('collections')}>Collections</button>
      <button type="button" data-testid="activity-mock" onClick={() => onTabChange('mock')}>Mock</button>
      <span data-testid="activity-tab-value">{String(activeTab)}</span>
    </div>
  ),
}));

vi.mock('./components/GraphqlHistoryPanel', () => ({
  GraphqlHistoryPanel: captureProps('gql-history-panel-mock', 'historyPanel', (props) => (
    <>
      <button
        type="button"
        data-testid="gql-mock-history-max"
        onClick={() => (props.onMaxItemsChange as (n: number) => void)(250)}
      >
        ChangeMax
      </button>
      <button
        type="button"
        data-testid="gql-save-to-col-trigger"
        onClick={() => (props.onSaveToCollection as (item: unknown) => void)({
          operation: { name: 'HistOp', query: 'query { h }', variables: '{}', operationType: 'query' },
        })}
      >
        SaveToCol
      </button>
      <button
        type="button"
        data-testid="gql-save-to-col-no-name"
        onClick={() => (props.onSaveToCollection as (item: unknown) => void)({
          operation: { query: 'query { h }', variables: '{}', operationType: 'mutation' },
        })}
      >
        SaveToColNoName
      </button>
      <button
        type="button"
        data-testid="gql-save-to-col-unnamed"
        onClick={() => (props.onSaveToCollection as (item: unknown) => void)({
          operation: { query: 'query { h }', variables: '{}' },
        })}
      >
        SaveToColUnnamed
      </button>
    </>
  )),
}));

vi.mock('./components/GraphqlCollections', () => ({
  GraphqlCollections: captureProps('gql-collections-mock', 'collections', (props) => (
    <>
      <button type="button" data-testid="gql-run-item" onClick={() => (props.onRunItem as (i: unknown) => void)({ collectionId: 'c1' })}>RunItem</button>
      <button type="button" data-testid="gql-run-all" onClick={() => (props.onRunAll as (c: string, f?: string) => void)('c1', 'f1')}>RunAll</button>
      <button type="button" data-testid="gql-load-item" onClick={() => (props.onLoadItem as (i: unknown) => void)({ id: 'i1' })}>LoadItem</button>
      <button type="button" data-testid="gql-save-complete" onClick={props.onSaveComplete as () => void}>SaveComplete</button>
    </>
  )),
  SaveToCollectionModal: captureProps('gql-save-to-collection-mock', 'saveToCollection', (props) => (
    <>
      <button
        type="button"
        data-testid="gql-save-collection-confirm"
        onClick={() => (props.onSave as (c: string, f: string | null, n: string) => void)('col-1', null, 'Saved Op')}
      >
        Save
      </button>
      <button type="button" data-testid="gql-save-collection-cancel" onClick={props.onCancel as () => void}>Cancel</button>
    </>
  )),
}));

vi.mock('./components/GraphqlCollectionRunnerPanel', () => ({
  GraphqlCollectionRunnerPanel: captureProps('gql-runner-panel-mock', 'runnerPanel', (props) => (
    <button type="button" data-testid="gql-runner-close" onClick={props.onClose as () => void}>CloseRunner</button>
  )),
}));

vi.mock('./components/GraphqlSchemaDiff', () => ({
  GraphqlSchemaDiff: captureProps('gql-schema-diff-mock', 'schemaDiff', (props) => (
    <button type="button" data-testid="gql-schema-diff-close" onClick={props.onClose as () => void}>CloseDiff</button>
  )),
}));

vi.mock('./components/GraphqlMockPanel', () => ({
  GraphqlMockPanel: () => <div data-testid="gql-mock-panel-mock" />,
}));

vi.mock('./components/GraphqlAdvancedSettings', () => ({
  GraphqlAdvancedSettings: ({ onClose }: { onClose: () => void }) => (
    <button type="button" data-testid="gql-advanced-close" onClick={onClose}>CloseAdv</button>
  ),
}));

vi.mock('./components/GraphqlBatchResults', () => ({
  GraphqlBatchResults: captureProps('gql-batch-results-mock', 'batchResults', (props) => (
    <button type="button" data-testid="gql-batch-dismiss" onClick={props.onDismiss as () => void}>DismissBatch</button>
  )),
}));

vi.mock('./components/GraphqlComplexityGateModal', () => ({
  GraphqlComplexityGateModal: captureProps('gql-complexity-gate-mock', 'complexityGate', (props) => (
    <>
      <button type="button" data-testid="gql-gate-send" onClick={() => (props.onSendAnyway as (r: boolean) => void)(true)}>SendAnyway</button>
      <button type="button" data-testid="gql-gate-cancel" onClick={props.onCancel as () => void}>CancelGate</button>
    </>
  )),
}));

vi.mock('./components/GqlDedupBanner', () => ({
  GqlDedupBanner: ({ visible, onWait, onCancelOriginal, onSendAnyway }: {
    visible: boolean;
    onWait: () => void;
    onCancelOriginal: () => void;
    onSendAnyway: () => void;
  }) => visible ? (
    <div data-testid="gql-dedup-banner-mock">
      <button type="button" data-testid="dedup-wait" onClick={onWait}>Wait</button>
      <button type="button" data-testid="dedup-cancel" onClick={onCancelOriginal}>CancelOrig</button>
      <button type="button" data-testid="dedup-send" onClick={onSendAnyway}>SendAnyway</button>
    </div>
  ) : null,
}));

vi.mock('./components/GqlComplexityWarningBanner', () => ({
  GqlComplexityWarningBanner: captureProps('gql-complexity-warning-mock', 'complexityWarning', (props) => (
    props.visible ? (
      <>
        <button type="button" data-testid="gql-warning-confirm" onClick={props.onConfirm as () => void}>Confirm</button>
        <button type="button" data-testid="gql-warning-dismiss" onClick={props.onDismiss as () => void}>Dismiss</button>
      </>
    ) : null
  )),
}));

vi.mock('./components/GqlPageToasts', () => ({
  GqlPageToasts: captureProps('gql-page-toasts-mock', 'pageToasts', (props) => (
    <>
      <button type="button" data-testid="toast-view-diff" onClick={props.onViewDiff as () => void}>ViewDiff</button>
      <button type="button" data-testid="toast-save-snapshot" onClick={props.onSaveSnapshot as () => void}>SaveSnapshot</button>
      <button type="button" data-testid="toast-dismiss-schema" onClick={props.onDismissSchemaDiff as () => void}>DismissSchema</button>
      <button type="button" data-testid="toast-dismiss-apq" onClick={props.onDismissApq as () => void}>DismissApq</button>
      <button type="button" data-testid="toast-dismiss-batch" onClick={props.onDismissBatch as () => void}>DismissBatch</button>
    </>
  )),
}));

vi.mock('./components/GqlConnectionModals', () => ({
  GqlConnectionModals: ({
    onProfileModalClose,
    onSaveProfile,
    onDeleteProfile,
    onApplyProfileToActiveTab,
    onEnvModalClose,
    onCreateEnvironment,
    onDeleteEnvironment,
    onSetActiveEnvironment,
    onRenameEnvironment,
    onUpdateVariables,
    onImportEnvironment,
    onExportEnvironment,
  }: Record<string, (...args: unknown[]) => void>) => (
    <div data-testid="gql-connection-modals-mock">
      <button type="button" data-testid="modal-profile-close" onClick={onProfileModalClose}>ProfileClose</button>
      <button type="button" data-testid="modal-save-profile" onClick={() => onSaveProfile('P')}>SaveProfile</button>
      <button type="button" data-testid="modal-delete-profile" onClick={() => onDeleteProfile('p1')}>DeleteProfile</button>
      <button type="button" data-testid="modal-apply-profile" onClick={() => onApplyProfileToActiveTab({ id: 'p1', name: 'P', endpoint: 'https://new.test/gql', auth: null, createdAt: 1 })}>ApplyProfile</button>
      <button type="button" data-testid="modal-env-close" onClick={onEnvModalClose}>EnvClose</button>
      <button type="button" data-testid="modal-create-env" onClick={() => onCreateEnvironment('E')}>CreateEnv</button>
      <button type="button" data-testid="modal-delete-env" onClick={() => onDeleteEnvironment('e1')}>DeleteEnv</button>
      <button type="button" data-testid="modal-set-active-env" onClick={() => onSetActiveEnvironment('e1')}>SetActiveEnv</button>
      <button type="button" data-testid="modal-rename-env" onClick={() => onRenameEnvironment('e1', 'Renamed')}>RenameEnv</button>
      <button type="button" data-testid="modal-update-vars" onClick={() => onUpdateVariables('e1', [])}>UpdateVars</button>
      <button type="button" data-testid="modal-import-env" onClick={() => onImportEnvironment({})}>ImportEnv</button>
      <button type="button" data-testid="modal-export-env" onClick={() => onExportEnvironment('e1')}>ExportEnv</button>
    </div>
  ),
}));

// ─── Hook mocks ───────────────────────────────────────────────────────────────

vi.mock('./hooks/useGraphqlConnectionSettings', () => ({
  useGraphqlConnectionSettings: (...args: unknown[]) => mocks.useGraphqlConnectionSettings(...args),
}));

vi.mock('./hooks/useGraphqlHistory', () => ({
  useGraphqlHistory: (...args: unknown[]) => mocks.useGraphqlHistory(...args),
}));

vi.mock('./hooks/useGraphqlCollections', () => ({
  useGraphqlCollections: (...args: unknown[]) => mocks.useGraphqlCollections(...args),
}));

vi.mock('./hooks/useGraphqlCollectionRunner', () => ({
  useGraphqlCollectionRunner: (...args: unknown[]) => mocks.useGraphqlCollectionRunner(...args),
}));

vi.mock('./hooks/useGraphqlStudioTabExecution', () => ({
  useGraphqlStudioTabExecution: (...args: unknown[]) => mocks.useGraphqlStudioTabExecution(...args),
}));

vi.mock('./hooks/useGraphqlExecution', () => ({
  useGraphqlExecution: (...args: unknown[]) => mocks.useGraphqlExecution(...args),
}));

vi.mock('./hooks/useGqlTabResponseCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useGqlTabResponseCache')>();
  return {
    ...actual,
    useGqlTabResponseCache: (...args: unknown[]) => mocks.useGqlTabResponseCache(...args),
  };
});

vi.mock('./hooks/useGraphqlSubscription', () => ({
  useGraphqlSubscription: (...args: unknown[]) => mocks.useGraphqlSubscription(...args),
}));

vi.mock('./hooks/useGraphqlAdvancedSettings', () => ({
  useGraphqlAdvancedSettings: (...args: unknown[]) => mocks.useGraphqlAdvancedSettings(...args),
}));

vi.mock('./hooks/useGqlStudioTabs', () => ({
  useGqlStudioTabs: (...args: unknown[]) => {
    mocks.captured.gqlStudioTabsArgs.push(args);
    return mocks.useGqlStudioTabs(...args);
  },
}));

vi.mock('./hooks/useGqlStudioEditorActions', () => ({
  useGqlStudioEditorActions: (...args: unknown[]) => mocks.useGqlStudioEditorActions(...args),
}));

vi.mock('./hooks/useGraphqlSchema', () => ({
  useGraphqlSchema: (...args: unknown[]) => mocks.useGraphqlSchema(...args),
}));

vi.mock('./hooks/useGraphqlMockServer', () => ({
  useGraphqlMockServer: (...args: unknown[]) => mocks.useGraphqlMockServer(...args),
}));

vi.mock('./hooks/useGraphqlSchemaSnapshots', () => ({
  useGraphqlSchemaSnapshots: (...args: unknown[]) => mocks.useGraphqlSchemaSnapshots(...args),
}));

vi.mock('./hooks/useQueryValidation', () => ({
  useQueryValidation: (...args: unknown[]) => mocks.useQueryValidation(...args),
}));

vi.mock('./hooks/useMonacoExecutionMarkers', () => ({
  useMonacoExecutionMarkers: (...args: unknown[]) => mocks.useMonacoExecutionMarkers(...args),
}));

vi.mock('./hooks/useGraphqlBatchExecution', () => ({
  useGraphqlBatchExecution: (...args: unknown[]) => {
    mocks.captured.batchExecutionArgs = (args[0] ?? null) as Record<string, unknown>;
    return mocks.useGraphqlBatchExecution(...args);
  },
}));

vi.mock('./hooks/useGraphqlCollectionRun', () => ({
  useGraphqlCollectionRun: (params: Record<string, unknown>) => {
    mocks.captured.collectionRunParams = params;
    return mocks.useGraphqlCollectionRun(params);
  },
}));

vi.mock('./hooks/useGqlItemLoaders', () => ({
  useGqlItemLoaders: (params: Record<string, unknown>) => {
    mocks.captured.gqlItemLoadersParams = params;
    return mocks.useGqlItemLoaders(params);
  },
}));

vi.mock('./hooks/useSubscriptionOrchestration', () => ({
  useSubscriptionOrchestration: (...args: unknown[]) => mocks.useSubscriptionOrchestration(...args),
}));

vi.mock('./hooks/useGqlKeyboardShortcuts', () => ({
  useGqlKeyboardShortcuts: (...args: unknown[]) => mocks.useGqlKeyboardShortcuts(...args),
}));

// ─── Import under test (after mocks) ─────────────────────────────────────────

import { GraphqlStudioPage } from './GraphqlStudioPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage(props: Partial<React.ComponentProps<typeof GraphqlStudioPage>> = {}) {
  return render(<GraphqlStudioPage {...props} />);
}

function getExecuteFn() {
  return mocks.captured.connectionBar?.onExecute as () => void;
}

function clickExecute() {
  fireEvent.click(screen.getByTestId('gql-mock-execute'));
}

function setupTabs(overrides: Record<string, unknown> = {}) {
  mocks.useGqlStudioTabs.mockImplementation(() => {
    const activeTab = mocks.makeActiveTab(overrides);
    const tabEndpointOverride = typeof activeTab.endpoint === 'string' ? activeTab.endpoint : undefined;
    const resolvedTabEndpoint = tabEndpointOverride ?? mocks.getPageEndpoint();
    const resolvedProfileLink = overrides.hasResolvedProfileLink === true;
    const profilesReady = overrides.profilesReady !== undefined ? Boolean(overrides.profilesReady) : true;
    const connectionId = activeTab.connectionId as string | undefined;
    const profileLinkPending = Boolean(connectionId) && profilesReady && !resolvedProfileLink;
    return {
      tabs: [activeTab],
      activeTabId: activeTab.id as string,
      activeTab,
      operations: ['MyQuery'],
      selectedOperation: 'MyQuery',
      confirmingCloseTabId: null,
      closeActiveTabRef: { current: vi.fn() },
      executingRef: mocks.executingRef,
      addTab: vi.fn(),
      handleTabClick: vi.fn(),
      closeTab: vi.fn(),
      renameTab: vi.fn(),
      updateActiveTab: vi.fn(),
      updateActiveTabEndpoint: vi.fn(),
      clearActiveTabEndpoint: vi.fn(),
      updateActiveTabSkipTlsVerify: vi.fn(),
      updateActiveTabTlsSettings: vi.fn(),
      updateActiveTabAuth: vi.fn(),
      clearActiveTabAuth: vi.fn(),
      resolvedTabEndpoint,
      hasActiveTabEndpointOverride: tabEndpointOverride !== undefined,
      hasActiveTabProfileLink: Boolean(connectionId)
        && (!profilesReady || resolvedProfileLink || profileLinkPending),
      hasResolvedProfileLink: resolvedProfileLink,
      hasPendingProfileEndpoint: Boolean(activeTab.connectionId)
        && (!profilesReady || !resolvedProfileLink),
      applyProfileToActiveTab: vi.fn(),
      clearConnectionIdsForProfile: vi.fn(),
      clearActiveTabProfileLink: vi.fn(),
      hasActiveTabSkipTlsOverride: activeTab.skipTlsVerify !== undefined,
      hasActiveTabTlsCertOverride: activeTab.tlsCaCert !== undefined
        || activeTab.tlsClientCert !== undefined
        || activeTab.tlsClientKey !== undefined,
      updateActiveTabPolling: vi.fn(),
      clearActiveTabPolling: vi.fn(),
      hasActiveTabPollingOverride: activeTab.pollingEnabled !== undefined
        || activeTab.pollingIntervalSeconds !== undefined,
      hasActiveTabAuthOverride: Boolean(
        activeTab.auth !== undefined
        && !(activeTab.auth?.type === 'inherit' && !activeTab.auth.globalProfileId),
      ),
      handleSelectOperation: vi.fn(),
      handleQueryChange: vi.fn(),
      handleVariablesChange: vi.fn(),
      handleHeadersChange: vi.fn(),
      handleAssertionsChange: vi.fn(),
      handleSubscriptionTransportChange: vi.fn(),
    };
  });
  return mocks.makeActiveTab(overrides);
}

function setupExecution(overrides: Partial<ReturnType<typeof mocks.useGraphqlExecution>> = {}) {
  const executeFn = vi.fn((params: {
    sourceTabId?: string;
    onExecutionStarted?: (id: string) => void;
    onExecutionCompleted?: (
      tabId: string,
      status: 'idle' | 'loading' | 'success' | 'error',
      response: unknown,
      apqInfo?: unknown,
    ) => void;
  }) => {
    if (params.sourceTabId && params.onExecutionStarted) {
      params.onExecutionStarted(params.sourceTabId);
    }
    if (params.sourceTabId && params.onExecutionCompleted) {
      params.onExecutionCompleted(
        params.sourceTabId,
        'success',
        { data: { ok: true }, latencyMs: 10, timestamp: 1, httpStatus: 200 },
        null,
      );
    }
  });
  mocks.useGraphqlExecution.mockReturnValue({
    status: 'idle',
    response: null,
    execute: executeFn,
    cancel: vi.fn(),
    isDuplicate: false,
    duplicateSourceTabId: null,
    apqInfo: null,
    resolveDedupChoice: vi.fn(),
    ...overrides,
  });
}

function setupConnection(overrides: Record<string, unknown> = {}) {
  const endpoint = Object.prototype.hasOwnProperty.call(overrides, 'endpoint')
    ? (overrides.endpoint as string)
    : 'https://api.example.com/graphql';
  mocks.setPageEndpoint(endpoint);
  if (Object.prototype.hasOwnProperty.call(overrides, 'skipTlsVerify')) {
    mocks.setPageSkipTlsVerify(Boolean(overrides.skipTlsVerify));
  }
  mocks.useGraphqlConnectionSettings.mockReturnValue({
    endpoint,
    setEndpoint: vi.fn(),
    historyConnectionId: 'conn-1',
    prevBaseUrlRef: { current: undefined },
    skipTlsVerify: mocks.getPageSkipTlsVerify(),
    handleSkipTlsVerifyChange: vi.fn(),
    pollingEnabled: false,
    pollingIntervalSeconds: 30,
    pollingIntervalMs: 0,
    handlePollingChange: vi.fn(),
    auth: null,
    handleAuthChange: vi.fn(),
    recentEndpoints: [],
    pushRecentEndpoint: vi.fn(),
    removeRecentEndpoint: vi.fn(),
    profiles: [],
    saveProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    profileModalOpen: false,
    setProfileModalOpen: vi.fn(),
    environments: [],
    activeEnvironment: { id: 'env-1', name: 'Dev', variables: [{ key: 'API_KEY', value: 'secret', enabled: true }] },
    createEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(),
    setActiveEnvironment: vi.fn(),
    updateEnvironmentName: vi.fn(),
    updateVariables: vi.fn(),
    importEnvironment: vi.fn(),
    exportEnvironment: vi.fn(),
    envModalOpen: false,
    setEnvModalOpen: vi.fn(),
    ...overrides,
  });
}

function setupSchema(overrides: Record<string, unknown> = {}) {
  mocks.useGraphqlSchema.mockReturnValue({
    status: 'none',
    schemaInfo: null,
    rawIntrospection: null,
    errorMessage: null,
    introspecting: false,
    introspect: vi.fn(),
    pollErrorMessage: null,
    ...overrides,
  });
}

function setupBatch(overrides: Record<string, unknown> = {}) {
  mocks.useGraphqlBatchExecution.mockReturnValue({
    batchResult: null,
    setBatchResult: vi.fn(),
    batchResultsOpen: false,
    dismissBatchResults: vi.fn(),
    openBatchResults: vi.fn(),
    batchExecuting: false,
    complexityGatePending: false,
    setComplexityGatePending: vi.fn(),
    pendingExecuteAfterGateRef: mocks.pendingExecuteAfterGateRef,
    skipComplexityGateRef: mocks.skipComplexityGateRef,
    sessionBypassComplexityGateRef: mocks.sessionBypassComplexityGateRef,
    effectiveBatchedTabs: [],
    batchedTabIdsSet: new Set<string>(),
    batchTabOverrides: new Map<string, unknown>(),
    setBatchTabOverrides: vi.fn(),
    batchGroups: [],
    activeBatchGroupKey: null,
    activeBatchGroup: null,
    handleSetActiveBatchGroup: vi.fn(),
    handleToggleBatch: vi.fn(),
    handleSendBatch: vi.fn(),
    batchEndpointMismatch: false,
    batchEndpointReady: false,
    ...overrides,
  });
}

function setupAdvSettings(overrides: Partial<typeof mocks.defaultAdvSettings> = {}) {
  const advSettings = { ...mocks.defaultAdvSettings, ...overrides };
  mocks.advSettingsRef.current = advSettings;
  mocks.useGraphqlAdvancedSettings.mockReturnValue({
    advSettingsOpen: false,
    setAdvSettingsOpen: vi.fn(),
    advSettingsBtnRef: { current: null },
    advSettings,
    advSettingsRef: mocks.advSettingsRef,
    setAdvSettings: vi.fn(),
    apqUnsupportedToast: false,
    setApqUnsupportedToast: vi.fn(),
    batchUnsupportedToast: false,
    setBatchUnsupportedToast: vi.fn(),
    connectionIdRef: mocks.connectionIdRef,
    handleAdvSettingsChange: vi.fn(),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GraphqlStudioPage', () => {
  beforeEach(() => {
    resetAllMocks();
    localStorage.clear();
    mocks.captured.connectionBar = null;
    mocks.captured.historyPanel = null;
    mocks.captured.bottomPanel = null;
    mocks.captured.gqlStudioTabsArgs = [];
    mocks.captured.tabBar = null;
    mocks.captured.collectionRunParams = null;
    mocks.captured.gqlItemLoadersParams = null;
    mocks.captured.tabExecutionArgs = null;
    mocks.captured.batchExecutionArgs = null;
    mocks.pendingExecuteAfterGateRef.current = null;
    mocks.skipComplexityGateRef.current = false;
    mocks.sessionBypassComplexityGateRef.current = false;
    mocks.executingRef.current = false;
    mocks.tabExecutionStates.clear();
    mocks.responseCache.clear();
    mocks.setPageEndpoint('https://api.example.com/graphql');
    mocks.setPageSkipTlsVerify(false);
    mocks.isTauri.mockReturnValue(false);
    mocks.loadPersistedActivityTab.mockReturnValue(null);
    mocks.findUnresolvedVars.mockReturnValue([]);
    mocks.resolveVars.mockImplementation((v: string) => v);
    mocks.computeQueryComplexity.mockReturnValue(null);
    mocks.buildClientSchema.mockReturnValue({});
    mocks.validate.mockReturnValue([]);
    mocks.gqlParseDoc.mockReturnValue({});
    setupConnection();
    setupExecution();
    setupTabs();
    setupSchema();
    setupBatch();
    setupAdvSettings();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic render', () => {
    it('renders without crashing with minimal props', () => {
      renderPage();
      expect(screen.getByTestId('gql-studio-page')).toBeInTheDocument();
      expect(screen.getByTestId('gql-connection-bar-mock')).toBeInTheDocument();
    });

    it('returns null when tabs are empty', () => {
      mocks.useGqlStudioTabs.mockReturnValue({
        tabs: [],
        activeTabId: '',
        activeTab: undefined,
        operations: [],
        selectedOperation: undefined,
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef: mocks.executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
      });
      const { container } = renderPage();
      expect(container.firstChild).toBeNull();
    });

    it('passes resolved endpoint to schema hook via resolveVars', () => {
      renderPage({ resolvedBaseUrl: 'https://base.example.com' });
      expect(mocks.useGraphqlSchema).toHaveBeenCalled();
      expect(mocks.resolveVars).toHaveBeenCalled();
    });

    it('builds global env map from selected service/env when provided', () => {
      setupConnection({ endpoint: '{{graphqlUrl}}' });
      mocks.resolveVars.mockImplementation((value: string, _env: unknown, globalMap?: Record<string, string>) =>
        value.replace('{{graphqlUrl}}', globalMap?.graphqlUrl ?? '{{graphqlUrl}}'));

      renderPage({
        envName: 'Dev',
        selectedEnvId: 'e1',
        selectedSvc: {
          id: 'svc-1',
          name: 'Orders',
          baseUrls: { e1: 'https://http.dev' },
          protocolEndpoints: {
            graphql: {
              e1: { baseUrl: 'https://gql.dev', path: '/v1/query' },
            },
          },
        },
      });

      expect(mocks.resolveVars).toHaveBeenCalledWith(
        '{{graphqlUrl}}',
        expect.any(Object),
        expect.objectContaining({ graphqlUrl: 'https://gql.dev/v1/query' }),
      );
      expect(mocks.useGraphqlSchema).toHaveBeenCalledWith(
        'https://gql.dev/v1/query',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('passes per-tab resolved endpoint to useGraphqlSchema when tab has override (Phase 6)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      setupConnection({ endpoint: 'https://api.example.com/graphql' });
      renderPage();
      expect(mocks.useGraphqlSchema).toHaveBeenCalledWith(
        'https://staging.example.com/graphql',
        expect.any(Object),
        expect.objectContaining({ skipTlsVerify: false }),
      );
    });

    it('passes per-tab skipTlsVerify to useGraphqlSchema when tab override is set (Phase 6)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql', skipTlsVerify: true });
      setupConnection({ endpoint: 'https://api.example.com/graphql', skipTlsVerify: false });
      renderPage();
      expect(mocks.useGraphqlSchema).toHaveBeenCalledWith(
        'https://staging.example.com/graphql',
        expect.any(Object),
        expect.objectContaining({ skipTlsVerify: true }),
      );
    });

    it('passes per-tab resolved pollingIntervalMs to useGraphqlSchema (Phase 6F)', () => {
      setupTabs({ pollingEnabled: true, pollingIntervalSeconds: 45 });
      setupConnection({ pollingEnabled: false, pollingIntervalSeconds: 30 });
      renderPage();
      expect(mocks.useGraphqlSchema).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ pollingIntervalMs: 45000 }),
      );
      expect(mocks.captured.connectionBar?.pollingEnabled).toBe(true);
      expect(mocks.captured.connectionBar?.pollingIntervalSeconds).toBe(45);
      expect(mocks.captured.connectionBar?.hasPollingOverride).toBe(true);
    });

    it('passes clearActiveTabPolling as onClearPolling when tab has polling override (Phase 6F)', () => {
      setupTabs({ pollingEnabled: true, pollingIntervalSeconds: 45 });
      setupConnection({ pollingEnabled: false, pollingIntervalSeconds: 30 });
      renderPage();
      const hookReturn = mocks.useGqlStudioTabs.mock.results.at(-1)?.value as {
        clearActiveTabPolling: unknown;
      };
      expect(mocks.captured.connectionBar?.onClearPolling).toBe(hookReturn.clearActiveTabPolling);
    });

    it('passes endpointLinkPending to connection bar when profile link is unresolved (Phase 6F)', () => {
      setupTabs({ connectionId: 'prof-staging' });
      setupConnection();
      renderPage();
      expect(mocks.captured.connectionBar?.endpointLinkPending).toBe(true);
    });

    it('Phase 6F Slice 3: profile-linked tab shows profile auth on connection bar', () => {
      setupTabs({
        connectionId: 'prof-staging',
        endpoint: 'https://staging.example.com/graphql',
        hasResolvedProfileLink: true,
      });
      setupConnection({
        auth: { type: 'bearer', token: 'page-token' },
        profiles: [{
          id: 'prof-staging',
          name: 'Staging',
          endpoint: 'https://staging.example.com/graphql',
          auth: { type: 'bearer', token: 'staging-token' },
          createdAt: 1,
        }],
      });
      renderPage();
      expect(mocks.captured.connectionBar?.auth).toEqual({ type: 'bearer', token: 'staging-token' });
      expect(mocks.captured.bottomPanel?.linkedProfileName).toBe('Staging');
    });

    it('Phase 6H Slice 3: profile-linked tab edits stored tab layer (not page auth)', () => {
      setupTabs({
        connectionId: 'prof-staging',
        endpoint: 'https://staging.example.com/graphql',
        hasResolvedProfileLink: true,
      });
      setupConnection({
        auth: { type: 'bearer', token: 'page-token' },
        profiles: [{
          id: 'prof-staging',
          name: 'Staging',
          endpoint: 'https://staging.example.com/graphql',
          auth: { type: 'bearer', token: 'staging-token' },
          createdAt: 1,
        }],
      });
      renderPage();
      expect(mocks.captured.bottomPanel?.authScope).toBe('tab');
      expect(mocks.captured.bottomPanel?.storedAuth).toEqual({ type: 'bearer', token: 'staging-token' });
      expect(mocks.captured.bottomPanel?.hasAuthOverride).toBe(false);
      expect(mocks.captured.bottomPanel?.resolvedAuthPreview).toContain('Bearer');
    });

    it('Phase 6H Slice 3: single inheriting tab edits page default auth', () => {
      setupTabs();
      setupConnection({ auth: { type: 'bearer', token: 'page-token' } });
      renderPage();
      expect(mocks.captured.bottomPanel?.authScope).toBe('page');
      expect(mocks.captured.bottomPanel?.storedAuth).toEqual({ type: 'bearer', token: 'page-token' });
      expect(mocks.captured.bottomPanel?.onResetAuthToInherit).toBeUndefined();
    });

    it('Phase 6H Slice 3: tab auth override wires reset to clearActiveTabAuth', () => {
      const tab = setupTabs({ auth: { type: 'bearer', token: 'tab-only' } });
      setupConnection({ auth: { type: 'bearer', token: 'page-token' } });
      renderPage();
      expect(mocks.captured.bottomPanel?.authScope).toBe('tab');
      expect(mocks.captured.bottomPanel?.storedAuth).toEqual(tab.auth);
      expect(mocks.captured.bottomPanel?.hasAuthOverride).toBe(true);
      expect(mocks.captured.bottomPanel?.onResetAuthToInherit).toBe(
        mocks.useGqlStudioTabs.mock.results.at(-1)?.value.clearActiveTabAuth,
      );
    });

    it('Phase 6H Slice 7.4: auth badge focuses bottom Auth panel', () => {
      setupTabs();
      setupConnection({ auth: { type: 'bearer', token: 'page-token' } });
      renderPage();
      expect(typeof mocks.captured.connectionBar?.onFocusAuthPanel).toBe('function');
      act(() => {
        (mocks.captured.connectionBar?.onFocusAuthPanel as () => void)();
      });
      expect(mocks.captured.bottomPanel?.activeTab).toBe('auth');
    });

    it('Phase 6H Slice 7.4: auth badge focus passes page scope to bottom panel', () => {
      setupTabs();
      setupConnection({ auth: { type: 'bearer', token: 'page-token' } });
      renderPage();
      expect(mocks.captured.bottomPanel?.authScope).toBe('page');
      expect(mocks.captured.bottomPanel?.storedAuth).toEqual({ type: 'bearer', token: 'page-token' });
    });

    it('Phase 6H Slice 4: passes authBadgePresentation for tab bearer override', () => {
      setupTabs({ auth: { type: 'bearer', token: 'tab-only' } });
      setupConnection({ auth: { type: 'bearer', token: 'page-token' } });
      renderPage();
      expect(mocks.captured.connectionBar?.authBadgePresentation).toEqual({
        label: 'Bearer',
        variant: 'override',
        scope: 'tab',
        configured: true,
      });
    });

    it('Phase 6H Slice 4: profile-linked tab badge uses profile variant', () => {
      setupTabs({
        connectionId: 'prof-staging',
        endpoint: 'https://staging.example.com/graphql',
        hasResolvedProfileLink: true,
      });
      setupConnection({
        auth: { type: 'bearer', token: 'page-token' },
        profiles: [{
          id: 'prof-staging',
          name: 'Staging',
          endpoint: 'https://staging.example.com/graphql',
          auth: { type: 'bearer', token: 'staging-token' },
          createdAt: 1,
        }],
      });
      renderPage();
      expect(mocks.captured.connectionBar?.authBadgePresentation).toMatchObject({
        label: 'Inherit (Staging)',
        variant: 'profile',
        scope: 'profile',
        configured: true,
      });
    });

    it('Phase 6F: linkedProfileName is null when connectionId is orphaned (profile missing)', () => {
      setupTabs({ connectionId: 'prof-deleted' });
      setupConnection({ profiles: [] });
      renderPage();
      expect(mocks.captured.bottomPanel?.linkedProfileName).toBeNull();
    });

    it('Phase 6F Slice 3: passes profiles + pageDefaults to tab execution hook', () => {
      setupTabs({
        connectionId: 'prof-staging',
        endpoint: 'https://staging.example.com/graphql',
        hasResolvedProfileLink: true,
      });
      setupConnection({
        auth: { type: 'bearer', token: 'page-token' },
        profiles: [{
          id: 'prof-staging',
          name: 'Staging',
          endpoint: 'https://staging.example.com/graphql',
          auth: { type: 'bearer', token: 'staging-token' },
          createdAt: 1,
        }],
      });
      renderPage();
      expect(mocks.captured.tabExecutionArgs?.profiles).toHaveLength(1);
      expect(mocks.captured.tabExecutionArgs?.pageDefaults).toEqual(expect.objectContaining({
        auth: { type: 'bearer', token: 'page-token' },
        endpoint: 'https://api.example.com/graphql',
      }));
    });

    it('Phase 6F Slice 3: batch execution uses page-default auth, not active-tab profile auth', () => {
      setupTabs({
        connectionId: 'prof-staging',
        endpoint: 'https://staging.example.com/graphql',
        hasResolvedProfileLink: true,
      });
      setupConnection({
        auth: { type: 'bearer', token: 'page-token' },
        profiles: [{
          id: 'prof-staging',
          name: 'Staging',
          endpoint: 'https://staging.example.com/graphql',
          auth: { type: 'bearer', token: 'staging-token' },
          createdAt: 1,
        }],
      });
      renderPage();
      expect(mocks.captured.batchExecutionArgs?.pageDefaultAuth).toEqual({ type: 'bearer', token: 'page-token' });
    });

    it('Phase 6F: pending profile link blocks actions even when tab endpoint is persisted', () => {
      setupTabs({
        connectionId: 'prof-staging',
        endpoint: 'https://staging.example.com/graphql',
        hasResolvedProfileLink: true,
        profilesReady: false,
      });
      setupConnection({
        profiles: [{
          id: 'prof-staging',
          name: 'Staging',
          endpoint: 'https://staging.example.com/graphql',
          auth: { type: 'bearer', token: 'staging-token' },
          createdAt: 1,
        }],
        profilesReady: false,
      });
      renderPage();
      expect(mocks.captured.connectionBar?.endpointLinkPending).toBe(true);
    });

    it('loads history by per-tab resolved endpoint, not page historyConnectionId (Phase 6)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      setupConnection({ endpoint: 'https://api.example.com/graphql', historyConnectionId: 'conn-1' });
      renderPage();
      expect(mocks.useGraphqlHistory).toHaveBeenCalledWith(
        'https://staging.example.com/graphql',
        100,
      );
    });

    it('loads advanced settings detection by per-tab connection id (Phase 6)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      setupConnection({ endpoint: 'https://api.example.com/graphql', historyConnectionId: 'conn-1' });
      renderPage();
      expect(mocks.useGraphqlAdvancedSettings).toHaveBeenCalledWith(
        'https://staging.example.com/graphql',
        null,
      );
    });

    it('passes tab schema connection id to snapshots and mock server when tab has override (Phase 6)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      renderPage();
      expect(mocks.useGraphqlSchemaSnapshots.mock.calls[0]?.[0]).toBe('https://staging.example.com/graphql');
      expect(mocks.useGraphqlMockServer.mock.calls[0]?.[0]).toBe('https://staging.example.com/graphql');
    });

    it('passes per-tab skipTlsVerify to collection run hook (Phase 6)', () => {
      setupTabs({ skipTlsVerify: true });
      setupConnection({ skipTlsVerify: false });
      renderPage();
      expect(mocks.captured.collectionRunParams?.skipTlsVerify).toBe(true);
    });

    it('passes per-tab cached response to right pane when switching tabs (Phase 6 PT-4 / 6E)', () => {
      setupTabs({ id: 'tab-1' });
      const tab1Response = { data: { tab: 1 }, latencyMs: 10, timestamp: 1, httpStatus: 200 };
      mocks.tabExecutionStates.set('tab-1', {
        status: 'success',
        response: tab1Response,
        apqInfo: null,
      });
      mocks.useGraphqlExecution.mockReturnValue({
        status: 'success',
        response: { data: { tab: 2 }, latencyMs: 12, timestamp: 2, httpStatus: 200 },
        execute: vi.fn(),
        cancel: vi.fn(),
        isDuplicate: false,
        apqInfo: null,
        resolveDedupChoice: vi.fn(),
      });

      renderPage();
      expect(mocks.captured.rightPane?.response).toEqual(tab1Response);
      expect(mocks.captured.rightPane?.execStatus).toBe('success');
      expect(mocks.captured.rightPane?.executing).toBe(false);
    });

    it('restores per-tab APQ badge from active tab hook state (Phase 6D / 6E)', () => {
      setupTabs({ id: 'tab-1' });
      const tab1Apq = { hash: 'tab1hash', cacheHit: true, unsupported: false };
      mocks.tabExecutionStates.set('tab-1', {
        status: 'success',
        response: { data: {}, latencyMs: 1, timestamp: 1, httpStatus: 200 },
        apqInfo: tab1Apq,
      });
      mocks.useGraphqlExecution.mockReturnValue({
        status: 'success',
        response: null,
        execute: vi.fn(),
        cancel: vi.fn(),
        isDuplicate: false,
        apqInfo: { hash: 'tab2hash', cacheHit: false, unsupported: false },
        resolveDedupChoice: vi.fn(),
      });

      renderPage();
      expect(mocks.captured.connectionBar?.apqCacheHit).toBe(true);
      expect(mocks.captured.connectionBar?.apqHash).toBe('tab1hash');
      expect(mocks.useGraphqlAdvancedSettings).toHaveBeenCalledWith(
        expect.any(String),
        tab1Apq,
      );
    });

    it('hides APQ badge when active tab has no apqInfo (Phase 6D / 6E)', () => {
      setupTabs({ id: 'tab-1' });
      mocks.tabExecutionStates.set('tab-1', {
        status: 'success',
        response: null,
        apqInfo: null,
      });
      mocks.useGraphqlExecution.mockReturnValue({
        status: 'success',
        response: null,
        execute: vi.fn(),
        cancel: vi.fn(),
        isDuplicate: false,
        apqInfo: { hash: 'tab2hash', cacheHit: true, unsupported: false },
        resolveDedupChoice: vi.fn(),
      });

      renderPage();
      expect(mocks.captured.connectionBar?.apqCacheHit).toBeUndefined();
      expect(mocks.captured.connectionBar?.apqHash).toBeUndefined();
      expect(mocks.useGraphqlAdvancedSettings).toHaveBeenCalledWith(expect.any(String), null);
    });

    it('uses live APQ info when active tab owns execution (Phase 6D / 6E)', () => {
      setupTabs({ id: 'tab-1' });
      const liveApq = { hash: 'live', cacheHit: false, unsupported: false };
      mocks.useGraphqlExecution.mockReturnValue({
        status: 'loading',
        response: null,
        execute: vi.fn(),
        cancel: vi.fn(),
        isDuplicate: false,
        apqInfo: liveApq,
        resolveDedupChoice: vi.fn(),
      });

      renderPage();
      expect(mocks.captured.connectionBar?.apqHash).toBe('live');
      expect(mocks.captured.connectionBar?.apqCacheHit).toBe(false);
      expect(mocks.useGraphqlAdvancedSettings).toHaveBeenCalledWith(expect.any(String), liveApq);
    });

    it('calls execute via tab execution bridge when Send is clicked (Phase 6E)', () => {
      setupTabs();
      renderPage();
      clickExecute();
      expect(mocks.tabExecuteBridgeMock).toHaveBeenCalled();
      expect(mocks.useGraphqlExecution().execute).toHaveBeenCalledWith(expect.objectContaining({
        sourceTabId: 'tab-1',
        onExecutionCompleted: expect.any(Function),
      }));
    });

    it('passes removeTabFromCache as onTabClosed to useGqlStudioTabs (Phase 6 PT-4)', () => {
      renderPage();
      const args = mocks.captured.gqlStudioTabsArgs[0]?.[0] as { onTabClosed: (id: string) => void };
      expect(args.onTabClosed).toBe(mocks.removeTabFromCache);
    });

    it('passes closeTab to tab bar onTabClose (Phase 6 PT-4)', () => {
      setupTabs();
      renderPage();
      const hookReturn = mocks.useGqlStudioTabs.mock.results.at(-1)?.value as { closeTab: unknown };
      expect(mocks.captured.tabBar?.onTabClose).toBe(hookReturn.closeTab);
    });

    it('passes per-tab resolved endpoint to connection bar (Phase 6 PT-5)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      setupConnection({ endpoint: 'https://api.example.com/graphql' });
      renderPage();
      const hookReturn = mocks.useGqlStudioTabs.mock.results.at(-1)?.value as {
        updateActiveTabEndpoint: unknown;
        clearActiveTabEndpoint: unknown;
      };
      expect(mocks.captured.connectionBar?.endpoint).toBe('https://staging.example.com/graphql');
      expect(mocks.captured.connectionBar?.hasEndpointOverride).toBe(true);
      expect(mocks.captured.connectionBar?.onClearEndpoint).toBe(hookReturn.clearActiveTabEndpoint);
      expect(typeof mocks.captured.connectionBar?.onEndpointChange).toBe('function');
    });

    it('connection bar inherits page default when tab has no endpoint override (Phase 6 PT-5)', () => {
      setupTabs();
      setupConnection({ endpoint: 'https://api.example.com/graphql' });
      renderPage();
      expect(mocks.captured.connectionBar?.endpoint).toBe('https://api.example.com/graphql');
      expect(mocks.captured.connectionBar?.hasEndpointOverride).toBe(false);
    });

    it('executes against per-tab resolved endpoint (Phase 6 PT-5)', () => {
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      setupConnection({ endpoint: 'https://api.example.com/graphql' });
      setupExecution();
      renderPage();
      clickExecute();
      const executeFn = mocks.useGraphqlExecution().execute as ReturnType<typeof vi.fn>;
      expect(executeFn).toHaveBeenCalledWith(expect.objectContaining({
        endpoint: 'https://staging.example.com/graphql',
        connectionId: 'https://staging.example.com/graphql',
      }));
    });

    it('legacy single tab edits page default endpoint, not tab override (Phase 6 PT-6)', () => {
      setupTabs();
      const setEndpoint = vi.fn();
      const updateActiveTabEndpoint = vi.fn();
      mocks.useGqlStudioTabs.mockReturnValue({
        ...mocks.useGqlStudioTabs(),
        tabs: [mocks.makeActiveTab()],
        activeTabId: 'tab-1',
        activeTab: mocks.makeActiveTab(),
        resolvedTabEndpoint: 'https://api.example.com/graphql',
        hasActiveTabEndpointOverride: false,
        updateActiveTabEndpoint,
        clearActiveTabEndpoint: vi.fn(),
      });
      setupConnection({ endpoint: 'https://api.example.com/graphql', setEndpoint });
      renderPage();
      const onChange = mocks.captured.connectionBar?.onEndpointChange as (url: string) => void;
      onChange('https://new.example.com/graphql');
      expect(setEndpoint).toHaveBeenCalledWith('https://new.example.com/graphql');
      expect(updateActiveTabEndpoint).not.toHaveBeenCalled();
    });

    it('multi-tab session edits active tab endpoint override (Phase 6 PT-6)', () => {
      const tab1 = mocks.makeActiveTab({ id: 'tab-1' });
      const tab2 = mocks.makeActiveTab({ id: 'tab-2' });
      const setEndpoint = vi.fn();
      const updateActiveTabEndpoint = vi.fn();
      mocks.useGqlStudioTabs.mockReturnValue({
        tabs: [tab1, tab2],
        activeTabId: 'tab-1',
        activeTab: tab1,
        operations: ['MyQuery'],
        selectedOperation: 'MyQuery',
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef: mocks.executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        renameTab: vi.fn(),
        updateActiveTab: vi.fn(),
        updateActiveTabEndpoint,
        clearActiveTabEndpoint: vi.fn(),
        resolvedTabEndpoint: 'https://api.example.com/graphql',
        hasActiveTabEndpointOverride: false,
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
      });
      setupConnection({ endpoint: 'https://api.example.com/graphql', setEndpoint });
      renderPage();
      const onChange = mocks.captured.connectionBar?.onEndpointChange as (url: string) => void;
      onChange('https://staging.example.com/graphql');
      expect(updateActiveTabEndpoint).toHaveBeenCalledWith('https://staging.example.com/graphql');
      expect(setEndpoint).not.toHaveBeenCalled();
    });

    it('passes explicit endpoint protocol status to connection bar', () => {
      renderPage({
        selectedEnvId: 'e1',
        selectedSvc: {
          id: 'svc-1',
          name: 'Orders',
          baseUrls: { e1: 'https://http.dev' },
          protocolEndpoints: {
            graphql: { e1: { baseUrl: 'https://gql.dev', path: '/v1' } },
          },
        },
      });
      expect(mocks.captured.connectionBar?.endpointProtocolStatus).toBe('explicit');
    });

    it('omits endpoint protocol status without service selection', () => {
      renderPage({ resolvedBaseUrl: 'https://legacy.example.com' });
      expect(mocks.captured.connectionBar?.endpointProtocolStatus).toBeUndefined();
    });
  });

  describe('historyMaxItems initializer (L121-127)', () => {
    it('uses valid localStorage integer clamped to 10-500', () => {
      localStorage.setItem('gql_history_max_items', '250');
      renderPage();
      expect(mocks.useGraphqlHistory).toHaveBeenCalledWith('https://api.example.com/graphql', 250);
    });

    it('falls back to 100 for invalid localStorage value', () => {
      localStorage.setItem('gql_history_max_items', 'not-a-number');
      renderPage();
      expect(mocks.useGraphqlHistory).toHaveBeenCalledWith('https://api.example.com/graphql', 100);
    });

    it('falls back to 100 when localStorage is null', () => {
      renderPage();
      expect(mocks.useGraphqlHistory).toHaveBeenCalledWith('https://api.example.com/graphql', 100);
    });

    it('clamps values below 10 up to 10', () => {
      localStorage.setItem('gql_history_max_items', '3');
      renderPage();
      expect(mocks.useGraphqlHistory).toHaveBeenCalledWith('https://api.example.com/graphql', 10);
    });
  });

  describe('handleHistoryMaxItemsChange (L128-131)', () => {
    it('persists max items to localStorage via history panel callback', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-history-max'));
      expect(setItemSpy).toHaveBeenCalledWith('gql_history_max_items', '250');
      setItemSpy.mockRestore();
    });
  });

  describe('Phase 6D-6 upload progress', () => {
    it('clears upload progress when execution completes', () => {
      setupExecution({ status: 'idle' });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-set-files'));
      clickExecute();
      expect(mocks.setTabUploadProgress).toHaveBeenCalledWith('tab-1', 0);
      mocks.cacheExecutionResult('tab-1', 'success', {
        data: { ok: true },
        latencyMs: 10,
        timestamp: 1,
        httpStatus: 200,
      });
      expect(mocks.responseCache.get('tab-1')?.uploadProgress).toBeUndefined();
    });

    it('restores cached upload progress for the active tab after tab switch', () => {
      mocks.responseCache.set('tab-1', {
        status: 'loading',
        response: null,
        uploadProgress: 55,
      });
      setupExecution({ status: 'idle' });
      renderPage();
      expect(mocks.captured.bottomPanel?.uploadProgress).toBe(55);
    });

    it('clears upload progress when user cancels execution', () => {
      setupExecution({ status: 'loading' });
      renderPage();
      mocks.responseCache.set('tab-1', {
        status: 'loading',
        response: null,
        uploadProgress: 60,
      });
      fireEvent.click(screen.getByTestId('gql-mock-cancel'));
      expect(mocks.setTabUploadProgress).toHaveBeenCalledWith('tab-1', null);
    });
  });

  describe('history auto-save on execution completed (Phase 6)', () => {
    it('saves history when execute invokes onExecutionCompleted', async () => {
      const saveHistory = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupTabs({ label: 'MyLabel', query: 'query { x }' });
      const response = { data: { x: 1 }, errors: [], httpStatus: 200, latencyMs: 10 };
      const execute = vi.fn((params: {
        sourceTabId?: string;
        onExecutionStarted?: (id: string) => void;
        onExecutionCompleted?: (tabId: string, status: 'success', resp: typeof response, apq: null) => void;
      }) => {
        params.onExecutionStarted?.('tab-1');
        params.onExecutionCompleted?.('tab-1', 'success', response, null);
      });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      await waitFor(() => {
        expect(saveHistory).toHaveBeenCalledWith(expect.objectContaining({
          connectionId: 'https://api.example.com/graphql',
          operation: expect.objectContaining({ query: 'query { x }' }),
        }));
      });
    });

    it('saves history with per-tab resolved endpoint (Phase 6)', async () => {
      const saveHistory = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupTabs({ endpoint: 'https://staging.example.com/graphql' });
      setupConnection({ endpoint: 'https://api.example.com/graphql', historyConnectionId: 'conn-1' });
      const response = { data: { x: 1 }, httpStatus: 200, latencyMs: 10 };
      const execute = vi.fn((params: {
        onExecutionCompleted?: (tabId: string, status: 'success', resp: typeof response, apq: null) => void;
      }) => {
        params.onExecutionCompleted?.('tab-1', 'success', response, null);
      });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      await waitFor(() => {
        expect(saveHistory).toHaveBeenCalledWith(expect.objectContaining({
          connectionId: 'https://staging.example.com/graphql',
        }));
      });
    });

    it('does not save history until execution completion callback runs', () => {
      const saveHistory = vi.fn();
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupExecution({ status: 'success', response: { data: {} } });
      renderPage();
      expect(saveHistory).not.toHaveBeenCalled();
    });
  });

  describe('activeTabHeaders useMemo (L220-228)', () => {
    it('includes only enabled non-empty header keys', () => {
      setupTabs({
        headers: [
          { key: 'X-Custom', value: '1', enabled: true },
          { key: '  X-Trim  ', value: '2', enabled: true },
          { key: 'Disabled', value: '3', enabled: false },
          { key: '   ', value: '4', enabled: true },
        ],
      });
      renderPage();
      expect(mocks.buildAuthHeaders).toHaveBeenCalled();
      expect(mocks.resolveVars).toHaveBeenCalled();
    });
  });

  describe('schemaHeaders useMemo (L230-237)', () => {
    it('merges auth headers with active tab headers and resolves vars', () => {
      setupConnection({ auth: { type: 'bearer', token: 'abc' } as never });
      setupTabs({ headers: [{ key: 'X-Tab', value: '{{API_KEY}}', enabled: true }] });
      renderPage();
      expect(mocks.buildAuthHeaders).toHaveBeenCalled();
      expect(mocks.resolveVars).toHaveBeenCalledWith('{{API_KEY}}', expect.any(Object), expect.any(Object));
    });
  });

  describe('schema effect (L245-248)', () => {
    it('calls setGraphqlSchema when rawIntrospection is set', () => {
      setupSchema({ rawIntrospection: { __schema: {} } });
      renderPage();
      expect(mocks.setGraphqlSchema).toHaveBeenCalledWith({ __schema: {} });
    });

    it('calls clearGraphqlSchema when rawIntrospection is null', () => {
      renderPage();
      expect(mocks.clearGraphqlSchema).toHaveBeenCalled();
    });
  });

  describe('invalidItemIds useMemo (L250-266)', () => {
    it('returns empty set without rawIntrospection', () => {
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{
          collection: { id: 'c1', name: 'C' },
          folders: [],
          items: [{ id: 'item-1', operation: { query: 'query { bad }' } }],
        }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      expect(mocks.buildClientSchema).not.toHaveBeenCalled();
    });

    it('marks items with validation errors as invalid', () => {
      setupSchema({ rawIntrospection: { __schema: {} } });
      mocks.validate.mockReturnValue([{ message: 'error' }]);
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{
          collection: { id: 'c1', name: 'C' },
          folders: [],
          items: [{ id: 'bad-item', operation: { query: 'query { bad }' } }],
        }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      expect(mocks.buildClientSchema).toHaveBeenCalled();
      expect(mocks.validate).toHaveBeenCalled();
    });

    it('handles buildClientSchema failure gracefully', () => {
      setupSchema({ rawIntrospection: { __schema: {} } });
      mocks.buildClientSchema.mockImplementation(() => { throw new Error('bad schema'); });
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{
          collection: { id: 'c1', name: 'C' },
          folders: [],
          items: [{ id: 'item-1', operation: { query: 'query { x }' } }],
        }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      expect(mocks.buildClientSchema).toHaveBeenCalled();
    });
  });

  describe('introspecting effect (L277-283)', () => {
    it('switches right pane to schema after successful introspection', async () => {
      setupSchema({ introspecting: false, status: 'none' });
      const { rerender } = renderPage();
      setupSchema({ introspecting: true, status: 'none' });
      rerender(<GraphqlStudioPage />);
      setupSchema({ introspecting: false, status: 'loaded' });
      rerender(<GraphqlStudioPage />);
      await waitFor(() => {
        expect(mocks.captured.rightPane?.view).toBe('schema');
      });
    });
  });

  describe('connectionBarSchemaStatus (L285-286)', () => {
    it('maps loaded schema status', () => {
      setupSchema({ status: 'loaded' });
      renderPage();
      expect(screen.getByTestId('gql-mock-schema-status').textContent).toBe('loaded');
    });

    it('maps error schema status', () => {
      setupSchema({ status: 'error' });
      renderPage();
      expect(screen.getByTestId('gql-mock-schema-status').textContent).toBe('error');
    });

    it('maps introspection-disabled to error', () => {
      setupSchema({ status: 'introspection-disabled' });
      renderPage();
      expect(screen.getByTestId('gql-mock-schema-status').textContent).toBe('error');
    });

    it('maps none schema status', () => {
      renderPage();
      expect(screen.getByTestId('gql-mock-schema-status').textContent).toBe('none');
    });
  });

  describe('complexityResult useMemo (L299-304)', () => {
    it('returns null when schema is not loaded', () => {
      renderPage();
      expect(screen.getByTestId('gql-mock-complexity-score').textContent).toBe('none');
    });

    it('computes complexity when schema is loaded', () => {
      setupSchema({
        status: 'loaded',
        schemaInfo: { types: [{}], sdl: 'type Query { hello: String }' },
      });
      mocks.computeQueryComplexity.mockReturnValue({
        score: 42,
        level: 'ok',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      renderPage();
      expect(mocks.computeQueryComplexity).toHaveBeenCalled();
      expect(screen.getByTestId('gql-mock-complexity-score').textContent).toBe('42');
    });
  });

  describe('complexity query change effect (L308-311)', () => {
    it('clears complexity warning pending when query changes', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 5000,
        level: 'danger',
        shouldBlock: true,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({
        status: 'loaded',
        schemaInfo: { types: [{}] },
      });
      const { rerender } = renderPage();
      clickExecute();
      expect(screen.getByTestId('gql-complexity-warning-mock')).toBeInTheDocument();
      setupTabs({ query: 'query { changed }' });
      rerender(<GraphqlStudioPage />);
      clickExecute();
      expect(screen.getByTestId('gql-complexity-warning-mock')).toBeInTheDocument();
    });
  });

  describe('varsError effect (L313-327)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('accepts empty variables', async () => {
      setupTabs({ variables: '' });
      renderPage();
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(mocks.captured.connectionBar?.varsInvalid).toBe(false);
    });

    it('accepts empty object variables', async () => {
      setupTabs({ variables: '{}' });
      renderPage();
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(mocks.captured.connectionBar?.varsInvalid).toBe(false);
    });

    it('flags invalid JSON after debounce', async () => {
      setupTabs({ variables: '{bad json' });
      renderPage();
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(mocks.captured.connectionBar?.varsInvalid).toBe(true);
    });

    it('flags non-object JSON values', async () => {
      setupTabs({ variables: '[]' });
      renderPage();
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(mocks.captured.connectionBar?.varsInvalid).toBe(true);
    });

    it('validates immediately on tab switch', () => {
      setupTabs({ id: 'tab-1', variables: '{}' });
      const { rerender } = renderPage();
      mocks.useGqlStudioTabs.mockReturnValue({
        tabs: [
          mocks.makeActiveTab({ id: 'tab-1', variables: '{}' }),
          mocks.makeActiveTab({ id: 'tab-2', variables: 'null' }),
        ],
        activeTabId: 'tab-2',
        activeTab: mocks.makeActiveTab({ id: 'tab-2', variables: 'null' }),
        operations: [],
        selectedOperation: undefined,
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef: mocks.executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
      });
      rerender(<GraphqlStudioPage />);
      expect(mocks.captured.connectionBar?.varsInvalid).toBe(true);
    });
  });

  describe('handleExecute guards (L355-435)', () => {
    it('does nothing without active tab query', () => {
      setupTabs({ query: '   ' });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('does nothing without endpoint', () => {
      setupConnection({ endpoint: '  ' });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('does nothing with unresolved environment variables', () => {
      mocks.findUnresolvedVars.mockReturnValue(['MISSING']);
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('does nothing with invalid variables JSON', () => {
      setupTabs({ variables: 'not-json' });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('does nothing with array variables JSON', () => {
      setupTabs({ variables: '[1,2]' });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('does nothing when file entries have errors', () => {
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-set-bad-files'));
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('does nothing while already executing', () => {
      setupExecution({ status: 'loading', execute: vi.fn() });
      const execute = vi.fn();
      mocks.useGraphqlExecution.mockReturnValue({
        status: 'loading',
        response: null,
        execute,
        cancel: vi.fn(),
        isDuplicate: false,
        apqInfo: null,
        resolveDedupChoice: vi.fn(),
      });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
    });

    it('shows complexity warning when shouldBlock and not pending', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 5000,
        level: 'danger',
        shouldBlock: true,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
      expect(screen.getByTestId('gql-complexity-warning-mock')).toBeInTheDocument();
    });

    it('executes after complexity warning confirm', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 5000,
        level: 'danger',
        shouldBlock: true,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      fireEvent.click(screen.getByTestId('gql-warning-confirm'));
      expect(execute).toHaveBeenCalled();
    });

    it('opens complexity gate modal when block threshold exceeded', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      setupAdvSettings({ complexityBlockEnabled: true, complexityBlockThreshold: 1000 });
      const setComplexityGatePending = vi.fn();
      setupBatch({ complexityGatePending: false, setComplexityGatePending });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).not.toHaveBeenCalled();
      expect(setComplexityGatePending).toHaveBeenCalledWith(true);
    });

    it('executes via complexity gate send anyway', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      setupAdvSettings({ complexityBlockEnabled: true, complexityBlockThreshold: 1000 });
      const setComplexityGatePending = vi.fn();
      setupBatch({ complexityGatePending: true, setComplexityGatePending });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      mocks.pendingExecuteAfterGateRef.current = getExecuteFn();
      fireEvent.click(screen.getByTestId('gql-gate-send'));
      expect(setComplexityGatePending).toHaveBeenCalledWith(false);
      expect(execute).toHaveBeenCalled();
    });

    it('cancels complexity gate modal', () => {
      setupBatch({ complexityGatePending: true });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupAdvSettings({ complexityBlockEnabled: true, complexityBlockThreshold: 1000 });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-gate-cancel'));
      expect(mocks.captured.complexityGate).toBeTruthy();
    });

    it('executes standard query successfully', () => {
      const execute = vi.fn();
      const pushRecentEndpoint = vi.fn();
      setupConnection({ pushRecentEndpoint });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        endpoint: 'https://api.example.com/graphql',
        query: 'query { hello }',
        apqEnabled: false,
        dedupEnabled: true,
      }));
      expect(pushRecentEndpoint).toHaveBeenCalled();
    });

    it('executes multipart upload when valid files present', () => {
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-set-files'));
      clickExecute();
      expect(mocks.buildMultipartFormData).toHaveBeenCalled();
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        formData: expect.any(FormData),
        onUploadProgress: expect.any(Function),
      }));
      const call = execute.mock.calls[0]?.[0] as { onUploadProgress?: (l: number, t: number) => void };
      mocks.tabExecutionStates.set('tab-1', { status: 'loading', response: null });
      setupExecution({ status: 'loading' });
      act(() => { call.onUploadProgress?.(50, 100); });
      expect(mocks.setTabUploadProgress).toHaveBeenCalledWith('tab-1', 50);
    });

    it('skips upload progress update when upload tab is not executing', () => {
      const execute = vi.fn();
      setupExecution({ execute, status: 'idle' });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-set-files'));
      clickExecute();
      const call = execute.mock.calls[0]?.[0] as { onUploadProgress?: (l: number, t: number) => void };
      mocks.setTabUploadProgress.mockClear();
      act(() => { call.onUploadProgress?.(50, 100); });
      expect(mocks.setTabUploadProgress).not.toHaveBeenCalled();
    });
  });

  describe('subscription orchestration (L467-487)', () => {
    it('handleSubscribe sets right view and delegates', () => {
      const handleSubscribe = vi.fn();
      mocks.useSubscriptionOrchestration.mockReturnValue({
        handleSubscribe,
        handleStopSubscription: vi.fn(),
        handleExportSubscription: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-subscribe'));
      expect(handleSubscribe).toHaveBeenCalled();
      expect(mocks.captured.rightPane?.view).toBe('response');
    });

    it('disconnects subscription when tab changes away from subscription', () => {
      const disconnect = vi.fn();
      mocks.useGraphqlSubscription.mockReturnValue({
        state: 'active',
        messages: [],
        stats: {},
        connectedSince: Date.now(),
        isPaused: false,
        pausedBufferCount: 0,
        errorMessage: null,
        reconnectAttempt: 0,
        transport: 'auto',
        reset: vi.fn(),
        disconnect,
        pause: vi.fn(),
        resume: vi.fn(),
        clear: vi.fn(),
      });
      setupTabs({ operationType: 'query' });
      const { rerender } = renderPage();
      mocks.useGqlStudioTabs.mockReturnValue({
        tabs: [mocks.makeActiveTab({ id: 'tab-2', operationType: 'query' })],
        activeTabId: 'tab-2',
        activeTab: mocks.makeActiveTab({ id: 'tab-2', operationType: 'query' }),
        operations: [],
        selectedOperation: undefined,
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef: mocks.executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
      });
      rerender(<GraphqlStudioPage />);
      expect(disconnect).toHaveBeenCalled();
    });
  });

  describe('UI interactions (L512-899)', () => {
    it('toggles builder mode', () => {
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mode-builder'));
      expect(screen.getByTestId('gql-query-builder-mock')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('gql-mode-editor'));
      expect(screen.getByTestId('gql-editor-pane')).toBeInTheDocument();
    });

    it('shows history panel when activity tab is history', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      renderPage();
      expect(screen.getByTestId('gql-history-panel-mock')).toBeInTheDocument();
    });

    it('shows resizable divider between activity sidebar and workspace', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      renderPage();
      const divider = screen.getByTestId('gql-activity-pane-divider');
      expect(divider).toBeInTheDocument();
      expect(divider).toHaveAttribute('role', 'separator');
      expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('shows mock panel when activity tab is mock', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('mock');
      renderPage();
      expect(screen.getByTestId('gql-mock-panel-mock')).toBeInTheDocument();
    });

    it('shows collections panel and parses lastRfResponse', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('collections');
      mocks.useGraphqlHistory.mockReturnValue({
        items: [{
          id: 'h1',
          response: JSON.stringify({ data: { ok: true }, httpStatus: 201, httpHeaders: { 'x-test': '1' } }),
          latencyMs: 99,
        }],
        recentItems: [],
        saveHistory: vi.fn(),
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      renderPage();
      expect(screen.getByTestId('gql-collections-mock')).toBeInTheDocument();
      expect(mocks.captured.collections?.lastRfResponse).toEqual(expect.objectContaining({
        httpStatus: 201,
        latencyMs: 99,
      }));
    });

    it('handles invalid lastRfResponse JSON gracefully', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('collections');
      mocks.useGraphqlHistory.mockReturnValue({
        items: [{ id: 'h1', response: 'not-json', latencyMs: 1 }],
        recentItems: [],
        saveHistory: vi.fn(),
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      renderPage();
      expect(mocks.captured.collections?.lastRfResponse).toBeUndefined();
    });

    it('passes envSnapshot to collections', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('collections');
      renderPage();
      expect(mocks.captured.collections?.envSnapshot).toEqual({ API_KEY: 'secret' });
    });

    it('shows subscription assertion panel for subscription tabs', () => {
      setupTabs({ operationType: 'subscription' });
      renderPage();
      expect(screen.getByTestId('gql-sub-assertions-mock')).toBeInTheDocument();
    });

    it('shows insert toast when editor actions provide one', () => {
      mocks.useGqlStudioEditorActions.mockReturnValue({
        editorMountRef: { current: null },
        prettifyError: true,
        insertToast: 'Field inserted',
        handlePrettify: vi.fn(),
        handleInsertField: vi.fn(),
      });
      renderPage();
      expect(screen.getByTestId('gql-insert-toast')).toHaveTextContent('Field inserted');
      expect(screen.getByTestId('gql-prettify-btn')).toHaveClass('gql-prettify-btn--error');
    });

    it('shows dedup banner on the tab that triggered duplicate detection (Phase 6A)', () => {
      setupExecution({ isDuplicate: true, duplicateSourceTabId: 'tab-1', resolveDedupChoice: vi.fn() });
      renderPage();
      expect(screen.getByTestId('gql-dedup-banner-mock')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('dedup-wait'));
      fireEvent.click(screen.getByTestId('dedup-cancel'));
      fireEvent.click(screen.getByTestId('dedup-send'));
      expect(mocks.useGraphqlExecution().resolveDedupChoice).toHaveBeenCalled();
    });

    it('hides dedup banner when duplicate was triggered on another tab (Phase 6A)', () => {
      setupExecution({ isDuplicate: true, duplicateSourceTabId: 'tab-other', resolveDedupChoice: vi.fn() });
      renderPage();
      expect(screen.queryByTestId('gql-dedup-banner-mock')).not.toBeInTheDocument();
    });

    it('shows batch results overlay and dismisses', () => {
      const dismissBatchResults = vi.fn();
      setupBatch({
        batchResult: { batchUnsupported: false, results: [] },
        batchResultsOpen: true,
        dismissBatchResults,
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-batch-dismiss'));
      expect(dismissBatchResults).toHaveBeenCalledTimes(1);
    });

    it('shows schema diff modal and closes', () => {
      mocks.useGraphqlSchemaSnapshots.mockReturnValue({
        snapshots: [],
        deprecatedUsages: [],
        diffModal: {
          result: {},
          oldSdl: 'old',
          newSdl: 'new',
          oldLabel: 'A',
          newLabel: 'B',
          snapshotId: 's1',
        },
        setDiffModal: vi.fn(),
        schemaDiffToast: false,
        setSchemaDiffToast: vi.fn(),
        toastBaselineSnapshotIdRef: mocks.toastBaselineSnapshotIdRef,
        handleSaveSnapshot: vi.fn(),
        handleDeleteSnapshot: vi.fn(),
        handleOpenDiff: vi.fn(),
        handleAcknowledge: vi.fn(),
        handleUnacknowledge: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-schema-diff-close'));
      expect(mocks.useGraphqlSchemaSnapshots().setDiffModal).toHaveBeenCalledWith(null);
    });

    it('handles page toast callbacks', () => {
      const setSchemaDiffToast = vi.fn();
      const setApqUnsupportedToast = vi.fn();
      const setBatchUnsupportedToast = vi.fn();
      mocks.useGraphqlAdvancedSettings.mockReturnValue({
        advSettingsOpen: false,
        setAdvSettingsOpen: vi.fn(),
        advSettingsBtnRef: { current: null },
        advSettings: mocks.defaultAdvSettings,
        advSettingsRef: mocks.advSettingsRef,
        setAdvSettings: vi.fn(),
        apqUnsupportedToast: true,
        setApqUnsupportedToast,
        batchUnsupportedToast: true,
        setBatchUnsupportedToast,
        connectionIdRef: mocks.connectionIdRef,
        handleAdvSettingsChange: vi.fn(),
      });
      mocks.useGraphqlSchemaSnapshots.mockReturnValue({
        snapshots: [],
        deprecatedUsages: [],
        diffModal: null,
        setDiffModal: vi.fn(),
        schemaDiffToast: true,
        setSchemaDiffToast,
        toastBaselineSnapshotIdRef: mocks.toastBaselineSnapshotIdRef,
        handleSaveSnapshot: vi.fn(),
        handleDeleteSnapshot: vi.fn(),
        handleOpenDiff: vi.fn(),
        handleAcknowledge: vi.fn(),
        handleUnacknowledge: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('toast-view-diff'));
      fireEvent.click(screen.getByTestId('toast-save-snapshot'));
      fireEvent.click(screen.getByTestId('toast-dismiss-schema'));
      fireEvent.click(screen.getByTestId('toast-dismiss-apq'));
      fireEvent.click(screen.getByTestId('toast-dismiss-batch'));
      expect(setSchemaDiffToast).toHaveBeenCalledWith(false);
      expect(setApqUnsupportedToast).toHaveBeenCalledWith(false);
      expect(setBatchUnsupportedToast).toHaveBeenCalledWith(false);
    });

    it('passes skip TLS handler on Tauri (routes through Node proxy)', async () => {
      const storage = await import('../../shared/utils/storage');
      const readKeySpy = vi.spyOn(storage, 'readKey').mockResolvedValue(null);
      mocks.isTauri.mockReturnValue(true);
      renderPage();
      expect(mocks.captured.connectionBar?.onSkipTlsVerifyChange).toBeTypeOf('function');
      readKeySpy.mockRestore();
      mocks.isTauri.mockReturnValue(false);
    });

    it('passes subscription log to right pane when subscription active', () => {
      setupTabs({ operationType: 'subscription', label: 'SubTab' });
      mocks.useGraphqlSubscription.mockReturnValue({
        state: 'active',
        messages: [{ id: 'm1' }],
        stats: { count: 1 },
        connectedSince: 123,
        isPaused: false,
        pausedBufferCount: 0,
        errorMessage: null,
        reconnectAttempt: 0,
        transport: 'graphql-ws',
        reset: vi.fn(),
        disconnect: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        clear: vi.fn(),
      });
      renderPage();
      expect(mocks.captured.rightPane?.subscriptionLog).toEqual(expect.objectContaining({
        state: 'active',
        operationName: 'MyQuery',
      }));
      expect(mocks.buildAssertionResultMap).toHaveBeenCalled();
    });

    it('invokes useGqlStudioTabs lifecycle callbacks from hook options', () => {
      renderPage();
      const args = mocks.captured.gqlStudioTabsArgs[0]?.[0] as {
        onCancelExecution: (tabId: string) => void;
        onClearFileEntries: () => void;
        onResetSubscription: () => void;
        pageDefaultEndpoint: string;
      };
      expect(args).toBeTruthy();
      expect(args.pageDefaultEndpoint).toBe('https://api.example.com/graphql');
      args.onCancelExecution('tab-1');
      args.onClearFileEntries();
      args.onResetSubscription();
      expect(mocks.setTabUploadProgress).toHaveBeenCalledWith('tab-1', null);
      expect(mocks.cancelTabMock).toHaveBeenCalledWith('tab-1');
      expect(mocks.useGraphqlSubscription().reset).toHaveBeenCalled();
    });

    it('registers keyboard shortcuts hook', () => {
      renderPage();
      expect(mocks.useGqlKeyboardShortcuts).toHaveBeenCalledWith(expect.objectContaining({
        handleExecute: expect.any(Function),
        handleSubscribe: expect.any(Function),
      }));
    });

    it('calls buildVarsModelUri for active tab', () => {
      renderPage();
      expect(mocks.buildVarsModelUri).toHaveBeenCalledWith('tab-1');
    });

    it('dismisses complexity warning banner', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 5000,
        level: 'danger',
        shouldBlock: true,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      renderPage();
      clickExecute();
      fireEvent.click(screen.getByTestId('gql-warning-dismiss'));
    });

    it('switches activity tabs via activity bar', () => {
      renderPage();
      fireEvent.click(screen.getByTestId('activity-history'));
      expect(screen.getByTestId('gql-history-panel-mock')).toBeInTheDocument();
    });

    it('renders complexity gate modal and sends anyway with session bypass', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      setupBatch({ complexityGatePending: true });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      mocks.pendingExecuteAfterGateRef.current = getExecuteFn();
      fireEvent.click(screen.getByTestId('gql-gate-send'));
      expect(mocks.sessionBypassComplexityGateRef.current).toBe(true);
      expect(execute).toHaveBeenCalled();
    });

    it('renders complexity gate modal cancel handler', () => {
      setupBatch({ complexityGatePending: true });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      renderPage();
      expect(screen.getByTestId('gql-complexity-gate-mock')).toBeInTheDocument();
    });

    it('invokes connection modal callbacks', () => {
      const setProfileModalOpen = vi.fn();
      const setEnvModalOpen = vi.fn();
      const saveProfile = vi.fn();
      const deleteProfile = vi.fn();
      const applyProfileToActiveTab = vi.fn();
      const clearConnectionIdsForProfile = vi.fn();
      setupConnection({
        setProfileModalOpen,
        setEnvModalOpen,
        saveProfile,
        deleteProfile,
        endpoint: 'https://api.example.com/graphql',
        auth: { type: 'none' },
      });
      setupTabs();
      mocks.useGqlStudioTabs.mockReturnValue({
        ...mocks.useGqlStudioTabs(),
        applyProfileToActiveTab,
        clearConnectionIdsForProfile,
      });
      renderPage();
      fireEvent.click(screen.getByTestId('modal-profile-close'));
      fireEvent.click(screen.getByTestId('modal-save-profile'));
      fireEvent.click(screen.getByTestId('modal-delete-profile'));
      fireEvent.click(screen.getByTestId('modal-apply-profile'));
      fireEvent.click(screen.getByTestId('modal-env-close'));
      fireEvent.click(screen.getByTestId('modal-create-env'));
      fireEvent.click(screen.getByTestId('modal-delete-env'));
      fireEvent.click(screen.getByTestId('modal-set-active-env'));
      fireEvent.click(screen.getByTestId('modal-rename-env'));
      fireEvent.click(screen.getByTestId('modal-update-vars'));
      fireEvent.click(screen.getByTestId('modal-import-env'));
      fireEvent.click(screen.getByTestId('modal-export-env'));
      expect(setProfileModalOpen).toHaveBeenCalledWith(false);
      expect(saveProfile).toHaveBeenCalled();
      expect(applyProfileToActiveTab).toHaveBeenCalled();
    });

    it('closes advanced settings panel', () => {
      const setAdvSettingsOpen = vi.fn();
      mocks.useGraphqlAdvancedSettings.mockReturnValue({
        advSettingsOpen: true,
        setAdvSettingsOpen,
        advSettingsBtnRef: { current: null },
        advSettings: mocks.defaultAdvSettings,
        advSettingsRef: mocks.advSettingsRef,
        setAdvSettings: vi.fn(),
        apqUnsupportedToast: false,
        setApqUnsupportedToast: vi.fn(),
        batchUnsupportedToast: false,
        setBatchUnsupportedToast: vi.fn(),
        connectionIdRef: mocks.connectionIdRef,
        handleAdvSettingsChange: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-advanced-close'));
      expect(setAdvSettingsOpen).toHaveBeenCalledWith(false);
    });

    it('toggles advanced settings via connection bar', () => {
      const setAdvSettingsOpen = vi.fn((fn: (v: boolean) => boolean) => fn(false));
      mocks.useGraphqlAdvancedSettings.mockReturnValue({
        advSettingsOpen: false,
        setAdvSettingsOpen,
        advSettingsBtnRef: { current: null },
        advSettings: mocks.defaultAdvSettings,
        advSettingsRef: mocks.advSettingsRef,
        setAdvSettings: vi.fn(),
        apqUnsupportedToast: false,
        setApqUnsupportedToast: vi.fn(),
        batchUnsupportedToast: false,
        setBatchUnsupportedToast: vi.fn(),
        connectionIdRef: mocks.connectionIdRef,
        handleAdvSettingsChange: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-adv-settings'));
      expect(setAdvSettingsOpen).toHaveBeenCalled();
    });

    it('opens env and profile modals from badges', () => {
      const setEnvModalOpen = vi.fn();
      const setProfileModalOpen = vi.fn();
      setupConnection({ setEnvModalOpen, setProfileModalOpen });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-env-badge'));
      fireEvent.click(screen.getByTestId('gql-mock-profile-badge'));
      expect(setEnvModalOpen).toHaveBeenCalledWith(true);
      expect(setProfileModalOpen).toHaveBeenCalledWith(true);
    });

    it('shows collection runner panel when runner tab active', () => {
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{
          collection: { id: 'col-run', name: 'RunCol' },
          folders: [],
          items: [{ id: 'ri1' }],
        }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      act(() => {
        (mocks.captured.collectionRunParams?.onSetRunnerCollectionId as (id: string) => void)('col-run');
        (mocks.captured.collectionRunParams?.onSetBottomTab as (tab: string) => void)('runner');
      });
      expect(screen.getByTestId('gql-runner-panel-mock')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('gql-runner-close'));
    });

    it('changes bottom panel tab via onTabChange', () => {
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-bottom-tab'));
      expect(mocks.captured.bottomPanel?.activeTab).toBe('headers');
    });

    it('handles save to collection flow from history', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      const addItem = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{ collection: { id: 'c1', name: 'C' }, folders: [], items: [] }],
        loading: false,
        addItem,
        markItemExecuted: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-save-to-col-trigger'));
      expect(screen.getByTestId('gql-save-to-collection-mock')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('gql-save-collection-confirm'));
      expect(addItem).toHaveBeenCalled();
    });

    it('cancels save to collection modal', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      renderPage();
      fireEvent.click(screen.getByTestId('gql-save-to-col-trigger'));
      fireEvent.click(screen.getByTestId('gql-save-collection-cancel'));
      expect(screen.queryByTestId('gql-save-to-collection-mock')).not.toBeInTheDocument();
    });

    it('invokes collection panel action callbacks', () => {
      const handleRunCollection = vi.fn();
      const handleLoadCollectionItem = vi.fn();
      mocks.useGraphqlCollectionRun.mockReturnValue({ handleRunCollection });
      mocks.useGqlItemLoaders.mockReturnValue({
        handleLoadCollectionItem,
        handleOpenCollectionItem: vi.fn(),
        handleLoadHistoryItem: vi.fn(),
        handleRunHistoryItem: vi.fn(),
        handleEditInEditor: vi.fn(),
        handleBuilderExecute: vi.fn(),
      });
      mocks.loadPersistedActivityTab.mockReturnValue('collections');
      renderPage();
      fireEvent.click(screen.getByTestId('gql-run-item'));
      fireEvent.click(screen.getByTestId('gql-run-all'));
      fireEvent.click(screen.getByTestId('gql-load-item'));
      fireEvent.click(screen.getByTestId('gql-save-complete'));
      expect(handleRunCollection).toHaveBeenCalled();
      expect(handleLoadCollectionItem).toHaveBeenCalled();
    });

    it('calls prettify handler from editor button', () => {
      const handlePrettify = vi.fn();
      mocks.useGqlStudioEditorActions.mockReturnValue({
        editorMountRef: { current: null },
        prettifyError: false,
        insertToast: null,
        handlePrettify,
        handleInsertField: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-prettify-btn'));
      expect(handlePrettify).toHaveBeenCalled();
    });

    it('executes mutation operation type', () => {
      setupTabs({ operationType: 'mutation' });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ operationType: 'mutation' }));
    });

    it('saves history on error completion callback', async () => {
      const saveHistory = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupTabs({ selectedOperation: 'NamedOp', label: 'CustomLabel' });
      const response = { data: null, errors: [{ message: 'fail' }], httpStatus: 500, latencyMs: 10 };
      const execute = vi.fn((params: {
        onExecutionCompleted?: (tabId: string, status: 'error', resp: typeof response, apq: null) => void;
      }) => {
        params.onExecutionCompleted?.('tab-1', 'error', response, null);
      });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      await waitFor(() => expect(saveHistory).toHaveBeenCalled());
    });

    it('handles setGraphqlSchema throw gracefully', () => {
      mocks.setGraphqlSchema.mockImplementation(() => { throw new Error('schema fail'); });
      setupSchema({ rawIntrospection: { __schema: {} } });
      renderPage();
      expect(mocks.setGraphqlSchema).toHaveBeenCalled();
    });

    it('skips invalid items with empty query in invalidItemIds', () => {
      setupSchema({ rawIntrospection: { __schema: {} } });
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{
          collection: { id: 'c1', name: 'C' },
          folders: [],
          items: [{ id: 'empty', operation: { query: '   ' } }],
        }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      expect(mocks.gqlParseDoc).not.toHaveBeenCalled();
    });

    it('marks items invalid when parse throws', () => {
      setupSchema({ rawIntrospection: { __schema: {} } });
      mocks.gqlParseDoc.mockImplementation(() => { throw new Error('parse fail'); });
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{
          collection: { id: 'c1', name: 'C' },
          folders: [],
          items: [{ id: 'bad-parse', operation: { query: 'query { x }' } }],
        }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      expect(mocks.gqlParseDoc).toHaveBeenCalled();
    });

    it('does not disconnect subscription when still on subscription tab', () => {
      const disconnect = vi.fn();
      mocks.useGraphqlSubscription.mockReturnValue({
        state: 'active',
        messages: [],
        stats: {},
        connectedSince: Date.now(),
        isPaused: false,
        pausedBufferCount: 0,
        errorMessage: null,
        reconnectAttempt: 0,
        transport: 'auto',
        reset: vi.fn(),
        disconnect,
        pause: vi.fn(),
        resume: vi.fn(),
        clear: vi.fn(),
      });
      setupTabs({ operationType: 'subscription' });
      const { rerender } = renderPage();
      setupTabs({ operationType: 'subscription', id: 'tab-1' });
      rerender(<GraphqlStudioPage />);
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('uses endpoint as history connection id when historyConnectionId is null', async () => {
      const saveHistory = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupConnection({ historyConnectionId: null });
      const response = { data: { ok: true }, httpStatus: 200, latencyMs: 10 };
      const execute = vi.fn((params: {
        onExecutionCompleted?: (tabId: string, status: 'success', resp: typeof response, apq: null) => void;
      }) => {
        params.onExecutionCompleted?.('tab-1', 'success', response, null);
      });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      await waitFor(() => {
        expect(saveHistory).toHaveBeenCalledWith(expect.objectContaining({
          connectionId: 'https://api.example.com/graphql',
        }));
      });
    });

    it('hides right pane in builder mode', () => {
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mode-builder'));
      expect(screen.queryByTestId('gql-right-pane-mock')).not.toBeInTheDocument();
    });

    it('uploads multipart with invalid resolved variables JSON without throwing', () => {
      setupTabs({ variables: '{"key":"value"}' });
      mocks.resolveVars.mockImplementation((v: string) => {
        if (v.includes('key')) return '{bad-json';
        return v;
      });
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-set-files'));
      clickExecute();
      expect(mocks.buildMultipartFormData).toHaveBeenCalledWith('query { hello }', {}, expect.any(Array));
      expect(execute).toHaveBeenCalled();
    });

    it('calls onItemExecuted and swallows markItemExecuted errors', async () => {
      const markItemExecuted = vi.fn().mockRejectedValue(new Error('fail'));
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted,
      });
      renderPage();
      await act(async () => {
        (mocks.captured.collectionRunParams?.onItemExecuted as (id: string) => void)('item-1');
      });
      expect(markItemExecuted).toHaveBeenCalledWith('item-1');
    });

    it('forwards activity tab changes from item loaders', () => {
      renderPage();
      act(() => {
        (mocks.captured.gqlItemLoadersParams?.onSetActivityTab as (tab: string) => void)('collections');
      });
      expect(screen.getByTestId('gql-collections-mock')).toBeInTheDocument();
    });

    it('uses parsed operation name for history when query is named', async () => {
      const saveHistory = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupTabs({
        selectedOperation: null,
        label: 'My Saved Tab',
        query: 'query MySavedTab { hello }',
      });
      const response = { data: { ok: true }, httpStatus: 200, latencyMs: 10 };
      const execute = vi.fn((params: {
        onExecutionCompleted?: (tabId: string, status: 'success', resp: typeof response, apq: null) => void;
      }) => {
        params.onExecutionCompleted?.('tab-1', 'success', response, null);
      });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      await waitFor(() => {
        expect(saveHistory).toHaveBeenCalledWith(expect.objectContaining({
          operation: expect.objectContaining({ name: 'MySavedTab' }),
        }));
      });
    });

    it('falls back to tabs[0] headers when activeTabId is missing from tabs', () => {
      const tab = mocks.makeActiveTab({
        id: 'other-tab',
        headers: [{ key: 'X-Fallback', value: 'yes', enabled: true }],
      });
      mocks.useGqlStudioTabs.mockReturnValue({
        tabs: [tab],
        activeTabId: 'missing-id',
        activeTab: tab,
        operations: [],
        selectedOperation: undefined,
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef: mocks.executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
      });
      renderPage();
      expect(mocks.buildAuthHeaders).toHaveBeenCalled();
    });

    it('handles localStorage read failure for historyMaxItems', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (key === 'gql_history_max_items') throw new Error('quota');
        return null;
      });
      renderPage();
      expect(mocks.useGraphqlHistory).toHaveBeenCalledWith('https://api.example.com/graphql', 100);
      getItemSpy.mockRestore();
    });

    it('handles localStorage write failure in handleHistoryMaxItemsChange', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
        if (key === 'gql_history_max_items') throw new Error('quota');
      });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-history-max'));
      setItemSpy.mockRestore();
    });

    it('skips upload progress update when loaded is zero', () => {
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      fireEvent.click(screen.getByTestId('gql-mock-set-files'));
      clickExecute();
      const call = execute.mock.calls[0]?.[0] as { onUploadProgress?: (l: number, t: number) => void };
      mocks.tabExecutionStates.set('tab-1', { status: 'loading', response: null });
      setupExecution({ status: 'loading' });
      act(() => { call.onUploadProgress?.(0, 100); });
    });

    it('complexity gate send anyway skips when pending fn is null', () => {
      setupBatch({ complexityGatePending: true });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      mocks.pendingExecuteAfterGateRef.current = null;
      renderPage();
      fireEvent.click(screen.getByTestId('gql-gate-send'));
    });

    it('passes currentOperation from activeTab to collections when no save item', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('collections');
      setupTabs({ query: 'query { fromTab }', selectedOperation: 'FromTab' });
      renderPage();
      expect(mocks.captured.collections?.currentOperation).toEqual(expect.objectContaining({
        query: 'query { fromTab }',
        name: 'FromTab',
      }));
    });

    it('uses subscription label when selectedOperation is undefined in subscription log', () => {
      mocks.useGqlStudioTabs.mockReturnValue({
        tabs: [mocks.makeActiveTab({ operationType: 'subscription', label: 'SubLabel', selectedOperation: null })],
        activeTabId: 'tab-1',
        activeTab: mocks.makeActiveTab({ operationType: 'subscription', label: 'SubLabel', selectedOperation: null }),
        operations: [],
        selectedOperation: undefined,
        confirmingCloseTabId: null,
        closeActiveTabRef: { current: vi.fn() },
        executingRef: mocks.executingRef,
        addTab: vi.fn(),
        handleTabClick: vi.fn(),
        closeTab: vi.fn(),
        handleSelectOperation: vi.fn(),
        handleQueryChange: vi.fn(),
        handleVariablesChange: vi.fn(),
        handleHeadersChange: vi.fn(),
        handleAssertionsChange: vi.fn(),
        handleSubscriptionTransportChange: vi.fn(),
      });
      mocks.useGraphqlSubscription.mockReturnValue({
        state: 'active',
        messages: [],
        stats: {},
        connectedSince: 123,
        isPaused: false,
        pausedBufferCount: 0,
        errorMessage: null,
        reconnectAttempt: 0,
        transport: 'auto',
        reset: vi.fn(),
        disconnect: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        clear: vi.fn(),
      });
      renderPage();
      expect(mocks.captured.rightPane?.subscriptionLog).toEqual(expect.objectContaining({
        operationName: 'SubLabel',
      }));
    });

    it('hides left panel when activity tab is null', () => {
      renderPage();
      expect(screen.getByTestId('gql-studio-left-panel').className).toContain('gql-studio-left-panel--hidden');
    });

    it('shows builder title when schema is unavailable', () => {
      renderPage();
      expect(screen.getByTestId('gql-mode-builder')).toHaveAttribute('title', 'Introspect a schema to use the builder');
    });

    it('uses operationType as save modal default name fallback', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      renderPage();
      fireEvent.click(screen.getByTestId('gql-save-to-col-no-name'));
      expect(mocks.captured.saveToCollection?.defaultName).toBe('mutation');
    });

    it('uses Unnamed operation when save item has no name or operationType', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('history');
      renderPage();
      fireEvent.click(screen.getByTestId('gql-save-to-col-unnamed'));
      expect(mocks.captured.saveToCollection?.defaultName).toBe('Unnamed operation');
    });

    it('executes when complexity gate skip ref is set without opening gate modal', () => {
      mocks.computeQueryComplexity.mockReturnValue({
        score: 2000,
        level: 'danger',
        shouldBlock: false,
        threshold: 1000,
        fieldBreakdown: [],
      });
      setupSchema({ status: 'loaded', schemaInfo: { types: [{}] } });
      setupAdvSettings({ complexityBlockEnabled: true, complexityBlockThreshold: 1000 });
      setupBatch({ complexityGatePending: false });
      mocks.skipComplexityGateRef.current = true;
      const execute = vi.fn();
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(execute).toHaveBeenCalled();
      expect(mocks.skipComplexityGateRef.current).toBe(false);
    });

    it('passes default variables when active tab variables are undefined', () => {
      setupTabs({ variables: undefined });
      renderPage();
      expect(mocks.captured.bottomPanel?.defaultVarsValue).toBe('{\n  \n}');
    });

    it('passes null activeOperationType when tab operationType is undefined', () => {
      setupTabs({ operationType: undefined });
      renderPage();
      expect(mocks.captured.rightPane?.activeOperationType).toBeNull();
    });

    it('returns early from invalidItemIds when collection has no items', () => {
      setupSchema({ rawIntrospection: { __schema: {} } });
      mocks.useGraphqlCollections.mockReturnValue({
        trees: [{ collection: { id: 'c1', name: 'C' }, folders: [], items: [] }],
        loading: false,
        addItem: vi.fn(),
        markItemExecuted: vi.fn(),
      });
      renderPage();
      expect(mocks.buildClientSchema).not.toHaveBeenCalled();
    });

    it('shows bottom panel when runner tab set without collection id', () => {
      renderPage();
      act(() => {
        (mocks.captured.collectionRunParams?.onSetBottomTab as (tab: string) => void)('runner');
      });
      expect(screen.getByTestId('gql-bottom-panel-mock')).toBeInTheDocument();
    });

    it('does not save history when endpoint is empty', () => {
      const saveHistory = vi.fn().mockResolvedValue(undefined);
      mocks.useGraphqlHistory.mockReturnValue({
        items: [],
        recentItems: [],
        saveHistory,
        deleteItem: vi.fn(),
        clearAll: vi.fn(),
        search: vi.fn(() => []),
        loading: false,
      });
      setupConnection({ endpoint: '' });
      setupTabs({ query: 'query { x }' });
      const response = { data: { ok: true }, httpStatus: 200, latencyMs: 10 };
      const execute = vi.fn((params: {
        onExecutionCompleted?: (tabId: string, status: 'success', resp: typeof response, apq: null) => void;
      }) => {
        params.onExecutionCompleted?.('tab-1', 'success', response, null);
      });
      setupExecution({ execute });
      renderPage();
      clickExecute();
      expect(saveHistory).not.toHaveBeenCalled();
    });

    it('passes saveToColItem operation to collections currentOperation', () => {
      mocks.loadPersistedActivityTab.mockReturnValue('collections');
      renderPage();
      fireEvent.click(screen.getByTestId('activity-history'));
      fireEvent.click(screen.getByTestId('gql-save-to-col-trigger'));
      fireEvent.click(screen.getByTestId('activity-collections'));
      expect(mocks.captured.collections?.currentOperation).toEqual(expect.objectContaining({
        name: 'HistOp',
      }));
    });
  });
});
