/** @vitest-environment jsdom */

import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeatureGroup } from '@shared/types';
import { CatalogEndpoint, CatalogEntry } from '../../features/catalog/types/catalog';
import { Tab } from '../utils/appTabUtils';
import { UseRequestsReturn } from '../../features/requests/hooks/useRequests';
import AppWorkbenchModals from './AppWorkbenchModals';
import { CatalogHarnessEndpointState } from '../hooks/useHarnessPromotion';
import { PromotionContext } from '../../features/requests/utils/requestToScenario';
import type { CatalogConvertTarget, SaveConvertedVersionArgs } from '../hooks/useCatalogState';

const sendHarnessPropsSpy = vi.fn();

vi.mock('../../features/catalog/components/CatalogSendToRequestsModal', () => ({
  __esModule: true,
  default: ({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }) => (
    <div data-testid="mock-send-requests">
      {entry.id}
      <button type="button" onClick={onClose}>close-send</button>
    </div>
  ),
}));

vi.mock('../../features/catalog/components/CatalogImportModal', () => ({
  __esModule: true,
  default: ({ onClose, onImport, onReimport }: {
    onClose: () => void;
    onImport: (entry: CatalogEntry, rawSpec: string) => void;
    onReimport: (entryId: string, parsed: unknown) => void;
  }) => (
    <div data-testid="mock-import">
      <button type="button" data-testid="mock-import-close" onClick={() => onClose()}>c</button>
      <button
        type="button"
        data-testid="mock-import-do"
        onClick={() => onImport({
          id: 'ne',
          name: 'NN',
          currentVersionId: 'vv',
          versions: [{ id: 'vv', version: '1', importedAt: 1, specHash: 'z', specSize: 9 }],
          servers: [],
          securitySchemes: {},
          folders: [],
          endpoints: [],
          hostConfig: {},
          authConfig: { type: 'none' },
        }, '')}
      >i</button>
      <button type="button" data-testid="mock-import-reimport" onClick={() => onReimport('tracked', {})}>re</button>
    </div>
  ),
}));

vi.mock('../../features/catalog/components/CatalogVersionHistory', () => ({
  __esModule: true,
  default: ({
    onClose,
    onSwitchVersion,
    onReimport,
  }: {
    onClose: () => void;
    onSwitchVersion: (versionId: string) => void;
    onReimport: () => void;
  }) => (
    <div data-testid="mock-version-history">
      <button type="button" data-testid="mock-vh-close" onClick={() => onClose()}>c</button>
      <button type="button" data-testid="mock-vh-switch" onClick={() => onSwitchVersion('vnext')}>s</button>
      <button type="button" data-testid="mock-vh-reimport" onClick={() => onReimport()}>r</button>
    </div>
  ),
}));

vi.mock('../../features/catalog/components/CatalogEditModal', () => ({
  __esModule: true,
  default: ({ onClose, onSave }: {
    onClose: () => void;
    onSave: (patch: { name?: string }) => void;
  }) => (
    <div data-testid="mock-edit">
      <button type="button" data-testid="mock-edit-close" onClick={() => onClose()}>c</button>
      <button type="button" data-testid="mock-edit-save" onClick={() => onSave({ name: 'edited' })}>s</button>
    </div>
  ),
}));

vi.mock('../../features/catalog/components/CatalogConvertOpenApiModal', () => ({
  __esModule: true,
  default: ({ specName, onClose, onSaveAsVersion }: {
    specName: string;
    onClose: () => void;
    onSaveAsVersion?: (args: SaveConvertedVersionArgs) => void;
  }) => (
    <div data-testid="mock-convert">
      {specName}
      <button type="button" data-testid="mock-convert-close" onClick={() => onClose()}>c</button>
      <button
        type="button"
        data-testid="mock-convert-save"
        onClick={() => onSaveAsVersion?.({
          yaml: 'openapi: 3.0.4\n',
          openapiVersion: '3.0.4',
          engineUsed: 'swagger2openapi',
          mode: 'convert',
        })}
      >s</button>
    </div>
  ),
}));

