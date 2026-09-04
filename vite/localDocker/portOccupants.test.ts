import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  LOOKUP_TIMEOUT_MS,
  decodeCommandOutput,
  formatPortConflictError,
  localAddrHasPort,
  lookupCommandCandidates,
  lookupPortOccupants,
  parseLsofListenPid,
  parseNetstatListenPid,
  parsePsComm,
  parseTasklistImage,
  sanitizeProcessName,
} from './portOccupants.ts';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn((...args: Parameters<typeof actual.spawn>) => actual.spawn(...args)),
  };
});

function fakeChild(opts?: {
  throwSync?: boolean;
  error?: Error;
  stdout?: Buffer;
  hang?: boolean;
  noStdout?: boolean;
  noUnref?: boolean;
}): EventEmitter & { stdout?: EventEmitter; kill: ReturnType<typeof vi.fn> } {
  if (opts?.throwSync) throw new Error('spawn fail');
  const child = new EventEmitter() as EventEmitter & {
    stdout?: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.kill = vi.fn();
  if (!opts?.noStdout) {
    child.stdout = new EventEmitter();
  }
  if (opts?.error) {
    queueMicrotask(() => child.emit('error', opts.error));
  } else if (!opts?.hang) {
    queueMicrotask(() => {
      if (opts?.stdout && child.stdout) child.stdout.emit('data', opts.stdout);
      child.emit('close', 0);
    });
  }
  return child;
}

const LSOF = `\
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
Python  72363 me     3u  IPv4 0x1      0t0  TCP *:4010 (LISTEN)
node      99 me     8u  IPv6 0x2      0t0  TCP [::1]:4443 (LISTEN)
`;

const NETSTAT = `\
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:4010         0.0.0.0:0              LISTENING       72363
  TCP    127.0.0.1:51234        127.0.0.1:4010         ESTABLISHED     88
  TCP    [::]:4443              [::]:0                 LISTENING       99
`;

describe('portOccupants parsers', () => {
  it('parses lsof LISTEN rows including glued state', () => {
    expect(parseLsofListenPid(LSOF, 4010)).toBe(72363);
    expect(parseLsofListenPid(LSOF, 4443)).toBe(99);
    expect(parseLsofListenPid(LSOF, 80)).toBeNull();
    expect(parseLsofListenPid('\uFEFFPython  72363 me  3u  IPv4  TCP *:4010(LISTEN)\n', 4010)).toBe(72363);
  });

  it('does not treat 4010 as a prefix of 40100', () => {
    expect(localAddrHasPort('127.0.0.1:4010', 4010)).toBe(true);
    expect(localAddrHasPort('127.0.0.1:4010', 401)).toBe(false);
    expect(localAddrHasPort('127.0.0.1:40100', 4010)).toBe(false);
    expect(localAddrHasPort('*:4010(LISTEN)', 4010)).toBe(true);
    expect(localAddrHasPort('[::]:4010', 4010)).toBe(true);
  });

  it('parses netstat listening PIDs and ignores remote-only matches', () => {
    expect(parseNetstatListenPid(NETSTAT, 4010)).toBe(72363);
    expect(parseNetstatListenPid(NETSTAT, 4443)).toBe(99);
    expect(parseNetstatListenPid(NETSTAT, 80)).toBeNull();
    expect(parseNetstatListenPid('  TCP    127.0.0.1:51234        127.0.0.1:4010         ESTABLISHED     88\n', 4010)).toBeNull();
    expect(parseNetstatListenPid('  TCP    0.0.0.0:4010           0.0.0.0:0              ABHOREN         72363\n', 4010)).toBe(72363);
    expect(parseNetstatListenPid('  TCP    127.0.0.1:4010         0.0.0.0:0              02              7\n', 4010)).toBe(7);
  });

  it('parses ps and tasklist names', () => {
    expect(parsePsComm('/usr/bin/python3.14\n')).toBe('python3.14');
    expect(parsePsComm('   \n')).toBeNull();
    expect(parseTasklistImage('"Python.exe","72363","Console","1","12,345 K"')).toBe('Python.exe');
    expect(parseTasklistImage('\uFEFF"Python.exe","72363","Console","1","12,345 K"')).toBe('Python.exe');
    expect(parseTasklistImage('INFO: No tasks')).toBeNull();
    expect(sanitizeProcessName('x'.repeat(80))?.length).toBe(64);
  });

  it('decodes UTF-16 LE netstat output', () => {
    const text = '  TCP    [::]:4010              [::]:0                 LISTENING       42\n';
    const bom = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
    expect(parseNetstatListenPid(decodeCommandOutput(bom), 4010)).toBe(42);
    const be = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(text, 'utf16le')]);
    for (let i = 2; i + 1 < be.length; i += 2) {
      const lo = be[i]!;
      be[i] = be[i + 1]!;
      be[i + 1] = lo;
    }
    expect(parseNetstatListenPid(decodeCommandOutput(be), 4010)).toBe(42);
    const large = Buffer.from(`${'TCP    127.0.0.1:1         0.0.0.0:0    LISTENING    1\n'.repeat(4000)}  TCP    [::]:4010              [::]:0                 LISTENING       42\n`, 'utf16le');
    expect(parseNetstatListenPid(decodeCommandOutput(large), 4010)).toBe(42);
  });

  it('lists lsof then PATH and Windows System32 candidates', () => {
    expect(lookupCommandCandidates('lsof')[0]).toBe('/usr/sbin/lsof');
    expect(lookupCommandCandidates('netstat', 'D:\\Windows').some((p) => p.includes('System32'))).toBe(true);
  });

  it('formats PORT_CONFLICT with optional process and pid', () => {
    expect(formatPortConflictError([4010, 4443])).toBe('PORT_CONFLICT:[{"port":4010},{"port":4443}]');
    expect(formatPortConflictError([{ port: 4010, process: 'Python', pid: 72363 }])).toBe(
      'PORT_CONFLICT:[{"port":4010,"process":"Python","pid":72363}]',
    );
  });

  it('looks up unix occupants from injected lsof + ps', async () => {
    const occupants = await lookupPortOccupants([4010], {
      platform: 'darwin',
      run: async (_bin, args) => {
        if (args.includes('-nP')) return LSOF;
        if (args.includes('comm=')) return 'Python\n';
        return null;
      },
    });
    expect(occupants).toEqual([{ port: 4010, process: 'Python', pid: 72363 }]);
  });

  it('looks up windows occupants from injected netstat + tasklist', async () => {
    const occupants = await lookupPortOccupants([4010], {
      platform: 'win32',
      run: async (_bin, args) => {
        if (args.includes('-ano')) return NETSTAT;
        if (args.includes('/FO')) return '"Python.exe","72363","Console","1","12,345 K"\n';
        return null;
      },
    });
    expect(occupants).toEqual([{ port: 4010, process: 'Python.exe', pid: 72363 }]);
  });

  it('falls back to port-only when lookup output is missing', async () => {
    await expect(lookupPortOccupants([18080], {
      platform: 'darwin',
      run: async () => null,
    })).resolves.toEqual([{ port: 18080 }]);
  });

  it('returns an empty list when no ports are requested', async () => {
    await expect(lookupPortOccupants([])).resolves.toEqual([]);
  });

  it('covers host:port edge cases and UTF-8 command output', () => {
    expect(localAddrHasPort('', 4010)).toBe(false);
    expect(localAddrHasPort('4010', 4010)).toBe(false);
    expect(localAddrHasPort('[::1', 4010)).toBe(false);
    expect(decodeCommandOutput(Buffer.from('hello'))).toBe('hello');
    expect(decodeCommandOutput(Buffer.from([0x61, 0x00, 0x62]))).toBe('a\u0000b');
    expect(sanitizeProcessName('\u0001\u0002')).toBeNull();
    expect(parseLsofListenPid('COMMAND PID\nshort\n', 4010)).toBeNull();
    expect(parseTasklistImage('Python.exe,72363,Console,1,12 K')).toBe('Python.exe');
    expect(lookupCommandCandidates('tasklist').some((p) => p.includes('tasklist'))).toBe(true);
  });

  it('resolves windows lookup bins from SystemRoot when they exist', async () => {
    const occupants = await lookupPortOccupants([4010], {
      platform: 'win32',
      env: { SystemRoot: 'D:\\Windows' },
      exists: (p) => p.includes('System32'),
      run: async () => null,
    });
    expect(occupants).toEqual([{ port: 4010 }]);
  });

  it('uses process defaults and SYSTEMROOT when resolving windows bins', async () => {
    await expect(lookupPortOccupants([4010], {
      platform: 'win32',
      env: { SYSTEMROOT: 'D:\\Windows' },
      exists: () => false,
      run: async () => null,
    })).resolves.toEqual([{ port: 4010 }]);
  });

  it('uses process.platform and env when lookup deps omit them', async () => {
    await expect(lookupPortOccupants([4010], {
      run: async () => null,
    })).resolves.toEqual([{ port: 4010 }]);
  });

  it('keeps a windows pid when tasklist output is missing', async () => {
    await expect(lookupPortOccupants([4010], {
      platform: 'win32',
      run: async (_bin, args) => (args.includes('-ano') ? NETSTAT : null),
    })).resolves.toEqual([{ port: 4010, pid: 72363 }]);
  });

  it('keeps a unix pid when ps output is missing', async () => {
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      run: async (_bin, args) => (args.includes('-nP') ? LSOF : null),
    })).resolves.toEqual([{ port: 4010, pid: 72363 }]);
  });

  it('keeps a windows pid when tasklist lines have no image name', async () => {
    await expect(lookupPortOccupants([4010], {
      platform: 'win32',
      run: async (_bin, args) => {
        if (args.includes('-ano')) return NETSTAT;
        return 'INFO: No tasks\nINFO: No tasks';
      },
    })).resolves.toEqual([{ port: 4010, pid: 72363 }]);
  });

  it('keeps a unix pid when ps returns a blank command', async () => {
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      run: async (_bin, args) => {
        if (args.includes('-nP')) return LSOF;
        return '   \n';
      },
    })).resolves.toEqual([{ port: 4010, pid: 72363 }]);
  });

  it('parses tcpv6 netstat rows and quoted-empty tasklist names', () => {
    expect(parseNetstatListenPid('  TCPv6  [::]:4010  [::]:0  LISTENING  11\n', 4010)).toBe(11);
    expect(parseTasklistImage('"')).toBeNull();
    expect(lookupCommandCandidates('netstat', '   ')[0]).toContain('Windows');
  });

  it('swallows a synchronous spawn failure from the default runner', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeChild({ throwSync: true }) as never);
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      exists: () => false,
    })).resolves.toEqual([{ port: 4010 }]);
  });

  it('swallows a child error from the default runner', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeChild({ error: new Error('gone') }) as never);
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      exists: () => false,
    })).resolves.toEqual([{ port: 4010 }]);
  });

  it('decodes stdout from the default runner', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeChild({
      stdout: Buffer.from(LSOF),
    }) as never);
    vi.mocked(spawn).mockImplementationOnce(() => fakeChild({
      stdout: Buffer.from('Python\n'),
    }) as never);
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      exists: () => false,
    })).resolves.toEqual([{ port: 4010, process: 'Python', pid: 72363 }]);
  });

  it('times out a hanging lookup child', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = fakeChild({ hang: true });
      child.kill = vi.fn(() => {
        throw new Error('already gone');
      });
      return child as never;
    });
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      exists: () => false,
    })).resolves.toEqual([{ port: 4010 }]);
  }, LOOKUP_TIMEOUT_MS + 1_000);

  it('ignores a child with no stdout pipe', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeChild({ noStdout: true }) as never);
    await expect(lookupPortOccupants([4010], {
      platform: 'darwin',
      exists: () => false,
    })).resolves.toEqual([{ port: 4010 }]);
  });
});
