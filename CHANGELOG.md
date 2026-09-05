# Changelog (Active)

This is the lightweight active changelog.

Format follows Keep a Changelog and Semantic Versioning.

---

## [Unreleased]

### Fixed
- **API Mock parked-server reopen** — Clicking a Saved servers item after closing its last tab always reopens the tab. The sidebar no longer keeps a stale “this tab is still open” callback, which also flaked product CI.
- **Local clone desktop gates** — Hosted/remote web still requires the desktop app for API Mock Start, GraphQL Mock, and Demo Hub desktop-only lessons. A local `npm run dev` clone (`localhost`, `*.localhost`, loopback) now unlocks those features the same way the desktop app does, via the companion on `:3001`.
- **Live demo tab-exit confirm** — Demo Hub `ctx.click` / `ctx.selectOption` no longer trip “Leave the live demo?” when the player itself switches tabs (for example Kafka Quick Start → Protocols). A human click on the activity bar during a lesson still prompts.
- **Demo Hub health-probe DevTools spam** — GraphQL (`:4010`), GraphQL TLS (`:4444` / `:4446`), gRPC echo (`:50052`), and Kafka Console (`:18080`) prerequisite checks now go through `/health/demo-http`. Chrome no longer logs `ERR_CONNECTION_REFUSED` every few seconds while those Docker stacks are stopped.

## [0.8.4] — 2026-09-04

