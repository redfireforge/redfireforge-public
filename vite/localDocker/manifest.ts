import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { composeProjectName, dockerStackSiblings, stackKeyToRelDir } from './stackIds.ts';
import type { LocalDockerStackKey, StackManifest } from './types.ts';

export function manifestFileName(stackKey: string): string {
  return stackKey === 'grpc-spring' ? 'stack-spring.json' : 'stack.json';
}

export function resolveStackDir(repoRoot: string, key: LocalDockerStackKey): string {
  const dockerRoot = resolve(repoRoot, 'docker');
  const dir = resolve(dockerRoot, stackKeyToRelDir(key));
  if (!isPathInside(dir, dockerRoot)) {
    throw new Error('Unknown docker stack');
  }
  return dir;
}

export function isPathInside(child: string, parent: string): boolean {
  const a = resolve(child);
  const b = resolve(parent);
  return a === b || a.startsWith(b + sep);
}

function assertSafeComposeFile(file: string): void {
  if (!file || file.includes('..') || file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)) {
    throw new Error(`Unsafe compose file: ${file}`);
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asPortArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0);
}

export function parseStackManifest(raw: unknown, expectedKey: string): StackManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid stack.json for ${expectedKey}`);
  }
  const obj = raw as Record<string, unknown>;
  const stackKey = typeof obj.stackKey === 'string' ? obj.stackKey : undefined;
  if (stackKey && stackKey !== expectedKey) {
    throw new Error(`Invalid stack.json for ${expectedKey}`);
  }
  const composeFiles = asStringArray(obj.composeFiles);
  for (const file of composeFiles) assertSafeComposeFile(file);
  const profile = obj.composeProfile;
  return {
    stackKey: stackKey ?? expectedKey,
    sinceVersion: typeof obj.sinceVersion === 'string' ? obj.sinceVersion : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    composeFiles,
    buildOnStart: obj.buildOnStart === true,
    composeProfile: typeof profile === 'string' && profile ? profile : null,
    requiresCompanionProbe: obj.requiresCompanionProbe === true,
    ports: asPortArray(obj.ports),
    minMemoryMb: typeof obj.minMemoryMb === 'number' ? obj.minMemoryMb : null,
    certExpiresAt: typeof obj.certExpiresAt === 'string' ? obj.certExpiresAt : null,
  };
}

export function loadManifest(stackDir: string, stackKey: string): StackManifest {
  const file = join(stackDir, manifestFileName(stackKey));
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read stack.json for ${stackKey}: ${detail}`, { cause: err });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Invalid stack.json for ${stackKey}`);
  }
  return parseStackManifest(raw, stackKey);
}

export function loadRelatedManifests(stackDir: string, stackKey: LocalDockerStackKey): StackManifest[] {
  return dockerStackSiblings(stackKey)
    .map((key) => {
      try {
        return loadManifest(stackDir, key);
      } catch {
        return null;
      }
    })
    .filter((m): m is StackManifest => m !== null);
}

function pushNamedProject(args: string[], project: string): void {
  args.push('-p', project);
}

export function composeFileArgs(manifest: StackManifest, includeProfile = true): string[] {
  const args: string[] = [];
  if (manifest.stackKey) {
    pushNamedProject(args, composeProjectName(manifest.stackKey));
  }
  if (includeProfile && manifest.composeProfile) {
    args.push('--profile', manifest.composeProfile);
  }
  for (const file of manifest.composeFiles) {
    args.push('-f', file);
  }
  return args;
}

export function composeMergedArgs(manifests: readonly StackManifest[], project?: string): string[] {
  const args: string[] = [];
  if (project) {
    pushNamedProject(args, project);
  } else {
    const key = manifests.find((m) => m.stackKey)?.stackKey;
    if (key) pushNamedProject(args, composeProjectName(key));
  }
  const profiles: string[] = [];
  const files: string[] = [];
  for (const manifest of manifests) {
    if (manifest.composeProfile && !profiles.includes(manifest.composeProfile)) {
      profiles.push(manifest.composeProfile);
    }
    for (const file of manifest.composeFiles) {
      if (!files.includes(file)) files.push(file);
    }
  }
  for (const profile of profiles) {
    args.push('--profile', profile);
  }
  for (const file of files) {
    args.push('-f', file);
  }
  return args;
}

/** One `compose up -d` with every `-f`. A second `up` with one file tears the other down. */
export function composeUpArgsWithBuild(manifest: StackManifest, forceBuild: boolean): string[] {
  const args = ['compose', ...composeFileArgs(manifest, true), 'up', '-d'];
  if (manifest.buildOnStart || forceBuild) args.push('--build');
  return args;
}

export function parseComposeNameList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function composeHasRunningFromLists(
  running: readonly string[],
  hasProfile: boolean,
  defaults: readonly string[],
): boolean {
  if (running.length === 0) return false;
  if (!hasProfile) return true;
  if (defaults.length === 0) return false;
  return running.some((svc) => !defaults.includes(svc));
}

export function overlayOnlyPorts(starting: StackManifest, related: readonly StackManifest[]): number[] {
  if (!starting.composeProfile) return [];
  const shared = new Set<number>();
  for (const manifest of related) {
    if (!manifest.composeProfile) {
      for (const port of manifest.ports) shared.add(port);
    }
  }
  return starting.ports.filter((port) => !shared.has(port));
}

export function legacyComposeProjectName(stackDir: string): string | null {
  const base = stackDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return base && base.length > 0 ? base : null;
}

export function legacyComposeProjectIfDistinct(
  stackDir: string,
  manifests: readonly StackManifest[],
): string | null {
  const legacy = legacyComposeProjectName(stackDir);
  if (!legacy) return null;
  const current = manifests.find((m) => m.stackKey)?.stackKey;
  if (current && composeProjectName(current) === legacy) return null;
  return legacy;
}

export function expiredCertStartError(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const expires = expiresAt?.trim();
  if (!expires) return null;
  const match = expires.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return `CERT_EXPIRED:${expires}`;
  const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date(nowMs);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((expiry - todayUtc) / 86_400_000);
  return days <= 0 ? `CERT_EXPIRED:${expires}` : null;
}
