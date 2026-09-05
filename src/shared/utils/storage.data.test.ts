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

const { idbStore, catalogStore, workflowsStore, requestsStore, projectsStore, appConfigStore, runnerConfigStore } = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  return {
    idbStore: store,
    catalogStore: {
      entries: null as unknown[] | null,
      rawSpecs: {} as Record<string, string>,
      endpointValues: {} as Record<string, unknown>,
    },
    workflowsStore: {
      workflows: null as unknown[] | null,
      folders: null as unknown[] | null,
    },
    requestsStore: {
      data: null as { environments: unknown[]; collections: unknown[] } | null,
    },
    projectsStore: {
      projects: null as unknown[] | null,
    },
    appConfigStore: {
      environments: null as unknown[] | null,
      microservices: null as unknown[] | null,
      featureGroups: null as unknown[] | null,
      globalAuthProfiles: null as unknown[] | null,
    },
    runnerConfigStore: {} as Record<string, string>,
  };
});

let _idbInsertOrder = 0;

vi.mock('./idbCatalog', () => ({
  idbLoadCatalogEntries: vi.fn(async () => catalogStore.entries),
  idbSaveCatalogEntries: vi.fn(async (entries: unknown[]) => { catalogStore.entries = entries; }),
  idbMigrateCatalogEntries: vi.fn(async () => false),
  idbLoadCatalogRawSpec: vi.fn(async (entryId: string, versionId: string) =>
    catalogStore.rawSpecs[`${entryId}-${versionId}`] ?? null),
  idbSaveCatalogRawSpec: vi.fn(async (entryId: string, versionId: string, raw: string) => {
    catalogStore.rawSpecs[`${entryId}-${versionId}`] = raw;
  }),
  idbRemoveCatalogRawSpec: vi.fn(async (entryId: string, versionId: string) => {
    delete catalogStore.rawSpecs[`${entryId}-${versionId}`];
  }),
  idbRemoveAllCatalogRawSpecs: vi.fn(async (entryId: string, versionIds: string[]) => {
    for (const vid of versionIds) delete catalogStore.rawSpecs[`${entryId}-${vid}`];
  }),
  idbMigrateCatalogRawSpecs: vi.fn(async () => 0),
  idbLoadCatalogEndpointValues: vi.fn(async (entryId: string) =>
    (catalogStore.endpointValues[entryId] as Record<string, unknown> | undefined) ?? null),
  idbSaveCatalogEndpointValues: vi.fn(async (entryId: string, values: unknown) => {
    catalogStore.endpointValues[entryId] = values;
  }),
  idbRemoveCatalogEndpointValues: vi.fn(async (entryId: string) => {
    delete catalogStore.endpointValues[entryId];
  }),
  idbMigrateCatalogEndpointValues: vi.fn(async () => 0),
}));

vi.mock('./idbWorkflows', () => ({
  idbLoadWorkflows: vi.fn(async () => workflowsStore.workflows),
  idbSaveWorkflows: vi.fn(async (workflows: unknown[]) => { workflowsStore.workflows = workflows; }),
  idbMigrateWorkflows: vi.fn(async () => false),
  idbLoadWorkflowFolders: vi.fn(async () => workflowsStore.folders),
  idbSaveWorkflowFolders: vi.fn(async (folders: unknown[]) => { workflowsStore.folders = folders; }),
  idbMigrateWorkflowFolders: vi.fn(async () => false),
}));

vi.mock('./idbRequests', () => ({
  idbLoadRequests: vi.fn(async () => requestsStore.data),
  idbSaveRequests: vi.fn(async (data: { environments: unknown[]; collections: unknown[] }) => {
    requestsStore.data = data;
  }),
  idbMigrateRequests: vi.fn(async () => false),
}));

vi.mock('./idbProjects', () => ({
  idbLoadProjects: vi.fn(async () => projectsStore.projects),
  idbSaveProjects: vi.fn(async (projects: unknown[]) => { projectsStore.projects = projects; }),
  idbMigrateProjects: vi.fn(async () => false),
}));

vi.mock('./idbEnvironmentsMicroservices', () => ({
  idbLoadEnvironments: vi.fn(async () => appConfigStore.environments),
  idbSaveEnvironments: vi.fn(async (data: unknown[]) => { appConfigStore.environments = data; }),
  idbMigrateEnvironments: vi.fn(async () => false),
  idbLoadMicroservices: vi.fn(async () => appConfigStore.microservices),
  idbSaveMicroservices: vi.fn(async (data: unknown[]) => { appConfigStore.microservices = data; }),
  idbMigrateMicroservices: vi.fn(async () => false),
}));

