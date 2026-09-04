#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadTestFile, buildScenarios, buildTestConfig } from './loader';
import { loadDataFile } from './dataLoader';
import { parseTagFilter, filterScenariosByRowTags } from './tagFilter';
import { loadWorkflowFile } from './workflowLoader';
import { runTest, type ProgressMeta } from '../src/engine/core/executor';
import { runGraphLoad } from '../src/features/workflow/engine/graphLoadRunner';
import { CircuitBreaker } from '../src/engine/core/circuitBreaker';
import { computeMetrics } from '../src/engine/core/metrics';
import {
  buildJsonReport,
  buildCiJsonReport,
  buildWorkflowCiJsonReport,
  buildJunitXml,
  buildMarkdownReport,
  printConsoleSummary,
  buildDataRowSummary,
  buildWorkflowJunitXml,
  buildWorkflowMarkdownReport,
  printWorkflowConsoleSummary,
  printComparisonSummary,
  buildComparisonMarkdown,
} from './reporters';
import { resolveOutputTarget, stdoutFormatOf } from './outputTarget';
import type { RequestResult, ErrorPolicy } from '../src/shared/types';
import { toErrorMessage } from '../src/shared/utils/helpers';
import {
  loadSlaTargetFile,
  evaluateCliSla,
  printSlaReport,
  overallSlaStatus as slaOverallStatus,
} from './slaEval';
import {
  addCliBaseline,
  findLatestBaseline,
  findBaselineById,
  LATEST_BASELINE_SENTINEL,
  DEFAULT_BASELINES_DIR,
  type CliBaseline,
} from './baselineStorage';
import {
  compareRuns,
  DEFAULT_THRESHOLDS,
} from '../src/features/results/utils/runBaselines';
import type { TestRun } from '../src/shared/types';
import { registerMockCommands } from './mockCommandRegistration';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('redfireforge')
  .description('RedfireForge CLI — run API performance tests from YAML/JSON files')
  .version(pkg.version);

