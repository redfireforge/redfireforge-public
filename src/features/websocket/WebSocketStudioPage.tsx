import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketProfiles } from '@app/hooks/useWebSocketProfiles';
import { useWebSocketTemplates } from '@app/hooks/useWebSocketTemplates';
import { useWebSocketHistory } from '@app/hooks/useWebSocketHistory';
import {
  WsConnectionTabBar,
  type ConnectionStateHint,
  type WsConnectionTabInfo,
} from './WsConnectionTabBar';
import { WsConnectionTabContent } from './WsConnectionTabContent';
import type { WsConnectionTabContentHandle } from './WsConnectionTabContent.types';
import { buildWsEnvVarMap } from './wsMessageUtils';
import { buildEnvVarMap } from '@shared/utils/envVarUtils';
import { getRowStatus } from '../environments/utils/protocolEndpointUtils';
import type {
  WsConnectionDraft,
  WsProtocolMode,
  WsViewTab,
  WsStudioLocation,
} from '@shared/websocket/types';
import { mapViewTabToStudioLocation } from '@shared/websocket/types';
import { loadWsTabState, saveWsTabState } from '@shared/websocket/websocketStorage';
import ConfirmModal from '@shared/components/ConfirmModal';
import { resolveWsMockApiUrl } from './useWebSocketMockServer';
import {
  DEMO_INITIAL_SURFACE_EVENT,
  peekDemoInitialSurface,
} from '@shared/demoInitialSurface';
import {
  MAX_TABS,
  MOCK_PORT_BASE,
  applyDemoWsStudioMode,
  LOCALHOST_WS_URL_RE,
  generateTabId,
  deriveTabLabel,
  nextFreePort,
  preparePortsForNewTab,
} from './WebSocketStudioPage.helpers';
import {
  buildWsPersistedTabState,
  restoreWsPersistedTabs,
} from './wsStudioTabPersistence';
import type { WebSocketStudioPageProps } from './WebSocketStudioPage.types';
import { useWsDemoBridges } from './useWsDemoBridges';
import '../../styles/websocket-studio.css';
import '../../styles/mock-server-shared.css';

