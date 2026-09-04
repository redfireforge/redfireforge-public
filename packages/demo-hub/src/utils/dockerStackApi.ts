import { isTauri } from '@shared/utils/platform';
import type { DockerStackKey } from '../types';
import { MAX_DOCKER_STACK_LOG_LINES } from '../stores/dockerStackStore';
import type { PrefetchChoice } from '../stores/dockerPrefetchStore';
import { DOCKER_DESKTOP_INSTALL_URL } from './dockerCommandDisplay';
import { DOCKER_STACK_KEYS } from './dockerStack';
import {
  certExpiryFromIsoDate,
  fetchLocalDockerLastRun,
  isLocalWebDockerEnabled,
  localDockerFetch,
  subscribeLocalDockerLogs,
} from './localDockerApi';

function helperUnavailable(): Error {
  return new Error('START_FAILED:Docker helper unavailable');
}

function isHelperMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // TypeError from fetch (Chrome / Safari / undici) — do not match compose stderr.
  if (err instanceof TypeError) {
    return /fetch|load failed|network/i.test(message);
  }
  return /failed to fetch/i.test(message)
    || /networkerror/i.test(message)
    || /^(not found|http 404)\b/i.test(message);
}

export type DockerDaemonState = 'notInstalled' | 'notRunning' | 'outdatedCompose' | 'running';

export interface StackManifestDto {
  stackKey?: string;
  sinceVersion?: string;
  composeFiles?: string[];
  buildOnStart?: boolean;
  composeProfile?: string | null;
  requiresCompanionProbe?: boolean;
  ports?: number[];
  minMemoryMb?: number | null;
  certExpiresAt?: string | null;
}

export interface CertExpiryStatus {
  expiresAt: string | null;
  daysRemaining: number | null;
}

export interface StaleStackInfo {
  stackKey: string;
  startedWith: string;
  sinceVersion: string;
}

export interface DockerLogEvent {
  stackKey: string;
  line: string;
}

export interface LowMemoryWarning {
  stackKey?: string;
  availableMb: number;
  recommendedMb: number;
}

const args = (stackKey: DockerStackKey) => ({ stackKey, stack_key: stackKey });

async function invokeCmd<T>(cmd: string, payload?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, payload);
}

export async function checkDockerState(): Promise<DockerDaemonState | null> {
  if (isTauri()) {
    try {
      return await invokeCmd<DockerDaemonState>('check_docker_state');
    } catch {
      return null;
    }
  }
  if (isLocalWebDockerEnabled()) {
    try {
      // /state?running=0 is docker info only. Default /state also lists every stack.
      const body = await localDockerFetch<{ docker?: DockerDaemonState | null }>(
        '/state?running=0',
      );
      return body?.docker ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function openDockerDesktop(): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCmd('open_docker_desktop');
    } catch {
      /* ignore */
    }
    return;
  }
  // POST first — a timed-out /health must not skip a working open-desktop.
  if (isLocalWebDockerEnabled()) {
    try {
      await localDockerFetch('/open-desktop', { method: 'POST' });
      return;
    } catch {
      /* 501 / network — fall through to the docs URL */
    }
  }
  if (typeof window !== 'undefined') {
    window.open(DOCKER_DESKTOP_INSTALL_URL, '_blank', 'noopener,noreferrer');
  }
}

/**
 * `true` / `false` when Compose reported status. `null` when the probe failed
 * (Docker down, incomplete extract) — callers must not treat that as stopped.
 */
