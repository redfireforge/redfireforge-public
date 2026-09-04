#!/usr/bin/env bash
# =============================================================================
# CI gate: fail the build when any bundled demo TLS cert expires within
# FAIL_DAYS days (default 730 = 2 years).
#
# Usage:
#   bash scripts/check-cert-expiry.sh
#
# Exit codes:
#   0 — certs have at least FAIL_DAYS remaining; stack.json / README dates match
#   1 — expired/expiring cert, unreadable cert, or stack.json / README drift
#
# GitHub Actions annotations:
#   ::error::  — on hard-fail (< FAIL_DAYS remaining)
# =============================================================================
set -euo pipefail

FAIL_DAYS="${FAIL_DAYS:-730}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v openssl >/dev/null 2>&1; then
  echo "::error::openssl is required to check demo TLS cert expiry"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "::error::node is required to verify stack.json certExpiresAt"
  exit 1
fi

# shellcheck source=demo-tls-cert-lib.sh
source "$SCRIPT_DIR/demo-tls-cert-lib.sh"
cd "$REPO_ROOT"

read_cert_expires_at() {
  node -e "
    const v = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).certExpiresAt;
    if (v === undefined) { console.error('missing certExpiresAt'); process.exit(2); }
    process.stdout.write(v === null ? 'null' : String(v));
  " "$1"
}

any_failed=0

assert_stack_expiry() {
  local stack_rel=$1
  shift
  local expected actual
  expected=$(shortest_iso "$@") || { any_failed=1; return; }
  actual=$(read_cert_expires_at "$stack_rel") || {
    echo "::error::Cannot read certExpiresAt from $stack_rel"
    any_failed=1
    return
  }
  if [[ "$actual" != "$expected" ]]; then
    echo "::error::$stack_rel certExpiresAt=$actual, shortest cert UTC date=$expected"
    any_failed=1
  else
    echo "OK  $stack_rel certExpiresAt=$actual"
  fi
}

assert_null_expiry() {
  local stack_rel=$1
  local actual
  actual=$(read_cert_expires_at "$stack_rel") || {
    echo "::error::Cannot read certExpiresAt from $stack_rel"
    any_failed=1
    return
  }
  if [[ "$actual" != "null" ]]; then
    echo "::error::$stack_rel should have certExpiresAt null, got $actual"
    any_failed=1
  else
    echo "OK  $stack_rel certExpiresAt=null"
  fi
}

assert_readme_expiry() {
  local readme_rel=$1
  local expected=$2
  local actual
  actual=$(grep -E '^Expires:' "$readme_rel" | head -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)
  if [[ -z "$actual" ]]; then
    echo "::error::No Expires: YYYY-MM-DD line in $readme_rel"
    any_failed=1
    return
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "::error::$readme_rel Expires=$actual, stack.json=$expected"
    any_failed=1
  else
    echo "OK  $readme_rel Expires=$actual"
  fi
}

CERTS=()
while IFS= read -r rel_cert; do
  CERTS+=("$rel_cert")
done < <(find "$REPO_ROOT/docker" -name '*.crt' \
  -not -path '*/target/*' -not -path '*/node_modules/*' -print \
  | sed "s|^$REPO_ROOT/||" | sort)

