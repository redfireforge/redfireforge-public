import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LAST_RUN_DIR_NAME,
  LAST_RUN_HTTP_MAX_LINES,
  LAST_RUN_TRIM_SLACK_BYTES,
  MAX_LAST_RUN_LOG_BYTES,
  createLogBus,
  defaultLastRunDir,
  formatSseData,
  isSafeStackKey,
  lastRunLogPath,
  tailLogBytes,
  tailLogLines,
} from './logs.ts';

const dirs: string[] = [];

function tempLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rff-last-run-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('logs', () => {
  it('rejects unsafe stack keys for last-run paths', () => {
    expect(isSafeStackKey('graphql')).toBe(true);
    expect(isSafeStackKey('grpc-spring')).toBe(true);
    expect(isSafeStackKey('../etc')).toBe(false);
    expect(isSafeStackKey('foo/bar')).toBe(false);
    expect(isSafeStackKey('foo\\bar')).toBe(false);
    expect(isSafeStackKey('')).toBe(false);
    const dir = tempLogDir();
    expect(lastRunLogPath('../etc', dir)).toBeNull();
    expect(lastRunLogPath('not-a-stack', dir)).toBeNull();
    expect(lastRunLogPath('grpc', dir)).toBe(join(dir, 'last-run-grpc.log'));
    expect(lastRunLogPath('grpc-spring', dir)).toBe(join(dir, 'last-run-grpc-spring.log'));
  });

  it('tails bytes on a newline boundary', () => {
    const bytes = Buffer.from('HELLO\nkeep-me');
    expect(Buffer.from(tailLogBytes(bytes, 10)).toString('utf8')).toBe('keep-me');
    expect(Buffer.from(tailLogBytes(Buffer.from('short'), 100)).toString('utf8')).toBe('short');
    expect(Buffer.from(tailLogBytes(Buffer.from('abcdefghij'), 4)).toString('utf8')).toBe('ghij');
  });

  it('tails the last HTTP line window', () => {
    const lines = Array.from({ length: LAST_RUN_HTTP_MAX_LINES + 3 }, (_, i) => `L${i}`);
    expect(tailLogLines(`${lines.join('\n')}\n`, LAST_RUN_HTTP_MAX_LINES)).toBe(
      lines.slice(3).join('\n'),
    );
    expect(tailLogLines('one\r\ntwo\rthree', 10)).toBe('one\ntwo\nthree');
  });

  it('uses the default last-run directory name', () => {
    expect(defaultLastRunDir()).toContain(LAST_RUN_DIR_NAME);
  });

  it('appends, fans out, and reads last-run text', () => {
    const bus = createLogBus({ logDir: tempLogDir() });
    const seen: string[] = [];
    const unsub = bus.subscribe((event) => {
      seen.push(`${event.stackKey}:${event.line}`);
    });
    bus.emit('graphql', '=== Starting graphql stack ===');
    bus.emit('graphql', 'pulling');
    expect(seen).toEqual([
      'graphql:=== Starting graphql stack ===',
      'graphql:pulling',
    ]);
    expect(bus.read('graphql')).toContain('=== Starting graphql stack ===');
    expect(bus.read('graphql')).toContain('pulling');
    unsub();
    bus.emit('graphql', 'after-unsub');
    expect(seen).toHaveLength(2);
  });

  it('keeps grpc and grpc-spring last-run files separate', () => {
    const bus = createLogBus({ logDir: tempLogDir() });
    bus.emit('grpc', 'base');
    bus.emit('grpc-spring', 'spring');
    expect(bus.read('grpc')).toBe('base\n');
    expect(bus.read('grpc-spring')).toBe('spring\n');
  });

  it('truncate then restore keeps the previous file', () => {
    const bus = createLogBus({ logDir: tempLogDir() });
    bus.emit('graphql', 'old-run');
    const prev = bus.read('graphql');
    expect(prev).toBeTruthy();
    bus.truncate('graphql');
    expect(bus.read('graphql')).toBeNull();
    bus.restore('graphql', prev ?? '');
    expect(bus.read('graphql')).toBe(prev);
  });

  it('trims an oversized last-run file on append', () => {
    const dir = tempLogDir();
    const bus = createLogBus({ logDir: dir });
    const path = lastRunLogPath('graphql', dir);
    expect(path).toBeTruthy();
    writeFileSync(path!, `${'x'.repeat(MAX_LAST_RUN_LOG_BYTES + LAST_RUN_TRIM_SLACK_BYTES + 10)}\nkeep\n`);
    bus.emit('graphql', 'newest');
    const text = bus.read('graphql') ?? '';
    expect(text.length).toBeLessThanOrEqual(MAX_LAST_RUN_LOG_BYTES + 20);
    expect(text).toContain('newest');
  });

  it('does not rewrite the last-run file on every append just over the cap', () => {
    const dir = tempLogDir();
    const bus = createLogBus({ logDir: dir });
    const path = lastRunLogPath('graphql', dir);
    expect(path).toBeTruthy();
    writeFileSync(path!, `${'x'.repeat(MAX_LAST_RUN_LOG_BYTES + 10)}\n`);
    const before = statSync(path!).size;
    bus.emit('graphql', 'one');
    expect(statSync(path!).size).toBe(before + 'one\n'.length);
  });

  it('formats an SSE data frame', () => {
    expect(formatSseData({ stackKey: 'graphql', line: 'hello' })).toBe(
      'data: {"stackKey":"graphql","line":"hello"}\n\n',
    );
  });

  it('ignores unsafe keys and broken subscribers without throwing', () => {
    const bus = createLogBus({ logDir: tempLogDir() });
    bus.subscribe(() => {
      throw new Error('broken');
    });
    expect(() => bus.emit('../etc', 'nope')).not.toThrow();
    expect(() => bus.emit('graphql', 'ok')).not.toThrow();
    expect(bus.read('graphql')).toBe('ok\n');
    expect(bus.read('not-a-stack')).toBeNull();
    bus.truncate('not-a-stack');
    bus.restore('not-a-stack', 'x');
    expect(bus.read('missing')).toBeNull();
  });

  it('returns null for an empty last-run file', () => {
    const dir = tempLogDir();
    const bus = createLogBus({ logDir: dir });
    bus.truncate('graphql');
    expect(bus.read('graphql')).toBeNull();
  });

  it('skips trim when the last-run path disappears after append', () => {
    const dir = tempLogDir();
    const bus = createLogBus({ logDir: dir });
    const path = lastRunLogPath('graphql', dir);
    expect(path).toBeTruthy();
    writeFileSync(path!, `${'x'.repeat(MAX_LAST_RUN_LOG_BYTES + LAST_RUN_TRIM_SLACK_BYTES + 10)}\nkeep\n`);
    rmSync(path!);
    expect(() => bus.emit('graphql', 'newest')).not.toThrow();
  });

  it('returns null when a tailed last-run file has no leftover text', () => {
    const dir = tempLogDir();
    const bus = createLogBus({ logDir: dir });
    const path = lastRunLogPath('graphql', dir);
    expect(path).toBeTruthy();
    writeFileSync(path!, `${'x'.repeat(MAX_LAST_RUN_LOG_BYTES)}\n`);
    expect(bus.read('graphql')).toBeNull();
  });

  it('swallows writes when logDir is a file', () => {
    const dir = tempLogDir();
    const fileAsDir = join(dir, 'not-a-dir');
    writeFileSync(fileAsDir, 'nope');
    const bus = createLogBus({ logDir: fileAsDir });
    expect(() => bus.emit('graphql', 'x')).not.toThrow();
    expect(() => bus.truncate('graphql')).not.toThrow();
    expect(() => bus.restore('graphql', 'x')).not.toThrow();
    expect(bus.read('graphql')).toBeNull();
  });

  it('creates a bus in the default tmp last-run directory', () => {
    expect(createLogBus().logDir).toContain(LAST_RUN_DIR_NAME);
  });
});
