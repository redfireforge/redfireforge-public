/** Learning Hub Docker engine pick — Desktop vs OrbStack (macOS). */

export type DockerEngineId = 'desktop' | 'orbstack';

export const DOCKER_ENGINE_PREF_KEY = 'docker-engine-preference';
export const ORBSTACK_INSTALL_URL = 'https://orbstack.dev';

export interface DockerEngineSnapshot {
  desktopInstalled: boolean;
  orbstackInstalled: boolean;
  preference: DockerEngineId | null;
  needsChoice: boolean;
  activeEngine: DockerEngineId | null;
}

export function parseDockerEngineId(raw: string | null | undefined): DockerEngineId | null {
  const value = raw?.trim().toLowerCase();
  if (value === 'desktop' || value === 'orbstack') return value;
  return null;
}

export function bothEnginesInstalled(snapshot: Pick<DockerEngineSnapshot, 'desktopInstalled' | 'orbstackInstalled'>): boolean {
  return snapshot.desktopInstalled && snapshot.orbstackInstalled;
}

export function engineNeedsChoice(
  snapshot: Pick<DockerEngineSnapshot, 'desktopInstalled' | 'orbstackInstalled' | 'preference'>,
): boolean {
  return bothEnginesInstalled(snapshot) && snapshot.preference == null;
}

/** Effective engine after a saved pick, or the only installed engine. */
export function resolveActiveEngine(
  snapshot: Pick<DockerEngineSnapshot, 'desktopInstalled' | 'orbstackInstalled' | 'preference'>,
): DockerEngineId | null {
  if (snapshot.preference === 'orbstack' && snapshot.orbstackInstalled) return 'orbstack';
  if (snapshot.preference === 'desktop' && snapshot.desktopInstalled) return 'desktop';
  if (snapshot.orbstackInstalled && !snapshot.desktopInstalled) return 'orbstack';
  if (snapshot.desktopInstalled && !snapshot.orbstackInstalled) return 'desktop';
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
  const base = { ...input, preference };
  return {
    ...base,
    needsChoice: engineNeedsChoice(base),
    activeEngine: resolveActiveEngine(base),
  };
}

/** Compose / info `--context`. Omit when Desktop is the only engine. */
export function dockerContextFor(
  engine: DockerEngineId | null,
  bothInstalled: boolean,
): string | null {
  if (engine === 'orbstack') return 'orbstack';
  if (engine === 'desktop' && bothInstalled) return 'desktop-linux';
  return null;
}

export function dockerArgsWithContext(args: readonly string[], context: string | null): string[] {
  if (!context) return [...args];
  return ['--context', context, ...args];
}

export function engineProductName(engine: DockerEngineId | null): string {
  if (engine === 'orbstack') return 'OrbStack';
  if (engine === 'desktop') return 'Docker Desktop';
  return 'Docker';
}

export function dockerNotInstalledCopy(macHost: boolean): string {
  return macHost
    ? 'Docker is not installed. Install Docker Desktop or OrbStack, then restart this app.'
    : 'Docker Desktop is not installed.';
}

export function dockerNotRunningCopy(engine: DockerEngineId | null): string {
  return `${engineProductName(engine)} is not running. Open it and wait until it is ready.`;
}

export function dockerOutdatedComposeCopy(engine: DockerEngineId | null): string {
  if (engine === 'orbstack') {
    return 'Your Docker Compose is outdated. Update OrbStack to continue.';
  }
  return 'Your Docker Compose is outdated. Update Docker Desktop to continue.';
}

export function openEngineLabel(engine: DockerEngineId | null): string {
  if (engine === 'orbstack') return 'Open OrbStack';
  if (engine === 'desktop') return 'Open Docker Desktop';
  return 'Open Docker';
}

export const ENGINE_CHOOSER_TITLE =
  'This Mac has Docker Desktop and OrbStack. Which should Learning Hub use for lesson stacks?';
