/**
 * AM-02 `am-02-multi-server` helpers — Multi-Server Workspace: Tabs, Ports & Binding.
 *
 * Tab testids are server-id based (`api-mock-tab-<id>`), and ids are minted at
 * runtime, so every beat resolves its target from the live tab bar by server name.
 * Steps are multi-beat (see `api-mock-demo-helpers`); each stateful step has an
 * `ensure*` guard so rapid **Next** still leaves the next step something real.
 */
import {
  expandAppSidebar,
  importApiMockGallerySample,
  prepareApiMockStudioChrome,
  wipeApiMockWorkspace,
} from '../../adapters';
import { API_MOCK } from '@shared/selectors';
import { firstVisibleElement } from '../../utils/domVisibility';
import type { DemoActionContext } from '../../types';
import {
  AM_DEMO_TIMING,
  clickBeat,
  fillBeat,
  revealBeat,
  spotlightBeat,
} from './api-mock-demo-helpers';

/** Background corpus: an already-built service mock so tab switching has a subject. */
export const AM02_CORPUS_SAMPLE = 'am-gallery-users';
/** Server name the corpus ships with — used to resolve its tab. */
export const AM02_CORPUS_NAME = 'Users API';
/** Name the viewer types over `Mock Server 2` during the rename beat. */
export const AM02_PAYMENTS_NAME = 'Payments';
/** Base path authored live in the settings beat — every rule inherits the prefix. */
export const AM02_BASE_PATH = '/payments/v1';
/** Name the product gives a duplicated tab (`duplicateServerDefinition`). */
export const AM02_COPY_NAME = `${AM02_CORPUS_NAME} copy`;

// ── Tab-bar identity ────────────────────────────────────────────────────────

/** Every server tab in workspace (left-to-right) order. */
export function am02Tabs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(API_MOCK.SERVER_TAB));
}

export function am02TabCount(): number {
  return am02Tabs().length;
}

/** The server name shown on a tab (label span, not the `:port` suffix). */
export function am02TabName(tab: HTMLElement): string {
  return tab.querySelector('.am-server-tab-name')?.textContent?.trim() ?? '';
}

/** Workspace order as names — used by the reorder beat to prove the move landed. */
export function am02TabNames(): string[] {
  return am02Tabs().map(am02TabName);
}

/** Tab element for an exact server name. */
export function am02TabByName(name: string): HTMLElement | null {
  return am02Tabs().find(t => am02TabName(t) === name) ?? null;
}

/** Server id behind a tab name — tab / close / rename selectors are id-based. */
export function am02TabId(name: string): string | null {
  return am02TabByName(name)?.getAttribute('data-server-id') ?? null;
}

/** Selector for a tab, or null when no such server is open. */
export function am02TabSelector(name: string): string | null {
  const id = am02TabId(name);
  return id ? API_MOCK.tab(id) : null;
}

/** Selector for a tab's close affordance. */
export function am02TabCloseSelector(name: string): string | null {
  const id = am02TabId(name);
  return id ? API_MOCK.tabClose(id) : null;
}

/** Selector for one tab's runtime dot — spotlight per tab, never the whole bar. */
export function am02TabDotSelector(name: string): string | null {
  const sel = am02TabSelector(name);
  return sel ? `${sel} .am-status-dot` : null;
}

/** Name on the active tab — `''` when the workspace is empty. */
export function am02ActiveTabName(): string {
  const active = document.querySelector<HTMLElement>(API_MOCK.ACTIVE_TAB);
  return active ? am02TabName(active) : '';
}

/** The open tab that is neither the corpus nor its duplicate (the live-authored one). */
export function am02SecondTabName(): string | null {
  const other = am02TabNames().find(n => n !== AM02_CORPUS_NAME && n !== AM02_COPY_NAME);
  return other ?? null;
}

/** True when the active server reports Running in the server bar. */
export function isAm02ActiveRunning(): boolean {
  const label = firstVisibleElement(API_MOCK.STATUS_LABEL);
  return (label?.textContent ?? '').toLowerCase().includes('running');
}

/** True when `name`'s tab already shows a running listener — no need to select it to know. */
export function isAm02TabRunning(name: string): boolean {
  return Boolean(am02TabByName(name)?.querySelector('.am-status-dot.running'));
}

