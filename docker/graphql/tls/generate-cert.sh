#!/usr/bin/env bash
# Generate a local TLS chain for the GraphQL HTTPS proxy: a root CA plus a
# server (leaf) certificate signed by that CA.
#
# Why a chain (CA + leaf) instead of a single self-signed cert?
#   A self-signed cert with basicConstraints CA:TRUE used directly as the
#   server cert is rejected by strict TLS stacks (rustls/webpki) with
#   "CaUsedAsEndEntity". The native (Tauri) transport uses rustls, so we need
#   a proper end-entity leaf (CA:FALSE) signed by a separate CA. This lets us
#   exercise all TLS panel paths across all transports:
#     - "Skip certificate validation" (rejectUnauthorized:false)
#     - custom CA validation (paste ca.crt → validates the leaf)
#     - default rejection of an untrusted chain
#
# Outputs (in ./certs):
#   ca.crt      - root CA cert  → PASTE THIS into the TLS panel "CA Certificate (PEM)"
#   ca.key      - root CA key   (used only to sign the leaf; never shared)
#   server.crt  - server leaf cert (CN/SAN=localhost) → nginx ssl_certificate
#   server.key  - server leaf key                     → nginx ssl_certificate_key
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "$CERT_DIR"

# Idempotent: skip if CA cert already exists.
# After FORCE=1, run `node scripts/sync-demo-tls-certs.js` (or the renew wrapper)
# so lesson PEM constants match the new CA.
# Re-run with FORCE=1 to regenerate (e.g. FORCE=1 ./generate-cert.sh).
if [[ -f "$CERT_DIR/ca.crt" ]] && [[ "${FORCE:-0}" != "1" ]]; then
  echo "Certs already exist in $CERT_DIR — skipping generation."
  echo "To regenerate: FORCE=1 ./generate-cert.sh"
  exit 0
fi

DAYS="${DAYS:-3650}"

# 1. Root CA (self-signed, CA:TRUE — used only to sign the leaf)
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/ca.key" \
  -out    "$CERT_DIR/ca.crt" \
  -days   "$DAYS" \
  -subj   "/CN=RedfireForge Dev Root CA/O=RedfireForge Dev/OU=GraphQL Studio"

# 2. Server (leaf) key + CSR
openssl req -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out    "$CERT_DIR/server.csr" \
  -subj   "/CN=localhost/O=RedfireForge Dev/OU=GraphQL Studio"

# 3. Sign the leaf with the CA (end-entity: CA:FALSE, SAN=localhost + 127.0.0.1)
openssl x509 -req \
  -in     "$CERT_DIR/server.csr" \
  -CA     "$CERT_DIR/ca.crt" \
  -CAkey  "$CERT_DIR/ca.key" \
  -CAcreateserial \
  -days   "$DAYS" \
  -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n') \
  -out    "$CERT_DIR/server.crt"

rm -f "$CERT_DIR/server.csr" "$CERT_DIR/ca.srl"
chmod 600 "$CERT_DIR/server.key" "$CERT_DIR/ca.key"

echo ""
echo "Generated TLS chain in $CERT_DIR:"
echo "  CA cert : ca.crt    ← paste into 'CA Certificate (PEM)' in the TLS panel"
echo "  CA key  : ca.key    (keep private)"
echo "  Leaf crt: server.crt  (nginx ssl_certificate)"
echo "  Leaf key: server.key  (nginx ssl_certificate_key)"
echo ""
echo "To print the CA cert for pasting into the lesson or TLS panel:"
echo "  cat $CERT_DIR/ca.crt"
echo ""
echo "Next step — start the TLS stack:"
echo "  docker compose -f docker/graphql/tls/docker-compose.yml up -d"
