import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { SIGKILL_GRACE_MS, createDockerRunner, runDockerProcess } from './spawnDocker.ts';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn((...args: Parameters<typeof actual.spawn>) => actual.spawn(...args)),
  };
});

describe('spawnDocker', () => {
  it('createDockerRunner rejects when docker is missing', async () => {
    const runner = createDockerRunner(() => null);
    await expect(runner.run(['info'])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('createDockerRunner runs the resolved binary', async () => {
    const runner = createDockerRunner(() => process.execPath);
    const result = await runner.run(['-e', 'process.stdout.write("ok")']);
    expect(result.stdout).toContain('ok');
    expect(result.code).toBe(0);
  });

  it('rejects when spawn cannot start the process', async () => {
    await expect(runDockerProcess('/no/such/docker-bin-xyz', ['info'])).rejects.toBeDefined();
  });

  it('rejects when spawn throws synchronously', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn fail');
    });
    await expect(runDockerProcess(process.execPath, ['-e', '0'])).rejects.toThrow('spawn fail');
  });

  it('flushes a trailing stderr chunk without a newline', async () => {
    const lines: string[] = [];
    await runDockerProcess(process.execPath, ['-e', "process.stderr.write('err-partial')"], {
      onLine: (line) => lines.push(line),
    });
    expect(lines).toContain('err-partial');
  });

  it('second kill request is a no-op after SIGTERM', async () => {
    if (process.platform === 'win32') return;
    const ac = new AbortController();
    const started = runDockerProcess(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 30000);'],
      { signal: ac.signal, timeoutMs: 30 },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    ac.abort();
    const result = await started;
    expect(result.killed).toBe(true);
  }, 10_000);

  it('timeout and abort share one SIGTERM', async () => {
    const ac = new AbortController();
    const started = runDockerProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: ac.signal,
      timeoutMs: 40,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    ac.abort();
    const result = await started;
    expect(result.killed).toBe(true);
  }, 10_000);

  it('clears an active timeout when the child errors', async () => {
    const { spawn: actualSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = actualSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('boom'), { code: 'ENOENT' }));
      });
      return child;
    });
    await expect(runDockerProcess(process.execPath, ['-e', '0'], { timeoutMs: 5_000 })).rejects.toThrow('boom');
  });

  it('ignores a second child error after the first rejected', async () => {
    const { spawn: actualSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = actualSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('first'), { code: 'ENOENT' }));
        child.emit('error', new Error('late'));
      });
      return child;
    });
    await expect(runDockerProcess(process.execPath, ['-e', '0'])).rejects.toThrow('first');
  });

  it('accepts string stdout and stderr chunks', async () => {
    const { spawn: actualSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const lines: string[] = [];
    vi.mocked(spawn).mockImplementationOnce((...args) => {
      const child = actualSpawn(...args);
      queueMicrotask(() => {
        child.stdout?.emit('data', 'hello\n');
        child.stderr?.emit('data', 'err1\n');
      });
      return child;
    });
    await runDockerProcess(process.execPath, ['-e', 'setTimeout(() => {}, 20)'], {
      onLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(expect.arrayContaining(['hello', 'err1']));
  });

  it('skips empty onLine rows and ignores timeoutMs 0', async () => {
    const lines: string[] = [];
    const result = await runDockerProcess(
      process.execPath,
      ['-e', "process.stdout.write('a\\n\\nb\\n')"],
      { onLine: (line) => lines.push(line), timeoutMs: 0 },
    );
    expect(result.timedOut).toBe(false);
    expect(lines).toEqual(['a', 'b']);
  });

  it('times out and kills a hung process', async () => {
    const result = await runDockerProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      timeoutMs: 80,
    });
    expect(result.timedOut).toBe(true);
    expect(result.killed).toBe(true);
  }, 10_000);

  it('kills immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await runDockerProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: ac.signal,
    });
    expect(result.killed).toBe(true);
  });

  it('splits stdout and stderr into onLine rows', async () => {
    const lines: string[] = [];
    await runDockerProcess(
      process.execPath,
      ['-e', "process.stdout.write('a\\nb\\n'); process.stderr.write('c\\n');"],
      { onLine: (line) => lines.push(line) },
    );
    expect(lines).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('double-abort does not throw', async () => {
    const ac = new AbortController();
    const started = runDockerProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: ac.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    ac.abort();
    ac.abort();
    const result = await started;
    expect(result.killed).toBe(true);
  });

  it('SIGTERMs an in-flight process when the start AbortSignal fires', async () => {
    const ac = new AbortController();
    const started = runDockerProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: ac.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    ac.abort();
    const result = await started;
    expect(result.killed).toBe(true);
  });

  it('emits a final onLine chunk that has no trailing newline', async () => {
    const lines: string[] = [];
    await runDockerProcess(process.execPath, ['-e', "process.stdout.write('partial-line')"], {
      onLine: (line) => lines.push(line),
    });
    expect(lines).toContain('partial-line');
  });

  it('SIGKILLs after SIGTERM grace when the child ignores SIGTERM', async () => {
    if (process.platform === 'win32') return;
    const ac = new AbortController();
    const started = runDockerProcess(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 30000);'],
      { signal: ac.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const startedAt = Date.now();
    ac.abort();
    const result = await started;
    expect(result.killed).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SIGKILL_GRACE_MS - 100);
  }, 10_000);
});
