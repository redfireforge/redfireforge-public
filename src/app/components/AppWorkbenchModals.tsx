import type { Dispatch, SetStateAction } from 'react';
import type { Environment, Microservice, FeatureGroup, RequestFolder } from '@shared/types';
import type { CatalogEntry, CatalogEndpoint, SavedEndpointValues } from '../../features/catalog/types/catalog';
import type { Tab } from '../utils/appTabUtils';
import type { UseCatalogReturn } from '../../features/catalog/hooks/useCatalog';
import type { UseRequestsReturn } from '../../features/requests/hooks/useRequests';
import type { PromotionContext } from '../../features/requests/utils/requestToScenario';
import type { SendToRequestsPayload } from '../../features/catalog/components/CatalogSendToRequestsModal';
import type { SendToHarnessPayload } from '../../features/requests/components/SendToHarnessModal';
import type { BatchSendToHarnessPayload } from '../../features/requests/components/BatchSendToHarnessModal';
import type { CatalogHarnessEndpointState } from '../hooks/useHarnessPromotion';
import CatalogSendToRequestsModal from '../../features/catalog/components/CatalogSendToRequestsModal';
import CatalogImportModal from '../../features/catalog/components/CatalogImportModal';
import CatalogVersionHistory from '../../features/catalog/components/CatalogVersionHistory';
import CatalogEditModal from '../../features/catalog/components/CatalogEditModal';
import CatalogConvertOpenApiModal from '../../features/catalog/components/CatalogConvertOpenApiModal';
import type { CatalogConvertTarget, SaveConvertedVersionArgs } from '../hooks/useCatalogState';
import type { ToastType } from '@workflow/components/WorkflowToastProvider';
import SendToHarnessModal from '../../features/requests/components/SendToHarnessModal';
import BatchSendToHarnessModal from '../../features/requests/components/BatchSendToHarnessModal';
import { catalogEndpointToRequest } from '../../features/catalog/utils/catalogEndpointToRequest';
import { ExportToApiMockModal, type ExportToApiMockItem } from '../../features/api-mock/components/ExportToApiMockModal';

function findFolderForBatch(folders: RequestFolder[], folderId: string): RequestFolder | undefined {
  for (const f of folders) {
    if (f.id === folderId) return f;
    const deep = findFolderForBatch(f.folders ?? [], folderId);
    if (deep) return deep;
  }
  return undefined;
}

interface AppWorkbenchModalsProps {
  catalog: UseCatalogReturn;
  wb: UseRequestsReturn;
  environments: Environment[];
  microservices: Microservice[];
  featureGroups: FeatureGroup[];

  sendToReqEntry: CatalogEntry | undefined;
  setSendToReqEntry: Dispatch<SetStateAction<CatalogEntry | undefined>>;
  sendToReqEpValues: Record<string, SavedEndpointValues>;
  sendToReqSingleEndpoint:
    | { endpoint: CatalogEndpoint; savedValues?: SavedEndpointValues }
    | undefined;
  setSendToReqSingleEndpoint: Dispatch<
    SetStateAction<{ endpoint: CatalogEndpoint; savedValues?: SavedEndpointValues } | undefined>
  >;
  handleSendToReqConfirm: (payload: SendToRequestsPayload) => void;

  showSendToHarness: boolean;
  setShowSendToHarness: Dispatch<SetStateAction<boolean>>;
  catalogHarnessEndpoint: CatalogHarnessEndpointState;
  setCatalogHarnessEndpoint: Dispatch<SetStateAction<CatalogHarnessEndpointState>>;
  catalogHarnessPromotionCtx: PromotionContext | null;
  handleSendToHarnessConfirm: (payload: SendToHarnessPayload) => void;

  harnessPromotionContext: PromotionContext | null;

  batchHarnessTarget: { colId: string; folderId?: string } | undefined;
  setBatchHarnessTarget: Dispatch<SetStateAction<{ colId: string; folderId?: string } | undefined>>;
  handleBatchSendToHarnessConfirm: (payload: BatchSendToHarnessPayload) => void;

  showCatalogImport: boolean;
  catalogReimportId: string | undefined;
  catalogInitialSpec: { yaml: string; name: string } | undefined;
  setShowCatalogImport: Dispatch<SetStateAction<boolean>>;
  setCatalogReimportId: Dispatch<SetStateAction<string | undefined>>;
  setCatalogInitialSpec: Dispatch<SetStateAction<{ yaml: string; name: string } | undefined>>;
  setActiveTab: Dispatch<SetStateAction<Tab>>;

  catalogVersionHistoryId: string | undefined;
  setCatalogVersionHistoryId: Dispatch<SetStateAction<string | undefined>>;
  catalogEditId: string | undefined;
  setCatalogEditId: Dispatch<SetStateAction<string | undefined>>;
  catalogConvert: CatalogConvertTarget | undefined;
  setCatalogConvert: Dispatch<SetStateAction<CatalogConvertTarget | undefined>>;
  handleSaveConvertedVersion: (entryId: string, args: SaveConvertedVersionArgs) => Promise<void>;
  showToast?: (type: ToastType, title: string, subtitle?: string) => void;

  exportToMockItems: ExportToApiMockItem[] | null;
  exportToMockSourceKind: 'requests' | 'catalog';
  onClearExportToMock: () => void;
}

