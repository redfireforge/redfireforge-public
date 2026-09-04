import { isTauri } from '@shared/utils/platform';
import { formatDockerCommandForHost, isWindowsHost } from './dockerCommandDisplay';
import type { DockerStackKey } from '../types';

export const DOCKER_STACK_LABELS: Record<DockerStackKey, string> = {
  graphql: 'GraphQL',
  'graphql-tls': 'GraphQL TLS',
  grpc: 'gRPC',
  'grpc-spring': 'gRPC Spring',
  'kafka-plaintext': 'Kafka',
  'kafka-secure': 'Kafka secure',
  'kafka-tls': 'Kafka TLS',
  'kafka-schema-registry': 'Kafka Schema Registry',
  'ws-socketio': 'WebSocket Socket.IO',
  'ws-graphql': 'WebSocket GraphQL',
  'ws-stomp': 'WebSocket STOMP',
  'ws-tls': 'WebSocket TLS',
  'api-mock': 'API Mock',
};

/** Background-stack hint on the lesson gate (State C). */
export function formatOtherRunningStacks(keys: readonly DockerStackKey[]): string {
  const names = keys.map((key) => DOCKER_STACK_LABELS[key]).join(', ');
  const verb = keys.length === 1 ? 'is' : 'are';
  return `${names} ${verb} running in the background. You can run another stack if needed.`;
}

/** Stacks that share a compose project / images and must stop together before `--rmi`. */
export function dockerStackSiblings(key: DockerStackKey): DockerStackKey[] {
  if (key === 'grpc' || key === 'grpc-spring') return ['grpc', 'grpc-spring'];
  return [key];
}

/** True while Settings is stopping this stack, a sibling, Stop all, or removing images. */
export function dockerStackStopBusy(key: DockerStackKey, busyKey: string | null): boolean {
  if (!busyKey) return false;
  if (busyKey === 'all' || busyKey.startsWith('rmi-')) return true;
  return dockerStackSiblings(key).includes(busyKey as DockerStackKey);
}

/** Stop / `compose down` tears down the whole project — clear every sibling in the store. */
export function markDockerStackStopped(
  key: DockerStackKey,
  setRunning: (stackKey: DockerStackKey, running: boolean) => void,
) {
  for (const sibling of dockerStackSiblings(key)) {
    setRunning(sibling, false);
  }
}

export function dockerStackBlockedByRunning(
  key: DockerStackKey,
  running: ReadonlySet<DockerStackKey>,
): DockerStackKey | undefined {
  return dockerStackSiblings(key).find((k) => running.has(k));
}

export const MAX_CONCURRENT_DOCKER_STACKS = 2;

export function dockerStackSlotKey(key: DockerStackKey): string {
  return key === 'grpc' || key === 'grpc-spring' ? 'grpc-family' : key;
}

export function composeProjectName(stackKey: DockerStackKey): string {
  return `rff-${dockerStackSlotKey(stackKey)}`;
}

/** Keep copied gate commands on the same Compose project the desktop app uses. */
export function injectComposeProjectFlag(command: string, stackKey: DockerStackKey): string {
  const project = composeProjectName(stackKey);
  if (new RegExp(`(?:-p|--project-name)\\s+${project}\\b`).test(command)) {
    return command;
  }
  return command.replace(/docker compose\b/g, `docker compose -p ${project}`);
}

export function occupiedDockerSlots(running: Iterable<DockerStackKey>): string[] {
  const slots: string[] = [];
  for (const key of running) {
    const slot = dockerStackSlotKey(key);
    if (!slots.includes(slot)) slots.push(slot);
  }
  return slots;
}

