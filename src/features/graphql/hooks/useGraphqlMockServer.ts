/**
 * useGraphqlMockServer.ts — Phase 3E (task 3E-3)
 *
 * Client-side hook managing the GraphQL mock server state and sync.
 *
 * Responsibilities:
 *  - Persist GraphqlMockConfig to storage (under `graphql-mock-config-${connectionId}`)
 *  - Sync config to proxy server (POST /api/graphql/mock/config)
 *  - Debounce sync 300ms for resolver/latency changes
 *  - Immediate sync for enable/disable + scenario switches
 *  - Poll /api/graphql/mock/log every 2s when enabled
 *  - Custom SDL stored separately under `graphql-mock-sdl-${connectionId}`
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { readKey, writeKey } from '@shared/utils/storage';
import { getProxyBase } from '../utils/graphqlProxyTransports';
import { loadCachedGraphqlSchemaSdl } from '../utils/graphqlSchemaCache';
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';
import type {
  GraphqlMockConfig,
  MockResolver,
  MockScalarFactory,
  MockScenario,
} from '@shared/types/graphql';

const MOCK_PROXY_BASE = getProxyBase();
const DEBOUNCE_MS     = 300;
const LOG_POLL_MS     = 2_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockRequestLogEntry {
  id:               string;
  timestamp:        number;
  operationName:    string | null;
  query:            string;
  variables:        unknown;
  latencyMs:        number;
  activeScenarioId: string | null;
  result:           { data?: unknown; errors?: Array<{ message: string }> };
}

export interface MockServerStatus {
  enabled:             boolean;
  configured:          boolean;
  activeResolverCount: number;
  latencyMs:           number;
  jitterMs:            number;
  requestCount:        number;
  activeScenarioId:    string | null;
}

export type MockSchemaSource = 'introspected' | 'custom';

export interface UseGraphqlMockServerResult {
  config:         GraphqlMockConfig;
  customSdl:      string;
  schemaSource:   MockSchemaSource;
  syncError:      string | null;
  syncing:        boolean;
  requestLog:     MockRequestLogEntry[];
  status:         MockServerStatus | null;

  // Actions
  setEnabled:           (enabled: boolean) => void;
  setSchemaSource:      (source: MockSchemaSource) => void;
  setCustomSdl:         (sdl: string) => void;
  setFieldResolver:     (typeName: string, fieldName: string, resolver: MockResolver) => void;
  clearFieldResolver:   (typeName: string, fieldName: string) => void;
  setGlobalLatency:     (ms: number) => void;
  setJitter:            (ms: number) => void;
  setSeed:              (seed: number | undefined) => void;
  addScenario:          (scenario: MockScenario) => void;
  updateScenario:       (id: string, scenario: Partial<MockScenario>) => void;
  deleteScenario:       (id: string) => void;
  activateScenario:     (id: string | undefined) => void;
  setScalarFactory:     (factory: MockScalarFactory) => void;
  removeScalarFactory:  (scalarName: string) => void;
  importConfig:         (config: Partial<GraphqlMockConfig>, sdl?: string) => void;
  resetAll:             () => void;
  refreshLog:           () => void;
  syncCustomSdlNow:     () => void;
  /** Align UI toggle with proxy status when the server was enabled out-of-band (e.g. demo bootstrap). */
  syncFromServerStatus: () => Promise<void>;
}

// ─── Default config ───────────────────────────────────────────────────────────

