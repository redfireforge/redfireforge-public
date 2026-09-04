/** GRPC-24 Workflow Runner lesson — shared helpers, session, setup/cleanup */
import type { DemoActionContext } from '../../types';
import { WF, GRPC } from '@shared/selectors';
import { RES } from '@shared/selectors/res';
import { REX } from '@shared/selectors/rex';
import { FIXTURE_DESCRIPTOR_KEY } from '@shared/grpc/contractFixtures';
import {
  connectWorkflowNodes,
  deleteWorkflowByName,
  fitResultsExplorerDiagram,
  fitWorkflowCanvasView,
  getGrpcActiveDescriptorKey,
  getWorkflowByName,
  applyRunnerBatchConfig,
  removeWorkflowEdge,
  seedNamedWorkflow,
  selectAndRunRunnerWorkflow,
  selectRunnerWorkflowByName,
  waitForResultsExplorerBridge,
  waitForRunnerBridge,
} from '../../adapters';
import {
  cleanupWorkflowDemoRunUi,
  closeWfConfigModalIfOpen,
  expandWfDemoAppSidebar,
} from '../wf-demo-helpers';
import {
  WF14_NAME,
  WF14_NODE_GRPC,
  WF14_NODE_ASSERT,
  isNodeOnCanvas,
  isUnaryNodeOnCanvas,
  isWorkflowPresent,
} from './grpc-workflow-integration-helpers';
import { grpcFirstCallCleanup, spotlightAndPause, spotlightElementAndPause } from './grpc-lesson-helpers';
import { findScrollableParent, pauseDemoAutoScroll } from '../../demoSpotlightUtils';
import { showClickRipple } from '../../demoRipple';

// ── Constants ──────────────────────────────────────────────────────────────

/** Workflow-level variable name shown in INITIAL VARIABLES panel. */
export const GRPCWR_TARGET_VAR = 'grpcTarget';
/** Default value — the local Echo server without TLS. */
export const GRPCWR_TARGET_DEFAULT = 'localhost:50051';
/** Template expression used inside the Unary node target field. */
export const GRPCWR_TARGET_EXPR = '{{grpcTarget}}';

export const GRPCWR_ITERATIONS = 3;
export const GRPCWR_CONCURRENCY = 1;
export const GRPCWR_TRACE_LEVEL = 'standard' as const;

export const WF_RUNNER_SELECT = '[data-testid="workflow-select"]';
export const GRPCWR_EXPLORER_BTN = ':is([data-testid="results-explorer-open-btn"], button[title="Explore execution results"])';
export const GRPCWR_VARS_SECTION = '.workflow-vars-section';
export const GRPCWR_CONFIG_SECTION = '.workflow-runner-config-section';
export const GRPCWR_COMPLETION = '.completion-section';
export const GRPCWR_VIEW_RESULTS_BTN = GRPC.WF_VIEW_RESULTS_BTN;
export const GRPCWR_PROGRESS = '.progress-section';
export const GRPCWR_REQUEST_ROW = '.clickable-row';
export const GRPCWR_EXPLORER_DETAIL = '.results-explorer-detail';
export const GRPCWR_EXPLORER_MATRIX = '.iteration-matrix';

// ── Session flags ──────────────────────────────────────────────────────────

export const grpcWRSession = {
  // Designer build phase
  workflowCreated: false,
  variablesDefined: false,
  sidebarCollapsed: false,
  unaryAdded: false,
  unaryConfigured: false,
  assertAdded: false,
  assertConfigured: false,
  quickTestRun: false,
  // Workflow Runner phase
  workflowSelected: false,
  configApplied: false,
  runCompleted: false,
};

export function resetGrpcWRSession(): void {
  Object.assign(grpcWRSession, {
    workflowCreated: false,
    variablesDefined: false,
    sidebarCollapsed: false,
    unaryAdded: false,
    unaryConfigured: false,
    assertAdded: false,
    assertConfigured: false,
    quickTestRun: false,
    workflowSelected: false,
    configApplied: false,
    runCompleted: false,
  });
}

// ── Workflow factory (with grpcTarget variable) ────────────────────────────

