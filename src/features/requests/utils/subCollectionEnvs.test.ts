import { describe, it, expect } from 'vitest';
import {
  resolveCollectionBaseUrls,
  usedSubColEnvIds,
  collectSubCollections,
  usedEnvIdsInCollection,
  computeEligibleSubColEnvs,
  getSubColAddBlockReason,
  resolveSubColBoundEnvId,
  subColAddDisabledTitle,
  SUB_COL_ALL_USED_TITLE,
  SUB_COL_NO_BASE_URLS_TITLE,
  type NamedEnv,
} from './subCollectionEnvs';
import type { RequestCollection, RequestFolder, Microservice } from '@shared/types';

const envs: NamedEnv[] = [
  { id: 'e-dev', name: 'dev' },
  { id: 'e-stg', name: 'staging' },
  { id: 'e-prod', name: 'prod' },
];

function collection(overrides: Partial<RequestCollection> = {}): RequestCollection {
  return {
    id: 'c1',
    name: 'Coll',
    mode: 'multi-env',
    requests: [],
    ...overrides,
  };
}

function subCol(overrides: Partial<RequestFolder> = {}): RequestFolder {
  return {
    id: 'f1',
    name: 'sub',
    requests: [],
    folders: [],
    isSubCollection: true,
    ...overrides,
  };
}

describe('resolveCollectionBaseUrls', () => {
  it('returns empty for non-multi-env collections', () => {
    expect(resolveCollectionBaseUrls(collection({ mode: 'direct' }), envs, [])).toEqual({});
    expect(resolveCollectionBaseUrls(collection({ mode: 'group' }), envs, [])).toEqual({});
  });

  it('returns the collection baseUrls for None (manual) collections', () => {
    const col = collection({ baseUrls: { 'e-dev': 'https://dev.x', 'e-prod': 'https://prod.x' } });
    expect(resolveCollectionBaseUrls(col, envs, [])).toEqual({
      'e-dev': 'https://dev.x',
      'e-prod': 'https://prod.x',
    });
  });

  it('returns empty when manual collection has no baseUrls', () => {
    expect(resolveCollectionBaseUrls(collection(), envs, [])).toEqual({});
  });

  it('maps microservice base URLs by env name for linked collections', () => {
    const svc: Microservice = {
      id: 'svc1',
      name: 'Orders',
      baseUrls: { 'e-dev': 'https://svc-dev', 'e-prod': 'https://svc-prod' },
    };
    const col = collection({ microserviceId: 'svc1' });
    expect(resolveCollectionBaseUrls(col, envs, [svc])).toEqual({
      'e-dev': 'https://svc-dev',
      'e-prod': 'https://svc-prod',
    });
  });

  it('remaps microservice env ids to Settings env ids by name', () => {
    // microservice uses a *different* id for the same-named env
    const svc: Microservice = {
      id: 'svc1',
      name: 'Orders',
      baseUrls: { 'svc-internal-dev': 'https://svc-dev' },
      customEnvs: [{ id: 'svc-internal-dev', name: 'dev' } as NamedEnv as never],
    };
    const col = collection({ microserviceId: 'svc1' });
    expect(resolveCollectionBaseUrls(col, envs, [svc])).toEqual({ 'e-dev': 'https://svc-dev' });
  });

  it('skips microservice envs with no matching Settings env or empty url', () => {
    const svc: Microservice = {
      id: 'svc1',
      name: 'Orders',
      baseUrls: { 'e-dev': 'https://svc-dev', 'unknown': 'https://x', 'e-prod': '' },
    };
    const col = collection({ microserviceId: 'svc1' });
    expect(resolveCollectionBaseUrls(col, envs, [svc])).toEqual({ 'e-dev': 'https://svc-dev' });
  });

  it('skips custom microservice envs whose names do not map to Settings env names', () => {
    const svc: Microservice = {
      id: 'svc1',
      name: 'Orders',
      baseUrls: { 'svc-qa': 'https://svc-qa' },
      customEnvs: [{ id: 'svc-qa', name: 'qa' } as NamedEnv as never],
    };
    const col = collection({ microserviceId: 'svc1' });
    expect(resolveCollectionBaseUrls(col, envs, [svc])).toEqual({});
  });

  it('returns empty when linked microservice is missing', () => {
    const col = collection({ microserviceId: 'gone' });
    expect(resolveCollectionBaseUrls(col, envs, [])).toEqual({});
  });

  it('returns empty when a linked collection has no microservice list', () => {
    const col = collection({ microserviceId: 'svc1' });
    expect(resolveCollectionBaseUrls(col, envs, undefined)).toEqual({});
  });
});