program
  .command('run')
  .description('Execute a test file')
  .argument('<file>', 'Path to a .yaml, .yml, or .json test file')
  .option('-c, --concurrency <n>', 'Number of concurrent requests', parseInt)
  .option('-i, --iterations <n>', 'Number of iterations (how many times each test runs)', parseInt)
  .option('-m, --mode <mode>', 'Execution mode: sequential, batch, pool, load-profile')
  .option('--timeout <sec>', 'Per-request timeout in seconds', parseInt)
  .option('--retries <n>', 'Retry count on failure', parseInt)
  .option('--retry-delay <ms>', 'Delay between retries in milliseconds', parseInt)
  .option('--duration <sec>', 'Duration in seconds (load-profile mode)', parseInt)
  .option('--base-url <url>', 'Override the base URL for all tests')
  .option('--data <file>', 'External data file (CSV or JSON) for parameterized testing')
  .option('--scenario <name>', 'Run only the test matching this name (used with --data)')
  .option('--env <name>', 'Environment name (metadata only)')
  .option('--error-policy <policy>', 'Error policy: continue, stop-first, stop-threshold')
  .option('--max-errors <n>', 'Stop after N errors (threshold mode)', parseInt)
  .option('--max-error-rate <pct>', 'Stop at error rate % (threshold mode)', parseFloat)
  .option('--fail-on-error', 'Exit code 1 if any request fails (HTTP or validation)')
  .option('--fail-threshold <pct>', 'Exit code 1 if error rate exceeds this %', parseFloat)
  .option('-o, --output <path|json|junit>', 'Write JSON report to file, or print `json`/`junit` to stdout for CI')
  .option('--junit <path>', 'Write JUnit XML report to file')
  .option('--markdown <path>', 'Write Markdown report to file')
  .option('--data-rows-summary <path>', 'Write data row summary JSON (CI/CD format)')
  .option('--tags <tags>', 'Run only data rows with these tags (comma-separated)')
  .option('--tag-mode <mode>', 'Tag matching mode: any (default) or all', 'any')
  .option('--scenario-tags <tags>', 'Run only scenarios with these tags (comma-separated)')
  .option('--scenario-tag-mode <mode>', 'Scenario tag matching mode: any (default) or all', 'any')
  .option('--sla-config <path>', 'JSON file of SLA targets to evaluate after the run (SlaTarget[])')
  .option('--fail-on-sla', 'Exit code 4 if any SLA violations are detected (requires --sla-config)')
  .option('--compare-baseline <id>', `Compare run against a saved baseline. Use "latest-baseline" to pick the most recent one automatically, or pass the runId of a specific saved baseline.`)
  .option('--fail-on-regression', 'Exit code 2 (regression only) or 3 (also test failures) when regressions are detected')
  .option('--save-baseline', 'Save this run as a new baseline after completion (only when no failures or regressions)')
  .option('--baseline-label <label>', 'Human-readable label for the saved baseline')
  .option('--baselines-dir <dir>', `Directory for the baseline store (default: ${DEFAULT_BASELINES_DIR})`)
  .option('--comparison-report <path>', 'Write the Markdown comparison report to a file')
  .option('-q, --quiet', 'Suppress progress output')
  .action(async (filePath: string, opts) => {
    try {
      const outputTarget = resolveOutputTarget(opts.output as string | undefined);
      const stdoutFormat = stdoutFormatOf(outputTarget);
      // A stdout report owns the stream, so nothing else may be written to it.
      const quiet = Boolean(opts.quiet) || stdoutFormat !== null;

      const absPath = resolve(filePath);
      const file = loadTestFile(absPath);

      // Load external data file if specified
      let externalDataSource;
      if (opts.data) {
        const dataPath = resolve(opts.data);
        externalDataSource = loadDataFile(dataPath);
        if (!quiet) {
          console.log(`  Data:    ${basename(dataPath)} (${externalDataSource.rows.length} rows)`);
        }
      }

      // Filter to specific scenario if requested
      if (opts.scenario) {
        file.tests = file.tests.filter(t => t.name === opts.scenario);
        if (file.tests.length === 0) {
          throw new Error(`No test found matching --scenario "${opts.scenario}"`);
        }
      }

      if (!quiet) {
        console.log(`\n  Loading: ${basename(absPath)}`);
        console.log(`  Tests:   ${file.tests.length}`);
        if (file.name) console.log(`  Suite:   ${file.name}`);
      }

      let scenarios = buildScenarios(file, opts.baseUrl, externalDataSource);

      // ─── Scenario-level tag filtering ──────────────────
      if (opts.scenarioTags) {
        const filterTags = (opts.scenarioTags as string)
          .split(',')
          .map((t: string) => t.trim().toLowerCase())
          .filter(Boolean);
        const tagMode = (opts.scenarioTagMode === 'all' ? 'all' : 'any') as 'any' | 'all';
        const before = scenarios.length;
        scenarios = scenarios.filter(sc => {
          const scTags = sc.scenarioTags ?? [];
          if (scTags.length === 0) return false;
          return tagMode === 'any'
            ? filterTags.some(t => scTags.includes(t))
            : filterTags.every(t => scTags.includes(t));
        });
        if (!quiet) {
          console.log(`  Scenario tags: ${filterTags.join(', ')} (mode: ${tagMode}, ${scenarios.length}/${before} scenarios matched)`);
        }
        if (scenarios.length === 0) {
          console.error('\n  ❌ No scenarios match the specified tags.\n');
          process.exit(1);
        }
      }

      // ─── Data row tag filtering ──────────────────────
      if (opts.tags) {
        const filterTags = parseTagFilter(opts.tags as string);
        const tagMode = (opts.tagMode === 'all' ? 'all' : 'any') as 'any' | 'all';
        const before = scenarios.length;
        const result = filterScenariosByRowTags(scenarios, filterTags, tagMode);
        scenarios = result.scenarios;
        if (!quiet) {
          console.log(`  Tags:    ${filterTags.join(', ')} (mode: ${tagMode}, ${result.matchingRowCount} matching rows, ${scenarios.length}/${before} scenarios retained)`);
          if (result.droppedScenarioNames.length > 0) {
            console.log(`  Dropped: ${result.droppedScenarioNames.join(', ')} (no rows matched the tag filter)`);
          }
        }
        if (scenarios.length === 0) {
          console.error('\n  ❌ No data rows match the specified tags.\n');
          process.exit(1);
        }
      }

      const config = buildTestConfig(file, scenarios, {
        concurrency: opts.concurrency,
        transactions: opts.iterations,
        mode: opts.mode,
        timeout: opts.timeout,
        retries: opts.retries,
        retryDelay: opts.retryDelay,
        duration: opts.duration,
        errorPolicy: opts.errorPolicy,
        maxErrors: opts.maxErrors,
        maxErrorRate: opts.maxErrorRate,
      });

      if (!quiet) {
        console.log(`  Mode:    ${config.executionMode} (C:${config.concurrency} I:${config.iterations})`);
        const paramTests = scenarios.filter(s => s.dataSource && s.dataSource.rows.length > 0);
        if (paramTests.length > 0) {
          const totalRows = paramTests.reduce((n, s) => n + (s.dataSource?.rows.length ?? 0), 0);
          console.log(`  Data:    ${totalRows} row${totalRows !== 1 ? 's' : ''} across ${paramTests.length} test${paramTests.length !== 1 ? 's' : ''}`);
        }
        console.log('');
      }

      const abortController = new AbortController();
      process.on('SIGINT', () => {
        if (!quiet) console.log('\n  Aborting...');
        abortController.abort();
      });

      let lastPrinted = 0;
      const onProgress = (completed: number, total: number, _results: RequestResult[], meta?: ProgressMeta) => {
        if (quiet) return;
        const now = Date.now();
        if (now - lastPrinted < 500 && completed < total) return;
        lastPrinted = now;
        if (meta) {
          const elSec = (meta.elapsedMs / 1000).toFixed(1);
          const rps = meta.elapsedMs > 0 ? Math.round(completed / (meta.elapsedMs / 1000)) : 0;
          process.stdout.write(`\r  Progress: ${completed} reqs | ${elSec}s | ${rps} RPS | concurrency: ${meta.currentInFlight}/${meta.targetConcurrency}`);
        } else {
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          process.stdout.write(`\r  Progress: ${completed}/${total} (${pct}%)`);
        }
      };

      const t0 = performance.now();
      const { results } = await runTest(config, scenarios, onProgress, abortController.signal);
      const elapsed = performance.now() - t0;
      const summary = computeMetrics(results, elapsed);

      if (!quiet) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
      }

      if (!stdoutFormat) {
        printConsoleSummary(summary, config, results);
      }

      const suiteName = file.name || basename(absPath, '.yaml').replace(/\.yml$|\.json$/, '');
      const meta = { name: file.name, env: opts.env || file.env, file: basename(absPath) };

      // Load SLA targets early so they can be embedded in the JSON report
      const slaTargets = opts.slaConfig
        ? loadSlaTargetFile(resolve(opts.slaConfig as string))
        : undefined;

      if (slaTargets) {
        config.slaTargets = slaTargets;
      }

      if (stdoutFormat === 'json') {
        process.stdout.write(JSON.stringify(buildCiJsonReport(results, elapsed), null, 2) + '\n');
      } else if (stdoutFormat === 'junit') {
        process.stdout.write(buildJunitXml(results, summary, suiteName) + '\n');
      } else if (outputTarget?.kind === 'file') {
        const report = buildJsonReport(results, summary, config, meta);
        writeFileSync(resolve(outputTarget.path), JSON.stringify(report, null, 2));
        console.log(`  JSON report: ${outputTarget.path}`);
      }

      if (opts.junit) {
        const xml = buildJunitXml(results, summary, suiteName);
        writeFileSync(resolve(opts.junit), xml);
        if (!quiet) console.log(`  JUnit XML:   ${opts.junit}`);
      }

      if (opts.markdown) {
        const md = buildMarkdownReport(summary, config, meta, results);
        writeFileSync(resolve(opts.markdown), md);
        if (!quiet) console.log(`  Markdown:    ${opts.markdown}`);
      }

      if (opts.dataRowsSummary) {
        const rowSummary = buildDataRowSummary(results);
        writeFileSync(resolve(opts.dataRowsSummary), JSON.stringify(rowSummary, null, 2));
        if (!quiet) console.log(`  Data Rows:   ${opts.dataRowsSummary}`);
      }

      // SLA evaluation (SLA-E3)
      let hasSlaFail = false;
      if (slaTargets) {
        const checks = evaluateCliSla(summary, results, slaTargets);
        hasSlaFail = !!(opts.failOnSla && slaOverallStatus(checks) === 'fail');
        // Always surface the report when it's about to cause a non-zero exit —
        // not gated on `-q`, since without it a quiet CI log shows only exit code 4
        // with no indication of which SLA target actually failed (NOTE-3).
        // Normally the report is forced on when it causes a non-zero exit, so a
        // quiet CI log is not just a bare exit code 4. A stdout report overrides
        // that: it writes to the same stream and must stay machine-parseable.
        printSlaReport(checks, stdoutFormat !== null || (quiet && !hasSlaFail));
      }

      // ── Baseline comparison ────────────────────────────────────────────────
      let hasRegression = false;

      if (opts.compareBaseline) {
        const baselinesDir: string = opts.baselinesDir ?? DEFAULT_BASELINES_DIR;
        const sentinel: string = opts.compareBaseline;

        // Resolve the baseline entry
        let baselineEntry: CliBaseline | null = null;
        if (sentinel === LATEST_BASELINE_SENTINEL) {
          baselineEntry = findLatestBaseline(absPath, baselinesDir);
          if (!baselineEntry && !quiet) {
            console.warn(`  ⚠  No baselines found for ${basename(absPath)} — skipping regression check`);
          }
        } else {
          // Look up by runId in the baseline store
          baselineEntry = findBaselineById(sentinel, baselinesDir);
          if (!baselineEntry && !quiet) {
            console.warn(`  ⚠  Baseline not found: "${sentinel}" — skipping regression check`);
          }
        }

        if (baselineEntry) {
          // Reconstruct a minimal TestRun from stored summary for metric comparison
          const baselineRun: TestRun = {
            id: baselineEntry.runId,
            timestamp: baselineEntry.savedAt,
            config: {
              scenarios: [],
              concurrency: 1,
              iterations: 1,
              executionMode: 'pool' as const,
            } as TestRun['config'],
            summary: baselineEntry.summary,
            results: [],
          };

          const currentRun: TestRun = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            config: config as TestRun['config'],
            summary,
            results,
          };

          const comparison = compareRuns(baselineRun, currentRun, DEFAULT_THRESHOLDS);

          printComparisonSummary(comparison, {
            quiet,
            baselineLabel: baselineEntry.label,
          });

          if (opts.comparisonReport) {
            const md = buildComparisonMarkdown(comparison, baselineEntry.label);
            writeFileSync(resolve(opts.comparisonReport as string), md);
            if (!quiet) {
              console.log(`  Comparison:  ${opts.comparisonReport}`);
            }
          }

          hasRegression = comparison.regressions.length > 0;
        }
      }

      // ── Save baseline ──────────────────────────────────────────────────────
      const failedRequests = summary.failedRequests > 0 || summary.failedValidations > 0;
      const overThreshold = opts.failThreshold != null && summary.errorRate > opts.failThreshold;
      const testFail = (opts.failOnError && failedRequests) || overThreshold;

      // Save baseline only when the run is clean (no failures, no regressions).
      // Check actual failures and error-rate threshold unconditionally — not gated
      // on --fail-on-error — because we never want a dirty run stored as a baseline.
      if (opts.saveBaseline && !failedRequests && !overThreshold && !hasRegression) {
        const baselinesDir: string = opts.baselinesDir ?? DEFAULT_BASELINES_DIR;
        const entry: CliBaseline = {
          runId: crypto.randomUUID(),
          label: opts.baselineLabel as string | undefined,
          savedAt: Date.now(),
          projectPath: absPath,
          summary,
        };
        addCliBaseline(entry, baselinesDir);
        if (!quiet) {
          console.log(`  Baseline saved${entry.label ? ` (${entry.label})` : ''}: ${entry.runId}`);
        }
      }

      // ── Exit code (priority: SLA=4 > both=3 > regression=2 > failure=1) ───
      if (hasSlaFail) {
        process.exit(4);
      }
      if (opts.failOnRegression && hasRegression) {
        process.exit(testFail ? 3 : 2);
      }
      if (testFail) {
        // Always surface why the run is about to exit non-zero — not gated on `-q`,
        // since without this line a quiet CI log shows only a bare exit code.
        // A stdout report is the exception: it must stay machine-parseable.
        if (overThreshold && !stdoutFormat) {
          console.log(`  Error rate ${summary.errorRate}% exceeds threshold ${opts.failThreshold}%`);
        }
        process.exit(1);
      }

      process.exit(0);
    } catch (err) {
      console.error(`\n  Error: ${toErrorMessage(err)}`);
      process.exit(1);
    }
  });

