import path from 'path';
import { defineConfig, coverageConfigDefaults } from 'vitest/config';
import {
  ALL_TEST_GLOBS,
  COMMON_TEST_EXCLUDE,
  DEMO_TEST_GLOBS,
  PRODUCT_COVERAGE_EXCLUDE,
  PRODUCT_TEST_EXCLUDE,
} from './vitest.projectPatterns';
import { demoHubRootImportsPlugin } from './vite/demoHubRootImports';
import { createMonacoAwareLogger, monacoDevNoisePlugin } from './vite/monacoDevNoisePlugin';

// Vitest 4 leaves coverageConfigDefaults.exclude empty; PRODUCT_COVERAGE_EXCLUDE
// is the full denylist (demo, CSS, test files, test-utils, styles).
const productCoverageExclude = [
  ...PRODUCT_COVERAGE_EXCLUDE,
  ...coverageConfigDefaults.exclude,
];

const demoCoverageExclude = [
  ...coverageConfigDefaults.exclude,
  '**/__test-utils__/**',
  '**/*.coverage-helpers.ts',
  'packages/demo-hub/**/test-utils/**',
];

const sharedTestOptions = {
  globals: true,
  environment: 'node' as const,
  setupFiles: ['./src/test-utils/vitest-setup.ts'],
  testTimeout: 15000,
  hookTimeout: 15000,
  exclude: [...COMMON_TEST_EXCLUDE],
  retry: 2,
  env: {
    VITE_ENABLE_DEMO_HUB: 'true',
  },
};

const sharedProjectConfig = {
  plugins: [demoHubRootImportsPlugin(), monacoDevNoisePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@redfireforge/demo-hub': path.resolve(__dirname, './packages/demo-hub/src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@graphql': path.resolve(__dirname, './src/features/graphql'),
      '@grpc': path.resolve(__dirname, './src/features/grpc'),
      '@workflow': path.resolve(__dirname, './src/features/workflow'),
      '@engine': path.resolve(__dirname, './src/engine'),
      '@engine/core': path.resolve(__dirname, './src/engine/core'),
      '@engine/grpc': path.resolve(__dirname, './src/engine/grpc'),
      '@engine/load': path.resolve(__dirname, './src/engine/load'),
      '@test-utils': path.resolve(__dirname, './src/test-utils'),
      '@app': path.resolve(__dirname, './src/app'),
    },
  },
};

export default defineConfig({
  customLogger: createMonacoAwareLogger(),
  ...sharedProjectConfig,
  test: {
    poolMatchGlobs: [
      ['src-server/**', 'forks'],
      ['packages/demo-hub/useDemoHub.coverage*.ts', 'forks'],
    ],
    projects: [
      {
        ...sharedProjectConfig,
        test: {
          ...sharedTestOptions,
          name: 'product',
          include: [...ALL_TEST_GLOBS],
          exclude: [...COMMON_TEST_EXCLUDE, ...PRODUCT_TEST_EXCLUDE],
          coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'json'],
            clean: false,
            excludeAfterRemap: true,
            exclude: productCoverageExclude,
          },
        },
      },
      {
        ...sharedProjectConfig,
        test: {
          ...sharedTestOptions,
          name: 'demo',
          include: [...DEMO_TEST_GLOBS],
          retry: 0,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'json'],
            clean: true,
            excludeAfterRemap: true,
            exclude: demoCoverageExclude,
          },
        },
      },
    ],
  },
});
