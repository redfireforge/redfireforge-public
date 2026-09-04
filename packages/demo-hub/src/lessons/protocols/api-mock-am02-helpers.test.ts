/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_MOCK } from '@shared/selectors';
import { makeCtx, makeVisible } from './ws-test-utils';

const wipeApiMockWorkspace = vi.fn(async () => true);
const importApiMockGallerySample = vi.fn(async () => true);
const prepareApiMockStudioChrome = vi.fn();
const expandAppSidebar = vi.fn();

vi.mock('../../adapters', () => ({
  wipeApiMockWorkspace: (...a: unknown[]) => wipeApiMockWorkspace(...(a as [])),
  importApiMockGallerySample: (...a: unknown[]) => importApiMockGallerySample(...(a as [string])),
  prepareApiMockStudioChrome: (...a: unknown[]) => prepareApiMockStudioChrome(...(a as [])),
  expandAppSidebar: (...a: unknown[]) => expandAppSidebar(...(a as [])),
}));

import {
  AM02_BASE_PATH,
  AM02_COPY_NAME,
  AM02_CORPUS_NAME,
  AM02_CORPUS_SAMPLE,
  AM02_PAYMENTS_NAME,
  am02ActiveTabName,
  am02TabByName,
  am02TabCloseSelector,
  am02TabCount,
  am02TabDotSelector,
  am02TabId,
  am02TabName,
  am02TabNames,
  am02TabSelector,
  am02Tabs,
  am02SecondTabName,
  cleanupAm02,
  doubleClickTab,
  dragTab,
  duplicateAm02Tab,
  ensureAm02BasePath,
  ensureAm02BothRunning,
  ensureAm02Closeable,
  ensureAm02Corpus,
  ensureAm02CorpusActive,
  ensureAm02Duplicate,
  ensureAm02Renamed,
  ensureAm02SecondServer,
  ensureAm02StudioView,
  hasAm02BasePath,
  isAm02ActiveRunning,
  isAm02StudioViewActive,
  isAm02TabRunning,
  openTabContextMenu,
  prepareAm02Workspace,
  pressF2OnTab,
  renameAm02Tab,
  runAm02Duplicate,
  runAm02PersistAndClose,
  runAm02Rename,
  runAm02ReorderAndCeiling,
  runAm02Settings,
  runAm02StartBoth,
  runAm02SwitchTab,
  runAm02TabsAndNew,
  selectAm02Tab,
} from './api-mock-am02-helpers';

interface TabSpec {
  id: string;
  name: string;
  port?: number;
  status?: 'stopped' | 'running';
  active?: boolean;
}

/** Build a tab bar that mirrors `ApiMockServerTabs` markup closely enough for the beats. */
function mountTabBar(specs: TabSpec[]): void {
  const bar = document.createElement('div');
  bar.setAttribute('data-testid', 'api-mock-server-tabs');
  makeVisible(bar);
  for (const spec of specs) {
    const tab = document.createElement('div');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', spec.active ? 'true' : 'false');
    tab.setAttribute('data-server-id', spec.id);
    tab.setAttribute('data-testid', `api-mock-tab-${spec.id}`);
    tab.setAttribute('title', `${spec.name} — ${spec.status === 'running' ? 'Running' : 'Stopped'}`);
    makeVisible(tab);

    const dot = document.createElement('span');
    dot.className = `am-status-dot ${spec.status ?? 'stopped'}`;
    makeVisible(dot);
    tab.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'am-server-tab-label';
    const name = document.createElement('span');
    name.className = 'am-server-tab-name';
    name.textContent = spec.name;
    const port = document.createElement('span');
    port.className = 'am-server-tab-port';
    port.textContent = `:${spec.port ?? 4600}`;
    label.append(name, port);
    tab.appendChild(label);

    const close = document.createElement('span');
    close.setAttribute('data-testid', `api-mock-tab-close-${spec.id}`);
    makeVisible(close);
    tab.appendChild(close);

    bar.appendChild(tab);
  }
  const add = document.createElement('button');
  add.setAttribute('data-testid', 'api-mock-tab-add');
  makeVisible(add);
  bar.appendChild(add);
  document.body.appendChild(bar);
}

