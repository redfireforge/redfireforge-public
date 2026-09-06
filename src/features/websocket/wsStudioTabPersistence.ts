import type {
  WsConnectionDraft,
  WsPersistedTabState,
  WsStudioLocation,
  WsViewTab,
} from '@shared/websocket/types';
import {
  deriveViewTabFromStudio,
  mapViewTabToStudioLocation,
} from '@shared/websocket/types';
import type { ConnectionStateHint, WsConnectionTabInfo } from './WsConnectionTabBar';
import {
  MOCK_PORT_BASE,
  applyDemoWsStudioMode,
  isAutoMockPort,
  LOCALHOST_WS_URL_RE,
  advanceSeqPastRestoredIds,
  nextFreePort,
} from './WebSocketStudioPage.helpers';

export type WsTabDraftFields = Pick<
  WsConnectionDraft,
  'subprotocols' | 'headers' | 'queryParams' | 'auth'
>;

export interface RestoredWsStudioTabs {
  tabs: WsConnectionTabInfo[];
  activeTabId: string;
  renamedTabIds: string[];
  connectionStates: Record<string, ConnectionStateHint>;
  urls: Record<string, string>;
  views: Record<string, WsViewTab>;
  initialUrls: Record<string, string>;
  initialDrafts: Record<string, Partial<WsConnectionDraft>>;
  studioLocs: Record<string, WsStudioLocation>;
  mockPorts: Record<string, number>;
}

function normalizeLocalhostUrl(
  tabId: string,
  urls: Record<string, string>,
  restoredTabs: WsConnectionTabInfo[],
  initialUrls: Record<string, string>,
): void {
  const rawUrl = urls[tabId] ?? '';
  if (!LOCALHOST_WS_URL_RE.test(rawUrl)) return;
  const suffix = rawUrl.match(LOCALHOST_WS_URL_RE)?.[1] ?? '';
  const normalizedUrl = `ws://localhost:${MOCK_PORT_BASE}${suffix}`;
  urls[tabId] = normalizedUrl;
  const restored = restoredTabs.find((t) => t.id === tabId);
  if (restored) restored.url = normalizedUrl;
  initialUrls[tabId] = normalizedUrl;
}

export function pinWsTabToBasePort(
  tabId: string,
  mockPorts: Record<string, number>,
  urls: Record<string, string>,
  restoredTabs: WsConnectionTabInfo[],
  initialUrls: Record<string, string>,
): void {
  if (mockPorts[tabId] === MOCK_PORT_BASE) {
    normalizeLocalhostUrl(tabId, urls, restoredTabs, initialUrls);
    return;
  }
  const oldPort = mockPorts[tabId];
  const conflictId = Object.entries(mockPorts).find(
    ([id, port]) => id !== tabId && port === MOCK_PORT_BASE,
  )?.[0];
  if (conflictId) {
    const used = new Set(
      Object.entries(mockPorts)
        .filter(([id]) => id !== conflictId && id !== tabId)
        .map(([, p]) => p),
    );
    used.add(MOCK_PORT_BASE);
    mockPorts[conflictId] =
      oldPort !== undefined && oldPort !== MOCK_PORT_BASE
        ? oldPort
        : nextFreePort(used);
  }
  mockPorts[tabId] = MOCK_PORT_BASE;
  normalizeLocalhostUrl(tabId, urls, restoredTabs, initialUrls);
}

