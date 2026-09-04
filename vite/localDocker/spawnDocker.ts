import { spawn } from 'node:child_process';
import type { DockerRunOptions, DockerRunResult, DockerRunner } from './types.ts';

/** After SIGTERM, wait this long before SIGKILL. Do not key off `child.killed` — Node sets that on the first kill(). */
export const SIGKILL_GRACE_MS = 1500;

export function createDockerRunner(resolveBin: () => string | null): DockerRunner {
  return {
    run(args, opts) {
      const bin = resolveBin();
      if (!bin) {
        const err = new Error('docker not found') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        return Promise.reject(err);
      }
      return runDockerProcess(bin, args, opts);
    },
  };
}

export function runDockerProcess(
  bin: string,
  args: string[],
  opts: DockerRunOptions = {},
): Promise<DockerRunResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let sentTerm = false;
    let pendingOut = '';
    let pendingErr = '';

    const flushPendingLines = () => {
      if (!opts.onLine) return;
      if (pendingOut) {
        opts.onLine(pendingOut);
        pendingOut = '';
      }
      if (pendingErr) {
        opts.onLine(pendingErr);
        pendingErr = '';
      }
    };

    const finish = (result: DockerRunResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const requestKill = () => {
      killed = true;
      if (!sentTerm) {
        sentTerm = true;
        child.kill('SIGTERM');
      }
      if (killTimer) return;
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, SIGKILL_GRACE_MS);
      killTimer.unref?.();
    };

    const onAbort = () => {
      requestKill();
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    const append = (chunk: Buffer | string, dest: 'out' | 'err') => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (dest === 'out') stdout += text;
      else stderr += text;
      if (!opts.onLine) return;
      if (dest === 'out') pendingOut += text;
      else pendingErr += text;
      const pending = dest === 'out' ? pendingOut : pendingErr;
      const lines = pending.split(/\r?\n/);
      const rest = lines.pop() ?? '';
      if (dest === 'out') pendingOut = rest;
      else pendingErr = rest;
      for (const line of lines) {
        if (line) opts.onLine(line);
      }
    };

    child.stdout?.on('data', (chunk: Buffer | string) => append(chunk, 'out'));
    child.stderr?.on('data', (chunk: Buffer | string) => append(chunk, 'err'));

    child.on('close', (code) => {
      flushPendingLines();
      finish({
        code,
        stdout,
        stderr,
        timedOut,
        killed: killed || opts.signal?.aborted === true,
      });
    });

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        requestKill();
      }, opts.timeoutMs);
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        requestKill();
      } else {
        opts.signal.addEventListener('abort', onAbort);
      }
    }
  });
}