if [[ ${#CERTS[@]} -eq 0 ]]; then
  echo "::error::No .crt files under docker/"
  exit 1
fi

for rel_cert in "${CERTS[@]}"; do
  cert="$REPO_ROOT/$rel_cert"
  if [[ ! -f "$cert" ]]; then
    echo "::error::Missing bundled cert: $rel_cert"
    any_failed=1
    continue
  fi

  iso=$(iso_from_cert "$cert" 2>/dev/null || true)
  if [[ -z "$iso" ]]; then
    echo "::error::Cannot read cert: $rel_cert"
    any_failed=1
    continue
  fi

  remaining_days=$(calendar_days_remaining "$iso" 2>/dev/null || true)
  if [[ -z "$remaining_days" ]]; then
    echo "::error::Cannot parse expiry date for $rel_cert ($iso)"
    any_failed=1
    continue
  fi

  if (( remaining_days < FAIL_DAYS )); then
    echo "::error::Cert expiring in ${remaining_days}d (< ${FAIL_DAYS}d threshold): $rel_cert — expires $iso"
    any_failed=1
  else
    echo "OK  ${remaining_days}d remaining — $rel_cert"
  fi
done

echo ""
echo "=== stack.json certExpiresAt ==="
# Keep in sync with TLS_STACK_CERTS / NON_TLS_STACKS in src/__tests__/certExpiry.test.ts
assert_stack_expiry docker/graphql/tls/stack.json \
  docker/graphql/tls/certs/ca.crt \
  docker/graphql/tls/certs/server.crt \
  docker/graphql/tls/certs/client.crt
assert_stack_expiry docker/websocket/stack.json \
  docker/websocket/certs/ca.crt \
  docker/websocket/certs/server.crt \
  docker/websocket/certs/client.crt
assert_stack_expiry docker/kafka/tls/stack.json \
  docker/kafka/tls/certs/ca.crt \
  docker/kafka/tls/certs/broker.crt
assert_stack_expiry docker/grpc/stack.json \
  docker/grpc/certs/ca.crt \
  docker/grpc/certs/server.crt \
  docker/grpc/certs/client.crt
assert_stack_expiry docker/grpc/stack-spring.json \
  docker/grpc/certs/ca.crt \
  docker/grpc/certs/server.crt \
  docker/grpc/certs/client.crt

assert_null_expiry docker/graphql/stack.json
assert_null_expiry docker/kafka/plaintext/stack.json
assert_null_expiry docker/kafka/secure/stack.json
assert_null_expiry docker/kafka/schema-registry/stack.json
assert_null_expiry docker/websocket/socketio/stack.json
assert_null_expiry docker/websocket/graphql/stack.json
assert_null_expiry docker/websocket/stomp/stack.json
assert_null_expiry docker/api-mock/stack.json

KNOWN_STACKS=(
  docker/graphql/tls/stack.json
  docker/websocket/stack.json
  docker/kafka/tls/stack.json
  docker/grpc/stack.json
  docker/grpc/stack-spring.json
  docker/graphql/stack.json
  docker/kafka/plaintext/stack.json
  docker/kafka/secure/stack.json
  docker/kafka/schema-registry/stack.json
  docker/websocket/socketio/stack.json
  docker/websocket/graphql/stack.json
  docker/websocket/stomp/stack.json
  docker/api-mock/stack.json
)

while IFS= read -r rel_stack; do
  known=0
  for k in "${KNOWN_STACKS[@]}"; do
    if [[ "$rel_stack" == "$k" ]]; then
      known=1
      break
    fi
  done
  if [[ "$known" -eq 0 ]]; then
    echo "::error::Unclassified stack manifest: $rel_stack — add it to scripts/check-cert-expiry.sh and src/__tests__/certExpiry.test.ts"
    any_failed=1
  fi
done < <(find docker \( -name stack.json -o -name stack-spring.json \) \
  -not -path '*/target/*' -not -path '*/node_modules/*' -print | sort)

echo ""
echo "=== unused cert dirs ==="
unused_kafka=$(find docker/kafka/certs \( -name '*.crt' -o -name '*.key' \) \
  -type f -not -path '*/target/*' -not -path '*/node_modules/*' -print 2>/dev/null | head -1 || true)
if [[ -n "$unused_kafka" ]]; then
  echo "::error::docker/kafka/certs/ must stay free of .crt/.key — TLS material lives in docker/kafka/tls/certs/"
  any_failed=1
else
  echo "OK  docker/kafka/certs/ has no .crt/.key"
fi

echo ""
echo "=== cert README Expires ==="
assert_readme_expiry docker/graphql/tls/certs/README.md "$(read_cert_expires_at docker/graphql/tls/stack.json)"
assert_readme_expiry docker/websocket/certs/README.md "$(read_cert_expires_at docker/websocket/stack.json)"
assert_readme_expiry docker/kafka/tls/certs/README.md "$(read_cert_expires_at docker/kafka/tls/stack.json)"
assert_readme_expiry docker/grpc/certs/README.md "$(read_cert_expires_at docker/grpc/stack.json)"

if (( any_failed == 1 )); then
  echo ""
  echo "FAIL: Demo TLS certs, stack.json dates, or README dates are invalid."
  echo "Run: bash scripts/renew-demo-tls-certs.sh"
  exit 1
fi

echo ""
echo "All demo TLS certs have at least ${FAIL_DAYS} days remaining, and stack.json / README dates match."