/** Mount visible stubs for plain `[data-testid="..."]` selectors. */
function mount(...selectors: string[]): void {
  for (const sel of selectors) {
    const id = /data-testid="([^"]+)"/.exec(sel)?.[1];
    if (!id) continue;
    const el = document.createElement('div');
    el.setAttribute('data-testid', id);
    makeVisible(el);
    document.body.appendChild(el);
  }
}

function mountText(selector: string, text: string): void {
  const id = /data-testid="([^"]+)"/.exec(selector)![1];
  const el = document.createElement('span');
  el.setAttribute('data-testid', id);
  el.textContent = text;
  makeVisible(el);
  document.body.appendChild(el);
}

function mountRenameInput(id: string): HTMLInputElement {
  const input = document.createElement('input');
  input.setAttribute('data-testid', `api-mock-tab-rename-${id}`);
  makeVisible(input);
  document.body.appendChild(input);
  return input;
}

const calls = (fn: unknown): string[] =>
  vi.mocked(fn as (s: string) => Promise<void>).mock.calls.map(c => c[0]);

const CORPUS: TabSpec = { id: 'srv-a', name: AM02_CORPUS_NAME, port: 4600, status: 'running' };
const PAYMENTS: TabSpec = { id: 'srv-b', name: AM02_PAYMENTS_NAME, port: 4601, status: 'running' };
const COPY: TabSpec = { id: 'srv-c', name: AM02_COPY_NAME, port: 4602 };
/** Only one tab may carry `aria-selected` — helpers resolve the active tab from it. */
const ACTIVE_CORPUS: TabSpec = { ...CORPUS, active: true };
const ACTIVE_PAYMENTS: TabSpec = { ...PAYMENTS, active: true };

