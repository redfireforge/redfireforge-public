# RedfireForge CLI Reference

Complete reference for running API performance tests from the command line.

## Installation

### Method A: From Source (Developers)

```bash
# Clone the repository
git clone https://github.com/your-org/redfireforge.git
cd redfireforge
npm install

# Run CLI via npx
npx tsx cli/index.ts <command> [options]
```

### Method B: Global npm Package

Install the CLI as a standalone npm package for use anywhere:

```bash
# Install globally
npm install -g redfireforge-cli

# Run from anywhere
redfireforge <command> [options]

# Or use npx without installing
npx redfireforge-cli <command> [options]
```

**Package Details:**
- Package name: `redfireforge-cli`
- Requires: Node.js >= 18
- Size: ~300KB bundled

**Verify Installation:**

```bash
redfireforge --version
redfireforge --help
```

### Method C: Desktop App CLI Mode

If you have the RedfireForge desktop app installed, you can use CLI mode with the `--cli` flag:

```bash
# macOS (after installation, symlink is created automatically)
redfireforge --cli run tests/test.yaml

# Or use the full path
/Applications/RedfireForge.app/Contents/MacOS/RedfireForge --cli run tests/test.yaml

# Windows (added to PATH during installation)
redfireforge --cli run tests/test.yaml

# Linux (symlink created in /usr/local/bin)
redfireforge --cli run tests/test.yaml
```

**Requirements:**
- RedfireForge desktop app installed
- Node.js >= 18 (for executing the CLI script)

**Note:** The desktop CLI mode requires Node.js because it executes the bundled JavaScript CLI. If Node.js is not available, the app will suggest using the standalone npm package instead.

**Full Option Parity:** The desktop `--cli` mode supports all the same options as the standalone npm CLI (`run`, `workflow`, `validate`, `validate-workflow`) — including `--data`, `--tags`, `--error-policy`, `--duration`, and all other flags documented below.

**Available Commands in Desktop CLI Mode:**

```bash
# Show help
redfireforge --cli

# Run a test file
redfireforge --cli run <file> [options]

# Run a workflow
redfireforge --cli workflow <file> [options]

# Validate files
redfireforge --cli validate <file>
redfireforge --cli validate-workflow <file>
```

**Example:**

```bash
# Run with concurrency and generate reports
redfireforge --cli run tests/api-test.yaml \
  -c 10 \
  -i 100 \
  --junit results.xml \
  --fail-on-error
```

---

## Commands Overview

| Command | Description |
|---------|-------------|
| `run <file>` | Execute a test file |
| `workflow <file>` | Execute a workflow file as a performance test |
| `validate <file>` | Validate a test file without running it |
| `validate-workflow <file>` | Validate a workflow file without running it |
| `--version` | Display version number |
| `--help` | Display help for command |

---

## Test File Commands

### `run` — Execute a Test File

Run API tests defined in a YAML or JSON file.

```bash
npx tsx cli/index.ts run <file> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a `.yaml`, `.yml`, or `.json` test file |

#### Options

##### Execution Control

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-c, --concurrency <n>` | integer | 1 | Number of concurrent requests |
| `-i, --iterations <n>` | integer | (tests × rows) | Number of iterations (how many times each test runs) |
| `-m, --mode <mode>` | string | `pool` | Execution mode: `sequential`, `batch`, `pool`, `load-profile` |
| `--timeout <sec>` | integer | 30 | Per-request timeout in seconds |
| `--duration <sec>` | integer | - | Duration in seconds (load-profile mode only) |