// ── Workflow run command ─────────────────────────────────────
program
  .command('workflow')
  .description('Execute a workflow file as a performance test')
  .argument('<file>', 'Path to a workflow .yaml, .yml, or .json file')
  .option('-i, --iterations <n>', 'Total number of workflow iterations', (v) => parseInt(v, 10))
  .option('-c, --concurrency <n>', 'Number of concurrent iterations', (v) => parseInt(v, 10))
  .option('--var <vars...>', 'Set workflow variables (format: name=value)')
  .option('--timeout <sec>', 'Per-request timeout in seconds', (v) => parseInt(v, 10))
  .option('--error-policy <policy>', 'Error policy: continue, stop-first, stop-threshold')
  .option('--max-errors <n>', 'Stop after N errors (threshold mode)', (v) => parseInt(v, 10))
  .option('--max-error-rate <pct>', 'Stop at error rate % (threshold mode)', (v) => parseFloat(v))
  .option('--base-url <url>', 'Base URL for HTTP nodes with relative paths')
  .option('--trace-level <level>', 'Trace capture level: minimal, standard, full, debug (default: standard)')
  .option('--trace-output <path>', 'Write the full execution trace (per-node/per-iteration) as JSON to file')
  .option('--fail-on-error', 'Exit code 1 if any request fails')
  .option('--fail-threshold <pct>', 'Exit code 1 if error rate exceeds this %', (v) => parseFloat(v))
  .option('-o, --output <path|json|junit>', 'Write JSON report to file, or print `json`/`junit` to stdout for CI')
  .option('--junit <path>', 'Write JUnit XML report to file')
  .option('--markdown <path>', 'Write Markdown report to file')
  .option('-q, --quiet', 'Suppress progress output')
  .action(async (filePath: string, opts) => {
    try {
      const outputTarget = resolveOutputTarget(opts.output as string | undefined);
      const stdoutFormat = stdoutFormatOf(outputTarget);
      // A stdout report owns the stream, so nothing else may be written to it.
      const quiet = Boolean(opts.quiet) || stdoutFormat !== null;

      const absPath = resolve(filePath);
      if (!existsSync(absPath)) {
        throw new Error(`Workflow file not found: ${absPath}`);
      }

      const workflow = loadWorkflowFile(absPath);

      if (!quiet) {
        console.log(`\n  Loading: ${basename(absPath)}`);
        console.log(`  Workflow: ${workflow.name}`);
        const httpNodes = workflow.nodes.filter(n => n.type === 'http');
        console.log(`  Steps:    ${httpNodes.length} HTTP nodes`);
      }

      // Parse --var options
      const variables: Record<string, string> = { ...workflow.variables };
      if (opts.var) {
        for (const v of opts.var as string[]) {
          const idx = v.indexOf('=');
          if (idx === -1) {
            throw new Error(`Invalid --var format: "${v}". Expected name=value`);
          }
          const name = v.slice(0, idx);
          const value = v.slice(idx + 1);
          variables[name] = value;
        }
      }

      if (!quiet && Object.keys(variables).length > 0) {
        console.log(`  Variables: ${Object.keys(variables).length}`);
        for (const [k, v] of Object.entries(variables)) {
          const display = v.length > 40 ? v.slice(0, 37) + '...' : v;
          console.log(`    ${k}=${display}`);
        }
      }

      const iterations = opts.iterations ?? 10;
      const concurrency = opts.concurrency ?? 1;

      if (!quiet) {
        console.log(`  Mode:    workflow (I:${iterations} C:${concurrency})`);
        console.log('');
      }

      const abortController = new AbortController();
      process.on('SIGINT', () => {
        if (!quiet) console.log('\n  Aborting...');
        abortController.abort();
      });

      const breaker = new CircuitBreaker({
        policy: (opts.errorPolicy ?? 'continue') as ErrorPolicy,
        maxErrors: opts.maxErrors ?? 10,
        maxErrorRate: opts.maxErrorRate ?? 50,
      });

      let lastPrinted = 0;
      const onProgress = (completed: number, total: number, _results: RequestResult[], _meta?: ProgressMeta) => {
        if (quiet) return;
        const now = Date.now();
        if (now - lastPrinted < 500 && completed < total) return;
        lastPrinted = now;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        process.stdout.write(`\r  Progress: ${completed}/${total} iterations (${pct}%)`);
      };

      const baseUrl = opts.baseUrl?.trim();
      if (!quiet && baseUrl) {
        console.log(`  Base URL: ${baseUrl}`);
      }

      const t0 = performance.now();
      // Resolve trace level from CLI option
      const validTraceLevels = ['minimal', 'standard', 'full', 'debug'] as const;
      const cliTraceLevel = opts.traceLevel as string | undefined;
      if (cliTraceLevel && !validTraceLevels.includes(cliTraceLevel as typeof validTraceLevels[number])) {
        throw new Error(`Invalid --trace-level "${cliTraceLevel}". Valid options: ${validTraceLevels.join(', ')}`);
      }
      const traceLevel = (cliTraceLevel as typeof validTraceLevels[number]) ?? 'standard';

      const { results, trace } = await runGraphLoad(workflow, {
        iterations,
        concurrency,
        initialVariables: variables,
        breaker,
        abortSignal: abortController.signal,
        onProgress,
        environmentLayer: baseUrl ? { baseUrl } : undefined,
        traceOptions: {
          captureFullTrace: traceLevel === 'full' || traceLevel === 'debug',
          traceLevel,
        },
      });
      const elapsed = performance.now() - t0;
      const summary = computeMetrics(results, elapsed);

      if (!quiet) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
      }

      if (!stdoutFormat) {
        printWorkflowConsoleSummary(summary, workflow, iterations, concurrency, results);
      }

      const meta = { name: workflow.name, file: basename(absPath) };

      if (stdoutFormat === 'json') {
        process.stdout.write(JSON.stringify(buildWorkflowCiJsonReport(results, iterations, elapsed), null, 2) + '\n');
      } else if (stdoutFormat === 'junit') {
        process.stdout.write(buildWorkflowJunitXml(results, summary, workflow.name, iterations) + '\n');
      } else if (outputTarget?.kind === 'file') {
        const report = buildJsonReport(results, summary, {
          concurrency,
          iterations,
          executionMode: 'workflow',
          workflowId: workflow.id,
          workflowName: workflow.name,
          scenarioWeights: [],
          timeoutSec: opts.timeout ?? 30,
          retryCount: 0,
          retryDelayMs: 0,
          errorPolicy: opts.errorPolicy ?? 'continue',
          maxErrors: opts.maxErrors ?? 10,
          maxErrorRate: opts.maxErrorRate ?? 50,
        }, meta);
        writeFileSync(resolve(outputTarget.path), JSON.stringify(report, null, 2));
        console.log(`  JSON report: ${outputTarget.path}`);
      }

      if (opts.junit) {
        const xml = buildWorkflowJunitXml(results, summary, workflow.name, iterations);
        writeFileSync(resolve(opts.junit), xml);
        if (!quiet) console.log(`  JUnit XML:   ${opts.junit}`);
      }

      if (opts.markdown) {
        const md = buildWorkflowMarkdownReport(summary, workflow, iterations, concurrency, results);
        writeFileSync(resolve(opts.markdown), md);
        if (!quiet) console.log(`  Markdown:    ${opts.markdown}`);
      }

      if (opts.traceOutput) {
        writeFileSync(resolve(opts.traceOutput), JSON.stringify(trace, null, 2));
        if (!quiet) console.log(`  Trace:       ${opts.traceOutput}`);
      }

      // Exit code logic
      const passed = summary.failedRequests === 0 && summary.failedValidations === 0;
      if (opts.failOnError && !passed) {
        process.exit(1);
      }
      if (opts.failThreshold != null && summary.errorRate > opts.failThreshold) {
        // Always surface why the run is about to exit non-zero — not gated on `-q`,
        // since without this line a quiet CI log shows only a bare exit code.
        // A stdout report is the exception: it must stay machine-parseable.
        if (!stdoutFormat) {
          console.log(`  Error rate ${summary.errorRate}% exceeds threshold ${opts.failThreshold}%`);
        }
        process.exit(1);
      }

      process.exit(0);
    } catch (err) {
      console.error(`\n  Error: ${toErrorMessage(err)}`);
      process.exit(2);
    }
  });

