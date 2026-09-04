import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/platform', () => ({
  isTauri: () => false,
}));

import {
  formatPortConflictCopy,
  getStackStatus,
  parseLastRunLogText,
  parsePortConflictDetail,
  parsePrefetchError,
  parseStackLimitKeys,
  daemonStateFromStartFailed,
  parseStartError,
  prefetchDockerImages,
  prefetchErrorCopy,
  readLastRunLog,
  removeDockerImages,
  startDockerStack,
  stopAllStacks,
  uninstallCleanup,
} from './dockerStackApi';
import { MAX_DOCKER_STACK_LOG_LINES } from '../stores/dockerStackStore';

describe('parseStartError', () => {
  it('detects port conflicts', () => {
    expect(parseStartError('PORT_CONFLICT:4010, 4443')).toEqual({
      kind: 'port-conflict',
      detail: '4010, 4443',
    });
  });

  it('detects a concurrent stack limit', () => {
    expect(parseStartError('STACK_LIMIT:graphql,kafka-plaintext')).toEqual({
      kind: 'stack-limit',
      detail: 'graphql,kafka-plaintext',
    });
    expect(parseStackLimitKeys('graphql,kafka-plaintext,not-a-stack')).toEqual([
      'graphql',
      'kafka-plaintext',
    ]);
    expect(parseStackLimitKeys('graphql, graphql,kafka-plaintext')).toEqual([
      'graphql',
      'kafka-plaintext',
    ]);
    expect(parseStackLimitKeys('kafka-plaintext,graphql')).toEqual([
      'graphql',
      'kafka-plaintext',
    ]);
  });

  it('detects OOM', () => {
    expect(parseStartError('OOM_KILLED:2048')).toEqual({
      kind: 'oom-killed',
      detail: '2048',
    });
  });

  it('detects an expired cert', () => {
    expect(parseStartError('CERT_EXPIRED:2020-01-01')).toEqual({
      kind: 'cert-expired',
      detail: '2020-01-01',
    });
    expect(parseStartError('command start_docker_stack failed: CERT_EXPIRED:2020-01-01')).toEqual({
      kind: 'cert-expired',
      detail: '2020-01-01',
    });
  });

  it('detects a cancelled start', () => {
    expect(parseStartError('START_CANCELLED')).toEqual({
      kind: 'start-cancelled',
      detail: 'START_CANCELLED',
    });
    expect(parseStartError('command start_docker_stack failed: START_CANCELLED')).toEqual({
      kind: 'start-cancelled',
      detail: 'command start_docker_stack failed: START_CANCELLED',
    });
  });

  it('maps helper daemon START_FAILED copy to A / B / B2', () => {
    expect(daemonStateFromStartFailed('Docker is not installed.')).toBe('notInstalled');
    expect(daemonStateFromStartFailed('Docker Desktop is not running.')).toBe('notRunning');
    expect(daemonStateFromStartFailed('Docker Compose V2 is required.')).toBe('outdatedCompose');
    expect(daemonStateFromStartFailed('compose exploded')).toBeNull();
  });

  it('treats other messages as start-failed', () => {
    expect(parseStartError('START_FAILED:compose exploded')).toEqual({
      kind: 'start-failed',
      detail: 'compose exploded',
    });
    expect(parseStartError('nope')).toEqual({
      kind: 'start-failed',
      detail: 'nope',
    });
  });

  it('finds codes inside a wrapped Tauri invoke message', () => {
    expect(parseStartError('Invoke error: PORT_CONFLICT:4010, 4443')).toEqual({
      kind: 'port-conflict',
      detail: '4010, 4443',
    });
    expect(parseStartError('command start_docker_stack failed: OOM_KILLED:2048')).toEqual({
      kind: 'oom-killed',
      detail: '2048',
    });
    expect(parseStartError('command start_docker_stack failed: STACK_LIMIT:graphql,kafka-plaintext')).toEqual({
      kind: 'stack-limit',
      detail: 'graphql,kafka-plaintext',
    });
  });
});