export function resolveDescriptorKey(): string {
  return getGrpcActiveDescriptorKey() ?? FIXTURE_DESCRIPTOR_KEY;
}

function buildGrpcEchoWorkflowWithVars(): Record<string, unknown> {
  return {
    id: 'grpc24-wf-demo',
    name: WF14_NAME,
    schemaVersion: 6,
    variables: { [GRPCWR_TARGET_VAR]: GRPCWR_TARGET_DEFAULT },
    services: [],
    hostProfiles: [],
    authProfiles: [],
    nodes: [
      {
        id: 'grpc24-start',
        type: 'start',
        position: { x: 100, y: 200 },
        data: { label: 'Start', inputVariables: {} },
      },
      {
        id: WF14_NODE_GRPC,
        type: 'grpcUnary',
        position: { x: 320, y: 200 },
        data: {
          label: 'Echo Call',
          callType: 'unary',
          target: GRPCWR_TARGET_EXPR,
          descriptorKey: resolveDescriptorKey(),
          service: 'echo.EchoService',
          method: 'Echo',
          body: { message: 'workflow-test' },
          saveAs: 'echoReply',
          onError: 'fail',
        },
      },
      {
        id: WF14_NODE_ASSERT,
        type: 'grpcAssert',
        position: { x: 580, y: 200 },
        data: {
          label: 'Assert Echo',
          source: 'echoReply',
          assertions: [
            { grpcStatus: 0 },
            { grpcField: 'message', equals: 'workflow-test' },
          ],
          onError: 'fail',
        },
      },
      {
        id: 'grpc24-end',
        type: 'end',
        position: { x: 820, y: 200 },
        data: { label: 'End' },
      },
    ],
    edges: [
      { id: 'grpc24-e1', source: 'grpc24-start', target: WF14_NODE_GRPC },
      { id: 'grpc24-e2', source: WF14_NODE_GRPC, target: WF14_NODE_ASSERT },
      { id: 'grpc24-e3', source: WF14_NODE_ASSERT, target: 'grpc24-end' },
    ],
  };
}

/** Exported for unit tests — full workflow with grpcTarget variable. */
export function createGrpcEchoWorkflowWithVars(): Record<string, unknown> {
  return buildGrpcEchoWorkflowWithVars();
}

// ── Canvas helpers ─────────────────────────────────────────────────────────

function resolveCanvasNodeId(selector: string): string {
  const el = document.querySelector<HTMLElement>(selector);
  return (
    el?.getAttribute('data-id') ??
    el?.closest('.react-flow__node')?.getAttribute('data-id') ??
    ''
  );
}

function connectEdge(sourceSelector: string, targetSelector: string, handle?: string): void {
  const src = resolveCanvasNodeId(sourceSelector);
  const tgt = resolveCanvasNodeId(targetSelector);
  if (!src || !tgt) return;
  removeWorkflowEdge(src, tgt);
  connectWorkflowNodes(src, tgt, handle ?? null, null);
}

export function ensureChainConnected(): void {
  connectEdge('.react-flow__node-start', WF.NODE_GRPC_UNARY, 'out');
  connectEdge(WF.NODE_GRPC_UNARY, WF.NODE_GRPC_ASSERT);
  connectEdge(WF.NODE_GRPC_ASSERT, '.react-flow__node-end');
}

// ── Designer build helpers ─────────────────────────────────────────────────

export async function seedGrpcWRWorkflowQuiet(ctx: DemoActionContext): Promise<void> {
  await seedNamedWorkflow(ctx, WF14_NAME, buildGrpcEchoWorkflowWithVars(), {
    deleteDelayMs: 150,
    insertPreDelayMs: 100,
    insertDelayMs: 350,
  });
  Object.assign(grpcWRSession, {
    workflowCreated: true,
    variablesDefined: true,
    sidebarCollapsed: true,
    unaryAdded: true,
    unaryConfigured: true,
    assertAdded: true,
    assertConfigured: true,
  });
  fitWorkflowCanvasView();
  await ctx.delay(120);
}

export async function ensureOnWorkflowTab(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(WF.CANVAS)) {
    ctx.navigateToTab('workflow');
    await ctx.delay(500);
  }
}

