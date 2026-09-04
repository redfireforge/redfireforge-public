#!/usr/bin/env bash
# Nightly / CI: Learning Hub step-through + API Mock product + AM-01…AM-24.
# Companion :3001 is started by Playwright webServer. No Kafka Docker here —
# Schema Registry lives in the `docker` project (E2E_WITH_DOCKER=1).
set -euo pipefail
cd "$(dirname "$0")/.."
# Playwright sets FORCE_COLOR=1 in workers; NO_COLOR from the agent/CI shell
# would trigger a Node warning on every worker start.
unset NO_COLOR

projects=(demo-stepthrough api-mock)
for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  projects+=("demo-am${n}")
done

args=()
for p in "${projects[@]}"; do
  args+=(--project="$p")
done

# One worker: every AM lesson shares companion :3001. Parallel tests call
# stopAllCompanionListeners in before/afterEach and kill each other's mock.
exec npx playwright test "${args[@]}" --workers=1 --reporter=list "$@"