vi.mock('./idbFeatureGroups', () => ({
  idbLoadFeatureGroups: vi.fn(async () => appConfigStore.featureGroups),
  idbSaveFeatureGroups: vi.fn(async (data: unknown[]) => { appConfigStore.featureGroups = data; }),
  idbMigrateFeatureGroups: vi.fn(async () => false),
}));

vi.mock('./idbGlobalAuthProfiles', () => ({
  idbLoadGlobalAuthProfiles: vi.fn(async () => appConfigStore.globalAuthProfiles),
  idbSaveGlobalAuthProfiles: vi.fn(async (data: unknown[]) => { appConfigStore.globalAuthProfiles = data; }),
  idbMigrateGlobalAuthProfiles: vi.fn(async () => false),
}));

vi.mock('./idbRunnerConfig', () => ({
  idbLoadRunnerConfig: vi.fn(async (contextKey: string) => runnerConfigStore[contextKey || '__default__'] ?? null),
  idbSaveRunnerConfig: vi.fn(async (contextKey: string, payload: string) => {
    runnerConfigStore[contextKey || '__default__'] = payload;
  }),
  idbMigrateRunnerConfigsFromLocalStorage: vi.fn(async () => 0),
  purgeRunnerConfigLocalStorageKeys: vi.fn(() => ({ removed: 0, freedBytes: 0 })),
  idbPruneRunnerConfigs: vi.fn(async () => 0),
  idbListRunnerConfigIds: vi.fn(async () => Object.keys(runnerConfigStore)),
}));

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

import { saveEnvironments, loadEnvironments, saveMicroservices, loadMicroservices, saveFeatureGroups, loadFeatureGroups, saveGlobalAuthProfiles, loadGlobalAuthProfiles, saveSelectedEnvId, loadSelectedEnvId, saveSelectedSvcId, loadSelectedSvcId, getMaxRuns, setMaxRuns, saveRunnerConfig, loadRunnerConfig, saveTheme, loadTheme, getStorageUsage, getStorageDiagnostics, cleanupStaleStorageKeys, loadRequests, saveRequests, loadCatalogEntries, saveCatalogEntries, loadCatalogRawSpec, saveCatalogRawSpec, removeCatalogRawSpec, removeAllCatalogRawSpecs, loadCatalogEndpointValues, saveCatalogEndpointValues, removeCatalogEndpointValues, loadTestRuns, saveTestRunsBulk, loadSelectedWorkflowId, saveSelectedWorkflowId, loadWorkflows, saveWorkflows, loadWorkflowSampleDismissed, saveWorkflowSampleDismissed, loadPreviewSampleId, savePreviewSampleId, PROJECTS_KEY, } from './storage';
import * as storageWorkflows from './storageWorkflows';
import * as storageCatalog from './storageCatalog';
import { idbSaveRequests, idbLoadRequests, idbMigrateRequests } from './idbRequests';
import { idbMigrateProjects } from './idbProjects';
import { idbLoadWorkflows } from './idbWorkflows';
import { TestRun, GlobalAuthProfile, RequestsData } from '../types';
import { CatalogEntry, SavedEndpointValues } from '../../features/catalog/types/catalog';
import { Workflow } from '@workflow/types/workflow';

