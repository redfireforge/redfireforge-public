import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CustomSelect } from '@shared/components/CustomSelect';
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';
import type {
  GraphqlMockConfig,
  GraphqlSchemaInfo,
  MockScalarFactory,
  MockScalarPreset,
  MockScenario,
} from '@shared/types/graphql';
import type {
  MockRequestLogEntry,
  MockSchemaSource,
  UseGraphqlMockServerResult,
} from '../hooks/useGraphqlMockServer';
import { loadCachedGraphqlSchemaSdl } from '../utils/graphqlSchemaCache';
import { ResolversTab } from './GraphqlMockResolversTab';

export { FieldResolverRow } from './GraphqlMockResolversTab';

const MOCK_ENDPOINT = 'http://localhost:3001/api/graphql/mock';

const SCALAR_PRESETS: { value: MockScalarPreset; label: string }[] = [
  { value: 'email',    label: 'Email address' },
  { value: 'date-iso', label: 'ISO date string' },
  { value: 'uuid',     label: 'UUID v4' },
  { value: 'url',      label: 'URL' },
  { value: 'phone',    label: 'Phone number' },
  { value: 'name',     label: 'Person name' },
  { value: 'sentence', label: 'Lorem sentence' },
];

type MockPanelTab = 'resolvers' | 'scenarios' | 'scalars' | 'log';

interface MockEmptyStateProps {
  title: string;
  hint: ReactNode;
  action?: ReactNode;
}

function MockEmptyState({ title, hint, action }: MockEmptyStateProps) {
  return (
    <div className="gql-mock-empty" data-testid="gql-mock-empty">
      <div className="gql-mock-empty-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M8 12h8M12 8v8" />
        </svg>
      </div>
      <div className="gql-mock-empty-title">{title}</div>
      <div className="gql-mock-empty-hint">{hint}</div>
      {action}
    </div>
  );
}

interface GraphqlMockPanelProps {
  mockServer:      UseGraphqlMockServerResult;
  schemaInfo:      GraphqlSchemaInfo | null;
}

