/**
 * Vitest product vs demo project globs.
 */
import { minimatch } from 'minimatch';

/** All unit/integration test entry points (both projects). */
export const ALL_TEST_GLOBS = [
  'src/**/*.test.{ts,tsx}',
  'src-server/**/*.test.{ts,tsx}',
  'cli/**/*.test.ts',
  'vite/**/*.test.ts',
  'scripts/**/*.test.ts',
] as const;

/** Demo-only test files — run in the `demo` Vitest project. */
export const DEMO_TEST_GLOBS = [
  'packages/demo-hub/**/*.test.{ts,tsx}',
  'src/**/useDemo*.test.ts',
  'src/**/useDemo*.coverage-gaps.test.ts',
  'src/app/components/AppLiveDemoOverlay.test.tsx',
] as const;

/** Excluded from the `product` Vitest project (must stay in sync with DEMO_TEST_GLOBS). */
export const PRODUCT_TEST_EXCLUDE = [
  'packages/demo-hub/**',
  'src/**/useDemo*.test.ts',
  'src/**/useDemo*.coverage-gaps.test.ts',
  'src/app/components/AppLiveDemoOverlay.test.tsx',
] as const;

/** Shared Vitest excludes (both projects). */
export const COMMON_TEST_EXCLUDE = [
  'node_modules',
  'dist',
  'src-tauri',
  'e2e',
] as const;

/**
 * Coverage excludes for the production (`product`) gate.
 * Vitest 4 ships `coverageConfigDefaults.exclude` as [] — we must list these
 * ourselves so demo, CSS, and test files never enter the product report.
 */
export const PRODUCT_COVERAGE_EXCLUDE = [
  '**/__test-utils__/**',
  '**/__mocks__/**',
  '**/test-helpers/**',
  '**/*.coverage-helpers.ts',
  '**/*.test-utils.{ts,tsx}',
  '**/*.testHelpers.ts',
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.d.ts',
  '**/*.css',
  '**/*.scss',
  '**/*.config.{ts,js}',
  'src/shared/types/index.ts',
  // App and server entry points — not unit-testable
  'src/app/main.tsx',
  'src-server/index.ts',
  // Test factory / helper files
  'src/features/websocket/__tests__/websocket.test.factories.ts',
  '**/src/test-utils/**',
  '**/src/styles/**',
  // Entire demo hub — product coverage gate (Phase 1 + Phase 3 shell + Phase 7 package)
  '**/packages/demo-hub/**',
  '**/src/app/demo/**',
  '**/src/app/hooks/useDemo*.ts',
  'coverage/**',
  'node_modules',
  'dist',
  'src-tauri',
  'e2e',
  'scripts/**',
] as const;

export function matchesGlob(path: string, pattern: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return minimatch(normalized, pattern, { dot: true });
}

export function isDemoTestFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return DEMO_TEST_GLOBS.some((pattern) => matchesGlob(normalized, pattern));
}

export function isProductTestFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const isTest =
    normalized.endsWith('.test.ts')
    || normalized.endsWith('.test.tsx');
  if (!isTest) return false;
  const inAllScope = ALL_TEST_GLOBS.some((pattern) => matchesGlob(normalized, pattern));
  if (!inAllScope) return false;
  return !PRODUCT_TEST_EXCLUDE.some((pattern) => matchesGlob(normalized, pattern));
}

/** Istanbul coverage map paths to strip from the product coverage gate. */
export function isDemoCoveragePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /\/demo-hub(\/|\.)/.test(normalized)
    || /\/packages\/demo-hub\//.test(normalized)
    || /\/demo-player(\/|\.)/.test(normalized)
    || /\/src\/app\/demo\//.test(normalized)
    || normalized.endsWith('/demo-hub.css')
    || /\/useDemo[^/]*\.ts$/.test(normalized);
}

/** Demo, CSS, and test/helper files — never counted in the product coverage gate. */
export function isIgnoredProductCoveragePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (isDemoCoveragePath(normalized)) return true;
  if (normalized.endsWith('.css') || normalized.endsWith('.scss')) return true;
  if (normalized.includes('/src/styles/')) return true;
  if (normalized.includes('/src/test-utils/')) return true;
  if (/\.test\.(ts|tsx)$/.test(normalized) || /\.spec\.(ts|tsx)$/.test(normalized)) return true;
  if (normalized.includes('.testHelpers.') || normalized.includes('.test-utils.')) return true;
  if (normalized.endsWith('.d.ts')) return true;
  return false;
}
