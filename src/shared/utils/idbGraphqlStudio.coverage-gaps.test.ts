/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  GQL_SCHEMA_CACHE_PREFIX,
  idbClearPageAuthRaw,
  idbGetSchemaCacheRaw,
  idbLoadConnectionProfiles,
  idbLoadPageAuthRaw,
  idbLoadStudioEnvironments,
  idbLoadTabsPersisted,
  idbMigrateSchemaCacheFromLocalStorage,
  idbMigrateTabsFromLocalStorage,
  idbSaveConnectionProfiles,
  idbSavePageAuthRaw,
  idbSaveStudioEnvironments,
  idbSaveTabsPersisted,
  idbSetSchemaCacheRaw,
  migrateGraphqlStudioFromLocalStorage,
  purgeGraphqlStudioLocalStorageDuplicates,
} from './idbGraphqlStudio';
import { DB_NAME, resetIdbOpenStateForTests } from './idbOpen';

vi.mock('./platform', () => ({ isTauri: () => false }));

async function resetGraphqlStudioIdb(): Promise<void> {
  localStorage.clear();
  resetIdbOpenStateForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  resetIdbOpenStateForTests();
}

describe('idbGraphqlStudio — coverage gaps', () => {
  beforeEach(async () => {
    await resetGraphqlStudioIdb();
  });

  afterEach(async () => {
    vi.doUnmock('./idbHelpers');
    await resetGraphqlStudioIdb();
  });

  it('idbMigrateTabsFromLocalStorage returns false when no data', async () => {
    expect(await idbMigrateTabsFromLocalStorage('missing', 'missing_active')).toBe(false);
  });

  it('idbMigrateTabsFromLocalStorage returns false for non-array JSON', async () => {
    localStorage.setItem('gql_tabs_v1', JSON.stringify({ not: 'array' }));
    expect(await idbMigrateTabsFromLocalStorage('gql_tabs_v1', 'gql_tabs_v1_active')).toBe(false);
  });

  it('idbMigrateTabsFromLocalStorage returns false for invalid JSON', async () => {
    localStorage.setItem('gql_tabs_v1', '{bad');
    expect(await idbMigrateTabsFromLocalStorage('gql_tabs_v1', 'gql_tabs_v1_active')).toBe(false);
  });

  it('saves and loads page auth, environments, and profiles', async () => {
    await idbSavePageAuthRaw('{"type":"none"}');
    expect(await idbLoadPageAuthRaw()).toBe('{"type":"none"}');

    await idbSaveStudioEnvironments([{ id: 'e1', name: 'Dev', variables: [] }]);
    expect(await idbLoadStudioEnvironments()).toHaveLength(1);

    await idbSaveConnectionProfiles([{ id: 'p1', name: 'Local', endpoint: 'http://x', createdAt: 1 }]);
    expect(await idbLoadConnectionProfiles()).toHaveLength(1);
  });

  it('idbClearPageAuthRaw removes stored auth', async () => {
    await idbSavePageAuthRaw('auth');
    await idbClearPageAuthRaw();
    expect(await idbLoadPageAuthRaw()).toBeNull();
  });

  it('idbGetSchemaCacheRaw returns null for missing key', async () => {
    expect(await idbGetSchemaCacheRaw('missing')).toBeNull();
  });

  it('idbSetSchemaCacheRaw and idbGetSchemaCacheRaw round-trip', async () => {
    const key = `${GQL_SCHEMA_CACHE_PREFIX}test`;
    await idbSetSchemaCacheRaw(key, '{"hash":1}');
    expect(await idbGetSchemaCacheRaw(key)).toBe('{"hash":1}');
  });

  it('idbGetSchemaCacheRaw returns null when stored value is not a string', async () => {
    const { idbSetSchemaCacheRaw, idbGetSchemaCacheRaw } = await import('./idbGraphqlStudio');
    // Manually put non-string via IDB is hard; empty get covers missing path
    expect(await idbGetSchemaCacheRaw('definitely-missing-key')).toBeNull();
    await idbSetSchemaCacheRaw(`${GQL_SCHEMA_CACHE_PREFIX}str`, '{"ok":true}');
    expect(await idbGetSchemaCacheRaw(`${GQL_SCHEMA_CACHE_PREFIX}str`)).toBe('{"ok":true}');
  });

  it('idbMigrateTabsFromLocalStorage returns false when idb unavailable', async () => {
    vi.resetModules();
    vi.doMock('./idbHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./idbHelpers')>();
      return { ...actual, idbAvailable: () => false };
    });
    const mod = await import('./idbGraphqlStudio');
    expect(await mod.idbMigrateTabsFromLocalStorage('gql_tabs_v1', 'gql_tabs_v1_active')).toBe(false);
    vi.doUnmock('./idbHelpers');
    vi.resetModules();
  });

  it('purgeGraphqlStudioLocalStorageDuplicates removes LS when IDB has data', async () => {
    await idbSaveStudioEnvironments([{ id: 'e1', name: 'Dev', variables: [] }]);
    await idbSaveTabsPersisted([], 'tab-1');
    await idbSavePageAuthRaw('{"type":"none"}');
    await idbSaveConnectionProfiles([{ id: 'p1', name: 'Local', endpoint: 'http://x', createdAt: 1 }]);
    localStorage.setItem('gql_environments_v1', '[]');
    localStorage.setItem('gql_tabs_v1', '[]');
    localStorage.setItem('gql_tabs_v1_active', 'tab-1');
    localStorage.setItem('gql_auth_v1', '{}');
    localStorage.setItem('gql_profiles_v1', '[]');

    const keys = {
      tabsKey: 'gql_tabs_v1',
      tabsActiveKey: 'gql_tabs_v1_active',
      authKey: 'gql_auth_v1',
      environmentsKey: 'gql_environments_v1',
      profilesKey: 'gql_profiles_v1',
    };

    expect(await idbLoadStudioEnvironments()).not.toBeNull();
    expect(await idbLoadPageAuthRaw()).not.toBeNull();
    expect(await idbLoadConnectionProfiles()).not.toBeNull();
    expect(await idbLoadTabsPersisted()).not.toBeNull();

    const removed = await purgeGraphqlStudioLocalStorageDuplicates(keys);
    expect(removed).toBeGreaterThanOrEqual(3);
    expect(localStorage.getItem('gql_environments_v1')).toBeNull();
    expect(localStorage.getItem('gql_auth_v1')).toBeNull();
    expect(localStorage.getItem('gql_profiles_v1')).toBeNull();
  });

  it('idbMigrateTabsFromLocalStorage migrates valid tabs and active id', async () => {
    localStorage.setItem('gql_tabs_v1', JSON.stringify([{ id: 't1', name: 'Tab' }]));
    localStorage.setItem('gql_tabs_v1_active', 't1');
    expect(await idbMigrateTabsFromLocalStorage('gql_tabs_v1', 'gql_tabs_v1_active')).toBe(true);
    expect(localStorage.getItem('gql_tabs_v1')).toBeNull();
    const loaded = await idbLoadTabsPersisted();
    expect(loaded?.tabs).toHaveLength(1);
    expect(loaded?.activeId).toBe('t1');
  });

  it('idbMigrateTabsFromLocalStorage uses an empty active id when none is stored', async () => {
    localStorage.setItem('gql_tabs_v1', JSON.stringify([{ id: 't1', name: 'Tab' }]));
    expect(await idbMigrateTabsFromLocalStorage('gql_tabs_v1', 'gql_tabs_v1_active')).toBe(true);
    const loaded = await idbLoadTabsPersisted();
    expect(loaded?.activeId).toBe('');
  });

  it('idbClearPageAuthRaw returns early when idb unavailable', async () => {
    vi.resetModules();
    vi.doMock('./idbHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./idbHelpers')>();
      return { ...actual, idbAvailable: () => false };
    });
    const mod = await import('./idbGraphqlStudio');
    await mod.idbSavePageAuthRaw('auth');
    await mod.idbClearPageAuthRaw();
    expect(await mod.idbLoadPageAuthRaw()).toBe('auth');
    vi.doUnmock('./idbHelpers');
    vi.resetModules();
  });

  it('idbMigrateSchemaCacheFromLocalStorage moves gql_schema_v1_* keys to IDB', async () => {
    const key = `${GQL_SCHEMA_CACHE_PREFIX}migrate-test`;
    localStorage.setItem(key, '{"hash":1}');
    localStorage.setItem(`${GQL_SCHEMA_CACHE_PREFIX}empty`, '');
    expect(await idbMigrateSchemaCacheFromLocalStorage()).toBe(1);
    expect(localStorage.getItem(key)).toBeNull();
    expect(await idbGetSchemaCacheRaw(key)).toBe('{"hash":1}');
  });

  it('idbMigrateSchemaCacheFromLocalStorage returns 0 when idb unavailable', async () => {
    vi.resetModules();
    vi.doMock('./idbHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./idbHelpers')>();
      return { ...actual, idbAvailable: () => false };
    });
    localStorage.setItem(`${GQL_SCHEMA_CACHE_PREFIX}offline`, '{"hash":1}');
    const mod = await import('./idbGraphqlStudio');
    expect(await mod.idbMigrateSchemaCacheFromLocalStorage()).toBe(0);
    vi.doUnmock('./idbHelpers');
    vi.resetModules();
  });

  it('migrateGraphqlStudioFromLocalStorage runs all migrations on web', async () => {
    localStorage.setItem('gql_tabs_v1', JSON.stringify([]));
    localStorage.setItem('gql_auth_v1', '"token"');
    localStorage.setItem('gql_environments_v1', JSON.stringify([{ id: 'e1', name: 'Dev', variables: [] }]));
    localStorage.setItem('gql_profiles_v1', JSON.stringify([{ id: 'p1', name: 'P', endpoint: 'http://x', createdAt: 1 }]));
    const result = await migrateGraphqlStudioFromLocalStorage({
      tabsKey: 'gql_tabs_v1',
      tabsActiveKey: 'gql_tabs_v1_active',
      authKey: 'gql_auth_v1',
      environmentsKey: 'gql_environments_v1',
      profilesKey: 'gql_profiles_v1',
    });
    expect(result.tabs).toBe(true);
    expect(result.environments).toBe(true);
    expect(result.profiles).toBe(true);
  });

  it('idbMigratePageAuthFromLocalStorage rejects non-string JSON', async () => {
    localStorage.setItem('gql_auth_v1', JSON.stringify({ type: 'bearer' }));
    const { idbMigratePageAuthFromLocalStorage } = await import('./idbGraphqlStudio');
    expect(await idbMigratePageAuthFromLocalStorage('gql_auth_v1')).toBe(false);
  });

  it('idbGetSchemaCacheRaw returns null when idb unavailable', async () => {
    vi.resetModules();
    vi.doMock('./idbHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./idbHelpers')>();
      return { ...actual, idbAvailable: () => false };
    });
    const mod = await import('./idbGraphqlStudio');
    expect(await mod.idbGetSchemaCacheRaw('missing')).toBeNull();
    await expect(mod.idbSetSchemaCacheRaw('k', 'v')).rejects.toThrow('IndexedDB not available');
    vi.doUnmock('./idbHelpers');
    vi.resetModules();
  });

  it('idbGetSchemaCacheRaw returns null when IDB read throws', async () => {
    vi.resetModules();
    vi.doMock('./idbHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./idbHelpers')>();
      return {
        ...actual,
        getObjectStore: vi.fn(async () => { throw new Error('idb down'); }),
      };
    });
    const mod = await import('./idbGraphqlStudio');
    expect(await mod.idbGetSchemaCacheRaw('missing')).toBeNull();
    vi.doUnmock('./idbHelpers');
    vi.resetModules();
  });

  it('idbMigrateStudioEnvironmentsFromLocalStorage rejects non-array payloads', async () => {
    localStorage.setItem('gql_environments_v1', JSON.stringify({ not: 'array' }));
    const { idbMigrateStudioEnvironmentsFromLocalStorage } = await import('./idbGraphqlStudio');
    expect(await idbMigrateStudioEnvironmentsFromLocalStorage('gql_environments_v1')).toBe(false);
  });

  it('idbMigrateConnectionProfilesFromLocalStorage rejects non-array payloads', async () => {
    localStorage.setItem('gql_profiles_v1', JSON.stringify({ not: 'array' }));
    const { idbMigrateConnectionProfilesFromLocalStorage } = await import('./idbGraphqlStudio');
    expect(await idbMigrateConnectionProfilesFromLocalStorage('gql_profiles_v1')).toBe(false);
  });

  it('isValidTabsPersistedBlob guards tabs blob shape', async () => {
    const { isValidTabsPersistedBlob } = await import('./idbGraphqlStudio');
    expect(isValidTabsPersistedBlob(null)).toBe(false);
    expect(isValidTabsPersistedBlob({ tabs: [] })).toBe(true);
    expect(isValidTabsPersistedBlob({ tabs: 'nope' })).toBe(false);
  });

  it('idbGetSchemaCacheRaw returns null when the stored value is not a string', async () => {
    vi.resetModules();
    vi.doMock('./idbHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./idbHelpers')>();
      return {
        ...actual,
        getObjectStore: vi.fn(async () => ({ get: vi.fn(() => ({})) })),
        wrap: vi.fn(async () => ({ not: 'a string' })),
      };
    });
    const mod = await import('./idbGraphqlStudio');
    expect(await mod.idbGetSchemaCacheRaw('object-value')).toBeNull();
    vi.doUnmock('./idbHelpers');
    vi.resetModules();
  });

  it('purgeGraphqlStudioLocalStorageDuplicates skips LS key when IDB lacks data', async () => {
    localStorage.setItem('gql_auth_v1', '{"type":"none"}');
    const keys = {
      tabsKey: 'gql_tabs_v1',
      tabsActiveKey: 'gql_tabs_v1_active',
      authKey: 'gql_auth_v1',
      environmentsKey: 'gql_environments_v1',
      profilesKey: 'gql_profiles_v1',
    };
    const removed = await purgeGraphqlStudioLocalStorageDuplicates(keys);
    expect(removed).toBe(0);
    expect(localStorage.getItem('gql_auth_v1')).not.toBeNull();
  });

  it('purgeGraphqlStudioLocalStorageDuplicates removes active tab key when tabs already exist in IDB', async () => {
    await idbSaveTabsPersisted([{ id: 't1', name: 'Tab' }], 't1');
    localStorage.setItem('gql_tabs_v1_active', 't1');
    const keys = {
      tabsKey: 'gql_tabs_v1',
      tabsActiveKey: 'gql_tabs_v1_active',
      authKey: 'gql_auth_v1',
      environmentsKey: 'gql_environments_v1',
      profilesKey: 'gql_profiles_v1',
    };
    const removed = await purgeGraphqlStudioLocalStorageDuplicates(keys);
    expect(removed).toBe(1);
    expect(localStorage.getItem('gql_tabs_v1_active')).toBeNull();
  });
});

