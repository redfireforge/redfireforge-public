# RedfireForge CLI

> API Performance Testing from the Command Line

Run API performance tests and workflows using YAML or JSON test files. The CLI uses the same execution engine as the RedfireForge desktop application, ensuring consistent behavior between GUI and command-line testing.

## Installation

### Option 1: npm Package (Recommended)

```bash
npm install -g redfireforge-cli
```

This installs two equivalent commands: `redfireforge` (full name) and **`rff`** (short alias — same binary, just less to type). `rff` is never claimed by the desktop app installer, so it's always unambiguous even on a machine that also has the desktop app installed.

### Option 2: Desktop App CLI Mode

If you have the RedfireForge desktop app installed, use the `--cli` flag:

```bash
# macOS/Linux (symlink created during installation)
redfireforge --cli run tests/test.yaml

# Windows (added to PATH during installation)
redfireforge --cli run tests/test.yaml
```

> **Note:** the desktop app's own `redfireforge` command launches the GUI by default (`--cli` switches it to CLI mode) — this is a *different* binary than Option 1's npm package, even though they share the same name. If you have both installed, prefer `rff` (Option 1) or `redfireforge --cli` (Option 2) explicitly rather than relying on bare `redfireforge`, since whichever one wins your `$PATH` determines which behavior you get.

### Option 3: From Source

```bash
git clone https://github.com/your-org/redfireforge.git
cd redfireforge
npm install
npx tsx cli/index.ts run tests/test.yaml
```

## Quick Start

```bash
# Validate a test file
redfireforge validate tests/api-test.yaml

# Run a simple test
redfireforge run tests/api-test.yaml

# Run with concurrency and iterations
redfireforge run tests/api-test.yaml -c 10 -i 100

# Run a workflow performance test
redfireforge workflow tests/checkout-flow.yaml -i 50 -c 5

# Print machine-readable JSON to stdout (for CI)
redfireforge run tests/api-test.yaml --output json

# Every command above also works with the short "rff" alias:
rff run tests/api-test.yaml -c 10 -i 100
```

## Commands

| Command | Description |
|---------|-------------|
| `run <file>` | Execute a test file |
| `workflow <file>` | Execute a workflow as a performance test |
| `validate <file>` | Validate a test file without running |
| `validate-workflow <file>` | Validate a workflow file without running |
| `mock simulate <file>` | Run saved API Mock samples (side-effect-free) |
| `mock verify <file>` | Assert live journal calls (or `--simulate` for offline corpus) |
| `mock start <file>` | Start mock listeners (companion, or in-process `--standalone`) |

### API Mock Studio (`mock`)

Headless helpers for API Mock Studio definitions (native JSON/YAML export envelopes or workspace files).

```bash
# Simulate samples against a definition (same engine as GUI)
npx tsx cli/index.ts mock simulate ./api-mock-workspace.json -o results.json --junit junit.xml

# Verify live journal (requires companion + running mock)
npx tsx cli/index.ts mock verify ./api-mock-workspace.json --expect-outcome matched --min-calls 1

# Offline corpus (same engine as GUI Simulate)
npx tsx cli/index.ts mock verify ./api-mock-workspace.json --simulate --expect-outcome matched --min-calls 1

# Start listeners. Companion on :3001 is preferred; falls back to in-process.
npx tsx cli/index.ts mock start ./api-mock-workspace.json --port 4600 --wait-ready

# Force in-process listeners (no companion) — useful in Docker/CI
npx tsx cli/index.ts mock start ./api-mock-workspace.json --standalone --wait-ready
```

| Option | Commands | Description |
|--------|----------|-------------|
| `--server <id>` | simulate, verify | Target server (default: active / first) |
| `-o, --output <path>` | simulate | Write JSON results to a file |
| `-o, --output json\|junit` | simulate | Print results to stdout in that format |
| `--junit <path>` | simulate | Write JUnit XML |
| `--min-calls <n>` | verify | Require at least N matching journal calls (samples when `--simulate`) |
| `--expect-outcome <outcome>` | verify | Require matching outcome |
| `--route <id>` | verify | Restrict assertions to a route (live journal, or `--simulate` samples) |
| `--last-call-within-ms <n>` | verify | Last matching call recency (live journal only) |
| `--body-contains <text>` | verify | Matching response body substring (live journal last call, or `--simulate` samples) |
| `--simulate` | verify | Offline corpus instead of live journal |
| `--port <n>` | start | Port override for the first server; later servers increment |
| `--control-base <url>` | start, verify | Companion base (default `http://127.0.0.1:3001`) |
| `--wait-ready` | start | Stay alive until SIGINT/SIGTERM, then stop (implied for `--standalone`) |
| `--standalone` | start | In-process listeners (no companion) |

## Common Options

### Test Run Options

| Option | Description |
|--------|-------------|
| `-c, --concurrency <n>` | Number of concurrent requests (default: 1) |
| `-i, --iterations <n>` | Number of iterations |
| `-m, --mode <mode>` | Execution mode: `sequential`, `batch`, `pool`, `load-profile` |
| `--timeout <sec>` | Per-request timeout in seconds (default: 30) |
| `--retries <n>` | Retry count on failure |
| `--retry-delay <ms>` | Delay between retries |
| `--base-url <url>` | Override base URL for all tests |

### Workflow Options

| Option | Description |
|--------|-------------|
| `-i, --iterations <n>` | Total workflow iterations (default: 10) |
| `-c, --concurrency <n>` | Concurrent iterations (default: 1) |
| `--var <name=value>` | Set workflow variables (can repeat) |

