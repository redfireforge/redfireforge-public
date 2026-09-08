import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDockerError, createLocalDockerLifecycle } from './lifecycle.ts';
import { createLogBus } from './logs.ts';
import * as ports from './ports.ts';
import type { DockerRunResult, DockerRunner } from './types.ts';

const logDirs: string[] = [];

function tempLogs() {
  const logDir = mkdtempSync(join(tmpdir(), 'rff-life-logs-'));
  logDirs.push(logDir);
  return createLogBus({ logDir });
}

afterEach(() => {
  for (const dir of logDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Call {
  args: string[];
  cwd?: string;
}

function result(partial: Partial<DockerRunResult> = {}): DockerRunResult {
  return { code: 0, stdout: '', stderr: '', timedOut: false, killed: false, ...partial };
}

function createMockRunner(
  decide?: (call: Call) => Partial<DockerRunResult> | undefined,
): { runner: DockerRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: DockerRunner = {
    async run(args, opts) {
      const call = { args, cwd: opts?.cwd };
      calls.push(call);
      if (opts?.signal?.aborted) {
        return result({ code: null, killed: true });
      }
      return result(decide?.(call) ?? {});
    },
  };
  return { runner, calls };
}

describe('lifecycle', () => {
  it('starts kafka-plaintext with one compose up in the repo stack dir', async () => {
    const { runner, calls } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await life.startStack('kafka-plaintext');
    const up = calls.find((c) => c.args.includes('up'));
    expect(up).toBeDefined();
    expect(up?.cwd?.replace(/\\/g, '/')).toMatch(/docker\/kafka\/plaintext$/);
    expect(up?.args).toContain('-p');
    expect(up?.args).toContain('rff-kafka-plaintext');
    expect(up?.args).toContain('-f');
    expect(up?.args).toContain('docker-compose.yml');
    expect(up?.args).toContain('up');
    expect(up?.args).toContain('-d');
    expect(calls.filter((c) => c.args.includes('up'))).toHaveLength(1);
  });

  it('refuses a third unrelated stack with STACK_LIMIT', async () => {
    const { runner } = createMockRunner((call) => {
      if (!call.args.includes('ps')) return {};
      const project = call.args.includes('-p') ? call.args[call.args.indexOf('-p') + 1] : '';
      const cwd = call.cwd?.replace(/\\/g, '/') ?? '';
      if (project === 'rff-graphql' || cwd.endsWith('/docker/graphql')) {
        return { stdout: 'graphql\n' };
      }
      if (project === 'rff-kafka-plaintext' || cwd.endsWith('/kafka/plaintext')) {
        return { stdout: 'kafka\n' };
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(life.startStack('ws-socketio')).rejects.toMatchObject({
      message: 'STACK_LIMIT:graphql,kafka-plaintext',
    });
  });

  it('allows grpc-spring as an overlay on the same slot', async () => {
    const { runner, calls } = createMockRunner((call) => {
      if (!call.args.includes('ps')) return {};
      if (call.cwd?.replace(/\\/g, '/').endsWith('/docker/grpc')) {
        if (call.args.includes('--profile')) return { stdout: 'grpc-test-server\n' };
        return { stdout: 'grpc-test-server\n' };
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await life.startStack('grpc-spring');
    expect(calls.some((c) => c.args.includes('up') && c.args.includes('--profile'))).toBe(true);
  });

  it('returns PORT_CONFLICT when a new stack port is busy', async () => {
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async (port) => port === 4010,
      lookupOccupants: async (ports) => ports.map((port) => ({ port })),
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'PORT_CONFLICT:[{"port":4010}]',
    });
  });

  it('includes process name and pid in PORT_CONFLICT when lookup finds them', async () => {
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async (port) => port === 4010,
      lookupOccupants: async () => [{ port: 4010, process: 'Python', pid: 72363 }],
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'PORT_CONFLICT:[{"port":4010,"process":"Python","pid":72363}]',
    });
  });

  it('refuses Start when the TLS cert date is already past', async () => {
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      nowMs: () => Date.UTC(2037, 0, 1),
    });
    await expect(life.startStack('graphql-tls')).rejects.toMatchObject({
      message: 'CERT_EXPIRED:2036-08-30',
    });
  });

  it('does not start when the daemon is down', async () => {
    const { runner, calls } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'notRunning',
    });
    await expect(life.startStack('graphql')).rejects.toBeInstanceOf(LocalDockerError);
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:Docker Desktop is not running.',
    });
    expect(calls.filter((c) => c.args.includes('up'))).toHaveLength(0);
  });

  it('maps compose up 137 to OOM_KILLED', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('up')) return { code: 137, stderr: 'killed 137' };
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'OOM_KILLED:512',
    });
  });

  it('cancels Start when Stop arrives during the daemon check', async () => {
    let releaseCheck: (() => void) | undefined;
    let checkEntered!: () => void;
    const checkStarted = new Promise<void>((resolve) => { checkEntered = resolve; });
    const checkHold = new Promise<void>((resolve) => { releaseCheck = resolve; });
    let upCalled = false;
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('up')) {
        upCalled = true;
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => {
        checkEntered();
        await checkHold;
        return 'running';
      },
      isPortOccupied: async () => false,
    });
    const start = life.startStack('graphql');
    await checkStarted;
    life.cancelInflightForStack('graphql');
    releaseCheck?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
    expect(upCalled).toBe(false);
  });

  it('cancels Start when Stop arrives during the pre-up gate', async () => {
    let releasePs: (() => void) | undefined;
    let psEntered!: () => void;
    const psStarted = new Promise<void>((resolve) => { psEntered = resolve; });
    const psHold = new Promise<void>((resolve) => { releasePs = resolve; });
    let upCalled = false;
    const runner: DockerRunner = {
      async run(args) {
        if (args.includes('ps')) {
          psEntered();
          await psHold;
          return result();
        }
        if (args.includes('up')) {
          upCalled = true;
          return result();
        }
        return result();
      },
    };
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    const start = life.startStack('graphql');
    await psStarted;
    life.cancelInflightForStack('graphql');
    releasePs?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
    expect(upCalled).toBe(false);
  });

  it('returns START_CANCELLED when Stop aborts an in-flight up', async () => {
    let releaseUp: (() => void) | undefined;
    const upStarted = new Promise<void>((resolve) => {
      releaseUp = resolve;
    });
    const calls: Call[] = [];
    let abortSeen = false;
    const hanging: DockerRunner = {
      async run(args, opts) {
        calls.push({ args, cwd: opts?.cwd });
        if (args.includes('up')) {
          releaseUp?.();
          await new Promise<void>((resolve) => {
            if (opts?.signal?.aborted) {
              abortSeen = true;
              resolve();
              return;
            }
            opts?.signal?.addEventListener('abort', () => {
              abortSeen = true;
              resolve();
            });
          });
          return result({ code: null, killed: true });
        }
        return result();
      },
    };
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: hanging,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    const start = life.startStack('graphql');
    await upStarted;
    life.cancelInflightForStack('graphql');
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
    expect(abortSeen).toBe(true);
    expect(calls.some((c) => c.args.includes('up'))).toBe(true);
  });

  it('stop-all fails when compose ls cannot run', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args[0] === 'compose' && call.args.includes('ls')) {
        return { code: 1, stderr: 'cannot connect' };
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    await expect(life.stopAllRffProjects()).rejects.toMatchObject({
      message: 'cannot connect',
    });
  });

  it('stop-all fails when every rff-* compose down fails', async () => {
    const { runner, calls } = createMockRunner((call) => {
      if (call.args[0] === 'compose' && call.args.includes('ls')) {
        return { stdout: 'rff-graphql\nrff-kafka-plaintext\n' };
      }
      if (call.args.includes('down')) {
        return { code: 1, stderr: 'cannot stop' };
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    await expect(life.stopAllRffProjects()).rejects.toMatchObject({
      message: 'docker compose down failed',
    });
    expect(calls.filter((c) => c.args.includes('down'))).toHaveLength(2);
  });

  it('stop-all downs only rff-* project names', async () => {
    const { runner, calls } = createMockRunner((call) => {
      if (call.args[0] === 'compose' && call.args.includes('ls')) {
        return { stdout: 'rff-graphql\norders-api-postgres\ngraphql\n' };
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    const stopped = await life.stopAllRffProjects();
    expect(stopped).toEqual(['rff-graphql']);
    const downs = calls.filter((c) => c.args.includes('down'));
    expect(downs).toHaveLength(1);
    expect(downs[0]?.args).toEqual(['compose', '-p', 'rff-graphql', 'down']);
  });

  it('stop uses merged grpc family args', async () => {
    const { runner, calls } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    await life.stopStack('grpc');
    const down = calls.find((c) => c.args.includes('down') && c.args.includes('-p'));
    expect(down?.args).toContain('rff-grpc-family');
    expect(down?.args).toContain('--profile');
    expect(down?.args).toContain('spring');
  });

  it('getStackStatus is null when compose ps fails', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('ps')) return { code: 1, stderr: 'cannot connect' };
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    await expect(life.getStackStatus('graphql')).resolves.toBeNull();
  });

  it('writes start status lines after F2/F3 checks', async () => {
    const { runner } = createMockRunner();
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      logs,
    });
    await life.startStack('kafka-plaintext');
    expect(seen[0]).toBe('=== Starting kafka-plaintext stack ===');
    expect(seen).toContain('✓ compose project started');
    expect(seen.at(-1)).toBe('=== Stack started ===');
    expect(logs.read('kafka-plaintext')).toContain('=== Starting kafka-plaintext stack ===');
  });

  it('does not truncate last-run when Start hits PORT_CONFLICT', async () => {
    const logs = tempLogs();
    logs.emit('graphql', 'previous-run');
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async (port) => port === 4010,
      lookupOccupants: async (ports) => ports.map((port) => ({ port })),
      logs,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'PORT_CONFLICT:[{"port":4010}]',
    });
    expect(logs.read('graphql')).toContain('previous-run');
    expect(logs.read('graphql')).not.toContain('=== Starting graphql stack ===');
  });

  it('restores last-run when compose spawn fails', async () => {
    const logs = tempLogs();
    logs.emit('graphql', 'previous-run');
    const runner: DockerRunner = {
      async run(args) {
        if (args.includes('up')) {
          const err = new Error('docker not found') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return result();
      },
    };
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      logs,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:Docker is not installed.',
    });
    expect(logs.read('graphql')).toContain('previous-run');
  });

  it('streams stop status lines', async () => {
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, { runner, logs });
    await life.stopStack('graphql');
    expect(seen[0]).toBe('=== Stopping graphql stack ===');
    expect(seen.at(-1)).toBe('=== Stack stopped ===');
  });

  it('writes grpc-family stop lines to both last-run files', async () => {
    const logs = tempLogs();
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, { runner, logs });
    await life.stopStack('grpc');
    expect(logs.read('grpc')).toContain('=== Stopping grpc stack ===');
    expect(logs.read('grpc')).toContain('=== Stack stopped ===');
    expect(logs.read('grpc-spring')).toContain('=== Stopping grpc stack ===');
    expect(logs.read('grpc-spring')).toContain('=== Stack stopped ===');
  });

  it('does not reuse the F2 port probe for the gRPC companion', async () => {
    const spy = vi.spyOn(ports, 'probeCompanionPort').mockResolvedValue(false);
    const probed: number[] = [];
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async (port) => {
        probed.push(port);
        return false;
      },
    });
    try {
      await life.startStack('grpc');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]?.[0]?.probe).toBeUndefined();
      expect(probed).not.toContain(3001);
    } finally {
      spy.mockRestore();
    }
  });

  it('cancels Start when Stop arrives during the companion probe', async () => {
    let releaseProbe: (() => void) | undefined;
    let probeEntered!: () => void;
    const probeStarted = new Promise<void>((resolve) => { probeEntered = resolve; });
    const probeHold = new Promise<void>((resolve) => { releaseProbe = resolve; });
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      probeCompanion: async () => {
        probeEntered();
        await probeHold;
        return true;
      },
    });
    const start = life.startStack('grpc');
    await probeStarted;
    life.cancelInflightForStack('grpc');
    releaseProbe?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
  });

  it('logs a companion miss without failing Start', async () => {
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      probeCompanion: async () => false,
      logs,
    });
    await life.startStack('grpc');
    expect(seen.some((line) => line.includes('gRPC companion not detected on :3001'))).toBe(true);
    expect(seen.at(-1)).toBe('=== Stack started ===');
  });

  it('lets two overlapping graphql Starts share one slot and blocks a third slot', async () => {
    let releaseGraphql: (() => void) | undefined;
    let releaseKafka: (() => void) | undefined;
    let graphqlEntered!: () => void;
    let kafkaEntered!: () => void;
    const graphqlUp = new Promise<void>((resolve) => { releaseGraphql = resolve; });
    const kafkaUp = new Promise<void>((resolve) => { releaseKafka = resolve; });
    const graphqlStarted = new Promise<void>((resolve) => { graphqlEntered = resolve; });
    const kafkaStarted = new Promise<void>((resolve) => { kafkaEntered = resolve; });
    let graphqlUps = 0;
    const runner: DockerRunner = {
      async run(args, opts) {
        const cwd = opts?.cwd?.replace(/\\/g, '/') ?? '';
        if (args.includes('up') && cwd.includes('/docker/graphql')) {
          graphqlUps += 1;
          if (graphqlUps === 1) {
            graphqlEntered();
            await graphqlUp;
          }
          return result();
        }
        if (args.includes('up') && cwd.includes('/kafka/plaintext')) {
          kafkaEntered();
          await kafkaUp;
          return result();
        }
        return result();
      },
    };
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    const first = life.startStack('graphql');
    await graphqlStarted;
    await expect(life.startStack('graphql')).resolves.toBeUndefined();
    const kafka = life.startStack('kafka-plaintext');
    await kafkaStarted;
    await expect(life.startStack('ws-socketio')).rejects.toMatchObject({
      message: 'STACK_LIMIT:graphql,kafka-plaintext',
    });
    releaseGraphql?.();
    releaseKafka?.();
    await expect(first).resolves.toBeUndefined();
    await expect(kafka).resolves.toBeUndefined();
  });

  it('getStackStatus is false when the stack dir is missing', async () => {
    const life = createLocalDockerLifecycle(resolve(repoRoot, 'does-not-exist'), {
      runner: createMockRunner().runner,
    });
    await expect(life.getStackStatus('graphql')).resolves.toBe(false);
  });

  it('rejects unknown stack keys and daemon install/compose blocks', async () => {
    const { runner } = createMockRunner();
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'notInstalled',
    });
    await expect(life.startStack('nope')).rejects.toMatchObject({ message: 'Unknown docker stack' });
    await expect(life.stopStack('nope')).rejects.toMatchObject({ message: 'Unknown docker stack' });
    await expect(life.getStackStatus('nope')).resolves.toBeNull();
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:Docker is not installed.',
    });
    const outdated = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'outdatedCompose',
    });
    await expect(outdated.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:Docker Compose V2 is required.',
    });
    expect(life.loadManifestDto('graphql').stackKey).toBe('graphql');
    expect(() => life.loadManifestDto('nope')).toThrow(/Unknown docker stack/);
  });

  it('maps a failed pre-up compose ps to a verify error', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('ps')) return { code: 1, stderr: 'cannot connect' };
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: expect.stringContaining('Cannot verify if graphql is already running'),
    });
  });

  it('ensures services when the stack is already up', async () => {
    const { runner, calls } = createMockRunner((call) => {
      if (call.args.includes('ps')) return { stdout: 'graphql\n' };
      return {};
    });
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      logs,
    });
    await life.startStack('graphql');
    expect(seen.some((line) => line.includes('already has running containers'))).toBe(true);
    expect(calls.some((c) => c.args.includes('up'))).toBe(true);
  });

  it('returns PORT_CONFLICT on overlay-only ports when the family is already up', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('config')) return { stdout: 'grpc-test-server\n' };
      if (!call.args.includes('ps')) return {};
      if (call.args.includes('--profile')) return { stdout: '' };
      return { stdout: 'grpc-test-server\n' };
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async (port) => port === 9090,
      lookupOccupants: async () => {
        throw new Error('lsof missing');
      },
    });
    await expect(life.startStack('grpc-spring')).rejects.toMatchObject({
      message: 'PORT_CONFLICT:[{"port":9090}]',
    });
  });

  it('maps compose up failures, OOM text, and non-ENOENT spawn errors', async () => {
    const failTail = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('up') ? { code: 1, stderr: 'pull failed\nbad image' } : {}
      )).runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(failTail.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:pull failed\nbad image',
    });

    const failEmpty = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('up') ? { code: 2, stderr: '' } : {}
      )).runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(failEmpty.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:docker compose up failed (exit 2)',
    });

    const oomText = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('up') ? { code: 1, stderr: 'container OOMKilled' } : {}
      )).runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(oomText.startStack('graphql')).rejects.toMatchObject({
      message: 'OOM_KILLED:512',
    });

    const boom = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('up')) throw new Error('broken pipe');
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(boom.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:docker compose failed: broken pipe',
    });
  });

  it('logs a ready companion and exposes list/memory helpers', async () => {
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('ps') && call.cwd?.replace(/\\/g, '/').endsWith('/docker/graphql')) {
        return { stdout: 'graphql\n' };
      }
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      probeCompanion: async () => true,
      memoryMb: async () => 2048,
      logs,
    });
    await life.startStack('grpc');
    expect(seen.some((line) => line.includes('gRPC companion server ready'))).toBe(true);
    await expect(life.listRunningBestEffort()).resolves.toContain('graphql');
    await expect(life.listRunningStrict()).resolves.toContain('graphql');
    await expect(life.getAvailableMemoryMb()).resolves.toBe(2048);
    life.cancelAllInflight();
  });

  it('uses docker memory when no memory helper is injected', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('info')) return { stdout: '1073741824' };
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    await expect(life.getAvailableMemoryMb()).resolves.toBe(1024);
  });

  it('surfaces stop failures and a failed compose ls fallback', async () => {
    const downCode = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('down') ? { code: 1 } : {}
      )).runner,
    });
    await expect(downCode.stopStack('graphql')).rejects.toMatchObject({
      message: 'docker compose down failed',
    });

    const downThrow = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('down')) throw new Error('pipe');
          return result();
        },
      },
    });
    await expect(downThrow.stopStack('graphql')).rejects.toMatchObject({ message: 'pipe' });

    const downUnknown = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('down')) throw 1;
          return result();
        },
      },
    });
    await expect(downUnknown.stopStack('graphql')).rejects.toMatchObject({
      message: 'docker compose down failed',
    });

    let lsCalls = 0;
    const lsFallback = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('ls') && args.includes('--all')) {
            lsCalls += 1;
            return result({ code: 1, stderr: '' });
          }
          if (args.includes('ls')) return result({ stdout: 'rff-graphql\n' });
          return result();
        },
      },
    });
    await expect(lsFallback.stopAllRffProjects()).resolves.toEqual(['rff-graphql']);
    expect(lsCalls).toBe(1);

    const lsEmpty = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('ls') ? { code: 1, stderr: '' } : {}
      )).runner,
    });
    await expect(lsEmpty.stopAllRffProjects()).rejects.toMatchObject({
      message: 'docker compose ls failed',
    });
  });

  it('returns null status when stack.json cannot be read', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rff-life-root-'));
    mkdirSync(join(tmp, 'docker', 'graphql'), { recursive: true });
    try {
      const life = createLocalDockerLifecycle(tmp, { runner: createMockRunner().runner });
      await expect(life.getStackStatus('graphql')).resolves.toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('aborts every in-flight start from cancelAllInflight', async () => {
    let releaseCheck: (() => void) | undefined;
    let checkEntered!: () => void;
    const checkStarted = new Promise<void>((resolve) => { checkEntered = resolve; });
    const checkHold = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner().runner,
      checkState: async () => {
        checkEntered();
        await checkHold;
        return 'running';
      },
      isPortOccupied: async () => false,
    });
    const start = life.startStack('graphql');
    await checkStarted;
    life.cancelAllInflight();
    releaseCheck?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
  });

  it('treats default-profile containers as the project already being up', async () => {
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const { runner } = createMockRunner((call) => {
      if (!call.args.includes('ps')) return {};
      if (call.args.includes('--profile')) return { stdout: '' };
      return { stdout: 'grpc-test-server\n' };
    });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      logs,
    });
    await life.startStack('grpc-spring');
    expect(seen.some((line) => line.includes('Adding profile services'))).toBe(true);
  });

  it('streams compose onLine output and treats a killed up as cancelled', async () => {
    const logs = tempLogs();
    const seen: string[] = [];
    logs.subscribe((e) => seen.push(e.line));
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args, opts) {
          if (args.includes('up')) {
            opts?.onLine?.('pulling image');
            return result({ killed: true, code: null });
          }
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
      logs,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({ message: 'START_CANCELLED' });
    expect(seen).toContain('pulling image');
    expect(seen).toContain('✗ Start cancelled — the stack was stopped');
  });

  it('rethrows a LocalDockerError from compose without wrapping it', async () => {
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('up')) throw new LocalDockerError('START_FAILED:already wrapped');
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:already wrapped',
    });
  });

  it('skips a missing stack.json while listing running stacks', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rff-life-strict-'));
    mkdirSync(join(tmp, 'docker', 'graphql'), { recursive: true });
    try {
      const life = createLocalDockerLifecycle(tmp, { runner: createMockRunner().runner });
      await expect(life.listRunningStrict()).resolves.toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('maps an aborted compose-ps throw to START_CANCELLED', async () => {
    let releasePs: (() => void) | undefined;
    let psEntered!: () => void;
    const psStarted = new Promise<void>((resolve) => { psEntered = resolve; });
    const psHold = new Promise<void>((resolve) => { releasePs = resolve; });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('ps')) {
            psEntered();
            await psHold;
            throw new Error('cannot connect');
          }
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    const start = life.startStack('graphql');
    await psStarted;
    life.cancelInflightForStack('graphql');
    releasePs?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
  });

  it('cancels Start after the legacy compose down', async () => {
    let releaseDown: (() => void) | undefined;
    let downEntered!: () => void;
    const downStarted = new Promise<void>((resolve) => { downEntered = resolve; });
    const downHold = new Promise<void>((resolve) => { releaseDown = resolve; });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('down')) {
            downEntered();
            await downHold;
            return result();
          }
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    const start = life.startStack('graphql');
    await downStarted;
    life.cancelInflightForStack('graphql');
    releaseDown?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
  });

  it('cancels Start during an overlay port probe', async () => {
    let releaseProbe: (() => void) | undefined;
    let probeEntered!: () => void;
    const probeStarted = new Promise<void>((resolve) => { probeEntered = resolve; });
    const probeHold = new Promise<void>((resolve) => { releaseProbe = resolve; });
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => {
        if (!call.args.includes('ps')) return {};
        if (call.args.includes('--profile')) return { stdout: '' };
        return { stdout: 'grpc-test-server\n' };
      }).runner,
      checkState: async () => 'running',
      isPortOccupied: async () => {
        probeEntered();
        await probeHold;
        return false;
      },
    });
    const start = life.startStack('grpc-spring');
    await probeStarted;
    life.cancelInflightForStack('grpc-spring');
    releaseProbe?.();
    await expect(start).rejects.toMatchObject({ message: 'START_CANCELLED' });
  });

  it('maps a 137 token in compose stderr to OOM_KILLED', async () => {
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('up') ? { code: 1, stderr: 'engine exit 137' } : {}
      )).runner,
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: 'OOM_KILLED:512',
    });
  });

  it('wraps a non-error compose throw and keeps a START_FAILED message', async () => {
    const raw = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('up')) throw 1;
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(raw.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:docker compose failed',
    });

    const keep = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('up')) throw new Error('START_FAILED:keep-me');
          return result();
        },
      },
      checkState: async () => 'running',
      isPortOccupied: async () => false,
    });
    await expect(keep.startStack('graphql')).rejects.toMatchObject({
      message: 'START_FAILED:keep-me',
    });
  });

  it('looks up occupants with the default helper and stringifies a non-error ps throw', async () => {
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner().runner,
      checkState: async () => 'running',
      isPortOccupied: async () => true,
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: expect.stringContaining('PORT_CONFLICT:'),
    });

    const verify = createLocalDockerLifecycle(repoRoot, {
      runner: {
        async run(args) {
          if (args.includes('ps')) throw 1;
          return result();
        },
      },
      checkState: async () => 'running',
    });
    await expect(verify.startStack('graphql')).rejects.toMatchObject({
      message: expect.stringContaining('Cannot verify if graphql is already running: 1'),
    });
    await expect(verify.listRunningStrict()).rejects.toMatchObject({
      message: expect.stringContaining('Cannot verify running stacks'),
    });
  });

  it('uses the generic compose-ps detail when stderr is empty', async () => {
    const life = createLocalDockerLifecycle(repoRoot, {
      runner: createMockRunner((call) => (
        call.args.includes('ps') ? { code: 1, stderr: '' } : {}
      )).runner,
      checkState: async () => 'running',
    });
    await expect(life.startStack('graphql')).rejects.toMatchObject({
      message: expect.stringContaining('docker compose ps --services --filter status=running failed'),
    });
  });

  it('throws when listRunningStrict cannot verify a stack', async () => {
    const { runner } = createMockRunner((call) => {
      if (call.args.includes('ps')) return { code: 1, stderr: 'cannot connect' };
      return {};
    });
    const life = createLocalDockerLifecycle(repoRoot, { runner });
    await expect(life.listRunningStrict()).rejects.toMatchObject({
      message: expect.stringContaining('Cannot verify running stacks'),
    });
  });
});