program
  .command('validate')
  .description('Validate a test file without running it')
  .argument('<file>', 'Path to a .yaml, .yml, or .json test file')
  .action((filePath: string) => {
    try {
      const absPath = resolve(filePath);
      const file = loadTestFile(absPath);
      const scenarios = buildScenarios(file);
      console.log(`\n  ✅ Valid test file: ${basename(absPath)}`);
      console.log(`  Tests: ${scenarios.length}`);
      for (const s of scenarios) {
        const dataSuffix = s.dataSource
          ? ` [${s.dataSource.rows.length} data rows]`
          : '';
        const tagSuffix = s.scenarioTags?.length
          ? `  [tags: ${s.scenarioTags.join(', ')}]`
          : '';
        console.log(`    - ${s.method} ${s.url}  (${s.name})${dataSuffix}${tagSuffix}`);
      }
      console.log('');
      process.exit(0);
    } catch (err) {
      console.error(`\n  ❌ Invalid: ${toErrorMessage(err)}`);
      process.exit(2);
    }
  });

// ── Workflow validate command ────────────────────────────────
program
  .command('validate-workflow')
  .description('Validate a workflow file without running it')
  .argument('<file>', 'Path to a workflow .yaml, .yml, or .json file')
  .action((filePath: string) => {
    try {
      const absPath = resolve(filePath);
      const workflow = loadWorkflowFile(absPath);
      const httpNodes = workflow.nodes.filter(n => n.type === 'http');
      console.log(`\n  ✅ Valid workflow: ${basename(absPath)}`);
      console.log(`  Name: ${workflow.name}`);
      console.log(`  Nodes: ${workflow.nodes.length} total, ${httpNodes.length} HTTP`);
      console.log(`  Edges: ${workflow.edges.length}`);
      if (Object.keys(workflow.variables).length > 0) {
        console.log(`  Variables: ${Object.keys(workflow.variables).join(', ')}`);
      }
      console.log('');
      process.exit(0);
    } catch (err) {
      console.error(`\n  ❌ Invalid: ${toErrorMessage(err)}`);
      process.exit(2);
    }
  });

registerMockCommands(program);

program.parse();
