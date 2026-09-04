# WebSocket TLS demo certificates

Generated: 2026-09-02
Expires:   2036-08-30 (3650-day validity)

Self-signed demo certs for local WebSocket TLS / mTLS only. Safe to commit.

## Renewal

From the repo root (preferred):

```bash
bash scripts/renew-demo-tls-certs.sh
```

Repo checkout only (these scripts are not in the Learning Hub extract):

```bash
FORCE=1 ./generate-cert.sh
FORCE=1 ./generate-client-cert.sh
node ../../scripts/sync-demo-tls-certs.js
```

Then bump `sinceVersion` in `docker/websocket/stack.json` and rebuild Learning Hub
so `ws-tls-demo-certs.ts` PEMs stay in sync.
