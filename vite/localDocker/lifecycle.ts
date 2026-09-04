import { existsSync } from 'node:fs';
import { resolveDockerBin } from './dockerBin.ts';
import { checkDockerState, startBlockedByDaemon } from './daemon.ts';
import {
  composeFileArgs,
  composeHasRunningFromLists,
  composeMergedArgs,
  composeUpArgsWithBuild,
  expiredCertStartError,
  legacyComposeProjectIfDistinct,
  loadManifest,
  loadRelatedManifests,
  overlayOnlyPorts,
  parseComposeNameList,
  resolveStackDir,
} from './manifest.ts';
import { dockerAvailableMemoryMb } from './memory.ts';
import type { LocalDockerLogBus } from './logs.ts';
import type { PortOccupant } from './portOccupants.ts';
import { formatPortConflictError, lookupPortOccupants } from './portOccupants.ts';
import { COMPANION_PORT, findOccupiedPorts, probeCompanionPort } from './ports.ts';
import { createDockerRunner } from './spawnDocker.ts';
import {
  DOCKER_STACK_KEYS,
  keysSharingStartSlot,
  mergeReservedStarts,
  parseStackKey,
  rffComposeProjectNames,
  stackLimitError,
} from './stackIds.ts';
import type {
  DockerDaemonState,
  DockerRunner,
  LocalDockerStackKey,
  StackManifest,
} from './types.ts';

export class LocalDockerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalDockerError';
  }
}

export interface LifecycleDeps {
  runner?: DockerRunner;
  checkState?: () => Promise<DockerDaemonState>;
  isPortOccupied?: (port: number) => Promise<boolean>;
  probeCompanion?: () => Promise<boolean>;
  nowMs?: () => number;
  logs?: LocalDockerLogBus;
  lookupOccupants?: (ports: readonly number[]) => Promise<PortOccupant[]>;
  memoryMb?: () => Promise<number | null>;
}

function asLocalDockerError(err: unknown, fallback: string): LocalDockerError {
  if (err instanceof LocalDockerError) return err;
  const message = err instanceof Error ? err.message : fallback;
  return new LocalDockerError(message.startsWith('START_FAILED:') ? message : `${fallback}: ${message}`);
}

