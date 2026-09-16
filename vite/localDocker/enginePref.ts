import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { detectInstalledEngines } from './engineDetect.ts';

export type DockerEngineId = 'desktop' | 'orbstack';

export interface DockerEngineSnapshot {
  desktopInstalled: boolean;
  orbstackInstalled: boolean;
  preference: DockerEngineId | null;
  needsChoice: boolean;
  activeEngine: DockerEngineId | null;
}

const PREF_FILE = 'docker-engine-preference';

export function parseDockerEngineId(raw: string | null | undefined): DockerEngineId | null {
  const value = raw?.trim().toLowerCase();
  if (value === 'desktop' || value === 'orbstack') return value;
  return null;
}

export function buildDockerEngineSnapshot(input: {
  desktopInstalled: boolean;
  orbstackInstalled: boolean;
  preference: DockerEngineId | null;
}): DockerEngineSnapshot {
  const preference = input.preference
    && (
      (input.preference === 'desktop' && input.desktopInstalled)
      || (input.preference === 'orbstack' && input.orbstackInstalled)
    )
    ? input.preference
    : null;
  const needsChoice = input.desktopInstalled && input.orbstackInstalled && preference == null;
  const activeEngine = preference
    ?? (input.orbstackInstalled && !input.desktopInstalled ? 'orbstack' : null)
    ?? (input.desktopInstalled && !input.orbstackInstalled ? 'desktop' : null);
  return {
    desktopInstalled: input.desktopInstalled,
    orbstackInstalled: input.orbstackInstalled,
    preference,
    needsChoice,
    activeEngine,
  };
}

export function dockerContextFor(
  engine: DockerEngineId | null,
  bothInstalled: boolean,
): string | null {
  if (engine === 'orbstack') return 'orbstack';
  if (engine === 'desktop' && bothInstalled) return 'desktop-linux';
  return null;
}

export function enginePrefPath(home = homedir()): string {
  return join(home, '.redfireforge', PREF_FILE);
}

export function readEnginePreference(path = enginePrefPath()): DockerEngineId | null {
  try {
    return parseDockerEngineId(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeEnginePreference(
  preference: DockerEngineId | null,
  path = enginePrefPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, preference ? `${preference}\n` : '');
}

export function loadDockerEngineSnapshot(opts?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  preference?: DockerEngineId | null;
}): DockerEngineSnapshot {
  const engines = detectInstalledEngines(opts);
  const preference = opts?.preference !== undefined
    ? opts.preference
    : readEnginePreference();
  return buildDockerEngineSnapshot({
    desktopInstalled: engines.desktop,
    orbstackInstalled: engines.orbstack,
    preference,
  });
}

export function getActiveDockerContext(snapshot = loadDockerEngineSnapshot()): string | null {
  return dockerContextFor(
    snapshot.activeEngine,
    snapshot.desktopInstalled && snapshot.orbstackInstalled,
  );
}

export function persistEnginePreference(preference: DockerEngineId | null): DockerEngineSnapshot {
  const engines = detectInstalledEngines();
  const next = buildDockerEngineSnapshot({
    desktopInstalled: engines.desktop,
    orbstackInstalled: engines.orbstack,
    preference,
  });
  writeEnginePreference(next.preference);
  return next;
}
