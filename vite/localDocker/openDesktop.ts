import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { firstExistingFile, windowsDesktopExeCandidates } from './dockerBin.ts';

export type OpenDesktopResult = 'opened' | 'unsupported';

export interface OpenDesktopDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  spawn?: typeof spawn;
}

function detach(child: ChildProcess): void {
  child.once('error', () => {
    /* `open` / `cmd` missing must not crash the Vite process */
  });
  child.unref?.();
}

export function openDockerDesktopApp(deps: OpenDesktopDeps = {}): OpenDesktopResult {
  const platform = deps.platform ?? process.platform;
  const spawnFn = deps.spawn ?? spawn;
  const exists = deps.exists ?? existsSync;
  const env = deps.env ?? process.env;

  if (platform === 'linux') return 'unsupported';

  if (platform === 'darwin') {
    detach(spawnFn('open', ['-a', 'Docker'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    }));
    return 'opened';
  }

  if (platform === 'win32') {
    const candidates = windowsDesktopExeCandidates({
      programFiles: env.ProgramFiles,
      programFilesX86: env['ProgramFiles(x86)'],
      localAppData: env.LOCALAPPDATA,
    });
    const exe = firstExistingFile(candidates, exists);
    const args = exe
      ? ['/C', 'start', '', exe]
      : ['/C', 'start', '', 'Docker Desktop'];
    detach(spawnFn('cmd', args, {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    }));
    return 'opened';
  }

  return 'unsupported';
}
