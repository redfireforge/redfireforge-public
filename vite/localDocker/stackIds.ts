import type { LocalDockerStackKey } from './types.ts';

export const MAX_CONCURRENT_DOCKER_STACKS = 2;

/** Roster order used for STACK_LIMIT payloads (matches demo-hub / Settings). */
export const DOCKER_STACK_KEYS: readonly LocalDockerStackKey[] = [
  'graphql',
  'graphql-tls',
  'grpc',
  'grpc-spring',
  'kafka-plaintext',
  'kafka-secure',
  'kafka-tls',
  'kafka-schema-registry',
  'ws-socketio',
  'ws-graphql',
  'ws-stomp',
  'ws-tls',
  'api-mock',
];

const REL_DIR: Record<LocalDockerStackKey, string> = {
  graphql: 'graphql',
  'graphql-tls': 'graphql/tls',
  grpc: 'grpc',
  'grpc-spring': 'grpc',
  'kafka-plaintext': 'kafka/plaintext',
  'kafka-secure': 'kafka/secure',
  'kafka-tls': 'kafka/tls',
  'kafka-schema-registry': 'kafka/schema-registry',
  'ws-socketio': 'websocket/socketio',
  'ws-graphql': 'websocket/graphql',
  'ws-stomp': 'websocket/stomp',
  'ws-tls': 'websocket',
  'api-mock': 'api-mock',
};

export function isDockerStackKey(value: string): value is LocalDockerStackKey {
  return (DOCKER_STACK_KEYS as readonly string[]).includes(value);
}

export function parseStackKey(value: string): LocalDockerStackKey | null {
  return isDockerStackKey(value) ? value : null;
}

export function stackKeyToRelDir(key: LocalDockerStackKey): string {
  return REL_DIR[key];
}

export function dockerStackSlotKey(key: string): string {
  return key === 'grpc' || key === 'grpc-spring' ? 'grpc-family' : key;
}

export function composeProjectName(stackKey: string): string {
  return `rff-${dockerStackSlotKey(stackKey)}`;
}

export function dockerStackSiblings(key: LocalDockerStackKey): LocalDockerStackKey[] {
  if (key === 'grpc' || key === 'grpc-spring') return ['grpc', 'grpc-spring'];
  return [key];
}

export function keysSharingStartSlot(stackKey: string): LocalDockerStackKey[] {
  const slot = dockerStackSlotKey(stackKey);
  return DOCKER_STACK_KEYS.filter((key) => dockerStackSlotKey(key) === slot);
}

/** `None` = start allowed. `STACK_LIMIT:key1,key2` = refuse. */
export function stackLimitError(starting: string, runningKeys: readonly string[]): string | null {
  if (runningKeys.includes(starting)) return null;
  const slots: string[] = [];
  for (const key of runningKeys) {
    const slot = dockerStackSlotKey(key);
    if (!slots.includes(slot)) slots.push(slot);
  }
  if (slots.length >= MAX_CONCURRENT_DOCKER_STACKS && !slots.includes(dockerStackSlotKey(starting))) {
    const present = new Set(runningKeys);
    const payload: string[] = [];
    for (const key of DOCKER_STACK_KEYS) {
      if (present.delete(key)) payload.push(key);
    }
    payload.push(...[...present].sort());
    return `STACK_LIMIT:${payload.join(',')}`;
  }
  return null;
}

/** Keep reserved (still pulling) keys in roster order so F3 buttons stay stable. */
export function mergeReservedStarts(
  running: readonly string[],
  reservedKeys: readonly string[],
): string[] {
  const present = new Set([...running, ...reservedKeys]);
  const ordered: string[] = [];
  for (const key of DOCKER_STACK_KEYS) {
    if (present.delete(key)) ordered.push(key);
  }
  const unknown = [...present].sort();
  return [...ordered, ...unknown];
}

export function isRffComposeProject(name: string): boolean {
  return name.startsWith('rff-') && name.length > 4;
}

export function rffComposeProjectNames(lsOutput: string): string[] {
  return lsOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isRffComposeProject);
}
