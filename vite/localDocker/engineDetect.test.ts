import { describe, expect, it } from 'vitest';
import { detectInstalledEngines, orbstackCliCandidates } from './engineDetect.ts';

describe('engineDetect', () => {
  it('lists the OrbStack CLI under the user home', () => {
    expect(orbstackCliCandidates('/Users/me')).toEqual(['/Users/me/.orbstack/bin/docker']);
    expect(orbstackCliCandidates()).toEqual([]);
  });

  it('detects Docker.app and OrbStack.app on macOS', () => {
    const exists = (p: string) =>
      p === '/Applications/Docker.app' || p === '/Applications/OrbStack.app';
    expect(detectInstalledEngines({
      platform: 'darwin',
      exists,
    })).toEqual({ desktop: true, orbstack: true });
  });

  it('treats ~/.orbstack as OrbStack without the .app', () => {
    expect(detectInstalledEngines({
      platform: 'darwin',
      env: { HOME: '/Users/me' },
      exists: (p) => p === '/Users/me/.orbstack/bin/docker',
    })).toEqual({ desktop: false, orbstack: true });
  });

  it('never reports OrbStack on Windows', () => {
    expect(detectInstalledEngines({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      exists: (p) => p.endsWith('Docker Desktop.exe'),
    })).toEqual({ desktop: true, orbstack: false });
  });

  it('treats Linux as Docker Engine without OrbStack', () => {
    expect(detectInstalledEngines({
      platform: 'linux',
      exists: () => false,
    })).toEqual({ desktop: true, orbstack: false });
  });
});
