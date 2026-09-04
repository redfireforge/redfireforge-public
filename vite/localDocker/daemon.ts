import { resolveDockerBin } from './dockerBin.ts';
import { createDockerRunner } from './spawnDocker.ts';
import type { DockerDaemonState, DockerRunner } from './types.ts';

const DAEMON_TIMEOUT_MS = 10_000;

export function looksLikeComposeV1(stdout: string, stderr = ''): boolean {
  const text = `${stdout}\n${stderr}`;
  if (/docker-compose version 1\./i.test(text)) return true;
  if (/compose version v?2\./i.test(text)) return false;
  return /compose version v?1\.\d/i.test(text);
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT');
}

export async function checkDockerState(opts?: {
  runner?: DockerRunner;
  resolveBin?: () => string | null;
}): Promise<DockerDaemonState> {
  const resolveBin = opts?.resolveBin ?? (() => resolveDockerBin());
  if (!resolveBin()) return 'notInstalled';
  const runner = opts?.runner ?? createDockerRunner(resolveBin);

  try {
    const info = await runner.run(['info'], { timeoutMs: DAEMON_TIMEOUT_MS });
    if (info.timedOut) return 'notRunning';
    if (info.code !== 0) return 'notRunning';
  } catch (err) {
    if (isNotFound(err)) return 'notInstalled';
    return 'notRunning';
  }

  try {
    const compose = await runner.run(['compose', 'version'], { timeoutMs: DAEMON_TIMEOUT_MS });
    if (compose.timedOut) return 'notRunning';
    if (compose.code !== 0) return 'outdatedCompose';
    if (looksLikeComposeV1(compose.stdout, compose.stderr)) return 'outdatedCompose';
    return 'running';
  } catch (err) {
    if (isNotFound(err)) return 'notInstalled';
    return 'notRunning';
  }
}

export function startBlockedByDaemon(state: DockerDaemonState): string | null {
  if (state === 'running') return null;
  if (state === 'notInstalled') return 'START_FAILED:Docker is not installed.';
  if (state === 'outdatedCompose') return 'START_FAILED:Docker Compose V2 is required.';
  return 'START_FAILED:Docker Desktop is not running.';
}

/**
 * Coalesce overlapping `docker info` calls and keep the last reading for a
 * cheap GET /health. The 800ms browser probe must not wait on this work.
 */
export function createDaemonStateReader(
  check: () => Promise<DockerDaemonState>,
): {
  peek: () => DockerDaemonState | null;
  refresh: () => Promise<DockerDaemonState>;
} {
  let last: DockerDaemonState | null = null;
  let inflight: Promise<DockerDaemonState> | null = null;
  const refresh = () => {
    if (inflight) return inflight;
    inflight = check()
      .then((state) => {
        last = state;
        return state;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return { peek: () => last, refresh };
}