vi.mock('../../features/requests/components/SendToHarnessModal', () => ({
  __esModule: true,
  default: (props: {
    onConfirm: (payload: { scenario: { id: string; name: string; url: string; method: 'GET'; headers: []; body: string; auth: { type: 'none' }; validation: { rules: []; expectedStatus: string; expectedBody: string } }; openEditorAfter: boolean }) => void;
    onClose: () => void;
  }) => {
    sendHarnessPropsSpy(props);
    return (
      <div data-testid="mock-send-harness">
        <button
          type="button"
          data-testid="mock-harness-confirm"
          onClick={() => props.onConfirm({
            scenario: {
              id: 'sid',
              name: 'Nm',
              url: '/',
              method: 'GET',
              headers: [],
              body: '',
              auth: { type: 'none' },
              validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
            },
            openEditorAfter: false,
          })}
        >
          send
        </button>
        <button type="button" data-testid="mock-harness-close" onClick={() => props.onClose()}>x</button>
      </div>
    );
  },
}));

const batchHarnessCollectSpy = vi.fn();

vi.mock('../../features/requests/components/BatchSendToHarnessModal', () => ({
  __esModule: true,
  default: ({
    collection,
    onConfirm,
    onClose,
  }: {
    collection: { id: string; requests: unknown[] };
    onConfirm?: () => void;
    onClose: () => void;
  }) => {
    batchHarnessCollectSpy(collection);
    return (
      <div>
        <button type="button" data-testid="mock-batch" onClick={() => onConfirm?.()}>
          {collection.id}:{collection.requests.length}
        </button>
        <button type="button" data-testid="mock-batch-close" onClick={() => onClose()}>
          close-batch
        </button>
      </div>
    );
  },
}));

vi.mock('../../features/api-mock/components/ExportToApiMockModal', () => ({
  ExportToApiMockModal: ({ items, sourceKind, onClose }: {
    items: { method: string; path: string }[];
    sourceKind: string;
    onClose: () => void;
  }) => (
    <div data-testid="mock-export-mock">
      <span data-testid="mock-export-kind">{sourceKind}</span>
      <span data-testid="mock-export-count">{items.length}</span>
      <button type="button" data-testid="mock-export-close" onClick={onClose}>close-mock</button>
    </div>
  ),
}));

vi.mock('../../features/catalog/utils/catalogEndpointToRequest', () => ({
  catalogEndpointToRequest: vi.fn().mockReturnValue({
    id: 'temp',
    name: '',
    url: '/t',
    method: 'GET',
    headers: [],
    body: '',
    auth: { type: 'none' },
    validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
    parameters: {},
    bodyType: 'none',
  }),
}));

afterEach(() => {
  cleanup();
  sendHarnessPropsSpy.mockReset();
  batchHarnessCollectSpy.mockReset();
});

function catalogStub(opts: Partial<Parameters<typeof AppWorkbenchModals>[0]['catalog']> = {}) {
  return {
    entries: [],
    addEntry: vi.fn(),
    addVersionToEntry: vi.fn(),
    updateEntry: vi.fn(),
    switchVersion: vi.fn(),
    loadRawSpec: vi.fn(),
    ...opts,
  } as unknown as Parameters<typeof AppWorkbenchModals>[0]['catalog'];
}

function wbStub(partial: Partial<UseRequestsReturn> = {}): UseRequestsReturn {
  return {
    collections: [],
    environments: [{ id: 'we', name: 'E' }],
    selectedEnvId: 'we',
    addGroup: vi.fn(),
    updateRequest: vi.fn(),
    importCollection: vi.fn(),
    addEnvironments: vi.fn(),
    selectedCollection: undefined,
    selectedRequest: undefined,
    ...partial,
  } as UseRequestsReturn;
}