export async function ensureGrpcWRNodesPresent(ctx: DemoActionContext): Promise<void> {
  await ensureOnWorkflowTab(ctx);
  if (
    !isWorkflowPresent() ||
    !isUnaryNodeOnCanvas() ||
    !isNodeOnCanvas(WF14_NODE_ASSERT)
  ) {
    await seedGrpcWRWorkflowQuiet(ctx);
  }
}

// ── Workflow Runner helpers ────────────────────────────────────────────────

export async function ensureWorkflowSeededForRunner(ctx: DemoActionContext): Promise<void> {
  if (!getWorkflowByName(WF14_NAME)) {
    await seedGrpcWRWorkflowQuiet(ctx);
  }
}

function fillRunnerLabeledNumberInput(labelText: string, value: string): HTMLInputElement | null {
  const field = Array.from(document.querySelectorAll('.resilience-field')).find(
    (el) => el.querySelector('label')?.textContent?.trim() === labelText,
  );
  const input = field?.querySelector<HTMLInputElement>('input') ?? null;
  if (!input) return null;
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  nativeSet?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  return input;
}

function resilienceFieldByLabel(labelText: string): HTMLElement | null {
  const field = Array.from(document.querySelectorAll<HTMLElement>('.resilience-field')).find(
    (el) => el.querySelector('label')?.textContent?.trim() === labelText,
  );
  return field ?? null;
}

/** Spotlight the grpcTarget row in Initial Variables (name + override value). */
export async function spotlightGrpcTargetVarRow(ctx: DemoActionContext, holdMs = 900): Promise<void> {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`${GRPCWR_VARS_SECTION} .wfp-var-row, ${GRPCWR_VARS_SECTION} [data-testid="var-row"]`));
  const row =
    rows.find((el) => el.textContent?.includes(GRPCWR_TARGET_VAR))
    ?? document.querySelector<HTMLElement>(`${GRPCWR_VARS_SECTION} .wfp-var-row`)
    ?? document.querySelector<HTMLElement>(GRPCWR_VARS_SECTION);
  if (!row) return;
  row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  await ctx.delay(200);
  await spotlightElementAndPause(ctx, row, holdMs);
}

export async function selectGrpcEchoWorkflow(ctx: DemoActionContext): Promise<void> {
  selectRunnerWorkflowByName(WF14_NAME);
  await spotlightAndPause(ctx, WF_RUNNER_SELECT, 550);
  await ctx.click(WF_RUNNER_SELECT);
  await ctx.waitFor('.wfp-dropdown-panel');
  await ctx.delay(400);
  const items = Array.from(document.querySelectorAll<HTMLElement>('.wfp-dropdown-item'));
  const target =
    items.find((el) => el.textContent?.trim() === WF14_NAME) ??
    items.find((el) => el.textContent?.trim().startsWith(WF14_NAME));
  if (target) {
    await spotlightElementAndPause(ctx, target, 500);
    target.click();
    await ctx.delay(700);
  }
  grpcWRSession.workflowSelected = true;
}

/** Quiet bridge apply — for preAction / rapid-Next guards. */
export async function applyGrpcWRConfig(ctx: DemoActionContext): Promise<void> {
  selectRunnerWorkflowByName(WF14_NAME);
  await waitForRunnerBridge(ctx);
  applyRunnerBatchConfig(GRPCWR_ITERATIONS, GRPCWR_CONCURRENCY, GRPCWR_TRACE_LEVEL);
  grpcWRSession.configApplied = true;
  await ctx.delay(120);
}

/**
 * Visible Execution Config beat: spotlight Iterations + Concurrency, fill values,
 * then bridge-apply so the runner state matches what the viewer saw.
 */
