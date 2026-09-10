/** @vitest-environment jsdom */

import '@testing-library/jest-dom';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Environment, FeatureGroup, Microservice, RequestCollection, Scenario } from '@shared/types';
import type { SendToHarnessPayload } from '../../features/requests/components/SendToHarnessModal';
import { useHarnessPromotion } from './useHarnessPromotion';

const promoteToFeatureGroups = vi.fn();
const batchPromoteCollection = vi.fn();
const catalogEndpointToRequest = vi.fn();

vi.mock('../../features/requests/utils/promoteToHarness', () => ({
  promoteToFeatureGroups: (...a: unknown[]) => promoteToFeatureGroups(...a),
  batchPromoteCollection: (...a: unknown[]) => batchPromoteCollection(...a),
}));

vi.mock('../../features/catalog/utils/catalogEndpointToRequest', () => ({
  catalogEndpointToRequest: (...a: unknown[]) => catalogEndpointToRequest(...a),
}));

afterEach(() => {
  cleanup();
  promoteToFeatureGroups.mockReset();
  batchPromoteCollection.mockReset();
  catalogEndpointToRequest.mockReset();
});

function minimalScenario(id: string): Scenario {
  return {
    id,
    name: 'T',
    url: '/',
    method: 'GET',
    headers: [],
    body: '',
    auth: { type: 'none' },
    validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
  };
}

function makeCollections(): RequestCollection[] {
  return [{
    id: 'col-batch',
    name: 'Batch',
    mode: 'direct',
    requests: [{ id: 'rq1', url: '/', method: 'GET', headers: [], body: '', name: 'A', auth: { type: 'none' }, validation: { rules: [], expectedStatus: '^200$', expectedBody: '' }, parameters: {}, bodyType: 'none' }],
  }];
}

