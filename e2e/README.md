# E2E Tests

## Two categories

| Category | Description | When to run |
|---|---|---|
| **Standard** | UI-only tests, no external services beyond the dev server | Every PR / local dev |
| **Docker** | Require live Docker infrastructure (Kafka, WebSocket servers) | On demand / Docker CI job |

## Commands

### Standard (default) — no Docker needed

```bash
# Run all standard E2E tests
npm run test:e2e

# With headed browser (useful for debugging)
npm run test:e2e:headed

# Target a single spec
npx playwright test e2e/workflow.spec.ts --reporter=list
```

### Docker — requires live infrastructure

```bash
# Run only Docker-dependent tests
npm run test:e2e:docker

# With headed browser
npm run test:e2e:docker:headed

# Run everything (standard + Docker)
npm run test:e2e:all
```

### One-off with custom options

```bash
# Docker tests with higher timeout (useful when containers are slow to warm up)
E2E_WITH_DOCKER=1 npx playwright test --project=docker --timeout=60000 --reporter=list

# Single Docker spec
E2E_WITH_DOCKER=1 npx playwright test e2e/kafka-live.spec.ts --reporter=list
```

## Docker stacks

Each Docker test group documents its required compose file in the spec's header comment.
Quick reference:

| Spec file | Docker compose path | Key port |
|---|---|---|
| `kafka-live.spec.ts` | `docker/kafka/basic/docker-compose.yml` | 19093 |
| `kafka-secure.spec.ts` | `docker/kafka/secure/docker-compose.yml` | 19645 |
| `kafka-tls.spec.ts` | `docker/kafka/tls/docker-compose.yml` | 19648 |
| `ws-protocols-console.spec.ts` | `docker/websocket/docker-compose.all.yml` | 3100 |
| `ws-protocols-socketio.spec.ts` | `docker/websocket/socketio/docker-compose.yml` | 3100 |
| `ws-protocols-graphql.spec.ts` | `docker/websocket/graphql/docker-compose.yml` | 4100 |
| `ws-protocols-stomp.spec.ts` | `docker/websocket/stomp/docker-compose.yml` | 15674 |
| `ws-tls-local-demo.spec.ts` | `docker/websocket/docker-compose.tls.yml` | — |
| `graphql-test-server.spec.ts` | `docker/graphql/docker-compose.yml` | 4010 |
| `environment-manager.spec.ts` | None (seeded localStorage) | 5173 |
| `graphql-multi-tab.spec.ts` | None (`/__proxy` mocks, Phase 6B-4 + 6F-13) | 5173 |
| `ws-basics-em.spec.ts` | None (Demo Hub live lesson) | 5173 |
| `demo-ws-workflow-builder.spec.ts` | None (Demo Hub live lesson) | 5173 |
| `demo-kafka-schema-registry.spec.ts` | `docker/kafka/schema-registry` (`--project=docker`) | 8085 |
| `demo-gql-first-query.spec.ts` | `docker/graphql` for full lesson (4010) | 5173 |
| `demo-gql-variables.spec.ts` | `docker/graphql` for full lesson (4010) | 5173 |
| `demo-gql-mutations.spec.ts` | `docker/graphql` for full lesson (4010) | 5173 |
| `graphql-lessons.spec.ts` | `docker/graphql` for GQL-1..3 smoke (4010) | 5173 |

Run **only** GQL-1 (not other demo lessons):

```bash
npm run test:e2e:demo:gql1
# or
npx playwright test --project=demo-gql1 e2e/demo-gql-first-query.spec.ts --reporter=html --workers=1
```

Run **only** GQL-2 (Variables & Arguments — not other demo lessons):

```bash
npm run test:e2e:demo:gql2
# or
npx playwright test --project=demo-gql2 e2e/demo-gql-variables.spec.ts --reporter=html --workers=1
```

Run **only** GQL-3 (Mutations — not other demo lessons):

```bash
npm run test:e2e:demo:gql3
# or
npx playwright test --project=demo-gql3 e2e/demo-gql-mutations.spec.ts --reporter=html --workers=1
```