function makeRun(id: string, results: number = 1): TestRun {
  return {
    id,
    timestamp: Date.now(),
    config: {
      concurrency: 1, iterations: results,
      scenarioWeights: [], executionMode: 'sequential',
    },
    summary: {
      tps: 1, avgResponseTime: 100, minResponseTime: 50, maxResponseTime: 150,
      p95ResponseTime: 140, p99ResponseTime: 148, errorRate: 0,
      errorsByStatus: {}, totalRequests: results, successfulRequests: results,
      failedRequests: 0, failedValidations: 0, totalDurationMs: 1000,
    },
    results: Array.from({ length: results }, (_, i) => ({
      id: `r${i}`,
      scenarioId: 's1',
      scenarioName: 'Test',
      url: 'http://api/test',
      method: 'GET',
      httpStatus: 200,
      responseTimeMs: 100,
      responseBody: '{"ok":true}',
      timestamp: Date.now(),
      passed: true,
      validationMode: 'none' as const,
      failureDetails: [],
    })),
  };
}

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(idbStore)) delete idbStore[k];
  catalogStore.entries = null;
  catalogStore.rawSpecs = {};
  catalogStore.endpointValues = {};
  workflowsStore.workflows = null;
  workflowsStore.folders = null;
  requestsStore.data = null;
  projectsStore.projects = null;
  appConfigStore.environments = null;
  appConfigStore.microservices = null;
  appConfigStore.featureGroups = null;
  appConfigStore.globalAuthProfiles = null;
  for (const k of Object.keys(runnerConfigStore)) delete runnerConfigStore[k];
  _idbInsertOrder = 0;
  isTauriMock.mockReturnValue(false);
  tauriGetItem.mockReset();
  tauriGetItem.mockResolvedValue(null);
  tauriSetItem.mockReset();
  tauriSetItem.mockResolvedValue(undefined);
  tauriGetUsage.mockReset();
  tauriGetUsage.mockResolvedValue({ usedBytes: 0, entries: {} });
});

describe('storage — flat data', () => {
  it('saves and loads environments', async () => {
    await saveEnvironments([{ id: 'e1', name: 'test' }, { id: 'e2', name: 'prod' }]);
    const loaded = await loadEnvironments();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe('test');
  });

  it('saves and loads microservices', async () => {
    await saveMicroservices([{ id: 's1', name: 'svc-1', baseUrls: { e1: 'http://api' } }]);
    const loaded = await loadMicroservices();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].baseUrls.e1).toBe('http://api');
  });

  it('saves and loads feature groups', async () => {
    await saveFeatureGroups([{ id: 'fg1', name: 'FG1', scenarios: [] }]);
    const loaded = await loadFeatureGroups();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('FG1');
  });

  it('saves and loads selected env/svc ids', async () => {
    await saveSelectedEnvId('e1');
    await saveSelectedSvcId('s1');
    expect(await loadSelectedEnvId()).toBe('e1');
    expect(await loadSelectedSvcId()).toBe('s1');
  });

  it('returns empty string for selected ids when keys are absent', async () => {
    expect(await loadSelectedEnvId()).toBe('');
    expect(await loadSelectedSvcId()).toBe('');
  });

  it('returns empty arrays when nothing stored', async () => {
    expect(await loadEnvironments()).toEqual([]);
    expect(await loadMicroservices()).toEqual([]);
    expect(await loadFeatureGroups()).toEqual([]);
  });
});

describe('storage — global auth profiles', () => {
  it('saves and loads auth profiles', async () => {
    const profiles: GlobalAuthProfile[] = [
      { id: 'gp1', name: 'OAuth Prod', auth: { type: 'oauth2', tokenUrl: 'http://auth', clientId: 'c', clientSecret: 's' } },
      { id: 'gp2', name: 'Basic QA', auth: { type: 'basic', username: 'u', password: 'p' } },
    ];
    await saveGlobalAuthProfiles(profiles);
    const loaded = await loadGlobalAuthProfiles();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].auth.type).toBe('oauth2');
    expect(loaded[1].auth.type).toBe('basic');
  });

  it('returns empty array when no profiles', async () => {
    expect(await loadGlobalAuthProfiles()).toEqual([]);
  });
});

describe('storage — max runs', () => {
  it('defaults to 50', async () => {
    expect(await getMaxRuns()).toBe(50);
  });

  it('saves and loads custom max', async () => {
    await setMaxRuns(10);
    expect(await getMaxRuns()).toBe(10);
  });

  it('clamps to 1 minimum', async () => {
    await setMaxRuns(0);
    expect(await getMaxRuns()).toBe(1);
  });

  it('clamps to 500 maximum', async () => {
    await setMaxRuns(1000);
    expect(await getMaxRuns()).toBe(500);
  });

  it('prunes existing runs when max is lowered', async () => {
    await saveTestRunsBulk([makeRun('r1'), makeRun('r2'), makeRun('r3')]);
    await setMaxRuns(2);
    const loaded = await loadTestRuns();
    expect(loaded).toHaveLength(2);
  });
});