function defaultConfig(connectionId: string): GraphqlMockConfig {
  return {
    connectionId,
    enabled:         false,
    resolvers:       {},
    globalLatencyMs: 0,
    jitterMs:        0,
    seed:            undefined,
    scenarios:       [],
    activeScenarioId: undefined,
    scalarFactories:  [],
  };
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Resolve SDL for mock sync — hook prop first, then persisted introspection cache. */
export function resolveMockSyncSdl(
  connectionId: string,
  schemaSource: MockSchemaSource,
  introspectedSdl: string | null,
  customSdl: string,
): string {
  if (schemaSource === 'custom') return customSdl.trim();
  const direct = (introspectedSdl ?? '').trim();
  if (direct) return direct;
  if (connectionId) {
    const cached = loadCachedGraphqlSchemaSdl(connectionId);
    if (cached?.trim()) return cached;
  }
  return '';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGraphqlMockServer(
  connectionId: string | null,
  introspectedSdl: string | null,
): UseGraphqlMockServerResult {
  const [config, setConfig]             = useState<GraphqlMockConfig>(() => defaultConfig(connectionId ?? ''));
  const [customSdl, setCustomSdlState]  = useState<string>('');
  const [schemaSource, setSchemaSourceState] = useState<MockSchemaSource>('introspected');
  const [syncError, setSyncError]       = useState<string | null>(null);
  const [syncing, setSyncing]           = useState(false);
  const [requestLog, setRequestLog]     = useState<MockRequestLogEntry[]>([]);
  const [status, setStatus]             = useState<MockServerStatus | null>(null);

  const debounceTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logPollIntervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // When true, the persist effects skip writing so a connection switch loading new config
  // doesn't race with persisting stale config from the previous connection.
  const isLoadingRef          = useRef(false);
  const configRef             = useRef<GraphqlMockConfig>(config);
  configRef.current           = config;
  const customSdlRef          = useRef<string>(customSdl);
  customSdlRef.current        = customSdl;
  const schemaSourceRef       = useRef<MockSchemaSource>(schemaSource);
  schemaSourceRef.current     = schemaSource;
  const introspectedSdlRef    = useRef<string | null>(introspectedSdl);
  introspectedSdlRef.current  = introspectedSdl;

  const syncFromServerStatus = useCallback(async () => {
    if (!isDesktopRuntimeAvailable() || isLoadingRef.current) return;
    try {
      const resp = await fetch(`${MOCK_PROXY_BASE}/api/graphql/mock/status`);
      if (!resp.ok) return;
      const data = await resp.json() as MockServerStatus;
      setStatus(data);
      if (data.enabled && data.configured && !configRef.current.enabled) {
        const next = { ...configRef.current, enabled: true };
        configRef.current = next;
        setConfig(next);
        setSyncError(null);
      } else if (data.enabled === false && configRef.current.enabled) {
        const next = { ...configRef.current, enabled: false };
        configRef.current = next;
        setConfig(next);
        setSyncError(null);
      }
    } catch {
      setStatus(null);
    }
  }, []);

  // ── Load persisted config on connectionId change ──────────────────────────
  useEffect(() => {
    // Cancel any pending debounced sync from the previous connection — it could
    // reconfigure the mock server with stale resolvers + the new connection's SDL.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // When switching connections, immediately tell the server to disable its mock so it
    // doesn't keep serving the previous connection's schema while the UI loads the new one.
    // Hosted web has no companion — skip. Local clone / desktop still sync.
    if (isDesktopRuntimeAvailable()) {
      void fetch(`${MOCK_PROXY_BASE}/api/graphql/mock/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }).catch(() => { /* non-fatal: proxy may not be running */ });
    }

    if (!connectionId) {
      setConfig(defaultConfig(''));
      setCustomSdlState('');
      setSchemaSourceState('introspected');
      setRequestLog([]);
      setStatus(null);
      return;
    }
    // Clear stale log/status from previous connection immediately on switch
    setRequestLog([]);
    setStatus(null);

    // Block the persist effects until the async load completes to prevent a race where the
    // persist effect writes old-connection config under the new connection's storage key.
    isLoadingRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const [savedJson, savedSdl, savedSource] = await Promise.all([
          readKey(`graphql-mock-config-${connectionId}`),
          readKey(`graphql-mock-sdl-${connectionId}`),
          readKey(`graphql-mock-source-${connectionId}`),
        ]);
        if (cancelled) return;
        const saved = safeParseJson<GraphqlMockConfig | null>(savedJson, null);
        if (saved && typeof saved === 'object') {
          // Always disable on load — user must re-enable manually after restart
          setConfig({ ...saved, connectionId, enabled: false });
        } else {
          setConfig(defaultConfig(connectionId));
        }
        if (typeof savedSdl === 'string' && savedSdl) setCustomSdlState(savedSdl);
        const src = savedSource as MockSchemaSource | null;
        if (src === 'introspected' || src === 'custom') setSchemaSourceState(src);
      } catch {
        // Storage read failed — fall back to defaults silently
        if (!cancelled) setConfig(defaultConfig(connectionId));
      } finally {
        // Always unblock persist effects, even on error.
        isLoadingRef.current = false;
        if (!cancelled) {
          void syncFromServerStatus();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [connectionId, syncFromServerStatus]);

  // ── Persist config whenever it changes ───────────────────────────────────
  // All three persist effects guard against `isLoadingRef.current` so they don't write
  // stale config from the previous connection while an async load is in progress.
  useEffect(() => {
    if (!connectionId || isLoadingRef.current) return;
    void writeKey(`graphql-mock-config-${connectionId}`, JSON.stringify(config));
  }, [connectionId, config]);

  useEffect(() => {
    if (!connectionId || isLoadingRef.current) return;
    void writeKey(`graphql-mock-sdl-${connectionId}`, customSdl);
  }, [connectionId, customSdl]);

  useEffect(() => {
    if (!connectionId || isLoadingRef.current) return;
    void writeKey(`graphql-mock-source-${connectionId}`, schemaSource);
  }, [connectionId, schemaSource]);

  // ── Sync helper ───────────────────────────────────────────────────────────
  /**
   * @param cfg - config to sync
   * @param sdl - SDL to use
   * @param immediate - true for enable/scenario switches; false for debounced edits
   * @param revertOnFailure - when true (explicit enable), revert `enabled` to false on any
   *   failure so the UI toggle stays consistent with actual server state. When false
   *   (debounced edit), only surface `syncError`; don't disable mock for a transient error.
   */
  const syncToServer = useCallback(async (
    cfg: GraphqlMockConfig,
    sdl: string,
    immediate = false,
    revertOnFailure = immediate,
  ) => {
    // Mock server needs the companion (local clone) or Tauri proxy.
    // Hosted web has neither — skip all network calls silently.
    if (!isDesktopRuntimeAvailable()) return;
    if (!immediate && !cfg.enabled) return;

    if (!cfg.enabled) {
      try {
        setSyncing(true);
        await fetch(`${MOCK_PROXY_BASE}/api/graphql/mock/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        setSyncError(null);
      } catch {
        setSyncError('Failed to contact mock server — is the proxy running?');
      } finally {
        setSyncing(false);
      }
      return;
    }

    if (!sdl.trim()) {
      setSyncError('No SDL available — introspect first or provide a custom SDL');
      if (revertOnFailure) {
        // Revert the enabled toggle: we cannot sync without SDL, so the server stays disabled.
        setConfig((prev) => ({ ...prev, enabled: false }));
        configRef.current = { ...configRef.current, enabled: false };
      }
      return;
    }

    try {
      setSyncing(true);
      const resp = await fetch(`${MOCK_PROXY_BASE}/api/graphql/mock/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdl, config: cfg }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: { message: resp.statusText } })) as { error: { message: string } };
        setSyncError(err?.error?.message ?? 'Unknown sync error');
        if (revertOnFailure) {
          // Revert the enabled toggle: server rejected the config so it is not actually enabled.
          setConfig((prev) => ({ ...prev, enabled: false }));
          configRef.current = { ...configRef.current, enabled: false };
        }
      } else {
        setSyncError(null);
      }
    } catch {
      setSyncError('Failed to contact mock server — is the proxy running?');
      if (revertOnFailure) {
        setConfig((prev) => ({ ...prev, enabled: false }));
        configRef.current = { ...configRef.current, enabled: false };
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  // ── Cleanup pending debounce on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // ── Debounced sync ─────────────────────────────────────────────────────────
  // Read introspectedSdl from a ref so the debounce closure always sees the latest value.
  const scheduleSync = useCallback((immediate = false) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const getSdl = () => resolveMockSyncSdl(
      configRef.current.connectionId,
      schemaSourceRef.current,
      introspectedSdlRef.current,
      customSdlRef.current,
    );

    if (immediate) {
      void syncToServer(configRef.current, getSdl(), true);
    } else {
      debounceTimerRef.current = setTimeout(() => {
        void syncToServer(configRef.current, getSdl(), false);
      }, DEBOUNCE_MS);
    }
  }, [syncToServer]);

  // ── Log polling ───────────────────────────────────────────────────────────
  const fetchLog = useCallback(async () => {
    if (!isDesktopRuntimeAvailable()) return;
    try {
      const resp = await fetch(`${MOCK_PROXY_BASE}/api/graphql/mock/log?limit=50`);
      if (resp.ok) {
        const data = await resp.json() as { entries: MockRequestLogEntry[] };
        setRequestLog(data.entries ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchStatus = useCallback(async () => {
    await syncFromServerStatus();
  }, [syncFromServerStatus]);

  useEffect(() => {
    if (config.enabled) {
      void fetchLog();
      void fetchStatus();
      logPollIntervalRef.current = setInterval(() => {
        void fetchLog();
        void fetchStatus();
      }, LOG_POLL_MS);
    } else {
      if (logPollIntervalRef.current) {
        clearInterval(logPollIntervalRef.current);
        logPollIntervalRef.current = null;
      }
    }
    return () => {
      if (logPollIntervalRef.current) clearInterval(logPollIntervalRef.current);
    };
  }, [config.enabled, fetchLog, fetchStatus]);

  // ── 3E-7: Re-sync when introspected SDL changes while mock is ON ──────────
  // When the user triggers a fresh introspection while mock is enabled with the
  // "Use introspected schema" source, the server must receive the updated SDL
  // immediately so the mock reflects the new schema.
  useEffect(() => {
    // Skip during async config load (connection switch) to avoid syncing stale config
    // from the previous connection against the new connection's SDL.
    if (isLoadingRef.current) return;
    if (
      config.enabled &&
      schemaSource === 'introspected' &&
      introspectedSdl
    ) {
      void syncToServer(config, introspectedSdl, true);
    }
  // Intentionally only run when introspectedSdl changes (not on every config change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introspectedSdl]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const setEnabled = useCallback((enabled: boolean) => {
    const next = { ...configRef.current, enabled };
    configRef.current = next;
    setConfig(next);
    const sdl = resolveMockSyncSdl(
      next.connectionId,
      schemaSourceRef.current,
      introspectedSdlRef.current,
      customSdlRef.current,
    );
    void syncToServer(next, sdl, true);
  }, [syncToServer]);

  const setSchemaSource = useCallback((source: MockSchemaSource) => {
    setSchemaSourceState(source);
    schemaSourceRef.current = source;
    if (configRef.current.enabled) {
      const sdl = resolveMockSyncSdl(
        configRef.current.connectionId,
        source,
        introspectedSdlRef.current,
        customSdlRef.current,
      );
      void syncToServer(configRef.current, sdl, true);
    }
  }, [syncToServer]);

  const setCustomSdl = useCallback((sdl: string) => {
    setCustomSdlState(sdl);
    customSdlRef.current = sdl;
  }, []);

  /**
   * Called on SDL editor blur — syncs to server only if mock is enabled
   * and the schema source is 'custom'.
   */
  const syncCustomSdlNow = useCallback(() => {
    if (configRef.current.enabled && schemaSourceRef.current === 'custom' && customSdlRef.current.trim()) {
      void syncToServer(configRef.current, customSdlRef.current, true);
    }
  // syncToServer is stable (empty dep array useCallback)
  }, [syncToServer]);

  const setFieldResolver = useCallback((typeName: string, fieldName: string, resolver: MockResolver) => {
    setConfig((prev) => {
      const next: GraphqlMockConfig = {
        ...prev,
        resolvers: {
          ...prev.resolvers,
          [typeName]: { ...(prev.resolvers[typeName] ?? {}), [fieldName]: resolver },
        },
      };
      configRef.current = next;
      return next;
    });
    const sdl = resolveMockSyncSdl(
      configRef.current.connectionId,
      schemaSourceRef.current,
      introspectedSdlRef.current,
      customSdlRef.current,
    );
    // Sync resolver overrides immediately; don't disable mock on transient SDL gaps.
    void syncToServer(configRef.current, sdl, true, false);
  }, [syncToServer]);

  const clearFieldResolver = useCallback((typeName: string, fieldName: string) => {
    setConfig((prev) => {
      const typeResolvers = { ...(prev.resolvers[typeName] ?? {}) };
      delete typeResolvers[fieldName];
      // Remove the type entry entirely when it has no remaining overrides so
      // the persisted config stays clean (no orphan {} entries).
      const newResolvers = { ...prev.resolvers };
      if (Object.keys(typeResolvers).length === 0) {
        delete newResolvers[typeName];
      } else {
        newResolvers[typeName] = typeResolvers;
      }
      const next: GraphqlMockConfig = { ...prev, resolvers: newResolvers };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const setGlobalLatency = useCallback((ms: number) => {
    setConfig((prev) => {
      const next = { ...prev, globalLatencyMs: Math.max(0, Math.round(ms)) };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const setJitter = useCallback((ms: number) => {
    setConfig((prev) => {
      const next = { ...prev, jitterMs: Math.max(0, Math.round(ms)) };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const setSeed = useCallback((seed: number | undefined) => {
    // Guard against NaN (e.g. from parseInt on empty/non-numeric input)
    const safeSeed = (seed !== undefined && Number.isNaN(seed)) ? undefined : seed;
    setConfig((prev) => {
      const next = { ...prev, seed: safeSeed };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const addScenario = useCallback((scenario: MockScenario) => {
    setConfig((prev) => {
      const next = { ...prev, scenarios: [...(prev.scenarios ?? []), scenario] };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const updateScenario = useCallback((id: string, updates: Partial<MockScenario>) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        scenarios: (prev.scenarios ?? []).map((s) => s.id === id ? { ...s, ...updates } : s),
      };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const deleteScenario = useCallback((id: string) => {
    // If the deleted scenario is the currently active one, use immediate sync so the
    // server stops applying it right away rather than waiting for the 300ms debounce.
    const wasActive = configRef.current.activeScenarioId === id;
    setConfig((prev) => {
      const next = {
        ...prev,
        scenarios: (prev.scenarios ?? []).filter((s) => s.id !== id),
        activeScenarioId: prev.activeScenarioId === id ? undefined : prev.activeScenarioId,
      };
      configRef.current = next;
      return next;
    });
    scheduleSync(wasActive);
  }, [scheduleSync]);

  const activateScenario = useCallback((id: string | undefined) => {
    // Validate that the requested scenario exists before activating to avoid orphaned IDs
    if (id !== undefined && !configRef.current.scenarios?.some((s) => s.id === id)) {
      console.warn(`[useGraphqlMockServer] activateScenario: scenario "${id}" not found — ignoring`);
      return;
    }
    const next = { ...configRef.current, activeScenarioId: id };
    configRef.current = next;
    setConfig(next);
    const sdl = resolveMockSyncSdl(
      next.connectionId,
      schemaSourceRef.current,
      introspectedSdlRef.current,
      customSdlRef.current,
    );
    void syncToServer(next, sdl, true);
  }, [syncToServer]);

  const setScalarFactory = useCallback((factory: MockScalarFactory) => {
    setConfig((prev) => {
      const factories = (prev.scalarFactories ?? []).filter((f) => f.scalarName !== factory.scalarName);
      const next = { ...prev, scalarFactories: [...factories, factory] };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const removeScalarFactory = useCallback((scalarName: string) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        scalarFactories: (prev.scalarFactories ?? []).filter((f) => f.scalarName !== scalarName),
      };
      configRef.current = next;
      return next;
    });
    scheduleSync(false);
  }, [scheduleSync]);

  const importConfig = useCallback((cfg: Partial<GraphqlMockConfig>, sdl?: string) => {
    // Validate activeScenarioId — if the imported config references a scenario ID that
    // doesn't exist in the imported scenarios, clear it to avoid orphaned state.
    const mergedScenarios = cfg.scenarios ?? [];
    const importedScenarioId = cfg.activeScenarioId;
    const validatedScenarioId = importedScenarioId && mergedScenarios.some((s) => s.id === importedScenarioId)
      ? importedScenarioId
      : undefined;

    setConfig((prev) => {
      const next: GraphqlMockConfig = {
        ...prev,
        resolvers:        cfg.resolvers        ?? prev.resolvers,
        globalLatencyMs:  cfg.globalLatencyMs  ?? prev.globalLatencyMs,
        jitterMs:         cfg.jitterMs         ?? prev.jitterMs,
        seed:             cfg.seed             ?? prev.seed,
        scenarios:        cfg.scenarios        ?? prev.scenarios,
        activeScenarioId: validatedScenarioId,
        scalarFactories:  cfg.scalarFactories  ?? prev.scalarFactories,
        enabled: false,
      };
      configRef.current = next;
      return next;
    });
    if (sdl) {
      setCustomSdlState(sdl);
      customSdlRef.current = sdl;
      setSchemaSourceState('custom');
      schemaSourceRef.current = 'custom';
    }
    // Explicitly disable the proxy mock server so a running mock stops immediately
    if (isDesktopRuntimeAvailable()) {
      void fetch(`${MOCK_PROXY_BASE}/api/graphql/mock/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }).catch(() => { /* non-fatal */ });
    }
  }, []);

  const resetAll = useCallback(() => {
    const next = defaultConfig(connectionId ?? '');
    setConfig(next);
    configRef.current = next;
    setCustomSdlState('');
    customSdlRef.current = '';
    setSchemaSourceState('introspected');
    schemaSourceRef.current = 'introspected';
    void syncToServer(next, '', true);
  }, [connectionId, syncToServer]);

  return {
    config,
    customSdl,
    schemaSource,
    syncError,
    syncing,
    requestLog,
    status,
    setEnabled,
    setSchemaSource,
    setCustomSdl,
    setFieldResolver,
    clearFieldResolver,
    setGlobalLatency,
    setJitter,
    setSeed,
    addScenario,
    updateScenario,
    deleteScenario,
    activateScenario,
    setScalarFactory,
    removeScalarFactory,
    importConfig,
    resetAll,
    refreshLog: () => { void fetchLog(); },
    syncCustomSdlNow,
    syncFromServerStatus,
  };
}