export async function getStackStatus(stackKey: DockerStackKey): Promise<boolean | null> {
  if (isTauri()) {
    try {
      return await invokeCmd<boolean>('get_stack_status', args(stackKey));
    } catch {
      return null;
    }
  }
  if (isLocalWebDockerEnabled()) {
    try {
      const body = await localDockerFetch<{ running?: boolean | null }>(
        `/status/${encodeURIComponent(stackKey)}`,
      );
      return body?.running ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function getStackManifest(stackKey: DockerStackKey): Promise<StackManifestDto | null> {
  if (isTauri()) {
    try {
      return await invokeCmd<StackManifestDto>('get_stack_manifest', args(stackKey));
    } catch {
      return null;
    }
  }
  if (isLocalWebDockerEnabled()) {
    try {
      return await localDockerFetch<StackManifestDto>(`/manifest/${encodeURIComponent(stackKey)}`);
    } catch {
      return null;
    }
  }
  return null;
}

export async function startDockerStack(
  stackKey: DockerStackKey,
  opts?: { build?: boolean },
): Promise<void> {
  if (isTauri()) {
    await invokeCmd('start_docker_stack', {
      ...args(stackKey),
      build: opts?.build === true ? true : null,
    });
    return;
  }
  if (isLocalWebDockerEnabled()) {
    try {
      const body: { stackKey: DockerStackKey; build?: boolean } = { stackKey };
      if (opts?.build === true) body.build = true;
      await localDockerFetch('/start', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return;
    } catch (err) {
      if (isHelperMissingError(err)) throw helperUnavailable();
      throw err;
    }
  }
  throw helperUnavailable();
}

export async function stopDockerStack(stackKey: DockerStackKey): Promise<void> {
  if (isTauri()) {
    await invokeCmd('stop_docker_stack', args(stackKey));
    return;
  }
  if (isLocalWebDockerEnabled()) {
    try {
      await localDockerFetch('/stop', {
        method: 'POST',
        body: JSON.stringify({ stackKey }),
      });
      return;
    } catch (err) {
      if (isHelperMissingError(err)) throw helperUnavailable();
      throw err;
    }
  }
  throw helperUnavailable();
}

export async function checkCertExpiry(stackKey: DockerStackKey): Promise<CertExpiryStatus | null> {
  if (isTauri()) {
    try {
      return await invokeCmd<CertExpiryStatus>('check_cert_expiry', args(stackKey));
    } catch {
      return null;
    }
  }
  if (isLocalWebDockerEnabled()) {
    try {
      const manifest = await getStackManifest(stackKey);
      if (!manifest) return null;
      return certExpiryFromIsoDate(manifest.certExpiresAt);
    } catch {
      return null;
    }
  }
  return null;
}

export async function getDockerAvailableMemoryMb(): Promise<number | null> {
  if (isTauri()) {
    try {
      return await invokeCmd<number | null>('get_docker_available_memory_mb');
    } catch {
      return null;
    }
  }
  if (isLocalWebDockerEnabled()) {
    try {
      const body = await localDockerFetch<{ availableMb?: number | null }>('/memory');
      return typeof body?.availableMb === 'number' && Number.isFinite(body.availableMb)
        ? body.availableMb
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function checkStaleStacks(): Promise<StaleStackInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invokeCmd<StaleStackInfo[]>('check_stale_stacks');
  } catch {
    return [];
  }
}

export async function triggerAppUpdateCheck(): Promise<void> {
  if (!isTauri()) {
    window.open('https://github.com/redfireforge/redfireforge-public/releases', '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    await invokeCmd('trigger_app_update_check');
  } catch {
    window.open('https://github.com/redfireforge/redfireforge-public/releases', '_blank', 'noopener,noreferrer');
  }
}

export async function listenDockerLogs(
  onEvent: (event: DockerLogEvent) => void,
  signal?: AbortSignal,
): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import('@tauri-apps/api/event');
    const un = await listen<DockerLogEvent>('docker-log', (e) => {
      if (e.payload?.stackKey && e.payload.line != null) onEvent(e.payload);
    });
    return un;
  }
  // EventSource, not /health: a busy daemon can time out the probe and leave
  // Show logs silent for the rest of the lesson (attach does not re-run).
  if (isLocalWebDockerEnabled()) {
    return subscribeLocalDockerLogs(onEvent, signal);
  }
  return () => {};
}

/** `true` when a stop-all command actually ran. `false` when the web helper is down (do not clear the store). */
export async function stopAllStacks(): Promise<boolean> {
  if (isTauri()) {
    await invokeCmd('stop_all_stacks');
    return true;
  }
  if (isLocalWebDockerEnabled()) {
    try {
      await localDockerFetch('/stop-all', { method: 'POST' });
      return true;
    } catch (err) {
      if (isHelperMissingError(err)) return false;
      throw err;
    }
  }
  return false;
}

export interface StackDiskUsage {
  stackKey: string;
  imageBytes?: number | null;
  sizeLabel?: string | null;
}

export async function getDockerImageSizes(): Promise<StackDiskUsage[]> {
  if (!isTauri()) return [];
  return invokeCmd<StackDiskUsage[]>('get_docker_image_sizes');
}

export async function removeDockerImages(stackKey?: DockerStackKey | null): Promise<string[]> {
  if (!isTauri()) return [];
  return invokeCmd<string[]>('remove_docker_images', {
    stackKey: stackKey ?? null,
    stack_key: stackKey ?? null,
  });
}

export interface UninstallReport {
  stopped: string[];
  errors: string[];
}

export async function uninstallCleanup(): Promise<UninstallReport> {
  if (!isTauri()) return { stopped: [], errors: [] };
  return invokeCmd<UninstallReport>('uninstall_cleanup');
}

export async function getStopOnClose(): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invokeCmd<boolean>('get_stop_on_close');
  } catch {
    return true;
  }
}

export async function setStopOnClose(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invokeCmd('set_stop_on_close', { enabled });
}

export async function readLastRunLog(stackKey: DockerStackKey): Promise<string | null> {
  if (isTauri()) {
    try {
      const content = await invokeCmd<string | null>('read_last_run_log', args(stackKey));
      return content && content.length > 0 ? content : null;
    } catch {
      return null;
    }
  }
  if (isLocalWebDockerEnabled()) {
    return fetchLocalDockerLastRun(stackKey);
  }
  return null;
}

export function parseLastRunLogText(content: string | null | undefined): string[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-MAX_DOCKER_STACK_LOG_LINES);
}

export async function listenDockerLowMemory(
  onEvent: (event: LowMemoryWarning) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const un = await listen<LowMemoryWarning>('docker-low-memory', (e) => {
    if (e.payload) onEvent(e.payload);
  });
  return un;
}

export type PortConflictEntry = {
  port: number;
  process?: string;
  pid?: number;
};

function coercePortConflictEntry(raw: unknown): PortConflictEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const port = Number(rec.port);
  if (!Number.isFinite(port) || port <= 0) return null;
  const process = typeof rec.process === 'string' && rec.process.trim()
    ? rec.process.trim()
    : undefined;
  const pid = Number(rec.pid);
  return {
    port,
    process,
    pid: Number.isFinite(pid) && pid > 0 ? pid : undefined,
  };
}

