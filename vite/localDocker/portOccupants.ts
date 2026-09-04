import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { firstExistingFile } from './dockerBin.ts';

export const LOOKUP_TIMEOUT_MS = 800;
export const MAX_PROCESS_NAME_CHARS = 64;

export interface PortOccupant {
  port: number;
  process?: string;
  pid?: number;
}

export interface OccupantLookupDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  run?: (bin: string, args: string[]) => Promise<string | null>;
}

export function lookupCommandCandidates(
  name: 'lsof' | 'ps' | 'netstat' | 'tasklist',
  systemRoot?: string,
): string[] {
  if (name === 'lsof' || name === 'ps') {
    return [`/usr/sbin/${name}`, `/usr/bin/${name}`, `/bin/${name}`, name];
  }
  const root = systemRoot?.trim() || 'C:\\Windows';
  return [join(root, 'System32', `${name}.exe`), name];
}

export function formatPortConflictError(occupants: readonly (PortOccupant | number)[]): string {
  const entries = occupants.map((item) => {
    if (typeof item === 'number') return { port: item };
    const out: PortOccupant = { port: item.port };
    if (item.process) out.process = item.process;
    if (item.pid != null) out.pid = item.pid;
    return out;
  });
  return `PORT_CONFLICT:${JSON.stringify(entries)}`;
}

export function splitHostPort(addr: string): { host: string; port: string } | null {
  const trimmed = addr.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']:');
    if (end === -1) return null;
    return { host: trimmed.slice(1, end), port: trimmed.slice(end + 2) };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon === -1) return null;
  return { host: trimmed.slice(0, colon), port: trimmed.slice(colon + 1) };
}

/** lsof sometimes glues the state on (`*:4010(LISTEN)`). */
export function localAddrHasPort(addr: string, port: number): boolean {
  const token = addr
    .trim()
    .replace(/^[()]+|[()]+$/g, '')
    .split('(')[0]
    ?.trim() ?? addr;
  const parts = splitHostPort(token);
  if (!parts) return false;
  return Number(parts.port) === port;
}

export function decodeCommandOutput(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return decodeUtf16(bytes.subarray(2), true);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return decodeUtf16(bytes.subarray(2), false);
  }
  if (looksLikeUtf16Le(bytes)) return decodeUtf16(bytes, true);
  return Buffer.from(bytes).toString('utf8');
}

function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes.length % 2 !== 0) return false;
  const pairs = bytes.length / 2;
  let nulHigh = 0;
  for (let i = 1; i < bytes.length; i += 2) {
    if (bytes[i] === 0) nulHigh += 1;
  }
  return nulHigh * 4 >= pairs * 3;
}

function decodeUtf16(bytes: Uint8Array, little: boolean): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  if (little) return buf.toString('utf16le');
  const swapped = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1]!;
    swapped[i + 1] = buf[i]!;
  }
  return swapped.toString('utf16le');
}

export function sanitizeProcessName(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name;
  const trimmed = [...base].filter((c) => c.charCodeAt(0) >= 32).join('').trim();
  if (!trimmed) return null;
  return [...trimmed].slice(0, MAX_PROCESS_NAME_CHARS).join('');
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, '');
}

export function parseLsofListenPid(output: string, port: number): number | null {
  for (const raw of output.split(/\r?\n/)) {
    const line = stripBom(raw).trim();
    if (!line || line.startsWith('COMMAND')) continue;
    if (!line.toUpperCase().includes('LISTEN')) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 2) continue;
    if (!cols.some((col) => localAddrHasPort(col, port))) continue;
    for (const col of cols) {
      const pid = Number(col);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  }
  return null;
}

export function parsePsComm(output: string): string | null {
  const line = output.split(/\r?\n/).map((l) => stripBom(l).trim()).find((l) => l.length > 0);
  return line ? sanitizeProcessName(line) : null;
}