export function createLocalDockerLifecycle(repoRoot: string, deps: LifecycleDeps = {}) {
  const runner = deps.runner ?? createDockerRunner(() => resolveDockerBin());
  const reserved = new Map<string, number>();
  const inflight = new Map<string, AbortController[]>();
  let startGate: Promise<void> = Promise.resolve();

  const reservedKeys = (): string[] => [...reserved.keys()];

  const acquireReserved = (key: string): (() => void) => {
    reserved.set(key, (reserved.get(key) ?? 0) + 1);
    return () => {
      const count = reserved.get(key);
      if (count == null) return;
      if (count > 1) reserved.set(key, count - 1);
      else reserved.delete(key);
    };
  };

  const registerInflight = (key: string, ac: AbortController): void => {
    const list = inflight.get(key) ?? [];
    list.push(ac);
    inflight.set(key, list);
  };

  const unregisterInflight = (key: string, ac: AbortController): void => {
    const list = inflight.get(key);
    if (!list) return;
    const next = list.filter((item) => item !== ac);
    if (next.length === 0) inflight.delete(key);
    else inflight.set(key, next);
  };

  const cancelInflightForStack = (stackKey: string): void => {
    for (const key of keysSharingStartSlot(stackKey)) {
      const list = inflight.get(key) ?? [];
      inflight.delete(key);
      for (const ac of list) {
        if (!ac.signal.aborted) ac.abort();
      }
    }
  };

  const cancelAllInflight = (): void => {
    const all = [...inflight.values()].flat();
    inflight.clear();
    for (const ac of all) {
      if (!ac.signal.aborted) ac.abort();
    }
  };

  const emitLog = (stackKey: string, line: string): void => {
    deps.logs?.emit(stackKey, line);
  };

  const resolveOccupants = async (ports: readonly number[]): Promise<PortOccupant[]> => {
    try {
      return await (deps.lookupOccupants ?? lookupPortOccupants)(ports);
    } catch {
      return ports.map((port) => ({ port }));
    }
  };

  const runCompose = async (
    args: string[],
    cwd: string,
    extra?: { signal?: AbortSignal; timeoutMs?: number; onLine?: (line: string) => void },
  ) => {
    try {
      return await runner.run(args, {
        cwd,
        signal: extra?.signal,
        timeoutMs: extra?.timeoutMs,
        onLine: extra?.onLine,
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new LocalDockerError('START_FAILED:Docker is not installed.');
      }
      throw asLocalDockerError(err, 'START_FAILED:docker compose failed');
    }
  };

  const composeServiceNames = async (
    dir: string,
    manifest: StackManifest,
    includeProfile: boolean,
    extraArgs: string[],
  ): Promise<string[]> => {
    const result = await runner.run(
      ['compose', ...composeFileArgs(manifest, includeProfile), ...extraArgs],
      { cwd: dir, timeoutMs: 15_000 },
    );
    if (result.code !== 0) {
      const detail = result.stderr.trim() || `docker compose ${extraArgs.join(' ')} failed`;
      throw new LocalDockerError(detail);
    }
    return parseComposeNameList(result.stdout);
  };

  const composeHasRunning = async (dir: string, manifest: StackManifest): Promise<boolean> => {
    const running = await composeServiceNames(
      dir,
      manifest,
      true,
      ['ps', '--services', '--filter', 'status=running'],
    );
    const defaults = manifest.composeProfile
      ? await composeServiceNames(dir, manifest, false, ['config', '--services'])
      : [];
    return composeHasRunningFromLists(running, Boolean(manifest.composeProfile), defaults);
  };

  const composeProjectHasContainers = async (dir: string, manifest: StackManifest): Promise<boolean> => {
    const profiled = await composeServiceNames(
      dir,
      manifest,
      true,
      ['ps', '--services', '--filter', 'status=running'],
    );
    if (profiled.length > 0) return true;
    if (manifest.composeProfile) {
      const defaults = await composeServiceNames(
        dir,
        manifest,
        false,
        ['ps', '--services', '--filter', 'status=running'],
      );
      return defaults.length > 0;
    }
    return false;
  };

  const downLegacy = async (dir: string, manifests: StackManifest[]): Promise<void> => {
    const legacy = legacyComposeProjectIfDistinct(dir, manifests);
    if (!legacy) return;
    if (legacy.startsWith('rff-')) return;
    await runner.run(['compose', ...composeMergedArgs(manifests, legacy), 'down'], {
      cwd: dir,
      timeoutMs: 60_000,
    });
  };

  const listRunningStrict = async (): Promise<string[]> => {
    const probes = await Promise.all(DOCKER_STACK_KEYS.map(async (key) => {
      const dir = resolveStackDir(repoRoot, key);
      if (!existsSync(dir)) return { key, running: false as const, error: null as string | null };
      let manifest: StackManifest;
      try {
        manifest = loadManifest(dir, key);
      } catch {
        return { key, running: false as const, error: null };
      }
      try {
        return { key, running: await composeHasRunning(dir, manifest), error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { key, running: false as const, error: `${key}: ${message}` };
      }
    }));
    const errors = probes.map((p) => p.error).filter((e): e is string => Boolean(e));
    if (errors.length > 0) {
      throw new LocalDockerError(`Cannot verify running stacks (${errors.join('; ')})`);
    }
    return probes.filter((p) => p.running).map((p) => p.key);
  };

  const listRunningBestEffort = async (): Promise<LocalDockerStackKey[]> => {
    const flags = await Promise.all(DOCKER_STACK_KEYS.map(async (key) => {
      const status = await getStackStatus(key);
      return status === true ? key : null;
    }));
    return flags.filter((key): key is LocalDockerStackKey => key !== null);
  };

  async function getStackStatus(stackKey: string): Promise<boolean | null> {
    const key = parseStackKey(stackKey);
    if (!key) return null;
    const dir = resolveStackDir(repoRoot, key);
    if (!existsSync(dir)) return false;
    let manifest: StackManifest;
    try {
      manifest = loadManifest(dir, key);
    } catch {
      return null;
    }
    try {
      return await composeHasRunning(dir, manifest);
    } catch {
      return null;
    }
  }

  function loadManifestDto(stackKey: string): StackManifest {
    const key = parseStackKey(stackKey);
    if (!key) throw new LocalDockerError('Unknown docker stack');
    return loadManifest(resolveStackDir(repoRoot, key), key);
  }

  const withStartGate = async <T>(fn: () => Promise<T>): Promise<T> => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = startGate;
    startGate = wait;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  async function startStack(stackKey: string, build = false): Promise<void> {
    const key = parseStackKey(stackKey);
    if (!key) throw new LocalDockerError('Unknown docker stack');

    const dir = resolveStackDir(repoRoot, key);
    const manifest = loadManifest(dir, key);
    const ac = new AbortController();
    let releaseReserved: (() => void) | undefined;
    let thisUp = false;
    let projectUp = false;
    const throwIfCancelled = () => {
      if (ac.signal.aborted) throw new LocalDockerError('START_CANCELLED');
    };

    // Register before docker info / F2 / F3 so Settings Stop cannot still run `up`.
    registerInflight(key, ac);
    try {
      const state = await (deps.checkState ?? (() => checkDockerState({ runner })))();
      throwIfCancelled();
      const blocked = startBlockedByDaemon(state);
      if (blocked) throw new LocalDockerError(blocked);

      await withStartGate(async () => {
        throwIfCancelled();
        try {
          thisUp = await composeHasRunning(dir, manifest);
          projectUp = await composeProjectHasContainers(dir, manifest);
        } catch (err) {
          if (ac.signal.aborted) throw new LocalDockerError('START_CANCELLED');
          const message = err instanceof Error ? err.message : String(err);
          throw new LocalDockerError(`Cannot verify if ${key} is already running: ${message}`);
        }

        throwIfCancelled();
        if (!thisUp) {
          const running = mergeReservedStarts(await listRunningStrict(), reservedKeys());
          throwIfCancelled();
          const limit = stackLimitError(key, running);
          if (limit) throw new LocalDockerError(limit);

          const related = loadRelatedManifests(dir, key);
          if (!projectUp) {
            await downLegacy(dir, related.length > 0 ? related : [manifest]);
            throwIfCancelled();
            const occupied = await findOccupiedPorts(manifest.ports, deps.isPortOccupied);
            throwIfCancelled();
            if (occupied.length > 0) {
              throw new LocalDockerError(formatPortConflictError(await resolveOccupants(occupied)));
            }
          } else {
            const extra = overlayOnlyPorts(manifest, related);
            if (extra.length > 0) {
              const occupied = await findOccupiedPorts(extra, deps.isPortOccupied);
              throwIfCancelled();
              if (occupied.length > 0) {
                throw new LocalDockerError(formatPortConflictError(await resolveOccupants(occupied)));
              }
            }
          }

          const certErr = expiredCertStartError(manifest.certExpiresAt, deps.nowMs?.());
          if (certErr) {
            emitLog(key, '✗ This lesson needs a security certificate that has expired. Update the app.');
            throw new LocalDockerError(certErr);
          }
        }

        throwIfCancelled();
        releaseReserved = acquireReserved(key);
      });

      throwIfCancelled();

      const previousRun = deps.logs?.read(key) ?? null;
      deps.logs?.truncate(key);

      if (thisUp) {
        emitLog(key, '=== Stack already has running containers — ensuring all services are up ===');
      } else if (projectUp) {
        emitLog(key, '=== Adding profile services to the running compose project ===');
      }
      emitLog(key, `=== Starting ${key} stack ===`);

      let result;
      try {
        result = await runCompose(composeUpArgsWithBuild(manifest, build), dir, {
          signal: ac.signal,
          onLine: (line) => emitLog(key, line),
        });
      } catch (err) {
        if (previousRun != null) deps.logs?.restore(key, previousRun);
        throw err;
      }
      if (ac.signal.aborted || result.killed) {
        emitLog(key, '✗ Start cancelled — the stack was stopped');
        throw new LocalDockerError('START_CANCELLED');
      }
      if (result.code !== 0) {
        if (result.code === 137 || /\b137\b/.test(result.stderr) || /OOMKilled/i.test(result.stderr)) {
          throw new LocalDockerError(`OOM_KILLED:${manifest.minMemoryMb ?? 0}`);
        }
        const tail = result.stderr.trim().split(/\r?\n/).slice(-8).join('\n');
        throw new LocalDockerError(
          tail
            ? `START_FAILED:${tail}`
            : `START_FAILED:docker compose up failed (exit ${result.code})`,
        );
      }
      emitLog(key, '✓ compose project started');
      throwIfCancelled();
      if (manifest.requiresCompanionProbe) {
        emitLog(key, `Checking gRPC companion server on port ${COMPANION_PORT}...`);
        const probe = deps.probeCompanion ?? (() => probeCompanionPort());
        const ready = await probe();
        throwIfCancelled();
        if (ready) {
          emitLog(key, '✓ gRPC companion server ready');
        } else {
          emitLog(
            key,
            `⚠ gRPC companion not detected on :${COMPANION_PORT} (start npm run dev / desktop app).`,
          );
        }
      }
      throwIfCancelled();
      emitLog(key, '=== Stack started ===');
    } finally {
      unregisterInflight(key, ac);
      releaseReserved?.();
    }
  }

  async function stopStack(stackKey: string): Promise<void> {
    const key = parseStackKey(stackKey);
    if (!key) throw new LocalDockerError('Unknown docker stack');
    cancelInflightForStack(key);
    const dir = resolveStackDir(repoRoot, key);
    const related = loadRelatedManifests(dir, key);
    const manifests = related.length > 0 ? related : [loadManifest(dir, key)];
    const logKeys = keysSharingStartSlot(key);
    const emitStop = (line: string) => {
      for (const k of logKeys) emitLog(k, line);
    };
    emitStop(`=== Stopping ${key} stack ===`);
    let result;
    try {
      result = await runner.run(['compose', ...composeMergedArgs(manifests), 'down'], {
        cwd: dir,
        timeoutMs: 120_000,
        onLine: emitStop,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'docker compose down failed';
      throw new LocalDockerError(message);
    }
    await downLegacy(dir, manifests);
    if (result.code !== 0) {
      throw new LocalDockerError('docker compose down failed');
    }
    emitStop('=== Stack stopped ===');
  }

  async function stopAllRffProjects(): Promise<string[]> {
    cancelAllInflight();
    let ls = await runner.run(['compose', 'ls', '-q', '--all'], { timeoutMs: 15_000 });
    if (ls.code !== 0) {
      ls = await runner.run(['compose', 'ls', '-q'], { timeoutMs: 15_000 });
    }
    if (ls.code !== 0) {
      const detail = ls.stderr.trim() || 'docker compose ls failed';
      throw new LocalDockerError(detail);
    }
    const names = rffComposeProjectNames(ls.stdout);
    const stopped: string[] = [];
    for (const name of names) {
      const down = await runner.run(['compose', '-p', name, 'down'], { timeoutMs: 120_000 });
      if (down.code === 0) stopped.push(name);
    }
    if (names.length > 0 && stopped.length === 0) {
      throw new LocalDockerError('docker compose down failed');
    }
    return stopped;
  }

  return {
    getStackStatus,
    loadManifestDto,
    startStack,
    stopStack,
    stopAllRffProjects,
    listRunningBestEffort,
    listRunningStrict,
    cancelInflightForStack,
    cancelAllInflight,
    getAvailableMemoryMb: () => deps.memoryMb ? deps.memoryMb() : dockerAvailableMemoryMb(runner),
  };
}

export type LocalDockerLifecycle = ReturnType<typeof createLocalDockerLifecycle>;
