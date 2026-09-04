import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendStackLog,
  clearStackLogs,
  getStackLogs,
  isStackRunning,
  MAX_DOCKER_STACK_LOG_LINES,
  otherRunningStacks,
  replaceStackLogs,
  resetDockerStackStore,
  setStackRunning,
} from './dockerStackStore';

describe('dockerStackStore', () => {
  beforeEach(() => {
    resetDockerStackStore();
  });

  it('tracks running stacks', () => {
    expect(isStackRunning('graphql')).toBe(false);
    setStackRunning('graphql', true);
    expect(isStackRunning('graphql')).toBe(true);
    setStackRunning('kafka-plaintext', true);
    expect(otherRunningStacks('graphql')).toEqual(['kafka-plaintext']);
    setStackRunning('graphql', false);
    expect(isStackRunning('graphql')).toBe(false);
  });

  it('appends and clears logs', () => {
    appendStackLog('graphql', 'line 1');
    appendStackLog('graphql', 'line 2');
    expect(getStackLogs('graphql')).toEqual(['line 1', 'line 2']);
    expect(isStackRunning('graphql')).toBe(false);
    clearStackLogs('graphql');
    expect(getStackLogs('graphql')).toEqual([]);
    appendStackLog('ws-tls', 'tls');
    expect(isStackRunning('ws-tls')).toBe(false);
  });

  it('replaceStackLogs replaces and caps at the live-stream limit', () => {
    appendStackLog('graphql', 'old');
    replaceStackLogs('graphql', ['a', 'b', 'c']);
    expect(getStackLogs('graphql')).toEqual(['a', 'b', 'c']);
    const overflow = Array.from({ length: MAX_DOCKER_STACK_LOG_LINES + 25 }, (_, i) => `L${i}`);
    replaceStackLogs('graphql', overflow);
    const kept = getStackLogs('graphql');
    expect(kept).toHaveLength(MAX_DOCKER_STACK_LOG_LINES);
    expect(kept[0]).toBe('L25');
    expect(kept[kept.length - 1]).toBe(`L${MAX_DOCKER_STACK_LOG_LINES + 24}`);
  });
});