describe('usedSubColEnvIds', () => {
  it('collects explicit selectedEnvId from sibling sub-collections', () => {
    const siblings = [subCol({ id: 'a', selectedEnvId: 'e-dev' }), subCol({ id: 'b', selectedEnvId: 'e-prod' })];
    expect([...usedSubColEnvIds(siblings, envs)]).toEqual(['e-dev', 'e-prod']);
  });

  it('resolves selectedEnvId stored as an environment name', () => {
    const siblings = [subCol({ id: 'a', name: 'Dev folder', selectedEnvId: 'dev' })];
    expect([...usedSubColEnvIds(siblings, envs)]).toEqual(['e-dev']);
  });

  it('falls back to folder name when selectedEnvId is stale', () => {
    const siblings = [subCol({ id: 'a', name: 'staging', selectedEnvId: 'legacy-stg' })];
    expect([...usedSubColEnvIds(siblings, envs)]).toEqual(['e-stg']);
  });

  it('falls back to name match for legacy sub-collections without selectedEnvId', () => {
    const siblings = [subCol({ id: 'a', name: 'Staging' })];
    expect([...usedSubColEnvIds(siblings, envs)]).toEqual(['e-stg']);
  });

  it('resolveSubColBoundEnvId prefers Settings id then name then folder name', () => {
    expect(resolveSubColBoundEnvId(subCol({ selectedEnvId: 'e-prod' }), envs)).toBe('e-prod');
    expect(resolveSubColBoundEnvId(subCol({ selectedEnvId: 'staging' }), envs)).toBe('e-stg');
    expect(resolveSubColBoundEnvId(subCol({ name: 'dev', selectedEnvId: 'gone' }), envs)).toBe('e-dev');
    expect(resolveSubColBoundEnvId(subCol({ name: 'orphan' }), envs)).toBeUndefined();
  });

  it('ignores non-sub-collection folders and the excluded folder', () => {
    const siblings = [
      subCol({ id: 'a', selectedEnvId: 'e-dev' }),
      { ...subCol({ id: 'b', selectedEnvId: 'e-prod' }), isSubCollection: false },
      subCol({ id: 'self', selectedEnvId: 'e-stg' }),
    ];
    expect([...usedSubColEnvIds(siblings, envs, 'self')]).toEqual(['e-dev']);
  });

  it('ignores legacy sub-collection names that do not match any environment', () => {
    const siblings = [subCol({ id: 'a', name: 'does-not-match-any-env' })];
    expect([...usedSubColEnvIds(siblings, envs)]).toEqual([]);
  });
});

describe('collectSubCollections / usedEnvIdsInCollection', () => {
  it('collects sub-collections recursively and ignores regular folders', () => {
    const folders: RequestFolder[] = [
      {
        id: 'root-regular',
        name: 'Regular',
        isSubCollection: false,
        requests: [],
        folders: [
          { id: 'nested-sub', name: 'dev', isSubCollection: true, requests: [], folders: [] },
          { id: 'nested-regular', name: 'Nested Regular', isSubCollection: false, requests: [], folders: [] },
        ],
      },
      { id: 'root-sub', name: 'staging', isSubCollection: true, requests: [], folders: [] },
    ];

    expect(collectSubCollections(folders).map(f => f.id)).toEqual(['nested-sub', 'root-sub']);
  });

  it('returns used env ids across whole collection and supports exclude id', () => {
    const col = collection({
      folders: [
        { id: 'f-dev', name: 'dev', isSubCollection: true, selectedEnvId: 'e-dev', requests: [], folders: [] },
        {
          id: 'f-wrap',
          name: 'Wrapper',
          isSubCollection: false,
          requests: [],
          folders: [{ id: 'f-legacy', name: 'prod', isSubCollection: true, requests: [], folders: [] }],
        },
      ],
    });

    expect([...usedEnvIdsInCollection(col, envs)]).toEqual(['e-dev', 'e-prod']);
    expect([...usedEnvIdsInCollection(col, envs, 'f-dev')]).toEqual(['e-prod']);
  });

  it('returns empty used env set when collection folders are absent', () => {
    const col = collection({ folders: undefined as unknown as RequestFolder[] });
    expect([...usedEnvIdsInCollection(col, envs)]).toEqual([]);
  });
});

