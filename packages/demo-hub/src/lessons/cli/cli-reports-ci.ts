/**
 * CLI-6 — Reports & CI/CD Integration
 *
 * Terminal-surface lesson (DemoTerminal), continuing the same pane from CLI-1 through CLI-5.
 * All captured output below was actually run against the repo (`examples/cli-basic-test.yaml`
 * against the real JSONPlaceholder API), not invented — see docs/future/cli/cli-demo-plan.md.
 * The GitHub Actions job in step 5 is the real, current content of
 * docs/guides/cli-ci-cd.md's "Basic Test Job (Using npm Package)" section.
 */
import type { DemoLesson } from '../../types';

export const cliReportsCiLesson: DemoLesson = {
  id: 'cli-reports-ci',
  domainId: 'cli',
  category: 'data-and-ci',
  name: 'Reports & CI/CD Integration',
  description:
    'Every report format the CLI can emit (JSON to a file or straight to stdout, ' +
    'JUnit, Markdown), quiet mode for log-limited CI runners, and wiring it into a ' +
    'real GitHub Actions job.',
  estimatedMinutes: 8,
  desktopOnly: false,

  concept: {
    title: 'Reports & CI/CD Integration',
    body:
      'The console summary is for a human watching a terminal. Every other format ' +
      'targets a different consumer: JSON for scripts/dashboards that need the full ' +
      'per-request detail, JUnit XML for CI systems with built-in test-report UIs, ' +
      'Markdown for a PR comment a teammate will actually read. All three come from ' +
      'the exact same run — pick as many as you need, they\'re not mutually exclusive.',
    keyTerms: [
      { term: '-o / --output <path>', definition: 'Full JSON report — config + summary + every per-request result.' },
      { term: '-o / --output json', definition: 'A flat, CI-shaped JSON summary printed straight to stdout — pipe it into jq, no temp file.' },
      { term: '--junit', definition: '<testsuites>/<testsuite>/<testcase> XML most CI dashboards already know how to render.' },
      { term: '--markdown', definition: 'A ready-to-paste PR comment — title, metrics table, timing breakdown, pass/fail banner.' },
    ],
    diagram: `<svg viewBox="0 0 440 180" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="cli6-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--primary)"/>
    </marker>
  </defs>
  <!-- one test run -->
  <rect x="145" y="14" width="150" height="40" rx="6" fill="var(--text-muted)" opacity="0.12" stroke="var(--text-muted)" stroke-width="1.5"/>
  <text x="220" y="38" text-anchor="middle" fill="var(--text)" font-size="11" font-family="system-ui" font-weight="600">one test run</text>
  <!-- fan-out arrows -->
  <line x1="180" y1="54" x2="90" y2="86" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#cli6-arrow)"/>
  <line x1="220" y1="54" x2="220" y2="86" stroke="var(--primary)" stroke-width="1.5" marker-end="url(#cli6-arrow)"/>
  <line x1="260" y1="54" x2="350" y2="86" stroke="var(--success)" stroke-width="1.5" marker-end="url(#cli6-arrow)"/>
  <!-- JSON -->
  <rect x="10" y="88" width="130" height="56" rx="6" fill="var(--accent)" opacity="0.15" stroke="var(--accent)" stroke-width="1.5"/>
  <text x="75" y="110" text-anchor="middle" fill="var(--text)" font-size="11" font-family="system-ui" font-weight="600">-o (JSON)</text>
  <text x="75" y="126" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">scripts / dashboards</text>
  <text x="75" y="140" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">full per-request detail</text>
  <!-- JUnit -->
  <rect x="155" y="88" width="130" height="56" rx="6" fill="var(--primary)" opacity="0.15" stroke="var(--primary)" stroke-width="1.5"/>
  <text x="220" y="110" text-anchor="middle" fill="var(--text)" font-size="11" font-family="system-ui" font-weight="600">--junit (XML)</text>
  <text x="220" y="126" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">CI dashboard UIs</text>
  <text x="220" y="140" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">zero custom parsing</text>
  <!-- Markdown -->
  <rect x="300" y="88" width="130" height="56" rx="6" fill="var(--success)" opacity="0.15" stroke="var(--success)" stroke-width="1.5"/>
  <text x="365" y="110" text-anchor="middle" fill="var(--text)" font-size="11" font-family="system-ui" font-weight="600">--markdown (.md)</text>
  <text x="365" y="126" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">PR comment, human read</text>
  <text x="365" y="140" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">pass/fail banner</text>
  <text x="220" y="168" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">additive — one run can emit all three at once</text>
</svg>`,
  },

  steps: [
    // ── Step 1: -o/--output — The Full JSON Report ──────────────────────
    {
      id: 'cli6-json-report',
      title: '-o/--output — The Full JSON Report',
      description:
        'The JSON report is the most complete format — run config, aggregate summary, and one entry per individual request with status, timing breakdown, response body, and headers.\n\n' +
        'If you\'re scripting on top of RedfireForge (a custom dashboard, a diffing tool, a PR bot), this is the format to parse.\n\n' +
        '**Flags used:**\n' +
        '- `-o results.json` — write the full JSON report to a file\n' +
        '- `-q` — quiet: suppress the per-request console lines, keep only the summary',
      terminalCommand: 'redfireforge run examples/cli-basic-test.yaml -o results.json -q',
      terminalOutput:
        '  JSON report: results.json\n' +
        '{\n' +
        '  "id": "...", "timestamp": 1755571200000, "config": { "...": "..." },\n' +
        '  "summary": { "tps": 20.3, "avgResponseTime": 49.06, "p50ResponseTime": 37.24, "p95ResponseTime": 141.37, "errorRate": 0, "totalRequests": 9, "successfulRequests": 9, "failedRequests": 0 },\n' +
        '  "results": [\n' +
        '    {\n' +
        '      "id": "r-1",\n' +
        '      "scenarioName": "Get Single User",\n' +
        '      "url": "https://jsonplaceholder.typicode.com/users/1",\n' +
        '      "method": "GET",\n' +
        '      "httpStatus": 200,\n' +
        '      "responseTimeMs": 141.37,\n' +
        '      "passed": true,\n' +
        '      "validationMode": "none",\n' +
        '      "timing": { "dnsLookup": 0, "tcpConnect": 0, "tlsHandshake": 0, "ttfb": 102.81, "download": 1.83, "total": 104.64 },\n' +
        '      "scenarioTags": ["smoke", "critical"]\n' +
        '    }\n' +
        '  ],\n' +
        '  "envName": "demo", "projectName": "CLI Basic Test"\n' +
        '}',
      // 2 beats: the report-written line, then the summary block.
      terminalHighlightLines: [[1, 1], [4, 4]],
      pauseAfter: true,
    },

    // ── Step 2: --output json — Straight to stdout for CI ─────────────
    {
      id: 'cli6-json-stdout',
      title: '--output json — Straight to stdout',
      description:
        'The full report above is rich, but a pipeline usually just wants "how many passed, and what broke?" — and it wants it without writing a temp file first.\n\n' +
        'Passing the **keyword** `json` instead of a path prints a flat, CI-shaped summary directly to stdout. Every other line — the header, the console summary, even the SLA and baseline reports — is suppressed, so the stream is safe to pipe straight into `jq`. Errors still go to stderr.\n\n' +
        'Exit codes are untouched, so `--fail-on-error` still fails the build.\n\n' +
        '**Flags used:**\n' +
        '- `--output json` — print the CI report to stdout (a **format**, not a filename)\n' +
        '- `--fail-on-error` — still exits `1` when anything failed',
      terminalCommand: 'redfireforge run examples/cli-error-handling.yaml --output json --fail-on-error; echo "exit: $?"',
      terminalOutput:
        '{\n' +
        '  "passed": 20,\n' +
        '  "failed": 5,\n' +
        '  "total": 25,\n' +
        '  "durationMs": 1107,\n' +
        '  "results": [\n' +
        '    {\n' +
        '      "name": "Valid Request 2 (Success)",\n' +
        '      "status": "pass",\n' +
        '      "durationMs": 216,\n' +
        '      "error": null\n' +
        '    },\n' +
        '    {\n' +
        '      "name": "Non-Existent Resource (404)",\n' +
        '      "status": "fail",\n' +
        '      "durationMs": 32,\n' +
        '      "error": "HTTP 404: {}"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        'exit: 1',
      // 3 beats: the pass/fail counts, the failing entry, then the preserved exit code.
      terminalHighlightLines: [[2, 4], [13, 18], [21, 21]],
      pauseAfter: true,
    },

    // ── Step 3: Piping it somewhere useful ─────────────────────────
    {
      id: 'cli6-json-pipe',
      title: 'Piping stdout JSON Into a Gate',
      description:
        'Because stdout is pure JSON, standard shell tooling just works — no parsing of human-readable text, no temp files to clean up.\n\n' +
        'This is the difference between `--output json` and `-o results.json`: the first is a **stream**, the second is an **artifact**. Use the stream for gating and summaries; use the artifact when you need the full per-request detail later.\n\n' +
        '`--output json` works the same way on `workflow` and `mock simulate`. For `workflow`, one result is emitted per **iteration**, matching `--output junit`, with the individual steps kept under a `steps` array.',
      terminalCommand: 'redfireforge run examples/cli-basic-test.yaml --output json | jq -r "\\(.passed)/\\(.total) passed in \\(.durationMs)ms"',
      terminalOutput:
        '9/9 passed in 540ms\n' +
        '\n' +
        '# a workflow iteration keeps its steps nested:\n' +
        '$ redfireforge workflow checkout.yaml -i 4 --output json | jq ".results[0]"\n' +
        '{\n' +
        '  "name": "Iteration 1",\n' +
        '  "status": "fail",\n' +
        '  "durationMs": 56,\n' +
        '  "error": "Create Order: (http): expected 2xx, got HTTP 500",\n' +
        '  "steps": [\n' +
        '    { "name": "Login", "status": "pass", "durationMs": 54, "error": null },\n' +
        '    { "name": "Create Order", "status": "fail", "durationMs": 2, "error": "(http): expected 2xx, got HTTP 500" }\n' +
        '  ]\n' +
        '}',
      terminalHighlightLines: [[1, 1], [10, 13]],
      pauseAfter: true,
    },

    // ── Step 2: --junit — JUnit XML for CI Dashboards ────────────────────
    {
      id: 'cli6-junit',
      title: '--junit — JUnit XML for CI Dashboards',
      description:
        'JUnit XML is the lingua franca of CI test reporting — GitHub Actions, Jenkins, GitLab CI, and most dashboard tools render it natively with zero custom parsing.\n\n' +
        'One `<testcase>` per request; tags are carried through as an attribute so a dashboard can filter by them too.\n\n' +
        '**Flags used:**\n' +
        '- `--junit results.xml` — write a JUnit XML report\n' +
        '- `-q` — quiet summary only\n' +
        '- `&& cat results.xml` — print the file contents after the run so you can see what was written',
      terminalCommand: 'redfireforge run examples/cli-basic-test.yaml --junit results.xml -q && cat results.xml',
      terminalOutput:
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<testsuites name="CLI Basic Test" tests="9" failures="0" time="0.422">\n' +
        '  <testsuite name="CLI Basic Test" tests="9" failures="0" time="0.422">\n' +
        '    <testcase classname="RedfireForge" name="Get Single User [GET https://jsonplaceholder.typicode.com/users/1]" time="0.149" tags="smoke,critical">\n' +
        '    </testcase>\n' +
        '    <testcase classname="RedfireForge" name="List Users [GET https://jsonplaceholder.typicode.com/users]" time="0.035" tags="smoke,regression">\n' +
        '    </testcase>\n' +
        '    <testcase classname="RedfireForge" name="List Posts [GET https://jsonplaceholder.typicode.com/posts]" time="0.035" tags="regression">\n' +
        '    </testcase>\n' +
        '  </testsuite>\n' +
        '</testsuites>',
      // Highlight the testsuites summary line and a sample testcase with tags.
      terminalHighlightLines: [[2, 2], [4, 5]],
      pauseAfter: true,
    },

    // ── Step 3: --markdown — A Ready-to-Paste PR Comment ─────────────────
    {
      id: 'cli6-markdown',
      title: '--markdown — A Ready-to-Paste PR Comment',
      description:
        'Same run, formatted for a human reading a pull request: a title, a metrics table, the timing breakdown, and a pass/fail banner.\n\n' +
        'Post this as a PR comment in a CI step and reviewers get the full performance picture without opening a separate dashboard.\n\n' +
        '**Flags used:**\n' +
        '- `--markdown results.md` — write a Markdown summary report\n' +
        '- `-q` — quiet summary only\n' +
        '- `&& cat results.md` — print the file so you can see the rendered output',
      terminalCommand: 'redfireforge run examples/cli-basic-test.yaml --markdown results.md -q && cat results.md',
      terminalOutput:
        '# CLI Basic Test\n' +
        '\n' +
        '**Environment:** demo\n' +
        '**Mode:** batch | Concurrency: 1 | Iterations: 3\n' +
        '\n' +
        '## Summary\n' +
        '\n' +
        '| Metric | Value |\n' +
        '|---|---|\n' +
        '| **TPS** | 20.86 |\n' +
        '| **Avg Response** | 47.73 ms |\n' +
        '| **P50** | 37.2 ms |\n' +
        '| **Error Rate** | 0% |\n' +
        '| **Total Requests** | 9 |\n' +
        '| **Tags** | critical, regression, smoke |\n' +
        '\n' +
        '## Timing Breakdown (avg)\n' +
        '\n' +
        '| Phase | Avg (ms) |\n' +
        '|---|---|\n' +
        '| **TTFB** | 44.4 |\n' +
        '| **Download** | 0.79 |\n' +
        '\n' +
        '## Result: PASSED ✅',
      // 2 beats: the Mode/Concurrency line (NOTE-2 fix), then the pass/fail banner.
      terminalHighlightLines: [[4, 4], [24, 24]],
      pauseAfter: true,
    },

    // ── Step 4: -q — Quiet Mode for Log-Limited CI Runners ───────────────
    {
      id: 'cli6-quiet',
      title: '-q — Quiet Mode for Log-Limited CI Runners',
      description:
        'Compare the same run with and without `-q`.\n\n' +
        'Without it, the CLI prints a header block (file name, test count, suite name, mode) before any request fires — useful locally so you can confirm what\'s about to run. In a CI log that already shows the command, it\'s just noise.\n\n' +
        'With `-q`, only the final summary survives — plus any threshold-exceeded explanation lines, which always print regardless of quiet mode.\n\n' +
        '**Flags used:**\n' +
        '- *(no flag)* — full output including the pre-run header\n' +
        '- `-q` — skip the header; print only the summary block',
      terminalCommand:
        'redfireforge run examples/cli-basic-test.yaml\n' +
        '$ redfireforge run examples/cli-basic-test.yaml -q',
      terminalOutput:
        '  Loading: cli-basic-test.yaml\n' +
        '  Tests:   3\n' +
        '  Suite:   CLI Basic Test\n' +
        '  Mode:    batch (C:1 I:3)\n' +
        '  ... (full summary block follows)\n' +
        '\n' +
        '# with -q — none of the above header prints, straight to the summary:\n' +
        '  Result:       PASSED ✅',
      terminalHighlightLines: [[1, 4]],
      pauseAfter: true,
    },

    // ── Step 5: A Real CI Job ─────────────────────────────────────────────
    {
      id: 'cli6-github-actions',
      title: 'A Real CI Job',
      description:
        'All the concepts wired into a real GitHub Actions job. Three things to notice:\n\n' +
        '1. The `run` step uses `--junit`, `--fail-on-error`, and `-q` together — machine-readable output, CI gating, and clean logs\n' +
        '2. Both the upload and publish steps use `if: always()` — a failing run still gets its report published. A green run needs no report; a red run needs the detail.\n' +
        '3. `mikepenz/action-junit-report` renders the XML natively in the GitHub Actions UI — no custom parsing, failures appear as first-class test results\n\n' +
        '**Key flags in the CI step:**\n' +
        '- `--concurrency 5` — 5 parallel workers\n' +
        '- `--iterations 100` — 100 iterations\n' +
        '- `--junit test-results.xml` — write JUnit report for the CI dashboard\n' +
        '- `--fail-on-error` — exit `1` on any test failure so the CI step itself fails\n' +
        '- `-q` — quiet logs (CI already shows the command)',
      // Real content from docs/guides/cli-ci-cd.md's "Basic Test Job (Using npm Package)"
      // section, not a live workflow file in this repo's own .github/workflows/.
      terminalCommand: 'cat docs/guides/cli-ci-cd.md   # (excerpt: Basic Test Job)',
      terminalOutput:
        'name: API Performance Tests\n' +
        '\n' +
        'on:\n' +
        '  push:\n' +
        '    branches: [main, develop]\n' +
        '  pull_request:\n' +
        '    branches: [main]\n' +
        '\n' +
        'jobs:\n' +
        '  performance-test:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        '      - name: Checkout code\n' +
        '        uses: actions/checkout@v4\n' +
        '\n' +
        '      - name: Setup Node.js\n' +
        '        uses: actions/setup-node@v4\n' +
        '        with:\n' +
        '          node-version: \'20\'\n' +
        '\n' +
        '      - name: Run API tests\n' +
        '        run: |\n' +
        '          npx redfireforge-cli run tests/api-test.yaml \\\n' +
        '            --concurrency 5 \\\n' +
        '            --iterations 100 \\\n' +
        '            --junit test-results.xml \\\n' +
        '            --fail-on-error \\\n' +
        '            -q\n' +
        '\n' +
        '      - name: Upload test results\n' +
        '        uses: actions/upload-artifact@v4\n' +
        '        if: always()\n' +
        '        with:\n' +
        '          name: test-results\n' +
        '          path: test-results.xml\n' +
        '\n' +
        '      - name: Publish Test Report\n' +
        '        uses: mikepenz/action-junit-report@v4\n' +
        '        if: always()\n' +
        '        with:\n' +
        '          report_paths: \'test-results.xml\'',
      // 2 beats: the actual test run step, then the always()-published report steps.
      terminalHighlightLines: [[21, 28], [29, 41]],
      pauseAfter: true,
    },

    // ── Step 6: Choosing Report Formats (recap, no execution) ────────────
    {
      id: 'cli6-recap',
      title: 'Choosing Report Formats',
      description:
        'Pick the format that matches who (or what) will consume it:\n\n' +
        '- `--output json` — a **stream** for a pipeline to gate on, straight to stdout\n' +
        '- `-o results.json` — an **artifact** with the full per-request detail\n' +
        '- `--junit results.xml` — CI systems with a built-in test-report UI (almost all of them)\n' +
        '- `--markdown results.md` — a PR comment a human will read\n' +
        '- `--data-rows-summary results.json` — per-row pass/fail for a parameterized CI gate (covered in the Data-Driven lesson)\n\n' +
        'The file-writing formats are additive — one run can emit all of them at once. ' +
        '`--output json` is the one exception: it owns stdout, so it replaces the console summary rather than adding to it.',
      terminalOutput:
        '# --output json       → stream to stdout, pipe into jq (owns stdout)\n' +
        '# -o results.json      → artifact with full per-request detail\n' +
        '# --junit results.xml  → CI systems with a built-in test-report UI\n' +
        '# --markdown results.md → a PR comment a human will read\n' +
        '# --data-rows-summary  → per-row pass/fail in a parameterized CI gate\n' +
        '#\n' +
        '# The file formats are additive — one run can emit all four at once:\n' +
        '$ redfireforge run examples/cli-basic-test.yaml -o r.json --junit r.xml --markdown r.md --data-rows-summary r-rows.json -q',
      terminalHighlightLines: [[1, 2], [7, 8]],
      pauseAfter: true,
    },
  ],
};
