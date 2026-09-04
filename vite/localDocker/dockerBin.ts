import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function unixDockerCandidates(): string[] {
  return ['/opt/homebrew/bin/docker', '/usr/local/bin/docker', '/usr/bin/docker'];
}

export function windowsDockerCliCandidates(env: {
  programFiles?: string;
  programData?: string;
  programFilesX86?: string;
  localAppData?: string;
}): string[] {
  const out: string[] = [];
  const pf = env.programFiles?.trim();
  const pd = env.programData?.trim();
  const pf86 = env.programFilesX86?.trim();
  const local = env.localAppData?.trim();
  if (pf) out.push(join(pf, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
  if (pd) out.push(join(pd, 'DockerDesktop', 'version-bin', 'docker.exe'));
  if (pf86) out.push(join(pf86, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
  if (local) {
    out.push(join(local, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'));
    out.push(join(local, 'Programs', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
    out.push(join(local, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
  }
  out.push(join('C:\\', 'Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
  out.push(join('C:\\', 'ProgramData', 'DockerDesktop', 'version-bin', 'docker.exe'));
  return out;
}

/** Well-known `Docker Desktop.exe` paths — subset of Rust `windows_desktop_exe_candidates`. */
export function windowsDesktopExeCandidates(env: {
  programFiles?: string;
  programFilesX86?: string;
  localAppData?: string;
}): string[] {
  const out: string[] = [];
  const pf = env.programFiles?.trim();
  const pf86 = env.programFilesX86?.trim();
  const local = env.localAppData?.trim();
  if (pf) out.push(join(pf, 'Docker', 'Docker', 'Docker Desktop.exe'));
  if (pf86) out.push(join(pf86, 'Docker', 'Docker', 'Docker Desktop.exe'));
  if (local) {
    out.push(join(local, 'Programs', 'DockerDesktop', 'Docker Desktop.exe'));
    out.push(join(local, 'Programs', 'Docker', 'Docker', 'Docker Desktop.exe'));
    out.push(join(local, 'Docker', 'Docker', 'Docker Desktop.exe'));
  }
  out.push(join('C:\\', 'Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'));
  return out;
}

export function pathDockerBins(
  pathEnv: string | undefined,
  exeName: string,
  pathDelimiter = delimiter,
): string[] {
  if (!pathEnv) return [];
  const out: string[] = [];
  for (const dir of pathEnv.split(pathDelimiter)) {
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (!trimmed) continue;
    out.push(join(trimmed, exeName));
  }
  return out;
}

export function firstExistingFile(
  paths: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const path of paths) {
    if (exists(path)) return path;
  }
  return null;
}

export function resolveDockerBin(opts?: {
  pathEnv?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}): string | null {
  const platform = opts?.platform ?? process.platform;
  const env = opts?.env ?? process.env;
  const pathEnv = opts?.pathEnv ?? env.PATH ?? env.Path;
  const exists = opts?.exists ?? existsSync;
  const isWin = platform === 'win32';
  const exeName = isWin ? 'docker.exe' : 'docker';
  const fromPath = pathDockerBins(pathEnv, exeName, isWin ? ';' : ':');
  const wellKnown = isWin
    ? windowsDockerCliCandidates({
        programFiles: env.ProgramFiles,
        programData: env.ProgramData,
        programFilesX86: env['ProgramFiles(x86)'],
        localAppData: env.LOCALAPPDATA,
      })
    : unixDockerCandidates();
  return firstExistingFile([...fromPath, ...wellKnown], exists);
}
