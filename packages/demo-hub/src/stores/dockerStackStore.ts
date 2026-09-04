import { useSyncExternalStore } from 'react';
import type { DockerStackKey } from '../types';

export const MAX_DOCKER_STACK_LOG_LINES = 400;

interface DockerStacksSnapshot {
  running: ReadonlySet<DockerStackKey>;
  stackLogs: Partial<Record<DockerStackKey, string[]>>;
}

let snapshot: DockerStacksSnapshot = {
  running: new Set(),
  stackLogs: {},
};

const listeners = new Set<() => void>();

function emit() {
  snapshot = { running: snapshot.running, stackLogs: snapshot.stackLogs };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

export function setStackRunning(key: DockerStackKey, isRunning: boolean) {
  const next = new Set(snapshot.running);
  if (isRunning) next.add(key);
  else next.delete(key);
  snapshot = { ...snapshot, running: next };
  emit();
}

export function appendStackLog(key: DockerStackKey, line: string) {
  const prev = snapshot.stackLogs[key] ?? [];
  const nextLines = [...prev, line].slice(-MAX_DOCKER_STACK_LOG_LINES);
  snapshot = {
    ...snapshot,
    stackLogs: { ...snapshot.stackLogs, [key]: nextLines },
  };
  emit();
}

export function clearStackLogs(key: DockerStackKey) {
  snapshot = { ...snapshot, stackLogs: { ...snapshot.stackLogs, [key]: [] } };
  emit();
}

export function replaceStackLogs(key: DockerStackKey, lines: string[]) {
  snapshot = {
    ...snapshot,
    stackLogs: { ...snapshot.stackLogs, [key]: lines.slice(-MAX_DOCKER_STACK_LOG_LINES) },
  };
  emit();
}

export function getStackLogs(key: DockerStackKey): string[] {
  return snapshot.stackLogs[key] ?? [];
}

export function isStackRunning(key: DockerStackKey): boolean {
  return snapshot.running.has(key);
}

export function otherRunningStacks(except: DockerStackKey): DockerStackKey[] {
  return [...snapshot.running].filter((k) => k !== except);
}

/** Reset between unit tests. */
export function resetDockerStackStore() {
  snapshot = { running: new Set(), stackLogs: {} };
  emit();
}

export function useDockerStacks() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    running: state.running,
    stackLogs: state.stackLogs,
    setRunning: setStackRunning,
    isRunning: isStackRunning,
    appendLog: appendStackLog,
    clearLogs: clearStackLogs,
    replaceLogs: replaceStackLogs,
    otherRunning: otherRunningStacks,
  };
}
