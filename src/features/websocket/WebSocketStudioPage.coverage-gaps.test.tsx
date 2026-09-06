/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WebSocketStudioPage, deriveTabLabel } from './WebSocketStudioPage';
import {
  DEMO_INITIAL_SURFACE_EVENT,
  clearDemoInitialSurface,
  setDemoInitialSurface,
} from '@shared/demoInitialSurface';

const {
  mockLoadWsTabState,
  mockSaveWsTabState,
  mockHistoryReturn,
  capturedTabBarPropsRef,
  capturedContentProps,
} = vi.hoisted(() => ({
  mockLoadWsTabState: vi.fn(async () => null),
  mockSaveWsTabState: vi.fn(async () => undefined),
  mockHistoryReturn: {
    history: [] as Array<{ url: string; protocol: string; lastUsed: string }>,
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    clearHistory: vi.fn(),
  },
  capturedTabBarPropsRef: { current: {} as Record<string, unknown> },
  capturedContentProps: {} as Record<string, Record<string, unknown>>,
}));

function setCapturedContentProps(tabId: string, props: Record<string, unknown>): void {
  capturedContentProps[tabId] = props;
}

vi.mock('../../shared/websocket/websocketStorage', () => ({
  loadWsTabState: mockLoadWsTabState,
  saveWsTabState: mockSaveWsTabState,
}));

vi.mock('../../app/hooks/useWebSocketProfiles', () => ({
  useWebSocketProfiles: () => ({
    profiles: [],
    loading: false,
    error: null,
    saveProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    duplicateProfile: vi.fn(),
    importProfiles: vi.fn(),
    exportProfiles: vi.fn(),
    loadProfileAsDraft: vi.fn(),
  }),
}));

vi.mock('../../app/hooks/useWebSocketTemplates', () => ({
  useWebSocketTemplates: () => ({
    templates: [],
    loading: false,
    error: null,
    saveTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    loadTemplate: vi.fn(),
  }),
}));

vi.mock('../../app/hooks/useWebSocketHistory', () => ({
  useWebSocketHistory: () => mockHistoryReturn,
}));

