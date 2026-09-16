import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDockerEngineSnapshot,
  dockerContextFor,
  enginePrefPath,
  getActiveDockerContext,
  loadDockerEngineSnapshot,
  parseDockerEngineId,
  readEnginePreference,
  writeEnginePreference,
} from './enginePref.ts';

describe('enginePref', () => {
  it('parses and persists a preference file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rff-engine-pref-'));
    const path = join(dir, 'docker-engine-preference');
    expect(readEnginePreference(path)).toBeNull();
    writeEnginePreference('orbstack', path);
    expect(readEnginePreference(path)).toBe('orbstack');
    writeEnginePreference(null, path);
    expect(readEnginePreference(path)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the pref file under ~/.redfireforge', () => {
    expect(enginePrefPath('/Users/me')).toBe('/Users/me/.redfireforge/docker-engine-preference');
    expect(parseDockerEngineId('desktop')).toBe('desktop');
    expect(dockerContextFor('orbstack', true)).toBe('orbstack');
    expect(dockerContextFor('desktop', true)).toBe('desktop-linux');
    expect(dockerContextFor('desktop', false)).toBeNull();
    expect(buildDockerEngineSnapshot({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: null,
    }).needsChoice).toBe(true);
  });

  it('loads a snapshot from detect + an explicit preference', () => {
    const snapshot = loadDockerEngineSnapshot({
      platform: 'darwin',
      env: { HOME: '/Users/me' },
      exists: (p) => p === '/Applications/Docker.app' || p === '/Applications/OrbStack.app',
      preference: 'desktop',
    });
    expect(snapshot).toMatchObject({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: 'desktop',
      needsChoice: false,
      activeEngine: 'desktop',
    });
    expect(getActiveDockerContext(snapshot)).toBe('desktop-linux');
  });
});
