/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { API_MOCK } from '@shared/selectors';
import type { DemoActionContext } from '../../types';
import { makeCtx, makeVisible } from './ws-test-utils';

const wipeApiMockWorkspace = vi.fn(async () => true);
const importApiMockGallerySample = vi.fn(async () => true);
const prepareApiMockStudioChrome = vi.fn();
const patchApiMockActiveRoute = vi.fn(() => true);
const sendApiMockRequest = vi.fn(async () => ({ status: 200, body: '{"ok":true,"id":"pay-1001"}' }));

vi.mock('../../adapters', () => ({
  wipeApiMockWorkspace: (...a: unknown[]) => wipeApiMockWorkspace(...(a as [])),
  importApiMockGallerySample: (...a: unknown[]) => importApiMockGallerySample(...(a as [string])),
  prepareApiMockStudioChrome: (...a: unknown[]) => prepareApiMockStudioChrome(...(a as [])),
  patchApiMockActiveRoute: (...a: unknown[]) => patchApiMockActiveRoute(...(a as [])),
  sendApiMockRequest: (...a: unknown[]) => sendApiMockRequest(...(a as [])),
}));

import {
  AM14_CLEAR_ELIGIBILITY,
  AM14_CORPUS_SAMPLE,
  AM14_DELAY,
  AM14_DELAY_BEHAVIOR,
  AM14_FETCH_TIMEOUT_MS,
  AM14_JITTER,
  AM14_MAX_MATCHES,
  AM14_MAX_MATCHES_BEHAVIOR,
  AM14_TIMEOUT_BEHAVIOR,
  AM14_PATH,
  AM14_PROBABILITY,
  AM14_TIMING,
  AM14_VARIANT_FALLBACK,
  am14DelayValue,
  am14FaultSelected,
  am14HasDelayAndJitter,
  am14HasDribbleFault,
  am14HasEligibility,
  am14HasExpiry,
  am14HasMaxMatches,
  am14HasResetFault,
  am14HasSibling,
  am14HasTimeoutFault,
  am14JitterValue,
  am14MaxMatchesValue,
  am14ProbabilityValue,
  am14SimMethod,
  am14VariantCount,
  cleanupAm14,
  closeAm14Simulate,
  ensureAm14Delay,
  ensureAm14Eligibility,
  ensureAm14FaultsTab,
  ensureAm14ForDribble,
  ensureAm14ForFaults,
  ensureAm14ForMaxMatches,
  ensureAm14ForPreview,
  ensureAm14ForReset,
  ensureAm14ForTimeout,
  ensureAm14MaxMatches,
  ensureAm14ResponseTab,
  ensureAm14RuleOpen,
  ensureAm14Running,
  ensureAm14Sibling,
  ensureAm14StudioView,
  ensureAm14TimingTab,
  ensureAm14Workspace,
  hasAm14RouteEditor,
  hasAm14Traffic,
  hasAm14Workspace,
  isAm14ServerRunning,
  isAm14SimulateOpen,
  isAm14StudioViewActive,
  prepareAm14Workspace,
  runAm14DelayAndJitter,
  runAm14DribbleAndTimeline,
  runAm14ExpiresAndProbability,
  runAm14FaultsPanel,
  runAm14MaxMatches,
  runAm14PreviewThenProve,
  runAm14ResetCloseMalformed,
  runAm14Timeout,
  sendAm14ProveRequest,
} from './api-mock-am14-helpers';

function el(tag: string, className?: string, testid?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (testid) node.setAttribute('data-testid', testid);
  makeVisible(node);
  return node;
}

function mountExplorer(): void {
  const explorer = el('div', 'am-explorer', 'api-mock-route-explorer');
  const row = el('button', 'am-route-item', 'api-mock-route-row');
  row.setAttribute('role', 'treeitem');
  explorer.append(row);
  document.body.append(explorer);
}

function mountServerBar(running: boolean, extras: { apply?: boolean; simulate?: boolean } = {}): void {
  const bar = el('div', 'am-server-bar', 'api-mock-server-bar');
  const status = el('span', undefined, 'api-mock-status-label');
  status.textContent = running ? 'Running' : 'Stopped';
  bar.append(status);
  if (running) bar.append(el('button', 'am-btn', 'api-mock-stop'));
  else bar.append(el('button', 'am-btn', 'api-mock-start'));
  if (extras.apply) bar.append(el('button', 'am-btn', 'api-mock-apply'));
  if (extras.simulate !== false) bar.append(el('button', 'am-btn', 'api-mock-simulate'));
  bar.append(el('span', undefined, 'api-mock-generation'));
  document.body.append(bar);
}

function mountVariantCard(id: string, label: string): HTMLElement {
  const card = el('button', 'am-variant-card', `api-mock-variant-tab-${id}`);
  card.textContent = label;
  return card;
}

