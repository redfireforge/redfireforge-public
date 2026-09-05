# RedfireForge — Redfire Performance Workbench

[![CI](https://github.com/redfireforge/redfireforge-public/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/redfireforge/redfireforge-public/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/redfireforge/redfireforge-public?label=release)](https://github.com/redfireforge/redfireforge-public/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#)

> *Fire. Measure. Validate.*

A **cross-platform** desktop & web API performance testing tool built with React + TypeScript + Vite + Tauri. Define HTTP tests visually, execute them with configurable concurrency, validate responses, and analyze results — all from a native desktop application or a browser.

**✅ Supports:** macOS (Intel & Apple Silicon) • Windows 10/11 • Linux (Ubuntu, Debian, Fedora)

📖 **[Full Cross-Platform Guide](docs/guides/cross-platform.md)** — Installation, building, and platform-specific notes

---

## Table of Contents

- [Quick Start](#quick-start)
- [CLI Runner](#cli-runner)
- [Architecture Overview](#architecture-overview)
- [UI Configuration Guide](#ui-configuration-guide)
  - [Settings](#settings)
  - [Sidebar Navigation](#sidebar-navigation)
  - [Feature Groups & Scenarios](#feature-groups--scenarios)
  - [Test Editor](#test-editor)
  - [Test Runner](#test-runner)
  - [Workflow Designer](#workflow-designer)
  - [Results Dashboard](#results-dashboard)
  - [API Catalog](#api-catalog)
  - [Requests](#requests-ad-hoc-api-testing)
- [Feature Reference](#feature-reference)
- [Branching Strategy & Versioning](#branching-strategy--versioning)
- [Development Workflow](#development-workflow)
- [CI/CD & Multi-Platform Releases](#cicd--multi-platform-releases)
- [Data Persistence](#data-persistence)

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **npm** (or yarn/pnpm)
- **Rust** (for desktop builds only — install via [rustup](https://rustup.rs/))

### Desktop App (Recommended)

```bash
npm install
npm run tauri:dev     # launches the native desktop window with hot-reload
```

### Desktop Builds — Standard vs Learning Hub

RedfireForge ships two desktop variants (side-by-side install on macOS via different bundle IDs):

| Variant | Command | Bundle ID | Demo Hub |
|---------|---------|-----------|----------|
| **Standard** (performance workbench) | `npm run tauri:build:prod` | `com.redfireforge.desktop` | Off |
| **Learning Hub** (interactive lessons) | `npm run tauri:build:demo` | `com.redfireforge.desktop.demo` | On |

Web-only builds: `npm run build:prod` vs `npm run build:demo`.  
Demo lessons live in the **`@redfireforge/demo-hub`** workspace package (`packages/demo-hub/`).  
GitHub Releases: tag `vX.Y.Z` for Standard; `vX.Y.Z-demo` or workflow dispatch for Learning Hub.

### Desktop Build (Production — Local)

```bash
npm run tauri:build
```

This builds for your current OS only:
- **macOS**: `RedfireForge.app` and `.dmg` in `src-tauri/target/release/bundle/`
- **Windows**: `.msi` and `.exe` installers
- **Linux**: `.deb` and `.AppImage` packages

End users do **not** need Rust installed — the build produces a standalone native binary with all dependencies bundled.

### Desktop Build (All Platforms — CI/CD)

To build for all three platforms, push a version tag to GitHub:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers the GitHub Actions workflow (`.github/workflows/release.yml`) which builds on macOS, Windows, and Linux runners simultaneously and creates a draft GitHub Release with all installers attached:

| Platform | Artifacts |
|---|---|
| **macOS ARM64** (Apple Silicon) | `.app`, `.dmg` |
| **macOS x64** (Intel) | `.app`, `.dmg` |
| **Linux x64** | `.deb`, `.AppImage` |
| **Windows x64** | `.msi`, `.exe` |

You can also trigger builds manually from the Actions tab using "Run workflow."

### Web Mode (Browser)

The app still runs as a standalone web app for development or environments where a desktop install isn't possible:

```bash
npm install
npm run dev
```

The app starts at `http://localhost:5173`. A built-in Vite server-side proxy (`/__proxy`) handles outbound HTTP requests to avoid CORS issues.

### Build Web for Production

```bash
npm run build
npm run preview   # serves the production build locally
```

### Stop

Press `Ctrl+C` in the terminal running the dev command.

---

## CLI Runner

Run API performance tests from the command line using YAML or JSON test files. The CLI reuses the same execution engine, validators, and reporters as the GUI — so tests behave identically in CI/CD and on your desktop.

📖 **[Full CLI Reference](docs/guides/cli-reference.md)** — Complete command documentation  
📖 **[CI/CD Integration Guide](docs/guides/cli-ci-cd.md)** — GitHub Actions, GitLab CI, Jenkins, Azure DevOps examples

### Quick Start

```bash
# Validate a test file
npx tsx cli/index.ts validate examples/cli-basic-test.yaml

# Run a simple test
npx tsx cli/index.ts run examples/cli-basic-test.yaml

# Run with concurrency and iterations
npx tsx cli/index.ts run examples/cli-basic-test.yaml -c 5 -i 50

# Run parameterized tests with tags
npx tsx cli/index.ts run examples/cli-parameterized.yaml --tags smoke,critical

# Run workflow performance test
npx tsx cli/index.ts workflow examples/workflow-cli-parallel.yaml -i 20 -c 3
```

### Commands

| Command | Description |
|---|---|
| `run <file>` | Execute a test file |
| `workflow <file>` | Execute a workflow file as a performance test |
| `validate <file>` | Validate a test file without running |
| `validate-workflow <file>` | Validate a workflow file without running |

### Common Options

| Flag | Description |
|---|---|
| `-c, --concurrency <n>` | Number of concurrent requests |
| `-i, --iterations <n>` | Number of iterations (how many times each test runs) |
| `--timeout <sec>` | Per-request timeout |
| `--base-url <url>` | Override the base URL for all tests |
| `-o, --output <path>` | Write JSON report |
| `--junit <path>` | Write JUnit XML report |
| `--markdown <path>` | Write Markdown report |
| `--fail-on-error` | Exit code 1 if any request fails |
| `--fail-threshold <pct>` | Exit code 1 if error rate exceeds % |
| `-q, --quiet` | Suppress progress output |

### Test File Example (YAML)

```yaml
name: My API Tests
baseUrl: https://jsonplaceholder.typicode.com

tests:
  - name: List Users
    method: GET
    url: /users
    assertions:
      - type: status
        expected: "200"

  - name: Get User
    method: GET
    url: /users/1
    assertions:
      - type: status
        expected: "200"
      - type: jsonPath
        jsonPath: $.name
        operator: exists
```

### CI/CD Quick Example

```bash
# GitHub Actions, Jenkins, etc.
npx tsx cli/index.ts run tests/api-test.yaml \
  --concurrency 10 \
  --iterations 100 \
  --junit results.xml \
  --fail-on-error \
  -q
```

### Example Scripts

Ready-to-use scripts are available in `examples/scripts/`:

```bash
# Basic test run with reports
./examples/scripts/run-basic-test.sh

# Parameterized tests with tag filtering
./examples/scripts/run-parameterized-test.sh smoke

# Load test with configurable concurrency
./examples/scripts/run-load-test.sh 10 500

# Workflow performance test
./examples/scripts/run-workflow-test.sh 50 5

# CI/CD smoke test (quick validation)
./examples/scripts/ci-smoke-test.sh

# CI/CD full test suite
./examples/scripts/ci-full-test.sh
```

Exit codes: `0` = all passed, `1` = failures exceed threshold, `2` = invalid file or runtime error.

---

## Architecture Overview

```
src/
├── App.tsx                     # Root component: tabs, sidebar, settings modal
├── styles/                     # Modular CSS files
├── pages/
│   └── EnvironmentManager.tsx  # Unified env/microservice/auth config page
├── engine/
│   ├── executor.ts             # Orchestration layer (re-exports from focused modules)
│   ├── allocationEngine.ts     # Shared allocation engine (computeAllocation)
│   ├── validator.ts            # Response validation barrel (16 assertion types)
│   ├── validatorDateHelpers.ts # Date assertion: resolveDate, toDayString, truncateToUnit
│   ├── validatorHttpHelpers.ts # HTTP assertion: matchesStatusPattern, findHeader, evaluateHeaderOp
│   ├── validatorSubsetMatch.ts # Deep recursive partial match: deepSubsetMatch
│   ├── validatorCustomExpression.ts # Custom ASSERT: isTruthy, wrapCustomExprDollarPaths
│   ├── fieldOperatorEvaluation.ts   # 24-operator evaluator: evaluateFieldOperator
│   ├── executionWorker.ts      # Web Worker entry point for off-thread test execution
│   ├── workerBridge.ts         # Main-thread bridge wrapping worker with runTest() interface
│   └── workerProtocol.ts       # Typed message protocol for Main ↔ Worker communication
├── features/
│   ├── scenarios/              # Feature Groups → Scenarios → Tests editor
│   │   └── components/
│   │       ├── TestEditorValidationTab.tsx  # Validation tab: 16 assertion types, rules pivot
│   │       ├── testEditorValidationAddMenu.ts  # Assertion factory menu definitions
│   │       └── testEditorValidationPivot.ts    # Pivoted rules table model
│   ├── test-runner/            # Standard, Parameterized, Workflow runners
│   ├── results/                # Results Explorer (canvas, detail panel, iteration matrix)
│   ├── requests/               # Requests: ad-hoc API testing (collections, folders)
│   ├── workflow/               # Workflow designer + 125 expression functions (8 categories)
│   └── catalog/                # API Catalog (OpenAPI/Swagger browser & testing)
├── shared/
│   ├── components/
│   │   └── data-mapper/        # Unified Data Mapper
│   │       ├── DataMapper.tsx             # Main container (895 lines)
│   │       ├── ValidationRulesModal.tsx    # Three-mode validation rules panel (docked/floating/maximized)
│   │       ├── DslReferencePanel.tsx      # Card-based DSL reference panel with search/insert
│   │       ├── ValidationCodeEditor.tsx   # Monaco DSL editor with syntax highlighting
│   │       ├── BodyBuilderPanel.tsx       # Three-mode body construction (JSON/Form/Raw)
│   │       ├── MappingCompare.tsx         # Side-by-side mapping trace comparison
│   │       ├── adapters/                  # 10 context-specific adapters
│   │       │   ├── validationAdapter.ts   # Selective validation (ExpectedField[])
│   │       │   ├── extractionAdapter.ts   # Variable extraction (Extraction[])
│   │       │   ├── requestBodyAdapter.ts  # Request body builder (JSON/Form/Raw)
│   │       │   ├── assertionAdapter.ts    # Regex assertion (jsonPath + pattern)
│   │       │   ├── columnMappingAdapter.ts    # CSV columns ↔ request slots
│   │       │   ├── populateFromApiAdapter.ts  # API response → data source
│   │       │   ├── sharedDsFetchAdapter.ts    # Shared data source fetch
│   │       │   ├── variableBindingAdapter.ts  # Workflow variable wiring
│   │       │   ├── webhookExtractionAdapter.ts # Webhook payload extraction
│   │       │   └── demoAdapter.ts             # Sandbox/gallery demos
│   │       ├── hooks/                     # State management hooks
│   │       │   ├── useMapperState.ts      # Mapping CRUD + undo/redo
│   │       │   ├── useKeyboardNavigation.ts   # Arrow keys, Tab, Home/End
│   │       │   ├── useBottomUtilityDock.ts    # Dock mode + floating pop-out
│   │       │   ├── useDataMapperTreeInteraction.ts # Hover/click/keyboard bridge
│   │       │   ├── useHighlightedMappingPaths.ts  # Highlight set derivation
│   │       │   ├── useMapperVisibleLines.ts       # Connection line filtering
│   │       │   └── useValidationCodeSync.ts       # Bi-directional DSL sync
│   │       └── utils/                     # Algorithms & engines
│   │           ├── autoMapAlgorithm.ts    # 3-tier auto-map matching
│   │           ├── validationDsl.ts       # DSL parser/serializer
│   │           ├── schemaDrift.ts         # Schema drift detection
│   │           ├── schemaRepair.ts        # Levenshtein-based repair
│   │           ├── schemaContract.ts      # Strict/lenient lock mode
│   │           ├── mappingTrace.ts        # Execution trace capture
│   │           ├── expressionStepDebugger.ts  # Step-through debugger
│   │           └── typeMismatch.ts        # Type mismatch detection & auto-fix
│   ├── types/index.ts          # Core types (16 Assertion variants, 24 FieldOperator, ExpectedField)
│   └── utils/                  # JSONPath engine, JSON tree model, scenario migration
├── utils/
│   ├── storage.ts           # Dual-mode persistence (Tauri fs / localStorage)
│   ├── httpClient.ts        # Quad-mode HTTP client with connection pooling
│   ├── platform.ts          # Runtime platform & capability detection
│   └── ...                  # cURL, CSV/Excel templates, search, export utilities
└── types/
    └── catalog.ts           # API Catalog types

cli/                            # CLI Runner (headless, Node.js)
├── index.ts                 # Entry point: `run` and `validate` commands (commander)
├── loader.ts                # YAML/JSON test file parser → engine Scenario/TestConfig
└── reporters.ts             # JSON, JUnit XML, Markdown report generators

examples/                       # Example test files for CLI
├── sample-api-test.yaml     # Basic YAML test with validation
├── sample-api-test.json     # Same tests in JSON format
├── load-profile-test.yaml   # Ramp-up load profile example
└── auth-test.yaml           # Authentication scenarios (bearer, basic, apikey)

src-tauri/
├── tauri.conf.json          # Tauri app configuration (window, bundle, plugins)
├── Cargo.toml               # Rust dependencies
├── capabilities/
│   └── default.json         # Plugin permissions (fs, http, dialog, shell)
└── src/
    ├── main.rs              # Tauri entry point
    ├── lib.rs               # Plugin registration (fs, http, dialog, shell)
    ├── executor.rs           # Rust HTTP executor (reqwest + tokio, pool/seq/load modes)
    ├── arrival_executor.rs   # Constant arrival rate executor (open-model load generation)
    ├── histogram.rs          # HDR Histogram for streaming percentile calculation
    ├── json_validator.rs     # Rust-side JSON validation engine
    ├── commands.rs           # Tauri IPC command handlers
    └── types.rs              # Shared Rust types (validation, execution config)
```

### Desktop vs Web Mode

The app detects at runtime whether it's running inside Tauri or a browser:

| Capability | Desktop (Tauri) | Web (Browser) |
|---|---|---|
| **Storage** | JSON files in `$APPDATA/redfireforge/` via Tauri `fs` plugin | `localStorage` (~5 MB) |
| **HTTP requests** | Native HTTP client via Tauri `http` plugin — no CORS, pooled via `reqwest` | Vite dev proxy (`/__proxy`) with `undici.Agent` connection pooling |
| **File save dialogs** | Native OS file picker via Tauri `dialog` plugin | File System Access API / browser download |
| **Cross-browser data** | Shared — data lives on disk | Isolated per browser |

---

## UI Configuration Guide

### Settings & Environments

Open **Settings** (⚙ button in the sidebar) or click **Environments** in the top-left sidebar to configure your testing infrastructure. Environments, microservices, and auth profiles are managed from a unified top-level page shared across Requests, Catalog, and Harness.

#### Environments & Microservices

| Concept | Purpose |
|---|---|
| **Environment** | A deployment target (e.g., `dev`, `test`, `staging`, `prod`) |
| **Microservice** | A service you test (e.g., `order-api`) |
| **Base URL** | Per-environment URL for each microservice |

**How to configure:**

1. Click the **Environments** section in the top-left sidebar, or open **⚙ Settings**.
2. Under **Environments**, type a name and click **Add** to create environments.
3. Under **Microservices**, type a name and click **Add** to create services.
4. For each microservice, click **Configure** to expand the environment table. Mark environments as **Deployed** (checkbox), then click **Edit** next to each to enter the base URL. Press **Save** or hit Enter to confirm.

#### Global Auth Profiles

Define reusable authentication configurations at the global level that Feature Groups can inherit from.

1. Scroll to **Global Auth Profiles** in Settings.
2. Enter a profile name (e.g., `prod-oauth`, `qa-basic`) and click **+ Add Profile**.
3. Configure the auth type and credentials (OAuth2, Basic, Bearer, API Key, Digest).
4. Click **Verify** to test the credentials (OAuth2 acquires a real token).
5. In a Feature Group, set auth to **Inherit from Global Profile** and select the profile from the dropdown.

Multiple profiles support different environments (dev, QA, prod) without duplicating auth configuration across Feature Groups.

#### Storage

The **Storage** section shows current data usage.

- Click the **Total usage** row to expand a per-key breakdown with usage bars.
- **Max stored runs** controls how many test runs are kept (1–500, default 50). Oldest runs are auto-deleted when the limit is exceeded.
- Response bodies are automatically truncated to 2 KB each to conserve storage.
- Results per run are capped at 2,000 (all failures kept; passed results evenly sampled). Live results during a run are capped at 500 for UI responsiveness.

#### Export Center

The **Export** section in Settings opens the **Export Center** — a modal that lets you pick exactly what data to export as a single JSON file.

**How to use:**

1. Open **Settings** → scroll to **Export** → click **Open Export Center**.
2. Five collapsible sections appear: **Environments**, **Microservices**, **Global Auth Profiles**, **Feature Groups**, and **Test Runs**.
3. Check individual items or use the **All / None** buttons per section.
4. Use **Select All / Clear All** at the top for bulk operations.
5. A live summary in the footer shows exactly what the export will contain (counts of environments, microservices, scenarios, tests, runs, and total requests).
6. Click **Export JSON** to save the file. A native "Save As" dialog appears.
7. Click **Close** to return to Settings.

When exporting microservices, any referenced environments are automatically included even if not explicitly checked. Global Auth Profiles referenced by selected Feature Groups are also auto-included.

#### Import Center

The **Import** button in Settings opens the **Import Center** for importing previously exported JSON files with full conflict resolution.

**How to use:**

1. Open **Settings** → scroll to **Export & Import** → click **Import Data**.
2. Select a JSON file. The Import Center parses it and shows all items grouped by type.
3. Each item is checked for conflicts by **ID** and **name**:
   - **NEW** — no conflict; will be added directly.
   - **ID MATCH** / **NAME MATCH** — a conflict was detected. Choose an action per item:
     - **Skip** — don't import this item.
     - **Overwrite** — replace the existing item with the incoming one.
     - **Keep Both** — import as a new copy with fresh IDs (including all nested scenario/test IDs for Feature Groups).
4. Expand any item to see a side-by-side comparison of incoming vs. existing data.
5. Use bulk actions (**All**, **None**, **Skip all**, **Overwrite all**, **Keep both all**) per section.
6. A live summary bar shows what will be added, overwritten, or skipped.
7. Click **Import** to apply.

The Import Center can be maximized for large imports using the ⊞ button.

### Theme (Dark / Light Mode)

Click the sun/moon toggle button in the top-right corner of the header to switch between **dark mode** (default) and **light mode**. Your preference is persisted across sessions.

### Sidebar Navigation

The left sidebar organizes your data by environment or microservice.

- **Toggle visibility**: Click the floating `☰` / `✕` button (always visible, even over modals).
- **Switch view**: Use the **Env** / **Svc** toggle at the top of the sidebar.
- **Expand / Collapse**: Click the `▸` arrow next to an item to expand its children, or use **Expand All** / **Collapse All** buttons.
- **Selection**: Click an environment/microservice name to select it. The selected context filters what you see in Feature Groups, Test Runner, and Results. Click a child item (e.g., a microservice under an environment) to select both simultaneously.
- **Feature indicator**: Items with associated Feature Groups show a colored dot — green for items that have features, gray for those that don't.
- **Selected item highlight**: The currently selected child item shows a colored left border and bold text for clear identification.
- **Additional Environments**: Microservice-specific environments appear in a separate "Additional Environments" section with amber/orange styling (dashed divider, amber tag showing the parent microservice name). When selected, the Feature Groups/Runner header badge also turns amber with a `+` indicator to distinguish from standard environments.

### Feature Groups & Scenarios

Navigate to the **Feature Groups** tab (first tab).

**Hierarchy:**

```
Feature Group (e.g., "Vehicle Onboarding")
  └── Scenario (e.g., "Happy Path - New Vehicle")
        └── Test (e.g., "POST /vehicles/onboarding")
```

**Creating a Feature Group:**

1. Type a name in the "New Feature Group" input and click **+ New Feature Group**.
2. The group is automatically associated with the currently selected environment and microservice from the sidebar.

**Feature Group Authentication:**

Click the **Auth** button on a Feature Group to configure authentication that all scenarios and tests in the group can inherit. This is the lowest priority in the inheritance chain.

**Creating a Scenario:**

1. Inside a Feature Group, type a name and click **+ Scenario**.
2. Optionally set **Scenario-level authentication** — it can inherit from the Feature Group or define its own. Tests within the scenario can inherit this auth.

**Drag-and-Drop:**

Reorder and move scenarios and tests using the `⠿` drag handle:

- **Move scenarios between Feature Groups** — drag a scenario's `⠿` handle and drop it onto another Feature Group's scenario list. A blue indicator line shows where it will be inserted.
- **Reorder scenarios** — drag a scenario within the same Feature Group to change its order.
- **Move tests between scenarios** — drag a test's `⠿` handle and drop it into a different scenario (even across Feature Groups).
- **Reorder tests** — drag a test within the same scenario to change its order.
- **Drop zones** — "Drop here" zones appear at the end of lists and in empty containers when dragging.

Note: When moving a scenario or test to a different parent, its auth inheritance chain updates to follow the new parent.

**Import / Export:**

- **Import**: Click **Import** on a Feature Group to import scenarios from a JSON file. Conflict detection warns if scenarios or tests with the same name already exist, with an option to proceed or cancel.
- **Export**: Click **Export** on a Feature Group, Scenario, or individual Test to save it as JSON using a native file dialog.
- **Naming convention**: All exported files follow a consistent format: `{environment}-{microservice}-{level}-{name}-{timestamp}.json`.

### Test Editor

Click **+ Add Test** inside a Scenario, or click an existing test to open the editor modal.

**Tabs:**

| Tab | Description |
|---|---|
| **Params** | URL and query parameters. Edit params visually or type the full URL. |
| **Body** | Request body (for POST/PUT/PATCH). |
| **Auth** | Authentication configuration (see auth types below). |
| **Headers** | Key-value header pairs. |
| **Validation** | Configure response validation (see below). |

**Authentication Types:**

Select from a dropdown menu (similar to Insomnia):

| Type | Fields | Description |
|---|---|---|
| **Inherit from Scenario** | — | Uses the parent scenario's auth; if the scenario also inherits, walks up to the Feature Group |
| **No Auth** | — | No authentication |
| **Basic Auth** | Username, Password | Sends `Authorization: Basic <base64>` header |
| **Bearer Token** | Token, Prefix | Sends `Authorization: Bearer <token>` with customizable prefix |
| **API Key** | Key Name, Key Value, Location | Sends as a custom header or query parameter |
| **Digest Auth** | Username, Password | HTTP Digest authentication |
| **OAuth2 Client Credentials** | Token URL, Client ID, Client Secret | Acquires a real token at runtime via client credentials flow |

**Auth Inheritance Chain** (lowest → highest priority):

```
Global Auth Profile  →  Feature Group Auth  →  Scenario Auth  →  Test Auth
    (lowest)                                                       (highest)
```

- A **Test** set to "Inherit" resolves auth from its Scenario; if the Scenario also inherits, it walks up to the Feature Group, and then to the Global Auth Profile.
- A **Scenario** set to "Inherit from Feature" uses the Feature Group's auth config.
- A **Feature Group** set to "Inherit from Global Profile" uses a named Global Auth Profile defined in Settings.
- Each level can override by selecting its own auth type (Basic, Bearer, OAuth2, etc.).

**Auth Verification:**

Click the **Verify Auth** button (available at Feature, Scenario, and Test levels) to validate credentials:
- **OAuth2**: Actually calls the Token URL to acquire a token. On success, shows a token preview with expiration and scope.
- **Other types**: Confirms required fields are filled and shows a config summary.

**Secret Visibility Toggle:**

OAuth2 Client Secret fields include an eye icon toggle to show/hide the value.

**Color-Coded Auth Badges:**

Auth badges are color-coded by level for quick visual identification:

| Color | Meaning |
|---|---|
| **Purple (solid)** | Auth configured at Feature Group level |
| **Blue (solid)** | Auth configured at Scenario level |
| **Purple (outline)** | Scenario inheriting from Feature |
| **Green (solid)** | Test using its own auth |
| **Blue (outline)** | Test inheriting from Scenario |
| **Purple (outline)** | Test inheriting from Feature |
| **Gray (outline)** | No auth |

**Input Modes:**

- **Builder** (default): Fill in fields visually.
- **cURL Import**: Paste a cURL command to auto-populate all fields (URL, method, headers, body, auth).
- **cURL Export**: Generates a ready-to-use cURL command from the current config. For OAuth2 tests, it **fetches a real access token** and embeds it in the command. For Digest auth, it generates `--digest -u` flags. For API Key in query mode, the key is appended to the URL. Use the **Refresh** button to get a new token.
- **Export Template**: Generate a multi-sheet Excel (`.xlsx`) template from the current test for bulk test creation. A 3-step wizard guides you through: (1) select which URL path segments are variable, (2) review and customize auto-generated short column names, (3) preview both sheets and confirm download.

**Excel Template Format:**

The exported `.xlsx` file contains two sheets:

| Sheet | Purpose |
|---|---|
| **Data** | One row per test. Columns split into "Request" (blue headers) and "Response (Validation)" (green headers). First row has sample data from the original test. |
| **Metadata** | Read-only technical config: COLUMN MAPPINGS (short name → type → full path), CONFIG (method, URL pattern, auth, validation mode), and HEADERS sections with formatted tables. |

**Import Template:**

Import `.xlsx` or legacy `.csv` files to create tests in bulk. Two import methods are supported:
- **File picker**: Click to browse and select an Excel or CSV file.
- **Drag-and-drop**: Drag a file directly onto the import modal.

Import includes comprehensive validation:
- **File-level checks**: Missing sheets, invalid metadata structure, missing URL pattern or HTTP method.
- **Row-level checks**: Missing required data, malformed entries — with expandable error details per row.
- **Dynamic columns**: Columns in the Data sheet not defined in Metadata are automatically treated as validation fields.
- **Warnings**: Non-blocking issues (e.g., unmapped columns) displayed in a yellow box.

All three body validation modes are fully supported through the export/import round-trip: No Body Validation, Full JSON Match, and Selective Fields.

During import, choose the target:
- **Existing Scenario**: Add tests to an existing scenario.
- **New Scenario**: Create a new scenario inside an existing Feature Group.
- **New Feature Group**: Create a new Feature Group with a new scenario (auto-fills scenario name from filename).

**Verify Rules:**

Below the validation rules, a "Verify Rules" button invokes the API with the current test configuration and compares the response against the expected validation rules. Results are displayed in a table showing pass/fail status with detailed discrepancies (path, expected value, actual value). A host override option lets you target a different server for verification.

**Response Body Validation Modes:**

| Mode | Behavior |
|---|---|
| **No Body Validation** | Skips body comparison — only assertions (status, headers, timing, regex) run. |
| **Full JSON Match** | Deep-compares the entire response body against expected JSON. Shows a warning if no expected JSON is provided. |
| **Selective Fields** | Validates specific JSON paths. Supports **include** (check listed paths) or **exclude** (check all except listed paths). |

**Selective Validation Features:**

- **Visual JSON Path Builder**: Paste a sample JSON response, and a visual tree appears. Check/uncheck fields to build validation paths.
- **Manual Rule Entry**: Click "+ Add Manual Rule" to type custom JSON paths and expected values directly.
- **Unordered Array Matching**: Enable this to match array items regardless of their order (e.g., `offers[0]` can match `offers[3]` if field values match).
- **Smart Path Remapping**: If paths don't resolve (e.g., response wraps data in a key), the validator automatically tries common remapping strategies.

**Response & Validation Version History:**

Each test can maintain a history of response + validation rule snapshots for tracking API changes over time.

- **Auto-save on Fetch**: Each time "Fetch Response" returns new data, a version is automatically saved (if different from the latest).
- **Save as Version**: Click "Save as Version" to manually snapshot the current response JSON and all validation rules.
- **Duplicate Prevention**: Versions are only created when something actually changed. Comparison uses canonical JSON (sorted keys) and respects excluded paths — so dynamic fields like timestamps don't trigger false versions.
- **Restore**: Click "Restore" on any version to bring back both the response and the complete validation configuration (mode, expected fields, excluded paths, etc.).
- **Compare Modal**: Click "Compare" to open a full-screen diff modal with two tabs:
  - **Response** — side-by-side JSON diff with syntax highlighting (green for additions, red for removals, blue for modifications)
  - **Validation Rules** — diff of the validation mode, expected fields, excluded paths, and settings
- **Unordered Arrays toggle**: In the compare modal, enable "Unordered Arrays" to ignore element order when diffing arrays of objects.
- **Identical Banner**: A green checkmark banner appears when two versions are identical.
- **Rename & Delete**: Click a version label to rename it; click "Delete" to remove it.

**Fetch Response & Host Override:**

Above the sample JSON area, a single row provides:

- **Fetch Response** button — sends the current test request and populates the sample JSON with the actual API response. Auth credentials are applied automatically based on the inheritance chain.
- **Host Override** checkbox + input — when enabled, replaces the hostname in the test URL with a different base URL for the fetch only (does not modify the test). Click **Use Settings** to quickly fill in the configured base URL. The override value is preserved when toggling off/on.

### API Catalog

The **Catalog** section is the third pillar of RedfireForge — an OpenAPI/Swagger specification browser with interactive testing, cURL generation, and version tracking.

**Import & Browse:**

1. Click **Catalog** in the sidebar, then **Import API** to add an OpenAPI 3.0/3.1 or Swagger 2.0 spec (file upload or paste YAML/JSON).
2. The import modal previews the spec: title, version, servers, endpoints grouped by tag, and any warnings.
3. Imported APIs appear in the catalog sidebar with version badges and endpoint counts.
4. Select an API to see the **Overview** page: endpoint stats by method/tag, server list, security schemes, and quick action buttons.

**Endpoint Browser:**

- Endpoints are grouped by tag with a search/filter bar and method-colored badges (GET, POST, PUT, DELETE, PATCH).
- Click an endpoint to open the **Swagger-UI-style detail view**: summary, parameters with type hints/enums/required badges, request body schema, and response schemas.
- Edit parameter values, headers, and body directly in the forms.

**Interactive Testing ("Try It"):**

- Click **Try It** to execute the endpoint against a real server. Results display in a JSON tree viewer.
- **Host Strategy**: Choose "From Spec" (use servers from the spec), "Custom URL" (type any base URL), or "Environment" (per-API named environments configured via Edit).
- **Host Warning**: When using "From Spec" with a placeholder URL (e.g., `example.com`, `.test`, `.local`), an amber warning banner appears suggesting to switch to "Custom URL" or "Environment" mode.
- **Auth**: Configure authentication per API — Inherit from Spec, Global Auth Profile (OAuth2/Bearer/Basic/API Key), or manual credentials.
- **Verify Auth**: Test OAuth2 token acquisition with a single click.
- **Send to Harness**: Export endpoints directly to the Harness as test scenarios. POST/PUT/PATCH endpoints automatically get a sample request body generated from the OpenAPI schema (handles nested objects, arrays, enums, defaults).

**cURL Integration:**

- **Generate cURL** for any endpoint with real OAuth2 token acquisition, syntax highlighting, and single/multi-line toggle.
- Copy to clipboard with one click.

**Versioning:**

- Re-import updated specs to create new versions. The import flow detects existing APIs by title and offers "Update existing" or "Import as new".
- **Version History**: View all past imports with timestamps. Restore any previous version.
- **Visual Diff**: See added, removed, and changed endpoints between any two spec versions.
- Version history is capped at 10 per API (oldest auto-pruned).

**Environments & Persistence:**

- Right-click an API → **Edit** to configure per-API environments (name + base URL pairs), auth settings, and host strategy.
- All settings — auth tokens, endpoint form values (params, headers, body), environments, host strategy — survive browser refresh and server restart.

**Send to Requests:**

- Send individual endpoints or all endpoints from an API into a Requests collection for further ad-hoc testing.

### Requests (Ad-Hoc API Testing)

The **Requests** section provides an Insomnia/Postman-style interface for ad-hoc API testing, independent of the project-based test hierarchy.

**Key Concepts:**

| Concept | Description |
|---|---|
| **Collection** | A top-level group of requests. Can be `URL` mode (direct URLs) or `ENV` mode (multi-environment with base URL switching). |
| **Folder** (📁) | A pure grouping container for organizing requests within a collection. |
| **Sub-Collection** (📦) | A mini-collection within a collection — has its own auth, base URL overrides, and can pin to a specific environment. |
| **Request** | An individual HTTP request (GET, POST, PUT, PATCH, DELETE) with params, headers, body, and auth. |

**Features:**

- **Hierarchical organization**: Collections → Folders / Sub-Collections → Requests with unlimited nesting depth.
- **Drag-and-drop**: Move requests and folders within and across collections. Drag a collection onto another to convert it into a sub-collection.
- **Right-click context menus**: Add, rename, duplicate, move, export, import, and delete items.
- **Per-environment base URLs**: Configure hostnames per environment in collection settings. URLs are dynamically resolved — the editor shows relative paths with the full resolved URL displayed separately.
- **Sub-collection environment pinning**: A sub-collection can lock to a specific environment, showing only that environment's base URL.
- **Auth inheritance**: Requests inherit auth from their collection, or override with Bearer, Basic, API Key, OAuth2, or a Global Auth Profile.
- **cURL import/export**: Paste a cURL command to create a request; generate cURL from any request (OAuth2 tokens fetched automatically).
- **JSON import/export**: Export collections or folders as JSON files; import them with duplicate name validation.
- **Console trace**: View detailed request/response trace (headers, timing, body) similar to Insomnia's console.
- **Collapsible JSON tree response viewer**: Response bodies rendered as an expandable/collapsible tree with search, match navigation, and highlight.
- **Response caching**: Responses are preserved per-request when navigating between requests.
- **Query parameter management**: Enable/disable parameters without deleting them; order is preserved.
- **Confirmation dialogs**: Delete actions require confirmation, showing the count of affected items.
- **Duplicate name prevention**: Collection, folder, and sub-collection names must be unique at the same level.

**Unified Sidebar:**

The left sidebar uses a vertical **Requests | Catalog | Harness** nav rail:
- **Requests** shows the collection tree with drag-and-drop, context menus, and inline folder creation.
- **Catalog** shows imported API specs with version badges and endpoint counts.
- **Harness** shows project-based navigation (Feature Groups, Environments, Microservices) for regression and performance testing.
- The sidebar is resizable (drag the right edge) and collapsible (toggle button).
- **Settings** is always accessible at the bottom of the sidebar.

### Test Runners

RedfireForge provides three specialized runners for different test types:

| Runner | Purpose | Input |
|---|---|---|
| **Test Runner** | Standard scenario load testing | Standard scenarios (no data sources) |
| **Parameterized Runner** | Data-driven testing | Parameterized scenarios (CSV/Excel data) |
| **Workflow Runner** | Multi-step flow testing | Workflows from the Designer |

Navigate to **Testing** in the Activity Bar, then select the appropriate runner tab.

**Scenario Types:**

When creating a scenario in Feature Groups, you choose its type — **Standard** or **Parameterized**. Each runner only shows matching scenarios. This prevents confusion about how iterations interact with data rows.

**Host Selection:**

Choose which hostname is used at runtime:

| Option | Behavior |
|---|---|
| **Original** | Uses the hardcoded URL from the test definition as-is. |
| **Settings** | Replaces the hostname/port with the base URL configured in Settings for the current environment/microservice. Disabled if no URL is configured. |
| **Custom** | Type a temporary base URL — useful for testing against a specific instance without changing Settings. |

**Execution Modes:**

| Mode | Concurrency | How It Works |
|---|---|---|
| **Sequential** | Fixed to 1 | Executes one request at a time, in order. No parallelism — useful for testing exact request sequences or when the target service cannot handle concurrent load. |
| **Batch** | N | Fires N requests simultaneously, waits for **all N** to complete, then fires the next N. Simple and predictable, but idle slots wait for the slowest request. |
| **Continuous Pool** | N | Maintains exactly N requests in-flight at all times. When **any single** request completes, a new one starts immediately. Maximizes throughput with zero idle time. |
| **Constant Arrival** | Open model | Fires exactly N requests/second regardless of response time (open-model load generation). Configurable target RPS, duration, max in-flight limit, and optional ramp period. Desktop only (uses Rust arrival executor). |

**Configuration:**

All execution settings are grouped in a single unified card below the Execution Mode selector.

| Field | Description |
|---|---|
| **Concurrency** | Number of parallel requests (1–100). Fixed to 1 in Sequential mode. Disabled (visible) in Load Profile mode. |
| **Iterations** | How many times each test runs. For parameterized tests: iterations × data rows = total requests. |
| **Timeout** | Per-request timeout in seconds (0 = unlimited, default 10s). Timed-out requests are recorded as failures. |
| **Retry** | Number of retry attempts on failure (0–10). When > 0, a Retry Delay field appears. |
| **Retry Delay** | Milliseconds to wait between retry attempts (shown only when Retry > 0). |
| **On Error** | Error policy: **Continue** (ignore errors), **Stop 1st** (halt on first failure), or **Threshold** (halt when Max Errors count or Error Rate % is exceeded). |
| **Max Errors** | Stop after this many errors (only active in Threshold mode). |
| **Error Rate** | Stop when error percentage exceeds this value (only active in Threshold mode, requires minimum 10 samples). |
| **Skip Validation** | Checkbox in the scenario selection header. Disables all response validation for pure throughput testing. |

**Running a Test:**

1. Select one or more scenarios using the checkboxes. Use **Skip validation** to disable response checks or **Unordered arrays** to force order-independent array matching for all tests.
2. Review the **Execution Plan Preview** — shows exact request count before you run.
3. Configure concurrency, iterations, timeout, retry, and error policy.
4. Optionally configure **Think Time** to add realistic delays between requests (None, Constant, Uniform random, or Gaussian distribution).
5. Optionally add **Rich Assertions** in the Validation tab — 16 assertion types (status, responseTime, header, regex, arrayLength, numeric, date, typeCheck, existence, arrayContains, each, containsSubset, jsonSchema, bodySize, datePrecise, custom), 24 field operators, Data Mapper with bi-directional DSL editor.
6. Click **▶ Run Test**.
7. A live progress bar shows completion percentage, current TPS, average response time, and error rate.
8. Click **■ Stop** to abort early. The circuit breaker may also stop the run automatically based on the error policy.
9. When complete, results auto-navigate to the Results tab.

All runner settings (concurrency, iterations, timeout, retry, error policy, think time, selected scenarios, host mode, execution mode, skip validation) are **persisted across sessions**.

**Worker Thread Architecture:**

Test execution automatically runs in a **Web Worker** (separate thread) when the browser supports it, keeping the UI fully responsive during runs:

```
Main Thread (UI)                Worker Thread (Engine)
─────────────────               ─────────────────────
React rendering                  runTest()
Progress bar updates             ├── HTTP requests
Live charts (60fps)              ├── Response validation
User interactions (abort,        ├── Think time delays
  scroll, click)                 ├── Circuit breaker logic
State management                 └── Metrics tracking
     ▲                                │
     │      postMessage (progress)    │
     └────────────────────────────────┘
```

| Benefit | Detail |
|---|---|
| **Responsive UI** | Main thread is free for rendering — no stuttering during high-concurrency runs, no "page unresponsive" warnings |
| **Accurate metrics** | Engine timing isn't skewed by React reconciliation or DOM repaints competing for CPU |
| **Parallel execution** | On multi-core machines, engine and UI truly run simultaneously (10–30% throughput improvement on CPU-bound validation-heavy tests) |
| **Tauri support** | In desktop mode, HTTP requests are proxied from the worker back to the main thread via `postMessage` so the Tauri HTTP plugin (main-thread only) is still used |
| **Automatic fallback** | If Web Workers are unavailable, falls back to direct main-thread execution (same behavior as before) |

> **Note:** This is primarily a **responsiveness and reliability** improvement. HTTP throughput is still bounded by network I/O and browser connection limits (~6 per origin for HTTP/1.1). The worker offloads CPU-bound work (validation, metrics, serialization) — it does not bypass network constraints.

### Workflow Designer

Navigate to the **Workflow** tab (fourth tab) to build multi-step API test workflows with visual graph editing.

**Visual Graph Editor:**

- **Canvas**: React Flow-based infinite canvas with pan, zoom, and minimap navigation
- **Node Palette**: Drag-and-drop nodes onto the canvas — HTTP requests, Conditions (If/Else), Delays, Start/End markers, Fork/Join for parallel execution, Switch/Loop/SetVariable/Aggregate for advanced control flow, Webhook/Schedule triggers for event-driven workflows
- **Connections**: Click and drag from output handles to input handles to create edges between nodes
- **Auto-Layout**: Click the auto-layout button in the canvas controls to apply Dagre hierarchical layout with smart centering and overlap resolution

**Node Types:**

| Node Type | Purpose | Features |
|---|---|---|
| **Start** | Entry point for workflow execution | Green node marking where execution begins; workflows auto-start from Start nodes when running Quick Test |
| **HTTP** | Execute an API request | Same configuration as Harness tests: method, URL, headers, body, auth, validation; extract variables from response via JSONPath; inline `{{` autocomplete in URL, headers, body, and extraction fields |
| **Condition** | If/Else branching | Compare two values (left vs right) with operators (`==`, `!=`, `>`, `<`, contains, regex); supports template variables; branches to True/False output handles; searchable variable picker with grouped results and type badges; expression mode with inline autocomplete |
| **Delay** | Think time between steps | Pause execution for fixed/random duration (constant, uniform, gaussian); simulates realistic user behavior |
| **Fork** | Parallel execution split | Spawns multiple parallel execution paths; each output handle runs concurrently |
| **Join** | Parallel execution merge | Waits for all incoming paths to complete before continuing; synchronization point |
| **Switch** | Multi-way branching | Evaluate expression against defined cases; each case creates an output path; unmatched values follow the Default path; visual badge showing expression and case count |
| **Loop** | Iterative execution | Three modes: Count (fixed iterations), ForEach (iterate JSON array with item/index variables), While (condition-based); configurable max iterations safety limit |
| **SetVariable** | Variable assignment | Assign variable name/value pairs during execution; supports template expressions; variables available to all downstream nodes |
| **Aggregate** | Data collection | Collect and combine values across loop iterations; source→target mappings with strategies: concat, sum, count, first, last, array |
| **End** | Terminal state | Marks workflow completion; stops execution even if other nodes haven't run yet |
| **Webhook Trigger** | HTTP endpoint trigger | Configure HTTP method, endpoint path, and sample payload; extract variables via JSONPath for downstream nodes; visual badge with method/path/extraction count |
| **Schedule Trigger** | Cron-based trigger | 5-field cron expression with timezone support; human-readable schedule description; automatic `{{triggerTime}}` (ISO) and `{{triggerTimestamp}}` (epoch) variables |
| **Kafka Trigger** | Kafka topic subscription trigger | Subscribe to a Kafka topic; extract variables via JSONPath from the message body; key/header/jsonpath filters; `kafka.trigger.*` context variables; bounded concurrency via pause/resume |
| **Kafka Produce** | Publish a message to Kafka | Configurable topic, key, body (template), headers, ack mode, schema encoding (Avro/Protobuf/JSON Schema); output bindings extract partition/offset/timestamp |
| **Kafka Consume** | Consume messages from Kafka | Fetch up to N messages from earliest/latest; filter by key, headers, JSONPath equals; schema decoding; output bindings map message fields to variables |
| **Kafka Wait** | Pause until a correlated Kafka reply | Waits for a message matching a correlation ID expression; extracts variables from the response body; supports synthetic-inject mode for Quick Test / load testing |

**Parallel Execution:**

Fork and Join nodes enable true parallel execution:
- **Fork** splits execution into multiple concurrent paths — each path executes independently
- **Join** waits for all incoming branches to complete before proceeding downstream
- HTTP requests on parallel paths execute concurrently (respecting overall concurrency limits)
- Condition branches can also execute in parallel when multiple outgoing edges exist

**Variable Context:**

- **Workflow Variables**: Define default variables in the Workflow Variables modal (toolbar button) — shared across all nodes
- **Node Variables**: Each HTTP node can define initial variables that override workflow defaults
- **Variable Extraction**: Extract values from HTTP responses via JSONPath, headers, or status code — scoped to downstream nodes
- **Template Resolution**: Use `{{variableName}}` syntax in URLs, headers, body, and auth fields — inline autocomplete suggests available variables as you type `{{`
- **Expression Functions**: Type `$` in any expression field to access built-in functions (`$upper`, `$concat`, `$jsonpath`, etc.) with inline autocomplete
- **Built-in Generators**: `{{$uuid}}`, `{{$timestamp}}`, `{{$randomInt}}`, `{{$isoDate}}`, `{{$randomEmail}}`, `{{$randomString(N)}}`

**Service Registry:**

- Configure external service endpoints per environment (similar to microservices in Harness mode)
- HTTP nodes reference services by ID — URLs auto-resolve based on selected environment
- Supports multi-environment testing: switch environments to test the same workflow against dev/QA/prod

**Quick Test Execution:**

- Click **Quick Test** in the toolbar to execute the workflow immediately with step-through debugging
- Each node shows real-time status: ⏳ Running, ✓ Pass, ✗ Fail, ⊘ Skipped
- Click **Step** to advance one node at a time; **Step All** to run to completion; **Resume All** to disable stepping
- Join nodes show "Waiting for N threads" status when blocked on parallel paths
- View response data for each HTTP node by clicking the node after execution

**Sample Workflows:**

- Click **Browse Samples** in the sidebar to load pre-built workflow templates
- Samples demonstrate common patterns: linear sequences, parallel API calls, conditional branching, error handling
- Click **Use as Template** to save a sample workflow to your workspace (auto-generates unique IDs)

**Workflow Persistence:**

- Workflows are saved automatically in local storage (browser) or Tauri's app-data directory (desktop)
- Node positions, connections, variables, and service configurations are all persisted
- Export/import workflows via JSON for sharing or version control
- **Viewport persistence**: Canvas pan/zoom position is saved when switching tabs and restored when returning to the Workflow tab. Click "Save layout" in the canvas controls to persist the viewport across sessions.

### Results Dashboard

Navigate to the **Results** tab (third tab).

**Layout:**

- **Row 1**: "Results" heading, context tags (environment, microservice, host, execution mode with `C:` and `I:`), and action buttons (Refresh, Export JSON, Export CSV, Delete) aligned to the far right.
- **Row 2**: Full-width dropdown listing historical runs filtered by the selected environment/microservice. Each entry shows timestamp, service, environment, request count, and TPS.

**Summary Metrics (Row 1):**

| Metric | Description |
|---|---|
| **TPS / TPM / TPH / TPD** | Throughput: transactions per second, minute, hour, day. |
| **Avg Response** | Mean response time across all requests. |
| **Min / Max** | Fastest and slowest individual request. |

**Summary Metrics (Row 2):**

| Metric | Description |
|---|---|
| **P95 / P99** | 95th and 99th percentile response times. |
| **Error Rate** | Percentage of requests that returned non-2xx status. |
| **Total Duration** | Wall-clock time from first to last request. |
| **Total Requests** | Number of requests executed. |
| **Validation Failures** | Count of requests that failed response validation. |

**Response Time Distribution:**

A bar chart shows the distribution of response times in histogram buckets.

**Request Details Table:**

- **Group By**: Cascade grouping with three levels — Feature, Scenario, or Test Name (flat). Select a primary group, then a sub-group (e.g., Feature → then by Scenario). Collapsible rows show per-group stats: total, passed, failed, validation failed, avg/min/max response times.
- **Detail Column Headers**: When expanding a group to individual results, a header row appears with Test Name, URL, Status, Validation, Time, Passed, and Error/Details columns.
- **Error Snippets**: Failed requests show a clickable error snippet (red chip for HTTP errors, orange for validation failures) truncated to 100 characters.
- **Response Detail Modal**: Click any error snippet to open a modal with: method badge, test name, status code, timing, full URL, error message, validation failures table (path/expected/actual), and the complete response body (formatted JSON, scrollable).
- **Search**: Text search filters results by name, URL, feature group, scenario, or error message.
- Filter by pass/fail status (All, Passed Only, Failed Only).
- Flat view with pagination for individual request details (method, URL, status, response time, validation).
- Alternating row stripes for readability.

**Export:**

- **Export JSON**: Full run data as structured JSON.
- **Export CSV**: Flat table suitable for spreadsheets.
- All exports use a native "Save As" dialog with sensible default filenames.

#### Results Explorer (Workflow Runs)

After running a workflow, click **📊 Results Explorer** to open a full-screen modal for visual execution analysis.

**Three-Panel Layout:**

- **Left — Workflow Diagram**: Read-only React Flow canvas showing execution state. Nodes colored green (pass), red (fail), or gray (skipped). Traversed edges show animated flowing dash; untaken edges are gray dashed. Heatmap gradient colors nodes by avg response time. Bottleneck nodes get a pulsing border.
- **Right — Detail Panel**: Click any node for tabbed details (Overview, Request, Response, Variables, Assertions). Shows hero stats, timing breakdown, per-iteration drill-down.
- **Bottom — Iteration Matrix**: Collapsible table (rows = iterations, columns = HTTP nodes) with sort, filter, error search, and cell click to jump to node+iteration.

**Key Features:**

| Feature | Description |
|---------|-------------|
| **Search & Filter** | Search bar to find nodes by name; filter buttons (All / Pass / Fail / Skipped). Non-matching nodes dimmed. Press `/` to focus. |
| **Save Layout** | Drag nodes to custom positions and save via pill controls. Restored automatically on next open. |
| **Heatmap** | Nodes colored green→yellow→orange→red by avg duration. |
| **Bottleneck Analysis** | Identifies time-dominant, high-variance, and high-failure nodes with suggestions. |
| **Edge Traversal %** | Branching edges show traversal percentage labels in aggregate view. |
| **Iteration Picker** | Rich dropdown with filter tabs (All / Failed / Slowest), jump-to-# search. |
| **Export** | Export trace as JSON or aggregate metrics as CSV. Import previously exported traces. |
| **Keyboard Shortcuts** | `←/→` iterate, `1-9` jump, `Space` toggle, `A` aggregate, `M` matrix, `/` search, `Esc` close. |

**Requirements:** Enable **"Capture Full Trace"** in Workflow Runner config before running to capture request/response details. Without it, only timing and pass/fail data are available.

---

## Feature Reference

| Feature | Description |
|---|---|
| Native desktop app | Built with Tauri — native window, file system storage, no CORS issues |
| Dual-mode (desktop + web) | Runs as desktop app or browser SPA; auto-detects environment |
| Dark / light mode | Toggle between dark and light themes; preference persisted |
| Hierarchical test organization | Feature Group → Scenario → Test |
| Visual test builder | Point-and-click editor for URL, headers, body, auth, validation |
| cURL import/export | Paste cURL to create tests; generate cURL with live OAuth2 tokens |
| Multiple auth schemes | None, Inherit, Basic, Bearer Token, API Key, Digest, OAuth2 Client Credentials |
| Global auth profiles | Named reusable auth configurations in Settings; Feature Groups can inherit from them |
| Auth inheritance chain | Global Profile → Feature → Scenario → Test with visual color-coded badges (purple/blue/green) |
| Auth verification | Verify credentials at any level; OAuth2 acquires a real token |
| Full & selective validation | Deep JSON compare, specific path checks, unordered arrays |
| Visual JSON path builder | Click fields in a sample JSON tree to build validation rules |
| Smart path remapping | Auto-detects and remaps JSON paths when structure differs |
| Multi-sheet Excel template export | 3-step wizard: select path variables → customize column names → review & download styled `.xlsx` with Data + Metadata sheets |
| Excel/CSV template import | Import `.xlsx` or legacy `.csv` with file-level and row-level validation, dynamic column detection, all three validation modes |
| Drag-and-drop file import | Drag Excel/CSV files directly onto the import modal; auto-fills scenario name from filename |
| Response Detail modal | Click error snippets on failed results to view full error message, validation failures table, and response body |
| Verify validation rules | Invoke API and compare response against expected validation rules with host override |
| Auto-refreshing OAuth2 tokens | Shared token cache with JWT expiry detection; auto-refresh with 30s buffer, no duplicate requests |
| Sequential, batch, pool & constant arrival execution | Four execution modes: one-at-a-time, parallel batches, continuous pool, or constant arrival rate (open model, desktop only) |
| Dynamic host replacement | Swap hostnames at runtime via Settings or custom URL |
| Fetch host override | Override hostname when fetching sample responses in the Validation tab, with enable/disable toggle; persisted across editor sessions |
| Response version history | Save, restore, rename, and delete response + validation rule snapshots per test |
| Visual diff comparison | Full-screen modal with side-by-side JSON diff (response + validation rules), monokai dark theme |
| Duplicate version prevention | Auto-detects unchanged responses using canonical JSON comparison with excluded-paths support |
| Unordered array diffing | Compare arrays ignoring element order, including arrays of complex objects |
| Request timeout | Per-request timeout (0–300s, default 10s); timed-out requests move to next test |
| Retry on failure | Retry failed requests up to N times with configurable delay between attempts |
| Error policy (circuit breaker) | Continue, stop on first error, or stop at error count/rate threshold |
| Unified execution config | Execution Mode, Concurrency, Iterations, Timeout, Retry, Error Policy in one card |
| Constant arrival rate | Open-model load generation: send N RPS regardless of response time; configurable target RPS, duration, max in-flight, ramp period; Rust executor (desktop only) |
| Streaming percentiles | Memory-efficient P50/P95/P99/P99.9 via HDR Histogram in Rust; accurate at 100K+ results without storing every datapoint |
| Skip validation toggle | Disable response checks for raw throughput testing |
| Unordered arrays toggle | Force unordered array matching globally — handles APIs returning arrays in non-deterministic order |
| Rich assertions | Status code (`200`, `2xx`, `200-299`), response time SLA (`≤ 500ms`), header validation (`equals`/`contains`/`regex`/`exists`), regex on JSONPath values — run on every request alongside JSON validation; **Regex Builder modal** with JSON tree picker, pattern library (17 presets), and live match preview; assertion type badges on test cards |
| Think time & pacing | Configurable delays between requests (constant, uniform random, gaussian distribution) for realistic virtual user simulation |
| Worker thread execution | Test engine runs in a Web Worker for responsive UI at 60fps; validation/metrics/orchestration offloaded to separate thread; Tauri HTTP proxied through main thread; automatic fallback when Workers unavailable; incremental result transfer |
| Connection pooling | HTTP connections reused via `keep-alive` with shared `undici.Agent` pool (30s timeout, 128 connections); eliminates TCP/TLS handshake overhead; 2–3x latency improvement for HTTPS APIs; Tauri natively pooled via `reqwest` |
| Weighted test distribution | Control relative frequency of each test |
| Live progress monitoring | Real-time TPS, response times, and error rates during runs (throttled updates, incremental metrics) |
| **Trash Box** | Soft-delete with configurable retention (7–90 days) for Feature Groups, Scenarios, Tests, and Shared Data Sources; 5-second undo toast, Trash Panel for browse/search/restore, automatic purge on startup |
| **GraphQL Studio** | Multi-tab query workspace with Monaco editor, introspection-driven schema explorer, variables/headers/auth panels, history, collections runner, batch execution (select tabs → Send Batch → per-tab response slices + full batch modal), SDL schema diff, connection profiles, TLS/mTLS settings, mock server mode, and workflow integration hooks |
| **Learning Hub (Demo)** | Interactive protocol lessons in `@redfireforge/demo-hub` (`packages/demo-hub/`) — GraphQL GQL-1–19 complete (Phase 8 human 19/19; E2E sweep 20/20), gRPC GRPC-1–24 (incl. Workflow Runner & Results), Kafka, WebSocket, etc.; live studio bridges, prerequisite gates, Docker health probes, §11.0 workspace isolation, per-lesson notes — ships as `npm run tauri:build:demo` |
| Persistent configuration | All settings saved across sessions (file system in desktop, IndexedDB + localStorage in browser) |
| Results filtering | Filter runs by environment and microservice |
| Multi-level grouped results | Group by Feature → Scenario → Test with cascading sub-groups and per-group summary stats |
| Advanced search (Scenario Builder) | Boolean search: AND, OR, NOT/-, "quoted phrases", (parentheses); searches name, URL, method, headers, body, auth, validation |
| Results search | Filter request details by name, URL, feature, group, or error message |
| Host badge on Progress | Active host (Settings/Custom/Original) displayed next to execution mode in Progress section |
| Rich metrics dashboard | TPS/TPM/TPH/TPD, percentiles, error rates, response distribution |
| JSON & CSV export | Export results with native file picker dialog |
| Export Center | Selectively export any combination of environments, microservices, global auth profiles, features, and runs |
| Import Center | Import exported JSON files with per-item conflict detection (ID/name match), side-by-side comparison, and resolution (skip, overwrite, keep both) |
| Import conflict detection | Feature Group, Scenario, and Test imports warn on duplicates with confirmation dialogs |
| Consistent export naming | All exports follow `{env}-{svc}-{level}-{name}-{timestamp}.json` naming convention |
| Storage management | Monitor usage, configure max runs, auto-prune old data, graceful quota-exceeded recovery |
| Requests (ad-hoc testing) | Insomnia/Postman-style request editor with collections, folders, sub-collections, and drag-and-drop |
| Requests collection hierarchy | Collections → Folders (📁) / Sub-Collections (📦) → Requests with unlimited nesting |
| Requests drag-and-drop | Move requests, folders, and entire collections between any containers; drag collection onto another to merge as sub-collection |
| Requests per-env base URLs | Configure hostnames per environment; URLs dynamically resolve with relative path display |
| Requests sub-collection pinning | Sub-collections can pin to a specific environment with locked URL resolution |
| Requests console trace | Insomnia-style request/response trace with headers, timing, and body |
| Collapsible JSON tree viewer | Response bodies as expandable tree with search, match count, prev/next navigation, and collapse/expand all |
| Requests response caching | Responses preserved per-request during navigation |
| Requests JSON import/export | Export/import collections and folders as JSON with duplicate name validation |
| Unified sidebar (Requests + Catalog + Harness) | Vertical nav rail with resizable width, collapse toggle, and persistent Settings access |
| Collapsible sidebar | Toggle sidebar visibility from anywhere, including modals |
| Drag-and-drop | Move and reorder scenarios between Feature Groups and tests between scenarios via drag handles |
| Feature presence indicator | Sidebar color-codes items with/without Feature Groups |
| **Data Mapper** | Visual field mapping component: drag source fields to target drop zones, expression editor (125 functions + lambda syntax with live preview), auto-map with accept/reject, type mismatch detection & auto-fix, live preview bar, **24 field operators** (equality, comparison, string, boolean, existence, type check, set membership with color-coded pills), **array assertions** (LENGTH, CONTAINS, EACH, SUBSET), **universal negation** (NOT modifier on any operator), **Validation Rules Modal** (docked/floating/maximized Monaco code editor with syntax highlighting, autocomplete, inline errors, pass/fail decorations), **DSL Reference Panel** (8-category accordion with search, insert, copy), **ASSERT custom predicates** (125+ expression functions, lambda syntax), **live verification** (per-node pass/fail badges, canvas line coloring, toolbar stats, Mapping View status column), **Mapping View** (Code/List/Pivot table with resize, panel collapse), bi-directional visual ↔ code sync, schema drift/repair, mapping profiles, keyboard navigation, hover-to-highlight, failure navigation. 10 adapters: validation, extraction, requestBody (JSON/Form/Raw), assertion, columnMapping, populateFromApi, sharedDsFetch, variableBinding, webhookExtraction, demo |
| **Parameterized Testing** | Data-driven testing with inline data sources — define one test pattern, run against N data rows |
| Data Source Editor | Inline spreadsheet-style table editor with columns (path, param, header, body, validate) and rows |
| Column types | `path:` replaces URL variables, `param:` adds query params, `header:` sets headers, `body:` fills body placeholders, `validate:` asserts response values |
| CSV/Excel/JSON import | Import data from external files with column detection and validation |
| Row tags & filtering | Categorize rows with tags (e.g., `smoke`, `regression`); filter by tag when running |
| Row enable/disable | Toggle individual rows without deleting; disabled rows are skipped during execution |
| Bulk operations | Select multiple rows (Ctrl+click, Shift+click) for bulk enable/disable/delete/duplicate |
| Drag-to-reorder rows | Reorder data rows via drag handles |
| Row labels & notes | Human-readable labels and annotations per row, shown in results |
| Distribution modes | Sequential, Random, or Round Robin row execution order |
| Sample rows | Mark rows as samples for selective validation mode |
| Pre-validation (Verify All) | Test all rows against the live API before committing to a full run |
| Populate from API | Send a request, extract an array from the response, map fields to columns — auto-generate data rows |
| Create Parameterized Copy | Convert any normal test into a parameterized version with auto-detected variables |
| Re-run failed rows | After a run, re-run only the rows that failed — saves time on large data sets |
| Grouped results | Results dashboard groups parameterized test results by data row with pass/fail status |
| **Shared Data Sources** | Top-level data sources shared across multiple tests — edit once, update everywhere |
| Shared DS modal | Dedicated modal for managing shared data sources with list panel, editor, and fetch config |
| Cross-test linking | Link any parameterized test to a shared data source; changes propagate automatically |
| "Used by" section | See which tests are linked to each shared data source |
| Promote/demote | Promote inline data to a shared source, or demote (detach) to create an independent copy |
| Impact warnings | Save confirmation modal shows affected tests when modifying shared data |
| Auth inheritance | Shared data sources can inherit auth from linked tests for API verification |
| Fetch config | Optional URL/method/headers/body for API-driven population and verification |
| **API Catalog** | Import OpenAPI 3.0/3.1 and Swagger 2.0 specs; browse endpoints in Swagger-UI-style detail view |
| Catalog endpoint browser | Tag-grouped endpoint list with search/filter, parameter forms, request body editor, response schemas |
| Catalog "Try It" testing | Execute endpoints interactively with host strategy (From Spec / Custom URL / Environment) and auth config |
| Catalog cURL generation | Generate cURL commands per endpoint with real OAuth2 token acquisition, syntax highlighting, copy to clipboard |
| Catalog versioning | Re-import updated specs with version history, visual endpoint diff (added/removed/changed), and restore |
| Catalog environments | Per-API environment configuration with name + base URL pairs; "Environment" host strategy |
| Catalog auth panel | Inherit from Spec, Global Auth Profile (OAuth2/Bearer/Basic/API Key), Verify Auth with token validation |
| Catalog persistence | Auth tokens, form values, environments, and host strategy survive refresh and restart |
| Catalog overview page | API summary with endpoint stats by method/tag, server list, security schemes, quick actions |
| Catalog "Send to Requests" | Copy endpoint(s) as RequestItem objects into a Requests collection |
| **CLI Runner** | Execute tests from YAML/JSON files via `redfireforge run` — same engine as the GUI |
| CLI validate | `redfireforge validate` checks file structure without executing |
| JUnit XML reports | `--junit report.xml` for CI/CD dashboards (GitHub Actions, Jenkins, GitLab CI) |
| JSON / Markdown reports | `-o report.json` and `--markdown report.md` for machine-readable and human-readable output |
| CI exit codes | `--fail-on-error` and `--fail-threshold` for quality gates in pipelines |
| YAML/JSON test files | Declarative test definitions with `baseUrl`, `defaults`, `config`, auth, validation |
| CLI base URL override | `--base-url` flag replaces all relative URLs at runtime |
| Native HTTP (desktop) | Tauri HTTP plugin bypasses CORS — no proxy needed |
| Node.js HTTP (CLI) | Native `fetch` with auto-detected proxy support (`HTTP_PROXY`/`HTTPS_PROXY`) |
| CORS proxy (web) | Built-in Vite server proxy for browser mode |
| Cross-platform builds | macOS (ARM + Intel), Windows, Linux via GitHub Actions CI/CD |
| Hot-reload development | `npm run tauri:dev` gives instant UI updates in the desktop window |

---

## Branching Strategy & Versioning

### Branch Model (Git Flow)

```
master          ← stable releases      (v1.0.0)
  └─ release/*  ← release candidates   (v1.0.0-beta.1)
  └─ develop    ← integration branch   (v1.0.0-alpha.1)
       └─ feature/*  ← feature work    (v1.0.0-dev.1)
```

| Branch | Purpose | Version tag | Merge target |
|---|---|---|---|
| `master` | Production-ready releases | `1.0.0` | — |
| `release/<ver>` | Stabilisation & QA before release | `1.0.0-beta.N` | `master` |
| `develop` | Integration of completed features | `1.0.0-alpha.N` | `release/*` |
| `feature/<name>` | Individual feature development | `1.0.0-dev.N` | `develop` |

### Version Bump Script

A single script updates the version across all three config files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) and applies the correct pre-release tag based on the current branch:

```bash
# On master — stable release
./scripts/version.sh minor              # 0.1.0 → 0.2.0

# On develop — alpha build
./scripts/version.sh minor --pre 1      # 0.1.0 → 0.2.0-alpha.1

# On release/0.2.0 — beta build
./scripts/version.sh minor --pre 1      # 0.1.0 → 0.2.0-beta.1
./scripts/version.sh minor --pre 2      # 0.1.0 → 0.2.0-beta.2

# On feature/* — dev build
./scripts/version.sh patch --pre 1      # 0.1.0 → 0.1.1-dev.1
```

### Typical Release Flow

```
1.  feature/xyz  →  develop             (merge feature)
2.  develop: ./scripts/version.sh minor --pre 1    → 0.2.0-alpha.1
3.  develop  →  release/0.2.0           (create release branch)
4.  release/0.2.0: ./scripts/version.sh minor --pre 1  → 0.2.0-beta.1
5.  (QA & bug fixes on release branch)
6.  release/0.2.0  →  master            (merge to master)
7.  master: ./scripts/version.sh minor  → 0.2.0
8.  git tag v0.2.0
```

The version is displayed in the app header as a badge (e.g., `v0.1.0`, `v0.2.0-alpha.1`).

---

## Development Workflow

### Day-to-Day Development

Use the Tauri dev mode for the best experience:

```bash
npm run tauri:dev
```

This launches the native desktop window with **hot-reload** — any changes to React components, styles, or logic are reflected instantly in the desktop window. No manual rebuild needed.

| Command | What it does | Use when |
|---|---|---|
| `npm run tauri:dev` | Desktop app with hot-reload | Day-to-day development (recommended) |
| `npm run dev` | Browser-only at `localhost:5173` | Quick UI tweaks, no Rust needed |
| `npm run tauri:build` | Production build for current OS | Testing the final binary locally |

### Making Changes

1. Edit files in `src/` (React/TypeScript) — changes appear instantly in the desktop window via hot-reload.
2. Edit files in `src-tauri/` (Rust/config) — Tauri automatically recompiles the Rust backend (~15-20 sec).
3. When satisfied, build a local production binary with `npm run tauri:build` (~45 sec).
4. To release for all platforms, push a version tag (see CI/CD below).

### Project Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server (browser-only mode) |
| `npm run build` | Build the web frontend for production |
| `npm run preview` | Serve the production web build locally |
| `npm run tauri:dev` | Launch desktop app with hot-reload |
| `npm run tauri:build` | Build desktop app for current OS |
| `npm test` | Run unit + integration test suite (Vitest, 19,112 tests) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report (>90% all files) |
| `npm run test:e2e` | Run Playwright E2E tests (660 tests, Chromium) |
| `npm run test:e2e:headed` | Run E2E tests with visible browser |
| `npm run lint` | Run ESLint |
| `./scripts/version.sh` | Bump version across all config files |
| `ENV=test COUNT=100 node scripts/generate-csv-from-db.cjs` | Generate CSV test template from a JSON query dump |

---

## CI/CD & Multi-Platform Releases

### Automated Builds

The project includes a GitHub Actions workflow (`.github/workflows/release.yml`) that builds installers for all platforms:

| Platform | Runner | Artifacts |
|---|---|---|
| **macOS ARM64** (Apple Silicon) | `macos-latest` | `.app`, `.dmg` |
| **macOS x64** (Intel) | `macos-latest` | `.app`, `.dmg` |
| **Linux x64** | `ubuntu-22.04` | `.deb`, `.AppImage` |
| **Windows x64** | `windows-latest` | `.msi`, `.exe` |

### How to Release

1. Commit and push your changes:

```bash
git add .
git commit -m "your changes"
git push origin main
```

2. Create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions automatically:
   - Builds on all 4 platform targets in parallel (~5-10 min)
   - Creates a **draft GitHub Release** with all installers attached
4. Go to the GitHub Releases page, review the draft, and click **Publish**.

You can also trigger a build manually from the **Actions** tab → **Build & Release** → **Run workflow** (no tag required).

### End-User Installation

End users download the installer for their OS from the GitHub Releases page. No development tools required — the installers are fully standalone:

- **macOS**: Open the `.dmg`, drag `RedfireForge.app` to Applications
- **Windows**: Run the `.msi` or `.exe` installer
- **Linux**: Install the `.deb` package or run the `.AppImage` directly

---

## Data Persistence

### Desktop Mode (Tauri)

Data is stored as individual JSON files in the OS application data directory:

- **macOS**: `~/Library/Application Support/com.redfireforge.desktop/`
- **Windows**: `%APPDATA%/com.redfireforge.desktop/`
- **Linux**: `~/.local/share/com.redfireforge.desktop/`

This means data persists across browsers and is shareable via file copy.

### Web Mode (Browser)

Data is stored using a tiered storage strategy:

**IndexedDB (Primary — for large data)**

| Store | Content |
|---|---|
| `featureGroups` | Feature Groups, Scenarios, Tests, and inline Data Sources |
| `testRuns` | Historical test run results |
| `sharedDataSources` | Top-level shared data sources (harness-wide) |
| `trash` | Soft-deleted items with metadata (retention, expiry, parent path) |
| `workflows`, `workflowFolders`, `requests`, `catalog`, `projects` | Workflow designer, request collections, API catalog, and project data |
| `graphql-*` | GraphQL Studio history, collections, schema snapshots, and diff acknowledgements |
| `environments`, `microservices`, `globalAuthProfiles` | Environment Manager config blobs |
| `gqlStudioTabs`, `gqlStudioEnvironments`, `gqlConnectionProfiles`, `gqlPageAuth`, `gqlSchemaCache` | GraphQL Studio tabs, env overrides, profiles, auth, and introspection cache |

IndexedDB is used for large data that would exceed localStorage's ~5 MB limit. The database (`redfireforge`, version 9) uses a blob-per-store pattern with automatic migration from localStorage on first load (non-empty arrays only).

**localStorage (Secondary — for small prefs and legacy keys)**

| Key | Content |
|---|---|
| `perf-test-runner-config` | Runner settings (concurrency, weights, host mode, execution mode, etc.) |
| `perf-test-max-runs` | Maximum number of stored runs (default 50, configurable 1–500) |
| `perf-test-selected-env` | Currently selected environment ID |
| `perf-test-selected-svc` | Currently selected microservice ID |
| `perf-test-theme` | Theme preference (`dark` or `light`) |

Legacy keys (`perf-test-environments`, `perf-test-microservices`, etc.) are migrated into IndexedDB on first load when they contain data.

**Fallback Behavior:**
- If IndexedDB open times out (10 s — e.g., corrupted state, DevTools lock), callers reject and reads return empty; large blob **saves do not fall back to localStorage** on web
- Non-empty legacy localStorage arrays auto-migrate to IndexedDB on first load; empty legacy arrays are cleared in place
- Response bodies are truncated to 2 KB; results per run capped at 2,000

**Storage Management:**
The Storage section in Settings shows current usage and per-key breakdown. If a test run cannot be saved due to a full quota, a confirmation banner appears offering to automatically remove old runs to make room. To reset all data manually, clear site data in your browser's DevTools (Application → Storage → Clear site data).

---

## Legal

- [LICENSE](./LICENSE) — AGPL-3.0
- [SECURITY.md](./SECURITY.md) — Vulnerability reporting
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contribution guide
- [PRIVACY.md](./PRIVACY.md) — Privacy policy

