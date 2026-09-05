/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { isTauriMock, tauriGetItem, tauriSetItem, tauriGetUsage } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  tauriGetItem: vi.fn(async (): Promise<string | null> => null),
  tauriSetItem: vi.fn(async () => {}),
  tauriGetUsage: vi.fn(async () => ({ usedBytes: 0, entries: {} as Record<string, number> })),
}));

vi.mock('./platform', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('./tauriStore', () => ({
  getItem: (key: string) => tauriGetItem(key),
  setItem: (key: string, value: string) => tauriSetItem(key, value),
  getUsageBytes: () => tauriGetUsage(),
}));

const { idbStore, appConfigStore, sharedDsStore } = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  return {
    idbStore: store,
    appConfigStore: {
      environments: null as import('../types').Environment[] | null,
      microservices: null as import('../types').Microservice[] | null,
      featureGroups: null as import('../types').FeatureGroup[] | null,
      globalAuthProfiles: null as import('../types').GlobalAuthProfile[] | null,
    },
    sharedDsStore: {
      data: null as import('../types').SharedDataSource[] | null,
    },
  };
});

let _idbInsertOrder = 0;

vi.mock('./idbTestRuns', () => {
  type TR = { id: string; timestamp?: number; _insertOrder?: number; [k: string]: unknown };
  const getRuns = (): TR[] => {
    const all = Object.values(idbStore) as TR[];
    all.sort((a, b) => {
      const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
      if (td !== 0) return td;
      return (b._insertOrder ?? 0) - (a._insertOrder ?? 0);
    });
    return all;
  };
  return {
    idbLoadTestRuns: vi.fn(async () => getRuns()),
    idbSaveTestRun: vi.fn(async (run: TR) => { idbStore[run.id] = { ...run, _insertOrder: ++_idbInsertOrder }; }),
    idbDeleteTestRun: vi.fn(async (id: string) => { delete idbStore[id]; }),
    idbSaveTestRunsBulk: vi.fn(async (runs: TR[]) => {
      for (const k of Object.keys(idbStore)) delete idbStore[k];
      for (const r of runs) idbStore[r.id] = { ...r, _insertOrder: ++_idbInsertOrder };
    }),
    idbPruneToMax: vi.fn(async (max: number) => {
      const all = getRuns();
      if (all.length <= max) return 0;
      const toDelete = all.slice(max);
      for (const r of toDelete) delete idbStore[r.id];
      return toDelete.length;
    }),
    idbMigrateFromLocalStorage: vi.fn(async () => false),
    idbGetRunsInfo: vi.fn(async () => {
      const all = getRuns();
      return { count: all.length, approxBytes: JSON.stringify(all).length * 2 };
    }),
    idbDeleteRunsOlderThan: vi.fn(async (cutoff: number) => {
      const all = getRuns();
      const toDelete = all.filter(r => (r.timestamp ?? 0) < cutoff);
      for (const r of toDelete) delete idbStore[r.id];
      return toDelete.length;
    }),
    idbClearAllRuns: vi.fn(async () => {
      for (const k of Object.keys(idbStore)) delete idbStore[k];
    }),
  };
});

vi.mock('./idbEnvironmentsMicroservices', () => ({
  idbLoadEnvironments: vi.fn(async () => appConfigStore.environments),
  idbSaveEnvironments: vi.fn(async (data: import('../types').Environment[]) => {
    appConfigStore.environments = data;
  }),
  idbMigrateEnvironments: vi.fn(async () => false),
  idbLoadMicroservices: vi.fn(async () => appConfigStore.microservices),
  idbSaveMicroservices: vi.fn(async (data: import('../types').Microservice[]) => {
    appConfigStore.microservices = data;
  }),
  idbMigrateMicroservices: vi.fn(async () => false),
}));

vi.mock('./idbFeatureGroups', () => ({
  idbLoadFeatureGroups: vi.fn(async () => appConfigStore.featureGroups),
  idbSaveFeatureGroups: vi.fn(async (data: import('../types').FeatureGroup[]) => {
    appConfigStore.featureGroups = data;
  }),
  idbMigrateFeatureGroups: vi.fn(async () => false),
}));

