import { describe, expect, it } from 'vitest';
import { dockerAvailableMemoryMb, parseDockerMemTotalMb } from './memory.ts';
import type { DockerRunner } from './types.ts';

describe('memory', () => {
  it('converts MemTotal bytes to MB', () => {
    expect(parseDockerMemTotalMb('2147483648\n')).toBe(2048);
    expect(parseDockerMemTotalMb('not-a-number')).toBeNull();
    expect(parseDockerMemTotalMb('')).toBeNull();
  });

  it('reads docker info via the runner', async () => {
    const runner: DockerRunner = {
      async run() {
        return { code: 0, stdout: '1073741824', stderr: '', timedOut: false, killed: false };
      },
    };
    await expect(dockerAvailableMemoryMb(runner)).resolves.toBe(1024);
  });

  it('returns null when docker info fails', async () => {
    const runner: DockerRunner = {
      async run() {
        return { code: 1, stdout: '', stderr: 'cannot connect', timedOut: false, killed: false };
      },
    };
    await expect(dockerAvailableMemoryMb(runner)).resolves.toBeNull();
  });

  it('returns null when the runner throws', async () => {
    const runner: DockerRunner = {
      async run() {
        throw new Error('enoent');
      },
    };
    await expect(dockerAvailableMemoryMb(runner)).resolves.toBeNull();
  });

  it('falls back to stderr when stdout is empty', async () => {
    const runner: DockerRunner = {
      async run() {
        return { code: 0, stdout: '', stderr: '1073741824', timedOut: false, killed: false };
      },
    };
    await expect(dockerAvailableMemoryMb(runner)).resolves.toBe(1024);
  });

  it('returns null when docker info times out', async () => {
    const runner: DockerRunner = {
      async run() {
        return { code: null, stdout: '', stderr: '', timedOut: true, killed: true };
      },
    };
    await expect(dockerAvailableMemoryMb(runner)).resolves.toBeNull();
  });
});