export default function AppWorkbenchModals(props: AppWorkbenchModalsProps) {
  const {
    catalog,
    wb,
    environments,
    microservices,
    featureGroups,
    sendToReqEntry,
    setSendToReqEntry,
    sendToReqEpValues,
    sendToReqSingleEndpoint,
    setSendToReqSingleEndpoint,
    handleSendToReqConfirm,
    showSendToHarness,
    setShowSendToHarness,
    catalogHarnessEndpoint,
    setCatalogHarnessEndpoint,
    catalogHarnessPromotionCtx,
    handleSendToHarnessConfirm,
    harnessPromotionContext,
    batchHarnessTarget,
    setBatchHarnessTarget,
    handleBatchSendToHarnessConfirm,
    showCatalogImport,
    catalogReimportId,
    catalogInitialSpec,
    setShowCatalogImport,
    setCatalogReimportId,
    setCatalogInitialSpec,
    setActiveTab,
    catalogVersionHistoryId,
    setCatalogVersionHistoryId,
    catalogEditId,
    setCatalogEditId,
    catalogConvert,
    setCatalogConvert,
    handleSaveConvertedVersion,
    showToast,
    exportToMockItems,
    exportToMockSourceKind,
    onClearExportToMock,
  } = props;

  return (
    <>
      {sendToReqEntry && (
        <CatalogSendToRequestsModal
          entry={sendToReqEntry}
          appEnvironments={environments}
          appMicroservices={microservices}
          savedEpValues={sendToReqEpValues}
          collections={wb.collections}
          onSend={handleSendToReqConfirm}
          onClose={() => { setSendToReqEntry(undefined); setSendToReqSingleEndpoint(undefined); }}
          preSelectedEndpointId={sendToReqSingleEndpoint?.endpoint.id}
        />
      )}
      {showSendToHarness && (() => {
        if (catalogHarnessEndpoint && catalogHarnessPromotionCtx) {
          const { entry, endpoint } = catalogHarnessEndpoint;
          const currentVersion = entry.versions.find(v => v.id === entry.currentVersionId);
          const tempReq = catalogEndpointToRequest(
            endpoint,
            entry.servers,
            { type: 'none' },
            entry.id,
            entry.name,
            currentVersion?.version,
          );
          return (
            <SendToHarnessModal
              request={tempReq}
              promotionContext={catalogHarnessPromotionCtx}
              featureGroups={featureGroups}
              environments={environments}
              microservices={microservices}
              defaultValidationPreset={catalogHarnessEndpoint.fromTryItOut ? 'status-200' : undefined}
              onConfirm={(payload) => {
                handleSendToHarnessConfirm(payload);
                setCatalogHarnessEndpoint(undefined);
              }}
              onClose={() => { setShowSendToHarness(false); setCatalogHarnessEndpoint(undefined); }}
            />
          );
        }
        if (wb.selectedRequest && harnessPromotionContext) {
          return (
            <SendToHarnessModal
              request={wb.selectedRequest}
              promotionContext={harnessPromotionContext}
              featureGroups={featureGroups}
              environments={environments}
              microservices={microservices}
              onConfirm={handleSendToHarnessConfirm}
              onClose={() => setShowSendToHarness(false)}
            />
          );
        }
        return null;
      })()}
      {batchHarnessTarget && (() => {
        const col = wb.collections.find(c => c.id === batchHarnessTarget.colId);
        if (!col) return null;
        let effectiveCol = col;
        if (batchHarnessTarget.folderId) {
          const folder = findFolderForBatch(col.folders ?? [], batchHarnessTarget.folderId);
          if (folder) {
            effectiveCol = { ...col, requests: folder.requests, folders: folder.folders ?? [] };
          }
        }
        return (
          <BatchSendToHarnessModal
            collection={effectiveCol}
            environments={environments}
            microservices={microservices}
            onConfirm={handleBatchSendToHarnessConfirm}
            onClose={() => setBatchHarnessTarget(undefined)}
          />
        );
      })()}
      {showCatalogImport && (
        <CatalogImportModal
          existingEntries={catalog.entries}
          reimportEntryId={catalogReimportId}
          initialSpec={catalogInitialSpec}
          onImport={(entry, rawSpec) => { catalog.addEntry(entry, rawSpec); setActiveTab('catalog'); }}
          onReimport={(entryId, parsed) => { catalog.addVersionToEntry(entryId, parsed); setActiveTab('catalog'); }}
          onClose={() => { setShowCatalogImport(false); setCatalogReimportId(undefined); setCatalogInitialSpec(undefined); }}
        />
      )}
      {catalogConvert && (
        <CatalogConvertOpenApiModal
          specName={catalogConvert.specName}
          rawSpec={catalogConvert.rawSpec}
          showToast={showToast}
          onClose={() => setCatalogConvert(undefined)}
          onSaveAsVersion={(args) => handleSaveConvertedVersion(catalogConvert.entryId, args)}
        />
      )}
      {catalogVersionHistoryId && (() => {
        const vhEntry = catalog.entries.find(e => e.id === catalogVersionHistoryId);
        if (!vhEntry) return null;
        return (
          <CatalogVersionHistory
            entry={vhEntry}
            onClose={() => setCatalogVersionHistoryId(undefined)}
            onSwitchVersion={(versionId) => catalog.switchVersion(catalogVersionHistoryId, versionId)}
            onReimport={() => { setCatalogReimportId(catalogVersionHistoryId); setShowCatalogImport(true); }}
            loadRawSpec={catalog.loadRawSpec}
          />
        );
      })()}
      {catalogEditId && (() => {
        const editEntry = catalog.entries.find(e => e.id === catalogEditId);
        if (!editEntry) return null;
        return (
          <CatalogEditModal
            entry={editEntry}
            microservices={microservices}
            environments={environments}
            onSave={(patch) => catalog.updateEntry(catalogEditId, patch)}
            onClose={() => setCatalogEditId(undefined)}
          />
        );
      })()}
      {exportToMockItems && (
        <ExportToApiMockModal
          items={exportToMockItems}
          sourceKind={exportToMockSourceKind}
          onClose={onClearExportToMock}
        />
      )}
    </>
  );
}