export function parsePortConflictDetail(detail: string): PortConflictEntry[] {
  const trimmed = detail.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const entries = parsed
          .map(coercePortConflictEntry)
          .filter((e): e is PortConflictEntry => e != null);
        if (entries.length > 0) return entries;
      }
    } catch {
      /* fall through to comma list */
    }
  }
  return trimmed
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ port: Number(p) }))
    .filter((e) => Number.isFinite(e.port) && e.port > 0);
}

export function formatPortConflictLine(entry: PortConflictEntry): string {
  if (entry.process && entry.pid) {
    return `Port ${entry.port} is in use by ${entry.process} (PID ${entry.pid}).`;
  }
  if (entry.process) {
    return `Port ${entry.port} is in use by ${entry.process}.`;
  }
  if (entry.pid) {
    return `Port ${entry.port} is already in use (PID ${entry.pid}).`;
  }
  return `Port ${entry.port} is already in use.`;
}

export function formatPortConflictCopy(entries: PortConflictEntry[]): { lines: string[]; retry: string } {
  const retry = entries.length > 1 ? 'Free them and click Retry.' : 'Free it and click Retry.';
  return {
    lines: entries.map(formatPortConflictLine),
    retry,
  };
}

function afterPrefix(message: string, prefix: string): string | null {
  const idx = message.indexOf(prefix);
  if (idx < 0) return null;
  return message.slice(idx + prefix.length);
}

export type StartErrorKind =
  | 'port-conflict'
  | 'oom-killed'
  | 'stack-limit'
  | 'cert-expired'
  | 'start-cancelled'
  | 'start-failed';

/** Tauri may wrap the Rust `Err(String)` as-is or inside a longer invoke message. */
export function parseStartError(message: string): { kind: StartErrorKind; detail: string } {
  const limit = afterPrefix(message, 'STACK_LIMIT:');
  if (limit != null) {
    return { kind: 'stack-limit', detail: limit };
  }
  const port = afterPrefix(message, 'PORT_CONFLICT:');
  if (port != null) {
    return { kind: 'port-conflict', detail: port };
  }
  const oom = afterPrefix(message, 'OOM_KILLED:');
  if (oom != null) {
    return { kind: 'oom-killed', detail: oom };
  }
  const cert = afterPrefix(message, 'CERT_EXPIRED:');
  if (cert != null) {
    return { kind: 'cert-expired', detail: cert };
  }
  if (message.includes('START_CANCELLED')) {
    return { kind: 'start-cancelled', detail: message };
  }
  const failed = afterPrefix(message, 'START_FAILED:');
  if (failed != null) {
    return { kind: 'start-failed', detail: failed };
  }
  return { kind: 'start-failed', detail: message };
}

