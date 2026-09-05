#!/usr/bin/env bash
# Shared helpers for product coverage dev scripts (sourced, not executed directly).
product_coverage_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

# Map a product source path to its vitest coverage batch name.
product_coverage_batch_for_path() {
  local path="$1"
  path="${path#./}"
  case "$path" in
    src/shared/*) echo shared ;;
    src/features/*) echo features ;;
    src/app/*|src/data/*|src/engine/*|src/config/*|src/*) echo app ;;
    src-server/*|cli/*) echo server ;;
    *)
      echo "Cannot infer coverage batch for: $path" >&2
      echo "Expected prefix: src/shared, src/features, src/app, src/data," >&2
      echo "src/engine, src/config, src/*, src-server, or cli" >&2
      return 1
      ;;
  esac
}

# Default vitest paths for a batch.
product_coverage_batch_default_paths() {
  local batch="$1"
  case "$batch" in
    shared) echo "src/shared" ;;
    features) echo "src/features" ;;
    app) echo "src/app src/data src/engine src/config src/test-utils src/suppressResizeObserverError.test.ts" ;;
    server) echo "src-server cli" ;;
    *)
      echo "Unknown batch: $batch — use shared, features, app, or server" >&2
      return 1
      ;;
  esac
}

product_coverage_product_report_exists() {
  [[ -f coverage/coverage-final.product.json ]]
}

product_coverage_ensure_batch_dirs() {
  mkdir -p coverage/.tmp coverage/batches/{shared,features,app,server}
}

# Run vitest coverage in an isolated scratch dir, then publish coverage-final.json
# into coverage/batches/<name>/ so vitest temp files cannot delete sibling batches.
# When partial=1, merge incoming coverage into the existing store (accumulative scoped runs).
product_coverage_run_vitest_batch() {
  local batch_name="$1"
  local partial="${2:-0}"
  shift 2
  local scratch="coverage/.tmp/vitest-batch-${batch_name}-$$"
  local store="coverage/batches/${batch_name}"
  local store_file="$store/coverage-final.json"
  local partials_dir="$store/partials"
  mkdir -p "$scratch/.tmp" "$store" "$partials_dir"
  trap "rm -rf '${scratch}'" RETURN
  set +e
  PRODUCT_COVERAGE=1 npx vitest run --project product --coverage \
    --maxWorkers=1 --no-file-parallelism \
    --coverage.clean=true \
    --coverage.reportOnFailure=true \
    --coverage.reportsDirectory="$scratch" \
    "$@"
  local batch_exit=$?
  set -e
  if [[ -f "$scratch/coverage-final.json" ]]; then
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    cp "$scratch/coverage-final.json" "$partials_dir/${stamp}-partial.json"
    if [[ "$partial" -eq 1 ]]; then
      npx tsx scripts/merge-coverage-map-into.ts "$store_file" "$scratch/coverage-final.json"
      echo "ℹ merged partial into $store_file (snapshot: $partials_dir/${stamp}-partial.json)"
    else
      cp "$scratch/coverage-final.json" "$store_file"
    fi
  else
    echo "⚠ no coverage-final.json from batch $batch_name (vitest exit $batch_exit)" >&2
  fi
  return "$batch_exit"
}

product_coverage_warn_stale_batches() {
  local batch="$1"
  local missing=0
  for other in shared features app server; do
    [[ "$other" == "$batch" ]] && continue
    if [[ ! -f "coverage/batches/$other/coverage-final.json" ]]; then
      echo "WARN missing batch coverage: coverage/batches/$other/ — merge omits this batch"
      missing=1
    fi
  done
  if [[ "$missing" -eq 1 ]]; then
    echo "Run all batches once on PR/CI: bash scripts/run-product-coverage-fast.sh"
  fi
}

# Fail when any product production source file is ≥750 lines (tests excluded).
# Demo-hub sources are intentionally excluded from this product gate.
product_coverage_check_monolithic() {
  local threshold="${MONOLITH_LINE_THRESHOLD:-750}"
  local offenders
  offenders="$(
    find src src-server cli -type f \( -name '*.ts' -o -name '*.tsx' \) \
      ! -path '*/node_modules/*' \
      ! -name '*.test.*' \
      ! -name '*.coverage-gaps.test.*' \
      ! -path '*/__test-utils__/*' \
      ! -path '*/test-utils/*' \
      -print0 2>/dev/null \
    | xargs -0 wc -l 2>/dev/null \
    | awk -v t="$threshold" '$1 >= t && $2 != "total" { print $1, $2 }' \
    | sort -rn
  )"

  if [[ -z "$offenders" ]]; then
    echo "✅ No production files ≥${threshold} lines (tests excluded)"
    return 0
  fi

  echo "❌ Monolithic production files (≥${threshold} lines, tests excluded):"
  while IFS= read -r line; do
    [[ -n "$line" ]] && echo "   $line"
  done <<< "$offenders"
  echo ""
  echo "Split into focused modules before merge."
  return 1
}