export async function applyGrpcWRConfigVisible(ctx: DemoActionContext): Promise<void> {
  selectRunnerWorkflowByName(WF14_NAME);
  await waitForRunnerBridge(ctx);

  await spotlightAndPause(ctx, GRPCWR_CONFIG_SECTION, 600);

  const iterField = resilienceFieldByLabel('Iterations');
  if (iterField) {
    iterField.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    await spotlightElementAndPause(ctx, iterField, 550);
  }
  fillRunnerLabeledNumberInput('Iterations', String(GRPCWR_ITERATIONS));
  await ctx.delay(450);

  const concField = resilienceFieldByLabel('Concurrency');
  if (concField) {
    concField.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    await spotlightElementAndPause(ctx, concField, 500);
  }
  fillRunnerLabeledNumberInput('Concurrency', String(GRPCWR_CONCURRENCY));
  await ctx.delay(450);

  applyRunnerBatchConfig(GRPCWR_ITERATIONS, GRPCWR_CONCURRENCY, GRPCWR_TRACE_LEVEL);
  grpcWRSession.configApplied = true;

  if (iterField) await spotlightElementAndPause(ctx, iterField, 500);
}

export async function runGrpcEchoWorkflow(ctx: DemoActionContext): Promise<void> {
  if (document.querySelector(GRPCWR_COMPLETION)) {
    grpcWRSession.runCompleted = true;
    return;
  }
  selectRunnerWorkflowByName(WF14_NAME);
  await waitForRunnerBridge(ctx);
  applyRunnerBatchConfig(GRPCWR_ITERATIONS, GRPCWR_CONCURRENCY, GRPCWR_TRACE_LEVEL);

  const runBtn = document.querySelector<HTMLElement>('[data-testid="workflow-runner-run-btn"]');
  if (runBtn) {
    runBtn.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    await spotlightElementAndPause(ctx, runBtn, 650);
    showClickRipple(runBtn);
    await ctx.delay(200);
  }

  if (!selectAndRunRunnerWorkflow(WF14_NAME)) {
    await ctx.delay(400);
    selectAndRunRunnerWorkflow(WF14_NAME);
  }

  // Progress bar while iterations run.
  for (let i = 0; i < 8; i++) {
    await ctx.delay(350);
    const progress = document.querySelector<HTMLElement>(GRPCWR_PROGRESS);
    if (progress) {
      await spotlightElementAndPause(ctx, progress, 700);
      break;
    }
    if (document.querySelector(GRPCWR_COMPLETION)) break;
  }

  for (let i = 0; i < 60; i++) {
    await ctx.delay(500);
    if (document.querySelector(GRPCWR_COMPLETION)) break;
  }
  const completion = document.querySelector<HTMLElement>(GRPCWR_COMPLETION);
  completion?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await ctx.delay(400);
  if (completion) await spotlightElementAndPause(ctx, completion, 900);
  grpcWRSession.runCompleted = true;
}

export async function ensureRunnerReady(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(WF_RUNNER_SELECT)) {
    ctx.navigateToTab('workflow-runner');
    await ctx.delay(700);
  }
  await ensureWorkflowSeededForRunner(ctx);
  if (!grpcWRSession.workflowSelected) await selectGrpcEchoWorkflow(ctx);
  if (!grpcWRSession.configApplied) await applyGrpcWRConfig(ctx);
}

export async function openResultsFromCompletionBanner(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(GRPCWR_COMPLETION)) {
    await ensureRunnerReady(ctx);
    await runGrpcEchoWorkflow(ctx);
  }
  const banner = document.querySelector<HTMLElement>(GRPCWR_COMPLETION);
  if (banner) {
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await spotlightElementAndPause(ctx, banner, 700);
  }
  const link = document.querySelector<HTMLElement>(GRPCWR_VIEW_RESULTS_BTN);
  if (link) {
    await spotlightElementAndPause(ctx, link, 600);
    showClickRipple(link);
    await ctx.delay(150);
    link.click();
  } else {
    ctx.navigateToTab('results');
  }
  await ctx.delay(900);
  await spotlightAndPause(ctx, '.results-run-filter-tabs', 600);
}

export async function ensureOnResultsTab(ctx: DemoActionContext): Promise<void> {
  if (document.querySelector('.results-run-filter-tabs')) return;
  if (!grpcWRSession.runCompleted) {
    ctx.navigateToTab('workflow-runner');
    await ctx.delay(600);
    await ensureRunnerReady(ctx);
    await runGrpcEchoWorkflow(ctx);
    await openResultsFromCompletionBanner(ctx);
    return;
  }
  ctx.navigateToTab('results');
  await ctx.delay(700);
}

