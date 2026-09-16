// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { selectOption, getCustomSelectValue } from '@test-utils/customSelectHelper';
import ResultsDashboard from './ResultsDashboard';
import { makeResult, makeSummary, makeTestRun } from '@test-utils/factories';
import { generateReport, downloadReport } from './utils/reportGenerator';

const storageMocks = vi.hoisted(() => ({
  loadTestRunsLite: vi.fn(),
  loadTraceForRun: vi.fn(),
  deleteTestRun: vi.fn(),
}));

const runBaselineMocks = vi.hoisted(() => ({
  loadBaselines: vi.fn(),
  markAsBaseline: vi.fn(),
  unmarkBaseline: vi.fn(),
  isBaseline: vi.fn((baselines: Array<{ runId: string }>, runId: string) => baselines.some((b) => b.runId === runId)),
  renameBaseline: vi.fn(),
  loadRegressionThresholds: vi.fn(),
  saveRegressionThresholds: vi.fn(),
  computeRunRegressionStatus: vi.fn(() => 'pass'),
}));

const importHandlersState = vi.hoisted(() => ({
  importFileRef: { current: null as HTMLInputElement | null },
  importRunFileRef: { current: null as HTMLInputElement | null },
  importError: '',
  setImportError: vi.fn(),
  importedFileName: '',
  showReplayModal: false,
  setShowReplayModal: vi.fn(),
  replayTrace: null as unknown,
  setReplayTrace: vi.fn(),
  handleImportTrace: vi.fn(),
  handleImportRun: vi.fn(),
  closeReplayModal: vi.fn(),
}));

const slaState = vi.hoisted(() => ({
  slaTargets: [] as Array<{ id: string; metric: string; operator: string; value: number }>,
  slaScope: 'run',
  runSlaStatuses: new Map<string, 'pass' | 'fail' | 'warn' | 'no-data' | null>(),
  handleSaveSlaTargets: vi.fn(),
}));

const groupingState = vi.hoisted(() => ({
  groupBy: 'feature',
  subGroupBy: 'group',
  setSubGroupBy: vi.fn(),
  expanded: new Set<string>(),
  setExpanded: vi.fn(),
  toggle: vi.fn(),
  handleGroupByChange: vi.fn(),
  groupTree: [],
  groupCount: 0,
  isFlat: true,
  subGroupOptions: [] as Array<{ value: 'feature' | 'group' | 'test' | 'iteration' | 'workflowStep'; label: string }>,
}));

const exportMocks = vi.hoisted(() => ({
  exportJson: vi.fn(),
  exportCsv: vi.fn(),
}));

const resultsGroupingUtilsMocks = vi.hoisted(() => ({
  hasWorkflowData: vi.fn(() => false),
}));

const traceMocks = vi.hoisted(() => ({
  hasExecutionTrace: vi.fn(() => false),
  decompressTrace: vi.fn((payload: unknown) => payload),
}));

vi.mock('../../shared/utils/storage', () => ({
  loadTestRunsLite: storageMocks.loadTestRunsLite,
  loadTraceForRun: storageMocks.loadTraceForRun,
  deleteTestRun: storageMocks.deleteTestRun,
}));

vi.mock('./utils/runBaselines', async () => {
  const actual = await vi.importActual<typeof import('./utils/runBaselines')>('./utils/runBaselines');
  return {
    ...actual,
    loadBaselines: runBaselineMocks.loadBaselines,
    markAsBaseline: runBaselineMocks.markAsBaseline,
    unmarkBaseline: runBaselineMocks.unmarkBaseline,
    isBaseline: runBaselineMocks.isBaseline,
    renameBaseline: runBaselineMocks.renameBaseline,
    loadRegressionThresholds: runBaselineMocks.loadRegressionThresholds,
    saveRegressionThresholds: runBaselineMocks.saveRegressionThresholds,
    computeRunRegressionStatus: runBaselineMocks.computeRunRegressionStatus,
  };
});

vi.mock('./hooks/useImportHandlers', () => ({
  useImportHandlers: () => importHandlersState,
}));

vi.mock('./hooks/useSlaManagement', () => ({
  useSlaManagement: () => slaState,
}));

vi.mock('./hooks/useResultsGrouping', () => ({
  useResultsGrouping: () => groupingState,
}));