/** Rebuild in-memory studio tabs from persisted state (ports, draft, studio loc). */
export function restoreWsPersistedTabs(state: WsPersistedTabState): RestoredWsStudioTabs {
  const restoredTabs: WsConnectionTabInfo[] = state.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    url: t.url,
  }));
  advanceSeqPastRestoredIds(restoredTabs);

  const connectionStates: Record<string, ConnectionStateHint> = {};
  const urls: Record<string, string> = {};
  const views: Record<string, WsViewTab> = {};
  const initialUrls: Record<string, string> = {};
  const initialDrafts: Record<string, Partial<WsConnectionDraft>> = {};
  const locs: Record<string, WsStudioLocation> = {};
  const assignedPorts = new Set<number>();
  const mockPorts: Record<string, number> = {};

  for (const t of state.tabs) {
    connectionStates[t.id] = 'disconnected';
    urls[t.id] = t.url;
    views[t.id] = t.viewTab;
    if (t.url) initialUrls[t.id] = t.url;
    initialDrafts[t.id] = {
      subprotocols: t.subprotocols ?? '',
      headers: t.headers ?? [],
      queryParams: t.queryParams ?? [],
      auth: t.auth,
    };
    const derived = mapViewTabToStudioLocation(t.viewTab);
    locs[t.id] = {
      mode: t.mode ?? derived.mode,
      leftTab: t.leftTab ?? derived.leftTab,
      rightTab: t.rightTab ?? derived.rightTab,
    };
    if (t.mockPort && !assignedPorts.has(t.mockPort)) {
      mockPorts[t.id] = t.mockPort;
      assignedPorts.add(t.mockPort);
    } else {
      const p = nextFreePort(assignedPorts);
      mockPorts[t.id] = p;
      assignedPorts.add(p);
    }
  }

  const firstTab = state.tabs[0];
  if (
    state.tabs.length === 1
    && firstTab
    && mockPorts[firstTab.id] !== undefined
    && mockPorts[firstTab.id] !== MOCK_PORT_BASE
    && isAutoMockPort(mockPorts[firstTab.id])
  ) {
    pinWsTabToBasePort(firstTab.id, mockPorts, urls, restoredTabs, initialUrls);
  } else if (
    firstTab
    && (firstTab.label === 'New Connection' || /^demo$/i.test(firstTab.label))
  ) {
    pinWsTabToBasePort(firstTab.id, mockPorts, urls, restoredTabs, initialUrls);
  }
  const demoTab = state.tabs.find((t) => /^demo$/i.test(t.label));
  if (demoTab && demoTab.id !== firstTab?.id) {
    pinWsTabToBasePort(demoTab.id, mockPorts, urls, restoredTabs, initialUrls);
  }

  return {
    tabs: restoredTabs,
    activeTabId: state.activeTabId,
    renamedTabIds: state.renamedTabIds,
    connectionStates,
    urls,
    views,
    initialUrls,
    initialDrafts,
    studioLocs: applyDemoWsStudioMode(locs),
    mockPorts,
  };
}

export function buildWsPersistedTabState(args: {
  tabs: WsConnectionTabInfo[];
  studioLocs: Record<string, WsStudioLocation>;
  viewTabs: Record<string, WsViewTab>;
  urls: Record<string, string>;
  mockPorts: Record<string, number>;
  activeTabId: string;
  renamedTabIds: string[];
  readDraft: (id: string) => WsTabDraftFields;
}): WsPersistedTabState {
  return {
    tabs: args.tabs.map((t) => {
      const loc = args.studioLocs[t.id];
      let viewTab: WsViewTab;
      let mode = loc?.mode;
      let leftTab = loc?.leftTab;
      let rightTab = loc?.rightTab;
      if (loc) {
        viewTab = deriveViewTabFromStudio(loc.mode, loc.leftTab);
      } else {
        viewTab = args.viewTabs[t.id] ?? 'connect';
        const derived = mapViewTabToStudioLocation(viewTab);
        mode = mode ?? derived.mode;
        leftTab = leftTab ?? derived.leftTab;
        rightTab = rightTab ?? derived.rightTab;
      }
      return {
        id: t.id,
        label: t.label,
        url: args.urls[t.id] ?? '',
        viewTab,
        mode,
        leftTab,
        rightTab,
        mockPort: args.mockPorts[t.id],
        ...args.readDraft(t.id),
      };
    }),
    activeTabId: args.activeTabId,
    renamedTabIds: args.renamedTabIds,
  };
}