export async function openRequestDetailsTab(ctx: DemoActionContext): Promise<void> {
  await ensureOnResultsTab(ctx);
  const tab =
    document.querySelector<HTMLElement>(RES.REQUEST_DETAILS_TAB)
    ?? Array.from(document.querySelectorAll<HTMLElement>('.results-view-tab')).find(
      (el) => el.textContent?.trim() === 'Request Details',
    );
  if (tab) {
    // Tab switch beat — hold long enough to read the label before the click.
    await spotlightElementAndPause(ctx, tab, 1000);
    showClickRipple(tab);
    await ctx.delay(350);
    tab.click();
    await ctx.delay(800);
  }
  // Flat group-by so Echo Call rows (and GRPC badges) render without expand clicks.
  const groupBySelect = document.querySelector<HTMLSelectElement>('.group-by-controls select');
  if (groupBySelect) {
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    nativeSet?.call(groupBySelect, 'test');
    groupBySelect.dispatchEvent(new Event('change', { bubbles: true }));
    await ctx.delay(500);
  }
}

/** Tour Request Details: GRPC badge → row → Response Detail → pause → close. */
export async function tourRequestDetailsRow(ctx: DemoActionContext): Promise<void> {
  await openRequestDetailsTab(ctx);
  await ctx.waitFor(GRPCWR_REQUEST_ROW);
  await ctx.delay(400);
  const row =
    Array.from(document.querySelectorAll<HTMLElement>(GRPCWR_REQUEST_ROW)).find((el) =>
      /grpc/i.test(el.textContent ?? ''),
    )
    ?? document.querySelector<HTMLElement>(GRPCWR_REQUEST_ROW);
  if (!row) return;
  row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  await ctx.delay(400);

  // Teaching payoff: the GRPC / GRPCUNARY method badge on the Echo Call row.
  const badge = row.querySelector<HTMLElement>('.method-badge');
  if (badge) {
    await spotlightElementAndPause(ctx, badge, 1200);
  }
  await spotlightElementAndPause(ctx, row, 1100);
  showClickRipple(row);
  await ctx.delay(400);
  row.click();
  await ctx.delay(1000);
  const detail =
    document.querySelector<HTMLElement>('[data-testid="response-detail-modal"]')
    ?? document.querySelector<HTMLElement>('.response-detail-modal')
    ?? document.querySelector<HTMLElement>('.professional-modal');
  if (detail) {
    await spotlightElementAndPause(ctx, detail, 1400);
    const closeBtn =
      detail.querySelector<HTMLElement>('button.btn-ghost, button.btn-primary, .ram-modal-close')
      ?? Array.from(detail.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => /close|cancel/i.test(b.textContent ?? ''),
      );
    if (closeBtn) {
      await spotlightElementAndPause(ctx, closeBtn, 700);
      showClickRipple(closeBtn);
      await ctx.delay(300);
      closeBtn.click();
      await ctx.delay(800);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await ctx.delay(700);
    }
  }
}

export async function openResultsOverviewTab(ctx: DemoActionContext): Promise<void> {
  await ensureOnResultsTab(ctx);
  const tab = Array.from(document.querySelectorAll<HTMLElement>('.results-view-tab')).find(
    (el) => el.textContent?.trim() === 'Overview',
  );
  if (tab && !tab.classList.contains('active')) {
    tab.click();
    await ctx.delay(450);
  }
}