describe('AM-02 helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // ── tab-bar identity ──────────────────────────────────────────────────────

  it('reads names, ids, and selectors off the live tab bar', () => {
    expect(am02Tabs()).toEqual([]);
    expect(am02TabCount()).toBe(0);
    expect(am02TabNames()).toEqual([]);
    expect(am02TabByName(AM02_CORPUS_NAME)).toBeNull();
    expect(am02TabId(AM02_CORPUS_NAME)).toBeNull();
    expect(am02TabSelector(AM02_CORPUS_NAME)).toBeNull();
    expect(am02TabCloseSelector(AM02_CORPUS_NAME)).toBeNull();
    expect(am02TabDotSelector(AM02_CORPUS_NAME)).toBeNull();
    expect(am02ActiveTabName()).toBe('');
    expect(am02SecondTabName()).toBeNull();

    mountTabBar([ACTIVE_CORPUS, PAYMENTS, COPY]);

    expect(am02TabCount()).toBe(3);
    expect(am02TabNames()).toEqual([AM02_CORPUS_NAME, AM02_PAYMENTS_NAME, AM02_COPY_NAME]);
    expect(am02TabId(AM02_PAYMENTS_NAME)).toBe('srv-b');
    expect(am02TabSelector(AM02_PAYMENTS_NAME)).toBe(API_MOCK.tab('srv-b'));
    expect(am02TabCloseSelector(AM02_PAYMENTS_NAME)).toBe(API_MOCK.tabClose('srv-b'));
    expect(am02TabDotSelector(AM02_PAYMENTS_NAME)).toBe(`${API_MOCK.tab('srv-b')} .am-status-dot`);
    expect(am02ActiveTabName()).toBe(AM02_CORPUS_NAME);
    // The clone is named after the corpus, so it must not be mistaken for the live one.
    expect(am02SecondTabName()).toBe(AM02_PAYMENTS_NAME);
    expect(am02TabName(am02TabByName(AM02_COPY_NAME)!)).toBe(AM02_COPY_NAME);
  });

  it('falls back to an empty name when a tab has no label span', () => {
    const bare = document.createElement('div');
    expect(am02TabName(bare)).toBe('');
  });

  it('reads running state and base path from the server bar', () => {
    expect(isAm02ActiveRunning()).toBe(false);
    expect(hasAm02BasePath()).toBe(false);
    expect(isAm02TabRunning(AM02_CORPUS_NAME)).toBe(false);

    mountTabBar([ACTIVE_CORPUS, PAYMENTS, COPY]);
    expect(isAm02TabRunning(AM02_CORPUS_NAME)).toBe(true);
    expect(isAm02TabRunning(AM02_PAYMENTS_NAME)).toBe(true);
    expect(isAm02TabRunning(AM02_COPY_NAME)).toBe(false);

    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);

    expect(isAm02ActiveRunning()).toBe(true);
    expect(hasAm02BasePath()).toBe(true);
  });

  it('treats the explorer or the empty state as the Studio view', () => {
    expect(isAm02StudioViewActive()).toBe(false);
    mount(API_MOCK.EMPTY);
    expect(isAm02StudioViewActive()).toBe(true);
    document.body.innerHTML = '';
    mount(API_MOCK.ROUTE_EXPLORER);
    expect(isAm02StudioViewActive()).toBe(true);
  });

  // ── raw-event primitives ──────────────────────────────────────────────────

  it('focuses a tab before dispatching F2', () => {
    mountTabBar([CORPUS]);
    const tab = am02TabByName(AM02_CORPUS_NAME)!;
    const focus = vi.spyOn(tab, 'focus');
    const dispatch = vi.spyOn(tab, 'dispatchEvent');

    pressF2OnTab(tab);

    expect(focus).toHaveBeenCalled();
    expect((dispatch.mock.calls[0][0] as KeyboardEvent).key).toBe('F2');
  });

  it('dispatches dblclick and a positioned contextmenu on a tab', () => {
    mountTabBar([CORPUS]);
    const tab = am02TabByName(AM02_CORPUS_NAME)!;
    const dispatch = vi.spyOn(tab, 'dispatchEvent');

    doubleClickTab(tab);
    expect((dispatch.mock.calls[0][0] as MouseEvent).type).toBe('dblclick');

    openTabContextMenu(tab);
    const menuEvent = dispatch.mock.calls[1][0] as MouseEvent;
    expect(menuEvent.type).toBe('contextmenu');
    expect(menuEvent.clientX).toBe(50);
    expect(menuEvent.clientY).toBe(20);
  });

  describe('dragTab', () => {
    const original = { DataTransfer: globalThis.DataTransfer, DragEvent: globalThis.DragEvent };

    afterEach(() => {
      Object.assign(globalThis, original);
    });

    it('drops onto the requested half of the target tab', () => {
      class FakeDataTransfer {
        private data: Record<string, string> = {};
        effectAllowed = '';
        dropEffect = '';
        types: string[] = [];
        setData(type: string, value: string) { this.data[type] = value; this.types = Object.keys(this.data); }
        getData(type: string) { return this.data[type] ?? ''; }
      }
      class FakeDragEvent extends MouseEvent {
        dataTransfer: unknown;
        constructor(type: string, init: MouseEventInit & { dataTransfer?: unknown }) {
          super(type, init);
          this.dataTransfer = init.dataTransfer;
        }
      }
      Object.assign(globalThis, { DataTransfer: FakeDataTransfer, DragEvent: FakeDragEvent });

      mountTabBar([CORPUS, PAYMENTS]);
      const [first, second] = am02Tabs();
      const events: Array<{ type: string; clientX: number }> = [];
      for (const el of [first, second]) {
        el.addEventListener('dragstart', e => events.push({ type: e.type, clientX: (e as MouseEvent).clientX }));
        el.addEventListener('dragover', e => events.push({ type: e.type, clientX: (e as MouseEvent).clientX }));
        el.addEventListener('drop', e => events.push({ type: e.type, clientX: (e as MouseEvent).clientX }));
        el.addEventListener('dragend', e => events.push({ type: e.type, clientX: (e as MouseEvent).clientX }));
      }

      expect(dragTab(second, first, 'before')).toBe(true);
      expect(events.map(e => e.type)).toEqual(['dragstart', 'dragover', 'drop', 'dragend']);
      expect(events[1].clientX).toBe(25);

      events.length = 0;
      expect(dragTab(first, second, 'after')).toBe(true);
      expect(events[1].clientX).toBe(75);
    });

    it('reports failure when the browser drag APIs are unavailable', () => {
      Object.assign(globalThis, { DataTransfer: undefined, DragEvent: undefined });
      mountTabBar([CORPUS, PAYMENTS]);
      const [first, second] = am02Tabs();
      expect(dragTab(second, first, 'before')).toBe(false);
    });
  });

  // ── boot / cleanup ────────────────────────────────────────────────────────

  it('boots with a wiped workspace plus the corpus mock, and cleans up on exit', async () => {
    await prepareAm02Workspace();
    expect(wipeApiMockWorkspace).toHaveBeenCalled();
    expect(importApiMockGallerySample).toHaveBeenCalledWith(AM02_CORPUS_SAMPLE);
    expect(prepareApiMockStudioChrome).toHaveBeenCalled();

    vi.clearAllMocks();
    await cleanupAm02();
    expect(wipeApiMockWorkspace).toHaveBeenCalled();
  });

  // ── guards ────────────────────────────────────────────────────────────────

  it('ensureAm02StudioView switches back only when the Studio view is unmounted', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER);
    await ensureAm02StudioView(ctx);
    expect(ctx.click).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    await ensureAm02StudioView(ctx);
    expect(ctx.click).not.toHaveBeenCalled();

    mount(API_MOCK.VIEW_STUDIO);
    await ensureAm02StudioView(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.VIEW_STUDIO]);
  });

  it('selectAm02Tab clicks only when another tab is active', async () => {
    const ctx = makeCtx();
    mountTabBar([ACTIVE_CORPUS, PAYMENTS]);

    expect(await selectAm02Tab(ctx, AM02_CORPUS_NAME)).toBe(true);
    expect(ctx.click).not.toHaveBeenCalled();

    expect(await selectAm02Tab(ctx, AM02_PAYMENTS_NAME)).toBe(true);
    expect(calls(ctx.click)).toEqual([API_MOCK.tab('srv-b')]);

    expect(await selectAm02Tab(ctx, 'Nope')).toBe(false);
  });

  it('ensureAm02Corpus imports the corpus only when its tab is missing', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER);
    mountTabBar([CORPUS]);
    await ensureAm02Corpus(ctx);
    expect(importApiMockGallerySample).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    mount(API_MOCK.ROUTE_EXPLORER);
    await ensureAm02Corpus(ctx);
    expect(importApiMockGallerySample).toHaveBeenCalledWith(AM02_CORPUS_SAMPLE);
  });

  it('ensureAm02SecondServer adds a tab only when the live-authored one is missing', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER);
    mountTabBar([CORPUS, PAYMENTS]);
    await ensureAm02SecondServer(ctx);
    expect(calls(ctx.click)).not.toContain(API_MOCK.TAB_ADD);

    document.body.innerHTML = '';
    mount(API_MOCK.ROUTE_EXPLORER);
    mountTabBar([CORPUS, COPY]);
    await ensureAm02SecondServer(ctx);
    expect(calls(ctx.click)).toContain(API_MOCK.TAB_ADD);
  });

  describe('renameAm02Tab', () => {
    it('commits through the editor F2 opened', async () => {
      const ctx = makeCtx();
      mountTabBar([{ id: 'srv-b', name: 'Mock Server 2', active: true }]);
      const input = mountRenameInput('srv-b');
      const dispatch = vi.spyOn(input, 'dispatchEvent');

      await renameAm02Tab(ctx, 'Mock Server 2', AM02_PAYMENTS_NAME);

      expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.tabRename('srv-b'), AM02_PAYMENTS_NAME);
      expect((dispatch.mock.calls.at(-1)![0] as KeyboardEvent).key).toBe('Enter');
      expect(ctx.waitFor).not.toHaveBeenCalled();
    });

    it('falls back to double-click when F2 did not open the editor', async () => {
      const ctx = makeCtx();
      mountTabBar([{ id: 'srv-b', name: 'Mock Server 2', active: true }]);

      expect(await renameAm02Tab(ctx, 'Mock Server 2', AM02_PAYMENTS_NAME)).toBe(false);
      expect(ctx.waitFor).toHaveBeenCalledWith(API_MOCK.tabRename('srv-b'), 4_000);
    });

    it('reports failure for an unknown tab or a tab without a server id', async () => {
      const ctx = makeCtx();
      mountTabBar([CORPUS]);
      expect(await renameAm02Tab(ctx, 'Ghost', 'X')).toBe(false);

      am02TabByName(AM02_CORPUS_NAME)!.removeAttribute('data-server-id');
      expect(await renameAm02Tab(ctx, AM02_CORPUS_NAME, 'X')).toBe(false);
    });
  });

  it('ensureAm02Renamed skips when the name is taken and bails without a second tab', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER);
    mountTabBar([CORPUS, PAYMENTS]);
    await ensureAm02Renamed(ctx);
    expect(ctx.fill).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    mount(API_MOCK.ROUTE_EXPLORER);
    mountTabBar([{ id: 'srv-b', name: 'Mock Server 2', active: true }, CORPUS]);
    await ensureAm02Renamed(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.tabRename('srv-b'), AM02_PAYMENTS_NAME);
  });

  it('ensureAm02Renamed stops quietly when no tab can be renamed', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER);
    // Corpus + clone only: `ensureAm02SecondServer` clicks +, which cannot mount a tab here.
    mountTabBar([CORPUS, COPY]);
    await ensureAm02Renamed(ctx);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  describe('ensureAm02BasePath', () => {
    it('does nothing when the address already carries the prefix', async () => {
      const ctx = makeCtx();
      mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
      mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
      mountTabBar([CORPUS, ACTIVE_PAYMENTS]);

      await ensureAm02BasePath(ctx);
      expect(calls(ctx.click)).not.toContain(API_MOCK.SETTINGS);
    });

    it('opens settings, fills the prefix, and saves', async () => {
      const ctx = makeCtx();
      mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
      mountText(API_MOCK.ADDRESS, 'http://127.0.0.1:4601');
      mountTabBar([CORPUS, ACTIVE_PAYMENTS]);

      await ensureAm02BasePath(ctx);
      expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.SETTINGS_BASE_PATH, AM02_BASE_PATH);
      expect(calls(ctx.click)).toEqual([API_MOCK.SETTINGS, API_MOCK.SETTINGS_SAVE]);
    });

    it('does not switch to Payments just to re-read an already-applied prefix', async () => {
      const ctx = makeCtx();
      mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
      mountText(API_MOCK.ADDRESS, 'http://127.0.0.1:4600/api/v1');
      mountTabBar([ACTIVE_CORPUS, PAYMENTS]);

      await ensureAm02BasePath(ctx);
      expect(calls(ctx.click)).not.toContain(API_MOCK.tab('srv-b'));
      expect(calls(ctx.click)).not.toContain(API_MOCK.SETTINGS);
    });
  });

  it('ensureAm02BothRunning starts each listener that is not already bound', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS, API_MOCK.START);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Stopped');
    mountTabBar([
      { ...CORPUS, status: 'stopped' },
      { ...ACTIVE_PAYMENTS, status: 'stopped' },
    ]);

    await ensureAm02BothRunning(ctx);
    expect(calls(ctx.click).filter(c => c === API_MOCK.START)).toHaveLength(2);
  });

  it('ensureAm02BothRunning leaves a running listener alone and skips a missing Start', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountTabBar([CORPUS, ACTIVE_PAYMENTS]);

    await ensureAm02BothRunning(ctx);
    expect(ctx.click).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Stopped');
    mountTabBar([
      { ...CORPUS, status: 'stopped' },
      { ...ACTIVE_PAYMENTS, status: 'stopped' },
    ]);
    await ensureAm02BothRunning(ctx);
    expect(calls(ctx.click)).not.toContain(API_MOCK.START);
  });

  it('ensureAm02CorpusActive selects the corpus tab', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountTabBar([CORPUS, ACTIVE_PAYMENTS]);

    await ensureAm02CorpusActive(ctx);
    expect(calls(ctx.click)).toContain(API_MOCK.tab('srv-a'));
  });

  describe('duplicateAm02Tab', () => {
    it('clicks Duplicate Tab in the context menu', async () => {
      const ctx = makeCtx();
      mountTabBar([CORPUS]);
      mount(API_MOCK.TAB_CTX_MENU, API_MOCK.TAB_CTX_DUPLICATE);

      expect(await duplicateAm02Tab(ctx, AM02_CORPUS_NAME)).toBe(false);
      expect(calls(ctx.click)).toEqual([API_MOCK.TAB_CTX_DUPLICATE]);
      expect(calls(ctx.waitFor)).toContain(API_MOCK.tabTitled(AM02_COPY_NAME));
    });

    it('reports failure for an unknown tab or a menu without the item', async () => {
      const ctx = makeCtx();
      mountTabBar([CORPUS]);
      expect(await duplicateAm02Tab(ctx, 'Ghost')).toBe(false);
      expect(await duplicateAm02Tab(ctx, AM02_CORPUS_NAME)).toBe(false);
      expect(ctx.click).not.toHaveBeenCalled();
    });
  });

  it('ensureAm02Duplicate skips when the clone already exists', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountTabBar([CORPUS, PAYMENTS, COPY]);

    await ensureAm02Duplicate(ctx);
    expect(calls(ctx.click)).not.toContain(API_MOCK.TAB_CTX_DUPLICATE);
    expect(calls(ctx.click)).not.toContain(API_MOCK.tab('srv-a'));
    expect(calls(ctx.click)).not.toContain(API_MOCK.tab('srv-b'));
  });

  it('ensureAm02Duplicate duplicates the corpus tab when the clone is missing', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS, API_MOCK.TAB_CTX_MENU, API_MOCK.TAB_CTX_DUPLICATE);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountTabBar([CORPUS, PAYMENTS]);

    await ensureAm02Duplicate(ctx);
    expect(calls(ctx.click)).toContain(API_MOCK.TAB_CTX_DUPLICATE);
  });

  it('ensureAm02Closeable re-runs the rename guard when the closable tab is gone', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
    mountText(API_MOCK.ADDRESS, `http://127.0.0.1:4601${AM02_BASE_PATH}`);
    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountTabBar([CORPUS, PAYMENTS, COPY]);
    await ensureAm02Closeable(ctx);
    expect(ctx.fill).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    mount(API_MOCK.ROUTE_EXPLORER, API_MOCK.SETTINGS);
    mountText(API_MOCK.ADDRESS, 'http://127.0.0.1:4601');
    mountText(API_MOCK.STATUS_LABEL, 'Running');
    mountTabBar([CORPUS, { id: 'srv-b', name: 'Mock Server 2' }, COPY]);
    await ensureAm02Closeable(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.tabRename('srv-b'), AM02_PAYMENTS_NAME);
  });

  // ── step bodies ───────────────────────────────────────────────────────────

  it('step 1 reads the existing tab, then adds a server', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS]);
    mount(API_MOCK.ADDRESS, API_MOCK.ROUTES_EMPTY);

    await runAm02TabsAndNew(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.TAB_ADD]);
    expect(calls(ctx.waitFor)).toContain(API_MOCK.ROUTES_EMPTY);
  });

  it('step 1 tolerates a corpus tab that has not mounted yet', async () => {
    const ctx = makeCtx();
    mountTabBar([{ id: 'srv-b', name: 'Mock Server 2', active: true }]);
    await runAm02TabsAndNew(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.TAB_ADD]);
  });

  it('step 2 renames the live-authored tab and holds on the new label', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, { id: 'srv-b', name: 'Mock Server 2', active: true }]);
    mountRenameInput('srv-b');

    await runAm02Rename(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.tabRename('srv-b'), AM02_PAYMENTS_NAME);
  });

  it('step 2 is a no-op when only the corpus and its clone are open', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, COPY]);
    await runAm02Rename(ctx);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('step 3 fills the base path, tours both host choices, and saves', async () => {
    const ctx = makeCtx();
    mount(
      API_MOCK.SETTINGS,
      API_MOCK.SETTINGS_MODAL,
      API_MOCK.SETTINGS_NAME,
      API_MOCK.SETTINGS_PORT,
      API_MOCK.SETTINGS_LISTEN_URL,
      API_MOCK.SETTINGS_BASE_PATH,
      API_MOCK.SETTINGS_HOST,
      API_MOCK.SETTINGS_HOST_WARNING,
      API_MOCK.SETTINGS_SAVE,
      API_MOCK.ADDRESS,
    );

    await runAm02Settings(ctx);
    expect(ctx.delay.mock.calls.some(([ms]) => (ms as number) >= 1600)).toBe(true);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.SETTINGS_BASE_PATH, AM02_BASE_PATH);
    expect(vi.mocked(ctx.selectOption).mock.calls).toEqual([
      [API_MOCK.SETTINGS_HOST, '0.0.0.0'],
      [API_MOCK.SETTINGS_HOST, '127.0.0.1'],
    ]);
    expect(calls(ctx.click)).toEqual([API_MOCK.SETTINGS, API_MOCK.SETTINGS_SAVE]);
  });

  it('step 4 starts the active server, switches tabs, and starts the other', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, ACTIVE_PAYMENTS]);
    mount(API_MOCK.START, API_MOCK.STOP, API_MOCK.STATUS_LABEL);

    await runAm02StartBoth(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.START, API_MOCK.tab('srv-a'), API_MOCK.START]);
  });

  it('step 4 skips the second Start when that server is already bound', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, ACTIVE_PAYMENTS]);
    mount(API_MOCK.STOP, API_MOCK.STATUS_LABEL);

    await runAm02StartBoth(ctx);
    // The active server's Start is unconditional; only the second one is guarded.
    expect(calls(ctx.click)).toEqual([API_MOCK.START, API_MOCK.tab('srv-a')]);
  });

  it('step 5 switches to the payments tab and back to the corpus', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, PAYMENTS]);
    mount(API_MOCK.ADDRESS, API_MOCK.ROUTES_EMPTY);

    await runAm02SwitchTab(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.tab('srv-b'), API_MOCK.tab('srv-a')]);
  });

  it('step 6 duplicates through the tab context menu', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, PAYMENTS]);
    mount(API_MOCK.TAB_CTX_MENU, API_MOCK.TAB_CTX_DUPLICATE, API_MOCK.ADDRESS);

    await runAm02Duplicate(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.TAB_CTX_DUPLICATE, API_MOCK.TAB_CTX_DUPLICATE]);
    expect(calls(ctx.waitFor)).toContain(API_MOCK.TAB_CTX_MENU);
    expect(calls(ctx.waitFor)).toContain(API_MOCK.tabTitled(AM02_COPY_NAME));
  });

  it('step 6 still holds on the active tab when no tab bar is mounted', async () => {
    const ctx = makeCtx();
    mount(API_MOCK.ADDRESS);
    await runAm02Duplicate(ctx);
    expect(ctx.click).not.toHaveBeenCalled();
  });

  it('step 7 walks the order, drags the last tab, and reads the ceiling', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, PAYMENTS, COPY]);
    const last = am02Tabs()[2];
    const dispatch = vi.spyOn(last, 'dispatchEvent');

    await runAm02ReorderAndCeiling(ctx);
    // jsdom has no DataTransfer, so the drag no-ops; the beat must still finish.
    expect(dispatch).not.toHaveBeenCalled();
    expect(ctx.delay).toHaveBeenCalled();
  });

  it('step 7 skips the drag when a single tab is open', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS]);
    await runAm02ReorderAndCeiling(ctx);
    expect(ctx.delay).toHaveBeenCalled();
  });

  it('step 8 closes the running tab through the confirm dialog', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, PAYMENTS, COPY]);
    mount(API_MOCK.CONFIRM_DIALOG, API_MOCK.CONFIRM_TITLE, API_MOCK.CONFIRM_ACCEPT);

    await runAm02PersistAndClose(ctx);
    expect(calls(ctx.click)).toEqual([API_MOCK.tabClose('srv-b'), API_MOCK.CONFIRM_ACCEPT]);
    expect(calls(ctx.waitFor)).toContain(API_MOCK.CONFIRM_DIALOG);
    expect(expandAppSidebar).toHaveBeenCalled();
  });

  it('step 8 stops after the persistence beats when there is nothing to close', async () => {
    const ctx = makeCtx();
    mountTabBar([CORPUS, COPY]);

    await runAm02PersistAndClose(ctx);
    expect(ctx.click).not.toHaveBeenCalled();
  });
});