vi.mock('../../shared/components/ConfirmModal', () => ({
  default: ({ title, message, onConfirm, onCancel }: { title: string; message: React.ReactNode; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="ws-confirm-modal">
      <div>{title}</div>
      <div>{message}</div>
      <button data-testid="ws-confirm-confirm" type="button" onClick={onConfirm}>confirm</button>
      <button data-testid="ws-confirm-cancel" type="button" onClick={onCancel}>cancel</button>
    </div>
  ),
}));

vi.mock('./WsConnectionTabBar', () => ({
  WsConnectionTabBar: (props: Record<string, unknown>) => {
    capturedTabBarPropsRef.current = props;
    const tabs = props.tabs as Array<{ id: string; label: string; url?: string }>;
    return (
      <div data-testid="mock-ws-tab-bar">
        <div data-testid="mock-ws-active-tab">{String(props.activeTabId ?? '')}</div>
        <button data-testid="mock-ws-add" type="button" onClick={() => (props.onAdd as (() => void) | undefined)?.()}>add</button>
        <button data-testid="mock-ws-add-url" type="button" onClick={() => (props.onAddWithUrl as ((url: string, protocol?: string) => void) | undefined)?.('ws://my%server:1234', 'graphql-ws')}>add-url</button>
        <button data-testid="mock-ws-add-url-empty" type="button" onClick={() => (props.onAddWithUrl as ((url: string, protocol?: string) => void) | undefined)?.('ws://', undefined)}>add-url-empty</button>
        {tabs.map((tab, index) => (
          <div key={tab.id} data-testid={`mock-ws-tab-${tab.id}`}>
            <span>{tab.label}</span>
            <button data-testid={`mock-ws-duplicate-${tab.id}`} type="button" onClick={() => (props.onDuplicate as ((id: string) => void) | undefined)?.(tab.id)}>duplicate</button>
            <button data-testid={`mock-ws-rename-${tab.id}`} type="button" onClick={() => (props.onRename as ((id: string, label: string) => void) | undefined)?.(tab.id, 'Renamed Tab')}>rename</button>
            <button data-testid={`mock-ws-reorder-${tab.id}`} type="button" onClick={() => (props.onReorder as ((fromIndex: number, toIndex: number) => void) | undefined)?.(index, 0)}>reorder</button>
            <button data-testid={`mock-ws-close-${tab.id}`} type="button" onClick={() => (props.onClose as ((id: string) => void) | undefined)?.(tab.id)}>close</button>
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('./WsConnectionTabContent', () => ({
  WsConnectionTabContent: React.forwardRef(function MockWsConnectionTabContent(props: Record<string, unknown>, _ref) {
    const tabId = String(props.tabId);
    setCapturedContentProps(tabId, props);
    return <div data-testid={`mock-ws-content-${tabId}`} />;
  }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
  }),
}));

beforeEach(() => {
  mockLoadWsTabState.mockReset();
  mockLoadWsTabState.mockResolvedValue(null);
  mockSaveWsTabState.mockReset();
  mockHistoryReturn.history = [];
  mockHistoryReturn.addEntry.mockReset();
  mockHistoryReturn.removeEntry.mockReset();
  mockHistoryReturn.clearHistory.mockReset();
  capturedTabBarPropsRef.current = {};
  for (const key of Object.keys(capturedContentProps)) delete capturedContentProps[key];
  clearDemoInitialSurface();
});

async function renderPage(state?: unknown) {
  if (state) mockLoadWsTabState.mockResolvedValueOnce(state as never);
  await act(async () => {
    render(<WebSocketStudioPage />);
  });
}

describe('WebSocketStudioPage coverage gaps', () => {
  it('duplicates a renamed tab and copies persisted seed props into the duplicated child', async () => {
    await renderPage({
      tabs: [
        {
          id: 'ws-tab-1',
          label: 'Custom Name',
          url: 'ws://demo.local/socket',
          viewTab: 'mock',
          mode: 'mock',
          leftTab: 'send',
          rightTab: 'stats',
          subprotocols: 'graphql-ws',
          headers: [{ key: 'X-Test', value: '1', enabled: true }],
          queryParams: [{ key: 'q', value: 'v', enabled: true }],
          auth: { type: 'bearer', token: 'secret' },
          mockPort: 9988,
        },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: ['ws-tab-1'],
    });

    fireEvent.click(screen.getByTestId('mock-ws-duplicate-ws-tab-1'));

    const tabs = (capturedTabBarPropsRef.current.tabs as Array<{ id: string; label: string; url?: string }>);
    expect(tabs).toHaveLength(2);
    expect(tabs[1].label).toBe('Custom Name (copy)');
    expect(tabs[1].url).toBe('ws://demo.local/socket');

    const duplicateId = tabs[1].id;
    const props = capturedContentProps[duplicateId];
    expect(props.initialUrl).toBe('ws://demo.local/socket');
    expect(props.initialDraft).toMatchObject({
      subprotocols: 'graphql-ws',
      headers: [{ key: 'X-Test', value: '1', enabled: true }],
      queryParams: [{ key: 'q', value: 'v', enabled: true }],
      auth: { type: 'bearer', token: 'secret' },
    });
    expect(props.controlledMode).toBe('mock');
    expect(props.controlledLeftTab).toBe('send');
    expect(props.controlledRightTab).toBe('stats');
  });

  it('adds a URL tab with regex-fallback label when URL parsing fails', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('mock-ws-add-url'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ label: string; url?: string }>;
    const added = tabs.find((tab) => tab.url === 'ws://my%server:1234');
    expect(added?.label).toBe('my%server:1234');
  });

  it('falls back to "New Connection" when add-with-url cannot derive a label and no protocol is supplied', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('mock-ws-add-url-empty'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ label: string; url?: string; id: string }>;
    const added = tabs.find((tab) => tab.url === 'ws://');
    expect(added?.label).toBe('New Connection');
    if (added) {
      const props = capturedContentProps[added.id];
      expect(props.initialProtocol).toBeUndefined();
    }
  });

  it('does not add or duplicate when already at max tabs', async () => {
    await renderPage({
      tabs: Array.from({ length: 8 }, (_, index) => ({ id: `ws-tab-${index + 1}`, label: `Tab ${index + 1}`, url: '', viewTab: 'connect' })),
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-add'));
    fireEvent.click(screen.getByTestId('mock-ws-add-url-empty'));
    fireEvent.click(screen.getByTestId('mock-ws-duplicate-ws-tab-1'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string }>;
    expect(tabs).toHaveLength(8);
  });

  it('duplicates a non-renamed tab without copy suffix and without seed props when none exist', async () => {
    await renderPage({
      tabs: [{ id: 'ws-tab-1', label: 'Plain', url: '', viewTab: 'connect' }],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-duplicate-ws-tab-1'));
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; label: string; url?: string }>;
    expect(tabs).toHaveLength(2);
    expect(tabs[1].label).toBe('Plain');
    const duplicateProps = capturedContentProps[tabs[1].id];
    expect(duplicateProps.initialDraft).toMatchObject({ subprotocols: '', headers: [], queryParams: [], auth: undefined });
    expect(duplicateProps.controlledMode).toBe('client');
  });

  it('duplicates an add-with-url tab and preserves the seeded protocol', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('mock-ws-add-url'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; url?: string }>;
    const added = tabs.find((tab) => tab.url === 'ws://my%server:1234');
    expect(added).toBeTruthy();

    fireEvent.click(screen.getByTestId(`mock-ws-duplicate-${added!.id}`));
    const nextTabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; url?: string }>;
    const duplicate = nextTabs.at(-1)!;
    expect(capturedContentProps[duplicate.id].initialProtocol).toBe('graphql-ws');
  });

  it('keeps a connected tab open until confirm and then closes it', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'Active', url: 'ws://a', viewTab: 'connect' },
        { id: 'ws-tab-2', label: 'Other', url: '', viewTab: 'connect' },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onConnectionStateChange as (tabId: string, state: string) => void)('ws-tab-1', 'connected');
    });
    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-1'));
    expect(screen.getByTestId('ws-confirm-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ws-confirm-confirm'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string }>;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe('ws-tab-2');
  });

  it('closing a disconnected non-active tab preserves the active tab and ignores closing the last tab', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'Active', url: '', viewTab: 'connect' },
        { id: 'ws-tab-2', label: 'Other', url: '', viewTab: 'connect' },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-2'));
    expect(screen.getByTestId('mock-ws-active-tab').textContent).toBe('ws-tab-1');

    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-1'));
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string }>;
    expect(tabs).toHaveLength(1);
  });

  it('adds history entry with explicit protocol and with auto fallback when connected', async () => {
    await renderPage({
      tabs: [{ id: 'ws-tab-1', label: 'Hist', url: '', viewTab: 'connect' }],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onUrlChange as (tabId: string, url: string) => void)('ws-tab-1', 'ws://history.local');
      (capturedContentProps['ws-tab-1'].onConnectionStateChange as (tabId: string, state: string, protocol?: string) => void)('ws-tab-1', 'connected', 'graphql-ws');
      (capturedContentProps['ws-tab-1'].onConnectionStateChange as (tabId: string, state: string, protocol?: string) => void)('ws-tab-1', 'connected');
    });

    expect(mockHistoryReturn.addEntry).toHaveBeenNthCalledWith(1, 'ws://history.local', 'graphql-ws');
    expect(mockHistoryReturn.addEntry).toHaveBeenNthCalledWith(2, 'ws://history.local', 'auto');
  });

  it('does not relabel when url change cannot derive a label', async () => {
    await renderPage({
      tabs: [{ id: 'ws-tab-1', label: 'Keep Me', url: '', viewTab: 'connect' }],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onUrlChange as (tabId: string, url: string) => void)('ws-tab-1', 'http://not-websocket');
    });
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ label: string }>;
    expect(tabs[0].label).toBe('Keep Me');
  });

  it('renames and reorders tabs via tab-bar callbacks', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'First', url: '', viewTab: 'connect' },
        { id: 'ws-tab-2', label: 'Second', url: '', viewTab: 'connect' },
      ],
      activeTabId: 'ws-tab-2',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-rename-ws-tab-2'));
    let tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; label: string }>;
    expect(tabs.find((t) => t.id === 'ws-tab-2')?.label).toBe('Renamed Tab');

    fireEvent.click(screen.getByTestId('mock-ws-reorder-ws-tab-2'));
    tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; label: string }>;
    expect(tabs[0].id).toBe('ws-tab-2');
  });

  it('normalizes survivor localhost URL to base port after closing sibling', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'A', url: 'ws://localhost:9881/path', viewTab: 'connect', mockPort: 9881 },
        { id: 'ws-tab-2', label: 'B', url: 'ws://localhost:9877/path', viewTab: 'connect', mockPort: 9877 },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-2'));
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; url?: string }>;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].url).toBe('ws://localhost:9876/path');
    expect((capturedContentProps['ws-tab-1'].mockPort as number)).toBe(9876);
  });

  it('closes a tab with a persisted mock port and leaves non-localhost survivor URLs unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'Remote', url: 'wss://echo.example/ws', viewTab: 'connect', mockPort: 9881 },
        { id: 'ws-tab-2', label: 'CloseMe', url: '', viewTab: 'connect', mockPort: 9877 },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-2'));
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; url?: string }>;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].url).toBe('wss://echo.example/ws');
    expect(fetchSpy).toHaveBeenCalledWith('/api/ws/mock/stop', expect.objectContaining({ method: 'POST' }));
  });

  it('reassigns conflicting mock ports and preserves existing owner where applicable', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'A', url: '', viewTab: 'connect', mockPort: 9879 },
        { id: 'ws-tab-2', label: 'B', url: '', viewTab: 'connect', mockPort: 9880 },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onMockPortChange as (tabId: string, port: number) => void)('ws-tab-1', 9880);
    });

    const firstPort = capturedContentProps['ws-tab-1'].mockPort as number;
    const secondPort = capturedContentProps['ws-tab-2'].mockPort as number;
    expect(firstPort).toBe(9880);
    expect(secondPort).not.toBe(9880);
  });

  it('keeps single tab when close is invoked on last tab (guard branch)', async () => {
    await renderPage({
      tabs: [{ id: 'ws-tab-1', label: 'Solo', url: '', viewTab: 'connect' }],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-1'));
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string }>;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe('ws-tab-1');
  });

  it('pins first New Connection tab to base port on load and handles base-port conflict reassignment', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'New Connection', url: 'ws://localhost:9882/path', viewTab: 'connect', mockPort: 9882 },
        { id: 'ws-tab-2', label: 'Other', url: 'ws://localhost:9876/other', viewTab: 'connect', mockPort: 9876 },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    const tab1 = capturedContentProps['ws-tab-1'];
    const tab2 = capturedContentProps['ws-tab-2'];
    expect(tab1.mockPort).toBe(9876);
    expect(tab2.mockPort).toBe(9882);

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; url?: string }>;
    expect(tabs.find((t) => t.id === 'ws-tab-1')?.url).toBe('ws://localhost:9876/path');
  });

  it('duplicate callback can hit MAX_TABS guard inside setTabs callback', async () => {
    await renderPage({
      tabs: Array.from({ length: 7 }, (_, index) => ({
        id: `ws-tab-${index + 1}`,
        label: index === 0 ? 'DupMe' : `Tab ${index + 1}`,
        url: '',
        viewTab: 'connect',
      })),
      activeTabId: 'ws-tab-1',
      renamedTabIds: ['ws-tab-1'],
    });

    fireEvent.click(screen.getByTestId('mock-ws-duplicate-ws-tab-1'));
    fireEvent.click(screen.getByTestId('mock-ws-duplicate-ws-tab-1'));
    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; label: string }>;
    expect(tabs.length).toBeLessThanOrEqual(8);
  });

  it('relabels tab when URL becomes valid websocket host', async () => {
    await renderPage({
      tabs: [{ id: 'ws-tab-1', label: 'Initial', url: '', viewTab: 'connect' }],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onUrlChange as (tabId: string, url: string) => void)('ws-tab-1', 'ws://example.org:1234/path');
    });

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string; label: string }>;
    expect(tabs[0].label).toBe('example.org:1234');
  });

  it('deriveTabLabel returns null for short hosts and invalid non-regex fallback URLs', () => {
    // Hits parsed-host-length guard inside try{}.
    expect(deriveTabLabel('ws://a:1')).toBeNull();
    // Hits catch{} + regex miss fallback.
    expect(deriveTabLabel('ws://a b')).toBeNull();
  });

  it('confirming close after tabs changed can hit doCloseTab single-tab guard', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'Conn', url: 'ws://a', viewTab: 'connect' },
        { id: 'ws-tab-2', label: 'Other', url: '', viewTab: 'connect' },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onConnectionStateChange as (tabId: string, state: string) => void)('ws-tab-1', 'connected');
    });
    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-1'));
    fireEvent.click(screen.getByTestId('mock-ws-close-ws-tab-2'));
    fireEvent.click(screen.getByTestId('ws-confirm-confirm'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string }>;
    expect(tabs).toHaveLength(1);
  });

  it('applies demo websocket mode on mount and when the demo surface event fires', async () => {
    setDemoInitialSurface({ wsStudioMode: 'mock' });
    await renderPage();

    const tabId = (capturedTabBarPropsRef.current.tabs as Array<{ id: string }>)[0].id;
    expect(capturedContentProps[tabId].controlledMode).toBe('mock');

    setDemoInitialSurface({ wsStudioMode: 'saved' });
    act(() => {
      window.dispatchEvent(new Event(DEMO_INITIAL_SURFACE_EVENT));
    });
    expect(capturedContentProps[tabId].controlledMode).toBe('saved');
  });

  it('moves a conflicting owner to the next free port when the caller has no current port', async () => {
    await renderPage({
      tabs: [
        { id: 'ws-tab-1', label: 'A', url: '', viewTab: 'connect', mockPort: 9876 },
        { id: 'ws-tab-2', label: 'B', url: '', viewTab: 'connect', mockPort: 9877 },
        { id: 'ws-tab-3', label: 'C', url: '', viewTab: 'connect', mockPort: 9878 },
      ],
      activeTabId: 'ws-tab-1',
      renamedTabIds: [],
    });

    act(() => {
      (capturedContentProps['ws-tab-1'].onMockPortChange as (tabId: string, port: number) => void)(
        'ghost-tab',
        9876,
      );
    });

    expect(capturedContentProps['ws-tab-1'].mockPort).toBe(9879);
    expect(capturedContentProps['ws-tab-2'].mockPort).toBe(9877);
    expect(capturedContentProps['ws-tab-3'].mockPort).toBe(9878);
  });

  it('seeds studio location when mode and pane tabs change on a newly added tab', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('mock-ws-add'));
    fireEvent.click(screen.getByTestId('mock-ws-add'));
    fireEvent.click(screen.getByTestId('mock-ws-add'));

    const tabs = capturedTabBarPropsRef.current.tabs as Array<{ id: string }>;
    const modeId = tabs[1].id;
    const leftId = tabs[2].id;
    const rightId = tabs[3].id;

    act(() => {
      (capturedContentProps[modeId].onModeChange as (mode: string) => void)('saved');
      (capturedContentProps[leftId].onLeftTabChange as (leftTab: string) => void)('auth');
      (capturedContentProps[rightId].onRightTabChange as (rightTab: string) => void)('schema');
    });

    expect(capturedContentProps[modeId].controlledMode).toBe('saved');
    expect(capturedContentProps[leftId].controlledLeftTab).toBe('auth');
    expect(capturedContentProps[rightId].controlledRightTab).toBe('schema');
  });

  it('ignores a demo surface event that repeats the current mode', async () => {
    setDemoInitialSurface({ wsStudioMode: 'mock' });
    await renderPage();
    const tabId = (capturedTabBarPropsRef.current.tabs as Array<{ id: string }>)[0].id;
    expect(capturedContentProps[tabId].controlledMode).toBe('mock');

    act(() => {
      window.dispatchEvent(new Event(DEMO_INITIAL_SURFACE_EVENT));
    });
    expect(capturedContentProps[tabId].controlledMode).toBe('mock');

    clearDemoInitialSurface();
    act(() => {
      window.dispatchEvent(new Event(DEMO_INITIAL_SURFACE_EVENT));
    });
    expect(capturedContentProps[tabId].controlledMode).toBe('mock');
  });
});