describe('useHarnessPromotion', () => {
  it('computes harnessPromotionContext only when collection and selected request exist', () => {
    const wbSel = makeWb({ selectedCollection: makeCollections()[0], selectedRequest: makeCollections()[0].requests[0] });
    const { result } = renderHook(() => useHarnessPromotion(baseParams(wbSel)));
    expect(result.current.harnessPromotionContext).not.toBeNull();

    const wbBare = makeWb({ selectedCollection: undefined, selectedRequest: undefined });
    const { result: r2 } = renderHook(() => useHarnessPromotion(baseParams(wbBare)));
    expect(r2.current.harnessPromotionContext).toBeNull();
  });

  it('sets folderId from the selected request parent folder', () => {
    const req = makeCollections()[0].requests[0];
    const col: RequestCollection = {
      id: 'col-nested',
      name: 'Nested',
      mode: 'direct',
      requests: [],
      folders: [{ id: 'fold-local', name: 'local-t01', requests: [req], folders: [] }],
    };
    const wb = makeWb({ collections: [col], selectedCollection: col, selectedRequest: req });
    const { result } = renderHook(() => useHarnessPromotion(baseParams(wb)));
    expect(result.current.harnessPromotionContext?.folderId).toBe('fold-local');
  });

  it('handleSendToHarnessConfirm applies promotion result, switches env/svc/tab, resets catalog endpoint', () => {
    promoteToFeatureGroups.mockReturnValue({
      featureGroups: [{ id: 'fg', name: 'G', scenarios: [], environmentId: 'e-new', microserviceId: 's-new' }] as FeatureGroup[],
      createdGroupId: 'g1',
      createdScenarioId: 'sc1',
    });

    const setFeatureGroups = vi.fn();
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    const setActiveTab = vi.fn();
    const toast = { show: vi.fn() };

    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(makeWb(), { setSelectedEnvId, setSelectedSvcId }),
        selectedEnvId: 'e-old',
        selectedSvcId: 's-old',
        setFeatureGroups,
        toast,
        setActiveTab,
      }));

    act(() => {
      result.current.setCatalogHarnessEndpoint({ entry: makeCatalogHarnessEntry(), endpoint: makeHarnessEndpoint(), fromTryItOut: true });
      result.current.setShowSendToHarness(true);
    });

    const payload: SendToHarnessPayload = {
      scenario: minimalScenario('t1'),
      newGroupName: 'New FG',
      openEditorAfter: false,
      environmentId: 'e-new',
      microserviceId: 's-new',
    };

    act(() => {
      result.current.handleSendToHarnessConfirm(payload);
    });

    expect(promoteToFeatureGroups).toHaveBeenCalled();
    expect(setFeatureGroups).toHaveBeenCalledTimes(1);
    expect(setSelectedEnvId).toHaveBeenCalledWith('e-new');
    expect(setSelectedSvcId).toHaveBeenCalledWith('s-new');
    expect(setActiveTab).toHaveBeenCalledWith('scenarios');
    expect(toast.show).toHaveBeenCalledWith('success', 'Sent to Harness', 'Test "T" created');
    expect(result.current.showSendToHarness).toBe(false);
    expect(result.current.catalogHarnessEndpoint).toBeUndefined();
  });

  it('handleSendToHarnessConfirm sets pendingEditTest when openEditorAfter is true', () => {
    promoteToFeatureGroups.mockReturnValue({
      featureGroups: [],
      createdGroupId: 'cg',
      createdScenarioId: 'cs',
    });

    const { result } = renderHook(() => useHarnessPromotion(baseParams(makeWb())));
    act(() => {
      result.current.handleSendToHarnessConfirm({
        scenario: minimalScenario('tid'),
        newGroupName: 'X',
        openEditorAfter: true,
      });
    });

    expect(result.current.pendingEditTest).toEqual({
      featureId: 'cg',
      scenarioId: 'cs',
      testId: 'tid',
    });
  });

  it('handleBatchSendToHarnessConfirm is a no-op when collection id missing', () => {
    const { result } = renderHook(() => useHarnessPromotion(baseParams(makeWb({ collections: [] }))));
    act(() => {
      result.current.handleBatchSendToHarnessConfirm({
        collectionId: 'missing',
        selectedRequestIds: new Set(['a']),
        validationPreset: 'none',
        authMode: 'inherit',
      });
    });

    expect(batchPromoteCollection).not.toHaveBeenCalled();
    expect(result.current.batchHarnessTarget).toBeUndefined();
  });

  it('handleBatchSendToHarnessConfirm appends batch group and notifies', () => {
    batchPromoteCollection.mockReturnValue({
      featureGroup: { id: 'fgb', name: 'BatchGrp', scenarios: [] } as FeatureGroup,
      promotedRequestIds: ['rq1', 'rq2'],
    });

    let groups: FeatureGroup[] = [{ id: 'existing', name: 'E', scenarios: [] }] as FeatureGroup[];
    const setFeatureGroupsStateful = vi.fn((u: FeatureGroup[] | ((p: FeatureGroup[]) => FeatureGroup[])) => {
      groups = typeof u === 'function' ? u(groups) : u;
    });

    const toast = { show: vi.fn() };
    const setActiveTab = vi.fn();
    const col = makeCollections()[0];

    const wb = makeWb({ collections: [col] });

    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(wb),
        selectedEnvId: 'app-e',
        selectedSvcId: 'app-s',
        setFeatureGroups: setFeatureGroupsStateful,
        toast,
        setActiveTab,
      }));

    act(() => {
      result.current.setBatchHarnessTarget({ colId: 'col-batch', folderId: undefined });
      result.current.handleBatchSendToHarnessConfirm({
        collectionId: 'col-batch',
        selectedRequestIds: new Set(['rq1']),
        validationPreset: 'status-200',
        authMode: 'concrete',
        environmentId: 'eff-e',
        microserviceId: 'eff-s',
      });
    });

    expect(batchPromoteCollection).toHaveBeenCalled();
    expect(groups.find(g => g.id === 'fgb')).toBeTruthy();
    expect(toast.show).toHaveBeenCalledWith('success', 'Batch sent to Harness', expect.stringContaining('2 tests'));
    expect(setActiveTab).toHaveBeenCalledWith('scenarios');
    expect(result.current.batchHarnessTarget).toBeUndefined();
  });

  it('uses the selected Settings env id directly for batch urls', () => {
    batchPromoteCollection.mockReturnValue({
      featureGroup: { id: 'fgx', name: 'X', scenarios: [] } as FeatureGroup,
      promotedRequestIds: ['rq1'],
    });

    const wb = makeWb({
      collections: makeCollections(),
      selectedEnvId: 'wb-current',
      environments: [{ id: 'wb-by-name', name: 'Staging', baseUrls: {} }],
    });

    let groups: FeatureGroup[] = [];
    const setFeatureGroups = vi.fn((u: FeatureGroup[] | ((p: FeatureGroup[]) => FeatureGroup[])) => {
      groups = typeof u === 'function' ? u(groups) : u;
    });

    const environments: Environment[] = [{ id: 'app-env-staging-id', name: 'Staging', baseUrls: {}, customEnvs: [] }];
    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(wb),
        environments,
        setFeatureGroups,
        toast: { show: vi.fn() },
        selectedEnvId: 'other',
      }));

    act(() => {
      result.current.handleBatchSendToHarnessConfirm({
        collectionId: 'col-batch',
        selectedRequestIds: new Set(['rq1']),
        validationPreset: 'none',
        authMode: 'concrete',
        environmentId: 'app-env-staging-id',
      });
    });

    const ctxPassed = batchPromoteCollection.mock.calls[0]?.[1] as { selectedEnvId: string };
    expect(ctxPassed.selectedEnvId).toBe('app-env-staging-id');
  });

  it('handleSendToHarnessConfirm skips sidebar env/service updates when overrides match selections', () => {
    promoteToFeatureGroups.mockReturnValue({
      featureGroups: [],
      createdGroupId: 'g',
      createdScenarioId: 's',
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(makeWb()),
        selectedEnvId: 'e1',
        selectedSvcId: 's1',
        setSelectedEnvId,
        setSelectedSvcId,
      }));
    act(() => {
      result.current.handleSendToHarnessConfirm({
        scenario: minimalScenario('x'),
        newGroupName: 'G',
        openEditorAfter: false,
        environmentId: 'e1',
        microserviceId: 's1',
      });
    });
    expect(setSelectedEnvId).not.toHaveBeenCalled();
    expect(setSelectedSvcId).not.toHaveBeenCalled();
  });

  it('batch promotion falls back to selected workbench env when payload env unknown', () => {
    batchPromoteCollection.mockReturnValue({
      featureGroup: { id: 'fb', name: 'Fb', scenarios: [] } as FeatureGroup,
      promotedRequestIds: ['rq1'],
    });
    const wb = makeWb({
      selectedEnvId: 'wb-current',
      environments: [{ id: 'wb-current', name: 'Local', baseUrls: {} }],
    });
    let groups: FeatureGroup[] = [];
    const setFeatureGroups = vi.fn((u: FeatureGroup[] | ((p: FeatureGroup[]) => FeatureGroup[])) => {
      groups = typeof u === 'function' ? u(groups) : u;
    });

    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(wb),
        environments: [],
        setFeatureGroups,
        toast: { show: vi.fn() },
      }));

    act(() => {
      result.current.handleBatchSendToHarnessConfirm({
        collectionId: 'col-batch',
        selectedRequestIds: new Set(['rq1']),
        validationPreset: 'none',
        authMode: 'concrete',
        environmentId: '__unknown-app-env__',
      });
    });

    const ctx = batchPromoteCollection.mock.calls[0]?.[1] as { selectedEnvId: string };
    expect(ctx.selectedEnvId).toBe('wb-current');
    expect(groups.find(g => g.id === 'fb')).toBeTruthy();
  });

  it('catalogHarnessPromotionCtx converts catalog harness endpoint via catalogEndpointToRequest', () => {
    catalogEndpointToRequest.mockReturnValue({
      id: 'tr',
      url: '/p',
      method: 'POST',
      name: '',
      headers: [],
      body: '',
      auth: { type: 'none' },
      validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
      parameters: {},
      bodyType: 'none',
    });

    const { result } = renderHook(() =>
      useHarnessPromotion(baseParams(makeWb())));

    expect(result.current.catalogHarnessPromotionCtx).toBeNull();

    act(() => {
      result.current.setCatalogHarnessEndpoint({
        entry: makeCatalogHarnessEntry(),
        endpoint: makeHarnessEndpoint(),
      });
    });

    expect(catalogEndpointToRequest).toHaveBeenCalledTimes(1);
    const firstCall = catalogEndpointToRequest.mock.calls[0]!;
    expect(firstCall[3]).toBe('cat-entry');
    expect(firstCall[4]).toBe('Cat');
    expect(firstCall[5]).toBe('3.4.5');
    expect(result.current.catalogHarnessPromotionCtx?.collection.requests).toHaveLength(1);
    expect(result.current.catalogHarnessPromotionCtx?.collection.mode).toBe('direct');
  });

  it('catalog harness omits catalog version argument when selected version id mismatches catalog entry', () => {
    catalogEndpointToRequest.mockReturnValue({
      id: 'tr',
      url: '/p',
      method: 'POST',
      name: '',
      headers: [],
      body: '',
      auth: { type: 'none' },
      validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
      parameters: {},
      bodyType: 'none',
    });

    const { result } = renderHook(() => useHarnessPromotion(baseParams(makeWb())));

    act(() => {
      result.current.setCatalogHarnessEndpoint({
        entry: {
          ...makeCatalogHarnessEntry(),
          currentVersionId: 'missing-version',
        },
        endpoint: makeHarnessEndpoint(),
      });
    });

    expect(catalogEndpointToRequest.mock.calls[0]?.[5]).toBeUndefined();
  });

  it('preserves ids when batch env already belongs to Requests workbench roster', () => {
    batchPromoteCollection.mockReturnValue({
      featureGroup: { id: 'same', name: 'S', scenarios: [] } as FeatureGroup,
      promotedRequestIds: ['rq1'],
    });
    const wb = makeWb({
      environments: [{ id: 'wb-native', name: 'Dev', baseUrls: {} }],
      selectedEnvId: 'wb-native',
    });

    let groups: FeatureGroup[] = [];
    const setFeatureGroups = vi.fn((u: FeatureGroup[] | ((p: FeatureGroup[]) => FeatureGroup[])) => {
      groups = typeof u === 'function' ? u(groups) : u;
    });

    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(wb),
        environments: [{ id: 'app-remote', name: 'Other', baseUrls: {}, customEnvs: [] }],
        setFeatureGroups,
        toast: { show: vi.fn() },
      }));

    act(() => {
      result.current.handleBatchSendToHarnessConfirm({
        collectionId: 'col-batch',
        selectedRequestIds: new Set(['rq1']),
        validationPreset: 'none',
        authMode: 'concrete',
        environmentId: 'wb-native',
      });
    });

    const ctxPassed = batchPromoteCollection.mock.calls[0]?.[1] as { selectedEnvId: string };
    expect(ctxPassed.selectedEnvId).toBe('wb-native');
    expect(groups.find(g => g.id === 'same')).toBeTruthy();
  });

  it('handleSendToHarnessConfirm updates only environment when microservice unchanged', () => {
    promoteToFeatureGroups.mockReturnValue({
      featureGroups: [],
      createdGroupId: 'g',
      createdScenarioId: 's',
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(makeWb()),
        selectedEnvId: 'stay-e',
        selectedSvcId: 'stay-m',
        setSelectedEnvId,
        setSelectedSvcId,
      }),
    );
    act(() => {
      result.current.handleSendToHarnessConfirm({
        scenario: minimalScenario('tid'),
        newGroupName: 'G',
        openEditorAfter: false,
        environmentId: 'new-e',
        microserviceId: 'stay-m',
      });
    });
    expect(setSelectedEnvId).toHaveBeenCalledWith('new-e');
    expect(setSelectedSvcId).not.toHaveBeenCalled();
  });

  it('handleSendToHarnessConfirm updates only microservice when environment unchanged', () => {
    promoteToFeatureGroups.mockReturnValue({
      featureGroups: [],
      createdGroupId: 'g',
      createdScenarioId: 's',
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(makeWb()),
        selectedEnvId: 'stay-e',
        selectedSvcId: 'stay-m',
        setSelectedEnvId,
        setSelectedSvcId,
      }),
    );
    act(() => {
      result.current.handleSendToHarnessConfirm({
        scenario: minimalScenario('tid'),
        newGroupName: 'G',
        openEditorAfter: false,
        environmentId: 'stay-e',
        microserviceId: 'new-m',
      });
    });
    expect(setSelectedEnvId).not.toHaveBeenCalled();
    expect(setSelectedSvcId).toHaveBeenCalledWith('new-m');
  });

  it('uses the resolved Settings env id for batch urls', () => {
    batchPromoteCollection.mockReturnValue({
      featureGroup: { id: 'fgz', name: 'Z', scenarios: [] } as FeatureGroup,
      promotedRequestIds: ['rq1'],
    });
    const wb = makeWb({
      environments: [{ id: 'wb-only', name: 'WorkbenchName', baseUrls: {} }],
      selectedEnvId: 'wb-current',
      collections: makeCollections(),
    });
    let groups: FeatureGroup[] = [];
    const setFeatureGroups = vi.fn((u: FeatureGroup[] | ((p: FeatureGroup[]) => FeatureGroup[])) => {
      groups = typeof u === 'function' ? u(groups) : u;
    });
    const environments: Environment[] = [
      { id: 'app-route', name: 'AppOnlyEnv', baseUrls: {}, customEnvs: [] },
    ];
    const { result } = renderHook(() =>
      useHarnessPromotion({
        ...baseParams(wb),
        environments,
        setFeatureGroups,
        toast: { show: vi.fn() },
      }),
    );
    act(() => {
      result.current.handleBatchSendToHarnessConfirm({
        collectionId: 'col-batch',
        selectedRequestIds: new Set(['rq1']),
        validationPreset: 'none',
        authMode: 'concrete',
        environmentId: 'app-route',
      });
    });
    const ctxPassed = batchPromoteCollection.mock.calls[0]?.[1] as { selectedEnvId: string };
    expect(ctxPassed.selectedEnvId).toBe('app-route');
    expect(groups.find(g => g.id === 'fgz')).toBeTruthy();
  });

  it('treats empty promotion overrides like omitted selections', () => {
    promoteToFeatureGroups.mockReturnValue({
      featureGroups: [],
      createdGroupId: 'g',
      createdScenarioId: 's',
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    const { result } = renderHook(() =>
      useHarnessPromotion(baseParams(makeWb(), {
        selectedEnvId: 'cur-e',
        selectedSvcId: 'cur-s',
        setSelectedEnvId,
        setSelectedSvcId,
      })),
    );

    act(() => {
      result.current.handleSendToHarnessConfirm({
        scenario: minimalScenario('tid'),
        newGroupName: 'G',
        openEditorAfter: false,
        environmentId: '',
        microserviceId: '',
      } as SendToHarnessPayload);
    });

    expect(setSelectedEnvId).not.toHaveBeenCalled();
    expect(setSelectedSvcId).not.toHaveBeenCalled();
  });
});