vi.mock('../requests/components/ResponseDetailModal', () => ({
  default: ({ result, onClose }: { result: { id: string } | null; onClose: () => void }) => (
    <div data-testid="response-detail-modal">
      {result?.id ?? 'none'}
      <button type="button" onClick={onClose}>mock-close-response-modal</button>
    </div>
  ),
}));
vi.mock('../test-runner/components/WaterfallBar', () => ({ AggregatedTimingTable: () => <div>timing-table</div> }));
vi.mock('../../shared/utils/export', () => ({ exportJson: exportMocks.exportJson, exportCsv: exportMocks.exportCsv }));
vi.mock('../test-runner/utils/resultsGrouping', () => ({ hasWorkflowData: resultsGroupingUtilsMocks.hasWorkflowData }));
vi.mock('../test-runner/utils/runnerProgressStorage', () => ({ thinkTimeLabel: () => 'none' }));
vi.mock('./components/RunComparisonPanel', () => ({
  RunComparisonPanel: ({
    baselineRun,
    currentRun,
    onRenameBaseline,
  }: {
    baselineRun: { id: string };
    currentRun: { id: string };
    onRenameBaseline?: (runId: string, label: string) => void;
  }) => (
    <div data-testid="run-comparison-panel">
      {baselineRun.id} vs {currentRun.id}
      {onRenameBaseline && (
        <button type="button" onClick={() => onRenameBaseline(baselineRun.id, 'Renamed Baseline')}>
          mock-rename-from-comparison
        </button>
      )}
    </div>
  ),
  TrendChart: () => <div data-testid="trend-chart" />,
}));
vi.mock('./components/ResponseTimeHistogram', () => ({ ResponseTimeHistogram: () => <div>histogram</div> }));
vi.mock('./components/DataRowSummaryTable', () => ({ DataRowSummaryTable: () => <div>data-row-summary</div> }));
vi.mock('./components/WorkflowResultsSummary', () => ({ WorkflowResultsSummary: () => <div>workflow-summary</div> }));
vi.mock('./components/ResultsMetricsCards', () => ({ ResultsMetricsCards: () => <div>metrics-cards</div> }));
vi.mock('./utils/reportGenerator', () => ({ generateReport: vi.fn(), downloadReport: vi.fn() }));
vi.mock('./components/BaselineListPanel', () => ({
  BaselineListPanel: ({
    baselines,
    onCompare,
    onUnmark,
    onRename,
  }: {
    baselines: Array<{ runId: string }>;
    onCompare: (runId: string) => void;
    onUnmark: (runId: string) => void;
    onRename: (runId: string, label: string) => void;
  }) => (
    <div>
      baseline-list
      <button
        type="button"
        onClick={() => {
          if (baselines[0]) onCompare(baselines[0].runId);
        }}
      >
        mock-set-compare-target
      </button>
      <button
        type="button"
        onClick={() => {
          if (baselines[0]) onUnmark(baselines[0].runId);
        }}
      >
        mock-unmark-baseline
      </button>
      <button
        type="button"
        onClick={() => {
          if (baselines[0]) onRename(baselines[0].runId, 'Renamed From Panel');
        }}
      >
        mock-rename-baseline
      </button>
    </div>
  ),
}));
vi.mock('./components/RegressionThresholdsPanel', () => ({
  RegressionThresholdsPanel: ({ onSave }: { onSave: (payload: { avgPercent: number }) => void }) => (
    <button type="button" onClick={() => onSave({ avgPercent: 12 } as unknown as { avgPercent: number })}>
      mock-save-thresholds
    </button>
  ),
}));
vi.mock('./components/WorkflowResultsExplorerModal', () => ({
  default: ({ importedFileName }: { importedFileName?: string }) => (
    <div data-testid="workflow-results-explorer">{importedFileName ?? 'no-file'}</div>
  ),
}));
vi.mock('../../shared/utils/traceCompression', () => ({
  hasExecutionTrace: traceMocks.hasExecutionTrace,
  decompressTrace: traceMocks.decompressTrace,
}));
vi.mock('./components/SlaCompactBar', () => ({ SlaCompactBar: () => <div>sla-compact-bar</div> }));
vi.mock('./components/SlaStatusAccordion', () => ({ SlaStatusAccordion: () => <div>sla-accordion</div> }));
vi.mock('./components/ResultsRequestDetailsTab', () => ({
  ResultsRequestDetailsTab: ({
    renderErrorSnippet,
  }: {
    renderErrorSnippet: (result: {
      id: string;
      passed: boolean;
      errorMessage?: string;
      responseBody?: string;
      scenarioName: string;
      url: string;
    }) => React.ReactNode;
  }) => (
    <div>
      <div>requests-tab</div>
      {renderErrorSnippet({ id: 'error-result', passed: false, errorMessage: 'boom', scenarioName: 's1', url: 'https://api.local/path' })}
      {renderErrorSnippet({
        id: 'error-object-body',
        passed: false,
        responseBody: {
          long: 'x'.repeat(180),
        },
        scenarioName: 's2',
        url: 'https://api.local/object',
      })}
      {renderErrorSnippet({ id: 'ok-result', passed: true, scenarioName: 'ok', url: 'https://api.local/ok' })}
    </div>
  ),
}));