/** True when the active server's listen address already carries the lesson prefix. */
export function hasAm02BasePath(): boolean {
  const address = firstVisibleElement(API_MOCK.ADDRESS);
  return (address?.textContent ?? '').includes(AM02_BASE_PATH);
}

/** True when the Studio (authoring) view is mounted — Runtime / Conflicts unmount it. */
export function isAm02StudioViewActive(): boolean {
  return Boolean(firstVisibleElement(API_MOCK.ROUTE_EXPLORER) ?? firstVisibleElement(API_MOCK.EMPTY));
}

// ── Raw-event primitives (no ctx equivalent) ────────────────────────────────

/**
 * F2 renames the focused tab. The handler reads `document.activeElement`'s
 * `data-server-id`, so the tab must take focus before the key is dispatched.
 */
export function pressF2OnTab(tab: HTMLElement): void {
  tab.focus();
  tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
}

/** Double-click fallback for the rename beat when F2 did not open the editor. */
export function doubleClickTab(tab: HTMLElement): void {
  tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

/** Open the tab context menu where a real right-click would put it. */
export function openTabContextMenu(tab: HTMLElement): void {
  const rect = tab.getBoundingClientRect();
  tab.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(rect.left + rect.width / 2),
    clientY: Math.round(rect.bottom),
  }));
}

/**
 * Drag `from` onto the half of `to` named by `side`. The tab bar computes the drop
 * index from `clientX`, so the pointer must land on the correct half of the target.
 * Returns false where `DataTransfer` is unavailable (jsdom) — callers narrate instead.
 */