export function parseNetstatListenPid(output: string, port: number): number | null {
  let fallback: number | null = null;
  for (const raw of output.split(/\r?\n/)) {
    const cols = stripBom(raw).split(/\s+/).filter(Boolean);
    if (cols.length < 4) continue;
    const proto = cols[0]?.toLowerCase() ?? '';
    if (proto !== 'tcp' && proto !== 'tcpv6') continue;
    if (!localAddrHasPort(cols[1] ?? '', port)) continue;
    let pid: number | null = null;
    for (let i = cols.length - 1; i >= 0; i -= 1) {
      const n = Number(cols[i]);
      if (Number.isInteger(n) && n > 0) {
        pid = n;
        break;
      }
    }
    if (pid == null) continue;
    const state = cols[3] ?? '';
    if (state.toLowerCase() === 'listening' || state === '02') return pid;
    fallback = pid;
  }
  return fallback;
}

export function parseTasklistImage(line: string): string | null {
  const trimmed = stripBom(line).trim();
  if (!trimmed || trimmed.startsWith('INFO:')) return null;
  const name = trimmed.startsWith('"')
    ? trimmed.slice(1).split('"')[0] ?? ''
    : trimmed.split(',')[0] ?? '';
  return sanitizeProcessName(name);
}

function runHidden(
  bin: string,
  args: string[],
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const timer = setTimeout(() => {
      // Do not key off `child.killed` — Node sets that on the first kill().
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve(null);
    }, timeoutMs);
    timer.unref?.();
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(decodeCommandOutput(Buffer.concat(chunks)));
    });
  });
}

function resolveLookupBin(
  name: 'lsof' | 'ps' | 'netstat' | 'tasklist',
  deps: OccupantLookupDeps,
): string {
  const exists = deps.exists ?? existsSync;
  const env = deps.env ?? process.env;
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
  return firstExistingFile(lookupCommandCandidates(name, systemRoot), exists) ?? name;
}

export async function lookupPortOccupants(
  ports: readonly number[],
  deps: OccupantLookupDeps = {},
): Promise<PortOccupant[]> {
  if (ports.length === 0) return [];
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? ((bin, args) => runHidden(bin, args));

  if (platform === 'win32') {
    const netstat = resolveLookupBin('netstat', deps);
    const text = await run(netstat, ['-ano']);
    const pids = ports.map((port) => ({
      port,
      pid: text ? parseNetstatListenPid(text, port) : null,
    }));
    const names = new Map<number, string | null>();
    const unique = [...new Set(pids.map((p) => p.pid).filter((pid): pid is number => pid != null))];
    const tasklist = resolveLookupBin('tasklist', deps);
    await Promise.all(unique.map(async (pid) => {
      const out = await run(tasklist, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      names.set(pid, out ? out.split(/\r?\n/).map(parseTasklistImage).find((n) => n != null) ?? null : null);
    }));
    return pids.map(({ port, pid }) => toOccupant(port, pid, pid != null ? names.get(pid) : null));
  }

  const lsof = resolveLookupBin('lsof', deps);
  const args = ['-nP', '-sTCP:LISTEN', ...ports.map((port) => `-iTCP:${port}`)];
  const text = await run(lsof, args);
  const pids = ports.map((port) => ({
    port,
    pid: text ? parseLsofListenPid(text, port) : null,
  }));
  const names = new Map<number, string | null>();
  const unique = [...new Set(pids.map((p) => p.pid).filter((pid): pid is number => pid != null))];
  const ps = resolveLookupBin('ps', deps);
  await Promise.all(unique.map(async (pid) => {
    const out = await run(ps, ['-p', String(pid), '-o', 'comm=']);
    names.set(pid, out ? parsePsComm(out) : null);
  }));
  return pids.map(({ port, pid }) => toOccupant(port, pid, pid != null ? names.get(pid) : null));
}

function toOccupant(port: number, pid: number | null, process: string | null | undefined): PortOccupant {
  const out: PortOccupant = { port };
  if (pid != null) out.pid = pid;
  if (process) out.process = process;
  return out;
}