##### Retry & Error Handling

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--retries <n>` | integer | 0 | Retry count on failure |
| `--retry-delay <ms>` | integer | 0 | Delay between retries in milliseconds |
| `--error-policy <policy>` | string | `continue` | Error policy: `continue`, `stop-first`, `stop-threshold` |
| `--max-errors <n>` | integer | 10 | Stop after N errors (threshold mode) |
| `--max-error-rate <pct>` | float | 50 | Stop at error rate % (threshold mode) |

##### Data & Filtering

| Option | Type | Description |
|--------|------|-------------|
| `--base-url <url>` | string | Override the base URL for all tests |
| `--data <file>` | string | External data file (CSV or JSON) for parameterized testing |
| `--scenario <name>` | string | Run only the test matching this name |
| `--tags <tags>` | string | Run only data rows with these tags (comma-separated) |
| `--tag-mode <mode>` | string | Tag matching mode: `any` (default) or `all` |
| `--env <name>` | string | Environment name (metadata only) |

##### Output & Reports

| Option | Type | Description |
|--------|------|-------------|
| `-o, --output <path>` | string | Write JSON report to file |
| `-o, --output json` | keyword | Print a CI-friendly JSON report to stdout |
| `-o, --output junit` | keyword | Print JUnit XML to stdout |
| `--junit <path>` | string | Write JUnit XML report to file |
| `--markdown <path>` | string | Write Markdown report to file |
| `--data-rows-summary <path>` | string | Write data row summary JSON (CI/CD format) |
| `-q, --quiet` | flag | Suppress progress output |

###### Machine-readable stdout

`--output json` and `--output junit` are format keywords rather than filenames,
and are supported by `run`, `workflow`, and `mock simulate`. When either is used,
all human-readable output is suppressed so stdout contains only the report —
diagnostics still go to stderr, and exit codes are unchanged.

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
    { "name": "Get Users", "status": "pass", "durationMs": 123, "error": null },
    { "name": "Create Order", "status": "fail", "durationMs": 456, "error": "Expected status 201 but got 500" }
  ]
}
```

The SLA and baseline-comparison reports that normally print on a failing run are
also suppressed, so exit codes 2, 3 and 4 still fire without corrupting stdout.

For `workflow`, results are emitted **per iteration** so `total` matches
`--output junit`. Steps are preserved under an additive `steps` array:

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

To write to a file literally named `json`, qualify the path: `--output ./json`.

##### Exit Code Control

| Option | Type | Description |
|--------|------|-------------|
| `--fail-on-error` | flag | Exit code 1 if any request fails (HTTP or validation) |
| `--fail-threshold <pct>` | float | Exit code 1 if error rate exceeds this % |

#### Examples

```bash
# Basic test run
npx tsx cli/index.ts run tests/api-test.yaml

# High concurrency load test
npx tsx cli/index.ts run tests/api-test.yaml -c 10 -i 1000

# Parameterized test with external data
npx tsx cli/index.ts run tests/user-test.yaml --data data/users.csv

# Run specific tags only
npx tsx cli/index.ts run tests/api-test.yaml --tags smoke,critical --tag-mode any

# Generate all reports
npx tsx cli/index.ts run tests/api-test.yaml \
  -o results.json \
  --junit results.xml \
  --markdown results.md

# CI/CD mode with failure threshold
npx tsx cli/index.ts run tests/api-test.yaml \
  --fail-on-error \
  --fail-threshold 5 \
  -q
```

---

### `validate` — Validate a Test File

Check that a test file is valid without executing any requests.

```bash
npx tsx cli/index.ts validate <file>
```

#### Examples

```bash
npx tsx cli/index.ts validate tests/api-test.yaml
```

**Output:**
```
  ✅ Valid test file: api-test.yaml
  Tests: 3
    - GET https://api.example.com/users  (List Users)
    - POST https://api.example.com/users  (Create User) [5 data rows]
    - GET https://api.example.com/users/{id}  (Get User)
```

---

## Workflow Commands

### `workflow` — Execute a Workflow File

Run a workflow definition as a performance test with configurable iterations and concurrency.

