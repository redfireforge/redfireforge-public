import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LESSONS_ROOT = join(process.cwd(), 'packages/demo-hub/src/lessons');
const DEMO_PLAYER_ROOT = join(process.cwd(), 'packages/demo-hub/src');
const ADAPTERS_ROOT = join(process.cwd(), 'packages/demo-hub/src/adapters');

const FORBIDDEN_PATTERNS = [
  /from ['"][^'"]*features\/graphql\/hooks\//,
  /from ['"][^'"]*features\/grpc\//,
  /from ['"][^'"]*app\/hooks\/useDemo/,
  /from ['"][^'"]*graphql\/utils\//,
  /await import\(['"][^'"]*graphql\/utils\//,
];

/** High-churn lesson modules migrated in Phase 5 — must not import product internals directly. */
const MIGRATED_REL_PATHS = new Set([
  'protocols/graphql-lesson-helpers/gql-demo-tab.ts',
  'protocols/graphql-lesson-helpers/lesson6-auth-headers.ts',
  'protocols/graphql-lesson-helpers/lesson14-multi-tab.ts',
  'protocols/graphql-lesson-helpers/lesson-https-tls.ts',
  'protocols/graphql-lesson-helpers/lesson11-workflow-integration.ts',
  'protocols/graphql-lesson-helpers/lesson13-mock-server-session.ts',
  'wf-demo-helpers.ts',
  'gql-demo-storage-cleanup.ts',
  'gql-demo-app-environment-cleanup.ts',
  'protocols/graphql-lesson-helpers/lesson12-schema-diff.ts',
  'protocols/graphql-lesson-helpers/lesson17-workflow-runner.ts',
  'protocols/graphql-lesson-helpers/lesson18-workflow-mutation.ts',
  'protocols/graphql-lesson-helpers/lesson19-workflow-subscription.ts',
  'protocols/kafka-workflow-produce.ts',
  'protocols/kafka-workflow-consume-wait.ts',
  'protocols/kafka-test-runner.ts',
  'protocols/ws-test-runner.ts',
  'protocols/ws-workflow-builder.ts',
  'protocols/grpc-lesson-helpers/lifecycle.ts',
  'protocols/grpc-lesson-helpers/constants.ts',
  'grpc-demo-storage-cleanup.ts',
]);

const RAW_WF_BRIDGE_PATTERN = /(?:\(window as unknown[^)]*\)|\bwin)\.__wf[A-Z]/;

function collectTsSources(dir: string, acc: string[] = [], skipAdapters = false): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipAdapters && entry === 'adapters') continue;
      collectTsSources(full, acc, skipAdapters);
      continue;
    }
    if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx') && !entry.endsWith('.testHelpers.ts') && !entry.endsWith('.testHelpers.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

function collectLessonSources(dir: string, acc: string[] = []): string[] {
  return collectTsSources(dir, acc);
}

describe('demo lesson adapter import audit', () => {
  it('no lesson file imports forbidden graphql hooks paths', () => {
    const violations: string[] = [];
    for (const file of collectLessonSources(LESSONS_ROOT)) {
      const content = readFileSync(file, 'utf8');
      const rel = relative(LESSONS_ROOT, file);
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(rel);
          break;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('demo-player core (outside adapters/lessons) avoids forbidden product imports', () => {
    const violations: string[] = [];
    for (const file of collectTsSources(DEMO_PLAYER_ROOT, [], true)) {
      const rel = relative(DEMO_PLAYER_ROOT, file);
      if (rel.startsWith('lessons/') || rel.startsWith('adapters/')) continue;
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(rel);
          break;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('Phase 5 migrated modules import from adapters', () => {
    const missing: string[] = [];
    for (const rel of MIGRATED_REL_PATHS) {
      const full = join(LESSONS_ROOT, rel);
      const content = readFileSync(full, 'utf8');
      if (!/from ['"][^'"]*adapters['"]/.test(content)) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it('grpc roster does not import adapters (production chunk cycle)', () => {
    const roster = readFileSync(
      join(LESSONS_ROOT, 'protocols/grpc-lesson-contract/roster.ts'),
      'utf8',
    );
    const fixtures = readFileSync(
      join(LESSONS_ROOT, 'protocols/grpc-lesson-contract/rosterFixtures.ts'),
      'utf8',
    );
    expect(roster).not.toMatch(/from ['"][^'"]*adapters/);
    expect(fixtures).not.toMatch(/from ['"][^'"]*adapters/);
  });

  it('adapter modules do not import demo-player lessons', () => {
    const violations: string[] = [];
    for (const file of collectLessonSources(ADAPTERS_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (/from ['"][^'"]*demo-player\/lessons/.test(content)) {
        violations.push(relative(ADAPTERS_ROOT, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('no lesson source file uses raw window workflow bridges', () => {
    const violations: string[] = [];
    for (const file of collectLessonSources(LESSONS_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (RAW_WF_BRIDGE_PATTERN.test(content)) {
        violations.push(relative(LESSONS_ROOT, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
