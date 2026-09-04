import type { DockerRunner } from './types.ts';

const INFO_TIMEOUT_MS = 10_000;

/** `docker info --format '{{.MemTotal}}'` is bytes. */
export function parseDockerMemTotalMb(stdout: string): number | null {
  const bytes = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  return Math.floor(bytes / 1_048_576);
}

export async function dockerAvailableMemoryMb(runner: DockerRunner): Promise<number | null> {
  try {
    const result = await runner.run(['info', '--format', '{{.MemTotal}}'], { timeoutMs: INFO_TIMEOUT_MS });
    if (result.code !== 0 || result.timedOut) return null;
    return parseDockerMemTotalMb(result.stdout || result.stderr);
  } catch {
    return null;
  }
}
