# gRPC Fixture Stack (Phase 12D)

Expanded local fixture stack for gRPC Studio and Demo Hub validation:

- Plaintext Go fixture (`:50051`)
- TLS fixture (`:50443`)
- mTLS fixture (`:50444`)
- Envoy grpc-web proxy fixture (`:50055`)
- Spring Boot fixture (`:9090` gRPC, `:8081` actuator/HTTP)
- Go mock servicer profile (`:50061` gRPC, `:50062` health/rules)
- OAuth2 mock token endpoint (`:50560`)

The stack supports reflection plus all four call types, and includes schema-v2 style payload coverage via `CreateComplexEcho`.

## Quick start

```bash
cd docker/grpc
docker compose up -d --build
./probe-fixtures.sh
```

Enable the Go mock servicer profile:

```bash
cd docker/grpc
docker compose --profile mock-servicer up -d --build
./probe-fixtures.sh --with-go-mock
```

Run the full P1-B acceptance sequence in one command from repo root:

```bash
npm run grpc:p1b:acceptance
```

Health probes are also available individually:

```bash
curl http://localhost:50052/health
curl http://localhost:50453/health
curl http://localhost:50454/health
curl http://localhost:50560/health
curl http://localhost:8081/actuator/health
```

## Endpoints

| Port | Protocol | Purpose |
|---|---|---|
| 50051 | gRPC (HTTP/2, plaintext) | Core Go fixture service with reflection |
| 50052 | HTTP | Core fixture health check |
| 50443 | gRPC (HTTP/2, TLS) | TLS fixture (server-auth TLS) |
| 50453 | HTTP | TLS fixture health check |
| 50444 | gRPC (HTTP/2, mTLS) | mTLS fixture (client cert required) |
| 50454 | HTTP | mTLS fixture health check |
| 50055 | Envoy grpc-web proxy | Browser-direct grpc-web proxy to `grpc-test-server:50051` |
| 9090 | gRPC (HTTP/2, plaintext) | Spring Boot fixture gRPC service |
| 8081 | HTTP | Spring Boot actuator/health |
| 50061 | gRPC (HTTP/2, plaintext) | Go mock servicer (rule-driven response fixture) |
| 50062 | HTTP | Go mock servicer health + rule inspection |
| 50560 | HTTP | OAuth2 mock token endpoint (`/oauth2/token`) for demo lessons |

## RPC behaviour

| RPC | Type | Behaviour |
|---|---|---|
| `Echo` | Unary | Response `message` equals request `message`. `@sleep:8000` delays ~8s (cancel E2E). |
| `CreateComplexEcho` | Unary | Echoes complex payload fields (`labels`, `attributes`) and returns `request_id` + `received_unix_ms`. |
| `ServerStream` | Server streaming | Emits `repeat_count` messages (default 1), optional `interval_ms` between messages. |
| `ClientStream` | Client streaming | Aggregates client messages (comma-separated) into one response on client EOF. |
| `BidiStream` | Bidirectional | Echoes each client message as a server message. |
| `Lookup` | Unary | Returns `status: "ok"` and `resolved_id` from request `ref.id` (or `"unknown"` when empty). |
| `Say` | Unary | Echo-style Eliza response: returns the input sentence (default `"hello"` when empty). |
| `Introduce` | Server streaming | Sends a short three-line intro stream for demo validation. |
| `Converse` | Bidirectional | Echoes each incoming sentence back as streaming responses. |

### ServerStream request fields

| Field | Default | Notes |
|---|---|---|
| `message` | `"stream"` | Base text; appends `[i/N]` when `repeat_count > 1` |
| `repeat_count` | `1` | Number of server messages |
| `interval_ms` | `0` | Delay between messages |

## Proto

See `proto/echo.proto` — mirrored in `FIXTURE_ECHO_PROTO` / `FIXTURE_DESCRIPTOR` in `src/shared/grpc/contractFixtures.ts`.

Schema-v2 fixture additions are provided in the same proto surface through `CreateComplexEcho` + complex request/response messages.

The schema-discovery sample service is defined in `proto/api.proto` (`api.ApiService/Lookup`).
It is intentionally handled via unknown-service routing so reflection-based explorer lists remain focused on `echo.EchoService`.