vi.mock('./idbGlobalAuthProfiles', () => ({
  idbLoadGlobalAuthProfiles: vi.fn(async () => appConfigStore.globalAuthProfiles),
  idbSaveGlobalAuthProfiles: vi.fn(async (data: import('../types').GlobalAuthProfile[]) => {
    appConfigStore.globalAuthProfiles = data;
  }),
  idbMigrateGlobalAuthProfiles: vi.fn(async () => false),
}));

vi.mock('./idbSharedDataSources', () => ({
  idbLoadSharedDataSources: vi.fn(async () => sharedDsStore.data),
  idbSaveSharedDataSources: vi.fn(async (data: import('../types').SharedDataSource[]) => {
    sharedDsStore.data = data;
  }),
  idbMigrateSharedDataSources: vi.fn(async () => false),
}));

import { migrateToFlat, loadEnvironments, migratePerFgSharedDataSourcesToTopLevel, saveFeatureGroups, loadFeatureGroups, saveSharedDataSources, loadSharedDataSources, } from './storage';
import { FeatureGroup, SharedDataSource, DataSource } from '../types';

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(idbStore)) delete idbStore[k];
  _idbInsertOrder = 0;
  appConfigStore.environments = null;
  appConfigStore.microservices = null;
  appConfigStore.featureGroups = null;
  appConfigStore.globalAuthProfiles = null;
  sharedDsStore.data = null;
  isTauriMock.mockReturnValue(false);
  tauriGetItem.mockReset();
  tauriGetItem.mockResolvedValue(null);
  tauriSetItem.mockReset();
  tauriSetItem.mockResolvedValue(undefined);
  tauriGetUsage.mockReset();
  tauriGetUsage.mockResolvedValue({ usedBytes: 0, entries: {} });
});

describe('storage — migration', () => {
  it('returns null when no legacy data and marks as migrated', async () => {
    expect(await migrateToFlat()).toBeNull();
  });

  it('migrates v2 project data to flat', async () => {
    const project = {
      id: 'p1', name: 'Test Project', createdAt: Date.now(),
      environments: [{ id: 'e1', name: 'test' }],
      microservices: [{ id: 's1', name: 'svc', baseUrls: { e1: 'http://api' } }],
      globalAuthProfiles: [{ id: 'a1', name: 'Auth', auth: { type: 'basic' } }],
      featureGroups: [{ id: 'f1', name: 'Feature', scenarios: [] }],
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([project]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    expect(result).toBeTruthy();
    expect(result!.environments).toHaveLength(1);
    expect(result!.microservices).toHaveLength(1);
    expect(result!.featureGroups).toHaveLength(1);
    expect(result!.globalAuthProfiles).toHaveLength(1);
    expect(result!.selectedEnvId).toBe('e1');
    expect(result!.selectedSvcId).toBe('s1');

    const envs = await loadEnvironments();
    expect(envs).toHaveLength(1);
    expect(envs[0].name).toBe('test');
  });

  it('migrates v1 legacy keys to flat', async () => {
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'test' }]));
    localStorage.setItem('perf-test-microservices', JSON.stringify([{ id: 's1', name: 'svc', baseUrls: {} }]));
    localStorage.setItem('perf-test-global-auth', JSON.stringify([{ id: 'g1', name: 'Auth', auth: { type: 'basic' } }]));
    localStorage.setItem('perf-test-features', JSON.stringify([{ id: 'f1', name: 'Feature', scenarios: [] }]));

    const result = await migrateToFlat();
    expect(result).toBeTruthy();
    expect(result!.environments).toHaveLength(1);
    expect(result!.microservices).toHaveLength(1);
    expect(result!.featureGroups).toHaveLength(1);
    expect(result!.globalAuthProfiles).toHaveLength(1);
  });

  it('does not re-migrate after first migration', async () => {
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'test' }]));
    await migrateToFlat();
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e2', name: 'prod' }]));
    const result = await migrateToFlat();
    expect(result).toBeNull();
  });

  it('strips projectId from legacy feature groups', async () => {
    localStorage.setItem('perf-test-features', JSON.stringify([
      { id: 'f1', name: 'FG', scenarios: [], projectId: 'old-project' },
    ]));
    const result = await migrateToFlat();
    expect(result!.featureGroups[0]).not.toHaveProperty('projectId');
  });
});

