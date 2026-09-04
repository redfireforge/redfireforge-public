import { describe, expect, it } from 'vitest';
import {
  firstExistingFile,
  pathDockerBins,
  resolveDockerBin,
  unixDockerCandidates,
  windowsDesktopExeCandidates,
  windowsDockerCliCandidates,
} from './dockerBin.ts';

describe('dockerBin', () => {
  it.skipIf(process.platform === 'win32')('prefers the first PATH hit', () => {
    const exists = (p: string) => p.endsWith('/opt/bin/docker');
    expect(resolveDockerBin({
      platform: 'darwin',
      pathEnv: '/opt/bin:/usr/bin',
      exists,
    })).toBe('/opt/bin/docker');
  });

  it('falls back to well-known Unix paths', () => {
    expect(unixDockerCandidates()).toContain('/opt/homebrew/bin/docker');
    expect(unixDockerCandidates()).toContain('/usr/local/bin/docker');
    expect(unixDockerCandidates()).toContain(
      '/Applications/Docker.app/Contents/Resources/bin/docker',
    );
    const exists = (p: string) => p === '/opt/homebrew/bin/docker';
    expect(resolveDockerBin({
      platform: 'darwin',
      pathEnv: '/no/such/bin',
      exists,
    })).toBe('/opt/homebrew/bin/docker');
  });

  it('prefers Docker Desktop over Homebrew when both exist', () => {
    const exists = (p: string) =>
      p === '/usr/local/bin/docker' || p === '/opt/homebrew/bin/docker';
    expect(resolveDockerBin({
      platform: 'darwin',
      pathEnv: '/usr/bin:/bin:/usr/sbin:/sbin',
      exists,
    })).toBe('/usr/local/bin/docker');
  });

  it('resolves Docker.app under the user home folder', () => {
    const home = '/Users/me';
    expect(unixDockerCandidates(home)).toContain(
      '/Users/me/.docker/bin/docker',
    );
    expect(resolveDockerBin({
      platform: 'darwin',
      pathEnv: '/usr/bin:/bin',
      env: { HOME: home },
      exists: (p) => p === '/Users/me/.docker/bin/docker',
    })).toBe('/Users/me/.docker/bin/docker');
  });

  it('includes Windows Program Files candidates', () => {
    const paths = windowsDockerCliCandidates({
      programFiles: 'D:\\Program Files',
      programData: 'D:\\ProgramData',
      programFilesX86: 'D:\\Program Files (x86)',
      localAppData: 'D:\\Users\\me\\AppData\\Local',
    });
    expect(paths.some((p) => p.includes('resources') && p.includes('docker.exe'))).toBe(true);
    expect(paths.some((p) => p.includes('version-bin'))).toBe(true);
    expect(paths.some((p) => p.includes('DockerDesktop') && p.endsWith('docker.exe'))).toBe(true);
  });

  it('returns null when nothing exists', () => {
    expect(resolveDockerBin({
      platform: 'darwin',
      pathEnv: '/nope',
      exists: () => false,
    })).toBeNull();
    expect(firstExistingFile(['/missing'], () => false)).toBeNull();
  });

  it('lists Windows Docker Desktop.exe candidates', () => {
    const paths = windowsDesktopExeCandidates({
      programFiles: 'D:\\Program Files',
      programFilesX86: 'D:\\Program Files (x86)',
      localAppData: 'D:\\Users\\me\\AppData\\Local',
    });
    expect(paths.some((p) => p.endsWith('Docker Desktop.exe'))).toBe(true);
    expect(paths.some((p) => p.includes('Program Files (x86)'))).toBe(true);
    expect(paths.some((p) => p.includes('DockerDesktop') && p.endsWith('Docker Desktop.exe'))).toBe(true);
  });

  it('resolves docker.exe from PATH on Windows', () => {
    expect(resolveDockerBin({
      platform: 'win32',
      pathEnv: 'C:\\bin;C:\\other',
      env: {
        ProgramFiles: 'D:\\Program Files',
        ProgramData: 'D:\\ProgramData',
        'ProgramFiles(x86)': 'D:\\Program Files (x86)',
        LOCALAPPDATA: 'D:\\Users\\me\\AppData\\Local',
      },
      exists: (p) => p.includes('C:\\bin') && p.endsWith('docker.exe'),
    })).toMatch(/docker\.exe$/);
  });

  it('uses process defaults when opts are omitted', () => {
    const bin = resolveDockerBin();
    expect(bin === null || typeof bin === 'string').toBe(true);
  });

  it.skipIf(process.platform === 'win32')('reads Windows Path when PATH is unset', () => {
    expect(resolveDockerBin({
      platform: 'darwin',
      env: { Path: '/from-path-env' },
      exists: (p) => p.includes('from-path-env'),
    })).toBe('/from-path-env/docker');
  });

  it('skips empty and quoted PATH entries', () => {
    expect(pathDockerBins('  ; "C:\\quoted" ;', 'docker.exe', ';')).toEqual([
      expect.stringMatching(/quoted.*docker\.exe$/),
    ]);
    expect(pathDockerBins(undefined, 'docker')).toEqual([]);
  });

  it('lists Windows candidates even when env dirs are empty', () => {
    expect(windowsDockerCliCandidates({}).some((p) => p.includes('docker.exe'))).toBe(true);
    expect(windowsDesktopExeCandidates({}).some((p) => p.endsWith('Docker Desktop.exe'))).toBe(true);
  });

  it('walks PATH entries for docker.exe on Windows', () => {
    expect(pathDockerBins('C:\\bin;C:\\other', 'docker.exe', ';')).toEqual([
      expect.stringMatching(/docker\.exe$/),
      expect.stringMatching(/docker\.exe$/),
    ]);
  });
});
