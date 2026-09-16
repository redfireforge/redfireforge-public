import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { firstExistingFile, windowsDesktopExeCandidates } from './dockerBin.ts';

export type DockerEngineId = 'desktop' | 'orbstack';

export interface DetectedDockerEngines {
  desktop: boolean;
  orbstack: boolean;
}

export function orbstackCliCandidates(home?: string): string[] {
  const h = home?.trim();
  return h ? [join(h, '.orbstack', 'bin', 'docker')] : [];
}

export function detectInstalledEngines(opts?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}): DetectedDockerEngines {
  const platform = opts?.platform ?? process.platform;
  const env = opts?.env ?? process.env;
  const exists = opts?.exists ?? existsSync;
  const home = env.HOME ?? env.USERPROFILE;

  if (platform === 'darwin') {
    const desktop =
      exists('/Applications/Docker.app')
      || (home ? exists(join(home, 'Applications', 'Docker.app')) : false);
    const orbstack =
      exists('/Applications/OrbStack.app')
      || (home ? exists(join(home, '.orbstack', 'bin', 'docker')) : false)
      || (home ? exists(join(home, '.orbstack')) : false);
    return { desktop, orbstack };
  }

  if (platform === 'win32') {
    const candidates = windowsDesktopExeCandidates({
      programFiles: env.ProgramFiles,
      programFilesX86: env['ProgramFiles(x86)'],
      localAppData: env.LOCALAPPDATA,
    });
    return { desktop: firstExistingFile(candidates, exists) != null, orbstack: false };
  }

  return { desktop: true, orbstack: false };
}