function baseParams(wb: ReturnType<typeof makeWb>, overrides?: Partial<Parameters<typeof useHarnessPromotion>[0]>) {
  return {
    wb,
    featureGroups: [],
    setFeatureGroups: vi.fn(),
    selectedEnvId: 'e-default',
    selectedSvcId: 's-default',
    setSelectedEnvId: vi.fn(),
    setSelectedSvcId: vi.fn(),
    appGlobalAuthProfiles: [],
    microservices: [] as Microservice[],
    environments: [] as Environment[],
    toast: { show: vi.fn() },
    setActiveTab: vi.fn(),
    ...overrides,
  };
}

function makeWb(override?: Partial<import('../../features/requests/hooks/useRequests').UseRequestsReturn>) {
  const cols = override?.collections ?? makeCollections();
  const col = cols[0];
  return {
    collections: cols,
    environments: [{ id: 'wb-current', name: 'Local', baseUrls: {} }],
    selectedEnvId: 'wb-current',
    addGroup: vi.fn(),
    updateRequest: vi.fn(),
    importCollection: vi.fn(),
    addEnvironments: vi.fn(),
    selectedCollection: col,
    selectedRequest: col?.requests[0],
    ...override,
  } as import('../../features/requests/hooks/useRequests').UseRequestsReturn;
}

function makeCatalogHarnessEntry() {
  return {
    id: 'cat-entry',
    name: 'Cat',
    currentVersionId: 'v1',
    versions: [{ id: 'v1', version: '3.4.5', importedAt: 1, specHash: 'x', specSize: 5 }],
    servers: [{ url: 'https://a.io' }] as Array<{ url: string }>,
    securitySchemes: {},
    folders: [],
    endpoints: [],
    hostConfig: {},
    authConfig: { type: 'none' },
  };
}

function makeHarnessEndpoint(): import('../../features/catalog/types/catalog').CatalogEndpoint {
  return {
    id: 'hep',
    summary: 'Do',
    method: 'DELETE',
    path: '/del',
    parameters: [],
    responses: [],
    tags: [],
  };
}