describe('AppWorkbenchModals', () => {
  it('shows Send Requests modal closing clears entry state callers', () => {
    const setSendToReqEntry = vi.fn();
    const setSendToReqSingleEndpoint = vi.fn();
    const entry = makeMinimalCatalogEntry({ id: 'ce1', name: 'API' });

    render(
      <AppWorkbenchModals
        {...emptyShell()}
        sendToReqEntry={entry}
        setSendToReqEntry={setSendToReqEntry}
        setSendToReqSingleEndpoint={setSendToReqSingleEndpoint}
        handleSendToReqConfirm={() => {}}
      />,
    );

    expect(screen.getByTestId('mock-send-requests')).toHaveTextContent('ce1');
    fireEvent.click(screen.getByText('close-send'));
    expect(setSendToReqEntry).toHaveBeenCalledWith(undefined);
    expect(setSendToReqSingleEndpoint).toHaveBeenCalledWith(undefined);
  });

  it('delegates Harness flow to persisted request selections', () => {
    const col = requestCollectionFixture();

    render(
      <AppWorkbenchModals
        {...emptyShell({
          wb: wbStub({
            collections: [col],
            selectedCollection: col,
            selectedRequest: col.requests[0],
          }),
          showSendToHarness: true,
          harnessPromotionContext: {
            collection: col,
            selectedEnvId: 'we',
            environments: [{ id: 'we', name: 'E' }],
            globalAuthProfiles: [],
            microservices: [],
            appEnvironments: [],
          },
        })}
      />,
    );

    expect(sendHarnessPropsSpy.mock.calls[0]?.[0]).toMatchObject({ request: expect.objectContaining({ id: 'rq' }) });
  });

  it('closes Harness modal for workbook requests directly', () => {
    const setHarness = vi.fn();
    const col = requestCollectionFixture();

    render(
      <AppWorkbenchModals
        {...emptyShell({
          wb: wbStub({
            collections: [col],
            selectedCollection: col,
            selectedRequest: col.requests[0],
          }),
          showSendToHarness: true,
          setShowSendToHarness: setHarness,
          harnessPromotionContext: {
            collection: col,
            selectedEnvId: 'we',
            environments: [{ id: 'we', name: 'E' }],
            globalAuthProfiles: [],
            microservices: [],
            appEnvironments: [],
          },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-harness-close'));
    expect(setHarness).toHaveBeenCalledWith(false);
  });

  it('narrow batch targets to folders while preserving identifiers', () => {
    const col = {
      id: 'cid',
      name: 'Nm',
      mode: 'direct' as const,
      requests: [],
      folders: [{
        id: 'fold',
        name: 'F',
        folders: [],
        requests: [{
          id: 'inner-req',
          name: 'In',
          url: '/f',
          method: 'PATCH' as const,
          headers: [],
          body: '',
          auth: { type: 'none' },
          validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
          parameters: {},
          bodyType: 'none' as const,
        }],
      }],
    };

    render(
      <AppWorkbenchModals
        {...emptyShell({
          wb: wbStub({ collections: [col], selectedCollection: col }),
          batchHarnessTarget: { colId: 'cid', folderId: 'fold' },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-batch'));
    expect(batchHarnessCollectSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cid',
      requests: [expect.objectContaining({ id: 'inner-req' })],
      folders: [],
    }));
  });

  it('sets default validation preset for catalog Harness preview', () => {
    const entry = makeMinimalCatalogEntry({ id: 'ce', endpoints: [sampleEndpoint()] });

    render(
      <AppWorkbenchModals
        {...emptyShell({
          showSendToHarness: true,
          catalogHarnessEndpoint: { entry, endpoint: sampleEndpoint(), fromTryItOut: true },
          catalogHarnessPromotionCtx: harnessCtxStub(),
        })}
      />,
    );

    expect(sendHarnessPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ defaultValidationPreset: 'status-200' }));
  });

  it('skips Harness modal when prerequisites are incomplete', () => {
    render(
      <AppWorkbenchModals
        {...emptyShell({
          showSendToHarness: true,
          wb: wbStub(),
          harnessPromotionContext: null,
          catalogHarnessEndpoint: undefined,
        })}
      />,
    );

    expect(screen.queryByTestId('mock-send-harness')).toBeNull();
  });

  it('closes catalog Harness sessions by clearing endpoint state', () => {
    const setShow = vi.fn();
    const setCatalog = vi.fn();
    const entry = makeMinimalCatalogEntry({ endpoints: [sampleEndpoint()] });

    render(
      <AppWorkbenchModals
        {...emptyShell({
          showSendToHarness: true,
          setShowSendToHarness: setShow,
          catalogHarnessEndpoint: { entry, endpoint: sampleEndpoint() },
          setCatalogHarnessEndpoint: setCatalog,
          catalogHarnessPromotionCtx: harnessCtxStub(),
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-harness-close'));
    expect(setShow).toHaveBeenCalledWith(false);
    expect(setCatalog).toHaveBeenCalledWith(undefined);
  });

  it('confirms catalog Harness promotion then clears transient endpoint', () => {
    const setCatalog = vi.fn();
    const handle = vi.fn();
    const entry = makeMinimalCatalogEntry({ endpoints: [sampleEndpoint()] });

    render(
      <AppWorkbenchModals
        {...emptyShell({
          showSendToHarness: true,
          catalogHarnessEndpoint: { entry, endpoint: sampleEndpoint() },
          setCatalogHarnessEndpoint: setCatalog,
          catalogHarnessPromotionCtx: harnessCtxStub(),
          handleSendToHarnessConfirm: handle,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-harness-confirm'));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(setCatalog).toHaveBeenCalledWith(undefined);
  });

  it('pipes Catalog Import callbacks into catalog workbook actions', () => {
    const addEntry = vi.fn();
    const addVersionToEntry = vi.fn();
    const setShowImport = vi.fn();
    const setReimport = vi.fn();
    const setInit = vi.fn();
    const setActiveTab = vi.fn();

    render(
      <AppWorkbenchModals
        {...emptyShell({
          catalog: catalogStub({ addEntry, addVersionToEntry }),
          showCatalogImport: true,
          setShowCatalogImport: setShowImport,
          setCatalogReimportId: setReimport,
          setCatalogInitialSpec: setInit,
          setActiveTab,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-import-do'));
    expect(addEntry).toHaveBeenCalled();
    expect(setActiveTab).toHaveBeenCalledWith('catalog');

    fireEvent.click(screen.getByTestId('mock-import-reimport'));
    expect(addVersionToEntry).toHaveBeenCalledWith('tracked', {});

    fireEvent.click(screen.getByTestId('mock-import-close'));
    expect(setShowImport).toHaveBeenCalledWith(false);
    expect(setReimport).toHaveBeenCalledWith(undefined);
    expect(setInit).toHaveBeenCalledWith(undefined);
  });

  it('routes version history shortcuts back into catalog state', () => {
    const entry = makeMinimalCatalogEntry({ id: 'hist' });
    const switchVersion = vi.fn();
    const setReimport = vi.fn();
    const setImport = vi.fn();

    const setVh = vi.fn();

    render(
      <AppWorkbenchModals
        {...emptyShell({
          catalog: catalogStub({ entries: [entry], switchVersion }),
          catalogVersionHistoryId: 'hist',
          setCatalogVersionHistoryId: setVh,
          setCatalogReimportId: setReimport,
          setShowCatalogImport: setImport,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-vh-switch'));
    expect(switchVersion).toHaveBeenCalledWith('hist', 'vnext');

    fireEvent.click(screen.getByTestId('mock-vh-reimport'));
    expect(setReimport).toHaveBeenCalledWith('hist');
    expect(setImport).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('mock-vh-close'));
    expect(setVh).toHaveBeenCalledWith(undefined);
  });

  it('returns null history shell when referenced entry evaporates', () => {
    render(
      <AppWorkbenchModals
        {...emptyShell({
          catalog: catalogStub({ entries: [] }),
          catalogVersionHistoryId: 'gone',
        })}
      />,
    );

    expect(screen.queryByTestId('mock-version-history')).toBeNull();
  });

  it('hides Catalog edit drawer when stale id remains', () => {
    render(
      <AppWorkbenchModals
        {...emptyShell({
          catalog: catalogStub({ entries: [] }),
          catalogEditId: 'missing',
        })}
      />,
    );

    expect(screen.queryByTestId('mock-edit')).toBeNull();
  });

  it('delegates edits into catalog persistence', () => {
    const updateEntry = vi.fn();
    const setEditId = vi.fn();
    render(
      <AppWorkbenchModals
        {...emptyShell({
          catalog: catalogStub({ entries: [makeMinimalCatalogEntry({ id: 'ed' })], updateEntry }),
          catalogEditId: 'ed',
          setCatalogEditId: setEditId,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-edit-save'));
    expect(updateEntry).toHaveBeenCalledWith('ed', { name: 'edited' });

    fireEvent.click(screen.getByTestId('mock-edit-close'));
    expect(setEditId).toHaveBeenCalledWith(undefined);
  });

  it('wires the Convert modal save + close into catalog state', () => {
    const setConvert = vi.fn();
    const handleSave = vi.fn();

    render(
      <AppWorkbenchModals
        {...emptyShell({
          catalogConvert: { entryId: 'conv-e', specName: 'Conv API', rawSpec: "swagger: '2.0'" },
          setCatalogConvert: setConvert,
          handleSaveConvertedVersion: handleSave,
        })}
      />,
    );

    expect(screen.getByTestId('mock-convert')).toHaveTextContent('Conv API');

    // Save forwards the held entryId together with the modal's result payload.
    fireEvent.click(screen.getByTestId('mock-convert-save'));
    expect(handleSave).toHaveBeenCalledWith('conv-e', {
      yaml: 'openapi: 3.0.4\n',
      openapiVersion: '3.0.4',
      engineUsed: 'swagger2openapi',
      mode: 'convert',
    });

    // Close clears the convert target so the modal unmounts.
    fireEvent.click(screen.getByTestId('mock-convert-close'));
    expect(setConvert).toHaveBeenCalledWith(undefined);
  });

  it('hides the Convert modal when no convert target is set', () => {
    render(<AppWorkbenchModals {...emptyShell()} />);
    expect(screen.queryByTestId('mock-convert')).toBeNull();
  });

  it('drops batch Harness UI when referenced collection vanished', () => {
    render(
      <AppWorkbenchModals
        {...emptyShell({
          wb: wbStub({ collections: [] }),
          batchHarnessTarget: { colId: 'missing-col' },
        })}
      />,
    );

    expect(screen.queryByTestId('mock-batch')).toBeNull();
  });

  it('honors bogus folder anchors by forwarding unresolved collections', () => {
    const col = {
      id: 'cid',
      name: 'Nm',
      mode: 'direct' as const,
      requests: [{ id: 'top', name: 'T', url: '/', method: 'GET' as const, headers: [], body: '', auth: { type: 'none' }, validation: { rules: [], expectedStatus: '^200$', expectedBody: '' }, parameters: {}, bodyType: 'none' as const }],
      folders: [{
        id: 'real',
        name: 'F',
        folders: [],
        requests: [],
      }],
    };

    render(
      <AppWorkbenchModals
        {...emptyShell({
          wb: wbStub({ collections: [col] }),
          batchHarnessTarget: { colId: 'cid', folderId: '__none__' },
        })}
      />,
    );

    expect(batchHarnessCollectSpy).toHaveBeenCalledWith(expect.objectContaining({
      requests: [expect.objectContaining({ id: 'top' })],
    }));
  });

  it('closes batch Harness chrome through modal dismiss', () => {
    const setBt = vi.fn();
    const col = {
      id: 'batch-col',
      name: 'Bc',
      mode: 'direct' as const,
      requests: [{
        id: 'one',
        name: 'O',
        url: '/',
        method: 'GET' as const,
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
        parameters: {},
        bodyType: 'none' as const,
      }],
      folders: [],
    };

    render(
      <AppWorkbenchModals
        {...emptyShell({
          wb: wbStub({ collections: [col] }),
          batchHarnessTarget: { colId: 'batch-col' },
          setBatchHarnessTarget: setBt,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-batch-close'));
    expect(setBt).toHaveBeenCalledWith(undefined);
  });

  it('renders ExportToApiMockModal when exportToMockItems is set', () => {
    const clearMock = vi.fn();
    const items = [{ method: 'GET', path: '/users', label: 'List users' }];

    render(
      <AppWorkbenchModals
        {...emptyShell({
          exportToMockItems: items,
          exportToMockSourceKind: 'catalog',
          onClearExportToMock: clearMock,
        })}
      />,
    );

    expect(screen.getByTestId('mock-export-mock')).toBeInTheDocument();
    expect(screen.getByTestId('mock-export-kind')).toHaveTextContent('catalog');
    expect(screen.getByTestId('mock-export-count')).toHaveTextContent('1');
  });

  it('hides ExportToApiMockModal when exportToMockItems is null', () => {
    render(<AppWorkbenchModals {...emptyShell({ exportToMockItems: null })} />);
    expect(screen.queryByTestId('mock-export-mock')).toBeNull();
  });

  it('calls onClearExportToMock when ExportToApiMock modal closes', () => {
    const clearMock = vi.fn();
    render(
      <AppWorkbenchModals
        {...emptyShell({
          exportToMockItems: [{ method: 'POST', path: '/items', label: 'Create item' }],
          exportToMockSourceKind: 'requests',
          onClearExportToMock: clearMock,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-export-close'));
    expect(clearMock).toHaveBeenCalledTimes(1);
  });
});

function sampleEndpoint(): CatalogEndpoint {
  return {
    id: 'ep',
    summary: 'S',
    method: 'GET',
    path: '/z',
    parameters: [],
    responses: [],
    tags: [],
  };
}

function makeMinimalCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'id',
    name: 'Nm',
    currentVersionId: 'v1',
    versions: [{ id: 'v1', version: '1', importedAt: 0, specHash: 'x', specSize: 4 }],
    servers: [{ url: 'https://a' }],
    securitySchemes: {},
    folders: [],
    endpoints: [sampleEndpoint()],
    hostConfig: {},
    authConfig: { type: 'none' },
    ...overrides,
  };
}

function requestCollectionFixture() {
  const req = {
    id: 'rq',
    name: 'RQ',
    url: '/',
    method: 'GET' as const,
    headers: [],
    body: '',
    auth: { type: 'none' as const },
    validation: { rules: [], expectedStatus: '^200$', expectedBody: '' },
    parameters: {},
    bodyType: 'none' as const,
  };

  return {
    id: 'col',
    name: 'Nm',
    mode: 'direct' as const,
    requests: [req],
  };
}

function harnessCtxStub(): PromotionContext {
  return {
    collection: {
      id: '__catalog__',
      name: 'tmp',
      mode: 'direct',
      requests: [],
    },
    environments: [],
    globalAuthProfiles: [],
    microservices: [],
    appEnvironments: [],
  };
}

function emptyShell(overrides: Partial<Parameters<typeof AppWorkbenchModals>[0]> = {}): Parameters<typeof AppWorkbenchModals>[0] {
  const noop = () => {};
  return {
    catalog: catalogStub(),
    wb: wbStub(),
    environments: [],
    microservices: [],
    featureGroups: [] as FeatureGroup[],
    sendToReqEntry: undefined,
    setSendToReqEntry: noop as Dispatch<SetStateAction<CatalogEntry | undefined>>,
    sendToReqEpValues: {},
    sendToReqSingleEndpoint: undefined,
    setSendToReqSingleEndpoint: noop as Dispatch<SetStateAction<{ endpoint: CatalogEndpoint; savedValues?: import('../../features/catalog/types/catalog').SavedEndpointValues } | undefined>>,
    handleSendToReqConfirm: noop,
    showSendToHarness: false,
    setShowSendToHarness: noop as Dispatch<SetStateAction<boolean>>,
    catalogHarnessEndpoint: undefined,
    setCatalogHarnessEndpoint: noop as Dispatch<SetStateAction<CatalogHarnessEndpointState>>,
    catalogHarnessPromotionCtx: null,
    handleSendToHarnessConfirm: noop,
    harnessPromotionContext: null,
    batchHarnessTarget: undefined,
    setBatchHarnessTarget: noop as Dispatch<SetStateAction<{ colId: string; folderId?: string } | undefined>>,
    handleBatchSendToHarnessConfirm: noop,
    showCatalogImport: false,
    catalogReimportId: undefined,
    catalogInitialSpec: undefined,
    setShowCatalogImport: noop as Dispatch<SetStateAction<boolean>>,
    setCatalogReimportId: noop as Dispatch<SetStateAction<string | undefined>>,
    setCatalogInitialSpec: noop as Dispatch<SetStateAction<{ yaml: string; name: string } | undefined>>,
    setActiveTab: noop as Dispatch<SetStateAction<Tab>>,
    catalogVersionHistoryId: undefined,
    setCatalogVersionHistoryId: noop as Dispatch<SetStateAction<string | undefined>>,
    catalogEditId: undefined,
    setCatalogEditId: noop as Dispatch<SetStateAction<string | undefined>>,
    catalogConvert: undefined,
    setCatalogConvert: noop as Dispatch<SetStateAction<CatalogConvertTarget | undefined>>,
    handleSaveConvertedVersion: (async () => {}) as (entryId: string, args: SaveConvertedVersionArgs) => Promise<void>,
    exportToMockItems: null,
    exportToMockSourceKind: 'catalog' as const,
    onClearExportToMock: noop,
    ...overrides,
  };
}
