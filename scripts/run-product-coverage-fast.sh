#!/usr/bin/env bash
# PR / CI product coverage gate — runs shards in PARALLEL (~5 min).
#
# Day-to-day (identify gaps + fix one area):
#   bash scripts/product-coverage-status.sh
#   npx tsx scripts/coverage-gap-lines.ts <file-substring>
#   bash scripts/run-product-coverage-file.sh <source-file.ts>
#   bash scripts/run-product-coverage-batch.sh <shared|features|app|server> [paths...]
set -euo pipefail
# Skip wall-clock perf benches — V8 coverage instrumentation invalidates them.
export PRODUCT_COVERAGE=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/product-coverage-lib.sh
source "$ROOT/scripts/product-coverage-lib.sh"

SHARDS=${COVERAGE_SHARDS:-4}
START_TIME=$(date +%s)

mkdir -p coverage/.tmp coverage/batches
product_coverage_ensure_batch_dirs

# Run shards in parallel using Vitest's --shard flag
echo "▶ Starting $SHARDS coverage shards in parallel..."
RUN_ID="run-$(date +%s)-$$"
SHARD_DIR="coverage/.tmp/shards/$RUN_ID"
mkdir -p "$SHARD_DIR"
echo "  Shard output dir: $SHARD_DIR"

PIDS=()
for i in $(seq 1 "$SHARDS"); do
  SHARD_OUT="$SHARD_DIR/s$i"
  mkdir -p "$SHARD_OUT"
  # Log lives beside the reports dir, not inside it — Vitest's coverage
  # reporter cleans reportsDirectory and would delete the log we need on failure.
  npx vitest run --project product --coverage \
    --maxWorkers=1 --no-file-parallelism \
    --shard="$i/$SHARDS" \
    --coverage.reportsDirectory="$SHARD_OUT" \
    --coverage.reportOnFailure \
    > "$SHARD_DIR/s$i.log" 2>&1 &
  PIDS+=($!)
  echo "  Shard $i/$SHARDS started (PID $!)"
done

echo "  Waiting for all shards..."
FAILURES=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid" 2>/dev/null; then
    ((FAILURES++)) || true
  fi
done

BATCH_END=$(date +%s)
echo "  All shards done in $((BATCH_END - START_TIME))s ($FAILURES non-zero exits)"

# Newer Vitest/V8 runs can emit many coverage-*.json fragments in nested
# shard temp dirs (e.g. s1/.tmp-1-4/) instead of a top-level coverage-final.json.
# Normalize each shard output so downstream checks/merge stay stable.
echo "▶ Normalizing shard coverage fragments..."
node -e "
const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');
const shardDir = '$SHARD_DIR';
const numShards = $SHARDS;

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

for (let i = 1; i <= numShards; i++) {
  const shardPath = path.join(shardDir, 's' + i);
  if (!fs.existsSync(shardPath)) continue;
  const finalPath = path.join(shardPath, 'coverage-final.json');
  if (fs.existsSync(finalPath)) continue;

  const files = walkFiles(shardPath);
  const fragments = files.filter((f) => {
    const base = path.basename(f);
    if (f === finalPath) return false;
    return /^coverage-(\\d+)\\.json$/.test(base) || base === 'coverage-final.json';
  });

  if (fragments.length === 0) continue;

  const map = libCoverage.createCoverageMap({});
  let merged = 0;
  for (const f of fragments) {
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      map.merge(libCoverage.createCoverageMap(raw));
      merged++;
    } catch {
      // Ignore malformed fragments and keep merging usable files.
    }
  }

  if (merged > 0) {
    fs.writeFileSync(finalPath, JSON.stringify(map.toJSON(), null, 0));
    console.log('  normalized shard ' + i + ': merged ' + merged + ' fragment(s)');
  }
}
"

