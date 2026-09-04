/**
 * buildMockMap.ts — Phase 3E (task 3E-13)
 *
 * Converts our `GraphqlMockConfig.resolvers` map and `scalarFactories` array
 * into the `IMocks` format expected by `@graphql-tools/mock`.
 *
 * Resolver modes:
 *  - random  → field omitted from IMocks (graphql-tools generates random data)
 *  - fixed   → field returns the configured scalar value
 *  - script  → field calls mockScriptRunner with the user's script
 *  - error   → field returns a new Error (triggers GraphQL field error)
 *
 * Scalar factory modes (applied per named scalar type):
 *  - preset  → built-in lightweight generator (no faker.js)
 *  - script  → calls mockScriptRunner with user's custom expression
 */

import type { IMocks } from '@graphql-tools/mock';
import type { MockResolver, MockScalarFactory, MockScalarPreset } from '../../src/shared/types/graphql.js';
import { runMockScript } from './mockScriptRunner.js';
import { toErrorMessage } from '../../src/shared/utils/helpers.js';

// ─── Scalar preset generators ────────────────────────────────────────────────
// All built-in; no faker.js or other runtime dependency.

let _emailCounter = 0;
let _uuidCounter  = 0;

const PRESET_GENERATORS: Record<MockScalarPreset, () => string> = {
  'email':    () => `user${++_emailCounter}@example.com`,
  'date-iso': () => new Date(Date.now() - Math.floor(Math.random() * 86400_000 * 365)).toISOString(),
  'uuid':     () => {
    _uuidCounter++;
    // Deterministic-ish UUID v4 format without crypto.randomUUID (not always available)
    const hex = _uuidCounter.toString(16).padStart(8, '0');
    return `${hex}-0000-4000-a000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`;
  },
  'url':      () => `https://example.com/resource/${Math.floor(Math.random() * 1000)}`,
  'phone':    () => `+1${Math.floor(2000000000 + Math.random() * 8000000000).toString().slice(0, 10)}`,
  'name':     () => {
    const first = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi'];
    const last  = ['Smith', 'Jones', 'Brown', 'White', 'Davis', 'Martin', 'Garcia'];
    return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
  },
  'sentence': () => {
    const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];
    const len = 4 + Math.floor(Math.random() * 5);
    return words.sort(() => Math.random() - 0.5).slice(0, len).join(' ') + '.';
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build an `IMocks` object from our resolver config and scalar factories.
 *
 * @param resolvers      — typeName → fieldName → MockResolver
 * @param scalarFactories — optional per-scalar type override factories
 */
export function buildMockMap(
  resolvers: Record<string, Record<string, MockResolver>>,
  scalarFactories?: MockScalarFactory[],
): IMocks {
  const mocks: IMocks = {};

  // ── Field resolver overrides ──────────────────────────────────────────────
  for (const [typeName, fields] of Object.entries(resolvers)) {
    // @graphql-tools/mock calls field mock functions with (fieldArgs) as the first argument.
    // We type the map accordingly so script resolvers can forward args to scripts.
    const typeResolvers: Record<string, (fieldArgs?: Record<string, unknown>) => unknown> = {};
    let hasOverride = false;

    for (const [fieldName, resolver] of Object.entries(fields)) {
      if (resolver.type === 'random') {
        // Omit from IMocks — graphql-tools will auto-generate random data
        continue;
      }

      if (resolver.type === 'fixed') {
        const val = resolver.value;
        typeResolvers[fieldName] = () => val;
        hasOverride = true;
      } else if (resolver.type === 'script') {
        const code = resolver.code;
        // Accept fieldArgs so scripts can read query arguments via the `args` context key.
        typeResolvers[fieldName] = (fieldArgs?: Record<string, unknown>) => {
          try {
            return runMockScript(code, {
              field:    fieldName,
              typeName,
              args:     fieldArgs ?? {},
              log:      console.log,
            });
          } catch (err) {
            throw new Error(`Mock script error on ${typeName}.${fieldName}: ${toErrorMessage(err)}`, { cause: err });
          }
        };
        hasOverride = true;
      } else if (resolver.type === 'error') {
        const msg = resolver.message;
        // Spec 3E-13: "return new Error(msg)" — GraphQL.js treats a returned Error
        // the same as a thrown one (field error), but return semantics match the spec.
        typeResolvers[fieldName] = () => new Error(msg || `Mock error for ${typeName}.${fieldName}`);
        hasOverride = true;
      }
    }

    if (hasOverride) {
      mocks[typeName] = () => typeResolvers;
    }
  }

  // ── Custom scalar factories ────────────────────────────────────────────────
  if (scalarFactories) {
    for (const factory of scalarFactories) {
      const { scalarName, preset, scriptCode } = factory;
      if (preset && PRESET_GENERATORS[preset]) {
        const gen = PRESET_GENERATORS[preset];
        mocks[scalarName] = gen;
      } else if (scriptCode) {
        mocks[scalarName] = () => {
          try {
            return runMockScript(scriptCode, {
              field:    scalarName,
              typeName: 'Scalar',
              args:     {},
              log:      console.log,
            });
          } catch (err) {
            // Consistent with field script errors: throw so GraphQL returns a field error
            // rather than silently returning an error string as the scalar value.
            throw new Error(`Mock scalar script error on ${scalarName}: ${toErrorMessage(err)}`, { cause: err });
          }
        };
      }
    }
  }

  return mocks;
}
