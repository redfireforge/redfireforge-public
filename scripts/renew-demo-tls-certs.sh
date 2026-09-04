#!/usr/bin/env bash
# Regenerates demo TLS certs (3650 days), updates stack.json certExpiresAt,
# and syncs lesson PEM constants.
#
# DEMO CONTENT STABILITY CONTRACT:
#   Touches cert files, stack.json certExpiresAt, cert README dates, and PEM constants only.
#   Never edits lesson steps, narration, selectors, or tests.
#
# Usage:
#   bash scripts/renew-demo-tls-certs.sh [--dry-run] [--include-grpc]
#
# Requires: openssl, node
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
INCLUDE_GRPC=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --include-grpc) INCLUDE_GRPC=1 ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: bash scripts/renew-demo-tls-certs.sh [--dry-run] [--include-grpc]"
      exit 1
      ;;
  esac
done

DAYS="${DAYS:-3650}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

# shellcheck source=demo-tls-cert-lib.sh
source "$SCRIPT_DIR/demo-tls-cert-lib.sh"

update_cert_expires() {
  local file=$1
  local date=$2
  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const date = process.argv[2];
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    obj.certExpiresAt = date;
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
    console.log('  Updated', file, '→', date);
  " "$file" "$date"
}

update_readme_dates() {
  local file=$1
  local expiry=$2
  if [[ ! -f "$file" ]]; then
    echo "Missing cert README: $file" >&2
    exit 1
  fi
  local generated
  generated=$(date -u +%Y-%m-%d)
  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const generated = process.argv[2];
    const expiry = process.argv[3];
    const days = process.argv[4];
    let t = fs.readFileSync(file, 'utf8');
    t = t.replace(/^Generated:\\s*.+$/m, 'Generated: ' + generated);
    t = t.replace(/^Expires:\\s*.+$/m, 'Expires:   ' + expiry + ' (' + days + '-day validity)');
    fs.writeFileSync(file, t);
    console.log('  Updated', file, '→', expiry);
  " "$file" "$generated" "$expiry" "$DAYS"
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  [dry-run] $*"
  else
    echo "  $*"
    "$@"
  fi
}

echo "=== Renewing demo TLS certificates (DAYS=$DAYS) ==="

run env FORCE=1 DAYS="$DAYS" bash docker/graphql/tls/generate-cert.sh
run env FORCE=1 DAYS="$DAYS" bash docker/graphql/tls/generate-client-cert.sh
run env FORCE=1 DAYS="$DAYS" bash docker/websocket/generate-cert.sh
run env FORCE=1 DAYS="$DAYS" bash docker/websocket/generate-client-cert.sh
run env DAYS="$DAYS" bash docker/kafka/tls/generate-certs.sh

if [[ "$INCLUDE_GRPC" == "1" ]]; then
  run env DAYS="$DAYS" bash docker/grpc/certs/generate.sh
else
  echo "  Skipping gRPC (already long-lived). Pass --include-grpc to regenerate."
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "=== Dry run complete (no stack.json / PEM sync) ==="
  exit 0
fi

echo ""
echo "=== Updating certExpiresAt ==="
GQL_EXPIRY=$(shortest_iso \
  docker/graphql/tls/certs/ca.crt \
  docker/graphql/tls/certs/server.crt \
  docker/graphql/tls/certs/client.crt)
WS_EXPIRY=$(shortest_iso \
  docker/websocket/certs/ca.crt \
  docker/websocket/certs/server.crt \
  docker/websocket/certs/client.crt)
KAFKA_EXPIRY=$(shortest_iso \
  docker/kafka/tls/certs/ca.crt \
  docker/kafka/tls/certs/broker.crt)
GRPC_EXPIRY=$(shortest_iso \
  docker/grpc/certs/ca.crt \
  docker/grpc/certs/server.crt \
  docker/grpc/certs/client.crt)

update_cert_expires docker/graphql/tls/stack.json "$GQL_EXPIRY"
update_cert_expires docker/websocket/stack.json "$WS_EXPIRY"
update_cert_expires docker/kafka/tls/stack.json "$KAFKA_EXPIRY"
update_cert_expires docker/grpc/stack.json "$GRPC_EXPIRY"
update_cert_expires docker/grpc/stack-spring.json "$GRPC_EXPIRY"

echo ""
echo "=== Updating cert README dates ==="
update_readme_dates docker/graphql/tls/certs/README.md "$GQL_EXPIRY"
update_readme_dates docker/websocket/certs/README.md "$WS_EXPIRY"
update_readme_dates docker/kafka/tls/certs/README.md "$KAFKA_EXPIRY"
# Match stack.json: always refresh the gRPC README from the certs on disk,
# even when this run skipped regenerate (--include-grpc).
update_readme_dates docker/grpc/certs/README.md "$GRPC_EXPIRY"

echo ""
echo "=== Syncing lesson PEM constants ==="
node "$SCRIPT_DIR/sync-demo-tls-certs.js"

echo ""
echo "=== Summary ==="
echo "  GraphQL TLS → $GQL_EXPIRY"
echo "  WebSocket   → $WS_EXPIRY"
echo "  Kafka TLS   → $KAFKA_EXPIRY"
echo "  gRPC        → $GRPC_EXPIRY"
echo ""
echo "Next: bump sinceVersion on renewed stacks, then"
echo "  npx tsc -b --noEmit"
echo "  npx vitest run src/__tests__/certExpiry.test.ts"
