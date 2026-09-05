/**
 * @vitest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useApiMockServerList } from './ApiMockServerListBridge';

import { proxiedExchangeToDraft, toRecordedDraft, draftFingerprint } from '@shared/api-mock/proxyRecording';
import * as apiMockJournalActions from './apiMockJournalActions';
import { API_MOCK_WORKSPACE_CHANGED_EVENT } from './apiMockGalleryImport';

const ts = '2026-08-12T00:00:00.000Z';

function ReorderProbe() {
  const state = useApiMockServerList();
  return (
    <>
      <button data-testid="reorder-missing" onClick={() => state?.onReorder('missing', 'also-missing')} />
      <button data-testid="reorder-same" onClick={() => state?.onReorder('srv-a', 'srv-a')} />
    </>
  );
}

function makeServer(id = 'srv-1', method = 'GET') {
  return {
    id,
    name: `Mock Server ${id}`,
    enabled: true,
    host: '127.0.0.1',
    port: 4600,
    basePath: '',
    folders: [],
    routes: [{
      id: 'route-1',
      name: 'Users route',
      enabled: true,
      method,
      path: { kind: 'exact', value: '/users' },
      priority: 10,
      predicates: { id: 'pg', combinator: 'all', children: [] },
      responseMode: 'rules',
      responses: [{ id: 'resp-1', name: '200 Default', enabled: true, isDefault: true, status: 200, headers: [], cookies: [], body: { kind: 'none', content: '' }, behavior: { delayMs: 0, jitterMs: 0 } }],
      tags: [],
      createdAt: ts,
      updatedAt: ts,
    }],
    samples: [],
    variables: [],
    settings: {
      selection: { multipleMatchPolicy: 'highest_priority', equalPriorityPolicy: 'reject', ambiguityResponse: { status: 409, headers: [], body: '{}', contentType: 'application/json' } },
      fallback: { unmatchedResponse: { status: 404, headers: [], body: '{}', contentType: 'application/json' }, mode: 'default_response' },
      cors: { enabled: false, allowOrigins: ['*'], allowMethods: ['GET'], allowHeaders: ['Content-Type'], allowCredentials: false, maxAge: 0, exposeHeaders: [] },
      limits: { maxInboundBodyBytes: 1024, maxResponseBodyBytes: 1024, maxConcurrentConnections: 10, maxDelayMs: 0, longRunningEnabled: false, longRunningMaxMs: 0, gracefulDrainMs: 0 },
      journal: { enabled: true, maxEntries: 10, maxCapturedBodyBytes: 1024, persistToDisk: false },
      redaction: { headerNames: [], jsonPaths: [], preserveScheme: true },
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

const loadApiMockWorkspace = vi.fn();
const saveApiMockWorkspace = vi.fn();
const start = vi.fn();
const stop = vi.fn();
const restart = vi.fn();
const commit = vi.fn();
const transactions = vi.fn();
const clearTransactions = vi.fn();
const state = vi.fn();
const resetState = vi.fn();
const recordedDrafts = vi.fn();
const ackRecordedDrafts = vi.fn();
const nextAutoPort = vi.fn(async (exclude: number[] = []) => {
  for (let port = 4600; port <= 4699; port++) {
    if (!exclude.includes(port)) return { ok: true as const, data: { port } };
  }
  return {
    ok: false as const,
    error: { code: 'NO_PORT_AVAILABLE', message: 'No available port in 4600-4699', retry: false },
  };
});
const analyzeConflicts = vi.fn();
const clearConsole = vi.fn();

vi.mock('./apiMockJournalActions', () => ({
  dispatchOpenInRequests: vi.fn(),
  copyTransactionToClipboard: vi.fn(() => Promise.resolve(true)),
  capturedRequestPath: vi.fn((req: { rawPath?: string; path?: string; query?: Record<string, string | string[]> }) => {
    const raw = req.rawPath || req.path || '/';
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    if (path.includes('?')) return path;
    const parts = Object.entries(req.query ?? {}).flatMap(([name, value]) => (
      (Array.isArray(value) ? value : [value]).map(v => `${name}=${v}`)
    ));
    return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
  }),
  transactionToOpenInRequestsDetail: vi.fn(() => ({ url: 'http://localhost/users' })),
  sampleToOpenInRequestsDetail: vi.fn(() => ({ url: 'http://localhost/users', method: 'GET', name: 'example', headers: [], body: '' })),
  transactionToSample: vi.fn((tx: any, opts?: { routeId?: string; name?: string }) => ({
    id: `sample-${tx?.id ?? 'from-tx'}`,
    name: opts?.name ?? 'GET /users',
    routeId: opts?.routeId,
    request: { method: 'GET', path: '/users', rawPath: '/users', query: {}, headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: ts },
    expected: { outcome: 'matched', status: 200 },
  })),
  transactionToRouteDraft: vi.fn(() => ({
    id: 'route-from-tx',
    name: 'From journal',
    enabled: false,
    method: 'POST',
    path: { kind: 'exact', value: '/orders' },
    priority: 10,
    predicates: { id: 'pg', combinator: 'all', children: [] },
    responseMode: 'rules',
    responses: [{ id: 'resp-1', name: '200', enabled: true, isDefault: true, status: 200, headers: [], cookies: [], body: { kind: 'none', content: '' }, behavior: { delayMs: 0, jitterMs: 0 } }],
    tags: [],
    createdAt: ts,
    updatedAt: ts,
  })),
}));
const isApiMockDemoPersistenceActive = vi.fn(() => false);
const rememberApiMockDemoImportedServer = vi.fn();
vi.mock('./apiMockPersistence', () => ({
  loadApiMockWorkspace: (...args: unknown[]) => loadApiMockWorkspace(...args),
  saveApiMockWorkspace: (...args: unknown[]) => saveApiMockWorkspace(...args),
  publishApiMockWorkspace: vi.fn(),
  publishApiMockRuntimeChanged: vi.fn(),
  isApiMockDemoPersistenceActive: () => isApiMockDemoPersistenceActive(),
  rememberApiMockDemoImportedServer: (...args: unknown[]) => rememberApiMockDemoImportedServer(...args),
}));
vi.mock('./apiMockControlClient', () => ({
  apiMockControlClient: {
    start: (...args: unknown[]) => start(...args),
    stop: (...args: unknown[]) => stop(...args),
    restart: (...args: unknown[]) => restart(...args),
    commit: (...args: unknown[]) => commit(...args),
    transactions: (...args: unknown[]) => transactions(...args),
    clearTransactions: (...args: unknown[]) => clearTransactions(...args),
    state: (...args: unknown[]) => state(...args),
    resetState: (...args: unknown[]) => resetState(...args),
    recordedDrafts: (...args: unknown[]) => recordedDrafts(...args),
    ackRecordedDrafts: (...args: unknown[]) => ackRecordedDrafts(...args),
    nextAutoPort: (...args: unknown[]) => nextAutoPort(...args),
    list: async () => ({ ok: true, data: [] }),
    status: async () => ({ ok: true, data: { state: 'stopped', generation: 0 } }),
  },
}));
vi.mock('./useApiMockConsole', () => ({
  useApiMockConsole: () => ({ lines: [{ ts, level: 'info', message: 'Started' }], clear: clearConsole }),
}));
vi.mock('../../shared/api-mock/conflictAnalyzer', () => ({
  analyzeConflicts: (...args: unknown[]) => analyzeConflicts(...args),
}));
vi.mock('../../app/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: (_message: string, onConfirm: () => void) => onConfirm(),
    confirmDialogElement: <div data-testid="mock-confirm" />,
  }),
}));
vi.mock('./components/ApiMockServerTabs', () => ({
  API_MOCK_WORKSPACE_PANEL_ID: 'api-mock-workspace-panel',
}));
vi.mock('./components/ApiMockStudioTitleBar', () => ({
  ApiMockStudioTitleBar: ({ servers, onCreate, onClose, onCloseMany, onDelete, onSelect, onRename, onDuplicate, onReorder, statusById, dirtyById }: any) => (
    <div data-testid="mock-titlebar">
      <div data-testid="mock-server-tabs">
        {servers[0] && <button data-testid="mock-delete-server" onClick={() => onDelete?.(servers[0].id)}>delete-server</button>}
        <button data-testid="mock-create-server" onClick={onCreate}>create-server</button>
        {servers.map((s: any) => (
          <button key={s.id} data-testid={`mock-select-${s.id}`} onClick={() => onSelect(s.id)}>
            {s.id}:{statusById?.[s.id] ?? 'stopped'}:{dirtyById?.[s.id] ? 'dirty' : 'clean'}
          </button>
        ))}
        {servers[0] && <button data-testid="mock-rename-server" onClick={() => onRename?.(servers[0].id, 'Renamed')}>rename</button>}
        {servers[0] && <button data-testid="mock-rename-empty" onClick={() => onRename?.(servers[0].id, '  ')}>rename-empty</button>}
        {servers[0] && <button data-testid="mock-duplicate-server" onClick={() => onDuplicate?.(servers[0].id)}>duplicate</button>}
        <button data-testid="mock-duplicate-missing" onClick={() => onDuplicate?.('missing-server')}>duplicate-missing</button>
        <button data-testid="mock-reorder-servers" onClick={() => onReorder?.(0, 1)}>reorder</button>
        {servers[0] && <button data-testid="mock-close-server" onClick={() => onClose(servers[0].id)}>close-server</button>}
        <button data-testid="mock-close-missing-server" onClick={() => onClose('missing-server')}>close-missing-server</button>
        {servers.length > 1 && (
          <button
            data-testid="mock-close-others"
            onClick={() => onCloseMany?.(servers.slice(1).map((s: { id: string }) => s.id))}
          >
            close-others
          </button>
        )}
      </div>
    </div>
  ),
}));
// Import/Export live on the workspace nav, not the title bar.
vi.mock('./components/ApiMockWorkspaceNav', () => ({
  ApiMockWorkspaceNav: ({ onChange, onImport, onExport }: any) => (
    <div data-testid="mock-workspace-nav">
      {['studio', 'runtime', 'conflicts'].map(id => (
        <button key={id} data-testid={`api-mock-view-${id}`} onClick={() => onChange(id)}>{id}</button>
      ))}
      <button data-testid="mock-import-open" onClick={() => onImport('curl')}>import</button>
      <button data-testid="api-mock-export" onClick={() => onExport({ scope: 'workspace', format: 'json' })}>export</button>
      <button data-testid="api-mock-export-routes" onClick={() => onExport({ scope: 'routes', format: 'json' })}>export-routes</button>
      <button data-testid="api-mock-export-servers" onClick={() => onExport({ scope: 'servers', format: 'json' })}>export-servers</button>
      <button data-testid="api-mock-export-wiremock" onClick={() => onExport({ scope: 'routes', format: 'wiremock' })}>export-wiremock</button>
      <button data-testid="api-mock-export-har" onClick={() => onExport({ scope: 'servers', format: 'har' })}>export-har</button>
      <button data-testid="api-mock-export-yaml" onClick={() => onExport({ scope: 'servers', format: 'yaml' })}>export-yaml</button>
    </div>
  ),
}));
vi.mock('./components/ApiMockServerBar', () => ({
  ApiMockServerBar: ({ status, dirty, generation, error, onUpdate, onStart, onStop, onApply, onRestart, onSettings, onOpenRoutes }: any) => (
    <div data-testid="mock-server-bar">
      <div data-testid="mock-server-status">{status}:{dirty ? 'dirty' : 'clean'}:{generation}:{error ?? ''}</div>
      <button data-testid="mock-server-update" onClick={() => onUpdate({ name: 'Updated server' })}>update-server</button>
      <button data-testid="mock-start" onClick={onStart}>start</button>
      <button data-testid="mock-stop" onClick={onStop}>stop</button>
      <button data-testid="mock-apply" onClick={onApply}>apply</button>
      <button data-testid="mock-restart" onClick={onRestart}>restart</button>
      <button data-testid="mock-settings" onClick={onSettings}>settings</button>
      <button data-testid="mock-open-routes" onClick={onOpenRoutes}>open-routes</button>
    </div>
  ),
}));
vi.mock('./components/ApiMockRouteExplorer', () => ({
  ApiMockRouteExplorer: ({ routes, folders, selectedRouteId, onSelect, onCreate, onDelete, onToggle, onAnalyze, onAddFolder, onToggleFolder, onMoveRoute, onRenameFolder, onDeleteFolder, conflictRouteIds, drawerOpen, onCloseDrawer }: any) => (
    <div data-testid="mock-route-explorer">
      <button data-testid="mock-create-route" onClick={() => onCreate()}>create-route</button>
      <button data-testid="mock-create-route-folder" onClick={() => onCreate('fld-1')}>create-route-folder</button>
      <button data-testid="mock-analyze" onClick={onAnalyze}>analyze</button>
      <button data-testid="mock-add-folder" onClick={onAddFolder}>add-folder</button>
      {drawerOpen && onCloseDrawer && <button data-testid="mock-close-drawer" onClick={onCloseDrawer}>close-drawer</button>}
      {folders?.[0] && <button data-testid="mock-toggle-folder" onClick={() => onToggleFolder(folders[0].id)}>toggle-folder</button>}
      {folders?.[0] && <button data-testid="mock-rename-folder" onClick={() => onRenameFolder(folders[0].id, 'Renamed folder')}>rename-folder</button>}
      {folders?.[0] && <button data-testid="mock-delete-folder" onClick={() => onDeleteFolder(folders[0].id)}>delete-folder</button>}
      <button data-testid="mock-delete-missing-folder" onClick={() => onDeleteFolder('missing-folder')}>delete-missing-folder</button>
      {routes[0] && <>
        <button data-testid="mock-select-route" onClick={() => onSelect(routes[0].id)}>{selectedRouteId ?? 'none'}</button>
        <button data-testid="mock-delete-route" onClick={() => onDelete(routes[0].id)}>delete-route</button>
        <button data-testid="mock-toggle-route" onClick={() => onToggle(routes[0].id, !routes[0].enabled)}>toggle-route</button>
        <button data-testid="mock-move-route" onClick={() => onMoveRoute(routes[0].id, 'fld-1')}>move-route</button>
        <button data-testid="mock-move-route-ungrouped" onClick={() => onMoveRoute(routes[0].id, undefined)}>move-ungrouped</button>
      </>}
      <button data-testid="mock-delete-missing-route" onClick={() => onDelete('missing-route')}>delete-missing</button>
      {routes[1] && <>
        <button data-testid="mock-select-route-2" onClick={() => onSelect(routes[1].id)}>select-route-2</button>
        <button data-testid="mock-delete-route-2" onClick={() => onDelete(routes[1].id)}>delete-route-2</button>
      </>}
      <div data-testid="mock-conflicts">{(conflictRouteIds ?? []).join(',')}</div>
    </div>
  ),
}));
vi.mock('./components/ApiMockRouteEditor', () => ({
  ApiMockRouteEditor: ({ route, hasConflict, folderName, onUpdate, onSimulate, onReviewConflicts, onUpdateSample, onDeleteSample, onTrySampleInRequests }: any) => (
    <div data-testid="mock-route-editor">
      <div data-testid="mock-route-editor-conflict">{hasConflict ? 'conflict' : 'clear'}</div>
      <div data-testid="mock-route-folder-name">{folderName ?? ''}</div>
      <button data-testid="mock-route-update" onClick={() => onUpdate({ name: `${route.name} updated` })}>update-route</button>
      <button data-testid="mock-route-simulate" onClick={() => onSimulate()}>simulate-route</button>
      <button data-testid="mock-route-simulate-sample" onClick={() => onSimulate({
        id: 's1',
        name: 'ex',
        request: {
          method: 'ANY', path: 'users', rawPath: '', query: { q: '1' },
          headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: '',
        },
      })}>simulate-sample</button>
      <button data-testid="mock-route-simulate-sample-post" onClick={() => onSimulate({
        id: 's2',
        name: 'ex-post',
        request: {
          method: 'POST', path: '/users', rawPath: '/users', query: {},
          headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: '',
        },
      })}>simulate-sample-post</button>
      <button data-testid="mock-route-review-conflicts" onClick={onReviewConflicts}>review-conflicts</button>
      <button data-testid="mock-sample-update" onClick={() => onUpdateSample?.({ id: 's1', name: 'Updated', request: { method: 'GET', path: '/', rawPath: '/', query: {}, headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: '' } })}>update-sample</button>
      <button data-testid="mock-sample-update-hit" onClick={() => onUpdateSample?.({ id: 'sample-tx-4', name: 'Updated hit', request: { method: 'GET', path: '/', rawPath: '/', query: {}, headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: '' } })}>update-sample-hit</button>
      <button data-testid="mock-sample-delete" onClick={() => onDeleteSample?.('s1')}>delete-sample</button>
      <button data-testid="mock-sample-try" onClick={() => onTrySampleInRequests?.({ id: 's1', name: 'Try', request: { method: 'GET', path: '/users', rawPath: '/users', query: {}, headers: {}, cookies: {}, body: '', bodyTruncated: false, receivedAt: '' } })}>try-sample</button>
    </div>
  ),
}));
vi.mock('./components/ApiMockDock', () => ({
  ApiMockDock: ({ conflictCount, transactions, running, liveState, onResetState, onClearTransactions, consoleLines, onClearConsole, onRequestedTabConsumed, onSimulateWitness, onOpenConflicts, onServerPatch, onAcknowledgeConflict, onAdjustPriority, onOpenInRequests, onCreateRouteFromTransaction, onSaveSampleFromTransaction, onCopyTransaction, onSelectRoute, onVariablesChange }: any) => (
    <div data-testid="mock-dock">
      <div data-testid="mock-dock-meta">{conflictCount}:{transactions.length}:{running ? 'running' : 'stopped'}:{Object.keys(liveState ?? {}).length}:{consoleLines.length}</div>
      <button data-testid="mock-reset-state" onClick={onResetState}>reset-state</button>
      <button data-testid="mock-clear-transactions" onClick={onClearTransactions}>clear-transactions</button>
      <button data-testid="mock-clear-console" onClick={onClearConsole}>clear-console</button>
      <button data-testid="mock-dock-consumed" onClick={onRequestedTabConsumed}>consume-requested-tab</button>
      <button data-testid="mock-dock-simulate" onClick={onSimulateWitness}>simulate-witness</button>
      <button data-testid="mock-dock-open-conflicts" onClick={onOpenConflicts}>open-conflicts</button>
      <button data-testid="mock-dock-server-patch" onClick={() => onServerPatch?.({ name: 'Patched via runtime' })}>server-patch</button>
      <button data-testid="mock-dock-ack" onClick={() => onAcknowledgeConflict?.({ id: 'f1', ruleIds: ['route-1'], acknowledgedAt: undefined, acknowledgementStale: true })}>ack-conflict</button>
      <button data-testid="mock-dock-ack-clean" onClick={() => onAcknowledgeConflict?.({ id: 'f2', ruleIds: ['route-1'], acknowledgedAt: undefined, acknowledgementStale: false })}>ack-conflict-clean</button>
      <button data-testid="mock-dock-priority" onClick={() => onAdjustPriority?.('route-1', 5)}>adjust-priority</button>
      <button data-testid="mock-dock-open-requests" onClick={() => onOpenInRequests?.({ id: 'tx-1', request: { method: 'GET', path: '/users' } })}>open-requests</button>
      <button data-testid="mock-dock-create-route" onClick={() => onCreateRouteFromTransaction?.({ id: 'tx-2', request: { method: 'POST', path: '/orders' } })}>create-from-tx</button>
      <button data-testid="mock-dock-save-example" onClick={() => onSaveSampleFromTransaction?.({ id: 'tx-4', matchedRouteId: 'route-1', request: { method: 'GET', path: '/users' }, outcome: 'matched' })}>save-example</button>
      <button data-testid="mock-dock-save-example-unassociated" onClick={() => onSaveSampleFromTransaction?.({ id: 'tx-5', request: { method: 'GET', path: '/orphan' }, outcome: 'unmatched' })}>save-unassociated</button>
      <button data-testid="mock-dock-copy-tx" onClick={() => onCopyTransaction?.({ id: 'tx-3', request: { method: 'GET', path: '/x' } })}>copy-tx</button>
      <button data-testid="mock-dock-select-route" onClick={() => onSelectRoute?.('route-1')}>select-route-from-dock</button>
      <button data-testid="mock-dock-variables" onClick={() => onVariablesChange?.([{ id: 'v2', key: 'k', value: 'v', sensitive: false }])}>change-variables</button>
    </div>
  ),
}));
vi.mock('./components/ApiMockConflictInspector', () => ({
  ApiMockConflictInspector: ({ findings, onSimulateWitness, onAcknowledge, onAdjustPriority, onAnalyze, onOpenStudio, onApply, onSelectRoute }: any) => (
    <div data-testid="mock-conflict-inspector">
      <button data-testid="mock-conflicts-simulate" onClick={() => onSimulateWitness?.({ id: 'f1', witnessRequest: { method: 'ANY', rawPath: '/raw-witness', path: '/witness' } })}>simulate-witness</button>
      <button data-testid="mock-conflicts-simulate-path" onClick={() => onSimulateWitness?.({ id: 'f2', witnessRequest: { method: 'POST', path: '/path-only', query: { q: '1' } } })}>simulate-path</button>
      <button data-testid="mock-conflicts-simulate-empty" onClick={() => onSimulateWitness?.({ id: 'f3', witnessRequest: { method: 'GET' } })}>simulate-empty</button>
      <button data-testid="mock-conflicts-ack" onClick={() => onAcknowledge?.(findings?.[0] ?? { id: 'f1', acknowledgementStale: false })}>ack</button>
      <button data-testid="mock-conflicts-priority" onClick={() => onAdjustPriority?.('route-1', -1)}>priority</button>
      <button data-testid="mock-conflicts-analyze-inner" onClick={onAnalyze}>analyze-inner</button>
      <button data-testid="mock-conflicts-studio" onClick={onOpenStudio}>open-studio</button>
      <button data-testid="mock-conflicts-apply" onClick={onApply}>apply-conflicts</button>
      <button data-testid="mock-conflicts-select-route" onClick={() => onSelectRoute?.('route-1')}>select-route</button>
    </div>
  ),
  conflictPeerLabel: () => undefined,
}));
vi.mock('./components/ApiMockServerSettingsModal', () => ({
  ApiMockServerSettingsModal: ({ statusLabel, onSave, onClose }: any) => (
    <div data-testid="mock-settings-modal">
      <div data-testid="mock-settings-status">{statusLabel}</div>
      <button data-testid="mock-settings-save" onClick={() => onSave({ name: 'Saved server' })}>save-settings</button>
      <button data-testid="mock-settings-close" onClick={onClose}>close-settings</button>
    </div>
  ),
}));
vi.mock('./components/ApiMockSimulateModal', () => ({
  ApiMockSimulateModal: ({ initialPath, initialMethod, onClose, onSaveSample }: any) => (
    <div data-testid="mock-simulate-modal">
      {initialMethod}:{initialPath}
      <button data-testid="mock-simulate-close" onClick={onClose}>close-simulate</button>
      <button
        data-testid="mock-simulate-save-sample"
        onClick={() => onSaveSample?.({
          id: 'sample-new',
          name: 'GET /health',
          request: {
            method: 'GET', path: '/health', rawPath: '/health', query: {},
            headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: '2026-08-13T00:00:00.000Z',
          },
        })}
      >save-sample</button>
    </div>
  ),
}));
vi.mock('./components/ApiMockImportReview', () => ({
  ApiMockImportReview: ({ onImport, onCancel }: any) => (
    <div data-testid="mock-import-review">
      <button data-testid="mock-import-zero" onClick={() => onImport([], { mode: 'merge' })}>import-zero</button>
      <button data-testid="mock-import-one" onClick={() => onImport([{ ...makeServer('tmp').routes[0], id: 'route-2', name: 'Imported route' }], { mode: 'merge' })}>import-one</button>
      <button data-testid="mock-import-copy" onClick={() => onImport([{ ...makeServer('tmp').routes[0], id: 'route-copy', name: 'Copy route' }], { mode: 'copy', newFolderName: 'Imported folder' })}>import-copy</button>
      <button data-testid="mock-import-replace" onClick={() => onImport([{ ...makeServer('tmp').routes[0], id: 'route-rep', name: 'Replace route' }], { mode: 'replace' })}>import-replace</button>
      <button data-testid="mock-import-cancel" onClick={onCancel}>cancel-import</button>
    </div>
  ),
}));
vi.mock('../../shared/components/AppModalFrame', () => ({
  default: ({ children, onClose, title }: any) => <div data-testid="mock-modal-frame">{title}<button data-testid="mock-modal-close" onClick={onClose}>x</button>{children}</div>,
}));

describe('ApiMockStudioPage orchestration coverage', () => {
  beforeEach(() => {
    loadApiMockWorkspace.mockResolvedValue({ servers: [makeServer()], activeServerId: 'srv-1' });
    saveApiMockWorkspace.mockResolvedValue(undefined);
    start.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 1 } });
    stop.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'stopped', generation: 1 } });
    restart.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 2 } });
    commit.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 2 } });
    transactions.mockResolvedValue({ ok: true, data: { transactions: [{ id: 'tx-1' }], cursor: 0, total: 1, capped: false } });
    clearTransactions.mockResolvedValue({ ok: true, data: { cleared: true } });
    state.mockResolvedValue({ ok: true, data: { states: {}, counters: {} } });
    resetState.mockResolvedValue({ ok: true, data: { reset: true } });
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [], total: 0 } });
    ackRecordedDrafts.mockResolvedValue({ ok: true, data: { removed: 0 } });
    nextAutoPort.mockImplementation(async (exclude: number[] = []) => {
      for (let port = 4600; port <= 4699; port++) {
        if (!exclude.includes(port)) return { ok: true as const, data: { port } };
      }
      return {
        ok: false as const,
        error: { code: 'NO_PORT_AVAILABLE', message: 'No available port in 4600-4699', retry: false },
      };
    });
    analyzeConflicts.mockResolvedValue({ findings: [{ id: 'f1', ruleIds: ['route-1', 'route-2'] }] });
  });

  afterEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('covers create/select/update/import/settings/simulate/delete and close-server flows', async () => {
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    const { default: ApiMockSidebar } = await import('./components/ApiMockSidebar');
    render(<><ApiMockStudioPage /><ApiMockSidebar /></>);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-route-update'));
    fireEvent.click(screen.getByTestId('mock-sample-update'));
    fireEvent.click(screen.getByTestId('mock-sample-delete'));
    fireEvent.click(screen.getByTestId('mock-sample-try'));
    fireEvent.click(screen.getByTestId('mock-rename-server'));
    fireEvent.click(screen.getByTestId('mock-rename-empty'));
    fireEvent.click(screen.getByTestId('mock-duplicate-missing'));
    fireEvent.click(screen.getByTestId('mock-route-simulate-sample'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('GET:/users?q=1');
    fireEvent.click(screen.getByTestId('mock-simulate-close'));
    fireEvent.click(screen.getByTestId('mock-route-simulate'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('GET:/users');
    fireEvent.click(screen.getByTestId('mock-simulate-save-sample'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Saved sample/);
    fireEvent.click(screen.getByTestId('mock-simulate-close'));

    fireEvent.click(screen.getByTestId('mock-add-folder'));
    fireEvent.click(screen.getByTestId('mock-toggle-folder'));
    fireEvent.click(screen.getByTestId('mock-toggle-folder'));

    fireEvent.click(screen.getByTestId('mock-server-update'));
    fireEvent.click(screen.getByTestId('mock-settings'));
    expect(screen.getByTestId('mock-settings-status')).toHaveTextContent('Stopped');
    fireEvent.click(screen.getByTestId('mock-settings-save'));

    fireEvent.click(screen.getByTestId('mock-import-open'));
    fireEvent.click(screen.getByTestId('mock-import-zero'));
    fireEvent.click(screen.getByTestId('mock-import-one'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Imported 1 route/i);

    fireEvent.click(screen.getByTestId('mock-delete-route'));
    // A rule remains (the imported one), so the editor stays populated rather
    // than falling back to the empty selection state.
    expect(screen.getByTestId('mock-route-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mock-delete-route'));
    expect(screen.getByTestId('api-mock-no-route')).toBeTruthy();

    // Closing the last tab parks the server: the landing lists it instead of
    // falling back to the first-run empty state.
    fireEvent.click(screen.getByTestId('mock-close-server'));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-1'));
    await waitFor(() => expect(screen.getByTestId('api-mock-library-landing')).toBeTruthy());
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/still saved in Saved servers/i);
    const parkedItem = await waitFor(() => {
      const item = screen.getByTestId('api-mock-sidebar-item-srv-1');
      expect(item).toHaveClass('am-sidebar-item-parked');
      return item;
    });

    fireEvent.click(parkedItem.querySelector('.am-sidebar-item-btn') ?? parkedItem);
    await waitFor(() => {
      expect(screen.getByTestId('mock-select-srv-1')).toBeTruthy();
      expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/opened from Saved servers/i);
    });

    fireEvent.click(screen.getByTestId('mock-create-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/created on port 4601/i));
  }, 30000);

  it('covers duplicate, library reorder, demo naming, and no-port failures', async () => {
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-duplicate-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/duplicated on port 4601/i));

    fireEvent.click(screen.getByTestId('mock-reorder-servers'));
    fireEvent.click(screen.getByTestId('mock-duplicate-missing'));

    isApiMockDemoPersistenceActive.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('mock-create-server'));
    await waitFor(() => expect(rememberApiMockDemoImportedServer).toHaveBeenCalled());

    nextAutoPort.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NO_PORT_AVAILABLE', message: 'No port', retry: false },
    });
    fireEvent.click(screen.getByTestId('mock-create-server'));
    await waitFor(() => expect(nextAutoPort).toHaveBeenCalled());
  });

  it('reorders the persisted library through the sidebar drag callback', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer('srv-a'), makeServer('srv-b')],
      activeServerId: 'srv-a',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    const { default: ApiMockSidebar } = await import('./components/ApiMockSidebar');
    render(<><ApiMockStudioPage /><ApiMockSidebar /><ReorderProbe /></>);
    await waitFor(() => expect(screen.getByTestId('api-mock-sidebar-item-srv-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('reorder-missing'));
    fireEvent.click(screen.getByTestId('reorder-same'));

    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId('api-mock-sidebar-item-srv-a'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('api-mock-sidebar-item-srv-b'), { dataTransfer });

    await waitFor(() => {
      const list = screen.getByTestId('api-mock-sidebar-list');
      expect(list.firstElementChild?.getAttribute('data-testid')).toBe('api-mock-sidebar-item-srv-b');
    });
  });

  it('announces moving a library server into and out of a folder', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer('srv-a'), { ...makeServer('srv-b'), serverFolder: 'Prod' }],
      activeServerId: 'srv-a',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    const { default: ApiMockSidebar } = await import('./components/ApiMockSidebar');
    render(<><ApiMockStudioPage /><ApiMockSidebar /></>);
    await waitFor(() => expect(screen.getByTestId('api-mock-sidebar-item-srv-a')).toBeTruthy());

    fireEvent.contextMenu(screen.getByTestId('api-mock-sidebar-item-srv-a'));
    fireEvent.click(screen.getByTestId('api-mock-sidebar-ctx-move-folder'));
    fireEvent.click(screen.getByTestId('api-mock-sidebar-move-to-Prod'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Moved to "Prod"/));

    fireEvent.contextMenu(screen.getByTestId('api-mock-sidebar-item-srv-a'));
    fireEvent.click(screen.getByTestId('api-mock-sidebar-ctx-move-folder'));
    fireEvent.click(screen.getByTestId('api-mock-sidebar-move-no-folder'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Removed from folder/));
  });

  it('hydrates from workspace-changed events and ignores empty details', async () => {
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-server-update'));
    window.dispatchEvent(new CustomEvent(API_MOCK_WORKSPACE_CHANGED_EVENT));
    window.dispatchEvent(new CustomEvent(API_MOCK_WORKSPACE_CHANGED_EVENT, {
      detail: { servers: [makeServer('srv-event')], activeServerId: 'srv-event' },
    }));

    await waitFor(() => expect(screen.getByTestId('mock-select-srv-event')).toBeTruthy());
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Gallery mock server imported/i);

    act(() => {
      window.dispatchEvent(new CustomEvent(API_MOCK_WORKSPACE_CHANGED_EVENT, {
        detail: { servers: [], activeServerId: undefined, openTabIds: [] },
      }));
    });
    await waitFor(() => expect(screen.queryByTestId('mock-select-srv-event')).toBeNull());
    expect(screen.getByTestId('api-mock-library-landing')).toBeTruthy();
  });

  it('covers runtime success and failure branches, polling, dirty status, and dock actions', async () => {
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    await waitFor(() => expect(transactions).toHaveBeenCalledWith('srv-1'));
    expect(screen.getByTestId('mock-server-tabs').textContent).toContain('running');

    fireEvent.click(screen.getByTestId('api-mock-open-runtime'));
    expect(screen.getByTestId('mock-dock-meta').textContent).toContain('0:1:running:2:1');

    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-toggle-route'));
    fireEvent.click(screen.getByTestId('mock-route-update'));
    expect(screen.getByTestId('mock-server-tabs').textContent).toContain('dirty');

    fireEvent.click(screen.getByTestId('mock-apply'));
    await waitFor(() => expect(commit).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('mock-restart'));
    await waitFor(() => expect(restart).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('mock-analyze'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());
    expect(screen.getByTestId('api-mock-conflicts-page')).toBeTruthy();
    expect(screen.getByTestId('mock-conflict-inspector')).toBeTruthy();

    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-clear-transactions'));
    await waitFor(() => expect(clearTransactions).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mock-reset-state'));
    await waitFor(() => expect(resetState).toHaveBeenCalled());
    state.mockResolvedValueOnce({ ok: false, error: { title: 'x', message: 'x', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    fireEvent.click(screen.getByTestId('mock-reset-state'));
    await waitFor(() => expect(resetState).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('mock-clear-console'));
    expect(clearConsole).toHaveBeenCalled();

    stop.mockResolvedValueOnce({ ok: false, error: { title: 'Runtime error', message: 'bad stop', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    fireEvent.click(screen.getByTestId('mock-stop'));
    await waitFor(() => expect(screen.getByTestId('mock-server-status')).toHaveTextContent('Runtime error: bad stop'));

    start.mockResolvedValueOnce({ ok: false, error: { title: 'Companion unavailable', message: 'down', code: 'COMPANION_UNAVAILABLE', recoverable: true, retry: true } });
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Companion unavailable/i));

    commit.mockResolvedValueOnce({ ok: false, error: { title: 'Invalid definition', message: 'bad draft', code: 'MOCK_VALIDATION_ERROR', recoverable: true, retry: false } });
    fireEvent.click(screen.getByTestId('mock-apply'));
    await waitFor(() => expect(screen.getByTestId('mock-server-status')).toHaveTextContent('Invalid definition: bad draft'));

    restart.mockResolvedValueOnce({ ok: false, error: { title: 'Port already in use', message: 'in use', code: 'MOCK_PORT_IN_USE', recoverable: true, retry: false } });
    fireEvent.click(screen.getByTestId('mock-restart'));
    await waitFor(() => expect(screen.getByTestId('mock-server-status')).toHaveTextContent('Port already in use: in use'));
  });

  it('covers folder/sample/runtime edge branches and port-owned start with existing owner', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [
        { ...makeServer('srv-1'), samples: undefined },
        makeServer('srv-2', 'POST'),
      ],
      activeServerId: 'srv-1',
    });
    start.mockResolvedValueOnce({
      ok: false,
      error: { title: 'Port owned', message: 'owner=srv-2', code: 'MOCK_PORT_OWNED', recoverable: true, retry: true },
    });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(stop).not.toHaveBeenCalledWith('srv-2');

    fireEvent.click(screen.getByTestId('mock-add-folder'));
    fireEvent.click(screen.getByTestId('mock-create-route-folder'));
    fireEvent.click(screen.getByTestId('mock-move-route'));
    fireEvent.click(screen.getByTestId('mock-move-route-ungrouped'));
    fireEvent.click(screen.getByTestId('mock-toggle-folder'));
    fireEvent.click(screen.getByTestId('mock-rename-folder'));

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-route-simulate-sample-post'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('POST:/users');
    fireEvent.click(screen.getByTestId('mock-simulate-close'));
    fireEvent.click(screen.getByTestId('mock-sample-update'));
    fireEvent.click(screen.getByTestId('mock-sample-delete'));

    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-save-example-unassociated'));
    fireEvent.click(screen.getByTestId('mock-dock-open-requests'));
    fireEvent.click(screen.getByTestId('mock-dock-create-route'));
    fireEvent.click(screen.getByTestId('mock-dock-priority'));
    fireEvent.click(screen.getByTestId('mock-dock-ack'));
    fireEvent.click(screen.getByTestId('mock-dock-ack-clean'));

    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    fireEvent.click(screen.getByTestId('mock-conflicts-ack'));
    expect(screen.getByTestId('api-mock-live-region').textContent).toMatch(/Conflict acknowledged|re-acknowledged/);
  });

  it('covers nullish sample and folder fallbacks in route/sample handlers', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [{ ...makeServer('srv-1'), samples: undefined, folders: undefined }],
      activeServerId: 'srv-1',
    });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-sample-delete'));
    fireEvent.click(screen.getByTestId('mock-create-route'));
    fireEvent.click(screen.getByTestId('mock-create-route-folder'));

    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-save-example-unassociated'));
    fireEvent.click(screen.getByTestId('mock-dock-save-example'));

    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('mock-sample-update-hit'));
    fireEvent.click(screen.getByTestId('mock-sample-update'));
  });

  it('covers deleting a sample while other servers remain in the workspace', async () => {
    const active = makeServer('srv-1');
    active.samples = [{
      id: 's1',
      name: 'Example',
      request: { method: 'GET', path: '/users', rawPath: '/users', query: {}, headers: {}, cookies: {}, body: null, bodyTruncated: false, receivedAt: ts },
      expected: { outcome: 'matched', status: 200 },
    }];
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [active, makeServer('srv-2')],
      activeServerId: 'srv-1',
    });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-sample-delete'));
    expect(screen.getByTestId('mock-server-tabs').textContent).toContain('srv-2');
  });

  it('covers folder map else-branches and non-stale conflict acknowledge message', async () => {
    const withFolders = {
      ...makeServer('srv-1'),
      folders: [
        { id: 'fld-1', name: 'Folder 1', expanded: true, sortOrder: 0 },
        { id: 'fld-2', name: 'Folder 2', expanded: false, sortOrder: 1 },
      ],
      routes: [{ ...makeServer('srv-1').routes[0], folderId: 'fld-1' }],
    };
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [withFolders], activeServerId: 'srv-1' });
    analyzeConflicts.mockResolvedValueOnce({ findings: [{ id: 'f-ack', ruleIds: ['route-1'], acknowledgementStale: false }] });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-toggle-folder'));
    fireEvent.click(screen.getByTestId('mock-rename-folder'));

    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mock-conflicts-ack'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent('Conflict acknowledged.');
  });

  it('covers load fallback and inactive-route/server early returns', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-a'), makeServer('srv-b')], activeServerId: undefined });
    analyzeConflicts.mockResolvedValueOnce({ findings: [] });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    expect(screen.getByTestId('mock-server-tabs').textContent).toContain('srv-a');

    fireEvent.click(screen.getByTestId('mock-close-missing-server'));

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-delete-route'));
    expect(screen.getByTestId('api-mock-no-route')).toBeTruthy();
    expect(screen.getByTestId('api-mock-undo-toast')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-undo-dismiss'));
    expect(screen.queryByTestId('api-mock-undo-toast')).toBeNull();
  });

  it('covers simulate ANY fallback, settings close, import modal close, and false poll branches', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-1', 'ANY')], activeServerId: undefined });
    transactions.mockResolvedValueOnce({ ok: false, error: { title: 'x', message: 'x', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    state.mockResolvedValueOnce({ ok: false, error: { title: 'x', message: 'x', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mock-settings'));
    expect(screen.getByTestId('mock-settings-status')).toHaveTextContent('Running');
    fireEvent.click(screen.getByTestId('mock-settings-close'));

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-route-simulate'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('GET:/users');
    fireEvent.click(screen.getByTestId('mock-simulate-close'));

    fireEvent.click(screen.getByTestId('mock-settings'));
    fireEvent.click(screen.getByTestId('mock-settings-close'));

    fireEvent.click(screen.getByTestId('mock-import-open'));
    fireEvent.click(screen.getByTestId('mock-modal-close'));

    fireEvent.click(screen.getByTestId('api-mock-open-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-simulate'));
    expect(screen.getByTestId('mock-simulate-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mock-simulate-close'));
    fireEvent.click(screen.getByTestId('mock-dock-consumed'));
    fireEvent.click(screen.getByTestId('mock-dock-open-conflicts'));
    expect(screen.getByTestId('api-mock-conflicts-page')).toBeTruthy();
  });

  it('covers hydration/poll cancellation on unmount', async () => {
    let resolveLoad!: (v: unknown) => void;
    loadApiMockWorkspace.mockImplementationOnce(() => new Promise(r => { resolveLoad = r; }));
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    const { unmount } = render(<ApiMockStudioPage />);
    unmount();
    resolveLoad({ servers: [makeServer()], activeServerId: 'srv-1' });
    await Promise.resolve();

    let resolveState!: (v: unknown) => void;
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer()], activeServerId: 'srv-1' });
    start.mockResolvedValueOnce({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 1 } });
    transactions.mockResolvedValueOnce({ ok: true, data: { transactions: [], cursor: 0, total: 0, capped: false } });
    state.mockImplementationOnce(() => new Promise(r => { resolveState = r; }));

    const rendered = render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    rendered.unmount();
    resolveState({ ok: true, data: { states: {}, counters: {} } });
    await Promise.resolve();
    expect(screen.queryByTestId('api-mock-studio')).toBeNull();
  });

  it('covers empty persisted load without hydrating servers', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [], activeServerId: undefined });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-library-landing')).toBeTruthy());
  });

  it('reclaims an orphan companion listener when Start hits MOCK_PORT_OWNED', async () => {
    start
      .mockResolvedValueOnce({
        ok: false,
        error: {
          title: 'Port owned by another server',
          message: 'Port 4600 is owned by server "srv-orphan"',
          code: 'MOCK_PORT_OWNED',
          recoverable: true,
          retry: false,
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 1 } });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-orphan'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Server started on port 4600/i));
  });

  it('keeps a parked port claimed but frees it once the server is deleted', async () => {
    const a = { ...makeServer('srv-a'), port: 4600 };
    const b = { ...makeServer('srv-b'), port: 4601 };
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [a, b], activeServerId: 'srv-a' });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    // Parking keeps 4600 reserved so reopening srv-a never collides.
    fireEvent.click(screen.getByTestId('mock-close-server')); // closes srv-a (first)
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-a'));
    fireEvent.click(screen.getByTestId('mock-create-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/created on port 4602/i));
    fireEvent.click(screen.getByTestId('mock-duplicate-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/duplicated on port/i));

    // Deleting the first open tab (srv-b) releases 4601 for the next server.
    fireEvent.click(screen.getByTestId('mock-delete-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/deleted/i));
    fireEvent.click(screen.getByTestId('mock-create-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/created on port 4601/i));
    fireEvent.click(screen.getByTestId('mock-reorder-servers'));
  });

  it('restores a deleted server from the undo toast', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer('srv-a'), makeServer('srv-b')],
      activeServerId: 'srv-a',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-delete-server'));
    await waitFor(() => expect(screen.queryByTestId('mock-select-srv-a')).toBeNull());
    expect(screen.getByTestId('api-mock-undo-toast')).toBeTruthy();

    fireEvent.click(screen.getByTestId('api-mock-undo-restore'));
    await waitFor(() => expect(screen.getByTestId('mock-select-srv-a')).toBeTruthy());
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/restored/i);
  });

  it('closes several tabs with a single close-others action', async () => {
    const a = { ...makeServer('srv-a'), port: 4600 };
    const b = { ...makeServer('srv-b'), port: 4601 };
    const c = { ...makeServer('srv-c'), port: 4602 };
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [a, b, c], activeServerId: 'srv-a' });
    start.mockResolvedValueOnce({ ok: true, data: { serverId: 'srv-b', port: 4601, state: 'running', generation: 1 } });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-select-srv-b'));
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mock-close-others'));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-b'));
    expect(stop).toHaveBeenCalledWith('srv-c');
    await waitFor(() => expect(screen.queryByTestId('mock-select-srv-b')).toBeNull());
    expect(screen.getByTestId('mock-select-srv-a')).toBeTruthy();
    expect(screen.getByTestId('mock-server-bar')).toBeTruthy();
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/2 mock servers closed/i);
  });

  it('covers closing a non-active server tab', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-a'), makeServer('srv-b')], activeServerId: 'srv-b' });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    expect(screen.getByTestId('mock-server-tabs').textContent).toContain('srv-b');
    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-route-simulate-sample'));
    expect(screen.getByTestId('mock-simulate-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mock-select-srv-a'));
    expect(screen.queryByTestId('mock-simulate-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('mock-close-server'));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-a'));
    await waitFor(() => {
      const tabs = screen.getByTestId('mock-server-tabs').textContent ?? '';
      expect(tabs).toContain('srv-b');
      expect(tabs).not.toContain('srv-a');
    });
  });

  it('covers plural conflict copy and simulate path fallback for an empty route path', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [{ ...makeServer('srv-p', 'ANY'), routes: [{ ...makeServer('srv-p', 'ANY').routes[0], path: { kind: 'exact', value: '' } }] }],
      activeServerId: 'srv-p',
    });
    analyzeConflicts.mockResolvedValueOnce({ findings: [{ ruleIds: ['route-1', 'route-2'] }, { ruleIds: ['route-2', 'route-3'] }] });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-route-simulate'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('GET:/');

    fireEvent.click(screen.getByTestId('mock-analyze'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/2 potential conflicts found/i));
  });

  it('covers create-route numbering and deleting a non-selected route', async () => {
    const server = makeServer('srv-many');
    server.routes = [
      server.routes[0],
      { ...server.routes[0], id: 'route-2', name: 'Orders route', path: { kind: 'exact', value: '/orders' } },
    ];
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [server], activeServerId: 'srv-many' });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route-2'));
    fireEvent.click(screen.getByTestId('mock-create-route'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/New Route 3 added/i);

    fireEvent.click(screen.getByTestId('mock-delete-route'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/deleted\. Undo/i);
    expect(screen.getByTestId('api-mock-undo-toast')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-undo-restore'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Restored/i);
  });

  it('restores a deleted route onto its original server after switching tabs', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer('srv-a'), makeServer('srv-b')],
      activeServerId: 'srv-a',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-delete-route'));
    expect(screen.getByTestId('api-mock-undo-toast')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mock-select-srv-b'));
    fireEvent.click(screen.getByTestId('api-mock-undo-restore'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Restored/i);
    expect(screen.queryByTestId('api-mock-undo-toast')).toBeNull();
  });

  it('ignores a second undo before the toast unmounts', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-a')], activeServerId: 'srv-a' });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-delete-route'));
    expect(screen.getByTestId('api-mock-undo-toast')).toBeTruthy();
    act(() => {
      screen.getByTestId('api-mock-undo-restore').click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Restored/i);
    expect(screen.getByTestId('api-mock-live-region')).not.toHaveTextContent(/Could not restore/i);
  });

  it('dismisses the undo toast when the origin server tab is closed', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer('srv-a'), makeServer('srv-b')],
      activeServerId: 'srv-a',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-delete-route'));
    expect(screen.getByTestId('api-mock-undo-toast')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mock-close-server'));
    await waitFor(() => expect(screen.queryByTestId('api-mock-undo-toast')).toBeNull());
  });

  it('covers folder-name rendering, running close-confirm, status error label, and port-owned no-retry branches', async () => {
    const server = makeServer('srv-folder');
    server.folders = [{ id: 'fld-1', name: 'Core', expanded: true, sortOrder: 0 } as any];
    server.routes[0].folderId = 'fld-1';
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [server], activeServerId: 'srv-folder' });
    start.mockResolvedValueOnce({ ok: true, data: { serverId: 'srv-folder', port: 4600, state: 'running', generation: 1 } });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    expect(screen.getByTestId('mock-route-folder-name')).toHaveTextContent('Core');

    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('mock-close-server'));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-folder'));

    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-owned')], activeServerId: 'srv-owned' });
    start.mockResolvedValueOnce({
      ok: false,
      error: {
        title: 'Port owned by another server',
        message: 'Port 4600 is owned by server "srv-owned"',
        code: 'MOCK_PORT_OWNED',
        recoverable: true,
        retry: false,
      },
    });
    const rerendered = render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getAllByTestId('api-mock-studio').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId('mock-start').at(-1)!);
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(stop).not.toHaveBeenCalledWith('srv-owned');

    restart.mockResolvedValueOnce({ ok: false, error: { title: 'Port already in use', message: 'in use', code: 'MOCK_PORT_IN_USE', recoverable: true, retry: false } });
    fireEvent.click(screen.getAllByTestId('mock-restart').at(-1)!);
    await waitFor(() => expect(screen.getAllByTestId('mock-server-status').at(-1)).toHaveTextContent('Port already in use: in use'));
    fireEvent.click(screen.getAllByTestId('mock-settings').at(-1)!);
    expect(screen.getAllByTestId('mock-settings-status').at(-1)).toHaveTextContent('Error');
    rerendered.unmount();
  });

  it('covers export callback and open-conflicts branch when findings already exist', async () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:api-mock-export');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const originalCreateElement = Document.prototype.createElement;
    const anchorClick = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'a') {
        const anchor = originalCreateElement.call(document, 'a', options) as HTMLAnchorElement;
        anchor.click = anchorClick;
        return anchor;
      }
      return originalCreateElement.call(document, tagName, options);
    }) as typeof document.createElement);

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-select-route'));
    fireEvent.click(screen.getByTestId('mock-route-review-conflicts'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/potential conflict/i));
    fireEvent.click(screen.getByTestId('api-mock-conflicts-analyze'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('mock-route-review-conflicts'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('api-mock-conflicts-page')).toBeTruthy();

    fireEvent.click(screen.getByTestId('api-mock-export'));
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);

    createElementSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    createObjectURLSpy.mockRestore();
  });

  it('covers runtime dock patches, journal actions, folder ops, import modes, exports, and recorded drafts', async () => {
    const server = makeServer('srv-rec');
    server.folders = [{ id: 'fld-1', name: 'Core', expanded: true, sortOrder: 0 } as any];
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [server], activeServerId: 'srv-rec' });
    const request = {
      method: 'GET',
      path: '/recorded',
      rawPath: '/recorded',
      query: {},
      cookies: {},
      headers: {},
      body: null,
      bodyTruncated: false,
      receivedAt: ts,
    };
    const conversion = proxiedExchangeToDraft(request, { status: 200, headers: {}, body: '{"ok":true}' });
    recordedDrafts.mockResolvedValue({
      ok: true,
      data: {
        drafts: [toRecordedDraft(conversion, draftFingerprint(request.method, request.path, 200))],
        total: 1,
      },
    });

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchorClick = vi.fn();
    const originalCreateElement = Document.prototype.createElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'a') {
        const anchor = originalCreateElement.call(document, 'a', options) as HTMLAnchorElement;
        anchor.click = anchorClick;
        return anchor;
      }
      return originalCreateElement.call(document, tagName, options);
    }) as typeof document.createElement);

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(recordedDrafts).toHaveBeenCalled());
    await waitFor(() => expect(ackRecordedDrafts).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Recorded 1 proxied exchange/i));

    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-server-patch'));
    fireEvent.click(screen.getByTestId('mock-dock-variables'));
    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-ack'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Stale conflict re-acknowledged/i);
    fireEvent.click(screen.getByTestId('mock-dock-priority'));
    fireEvent.click(screen.getByTestId('mock-dock-open-requests'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Opened captured request/i);
    fireEvent.click(screen.getByTestId('mock-dock-create-route'));
    fireEvent.click(screen.getByTestId('mock-dock-save-example'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/on the matched rule/i);
    fireEvent.click(screen.getByTestId('mock-dock-copy-tx'));
    fireEvent.click(screen.getByTestId('mock-dock-select-route'));

    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    fireEvent.click(screen.getByTestId('mock-conflicts-simulate'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('GET:/raw-witness');
    fireEvent.click(screen.getByTestId('mock-simulate-close'));
    fireEvent.click(screen.getByTestId('mock-conflicts-simulate-empty'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('GET:/');
    fireEvent.click(screen.getByTestId('mock-simulate-close'));
    fireEvent.click(screen.getByTestId('mock-conflicts-simulate-path'));
    expect(screen.getByTestId('mock-simulate-modal')).toHaveTextContent('POST:/path-only?q=1');
    fireEvent.click(screen.getByTestId('mock-simulate-close'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('mock-conflict-inspector')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-conflicts-ack'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Conflict acknowledged/i);
    fireEvent.click(screen.getByTestId('mock-conflicts-priority'));
    fireEvent.click(screen.getByTestId('mock-conflicts-analyze-inner'));
    fireEvent.click(screen.getByTestId('mock-conflicts-apply'));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mock-conflicts-studio'));

    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    fireEvent.click(screen.getByTestId('mock-conflicts-select-route'));
    expect(screen.getByTestId('mock-route-editor')).toBeTruthy();

    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('mock-open-routes'));
    fireEvent.click(screen.getByTestId('mock-close-drawer'));
    fireEvent.click(screen.getByTestId('mock-move-route-ungrouped'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Moved rule to Ungrouped/i);
    fireEvent.click(screen.getByTestId('mock-delete-missing-route'));
    fireEvent.click(screen.getByTestId('mock-create-route-folder'));
    fireEvent.click(screen.getByTestId('mock-move-route'));
    fireEvent.click(screen.getByTestId('mock-rename-folder'));
    fireEvent.click(screen.getByTestId('mock-delete-missing-folder'));
    fireEvent.click(screen.getByTestId('mock-delete-folder'));

    fireEvent.click(screen.getByTestId('mock-import-open'));
    fireEvent.click(screen.getByTestId('mock-import-copy'));
    fireEvent.click(screen.getByTestId('mock-import-open'));
    fireEvent.click(screen.getByTestId('mock-import-replace'));

    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    vi.mocked(apiMockJournalActions.copyTransactionToClipboard).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByTestId('mock-dock-copy-tx'));
    await waitFor(() => expect(vi.mocked(apiMockJournalActions.copyTransactionToClipboard)).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('api-mock-export-yaml'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Server exported/i);
    fireEvent.click(screen.getByTestId('api-mock-export-servers'));
    fireEvent.click(screen.getByTestId('api-mock-export-routes'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Routes exported/i);

    fireEvent.click(screen.getByTestId('api-mock-export-wiremock'));
    fireEvent.click(screen.getByTestId('api-mock-export-har'));
    fireEvent.click(screen.getByTestId('api-mock-export-yaml'));
    await waitFor(() => expect(anchorClick.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByTestId('mock-import-open'));
    fireEvent.click(screen.getByTestId('mock-import-cancel'));

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('skips recorded-draft merge when proxied routes already exist', async () => {
    const server = makeServer('srv-dup');
    const request = {
      method: 'GET',
      path: '/users',
      rawPath: '/users',
      query: {},
      cookies: {},
      headers: {},
      body: null,
      bodyTruncated: false,
      receivedAt: ts,
    };
    const conversion = proxiedExchangeToDraft(request, { status: 200, headers: {}, body: '{}' });
    const draft = toRecordedDraft(conversion, draftFingerprint(request.method, request.path, 200));
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [server], activeServerId: 'srv-dup' });
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [draft], total: 1 } });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(recordedDrafts).toHaveBeenCalled());
    await waitFor(() => expect(ackRecordedDrafts).toHaveBeenCalled());
    expect(screen.getByTestId('api-mock-live-region')).not.toHaveTextContent(/Recorded 1 proxied exchange/i);
  });

  it('merges recorded drafts on the active server only when multiple tabs exist', async () => {
    const request = {
      method: 'GET',
      path: '/new-draft',
      rawPath: '/new-draft',
      query: {},
      cookies: {},
      headers: {},
      body: null,
      bodyTruncated: false,
      receivedAt: ts,
    };
    const conversion = proxiedExchangeToDraft(request, { status: 201, headers: {}, body: '{}' });
    const draft = toRecordedDraft(conversion, draftFingerprint(request.method, request.path, 201));
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer('srv-a'), makeServer('srv-b')],
      activeServerId: 'srv-a',
    });
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [draft], total: 1 } });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Recorded 1 proxied exchange/i));
  });

  it('shows a copy failure message when journal clipboard export fails', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer()], activeServerId: 'srv-1' });
    start.mockResolvedValueOnce({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 1 } });
    vi.mocked(apiMockJournalActions.copyTransactionToClipboard).mockResolvedValueOnce(false);
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-copy-tx'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Could not copy transaction/i));
  });

  it('uses the active server id in export filenames when the server has no name', async () => {
    const server = { ...makeServer('srv-noname'), name: undefined as unknown as string };
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [server], activeServerId: 'srv-noname' });
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hint');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchorClick = vi.fn();
    const originalCreateElement = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'a') {
        const anchor = originalCreateElement.call(document, 'a', options) as HTMLAnchorElement;
        anchor.click = anchorClick;
        return anchor;
      }
      return originalCreateElement.call(document, tagName, options);
    }) as typeof document.createElement);

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    transactions.mockResolvedValue({ ok: false, error: { code: 'COMPANION_UNAVAILABLE', title: 'down', message: 'down', recoverable: true, retry: true } });
    fireEvent.click(screen.getByTestId('api-mock-export'));
    fireEvent.click(screen.getByTestId('api-mock-export-har'));
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('blocks create and duplicate at the 8-tab ceiling', async () => {
    const servers = Array.from({ length: 8 }, (_, i) => ({ ...makeServer(`srv-${i}`), port: 4600 + i }));
    loadApiMockWorkspace.mockResolvedValueOnce({ servers, activeServerId: 'srv-0' });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-create-server'));
    fireEvent.click(screen.getByTestId('mock-duplicate-server'));
    expect(screen.getAllByTestId(/mock-select-srv-/)).toHaveLength(8);
  });

  it('falls back to a local auto-port when companion nextAutoPort fails', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-1')], activeServerId: 'srv-1' });
    nextAutoPort.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NO_PORT_AVAILABLE', message: 'No available port in 4600-4699', retry: false },
    });
    nextAutoPort.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NO_PORT_AVAILABLE', message: 'No available port in 4600-4699', retry: false },
    });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-create-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/created on port/i));
    fireEvent.click(screen.getByTestId('mock-duplicate-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/duplicated on port/i));
    await waitFor(() => expect(screen.getAllByTestId(/mock-select-srv-/).length).toBeGreaterThanOrEqual(3));
  });

  it('shows the tab-limit warning when companion and local auto-ports are exhausted', async () => {
    const servers = Array.from({ length: 100 }, (_, i) => ({
      ...makeServer(`srv-${i}`),
      port: 4600 + i,
    }));
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers,
      activeServerId: 'srv-0',
      openTabIds: ['srv-0'],
    });
    nextAutoPort.mockResolvedValue({
      ok: false,
      error: { code: 'NO_PORT_AVAILABLE', message: 'No available port in 4600-4699', retry: false },
    });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mock-create-server'));
    fireEvent.click(screen.getByTestId('mock-duplicate-server'));
    await waitFor(() => expect(screen.getAllByTestId(/mock-select-srv-/)).toHaveLength(1));
  });

  it('registers the duplicate server id when demo persistence is active', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({ servers: [makeServer('srv-1')], activeServerId: 'srv-1' });
    isApiMockDemoPersistenceActive.mockReturnValue(true);
    rememberApiMockDemoImportedServer.mockClear();
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-duplicate-server'));
    await waitFor(() => expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/duplicated on port/i));
    expect(rememberApiMockDemoImportedServer).toHaveBeenCalledTimes(1);
    isApiMockDemoPersistenceActive.mockReturnValue(false);
  });

  it('saves an unassociated example when the journal row has no matched route', async () => {    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [makeServer()],
      activeServerId: 'srv-1',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));
    fireEvent.click(screen.getByTestId('mock-dock-save-example-unassociated'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/unassociated/i);
  });
});