export function GraphqlMockPanel({ mockServer, schemaInfo }: GraphqlMockPanelProps) {
  const [activeTab, setActiveTab] = useState<MockPanelTab>('resolvers');
  const importInputRef = useRef<HTMLInputElement>(null);

  const { config, customSdl, schemaSource, syncError, syncing } = mockServer;

  const resolverCount = useMemo(() =>
    Object.values(config.resolvers).reduce((s, f) => s + Object.keys(f).length, 0),
  [config.resolvers]);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const reconcile = () => { void mockServer.syncFromServerStatus(); };
    window.addEventListener('rf-gql-mock-reconcile', reconcile);
    return () => window.removeEventListener('rf-gql-mock-reconcile', reconcile);
  }, [mockServer]);

  if (!isDesktopRuntimeAvailable()) {
    return (
      <div className="gql-mock-guard" data-testid="gql-mock-guard">
        <div className="gql-mock-guard-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </div>
        <div className="gql-mock-guard-title">Desktop app required</div>
        <div className="gql-mock-guard-body">
          The GraphQL mock server runs inside the RedfireForge desktop proxy.
          It is not available in the web version.
        </div>
        <a
          href="https://github.com/redfire/redfire-forge/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="gql-mock-guard-link"
        >
          Download the desktop app →
        </a>
      </div>
    );
  }

  const hasIntrospectedSdl = !!(schemaInfo?.sdl?.trim())
    || !!(config.connectionId && loadCachedGraphqlSchemaSdl(config.connectionId));
  const hasSdl = schemaSource === 'introspected'
    ? hasIntrospectedSdl
    : customSdl.trim().length > 0;

  const handleExport = () => {
    const exportData = {
      _meta: { version: 1, exportedAt: new Date().toISOString() },
      config: {
        resolvers:        config.resolvers,
        globalLatencyMs:  config.globalLatencyMs,
        jitterMs:         config.jitterMs,
        seed:             config.seed,
        scenarios:        config.scenarios,
        scalarFactories:  config.scalarFactories,
        activeScenarioId: config.activeScenarioId,
      },
      ...(schemaSource === 'custom' && customSdl ? { customSdl } : {}),
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `mock-config-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 150);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      setImportError('Failed to read file — please try again.');
    };
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string) as Record<string, unknown>;
        if (typeof raw !== 'object' || Array.isArray(raw) || !raw) {
          setImportError('Invalid mock config file — expected a JSON object.');
          return;
        }
        const data = raw as { config?: Partial<GraphqlMockConfig>; customSdl?: string };
        const cfg = data.config;
        if (cfg !== undefined && (typeof cfg !== 'object' || Array.isArray(cfg))) {
          setImportError('Invalid mock config file — "config" field must be an object.');
          return;
        }
        mockServer.importConfig(cfg ?? {}, data.customSdl);
        setImportError(null);
      } catch {
        setImportError('Invalid mock config file — could not parse JSON.');
      }
    };
    reader.readAsText(file);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleCopyEndpoint = async () => {
    try { await navigator.clipboard.writeText(MOCK_ENDPOINT); } catch { /* ignore */ }
  };

  return (
    <div className="gql-mock-panel" data-testid="gql-mock-panel">
      <div className="gql-mock-header">
        <div className="gql-mock-header-top">
          <div className="gql-mock-header-copy">
            <h2 className="gql-mock-title">Mock server</h2>
            <p className="gql-mock-subtitle">In-process GraphQL proxy for offline testing</p>
          </div>
          {syncing && (
            <span className="gql-mock-sync-badge" data-testid="gql-mock-sync-badge" aria-live="polite">
              Syncing…
            </span>
          )}
        </div>

        <div
          className={`gql-mock-toggle-card${config.enabled ? ' gql-mock-toggle-card--on' : ''}`}
          data-testid="gql-mock-toggle-card"
        >
          <label className="gql-mock-toggle-label">
            <input
              type="checkbox"
              className="gql-mock-toggle-input"
              checked={config.enabled}
              disabled={!hasSdl || syncing}
              onChange={(e) => mockServer.setEnabled(e.target.checked)}
              data-testid="gql-mock-toggle"
            />
            <span className="gql-mock-toggle-slider" />
            <span className="gql-mock-toggle-text">
              {config.enabled ? 'Mock mode ON' : 'Mock mode OFF'}
            </span>
          </label>
          {!hasSdl && (
            <span className="gql-mock-no-sdl">Introspect first or provide SDL</span>
          )}
        </div>

        {syncError && (
          <div className="gql-mock-sync-error" data-testid="gql-mock-sync-error">
            {syncError}
          </div>
        )}

        {config.enabled && (
          <div className="gql-mock-status-row" data-testid="gql-mock-status-row">
            <span className="gql-mock-status-badge">Mock active</span>
            {resolverCount > 0 && (
              <span className="gql-mock-status-chip">
                {resolverCount} override{resolverCount !== 1 ? 's' : ''}
              </span>
            )}
            {(config.globalLatencyMs ?? 0) > 0 && (
              <span className="gql-mock-status-chip">
                {config.globalLatencyMs}ms
                {(config.jitterMs ?? 0) > 0 && ` ±${config.jitterMs}ms`}
              </span>
            )}
            {config.activeScenarioId && (
              <span className="gql-mock-status-chip">
                {config.scenarios?.find((s) => s.id === config.activeScenarioId)?.name ?? 'Scenario'}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="gql-mock-settings">
        {/* ─ Schema source ─ */}
        <div className="gql-mock-form-card" data-testid="gql-mock-schema-source">
          <div className="gql-mock-section-label">Schema source</div>
          <div className="gql-mock-segment" role="radiogroup" aria-label="Schema source">
            {([
              { id: 'introspected' as MockSchemaSource, title: 'Introspected schema', desc: 'Reuse SDL from the last introspection' },
              { id: 'custom' as MockSchemaSource, title: 'Custom SDL', desc: 'Paste or edit schema by hand' },
            ]).map(({ id, title, desc }) => (
              <label
                key={id}
                className={`gql-mock-segment-option${schemaSource === id ? ' gql-mock-segment-option--active' : ''}`}
              >
                <input
                  type="radio"
                  name="mock-schema-source"
                  value={id}
                  checked={schemaSource === id}
                  onChange={() => mockServer.setSchemaSource(id)}
                  className="gql-mock-segment-input"
                />
                <span className="gql-mock-segment-body">
                  <span className="gql-mock-segment-title">{title}</span>
                  <span className="gql-mock-segment-desc">{desc}</span>
                </span>
              </label>
            ))}
          </div>
          {schemaSource === 'custom' && (
            <textarea
              className="gql-mock-sdl-editor"
              value={customSdl}
              onChange={(e) => mockServer.setCustomSdl(e.target.value)}
              onBlur={() => mockServer.syncCustomSdlNow()}
              placeholder="type Query { ... }"
              rows={6}
              data-testid="gql-mock-sdl-editor"
            />
          )}
        </div>

        {/* ─ Latency / Jitter / Seed ─ */}
        <div className="gql-mock-form-card gql-mock-timing-card">
          <div className="gql-mock-section-label">Response timing</div>
          <div className="gql-mock-form-row">
            <label className="gql-mock-form-label" htmlFor="gql-mock-latency-slider">Latency</label>
            <div className="gql-mock-form-ctrl gql-mock-form-ctrl--slider">
              <input
                id="gql-mock-latency-slider"
                type="range"
                min={0}
                max={5000}
                step={50}
                value={config.globalLatencyMs ?? 0}
                onChange={(e) => mockServer.setGlobalLatency(parseInt(e.target.value, 10))}
                className="gql-mock-slider"
                data-testid="gql-mock-latency-slider"
              />
              <span className="gql-mock-latency-value" data-testid="gql-mock-latency-value">
                {config.globalLatencyMs ?? 0} ms
              </span>
            </div>
          </div>
          <div className="gql-mock-form-row">
            <label className="gql-mock-form-label" htmlFor="gql-mock-jitter-input">Jitter</label>
            <div className="gql-mock-form-ctrl">
              <input
                id="gql-mock-jitter-input"
                type="number"
                min={0}
                max={2000}
                step={10}
                value={config.jitterMs ?? 0}
                onChange={(e) => mockServer.setJitter(parseInt(e.target.value, 10) || 0)}
                className="gql-mock-number-input"
                data-testid="gql-mock-jitter-input"
              />
              <span className="gql-mock-form-hint">± ms around latency</span>
            </div>
          </div>
          <div className="gql-mock-form-row gql-mock-form-row--muted">
            <label className="gql-mock-form-label" htmlFor="gql-mock-seed-input">Seed</label>
            <div className="gql-mock-form-ctrl">
              <input
                id="gql-mock-seed-input"
                type="number"
                min={0}
                value={config.seed ?? ''}
                onChange={(e) => mockServer.setSeed(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                className="gql-mock-number-input"
                placeholder="Random"
                data-testid="gql-mock-seed-input"
                title="Seed-based deterministic randomness is not yet implemented"
              />
              <span className="gql-mock-form-hint">Coming soon — stored but not applied yet</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─ Panel tabs ─ */}
      <div className="gql-mock-tabs" role="tablist" aria-label="Mock server sections">
        {([
          { id: 'resolvers' as MockPanelTab, label: 'Resolvers' },
          { id: 'scenarios' as MockPanelTab, label: 'Scenarios' },
          { id: 'scalars'   as MockPanelTab, label: 'Scalars' },
          { id: 'log'       as MockPanelTab, label: 'Request log' },
        ]).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`gql-mock-tab${activeTab === id ? ' gql-mock-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─ Tab content ─ */}
      <div className="gql-mock-tab-content">
        {activeTab === 'resolvers' && (
          <ResolversTab config={config} schemaInfo={schemaInfo} mockServer={mockServer} schemaSource={schemaSource} />
        )}
        {activeTab === 'scenarios' && (
          <ScenariosTab config={config} mockServer={mockServer} />
        )}
        {activeTab === 'scalars' && (
          <ScalarFactoriesTab config={config} schemaInfo={schemaInfo} mockServer={mockServer} schemaSource={schemaSource} />
        )}
        {activeTab === 'log' && (
          <RequestLogTab
            log={mockServer.requestLog}
            scenarios={config.scenarios ?? []}
            onRefresh={mockServer.refreshLog}
            enabled={config.enabled}
          />
        )}
      </div>

      {/* ─ Footer actions ─ */}
      {importError && (
        <div className="gql-mock-import-error" role="alert" data-testid="gql-mock-import-error">
          {importError}
          <button type="button" className="gql-mock-import-error-close" onClick={() => setImportError(null)} aria-label="Dismiss import error">✕</button>
        </div>
      )}
      <div className="gql-mock-footer" data-testid="gql-mock-footer">
        <button type="button" className="gql-mock-footer-btn" onClick={handleExport} title="Export mock config as JSON">
          Export
        </button>
        <label className="gql-mock-footer-btn gql-mock-footer-btn--import" title="Import mock config from JSON">
          Import
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="gql-mock-import-input"
            onChange={handleImport}
          />
        </label>
        <button type="button" className="gql-mock-footer-btn" onClick={handleCopyEndpoint} title="Copy mock endpoint URL">
          Copy URL
        </button>
        <button type="button" className="gql-mock-footer-btn gql-mock-footer-btn--danger" onClick={mockServer.resetAll} title="Reset all resolvers and config">
          Reset all
        </button>
      </div>
    </div>
  );
}

function ScenariosTab({ config, mockServer }: { config: GraphqlMockConfig; mockServer: UseGraphqlMockServerResult }) {
  const [adding, setAdding]         = useState(false);
  const [newName, setNewName]       = useState('');
  const [snapResolvers, setSnapResolvers] = useState(true);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const scenario: MockScenario = {
      id:        crypto.randomUUID(),
      name:      newName.trim(),
      // When snapResolvers is on, snapshot the current resolver overrides as the scenario's starting state
      resolvers: snapResolvers ? JSON.parse(JSON.stringify(config.resolvers)) as typeof config.resolvers : {},
    };
    mockServer.addScenario(scenario);
    setNewName('');
    setAdding(false);
  };

  const scenarios = config.scenarios ?? [];

  return (
    <div className="gql-mock-scenarios" data-testid="gql-mock-scenarios">
      {scenarios.length === 0 && !adding && (
        <MockEmptyState
          title="No scenarios yet"
          hint="Save named resolver presets and switch between them with one click."
        />
      )}

      {scenarios.map((s) => (
        <div
          key={s.id}
          className={`gql-mock-scenario-card${config.activeScenarioId === s.id ? ' gql-mock-scenario-card--active' : ''}`}
          data-testid="gql-mock-scenario-card"
        >
          <div className="gql-mock-scenario-header">
            <span className="gql-mock-scenario-name">{s.name}</span>
            <div className="gql-mock-scenario-actions">
              {config.activeScenarioId !== s.id ? (
                <button
                  type="button"
                  className="gql-mock-scenario-activate"
                  onClick={() => mockServer.activateScenario(s.id)}
                  data-testid="gql-mock-scenario-activate"
                >
                  Activate
                </button>
              ) : (
                <button
                  type="button"
                  className="gql-mock-scenario-deactivate"
                  onClick={() => mockServer.activateScenario(undefined)}
                  title="Deactivate this scenario"
                  data-testid="gql-mock-scenario-deactivate"
                >
                  ✓ Active
                </button>
              )}
              <button
                type="button"
                className="gql-mock-scenario-delete"
                onClick={() => mockServer.deleteScenario(s.id)}
                title="Delete scenario"
                aria-label={`Delete scenario ${s.name}`}
                data-testid="gql-mock-scenario-delete"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="gql-mock-scenario-resolvers-count">
            {Object.values(s.resolvers ?? {}).reduce((n, f) => n + Object.keys(f).length, 0)} resolver overrides
          </div>
        </div>
      ))}

      {adding ? (
        <div className="gql-mock-scenario-add-form" data-testid="gql-mock-scenario-add-form">
          <input
            type="text"
            className="gql-mock-scenario-name-input"
            value={newName}
            placeholder="Enter scenario name..."
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
            autoFocus
            data-testid="gql-mock-scenario-name-input"
          />
          <label className="gql-mock-scenario-snap-label" title="Capture current resolver overrides into this scenario">
            <input
              type="checkbox"
              checked={snapResolvers}
              onChange={(e) => setSnapResolvers(e.target.checked)}
              data-testid="gql-mock-scenario-snap-checkbox"
            />
            Snapshot current resolvers into this scenario
          </label>
          <div className="gql-mock-scenario-add-actions">
            <button type="button" className="gql-mock-cancel-btn" onClick={() => { setAdding(false); setNewName(''); setSnapResolvers(true); }}>Cancel</button>
            <button
              type="button"
              className="gql-mock-add-btn"
              onClick={handleAdd}
              disabled={!newName.trim()}
              title={!newName.trim() ? 'Enter a scenario name' : 'Create new scenario'}
              data-testid="gql-mock-scenario-add-confirm"
              style={!newName.trim() ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
              Create Scenario
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="gql-mock-add-scenario-btn"
          onClick={() => setAdding(true)}
          data-testid="gql-mock-add-scenario-btn"
        >
          Add Scenario
        </button>
      )}
    </div>
  );
}

// ─── ScalarFactoriesTab ───────────────────────────────────────────────────────

interface ScalarFactoriesTabProps {
  config:       GraphqlMockConfig;
  schemaInfo:   GraphqlSchemaInfo | null;
  mockServer:   UseGraphqlMockServerResult;
  schemaSource: MockSchemaSource;
}

function ScalarFactoriesTab({ config, schemaInfo, mockServer, schemaSource }: ScalarFactoriesTabProps) {
  // Find custom scalar types from schema
  const customScalars = useMemo(() =>
    (schemaInfo?.types ?? [])
      .filter((t) => t.kind === 'SCALAR' && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(t.name))
      .map((t) => t.name),
  [schemaInfo]);

  if (customScalars.length === 0) {
    const emptyMsg = schemaInfo
      ? 'No custom scalar types found in schema. Custom scalars like DateTime or EmailAddress appear here when the schema contains them.'
      : schemaSource === 'custom'
        ? 'Scalar factory configuration uses the introspected schema type list. Switch to "Introspected schema" and introspect first to configure scalar factories.'
        : 'Introspect a schema to configure custom scalar factories.';
    return (
      <MockEmptyState
        title="No custom scalars"
        hint={emptyMsg}
      />
    );
  }

  return (
    <div className="gql-mock-scalar-factories" data-testid="gql-mock-scalar-factories">
      {customScalars.map((scalarName) => {
        const factory = config.scalarFactories?.find((f) => f.scalarName === scalarName);
        return (
          <ScalarFactoryRow
            key={`${scalarName}-${JSON.stringify(factory ?? null)}`}
            scalarName={scalarName}
            factory={factory}
            mockServer={mockServer}
          />
        );
      })}
    </div>
  );
}

interface ScalarFactoryRowProps {
  scalarName: string;
  factory:    MockScalarFactory | undefined;
  mockServer: UseGraphqlMockServerResult;
}

function ScalarFactoryRow({ scalarName, factory, mockServer }: ScalarFactoryRowProps) {
  const [mode, setMode]     = useState<'random' | 'preset' | 'script'>(
    factory?.preset ? 'preset' : factory?.scriptCode ? 'script' : 'random',
  );
  const [preset, setPreset] = useState<MockScalarPreset>(factory?.preset ?? 'email');
  const [script, setScript] = useState(factory?.scriptCode ?? '');

  const apply = (m: typeof mode, p: MockScalarPreset, sc: string) => {
    if (m === 'random') {
      mockServer.removeScalarFactory(scalarName);
    } else if (m === 'preset') {
      mockServer.setScalarFactory({ scalarName, preset: p });
    } else {
      // Don't persist empty scripts — same guard as FieldResolverRow
      if (!sc.trim()) return;
      mockServer.setScalarFactory({ scalarName, scriptCode: sc });
    }
  };

  return (
    <div className="gql-mock-scalar-row" data-testid="gql-mock-scalar-row">
      <span className="gql-mock-scalar-name">{scalarName}</span>
      <CustomSelect
        className="gql-mock-resolver-select"
        value={mode}
        onChange={(v) => {
          const m = v as typeof mode;
          setMode(m);
          // Don't sync 'script' mode immediately with empty script — wait for onBlur
          if (m === 'script' && !script.trim()) return;
          apply(m, preset, script);
        }}
        options={[
          { value: 'random', label: 'Random (default)' },
          { value: 'preset', label: 'Preset' },
          { value: 'script', label: 'Script' },
        ]}
        data-testid="gql-mock-scalar-mode-select"
      />
      {mode === 'preset' && (
        <CustomSelect
          className="gql-mock-resolver-select"
          value={preset}
          onChange={(v) => { const p = v as MockScalarPreset; setPreset(p); apply('preset', p, script); }}
          options={SCALAR_PRESETS.map((sp) => ({ value: sp.value, label: sp.label }))}
          data-testid="gql-mock-scalar-preset-select"
        />
      )}
      {mode === 'script' && (
        <input
          type="text"
          className="gql-mock-fixed-input"
          value={script}
          placeholder='return new Date().toISOString()'
          onChange={(e) => setScript(e.target.value)}
          onBlur={() => apply('script', preset, script)}
          data-testid="gql-mock-scalar-script-input"
        />
      )}
    </div>
  );
}

// ─── RequestLogTab ────────────────────────────────────────────────────────────

function RequestLogTab({
  log,
  scenarios,
  onRefresh,
  enabled,
}: {
  log:       MockRequestLogEntry[];
  scenarios: MockScenario[];
  onRefresh: () => void;
  enabled:   boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!enabled) {
    return (
      <MockEmptyState
        title="Mock mode is off"
        hint="Turn on mock mode above, then execute queries against the mock endpoint to populate this log."
      />
    );
  }
  if (log.length === 0) {
    return (
      <MockEmptyState
        title="No requests yet"
        hint={<>Point your client at <code className="gql-mock-inline-code">{MOCK_ENDPOINT}</code> and run a query.</>}
        action={(
          <button type="button" className="gql-mock-refresh-btn" onClick={onRefresh}>
            Refresh
          </button>
        )}
      />
    );
  }

  return (
    <div className="gql-mock-log" data-testid="gql-mock-log">
      <div className="gql-mock-log-toolbar">
        <span className="gql-mock-log-count">{log.length} request{log.length !== 1 ? 's' : ''}</span>
        <button type="button" className="gql-mock-refresh-btn" onClick={onRefresh} data-testid="gql-mock-log-refresh">
          ⟳ Refresh
        </button>
      </div>
      {log.map((entry) => (
        <div
          key={entry.id}
          className="gql-mock-log-row"
          data-testid="gql-mock-log-row"
        >
          <div
            className="gql-mock-log-row-summary"
            onClick={() => setExpandedId((id) => id === entry.id ? null : entry.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedId((id) => id === entry.id ? null : entry.id); }}
          >
            <span className="gql-mock-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="gql-mock-log-op">{entry.operationName ?? 'anonymous'}</span>
            <span className="gql-mock-log-latency">{entry.latencyMs}ms</span>
            {entry.activeScenarioId && (
              <span className="gql-mock-log-scenario">
                {scenarios.find((s) => s.id === entry.activeScenarioId)?.name ?? entry.activeScenarioId.slice(0, 8)}
              </span>
            )}
            {entry.result.errors && entry.result.errors.length > 0 && (
              <span className="gql-mock-log-error-badge">⚠ {entry.result.errors.length} error{entry.result.errors.length !== 1 ? 's' : ''}</span>
            )}
            <span className="gql-mock-log-expand-icon">{expandedId === entry.id ? '▲' : '▼'}</span>
          </div>
          {expandedId === entry.id && (
            <div className="gql-mock-log-detail" data-testid="gql-mock-log-detail">
              <div className="gql-mock-log-detail-section">
                <div className="gql-mock-log-detail-label">Query</div>
                <pre className="gql-mock-log-code">{entry.query}</pre>
              </div>
              {Boolean(entry.variables && typeof entry.variables === 'object' && entry.variables !== null && Object.keys(entry.variables as Record<string, unknown>).length > 0) && (
                <div className="gql-mock-log-detail-section">
                  <div className="gql-mock-log-detail-label">Variables</div>
                  <pre className="gql-mock-log-code">{JSON.stringify(entry.variables, null, 2)}</pre>
                </div>
              )}
              <div className="gql-mock-log-detail-section">
                <div className="gql-mock-log-detail-label">Response</div>
                <pre className="gql-mock-log-code">{JSON.stringify(entry.result, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
