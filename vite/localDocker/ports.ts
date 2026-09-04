import { createConnection } from 'node:net';

const CONNECT_TIMEOUT_MS = 200;
const COMPANION_PORT = 3001;
/** Companion / proxy probe host — never `localhost` (HTTP_PROXY) and never `::1`. */
export const COMPANION_HOST = '127.0.0.1';
const COMPANION_RETRY_MS = 150;
const COMPANION_BUDGET_MS = 5_000;

export function classifyPortProbeError(code: string | undefined): 'open' | 'free' {
  if (code === 'ECONNREFUSED' || code === 'EADDRNOTAVAIL' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') {
    return 'free';
  }
  return 'free';
}

function connectOnce(host: string, port: number, timeoutMs: number): Promise<'open' | 'free'> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const done = (result: 'open' | 'free') => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => done('free'), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      done('open');
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done(classifyPortProbeError(err.code));
    });
  });
}

export async function isPortOccupied(port: number): Promise<boolean> {
  const v4 = await connectOnce('127.0.0.1', port, CONNECT_TIMEOUT_MS);
  if (v4 === 'open') return true;
  const v6 = await connectOnce('::1', port, CONNECT_TIMEOUT_MS);
  return v6 === 'open';
}

export async function findOccupiedPorts(
  ports: readonly number[],
  probe: (port: number) => Promise<boolean> = isPortOccupied,
): Promise<number[]> {
  const occupied: number[] = [];
  for (const port of ports) {
    if (await probe(port)) occupied.push(port);
  }
  return occupied;
}

export { formatPortConflictError } from './portOccupants.ts';

/** Companion / proxy probe: IPv4 loopback only (never HTTP, never `localhost` through a proxy). */
export async function isLoopbackIpv4Occupied(port: number): Promise<boolean> {
  return (await connectOnce(COMPANION_HOST, port, CONNECT_TIMEOUT_MS)) === 'open';
}

export async function probeCompanionPort(
  opts?: {
    probe?: (port: number) => Promise<boolean>;
    nowMs?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<boolean> {
  const probe = opts?.probe ?? ((port) => isLoopbackIpv4Occupied(port));
  const nowMs = opts?.nowMs ?? Date.now;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = nowMs() + COMPANION_BUDGET_MS;
  while (nowMs() <= deadline) {
    if (await probe(COMPANION_PORT)) return true;
    if (nowMs() + COMPANION_RETRY_MS > deadline) break;
    await sleep(COMPANION_RETRY_MS);
  }
  return false;
}

export { COMPANION_PORT };