describe('idbGraphqlStudio — Tauri early exit', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('./platform', () => ({ isTauri: () => true }));
  });

  afterEach(() => {
    vi.doUnmock('./platform');
    vi.resetModules();
  });

  it('migrateGraphqlStudioFromLocalStorage no-ops on Tauri', async () => {
    const mod = await import('./idbGraphqlStudio');
    const result = await mod.migrateGraphqlStudioFromLocalStorage({
      tabsKey: 'gql_tabs_v1',
      tabsActiveKey: 'gql_tabs_v1_active',
      authKey: 'gql_auth_v1',
      environmentsKey: 'gql_environments_v1',
      profilesKey: 'gql_profiles_v1',
    });
    expect(result).toEqual({
      tabs: false,
      auth: false,
      environments: false,
      profiles: false,
      schemaEntries: 0,
    });
  });

  it('purgeGraphqlStudioLocalStorageDuplicates returns 0 on Tauri', async () => {
    const mod = await import('./idbGraphqlStudio');
    const removed = await mod.purgeGraphqlStudioLocalStorageDuplicates({
      tabsKey: 'gql_tabs_v1',
      tabsActiveKey: 'gql_tabs_v1_active',
      authKey: 'gql_auth_v1',
      environmentsKey: 'gql_environments_v1',
      profilesKey: 'gql_profiles_v1',
    });
    expect(removed).toBe(0);
  });
});
