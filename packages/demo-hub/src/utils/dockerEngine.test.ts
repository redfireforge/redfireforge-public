import { describe, expect, it } from 'vitest';
import {
  buildDockerEngineSnapshot,
  dockerArgsWithContext,
  dockerContextFor,
  dockerNotInstalledCopy,
  dockerNotRunningCopy,
  dockerOutdatedComposeCopy,
  engineNeedsChoice,
  engineProductName,
  openEngineLabel,
  parseDockerEngineId,
  resolveActiveEngine,
} from './dockerEngine';

describe('dockerEngine', () => {
  it('parses saved preference values', () => {
    expect(parseDockerEngineId('desktop')).toBe('desktop');
    expect(parseDockerEngineId(' ORBSTACK ')).toBe('orbstack');
    expect(parseDockerEngineId('podman')).toBeNull();
    expect(parseDockerEngineId(null)).toBeNull();
  });

  it('asks only when both engines are present and no pick is saved', () => {
    expect(engineNeedsChoice({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: null,
    })).toBe(true);
    expect(engineNeedsChoice({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: 'orbstack',
    })).toBe(false);
    expect(engineNeedsChoice({
      desktopInstalled: true,
      orbstackInstalled: false,
      preference: null,
    })).toBe(false);
  });

  it('resolves the only installed engine without a pick', () => {
    expect(resolveActiveEngine({
      desktopInstalled: false,
      orbstackInstalled: true,
      preference: null,
    })).toBe('orbstack');
    expect(resolveActiveEngine({
      desktopInstalled: true,
      orbstackInstalled: false,
      preference: null,
    })).toBe('desktop');
    expect(resolveActiveEngine({
      desktopInstalled: false,
      orbstackInstalled: false,
      preference: null,
    })).toBeNull();
    expect(resolveActiveEngine({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: 'orbstack',
    })).toBe('orbstack');
    expect(resolveActiveEngine({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: 'desktop',
    })).toBe('desktop');
  });

  it('drops a stale pick when that app is gone', () => {
    const snap = buildDockerEngineSnapshot({
      desktopInstalled: true,
      orbstackInstalled: false,
      preference: 'orbstack',
    });
    expect(snap.preference).toBeNull();
    expect(snap.needsChoice).toBe(false);
    expect(snap.activeEngine).toBe('desktop');
    expect(buildDockerEngineSnapshot({
      desktopInstalled: true,
      orbstackInstalled: true,
      preference: 'desktop',
    })).toMatchObject({
      preference: 'desktop',
      needsChoice: false,
      activeEngine: 'desktop',
    });
  });

  it('sets compose context only when the pick can collide', () => {
    expect(dockerContextFor('orbstack', false)).toBe('orbstack');
    expect(dockerContextFor('desktop', true)).toBe('desktop-linux');
    expect(dockerContextFor('desktop', false)).toBeNull();
    expect(dockerArgsWithContext(['info'], 'orbstack')).toEqual(['--context', 'orbstack', 'info']);
    expect(dockerArgsWithContext(['compose', 'version'], null)).toEqual(['compose', 'version']);
  });

  it('names the product in gate copy', () => {
    expect(engineProductName('orbstack')).toBe('OrbStack');
    expect(engineProductName('desktop')).toBe('Docker Desktop');
    expect(engineProductName(null)).toBe('Docker');
    expect(dockerNotRunningCopy('orbstack')).toMatch(/OrbStack is not running/);
    expect(dockerOutdatedComposeCopy('orbstack')).toMatch(/Update OrbStack/);
    expect(dockerOutdatedComposeCopy('desktop')).toMatch(/Update Docker Desktop/);
    expect(openEngineLabel('orbstack')).toBe('Open OrbStack');
    expect(openEngineLabel('desktop')).toBe('Open Docker Desktop');
    expect(openEngineLabel(null)).toBe('Open Docker');
    expect(dockerNotInstalledCopy(true)).toMatch(/OrbStack/);
    expect(dockerNotInstalledCopy(false)).toBe('Docker Desktop is not installed.');
  });
});