describe('ResultsDashboard', () => {
  function compareSelectEl(): Element {
    return document.querySelector('.baseline-compare-select')!;
  }

  beforeEach(async () => {
    resetAllMocks();
    storageMocks.loadTraceForRun.mockResolvedValue(null);
    storageMocks.deleteTestRun.mockResolvedValue(undefined);
    runBaselineMocks.markAsBaseline.mockResolvedValue([]);
    runBaselineMocks.unmarkBaseline.mockResolvedValue([]);
    runBaselineMocks.renameBaseline.mockResolvedValue([]);
    runBaselineMocks.loadRegressionThresholds.mockResolvedValue((await vi.importActual<typeof import('./utils/runBaselines')>('./utils/runBaselines')).DEFAULT_THRESHOLDS);

    importHandlersState.importError = '';
    importHandlersState.setImportError = vi.fn();
    importHandlersState.importedFileName = '';
    importHandlersState.showReplayModal = false;
    importHandlersState.replayTrace = null;
    importHandlersState.setReplayTrace = vi.fn();
    importHandlersState.setShowReplayModal = vi.fn();
    importHandlersState.handleImportTrace = vi.fn();
    importHandlersState.handleImportRun = vi.fn();
    importHandlersState.closeReplayModal = vi.fn();

    slaState.slaTargets = [];
    slaState.slaScope = 'run';
    slaState.runSlaStatuses = new Map();
    slaState.handleSaveSlaTargets = vi.fn();

    groupingState.groupBy = 'feature';
    groupingState.subGroupBy = 'group';
    groupingState.setSubGroupBy = vi.fn();
    groupingState.expanded = new Set();
    groupingState.setExpanded = vi.fn();
    groupingState.toggle = vi.fn();
    groupingState.handleGroupByChange = vi.fn();
    groupingState.groupTree = [];
    groupingState.groupCount = 0;
    groupingState.isFlat = true;
    groupingState.subGroupOptions = [];

    resultsGroupingUtilsMocks.hasWorkflowData.mockReturnValue(false);
    traceMocks.hasExecutionTrace.mockReturnValue(false);
    traceMocks.decompressTrace.mockImplementation((payload: unknown) => payload);
  });

  it('renders results tabs with tab semantics and updates selected state', async () => {
    const run = makeTestRun({
      id: 'run-a',
      timestamp: 1,
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);

    const overviewTab = await screen.findByRole('tab', { name: 'Overview' });
    const comparisonTrendsTab = screen.getByRole('tab', { name: 'Comparison & Trends' });

    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(comparisonTrendsTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(comparisonTrendsTab);

    expect(comparisonTrendsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /Comparison & Trends/i })).toBeTruthy();
  });

  it('renders empty state with run-type tabs and workflow-specific copy', async () => {
    storageMocks.loadTestRunsLite.mockResolvedValue([]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard initialRunTypeFilter="workflow" />);

    expect(await screen.findByRole('heading', { name: 'No results yet' })).toBeTruthy();
    expect(screen.getByText(/Workflow Runner to see results here/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /🧪 Test Runs/i }));
    expect(screen.getByText(/Test Runner or Parameterized Runner/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /All Runs/i }));
    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeTruthy();
  });

  it('offers a call to action from the empty state, routed by run type', async () => {
    storageMocks.loadTestRunsLite.mockResolvedValue([]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    const onNavigate = vi.fn();

    render(<ResultsDashboard initialRunTypeFilter="workflow" onNavigate={onNavigate} />);

    fireEvent.click(await screen.findByTestId('results-empty-state-cta'));
    expect(onNavigate).toHaveBeenCalledWith('workflow-runner');

    fireEvent.click(screen.getByRole('button', { name: /🧪 Test Runs/i }));
    fireEvent.click(screen.getByTestId('results-empty-state-cta'));
    expect(onNavigate).toHaveBeenCalledWith('runner');
  });

  it('generates markdown report from the report menu', async () => {
    const run = makeTestRun({
      id: 'run-report',
      timestamp: 1700000000000,
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
      svcName: 'svc-report',
      envName: 'dev',
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    vi.mocked(generateReport).mockReturnValue('# report');

    render(<ResultsDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Report ▾' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdown Report' }));

    expect(generateReport).toHaveBeenCalled();
    expect(downloadReport).toHaveBeenCalled();
  });

  it('generates html/json reports and exports JSON/CSV', async () => {
    const run = makeTestRun({
      id: 'run-report-2',
      timestamp: 1700000000000,
      summary: makeSummary({ errorsByStatus: { '500': 1, '0': 1 } }),
      results: [makeResult()],
      svcName: 'svc-report',
      envName: 'dev',
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    vi.mocked(generateReport).mockReturnValue('# report');

    render(<ResultsDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate Report ▾' }));
    fireEvent.click(screen.getByRole('button', { name: 'HTML Report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Report ▾' }));
    fireEvent.click(screen.getByRole('button', { name: 'JSON Report' }));

    expect(exportMocks.exportJson).toHaveBeenCalledWith(run);
    expect(exportMocks.exportCsv).toHaveBeenCalledWith(run.results, run.envName, run.svcName);
    expect(generateReport).toHaveBeenCalledTimes(2);
  });

  it('renders rerun-failed bar and triggers callback with unique row ids', async () => {
    const onRerunFailed = vi.fn();
    const run = makeTestRun({
      id: 'run-rerun',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [
        makeResult({ id: 'a', passed: false, dataRowId: 'r1' }),
        makeResult({ id: 'b', passed: false, dataRowId: 'r1' }),
        makeResult({ id: 'c', passed: false, dataRowId: 'r2' }),
      ],
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard onRerunFailed={onRerunFailed} />);

    const btn = await screen.findByRole('button', { name: 'Re-run Failed (2)' });
    fireEvent.click(btn);
    expect(onRerunFailed).toHaveBeenCalledWith(run, ['r1', 'r2']);
  });

  it('does not render rerun-failed bar when there are no failed data-row results', async () => {
    const onRerunFailed = vi.fn();
    const run = makeTestRun({
      id: 'run-rerun-none',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [
        makeResult({ id: 'a', passed: true, dataRowId: 'r1' }),
        makeResult({ id: 'b', passed: false, dataRowId: undefined }),
      ],
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard onRerunFailed={onRerunFailed} />);
    await screen.findByRole('button', { name: /Generate Report/i });
    expect(screen.queryByRole('button', { name: /Re-run Failed/i })).toBeNull();
    expect(onRerunFailed).not.toHaveBeenCalled();
  });

  it('deletes selected run and switches selection to remaining run', async () => {
    const runA = makeTestRun({ id: 'run-a', timestamp: 200, projectName: 'Run A', summary: makeSummary({ errorsByStatus: {} }), results: [makeResult()] });
    const runB = makeTestRun({ id: 'run-b', timestamp: 100, projectName: 'Run B', summary: makeSummary({ errorsByStatus: {} }), results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([runA, runB]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /Run A/i }));
    fireEvent.click(screen.getByRole('option', { name: /Run A/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(storageMocks.deleteTestRun).toHaveBeenCalledWith('run-a');
    });
  });

  it('refreshes data and supports env/svc filtering with run-type tabs', async () => {
    const unscopedRun = makeTestRun({ id: 'unscoped', svcName: '', envName: '', projectName: 'Unscoped', config: { ...makeTestRun().config, executionMode: 'pool' } });
    const devRun = makeTestRun({ id: 'dev-run', svcName: 'svc-a', envName: 'dev', projectName: 'Dev', config: { ...makeTestRun().config, executionMode: 'pool' } });
    const prodRun = makeTestRun({ id: 'prod-run', svcName: 'svc-a', envName: 'prod', projectName: 'Prod', config: { ...makeTestRun().config, executionMode: 'pool' } });
    const workflowRun = makeTestRun({ id: 'wf-run', projectName: 'WF', config: { ...makeTestRun().config, executionMode: 'workflow' } });
    storageMocks.loadTestRunsLite.mockResolvedValue([unscopedRun, devRun, prodRun, workflowRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard envName="dev" svcName="svc-a" />);

    await screen.findByRole('button', { name: /Unscoped/i });
    expect(screen.getByRole('button', { name: /All Runs \(3\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /🧪 Test Runs \(2\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /⚡ Workflow Runs \(1\)/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /⚡ Workflow Runs/i }));
    expect(screen.getByRole('button', { name: /WF/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /🧪 Test Runs/i }));
    fireEvent.click(screen.getByRole('button', { name: /All Runs/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(storageMocks.loadTestRunsLite).toHaveBeenCalledTimes(2);
      expect(runBaselineMocks.loadBaselines).toHaveBeenCalledTimes(2);
    });
  });

  it('renders import error banner and dismisses it', async () => {
    importHandlersState.importError = 'Import failed';
    const run = makeTestRun({ id: 'run-a', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);
    await screen.findByText('Import failed');
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(importHandlersState.setImportError).toHaveBeenCalledWith(null);
  });

  it('uses the newest baseline by markedAt as the default compare target', async () => {
    const selectedRun = makeTestRun({
      id: 'selected-run',
      timestamp: 300,
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const oldBaselineRun = makeTestRun({
      id: 'old-baseline',
      timestamp: 100,
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const newBaselineRun = makeTestRun({
      id: 'new-baseline',
      timestamp: 200,
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([selectedRun, oldBaselineRun, newBaselineRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([
      { runId: 'old-baseline', markedAt: 1 },
      { runId: 'new-baseline', markedAt: 5 },
    ]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Comparison & Trends (2)' }));

    await waitFor(() => {
      expect(screen.getByTestId('run-comparison-panel').textContent).toContain('new-baseline vs selected-run');
    });
    expect(screen.getByTestId('run-comparison-panel').textContent).toContain('new-baseline vs selected-run');
  });

  it('renders the selected run via the custom listbox and switches runs from the popup', async () => {
    const firstRun = makeTestRun({
      id: 'run-a',
      timestamp: 100,
      projectName: 'Project A',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const secondRun = makeTestRun({
      id: 'run-b',
      timestamp: 200,
      projectName: 'Project B',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([secondRun, firstRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);

    const trigger = await screen.findByRole('button', { name: /project b/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);

    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /project a/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /project a/i }).getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('does not show hidden baseline count in workflow-only filter', async () => {
    const workflowRun = makeTestRun({
      id: 'workflow-run',
      timestamp: 200,
      config: {
        ...makeTestRun().config,
        executionMode: 'workflow',
      },
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const testBaselineRun = makeTestRun({
      id: 'test-baseline-run',
      timestamp: 100,
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([workflowRun, testBaselineRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'test-baseline-run', markedAt: 1 }]);

    render(<ResultsDashboard initialRunTypeFilter="workflow" />);

    await screen.findByRole('tab', { name: 'Comparison & Trends' });
    expect(screen.queryByRole('tab', { name: 'Comparison & Trends (1)' })).toBeNull();
  });

  it('marks baseline, unmarks from panel, and renames baseline from panel/comparison', async () => {
    const selectedRun = makeTestRun({ id: 'selected-run', timestamp: 200, projectName: 'Selected', results: [makeResult()] });
    const baselineRun = makeTestRun({ id: 'baseline-run', timestamp: 100, projectName: 'Baseline', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([selectedRun, baselineRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline-run', markedAt: 2, label: 'Initial' }]);
    runBaselineMocks.markAsBaseline.mockResolvedValue([
      { runId: 'baseline-run', markedAt: 2, label: 'Initial' },
      { runId: 'selected-run', markedAt: 5 },
    ]);
    runBaselineMocks.unmarkBaseline.mockResolvedValue([]);
    runBaselineMocks.renameBaseline.mockResolvedValue([{ runId: 'baseline-run', markedAt: 2, label: 'Renamed' }]);

    render(<ResultsDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /☆ Set Baseline/i }));
    await waitFor(() => expect(runBaselineMocks.markAsBaseline).toHaveBeenCalledWith('selected-run'));

    fireEvent.click(screen.getByRole('tab', { name: /Comparison & Trends/i }));
    selectOption(compareSelectEl(), 'Initial');
    fireEvent.click(screen.getByRole('button', { name: 'mock-rename-from-comparison' }));
    await waitFor(() => {
      expect(runBaselineMocks.renameBaseline).toHaveBeenCalledWith('baseline-run', 'Renamed Baseline');
    });

    fireEvent.click(screen.getByRole('button', { name: 'mock-unmark-baseline' }));
    await waitFor(() => expect(runBaselineMocks.unmarkBaseline).toHaveBeenCalledWith('baseline-run'));

    await waitFor(() => {
      expect(runBaselineMocks.renameBaseline).toHaveBeenCalledWith('baseline-run', 'Renamed Baseline');
    });
  });

  it('keeps ad-hoc mode after user clears compare and switches selected run', async () => {
    const baselineRun = makeTestRun({
      id: 'baseline-run',
      timestamp: 300,
      projectName: 'Baseline Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const selectedRun = makeTestRun({
      id: 'selected-run',
      timestamp: 200,
      projectName: 'Selected Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const otherRun = makeTestRun({
      id: 'other-run',
      timestamp: 100,
      projectName: 'Other Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([selectedRun, baselineRun, otherRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline-run', markedAt: 9 }]);

    render(<ResultsDashboard />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Comparison & Trends (1)' }));
    await waitFor(() => {
      expect(getCustomSelectValue(compareSelectEl())).toMatch(/^★/);
    });

    fireEvent.click(document.querySelector('.baseline-compare-chip-clear') as HTMLButtonElement);
    await waitFor(() => {
      expect(getCustomSelectValue(compareSelectEl())).toBe('Compare against run...');
      expect(screen.getByText('Ad-hoc Mode')).toBeTruthy();
      expect(screen.getByText('Manual compare target (or none).')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /selected project/i }));
    fireEvent.click(screen.getByRole('option', { name: /other project/i }));

    await waitFor(() => {
      expect(getCustomSelectValue(compareSelectEl())).toBe('Compare against run...');
      expect(screen.getByText('Ad-hoc Mode')).toBeTruthy();
    });
  });

  it('opens compare action prompt from side panel and applies compared-target action', async () => {
    const selectedRun = makeTestRun({
      id: 'selected-run',
      timestamp: 300,
      projectName: 'Selected Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const baselineRun = makeTestRun({
      id: 'baseline-run',
      timestamp: 200,
      projectName: 'Baseline Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([selectedRun, baselineRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline-run', markedAt: 9 }]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Comparison & Trends (1)' }));

    fireEvent.click(screen.getByRole('button', { name: 'mock-set-compare-target' }));

    expect(await screen.findByText('Choose Comparison Action')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use As Compared Run' }));

    await waitFor(() => {
      expect(screen.queryByText('Choose Comparison Action')).toBeNull();
      expect(getCustomSelectValue(compareSelectEl())).toMatch(/^★/);
    });
  });

  it('swaps comparison direction from compare-action modal', async () => {
    const selectedRun = makeTestRun({
      id: 'selected-run',
      timestamp: 300,
      projectName: 'Selected Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const baselineRun = makeTestRun({
      id: 'baseline-run',
      timestamp: 200,
      projectName: 'Baseline Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([selectedRun, baselineRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline-run', markedAt: 9 }]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Comparison & Trends (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-set-compare-target' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Swap Direction' }));

    await waitFor(() => {
      expect(screen.queryByText('Choose Comparison Action')).toBeNull();
      expect(screen.getByRole('button', { name: /Baseline Project/i })).toBeTruthy();
      expect(getCustomSelectValue(compareSelectEl())).not.toMatch(/^★/);
    });
  });

  it('opens trace explorer directly from executionTrace payload', async () => {
    const run = makeTestRun({
      id: 'trace-run',
      timestamp: 10,
      config: { ...makeTestRun().config, executionMode: 'workflow' },
      results: [makeResult()],
      workflowName: 'wf-name',
      baseUrl: '',
      executionTrace: { traceId: 'exec-trace' } as unknown,
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    traceMocks.hasExecutionTrace.mockReturnValue(true);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /📊 Results Explorer/i }));
    expect(importHandlersState.setReplayTrace).toHaveBeenCalledWith(run.executionTrace);
    expect(importHandlersState.setShowReplayModal).toHaveBeenCalledWith(true);
  });

  it('decompresses trace when only compressedTrace exists', async () => {
    const compressedRun = makeTestRun({
      id: 'trace-run-2',
      timestamp: 10,
      config: { ...makeTestRun().config, executionMode: 'workflow' },
      results: [makeResult()],
      executionTrace: undefined,
      compressedTrace: { zipped: true } as unknown,
      hasTrace: false,
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([compressedRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    traceMocks.hasExecutionTrace.mockReturnValue(true);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /📊 Results Explorer/i }));
    expect(traceMocks.decompressTrace).toHaveBeenCalledWith(compressedRun.compressedTrace);
  });

  it('loads trace from storage when hasTrace is true', async () => {
    const hasTraceRun = makeTestRun({
      id: 'trace-run-3',
      timestamp: 10,
      config: { ...makeTestRun().config, executionMode: 'workflow' },
      results: [makeResult()],
      executionTrace: undefined,
      compressedTrace: undefined,
      hasTrace: true,
    });
    storageMocks.loadTraceForRun.mockResolvedValue({ fromStorage: true });
    storageMocks.loadTestRunsLite.mockResolvedValue([hasTraceRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    traceMocks.hasExecutionTrace.mockReturnValue(true);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /📊 Results Explorer/i }));
    await waitFor(() => expect(storageMocks.loadTraceForRun).toHaveBeenCalledWith('trace-run-3'));
  });

  it('shows loading state and exits when stored trace payload is empty', async () => {
    const hasTraceRun = makeTestRun({
      id: 'trace-run-4',
      timestamp: 10,
      config: { ...makeTestRun().config, executionMode: 'workflow' },
      results: [makeResult()],
      executionTrace: undefined,
      compressedTrace: undefined,
      hasTrace: true,
    });
    storageMocks.loadTraceForRun.mockResolvedValue(null);
    storageMocks.loadTestRunsLite.mockResolvedValue([hasTraceRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    traceMocks.hasExecutionTrace.mockReturnValue(true);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /📊 Results Explorer/i }));
    expect(screen.getByRole('button', { name: /⏳ Loading trace…/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /📊 Results Explorer/i })).toBeTruthy();
    });
    expect(importHandlersState.setReplayTrace).not.toHaveBeenCalled();
  });

  it('passes through empty imported filename to replay modal when filename is empty', async () => {
    const run = makeTestRun({ id: 'run-modal-fallback', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    importHandlersState.showReplayModal = true;
    importHandlersState.replayTrace = { trace: 'x' };
    importHandlersState.importedFileName = '';

    render(<ResultsDashboard />);
    expect((await screen.findByTestId('workflow-results-explorer')).textContent).toBe('');
  });

  it('passes undefined imported filename to replay modal for empty and populated states', async () => {
    (importHandlersState as unknown as { importedFileName: string | null }).importedFileName = null;
    importHandlersState.showReplayModal = true;
    importHandlersState.replayTrace = { trace: 'empty-state' };

    storageMocks.loadTestRunsLite.mockResolvedValue([]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    const emptyView = render(<ResultsDashboard />);
    expect((await screen.findByTestId('workflow-results-explorer')).textContent).toBe('no-file');

    emptyView.unmount();

    const run = makeTestRun({ id: 'run-modal-null', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    render(<ResultsDashboard />);
    expect((await screen.findByTestId('workflow-results-explorer')).textContent).toBe('no-file');
  });

  it('renders workflow summary, trend toggle, thresholds save, SLA tab, and replay modal', async () => {
    const run = makeTestRun({
      id: 'wf-run',
      timestamp: 1,
      config: {
        ...makeTestRun().config,
        executionMode: 'workflow',
      },
      summary: makeSummary({ errorsByStatus: { '500': 1, '0': 1 } }),
      results: [makeResult({ passed: false, dataRowId: 'row-1' }), makeResult({ passed: true })],
      compressedTrace: undefined,
      executionTrace: undefined,
      hasTrace: false,
    });
    const baseline = makeTestRun({ id: 'baseline', timestamp: 0, results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run, baseline]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline', markedAt: 2 }]);
    resultsGroupingUtilsMocks.hasWorkflowData.mockReturnValue(true);
    slaState.slaTargets = [{ id: 't-1', metric: 'p95', operator: 'lte', value: 1000 }];
    importHandlersState.showReplayModal = true;
    importHandlersState.replayTrace = { trace: 'x' };
    importHandlersState.importedFileName = 'imported.json';

    render(<ResultsDashboard onRerunFailed={vi.fn()} isRerunning />);
    expect(await screen.findByText('workflow-summary')).toBeTruthy();
    expect(screen.getByText('HTTP 500: 1')).toBeTruthy();
    expect(screen.getByText('Network Error: 1')).toBeTruthy();
    expect(screen.getByText('Re-running…')).toBeTruthy();
    expect(screen.getByTestId('workflow-results-explorer').textContent).toContain('imported.json');

    fireEvent.click(screen.getByRole('tab', { name: 'Comparison & Trends (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Trend' }));
    expect(screen.getByTestId('trend-chart')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'mock-save-thresholds' }));
    await waitFor(() => expect(runBaselineMocks.saveRegressionThresholds).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: 'SLA' }));
    expect(screen.getByText('sla-accordion')).toBeTruthy();
  });

  it('shows SLA empty-state when no SLA targets exist', async () => {
    const run = makeTestRun({ id: 'run-sla-empty', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    slaState.slaTargets = [];

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: 'SLA' }));
    expect(screen.getByText('No SLA targets defined for this run.')).toBeTruthy();
  });
  it('refreshes runs when rerun status transitions from true to false', async () => {
    const run = makeTestRun({ id: 'rerun-refresh', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    const view = render(<ResultsDashboard isRerunning />);
    await waitFor(() => {
      expect(storageMocks.loadTestRunsLite).toHaveBeenCalledTimes(1);
    });

    view.rerender(<ResultsDashboard isRerunning={false} />);
    await waitFor(() => {
      expect(storageMocks.loadTestRunsLite).toHaveBeenCalledTimes(2);
    });
  });

  it('reloads runs and baselines on demo-test-runs-changed', async () => {
    const run = makeTestRun({ id: 'demo-a', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);
    await waitFor(() => {
      expect(storageMocks.loadTestRunsLite).toHaveBeenCalledTimes(1);
      expect(runBaselineMocks.loadBaselines).toHaveBeenCalledTimes(1);
    });

    storageMocks.loadTestRunsLite.mockResolvedValue([
      run,
      makeTestRun({ id: 'demo-b', results: [makeResult()] }),
    ]);
    runBaselineMocks.loadBaselines.mockResolvedValue([
      { runId: 'demo-a', markedAt: 1, label: 'Fast baseline' },
      { runId: 'demo-b', markedAt: 2, label: 'Slow baseline' },
    ]);

    window.dispatchEvent(new CustomEvent('demo-test-runs-changed'));

    await waitFor(() => {
      expect(storageMocks.loadTestRunsLite).toHaveBeenCalledTimes(2);
      expect(runBaselineMocks.loadBaselines).toHaveBeenCalledTimes(2);
    });
  });

  it('deleting a baseline-marked selected run also unmarks it', async () => {
    const run = makeTestRun({ id: 'baseline-delete-run', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline-delete-run', markedAt: 1 }]);
    runBaselineMocks.unmarkBaseline.mockResolvedValue([]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(runBaselineMocks.unmarkBaseline).toHaveBeenCalledWith('baseline-delete-run');
    });
  });

  it('invokes import button refs in both empty and populated states', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    storageMocks.loadTestRunsLite.mockResolvedValue([]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);
    const first = render(<ResultsDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /📂 Import Workflow Replay/i }));
    fireEvent.click(screen.getByRole('button', { name: /📥 Import Test Results/i }));
    expect(clickSpy).toHaveBeenCalledTimes(2);

    first.unmount();

    const run = makeTestRun({ id: 'with-run', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /📂 Import Workflow Replay/i }));
    fireEvent.click(screen.getByRole('button', { name: /📥 Import Test Results/i }));
    expect(clickSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    clickSpy.mockRestore();
  });

  it('renders request tab error snippet and opens response modal on click', async () => {
    const run = makeTestRun({ id: 'requests-run', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Request Details' }));

    const snippet = await screen.findByText('boom');
    fireEvent.click(snippet);
    expect(screen.getByTestId('response-detail-modal').textContent).toContain('error-result');
  });

  it('closes response detail modal via onClose callback', async () => {
    const run = makeTestRun({ id: 'requests-run', results: [makeResult()] });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Request Details' }));
    fireEvent.click(await screen.findByText('boom'));

    expect(screen.getByTestId('response-detail-modal').textContent).toContain('error-result');

    fireEvent.click(screen.getByRole('button', { name: 'mock-close-response-modal' }));
    await waitFor(() =>
      expect(screen.getByTestId('response-detail-modal').textContent).not.toContain('error-result'),
    );
  });

  it('closes compare action modal via Cancel button', async () => {
    const run = makeTestRun({
      id: 'selected-run',
      timestamp: 300,
      projectName: 'Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([run]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'selected-run', markedAt: 9 }]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: /Comparison & Trends/i }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-set-compare-target' }));

    expect(await screen.findByText('Choose Comparison Action')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Choose Comparison Action')).toBeNull());
  });

  it('calls onRename callback on BaselineListPanel and updates baselines', async () => {
    const selectedRun = makeTestRun({
      id: 'selected-run',
      timestamp: 300,
      projectName: 'Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    const baselineRun = makeTestRun({
      id: 'baseline-run',
      timestamp: 200,
      projectName: 'Baseline Project',
      summary: makeSummary({ errorsByStatus: {} }),
      results: [makeResult()],
    });
    storageMocks.loadTestRunsLite.mockResolvedValue([selectedRun, baselineRun]);
    runBaselineMocks.loadBaselines.mockResolvedValue([{ runId: 'baseline-run', markedAt: 9 }]);
    runBaselineMocks.renameBaseline.mockResolvedValue([{ runId: 'baseline-run', markedAt: 9, label: 'Renamed' }]);

    render(<ResultsDashboard />);
    fireEvent.click(await screen.findByRole('tab', { name: /Comparison & Trends/i }));

    fireEvent.click(screen.getByRole('button', { name: 'mock-rename-baseline' }));
    await waitFor(() =>
      expect(runBaselineMocks.renameBaseline).toHaveBeenCalledWith('baseline-run', 'Renamed From Panel'),
    );
  });
});