import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');

const UTILS_SEARCH_BASES = [
  'src/features/graphql/utils',
  'src/utils',
  'src/shared/utils',
] as const;

function resolveUtilsModule(subpath: string): string | undefined {
  for (const base of UTILS_SEARCH_BASES) {
    for (const ext of ['.ts', '.tsx'] as const) {
      const candidate = resolve(ROOT, base, `${subpath}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function resolveFeatureModule(
  featureDir: string,
  subpath: string,
): string | undefined {
  for (const ext of ['.ts', '.tsx'] as const) {
    const candidate = resolve(ROOT, featureDir, `${subpath}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Maps demo-hub root-absolute imports (`/selectors`, `/utils/foo`, …) to src files. */
export function resolveDemoHubRootImport(id: string): string | undefined {
  if (!id.startsWith('/') || id.startsWith('//')) return undefined;

  if (id === '/selectors') {
    return resolve(ROOT, 'src/shared/selectors.ts');
  }

  if (id === '/types') {
    return resolve(ROOT, 'src/shared/types/index.ts');
  }

  if (id.startsWith('/types/')) {
    const sub = id.slice('/types/'.length);
    return resolveFeatureModule('src/shared/types', sub);
  }

  if (id.startsWith('/utils/')) {
    return resolveUtilsModule(id.slice('/utils/'.length));
  }

  if (id.startsWith('/hooks/')) {
    return resolveFeatureModule('src/features/graphql/hooks', id.slice('/hooks/'.length));
  }

  if (id.startsWith('/kafka/')) {
    return resolveFeatureModule('src/features/kafka', id.slice('/kafka/'.length));
  }

  return undefined;
}

/** Vite / Vitest plugin — resolves demo-hub `/…` imports to monorepo src paths. */
export function demoHubRootImportsPlugin(): Plugin {
  return {
    name: 'demo-hub-root-imports',
    enforce: 'pre',
    resolveId(source) {
      const resolved = resolveDemoHubRootImport(source);
      return resolved ?? null;
    },
  };
}
