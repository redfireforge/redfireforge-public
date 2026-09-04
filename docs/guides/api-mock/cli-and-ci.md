# CLI & CI

Canonical command help also lives in [`cli/README.md`](../../../cli/README.md). Runnable samples: [`examples/api-mock/`](../../../examples/api-mock/).

## Commands

```bash
# Offline corpus (same engine as GUI Simulate)
npx tsx cli/index.ts mock simulate ./api-mock-workspace.json -o results.json --junit junit.xml

# Same run, piped straight into a CI gate (json|junit are format keywords, not paths)
npx tsx cli/index.ts mock simulate ./api-mock-workspace.json --output json | jq '.failed'

# Live journal asserts (companion + running mock)
npx tsx cli/index.ts mock verify ./api-mock-workspace.json --expect-outcome matched --min-calls 1

# Offline verify (no listener)
npx tsx cli/index.ts mock verify ./api-mock-workspace.json --simulate --expect-outcome matched --min-calls 1

# Start via companion (falls back to in-process if companion down)
npx tsx cli/index.ts mock start ./api-mock-workspace.json --port 4600 --wait-ready

# Force in-process (Docker/CI)
npx tsx cli/index.ts mock start ./api-mock-workspace.json --standalone --wait-ready
```

### Options (summary)

| Option | Commands | Meaning |
|---|---|---|
| `--server <id>` | simulate, verify | Target server |
| `-o` / `--junit` | simulate | JSON / JUnit output |
| `--min-calls` | verify | Minimum matching calls/samples |
| `--expect-outcome` | verify | e.g. `matched` |
| `--route` | verify | Restrict to route id |
| `--body-contains` | verify | Substring match |
| `--last-call-within-ms` | verify | Recency (live only) |
| `--simulate` | verify | Offline corpus |
| `--port` | start | Override first server port |
| `--control-base` | start, verify | Companion base (default `http://127.0.0.1:3001`) |
| `--wait-ready` | start | Block until SIGINT; then stop |
| `--standalone` | start | In-process listeners |

## Sample workspace

`examples/api-mock/sample-workspace.json` — `GET /health` on `:4600` (`0.0.0.0` for Docker).

```bash
npx tsx cli/index.ts mock simulate examples/api-mock/sample-workspace.json
curl -s http://127.0.0.1:4600/health   # after mock start --standalone --wait-ready
```

## Docker

```bash
docker build -f examples/api-mock/Dockerfile -t redfireforge-api-mock .
docker run --rm -p 4600:4600 redfireforge-api-mock
curl -s http://127.0.0.1:4600/health
```

Image uses `--standalone --wait-ready`. Loopback hosts rewrite to `0.0.0.0` inside the container.

## CI snippet

```yaml
- name: Mock simulate
  run: npx tsx cli/index.ts mock verify examples/api-mock/sample-workspace.json --simulate --expect-outcome matched --min-calls 1
- name: Mock start (background)
  run: npx tsx cli/index.ts mock start examples/api-mock/sample-workspace.json --standalone --wait-ready &
- name: Health
  run: |
    for i in 1 2 3 4 5; do curl -sf http://127.0.0.1:4600/health && exit 0; sleep 1; done
    exit 1
```