```bash
npx tsx cli/index.ts workflow <file> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a workflow `.yaml`, `.yml`, or `.json` file |

#### Options

##### Execution Control

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-i, --iterations <n>` | integer | 10 | Total number of workflow iterations |
| `-c, --concurrency <n>` | integer | 1 | Number of concurrent iterations |
| `--var <vars...>` | string | - | Set workflow variables (format: `name=value`) |
| `--base-url <url>` | string | - | Base URL for HTTP nodes with relative paths |
| `--timeout <sec>` | integer | 30 | Per-request timeout in seconds |

##### Error Handling

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--error-policy <policy>` | string | `continue` | Error policy: `continue`, `stop-first`, `stop-threshold` |
| `--max-errors <n>` | integer | 10 | Stop after N errors (threshold mode) |
| `--max-error-rate <pct>` | float | 50 | Stop at error rate % (threshold mode) |

##### Output & Reports

| Option | Type | Description |
|--------|------|-------------|
| `-o, --output <path>` | string | Write JSON report to file |
| `-o, --output json` | keyword | Print a CI-friendly JSON report to stdout |
| `-o, --output junit` | keyword | Print JUnit XML to stdout |
| `--junit <path>` | string | Write JUnit XML report to file |
| `--markdown <path>` | string | Write Markdown report to file |
| `-q, --quiet` | flag | Suppress progress output |

##### Exit Code Control

| Option | Type | Description |
|--------|------|-------------|
| `--fail-on-error` | flag | Exit code 1 if any request fails |
| `--fail-threshold <pct>` | float | Exit code 1 if error rate exceeds this % |

#### Examples

```bash
# Basic workflow run
npx tsx cli/index.ts workflow workflows/user-flow.yaml

# Load test with 50 iterations at concurrency 5
npx tsx cli/index.ts workflow workflows/checkout.yaml -i 50 -c 5

# Override workflow variables
npx tsx cli/index.ts workflow workflows/search.yaml \
  --var searchTerm=laptop \
  --var maxResults=20

# Generate reports
npx tsx cli/index.ts workflow workflows/checkout.yaml \
  -i 100 -c 10 \
  -o results.json \
  --junit results.xml \
  --markdown results.md

# CI/CD mode
npx tsx cli/index.ts workflow workflows/checkout.yaml \
  -i 50 -c 5 \
  --fail-on-error \
  -q
```

---

### `validate-workflow` — Validate a Workflow File

Check that a workflow file is valid without executing it.

```bash
npx tsx cli/index.ts validate-workflow <file>
```

#### Examples

```bash
npx tsx cli/index.ts validate-workflow workflows/checkout.yaml
```

**Output:**
```
  ✅ Valid workflow: checkout.yaml
  Name: Checkout Flow
  Nodes: 8 total, 5 HTTP
  Edges: 7
  Variables: userId, productId
```

---

## Test File Format

### YAML Structure

```yaml
name: API Test Suite
env: staging
baseUrl: https://api.example.com

tests:
  - name: List Users
    method: GET
    url: /users
    headers:
      Accept: application/json
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
      {
        "name": "{{name}}",
        "email": "{{email}}"
      }
    assertions:
      - type: status
        expected: "201"
    dataSource:
      columns:
        - id: name
          name: name
          type: body
          mapping: name
        - id: email
          name: email
          type: body
          mapping: email
      rows:
        - id: r1
          values:
            name: John Doe
            email: john@example.com
        - id: r2
          values:
            name: Jane Doe
            email: jane@example.com
```

### JSON Structure

```json
{
  "name": "API Test Suite",
  "env": "staging",
  "baseUrl": "https://api.example.com",
  "tests": [
    {
      "name": "List Users",
      "method": "GET",
      "url": "/users",
      "headers": {
        "Accept": "application/json"
      },
      "assertions": [
        { "type": "status", "expected": "200" }
      ]
    }
  ]
}
```

---

## Workflow File Format

### Simplified Format (Recommended for CLI)

```yaml
name: User Registration Flow
description: Create user, verify, update profile

variables:
  email: test@example.com
  name: Test User

