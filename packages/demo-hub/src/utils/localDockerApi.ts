import { isTauri } from '@shared/utils/platform';
import { isLocalDemoWebHost } from './lessonPlatform';

export interface LocalCertExpiryStatus {
  expiresAt: string | null;
  daysRemaining: number | null;
}

export const LOCAL_DOCKER_PREFIX = '/__rff-docker';

const PROBE_TIMEOUT_MS = 800;
const PROBE_CACHE_MS = 2000;

interface ProbeCache {
  ok: boolean;
  at: number;
}

let probeCache: ProbeCache | null = null;
let probeInflight: Promise<boolean> | null = null;

export function resetLocalDockerHelperCache(): void {
  probeCache = null;
  probeInflight = null;
}

export function peekLocalDockerHelper(): boolean | null {
  return probeCache ? probeCache.ok : null;
}

/**
 * Sync allow-list for clone-local Vite. Still requires `probeLocalDockerHelper()`.
 * Playwright (`navigator.webdriver`) stays on the clone-command gate.
 */
export function isLocalWebDockerEnabled(): boolean {
  if (isTauri()) return false;
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver === true) return false;
  return isLocalDemoWebHost(window.location.hostname);
}

export async function probeLocalDockerHelper(): Promise<boolean> {
  const now = Date.now();
  // Only a fresh *success* is cached — a failed first paint must not hide Start Stack.
  if (probeCache?.ok && now - probeCache.at < PROBE_CACHE_MS) {
    return true;
  }
  if (probeInflight) return probeInflight;
  probeInflight = runHelperProbe().finally(() => {
    probeInflight = null;
  });
  return probeInflight;
}

async function runHelperProbe(): Promise<boolean> {
  const now = Date.now();
  if (typeof fetch !== 'function') {
    probeCache = { ok: false, at: now };
    return false;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${LOCAL_DOCKER_PREFIX}/health`, { signal: ac.signal });
    if (!res.ok) {
      probeCache = { ok: false, at: now };
      return false;
    }
    const body: unknown = await res.json();
    const ok = Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === true);
    probeCache = { ok, at: now };
    return ok;
  } catch {
    probeCache = { ok: false, at: Date.now() };
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function isLocalDockerHelperUp(): Promise<boolean> {
  return isLocalWebDockerEnabled() && await probeLocalDockerHelper();
}

export async function localDockerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${LOCAL_DOCKER_PREFIX}${path}`, { ...init, headers });
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const fromJson = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : '';
    throw new Error(fromJson || text || res.statusText || `HTTP ${res.status}`);
  }
  return body as T;
}

export interface LocalDockerLogEvent {
  stackKey: string;
  line: string;
}

/**
 * One EventSource for every stack. Caller filters by `stackKey`.
 * Rejects if the socket errors before `onopen` so attachLogs can retry.
 */
export function subscribeLocalDockerLogs(
  onEvent: (event: LocalDockerLogEvent) => void,
  signal?: AbortSignal,
): Promise<() => void> {
  if (typeof EventSource === 'undefined') {
    return Promise.resolve(() => {});
  }
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    let es: EventSource;
    try {
      es = new EventSource(`${LOCAL_DOCKER_PREFIX}/logs`);
    } catch {
      reject(new Error('START_FAILED:Docker helper unavailable'));
      return;
    }
    let opened = false;
    let settled = false;
    const close = () => {
      signal?.removeEventListener('abort', onAbort);
      es.close();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      close();
      reject(err);
    };
    const finishOpen = () => {
      if (settled) return;
      settled = true;
      opened = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(close);
    };
    const onAbort = () => {
      fail(new DOMException('Aborted', 'AbortError'));
    };
    es.onopen = finishOpen;
    es.onmessage = (ev) => {
      if (settled && !opened) return;
      finishOpen();
      try {
        const payload: unknown = JSON.parse(ev.data);
        if (
          payload
          && typeof payload === 'object'
          && typeof (payload as LocalDockerLogEvent).stackKey === 'string'
          && (payload as LocalDockerLogEvent).line != null
        ) {
          onEvent(payload as LocalDockerLogEvent);
        }
      } catch {
        /* ignore a malformed frame */
      }
    };
    es.onerror = () => {
      if (!opened) {
        fail(new Error('START_FAILED:Docker helper unavailable'));
      }
    };
    signal?.addEventListener('abort', onAbort);
  });
}

export async function fetchLocalDockerLastRun(stackKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${LOCAL_DOCKER_PREFIX}/last-run/${encodeURIComponent(stackKey)}`, {
      cache: 'no-store',
    });
    if (res.status === 404 || !res.ok) return null;
    const text = await res.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** UTC calendar days remaining — same rule as Rust `cert_days_remaining`. */
export function certExpiryFromIsoDate(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): LocalCertExpiryStatus | null {
  const expires = expiresAt?.trim();
  if (!expires) {
    return { expiresAt: expiresAt ?? null, daysRemaining: null };
  }
  const match = expires.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date(nowMs);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return {
    expiresAt: expires,
    daysRemaining: Math.round((expiry - todayUtc) / 86_400_000),
  };
}
