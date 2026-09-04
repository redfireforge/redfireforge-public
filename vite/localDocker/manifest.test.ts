import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeFileArgs,
  composeHasRunningFromLists,
  composeMergedArgs,
  composeUpArgsWithBuild,
  expiredCertStartError,
  isPathInside,
  legacyComposeProjectIfDistinct,
  legacyComposeProjectName,
  loadManifest,
  loadRelatedManifests,
  overlayOnlyPorts,
  parseComposeNameList,
  parseStackManifest,
  resolveStackDir,
} from './manifest.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('manifest', () => {
  it('reads stack.json and stack-spring.json from the repo docker tree', () => {
    const graphql = loadManifest(resolveStackDir(repoRoot, 'graphql'), 'graphql');
    expect(graphql.stackKey).toBe('graphql');
    expect(graphql.composeFiles).toEqual(['docker-compose.yml']);

    const spring = loadManifest(resolveStackDir(repoRoot, 'grpc-spring'), 'grpc-spring');
    expect(spring.stackKey).toBe('grpc-spring');
    expect(spring.composeProfile).toBe('spring');
    expect(spring.ports).toContain(9090);
    expect(spring.ports).toContain(8081);
  });

  it('builds one compose up with every -f and the rff project name', () => {
    const kafka = loadManifest(resolveStackDir(repoRoot, 'kafka-plaintext'), 'kafka-plaintext');
    const args = composeUpArgsWithBuild(kafka, false);
    expect(args).toEqual([
      'compose',
      '-p',
      'rff-kafka-plaintext',
      '-f',
      'docker-compose.yml',
      'up',
      '-d',
    ]);

    const tls = loadManifest(resolveStackDir(repoRoot, 'graphql-tls'), 'graphql-tls');
    expect(composeUpArgsWithBuild(tls, false)).toEqual([
      'compose',
      '-p',
      'rff-graphql-tls',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.mtls.yml',
      'up',
      '-d',
    ]);
  });

  it('merges grpc + spring stop args onto rff-grpc-family', () => {
    const dir = resolveStackDir(repoRoot, 'grpc');
    const go = loadManifest(dir, 'grpc');
    const spring = loadManifest(dir, 'grpc-spring');
    const args = composeMergedArgs([go, spring]);
    expect(args).toContain('-p');
    expect(args).toContain('rff-grpc-family');
    expect(args).toContain('--profile');
    expect(args).toContain('spring');
    expect(args).toContain('docker-compose.yml');
  });

  it('computes spring overlay ports as 9090/8081', () => {
    const dir = resolveStackDir(repoRoot, 'grpc');
    const go = loadManifest(dir, 'grpc');
    const spring = loadManifest(dir, 'grpc-spring');
    expect(overlayOnlyPorts(go, [go, spring])).toEqual([]);
    const extra = overlayOnlyPorts(spring, [go, spring]);
    expect(extra).toContain(9090);
    expect(extra).toContain(8081);
    expect(extra).not.toContain(50051);
  });

  it('treats a profiled stack as up only when a non-default service is running', () => {
    expect(composeHasRunningFromLists(['grpc-test-server'], true, ['grpc-test-server'])).toBe(false);
    expect(composeHasRunningFromLists(['grpc-test-server', 'spring-boot-fixture'], true, ['grpc-test-server'])).toBe(true);
    expect(composeHasRunningFromLists(['graphql'], false, [])).toBe(true);
    expect(composeHasRunningFromLists([], false, [])).toBe(false);
    expect(composeHasRunningFromLists(['spring'], true, [])).toBe(false);
  });

  it('fills a missing stackKey so compose always gets -p', () => {
    const parsed = parseStackManifest({ composeFiles: ['docker-compose.yml'] }, 'graphql');
    expect(parsed.stackKey).toBe('graphql');
    expect(composeUpArgsWithBuild(parsed, false)).toEqual([
      'compose',
      '-p',
      'rff-graphql',
      '-f',
      'docker-compose.yml',
      'up',
      '-d',
    ]);
  });

  it('blocks expired or unreadable cert dates', () => {
    expect(expiredCertStartError(null)).toBeNull();
    expect(expiredCertStartError('')).toBeNull();
    expect(expiredCertStartError('2036-08-30', Date.UTC(2026, 8, 3))).toBeNull();
    expect(expiredCertStartError('2000-01-01', Date.UTC(2026, 8, 3))).toBe('CERT_EXPIRED:2000-01-01');
    expect(expiredCertStartError('not-a-date')).toBe('CERT_EXPIRED:not-a-date');
    expect(expiredCertStartError('   ')).toBeNull();
  });

  it('rejects unsafe compose files and invalid manifests', () => {
    expect(() => parseStackManifest(null, 'graphql')).toThrow(/Invalid stack.json/);
    expect(() => parseStackManifest({ stackKey: 'kafka', composeFiles: ['docker-compose.yml'] }, 'graphql'))
      .toThrow(/Invalid stack.json/);
    expect(() => parseStackManifest({ composeFiles: ['../escape.yml'] }, 'graphql')).toThrow(/Unsafe compose file/);
    expect(() => parseStackManifest({ composeFiles: ['/etc/passwd'] }, 'graphql')).toThrow(/Unsafe compose file/);
    expect(() => parseStackManifest({ composeFiles: ['C:\\Windows\\compose.yml'] }, 'graphql')).toThrow(/Unsafe compose file/);
    const parsed = parseStackManifest({
      composeFiles: ['ok.yml', 1],
      ports: [4010, 'nope', 0, 1.5],
      buildOnStart: true,
      composeProfile: '',
      requiresCompanionProbe: true,
      minMemoryMb: 512,
      description: 'd',
      sinceVersion: '1.0.0',
    }, 'graphql');
    expect(parsed.composeFiles).toEqual(['ok.yml']);
    expect(parsed.ports).toEqual([4010]);
    expect(parsed.buildOnStart).toBe(true);
    expect(parsed.composeProfile).toBeNull();
    expect(parsed.minMemoryMb).toBe(512);
    expect(isPathInside(resolve(repoRoot, 'docker/graphql'), resolve(repoRoot, 'docker'))).toBe(true);
    expect(isPathInside(resolve(repoRoot, 'src'), resolve(repoRoot, 'docker'))).toBe(false);
  });

  it('loads related manifests and skips a missing sibling', () => {
    const dir = resolveStackDir(repoRoot, 'graphql');
    expect(loadRelatedManifests(dir, 'graphql').map((m) => m.stackKey)).toEqual(['graphql']);
    const tmp = mkdtempSync(join(tmpdir(), 'rff-manifest-'));
    try {
      expect(loadRelatedManifests(tmp, 'grpc')).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when stack.json is missing or not JSON', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rff-manifest-'));
    try {
      expect(() => loadManifest(tmp, 'graphql')).toThrow(/Cannot read stack.json/);
      writeFileSync(join(tmp, 'stack.json'), '{');
      expect(() => loadManifest(tmp, 'graphql')).toThrow(/Invalid stack.json/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('builds compose args, name lists, and legacy project names', () => {
    const kafka = loadManifest(resolveStackDir(repoRoot, 'kafka-plaintext'), 'kafka-plaintext');
    expect(composeFileArgs({ ...kafka, stackKey: '', composeProfile: null }, false)).toEqual([
      '-f',
      'docker-compose.yml',
    ]);
    expect(composeUpArgsWithBuild({ ...kafka, buildOnStart: true }, false)).toContain('--build');
    expect(composeUpArgsWithBuild(kafka, true)).toContain('--build');
    expect(composeMergedArgs([], 'rff-custom')).toEqual(['-p', 'rff-custom']);
    expect(composeMergedArgs([{ ...kafka, stackKey: '' }])).toEqual(['-f', 'docker-compose.yml']);
    expect(parseComposeNameList('a\r\n\nb\n')).toEqual(['a', 'b']);
    expect(legacyComposeProjectName('/tmp/graphql/')).toBe('graphql');
    expect(legacyComposeProjectIfDistinct('/tmp/graphql', [kafka])).toBe('graphql');
    expect(legacyComposeProjectIfDistinct('/tmp/rff-graphql', [{ ...kafka, stackKey: 'graphql' }])).toBeNull();
  });
});