describe('storage — runner config', () => {
  it('saves and loads runner config', async () => {
    const config = { concurrency: 5, mode: 'batch' };
    await saveRunnerConfig(config);
    const loaded = await loadRunnerConfig();
    expect(loaded).toEqual(config);
  });

  it('saves and loads with context key', async () => {
    await saveRunnerConfig({ concurrency: 5 }, 'env-1:svc-1');
    await saveRunnerConfig({ concurrency: 10 }, 'env-2:svc-2');

    expect(await loadRunnerConfig('env-1:svc-1')).toEqual({ concurrency: 5 });
    expect(await loadRunnerConfig('env-2:svc-2')).toEqual({ concurrency: 10 });
  });

  it('returns null when no config stored', async () => {
    expect(await loadRunnerConfig()).toBeNull();
  });

  it('saveRunnerConfig persists to IDB without leaving legacy localStorage keys', async () => {
    await saveRunnerConfig({ concurrency: 2 }, 'env-1:svc-1');
    expect(await loadRunnerConfig('env-1:svc-1')).toEqual({ concurrency: 2 });
    expect(localStorage.getItem('perf-test-runner-config:env-1:svc-1')).toBeNull();
  });

  it('loadRunnerConfig migrates legacy localStorage into IDB', async () => {
    localStorage.setItem('perf-test-runner-config:legacy-env', '{"concurrency":7}');
    const loaded = await loadRunnerConfig('legacy-env');
    expect(loaded).toEqual({ concurrency: 7 });
  });
});

describe('storage — theme', () => {
  it('defaults to dark', async () => {
    expect(await loadTheme()).toBe('dark');
  });

  it('saves and loads theme', async () => {
    await saveTheme('light');
    expect(await loadTheme()).toBe('light');
  });
});

describe('storage — usage', () => {
  it('returns zero for empty storage', async () => {
    const { usedBytes, entries } = await getStorageUsage();
    expect(usedBytes).toBe(0);
    expect(Object.keys(entries)).toHaveLength(0);
  });

  it('counts bytes for stored data', async () => {
    await saveEnvironments([{ id: 'e1', name: 'test' }]);
    const { usedBytes, entries } = await getStorageUsage();
    expect(usedBytes).toBeGreaterThan(0);
    expect(entries['environments (IndexedDB)']).toBeGreaterThan(0);
  });

  it('includes sizes for workflows, requests, catalog, and projects IDB stores', async () => {
    workflowsStore.workflows = [{ id: 'w1', name: 'Workflow' }];
    requestsStore.data = { environments: [{ id: 'e1', name: 'env' }], collections: [] };
    catalogStore.entries = [{ id: 'c1', name: 'Catalog' }];
    projectsStore.projects = [{ id: 'p1', name: 'Project' }];
    const { entries, usedBytes } = await getStorageUsage();
    expect(entries['workflows (IndexedDB)']).toBeGreaterThan(0);
    expect(entries['requests (IndexedDB)']).toBeGreaterThan(0);
    expect(entries['catalog (IndexedDB)']).toBeGreaterThan(0);
    expect(entries['projects (IndexedDB)']).toBeGreaterThan(0);
    expect(usedBytes).toBeGreaterThan(0);
  });

  it('ignores IDB store load failures in usage report', async () => {
    vi.mocked(idbLoadWorkflows).mockRejectedValueOnce(new Error('idb unavailable'));
    const { usedBytes } = await getStorageUsage();
    expect(usedBytes).toBeGreaterThanOrEqual(0);
  });
});

