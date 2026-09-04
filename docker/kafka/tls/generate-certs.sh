#!/usr/bin/env bash
# =============================================================================
# Generate self-signed TLS certificates for Redpanda broker testing
# =============================================================================
# Creates a CA + broker certificate pair for TLS-encrypted Kafka connections.
#
# Output:
#   certs/ca.crt           — CA certificate (trust this in clients)
#   certs/broker.crt       — Broker certificate signed by the CA
#   certs/broker.key       — Broker private key
#
# Usage:
#   cd docker/kafka/tls && ./generate-certs.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
DAYS="${DAYS:-3650}"

# Do not `rm -rf` this directory — certs/README.md lives here.
mkdir -p "$CERTS_DIR"
rm -f "$CERTS_DIR"/ca.crt "$CERTS_DIR"/ca.key \
  "$CERTS_DIR"/broker.crt "$CERTS_DIR"/broker.key \
  "$CERTS_DIR"/broker.csr "$CERTS_DIR"/broker-ext.cnf "$CERTS_DIR"/ca.srl

echo "Generating CA key and certificate..."
openssl req -new -x509 -days "$DAYS" -nodes \
  -keyout "$CERTS_DIR/ca.key" \
  -out "$CERTS_DIR/ca.crt" \
  -subj "/C=US/ST=Test/L=Test/O=RedfireForge/CN=RedfireForge-CA"

echo "Generating broker key and CSR..."
openssl req -new -nodes \
  -keyout "$CERTS_DIR/broker.key" \
  -out "$CERTS_DIR/broker.csr" \
  -subj "/C=US/ST=Test/L=Test/O=RedfireForge/CN=localhost"

cat > "$CERTS_DIR/broker-ext.cnf" <<EOF
[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = redpanda-tls
IP.1  = 127.0.0.1
EOF

echo "Signing broker certificate with CA..."
openssl x509 -req -days "$DAYS" \
  -in "$CERTS_DIR/broker.csr" \
  -CA "$CERTS_DIR/ca.crt" \
  -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/broker.crt" \
  -extfile "$CERTS_DIR/broker-ext.cnf" \
  -extensions v3_req

rm -f "$CERTS_DIR/broker.csr" "$CERTS_DIR/broker-ext.cnf" "$CERTS_DIR/ca.srl"

echo ""
echo "Certificates generated in: $CERTS_DIR/"
ls -la "$CERTS_DIR/"
echo ""
echo "To verify: openssl verify -CAfile $CERTS_DIR/ca.crt $CERTS_DIR/broker.crt"