### Added
- **Social preview card (L-16)** — README hero plus Open Graph / Twitter large-image tags on the demo and app shells, using the same 1200×630 art as [redfireforge.com/og-image.png](https://redfireforge.com/og-image.png). GitHub Settings social preview is uploaded.

### Changed
- **Single GitHub release per version** — Standard and Learning Hub installers now publish to one `vX.Y.Z` tag (`RedfireForge_*` vs `RedfireForge-LearningHub-*`). Do not push `-lh` tags. Learning Hub updater reads `latest-demo.json` so it does not overwrite Standard `latest.json`.
- **Signed updater artifacts** — Release builds sign `latest.json` / `latest-demo.json` payloads so in-app updates can verify 0.8.4 and later. The matching private key lives in repo Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`).

### Fixed
- **Learning Hub macOS / Linux Docker detection** — Finder, Dock, Spotlight, and slim Linux `.desktop` PATH often omit Docker. The app now also looks in `/usr/local/bin`, `Docker.app`, `~/.docker/bin`, Homebrew, `/usr/bin`, and `/snap/bin`. Windows already resolved well-known Docker Desktop paths in 0.8.3.

## [0.8.3] — 2026-09-04

### Added
- **CLI `--output json` / `--output junit`** (#57) — `json` and `junit` are now *format keywords* for `-o/--output`, supported by `run`, `workflow`, and `mock simulate`. They print a flat, CI-shaped report straight to stdout and suppress every other stdout write (progress, console summary, file notices, and the SLA / baseline-comparison reports), so the stream can be piped directly into `jq`. Diagnostics still go to stderr and exit codes are unchanged, so `--fail-on-error` (1), `--fail-on-regression` (2/3) and `--fail-on-sla` (4) keep gating. Passing any other value still writes a JSON report to that file path, so `-o results.json` is unaffected; to write a file literally named `json`, qualify it as `--output ./json`.
  - Schema: `{ passed, failed, total, durationMs, results: [{ name, status, durationMs, error }] }`.
  - `workflow` emits one result per **iteration** — matching `--output junit` so both formats agree on `total` — with the individual steps preserved under an additive `steps` array.
- **Copy button on the response body toolbar** (#54) — one-click copy of the raw response body, in both the Request Editor preview and the Response Detail modal. Flashes a checkmark for ~1.5 s, is hidden when there is no body, and works for any content type.

### Changed
- **Learning Hub prerequisite gate (Phase 1)** — web Docker gate no longer claims the desktop app “includes everything.” Download goes to the GitHub releases list (Learning Hub builds are not `/releases/latest`). The command block includes a repo-clone hint, a Copy button, and an Install Docker Desktop link.
- **Learning Hub Docker bundle (Phase 2)** — Learning Hub extracts `docker/` compose trees into app data on launch. On desktop the prerequisite command uses that OS path (no repo clone). Web still shows the clone preamble. `tauri:dev` falls back to the repo `docker/` folder.
- **Learning Hub Start/Stop Stack (Phase 3)** — Desktop prerequisite gate can start and stop the lesson Docker stack (daemon / Compose checks, log stream, port-conflict and OOM errors, cert expiry warning). Web keeps the manual compose command.
- **Learning Hub / TLS demos — certificates renewed (expire 2036).** Kafka, GraphQL, and WebSocket demo TLS certs were regenerated (3650-day validity). **Install this app version**, then restart any local TLS Docker stacks (`docker compose down && docker compose up -d`). Restarting Docker by itself does not update certificates inside an older Learning Hub build. Kafka, WebSocket, GraphQL, and gRPC TLS lessons paste CA/client material from the app; those steps will fail against the new stacks until you update.
- **Learning Hub TLS pre-bundling (Phase 4)** — Demo certs ship in the Learning Hub bundle. The prerequisite command no longer asks the user to run `generate-cert.sh`. Lesson PEM constants are gated to match `docker/*/certs/`. Renewal: `bash scripts/renew-demo-tls-certs.sh`.
- **Learning Hub Windows Docker parity (Phase 5, code)** — Docker CLI is resolved from well-known Windows install paths when PATH is stale; compose spawn hides the extra console window. The gate command uses Windows `cd` quoting (no `&&` / doubled backslashes). State B explains the 90s Docker Desktop start. Live Windows QA is still pending a Windows machine.
- **Learning Hub Docker settings (Phase 6, code)** — Settings → Docker (Learning Hub only) lists all 13 stacks, can stop one or all, shows image disk usage with Remove, persists stop-on-quit in `$APP_DATA/docker-stop-on-close`, and offers Prepare to uninstall (`compose down --rmi all` then wipe extracted stack files). The lesson-gate **Manage Docker settings →** link opens that tab. Web lists stacks but leaves actions disabled. Live quit / installer QA is still pending.
- **Learning Hub last-run Docker logs (Phase 7, code)** — Compose start/stop lines persist to `$APP_DATA/docker/<dir>/last-run-<stackKey>.log` so Show logs still has the previous run after quit + relaunch. A port conflict does not wipe the last successful file. Live desktop restart QA is still pending.
- **Learning Hub port-conflict process name (Phase 8, code)** — State F2 names the process and PID holding a required port (`lsof`/`ps` on macOS/Linux, `netstat`/`tasklist` on Windows, no extra console). Legacy `PORT_CONFLICT:4010` still parses. Live desktop QA is still pending.
- **Learning Hub concurrent stack limit (Phase 9, code)** — At most two Docker stacks at once (`grpc` / `grpc-spring` count as one). Starting a third shows State F3 with per-stack Stop and Retry. Rust is the gate (`STACK_LIMIT:key1,key2`); in-flight starts count during image pull. Live F3 QA is still pending.
- **Learning Hub image pre-download (Phase 10, code)** — First Learning Hub desktop visit can opt in to `docker compose pull --ignore-buildable` (~2 GB of public images). Not now writes `$APP_DATA/docker-images-prefetch` so uninstall does not re-prompt. Settings → Docker has Download / Resume / Cancel. Live clean-install QA is still pending.
- **Learning Hub clone-local Vite Start/Stop Stack** — `npm run dev` / `dev:demo` on `:5173` can start, stop, and stream logs for repo `docker/` stacks through a loopback-only `/__rff-docker` helper (`apply: 'serve'` only). Hosted web, `vite preview`, and Playwright (`navigator.webdriver`) keep the clone-command gate. Settings → Docker Stop all tears down `rff-*` stacks only.
- **CLI error detail in CI reports** — HTTP failures now lead with the status (`HTTP 404: {}` instead of a bare `{}`), and non-HTTP transports fall back to their own transport label rather than a meaningless `HTTP 0`.
- **Exit-code documentation corrected** — `cli/README.md` and `docs/guides/cli-ci-cd.md` previously listed exit `2` as "invalid file" and omitted `3` and `4` entirely. `2` is a baseline regression, `3` is regression plus test failures, `4` is an SLA violation, and an execution error exits `1`.

### Fixed
- **Product coverage `openExternalUrl`** — Branch tests cover a non-string URL and a missing `window` so the waitlist helper stays above the 90% gate.
- **Demo hub pauseAutoPlay unit flake** — Coverage session test no longer requires `stepPhase === 'pre'` after 100ms of auto-play start. A step without `preAction` can already be in `reading`; the assertion is that a double-toggle did not force `done`.
- **Nightly E2E Kafka live consume** — Message Studio waits for the header **Connected** badge before Send/Consume. Consume waits for Earliest/topic to commit (so consume-once is not sent as Latest), waits for **Consuming…** to finish, then retries with a fresh group and a reseeded publish when the result table is empty. Live Kafka specs take a companion lock so `--workers=2` cannot swap the singleton broker connection mid-consume. Gallery Quick Tests wait for the same badge and retry once.
- **Nightly E2E AM-02 / Kafka live** — Duplicate Tab waits for the async clone (and falls back to a local 4600–4699 port when companion `nextAutoPort` fails). Kafka live Consume/Topics assert scoped result rows instead of the first `table tbody tr` on the page.
- **Learning Hub Docker quit / extract** — Stop-on-close downs `rff-*` compose projects on `ExitRequested` and `Exit` without waiting on extract or an in-flight image pull. Extract runs synchronously at launch so a packaged Learning Hub has compose files before the first Start. Unrelated compose projects are left alone.
- **Learning Hub gRPC companion probe** — Companion readiness uses a loopback TCP connect to `:3001` instead of HTTP through `reqwest`, so `ALL_PROXY` / `HTTP_PROXY` cannot false-fail Start while the sidecar is up.
- **Learning Hub Docker stale prompt / false running** — `sinceVersion: 0.8.3` no longer treats a just-started `0.8.3-alpha.N` stack as stale. Compose now uses a unique `-p rff-<slot>` (and a matching `name:` in each compose file) so GraphQL vs WebSocket GraphQL and GraphQL TLS vs Kafka TLS no longer share a project (that made Settings/F3 list stacks that were down, and showed TLS State E while 4443–4446 were closed). Copied gate commands include the same `-p`. Start/Stop also tear down leftovers that used the old folder-name project. The other-stack hint uses *are* when more than one name is listed.
- **E2E Learning Hub AM lessons** — Nightly `test:e2e:demo:hub:ci` now uses one Playwright worker. Two workers shared companion `:3001`, and `stopAllCompanionListeners` in before/afterEach stopped the other lesson's mock (AM-18 journal rows / near-misses empty, server Stopped).
- **E2E Kafka Schema Registry** — A fresh Schema Registry stack has no subjects. Docker global-setup and `kafka-live` now seed `orders-value` (v1 + v2) so the live browse test and the lesson are not left on an empty table.
- **E2E `NO_COLOR` warning** — Playwright workers set `FORCE_COLOR=1`. Agent/CI shells that also set `NO_COLOR` triggered a Node warning on every worker start. Config and the hub CI script drop `NO_COLOR` when both are set.
- **E2E WP-22 flake** — Transport-badge tests use a dedicated mock port (`9890`) and match `Connected` / `— connected` only, so parallel specs that stop `:9876` cannot leave the waiter on **Disconnected**.
- **E2E Kafka Schema Registry demo** — Moved to the `docker` project. `:8085` was down in the default suite because `E2E_WITH_DOCKER` was never set, so global-setup never started Schema Registry. Nightly now starts that stack instead of skipping the spec.
- **Learning Hub Docker gate (full-implementation pass 3)** — Start Demo still locks after the user leaves Concept (the gate stays mounted and keeps probing). A remount no longer starts a second poll interval. Stale Restart copy and Keep Running / Dismiss now match whether `compose down` actually succeeded.
- **Learning Hub Docker gate (follow-up pass)** — After Start Demo unlocks, the gate keeps probing so an in-session Settings Stop or Docker quit disables the button (not only a remount). A failed stale Restart shows the error on that card only and relabels Keep Running to Dismiss, because the previous stack was already stopped.
- **Learning Hub Docker gate (full-implementation pass)** — Start Demo is disabled again when a previously cleared gate finds endpoints down (Settings Stop / Docker quit no longer leave the button enabled). Start Stack stays disabled when cert and manifest probes both fail (unknown TLS). A failed stale-stack Restart keeps the card and shows the error.
- **Learning Hub Docker settings (Phase 5–10 tenth pass)** — Settings Stop of an F3-listed stack now drops that key from the lesson gate (and a gRPC sibling after a shared-project Stop). Already-quoted Windows extract paths strip a trailing `\` so cmd.exe quoting stays closed.
- **Learning Hub Docker settings (Phase 5–10 ninth pass)** — A Settings Stop that lands while the lesson’s first `compose ps` is still in flight no longer lets that stale “running” result resurrect the gate or the shared running flag.
- **Learning Hub Docker settings (Phase 5–10 eighth pass)** — Settings Stop now updates the open lesson gate (the shared running flag was written but `controlState` stayed on “running”). Unknown Compose status shows Checking… instead of Not running, and a successful Stop marks that stack known so Remove can enable. Port pre-check also treats an IPv6 all-interfaces listener (`::`) as occupied, matching the existing `0.0.0.0` rule.
- **Learning Hub Docker settings (Phase 6 seventh pass)** — Remove / Remove all stay disabled until Compose has confirmed that stack is stopped (a first-load failed `compose ps` no longer looks like “not running” and offered Remove while images were listed).
- **Learning Hub docker extract (Phase 2 sixth pass)** — Completeness also requires every Spring Boot source under `COPY src` (the other Java services, `application.yml`, and proto files). A leftover extract with only the application class can no longer stamp complete and then fail `compose up --build`.
- **Learning Hub Start/Stop Stack (Phase 3 seventh pass)** — Stale-stack Restart passes `--build` so a version-bump Restart rebuilds local images, not only bind-mounted compose/certs.
- **Learning Hub concurrent stack limit (Phase 9 sixth pass)** — A Compose “stopped” result wins over a stale in-memory running flag (the fifth-pass unknown-probe guard no longer keeps Stop on a stack that is already down).
- **Learning Hub last-run Docker logs (Phase 7 fifth pass)** — A rejected `docker-log` / low-memory `listen()` is retried once so Show logs still streams this run.
- **Learning Hub port-conflict process name (Phase 8 fifth pass)** — Start also treats an all-interfaces IPv4 listener (`0.0.0.0`) as a port conflict, matching Compose’s published host bind.
- **Learning Hub concurrent stack limit (Phase 9 fifth pass)** — A failed `compose ps` no longer counts as “not running” for the two-stack gate (that allowed a third Start, or showed F2 on our own ports). The lesson gate keeps checking when stack status is unknown instead of offering Start.
- **Learning Hub image pre-download (Phase 10 fifth pass)** — A failed `docker-pull` listen is retried on Download. Cancel after the last image pull no longer reports success or writes `done`.
- **Learning Hub concurrent stack limit (Phase 9)** — Overlapping Start of the same stack keeps the in-flight reservation until the last command returns (two GraphQL lessons during image pull no longer drop the slot). A late Docker-not-running probe no longer wipes State F3.
- **Learning Hub concurrent stack limit (Phase 9 re-review)** — F3 Stop and Retry stay disabled while `compose down` is in flight (a second Stop / Retry is ignored). An empty or unknown `STACK_LIMIT` payload stays on F3 instead of bouncing to State C. Limit keys are deduped. Reserved-start Rust tests serialize on a mutex so parallel `cargo test` cannot share the global reservation map.
- **Learning Hub concurrent stack limit (Phase 9 third pass)** — F3 Stop buttons stay in roster order when one listed stack is still pulling (reserved) and another is already up. The gate also sorts `STACK_LIMIT` keys to the known stack roster.
- **Learning Hub concurrent stack limit (Phase 9 fourth pass)** — F3 Stop / Settings Stop / Stop all / quit kill the in-flight `compose up` (including the gRPC sibling) so a stack that is still pulling cannot come back up after Stop. The starting lesson returns to State C (`START_CANCELLED`), not Retry.
- **Learning Hub image pre-download (Phase 10 re-review)** — Download no longer writes `accepted` before Docker is running (a failed first click no longer skips the next launch prompt). A second Download click is ignored. Cancel after `compose images` still kills the pull child. Settings Download stays disabled during Stop / Remove; Prepare to uninstall cancels an in-flight pull. Escape still dismisses the Docker-down error modal.
- **Learning Hub image pre-download (Phase 10 fourth pass)** — Cancel no longer reopens the first-launch modal. A late Settings hydrate does not clear an in-flight Download. Remove / Remove all stay disabled while images are pulling; Rust also refuses Remove during prefetch.
- **Learning Hub port-conflict process name (Phase 8)** — Windows lookup uses `netstat -ano` so IPv6 listeners are named ( `-p tcp` was IPv4-only). Occupant parsers strip a UTF-16 BOM. State F2 still shows the PID when `ps`/`tasklist` does not return a process name.
- **Learning Hub port-conflict process name (Phase 8 re-review)** — Lookup decodes UTF-16 stdout (not only a UTF-8 BOM). lsof matches `*:4010(LISTEN)` glued tokens and takes the first numeric PID. netstat takes the last numeric field so an extra Offload column is not treated as the PID. `lsof`/`ps`/`netstat`/`tasklist` resolve from well-known install paths when PATH is slim.
- **Learning Hub port-conflict process name (Phase 8 third pass)** — Windows lookup also decodes UTF-16 LE stdout that has no BOM (a UTF-8 netstat capture is unchanged).
- **Learning Hub port-conflict process name (Phase 8 fourth pass)** — Start also treats an IPv6-loopback listener (`::1`) as a port conflict. A missing IPv6 stack (`AddrNotAvailable`) is not treated as occupied.
- **Learning Hub last-run Docker logs (Phase 7)** — Show logs no longer triggers a docker extract (that wipe deleted the last-run file). Extract now restores `last-run-*.log` after a version-bump recopy. A port conflict or stack-limit Start restores the previous file into the panel instead of leaving it blank.
- **Learning Hub last-run Docker logs (Phase 7 re-review)** — Show logs refreshes from the file when it grew (Settings → Stop while the lesson is unmounted). A Start that finishes with an empty live buffer loads this attempt from the file. Extract does not copy `last-run-*.log` out of the bundle, and append creates a missing stack directory.
- **Learning Hub last-run Docker logs (Phase 7 third pass)** — Compose log append, Start truncate, and spawn-fail restore hold the extract mutex so a version-bump recopy cannot wipe the file mid-write. A last-run file that grows past 512 KB is rewritten to the 256 KB newline-aligned tail.
- **Learning Hub last-run Docker logs (Phase 7 fourth pass)** — Leaving a lesson before the docker-log / low-memory listener finishes attaching no longer leaks that listener.
- **Learning Hub Docker settings (Phase 6)** — Manage Docker settings no longer reopens the Docker tab on the next Settings visit. Prepare to Uninstall extracts compose files first and does not say “Cleanup complete” when Docker reported errors. Disk-usage invoke failures surface in the panel. Remove all is disabled when every imaged stack is running. Stop-on-close treats `FALSE` as off.
- **Learning Hub Docker settings (Phase 6 re-review)** — Remove-all / uninstall `--rmi` skip a compose dir already handled (`grpc` + `grpc-spring` share one project). Remove all is disabled when any imaged stack is running. Sibling Stop, Stop all, Remove, and Prepare to uninstall stay disabled while a stop is in flight. Quit stops stacks with a 30s timeout so a stuck `compose down` cannot hang Exit. Remove / uninstall confirms no longer use the generic “Confirm Deletion” title.
- **Learning Hub Docker settings (Phase 6 third pass)** — Stop stays disabled while `compose down --rmi` is in flight (not only during Stop). A failed stop-on-close write reverts the checkbox and shows the error.
- **Learning Hub Docker settings (Phase 6 fourth pass)** — Prepare to Uninstall with partial errors keeps the button (retry) and refreshes running status instead of claiming every stack is stopped.
- **Learning Hub Docker settings (Phase 6 fifth pass)** — A failed stack-status probe no longer marks a running stack stopped (Stop stayed hidden and Remove became enabled). Remove refreshes disk usage after a partial `--rmi` failure. Rust also refuses `--rmi` when Compose cannot confirm the stack is stopped.
- **Learning Hub Docker settings (Phase 6 sixth pass)** — Stop all no longer treats a failed `compose ps` as “nothing running” (that marked every stack stopped). A successful Prepare to Uninstall no longer re-extracts `$APP_DATA/docker/` via a disk-usage refresh.
- **Learning Hub TLS pre-bundling (Phase 4 fifth pass)** — The bundled gRPC README now labels `certs/generate.sh` as repo-checkout only (that script is not in the Learning Hub extract).
- **Learning Hub TLS pre-bundling (Phase 4 sixth pass)** — The gate also strips Windows `certs\generate.sh` steps.
- **Learning Hub Windows Docker parity (Phase 5)** — State B no longer says Docker Desktop “is starting” before the user opens it. Open Desktop / update-check use detached `cmd /C start` with no extra console. `compose version` uses the same 10s timeout as `docker info` so a hung check during Desktop startup stays on State B. Windows command quoting normalizes `/` to `\` and splits every `&&` onto its own line so PowerShell 5 can paste TLS / gRPC commands.
- **Learning Hub Windows Docker parity (Phase 5 re-review)** — Desktop rewrite now switches drive (`C:` then `cd`) so Command Prompt works when the terminal is not on C:, and drops `#` comment-only lines (gRPC Terminal notes). Web clone preamble still uses `#` and tells Windows users to paste into PowerShell. Docker CLI / Desktop lookup includes `%LOCALAPPDATA%` install paths.
- **Learning Hub Windows Docker parity (Phase 5 third pass)** — `docker.exe` on PATH wins over a leftover Program Files binary. Host detection uses `navigator.platform` when the UA omits Windows. Quoted Windows paths drop a trailing `\` so cmd.exe quoting stays closed.
- **Learning Hub TLS pre-bundling (Phase 4)** — WebSocket TLS concept copy and GraphQL mTLS narration no longer tell viewers to run `generate-cert.sh`. Compose/stack README comments are compose-only (certs pre-bundled). Extract completeness now requires TLS `ca.crt` / `client.crt` so a compose-only leftover extract is not stamped complete.
- **Learning Hub TLS pre-bundling (Phase 4 re-review)** — Extract completeness also requires server/broker and client key files (a CA-only leftover extract can no longer stamp complete). The gate strips `bash generate-certs.sh` steps. WebSocket TLS stack inference no longer depends on a `generate-cert` substring. Cert README alternate generate paths are labeled repo-checkout only.
- **Learning Hub TLS pre-bundling (Phase 4 third pass)** — Learning Hub no longer bundles `certs/*.sh` / `certs/*.cnf` (generate scripts stay repo-checkout only). The gate also strips generate scripts on their own lines and `sh` / `.\\` prefixes.
- **Learning Hub TLS pre-bundling (Phase 4 fourth pass)** — Cert expiry is read from a complete extract (not a leftover `stack.json`). Start refuses an expired or unreadable `certExpiresAt` in Rust (`CERT_EXPIRED`) so stale-stack Restart cannot bring up an expired TLS stack.
- **Learning Hub Start/Stop Stack (Phase 3)** — `grpc-spring` is running only when the Spring service is up (Go-only `compose ps` no longer marks the Spring lesson as already started). Starting Spring on top of Go skips the shared-port conflict. Stop / image-remove include `--profile spring`. graphql-batch-execution Start passes `--build`. Stop re-extracts first. Stale prompt lists one row per compose project.
- **Learning Hub Start/Stop Stack (Phase 3 re-review)** — Stop no longer fails because an unrelated extract file is missing. Start logs an incomplete-extract error instead of a blank panel. Stop opens logs, ignores a second click while `compose down` is running, and clears gRPC siblings in the in-memory store (down tears down Go + Spring together). Starting Spring on top of Go still reports a port conflict on 9090 / 8081.
- **Learning Hub Start/Stop Stack (Phase 3 third pass)** — A failed `docker compose` spawn restores the previous last-run log. The stale-stack prompt disables every Restart while one restart is in flight.
- **Learning Hub Start/Stop Stack (Phase 3 fourth pass)** — Start stays disabled until cert expiry is known. An expired-cert Start error shows State H (not Retry). Stale-stack Keep Running is disabled while a Restart is in flight.
- **Learning Hub Start/Stop Stack (Phase 3 fifth pass)** — A failed cert-expiry probe on a TLS stack keeps Start disabled instead of enabling until Rust rejects. Stale-stack Restart uses the shared stack roster.
- **Learning Hub Start/Stop Stack (Phase 3 sixth pass)** — A failed TLS cert probe no longer fakes an expired certificate (State H). Start stays disabled until expiry is known; a non-TLS probe failure still allows Start.
- **Learning Hub docker extract (Phase 2)** — extract is serialized so setup and `get_docker_stack_path` cannot wipe each other. Completeness checks all 13 stack compose files plus Kafka `.bootstrap.yaml`, and the version stamp is written only when that set is present. Learning Hub resource globs no longer use `docker/**/*.{js,json,md,yml}` (those matched local `docker/graphql/node_modules`). Hidden Kafka bootstrap files are listed by path. Missing extract dirs now error so the web clone fallback can show.
- **Learning Hub docker extract (Phase 2 re-review)** — Completeness now also requires every `stack.json` / `stack-spring.json` and TLS `docker-compose.mtls.yml`. `get_docker_stack_path` refuses an incomplete tree so the gate does not show a path that cannot start, and holds the extract lock through that check.
- **Learning Hub docker extract (Phase 2 third pass)** — Unknown stack keys (`..`) no longer resolve under app data. Completeness requires nginx / Envoy / oauth-mock bind-mounts. Show logs waits on the extract mutex. Desktop rewrite keeps non-default `-f docker-compose.tls.yml` names.
- **Learning Hub docker extract (Phase 2 fourth pass)** — Completeness also requires the Dockerfiles that `build:` stacks need (`graphql`, `api-mock`, WebSocket GraphQL/Socket.IO, gRPC Go / mock / Spring). A leftover extract without those files can no longer stamp complete and then fail on `compose up --build`.
- **Learning Hub docker extract (Phase 2 fifth pass)** — Completeness also requires the files those Dockerfiles `COPY` (Node `package.json` / `server.js`, gRPC proto + Go sources, Spring `pom.xml` + application class). A leftover extract with only Dockerfiles can no longer stamp complete and then fail on `--build`.
- **Demo TLS cert renewal** — `renew-demo-tls-certs.sh` now writes `certExpiresAt` as the UTC calendar date (a US/Eastern run used to store `2036-06-30` for the gRPC `Jul 1 02:06 GMT` cert). Kafka `generate-certs.sh` no longer `rm -rf`s `certs/` (that deleted `README.md`) and honors `DAYS`. PR CI runs `check-cert-expiry.sh`.
- **Demo TLS cert renewal (re-review)** — Deleting every `.crt` no longer makes Vitest skip the suite. `SKIP_CERT_EXPIRY_TEST` skips only openssl-backed checks (PEM / `stack.json` / README still run). Renew writes the shortest UTC date across CA/server/client, not only `server.crt`. `check-cert-expiry.sh` fails fast without openssl, uses UTC calendar days (macOS `date -j` was off-by-one), and verifies `stack.json` + README dates. CI also runs `sync-demo-tls-certs.js --check`. `iso_from_cert` uses Node UTC dates (same as Vitest) instead of GNU/BSD `date`. Renew always refreshes the gRPC cert README from the certs on disk, even when `--include-grpc` is omitted.
- **Demo TLS cert renewal (third pass)** — `check-cert-expiry.sh` fails if `docker/kafka/certs/` contains `.crt`/`.key` (TLS material belongs in `docker/kafka/tls/certs/`).
- **Demo TLS cert renewal (fourth pass)** — The unused `docker/kafka/certs/` Vitest check walks nested files (same as the shell `find`), so a buried `.crt` / `.key` cannot pass the unit suite.
- **Learning Hub Phase 1 gate** — localhost web no longer flashes a compose-only command before the repo-clone preamble when a stack key is set. Copy stays on **Copy** if `navigator.clipboard` is missing. Hosted `DesktopOnlyGate` (docker-backend) now includes the Docker Desktop install link.
- **Learning Hub Phase 1 gate (re-review)** — `*.localhost`, `[::1]`, and `127.0.0.0/8` keep the local command gate (they were treated as hosted). Desktop Copy is disabled until the extracted stack path resolves, so the first paint is not a repo-relative compose line. **Copied** resets when the command text changes. IPv4-mapped IPv6 loopback (`::ffff:127.0.0.1`) and `0:0:0:0:0:0:0:1` also stay local. Invalid `127.*.*.*` octets are not treated as loopback.
- **Learning Hub Phase 1 gate (third pass)** — Bracketed IPv6 with a trailing FQDN dot (`[::1].`) and expanded IPv4-mapped loopback (`0:0:0:0:0:ffff:127.0.0.1`) keep the local command gate. The trailing-dot strip now runs before bracket unwrap so `[::1].` is not treated as hosted.
- **Learning Hub Phase 1 gate (fourth pass)** — Hex IPv4-mapped loopback (`::ffff:7f00:1`) keeps the local command gate. Hex-mapped LAN (`::ffff:c0a8:10a`) stays hosted.
- **Learning Hub demo bundle globs** — `tauri.conf.demo.json` resource patterns that matched nothing (`proto/**`, `certs/**`, `*.pem`) aborted `tauri:dev:demo`. They now list files that exist.
- **Nightly E2E — waitlist banner chrome** — the Cloud waitlist banner (PR #110) sits above the header on a fresh profile and shifted two `ci` core assertions: the Service Registry footer fell ~13px below the viewport, and the Results Explorer iteration-picker outside-click hit the banner (`z-index: 9998`) instead of the backdrop. Playwright now hides the banner (`navigator.webdriver`), and E2E seeds persist `cloud-waitlist-dismissed`. The two banner mounts are also moved into `AppShellBanners` so `App.tsx` stays under the 750-line monolith gate.
- **Repo-wide lint gate** — `npm run lint` reported 35 errors and 2 warnings; now zero. 20 × `preserve-caught-error` (errors rethrown from `catch` now attach `{ cause }`, preserving the root cause across gRPC proto parsing, TLS certificate generation, GraphQL mock routes and the API Mock listener), 13 × `no-useless-assignment` (dead initialisers and discarded retry results removed), 1 unused import, and 2 stale `eslint-disable` directives. `.tmp` added to `globalIgnores` so gitignored scratch files are no longer linted.

---

## [0.8.2] — 2026-08-29

### Added
- **CODE_OF_CONDUCT.md** — Contributor Covenant v2.1 added to the repository root.

### Changed
- **CI — Node.js 20 → 22** — all GitHub Actions workflows (`ci.yml`, `release.yml`, `demo-nightly.yml`, `publish-cli.yml`) upgraded to Node.js 22 to satisfy peer-dependency requirements of `graphql@17`, `@scalar/*`, and `@kafkajs/confluent-schema-registry`.
- **CI — Unit Tests (product) sharding** — `COVERAGE_SHARDS` set to 2 in CI to match the 2-vCPU `ubuntu-latest` runner, eliminating CPU contention and cutting product coverage run time from ~45 min to ~19 min.
- **CI — path-filter gating** — product and gRPC unit-test jobs now only run when the relevant source paths changed, using `dorny/paths-filter`; unrelated pushes skip the expensive jobs entirely.
- **CI — gRPC Phase 13 artifact chain** — Phase 13B now uploads its transport-parity artifact; Phase 13I downloads all upstream artifacts before running the GA sign-off gate.
- **CI — release.yml branch triggers** — added branch push triggers and a `validate` job so the release workflow reports success (not phantom failure) on non-tag pushes.
- **Dependency upgrades (major)** — applied with full code-compatibility fixes:
  - `eslint` 9 → 10 + `@eslint/js` 9 → 10: disabled unused React Compiler rules; fixed ~30 `no-useless-assignment`, 8 `preserve-caught-error`, and `no-unassigned-vars` violations across the codebase.
  - `express` 4 → 5: updated wildcard route to `{*path}` syntax for `path-to-regexp` v8 compatibility.
  - `better-sqlite3` 12 → 13: N-API refactor, no API changes required.
  - `@testing-library/jest-dom` 6 → 7: added `@testing-library/dom` peer dependency.
  - `jsdom` 29 → 30: fixed `CSS.escape.bind(CSS)` call in `useKeyboardNavigation.ts`.
  - `lint-staged` 16 → 17, `uuid` 13 → 14, `commander` 14 → 15 in `/cli`, `@types/node` 24 → 26.
- **Dependency upgrades (minor/patch)** — 49-package minor/patch group including `graphql-ws`, `graphql-sse`, `typescript-eslint`, and all transitive updates.

### Fixed
- **`vitest.projectPatterns.ts`** — switched to named import `{ minimatch }` after `minimatch` v10 dropped the default export; fixed post-test coverage verification crash.
- **`demoRipple.ts`** — added `typeof window !== 'undefined'` guards in `dispose()` and `position()` to prevent `ReferenceError: window is not defined` when a `setInterval` fires after jsdom environment teardown.
- **`vite.config.ts`** — added `undici` to `optimizeDeps.exclude` to prevent Vite/rolldown from attempting to pre-bundle this Node-only library for the browser (E2E dev server crash).
- **gRPC Phase 13H/13I gate scripts** — updated `validateCiChain` to recognise path-filter gating (`needs.changes.outputs.grpc == 'true'`) as a valid CI guard, in addition to the legacy `pull_request` event check.
- **`scripts/run-product-coverage-fast.sh`** — replaced non-portable `stat -f '%z'` with `wc -c` for cross-platform file-size detection on Linux CI runners.
- **`ApiMockStudioPage.orchestration` test** — increased timeout to 30 s to prevent flaky failures on slow CI runners.
- **CI — `changes` job permissions** — added `pull-requests: read` so `dorny/paths-filter` can access PR diff metadata.
- **grpcDemoCollectionsCleanup tests** — unit tests covering `purgeGrpcDemoSavedRequests` and `purgeEmptyGrpcDemoCollectionsByName` (100% coverage).

### Changed
- **Public repo self-contained for shipping docs/tests** — removed plan/runbook coupling from gates/tests; restored `e2e/DEMO-LESSON-E2E-MEMO.md` (needed by public demo E2E); dropped dead links to missing runbooks/validation records; simplified docs conventions to match published trees only.
- **`.gitignore`** — removed ignore rules for planning/runbook/archive paths that are not part of this repository.
- **README Quick Start** — added "Download a pre-built installer" section (GitHub Releases link, no build toolchain); added `git clone` + Node.js 20+ + Rust prerequisites to build-from-source sections; fixed CLI section to use `npx tsx cli/index.ts` as the working from-source command.
- **CONTRIBUTING.md** — full rewrite: CLA requirements, Node 20+ prerequisites, development workflow, branch naming, PR guidelines, code style, Tauri build notes, issue reporting, corporate CCLA contact.
- **PRIVACY.md** — added canonical GitHub URL, GDPR legal basis for waitlist data processing, clarified storage section (Tally + Supabase with DPA mention).

### Fixed
- **E2E full-suite stability** — demo player step waits tolerate fast-mode phase skips; GQL-1 endpoint preview asserts `data-status="explicit"`; designer Undo/Redo visibility matches current toolbar; run-comparison baseline picker waits for the portaled listbox.

---

## [0.8.0] - 2026-08-26

### Added
- **Learning Hub — richer learning-path cards** — the Demo Hub landing page now shows path descriptions, per-category lesson counts, progress bars, completion rings, status pills, and estimated total time derived from the live lesson registry.
- **API Mock body editor — Tree view** — the full-screen body editor now has a Text / Tree toggle. Tree mode renders an interactive JSON tree with collapsible nodes, syntax colors, search, Expand all / Collapse all, and is kept in sync with the text editor.
- **Runtime journal — collapse the detail panel** — a chevron on the divider lets you hide the request/response detail and give the transaction list the full width, then bring the detail back.
- **Journal redaction — header reference chips** — the Redact headers field now shows clickable chips for common defaults plus extras. Click to add or remove; type any custom name; Restore defaults resets the list.
- **API Mock Proxy — Allowlist failover chain** — the proxy Allowlist is now an ordered primary → backup chain. Unmatched requests try each server top to bottom, moving on only when a server is unreachable or returns 5xx / 404. Any real 2xx/3xx/4xx reply stops the chain.
- **API Mock export — Save to disk** — the export confirmation footer now has a Save to disk button alongside Copy.
- **Response Selection — Pick JSONPath from sample** — conditional rule variants can open the Pattern Toolbox JSONPath picker to select a key from a sample body rather than typing the path by hand.
- **Response body — Browse helpers** — a searchable catalog of every `{{ }}` helper the engine evaluates (request, context, identity, random, transform, state, faker) is available from the body editor. Search, Copy, and Insert.
- **Simulate — Headers expand popup** — the Headers field now has the same full-screen expand control as Body, with Raw / Table modes, search, undo/redo, and Apply.
- **API Mock gallery — Storefront basics sample** — a compact six-rule storefront preset for exploring the runtime journal, filtering rows, and promoting a captured near-miss.
- **API Mock Timeout fault — configurable hold** — the Timeout / no response fault card now has a Hold for (ms) field. A server-wide Timeout hold max is available under Settings → Network → Limits.
- **API Mock settings — Proxy safety** — the Proxy tab now has a Block private nets toggle, a default-deny note while proxy is on, and a 508 loop-guard note.
- **API Mock export confirmation** — every export download opens a readable confirmation with a JSON/YAML preview tree, redaction callout, WireMock loss notes, HAR entry count, and a copyable CLI command.
- **API Mock — Saved servers library** — mock server definitions now live in a durable library independent of the tab bar. Closing a tab parks the server with all its rules, examples, variables, and settings intact. A Saved servers button opens a searchable library dialog. Removing a server is an explicit Delete behind a confirm with a 5-second undo.
- **API Mock demo curriculum v2** — 24-lesson scenario curriculum replacing the v1 eight-lesson pack. Each lesson builds on the previous one across Studio Tour, Multi-Server Workspace, Rule Library, Path Matching, Request Predicates, Body Matching, Payload Formats, Selection Policy, Conflict Inspector, Response Content, Templating, Variants & Sequence, Stateful Mocks, Timing Faults, Import, Export, Proxy, Journal Forensics, Runtime Ops, TLS/mTLS, Simulation as a Test Suite, Variants & Sequence (advanced), Test Runner & CI Handoff, and the capstone Ship a Contract Mock.

### Changed
- **API Mock chrome** — removed the redundant "API Mock Studio" title from the tab strip; the protocol tab already names the view.
- **API Mock settings — port conflict guard** — entering a listen port already claimed by another saved server now shows an inline error naming the owner and disables Save settings.
- **API Mock Conflict Inspector** — redesigned two-column layout with competing-rule cards, Match dimensions, Selection policy, full SHA-256 fingerprints with Same / Different badge, and a sticky action bar for Acknowledge / Adjust priority.
- **API Mock body conditions** — the key box on a body source condition is now disabled and shows `(whole body)` with a tooltip, making it clear that body matchers read the entire payload.
- **API Mock selection policy** — when two rules tie at highest priority, Simulate now shows a Winner badge and a specificity score breakdown. The Ambiguous response body is editable.
- **API Mock response preview** — the body preview panel now evaluates `{{ }}` template helpers against a sample request derived from the rule path. Unknown helpers show an inline diagnostic.
- **API Mock response editor** — the status reason phrase is now editable. Changing Content-Type also sets the body kind (JSON / HTML / XML / text / base64).
- **API Mock Studio — resizable rules panel** — the vertical bar between the rules list and the editor is now draggable. Width persists across sessions.
- **API Mock rules footer tally** — enabled vs draft shown as two status chips (live green / draft amber) instead of faint inline text.
- **API Mock Simulate — Saved samples** — Save as sample stores the full request under Saved samples with a focused name field. Reopening a saved sample restores that request.
- **API Mock Pattern Toolbox — XPath layout** — presets on the left, Sample XML fills the remaining width, Generated matcher underneath. A live Resolved read and ✓ / × verdict added to the XPath tab.
- **API Mock — Body expand popup** — Simulate request body, Match body expected/schema, and Pattern Toolbox Sample XML all have an expand control opening a full-screen editor with search, pretty-print, undo/redo, and Apply.
- **API Mock Simulate — From rules probes** — sidebar From rules entries now show the rule's request read-only, with an Edit in Ad-hoc button to copy into the scratch pad.
- **API Mock Proxy settings** — default-deny and 508 loop-guard notes placed clearly under the Enabled toggle. Allowlist hint explains the failover ordering.
- **API Mock Outbound tab** — redesigned with a pipeline strip (Template → Transforms → Client → Callbacks), section cards with sentence-case titles, and two-tone callback card rows.
- **API Mock Expires at** — the expiry field now has a calendar picker (month grid + 24-hour time row) in addition to typed ISO and the +1h / +24h / +7d chips.
- **API Mock response cookies** — HttpOnly, Secure, and SameSite flag meanings are shown inline. The SameSite menu repeats a one-line hint per option.
- **API Mock export Preview popup** — cleaned-up header layout: title left, flexible search field with N/M counter in the middle, Expand / Collapse / Copy JSON grouped on the right.
- **API Mock export inline Preview** — the JSON preview in the export confirmation card now uses the interactive JSON tree (collapsible nodes, syntax colors, search) instead of a flat text dump. YAML and unparseable content keep the plain text preview.

### Fixed
- **API Mock Studio — no flash on load** — `ApiMockLibraryLanding` is now suppressed until workspace hydration completes, eliminating the brief empty-landing flicker when navigating to the API Mock tab with saved servers.
- **AM-25 lesson — step 3 spotlight** — the Replay step now highlights the **Start** button instead of the (already-running) Stop button.
- **AM-25 lesson — step 5 Show breakdown** — the modal step now spotlights and clicks **Show breakdown** so viewers see the field-by-field body diff expand from the collapsed "all fields match" state. Added `HAR_COMPARE_SHOW_BREAKDOWN` selector to the shared API Mock selector map.
- **API Mock `{id}` / `:id` paths now match real requests** — OpenAPI import was storing parameterized paths as exact literals. Import now infers the parameterized kind, and the matcher promotes templates at evaluation time.
- **API Mock near-misses** — unmatched journal rows now require a path match or a same-arity path typo (≤2 edits) to qualify as a near-miss. Disabled routes are included. The failed dimension is named in the result.
- **API Mock Start/Apply — stale workspace** — Start, Apply, and Restart now read the latest server snapshot so enabling a draft then starting the server applies the current state.
- **API Mock rule list — Draft/On enable control** — the chip on each explorer row is a real button. Click Draft to enable a rule; double-click on the row still toggles as before.
- **API Mock Simulate — no auto-generated probes on open** — Simulate no longer injects auto-generated From rules stubs on open. It starts with only the scratch pad and any samples you have saved.
- **Open in Requests → Send — invalid connection header** — journal rows no longer copy hop-by-hop headers (Connection, Host, Accept-Encoding) into replayed requests.
- **API Mock — closing a running server** — the confirm dialog now says Stop and close / Stop & Close and explains that the listener stops and the port is freed, instead of "Confirm Deletion / Delete Permanently".
- **API Mock Runtime Settings — clipped field hints** — Journal, Limits, and CORS help text was cut off. Hinted rows now grow; short numeric hints sit beside the control.
- **API Mock journal — 404 poll noise** — API state/transaction/draft endpoints now return 200 with `ok: false` when the listener is stopped, preventing repeated 404s in the browser console.
- **API Mock Console — reliable "Started …" line** — the companion now keeps a short replay buffer and replays recently-broadcast lifecycle lines to newly connected clients, so the Started line is never lost to a connect race.
- **API Mock Console — empty despite a running server** — the SSE stream now stays attached across starting / applying / draining states. Restart now emits its own Restarted lifecycle line.
- **API Mock TLS/mTLS — live HTTPS requests** — loopback HTTPS requests to a self-signed API Mock listener are now treated as skip-verify by default, so live requests over HTTPS complete and journal correctly.
- **API Mock Conflicts — stale after lesson wipe** — the Conflict Inspector findings and badge now clear on workspace replace and active-server change. Opening Conflicts re-analyzes the current library.
- **API Mock Proxy settings — label column collapse** — a long non-wrapping hint was pushing the label column off-screen. Settings rows cap min-width; the Allowlist hint wraps.
- **Workflow API Mock nodes — isolated run targeting** — Reset/Stop/Assert Mock Calls nodes now resolve their target against the run's started-server registry when a Start Mock Server node used Isolate this run, so downstream nodes reliably reach the isolated listener.
- **API Mock export — YAML Preview now uses the tree** — YAML downloads now render the same collapsible JSON tree in the Preview popup as JSON/WireMock/HAR exports.
- **JSON tree — Expand all while searching** — Expand all now correctly expands all nodes even when a search filter is active.
- **API Mock Response body editor — dark theme** — the Monaco editor now uses the app's theme tokens instead of the default dark background.
- **API Mock export confirm — journal header bleed** — the sticky journal header no longer appears above the export dialog.
- **Learning Hub — Docker gate on Tauri** — the Docker prerequisite gate now probes via the native companion proxy on Tauri instead of WKWebView fetch, resolving loopback proxy interception issues.
- **API Mock — `Form field present` never matched** — the matcher now correctly reads a bare string as the field name for form field presence checks.
- **Simulate / FLAKY variant — unexpected 404** — rule-level predicates no longer gate variant conditions; a probability-weighted variant correctly claims its request even when the default route predicate does not match the variant body.

---

## Recent Release Highlights

### 0.6.x
- Major workflow, testing, and platform reliability improvements.
- Kafka and protocol feature depth expanded.
- Coverage, type safety, and E2E stability improvements.

### 0.5.x
- Data Mapper, validation, and results explorer refinements.
- Workflow UX and storage reliability improvements.