export function WebSocketStudioPage({
  resolvedBaseUrl,
  envName,
  svcName,
  selectedSvc,
  selectedEnvId,
  globalAuthProfiles = [],
}: WebSocketStudioPageProps) {
  const [tabs, setTabs] = useState<WsConnectionTabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [connectionStates, setConnectionStates] = useState<Record<string, ConnectionStateHint>>({});
  const renamedTabIds = useRef(new Set<string>());
  const tabUrls = useRef<Record<string, string>>({});
  const tabViewTabs = useRef<Record<string, WsViewTab>>({});
  const initialUrlsRef = useRef<Record<string, string>>({});
  const initialProtocolsRef = useRef<Record<string, WsProtocolMode>>({});
  const initialDraftsRef = useRef<Record<string, Partial<WsConnectionDraft>>>({});
  const [loaded, setLoaded] = useState(false);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  // ── Redesigned studio shell (now the only production layout) ──────────
  const [studioLoc, setStudioLoc] = useState<Record<string, WsStudioLocation>>({});
  const studioLocRef = useRef(studioLoc);
  studioLocRef.current = studioLoc;

  const tabRefs = useRef<Map<string, React.RefObject<WsConnectionTabContentHandle | null>>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const envVarMap = useMemo(() => {
    if (selectedSvc && selectedEnvId) {
      return buildEnvVarMap(selectedSvc, selectedEnvId, 'websocket', envName);
    }
    return buildWsEnvVarMap(resolvedBaseUrl, envName, svcName);
  }, [selectedSvc, selectedEnvId, resolvedBaseUrl, envName, svcName]);

  const endpointProtocolStatus = useMemo(() => {
    if (selectedSvc && selectedEnvId) {
      return getRowStatus(selectedSvc, 'websocket', selectedEnvId);
    }
    return undefined;
  }, [selectedSvc, selectedEnvId]);

  const profilesHook = useWebSocketProfiles();
  const templatesHook = useWebSocketTemplates();
  const historyHook = useWebSocketHistory();

  // Per-tab mock server port assignment.
  // Must be React state (not a ref): children read mockPort as a prop, and
  // conflict swaps / demo pinning only take effect after a re-render.
  const [mockPorts, setMockPorts] = useState<Record<string, number>>({});
  const mockPortsRef = useRef(mockPorts);
  mockPortsRef.current = mockPorts;


  // ── Load persisted tab state on mount ──────────────────────────────

  const createDefaultTab = useCallback(() => {
    const id = generateTabId();
    setMockPorts({ [id]: MOCK_PORT_BASE });
    mockPortsRef.current = { [id]: MOCK_PORT_BASE };
    setTabs([{ id, label: 'New Connection' }]);
    setActiveTabId(id);
    setConnectionStates({ [id]: 'disconnected' });
    const base = mapViewTabToStudioLocation('connect');
    setStudioLoc(applyDemoWsStudioMode({ [id]: base }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadWsTabState().then((state) => {
      if (cancelled) return;
      if (state && state.tabs.length > 0) {
        const restored = restoreWsPersistedTabs(state);
        renamedTabIds.current = new Set(restored.renamedTabIds);
        mockPortsRef.current = restored.mockPorts;
        setMockPorts(restored.mockPorts);
        tabUrls.current = restored.urls;
        tabViewTabs.current = restored.views;
        initialUrlsRef.current = restored.initialUrls;
        initialDraftsRef.current = restored.initialDrafts;
        setTabs(restored.tabs);
        setActiveTabId(restored.activeTabId);
        setConnectionStates(restored.connectionStates);
        setStudioLoc(restored.studioLocs);
      } else {
        createDefaultTab();
      }
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      createDefaultTab();
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [createDefaultTab]);

  // ── Debounced save ─────────────────────────────────────────────────

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Demo boot: if the lesson arms wsStudioMode after mount (or re-arms on Restart),
  // sync the active tab immediately so step 1 never paints the wrong mode.
  useEffect(() => {
    const syncDemoMode = () => {
      const mode = peekDemoInitialSurface()?.wsStudioMode;
      if (!mode) return;
      const id = activeTabIdRef.current;
      if (!id) return;
      setStudioLoc((prev) => {
        const cur = prev[id] ?? mapViewTabToStudioLocation('connect');
        if (cur.mode === mode) return prev;
        return { ...prev, [id]: { ...cur, mode } };
      });
    };
    window.addEventListener(DEMO_INITIAL_SURFACE_EVENT, syncDemoMode);
    syncDemoMode();
    return () => window.removeEventListener(DEMO_INITIAL_SURFACE_EVENT, syncDemoMode);
  }, []);

  // Phase 8: read the live draft fields (subprotocols/headers/queryParams/auth)
  // for whole-draft persistence. Prefer the mounted tab's current draft via its
  // imperative handle; fall back to the persisted seed for tabs that are not
  // mounted (or before they have applied their initial draft).
  const readTabDraftFields = useCallback(
    (id: string): Pick<WsConnectionDraft, 'subprotocols' | 'headers' | 'queryParams' | 'auth'> => {
      const handle = tabRefs.current.get(id)?.current;
      const draft = handle?.getDraft();
      if (draft) {
        return {
          subprotocols: draft.subprotocols,
          headers: draft.headers,
          queryParams: draft.queryParams,
          auth: draft.auth,
        };
      }
      const seed = initialDraftsRef.current[id];
      return {
        subprotocols: seed?.subprotocols ?? '',
        headers: seed?.headers ?? [],
        queryParams: seed?.queryParams ?? [],
        auth: seed?.auth,
      };
    },
    [],
  );
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const buildPersistState = useCallback(() => {
    return buildWsPersistedTabState({
      tabs: tabsRef.current,
      studioLocs: studioLocRef.current,
      viewTabs: tabViewTabs.current,
      urls: tabUrls.current,
      mockPorts: mockPortsRef.current,
      activeTabId: activeTabIdRef.current,
      renamedTabIds: Array.from(renamedTabIds.current),
      readDraft: readTabDraftFields,
    });
  }, [readTabDraftFields]);

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveWsTabState(buildPersistState());
    }, 300);
  }, [buildPersistState]);

  useWsDemoBridges({
    profilesHook,
    templatesHook,
    activeTabIdRef,
    tabsRef,
    tabRefs,
    renamedTabIdsRef: renamedTabIds,
    tabUrls,
    initialUrlsRef,
    mockPortsRef,
    setStudioLoc,
    setTabs,
    setActiveTabId,
    setConnectionStates,
    setMockPorts,
    debouncedSave,
    generateTabId,
  });

  // Clean up save timer on unmount + save immediately
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (!loaded) return;
      saveWsTabState(buildPersistState());
    };
  }, [loaded, buildPersistState]);

  // ── Tab management ─────────────────────────────────────────────────

  const getTabRef = useCallback((id: string) => {
    let r = tabRefs.current.get(id);
    if (!r) {
      r = { current: null };
      tabRefs.current.set(id, r);
    }
    return r;
  }, []);

  const applyPreparedPorts = useCallback((
    liveTabIds: string[],
    newTabId: string,
  ): number => {
    const { ports, nextPort, remappedSoleTabId } = preparePortsForNewTab(mockPortsRef.current, liveTabIds);
    if (remappedSoleTabId) {
      const survivorUrl = tabUrls.current[remappedSoleTabId] ?? '';
      if (LOCALHOST_WS_URL_RE.test(survivorUrl)) {
        const suffix = survivorUrl.match(LOCALHOST_WS_URL_RE)?.[1] ?? '';
        const normalizedUrl = `ws://localhost:${MOCK_PORT_BASE}${suffix}`;
        tabUrls.current[remappedSoleTabId] = normalizedUrl;
        initialUrlsRef.current[remappedSoleTabId] = normalizedUrl;
      }
    }
    const nextPorts = { ...ports, [newTabId]: nextPort };
    mockPortsRef.current = nextPorts;
    setMockPorts(nextPorts);
    return nextPort;
  }, []);

  const handleAddTab = useCallback(() => {
    const id = generateTabId();
    setTabs((prev) => {
      if (prev.length >= MAX_TABS) return prev;
      applyPreparedPorts(prev.map((t) => t.id), id);
      setActiveTabId(id);
      setConnectionStates((current) => ({ ...current, [id]: 'disconnected' }));
      debouncedSave();
      return [...prev, { id, label: 'New Connection' }];
    });
  }, [debouncedSave, applyPreparedPorts]);

  const handleAddTabWithUrl = useCallback(
    (url: string, protocol?: WsProtocolMode) => {
      const id = generateTabId();
      const label = deriveTabLabel(url) ?? 'New Connection';
      setTabs((prev) => {
        if (prev.length >= MAX_TABS) return prev;
        applyPreparedPorts(prev.map((t) => t.id), id);
        setActiveTabId(id);
        setConnectionStates((current) => ({ ...current, [id]: 'disconnected' }));
        tabUrls.current[id] = url;
        initialUrlsRef.current[id] = url;
        if (protocol) initialProtocolsRef.current[id] = protocol;
        debouncedSave();
        return [...prev, { id, label, url }];
      });
    },
    [debouncedSave, applyPreparedPorts],
  );

  const doCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const filtered = prev.filter((t) => t.id !== id);
        if (activeTabId === id && filtered.length > 0) {
          const oldIdx = prev.findIndex((t) => t.id === id);
          const newIdx = Math.min(oldIdx, filtered.length - 1);
          setActiveTabId(filtered[newIdx].id);
        }
        setConnectionStates((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        tabRefs.current.delete(id);
        renamedTabIds.current.delete(id);
        delete tabUrls.current[id];
        delete tabViewTabs.current[id];
        delete initialUrlsRef.current[id];
        delete initialProtocolsRef.current[id];
        delete initialDraftsRef.current[id];
        const closedPort = mockPortsRef.current[id];
        const nextPorts = { ...mockPortsRef.current };
        delete nextPorts[id];
        // When only one tab remains, reset it to the canonical base port so
        // "New Connection" doesn't keep a leftover 9878/9879 from an older layout.
        if (filtered.length === 1) {
          nextPorts[filtered[0].id] = MOCK_PORT_BASE;
          const survivorUrl = tabUrls.current[filtered[0].id] ?? '';
          if (LOCALHOST_WS_URL_RE.test(survivorUrl)) {
            const suffix = survivorUrl.match(LOCALHOST_WS_URL_RE)?.[1] ?? '';
            const normalizedUrl = `ws://localhost:${MOCK_PORT_BASE}${suffix}`;
            tabUrls.current[filtered[0].id] = normalizedUrl;
            initialUrlsRef.current[filtered[0].id] = normalizedUrl;
            filtered[0] = { ...filtered[0], url: normalizedUrl };
          }
        }
        mockPortsRef.current = nextPorts;
        setMockPorts(nextPorts);
        if (closedPort !== undefined) {
          void fetch(resolveWsMockApiUrl('/api/ws/mock/stop'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: closedPort }),
          }).catch(() => { /* ignore if server wasn't running */ });
        }
        setStudioLoc((current) => {
          if (!(id in current)) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
        debouncedSave();
        return filtered;
      });
    },
    [activeTabId, debouncedSave],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) return;

      const state = connectionStates[id];
      if (state === 'connected' || state === 'connecting') {
        setPendingCloseTabId(id);
        return;
      }

      doCloseTab(id);
    },
    [tabs.length, connectionStates, doCloseTab],
  );

  const handleSelectTab = useCallback((id: string) => {
    setActiveTabId(id);
    debouncedSave();
  }, [debouncedSave]);

  const handleRenameTab = useCallback((id: string, newLabel: string) => {
    renamedTabIds.current.add(id);
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, label: newLabel } : t)),
    );
    debouncedSave();
  }, [debouncedSave]);

  const handleReorderTab = useCallback(
    (fromIndex: number, toIndex: number) => {
      setTabs((prev) => {
        if (fromIndex < 0 || fromIndex >= prev.length) return prev;
        if (toIndex < 0 || toIndex >= prev.length) return prev;
        if (fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleDuplicateTab = useCallback(
    (tabId: string) => {
      const srcTab = tabs.find((t) => t.id === tabId);
      if (!srcTab) return;
      if (tabs.length >= MAX_TABS) return;
      const newId = generateTabId();
      const isRenamed = renamedTabIds.current.has(tabId);
      const newLabel = isRenamed ? `${srcTab.label} (copy)` : srcTab.label;
      const newTab: WsConnectionTabInfo = { id: newId, label: newLabel, url: srcTab.url };
      setTabs((prev) => {
        if (prev.length >= MAX_TABS) return prev;
        if (isRenamed) renamedTabIds.current.add(newId);
        applyPreparedPorts(prev.map((t) => t.id), newId);
        const srcUrl = tabUrls.current[tabId] ?? srcTab.url ?? '';
        tabUrls.current[newId] = srcUrl;
        initialUrlsRef.current[newId] = srcUrl;
        const srcProtocol = initialProtocolsRef.current[tabId];
        if (srcProtocol) initialProtocolsRef.current[newId] = srcProtocol;
        const srcDraft = initialDraftsRef.current[tabId];
        if (srcDraft) {
          initialDraftsRef.current[newId] = {
            ...srcDraft,
            headers: srcDraft.headers ? [...srcDraft.headers] : undefined,
            queryParams: srcDraft.queryParams ? [...srcDraft.queryParams] : undefined,
            auth: srcDraft.auth ? { ...srcDraft.auth } : undefined,
          };
        }
        const srcLoc = studioLocRef.current[tabId];
        if (srcLoc) {
          setStudioLoc((current) => ({ ...current, [newId]: { ...srcLoc } }));
        }
        setActiveTabId(newId);
        setConnectionStates((current) => ({ ...current, [newId]: 'disconnected' }));
        debouncedSave();
        return [...prev, newTab];
      });
    },
    [tabs, debouncedSave, applyPreparedPorts],
  );

  const addHistoryEntry = historyHook.addEntry;
  const handleConnectionStateChange = useCallback((tabId: string, state: ConnectionStateHint, protocolMode?: WsProtocolMode) => {
    setConnectionStates((prev) => ({ ...prev, [tabId]: state }));
    if (state === 'connected') {
      const url = tabUrls.current[tabId];
      if (url) {
        addHistoryEntry(url, protocolMode ?? 'auto');
      }
    }
  }, [addHistoryEntry]);

  const handleUrlChange = useCallback(
    (tabId: string, url: string) => {
      tabUrls.current[tabId] = url;
      if (!renamedTabIds.current.has(tabId)) {
        const label = deriveTabLabel(url);
        if (label) {
          setTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, label } : t)),
          );
        }
      }
      debouncedSave();
    },
    [debouncedSave],
  );

  // Phase 8: a tab's draft (subprotocols/headers/queryParams/auth) changed —
  // debounce-save so the whole draft is persisted (read via the tab refs).
  const handleDraftChange = useCallback(() => {
    debouncedSave();
  }, [debouncedSave]);

  const handleMockPortChange = useCallback(
    (tabId: string, newPort: number) => {
      const prev = mockPortsRef.current;
      const currentPort = prev[tabId];
      const next = { ...prev };
      const conflictEntry = Object.entries(next).find(
        ([id, port]) => id !== tabId && port === newPort,
      );
      // If another tab already owns the requested port, move that tab to the
      // caller's current port (swap) so the caller deterministically gets the
      // requested port. This keeps per-tab uniqueness while allowing explicit
      // "set to 9876" operations (used by guided demo flows).
      if (conflictEntry) {
        const [conflictTabId] = conflictEntry;
        if (currentPort !== undefined && currentPort !== newPort) {
          next[conflictTabId] = currentPort;
        } else {
          const used = new Set(
            Object.entries(next)
              .filter(([id]) => id !== tabId && id !== conflictTabId)
              .map(([, p]) => p),
          );
          next[conflictTabId] = nextFreePort(new Set([...used, newPort]));
        }
      }
      next[tabId] = newPort;
      mockPortsRef.current = next;
      setMockPorts(next);
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleModeChange = useCallback(
    (tabId: string, mode: WsStudioLocation['mode']) => {
      setStudioLoc((prev) => {
        const cur = prev[tabId] ?? mapViewTabToStudioLocation('connect');
        return { ...prev, [tabId]: { ...cur, mode } };
      });
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleLeftTabChange = useCallback(
    (tabId: string, leftTab: WsStudioLocation['leftTab']) => {
      setStudioLoc((prev) => {
        const cur = prev[tabId] ?? mapViewTabToStudioLocation('connect');
        return { ...prev, [tabId]: { ...cur, leftTab } };
      });
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleRightTabChange = useCallback(
    (tabId: string, rightTab: WsStudioLocation['rightTab']) => {
      setStudioLoc((prev) => {
        const cur = prev[tabId] ?? mapViewTabToStudioLocation('connect');
        return { ...prev, [tabId]: { ...cur, rightTab } };
      });
      debouncedSave();
    },
    [debouncedSave],
  );

  if (!loaded) return null;

  return (
    <div className="ws-studio-page" data-testid="ws-studio">
      <WsConnectionTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        maxTabs={MAX_TABS}
        connectionStates={connectionStates}
        onSelect={handleSelectTab}
        onAdd={handleAddTab}
        onAddWithUrl={handleAddTabWithUrl}
        onClose={handleCloseTab}
        onRename={handleRenameTab}
        onReorder={handleReorderTab}
        onDuplicate={handleDuplicateTab}
        history={historyHook.history}
        onClearHistory={historyHook.clearHistory}
      />
      {tabs.map((tab) => {
        const loc = studioLoc[tab.id] ?? mapViewTabToStudioLocation('connect');
        return (
          <div
            key={tab.id}
            style={{ display: tab.id === activeTabId ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
            data-testid={`conn-tab-pane-${tab.id}`}
          >
            <WsConnectionTabContent
              ref={getTabRef(tab.id)}
              tabId={tab.id}
              envVarMap={envVarMap}
              endpointProtocolStatus={endpointProtocolStatus}
              globalAuthProfiles={globalAuthProfiles}
              profilesHook={profilesHook}
              templatesHook={templatesHook}
              mockPort={mockPorts[tab.id] ?? MOCK_PORT_BASE}
              onMockPortChange={handleMockPortChange}
              onConnectionStateChange={handleConnectionStateChange}
              onUrlChange={handleUrlChange}
              onDraftChange={handleDraftChange}
              initialUrl={initialUrlsRef.current[tab.id]}
              initialProtocol={initialProtocolsRef.current[tab.id]}
              initialDraft={initialDraftsRef.current[tab.id]}
              controlledLeftTab={loc.leftTab}
              controlledMode={loc.mode}
              controlledRightTab={loc.rightTab}
              onModeChange={(m) => handleModeChange(tab.id, m)}
              onLeftTabChange={(lt) => handleLeftTabChange(tab.id, lt)}
              onRightTabChange={(rt) => handleRightTabChange(tab.id, rt)}
              history={historyHook.history}
              onClearHistory={historyHook.clearHistory}
            />
          </div>
        );
      })}
      {pendingCloseTabId != null && (
        <ConfirmModal
          title="Close Active Connection"
          message="This connection is active. Close and disconnect?"
          confirmLabel="Close"
          variant="danger"
          onConfirm={() => {
            const id = pendingCloseTabId;
            setPendingCloseTabId(null);
            doCloseTab(id);
          }}
          onCancel={() => setPendingCloseTabId(null)}
        />
      )}
    </div>
  );
}

export { deriveTabLabel } from './WebSocketStudioPage.helpers'; // eslint-disable-line react-refresh/only-export-components