/** Map helper/Rust `START_FAILED:` daemon copy to A / B / B2. */
export function daemonStateFromStartFailed(detail: string): DockerDaemonState | null {
  if (/Docker is not installed/i.test(detail)) return 'notInstalled';
  if (/Docker Compose V2 is required/i.test(detail)) return 'outdatedCompose';
  if (/Docker Desktop is not running/i.test(detail)) return 'notRunning';
  return null;
}

export function parseStackLimitKeys(detail: string): DockerStackKey[] {
  const seen = new Set<string>();
  for (const raw of detail.split(',')) {
    const key = raw.trim();
    if (key) seen.add(key);
  }
  return DOCKER_STACK_KEYS.filter((key) => seen.has(key));
}

export type PrefetchErrorKind =
  | 'docker-not-running'
  | 'docker-not-installed'
  | 'docker-outdated-compose'
  | 'prefetch-cancelled'
  | 'prefetch-in-progress'
  | 'prefetch-failed';

export function parsePrefetchError(message: string): { kind: PrefetchErrorKind; detail: string } {
  if (message.includes('DOCKER_NOT_RUNNING')) {
    return { kind: 'docker-not-running', detail: message };
  }
  if (message.includes('DOCKER_NOT_INSTALLED')) {
    return { kind: 'docker-not-installed', detail: message };
  }
  if (message.includes('DOCKER_OUTDATED_COMPOSE')) {
    return { kind: 'docker-outdated-compose', detail: message };
  }
  if (message.includes('PREFETCH_CANCELLED')) {
    return { kind: 'prefetch-cancelled', detail: message };
  }
  if (message.includes('PREFETCH_IN_PROGRESS')) {
    return { kind: 'prefetch-in-progress', detail: message };
  }
  const failed = afterPrefix(message, 'PREFETCH_FAILED:');
  return { kind: 'prefetch-failed', detail: failed ?? message };
}

export function prefetchErrorCopy(kind: PrefetchErrorKind): string {
  switch (kind) {
    case 'docker-not-running':
      return 'Docker Desktop is not running. Open it, then try again.';
    case 'docker-not-installed':
      return 'Docker Desktop is not installed.';
    case 'docker-outdated-compose':
      return 'Your Docker Compose is outdated. Update Docker Desktop to continue.';
    case 'prefetch-cancelled':
      return 'Image download was cancelled.';
    case 'prefetch-in-progress':
      return 'An image download is already running.';
    case 'prefetch-failed':
      return 'Image download failed. You can retry from Settings → Docker.';
  }
}

export async function getPrefetchChoice(): Promise<PrefetchChoice | null> {
  if (!isTauri()) return null;
  try {
    const value = await invokeCmd<PrefetchChoice | null>('get_prefetch_choice');
    return value ?? null;
  } catch {
    return null;
  }
}

export async function setPrefetchChoice(choice: PrefetchChoice): Promise<void> {
  if (!isTauri()) return;
  await invokeCmd('set_prefetch_choice', { choice });
}

export async function prefetchDockerImages(stackKey?: DockerStackKey): Promise<void> {
  if (!isTauri()) return;
  await invokeCmd('prefetch_docker_images', stackKey
    ? { stackKey, stack_key: stackKey }
    : { stackKey: null, stack_key: null });
}

export async function cancelPrefetch(): Promise<void> {
  if (!isTauri()) return;
  await invokeCmd('cancel_prefetch');
}

export async function isPrefetchRunning(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invokeCmd<boolean>('is_prefetch_running');
  } catch {
    return false;
  }
}

export async function listenDockerPull(
  onEvent: (event: DockerLogEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const un = await listen<DockerLogEvent>('docker-pull', (e) => {
    if (e.payload?.line != null) onEvent(e.payload);
  });
  return un;
}