### Output Options

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Write JSON report to a file |
| `-o, --output json` | Print a CI-friendly JSON report to **stdout** |
| `-o, --output junit` | Print JUnit XML to **stdout** |
| `--junit <path>` | Write JUnit XML report |
| `--markdown <path>` | Write Markdown report |
| `-q, --quiet` | Suppress progress output |

> `json` and `junit` are format keywords, not filenames — supported by `run`,
> `workflow`, and `mock simulate`. To write to a file literally named `json`,
> qualify it: `--output ./json`.

### Machine-Readable Output (CI)

`--output json` prints a flat, stable report to stdout and suppresses **all**
other stdout output, so the stream is safe to pipe straight into `jq`:

```bash
rff run tests/api-test.yaml --output json | jq '.failed'
```

```json
{
  "passed": 12,
  "failed": 2,
  "total": 14,
  "durationMs": 3421,
  "results": [
    {
      "name": "Get Users",
      "status": "pass",
      "durationMs": 123,
      "error": null
    },
    {
      "name": "Create Order",
      "status": "fail",
      "durationMs": 456,
      "error": "Expected status 201 but got 500"
    }
  ]
}
```

Notes:

- `status` is `"pass"` or `"fail"`; `error` is `null` for passing tests.
- Parameterized rows are qualified as `Scenario [Row label]` so names stay unique.
- Errors and diagnostics still go to **stderr**, keeping stdout pure.
- Exit codes are unchanged — `--fail-on-error` (1), `--fail-on-regression` (2/3)
  and `--fail-on-sla` (4) all still fire, and the SLA / baseline reports that
  normally print on failure are suppressed so they cannot corrupt the report.

#### Workflow runs

For `workflow`, one result is emitted **per iteration** — matching `--output junit`,
so both formats agree on `total`. Each iteration fails if any of its steps failed,
and the individual steps are preserved under `steps` (same shape, one level deep):

```json
{
  "name": "Iteration 1",
  "status": "fail",
  "durationMs": 56,
  "error": "Create Order: (http): expected 2xx, got HTTP 500",
  "steps": [
    { "name": "Login", "status": "pass", "durationMs": 54, "error": null },
    { "name": "Create Order", "status": "fail", "durationMs": 2, "error": "(http): expected 2xx, got HTTP 500" }
  ]
}
```

`steps` is additive — pipelines that only read the documented fields are unaffected.
The iteration `error` concatenates every failing step as `Step: error`, joined by `; `.

### CI/CD Options

| Option | Description |
|--------|-------------|
| `--fail-on-error` | Exit code 1 if any request fails |
| `--fail-threshold <pct>` | Exit code 1 if error rate exceeds % |
| `--error-policy <policy>` | `continue`, `stop-first`, `stop-threshold` |

## Test File Format (YAML)

```yaml
name: My API Tests
baseUrl: https://api.example.com

tests:
  - name: List Users
    method: GET
    url: /users
    assertions:
      - type: status
        expected: "200"
      - type: jsonPath
        jsonPath: $.length
        operator: ">"
        value: 0

  - name: Create User
    method: POST
    url: /users
    headers:
      Content-Type: application/json
    body: |
      {"name": "{{name}}", "email": "{{email}}"}
    assertions:
      - type: status
        expected: "201"
```

## Workflow File Format (YAML)

```yaml
name: User Registration Flow
variables:
  email: test@example.com

nodes:
  - id: start
    type: start
    data:
      label: Start

  - id: create-user
    type: http
    data:
      label: Create User
      method: POST
      url: https://api.example.com/users
      headers:
        Content-Type: application/json
      body: |
        {"email": "{{email}}"}

edges:
  - id: e1
    source: start
    target: create-user
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — all tests passed |
| 1 | Test failure, or an execution error (invalid/missing file) |
| 2 | Performance regression vs. baseline (`--fail-on-regression`) |
| 3 | Regression **and** test failures (`--fail-on-regression`) |
| 4 | SLA violation (`--fail-on-sla`) |

A **test failure** exits `1` only with `--fail-on-error` or `--fail-threshold <pct>`;
otherwise failures are reported and the run still exits `0`. An **execution error**
(invalid or missing file) always exits `1`, no flag required. Codes `2`/`3` need
`--fail-on-regression`, `4` needs `--fail-on-sla`. The `workflow` command uses `1`
for failures and `2` for execution errors. Exit codes are unaffected by `--output json`.

## CI/CD Example

```yaml
# GitHub Actions
- name: Run API Tests
  run: |
    npx redfireforge-cli run tests/api-test.yaml \
      --concurrency 10 \
      --iterations 100 \
      --junit results.xml \
      --fail-on-error \
      -q
```

To parse results in the pipeline instead of writing a file, stream JSON to stdout:

```yaml
- name: Run API Tests and gate on failures
  run: |
    npx redfireforge-cli run tests/api-test.yaml \
      --output json \
      --fail-on-error > results.json
  # Non-zero exit already fails the step; results.json is still valid JSON.

- name: Summarize
  if: always()
  run: jq -r '"\(.passed)/\(.total) passed in \(.durationMs)ms"' results.json
```

## Links

- [Full Documentation](https://github.com/your-org/redfireforge/blob/main/docs/guides/cli-reference.md)
- [CI/CD Integration Guide](https://github.com/your-org/redfireforge/blob/main/docs/guides/cli-ci-cd.md)
- [Example Test Files](https://github.com/your-org/redfireforge/tree/main/examples)

## License

MIT
