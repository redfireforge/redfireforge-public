import { describe, expect, it } from 'vitest';
import {
  clearDemoInitialSurface,
  setDemoInitialSurface,
} from '@shared/demoInitialSurface';
import type { WsPersistedTab, WsPersistedTabState } from '@shared/websocket/types';
import { MOCK_PORT_BASE } from './WebSocketStudioPage.helpers';
import {
  buildWsPersistedTabState,
  pinWsTabToBasePort,
  restoreWsPersistedTabs,
} from './wsStudioTabPersistence';

function tab(partial: Partial<WsPersistedTab> & Pick<WsPersistedTab, 'id' | 'label'>): WsPersistedTab {
  return {
    url: '',
    viewTab: 'connect',
    ...partial,
  };
}

function state(tabs: WsPersistedTab[], extra?: Partial<WsPersistedTabState>): WsPersistedTabState {
  return {
    tabs,
    activeTabId: tabs[0]?.id ?? '',
    renamedTabIds: [],
    ...extra,
  };
}

describe('restoreWsPersistedTabs', () => {
  it('restores tabs, drafts, and unique persisted ports', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({
        id: 'ws-tab-1',
        label: 'api.example.com',
        url: 'wss://api.example.com/ws',
        viewTab: 'messages',
        mode: 'client',
        leftTab: 'send',
        rightTab: 'events',
        mockPort: 9876,
        subprotocols: 'graphql-ws',
        headers: [{ key: 'X-A', value: '1', enabled: true }],
        queryParams: [{ key: 'q', value: '2', enabled: true }],
      }),
      tab({
        id: 'ws-tab-2',
        label: 'other',
        url: 'wss://other.example.com',
        mockPort: 9877,
      }),
    ], { activeTabId: 'ws-tab-2', renamedTabIds: ['ws-tab-1'] }));

    expect(restored.activeTabId).toBe('ws-tab-2');
    expect(restored.renamedTabIds).toEqual(['ws-tab-1']);
    expect(restored.tabs).toHaveLength(2);
    expect(restored.mockPorts['ws-tab-1']).toBe(9876);
    expect(restored.mockPorts['ws-tab-2']).toBe(9877);
    expect(restored.views['ws-tab-1']).toBe('messages');
    expect(restored.studioLocs['ws-tab-1']).toEqual({
      mode: 'client',
      leftTab: 'send',
      rightTab: 'events',
    });
    expect(restored.initialDrafts['ws-tab-1']).toEqual({
      subprotocols: 'graphql-ws',
      headers: [{ key: 'X-A', value: '1', enabled: true }],
      queryParams: [{ key: 'q', value: '2', enabled: true }],
      auth: undefined,
    });
    expect(restored.connectionStates['ws-tab-1']).toBe('disconnected');
  });

  it('assigns the next free port when mockPort is missing or duplicated', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({ id: 'a', label: 'A', mockPort: 9876 }),
      tab({ id: 'b', label: 'B' }),
      tab({ id: 'c', label: 'C', mockPort: 9876 }),
    ]));

    expect(restored.mockPorts.a).toBe(9876);
    expect(restored.mockPorts.b).toBe(9877);
    expect(restored.mockPorts.c).toBe(9878);
  });

  it('derives studio location from viewTab when mode fields are absent', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({ id: 'a', label: 'A', viewTab: 'mock' }),
    ]));
    expect(restored.studioLocs.a.mode).toBe('mock');
  });

  it('pins a sole leftover auto-range port back to 9876', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({
        id: 'only',
        label: 'api.example.com',
        url: 'ws://localhost:9878/socket',
        mockPort: 9878,
      }),
    ]));
    expect(restored.mockPorts.only).toBe(MOCK_PORT_BASE);
    expect(restored.urls.only).toBe('ws://localhost:9876/socket');
    expect(restored.tabs[0].url).toBe('ws://localhost:9876/socket');
    expect(restored.initialUrls.only).toBe('ws://localhost:9876/socket');
  });

  it('does not rewrite a non-localhost URL when pinning the sole tab', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({
        id: 'only',
        label: 'remote',
        url: 'wss://api.example.com/ws',
        mockPort: 9878,
      }),
    ]));
    expect(restored.mockPorts.only).toBe(MOCK_PORT_BASE);
    expect(restored.urls.only).toBe('wss://api.example.com/ws');
  });

  it('pins the first New Connection tab to 9876 and swaps a conflicting owner', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({ id: 'new', label: 'New Connection', mockPort: 9878 }),
      tab({ id: 'owner', label: 'owner', mockPort: 9876 }),
    ]));
    expect(restored.mockPorts.new).toBe(MOCK_PORT_BASE);
    expect(restored.mockPorts.owner).toBe(9878);
  });

  it('assigns the next free port when the pinned tab has no previous port to swap', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({ id: 'new', label: 'New Connection' }),
      tab({ id: 'owner', label: 'owner', mockPort: 9876 }),
    ]));
    expect(restored.mockPorts.new).toBe(MOCK_PORT_BASE);
    expect(restored.mockPorts.owner).not.toBe(MOCK_PORT_BASE);
  });

  it('leaves an already-base first New Connection tab in place', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({
        id: 'new',
        label: 'New Connection',
        url: 'ws://localhost:9876',
        mockPort: 9876,
      }),
    ]));
    expect(restored.mockPorts.new).toBe(MOCK_PORT_BASE);
    expect(restored.urls.new).toBe('ws://localhost:9876');
  });

  it('pins a first demo tab to the base port', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({ id: 'demo', label: 'Demo', mockPort: 9879 }),
    ]));
    expect(restored.mockPorts.demo).toBe(MOCK_PORT_BASE);
  });

  it('pins a later demo tab even when the first tab is not demo', () => {
    const restored = restoreWsPersistedTabs(state([
      tab({ id: 'first', label: 'api.example.com', mockPort: 9876 }),
      tab({ id: 'demo', label: 'demo', mockPort: 9878 }),
    ]));
    expect(restored.mockPorts.demo).toBe(MOCK_PORT_BASE);
    expect(restored.mockPorts.first).toBe(9878);
  });

  it('applies an armed demo studio mode onto restored locations', () => {
    setDemoInitialSurface({ wsStudioMode: 'mock' });
    try {
      const restored = restoreWsPersistedTabs(state([
        tab({ id: 'a', label: 'A', viewTab: 'connect' }),
      ]));
      expect(restored.studioLocs.a.mode).toBe('mock');
    } finally {
      clearDemoInitialSurface();
    }
  });
});

