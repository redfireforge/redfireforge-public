/**
 * useGraphqlMockServer.test.ts — Phase 3E
 *
 * Unit tests for the mock server management hook. Uses renderHook from
 * @testing-library/react. All external I/O (fetch, readKey, writeKey, isTauri)
 * is mocked so no proxy server is required.
 */

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../shared/utils/storage', () => ({
  readKey:  vi.fn().mockResolvedValue(null),
  writeKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/utils/platform', () => ({
  isTauri: vi.fn().mockReturnValue(true),
  isDesktopRuntimeAvailable: vi.fn().mockReturnValue(true),
}));

vi.mock('../utils/graphqlSchemaCache', () => ({
  loadCachedGraphqlSchemaSdl: vi.fn().mockReturnValue(null),
}));

// Suppress all fetch calls — we test state logic, not network behaviour.
const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
vi.stubGlobal('fetch', mockFetch);

// ─── Import after mocks ───────────────────────────────────────────────────────

import { useGraphqlMockServer, resolveMockSyncSdl } from './useGraphqlMockServer';
import type { MockResolver, MockScenario } from '@shared/types/graphql';
import { isDesktopRuntimeAvailable, isTauri } from '@shared/utils/platform';
import { loadCachedGraphqlSchemaSdl } from '../utils/graphqlSchemaCache';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Render the mock server hook and flush its initial async mount effect.
 *
 * The hook's useEffect on mount runs a Promise.all over 3 storage reads (all mocked as
 * Promise.resolve). Two microtask ticks are needed to drain:
 *   tick 1 — Promise.all resolves
 *   tick 2 — the async IIFE continues and calls setState
 *
 * IMPORTANT: Do NOT use setTimeout() here — that hangs when vi.useFakeTimers() is
 * active in a test. Promise.resolve() is microtask-based and is never affected by
 * fake timer replacements.
 */
