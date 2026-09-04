/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const ts = '2026-08-12T00:00:00.000Z';

function makeServer(id = 'srv-1') {
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
      method: 'GET',
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
    variables: [{ id: 'v1', key: 'tenant', value: 'acme', sensitive: false }],
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
const list = vi.fn();
const status = vi.fn();
const nextAutoPort = vi.fn();
const analyzeConflicts = vi.fn();
const clearConsole = vi.fn();

// In jsdom isTauri() returns false, which makes ApiMockServerBar disable the
// Start button (desktopRequired=true). Mock it as true so control-flow tests
// can exercise start/stop/apply/restart branches.
vi.mock('@shared/utils/platform', () => ({
  isTauri: () => true,
  isE2eDesktopShim: () => false,
  supportsWorkers: () => false,
  isNode: () => false,
}));

// When isTauri() returns true, useSplitPaneResize tries to persist via the
// storage layer → tauriStore → @tauri-apps/api/core invoke, which blows up
// in jsdom. Stub every exported function from the storage abstraction so those
// async side-effects are silent no-ops.
vi.mock('../../shared/utils/storage', () => ({
  readKey: vi.fn().mockResolvedValue(null),
  writeKey: vi.fn().mockResolvedValue(undefined),
  removeKey: vi.fn().mockResolvedValue(undefined),
  readJson: vi.fn().mockResolvedValue(null),
  writeJson: vi.fn().mockResolvedValue(undefined),
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./apiMockPersistence', () => ({
  isApiMockDemoPersistenceActive: vi.fn(() => false),
  loadApiMockWorkspace: (...args: unknown[]) => loadApiMockWorkspace(...args),
  saveApiMockWorkspace: (...args: unknown[]) => saveApiMockWorkspace(...args),
  publishApiMockWorkspace: vi.fn(),
  publishApiMockRuntimeChanged: vi.fn(),
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
    // Hydration reconciles against the live pool; creation asks for a free port.
    list: (...args: unknown[]) => list(...args),
    status: (...args: unknown[]) => status(...args),
    nextAutoPort: (...args: unknown[]) => nextAutoPort(...args),
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
    confirmDialogElement: null,
  }),
}));

function makeConflictFinding(id = 'f1') {
  return {
    id,
    serverId: 'srv-1',
    ruleIds: ['route-1', 'route-2'] as [string, string],
    kind: 'potential_overlap' as const,
    severity: 'warning' as const,
    dimensions: [{ source: 'path' as const, result: 'overlap' as const, explanation: 'Paths overlap' }],
    selectionOutcome: 'unknown' as const,
    ruleFingerprints: ['fp-a', 'fp-b'] as [string, string],
  };
}