describe('storage — diagnostics and cleanup', () => {
  it('getStorageDiagnostics returns formatted summary', async () => {
    await saveTheme('dark');
    const diag = await getStorageDiagnostics();
    expect(diag).toContain('=== Storage Diagnostics ===');
    expect(diag).toContain('Total:');
    expect(diag).toContain('--- Top Keys ---');
    expect(diag).toContain('perf-test-theme');
  });

  it('cleanupStaleStorageKeys removes ephemeral localStorage keys', () => {
    localStorage.setItem('perf-test-last-progress:sc1', 'progress');
    localStorage.setItem('perf-test-wf-undo-wf1', 'undo');
    localStorage.setItem('replayLayout:wf1', 'layout');
    localStorage.setItem('dm-schema-snapshot-x', 'snap');
    localStorage.setItem('dm-patterns:ctx', 'patterns');
    const { removed, freedKB } = cleanupStaleStorageKeys();
    expect(removed).toBe(5);
    expect(freedKB).toBeGreaterThanOrEqual(0);
    expect(localStorage.getItem('perf-test-last-progress:sc1')).toBeNull();
    expect(localStorage.getItem('perf-test-wf-undo-wf1')).toBeNull();
  });

  it('cleanupStaleStorageKeys removes stale runner-config keys', () => {
    localStorage.setItem('perf-test-runner-config:a:b:c:d', '{"iterations":1}');
    localStorage.setItem('perf-test-runner-config:90601c56-6402-4abc-def0-1234', '{"iterations":2}');
    localStorage.setItem('perf-test-runner-config:_workflow_runner', '{"iterations":3}');
    const { removed } = cleanupStaleStorageKeys();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem('perf-test-runner-config:a:b:c:d')).toBeNull();
    expect(localStorage.getItem('perf-test-runner-config:90601c56-6402-4abc-def0-1234')).toBeNull();
    expect(localStorage.getItem('perf-test-runner-config:_workflow_runner')).toBe('{"iterations":3}');
  });

  it('cleanupStaleStorageKeys returns zero on Tauri', () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('perf-test-wf-undo-wf1', 'data');
    expect(cleanupStaleStorageKeys()).toEqual({ removed: 0, freedKB: 0 });
    expect(localStorage.getItem('perf-test-wf-undo-wf1')).toBe('data');
  });

  it('cleanupStaleStorageKeys logs when keys are removed', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    localStorage.setItem('perf-test-wf-undo-wf1', 'data');
    cleanupStaleStorageKeys();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[Storage] Cleanup:'));
    infoSpy.mockRestore();
  });

  it('cleanupStaleStorageKeys returns zero when nothing to clean', () => {
    expect(cleanupStaleStorageKeys()).toEqual({ removed: 0, freedKB: 0 });
  });

  it('cleanupStaleStorageKeys triggers IDB migration for remaining large keys', async () => {
    const wfSpy = vi.spyOn(storageWorkflows, 'migrateWorkflowKeysToIdb').mockResolvedValue(undefined);
    const catSpy = vi.spyOn(storageCatalog, 'migrateCatalogKeysToIdb').mockResolvedValue(undefined);
    localStorage.setItem('perf-test-requests', '[]');
    localStorage.setItem(PROJECTS_KEY, '[]');

    cleanupStaleStorageKeys();

    await vi.waitFor(() => {
      expect(wfSpy).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(vi.mocked(idbMigrateRequests)).toHaveBeenCalledWith('perf-test-requests');
      expect(vi.mocked(idbMigrateProjects)).toHaveBeenCalledWith(PROJECTS_KEY);
      expect(catSpy).toHaveBeenCalled();
    });

    wfSpy.mockRestore();
    catSpy.mockRestore();
  });

  it('cleanupStaleStorageKeys ignores IDB migration errors', async () => {
    vi.spyOn(storageWorkflows, 'migrateWorkflowKeysToIdb').mockResolvedValue(undefined);
    vi.spyOn(storageCatalog, 'migrateCatalogKeysToIdb').mockResolvedValue(undefined);
    vi.mocked(idbMigrateRequests).mockRejectedValueOnce(new Error('migrate fail'));
    localStorage.setItem('perf-test-requests', '[]');
    cleanupStaleStorageKeys();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe('storage — requests', () => {
  it('returns empty requests data when nothing stored', async () => {
    const result = await loadRequests();
    expect(result.environments).toEqual([]);
    expect(result.collections).toEqual([]);
  });

  it('saves and loads requests data', async () => {
    const data = { environments: [{ id: 'e1', name: 'dev' }], collections: [] };
    await saveRequests(data as unknown as RequestsData);
    const loaded = await loadRequests();
    expect(loaded.environments).toHaveLength(1);
    expect(loaded.environments[0].name).toBe('dev');
  });

  it('migrates data from legacy workbench key to requests key', async () => {
    const legacy = { environments: [{ id: 'e1', name: 'staging' }], collections: [{ id: 'c1', name: 'Col' }] };
    localStorage.setItem('perf-test-workbench', JSON.stringify(legacy));

    const loaded = await loadRequests();
    expect(loaded.environments).toHaveLength(1);
    expect(loaded.environments[0].name).toBe('staging');
    expect(loaded.collections).toHaveLength(1);

    expect(localStorage.getItem('perf-test-workbench')).toBeNull();
    expect(localStorage.getItem('perf-test-requests')).toBeNull();
    expect(requestsStore.data?.environments[0].name).toBe('staging');
  });

  it('prefers new key over legacy key', async () => {
    const legacy = { environments: [{ id: 'e1', name: 'old' }], collections: [] };
    const current = { environments: [{ id: 'e2', name: 'new' }], collections: [] };
    localStorage.setItem('perf-test-workbench', JSON.stringify(legacy));
    localStorage.setItem('perf-test-requests', JSON.stringify(current));

    const loaded = await loadRequests();
    expect(loaded.environments[0].name).toBe('new');
    expect(localStorage.getItem('perf-test-workbench')).toBeTruthy();
  });

  it('returns empty data when IDB load throws', async () => {
    vi.mocked(idbLoadRequests).mockRejectedValueOnce(new Error('idb fail'));
    const loaded = await loadRequests();
    expect(loaded).toEqual({ environments: [], collections: [] });
  });

  it('normalizes malformed request payloads from IDB', async () => {
    requestsStore.data = { selectedEnvId: 'e1' } as unknown as { environments: unknown[]; collections: unknown[] };
    const loaded = await loadRequests();
    expect(loaded).toEqual({ environments: [], collections: [], selectedEnvId: 'e1', selectedCollectionId: undefined, selectedRequestId: undefined });
  });

  it('clears stale localStorage copy after successful IDB save', async () => {
    localStorage.setItem('perf-test-requests', '[]');
    await saveRequests({ environments: [], collections: [] } as RequestsData);
    expect(localStorage.getItem('perf-test-requests')).toBeNull();
  });

  it('migrates localStorage requests to IDB on load', async () => {
    const data = { environments: [{ id: 'e1', name: 'local' }], collections: [] };
    localStorage.setItem('perf-test-requests', JSON.stringify(data));
    const loaded = await loadRequests();
    expect(loaded.environments[0].name).toBe('local');
    expect(vi.mocked(idbMigrateRequests)).toHaveBeenCalledWith('perf-test-requests');
  });

  it('falls back to localStorage when IDB save fails', async () => {
    vi.mocked(idbSaveRequests).mockRejectedValueOnce(new Error('idb down'));
    const data = { environments: [{ id: 'e1', name: 'fallback' }], collections: [] };
    await saveRequests(data as RequestsData);
    expect(localStorage.getItem('perf-test-requests')).toContain('fallback');
  });
});

describe('storage — requests (Tauri)', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    tauriGetItem.mockImplementation(async (key: string) => localStorage.getItem(key));
    tauriSetItem.mockImplementation(async (key: string, value: string) => {
      localStorage.setItem(key, value);
    });
  });

  it('loads requests from tauri storage', async () => {
    const data = { environments: [{ id: 'e1', name: 'tauri-env' }], collections: [] };
    localStorage.setItem('perf-test-requests', JSON.stringify(data));
    const loaded = await loadRequests();
    expect(loaded.environments[0].name).toBe('tauri-env');
  });

  it('migrates legacy workbench key in tauri mode', async () => {
    const legacy = { environments: [{ id: 'e1', name: 'legacy-tauri' }], collections: [] };
    localStorage.setItem('perf-test-workbench', JSON.stringify(legacy));
    const loaded = await loadRequests();
    expect(loaded.environments[0].name).toBe('legacy-tauri');
    expect(tauriSetItem).toHaveBeenCalledWith('perf-test-workbench', '');
    expect(tauriSetItem).toHaveBeenCalledWith('perf-test-requests', JSON.stringify(legacy));
  });

  it('saveRequests writes via tauriStore', async () => {
    const data = { environments: [{ id: 'e1', name: 'saved' }], collections: [] };
    await saveRequests(data as RequestsData);
    expect(tauriSetItem).toHaveBeenCalledWith('perf-test-requests', JSON.stringify(data));
  });

  it('returns empty requests when tauri read fails', async () => {
    tauriGetItem.mockRejectedValue(new Error('disk error'));
    const loaded = await loadRequests();
    expect(loaded).toEqual({ environments: [], collections: [] });
  });

  it('returns empty requests when tauri keys are absent', async () => {
    tauriGetItem.mockResolvedValue(null);
    const loaded = await loadRequests();
    expect(loaded).toEqual({ environments: [], collections: [] });
  });
});

