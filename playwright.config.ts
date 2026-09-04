import { execSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

// Playwright workers set FORCE_COLOR=1. Agent/CI shells often also set
// NO_COLOR, and Node then warns on every worker start. Prefer Playwright color.
delete process.env.NO_COLOR;

function isLocalPortListening(port: number): boolean {
  try {
    execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spec files that require Docker infrastructure to run.
 *
 * These are excluded from the default `chromium` project and only run when
 * the `E2E_WITH_DOCKER=1` environment variable is set (via the `docker`
 * project below).
 *
 * Docker stacks and the port they probe:
 *   kafka-live       → Redpanda plain (port 19093)
 *   kafka-secure     → Redpanda SASL/SCRAM-256 (port 19645)
 *   kafka-tls        → Redpanda TLS+SASL (port 19648)
 *   ws-protocols-*   → WebSocket echo servers (Socket.IO :3100, GraphQL :4100,
 *                        RabbitMQ STOMP :15674)
 *   ws-tls-local-demo → local TLS WebSocket stack
 *   graphql-test-server → Apollo Server 4 GraphQL test server (port 4010)
 *   graphql-* (live)    → GraphQL Studio live E2E against port 4010
 *   grpc-test-server    → Go echo gRPC test server (50051 gRPC, 50052 health)
 *   grpc-* (live)       → gRPC Studio live E2E against port 50051
 *   grpc-studio-manage-schemas.spec.ts → Phase 3I schema browser (live tests skip when infra down)
 *   grpc-studio-schema-drift.spec.ts   → Phase 3I drift UI (mocked reflect; no Docker)
 *   grpc-studio-tls.spec.ts            → Phase 4J TLS modal + settings drawer (shell; no Docker)
 *
 * GraphQL Studio live specs skip automatically when port 4010 is down.
 * gRPC Studio live specs skip automatically when port 50051 is down.
 * Run with server up:
 *   cd docker/graphql && docker compose up -d
 *   E2E_GRAPHQL_SERVER=1 npx playwright test e2e/graphql-subscriptions.spec.ts
 *   cd docker/kafka/basic    && docker compose up -d   # kafka-live
 *   cd docker/kafka/secure   && docker compose up -d   # kafka-secure
 *   cd docker/kafka/tls      && docker compose up -d   # kafka-tls
 *   cd docker/websocket      && docker compose up -d   # ws-protocols-*
 *   cd docker/websocket && docker compose -f docker-compose.tls.yml up -d   # ws-tls-local-demo
 *   cd docker/graphql        && docker compose up -d   # graphql-test-server (4010)
 *   cd docker/grpc           && docker compose up -d   # grpc-test-server (50051)
 *
 * Or let global-setup start the GraphQL server automatically:
 *   E2E_WITH_DOCKER=1 npx playwright test --project=docker
 *   E2E_WS_SERVER=1 npx playwright test e2e/ws-protocols-*.spec.ts --project=docker
 */
const WS_DOCKER_SPECS = [
  '**/ws-protocols-console.spec.ts',
  '**/ws-protocols-graphql.spec.ts',
  '**/ws-protocols-socketio.spec.ts',
  '**/ws-protocols-stomp.spec.ts',
  '**/ws-tls-local-demo.spec.ts',
];

const DOCKER_SPECS = [
  '**/kafka-live.spec.ts',
  '**/kafka-secure.spec.ts',
  '**/kafka-tls.spec.ts',
  ...WS_DOCKER_SPECS,
  '**/graphql-test-server.spec.ts',
];

/** GraphQL Studio live E2E — need port 4010 (skip in spec when server down). */
const GRAPHQL_LIVE_SPECS = [
  '**/graphql-subscriptions.spec.ts',
  '**/graphql-schema-explorer.spec.ts',
  '**/graphql-query-builder.spec.ts',
  '**/graphql-code-gen.spec.ts',
];

/** gRPC Studio live E2E — need port 50051 (skip in spec when server down). */
const GRPC_LIVE_SPECS = [
  '**/grpc-test-server.spec.ts',
  '**/grpc-studio-unary.spec.ts',
  '**/grpc-studio-server-stream.spec.ts',
  '**/grpc-studio-client-stream.spec.ts',
  '**/grpc-studio-bidi-stream.spec.ts',
  '**/grpc-studio-manage-schemas.spec.ts',
  '**/grpc-studio-collections-history.spec.ts',
];

const ALL_DOCKER_SPECS = DOCKER_SPECS;

/**
 * Step-through demo specs — excluded from the default run.
 *
 * These specs walk through individual lesson steps to validate specific
 * bug fixes (e.g. node deselection before config modal opens). They are
 * too slow (~60 s per test) for the standard suite and are only run when
 * actively working on demo lessons.
 *
 * Run them directly:
 *   npx playwright test e2e/demo-ws-workflow-builder.spec.ts --reporter=html
 *   npx playwright test e2e/demo-stepthrough-*.spec.ts --reporter=html
 *
 * Naming convention: any new per-lesson step-through spec must be named
 *   demo-{protocol}-{lesson-slug}.spec.ts
 * so the glob below picks it up automatically.
 */
const DEMO_STEPTHROUGH_SPECS = [
  '**/demo-ws-workflow-builder.spec.ts',
  '**/ws-basics-em.spec.ts',
  '**/demo-cat-convert-openapi.spec.ts',
  // GQL-1 has its own isolated project — see demo-gql1 below.
  // Future per-lesson step-through specs follow the same naming pattern:
  // '**/demo-kafka-consume.spec.ts',
  // '**/demo-sse-advanced.spec.ts',
];

/** GQL-1 only — never bundled with other demo step-through specs. */
const DEMO_GQL1_SPEC = '**/demo-gql-first-query.spec.ts';
/** GQL-2 only — Variables & Arguments lesson validation. */
const DEMO_GQL2_SPEC = '**/demo-gql-variables.spec.ts';
/** GQL-3 only — Schema Exploration lesson validation. */
const DEMO_GQL3_SPEC = '**/demo-gql-schema-exploration.spec.ts';
/** GQL-4 only — Authentication & Headers lesson validation. */
const DEMO_GQL4_SPEC = '**/demo-gql-auth-headers.spec.ts';
/** GQL-5 only — HTTPS, TLS & Certificates lesson validation. */
const DEMO_GQL5_SPEC = '**/demo-gql-https-tls.spec.ts';
/** GQL-6 only — Mutations lesson validation. */
const DEMO_GQL6_SPEC = '**/demo-gql-mutations.spec.ts';
/** GQL-7 only — Subscriptions lesson validation. */
const DEMO_GQL7_SPEC = '**/demo-gql-subscriptions.spec.ts';
/** GQL-8 only — Query Builder lesson validation. */
const DEMO_GQL8_SPEC = '**/demo-gql-query-builder.spec.ts';
/** GQL-9 only — Collections & History lesson validation. */
const DEMO_GQL9_SPEC = '**/demo-gql-collections-history.spec.ts';
/** GQL-10 only — Export & Share Queries lesson validation. */
const DEMO_GQL10_SPEC = '**/demo-gql-export-share.spec.ts';
/** GQL-11 only — Performance Tracing lesson validation. */
const DEMO_GQL11_SPEC = '**/demo-gql-performance-tracing.spec.ts';
/** GQL-12 only — Schema Diff & Breaking Changes lesson validation. */
const DEMO_GQL12_SPEC = '**/demo-gql-schema-diff.spec.ts';
/** GQL-13 only — Mock Server lesson validation. */
const DEMO_GQL13_SPEC = '**/demo-gql-mock-server.spec.ts';
/** GQL-14 only — Multi-Tab Workspaces lesson validation. */
const DEMO_GQL14_SPEC = '**/demo-gql-multi-tab.spec.ts';
/** GQL-15 only — Batch Execution lesson validation. */
const DEMO_GQL15_SPEC = '**/demo-gql-batch-execution.spec.ts';
/** GQL-16 only — Workflow Integration lesson validation. */
const DEMO_GQL16_SPEC = '**/demo-gql-workflow-integration.spec.ts';
/** GQL-17 only — Workflow Runner & Results lesson validation. */
const DEMO_GQL17_SPEC = '**/demo-gql-workflow-runner.spec.ts';
/** GQL-18 only — Mutation Node in Workflow lesson validation. */
const DEMO_GQL18_SPEC = [
  '**/demo-gql-workflow-mutation.spec.ts',
  '**/demo-gql18-delete-validation.spec.ts',
];
/** GQL-19 only — Subscription Node in Workflow lesson validation. */
const DEMO_GQL19_SPEC = '**/demo-gql-workflow-subscription.spec.ts';
/** §11.0 — Demo workspace isolation acceptance (GQL-1 / GQL-14 gate / lesson switch). */
const DEMO_GQL110_SPEC = '**/demo-gql-workspace-isolation.spec.ts';
/** GRPC-1 only: Your First gRPC Call (isolated Docker lesson). */
const DEMO_GRPC1_SPEC = '**/demo-grpc-first-call.spec.ts';
/** REQ-3 only: Multi-Environment Requests (api › requests) smoke walk. */
const DEMO_REQ3_SPEC = '**/demo-req-multi-env.spec.ts';
/** Product: API Mock multi-server §12.2 (companion :3001). */
const API_MOCK_MULTI_SERVER_SPEC = '**/api-mock-multi-server.spec.ts';
/**
 * AM-01…AM-24 — API Mock Studio demo curriculum v2. Each lesson gets an isolated
 * project (`demo-am01` … `demo-am24`) so a single lesson can be run in dev.
 */
const AM_LESSON_IDS = [
  '01', '02', '03', '04', '05', '06', '07', '08',
  '09', '10', '11', '12', '13', '14', '15', '16',
  '17', '18', '19', '20', '21', '22', '23', '24',
] as const;
const amLessonSpec = (n: string) => `**/demo-api-mock-am${n}.spec.ts`;
const DEMO_AM_SPECS = AM_LESSON_IDS.map(amLessonSpec);
/** Workflows domain (WF-1…WF-8) Demo Hub smoke walks. */
const DEMO_WF_SPEC = '**/demo-wf-lessons.spec.ts';
/** GQL-1..3 smoke — first three lessons auto-play (requires port 4010). */
const DEMO_GQL_LESSONS_SPEC = '**/graphql-lessons.spec.ts';

/** Docker-gated demo hub validation — requires live Kafka/WS/SSE stacks; run via E2E_WITH_DOCKER=1. */
const DOCKER_DEMO_SPECS = [
  '**/demo-hub-docker-validate.spec.ts',
  // Needs Schema Registry on :8085 (started by global-setup when E2E_WITH_DOCKER=1).
  '**/demo-kafka-schema-registry.spec.ts',
];

const withDocker = process.env.E2E_WITH_DOCKER === '1';
const withGraphqlServer = process.env.E2E_GRAPHQL_SERVER === '1';
const withGrpcServer = process.env.E2E_GRPC_SERVER === '1';
const withWsServer = process.env.E2E_WS_SERVER === '1';
const withGql5Docker = process.env.E2E_GQL5_DOCKER === '1';
const withAnyDockerInfra = withDocker || withGraphqlServer || withGrpcServer || withWsServer || withGql5Docker;
/** CI and `E2E_REUSE_SERVERS=0` always start (and tear down) fresh servers. */
const forceFreshE2EServers =
  process.env.CI === 'true' || process.env.E2E_REUSE_SERVERS === '0';
/** Reuse a local `npm run dev` so Playwright does not kill a live demo tab. */
const reuseExistingE2EServers =
  !forceFreshE2EServers
  && (process.env.E2E_REUSE_SERVERS === '1' || isLocalPortListening(5173));
const reuseExistingCompanion =
  !forceFreshE2EServers
  && (process.env.E2E_REUSE_SERVERS === '1' || isLocalPortListening(3001));

export default defineConfig({
  testDir: './e2e',
  // Starts graphql-test-server (4010) and/or grpc-test-server (50051) when Docker E2E is enabled.
  globalSetup: withAnyDockerInfra ? './e2e/global-setup.ts' : undefined,
  globalTeardown: withAnyDockerInfra ? './e2e/global-teardown.ts' : undefined,
  fullyParallel: false,
  retries: 2,
  // Favor deterministic full-suite runs over maximal parallel throughput.
  // 2 local workers prevents dev-server overload that causes .app-header timeouts.
  workers: process.env.CI ? 12 : 2,
  // 45s default gives breathing room under parallel load.
  timeout: 45_000,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    // ── Default project: standard UI tests, no Docker required ─────────────
    {
      name: 'chromium',
      // Exclude the dedicated ws-mock-server spec (has its own project below)
      // and all Docker-dependent specs.
      testIgnore: [
        '**/ws-mock-server.spec.ts',
        ...ALL_DOCKER_SPECS,
        ...DOCKER_DEMO_SPECS,
        ...(withDocker || withGrpcServer ? GRPC_LIVE_SPECS : []),
        ...DEMO_STEPTHROUGH_SPECS,
        DEMO_GQL1_SPEC,
        DEMO_GQL2_SPEC,
        DEMO_GQL3_SPEC,
        DEMO_GQL4_SPEC,
        DEMO_GQL5_SPEC,
        DEMO_GQL6_SPEC,
        DEMO_GQL7_SPEC,
        DEMO_GQL8_SPEC,
        DEMO_GQL9_SPEC,
        DEMO_GQL10_SPEC,
        DEMO_GQL11_SPEC,
        DEMO_GQL12_SPEC,
        DEMO_GQL13_SPEC,
        DEMO_GQL14_SPEC,
        DEMO_GQL15_SPEC,
        DEMO_GQL16_SPEC,
        DEMO_GQL17_SPEC,
        ...DEMO_GQL18_SPEC,
        DEMO_GQL19_SPEC,
        DEMO_GQL110_SPEC,
        DEMO_GQL_LESSONS_SPEC,
        DEMO_GRPC1_SPEC,
        DEMO_REQ3_SPEC,
        API_MOCK_MULTI_SERVER_SPEC,
        ...DEMO_AM_SPECS,
        DEMO_WF_SPEC,
      ],
      use: { browserName: 'chromium' },
    },

    // ── ws-mock-server: runs after chromium; cleans mock state via beforeAll API ─
    {
      name: 'ws-mock-server',
      testMatch: '**/ws-mock-server.spec.ts',
      use: { browserName: 'chromium' },
    },

    // ── Demo step-through: slow per-lesson validation (EM setup, config modals, etc.)
    // Kafka Schema Registry is in DOCKER_DEMO_SPECS (needs :8085). ─
    {
      name: 'demo-stepthrough',
      testMatch: DEMO_STEPTHROUGH_SPECS,
      timeout: 180_000,
      use: { browserName: 'chromium' },
    },

    // ── GQL-1 only: Your First GraphQL Query (isolated from WS/SSE demo specs) ─
    {
      name: 'demo-gql1',
      testMatch: DEMO_GQL1_SPEC,
      timeout: 720_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-2 only: Variables & Arguments ─
    {
      name: 'demo-gql2',
      testMatch: DEMO_GQL2_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-3 only: Schema Exploration ─
    {
      name: 'demo-gql3',
      testMatch: DEMO_GQL3_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-4 only: Authentication & Headers ─
    {
      name: 'demo-gql4',
      testMatch: DEMO_GQL4_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-5 only: HTTPS, TLS & Certificates ─
    {
      name: 'demo-gql5',
      testMatch: DEMO_GQL5_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-6 only: Mutations — Create, Update, Delete ─
    {
      name: 'demo-gql6',
      testMatch: DEMO_GQL6_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-7 only: Subscriptions — Real-Time Data ─
    {
      name: 'demo-gql7',
      testMatch: DEMO_GQL7_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-8 only: Query Builder — Visual Operations ─
    {
      name: 'demo-gql8',
      testMatch: DEMO_GQL8_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-9 only: Collections & History ─
    {
      name: 'demo-gql9',
      testMatch: DEMO_GQL9_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-10 only: Export & Share Queries ─
    {
      name: 'demo-gql10',
      testMatch: DEMO_GQL10_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-11 only: Performance Tracing ─
    {
      name: 'demo-gql11',
      testMatch: DEMO_GQL11_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-12 only: Schema Diff & Breaking Changes ─
    {
      name: 'demo-gql12',
      testMatch: DEMO_GQL12_SPEC,
      timeout: 600_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-13 only: Mock Server ─
    {
      name: 'demo-gql13',
      testMatch: DEMO_GQL13_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-14 only: Multi-Tab Workspaces ─
    {
      name: 'demo-gql14',
      testMatch: DEMO_GQL14_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-15 only: Batch Execution ─
    {
      name: 'demo-gql15',
      testMatch: DEMO_GQL15_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-16 only: Workflow Integration ─
    {
      name: 'demo-gql16',
      testMatch: DEMO_GQL16_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-17 only: Workflow Runner & Results ─
    {
      name: 'demo-gql17',
      testMatch: DEMO_GQL17_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-18 only: Mutation Node in Workflow ─
    {
      name: 'demo-gql18',
      testMatch: DEMO_GQL18_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    {
      name: 'demo-gql19',
      testMatch: DEMO_GQL19_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── §11.0 — Demo workspace isolation acceptance ─
    {
      name: 'demo-gql110',
      testMatch: DEMO_GQL110_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GRPC-1 only: Your First gRPC Call ─
    {
      name: 'demo-grpc1',
      testMatch: DEMO_GRPC1_SPEC,
      timeout: 720_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── REQ-3 only: Multi-Environment Requests ─
    {
      name: 'demo-req3',
      testMatch: DEMO_REQ3_SPEC,
      timeout: 720_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── Product: API Mock multi-server (§12.2, companion :3001, workers: 1) ─
    {
      name: 'api-mock',
      testMatch: API_MOCK_MULTI_SERVER_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── AM-01…AM-24: one isolated project per API Mock lesson (companion :3001) ─
    ...AM_LESSON_IDS.map((n) => ({
      name: `demo-am${n}`,
      testMatch: amLessonSpec(n),
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' as const },
    })),

    // ── Workflows domain: WF-1…WF-8 Demo Hub smoke walks ─
    {
      name: 'demo-wf',
      testMatch: DEMO_WF_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── GQL-1..3 smoke: auto-play first three GraphQL lessons (4F-7) ─
    {
      name: 'demo-gql-lessons',
      testMatch: DEMO_GQL_LESSONS_SPEC,
      timeout: 900_000,
      retries: 0,
      use: { browserName: 'chromium' },
    },

    // ── CI smoke project: curated core product specs, no Docker required ──
    // Run: npx playwright test --project=ci
    // Used by the `e2e-product` job in .github/workflows/ci.yml.
    // Selection criteria: (a) no Docker / no external server, (b) covers a
    // critical UI flow, (c) fast enough to complete within ~10 min on a 2-vCPU
    // GitHub Actions runner.
    {
      name: 'ci',
      testMatch: [
        // Core app shell
        '**/app-features.spec.ts',
        '**/settings.spec.ts',
        '**/page-persistence.spec.ts',
        '**/idb-loading.spec.ts',
        '**/gallery.spec.ts',
        '**/gallery-loaded-badge.spec.ts',
        '**/trash-box.spec.ts',
        '**/environment-manager.spec.ts',
        // Test scenarios: creation, execution, history
        '**/create-test.spec.ts',
        '**/run-test.spec.ts',
        '**/import-run.spec.ts',
        '**/execution-history.spec.ts',
        '**/export-options-popover.spec.ts',
        '**/structured-assertions.spec.ts',
        '**/parameterized-verify.spec.ts',
        // Results
        '**/results-console.spec.ts',
        '**/view-results.spec.ts',
        '**/run-comparison.spec.ts',
        // Workflow (no Docker required)
        '**/workflow.spec.ts',
        '**/workflow-features.spec.ts',
        '**/workflow-nodes.spec.ts',
        '**/workflow-persistence.spec.ts',
        '**/workflow-folders.spec.ts',
        '**/workflow-conditions.spec.ts',
        '**/workflow-console.spec.ts',
        // Data Mapper
        '**/data-mapper-ui.spec.ts',
        // Validation
        '**/validation-rules-editor.spec.ts',
        '**/validation-operator-roundtrip.spec.ts',
        '**/validation-dsl-roundtrip.spec.ts',
      ],
      timeout: 60_000,
      retries: 1,
      use: { browserName: 'chromium' },
    },

    // ── Docker project: active when E2E_WITH_DOCKER=1, E2E_GRAPHQL_SERVER=1, E2E_GRPC_SERVER=1, or E2E_WS_SERVER=1 ─
    // Run: E2E_WITH_DOCKER=1 npx playwright test --project=docker
    // Or:  E2E_GRAPHQL_SERVER=1 npx playwright test e2e/graphql-test-server.spec.ts
    // Or:  E2E_GRPC_SERVER=1 npx playwright test e2e/grpc-test-server.spec.ts
    // Or:  E2E_WS_SERVER=1 npx playwright test e2e/ws-protocols-*.spec.ts --project=docker
    ...(withDocker || withGraphqlServer || withGrpcServer || withWsServer
      ? [
          {
            name: 'docker',
            testMatch: withDocker
              ? [...ALL_DOCKER_SPECS, ...DOCKER_DEMO_SPECS, ...GRPC_LIVE_SPECS]
              : withWsServer
                ? WS_DOCKER_SPECS
                : withGrpcServer
                  ? GRPC_LIVE_SPECS
                  : ['**/graphql-test-server.spec.ts', ...GRAPHQL_LIVE_SPECS],
            use: { browserName: 'chromium' as const },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'VITE_SUPPRESS_PROXY_ERRORS=1 npm run server',
      url: 'http://localhost:3001/health',
      // Release gates start a fresh companion; locally reuse :3001 if it is already up.
      reuseExistingServer: reuseExistingCompanion,
      timeout: 30_000,
    },
    {
      command: 'VITE_SUPPRESS_PROXY_ERRORS=1 VITE_ENABLE_DEMO_HUB=true vite',
      url: 'http://localhost:5173',
      // Release gates start a fresh frontend; locally reuse :5173 if it is already up
      // so a finished E2E run does not tear down the Vite tab you are watching.
      reuseExistingServer: reuseExistingE2EServers,
      // 120s: Vite's first-run dependency pre-bundling on a cold CI runner (no .vite/deps
      // cache after npm ci) can take 40-90s before the HTTP server responds. 30s was
      // too tight and caused intermittent timeout failures on fresh CI runs.
      timeout: 120_000,
    },
  ],
});
