# GraphQL TLS Test Stack

Local HTTPS + mTLS test environment for the **GraphQL Studio TLS demo lesson** (`gql-https-tls`). Mirrors the structure of `docker/websocket/` TLS stacks.

## Architecture

```
RedfireForge (web / Tauri)
        │
        │  https://localhost:4443   (Phase 1+2)
        │  https://localhost:4445   (Phase 3 mTLS)
        ▼
  nginx TLS proxy
  (gql-tls-proxy / gql-mtls-proxy)
        │
        │  http://gql-test-server-tls:4010  (internal Docker network)
        ▼
  Apollo GraphQL Server
  (same server.js as docker/graphql/)
```

## Ports

| Port | Protocol | Description |
|------|----------|-------------|
| `4443` | HTTPS / WSS | TLS-protected GraphQL endpoint (Phase 1+2) |
| `4444` | HTTP | Health probe for PrerequisiteGate (Phase 1+2) |
| `4445` | HTTPS / WSS | mTLS-protected GraphQL endpoint (Phase 3) |
| `4446` | HTTP | Health probe for PrerequisiteGate (Phase 3) |

## Certificates

TLS certs are **already committed** under `certs/`. Start compose without running generate scripts.

To renew (developers):

```bash
bash scripts/renew-demo-tls-certs.sh
```

The generate scripts remain for local rotation (`FORCE=1`). They are idempotent if certs already exist.

## Start / Stop

```bash
# Phase 1+2 stack (skip-cert and CA cert)
docker compose -f docker/graphql/tls/docker-compose.yml up -d
docker compose -f docker/graphql/tls/docker-compose.yml down

# Phase 3 stack (mTLS — requires client cert + key)
docker compose -f docker/graphql/tls/docker-compose.mtls.yml up -d
docker compose -f docker/graphql/tls/docker-compose.mtls.yml down
```

Both stacks can run simultaneously without port conflicts.

## Verify

```bash
# Health (plain HTTP — no TLS settings required)
curl http://localhost:4444/health
curl http://localhost:4446/health

# Phase 1: skip cert validation
curl -k https://localhost:4443/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ health }"}'

# Phase 2: with CA cert
curl --cacert certs/ca.crt https://localhost:4443/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ health }"}'

# Phase 3: with mTLS client cert
curl --cacert certs/ca.crt \
     --cert   certs/client.crt \
     --key    certs/client.key \
     https://localhost:4445/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ health }"}'
```

## Demo Lesson Usage

This stack powers **Lesson GQL-5 (new): HTTPS, TLS & Certificates** in the GraphQL Demo Hub.

| Demo phase | Endpoint | TLS panel setting |
|-----------|----------|-------------------|
| Phase 1 — skip-cert | `https://localhost:4443/graphql` | Enable "Skip certificate validation" |
| Phase 2 — CA cert   | `https://localhost:4443/graphql` | Paste `certs/ca.crt` into "CA Certificate (PEM)" |
| Phase 3 — mTLS      | `https://localhost:4445/graphql` | CA cert + `certs/client.crt` + `certs/client.key` |

## Lesson PEM constants

Do not paste PEMs by hand. After renewing certs:

```bash
bash scripts/renew-demo-tls-certs.sh
# or: node scripts/sync-demo-tls-certs.js
```

That updates `GQL_TLS_*` in `lesson-https-tls.ts` (and the WebSocket / Kafka / gRPC PEM constants).

## Platform Notes

| Platform | How TLS is applied |
|----------|-------------------|
| Web browser | Node.js proxy (`npm run server`) opens the TLS connection server-side and bridges the browser WebView |
| Tauri desktop | Rust client (rustls) applies TLS settings directly — **no proxy required** |

Setting any TLS option in the web browser automatically routes through the proxy transport. In Tauri, native transport is always used.

## Relation to `docker/graphql/docker-compose.yml`

This TLS stack starts its **own internal copy** of the GraphQL test server (`gql-test-server-tls` on `gql-tls-net`). It does **not** share the server started by the base `docker/graphql/docker-compose.yml` (port 4010 on host). Both stacks can run side-by-side without conflicts.