describe('pinWsTabToBasePort', () => {
  it('normalizes a bare localhost URL when the tab is already on 9876', () => {
    const mockPorts = { a: MOCK_PORT_BASE };
    const urls = { a: 'ws://localhost:9876' };
    const tabs = [{ id: 'a', label: 'A', url: 'ws://localhost:9876' }];
    const initialUrls = { a: 'ws://localhost:9876' };
    pinWsTabToBasePort('a', mockPorts, urls, tabs, initialUrls);
    expect(urls.a).toBe('ws://localhost:9876');
    expect(tabs[0].url).toBe('ws://localhost:9876');
  });

  it('rewrites localhost without updating a missing restored tab row', () => {
    const mockPorts = { a: MOCK_PORT_BASE };
    const urls = { a: 'ws://localhost:9876/chat' };
    const initialUrls: Record<string, string> = {};
    pinWsTabToBasePort('a', mockPorts, urls, [], initialUrls);
    expect(urls.a).toBe('ws://localhost:9876/chat');
    expect(initialUrls.a).toBe('ws://localhost:9876/chat');
  });

  it('swaps the conflicting owner and keeps unrelated ports', () => {
    const mockPorts = { new: 9880, owner: MOCK_PORT_BASE, other: 9879 };
    pinWsTabToBasePort('new', mockPorts, {}, [], {});
    expect(mockPorts.new).toBe(MOCK_PORT_BASE);
    expect(mockPorts.owner).toBe(9880);
    expect(mockPorts.other).toBe(9879);
  });

  it('assigns the next free port when the pinned tab has no previous port', () => {
    const mockPorts: Record<string, number> = { owner: MOCK_PORT_BASE };
    const urls: Record<string, string> = {};
    pinWsTabToBasePort('new', mockPorts, urls, [], {});
    expect(mockPorts.new).toBe(MOCK_PORT_BASE);
    expect(mockPorts.owner).toBe(9877);
  });

  it('pins a tab with no conflict and leaves other ports alone', () => {
    const mockPorts = { a: 9878, b: 9879 };
    pinWsTabToBasePort('a', mockPorts, {}, [], {});
    expect(mockPorts).toEqual({ a: MOCK_PORT_BASE, b: 9879 });
  });
});

describe('buildWsPersistedTabState', () => {
  const emptyDraft = () => ({
    subprotocols: '',
    headers: [],
    queryParams: [],
    auth: undefined,
  });

  it('serializes from the studio location when one exists', () => {
    const persisted = buildWsPersistedTabState({
      tabs: [{ id: 'a', label: 'A', url: 'wss://a' }],
      studioLocs: {
        a: { mode: 'client', leftTab: 'send', rightTab: 'console' },
      },
      viewTabs: {},
      urls: { a: 'wss://a/live' },
      mockPorts: { a: 9876 },
      activeTabId: 'a',
      renamedTabIds: ['a'],
      readDraft: () => ({
        subprotocols: 'graphql-ws',
        headers: [],
        queryParams: [],
        auth: undefined,
      }),
    });

    expect(persisted.activeTabId).toBe('a');
    expect(persisted.renamedTabIds).toEqual(['a']);
    expect(persisted.tabs[0]).toMatchObject({
      id: 'a',
      label: 'A',
      url: 'wss://a/live',
      viewTab: 'messages',
      mode: 'client',
      leftTab: 'send',
      rightTab: 'console',
      mockPort: 9876,
      subprotocols: 'graphql-ws',
    });
  });

  it('falls back to viewTab and empty URL when location is missing', () => {
    const persisted = buildWsPersistedTabState({
      tabs: [{ id: 'b', label: 'B' }],
      studioLocs: {},
      viewTabs: { b: 'saved' },
      urls: {},
      mockPorts: {},
      activeTabId: 'b',
      renamedTabIds: [],
      readDraft: emptyDraft,
    });

    expect(persisted.tabs[0].url).toBe('');
    expect(persisted.tabs[0].viewTab).toBe('saved');
    expect(persisted.tabs[0].mode).toBe('saved');
    expect(persisted.tabs[0].mockPort).toBeUndefined();
  });

  it('defaults a missing viewTab to connect', () => {
    const persisted = buildWsPersistedTabState({
      tabs: [{ id: 'c', label: 'C' }],
      studioLocs: {},
      viewTabs: {},
      urls: {},
      mockPorts: {},
      activeTabId: 'c',
      renamedTabIds: [],
      readDraft: emptyDraft,
    });
    expect(persisted.tabs[0].viewTab).toBe('connect');
    expect(persisted.tabs[0].mode).toBe('client');
  });
});