function mountEditor(opts: {
  variants?: Array<{ id: string; label: string }>;
  timing?: boolean;
  faults?: boolean;
  delay?: string;
  jitter?: string;
  maxMatches?: string;
  probability?: string;
  expires?: string;
  fault?: string;
  chunks?: boolean;
} = {}): void {
  const editor = el('div', 'am-route-editor', 'api-mock-route-editor');
  const response = el('div', undefined, 'api-mock-response-editor');
  const modeBar = el('div', undefined, 'api-mock-response-mode-bar');
  const rules = el('button', undefined, 'api-mock-response-mode-rules');
  rules.setAttribute('aria-pressed', 'true');
  modeBar.append(rules);
  const sidebar = el('aside', undefined, 'api-mock-variant-sidebar');
  const list = el('div', undefined, 'api-mock-variant-list');
  const variants = opts.variants ?? [{ id: 'resp-1', label: '200 Paid' }];
  for (const v of variants) list.append(mountVariantCard(v.id, v.label));
  sidebar.append(list);
  sidebar.append(el('button', 'am-btn', 'api-mock-add-variant'));
  response.append(modeBar, sidebar);
  response.append(el('button', undefined, 'api-mock-response-tab-timing'));
  response.append(el('button', undefined, 'api-mock-response-tab-faults'));
  response.append(el('button', undefined, 'api-mock-response-tab-content'));
  if (opts.timing) {
    const panel = el('div', undefined, 'api-mock-timing-panel');
    const delay = document.createElement('input');
    delay.setAttribute('data-testid', 'api-mock-variant-delay');
    delay.value = opts.delay ?? '';
    makeVisible(delay);
    const jitter = document.createElement('input');
    jitter.setAttribute('data-testid', 'api-mock-variant-jitter');
    jitter.value = opts.jitter ?? '';
    makeVisible(jitter);
    const max = document.createElement('input');
    max.setAttribute('data-testid', 'api-mock-variant-max-matches');
    max.value = opts.maxMatches ?? '';
    makeVisible(max);
    const prob = document.createElement('input');
    prob.setAttribute('data-testid', 'api-mock-variant-probability');
    prob.value = opts.probability ?? '';
    makeVisible(prob);
    const expires = el('button', undefined, 'api-mock-expires-display');
    expires.textContent = opts.expires ?? 'Not set';
    panel.append(
      delay, jitter, max, prob, expires,
      el('button', undefined, 'api-mock-expires-quick-1h'),
      el('span', undefined, 'api-mock-timing-spread'),
      el('span', undefined, 'api-mock-eligibility-summary'),
    );
    response.append(panel);
  }
  if (opts.faults) {
    const panel = el('div', undefined, 'api-mock-faults-panel');
    for (const id of ['none', 'timeout', 'reset', 'close', 'malformed', 'dribble']) {
      const card = el('button', opts.fault === id ? 'am-fault-card selected' : 'am-fault-card', `api-mock-fault-${id}`);
      panel.append(card);
    }
    if (opts.chunks || opts.fault === 'dribble') {
      const schedule = el('div', undefined, 'api-mock-chunk-schedule');
      schedule.append(el('button', undefined, 'api-mock-chunk-add'));
      schedule.append(el('div', undefined, 'api-mock-chunk-row-0'));
      panel.append(schedule);
    }
    response.append(panel);
  }
  editor.append(response);
  const btab = document.createElement('button');
  btab.id = 'api-mock-btab-response';
  btab.setAttribute('data-testid', 'api-mock-btab-response');
  makeVisible(btab);
  editor.append(btab);
  document.body.append(editor);
}

function mountSimulate(extra: { delay?: boolean; timeline?: boolean; dribble?: boolean } = {}): void {
  const workspace = el('div', undefined, 'api-mock-simulate-workspace');
  const method = el('div', undefined, 'api-mock-simulate-method');
  method.setAttribute('data-value', 'POST');
  workspace.append(method);
  workspace.append(el('input', undefined, 'api-mock-simulate-path'));
  workspace.append(el('button', undefined, 'api-mock-simulate-run'));
  workspace.append(el('button', undefined, 'api-mock-simulate-close'));
  workspace.append(el('button', undefined, 'api-mock-simulate-save-sample'));
  workspace.append(el('button', undefined, 'api-mock-sim-tab-rendered'));
  workspace.append(el('button', undefined, 'api-mock-sim-tab-trace'));
  const result = el('div', undefined, 'api-mock-simulate-result');
  const out = el('span', undefined, 'api-mock-sim-outcome');
  out.textContent = 'MATCHED';
  result.append(out);
  workspace.append(result);
  const rendered = el('div', undefined, 'api-mock-sim-rendered');
  if (extra.delay) {
    const badge = el('span', undefined, 'api-mock-sim-virtual-delay');
    badge.textContent = 'Virtual delay 800 ms';
    rendered.append(badge);
  }
  if (extra.dribble) {
    rendered.append(el('div', undefined, 'api-mock-sim-dribble-notice'));
    const wireSection = el('div', undefined, 'api-mock-sim-wire-section');
    const wire = el('pre', undefined, 'api-mock-sim-wire-body');
    wire.textContent = '{"ok":tr';
    wireSection.append(wire);
    rendered.append(wireSection);
    const intendedSection = el('div', undefined, 'api-mock-sim-intended-section');
    const intended = el('pre', undefined, 'api-mock-sim-rendered-body');
    intended.textContent = '{"ok":true,"id":"pay-1001"}';
    intendedSection.append(intended);
    rendered.append(intendedSection);
  }
  if (extra.timeline || extra.dribble) {
    rendered.append(el('div', undefined, 'api-mock-sim-fault-timeline'));
    workspace.append(el('div', undefined, 'api-mock-sim-timeline-6'));
  }
  workspace.append(rendered);
  document.body.append(workspace);
}

