import { describe, expect, it, vi } from 'vitest';
import { checkDockerState, createDaemonStateReader, looksLikeComposeV1, startBlockedByDaemon } from './daemon.ts';
import type { DockerRunResult, DockerRunner } from './types.ts';

function ok(stdout = '', extras: Partial<DockerRunResult> = {}): DockerRunResult {
  return { code: 0, stdout, stderr: '', timedOut: false, killed: false, ...extras };
}

function runnerFor(script: Record<string, DockerRunResult | Error>): DockerRunner {
  return {
    async run(args) {
      const key = args.join(' ');
      const value = script[key] ?? script[args[0] ?? ''];
      if (value instanceof Error) throw value;
      if (!value) return ok();
      return value;
    },
  };
}

describe('daemon', () => {
  it('detects Compose V1 stdout', () => {
    expect(looksLikeComposeV1('docker-compose version 1.29.2, build abc')).toBe(true);
    expect(looksLikeComposeV1('Docker Compose version v2.29.0')).toBe(false);
    expect(looksLikeComposeV1('compose version v1.29.2')).toBe(true);
    expect(looksLikeComposeV1('', 'compose version 1.29.2')).toBe(true);
  });

  it('maps daemon messages for Start', () => {
    expect(startBlockedByDaemon('running')).toBeNull();
    expect(startBlockedByDaemon('notInstalled')).toBe('START_FAILED:Docker is not installed.');
    expect(startBlockedByDaemon('notRunning')).toBe('START_FAILED:Docker Desktop is not running.');
    expect(startBlockedByDaemon('outdatedCompose')).toBe('START_FAILED:Docker Compose V2 is required.');
  });

  it('returns notInstalled when no binary exists', async () => {
    await expect(checkDockerState({ resolveBin: () => null })).resolves.toBe('notInstalled');
  });

  it('returns notRunning when docker info fails or times out', async () => {
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({ info: ok('', { code: 1 }) }),
    })).resolves.toBe('notRunning');

    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({ info: ok('', { timedOut: true, code: null }) }),
    })).resolves.toBe('notRunning');
  });

  it('returns outdatedCompose when the compose plugin is missing or V1', async () => {
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({
        info: ok(),
        'compose version': ok('', { code: 1 }),
      }),
    })).resolves.toBe('outdatedCompose');

    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({
        info: ok(),
        'compose version': ok('docker-compose version 1.29.2'),
      }),
    })).resolves.toBe('outdatedCompose');
  });

  it('returns running for a healthy Compose V2 daemon', async () => {
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({
        info: ok(),
        'compose version': ok('Docker Compose version v2.29.0'),
      }),
    })).resolves.toBe('running');
  });

  it('returns notRunning when docker info throws a non-ENOENT error', async () => {
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({ info: new Error('EPIPE') }),
    })).resolves.toBe('notRunning');
  });

  it('returns notInstalled when compose version spawn is ENOENT', async () => {
    const err = Object.assign(new Error('spawn compose ENOENT'), { code: 'ENOENT' });
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({
        info: ok(),
        'compose version': err,
      }),
    })).resolves.toBe('notInstalled');
  });

  it('returns notRunning when compose version throws a non-ENOENT error', async () => {
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({
        info: ok(),
        'compose version': new Error('EPIPE'),
      }),
    })).resolves.toBe('notRunning');
  });

  it('returns notRunning when compose version times out', async () => {
    await expect(checkDockerState({
      resolveBin: () => '/usr/local/bin/docker',
      runner: runnerFor({
        info: ok(),
        'compose version': ok('', { timedOut: true, code: null }),
      }),
    })).resolves.toBe('notRunning');
  });

  it('returns notInstalled when spawn cannot find docker', async () => {
    const err = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    await expect(checkDockerState({
      resolveBin: () => 'docker',
      runner: runnerFor({ info: err }),
    })).resolves.toBe('notInstalled');
  });

  it('coalesces overlapping daemon checks and peeks the last reading', async () => {
    let resolveFirst!: (state: 'running') => void;
    const first = new Promise<'running'>((resolve) => {
      resolveFirst = resolve;
    });
    const check = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce('notRunning');
    const reader = createDaemonStateReader(check);
    const a = reader.refresh();
    const b = reader.refresh();
    expect(check).toHaveBeenCalledTimes(1);
    expect(reader.peek()).toBeNull();
    resolveFirst('running');
    await expect(a).resolves.toBe('running');
    await expect(b).resolves.toBe('running');
    expect(reader.peek()).toBe('running');
    await expect(reader.refresh()).resolves.toBe('notRunning');
    expect(reader.peek()).toBe('notRunning');
    expect(check).toHaveBeenCalledTimes(2);
  });
});
