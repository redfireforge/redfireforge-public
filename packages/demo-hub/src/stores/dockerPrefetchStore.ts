import { useSyncExternalStore } from 'react';

export const MAX_DOCKER_PREFETCH_LOG_LINES = 200;

export type PrefetchChoice = 'declined' | 'accepted' | 'done';

export interface DockerPrefetchSnapshot {
  choice: PrefetchChoice | null;
  running: boolean;
  lines: string[];
  error: string | null;
  hydrated: boolean;
}

let snapshot: DockerPrefetchSnapshot = {
  choice: null,
  running: false,
  lines: [],
  error: null,
  hydrated: false,
};

const listeners = new Set<() => void>();

function emit() {
  snapshot = { ...snapshot };
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

export function setPrefetchHydrated(hydrated: boolean) {
  snapshot = { ...snapshot, hydrated };
  emit();
}

export function setPrefetchChoiceState(choice: PrefetchChoice | null) {
  snapshot = { ...snapshot, choice };
  emit();
}

export function setPrefetchRunning(running: boolean) {
  snapshot = { ...snapshot, running };
  emit();
}

export function setPrefetchError(error: string | null) {
  snapshot = { ...snapshot, error };
  emit();
}

export function clearPrefetchLines() {
  snapshot = { ...snapshot, lines: [] };
  emit();
}

export function appendPrefetchLine(line: string) {
  const next = [...snapshot.lines, line].slice(-MAX_DOCKER_PREFETCH_LOG_LINES);
  snapshot = { ...snapshot, lines: next };
  emit();
}

/** Reset between unit tests. */
export function resetDockerPrefetchStore() {
  snapshot = { choice: null, running: false, lines: [], error: null, hydrated: false };
  emit();
}

export function useDockerPrefetchStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
