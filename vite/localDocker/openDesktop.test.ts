import { describe, expect, it, vi } from 'vitest';
import { windowsDesktopExeCandidates } from './dockerBin.ts';
import { openDockerDesktopApp } from './openDesktop.ts';

describe('openDockerDesktopApp', () => {
  it('spawns open -a Docker on macOS', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }));
    expect(openDockerDesktopApp({
      platform: 'darwin',
      engine: 'desktop',
      spawn: spawn as never,
    })).toBe('opened');
    expect(spawn).toHaveBeenCalledWith('open', ['-a', 'Docker'], expect.objectContaining({
      shell: false,
      windowsHide: true,
    }));
  });

  it('spawns open -a OrbStack when that engine is selected', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }));
    expect(openDockerDesktopApp({
      platform: 'darwin',
      engine: 'orbstack',
      spawn: spawn as never,
    })).toBe('opened');
    expect(spawn).toHaveBeenCalledWith('open', ['-a', 'OrbStack'], expect.objectContaining({
      shell: false,
    }));
  });

  it('uses process.platform when deps omit platform', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }));
    const result = openDockerDesktopApp({ engine: 'desktop', spawn: spawn as never });
    if (process.platform === 'linux') {
      expect(result).toBe('unsupported');
      expect(spawn).not.toHaveBeenCalled();
    } else {
      expect(result).toBe('opened');
      expect(spawn).toHaveBeenCalled();
    }
  });

  it('uses process defaults before the linux unsupported return', () => {
    expect(openDockerDesktopApp({ platform: 'linux' })).toBe('unsupported');
  });

  it('returns unsupported on Linux without spawning', () => {
    const spawn = vi.fn();
    expect(openDockerDesktopApp({
      platform: 'linux',
      spawn: spawn as never,
    })).toBe('unsupported');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('swallows spawn errors so a missing open/cmd cannot crash Vite', () => {
    const once = vi.fn();
    const spawn = vi.fn(() => ({ unref: vi.fn(), once }));
    expect(openDockerDesktopApp({
      platform: 'darwin',
      engine: 'desktop',
      spawn: spawn as never,
    })).toBe('opened');
    expect(once).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('starts Docker Desktop.exe on Windows when the well-known path exists', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }));
    const exe = windowsDesktopExeCandidates({ programFiles: 'C:\\Program Files' })[0];
    expect(exe).toBeTruthy();
    expect(openDockerDesktopApp({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      exists: (path) => path === exe,
      spawn: spawn as never,
    })).toBe('opened');
    expect(spawn).toHaveBeenCalledWith(
      'cmd',
      ['/C', 'start', '', exe],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });

  it('invokes the spawn error listener so a missing binary cannot crash Vite', () => {
    const once = vi.fn((event: string, fn: (err: Error) => void) => {
      if (event === 'error') fn(new Error('missing'));
    });
    expect(openDockerDesktopApp({
      platform: 'darwin',
      engine: 'desktop',
      spawn: vi.fn(() => ({ unref: vi.fn(), once })) as never,
    })).toBe('opened');
  });

  it('tolerates a child without unref', () => {
    expect(openDockerDesktopApp({
      platform: 'darwin',
      engine: 'desktop',
      spawn: vi.fn(() => ({ once: vi.fn() })) as never,
    })).toBe('opened');
  });

  it('returns unsupported on unknown platforms', () => {
    expect(openDockerDesktopApp({
      platform: 'freebsd' as NodeJS.Platform,
      spawn: vi.fn() as never,
    })).toBe('unsupported');
  });

  it('falls back to start Docker Desktop when no exe is on disk', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }));
    expect(openDockerDesktopApp({
      platform: 'win32',
      exists: () => false,
      spawn: spawn as never,
    })).toBe('opened');
    expect(spawn).toHaveBeenCalledWith(
      'cmd',
      ['/C', 'start', '', 'Docker Desktop'],
      expect.objectContaining({ shell: false }),
    );
  });
});