### Demo step-through (slow — run on demand)

These specs walk through live demo lessons step-by-step (~30–90 s each). They live in the
`demo-stepthrough` Playwright project (excluded from the default `chromium` run).
Nightly `e2e-nightly.yml` runs them plus API Mock / AM-01…AM-24 via
`npm run test:e2e:demo:hub:ci`. The Kafka Schema Registry demo is **not** here —
it needs `:8085` and runs in `--project=docker` when `E2E_WITH_DOCKER=1`.

```bash
# WebSocket Basics EM + {{wsBaseUrl}} validation, WS Workflow Builder modal regression
npm run test:e2e:demo

# GQL-1 only (Your First GraphQL Query)
npm run test:e2e:demo:gql1

# GQL-2 only (Variables & Arguments — not other demo lessons)
npm run test:e2e:demo:gql2

# GQL-3 only (Mutations — not other demo lessons)
npm run test:e2e:demo:gql3

# GQL-1..3 smoke auto-play (4F-7 — requires docker/graphql on 4010; lesson-stage / on demand, not default CI)
npm run test:e2e:demo:gql-smoke

# §11.0 — demo workspace isolation acceptance (requires docker/graphql on 4010)
npm run test:e2e:demo:gql110

# GQL-19 — Subscription Node in Workflow (requires docker/graphql on 4010)
npm run test:e2e:demo:gql19

# Single WS demo spec
npx playwright test --project=demo-stepthrough e2e/ws-basics-em.spec.ts --reporter=list
```

**Synchronisation rule:** never click **Next** during the reading phase — that aborts the
step before its `action()` runs. Use `completeCurrentStepAction()` or `runNextStep()` from
`e2e/demo-player-helpers.ts` instead.

**Demo lesson E2E memo (required reading for new specs):** [`e2e/DEMO-LESSON-E2E-MEMO.md`](./DEMO-LESSON-E2E-MEMO.md)

Key pitfalls from GQL-1..3:

| Pitfall | Fix |
|---------|-----|
| Hang on final step | Use `finishDemoStep`, not `runNextStep` / `advanceToStep(N)` when N = total steps |
| Strict-mode `getByText` | Scope to `data-testid` panels (narration duplicates UI text) |
| GraphQL 404 `Cannot POST /` | Endpoint must be `http://localhost:4010/graphql`, not bare `4010` |
| History steps flicker Response | History guards must not re-execute queries (GQL-2 `skipResponseFocus`) |
| Slow Docker executes | 300s action timeout; test timeout 600–900s; `workers: 1` |

## GraphQL test server (port 4010)

The Apollo Server 4 test server is started automatically by `e2e/global-setup.ts` when
`E2E_WITH_DOCKER=1` or `E2E_GRAPHQL_SERVER=1` is set:

```bash
# GraphQL server smoke tests only (global-setup starts Docker automatically)
E2E_GRAPHQL_SERVER=1 npx playwright test e2e/graphql-test-server.spec.ts --reporter=list

# Full Docker suite (includes graphql-test-server via global-setup)
E2E_WITH_DOCKER=1 npx playwright test --project=docker --reporter=list

# Manual start (for manual workflow scenarios)
cd docker/graphql && docker compose up -d
curl http://localhost:4010/health
```

Set `E2E_DOCKER_TEARDOWN=1` to stop containers after the run (default: leave running).

## How it works

`playwright.config.ts` reads the `E2E_WITH_DOCKER` environment variable:

- **Not set (default)**: the `docker` project is not registered; all Docker specs are excluded
  from the `chromium` project via `testIgnore`.
- **`E2E_WITH_DOCKER=1`**: a `docker` project is registered and only Docker specs are matched.
  The `chromium` project still ignores them, so the two projects never overlap.

Individual test files also have runtime skip guards (`test.skip(!up, ...)`) that probe
infrastructure ports. These act as a safety net but are now secondary to the project-level
gating — you should never see unexpected skips in a normal run.
