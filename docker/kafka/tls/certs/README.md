# Kafka TLS demo certificates

Generated: 2026-09-02
Expires:   2036-08-30 (3650-day validity)

Self-signed demo certs for the local Kafka TLS broker only. Safe to commit.
`kafka-secure` is SASL-only and has no TLS certs.

## Renewal

From the repo root (preferred):

```bash
bash scripts/renew-demo-tls-certs.sh
```

Repo checkout only (these scripts are not in the Learning Hub extract):

```bash
bash generate-certs.sh
node ../../../scripts/sync-demo-tls-certs.js
```

Then bump `sinceVersion` in `docker/kafka/tls/stack.json` and rebuild Learning Hub
so `KAFKA_TLS_DEMO_CA_PEM` stays in sync.