describe('storage — catalog entries', () => {
  it('returns empty array when no catalog entries', async () => {
    const entries = await loadCatalogEntries();
    expect(entries).toEqual([]);
  });

  it('saves and loads catalog entries', async () => {
    const entries = [{ id: 'c1', name: 'API1' }] as unknown as CatalogEntry[];
    await saveCatalogEntries(entries);
    const loaded = await loadCatalogEntries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('API1');
  });
});

describe('storage — catalog raw specs', () => {
  it('returns null when no spec stored', async () => {
    expect(await loadCatalogRawSpec('c1', 'v1')).toBeNull();
  });

  it('saves and loads raw spec', async () => {
    await saveCatalogRawSpec('c1', 'v1', '{"openapi":"3.0"}');
    const spec = await loadCatalogRawSpec('c1', 'v1');
    expect(spec).toBe('{"openapi":"3.0"}');
  });

  it('removes raw spec', async () => {
    await saveCatalogRawSpec('c1', 'v1', 'spec-data');
    await removeCatalogRawSpec('c1', 'v1');
    expect(await loadCatalogRawSpec('c1', 'v1')).toBeNull();
  });

  it('removes all raw specs for an entry', async () => {
    await saveCatalogRawSpec('c1', 'v1', 'spec1');
    await saveCatalogRawSpec('c1', 'v2', 'spec2');
    await removeAllCatalogRawSpecs('c1', ['v1', 'v2']);
    expect(await loadCatalogRawSpec('c1', 'v1')).toBeNull();
    expect(await loadCatalogRawSpec('c1', 'v2')).toBeNull();
  });
});