async function renderMockHook(connectionId = 'conn-1', sdl: string | null = null) {
  const rendered = renderHook(() => useGraphqlMockServer(connectionId, sdl));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return rendered;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useGraphqlMockServer', () => {
  beforeEach(() => {
    resetAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  afterEach(async () => {
    // Drain any React state updates from async operations (syncToServer, fetchLog, etc.)
    // that escaped the previous test's act() boundary. Without this, those updates bleed
    // into the next test and trigger "not wrapped in act" warnings.
    //
    // IMPORTANT: Uses Promise.resolve() (microtask), NOT setTimeout — setTimeout would
    // hang indefinitely when vi.useFakeTimers() is active in a test.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    resetAllMocks();
  });

  describe('initial state', () => {
    it('starts with enabled: false and empty resolvers', async () => {
      const { result } = await renderMockHook();
      expect(result.current.config.enabled).toBe(false);
      expect(result.current.config.resolvers).toEqual({});
      expect(result.current.schemaSource).toBe('introspected');
    });

    it('starts with connectionId from argument', async () => {
      const { result } = await renderMockHook('my-conn');
      expect(result.current.config.connectionId).toBe('my-conn');
    });
  });

  describe('setFieldResolver', () => {
    it('adds a field resolver', async () => {
      const { result } = await renderMockHook();
      const resolver: MockResolver = { type: 'fixed', value: 'hello' };
      act(() => result.current.setFieldResolver('Query', 'user', resolver));
      expect(result.current.config.resolvers['Query']?.['user']).toEqual(resolver);
    });

    it('adds resolvers for multiple types independently', async () => {
      const { result } = await renderMockHook();
      act(() => {
        result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'Alice' });
        result.current.setFieldResolver('User', 'name', { type: 'fixed', value: 'Bob' });
      });
      expect(result.current.config.resolvers['Query']?.['user']).toBeDefined();
      expect(result.current.config.resolvers['User']?.['name']).toBeDefined();
    });
  });

  describe('clearFieldResolver', () => {
    it('removes a field resolver', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'Alice' }));
      act(() => result.current.clearFieldResolver('Query', 'user'));
      expect(result.current.config.resolvers['Query']?.['user']).toBeUndefined();
    });

    it('removes the empty type entry after clearing the last field (regression: no orphan {} entries)', async () => {
      const { result } = await renderMockHook();
      // Add one resolver then clear it
      act(() => result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'x' }));
      expect(result.current.config.resolvers['Query']).toBeDefined();

      act(() => result.current.clearFieldResolver('Query', 'user'));
      // The Query key itself must be gone — not left as {}
      expect(Object.keys(result.current.config.resolvers)).not.toContain('Query');
    });

    it('keeps the type entry when other fields remain after clearing one', async () => {
      const { result } = await renderMockHook();
      act(() => {
        result.current.setFieldResolver('User', 'name',  { type: 'fixed', value: 'Alice' });
        result.current.setFieldResolver('User', 'email', { type: 'fixed', value: 'a@b.c' });
      });
      act(() => result.current.clearFieldResolver('User', 'name'));
      // email still present → User key should remain
      expect(result.current.config.resolvers['User']).toBeDefined();
      expect(result.current.config.resolvers['User']?.['email']).toBeDefined();
      expect(result.current.config.resolvers['User']?.['name']).toBeUndefined();
    });

    it('is a no-op for a non-existent field', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.clearFieldResolver('NonExistentType', 'nonExistentField'));
      expect(result.current.config.resolvers).toEqual({});
    });
  });

  describe('activateScenario', () => {
    it('sets activeScenarioId when scenario exists', async () => {
      const { result } = await renderMockHook();
      const scenario: MockScenario = { id: 's1', name: 'Test', resolvers: {} };
      act(() => result.current.addScenario(scenario));
      await act(async () => { result.current.activateScenario('s1'); await Promise.resolve(); });
      expect(result.current.config.activeScenarioId).toBe('s1');
    });

    it('syncs using customSdl when schemaSource is custom (covers line 522)', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setSchemaSource('custom'));
      act(() => result.current.setCustomSdl('type Query { hello: String }'));
      const scenario: MockScenario = { id: 's1', name: 'Test', resolvers: {} };
      act(() => result.current.addScenario(scenario));
      await act(async () => { result.current.activateScenario('s1'); await Promise.resolve(); });
      expect(result.current.config.activeScenarioId).toBe('s1');
    });

    it('ignores activation for non-existent scenario id', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.activateScenario('does-not-exist'));
      expect(result.current.config.activeScenarioId).toBeUndefined();
    });

    it('deactivates scenario by passing undefined', async () => {
      const { result } = await renderMockHook();
      const scenario: MockScenario = { id: 's1', name: 'Test', resolvers: {} };
      act(() => result.current.addScenario(scenario));
      await act(async () => { result.current.activateScenario('s1'); await Promise.resolve(); });
      await act(async () => { result.current.activateScenario(undefined); await Promise.resolve(); });
      expect(result.current.config.activeScenarioId).toBeUndefined();
    });
  });

  describe('deleteScenario', () => {
    it('removes the scenario from the list', async () => {
      const { result } = await renderMockHook();
      const s1: MockScenario = { id: 's1', name: 'A', resolvers: {} };
      const s2: MockScenario = { id: 's2', name: 'B', resolvers: {} };
      act(() => { result.current.addScenario(s1); result.current.addScenario(s2); });
      act(() => result.current.deleteScenario('s1'));
      const ids = (result.current.config.scenarios ?? []).map((s) => s.id);
      expect(ids).not.toContain('s1');
      expect(ids).toContain('s2');
    });

    it('clears activeScenarioId when the active scenario is deleted', async () => {
      const { result } = await renderMockHook();
      const scenario: MockScenario = { id: 's1', name: 'Test', resolvers: {} };
      act(() => result.current.addScenario(scenario));
      await act(async () => { result.current.activateScenario('s1'); await Promise.resolve(); });
      await act(async () => { result.current.deleteScenario('s1'); await Promise.resolve(); });
      expect(result.current.config.activeScenarioId).toBeUndefined();
    });
  });

  describe('importConfig', () => {
    it('loads resolvers from imported config', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.importConfig({
        resolvers: { Query: { user: { type: 'fixed', value: 42 } } },
      }));
      expect(result.current.config.resolvers['Query']?.['user']).toEqual({ type: 'fixed', value: 42 });
    });

    it('always disables the mock after import', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.importConfig({ resolvers: {} }));
      expect(result.current.config.enabled).toBe(false);
    });

    it('clears activeScenarioId if referenced scenario is not in the imported list', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.importConfig({
        scenarios: [{ id: 's2', name: 'B', resolvers: {} }],
        activeScenarioId: 'non-existent-id',
      }));
      expect(result.current.config.activeScenarioId).toBeUndefined();
    });

    it('preserves activeScenarioId when the referenced scenario exists in the imported list', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.importConfig({
        scenarios: [{ id: 's1', name: 'A', resolvers: {} }],
        activeScenarioId: 's1',
      }));
      expect(result.current.config.activeScenarioId).toBe('s1');
    });

    it('switches schemaSource to custom when SDL is provided', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.importConfig({}, 'type Query { hello: String }'));
      expect(result.current.schemaSource).toBe('custom');
      expect(result.current.customSdl).toBe('type Query { hello: String }');
    });
  });

  describe('setGlobalLatency', () => {
    it('clamps negative values to 0', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setGlobalLatency(-100));
      expect(result.current.config.globalLatencyMs).toBe(0);
    });

    it('rounds fractional values', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setGlobalLatency(123.7));
      expect(result.current.config.globalLatencyMs).toBe(124);
    });
  });

  describe('setJitter', () => {
    it('sets jitter in ms', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setJitter(50));
      expect(result.current.config.jitterMs).toBe(50);
    });

    it('clamps negative jitter to 0', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setJitter(-20));
      expect(result.current.config.jitterMs).toBe(0);
    });

    it('rounds fractional jitter', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setJitter(10.9));
      expect(result.current.config.jitterMs).toBe(11);
    });
  });

  describe('syncToServer — error paths', () => {
    it('sets syncError and reverts enabled when server returns non-OK on enable', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { hello: String }');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'Schema parse failed' } }),
      });
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
      // Should revert back to disabled since revertOnFailure = true for enable
      expect(result.current.config.enabled).toBe(false);
      expect(result.current.syncError).toBe('Schema parse failed');
    });

    it('sets syncError when fetch throws (network error) on enable', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { hello: String }');
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
      expect(result.current.config.enabled).toBe(false);
      expect(result.current.syncError).toContain('Failed to contact mock server');
    });

    it('uses Unknown sync error when error response JSON has no message field', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { hello: String }');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Gateway',
        json: async () => ({}),
      } as Response);
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
      expect(result.current.syncError).toBe('Unknown sync error');
    });
  });

  describe('connection load error handling', () => {
    it('falls back to default config when storage read fails on mount', async () => {
      const { readKey } = await import('../../../shared/utils/storage');
      vi.mocked(readKey).mockRejectedValue(new Error('disk error'));
      const { result } = renderHook(() => useGraphqlMockServer('conn-x', null));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(result.current.config.connectionId).toBe('conn-x');
      vi.mocked(readKey).mockResolvedValue(null);
    });
  });

  describe('setSeed', () => {
    it('sets a numeric seed', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setSeed(42));
      expect(result.current.config.seed).toBe(42);
    });

    it('clears seed when undefined is passed', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setSeed(42));
      act(() => result.current.setSeed(undefined));
      expect(result.current.config.seed).toBeUndefined();
    });

    it('ignores NaN values (guarded against parseInt on empty input)', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setSeed(NaN));
      expect(result.current.config.seed).toBeUndefined();
    });
  });

  describe('resetAll', () => {
    it('resets to default empty config', async () => {
      const { result } = await renderMockHook('conn-1');
      act(() => {
        result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'x' });
        result.current.setGlobalLatency(500);
      });
      await act(async () => { result.current.resetAll(); await Promise.resolve(); });
      expect(result.current.config.resolvers).toEqual({});
      expect(result.current.config.globalLatencyMs).toBe(0);
      expect(result.current.config.enabled).toBe(false);
    });
  });

  describe('removeScalarFactory', () => {
    it('removes a scalar factory by name', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setScalarFactory({ scalarName: 'Date', preset: 'date-iso' }));
      act(() => result.current.setScalarFactory({ scalarName: 'UUID', preset: 'uuid' }));
      act(() => result.current.removeScalarFactory('Date'));
      const names = (result.current.config.scalarFactories ?? []).map((f) => f.scalarName);
      expect(names).not.toContain('Date');
      expect(names).toContain('UUID');
    });

    it('is a no-op for a non-existent scalar name', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.removeScalarFactory('NonExistentScalar'));
      expect(result.current.config.scalarFactories ?? []).toHaveLength(0);
    });
  });

  describe('null-coalescence branches in scalar factory ops (lines 530, 542)', () => {
    it('handles scalarFactories being undefined via importConfig without factories', async () => {
      const { result } = await renderMockHook();
      // Import a config that doesn't include scalarFactories (so it stays at default [])
      act(() => result.current.importConfig({ scenarios: [] }));
      // Now add a scalar factory — scalarFactories is [] (default), ?? [] branch fires
      act(() => result.current.setScalarFactory({ scalarName: 'TestScalar', preset: 'uuid' }));
      expect(result.current.config.scalarFactories).toHaveLength(1);
      // Remove it — ?? [] branch fires again
      act(() => result.current.removeScalarFactory('TestScalar'));
      expect(result.current.config.scalarFactories).toHaveLength(0);
    });
  });

  describe('resetAll with null connectionId (line 589)', () => {
    it('resets using empty connectionId when connectionId is null', async () => {
      const { result } = renderHook(() => useGraphqlMockServer(null, null));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { result.current.resetAll(); await Promise.resolve(); });
      expect(result.current.config.connectionId).toBe('');
    });
  });

  describe('refreshLog', () => {
    it('calls the log endpoint when refreshLog is invoked', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [{ id: 'log-1' }] }) });
      const { result } = await renderMockHook();
      act(() => result.current.refreshLog());
      // Give the async fetch a tick to resolve
      await act(async () => { await Promise.resolve(); });
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/graphql/mock/log'));
    });
  });

  describe('customSdl persistence (line 208)', () => {
    it('persists customSdl to storage after async load completes', async () => {
      const { writeKey: mockWriteKey } = await import('../../../shared/utils/storage');
      const { result } = await renderMockHook();
      // Wait for the async mount (readKey calls) to complete so isLoadingRef.current = false
      await act(async () => { await Promise.resolve(); });
      vi.mocked(mockWriteKey).mockClear();
      act(() => result.current.setCustomSdl('type Query { hello: String }'));
      expect(mockWriteKey).toHaveBeenCalledWith(
        expect.stringContaining('graphql-mock-sdl-'),
        'type Query { hello: String }',
      );
    });
  });

  describe('fetchStatus error path (line 332)', () => {
    it('sets status to null when fetchStatus fetch throws', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/status')) return Promise.reject(new Error('Network error'));
        return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) });
      });
      const { result } = await renderMockHook('conn-1', 'type Query { hi: String }');
      await act(async () => { await Promise.resolve(); });
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      // fetchStatus threw, so status should be null
      expect(result.current.status).toBeNull();
    });
  });

  describe('disable mock network error (line 243)', () => {
    it('sets syncError when the disable fetch throws', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { hello: String }');
      await act(async () => { await Promise.resolve(); });
      // Enable first (succeeds)
      act(() => result.current.setEnabled(true));
      await act(async () => { await Promise.resolve(); });
      // Make next fetch throw to simulate network error when disabling
      mockFetch.mockRejectedValueOnce(new Error('Network down'));
      await act(async () => {
        result.current.setEnabled(false);
        await Promise.resolve();
      });
      expect(result.current.syncError).toContain('Failed to contact mock server');
    });
  });

  describe('no-SDL debounced sync (lines 251-257 with revertOnFailure=false)', () => {
    it('sets syncError but does not revert enabled when debounced sync has empty SDL', async () => {
      vi.useFakeTimers();
      // No SDL provided: introspectedSdl = null, customSdl = '' → getSdl() = ''
      const { result } = await renderMockHook('conn-1', null);
      await act(async () => { await Promise.resolve(); });
      // Enable with custom SDL so sync passes
      act(() => {
        result.current.setSchemaSource('custom');
        result.current.setCustomSdl('type Query { hello: String }');
      });
      act(() => result.current.setEnabled(true));
      await act(async () => { await Promise.resolve(); });
      // Now clear the custom SDL and trigger a debounced sync
      act(() => result.current.setCustomSdl(''));
      act(() => result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'x' }));
      // Advance timers past DEBOUNCE_MS
      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });
      // syncError should be set (empty SDL error), but mock should still be enabled (no revert)
      expect(result.current.syncError).toContain('No SDL available');
      expect(result.current.config.enabled).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('debounced sync and interval (lines 308, 341-342)', () => {
    afterAll(() => { vi.useRealTimers(); });

    it('fires immediate syncToServer when setFieldResolver is called', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { hi: String }');
      await act(async () => { await Promise.resolve(); });
      act(() => result.current.setEnabled(true));
      await act(async () => { await Promise.resolve(); });
      mockFetch.mockClear();
      act(() => result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'hello' }));
      await act(async () => { await Promise.resolve(); });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('fires setInterval callback for log + status polling (lines 341-342)', async () => {
      vi.useFakeTimers();
      const { result } = await renderMockHook('conn-1', 'type Query { hi: String }');
      await act(async () => { await Promise.resolve(); });
      act(() => result.current.setEnabled(true));
      await act(async () => { await Promise.resolve(); });
      mockFetch.mockClear();
      // Advance past LOG_POLL_MS (2000ms) to fire the interval callback
      await act(async () => {
        vi.advanceTimersByTime(2100);
        await Promise.resolve();
      });
      // The interval callback should call fetchLog and fetchStatus
      const logCalls = mockFetch.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/log'));
      const statusCalls = mockFetch.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/status'));
      expect(logCalls.length + statusCalls.length).toBeGreaterThan(0);
      vi.useRealTimers();
    });
  });

  describe('null connectionId', () => {
    it('resets to defaults when connectionId is null', async () => {
      const { result, rerender } = renderHook(
        ({ connId }: { connId: string | null }) => useGraphqlMockServer(connId, null),
        { initialProps: { connId: 'conn-1' as string | null } },
      );
      // Add some state
      act(() => result.current.setFieldResolver('Query', 'user', { type: 'fixed', value: 'x' }));
      // Switch to null connectionId
      act(() => rerender({ connId: null }));
      expect(result.current.config.connectionId).toBe('');
      expect(result.current.config.resolvers).toEqual({});
    });
  });

  describe('loading saved config from storage (line 180)', () => {
    it('restores saved config and always disables on load', async () => {
      const { readKey: mockReadKey } = await import('../../../shared/utils/storage');
      const savedConfig = {
        connectionId: 'conn-1',
        enabled: true, // saved as enabled, but should be disabled on load
        resolvers: { Query: { user: { type: 'fixed', value: 'saved' } } },
        globalLatencyMs: 200,
        jitterMs: 50,
        seed: 42,
        scenarios: [],
        activeScenarioId: undefined,
        scalarFactories: [],
      };
      vi.mocked(mockReadKey).mockImplementation(async (key: string) => {
        if (key.includes('graphql-mock-config-')) return JSON.stringify(savedConfig);
        if (key.includes('graphql-mock-sdl-')) return 'type Query { saved: String }';
        if (key.includes('graphql-mock-source-')) return 'custom';
        return null;
      });
      const { result } = renderHook(() => useGraphqlMockServer('conn-1', null));
      await act(async () => { await Promise.resolve(); });
      // Should have loaded saved resolvers but with enabled = false
      expect(result.current.config.enabled).toBe(false);
      expect(result.current.config.globalLatencyMs).toBe(200);
      expect(result.current.customSdl).toBe('type Query { saved: String }');
      expect(result.current.schemaSource).toBe('custom');
      // Reset mock for subsequent tests
      vi.mocked(mockReadKey).mockResolvedValue(null);
    });
  });

  describe('storage read error on mount (line 189)', () => {
    it('falls back to default config when readKey throws', async () => {
      const { readKey: mockReadKey } = await import('../../../shared/utils/storage');
      vi.mocked(mockReadKey).mockRejectedValue(new Error('Storage unavailable'));
      const { result } = renderHook(() => useGraphqlMockServer('conn-1', null));
      await act(async () => { await Promise.resolve(); });
      // Should fall back to empty default config
      expect(result.current.config.enabled).toBe(false);
      expect(result.current.config.resolvers).toEqual({});
      // Reset mock
      vi.mocked(mockReadKey).mockResolvedValue(null);
    });

    it('falls back when stored config is invalid JSON (safeParseJson catch branch, line 104)', async () => {
      const { readKey: mockReadKey } = await import('../../../shared/utils/storage');
      vi.mocked(mockReadKey).mockImplementation(async (key: string) => {
        if (key.includes('graphql-mock-config-')) return '{invalid json{{';
        return null;
      });
      const { result } = renderHook(() => useGraphqlMockServer('conn-1', null));
      await act(async () => { await Promise.resolve(); });
      // safeParseJson catch fires → saved = null → defaultConfig
      expect(result.current.config.resolvers).toEqual({});
      vi.mocked(mockReadKey).mockResolvedValue(null);
    });
  });

  describe('enable with no SDL reverts enabled=false (lines 254-255)', () => {
    it('sets syncError and reverts enabled when trying to enable with no SDL', async () => {
      // No SDL: introspectedSdl = null, customSdl = '' → getSdl() = ''
      const { result } = await renderMockHook('conn-1', null);
      await act(async () => { await Promise.resolve(); });
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      // syncToServer was called with empty SDL + revertOnFailure=true
      expect(result.current.config.enabled).toBe(false);
      expect(result.current.syncError).toContain('No SDL available');
    });

    it('enables mock when introspected SDL is missing but cache has SDL', async () => {
      vi.mocked(loadCachedGraphqlSchemaSdl).mockReturnValueOnce('type Query { health: String }');
      const { result } = await renderMockHook('conn-1', null);
      await act(async () => { await Promise.resolve(); });
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      expect(result.current.config.enabled).toBe(true);
      expect(result.current.syncError).toBeNull();
    });
  });

  describe('resolveMockSyncSdl', () => {
    it('prefers introspected SDL over cache', () => {
      expect(resolveMockSyncSdl('conn-1', 'introspected', 'type Query { a: String }', '')).toBe(
        'type Query { a: String }',
      );
    });

    it('falls back to cached SDL for introspected source', () => {
      vi.mocked(loadCachedGraphqlSchemaSdl).mockReturnValueOnce('type Query { cached: String }');
      expect(resolveMockSyncSdl('conn-1', 'introspected', null, '')).toBe('type Query { cached: String }');
    });
  });

  describe('syncFromServerStatus', () => {
    it('sets UI enabled when proxy reports mock is already running', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/graphql/mock/status')) {
          return {
            ok: true,
            json: async () => ({
              enabled: true,
              configured: true,
              activeResolverCount: 0,
              latencyMs: 0,
              jitterMs: 0,
              requestCount: 1,
              activeScenarioId: null,
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      });
      const { result } = await renderMockHook('conn-1', 'type Query { health: String }');
      await act(async () => { await Promise.resolve(); });
      expect(result.current.config.enabled).toBe(true);
    });

    it('sets UI disabled when proxy reports mock is off', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { health: String }');
      await act(async () => { await Promise.resolve(); });
      act(() => result.current.setEnabled(true));
      await act(async () => { await Promise.resolve(); });
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/graphql/mock/status')) {
          return {
            ok: true,
            json: async () => ({
              enabled: false,
              configured: true,
              activeResolverCount: 0,
              latencyMs: 0,
              jitterMs: 0,
              requestCount: 1,
              activeScenarioId: null,
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      });
      await act(async () => {
        await result.current.syncFromServerStatus();
      });
      expect(result.current.config.enabled).toBe(false);
    });
  });

  describe('updateScenario', () => {
    it('updates a scenario by id', async () => {
      const { result } = await renderMockHook();
      const scenario: MockScenario = { id: 's1', name: 'Original', resolvers: {} };
      act(() => result.current.addScenario(scenario));
      act(() => result.current.updateScenario('s1', { name: 'Updated' }));
      const updated = (result.current.config.scenarios ?? []).find((s) => s.id === 's1');
      expect(updated?.name).toBe('Updated');
    });

    it('is a no-op for a non-existent scenario id', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.updateScenario('no-such-id', { name: 'X' }));
      expect(result.current.config.scenarios ?? []).toHaveLength(0);
    });
  });

  describe('setSchemaSource', () => {
    it('changes schema source state', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setSchemaSource('custom'));
      expect(result.current.schemaSource).toBe('custom');
    });

    it('syncs to server when mock is enabled and source changes to introspected', async () => {
      // Set up with custom SDL so we can test source switching
      const { result } = await renderMockHook('conn-1', 'type Query { hello: String }');
      // Set source to custom with a non-empty SDL, then enable
      act(() => result.current.setCustomSdl('type Query { world: String }'));
      act(() => result.current.setSchemaSource('custom'));
      act(() => result.current.setEnabled(true));
      mockFetch.mockClear();
      // Switching back to introspected while enabled should trigger sync with introspected SDL
      act(() => result.current.setSchemaSource('introspected'));
      await act(async () => { await Promise.resolve(); });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/graphql/mock/config'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('syncCustomSdlNow', () => {
    it('does not sync when mock is disabled', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setCustomSdl('type Query { hello: String }'));
      mockFetch.mockClear();
      act(() => result.current.syncCustomSdlNow());
      await act(async () => { await Promise.resolve(); });
      // Only the fetch from the initial setEnabled(false) call should have occurred
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/graphql/mock/config'),
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"enabled":true') }),
      );
    });

    it('syncs when mock is enabled and source is custom', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setSchemaSource('custom'));
      act(() => result.current.setCustomSdl('type Query { hello: String }'));
      act(() => result.current.setEnabled(true));
      mockFetch.mockClear();
      act(() => result.current.syncCustomSdlNow());
      await act(async () => { await Promise.resolve(); });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/graphql/mock/config'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('disabling mock (immediate sync with enabled: false)', () => {
    it('calls /api/graphql/mock/config with enabled:false when mock is turned off', async () => {
      const { result } = await renderMockHook('conn-1', 'type Query { hello: String }');
      act(() => result.current.setEnabled(true));
      await act(async () => { await Promise.resolve(); });
      mockFetch.mockClear();
      act(() => result.current.setEnabled(false));
      await act(async () => { await Promise.resolve(); });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/graphql/mock/config'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"enabled":false'),
        }),
      );
    });
  });

  describe('log polling interval', () => {
    it('fetches log and status initially when mock is enabled', async () => {
      // Verify that when enabled=true, the /log and /status endpoints are called
      const { result } = await renderMockHook('conn-1', 'type Query { hi: String }');
      // Wait for mount to settle
      await act(async () => { await Promise.resolve(); });
      const callsBefore = mockFetch.mock.calls.length;
      await act(async () => {
        result.current.setEnabled(true);
      });
      // After enabling, fetchLog and fetchStatus should be called (in addition to the config POST)
      const logCalls = mockFetch.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/log'));
      const statusCalls = mockFetch.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/status'));
      expect(logCalls.length + statusCalls.length + callsBefore).toBeGreaterThan(callsBefore);
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  describe('updateScenario false branch coverage (multiple scenarios)', () => {
    it('only updates the matching scenario — non-matching scenarios return unchanged (line 489 false branch)', async () => {
      const { result } = await renderMockHook();
      const s1: MockScenario = { id: 's1', name: 'First', resolvers: {} };
      const s2: MockScenario = { id: 's2', name: 'Second', resolvers: {} };
      act(() => { result.current.addScenario(s1); result.current.addScenario(s2); });
      act(() => result.current.updateScenario('s1', { name: 'Updated First' }));
      const scenarios = result.current.config.scenarios ?? [];
      const s1after = scenarios.find((s) => s.id === 's1');
      const s2after = scenarios.find((s) => s.id === 's2');
      expect(s1after?.name).toBe('Updated First');
      expect(s2after?.name).toBe('Second'); // unchanged — false branch
    });
  });

  describe('deleteScenario false branch coverage', () => {
    it('keeps activeScenarioId unchanged when a different scenario is deleted (line 505 false branch)', async () => {
      const { result } = await renderMockHook();
      const s1: MockScenario = { id: 's1', name: 'First', resolvers: {} };
      const s2: MockScenario = { id: 's2', name: 'Second', resolvers: {} };
      act(() => { result.current.addScenario(s1); result.current.addScenario(s2); });
      // Set s1 as active
      await act(async () => { result.current.activateScenario('s1'); await Promise.resolve(); });
      // Delete s2 (not the active one) — activeScenarioId should remain 's1'
      act(() => result.current.deleteScenario('s2'));
      expect(result.current.config.activeScenarioId).toBe('s1');
    });
  });

  describe('setScalarFactory with existing scalar (line 530 filter branch)', () => {
    it('replaces existing scalar factory with same scalarName', async () => {
      const { result } = await renderMockHook();
      act(() => result.current.setScalarFactory({ scalarName: 'Date', preset: 'date-iso' }));
      act(() => result.current.setScalarFactory({ scalarName: 'UUID', preset: 'uuid' }));
      // Replace Date factory with a scriptCode version — filter removes old, adds new
      act(() => result.current.setScalarFactory({ scalarName: 'Date', scriptCode: 'return "2024-01-01"' }));
      const factories = result.current.config.scalarFactories ?? [];
      const dateFac = factories.find((f) => f.scalarName === 'Date');
      expect(dateFac?.scriptCode).toBe('return "2024-01-01"');
      expect(factories).toHaveLength(2); // Date and UUID (not 3)
    });
  });

  describe('introspectedSdl change while enabled (covers lines 363-368)', () => {
    it('re-syncs to server when introspectedSdl changes while mock is enabled', async () => {
      const { result, rerender } = renderHook(
        ({ sdl }: { sdl: string | null }) => useGraphqlMockServer('conn-1', sdl),
        { initialProps: { sdl: 'type Query { hello: String }' as string | null } },
      );
      // Wait for async mount to complete (readKey calls)
      await act(async () => { await Promise.resolve(); });
      // Enable mock with initial SDL
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
      });
      expect(result.current.config.enabled).toBe(true);
      mockFetch.mockClear();
      // Change introspectedSdl — this should trigger the useEffect([introspectedSdl]) and re-sync
      await act(async () => {
        rerender({ sdl: 'type Query { world: String }' });
        await Promise.resolve();
      });
      // The re-sync should send a POST to /config with the new SDL body
      const configCalls = mockFetch.mock.calls.filter(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('/api/graphql/mock/config'),
      );
      expect(configCalls.length).toBeGreaterThan(0);
    });
  });

  describe('connection switch and import cleanup', () => {
    it('handles fetch failure when disabling mock on connection switch', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));
      const { rerender } = renderHook(
        ({ id }: { id: string }) => useGraphqlMockServer(id, null),
        { initialProps: { id: 'conn-a' } },
      );
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => {
        rerender({ id: 'conn-b' });
        await Promise.resolve();
      });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('uses statusText fallback when sync error response is not JSON', async () => {
      const { result } = await renderMockHook();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => { throw new Error('not json'); },
      } as Response);
      await act(async () => {
        result.current.setEnabled(true);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.syncError).toBeTruthy();
      expect(result.current.config.enabled).toBe(false);
    });

    it('handles importConfig proxy disable fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('proxy offline'));
      const { result } = await renderMockHook();
      await act(async () => {
        result.current.importConfig({ enabled: false, resolvers: {}, scenarios: [] });
        await Promise.resolve();
      });
      expect(result.current.config.enabled).toBe(false);
    });

    it('skips proxy disable fetch on connection switch when not in Tauri', async () => {
      vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(false);
      vi.mocked(isTauri).mockReturnValue(false);
      const { rerender } = renderHook(
        ({ id }: { id: string }) => useGraphqlMockServer(id, null),
        { initialProps: { id: 'conn-a' } },
      );
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const callsBefore = mockFetch.mock.calls.length;
      await act(async () => {
        rerender({ id: 'conn-b' });
        await Promise.resolve();
      });
      expect(mockFetch.mock.calls.length).toBe(callsBefore);
      vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
      vi.mocked(isTauri).mockReturnValue(true);
    });

    it('skips proxy disable fetch during importConfig when not in Tauri', async () => {
      vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(false);
      vi.mocked(isTauri).mockReturnValue(false);
      const { result } = await renderMockHook();
      const callsBefore = mockFetch.mock.calls.length;
      await act(async () => {
        result.current.importConfig({ enabled: false, resolvers: {}, scenarios: [] });
        await Promise.resolve();
      });
      expect(mockFetch.mock.calls.length).toBe(callsBefore);
      vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
      vi.mocked(isTauri).mockReturnValue(true);
    });
  });
});
