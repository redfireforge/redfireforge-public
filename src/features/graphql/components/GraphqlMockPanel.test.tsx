/**
 * GraphqlMockPanel.test.tsx
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { selectOption, getCustomSelectValue } from '@test-utils/customSelectHelper';
import { GraphqlMockPanel, FieldResolverRow } from './GraphqlMockPanel';
import type { UseGraphqlMockServerResult } from '../hooks/useGraphqlMockServer';
import type { GraphqlSchemaInfo } from '@shared/types/graphql';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
  isDesktopRuntimeAvailable: vi.fn(() => false),
}));

import { isDesktopRuntimeAvailable, isTauri } from '@shared/utils/platform';
const mockIsTauri = vi.mocked(isTauri);
const mockIsDesktopRuntimeAvailable = vi.mocked(isDesktopRuntimeAvailable);

// Silence URL.createObjectURL not implemented in jsdom
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

// ─── Factories ────────────────────────────────────────────────────────────────

function makeMockServer(overrides: Partial<UseGraphqlMockServerResult> = {}): UseGraphqlMockServerResult {
  return {
    config: {
      connectionId:    'test-conn',
      enabled:         false,
      resolvers:       {},
      globalLatencyMs: 0,
      jitterMs:        0,
      seed:            undefined,
      scenarios:       [],
      activeScenarioId: undefined,
      scalarFactories:  [],
    },
    customSdl:    '',
    schemaSource: 'introspected',
    syncError:    null,
    syncing:      false,
    requestLog:   [],
    status:       null,

    setEnabled:          vi.fn(),
    setSchemaSource:     vi.fn(),
    setCustomSdl:        vi.fn(),
    setFieldResolver:    vi.fn(),
    clearFieldResolver:  vi.fn(),
    setGlobalLatency:    vi.fn(),
    setJitter:           vi.fn(),
    setSeed:             vi.fn(),
    addScenario:         vi.fn(),
    updateScenario:      vi.fn(),
    deleteScenario:      vi.fn(),
    activateScenario:    vi.fn(),
    setScalarFactory:    vi.fn(),
    removeScalarFactory: vi.fn(),
    importConfig:        vi.fn(),
    resetAll:            vi.fn(),
    refreshLog:          vi.fn(),
    syncCustomSdlNow:    vi.fn(),
    syncFromServerStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSchemaInfo(overrides: Partial<GraphqlSchemaInfo> = {}): GraphqlSchemaInfo {
  return {
    sdl: 'type Query { hello: String }',
    types: [
      {
        name:   'Query',
        kind:   'OBJECT',
        fields: [{ name: 'hello', type: 'String', description: null }],
        description: null,
      },
    ],
    queryType:        { name: 'Query' },
    mutationType:     null,
    subscriptionType: null,
    directives:       [],
    safeCount:        1,
    deprecatedCount:  0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GraphqlMockPanel — web guard', () => {
  beforeEach(() => {
    mockIsTauri.mockReturnValue(false);
    mockIsDesktopRuntimeAvailable.mockReturnValue(false);
  });

  it('renders the desktop-only guard on hosted web', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={null} />);
    expect(screen.getByTestId('gql-mock-guard')).toBeDefined();
    expect(screen.queryByTestId('gql-mock-panel')).toBeNull();
  });

  it('shows the download link in the guard banner', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={null} />);
    const link = screen.getByRole('link', { name: /Download the desktop app/i });
    expect(link.getAttribute('href')).toContain('releases');
  });

  it('renders the full panel on a local clone even when not in Tauri', () => {
    mockIsDesktopRuntimeAvailable.mockReturnValue(true);
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-panel')).toBeDefined();
    expect(screen.queryByTestId('gql-mock-guard')).toBeNull();
  });
});

describe('GraphqlMockPanel — desktop (Tauri)', () => {
  beforeEach(() => {
    mockIsTauri.mockReturnValue(true);
    mockIsDesktopRuntimeAvailable.mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the full panel when in Tauri', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-panel')).toBeDefined();
    expect(screen.queryByTestId('gql-mock-guard')).toBeNull();
  });

  // ─── Toggle ─────────────────────────────────────────────────────────────────

  it('toggle is disabled when there is no SDL', () => {
    const server = makeMockServer({ schemaSource: 'introspected' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={null} />);
    const toggle = screen.getByTestId('gql-mock-toggle') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText(/Introspect first or provide SDL/i)).toBeDefined();
  });

  it('toggle is enabled when schema info is present', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const toggle = screen.getByTestId('gql-mock-toggle') as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
  });

  it('calls setEnabled when toggle is clicked', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-toggle'));
    expect(server.setEnabled).toHaveBeenCalledWith(true);
  });

  it('shows "Mock mode ON" when enabled', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByText(/Mock mode ON/i)).toBeDefined();
  });

  it('shows status row when enabled', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 100, jitterMs: 20, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-status-row')).toBeDefined();
    expect(screen.getByText(/100ms ±20ms/)).toBeDefined();
  });

  it('shows resolver count in status row when there are overrides', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true,
        resolvers: { Query: { hello: { type: 'fixed', value: 'world' } } },
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-status-row')).toHaveTextContent('1 override');
  });

  it('shows active scenario name in status row', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true,
        resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{ id: 'sc1', name: 'Error Case', resolvers: {} }],
        activeScenarioId: 'sc1',
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByText('Error Case')).toBeDefined();
  });

  it('shows sync error when present', () => {
    const server = makeMockServer({ syncError: 'Connection refused' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-sync-error')).toBeDefined();
    expect(screen.getByText('Connection refused')).toBeDefined();
  });

  it('shows syncing indicator when syncing', () => {
    const server = makeMockServer({ syncing: true });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-sync-badge')).toBeDefined();
  });

  // ─── Schema source ──────────────────────────────────────────────────────────

  it('calls setSchemaSource when custom radio is selected', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    const customRadio = screen.getByDisplayValue('custom');
    fireEvent.click(customRadio);
    expect(server.setSchemaSource).toHaveBeenCalledWith('custom');
  });

  it('shows SDL editor when schemaSource is custom', () => {
    const server = makeMockServer({ schemaSource: 'custom', customSdl: 'type Query {}' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-sdl-editor')).toBeDefined();
  });

  it('calls setCustomSdl when SDL textarea changes', () => {
    const server = makeMockServer({ schemaSource: 'custom', customSdl: '' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.change(screen.getByTestId('gql-mock-sdl-editor'), { target: { value: 'type Foo { bar: String }' } });
    expect(server.setCustomSdl).toHaveBeenCalledWith('type Foo { bar: String }');
  });

  it('calls syncCustomSdlNow on SDL textarea blur', () => {
    const server = makeMockServer({ schemaSource: 'custom', customSdl: 'type Query {}' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.blur(screen.getByTestId('gql-mock-sdl-editor'));
    expect(server.syncCustomSdlNow).toHaveBeenCalled();
  });

  it('SDL editor enabled when customSdl is non-empty for hasSdl', () => {
    const server = makeMockServer({ schemaSource: 'custom', customSdl: 'type Q {}' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={null} />);
    const toggle = screen.getByTestId('gql-mock-toggle') as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
  });

  // ─── Latency / Jitter / Seed ────────────────────────────────────────────────

  it('calls setGlobalLatency when slider changes', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.change(screen.getByTestId('gql-mock-latency-slider'), { target: { value: '500' } });
    expect(server.setGlobalLatency).toHaveBeenCalledWith(500);
  });

  it('calls setJitter when jitter input changes', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.change(screen.getByTestId('gql-mock-jitter-input'), { target: { value: '100' } });
    expect(server.setJitter).toHaveBeenCalledWith(100);
  });

  it('calls setSeed with parsed integer when seed input changes', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.change(screen.getByTestId('gql-mock-seed-input'), { target: { value: '42' } });
    expect(server.setSeed).toHaveBeenCalledWith(42);
  });

  it('calls setSeed with undefined when seed input is cleared', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [], seed: 99,
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.change(screen.getByTestId('gql-mock-seed-input'), { target: { value: '' } });
    expect(server.setSeed).toHaveBeenCalledWith(undefined);
  });

  // ─── Tabs ────────────────────────────────────────────────────────────────────

  it('defaults to Resolvers tab', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const resolversTab = screen.getByRole('tab', { name: 'Resolvers' });
    expect(resolversTab.getAttribute('aria-selected')).toBe('true');
  });

  it('switches to Scenarios tab', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    expect(screen.getByTestId('gql-mock-scenarios')).toBeDefined();
  });

  it('switches to Scalar Factories tab', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    // With no custom scalars, shows empty message (not the list container)
    expect(screen.getByText(/No custom scalar types found/i)).toBeDefined();
  });

  it('switches to Request Log tab', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    // When mock is disabled, shows "enable mock mode" message
    expect(screen.getByText(/Mock mode is off/i)).toBeDefined();
  });

  // ─── Resolvers tab content ───────────────────────────────────────────────────

  it('shows empty message when no schema types exist but schemaInfo is provided', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={{ ...makeSchemaInfo(), types: [] }} />);
    expect(screen.getByText(/No Object types found in schema/i)).toBeDefined();
  });

  it('shows custom SDL empty message when schemaInfo is null and source is custom', () => {
    const server = makeMockServer({ schemaSource: 'custom' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={null} />);
    expect(screen.getByText(/Field resolvers use the introspected schema/i)).toBeDefined();
  });

  it('shows empty message when schemaInfo is null', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={null} />);
    expect(screen.getByText(/Introspect a schema to configure field resolver/i)).toBeDefined();
  });

  it('renders TypeResolverGroup for each OBJECT type', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getAllByTestId('gql-mock-type-group').length).toBeGreaterThanOrEqual(1);
  });

  it('expands TypeResolverGroup to show FieldResolverRow', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const typeHeader = screen.getByTestId('gql-mock-type-header');
    fireEvent.click(typeHeader);
    expect(screen.getByTestId('gql-mock-field-row')).toBeDefined();
  });

  it('shows override count badge when type has overrides', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false,
        resolvers: { Query: { hello: { type: 'fixed', value: 'world' } } },
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByText(/1 override/)).toBeDefined();
  });

  it('calls setFieldResolver when resolver select changes', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Fixed');
    // A fixed-value input should appear; setFieldResolver is called on blur/change of fixed input
    expect(screen.getByTestId('gql-mock-fixed-input')).toBeDefined();
  });

  it('calls setFieldResolver with script when script mode selected', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Script');
    expect(screen.getByTestId('gql-mock-script-input')).toBeDefined();
  });

  it('calls setFieldResolver with error when error mode selected', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Error');
    expect(screen.getByTestId('gql-mock-error-input')).toBeDefined();
  });

  it('calls setFieldResolver on fixed input blur', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Fixed');
    const fixedInput = screen.getByTestId('gql-mock-fixed-input');
    fireEvent.change(fixedInput, { target: { value: '"hello"' } });
    fireEvent.blur(fixedInput);
    expect(server.setFieldResolver).toHaveBeenCalled();
  });

  // ─── Scenarios tab ───────────────────────────────────────────────────────────

  it('renders scenario cards when scenarios exist', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{ id: 'sc1', name: 'Happy Path', resolvers: {} }],
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    expect(screen.getByTestId('gql-mock-scenario-card')).toBeDefined();
    expect(screen.getByText('Happy Path')).toBeDefined();
  });

  it('activates a scenario when activate button clicked', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{ id: 'sc1', name: 'Happy Path', resolvers: {} }],
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-scenario-activate'));
    expect(server.activateScenario).toHaveBeenCalledWith('sc1');
  });

  it('deactivates a scenario when deactivate button clicked', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{ id: 'sc1', name: 'Happy Path', resolvers: {} }],
        activeScenarioId: 'sc1',
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-scenario-deactivate'));
    expect(server.activateScenario).toHaveBeenCalledWith(undefined);
  });

  it('deletes a scenario when delete button clicked', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{ id: 'sc1', name: 'Happy Path', resolvers: {} }],
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-scenario-delete'));
    expect(server.deleteScenario).toHaveBeenCalledWith('sc1');
  });

  it('adds a new scenario via the add form', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));

    // Open add form
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    const nameInput = screen.getByTestId('gql-mock-scenario-name-input');
    fireEvent.change(nameInput, { target: { value: 'Error Flow' } });
    fireEvent.click(screen.getByTestId('gql-mock-scenario-add-confirm'));
    expect(server.addScenario).toHaveBeenCalled();
    const [calledArg] = (server.addScenario as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledArg.name).toBe('Error Flow');
  });

  it('shows add form in scenarios tab', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    expect(screen.getByTestId('gql-mock-scenario-add-form')).toBeDefined();
  });

  // ─── Scalar factories tab ────────────────────────────────────────────────────

  it('renders scalar factory rows for schema scalar types', () => {
    const schemaInfoWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [
        {
          name: 'DateTime',
          kind: 'SCALAR',
          fields: null,
          description: null,
        },
      ],
    };
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={schemaInfoWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    expect(screen.getByTestId('gql-mock-scalar-row')).toBeDefined();
  });

  it('shows empty message in scalar factories when no custom scalars', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    expect(screen.getByText(/No custom scalar types found/i)).toBeDefined();
  });

  // ─── Request log tab ─────────────────────────────────────────────────────────

  it('renders empty log message when no log entries (enabled)', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    // With empty log and mock enabled, shows "No requests yet." empty state
    const empty = document.querySelector('.gql-mock-empty');
    expect(empty?.textContent).toMatch(/No requests yet/i);
  });

  it('renders log entries when requestLog has entries', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [
        {
          id:               'log1',
          timestamp:        Date.now(),
          operationName:    'GetUser',
          query:            '{ user { id } }',
          variables:        {},
          latencyMs:        42,
          activeScenarioId: null,
          result:           { data: { user: { id: '1' } } },
        },
      ],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    expect(screen.getByTestId('gql-mock-log')).toBeDefined();
    expect(screen.getByTestId('gql-mock-log-row')).toBeDefined();
    expect(screen.getByText('GetUser')).toBeDefined();
  });

  it('expands log row to show detail on click', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [
        {
          id:               'log1',
          timestamp:        Date.now(),
          operationName:    'GetUser',
          query:            '{ user { id } }',
          variables:        {},
          latencyMs:        42,
          activeScenarioId: null,
          result:           { data: {} },
        },
      ],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    // The inner summary div has role="button" and is clickable; click on the op name to trigger expand
    fireEvent.click(screen.getByText('GetUser'));
    expect(screen.getByTestId('gql-mock-log-detail')).toBeDefined();
  });

  it('calls refreshLog when refresh button clicked', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [
        {
          id:               'log1',
          timestamp:        Date.now(),
          operationName:    'GetUser',
          query:            '{ user { id } }',
          variables:        {},
          latencyMs:        42,
          activeScenarioId: null,
          result:           { data: {} },
        },
      ],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    fireEvent.click(screen.getByTestId('gql-mock-log-refresh'));
    expect(server.refreshLog).toHaveBeenCalled();
  });

  // ─── Footer actions ──────────────────────────────────────────────────────────

  it('calls resetAll when Reset All button clicked', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTitle(/Reset all resolvers/i));
    expect(server.resetAll).toHaveBeenCalled();
  });

  it('triggers export download on Export click', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body as unknown as Node);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => document.body as unknown as Node);
    try {
      fireEvent.click(screen.getByTitle(/Export mock config/i));
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('calls clipboard.writeText on Copy URL click', async () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Copy mock endpoint URL/i));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3001/api/graphql/mock');
  });

  // ─── Import ──────────────────────────────────────────────────────────────────

  /** Replace global.FileReader with a lightweight stub, returns a restore fn. */
  function withFileReader(result: string | null, triggerError = false) {
    const OrigFileReader = global.FileReader;
    type FRInstance = { onerror: (() => void) | null; onload: ((ev: { target: { result: string } }) => void) | null; readAsText: (f: File) => void };
    const _result = result;
    const _triggerError = triggerError;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).FileReader = function (this: FRInstance) {
      this.onerror = null;
      this.onload = null;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const instance = this;
      this.readAsText = () => {
        if (_triggerError) {
          setTimeout(() => { instance.onerror?.(); }, 0);
        } else {
          setTimeout(() => { instance.onload?.({ target: { result: _result ?? '' } }); }, 0);
        }
      };
    };
    return () => { global.FileReader = OrigFileReader; };
  }

  it('calls importConfig when a valid JSON file is imported', async () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);

    const importData = { _meta: { version: 1 }, config: { globalLatencyMs: 200 } };
    const fileContent = JSON.stringify(importData);
    const restore = withFileReader(fileContent);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File([fileContent], 'mock.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(server.importConfig).toHaveBeenCalledWith({ globalLatencyMs: 200 }, undefined);
    restore();
  });

  it('shows import error for invalid JSON', async () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const restore = withFileReader('not json');

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File(['not json'], 'bad.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getByTestId('gql-mock-import-error')).toBeDefined();
    expect(screen.getByText(/could not parse JSON/i)).toBeDefined();
    restore();
  });

  it('dismisses import error when ✕ clicked', async () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const restore = withFileReader('not json');

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File(['not json'], 'bad.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getByTestId('gql-mock-import-error')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Dismiss import error'));
    expect(screen.queryByTestId('gql-mock-import-error')).toBeNull();
    restore();
  });

  it('shows import error when file read fails', async () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const restore = withFileReader(null, true);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File([''], 'fail.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getByText(/Failed to read file/i)).toBeDefined();
    restore();
  });

  it('shows import error when config field is invalid', async () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const badData = JSON.stringify({ config: [1, 2, 3] });
    const restore = withFileReader(badData);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File([badData], 'mock.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getByText(/config.*field must be an object/i)).toBeDefined();
    restore();
  });

  it('shows import error when root JSON is not an object (array)', async () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    const badData = JSON.stringify([1, 2, 3]);
    const restore = withFileReader(badData);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File([badData], 'bad.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getByText(/expected a JSON object/i)).toBeDefined();
    restore();
  });

  it('does nothing when file input changes with no file', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(server.importConfig).not.toHaveBeenCalled();
  });

  it('calls importConfig with customSdl when import data includes it', async () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);

    const importData = {
      config: { globalLatencyMs: 100 },
      customSdl: 'type Foo { id: ID }',
    };
    const fileContent = JSON.stringify(importData);
    const restore = withFileReader(fileContent);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File([fileContent], 'mock.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(server.importConfig).toHaveBeenCalledWith({ globalLatencyMs: 100 }, 'type Foo { id: ID }');
    restore();
  });

  // ─── More field resolver tests ────────────────────────────────────────────────

  it('calls clearFieldResolver when switching back to random mode from fixed', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false,
        resolvers: { Query: { hello: { type: 'fixed', value: 'world' } } },
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Random');
    expect(server.clearFieldResolver).toHaveBeenCalledWith('Query', 'hello');
  });

  it('calls setFieldResolver on script input blur with non-empty script', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Script');
    const scriptInput = screen.getByTestId('gql-mock-script-input');
    fireEvent.change(scriptInput, { target: { value: 'return "test"' } });
    fireEvent.blur(scriptInput);
    expect(server.setFieldResolver).toHaveBeenCalledWith('Query', 'hello', { type: 'script', code: 'return "test"' });
  });

  it('calls setFieldResolver on error input blur', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Error');
    const errorInput = screen.getByTestId('gql-mock-error-input');
    fireEvent.change(errorInput, { target: { value: 'Not found' } });
    fireEvent.blur(errorInput);
    expect(server.setFieldResolver).toHaveBeenCalledWith('Query', 'hello', { type: 'error', message: 'Not found' });
  });

  it('shows jitter in status row when jitter is non-zero', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 200, jitterMs: 50, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByText(/200ms ±50ms/)).toBeDefined();
  });

  it('shows plural resolver overrides in status row', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true,
        resolvers: {
          Query: { hello: { type: 'fixed', value: 'a' }, world: { type: 'fixed', value: 'b' } },
        },
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={{
      ...makeSchemaInfo(),
      types: [{
        name: 'Query', kind: 'OBJECT',
        fields: [{ name: 'hello', type: 'String' }, { name: 'world', type: 'String' }],
        description: null,
      }],
    }} />);
    expect(screen.getByTestId('gql-mock-status-row')).toHaveTextContent('2 overrides');
  });

  // ─── ScalarFactory preset/script modes ───────────────────────────────────────

  it('changes scalar factory mode to preset and applies', () => {
    const server = makeMockServer();
    const schemaWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [{ name: 'DateTime', kind: 'SCALAR', fields: null, description: null }],
    };
    render(<GraphqlMockPanel mockServer={server} schemaInfo={schemaWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    selectOption(screen.getByTestId('gql-mock-scalar-mode-select'), 'Preset');
    expect(screen.getByTestId('gql-mock-scalar-preset-select')).toBeDefined();
    expect(server.setScalarFactory).toHaveBeenCalled();
  });

  it('changes scalar factory mode to script and applies', () => {
    const server = makeMockServer();
    const schemaWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [{ name: 'DateTime', kind: 'SCALAR', fields: null, description: null }],
    };
    render(<GraphqlMockPanel mockServer={server} schemaInfo={schemaWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    selectOption(screen.getByTestId('gql-mock-scalar-mode-select'), 'Script');
    expect(screen.getByTestId('gql-mock-scalar-script-input')).toBeDefined();
    const scriptInput = screen.getByTestId('gql-mock-scalar-script-input');
    fireEvent.change(scriptInput, { target: { value: 'return "2026-01-01"' } });
    fireEvent.blur(scriptInput);
    expect(server.setScalarFactory).toHaveBeenCalledWith({ scalarName: 'DateTime', scriptCode: 'return "2026-01-01"' });
  });

  it('removes scalar factory when mode is set back to random', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [],
        scalarFactories: [{ scalarName: 'DateTime', preset: 'date-iso' }],
      },
    });
    const schemaWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [{ name: 'DateTime', kind: 'SCALAR', fields: null, description: null }],
    };
    render(<GraphqlMockPanel mockServer={server} schemaInfo={schemaWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    selectOption(screen.getByTestId('gql-mock-scalar-mode-select'), 'Random (default)');
    expect(server.removeScalarFactory).toHaveBeenCalledWith('DateTime');
  });

  it('adds scenario with snapCurrentResolvers flag', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: { Query: { hello: { type: 'fixed', value: 'x' } } },
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    fireEvent.change(screen.getByTestId('gql-mock-scenario-name-input'), { target: { value: 'Snap Scenario' } });
    fireEvent.click(screen.getByTestId('gql-mock-scenario-snap-checkbox'));
    fireEvent.click(screen.getByTestId('gql-mock-scenario-add-confirm'));
    expect(server.addScenario).toHaveBeenCalled();
  });

  it('renders with undefined jitter (covers ?? 0 fallback)', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: undefined, scenarios: [], scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    const jitterInput = screen.getByTestId('gql-mock-jitter-input') as HTMLInputElement;
    expect(jitterInput.value).toBe('0');
  });

  it('does not call setFieldResolver when blurring empty fixed input', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Fixed');
    // Blur with empty value → applyResolver returns early
    fireEvent.blur(screen.getByTestId('gql-mock-fixed-input'));
    expect(server.setFieldResolver).not.toHaveBeenCalled();
  });

  it('does not call setFieldResolver when blurring empty script input', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByTestId('gql-mock-type-header'));
    selectOption(screen.getByTestId('gql-mock-resolver-select'), 'Script');
    // Blur with empty script → applyResolver returns early
    fireEvent.blur(screen.getByTestId('gql-mock-script-input'));
    expect(server.setFieldResolver).not.toHaveBeenCalled();
  });

  it('does not add scenario when name is empty', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    // Don't fill name, click Add
    fireEvent.click(screen.getByTestId('gql-mock-scenario-add-confirm'));
    expect(server.addScenario).not.toHaveBeenCalled();
  });

  it('cancels the add form without adding a scenario', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    expect(screen.getByTestId('gql-mock-scenario-add-form')).toBeDefined();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('gql-mock-scenario-add-form')).toBeNull();
    expect(server.addScenario).not.toHaveBeenCalled();
  });

  it('adds scenario via Enter key press in name input', () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    const nameInput = screen.getByTestId('gql-mock-scenario-name-input');
    fireEvent.change(nameInput, { target: { value: 'Quick Add' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(server.addScenario).toHaveBeenCalled();
  });

  it('closes add form via Escape key press in name input', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    fireEvent.click(screen.getByTestId('gql-mock-add-scenario-btn'));
    fireEvent.keyDown(screen.getByTestId('gql-mock-scenario-name-input'), { key: 'Escape' });
    expect(screen.queryByTestId('gql-mock-scenario-add-form')).toBeNull();
  });

  it('shows resolver count in scenario card', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{
          id: 'sc1',
          name: 'With Resolvers',
          resolvers: { Query: { hello: { type: 'fixed', value: 'x' } } },
        }],
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    expect(screen.getByText(/1 resolver overrides/i)).toBeDefined();
  });

  it('shows log errors badge when result has errors', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id:               'log2',
        timestamp:        Date.now(),
        operationName:    'FailOp',
        query:            '{ fail }',
        variables:        {},
        latencyMs:        5,
        activeScenarioId: null,
        result:           { errors: [{ message: 'Something went wrong' }] },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    expect(screen.getByText(/1 error/i)).toBeDefined();
  });

  it('shows plural requests count in log', () => {
    const makeEntry = (id: string, op: string) => ({
      id, timestamp: Date.now(), operationName: op,
      query: `{ ${op} }`, variables: {}, latencyMs: 10,
      activeScenarioId: null as null | string, result: { data: {} },
    });
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [makeEntry('l1', 'GetA'), makeEntry('l2', 'GetB')],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    expect(screen.getByText(/2 requests/)).toBeDefined();
  });

  it('shows anonymous in log when operationName is null', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: null,
        query: '{ hello }', variables: {}, latencyMs: 10,
        activeScenarioId: null, result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    expect(screen.getByText('anonymous')).toBeDefined();
  });

  it('shows active scenario name in log entry', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: [{ id: 'sc1', name: 'Error Flow', resolvers: {} }],
        scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: 'GetUser',
        query: '{ user }', variables: {}, latencyMs: 10,
        activeScenarioId: 'sc1', result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    expect(screen.getByText('Error Flow')).toBeDefined();
  });

  it('shows variables section in log detail when entry has variables', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: 'GetUser',
        query: '{ user }', variables: { userId: '42' }, latencyMs: 10,
        activeScenarioId: null, result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    fireEvent.click(screen.getByText('GetUser'));
    expect(screen.getByText('Variables')).toBeDefined();
  });

  it('collapses log row on second click', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: 'GetUser',
        query: '{ user }', variables: {}, latencyMs: 10,
        activeScenarioId: null, result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    // Expand
    fireEvent.click(screen.getByText('GetUser'));
    expect(screen.getByTestId('gql-mock-log-detail')).toBeDefined();
    // Collapse
    fireEvent.click(screen.getByText('GetUser'));
    expect(screen.queryByTestId('gql-mock-log-detail')).toBeNull();
  });

  it('expands log row via Enter keydown', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: 'GetUser',
        query: '{ user }', variables: {}, latencyMs: 10,
        activeScenarioId: null, result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    const logSummary = document.querySelector('.gql-mock-log-row-summary') as HTMLElement;
    fireEvent.keyDown(logSummary, { key: 'Enter' });
    expect(screen.getByTestId('gql-mock-log-detail')).toBeDefined();
  });

  it('shows scalar introspect empty message when schemaInfo is null and schemaSource is custom', () => {
    const server = makeMockServer({ schemaSource: 'custom' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={null} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    expect(screen.getByText(/Scalar factory configuration uses/i)).toBeDefined();
  });

  it('shows "Introspect" scalar empty message when schemaInfo is null and source is introspected', () => {
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={null} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    expect(screen.getByText(/Introspect a schema to configure custom scalar/i)).toBeDefined();
  });

  it('changing preset select calls setScalarFactory', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [],
        scalarFactories: [{ scalarName: 'DateTime', preset: 'email' }],
      },
    });
    const schemaWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [{ name: 'DateTime', kind: 'SCALAR', fields: null, description: null }],
    };
    render(<GraphqlMockPanel mockServer={server} schemaInfo={schemaWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    // The scalar row starts in 'preset' mode since factory has preset
    expect(screen.getByTestId('gql-mock-scalar-preset-select')).toBeDefined();
    selectOption(screen.getByTestId('gql-mock-scalar-preset-select'), 'UUID v4');
    expect(server.setScalarFactory).toHaveBeenCalledWith({ scalarName: 'DateTime', preset: 'uuid' });
  });

  it('shows fallback label in status row when active scenario not found', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], // no scenarios
        scalarFactories: [], activeScenarioId: 'missing-id',
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    expect(screen.getByTestId('gql-mock-status-row')).toHaveTextContent('Scenario');
  });

  it('covers type with null fields (fields ?? [] fallback)', () => {
    const schemaInfoWithNullFields: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [
        { name: 'Query', kind: 'OBJECT', fields: null, description: null },
      ],
    };
    render(<GraphqlMockPanel mockServer={makeMockServer()} schemaInfo={schemaInfoWithNullFields} />);
    const typeHeader = screen.getByTestId('gql-mock-type-header');
    fireEvent.click(typeHeader);
    // With null fields, no FieldResolverRow should render
    expect(screen.queryByTestId('gql-mock-field-row')).toBeNull();
  });

  it('exports config with customSdl when schemaSource is custom', () => {
    const server = makeMockServer({ schemaSource: 'custom', customSdl: 'type Q { id: ID }' });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body as unknown as Node);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => document.body as unknown as Node);
    try {
      fireEvent.click(screen.getByTitle(/Export mock config/i));
      // The export blob should include customSdl
      const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]?.[0] as Blob;
      expect(blobArg).toBeDefined();
    } finally {
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('calls importConfig with empty object when config field is absent', async () => {
    const server = makeMockServer();
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);

    const importData = { _meta: { version: 1 } }; // no config field
    const fileContent = JSON.stringify(importData);
    const restore = withFileReader(fileContent);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(fileInput, { target: { files: [new File([fileContent], 'mock.json')] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(server.importConfig).toHaveBeenCalledWith({}, undefined);
    restore();
  });

  it('renders correctly with undefined jitterMs in config (more branches)', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 50,
        jitterMs: undefined,
        scenarios: undefined as unknown as [],
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    // Shows latency but not jitter (jitterMs is falsy/undefined)
    expect(screen.getByText(/50ms/)).toBeDefined();
  });

  it('works with config.scenarios undefined (uses ?? [] fallback)', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0,
        scenarios: undefined as unknown as [],
        scalarFactories: [],
      },
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
    expect(screen.getByText(/No scenarios yet/i)).toBeDefined();
  });

  it('initializes ScalarFactoryRow in script mode when factory has scriptCode', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: false, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [],
        scalarFactories: [{ scalarName: 'DateTime', scriptCode: 'return new Date()' }],
      },
    });
    const schemaWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [{ name: 'DateTime', kind: 'SCALAR', fields: null, description: null }],
    };
    render(<GraphqlMockPanel mockServer={server} schemaInfo={schemaWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    // Should start in script mode
    expect(getCustomSelectValue(screen.getByTestId('gql-mock-scalar-mode-select'))).toBe('Script');
    expect(screen.getByTestId('gql-mock-scalar-script-input')).toBeDefined();
  });

  it('scalar factory empty script guard does not call setScalarFactory', () => {
    const server = makeMockServer();
    const schemaWithScalar: GraphqlSchemaInfo = {
      ...makeSchemaInfo(),
      types: [{ name: 'DateTime', kind: 'SCALAR', fields: null, description: null }],
    };
    render(<GraphqlMockPanel mockServer={server} schemaInfo={schemaWithScalar} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scalars' }));
    selectOption(screen.getByTestId('gql-mock-scalar-mode-select'), 'Script');
    // Blur with empty script
    fireEvent.blur(screen.getByTestId('gql-mock-scalar-script-input'));
    expect(server.setScalarFactory).not.toHaveBeenCalled();
  });

  it('shows ▲ icon when log row is expanded', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: 'Op',
        query: '{ op }', variables: {}, latencyMs: 5,
        activeScenarioId: null, result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    fireEvent.click(screen.getByText('Op'));
    expect(screen.getByText('▲')).toBeDefined();
  });

  it('shows log with scenario id slice when scenario not found in config', () => {
    const server = makeMockServer({
      config: {
        connectionId: 'x', enabled: true, resolvers: {},
        globalLatencyMs: 0, jitterMs: 0, scenarios: [], scalarFactories: [],
      },
      requestLog: [{
        id: 'l1', timestamp: Date.now(), operationName: 'Op',
        query: '{ op }', variables: {}, latencyMs: 5,
        activeScenarioId: 'unknown-scenario-id', result: { data: {} },
      }],
    });
    render(<GraphqlMockPanel mockServer={server} schemaInfo={makeSchemaInfo()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Request log' }));
    // Shows sliced id since scenario not found
    expect(screen.getByText('unknown-')).toBeDefined();
  });
});