Regenerate Go stubs (Docker build does this automatically):

```bash
cd docker/grpc/go-server
protoc --proto_path=../proto \
  --go_out=echo --go_opt=paths=source_relative \
  --go-grpc_out=echo --go-grpc_opt=paths=source_relative \
  ../proto/echo.proto

protoc --proto_path=../proto \
  --go_out=api --go_opt=paths=source_relative \
  --go-grpc_out=api --go-grpc_opt=paths=source_relative \
  ../proto/api.proto
```

## With RedfireForge

1. Terminal A: `npm run server` (Express `:3001`)
2. Terminal B: `npm run dev` (Vite `:5173`)
3. Open **Protocols → gRPC**, set target `localhost:50051`, click **Reflect**, select a method.

Suggested target matrix for manual transport checks:

- Express/tauri plaintext: `localhost:50051`
- Express/tauri TLS: `localhost:50443` (`ca.crt`)
- Express/tauri mTLS: `localhost:50444` (`ca.crt` + `client.crt` + `client.key`)
- Browser direct grpc-web via Envoy: `localhost:50055`
- Spring fixture: `localhost:9090` (gRPC) and `localhost:8081` (actuator)

Quick grpcurl check for schema-discovery method:

```bash
grpcurl -plaintext -d '{"ref":{"id":"A-100"}}' localhost:50051 api.ApiService/Lookup
```

Expected response includes:

```json
{"status":"ok","resolvedId":"A-100"}
```

Quick OAuth2 token endpoint check:

```bash
curl -s -X POST http://localhost:50560/oauth2/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials&client_id=client-id-demo&client_secret=client-secret-demo&scope=read%20write'
```

Expected response includes:

```json
{"access_token":"rf-demo-client-id-demo-token","token_type":"Bearer","expires_in":3600,"scope":"read write"}
```

Quick grpcurl checks for ElizaService (BSR lesson parity):

```bash
grpcurl -plaintext -d '{"sentence":"hi"}' localhost:50051 connectrpc.eliza.v1.ElizaService/Say
grpcurl -plaintext localhost:50051 list
```

Expected `list` output includes:

```text
connectrpc.eliza.v1.ElizaService
echo.EchoService
```

Streaming RPCs appear in the explorer with SS/CS/BD badges; full stream compose UI ships with the Studio streaming panels.

## TLS/mTLS certs

Fixture certs are checked into `docker/grpc/certs/`:

- `ca.crt` — local fixture CA certificate
- `server.crt` / `server.key` — server cert for TLS + mTLS fixture targets
- `client.crt` / `client.key` — client cert for mTLS probes

To rotate certs locally (repo checkout only — `certs/generate.sh` is not
in the Learning Hub extract):

```bash
./certs/generate.sh
```

Do not reuse these certs outside local fixture development.

## Fixture probe script

`./probe-fixtures.sh` validates all fixture endpoints:

1. Health probes (Go plaintext/TLS/mTLS + Spring actuator)
2. Plaintext unary probe (`:50051`)
3. TLS unary probe (`:50443`)
4. mTLS unary probe (`:50444`)
5. Envoy grpc-web upstream reachability probe (`:50055`)
6. Spring gRPC schema-v2 probe (`CreateComplexEcho` on `:9090`)

`./probe-fixtures.sh --with-go-mock` adds Go mock servicer checks:

1. Mock servicer health and rule import (`:50062`)
2. Metadata predicate match (`x-tenant: acme`)
3. Body-path predicate match (`attributes.order_id == "123"`)
4. Server stream canned response sequence

Mock rule source: `go-mock-server/config/rules.json`.

## E2E

```bash
# Without Docker — shell + mocked drift specs; live specs skip gracefully:
npx playwright test e2e/grpc-studio-shell.spec.ts e2e/grpc-studio-schema-drift.spec.ts --reporter=list

# Full suite — shell + live specs (see `npm run test:e2e:grpc`):
npm run test:e2e:grpc
```

Descriptor sources, schema drift, and Studio troubleshooting notes live with the gRPC Studio product UI and `docs/guides/grpc-dev-loop.md` (local phase-gate workflow).