export async function ensureFullResultsMetricsCards(ctx: DemoActionContext): Promise<void> {
  // Metrics cards can briefly render in a partial state while run summary data hydrates.
  // Wait until rows are present and core numeric values are populated before highlighting.
  for (let i = 0; i < 25; i++) {
    const cards = document.querySelector<HTMLElement>(RES.METRICS_CARDS);
    if (cards) {
      const rows = cards.querySelectorAll<HTMLElement>('.metrics-row');
      const hasTwoRows = rows.length >= 2;
      const hasTps = Array.from(cards.querySelectorAll<HTMLElement>('.metric-label')).some(
        (el) => el.textContent?.trim().toUpperCase() === 'TPS',
      );
      const metricValues = Array.from(cards.querySelectorAll<HTMLElement>('.metric-value'))
        .map((el) => el.textContent?.trim() ?? '');
      const hasEnoughValues = metricValues.length >= 10;
      const coreValues = metricValues.slice(0, 8);
      const coreFilled = coreValues.length >= 8 && coreValues.every((v) => v.length > 0);
      const hasNumericCore = coreValues.some((v) => /\d/.test(v));
      if (hasTwoRows && hasTps && hasEnoughValues && coreFilled && hasNumericCore) return;
    }
    await ctx.delay(250);
  }
}

/**
 * Scroll a Results Dashboard element so its top sits just below the sticky
 * `.results-top` chrome. Native `scrollIntoView({ block: 'nearest' })` often
 * parks percentile cards under that header, clipping values at the viewport top.
 */
export async function scrollResultsStickyAwareIntoView(
  ctx: DemoActionContext,
  el: HTMLElement,
): Promise<void> {
  // Pause LiveDemo auto-scroll so it cannot override our manual position.
  // Metrics blocks are taller than the gap between sticky header and the demo
  // narration panel, so visibility checks stay false and auto-scroll would
  // push content behind `.results-top` again.
  pauseDemoAutoScroll(4000);

  const scrollParent = findScrollableParent(el);
  const stickyTop = document.querySelector<HTMLElement>('.results-top');
  if (scrollParent && stickyTop) {
    const elRect = el.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const stickyRect = stickyTop.getBoundingClientRect();
    const elTopInParent = elRect.top - parentRect.top + scrollParent.scrollTop;
    const targetTop = Math.max(0, elTopInParent - stickyRect.height - 16);
    // Use 'instant' so the scroll completes before the spotlight ring measures.
    scrollParent.scrollTo({ top: targetTop, behavior: 'instant' });
    await ctx.delay(120);
    return;
  }

  el.scrollIntoView?.({ behavior: 'instant', block: 'start', inline: 'nearest' });
  await ctx.delay(120);
}

export async function scrollResultsMetricsCardsIntoView(ctx: DemoActionContext): Promise<void> {
  const cards = document.querySelector<HTMLElement>(RES.METRICS_CARDS);
  if (!cards) return;
  await scrollResultsStickyAwareIntoView(ctx, cards);
}

/** Scroll the p50/p95 latency row fully below the sticky Results header. */
export async function scrollResultsMetricsLatencyRowIntoView(ctx: DemoActionContext): Promise<void> {
  const latencyRow = document.querySelector<HTMLElement>(RES.METRICS_LATENCY_ROW);
  if (!latencyRow) return;
  await scrollResultsStickyAwareIntoView(ctx, latencyRow);
}

export async function openAndFitResultsExplorer(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(REX.DIAGRAM)) {
    const explorerBtn = document.querySelector<HTMLElement>(GRPCWR_EXPLORER_BTN);
    if (explorerBtn) {
      await spotlightElementAndPause(ctx, explorerBtn, 600);
      showClickRipple(explorerBtn);
      await ctx.delay(150);
      explorerBtn.click();
      await ctx.delay(700);
    }
  }
  await waitForResultsExplorerBridge(ctx);
  const fitBtn = document.querySelector<HTMLElement>(REX.FIT_VIEW_BTN);
  if (fitBtn) {
    await spotlightElementAndPause(ctx, fitBtn, 450);
    fitBtn.click();
    await ctx.delay(400);
  } else if (!fitResultsExplorerDiagram()) {
    await ctx.delay(300);
  }
  await ctx.delay(300);
}