export const DOCKER_STACK_KEYS: DockerStackKey[] = [
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

/**
 * Infer a stack key from a lesson `dockerCommand` so Phase 2 can resolve the
 * extracted path without editing 38 lesson files.
 */
/** Lesson-level `docker compose ... --build` (graphql-batch-execution). */
export function lessonWantsComposeBuild(dockerCommand?: string): boolean {
  return /(?:^|[\s&])--build(?:\s|$)/.test(dockerCommand ?? '');
}

export function inferDockerStackKey(dockerCommand?: string): DockerStackKey | undefined {
  if (!dockerCommand) return undefined;
  const c = dockerCommand;
  if (c.includes('docker/graphql/tls')) return 'graphql-tls';
  if (c.includes('docker/graphql')) return 'graphql';
  if (c.includes('--profile spring') || c.includes('profile spring')) return 'grpc-spring';
  if (c.includes('docker/grpc')) return 'grpc';
  if (c.includes('docker/kafka/tls')) return 'kafka-tls';
  if (c.includes('docker/kafka/secure')) return 'kafka-secure';
  if (c.includes('docker/kafka/schema-registry')) return 'kafka-schema-registry';
  if (c.includes('docker/kafka/plaintext') || c.includes('docker/kafka')) return 'kafka-plaintext';
  if (c.includes('websocket/socketio') || c.includes('socketio')) return 'ws-socketio';
  if (c.includes('websocket/graphql')) return 'ws-graphql';
  if (c.includes('websocket/stomp') || (c.includes('stomp') && c.includes('docker'))) return 'ws-stomp';
  if (
    c.includes('docker-compose.tls.yml')
    || c.includes('docker-compose.mtls.yml')
    || c.includes('docker/websocket')
  ) {
    return 'ws-tls';
  }
  if (c.includes('docker/api-mock')) return 'api-mock';
  return undefined;
}

/**
 * Hide the login name in copy/paste commands. Absolute extract paths still
 * resolve correctly via `$HOME` / `%USERPROFILE%` when the user runs them.
 */
export function abbreviateUserHomePath(path: string, windows = isWindowsHost()): string {
  const unquoted = path.length >= 2 && path.startsWith('"') && path.endsWith('"')
    ? path.slice(1, -1)
    : path;
  if (windows) {
    const native = unquoted.replace(/\//g, '\\');
    const m = /^[A-Za-z]:\\Users\\[^\\]+(\\.*)$/i.exec(native);
    if (m) return `%USERPROFILE%${m[1]}`;
    return native;
  }
  // /home/<user>/… (Linux) or /Users/<user>/… (macOS)
  const m = /^\/(?:home|Users)\/[^/]+(\/.*)$/.exec(unquoted);
  if (m) return `$HOME${m[1]}`;
  return unquoted;
}

export function quoteShellPath(path: string, windows = isWindowsHost()): string {
  const unquoted = path.length >= 2 && path.startsWith('"') && path.endsWith('"')
    ? path.slice(1, -1)
    : path;
  if (windows) {
    // cmd / PowerShell: native backslashes; double embedded quotes.
    // Trailing `\` before the closing quote ends the string early in cmd.exe.
    const native = unquoted.replace(/\//g, '\\').replace(/\\+$/, '');
    return `"${native.replace(/"/g, '""')}"`;
  }
  return `"${unquoted.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** cmd.exe `cd` stays on the current drive unless we switch first. PowerShell accepts `C:`. */
export function windowsChangeDirectory(quotedDir: string): string {
  const inner = quotedDir.startsWith('"') && quotedDir.endsWith('"')
    ? quotedDir.slice(1, -1)
    : quotedDir;
  const drive = /^([A-Za-z]):/.exec(inner);
  if (drive) {
    return `${drive[1]}:\ncd ${quotedDir}`;
  }
  return `cd ${quotedDir}`;
}

function dropWindowsHashComments(cmd: string): string {
  return cmd
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function joinCdAndRest(quotedDir: string, rest: string, windows: boolean): string {
  const trimmed = rest.replace(/^&&\s*/, '').trim();
  if (windows) return `${windowsChangeDirectory(quotedDir)}\n${trimmed}`;
  return `cd ${quotedDir} && ${trimmed}`;
}

/**
 * Rewrite a lesson compose command so `cd` / `-f docker/...` points at the
 * extracted stack directory (the compose working directory).
 * On Windows the display is two lines (`cd` then `docker compose`) so it
 * pastes into both cmd.exe and Windows PowerShell 5 (no `&&`).
 */
export function rewriteDockerCommandPath(
  dockerCommand: string,
  extractedDir: string,
  windows = isWindowsHost(),
): string {
  const quoted = quoteShellPath(abbreviateUserHomePath(extractedDir, windows), windows);
  const finish = (cmd: string) => {
    const formatted = formatDockerCommandForHost(cmd, windows);
    return windows ? dropWindowsHashComments(formatted) : formatted;
  };
  const withCd = dockerCommand.replace(/cd\s+docker\/[^\s&|;]+/, `cd ${quoted}`);
  if (withCd !== dockerCommand) {
    const rewritten = windows
      ? withCd.replace(/^cd ("[^"]+"|\S+)\s*&&\s*/m, (_all, dir: string) => `${windowsChangeDirectory(dir)}\n`)
      : withCd;
    return finish(rewritten);
  }

  if (/-f\s+docker\//.test(dockerCommand)) {
    // Keep the compose file name (`docker-compose.tls.yml`, not only the
    // default `docker-compose.yml`) after `cd` into the extracted dir.
    const withLocalFiles = dockerCommand
      .replace(/-f\s+docker\/(\S+)/g, (_all, rel: string) => {
        const base = rel.split('/').filter(Boolean).pop() ?? rel;
        return `-f ${base}`;
      })
      .replace(/\s+/g, ' ')
      .trim();
    return finish(joinCdAndRest(quoted, withLocalFiles, windows));
  }

  return finish(joinCdAndRest(quoted, dockerCommand, windows));
}

/** Resolve the extracted stack dir from Tauri. Web / failure → null. */
export async function resolveExtractedDockerStackPath(
  stackKey: DockerStackKey,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('get_docker_stack_path', {
      stackKey,
      stack_key: stackKey,
    });
    return path?.trim() ? path : null;
  } catch {
    return null;
  }
}