nodes:
  - id: start
    type: start
    position: { x: 0, y: 0 }
    data:
      label: Start

  - id: create-user
    type: http
    position: { x: 0, y: 100 }
    data:
      label: Create User
      method: POST
      url: https://jsonplaceholder.typicode.com/users
      headers:
        Content-Type: application/json
      body: |
        {"name": "{{name}}", "email": "{{email}}"}

  - id: verify-user
    type: http
    position: { x: 0, y: 200 }
    data:
      label: Verify User
      method: GET
      url: https://jsonplaceholder.typicode.com/users/{{userId}}

edges:
  - id: e1
    source: start
    target: create-user
  - id: e2
    source: create-user
    target: verify-user
```

### Full Format (Exported from UI)

When exporting from the RedfireForge UI, workflows include the full `scenario` structure:

```yaml
nodes:
  - id: http-1
    type: http
    data:
      label: Create User
      scenario:
        id: sc-1
        name: Create User
        url: https://api.example.com/users
        method: POST
        headers:
          - key: Content-Type
            value: application/json
        body: '{"name": "{{name}}"}'
        auth:
          type: none
        validation:
          mode: selective
          assertions:
            - path: $.status
              operator: equals
              expected: "201"
        extractions:
          - name: userId
            source: body
            expression: $.id
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — all tests passed |
| `1` | Test failure — some requests failed (with `--fail-on-error`) or error rate exceeded threshold |
| `2` | Error — invalid file, missing file, or execution error |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REDFIREFORGE_BASE_URL` | Default base URL (can be overridden by `--base-url`) |
| `REDFIREFORGE_TIMEOUT` | Default timeout in seconds |
| `NO_COLOR` | Disable colored output |

---

## Tips & Best Practices

### 1. Start Small, Scale Up

```bash
# First, validate your test file
npx tsx cli/index.ts validate tests/api-test.yaml

# Run a quick smoke test
npx tsx cli/index.ts run tests/api-test.yaml -c 1 -i 5

# Then scale up
npx tsx cli/index.ts run tests/api-test.yaml -c 10 -i 1000
```

### 2. Use Tags for Test Selection

```bash
# Run only smoke tests
npx tsx cli/index.ts run tests/api-test.yaml --tags smoke

# Run critical AND regression tests
npx tsx cli/index.ts run tests/api-test.yaml --tags critical,regression --tag-mode all
```

### 3. Generate Reports for CI/CD

```bash
npx tsx cli/index.ts run tests/api-test.yaml \
  --junit results.xml \
  --fail-on-error \
  -q
```

### 4. Override Base URL for Different Environments

```bash
# Staging
npx tsx cli/index.ts workflow workflows/checkout.yaml \
  --base-url https://staging.example.com

# Production
npx tsx cli/index.ts workflow workflows/checkout.yaml \
  --base-url https://api.example.com

# Or via workflow variable (equivalent, but --base-url is preferred)
npx tsx cli/index.ts workflow workflows/checkout.yaml \
  --var baseUrl=https://api.example.com
```

### 5. Use Quiet Mode in Scripts

```bash
#!/bin/bash
if npx tsx cli/index.ts run tests/api-test.yaml --fail-on-error -q; then
  echo "Tests passed!"
else
  echo "Tests failed!"
  exit 1
fi
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `Error: Cannot find module` | Run `npm install` in the project directory |
| `Error: Test file not found` | Check the file path is correct and file exists |
| `Error: Invalid test file` | Run `validate` command to see detailed errors |
| `Timeout errors` | Increase `--timeout` value or check API availability |
| `Connection refused` | Verify the API is running and accessible |

### Debug Mode

For verbose output, omit the `-q` flag to see:
- File loading information
- Test/scenario counts
- Progress updates
- Detailed error messages

---

## See Also

- [CLI CI/CD Integration Guide](./cli-ci-cd.md)
- [Workflow Runner Guide](./workflow-runner-guide.md)
- [Runners Comparison](./runners-comparison.md)