describe('computeEligibleSubColEnvs', () => {
  it('returns empty for non-multi-env collections', () => {
    expect(computeEligibleSubColEnvs(collection({ mode: 'direct' }), envs, [])).toEqual([]);
  });

  it('lists envs with a configured base URL, in environments order', () => {
    const col = collection({ baseUrls: { 'e-prod': 'https://p', 'e-dev': 'https://d' } });
    expect(computeEligibleSubColEnvs(col, envs, [])).toEqual([
      { id: 'e-dev', name: 'dev' },
      { id: 'e-prod', name: 'prod' },
    ]);
  });

  it('excludes envs already used by any sub-collection in the collection (one-per-env)', () => {
    const col = collection({
      baseUrls: { 'e-dev': 'https://d', 'e-prod': 'https://p' },
      folders: [subCol({ id: 'a', selectedEnvId: 'e-dev' })],
    });
    expect(computeEligibleSubColEnvs(col, envs, [])).toEqual([
      { id: 'e-prod', name: 'prod' },
    ]);
  });

  it('excludes a nested sub-collection env when adding at the collection root', () => {
    const col = collection({
      baseUrls: { 'e-dev': 'https://d', 'e-prod': 'https://p' },
      folders: [{
        id: 'wrap',
        name: 'Regular',
        isSubCollection: false,
        requests: [],
        folders: [subCol({ id: 'nested', name: 'dev' })],
      }],
    });
    expect(computeEligibleSubColEnvs(col, envs, [])).toEqual([
      { id: 'e-prod', name: 'prod' },
    ]);
  });

  it('returns empty when no env has a configured base URL', () => {
    expect(computeEligibleSubColEnvs(collection(), envs, [])).toEqual([]);
  });

  it('works for linked-microservice collections', () => {
    const svc: Microservice = {
      id: 'svc1',
      name: 'Orders',
      baseUrls: { 'e-dev': 'https://svc-dev', 'e-stg': 'https://svc-stg' },
    };
    const col = collection({
      microserviceId: 'svc1',
      folders: [subCol({ id: 'a', selectedEnvId: 'e-stg' })],
    });
    expect(computeEligibleSubColEnvs(col, envs, [svc])).toEqual([
      { id: 'e-dev', name: 'dev' },
    ]);
  });
});

describe('getSubColAddBlockReason', () => {
  it('returns no-base-urls when the collection has no configured hosts', () => {
    expect(getSubColAddBlockReason(collection({ mode: 'direct' }), envs, [])).toBe('no-base-urls');
    expect(getSubColAddBlockReason(collection({ mode: 'multi-env' }), envs, [])).toBe('no-base-urls');
  });

  it('returns all-used when every configured env already has a sub-collection', () => {
    const col = collection({
      baseUrls: { 'e-dev': 'https://d', 'e-prod': 'https://p' },
      folders: [
        subCol({ id: 'a', name: 'dev', selectedEnvId: 'e-dev' }),
        subCol({ id: 'b', name: 'prod', selectedEnvId: 'e-prod' }),
      ],
    });
    expect(getSubColAddBlockReason(col, envs, [])).toBe('all-used');
    expect(computeEligibleSubColEnvs(col, envs, [])).toEqual([]);
  });

  it('returns null when at least one env is still free', () => {
    const col = collection({ baseUrls: { 'e-dev': 'https://d' } });
    expect(getSubColAddBlockReason(col, envs, [])).toBeNull();
  });

  it('maps block reasons to menu titles', () => {
    expect(subColAddDisabledTitle(null)).toBeUndefined();
    expect(subColAddDisabledTitle('no-base-urls')).toBe(SUB_COL_NO_BASE_URLS_TITLE);
    expect(subColAddDisabledTitle('all-used')).toBe(SUB_COL_ALL_USED_TITLE);
  });
});