function mountLiveStrip(): void {
  const strip = el('div', undefined, 'api-mock-live-strip');
  const tx = el('button', undefined, 'api-mock-live-transactions');
  tx.append(Object.assign(el('span', 'am-count-badge'), { textContent: '1' }));
  strip.append(tx);
  document.body.append(strip);
}

function mountJournal(opts: { rows?: Array<{ id: string; status: string }> } = {}): void {
  const dock = el('div', undefined, 'api-mock-dock');
  dock.append(el('button', undefined, 'api-mock-dock-tab-transactions'));
  dock.append(el('button', undefined, 'api-mock-dock-tab-state'));
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  const rows = opts.rows ?? [{ id: 'api-mock-tx-1', status: '200' }];
  for (const row of rows) {
    const tr = el('tr', undefined, row.id);
    const status = el('td', 'am-tx-status');
    status.textContent = row.status;
    tr.append(status);
    tbody.append(tr);
  }
  table.append(tbody);
  dock.append(table);
  const state = el('div', undefined, 'api-mock-dock-state');
  state.append(el('button', undefined, 'api-mock-state-reset'));
  dock.append(state);
  document.body.append(dock);
  const detail = el('div', undefined, 'api-mock-tx-detail');
  detail.append(el('span', undefined, 'api-mock-tx-outcome'));
  detail.append(el('span', undefined, 'api-mock-tx-detail-duration'));
  detail.append(el('section', undefined, 'api-mock-tx-response'));
  document.body.append(detail);
  const duration = el('td', undefined, 'api-mock-tx-duration');
  duration.textContent = '912 ms';
  document.body.append(duration);
}

function withClickSideEffects(ctx: DemoActionContext): void {
  ctx.click = vi.fn(async (selector: string) => {
    if (selector === API_MOCK.START) {
      const label = document.querySelector('[data-testid="api-mock-status-label"]');
      if (label) label.textContent = 'Running';
      document.querySelector('[data-testid="api-mock-start"]')?.remove();
      const bar = document.querySelector('[data-testid="api-mock-server-bar"]');
      bar?.append(el('button', 'am-btn', 'api-mock-stop'));
    }
    if (selector === API_MOCK.RESPONSE_TAB_TIMING && !document.querySelector('[data-testid="api-mock-timing-panel"]')) {
      mountEditor({ timing: true });
    }
    if (selector === API_MOCK.RESPONSE_TAB_FAULTS && !document.querySelector('[data-testid="api-mock-faults-panel"]')) {
      mountEditor({ faults: true });
    }
    if (selector === API_MOCK.SIMULATE && !document.querySelector('[data-testid="api-mock-simulate-workspace"]')) {
      mountSimulate({ delay: true, timeline: true, dribble: true });
    }
    if (selector === API_MOCK.SIMULATE_CLOSE) {
      document.querySelector('[data-testid="api-mock-simulate-workspace"]')?.remove();
    }
    if (selector === API_MOCK.LIVE_TRANSACTIONS && !document.querySelector('[data-testid="api-mock-tx-detail"]')) {
      mountJournal();
    }
    if (selector === API_MOCK.VIEW_STUDIO && !document.querySelector('[data-testid="api-mock-route-explorer"]')) {
      mountExplorer();
      mountServerBar(true);
    }
    if (selector === API_MOCK.ROUTE_ROW && !document.querySelector('[data-testid="api-mock-route-editor"]')) {
      mountEditor();
    }
    if (selector === API_MOCK.BTAB_RESPONSE && !document.querySelector('[data-testid="api-mock-response-mode-bar"]')) {
      mountEditor();
    }
    if (selector === API_MOCK.EXPIRES_QUICK_1H) {
      const display = document.querySelector('[data-testid="api-mock-expires-display"]');
      if (display) display.textContent = 'Aug 14, 2026  13:51';
    }
    if (selector === API_MOCK.FAULT_TIMEOUT) {
      document.querySelector('[data-testid="api-mock-fault-timeout"]')?.classList.add('selected');
    }
    if (selector === API_MOCK.FAULT_RESET) {
      document.querySelector('[data-testid="api-mock-fault-reset"]')?.classList.add('selected');
    }
    if (selector === API_MOCK.FAULT_DRIBBLE) {
      document.querySelector('[data-testid="api-mock-fault-dribble"]')?.classList.add('selected');
      const panel = document.querySelector('[data-testid="api-mock-faults-panel"]');
      if (panel && !document.querySelector('[data-testid="api-mock-chunk-schedule"]')) {
        const schedule = el('div', undefined, 'api-mock-chunk-schedule');
        schedule.append(el('button', undefined, 'api-mock-chunk-add'));
        panel.append(schedule);
      }
    }
  });
}

