/**
 * Phase 8B/8C — `redfireforge mock` CLI commands.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  cliAssertJournal,
  cliFetchJournal,
  cliLoadAndValidate,
  cliSimulateSamples,
} from '../src/shared/api-mock/cliMock';
import type { ApiMockServerDefinitionV1, ApiMockTransactionOutcome } from '../src/shared/api-mock/contracts';
import { startStandaloneServers } from './mockStandalone';
import {
  asWorkspace,
  companionUnreachable,
  escapeXml,
  findFreePort,
  isFailedSimulation,
  loadDefinitionFile,
  readNonNegInt,
  readPortOverride,
  reportValidation,
  requireExistingServer,
  requireWorkspaceServers,
  resolveServerId,
  rollbackCompanionStarts,
  sleep,
} from './mockCommandShared';
import { resolveOutputTarget, stdoutFormatOf } from './outputTarget';


export async function runMockSimulate(opts: {
  file: string;
  serverId?: string;
  output?: string;
  junit?: string;
}): Promise<number> {
  const outputTarget = resolveOutputTarget(opts.output);
  const stdoutFormat = stdoutFormatOf(outputTarget);

  const raw = asWorkspace(loadDefinitionFile(opts.file));
  const loaded = cliLoadAndValidate(raw);
  if (reportValidation(loaded.validationErrors)) return 1;
  if (requireWorkspaceServers(loaded.workspace)) return 1;
  const serverId = resolveServerId(loaded.workspace, opts.serverId);
  if (!requireExistingServer(loaded.workspace, serverId)) return 1;
  const results = cliSimulateSamples({ workspace: loaded.workspace, serverId });
  if (results.length === 0) {
    console.error('No samples to simulate.');
    return 1;
  }
  const failed = results.filter(isFailedSimulation);
  const summary = {
    serverId,
    total: results.length,
    failed: failed.length,
    results,
  };

  const buildJunit = () => {
    const cases = results.map(r => {
      const name = r.sampleId;
      if (isFailedSimulation(r)) {
        return `<testcase classname="api-mock" name="${escapeXml(name)}"><failure message="${escapeXml(r.outcome)}"/></testcase>`;
      }
      return `<testcase classname="api-mock" name="${escapeXml(name)}"/>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="api-mock-simulate" tests="${results.length}" failures="${failed.length}">\n${cases}\n</testsuite>\n`;
  };

  const json = JSON.stringify(summary, null, 2);
  if (stdoutFormat === 'junit') process.stdout.write(buildJunit());
  else if (outputTarget?.kind === 'file') writeFileSync(resolve(outputTarget.path), json, 'utf8');
  else console.log(json);

  if (opts.junit) {
    writeFileSync(resolve(opts.junit), buildJunit(), 'utf8');
  }

  console.error(`Simulated ${results.length} sample(s); ${failed.length} failure(s).`);
  return failed.length > 0 ? 1 : 0;
}

async function startViaCompanion(
  servers: ApiMockServerDefinitionV1[],
  base: string,
): Promise<Array<{ serverId: string; ok: boolean; port?: number; error?: string; mode: 'companion' }>> {
  const results: Array<{ serverId: string; ok: boolean; port?: number; error?: string; mode: 'companion' }> = [];
  for (const srv of servers) {
    try {
      const res = await fetch(`${base}/api/mock/servers/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(srv),
      });
      const body = await res.json() as { ok?: boolean; data?: { port: number; generation: number }; error?: { message?: string } };
      if (!res.ok || body.ok === false) {
        results.push({ serverId: srv.id, ok: false, error: body.error?.message ?? `HTTP ${res.status}`, mode: 'companion' });
      } else {
        results.push({ serverId: srv.id, ok: true, port: body.data?.port, mode: 'companion' });
      }
    } catch (e) {
      results.push({
        serverId: srv.id,
        ok: false,
        error: e instanceof Error ? `${e.message} — companion unreachable` : 'Companion unreachable',
        mode: 'companion',
      });
    }
  }
  return results;
}

export async function runMockStart(opts: {
  file: string;
  /** Fixed port number, the string 'auto' to pick a free OS port, or undefined to use the definition's port. */
  port?: number | 'auto';
  /** Write the bound port number to this file path (e.g. `.rff-mock-port`). */
  portFile?: string;
  /** Write `API_MOCK_PORT=<port>` to this file path (e.g. `.env.mock`). */
  envFile?: string;
  controlBase?: string;
  waitReady?: boolean;
  standalone?: boolean;
  /** When false, skip parking so tests can return without process.exit (listeners stay up). */
  hold?: boolean;
}): Promise<number> {
  const raw = asWorkspace(loadDefinitionFile(opts.file));
  const loaded = cliLoadAndValidate(raw);
  if (reportValidation(loaded.validationErrors)) return 1;
  if (requireWorkspaceServers(loaded.workspace)) return 1;

  let resolvedPort: number | undefined;
  if (opts.port === 'auto') {
    try {
      resolvedPort = await findFreePort();
    } catch (e) {
      /* c8 ignore next 2 -- OS port allocation failure is environment-dependent. */
      console.error(`Failed to allocate a free port: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  } else {
    const portOpt = readPortOverride(opts.port);
    if (!portOpt.ok) return 1;
    resolvedPort = portOpt.port;
  }

  if (resolvedPort != null && resolvedPort + loaded.workspace.servers.length - 1 > 65535) {
    console.error('--port range exceeds 65535 for this workspace.');
    return 1;
  }
  const servers = loaded.workspace.servers.map((srv, i) => (
    resolvedPort != null ? { ...srv, port: resolvedPort! + i } : srv
  ));
  const base = (opts.controlBase ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

  let results: Array<{ serverId: string; ok: boolean; port?: number; error?: string; mode: string }>;
  let stopAll: (() => Promise<void>) | undefined;

  if (opts.standalone) {
    const handle = await startStandaloneServers(servers);
    results = handle.results;
    stopAll = handle.stopAll;
  } else {
    results = await startViaCompanion(servers, base);
    if (!results.every(r => r.ok)) {
      if (companionUnreachable(results)) {
        console.error('Companion unreachable — starting in-process listeners (standalone).');
        const handle = await startStandaloneServers(servers);
        results = handle.results;
        stopAll = handle.stopAll;
      } else {
        await rollbackCompanionStarts(results, base);
      }
    }
  }

  const allOk = results.every(r => r.ok);
  console.log(JSON.stringify({ ready: allOk, results }, null, 2));

  // Write port discovery files so CI pipelines can consume the dynamic port.
  if (allOk && (opts.portFile || opts.envFile)) {
    const boundPort = results[0]?.port ?? resolvedPort;
    if (boundPort != null) {
      if (opts.portFile) {
        writeFileSync(resolve(opts.portFile), String(boundPort), 'utf8');
        console.error(`Port written to ${opts.portFile}`);
      }
      if (opts.envFile) {
        writeFileSync(resolve(opts.envFile), `API_MOCK_PORT=${boundPort}\n`, 'utf8');
        console.error(`Env file written to ${opts.envFile}`);
      }
    }
  }

  const inProcess = Boolean(stopAll);
  if ((opts.waitReady || inProcess) && allOk) {
    console.error(inProcess && !opts.waitReady
      ? 'In-process listeners keep this process alive. Press Ctrl+C to stop.'
      : 'Listeners running. Press Ctrl+C to stop.');
    if (opts.hold === false) return 0;
    await holdMockStartUntilSignal({
      stopAll,
      controlBase: base,
      results,
    });
  }

  return allOk ? 0 : 1;
}

/** Keep the CLI process alive until SIGINT/SIGTERM. `hold: false` shuts down immediately (tests). */
export async function holdMockStartUntilSignal(opts: {
  stopAll?: () => Promise<void>;
  controlBase: string;
  results: Array<{ ok: boolean; serverId: string }>;
  fetchImpl?: typeof fetch;
  hold?: boolean;
  exit?: (code: number) => void;
}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const exit = opts.exit ?? ((code: number) => { process.exit(code); });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    try {
      if (opts.stopAll) {
        await opts.stopAll();
      } else {
        for (const r of opts.results) {
          if (!r.ok) continue;
          try {
            await fetchImpl(`${opts.controlBase}/api/mock/servers/${encodeURIComponent(r.serverId)}/stop`, { method: 'POST' });
          } catch { /* ignore */ }
        }
      }
    } catch { /* best-effort shutdown */ } finally {
      exit(0);
    }
  };
  function onSignal() { void shutdown(); }
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  if (opts.hold === false) {
    await shutdown();
    return;
  }
  /* c8 ignore next -- this is the intentional long-lived CLI process path. */
  await new Promise(() => { /* keep alive */ });
}

export async function runMockVerify(opts: {
  file: string;
  serverId?: string;
  minCalls?: number;
  expectOutcome?: string;
  routeId?: string;
  lastCallWithinMs?: number;
  bodyContains?: string;
  controlBase?: string;
  simulate?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const minCalls = readNonNegInt(opts.minCalls, '--min-calls');
  if (!minCalls.ok) return 1;
  const lastCallWithinMs = readNonNegInt(opts.lastCallWithinMs, '--last-call-within-ms');
  if (!lastCallWithinMs.ok) return 1;

  if (opts.simulate) {
    if (lastCallWithinMs.value != null) {
      console.error('--last-call-within-ms requires a live journal (omit --simulate).');
      return 1;
    }
    const raw = asWorkspace(loadDefinitionFile(opts.file));
    const loaded = cliLoadAndValidate(raw);
    if (reportValidation(loaded.validationErrors)) return 1;
    if (requireWorkspaceServers(loaded.workspace)) return 1;
    const serverId = resolveServerId(loaded.workspace, opts.serverId);
    if (!requireExistingServer(loaded.workspace, serverId)) return 1;
    const results = cliSimulateSamples({
      workspace: loaded.workspace,
      serverId,
      routeId: opts.routeId,
    });
    if (results.length === 0) {
      console.error(opts.routeId
        ? `No simulated samples matched route ${opts.routeId}`
        : 'No samples to simulate.');
      return 1;
    }
    const failed = results.filter(isFailedSimulation);
    console.log(JSON.stringify({
      mode: 'simulate',
      serverId,
      total: results.length,
      failed: failed.length,
      results,
    }, null, 2));
    if (failed.length > 0) {
      console.error(`Simulated ${results.length} sample(s); ${failed.length} failure(s).`);
      return 1;
    }
    if (minCalls.value != null && results.length < minCalls.value) {
      console.error(`Expected at least ${minCalls.value} samples, got ${results.length}`);
      return 1;
    }
    if (opts.expectOutcome) {
      const bad = results.filter(r => r.outcome !== opts.expectOutcome);
      if (bad.length) {
        console.error(`${bad.length} sample(s) did not have outcome ${opts.expectOutcome}`);
        return 1;
      }
    }
    if (opts.bodyContains) {
      const bad = results.filter(r => !String(r.renderedResponse?.body ?? '').includes(opts.bodyContains!));
      if (bad.length) {
        console.error(`${bad.length} sample(s) did not contain ${JSON.stringify(opts.bodyContains)}`);
        return 1;
      }
    }
    console.error(`Simulated ${results.length} sample(s); 0 failure(s).`);
    return 0;
  }

  const raw = asWorkspace(loadDefinitionFile(opts.file));
  const loaded = cliLoadAndValidate(raw);
  if (reportValidation(loaded.validationErrors)) return 1;
  if (requireWorkspaceServers(loaded.workspace)) return 1;
  const serverId = resolveServerId(loaded.workspace, opts.serverId);
  if (!requireExistingServer(loaded.workspace, serverId)) return 1;

  const journal = await cliFetchJournal({
    controlBase: opts.controlBase ?? 'http://127.0.0.1:3001',
    serverId,
    fetchImpl: opts.fetchImpl,
  });
  if (!journal.ok) {
    console.error(`Live journal verify failed: ${journal.error}`);
    return 1;
  }

  const result = cliAssertJournal(journal.transactions, {
    serverId,
    routeId: opts.routeId,
    expectedMinCount: minCalls.value ?? (opts.expectOutcome ? 1 : undefined),
    expectedOutcome: opts.expectOutcome as ApiMockTransactionOutcome | undefined,
    expectedLastCallWithinMs: lastCallWithinMs.value,
    expectedBodyContains: opts.bodyContains,
  });
  console.log(JSON.stringify({
    mode: 'live-journal',
    serverId,
    passed: result.passed,
    expected: result.expected,
    actual: result.actual,
    matchingCount: result.matchingCount,
    matchingIds: result.matchingIds,
    nearMisses: result.nearMisses,
  }, null, 2));
  if (!result.passed) {
    console.error(`Journal assertion failed: expected ${result.expected}; actual ${result.actual}`);
    return 1;
  }
  console.error(`Live journal: ${result.matchingCount} matching call(s).`);
  return 0;
}

// ── mock wait-ready ──────────────────────────────────────────

/**
 * Poll a mock server's port until it reports ready via the built-in
 * `GET /__rff/health/ready` endpoint (or a custom `--health-path`).
 *
 * Port can be supplied as:
 *  - `--port <n>`        explicit port number
 *  - `--port-file <p>`   read port from a file written by `mock start --port-file`
 *  - `--env-file <p>`    read API_MOCK_PORT=<n> from a file written by `mock start --env-file`
 *
 * By default polls `/__rff/health/ready` which returns 200 once routes are loaded
 * and 503 while still initializing — matching Kubernetes readiness probe semantics.
 */
export async function runMockWaitReady(opts: {
  port?: number;
  portFile?: string;
  envFile?: string;
  host?: string;
  /** Path to poll (default: /__rff/health/ready). Use / to accept any HTTP response. */
  healthPath?: string;
  /** Max seconds to wait (default: 30). */
  timeoutSecs?: number;
  /** Interval between poll attempts in ms (default: 250). */
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const timeoutSecs = opts.timeoutSecs ?? 30;
  const intervalMs  = opts.intervalMs  ?? 250;

  // Resolve port from the three possible sources.
  let port: number | undefined = opts.port;

  if (port == null && opts.portFile) {
    const abs = resolve(opts.portFile);
    if (!existsSync(abs)) {
      // File may not be written yet if the server is still starting — wait up to timeout.
      const deadline = Date.now() + timeoutSecs * 1000;
      while (!existsSync(abs)) {
        if (Date.now() >= deadline) {
          console.error(`wait-ready: port file not found after ${timeoutSecs}s: ${abs}`);
          return 1;
        }
        await sleep(intervalMs);
      }
    }
    const raw = readFileSync(abs, 'utf8').trim();
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      console.error(`wait-ready: invalid port in ${abs}: "${raw}"`);
      return 1;
    }
    port = n;
  }

  if (port == null && opts.envFile) {
    const abs = resolve(opts.envFile);
    if (!existsSync(abs)) {
      const deadline = Date.now() + timeoutSecs * 1000;
      while (!existsSync(abs)) {
        if (Date.now() >= deadline) {
          console.error(`wait-ready: env file not found after ${timeoutSecs}s: ${abs}`);
          return 1;
        }
        await sleep(intervalMs);
      }
    }
    const lines = readFileSync(abs, 'utf8').split('\n');
    const match = lines.map(l => /^API_MOCK_PORT=(\d+)/.exec(l)).find(Boolean);
    if (!match) {
      console.error(`wait-ready: API_MOCK_PORT not found in ${abs}`);
      return 1;
    }
    port = parseInt(match[1], 10);
  }

  if (port == null) {
    console.error('wait-ready: specify --port, --port-file, or --env-file');
    return 1;
  }

  const host       = opts.host       ?? '127.0.0.1';
  const healthPath = opts.healthPath ?? '/__rff/health/ready';
  const url        = `http://${host}:${port}${healthPath}`;
  const fetchImpl  = opts.fetchImpl ?? fetch;
  const deadline   = Date.now() + timeoutSecs * 1000;

  console.error(`wait-ready: polling ${url} (timeout ${timeoutSecs}s)...`);

  while (Date.now() < deadline) {
    try {
      const r = await fetchImpl(url);
      if (r.ok) {
        // 200 → liveness or readiness confirmed.
        console.error(`wait-ready: server is ready on port ${port}`);
        console.log(String(port));
        return 0;
      }
      // 503 on /__rff/health/ready means "alive but not ready yet" — keep polling.
      // Any other non-2xx falls through to the sleep and retry loop.
    } catch {
      // ECONNREFUSED / ENOTFOUND — server process not yet accepting connections.
    }
    await sleep(intervalMs);
  }

  console.error(`wait-ready: server did not become ready on port ${port} within ${timeoutSecs}s`);
  return 1;
}

// ── mock stop ────────────────────────────────────────────────

/**
 * Stop one or all mock servers defined in a workspace file.
 * Only works when the companion is running; standalone servers must be stopped
 * with SIGINT/SIGTERM to their process.
 */
export async function runMockStop(opts: {
  file: string;
  serverId?: string;
  all?: boolean;
  controlBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const raw = asWorkspace(loadDefinitionFile(opts.file));
  const loaded = cliLoadAndValidate(raw);
  /* c8 ignore next */
  if (reportValidation(loaded.validationErrors)) return 1;
  /* c8 ignore next */
  if (requireWorkspaceServers(loaded.workspace)) return 1;

  const base = (opts.controlBase ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Determine which server(s) to stop.
  let toStop: ApiMockServerDefinitionV1[];
  if (opts.all) {
    toStop = loaded.workspace.servers;
  } else {
    const serverId = resolveServerId(loaded.workspace, opts.serverId);
    if (!requireExistingServer(loaded.workspace, serverId)) return 1;
    toStop = loaded.workspace.servers.filter(s => s.id === serverId);
  }

  const results: Array<{ serverId: string; ok: boolean; error?: string }> = [];
  for (const srv of toStop) {
    try {
      const res = await fetchImpl(`${base}/api/mock/servers/${encodeURIComponent(srv.id)}/stop`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        results.push({ serverId: srv.id, ok: false, error: body.error?.message ?? `HTTP ${res.status}` });
      } else {
        results.push({ serverId: srv.id, ok: true });
      }
    } catch (e) {
      results.push({
        serverId: srv.id,
        ok: false,
        error: e instanceof Error ? `${e.message} — companion unreachable` : 'Companion unreachable',
      });
    }
  }

  console.log(JSON.stringify({ stopped: results.every(r => r.ok), results }, null, 2));
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error(`Failed to stop ${failed.length} server(s).`);
    return 1;
  }
  console.error(`Stopped ${results.length} server(s).`);
  return 0;
}

// ── mock verify --all-routes ─────────────────────────────────

/** Per-route coverage row for the --all-routes report. */
export interface RouteCoverageRow {
  routeId: string;
  routeName: string;
  method: string;
  path: string;
  hitCount: number;
  passed: boolean;
}

/**
 * Check that every enabled route in the definition was called at least
 * `minCallsPerRoute` times (default 1). Fetches the live journal from the
 * companion and counts `matchedRouteId` per route.
 */
export async function runMockVerifyAllRoutes(opts: {
  file: string;
  serverId?: string;
  minCallsPerRoute?: number;
  controlBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const minPerRoute = opts.minCallsPerRoute ?? 1;
  if (!Number.isInteger(minPerRoute) || minPerRoute < 1) {
    console.error('--min-calls must be a positive integer when used with --all-routes.');
    return 1;
  }

  const raw = asWorkspace(loadDefinitionFile(opts.file));
  const loaded = cliLoadAndValidate(raw);
  /* c8 ignore next */
  if (reportValidation(loaded.validationErrors)) return 1;
  /* c8 ignore next */
  if (requireWorkspaceServers(loaded.workspace)) return 1;

  const serverId = resolveServerId(loaded.workspace, opts.serverId);
  /* c8 ignore next */
  if (!requireExistingServer(loaded.workspace, serverId)) return 1;

  const server = loaded.workspace.servers.find(s => s.id === serverId)!;

  // All routes live on `server.routes`; folders are just metadata with a `folderId` FK on each route.
  const enabledRoutes: ApiMockRouteV1[] = server.routes.filter(r => r.enabled);

  if (enabledRoutes.length === 0) {
    console.error('No enabled routes found in server definition.');
    return 1;
  }

  // Fetch the full live journal.
  const journal = await cliFetchJournal({
    controlBase: opts.controlBase ?? 'http://127.0.0.1:3001',
    serverId,
    fetchImpl: opts.fetchImpl,
  });
  if (!journal.ok) {
    console.error(`Live journal fetch failed: ${journal.error}`);
    return 1;
  }

  // Count hits per route.
  const hitCounts = new Map<string, number>();
  for (const tx of journal.transactions) {
    if (tx.matchedRouteId) {
      hitCounts.set(tx.matchedRouteId, (hitCounts.get(tx.matchedRouteId) ?? 0) + 1);
    }
  }

  const rows: RouteCoverageRow[] = enabledRoutes.map(route => {
    const hits = hitCounts.get(route.id) ?? 0;
    const pathStr = route.path?.value ?? '(unknown)';
    return {
      routeId: route.id,
      routeName: route.name,
      method: route.method,
      path: pathStr,
      hitCount: hits,
      passed: hits >= minPerRoute,
    };
  });

  const failed = rows.filter(r => !r.passed);
  const passed = rows.filter(r => r.passed);

  console.log(JSON.stringify({
    mode: 'all-routes',
    serverId,
    minCallsPerRoute: minPerRoute,
    totalRoutes: rows.length,
    passedRoutes: passed.length,
    failedRoutes: failed.length,
    allPassed: failed.length === 0,
    routes: rows,
  }, null, 2));

  if (failed.length > 0) {
    console.error(`Contract coverage FAILED: ${failed.length}/${rows.length} route(s) not called:`);
    for (const r of failed) {
      console.error(`  ✗ [${r.method}] ${r.path}  "${r.routeName}"  (hits: ${r.hitCount}, required: ${minPerRoute})`);
    }
    return 1;
  }

  console.error(`Contract coverage PASSED: all ${rows.length} route(s) called ≥ ${minPerRoute} time(s).`);
  return 0;
}
