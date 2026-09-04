import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStackKey } from './stackIds.ts';

export const MAX_LAST_RUN_LOG_BYTES = 256 * 1024;
/** Grow this much past the cap before a sync rewrite — avoid rewriting on every compose line. */
export const LAST_RUN_TRIM_SLACK_BYTES = 32 * 1024;
export const LAST_RUN_HTTP_MAX_LINES = 400;
export const SSE_HEARTBEAT_MS = 15_000;
export const LAST_RUN_DIR_NAME = 'redfireforge-local-docker-logs';

export interface DockerLogEvent {
  stackKey: string;
  line: string;
}

export interface LocalDockerLogBus {
  emit: (stackKey: string, line: string) => void;
  subscribe: (onEvent: (event: DockerLogEvent) => void) => () => void;
  truncate: (stackKey: string) => void;
  read: (stackKey: string) => string | null;
  restore: (stackKey: string, text: string) => void;
  logDir: string;
}

export function isSafeStackKey(stackKey: string): boolean {
  return stackKey.length > 0
    && !stackKey.includes('/')
    && !stackKey.includes('\\')
    && !stackKey.includes('..')
    && /^[A-Za-z0-9_-]+$/.test(stackKey);
}

export function defaultLastRunDir(): string {
  return join(tmpdir(), LAST_RUN_DIR_NAME);
}

export function lastRunLogPath(stackKey: string, logDir: string): string | null {
  if (!isSafeStackKey(stackKey) || !parseStackKey(stackKey)) return null;
  return join(logDir, `last-run-${stackKey}.log`);
}

/** Last `max` bytes, advanced to the next newline so the UI does not start mid-line. */
export function tailLogBytes(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes;
  const start = bytes.length - max;
  const slice = bytes.subarray(start);
  const newline = slice.indexOf(0x0a);
  return newline === -1 ? slice : slice.subarray(newline + 1);
}

export function tailLogLines(text: string, maxLines: number): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-maxLines).join('\n');
}

function readFileTail(path: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const text = Buffer.from(tailLogBytes(bytes, MAX_LAST_RUN_LOG_BYTES)).toString('utf8');
  return text.length > 0 ? text : null;
}

function maybeTrimLastRunFile(path: string): void {
  try {
    if (statSync(path).size <= MAX_LAST_RUN_LOG_BYTES + LAST_RUN_TRIM_SLACK_BYTES) return;
  } catch {
    return;
  }
  const text = readFileTail(path);
  if (text == null) return;
  try {
    writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`);
  } catch {
    /* ignore */
  }
}

export function createLogBus(opts?: { logDir?: string }): LocalDockerLogBus {
  const logDir = opts?.logDir ?? defaultLastRunDir();
  const subscribers = new Set<(event: DockerLogEvent) => void>();

  const pathFor = (stackKey: string): string | null => lastRunLogPath(stackKey, logDir);

  const append = (stackKey: string, line: string): void => {
    const path = pathFor(stackKey);
    if (!path) return;
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(path, `${line}\n`);
      maybeTrimLastRunFile(path);
    } catch {
      /* ignore */
    }
  };

  const emit = (stackKey: string, line: string): void => {
    append(stackKey, line);
    const event: DockerLogEvent = { stackKey, line };
    for (const sub of subscribers) {
      try {
        sub(event);
      } catch {
        /* ignore a broken subscriber */
      }
    }
  };

  return {
    logDir,
    emit,
    subscribe(onEvent) {
      subscribers.add(onEvent);
      return () => {
        subscribers.delete(onEvent);
      };
    },
    truncate(stackKey) {
      const path = pathFor(stackKey);
      if (!path) return;
      try {
        mkdirSync(logDir, { recursive: true });
        writeFileSync(path, '');
      } catch {
        /* ignore */
      }
    },
    read(stackKey) {
      const path = pathFor(stackKey);
      if (!path || !existsSync(path)) return null;
      return readFileTail(path);
    },
    restore(stackKey, text) {
      const path = pathFor(stackKey);
      if (!path) return;
      try {
        mkdirSync(logDir, { recursive: true });
        writeFileSync(path, text);
      } catch {
        /* ignore */
      }
    },
  };
}

export function formatSseData(event: DockerLogEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