# Check shard outputs
SHARD_COUNT=0
for i in $(seq 1 "$SHARDS"); do
  SHARD_FINAL="$SHARD_DIR/s$i/coverage-final.json"
  if [[ ! -f "$SHARD_FINAL" ]]; then
    # Fallback: some providers may place a final map in nested temp dirs.
    NESTED_FINAL=$(find "$SHARD_DIR/s$i" -type f -name 'coverage-final.json' 2>/dev/null | head -n 1 || true)
    if [[ -n "$NESTED_FINAL" ]]; then
      cp "$NESTED_FINAL" "$SHARD_FINAL"
    fi
  fi

  if [[ -f "$SHARD_FINAL" ]]; then
    SIZE=$(wc -c < "$SHARD_FINAL" 2>/dev/null | tr -d ' ' || echo "0")
    echo "  ✓ shard $i: $(( SIZE / 1048576 ))MB"
    ((SHARD_COUNT++)) || true
  else
    echo "  ✗ shard $i: coverage-final.json MISSING"
    echo "    log: $SHARD_DIR/s$i.log"
    echo "    files:"
    find "$SHARD_DIR/s$i" -maxdepth 3 -type f | sed 's/^/      - /' | head -n 20 || true
  fi
done

if [[ "$SHARD_COUNT" -lt 1 ]]; then
  echo "❌ No shards produced coverage output"
  exit 1
fi

# Merge shards using istanbul-lib-coverage
echo "▶ Merging $SHARD_COUNT shard(s)..."
node -e "
const fs = require('fs');
const path = require('path');
const shardDir = '$SHARD_DIR';
const numShards = $SHARDS;
const libCoverage = require('istanbul-lib-coverage');
const map = libCoverage.createCoverageMap({});
let merged = 0;
for (let i = 1; i <= numShards; i++) {
  const covPath = path.join(shardDir, 's' + i, 'coverage-final.json');
  if (!fs.existsSync(covPath)) continue;
  const raw = JSON.parse(fs.readFileSync(covPath, 'utf8'));
  map.merge(libCoverage.createCoverageMap(raw));
  merged++;
}
const outPath = 'coverage/coverage-final.json';
fs.mkdirSync('coverage', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(map.toJSON(), null, 0));
const size = fs.statSync(outPath).size;
console.log('  Merged ' + merged + ' shard(s) -> ' + outPath + ' (' + map.files().length + ' files, ' + (size / 1e6).toFixed(1) + 'MB)');
"

npx tsx scripts/product-coverage-filter.ts
npx tsx scripts/list-top-coverage-gaps.ts --limit=10

echo ""
echo "▶ product coverage verify (incl. workflow, shared, engine)"
npx tsx scripts/verify-product-coverage-gaps.ts

echo ""
echo "▶ monolith check"
product_coverage_check_monolithic

END_TIME=$(date +%s)
TOTAL=$((END_TIME - START_TIME))
echo ""
echo "Total: ${TOTAL}s ($(( TOTAL / 60 ))m $(( TOTAL % 60 ))s) — batches: $((BATCH_END - START_TIME))s, merge+verify: $((END_TIME - BATCH_END))s"

# Coverage can be green while tests fail, so the shard exit codes are a
# separate gate — without this the script reports success on a failing suite.
if [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "❌ $FAILURES shard(s) exited non-zero — failing tests:"
  for i in $(seq 1 "$SHARDS"); do
    log="$SHARD_DIR/s$i.log"
    [[ -f "$log" ]] || continue
    # Vitest colorizes FAIL lines; strip ANSI so grep can see them.
    stripped=$(sed $'s/\x1B\\[[0-9;]*[A-Za-z]//g' "$log")
    matches=$(printf '%s\n' "$stripped" | grep -E 'FAIL |Failed Tests|Test Files.*failed|× |heap out of memory|FATAL|timeout' | head -n 40 || true)
    if [[ -n "$matches" ]]; then
      echo "   --- shard $i ---"
      printf '%s\n' "$matches" | sed 's/^/   /'
    fi
    echo "   --- last 80 lines of $log ---"
    printf '%s\n' "$stripped" | tail -n 80 | sed 's/^/   /'
  done
  echo "   logs: $SHARD_DIR/s<N>.log"
  exit 1
fi

echo "✅ All shards passed"