/** Walk Canvas → Detail → Iteration matrix so narration matches visible panels. */
export async function tourResultsExplorerPanels(ctx: DemoActionContext): Promise<void> {
  await openAndFitResultsExplorer(ctx);

  await spotlightAndPause(ctx, REX.DIAGRAM, 900);

  // Ensure detail panel is open, then ring it.
  const detailToggle = document.querySelector<HTMLElement>(REX.DETAIL_PANEL_TOGGLE);
  if (detailToggle && !document.querySelector(GRPCWR_EXPLORER_DETAIL)) {
    detailToggle.click();
    await ctx.delay(400);
  }
  const detail = document.querySelector<HTMLElement>(GRPCWR_EXPLORER_DETAIL);
  if (detail) {
    await spotlightElementAndPause(ctx, detail, 800);
  } else if (detailToggle) {
    await spotlightElementAndPause(ctx, detailToggle, 500);
  }

  // Click a canvas node so detail has content (best-effort).
  const canvasNode = document.querySelector<HTMLElement>(REX.CANVAS_NODE);
  if (canvasNode) {
    await spotlightElementAndPause(ctx, canvasNode, 600);
    canvasNode.click();
    await ctx.delay(500);
    const detailAfter = document.querySelector<HTMLElement>(GRPCWR_EXPLORER_DETAIL);
    if (detailAfter) await spotlightElementAndPause(ctx, detailAfter, 700);
  }

  const matrix = document.querySelector<HTMLElement>(GRPCWR_EXPLORER_MATRIX);
  if (matrix) {
    matrix.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    await spotlightElementAndPause(ctx, matrix, 900);
  }
}

export async function closeResultsExplorerIfOpen(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(REX.DIAGRAM)) return;

  // 1) Prefer explicit close controls when available (legacy + current UIs).
  let closeBtn = document.querySelector<HTMLElement>(
    '.results-explorer-modal-close-btn, [data-testid="results-explorer-close-btn"], .results-explorer-footer-actions .cat-btn',
  );

  // 2) Fallback: any visible button labeled exactly "Close" inside Explorer.
  if (!closeBtn) {
    const closeByText = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (btn) =>
        btn.offsetParent !== null &&
        btn.textContent?.trim().toLowerCase() === 'close' &&
        (btn.closest('.results-explorer-overlay') || btn.closest('.results-explorer-modal') || btn.closest('.results-explorer-footer')),
    );
    closeBtn = closeByText ?? null;
  }

  if (closeBtn) {
    closeBtn.click();
    await ctx.delay(450);
  }

  // 3) Final fallback: Escape key (Explorer listens for Esc to close).
  if (document.querySelector(REX.DIAGRAM)) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await ctx.delay(250);
  }
}

// ── Setup / Cleanup ────────────────────────────────────────────────────────

export async function grpcWorkflowRunnerSetup(ctx: DemoActionContext): Promise<void> {
  resetGrpcWRSession();
  // This lesson opens on Workflow Designer step 1 (+ New). Skip the full
  // grpcFirstCallSetup Studio tour — it flashes gRPC Studio / tabs / drawers
  // before Reading. Quiet storage hygiene is enough; the isolated demo tab is
  // discarded on cleanup.
  try {
    const { purgeGrpcDemoEphemeralStorage } = await import('../grpc-demo-storage-cleanup');
    await purgeGrpcDemoEphemeralStorage();
  } catch {
    // Best-effort hygiene only.
  }
  await cleanupWorkflowDemoRunUi(ctx);
  await closeWfConfigModalIfOpen(ctx);
  if (getWorkflowByName(WF14_NAME)) {
    deleteWorkflowByName(WF14_NAME);
    await ctx.delay(100);
  }
  // Land on the Reading frame: Workflow Designer + sidebar open + + New visible.
  ctx.navigateToTab('workflow');
  await ctx.delay(180);
  const skipBtn = document.querySelector<HTMLElement>('.onboarding-tooltip-skip');
  if (skipBtn) { skipBtn.click(); await ctx.delay(60); }
  await expandWfDemoAppSidebar(ctx);
  grpcWRSession.sidebarCollapsed = false;
  // Readable node size — leave room for the LiveDemo card on the right.
  fitWorkflowCanvasView();
  await ctx.delay(100);
}

export async function grpcWorkflowRunnerCleanup(ctx: DemoActionContext): Promise<void> {
  resetGrpcWRSession();
  await closeWfConfigModalIfOpen(ctx);
  await cleanupWorkflowDemoRunUi(ctx);
  deleteWorkflowByName(WF14_NAME);
  await grpcFirstCallCleanup(ctx);
}