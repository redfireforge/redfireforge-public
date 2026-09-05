#!/usr/bin/env bash
# Fast isolated coverage check for a single source file (dev loop only — not the merge gate).
#
#   bash scripts/run-product-coverage-file.sh src/features/grpc/data/grpcCollectionRepository.ts
#
# After isolated coverage looks good, refresh merged totals for that batch:
#   bash scripts/run-product-coverage-batch.sh features src/features/grpc/data/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/product-coverage-lib.sh
source "$ROOT/scripts/product-coverage-lib.sh"

FILE="${1:?Usage: $0 <source-file.ts|tsx>}"
FILE="${FILE#./}"

if [[ ! -f "$FILE" ]]; then
  echo "❌ File not found: $FILE" >&2
  exit 1
fi

case "$FILE" in
  *.ts|*.tsx) ;;
  *)
    echo "❌ Expected a .ts or .tsx source file: $FILE" >&2
    exit 1
    ;;
esac

DIR="$(dirname "$FILE")"
BASE="$(basename "$FILE")"
STEM="${BASE%.tsx}"
STEM="${STEM%.ts}"

TESTS=()
for candidate in \
  "$DIR/$STEM.test.ts" \
  "$DIR/$STEM.test.tsx" \
  "$DIR/$STEM.coverage-gaps.test.ts" \
  "$DIR/$STEM.coverage-gaps.test.tsx"
do
  if [[ -f "$candidate" ]]; then
    TESTS+=("$candidate")
  fi
done

shopt -s nullglob
for extra in "$DIR/$STEM."*.test.ts "$DIR/$STEM."*.test.tsx "$DIR/$STEM"*.test.ts "$DIR/$STEM"*.test.tsx; do
  [[ -f "$extra" ]] || continue
  case "$extra" in
    "$DIR/$STEM.test.ts"|"$DIR/$STEM.test.tsx"|"$DIR/$STEM.coverage-gaps.test.ts"|"$DIR/$STEM.coverage-gaps.test.tsx") continue ;;
  esac
  local_seen=0
  for existing in "${TESTS[@]}"; do
    [[ "$existing" == "$extra" ]] && local_seen=1 && break
  done
  [[ "$local_seen" -eq 1 ]] && continue
  TESTS+=("$extra")
done
shopt -u nullglob

# Split-module pattern: sibling tests that import ./<stem> directly.
import_pattern="from ['\"]\\./${STEM}['\"]"
while IFS= read -r testfile; do
  [[ -f "$testfile" ]] || continue
  local_seen=0
  for existing in "${TESTS[@]}"; do
    [[ "$existing" == "$testfile" ]] && local_seen=1 && break
  done
  [[ "$local_seen" -eq 1 ]] && continue
  TESTS+=("$testfile")
done < <(grep -rlE "$import_pattern" "$DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null || true)

if [[ ${#TESTS[@]} -eq 0 ]]; then
  echo "❌ No co-located tests found for $FILE" >&2
  echo "   Looked for: $DIR/$STEM.{test,coverage-gaps.test}.{ts,tsx} and imports of ./${STEM}" >&2
  exit 1
fi

BATCH="$(product_coverage_batch_for_path "$FILE")"

echo "▶ isolated coverage: $FILE"
echo "   tests: ${TESTS[*]}"
echo ""

mkdir -p coverage/.tmp/isolated-"$$"/.tmp
ISOLATED_COV_DIR="coverage/.tmp/isolated-$$"

set +e
PRODUCT_COVERAGE=1 npx vitest run --project product --coverage \
  --coverage.clean=true \
  --coverage.reportsDirectory="$ISOLATED_COV_DIR" \
  --coverage.include="$FILE" \
  --coverage.reporter=text \
  "${TESTS[@]}"
TEST_EXIT=$?
set -e
rm -rf "$ISOLATED_COV_DIR"

echo ""
if product_coverage_product_report_exists; then
  echo "Merged gate snapshot (may differ from isolated run above):"
  npx tsx scripts/coverage-gap-lines.ts "$FILE" || true
else
  echo "ℹ No merged product report yet. After fixing tests, run:"
fi
echo "   bash scripts/run-product-coverage-batch.sh $BATCH ${DIR}/"

exit "$TEST_EXIT"