describe('ApiMockStudioPage coverage gaps', () => {
  beforeEach(() => {
    loadApiMockWorkspace.mockResolvedValue({ servers: [makeServer()], activeServerId: 'srv-1' });
    saveApiMockWorkspace.mockResolvedValue(undefined);
    start.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 1 } });
    stop.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'stopped', generation: 1 } });
    restart.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 2 } });
    commit.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 2 } });
    transactions.mockResolvedValue({ ok: true, data: { transactions: [], cursor: 0, total: 0, capped: false } });
    clearTransactions.mockResolvedValue({ ok: true, data: { cleared: true } });
    state.mockResolvedValue({ ok: true, data: { states: {}, counters: {} } });
    resetState.mockResolvedValue({ ok: true, data: { reset: true } });
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [], total: 0 } });
    ackRecordedDrafts.mockResolvedValue({ ok: true, data: { removed: 0 } });
    list.mockResolvedValue({ ok: true, data: [] });
    status.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'stopped', generation: 0 } });
    nextAutoPort.mockResolvedValue({ ok: true, data: { port: 4601 } });
    analyzeConflicts.mockResolvedValue({ findings: [] });
  });

  afterEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('hydrates persisted workspace, polls runtime data, and autosaves', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [{ ...makeServer(), routes: [] }],
      activeServerId: 'srv-1',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);

    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    expect(screen.getByText('Mock Server srv-1')).toBeTruthy();
    expect(screen.getByTestId('api-mock-no-route')).toBeTruthy();

    await waitFor(() => expect(saveApiMockWorkspace).toHaveBeenCalled(), { timeout: 1200 });
    expect(transactions).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
  });

  it('covers start/apply/restart/stop success flows, settings/import open, analyze, and clears transactions/state/console', async () => {
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('api-mock-route-route-1'));

    fireEvent.click(screen.getByTestId('api-mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('api-mock-settings'));
    expect(screen.getByTestId('api-mock-settings-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-settings-cancel'));

    // Make the route dirty so Apply appears.
    fireEvent.change(screen.getByTestId('api-mock-route-name'), { target: { value: 'Users route 2' } });
    fireEvent.click(screen.getByTestId('api-mock-apply'));
    await waitFor(() => expect(commit).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('api-mock-restart'));
    await waitFor(() => expect(restart).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('api-mock-analyze'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('api-mock-import-menu'));
    expect(screen.getByTestId('api-mock-import-review')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-import-source-curl'));
    fireEvent.change(screen.getByTestId('api-mock-curl-input'), { target: { value: 'curl /users' } });
    fireEvent.click(screen.getByTestId('api-mock-curl-parse'));
    fireEvent.click(screen.getByTestId('api-mock-import-cancel'));

    // The dock now lives under the Runtime view rather than always being mounted.
    fireEvent.click(screen.getByTestId('api-mock-view-runtime'));

    fireEvent.click(screen.getByRole('tab', { name: 'State' }));
    fireEvent.click(screen.getByTestId('api-mock-state-reset'));
    await waitFor(() => expect(resetState).toHaveBeenCalled());

    // The page-variant dock shortens this label to "Console".
    fireEvent.click(screen.getByRole('tab', { name: 'Console' }));
    fireEvent.click(screen.getByTestId('api-mock-console-clear'));
    expect(clearConsole).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('api-mock-stop'));
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('covers control-flow failures and route/server deletion branches', async () => {
    start.mockResolvedValueOnce({ ok: false, error: { title: 'Companion unavailable', message: 'down', code: 'COMPANION_UNAVAILABLE', recoverable: true, retry: true } });
    stop.mockResolvedValueOnce({ ok: false, error: { title: 'Runtime error', message: 'bad stop', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    commit.mockResolvedValueOnce({ ok: false, error: { title: 'Invalid definition', message: 'bad draft', code: 'MOCK_VALIDATION_ERROR', recoverable: true, retry: false } });
    restart.mockResolvedValueOnce({ ok: false, error: { title: 'Port already in use', message: 'in use', code: 'MOCK_PORT_IN_USE', recoverable: true, retry: false } });
    transactions.mockResolvedValueOnce({ ok: false, error: { title: 'x', message: 'x', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    state.mockResolvedValueOnce({ ok: false, error: { title: 'x', message: 'x', code: 'MOCK_RUNTIME_ERROR', recoverable: true, retry: true } });
    analyzeConflicts.mockResolvedValueOnce({ findings: [{ ruleIds: ['route-1', 'route-1'] }] });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    fireEvent.click(screen.getByTestId('api-mock-route-route-1'));

    fireEvent.click(screen.getByTestId('api-mock-start'));
    await waitFor(() => expect(screen.getByTestId('api-mock-server-error')).toHaveTextContent('Companion unavailable'));

    // Force running UI so stop/apply/restart branches render even when control calls fail.
    start.mockResolvedValue({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 1 } });
    fireEvent.click(screen.getByTestId('api-mock-start'));
    await waitFor(() => expect(screen.getByTestId('api-mock-stop')).toBeTruthy());

    fireEvent.change(screen.getByTestId('api-mock-route-name'), { target: { value: 'Dirty route' } });
    fireEvent.click(screen.getByTestId('api-mock-apply'));
    await waitFor(() => expect(screen.getByTestId('api-mock-server-error')).toHaveTextContent('Invalid definition'));

    fireEvent.click(screen.getByTestId('api-mock-restart'));
    await waitFor(() => expect(screen.getByTestId('api-mock-server-error')).toHaveTextContent('Port already in use'));

    // "Analyze all" now jumps to the Conflicts view; come back to see the badge.
    fireEvent.click(screen.getByTestId('api-mock-analyze'));
    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    await waitFor(() => expect(screen.getByTestId('api-mock-editor-conflict')).toBeTruthy());

    // Deletion now lives on the rule row in the explorer, not the editor header.
    fireEvent.click(document.querySelector('[data-testid^="api-mock-route-delete-"]') as HTMLElement);
    expect(screen.getByTestId('api-mock-no-route')).toBeTruthy();

    fireEvent.click(screen.getByTestId('api-mock-tab-close-srv-1'));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('srv-1'));
    // Closing the last tab parks the server — the landing offers it back.
    await waitFor(() => expect(screen.getByTestId('api-mock-library-landing')).toBeTruthy());
  });

  it('covers live strip deep links and empty-route selection copy', async () => {
    loadApiMockWorkspace.mockResolvedValueOnce({
      servers: [{ ...makeServer(), routes: [] }],
      activeServerId: 'srv-1',
    });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    expect(screen.getByText(/This mock server has no rules yet/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-no-route-create'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/added/i);

    fireEvent.click(screen.getByTestId('api-mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('api-mock-live-settings'));
    expect(screen.getByTestId('api-mock-runtime-page')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('api-mock-live-console'));
    expect(screen.getByTestId('api-mock-runtime-page')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('api-mock-live-variables'));
    fireEvent.click(screen.getByTestId('api-mock-view-studio'));
    fireEvent.click(screen.getByTestId('api-mock-open-routes'));
    fireEvent.click(screen.getByTestId('api-mock-routes-backdrop'));
    fireEvent.click(screen.getByTestId('api-mock-open-routes'));
    fireEvent.click(screen.getByTestId('api-mock-close-routes'));
    fireEvent.click(screen.getByTestId('api-mock-import-menu'));
    fireEvent.click(screen.getByTestId('api-mock-import-close'));
    expect(screen.queryByTestId('api-mock-import-review')).not.toBeInTheDocument();
  });

  it('acknowledges analyzed conflicts through the real conflict inspector', async () => {
    analyzeConflicts.mockResolvedValueOnce({ findings: [makeConflictFinding()] });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('api-mock-conflict-acknowledge')).toBeTruthy());
    fireEvent.click(screen.getByTestId('api-mock-conflict-acknowledge'));
    expect(screen.getByTestId('api-mock-live-region')).toHaveTextContent(/Conflict acknowledged/i);
  });

  it('applies a dirty draft from the conflicts page apply button', async () => {
    analyzeConflicts.mockResolvedValueOnce({ findings: [makeConflictFinding()] });
    commit.mockResolvedValueOnce({ ok: true, data: { serverId: 'srv-1', port: 4600, state: 'running', generation: 2 } });
    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());
    fireEvent.click(screen.getByTestId('api-mock-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('api-mock-route-name'), { target: { value: 'Dirty users route' } });
    fireEvent.click(screen.getByTestId('api-mock-view-conflicts'));
    await waitFor(() => expect(analyzeConflicts).toHaveBeenCalled());
    const applyBtn = await screen.findByTestId('api-mock-conflict-apply');
    await waitFor(() => expect(applyBtn).not.toBeDisabled());
    fireEvent.click(applyBtn);
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  // ─── B-1: handleImportRoutes with samples (line 430) ──────────────────────
  it('handleImportRoutes merges HAR-imported samples into the active server (B-1 line 430)', async () => {
    const harJson = JSON.stringify({
      log: {
        version: '1.2',
        entries: [{
          request: { method: 'GET', url: 'https://api.example.com/orders', headers: [] },
          response: {
            status: 201,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { text: '{"id":1}', mimeType: 'application/json' },
          },
        }],
      },
    });

    const { ApiMockStudioPage } = await import('./ApiMockStudioPage');
    render(<ApiMockStudioPage />);
    await waitFor(() => expect(screen.getByTestId('api-mock-studio')).toBeTruthy());

    // Open the import modal
    fireEvent.click(screen.getByTestId('api-mock-import-menu'));
    expect(screen.getByTestId('api-mock-import-review')).toBeTruthy();

    // Select HAR source, paste HAR JSON, parse
    fireEvent.click(screen.getByTestId('api-mock-import-source-har'));
    fireEvent.change(screen.getByTestId('api-mock-import-paste'), { target: { value: harJson } });
    fireEvent.click(screen.getByTestId('api-mock-import-parse'));

    // "Also create Simulate samples" toggle is on by default — confirm import
    expect(screen.getByTestId('api-mock-import-har-samples-checkbox')).toBeChecked();
    fireEvent.click(screen.getByTestId('api-mock-import-confirm'));

    // Verify saveApiMockWorkspace was called with the server containing the new sample
    await waitFor(() => expect(saveApiMockWorkspace).toHaveBeenCalled());
    const savedWorkspace = saveApiMockWorkspace.mock.calls.at(-1)![0];
    const server = savedWorkspace.servers.find((s: { id: string }) => s.id === 'srv-1');
    expect(server.samples).toHaveLength(1);
    expect(server.samples[0].expected?.status).toBe(201);
    expect(server.samples[0].expected?.outcome).toBe('matched');
    expect(server.samples[0].request.method).toBe('GET');
    expect(server.samples[0].request.path).toBe('/orders');
  });
});