describe('last-run log helpers', () => {
  it('parseLastRunLogText splits, strips a trailing blank, and caps', () => {
    expect(parseLastRunLogText(null)).toEqual([]);
    expect(parseLastRunLogText('')).toEqual([]);
    expect(parseLastRunLogText('one\ntwo\n')).toEqual(['one', 'two']);
    expect(parseLastRunLogText('one\r\ntwo\rthree')).toEqual(['one', 'two', 'three']);
    const overflow = Array.from({ length: MAX_DOCKER_STACK_LOG_LINES + 3 }, (_, i) => `L${i}`).join('\n');
    const parsed = parseLastRunLogText(overflow);
    expect(parsed).toHaveLength(MAX_DOCKER_STACK_LOG_LINES);
    expect(parsed[0]).toBe('L3');
  });

  it('readLastRunLog is a no-op when not Tauri', async () => {
    await expect(readLastRunLog('graphql')).resolves.toBeNull();
  });
});

describe('bare-web dockerStackApi', () => {
  it('getStackStatus is null when the helper is absent', async () => {
    await expect(getStackStatus('graphql')).resolves.toBeNull();
  });

  it('startDockerStack throws START_FAILED and never invokes Tauri', async () => {
    await expect(startDockerStack('graphql')).rejects.toThrow('START_FAILED:Docker helper unavailable');
  });

  it('stopAllStacks is a no-op when the helper is absent', async () => {
    await expect(stopAllStacks()).resolves.toBe(false);
  });

  it('prefetch / remove / uninstall never invoke Tauri on web', async () => {
    await expect(prefetchDockerImages('graphql')).resolves.toBeUndefined();
    await expect(removeDockerImages('graphql')).resolves.toEqual([]);
    await expect(uninstallCleanup()).resolves.toEqual({ stopped: [], errors: [] });
  });
});

describe('parsePortConflictDetail', () => {
  it('parses JSON occupants and legacy comma lists', () => {
    expect(parsePortConflictDetail('[{"port":4010,"process":"Python","pid":72363}]')).toEqual([
      { port: 4010, process: 'Python', pid: 72363 },
    ]);
    expect(parsePortConflictDetail('[{"port":4010},{"port":"4443","process":"node","pid":"99"}]')).toEqual([
      { port: 4010 },
      { port: 4443, process: 'node', pid: 99 },
    ]);
    expect(parsePortConflictDetail('4010, 4443')).toEqual([{ port: 4010 }, { port: 4443 }]);
    expect(parsePortConflictDetail('')).toEqual([]);
    expect(parsePortConflictDetail('not-json')).toEqual([]);
    expect(parsePortConflictDetail('[not-json')).toEqual([]);
    expect(parsePortConflictDetail('[{"nope":true}]')).toEqual([]);
  });

  it('formats one named process and a multi-port list', () => {
    expect(formatPortConflictCopy([{ port: 4010, process: 'Python', pid: 72363 }])).toEqual({
      lines: ['Port 4010 is in use by Python (PID 72363).'],
      retry: 'Free it and click Retry.',
    });
    expect(formatPortConflictCopy([{ port: 4010, pid: 88 }])).toEqual({
      lines: ['Port 4010 is already in use (PID 88).'],
      retry: 'Free it and click Retry.',
    });
    expect(formatPortConflictCopy([{ port: 4010 }, { port: 4443, process: 'node', pid: 99 }])).toEqual({
      lines: [
        'Port 4010 is already in use.',
        'Port 4443 is in use by node (PID 99).',
      ],
      retry: 'Free them and click Retry.',
    });
  });
});

describe('parsePrefetchError', () => {
  it('maps rust codes to copy', () => {
    expect(parsePrefetchError('DOCKER_NOT_RUNNING').kind).toBe('docker-not-running');
    expect(prefetchErrorCopy('docker-not-running')).toContain('not running');
    expect(parsePrefetchError('command failed: PREFETCH_CANCELLED').kind).toBe('prefetch-cancelled');
    expect(parsePrefetchError('PREFETCH_FAILED:compose pull exploded')).toEqual({
      kind: 'prefetch-failed',
      detail: 'compose pull exploded',
    });
  });
});