describe('AM-14 timing-faults helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    wipeApiMockWorkspace.mockClear();
    importApiMockGallerySample.mockClear().mockResolvedValue(true);
    prepareApiMockStudioChrome.mockClear();
    patchApiMockActiveRoute.mockClear().mockReturnValue(true);
    sendApiMockRequest.mockClear().mockResolvedValue({ status: 200, body: '{"ok":true,"id":"pay-1001"}' });
  });

  it('exposes slower timing holds than the shared demo defaults', () => {
    expect(AM14_TIMING.beforeOpen).toBe(1400);
    expect(AM14_TIMING.payoff).toBe(1600);
    expect(AM14_TIMING.beforeRun).toBe(2400);
  });

  it('prepareAm14Workspace wipes, imports the payment sample, and does not seed a sibling', async () => {
    await prepareAm14Workspace();
    expect(wipeApiMockWorkspace).toHaveBeenCalled();
    expect(importApiMockGallerySample).toHaveBeenCalledWith(AM14_CORPUS_SAMPLE);
    expect(prepareApiMockStudioChrome).toHaveBeenCalled();
    expect(patchApiMockActiveRoute).not.toHaveBeenCalled();
  });

  it('prepareAm14Workspace throws when the gallery import fails', async () => {
    importApiMockGallerySample.mockResolvedValueOnce(false);
    await expect(prepareAm14Workspace()).rejects.toThrow(/am-gallery-payment/);
  });

  it('cleanupAm14 wipes the workspace', async () => {
    await cleanupAm14();
    expect(wipeApiMockWorkspace).toHaveBeenCalled();
  });

  it('probes empty DOM as false / blank', () => {
    expect(hasAm14Workspace()).toBe(false);
    expect(hasAm14RouteEditor()).toBe(false);
    expect(isAm14StudioViewActive()).toBe(false);
    expect(isAm14ServerRunning()).toBe(false);
    expect(am14HasSibling()).toBe(false);
    expect(am14HasDelayAndJitter()).toBe(false);
    expect(am14HasMaxMatches()).toBe(false);
    expect(am14HasExpiry()).toBe(false);
    expect(am14HasEligibility()).toBe(false);
    expect(am14HasTimeoutFault()).toBe(false);
    expect(am14HasResetFault()).toBe(false);
    expect(am14HasDribbleFault()).toBe(false);
    expect(isAm14SimulateOpen()).toBe(false);
    expect(hasAm14Traffic()).toBe(false);
    expect(am14DelayValue()).toBe('');
    expect(am14JitterValue()).toBe('');
    expect(am14MaxMatchesValue()).toBe('');
    expect(am14ProbabilityValue()).toBe('');
    expect(am14SimMethod()).toBe('');
    expect(am14VariantCount()).toBe(0);
    expect(am14FaultSelected('timeout')).toBe(false);
  });

  it('probes a mounted studio', () => {
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
      fault: 'dribble',
      chunks: true,
    });
    mountLiveStrip();
    mountSimulate();
    expect(hasAm14Workspace()).toBe(true);
    expect(hasAm14RouteEditor()).toBe(true);
    expect(isAm14StudioViewActive()).toBe(true);
    expect(isAm14ServerRunning()).toBe(true);
    expect(am14HasSibling()).toBe(true);
    expect(am14HasDelayAndJitter()).toBe(true);
    expect(am14HasMaxMatches()).toBe(true);
    expect(am14HasExpiry()).toBe(true);
    expect(am14HasEligibility()).toBe(true);
    expect(am14HasDribbleFault()).toBe(true);
    expect(isAm14SimulateOpen()).toBe(true);
    expect(hasAm14Traffic()).toBe(true);
    expect(am14SimMethod()).toBe('POST');
  });

  it('hasAm14Traffic also reads a journal row', () => {
    mountJournal();
    expect(hasAm14Traffic()).toBe(true);
  });

  it('ensureAm14Workspace imports when the explorer is missing', async () => {
    const ctx = makeCtx();
    await ensureAm14Workspace(ctx);
    expect(importApiMockGallerySample).toHaveBeenCalledWith(AM14_CORPUS_SAMPLE);
  });

  it('ensureAm14Workspace throws when a missing studio cannot import', async () => {
    const ctx = makeCtx();
    importApiMockGallerySample.mockResolvedValueOnce(false);
    await expect(ensureAm14Workspace(ctx)).rejects.toThrow(/am-gallery-payment/);
  });

  it('ensureAm14StudioView clicks Studio when the explorer is missing', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    document.body.append(el('button', undefined, 'api-mock-view-studio'));
    await ensureAm14StudioView(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.VIEW_STUDIO);
  });

  it('ensureAm14StudioView is a no-op when already on Studio', async () => {
    const ctx = makeCtx();
    mountExplorer();
    await ensureAm14StudioView(ctx);
    expect(ctx.click).not.toHaveBeenCalled();
  });

  it('ensureAm14RuleOpen clicks the route row when the editor is missing', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    await ensureAm14RuleOpen(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.ROUTE_ROW);
  });

  it('ensureAm14ResponseTab clicks the response body tab', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    const editor = el('div', 'am-route-editor', 'api-mock-route-editor');
    const btab = el('button', undefined, 'api-mock-btab-response');
    btab.id = 'api-mock-btab-response';
    editor.append(btab);
    document.body.append(editor);
    await ensureAm14ResponseTab(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.BTAB_RESPONSE);
  });

  it('ensureAm14Running clicks Start when stopped', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(false);
    await ensureAm14Running(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.START);
  });

  it('ensureAm14TimingTab and Faults tab click their triggers', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true);
    mountEditor();
    await ensureAm14TimingTab(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.RESPONSE_TAB_TIMING);
    document.body.innerHTML = '';
    mountExplorer();
    mountServerBar(true);
    mountEditor();
    await ensureAm14FaultsTab(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.RESPONSE_TAB_FAULTS);
  });

  it('ensureAm14Sibling seeds Fallback when only one card exists', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor();
    await ensureAm14Sibling(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith(expect.objectContaining({
      addVariant: true,
      variantName: AM14_VARIANT_FALLBACK,
      status: 503,
    }));
  });

  it('ensureAm14Delay patches 800±200 when the fields are empty', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({ timing: true });
    await ensureAm14Delay(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({
      variantIndex: 0,
      behavior: AM14_DELAY_BEHAVIOR,
    });
  });

  it('ensureAm14Delay skips when delay and jitter are already set', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    await ensureAm14Delay(ctx);
    expect(patchApiMockActiveRoute).not.toHaveBeenCalled();
  });

  it('ensureAm14MaxMatches patches the limit and seeds a sibling', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    await ensureAm14MaxMatches(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith(expect.objectContaining({
      addVariant: true,
      variantName: AM14_VARIANT_FALLBACK,
    }));
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({
      variantIndex: 0,
      behavior: AM14_MAX_MATCHES_BEHAVIOR,
    });
  });

  it('ensureAm14Eligibility patches expiry and probability', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
    });
    await ensureAm14Eligibility(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith(expect.objectContaining({
      variantIndex: 0,
      behavior: expect.objectContaining({ probability: 0.5, expiresAt: expect.any(String) }),
    }));
  });

  it('ensureAm14ForPreview / max-matches / faults / timeout / reset / dribble close Simulate', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
      fault: 'timeout',
    });
    mountJournal();
    mountSimulate();
    await ensureAm14ForPreview(ctx);
    expect(isAm14SimulateOpen()).toBe(false);
    mountSimulate();
    await ensureAm14ForMaxMatches(ctx);
    mountSimulate();
    await ensureAm14ForFaults(ctx);
    await ensureAm14ForTimeout(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({
      variantIndex: 0,
      behavior: { delayMs: 0, jitterMs: 0, ...AM14_CLEAR_ELIGIBILITY },
    });
    await ensureAm14ForReset(ctx);
    await ensureAm14ForDribble(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.STATE_RESET);
  });

  it('closeAm14Simulate clicks Close when open and is a no-op when closed', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountSimulate();
    expect(isAm14SimulateOpen()).toBe(true);
    await closeAm14Simulate(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.SIMULATE_CLOSE);
    const idle = makeCtx();
    await closeAm14Simulate(idle);
    expect(idle.click).not.toHaveBeenCalled();
  });

  it('sendAm14ProveRequest posts /payments and can abort', async () => {
    await sendAm14ProveRequest();
    expect(sendApiMockRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: AM14_PATH,
      method: 'POST',
    }));
    await sendAm14ProveRequest(AM14_FETCH_TIMEOUT_MS);
    expect(sendApiMockRequest).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: AM14_FETCH_TIMEOUT_MS,
    }));
  });

  it('runAm14DelayAndJitter fills delay and jitter then holds the spread', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true);
    mountEditor({ timing: true });
    await runAm14DelayAndJitter(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_DELAY, AM14_DELAY);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_JITTER, AM14_JITTER);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({
      variantIndex: 0,
      behavior: AM14_DELAY_BEHAVIOR,
    });
  });

  it('runAm14PreviewThenProve runs Simulate then Applies a live fetch', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountLiveStrip();
    await runAm14PreviewThenProve(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.SIMULATE);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.APPLY);
    expect(sendApiMockRequest).toHaveBeenCalled();
  });

  it('runAm14MaxMatches fills the limit and fetches twice', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
    });
    mountLiveStrip();
    mountJournal();
    await runAm14MaxMatches(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_MAX_MATCHES, AM14_MAX_MATCHES);
    expect(sendApiMockRequest).toHaveBeenCalledTimes(2);
  });

  it('runAm14ExpiresAndProbability clicks +1h and fills P=0.5', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
    });
    await runAm14ExpiresAndProbability(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.EXPIRES_QUICK_1H);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_PROBABILITY, AM14_PROBABILITY);
  });

  it('runAm14FaultsPanel holds the five fault cards', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
    });
    await runAm14FaultsPanel(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.RESPONSE_TAB_FAULTS);
  });

  it('runAm14Timeout selects timeout and fetches with a catch timeout', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountLiveStrip();
    mountJournal();
    await runAm14Timeout(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.FAULT_TIMEOUT);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({
      variantIndex: 0,
      behavior: AM14_TIMEOUT_BEHAVIOR,
    });
    expect(sendApiMockRequest).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: AM14_FETCH_TIMEOUT_MS,
    }));
  });

  it('runAm14Timeout does not click an old 503 journal row', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountJournal({ rows: [{ id: 'api-mock-tx-old-503', status: '503' }] });
    await runAm14Timeout(ctx);
    expect(ctx.click).not.toHaveBeenCalledWith('[data-testid="api-mock-tx-old-503"]');
  });

  it('runAm14Timeout clicks the fault journal row, not a sibling 503', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountJournal({
      rows: [
        { id: 'api-mock-tx-old-503', status: '503' },
        { id: 'api-mock-tx-fault', status: '0' },
      ],
    });
    await runAm14Timeout(ctx);
    expect(ctx.click).toHaveBeenCalledWith('[data-testid="api-mock-tx-fault"]');
    expect(ctx.click).not.toHaveBeenCalledWith('[data-testid="api-mock-tx-old-503"]');
  });

  it('runAm14ResetCloseMalformed selects reset then holds close and malformed', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, fault: 'timeout' });
    mountLiveStrip();
    mountJournal();
    await runAm14ResetCloseMalformed(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.FAULT_RESET);
    expect(sendApiMockRequest).toHaveBeenCalled();
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({
      variantIndex: 0,
      behavior: { fault: 'reset', delayMs: 0, jitterMs: 0, ...AM14_CLEAR_ELIGIBILITY },
    });
  });

  it('runAm14DribbleAndTimeline adds chunks then holds the fault timeline', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, fault: 'reset' });
    await runAm14DribbleAndTimeline(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.FAULT_DRIBBLE);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.CHUNK_ADD);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.SIMULATE);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.SIMULATE_TAB_RENDERED);
    expect(document.querySelector(API_MOCK.SIMULATE_WIRE_SECTION)).toBeTruthy();
    expect(document.querySelector(API_MOCK.SIMULATE_INTENDED_SECTION)).toBeTruthy();
  });

  it('ensureAm14ForReset patches timeout when it is not selected', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
    });
    mountJournal();
    await ensureAm14ForReset(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({ variantIndex: 0, behavior: { fault: 'timeout' } });
  });

  it('ensureAm14ForDribble patches reset when it is not selected', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
      fault: 'timeout',
    });
    mountJournal();
    await ensureAm14ForDribble(ctx);
    expect(patchApiMockActiveRoute).toHaveBeenCalledWith({ variantIndex: 0, behavior: { fault: 'reset' } });
  });

  it('skips ensure patches when delay, sibling, max-matches, and eligibility are already set', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
    });
    await ensureAm14Delay(ctx);
    await ensureAm14Sibling(ctx);
    await ensureAm14MaxMatches(ctx);
    await ensureAm14Eligibility(ctx);
    await ensureAm14TimingTab(ctx);
    await ensureAm14FaultsTab(ctx);
    expect(patchApiMockActiveRoute).not.toHaveBeenCalled();
  });

  it('ensureAm14StudioView / Running / RuleOpen are no-ops without their triggers', async () => {
    const ctx = makeCtx();
    await ensureAm14StudioView(ctx);
    await ensureAm14Running(ctx);
    await ensureAm14RuleOpen(ctx);
    expect(ctx.click).not.toHaveBeenCalled();
  });

  it('resetAm14Runtime opens the State tab when Reset is not yet visible', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    ctx.click = vi.fn(async (selector: string) => {
      if (selector === API_MOCK.DOCK_TAB_STATE && !document.querySelector('[data-testid="api-mock-state-reset"]')) {
        document.querySelector('[data-testid="api-mock-dock"]')?.append(el('button', undefined, 'api-mock-state-reset'));
      }
    });
    mountExplorer();
    mountServerBar(true);
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    const dock = el('div', undefined, 'api-mock-dock');
    dock.append(el('button', undefined, 'api-mock-dock-tab-state'));
    dock.append(el('button', undefined, 'api-mock-dock-tab-transactions'));
    document.body.append(dock);
    await ensureAm14ForMaxMatches(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.DOCK_TAB_STATE);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.STATE_RESET);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.DOCK_TAB_TRANSACTIONS);
  });

  it('runAm14PreviewThenProve looks at the dirty badge and picks a method when Simulate is not POST', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    const inner = ctx.click as ReturnType<typeof vi.fn>;
    ctx.click = vi.fn(async (selector: string) => {
      await inner(selector);
      if (selector === API_MOCK.SIMULATE) {
        document.querySelector('[data-testid="api-mock-simulate-method"]')?.setAttribute('data-value', 'GET');
      }
    });
    mountExplorer();
    mountServerBar(true, { apply: true });
    const dirty = el('span', undefined, 'api-mock-dirty-badge');
    dirty.textContent = 'dirty';
    document.querySelector('[data-testid="api-mock-server-bar"]')?.append(dirty);
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountLiveStrip();
    await runAm14PreviewThenProve(ctx);
    expect(ctx.selectOption).toHaveBeenCalledWith(API_MOCK.SIMULATE_METHOD, 'POST');
  });

  it('runAm14PreviewThenProve falls back to the delay timeline step without a virtual-delay badge', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountLiveStrip();
    mountJournal();
    mountSimulate();
    document.querySelector('[data-testid="api-mock-sim-virtual-delay"]')?.remove();
    const timeline = el('div', undefined, 'api-mock-sim-timeline-5');
    document.querySelector('[data-testid="api-mock-simulate-workspace"]')?.append(timeline);
    await runAm14PreviewThenProve(ctx);
    expect(sendApiMockRequest).toHaveBeenCalled();
  });

  it('runAm14Timeout and reset fall back to TX_DETAIL when outcome is missing', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountLiveStrip();
    mountJournal();
    document.querySelector('[data-testid="api-mock-tx-outcome"]')?.remove();
    document.querySelector('[data-testid="api-mock-tx-response"]')?.remove();
    await runAm14Timeout(ctx);
    await runAm14ResetCloseMalformed(ctx);
    expect(sendApiMockRequest).toHaveBeenCalled();
  });

  it('runAm14DribbleAndTimeline falls back to the rendered fault timeline', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true);
    mountEditor({ faults: true, fault: 'reset', chunks: true });
    await runAm14DribbleAndTimeline(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.FAULT_DRIBBLE);
  });

  it('runAm14ExpiresAndProbability and faults skip missing quick-chip / tab triggers', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
    });
    document.querySelector('[data-testid="api-mock-expires-quick-1h"]')?.remove();
    await runAm14ExpiresAndProbability(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_PROBABILITY, AM14_PROBABILITY);
  });

  it('am14HasExpiry is false for an empty or Not-set display', () => {
    mountEditor({ timing: true, expires: 'Not set' });
    expect(am14HasExpiry()).toBe(false);
    const display = document.querySelector('[data-testid="api-mock-expires-display"]');
    if (display) display.textContent = '';
    expect(am14HasExpiry()).toBe(false);
  });

  it('hasAm14Workspace and studio view fall back to server bar / empty', () => {
    mountServerBar(true);
    expect(hasAm14Workspace()).toBe(true);
    expect(isAm14ServerRunning()).toBe(true);
    document.body.innerHTML = '';
    document.body.append(el('div', undefined, 'api-mock-empty'));
    expect(isAm14StudioViewActive()).toBe(true);
  });

  it('hasAm14Traffic ignores a non-numeric live chip', () => {
    const strip = el('div', undefined, 'api-mock-live-strip');
    const tx = el('button', undefined, 'api-mock-live-transactions');
    tx.append(Object.assign(el('span', 'am-count-badge'), { textContent: '—' }));
    strip.append(tx);
    document.body.append(strip);
    expect(hasAm14Traffic()).toBe(false);
  });

  it('ensureAm14RuleOpen clicks the route row when only a treeitem exists', async () => {
    const ctx = makeCtx();
    const explorer = el('div', 'am-explorer', 'api-mock-route-explorer');
    const row = el('button', 'am-route-item');
    row.setAttribute('role', 'treeitem');
    explorer.append(row);
    document.body.append(explorer);
    await ensureAm14RuleOpen(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.ROUTE_ROW);
  });

  it('runAm14FaultsPanel skips the tab click when the trigger is gone', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      faults: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
      probability: AM14_PROBABILITY,
      expires: 'Aug 14, 2026  13:51',
    });
    document.querySelector('[data-testid="api-mock-response-tab-faults"]')?.remove();
    await runAm14FaultsPanel(ctx);
    expect(ctx.click).not.toHaveBeenCalledWith(API_MOCK.RESPONSE_TAB_FAULTS);
  });

  it('runAm14MaxMatches falls back to TX_DETAIL without a response pane', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
    });
    mountLiveStrip();
    mountJournal();
    document.querySelector('[data-testid="api-mock-tx-response"]')?.remove();
    await runAm14MaxMatches(ctx);
    expect(sendApiMockRequest).toHaveBeenCalledTimes(2);
  });

  it('runAm14ExpiresAndProbability falls back to the expires picker root', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({
      variants: [
        { id: 'resp-1', label: 'Paid' },
        { id: 'resp-2', label: AM14_VARIANT_FALLBACK },
      ],
      timing: true,
      delay: AM14_DELAY,
      jitter: AM14_JITTER,
      maxMatches: AM14_MAX_MATCHES,
    });
    document.querySelector('[data-testid="api-mock-expires-display"]')?.remove();
    const picker = el('div', undefined, 'api-mock-variant-expires-at');
    document.querySelector('[data-testid="api-mock-timing-panel"]')?.append(picker);
    await runAm14ExpiresAndProbability(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_PROBABILITY, AM14_PROBABILITY);
  });

  it('runAm14ResetCloseMalformed skips the journal payoff when no row exists', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ faults: true, fault: 'timeout' });
    mountLiveStrip();
    const dock = el('div', undefined, 'api-mock-dock');
    dock.append(el('button', undefined, 'api-mock-dock-tab-transactions'));
    dock.append(el('button', undefined, 'api-mock-state-reset'));
    document.body.append(dock);
    document.body.append(el('div', undefined, 'api-mock-tx-detail'));
    await runAm14ResetCloseMalformed(ctx);
    expect(sendApiMockRequest).toHaveBeenCalled();
  });

  it('runAm14DribbleAndTimeline falls back to Simulate result without a timeline', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    const inner = ctx.click as ReturnType<typeof vi.fn>;
    ctx.click = vi.fn(async (selector: string) => {
      await inner(selector);
      document.querySelector('[data-testid="api-mock-sim-timeline-6"]')?.remove();
      document.querySelector('[data-testid="api-mock-sim-fault-timeline"]')?.remove();
      document.querySelector('[data-testid="api-mock-sim-tab-trace"]')?.remove();
      document.querySelector('[data-testid="api-mock-sim-wire-body"]')?.remove();
      document.querySelector('[data-testid="api-mock-sim-rendered-body"]')?.remove();
      document.querySelector('[data-testid="api-mock-chunk-add"]')?.remove();
    });
    mountExplorer();
    mountServerBar(true);
    mountEditor({ faults: true, fault: 'reset' });
    await runAm14DribbleAndTimeline(ctx);
    expect(ctx.click).toHaveBeenCalledWith(API_MOCK.FAULT_DRIBBLE);
  });

  it('runAm14PreviewThenProve skips duration column when it is missing', async () => {
    const ctx = makeCtx();
    withClickSideEffects(ctx);
    mountExplorer();
    mountServerBar(true, { apply: true });
    mountEditor({ timing: true, delay: AM14_DELAY, jitter: AM14_JITTER });
    mountLiveStrip();
    mountJournal();
    document.querySelector('[data-testid="api-mock-tx-duration"]')?.remove();
    document.querySelector('[data-testid="api-mock-tx-detail-duration"]')?.remove();
    await runAm14PreviewThenProve(ctx);
    expect(sendApiMockRequest).toHaveBeenCalled();
  });

  it('selectAm14Card is a no-op when variant cards are missing', async () => {
    const ctx = makeCtx();
    mountExplorer();
    mountServerBar(true);
    mountEditor({ variants: [], timing: true });
    await runAm14DelayAndJitter(ctx);
    expect(ctx.fill).toHaveBeenCalledWith(API_MOCK.VARIANT_DELAY, AM14_DELAY);
  });
});
