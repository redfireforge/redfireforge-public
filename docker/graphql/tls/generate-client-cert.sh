#!/usr/bin/env bash
# Generate a client certificate signed by the RedfireForge Dev Root CA.
# Used for mTLS (Mutual TLS) Phase 3 testing against the gql-mtls-proxy service.
#
# Prerequisites:
#   Run ./generate-cert.sh first to create certs/ca.crt and certs/ca.key.
#
# Why a proper chain?
#   The Node.js proxy and Tauri native transport expect a leaf cert (CA:FALSE)
#   with extendedKeyUsage=clientAuth signed by the CA that the mTLS nginx server
#   trusts (ssl_client_certificate = ca.crt).
#
# Outputs (in ./certs):
#   client.crt  - client leaf cert  → paste into "Client Certificate (PEM)"
#   client.key  - client private key → paste into "Client Private Key (PEM)"
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"

if [[ ! -f "$CERT_DIR/ca.crt" ]] || [[ ! -f "$CERT_DIR/ca.key" ]]; then
  echo "ERROR: CA not found. Run ./generate-cert.sh first." >&2
  exit 1
fi

# Idempotent: skip if client cert already exists.
# Re-run with FORCE=1 to regenerate (e.g. FORCE=1 ./generate-client-cert.sh).
if [[ -f "$CERT_DIR/client.crt" ]] && [[ "${FORCE:-0}" != "1" ]]; then
  echo "Client cert already exists in $CERT_DIR — skipping generation."
  echo "To regenerate: FORCE=1 ./generate-client-cert.sh"
  exit 0
fi

DAYS="${DAYS:-3650}"

# Client key + CSR
openssl req -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/client.key" \
  -out    "$CERT_DIR/client.csr" \
  -subj   "/CN=RedfireForge Test Client/O=RedfireForge Dev/OU=GraphQL Studio"

# Sign the client cert with the CA (clientAuth EKU, CA:FALSE)
openssl x509 -req \
  -in     "$CERT_DIR/client.csr" \
  -CA     "$CERT_DIR/ca.crt" \
  -CAkey  "$CERT_DIR/ca.key" \
  -CAcreateserial \
  -days   "$DAYS" \
  -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=clientAuth\n') \
  -out    "$CERT_DIR/client.crt"

rm -f "$CERT_DIR/client.csr" "$CERT_DIR/ca.srl"
chmod 600 "$CERT_DIR/client.key"

echo ""
echo "Generated mTLS client credentials in $CERT_DIR:"
echo "  client.crt  ← paste into 'Client Certificate (PEM)'"
echo "  client.key  ← paste into 'Client Private Key (PEM)'"
echo ""
echo "To print for pasting:"
echo "  cat $CERT_DIR/client.crt"
echo "  cat $CERT_DIR/client.key"
echo ""
echo "Next step — start the mTLS stack:"
echo "  docker compose -f docker/graphql/tls/docker-compose.mtls.yml up -d"
