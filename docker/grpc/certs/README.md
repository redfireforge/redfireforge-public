# gRPC TLS demo certificates

Generated: 2026-07-04
Expires:   2036-07-01 (existing long-lived set)

Self-signed demo certs for local gRPC TLS / mTLS only. Safe to commit.
The CA private key is not committed; `generate.sh` recreates the whole chain.

## Renewal

gRPC certs already expire in 2036. To regenerate anyway:

```bash
bash scripts/renew-demo-tls-certs.sh --include-grpc
```

Repo checkout only (the CA private key is not committed; this script
recreates the chain and is not in the Learning Hub extract):

```bash
./generate.sh
node ../../../scripts/sync-demo-tls-certs.js
```

Then bump `sinceVersion` in `docker/grpc/stack.json` and `stack-spring.json`
and rebuild Learning Hub so `DEMO_CA_CERT` / client PEMs stay in sync.