describe('storage — migration edge cases', () => {
  it('returns null for v1 legacy keys that only contain empty arrays', async () => {
    localStorage.setItem('perf-test-environments', '[]');
    localStorage.setItem('perf-test-microservices', '[]');
    localStorage.setItem('perf-test-global-auth', '[]');
    localStorage.setItem('perf-test-features', '[]');
    expect(await migrateToFlat()).toBeNull();
    expect(localStorage.getItem('perf-test-v3-migrated')).toBe('true');
  });

  it('merges unique data from multiple v2 projects (selected first)', async () => {
    const p1 = {
      id: 'p1',
      name: 'A',
      createdAt: 1,
      environments: [{ id: 'e1', name: 'only-p1' }],
      microservices: [{ id: 's1', name: 'svc1', baseUrls: {} }],
      globalAuthProfiles: [{ id: 'a1', name: 'auth1', auth: { type: 'basic' as const } }],
      featureGroups: [{ id: 'f1', name: 'FG1', scenarios: [] }],
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
    };
    const p2 = {
      id: 'p2',
      name: 'B',
      createdAt: 2,
      environments: [
        { id: 'e1', name: 'dup' },
        { id: 'e2', name: 'from-p2' },
      ],
      microservices: [
        { id: 's1', name: 'dup', baseUrls: {} },
        { id: 's2', name: 'svc2', baseUrls: {} },
      ],
      globalAuthProfiles: [
        { id: 'a1', name: 'dup', auth: { type: 'basic' as const } },
        { id: 'a2', name: 'auth2', auth: { type: 'basic' as const } },
      ],
      featureGroups: [{ id: 'f2', name: 'FG2', scenarios: [] }],
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([p1, p2]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    expect(result).toBeTruthy();
    expect(result!.environments.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(result!.microservices.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(result!.globalAuthProfiles.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(result!.featureGroups).toHaveLength(2);
    expect(result!.environments.find((e) => e.id === 'e1')!.name).toBe('only-p1');
  });

  it('falls back to first project when selected id is missing', async () => {
    const p2 = {
      id: 'p2',
      name: 'Second',
      createdAt: 2,
      environments: [{ id: 'e2', name: 'staging' }],
      microservices: [{ id: 's2', name: 'svc', baseUrls: { e2: 'http://x' } }],
      featureGroups: [],
      selectedEnvId: 'e2',
      selectedSvcId: 's2',
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([p2]));
    localStorage.setItem('perf-test-selected-project', 'missing-id');

    const result = await migrateToFlat();
    expect(result!.selectedEnvId).toBe('e2');
    expect(result!.selectedSvcId).toBe('s2');
  });

  it('falls through to v1 when v2 projects JSON is invalid', async () => {
    localStorage.setItem('perf-test-projects', '{');
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'legacy' }]));
    localStorage.setItem('perf-test-microservices', '[]');
    localStorage.setItem('perf-test-global-auth', '[]');
    localStorage.setItem('perf-test-features', '[]');

    const result = await migrateToFlat();
    expect(result).toBeTruthy();
    expect(result!.environments[0].name).toBe('legacy');
  });

  it('falls through to v1 when projects array is empty', async () => {
    localStorage.setItem('perf-test-projects', '[]');
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'legacy' }]));
    localStorage.setItem('perf-test-microservices', '[]');
    localStorage.setItem('perf-test-global-auth', '[]');
    localStorage.setItem('perf-test-features', '[]');

    const result = await migrateToFlat();
    expect(result!.environments[0].name).toBe('legacy');
  });

  it('strips projectId from feature groups during v2 migration', async () => {
    const project = {
      id: 'p1',
      name: 'P',
      createdAt: 1,
      environments: [],
      microservices: [],
      featureGroups: [{ id: 'f1', name: 'FG', scenarios: [], projectId: 'x' }],
      selectedEnvId: '',
      selectedSvcId: '',
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([project]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    expect(result!.featureGroups[0]).not.toHaveProperty('projectId');
  });

  it('v1 migration reads only environments when other legacy keys are absent', async () => {
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'solo' }]));

    const result = await migrateToFlat();
    expect(result).toBeTruthy();
    expect(result!.environments).toHaveLength(1);
    expect(result!.microservices).toEqual([]);
    expect(result!.featureGroups).toEqual([]);
    expect(result!.globalAuthProfiles).toEqual([]);
  });

  it('v1 migration merges legacy global auth with existing app global profiles', async () => {
    localStorage.setItem(
      'perf-test-global-auth-profiles',
      JSON.stringify([{ id: 'app-g', name: 'Already saved', auth: { type: 'basic', username: 'u', password: 'p' } }]),
    );
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'test' }]));
    localStorage.setItem('perf-test-microservices', '[]');
    localStorage.setItem(
      'perf-test-global-auth',
      JSON.stringify([{ id: 'legacy-g', name: 'From legacy key', auth: { type: 'basic', username: 'a', password: 'b' } }]),
    );
    localStorage.setItem('perf-test-features', '[]');

    const result = await migrateToFlat();
    expect(result!.globalAuthProfiles.map((a) => a.id).sort()).toEqual(['app-g', 'legacy-g']);
  });

  it('v1 migration skips legacy auth ids that already exist in app global storage', async () => {
    localStorage.setItem(
      'perf-test-global-auth-profiles',
      JSON.stringify([{ id: 'same-id', name: 'Kept', auth: { type: 'basic', username: 'u', password: 'p' } }]),
    );
    localStorage.setItem('perf-test-environments', JSON.stringify([{ id: 'e1', name: 'test' }]));
    localStorage.setItem('perf-test-microservices', '[]');
    localStorage.setItem(
      'perf-test-global-auth',
      JSON.stringify([{ id: 'same-id', name: 'Skipped dup', auth: { type: 'basic', username: 'a', password: 'b' } }]),
    );
    localStorage.setItem('perf-test-features', '[]');

    const result = await migrateToFlat();
    expect(result!.globalAuthProfiles).toHaveLength(1);
    expect(result!.globalAuthProfiles[0].name).toBe('Kept');
  });

  it('v2 merge skips duplicate env/svc/auth ids from other projects', async () => {
    const p1 = {
      id: 'p1',
      name: 'A',
      createdAt: 1,
      environments: [{ id: 'e1', name: 'first' }],
      microservices: [{ id: 's1', name: 'm1', baseUrls: {} }],
      globalAuthProfiles: [{ id: 'a1', name: 'auth', auth: { type: 'basic' as const, username: 'u', password: 'p' } }],
      featureGroups: [{ id: 'f1', name: 'OnlySel', scenarios: [] }],
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
    };
    const p2 = {
      id: 'p2',
      name: 'B',
      createdAt: 2,
      environments: [{ id: 'e1', name: 'dup-env' }],
      microservices: [{ id: 's1', name: 'dup-svc', baseUrls: {} }],
      globalAuthProfiles: [{ id: 'a1', name: 'dup-auth', auth: { type: 'basic' as const, username: 'x', password: 'y' } }],
      featureGroups: [{ id: 'f2', name: 'FromOther', scenarios: [] }],
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([p1, p2]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    expect(result!.environments).toHaveLength(1);
    expect(result!.environments[0].name).toBe('first');
    expect(result!.microservices).toHaveLength(1);
    expect(result!.globalAuthProfiles).toHaveLength(1);
    expect(result!.featureGroups).toHaveLength(2);
  });

  it('v2 migration merges project auth into existing app global profiles', async () => {
    localStorage.setItem(
      'perf-test-global-auth-profiles',
      JSON.stringify([{ id: 'pre', name: 'Preloaded', auth: { type: 'basic', username: 'u', password: 'p' } }]),
    );
    const project = {
      id: 'p1',
      name: 'P',
      createdAt: 1,
      environments: [{ id: 'e1', name: 'test' }],
      microservices: [{ id: 's1', name: 'svc', baseUrls: {} }],
      globalAuthProfiles: [{ id: 'from-proj', name: 'Proj', auth: { type: 'basic', username: 'x', password: 'y' } }],
      featureGroups: [{ id: 'f1', name: 'FG', scenarios: [] }],
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([project]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    const ids = result!.globalAuthProfiles.map((a) => a.id).sort();
    expect(ids).toEqual(['from-proj', 'pre']);
  });

  it('v2 migration uses defaults when selected project omits optional fields', async () => {
    const minimalSel: Record<string, unknown> = {
      id: 'p1',
      name: 'Minimal',
      createdAt: 1,
    };
    const p2 = {
      id: 'p2',
      name: 'Full-other',
      createdAt: 2,
      environments: [{ id: 'e2', name: 'from-other' }],
      microservices: [{ id: 's2', name: 'svc2', baseUrls: { e2: 'http://z' } }],
      globalAuthProfiles: [{ id: 'a2', name: 'auth2', auth: { type: 'basic', username: 'u', password: 'p' } }],
      featureGroups: [{ id: 'f2', name: 'FG2', scenarios: [] }],
    };
    const bareOther: Record<string, unknown> = { id: 'p3', name: 'Bare', createdAt: 3 };
    localStorage.setItem('perf-test-projects', JSON.stringify([minimalSel, p2, bareOther]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    expect(result!.environments.map((e) => e.id)).toContain('e2');
    expect(result!.microservices.map((s) => s.id)).toContain('s2');
    expect(result!.globalAuthProfiles.map((a) => a.id)).toContain('a2');
    expect(result!.featureGroups.map((f) => f.id)).toContain('f2');
    expect(result!.selectedEnvId).toBe('');
    expect(result!.selectedSvcId).toBe('');
  });

  it('v2 merge skips auth profiles already present in app global storage', async () => {
    localStorage.setItem(
      'perf-test-global-auth-profiles',
      JSON.stringify([{ id: 'shared', name: 'Existing', auth: { type: 'basic', username: 'u', password: 'p' } }]),
    );
    const project = {
      id: 'p1',
      name: 'P',
      createdAt: 1,
      environments: [{ id: 'e1', name: 'test' }],
      microservices: [{ id: 's1', name: 'svc', baseUrls: {} }],
      globalAuthProfiles: [{ id: 'shared', name: 'Dup', auth: { type: 'basic', username: 'x', password: 'y' } }],
      featureGroups: [],
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
    };
    localStorage.setItem('perf-test-projects', JSON.stringify([project]));
    localStorage.setItem('perf-test-selected-project', 'p1');

    const result = await migrateToFlat();
    expect(result!.globalAuthProfiles).toHaveLength(1);
    expect(result!.globalAuthProfiles[0].name).toBe('Existing');
  });
});

// ─── Per-FG Shared Data Sources Migration ─────────────────────

function makeDataSource(id: string): DataSource {
  return {
    id,
    columns: [{ id: 'col1', name: 'vin', type: 'path', mapping: 'vin' }],
    rows: [{ id: 'r1', values: { col1: 'ABC123' }, enabled: true }],
    source: { type: 'inline' },
  };
}

function makeSharedDs(id: string, name: string): SharedDataSource {
  return {
    id,
    name,
    dataSource: makeDataSource(`ds-${id}`),
    updatedAt: Date.now(),
  };
}

function makeFgWithSharedDs(fgId: string, sharedDs: SharedDataSource[]): FeatureGroup {
  return {
    id: fgId,
    name: `Feature ${fgId}`,
    scenarios: [],
    sharedDataSources: sharedDs,
  } as FeatureGroup & { sharedDataSources?: SharedDataSource[] };
}

describe('migratePerFgSharedDataSourcesToTopLevel', () => {
  beforeEach(async () => {
    localStorage.clear();
    // Reset migration flag
    localStorage.removeItem('perf-test-v3-migrated');
  });

  it('returns zeros when no per-FG shared data sources exist', async () => {
    const fg: FeatureGroup = { id: 'fg1', name: 'Feature', scenarios: [] };
    await saveFeatureGroups([fg]);
    await saveSharedDataSources([]);

    const result = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result.migrated).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('migrates per-FG shared data sources to top-level', async () => {
    const shared1 = makeSharedDs('s1', 'Vehicles');
    const shared2 = makeSharedDs('s2', 'Users');
    const fg = makeFgWithSharedDs('fg1', [shared1, shared2]);

    await saveFeatureGroups([fg]);
    await saveSharedDataSources([]);

    const result = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result.migrated).toBe(2);
    expect(result.removed).toBe(2);

    const topLevel = await loadSharedDataSources();
    expect(topLevel).toHaveLength(2);
    expect(topLevel.map(s => s.id).sort()).toEqual(['s1', 's2']);

    const fgs = await loadFeatureGroups();
    expect((fgs[0] as FeatureGroup & { sharedDataSources?: unknown }).sharedDataSources).toBeUndefined();
  });

  it('deduplicates by ID when same shared DS exists in top-level', async () => {
    const shared1 = makeSharedDs('s1', 'Vehicles');
    const fg = makeFgWithSharedDs('fg1', [shared1]);

    const existingTopLevel = makeSharedDs('s1', 'Already Exists');
    await saveFeatureGroups([fg]);
    await saveSharedDataSources([existingTopLevel]);

    const result = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result.migrated).toBe(0); // s1 already exists, not migrated
    expect(result.removed).toBe(1); // still counts as removed from FG

    const topLevel = await loadSharedDataSources();
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].name).toBe('Already Exists'); // original kept
  });

  it('migrates from multiple feature groups', async () => {
    const shared1 = makeSharedDs('s1', 'Vehicles');
    const shared2 = makeSharedDs('s2', 'Products');
    const shared3 = makeSharedDs('s3', 'Customers');

    const fg1 = makeFgWithSharedDs('fg1', [shared1, shared2]);
    const fg2 = makeFgWithSharedDs('fg2', [shared3]);

    await saveFeatureGroups([fg1, fg2]);
    await saveSharedDataSources([]);

    const result = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result.migrated).toBe(3);
    expect(result.removed).toBe(3);

    const topLevel = await loadSharedDataSources();
    expect(topLevel).toHaveLength(3);
  });

  it('handles FGs without sharedDataSources field gracefully', async () => {
    const fg1: FeatureGroup = { id: 'fg1', name: 'No Shared', scenarios: [] };
    const shared1 = makeSharedDs('s1', 'Vehicles');
    const fg2 = makeFgWithSharedDs('fg2', [shared1]);

    await saveFeatureGroups([fg1, fg2]);
    await saveSharedDataSources([]);

    const result = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result.migrated).toBe(1);
    expect(result.removed).toBe(1);

    const topLevel = await loadSharedDataSources();
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].id).toBe('s1');
  });

  it('is idempotent — running twice does not duplicate', async () => {
    const shared1 = makeSharedDs('s1', 'Vehicles');
    const fg = makeFgWithSharedDs('fg1', [shared1]);

    await saveFeatureGroups([fg]);
    await saveSharedDataSources([]);

    // First run
    const result1 = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result1.migrated).toBe(1);

    // Second run (FG no longer has sharedDataSources)
    const result2 = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result2.migrated).toBe(0);
    expect(result2.removed).toBe(0);

    const topLevel = await loadSharedDataSources();
    expect(topLevel).toHaveLength(1);
  });

  it('removes sharedDataSources field from all FGs after migration', async () => {
    const shared1 = makeSharedDs('s1', 'Vehicles');
    const fg1 = makeFgWithSharedDs('fg1', [shared1]);
    const fg2: FeatureGroup = { id: 'fg2', name: 'No Shared', scenarios: [] };

    await saveFeatureGroups([fg1, fg2]);
    await saveSharedDataSources([]);

    await migratePerFgSharedDataSourcesToTopLevel();

    const fgs = await loadFeatureGroups();
    for (const fg of fgs) {
      expect((fg as FeatureGroup & { sharedDataSources?: unknown }).sharedDataSources).toBeUndefined();
    }
  });

  it('handles empty sharedDataSources array in FG', async () => {
    const fg = makeFgWithSharedDs('fg1', []);

    await saveFeatureGroups([fg]);
    await saveSharedDataSources([]);

    const result = await migratePerFgSharedDataSourcesToTopLevel();
    expect(result.migrated).toBe(0);
    expect(result.removed).toBe(0);
  });
});
