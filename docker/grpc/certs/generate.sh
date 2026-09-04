#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi

CA_KEY="$TMP_DIR/ca.key"
CA_SRL="$TMP_DIR/ca.srl"
DAYS="${DAYS:-3650}"

openssl req -x509 -newkey rsa:2048 -days "$DAYS" -nodes \
  -keyout "$CA_KEY" \
  -out "$ROOT_DIR/ca.crt" \
  -subj "/C=US/ST=CA/L=Local/O=RedfireForge/OU=gRPC Fixtures/CN=redfire-grpc-fixture-ca"

openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$ROOT_DIR/server.key" \
  -out "$TMP_DIR/server.csr" \
  -config "$ROOT_DIR/openssl-server.cnf"

openssl x509 -req -in "$TMP_DIR/server.csr" \
  -CA "$ROOT_DIR/ca.crt" -CAkey "$CA_KEY" -CAcreateserial \
  -CAserial "$CA_SRL" \
  -out "$ROOT_DIR/server.crt" -days "$DAYS" -sha256 \
  -extensions req_ext -extfile "$ROOT_DIR/openssl-server.cnf"

openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$ROOT_DIR/client.key" \
  -out "$TMP_DIR/client.csr" \
  -config "$ROOT_DIR/openssl-client.cnf"

openssl x509 -req -in "$TMP_DIR/client.csr" \
  -CA "$ROOT_DIR/ca.crt" -CAkey "$CA_KEY" -CAcreateserial \
  -CAserial "$CA_SRL" \
  -out "$ROOT_DIR/client.crt" -days "$DAYS" -sha256 \
  -extensions req_ext -extfile "$ROOT_DIR/openssl-client.cnf"

echo "Generated fixture certs under $ROOT_DIR"