describe('storage — catalog endpoint values', () => {
  it('returns empty object when no values stored', async () => {
    expect(await loadCatalogEndpointValues('c1')).toEqual({});
  });

  it('saves and loads endpoint values', async () => {
    const values = { ep1: { params: { id: '123' }, headers: {}, body: '{}' } };
    await saveCatalogEndpointValues('c1', values as unknown as Record<string, SavedEndpointValues>);
    const loaded = await loadCatalogEndpointValues('c1');
    expect(loaded.ep1.params).toEqual({ id: '123' });
  });

  it('removes endpoint values', async () => {
    await saveCatalogEndpointValues('c1', { ep1: {} as unknown as SavedEndpointValues });
    await removeCatalogEndpointValues('c1');
    expect(await loadCatalogEndpointValues('c1')).toEqual({});
  });
});

describe('storage — usage key filter', () => {
  it('includes all localStorage keys in usage report', async () => {
    localStorage.setItem('other-app', 'yyyy');
    await saveTheme('dark');
    const { entries } = await getStorageUsage();
    expect(entries['other-app']).toBeGreaterThan(0);
    expect(entries['perf-test-theme']).toBeGreaterThan(0);
  });

  it('treats missing values for enumerated perf-test keys as empty string', async () => {
    const nativeGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'perf-test-orphan') return null;
      return nativeGet.call(this, key);
    });
    localStorage.setItem('perf-test-orphan', 'ignored');
    const { entries, usedBytes } = await getStorageUsage();
    expect(entries['perf-test-orphan']).toBe(0);
    expect(usedBytes).toBe(0);
    vi.restoreAllMocks();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
    tauriGetItem.mockReset();
    tauriGetItem.mockResolvedValue(null);
    tauriSetItem.mockReset();
    tauriSetItem.mockResolvedValue(undefined);
    tauriGetUsage.mockReset();
    tauriGetUsage.mockResolvedValue({ usedBytes: 0, entries: {} });
  });
});

describe('storage — tauri backend', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
  });

  it('getMaxRuns reads from tauriStore', async () => {
    tauriGetItem.mockResolvedValue('42');
    expect(await getMaxRuns()).toBe(42);
    expect(tauriGetItem).toHaveBeenCalledWith('perf-test-max-runs');
  });

  it('saveTheme writes via tauriStore', async () => {
    await saveTheme('light');
    expect(tauriSetItem).toHaveBeenCalledWith('perf-test-theme', 'light');
  });

  it('getStorageUsage delegates to tauriStore', async () => {
    tauriGetUsage.mockResolvedValue({ usedBytes: 999, entries: { 'perf-test-theme': 999 } });
    expect(await getStorageUsage()).toEqual({ usedBytes: 999, entries: { 'perf-test-theme': 999 } });
  });

  it('removeCatalogRawSpec clears the key via tauriStore setItem empty string', async () => {
    await removeCatalogRawSpec('c1', 'v1');
    expect(tauriSetItem).toHaveBeenCalledWith('perf-test-catalog-spec-c1-v1', '');
  });
});