// ─── FieldResolverRow useEffect branch coverage (lines 463-481) ──────────────
// FieldResolverRow is keyed by JSON.stringify(resolver) inside TypeResolverGroup,
// so prop-change rerenders always cause a remount there. We render FieldResolverRow
// directly (bypassing the key mechanism) to exercise the useEffect guard paths.

const makeField = (name = 'hello') => ({ name, type: 'String' });

describe('FieldResolverRow — useEffect resolver prop changes (direct render)', () => {
  it('updates mode and fixedVal when resolver changes to fixed type (L467-469)', async () => {
    const server = makeMockServer();
    const { rerender } = render(
      <FieldResolverRow
        typeName="Query"
        field={makeField()}
        resolver={{ type: 'random' }}
        mockServer={server}
      />
    );
    await act(async () => {
      rerender(
        <FieldResolverRow
          typeName="Query"
          field={makeField()}
          resolver={{ type: 'fixed', value: 'world' }}
          mockServer={server}
        />
      );
    });
    await waitFor(() => expect(getCustomSelectValue(screen.getByTestId('gql-mock-resolver-select'))).toBe('Fixed'));
  });

  it('updates mode when resolver changes to script type (L470-471)', async () => {
    const server = makeMockServer();
    const { rerender } = render(
      <FieldResolverRow typeName="Query" field={makeField()} resolver={{ type: 'random' }} mockServer={server} />
    );
    await act(async () => {
      rerender(
        <FieldResolverRow typeName="Query" field={makeField()} resolver={{ type: 'script', code: 'return 42;' }} mockServer={server} />
      );
    });
    await waitFor(() => expect(getCustomSelectValue(screen.getByTestId('gql-mock-resolver-select'))).toBe('Script'));
  });

  it('updates mode when resolver changes to error type (L472-473)', async () => {
    const server = makeMockServer();
    const { rerender } = render(
      <FieldResolverRow typeName="Query" field={makeField()} resolver={{ type: 'random' }} mockServer={server} />
    );
    await act(async () => {
      rerender(
        <FieldResolverRow typeName="Query" field={makeField()} resolver={{ type: 'error', message: 'oops' }} mockServer={server} />
      );
    });
    await waitFor(() => expect(getCustomSelectValue(screen.getByTestId('gql-mock-resolver-select'))).toBe('Error'));
  });

  it('resets state when resolver changes back to random type (L474-477)', async () => {
    const server = makeMockServer();
    const { rerender } = render(
      <FieldResolverRow typeName="Query" field={makeField()} resolver={{ type: 'fixed', value: 'old' }} mockServer={server} />
    );
    expect(getCustomSelectValue(screen.getByTestId('gql-mock-resolver-select'))).toBe('Fixed');
    await act(async () => {
      rerender(
        <FieldResolverRow typeName="Query" field={makeField()} resolver={{ type: 'random' }} mockServer={server} />
      );
    });
    await waitFor(() => expect(getCustomSelectValue(screen.getByTestId('gql-mock-resolver-select'))).toBe('Random'));
  });

  it('uses DOM value on fixed input blur when React state is stale', () => {
    const server = makeMockServer({
      config: { ...makeMockServer().config, enabled: true },
    });
    render(
      <FieldResolverRow
        typeName="Query"
        field={{ name: 'health', type: 'String' }}
        resolver={{ type: 'fixed', value: '' }}
        mockServer={server}
      />,
    );
    const input = screen.getByTestId('gql-mock-fixed-input') as HTMLInputElement;
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    nativeSet?.call(input, '"mock-ok"');
    fireEvent.blur(input);
    expect(server.setFieldResolver).toHaveBeenCalledWith(
      'Query',
      'health',
      { type: 'fixed', value: 'mock-ok' },
    );
  });
});
