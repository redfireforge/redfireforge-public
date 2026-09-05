import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_TEST_GLOBS,
  isDemoCoveragePath,
  isDemoTestFile,
  isIgnoredProductCoveragePath,
  isProductTestFile,
  PRODUCT_COVERAGE_EXCLUDE,
  PRODUCT_TEST_EXCLUDE,
} from '../../vitest.projectPatterns';

const ROOT = join(import.meta.dirname, '../..');

function collectTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      collectTestFiles(full, acc);
    } else if (/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return acc;
}

function collectUnder(relativeDir: string): string[] {
  const abs = join(ROOT, relativeDir);
  try {
    return collectTestFiles(abs);
  } catch {
    return [];
  }
}

function collectAllRepoTestFiles(): string[] {
  return [
    ...collectUnder('src'),
    ...collectUnder('packages/demo-hub/src'),
    ...collectUnder('src-server'),
    ...collectUnder('cli'),
  ];
}

describe('vitest project split (Phase 1)', () => {
  it('classifies demo-hub package tests as demo-only', () => {
    expect(isDemoTestFile('packages/demo-hub/src/useDemoHub.test.ts')).toBe(true);
    expect(isProductTestFile('packages/demo-hub/src/useDemoHub.test.ts')).toBe(false);
  });

  it('classifies useDemoShortcuts.test.ts as demo-only', () => {
    expect(isDemoTestFile('src/app/hooks/useDemoShortcuts.test.ts')).toBe(true);
    expect(isProductTestFile('src/app/hooks/useDemoShortcuts.test.ts')).toBe(false);
  });

  it('classifies gqlDemoWorkspace.test.ts as product (demo support in GraphQL Studio)', () => {
    expect(isDemoTestFile('src/features/graphql/utils/gqlDemoWorkspace.test.ts')).toBe(false);
    expect(isProductTestFile('src/features/graphql/utils/gqlDemoWorkspace.test.ts')).toBe(true);
  });

  it('classifies AppActivityBar.test.tsx as product (mixed demo-hub assertions)', () => {
    expect(isDemoTestFile('src/app/components/AppActivityBar.test.tsx')).toBe(false);
    expect(isProductTestFile('src/app/components/AppActivityBar.test.tsx')).toBe(true);
  });

  it('classifies AppLiveDemoOverlay.test.tsx as demo-only', () => {
    expect(isDemoTestFile('src/app/components/AppLiveDemoOverlay.test.tsx')).toBe(true);
  });

  it('classifies all bridge hook tests as demo-only', () => {
    for (const file of [
      'src/app/hooks/useDemoWorkflowBridge.test.ts',
      'src/app/hooks/useDemoWorkflowCanvasBridge.test.ts',
      'src/app/hooks/useDemoGlobalAuthBridge.test.ts',
      'src/features/graphql/hooks/useDemoGqlTlsBridge.test.ts',
      'src/features/graphql/hooks/useDemoGqlEnvBridge.test.ts',
      'src/features/graphql/hooks/useDemoGqlModalLockBridge.test.ts',
      'src/app/hooks/useDemoWorkspaceDefaultsBridge.test.ts',
    ]) {
      expect(isDemoTestFile(file), file).toBe(true);
      expect(isProductTestFile(file), file).toBe(false);
    }
  });

  it('has no overlap between product exclude globs and product-eligible demo-hub paths', () => {
    const demoHubTests = collectUnder('packages/demo-hub/src');
    expect(demoHubTests.length).toBeGreaterThan(50);
    for (const file of demoHubTests) {
      expect(isProductTestFile(file), `${file} should not be in product project`).toBe(false);
      expect(isDemoTestFile(file), `${file} should be in demo project`).toBe(true);
    }
  });

  it('documents expected glob patterns for CI audit', () => {
    expect(DEMO_TEST_GLOBS).toContain('packages/demo-hub/**/*.test.{ts,tsx}');
    expect(PRODUCT_TEST_EXCLUDE).toContain('packages/demo-hub/**');
  });

  it('partitions every repo test file into exactly one project (demo xor product)', () => {
    const all = collectAllRepoTestFiles();
    expect(all.length).toBeGreaterThan(1400);

    const neither: string[] = [];
    const both: string[] = [];

    for (const file of all) {
      const demo = isDemoTestFile(file);
      const product = isProductTestFile(file);
      if (demo && product) both.push(file);
      if (!demo && !product) neither.push(file);
    }

    expect(both, `files in both projects: ${both.join(', ')}`).toEqual([]);
    expect(neither, `unclassified files: ${neither.join(', ')}`).toEqual([]);
    expect(all.filter(isDemoTestFile).length).toBeGreaterThan(90);
  });

  it('classifies every useDemo*.test.ts file as demo-only', () => {
    function collectUseDemoTests(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (entry === 'node_modules' || entry === 'dist') continue;
          collectUseDemoTests(full, acc);
        } else if (/^useDemo.*\.test\.ts$/.test(entry)) {
          acc.push(relative(ROOT, full).replace(/\\/g, '/'));
        }
      }
      return acc;
    }

    const useDemoTests = [
      ...collectUseDemoTests(join(ROOT, 'src')),
      ...collectUseDemoTests(join(ROOT, 'packages/demo-hub/src')),
    ];
    expect(useDemoTests.length).toBeGreaterThanOrEqual(9);
    for (const file of useDemoTests) {
      expect(isDemoTestFile(file), file).toBe(true);
      expect(isProductTestFile(file), file).toBe(false);
    }
  });

  it('classifies demo coverage paths for Istanbul filter', () => {
    expect(isDemoCoveragePath('/repo/packages/demo-hub/src/DemoHub.tsx')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/app/hooks/useDemoWorkflowBridge.ts')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/app/demo/DemoShellHost.tsx')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/app/demo/demoHubRuntimeRef.ts')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/features/graphql/hooks/useDemoGqlTlsBridge.ts')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/styles/demo-player.css')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/styles/demo-hub.css')).toBe(true);
    expect(isDemoCoveragePath('C:\\repo\\packages\\demo-hub\\src\\DemoHub.tsx')).toBe(true);
    expect(isDemoCoveragePath('/repo/src/features/graphql/utils/gqlDemoWorkspace.ts')).toBe(false);
  });

  it('ignores demo, CSS, and test files in the product coverage map', () => {
    expect(isIgnoredProductCoveragePath('/repo/packages/demo-hub/src/DemoHub.tsx')).toBe(true);
    expect(isIgnoredProductCoveragePath('/repo/src/styles/data-mapper.css')).toBe(true);
    expect(isIgnoredProductCoveragePath('/repo/src/shared/foo.test.ts')).toBe(true);
    expect(isIgnoredProductCoveragePath('/repo/src/test-utils/factories.ts')).toBe(true);
    expect(isIgnoredProductCoveragePath('/repo/src/shared/utils/platform.ts')).toBe(false);
    expect(PRODUCT_COVERAGE_EXCLUDE).toEqual(expect.arrayContaining([
      '**/*.css',
      '**/*.test.{ts,tsx}',
      '**/packages/demo-hub/**',
      '**/src/styles/**',
      '**/src/test-utils/**',
    ]));
  });
});