export function dragTab(from: HTMLElement, to: HTMLElement, side: 'before' | 'after'): boolean {
  if (typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') return false;
  const dataTransfer = new DataTransfer();
  const rect = to.getBoundingClientRect();
  const clientX = Math.round(rect.left + rect.width * (side === 'before' ? 0.25 : 0.75));
  const clientY = Math.round(rect.top + rect.height / 2);
  const opts = { bubbles: true, cancelable: true, dataTransfer, clientX, clientY };
  from.dispatchEvent(new DragEvent('dragstart', opts));
  to.dispatchEvent(new DragEvent('dragover', opts));
  to.dispatchEvent(new DragEvent('drop', opts));
  from.dispatchEvent(new DragEvent('dragend', opts));
  return true;
}

// ── Boot / cleanup ──────────────────────────────────────────────────────────

/**
 * Quiet boot: one already-built service mock and a collapsed app sidebar, so step 1
 * opens on a workspace that has something to compare the new server against.
 */
export async function prepareAm02Workspace(): Promise<void> {
  await wipeApiMockWorkspace();
  await importApiMockGallerySample(AM02_CORPUS_SAMPLE);
  prepareApiMockStudioChrome();
}

/** Exit / restart cleanup — stop every listener the lesson bound and free the ports. */
export async function cleanupAm02(): Promise<void> {
  await wipeApiMockWorkspace();
}

// ── Guards ──────────────────────────────────────────────────────────────────

/** Authoring guards must not fire on Runtime / Conflicts — both unmount the explorer. */
export async function ensureAm02StudioView(ctx: DemoActionContext): Promise<void> {
  if (isAm02StudioViewActive()) return;
  if (!firstVisibleElement(API_MOCK.VIEW_STUDIO)) return;
  await ctx.click(API_MOCK.VIEW_STUDIO);
  await ctx.waitFor(API_MOCK.SERVER_BAR, 10_000);
}

/** Make `name` the active tab (no-op when it already is). */
export async function selectAm02Tab(ctx: DemoActionContext, name: string): Promise<boolean> {
  if (am02ActiveTabName() === name) return true;
  const sel = am02TabSelector(name);
  if (!sel) return false;
  await ctx.click(sel);
  await ctx.delay(AM_DEMO_TIMING.tabSwitch);
  return true;
}

/** Guard — the background service mock must exist for every step. */
export async function ensureAm02Corpus(ctx: DemoActionContext): Promise<void> {
  prepareApiMockStudioChrome();
  await ensureAm02StudioView(ctx);
  if (am02TabId(AM02_CORPUS_NAME)) return;
  await importApiMockGallerySample(AM02_CORPUS_SAMPLE);
  await ctx.waitFor(API_MOCK.SERVER_BAR, 10_000);
}

/** Guard — a second, live-authored server must exist beside the corpus. */
export async function ensureAm02SecondServer(ctx: DemoActionContext): Promise<void> {
  await ensureAm02Corpus(ctx);
  if (am02SecondTabName()) return;
  await ctx.click(API_MOCK.TAB_ADD);
  await ctx.waitFor(API_MOCK.SERVER_BAR, 10_000);
  await ctx.delay(AM_DEMO_TIMING.panelReady);
}

/** Rename a tab through the inline editor (F2, double-click fallback). */
export async function renameAm02Tab(
  ctx: DemoActionContext,
  from: string,
  to: string,
): Promise<boolean> {
  const tab = am02TabByName(from);
  if (!tab) return false;
  const id = tab.getAttribute('data-server-id');
  if (!id) return false;
  pressF2OnTab(tab);
  await ctx.delay(AM_DEMO_TIMING.fieldFilled);
  if (!document.querySelector(API_MOCK.tabRename(id))) {
    doubleClickTab(tab);
    await ctx.waitFor(API_MOCK.tabRename(id), 4_000);
  }
  const sel = API_MOCK.tabRename(id);
  await ctx.fill(sel, to);
  await ctx.delay(AM_DEMO_TIMING.fieldFilled);
  document.querySelector<HTMLInputElement>(sel)
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await ctx.delay(AM_DEMO_TIMING.fieldFilled);
  return Boolean(am02TabId(to));
}

/** Guard — the second server must carry the lesson's name. */
export async function ensureAm02Renamed(ctx: DemoActionContext): Promise<void> {
  await ensureAm02SecondServer(ctx);
  if (am02TabId(AM02_PAYMENTS_NAME)) return;
  const current = am02SecondTabName();
  if (!current) return;
  await selectAm02Tab(ctx, current);
  await renameAm02Tab(ctx, current, AM02_PAYMENTS_NAME);
}

/** Guard — the renamed server must serve under the lesson's base path. */
export async function ensureAm02BasePath(ctx: DemoActionContext): Promise<void> {
  await ensureAm02Renamed(ctx);
  const onPayments = am02ActiveTabName() === AM02_PAYMENTS_NAME;
  if (onPayments && hasAm02BasePath()) return;
  // Selecting Payments just to re-read the address flashes the empty rule list
  // at the start of later steps. A running Payments tab already had the prefix
  // applied (the settings beat runs before Start).
  if (!onPayments && isAm02TabRunning(AM02_PAYMENTS_NAME)) return;
  if (!onPayments) {
    await selectAm02Tab(ctx, AM02_PAYMENTS_NAME);
    if (hasAm02BasePath()) return;
  }
  if (!firstVisibleElement(API_MOCK.SETTINGS)) return;
  await ctx.click(API_MOCK.SETTINGS);
  await ctx.waitFor(API_MOCK.SETTINGS_BASE_PATH, 10_000);
  await ctx.fill(API_MOCK.SETTINGS_BASE_PATH, AM02_BASE_PATH);
  await ctx.click(API_MOCK.SETTINGS_SAVE);
  await ctx.delay(AM_DEMO_TIMING.panelReady);
}

/** Start the active server when it is not already listening. */
async function startActiveAm02Server(ctx: DemoActionContext): Promise<void> {
  if (isAm02ActiveRunning()) return;
  if (!firstVisibleElement(API_MOCK.START)) return;
  await ctx.click(API_MOCK.START);
  await ctx.waitFor(API_MOCK.STOP, 20_000);
}

/** Guard — both listeners must be bound for the switch / close steps to mean anything. */
export async function ensureAm02BothRunning(ctx: DemoActionContext): Promise<void> {
  await ensureAm02BasePath(ctx);
  if (isAm02TabRunning(AM02_PAYMENTS_NAME) && isAm02TabRunning(AM02_CORPUS_NAME)) return;
  const restore = am02ActiveTabName();
  for (const name of [AM02_PAYMENTS_NAME, AM02_CORPUS_NAME]) {
    if (isAm02TabRunning(name)) continue;
    await selectAm02Tab(ctx, name);
    await startActiveAm02Server(ctx);
  }
  if (restore && restore !== am02ActiveTabName()) {
    await selectAm02Tab(ctx, restore);
  }
}

/** Guard — the corpus tab is the active workspace (its rules are the subject). */
export async function ensureAm02CorpusActive(ctx: DemoActionContext): Promise<void> {
  await ensureAm02BothRunning(ctx);
  await selectAm02Tab(ctx, AM02_CORPUS_NAME);
}

/** Duplicate a tab through its context menu. */
export async function duplicateAm02Tab(ctx: DemoActionContext, name: string): Promise<boolean> {
  const tab = am02TabByName(name);
  if (!tab) return false;
  openTabContextMenu(tab);
  await ctx.waitFor(API_MOCK.TAB_CTX_MENU, 4_000);
  if (!document.querySelector(API_MOCK.TAB_CTX_DUPLICATE)) return false;
  await ctx.click(API_MOCK.TAB_CTX_DUPLICATE);
  await ctx.delay(AM_DEMO_TIMING.panelReady);
  // Port allocation is async — wait for the clone tab, not just the click.
  await ctx.waitFor(API_MOCK.tabTitled(AM02_COPY_NAME), 15_000);
  return Boolean(am02TabId(AM02_COPY_NAME));
}

/** Guard — a third tab (the clone) must exist for the reorder and ceiling beats. */
export async function ensureAm02Duplicate(ctx: DemoActionContext): Promise<void> {
  await ensureAm02Corpus(ctx);
  if (am02TabId(AM02_COPY_NAME)) return;
  await ensureAm02CorpusActive(ctx);
  await duplicateAm02Tab(ctx, AM02_CORPUS_NAME);
}

/** Guard — the closing step needs a running tab to close and the confirm it triggers. */
export async function ensureAm02Closeable(ctx: DemoActionContext): Promise<void> {
  await ensureAm02Duplicate(ctx);
  if (!am02TabId(AM02_PAYMENTS_NAME)) {
    await ensureAm02Renamed(ctx);
  }
  await ensureAm02BothRunning(ctx);
}

// ── Multi-beat step bodies ──────────────────────────────────────────────────

/** Step 1 — read the existing tab, then add a second server on its own auto-port. */
export async function runAm02TabsAndNew(ctx: DemoActionContext): Promise<void> {
  await spotlightBeat(ctx, API_MOCK.ACTIVE_TAB, AM_DEMO_TIMING.payoff);
  const corpusDot = am02TabDotSelector(AM02_CORPUS_NAME);
  if (corpusDot) await spotlightBeat(ctx, corpusDot, AM_DEMO_TIMING.look);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  await clickBeat(ctx, API_MOCK.TAB_ADD, { hold: 0 });
  await revealBeat(ctx, API_MOCK.ROUTES_EMPTY, { hold: AM_DEMO_TIMING.panelReady });
  await spotlightBeat(ctx, API_MOCK.ACTIVE_TAB, AM_DEMO_TIMING.payoff);
  await spotlightBeat(ctx, API_MOCK.ADDRESS, AM_DEMO_TIMING.payoff);
}

/** Step 2 — F2 renames the new tab in place. */
export async function runAm02Rename(ctx: DemoActionContext): Promise<void> {
  const current = am02SecondTabName();
  if (!current) return;
  const sel = am02TabSelector(current);
  if (sel) await spotlightBeat(ctx, sel, AM_DEMO_TIMING.look);
  await renameAm02Tab(ctx, current, AM02_PAYMENTS_NAME);
  const renamed = am02TabSelector(AM02_PAYMENTS_NAME);
  await spotlightBeat(ctx, renamed ?? API_MOCK.ACTIVE_TAB, AM_DEMO_TIMING.payoff);
}

/**
 * Step 3 settings tour — longer spotlight holds so each field (listen URL,
 * base path, host warning) can be read before the ring moves on.
 */
const AM02_SETTINGS_HOLD = {
  look: 1100,
  payoff: 1600,
  field: 900,
  group: 1200,
  panel: 900,
} as const;

/** Step 3 — General settings: base path, then the LAN-binding choice and its warning. */
export async function runAm02Settings(ctx: DemoActionContext): Promise<void> {
  await clickBeat(ctx, API_MOCK.SETTINGS, { look: AM02_SETTINGS_HOLD.look, hold: AM02_SETTINGS_HOLD.panel });
  await revealBeat(ctx, API_MOCK.SETTINGS_MODAL, { hold: AM02_SETTINGS_HOLD.panel });
  await spotlightBeat(ctx, API_MOCK.SETTINGS_NAME, AM02_SETTINGS_HOLD.look);
  await spotlightBeat(ctx, API_MOCK.SETTINGS_PORT, AM02_SETTINGS_HOLD.look);
  await spotlightBeat(ctx, API_MOCK.SETTINGS_LISTEN_URL, AM02_SETTINGS_HOLD.payoff);
  await ctx.delay(AM02_SETTINGS_HOLD.group);

  await fillBeat(ctx, API_MOCK.SETTINGS_BASE_PATH, AM02_BASE_PATH, {
    look: AM02_SETTINGS_HOLD.look,
    hold: AM02_SETTINGS_HOLD.field,
  });
  await spotlightBeat(ctx, API_MOCK.SETTINGS_LISTEN_URL, AM02_SETTINGS_HOLD.payoff);
  await ctx.delay(AM02_SETTINGS_HOLD.group);

  await spotlightBeat(ctx, API_MOCK.SETTINGS_HOST, AM02_SETTINGS_HOLD.look);
  await ctx.selectOption(API_MOCK.SETTINGS_HOST, '0.0.0.0');
  await revealBeat(ctx, API_MOCK.SETTINGS_HOST_WARNING, { timeout: 4_000, hold: AM02_SETTINGS_HOLD.field });
  await spotlightBeat(ctx, API_MOCK.SETTINGS_HOST_WARNING, AM02_SETTINGS_HOLD.payoff);
  await ctx.selectOption(API_MOCK.SETTINGS_HOST, '127.0.0.1');
  await spotlightBeat(ctx, API_MOCK.SETTINGS_HOST, AM02_SETTINGS_HOLD.payoff);
  await ctx.delay(AM02_SETTINGS_HOLD.group);

  await clickBeat(ctx, API_MOCK.SETTINGS_SAVE, { look: AM02_SETTINGS_HOLD.look, hold: 0 });
  await revealBeat(ctx, API_MOCK.ADDRESS, { hold: AM02_SETTINGS_HOLD.panel });
  await spotlightBeat(ctx, API_MOCK.ADDRESS, AM02_SETTINGS_HOLD.payoff);
}

/** Step 4 — bind both listeners; each tab keeps its own runtime dot. */
export async function runAm02StartBoth(ctx: DemoActionContext): Promise<void> {
  await clickBeat(ctx, API_MOCK.START, { hold: 0 });
  await revealBeat(ctx, API_MOCK.STOP, { hold: AM_DEMO_TIMING.lifecycle });
  await spotlightBeat(ctx, API_MOCK.STATUS_LABEL, AM_DEMO_TIMING.payoff);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  const corpusTab = am02TabSelector(AM02_CORPUS_NAME);
  if (corpusTab) await clickBeat(ctx, corpusTab, { hold: AM_DEMO_TIMING.tabSwitch });
  if (firstVisibleElement(API_MOCK.START)) {
    await clickBeat(ctx, API_MOCK.START, { hold: 0 });
    await revealBeat(ctx, API_MOCK.STOP, { hold: AM_DEMO_TIMING.lifecycle });
  }
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  for (const name of [AM02_CORPUS_NAME, AM02_PAYMENTS_NAME]) {
    const dot = am02TabDotSelector(name);
    if (dot) await spotlightBeat(ctx, dot, AM_DEMO_TIMING.payoff);
  }
}

/** Step 5 — a tab switch swaps the whole workspace, not just the rule list. */
export async function runAm02SwitchTab(ctx: DemoActionContext): Promise<void> {
  await spotlightBeat(ctx, API_MOCK.FIRST_ROUTE, AM_DEMO_TIMING.look);
  await spotlightBeat(ctx, API_MOCK.ADDRESS, AM_DEMO_TIMING.payoff);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  const paymentsTab = am02TabSelector(AM02_PAYMENTS_NAME);
  if (paymentsTab) await clickBeat(ctx, paymentsTab, { hold: AM_DEMO_TIMING.tabSwitch });
  await spotlightBeat(ctx, API_MOCK.ROUTES_EMPTY, AM_DEMO_TIMING.payoff);
  await spotlightBeat(ctx, API_MOCK.ADDRESS, AM_DEMO_TIMING.payoff);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  const corpusTab = am02TabSelector(AM02_CORPUS_NAME);
  if (corpusTab) await clickBeat(ctx, corpusTab, { hold: AM_DEMO_TIMING.tabSwitch });
  await spotlightBeat(ctx, API_MOCK.FIRST_ROUTE, AM_DEMO_TIMING.payoff);
}

/** Step 6 — duplicate a tab: rules cloned, secrets dropped, fresh port, stopped. */
export async function runAm02Duplicate(ctx: DemoActionContext): Promise<void> {
  const corpusTab = am02TabSelector(AM02_CORPUS_NAME);
  if (corpusTab) await spotlightBeat(ctx, corpusTab, AM_DEMO_TIMING.look);
  const tab = am02TabByName(AM02_CORPUS_NAME);
  if (tab) {
    openTabContextMenu(tab);
    await revealBeat(ctx, API_MOCK.TAB_CTX_MENU, { timeout: 4_000, hold: AM_DEMO_TIMING.panelReady });
    await clickBeat(ctx, API_MOCK.TAB_CTX_DUPLICATE, { hold: AM_DEMO_TIMING.panelReady });
    if (!am02TabId(AM02_COPY_NAME)) {
      await duplicateAm02Tab(ctx, AM02_CORPUS_NAME);
    }
    await ctx.waitFor(API_MOCK.tabTitled(AM02_COPY_NAME), 15_000);
  }

  const copyTab = am02TabSelector(AM02_COPY_NAME);
  await spotlightBeat(ctx, copyTab ?? API_MOCK.ACTIVE_TAB, AM_DEMO_TIMING.payoff);
  await spotlightBeat(ctx, API_MOCK.ADDRESS, AM_DEMO_TIMING.payoff);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  await spotlightBeat(ctx, API_MOCK.FIRST_ROUTE, AM_DEMO_TIMING.payoff);
  const copyDot = am02TabDotSelector(AM02_COPY_NAME);
  if (copyDot) await spotlightBeat(ctx, copyDot, AM_DEMO_TIMING.payoff);
}

/** Walk the tab bar left to right so the viewer reads the current order. */
async function walkAm02TabOrder(ctx: DemoActionContext, hold: number): Promise<void> {
  for (const name of am02TabNames()) {
    const sel = am02TabSelector(name);
    if (sel) await spotlightBeat(ctx, sel, hold);
  }
}

/** Step 7 — drag a tab into a new slot, then read the ceiling guardrail. */
export async function runAm02ReorderAndCeiling(ctx: DemoActionContext): Promise<void> {
  await walkAm02TabOrder(ctx, AM_DEMO_TIMING.look);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  const tabs = am02Tabs();
  const last = tabs[tabs.length - 1];
  const first = tabs[0];
  if (last && first && last !== first) {
    dragTab(last, first, 'before');
    await ctx.delay(AM_DEMO_TIMING.payoff);
  }
  await walkAm02TabOrder(ctx, AM_DEMO_TIMING.fieldFilled);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  await spotlightBeat(ctx, API_MOCK.TAB_ADD, AM_DEMO_TIMING.payoff);
}

/** Step 8 — persistence, then closing a running tab through Stop-and-close. */
export async function runAm02PersistAndClose(ctx: DemoActionContext): Promise<void> {
  await walkAm02TabOrder(ctx, AM_DEMO_TIMING.fieldFilled);
  const runningDot = am02TabDotSelector(AM02_CORPUS_NAME);
  if (runningDot) await spotlightBeat(ctx, runningDot, AM_DEMO_TIMING.payoff);
  await ctx.delay(AM_DEMO_TIMING.groupBreak);

  const closeSel = am02TabCloseSelector(AM02_PAYMENTS_NAME);
  if (!closeSel) return;
  await clickBeat(ctx, closeSel, { hold: 0 });
  await revealBeat(ctx, API_MOCK.CONFIRM_DIALOG, { timeout: 6_000, hold: AM_DEMO_TIMING.panelReady });
  await spotlightBeat(ctx, API_MOCK.CONFIRM_TITLE, AM_DEMO_TIMING.payoff);
  await clickBeat(ctx, API_MOCK.CONFIRM_ACCEPT, { hold: AM_DEMO_TIMING.lifecycle });
  await walkAm02TabOrder(ctx, AM_DEMO_TIMING.payoff);

  // The payoff of the close is what did *not* happen: the definition is still saved
  // — it stays in the left sidebar, just marked closed.
  expandAppSidebar();
  await ctx.delay(AM_DEMO_TIMING.groupBreak);
  await spotlightBeat(ctx, API_MOCK.SIDEBAR, AM_DEMO_TIMING.payoff);
}