describe('workflow storage', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    tauriGetItem.mockReset();
    tauriSetItem.mockReset();
  });

  it('loadSelectedWorkflowId returns trimmed id', async () => {
    tauriGetItem.mockResolvedValue('  wf-123  ');
    expect(await loadSelectedWorkflowId()).toBe('wf-123');
  });

  it('loadSelectedWorkflowId returns null for empty string', async () => {
    tauriGetItem.mockResolvedValue('   ');
    expect(await loadSelectedWorkflowId()).toBeNull();
  });

  it('loadSelectedWorkflowId returns null on error', async () => {
    tauriGetItem.mockRejectedValue(new Error('fail'));
    expect(await loadSelectedWorkflowId()).toBeNull();
  });

  it('saveSelectedWorkflowId writes trimmed id', async () => {
    await saveSelectedWorkflowId('  wf-1  ');
    expect(tauriSetItem).toHaveBeenCalledWith('workflows_selected_id', 'wf-1');
  });

  it('saveSelectedWorkflowId removes key for null', async () => {
    await saveSelectedWorkflowId(null);
    expect(tauriSetItem).toHaveBeenCalledWith('workflows_selected_id', '');
  });

  it('loadWorkflows returns parsed array', async () => {
    tauriGetItem.mockResolvedValue('[{"id":"w1"}]');
    const wfs = await loadWorkflows();
    expect(wfs).toEqual([{ id: 'w1' }]);
  });

  it('loadWorkflows returns empty array when null', async () => {
    tauriGetItem.mockResolvedValue(null);
    expect(await loadWorkflows()).toEqual([]);
  });

  it('loadWorkflows returns empty array on error', async () => {
    tauriGetItem.mockRejectedValue(new Error('fail'));
    expect(await loadWorkflows()).toEqual([]);
  });

  it('saveWorkflows writes JSON', async () => {
    await saveWorkflows([{ id: 'w1' }] as unknown as Workflow[]);
    expect(tauriSetItem).toHaveBeenCalledWith('workflows', '[{"id":"w1"}]');
  });

  it('loadWorkflowSampleDismissed returns true when stored', async () => {
    tauriGetItem.mockResolvedValue('true');
    expect(await loadWorkflowSampleDismissed()).toBe(true);
  });

  it('loadWorkflowSampleDismissed returns false when not true', async () => {
    tauriGetItem.mockResolvedValue('false');
    expect(await loadWorkflowSampleDismissed()).toBe(false);
  });

  it('loadWorkflowSampleDismissed returns false on error', async () => {
    tauriGetItem.mockRejectedValue(new Error('fail'));
    expect(await loadWorkflowSampleDismissed()).toBe(false);
  });

  it('saveWorkflowSampleDismissed writes true', async () => {
    await saveWorkflowSampleDismissed(true);
    expect(tauriSetItem).toHaveBeenCalledWith('workflows_sample_dismissed', 'true');
  });

  it('saveWorkflowSampleDismissed writes false', async () => {
    await saveWorkflowSampleDismissed(false);
    expect(tauriSetItem).toHaveBeenCalledWith('workflows_sample_dismissed', 'false');
  });
});

describe('preview sample ID (sessionStorage)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('loadPreviewSampleId returns null when nothing stored', () => {
    expect(loadPreviewSampleId()).toBeNull();
  });

  it('savePreviewSampleId stores and loads the id', () => {
    savePreviewSampleId('sample-workflow-001');
    expect(loadPreviewSampleId()).toBe('sample-workflow-001');
  });

  it('savePreviewSampleId(null) clears the stored id', () => {
    savePreviewSampleId('sample-workflow-001');
    savePreviewSampleId(null);
    expect(loadPreviewSampleId()).toBeNull();
  });

  it('savePreviewSampleId(null) ignores removeItem errors', () => {
    sessionStorage.setItem('workflow_preview_sample_id', 'sample-workflow-001');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => savePreviewSampleId(null)).not.toThrow();
    vi.restoreAllMocks();
  });

  it('loadPreviewSampleId returns null when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadPreviewSampleId()).toBeNull();
    vi.restoreAllMocks();
  });

  it('loadPreviewSampleId returns null for empty string', () => {
    sessionStorage.setItem('workflow_preview_sample_id', '');
    expect(loadPreviewSampleId()).toBeNull();
  });
});
