import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Environment, Microservice, FeatureGroup, GlobalAuthProfile } from '@shared/types';
import type { CatalogEntry, CatalogEndpoint } from '../../features/catalog/types/catalog';
import type { SendToHarnessPayload } from '../../features/requests/components/SendToHarnessModal';
import type { BatchSendToHarnessPayload } from '../../features/requests/components/BatchSendToHarnessModal';
import { batchPromoteCollection, promoteToFeatureGroups } from '../../features/requests/utils/promoteToHarness';
import type { PromotionContext } from '../../features/requests/utils/requestToScenario';
import { findReqParentFolder } from '../../features/requests/utils/requestTree';
import { catalogEndpointToRequest } from '../../features/catalog/utils/catalogEndpointToRequest';
import type { UseRequestsReturn } from '../../features/requests/hooks/useRequests';
import type { ToastApi } from '@workflow/components/WorkflowToastProvider';
import type { Tab } from '../utils/appTabUtils';


export type CatalogHarnessEndpointState =
  | { entry: CatalogEntry; endpoint: CatalogEndpoint; fromTryItOut?: boolean }
  | undefined;

export type PendingEditTestState =
  | { featureId: string; scenarioId: string; testId: string }
  | undefined;

export type UseHarnessPromotionParams = {
  wb: UseRequestsReturn;
  featureGroups: FeatureGroup[];
  setFeatureGroups: Dispatch<SetStateAction<FeatureGroup[]>>;
  selectedEnvId: string;
  selectedSvcId: string;
  setSelectedEnvId: (id: string) => void;
  setSelectedSvcId: (id: string) => void;
  appGlobalAuthProfiles: GlobalAuthProfile[];
  microservices: Microservice[];
  environments: Environment[];
  toast: ToastApi;
  setActiveTab: Dispatch<SetStateAction<Tab>>;
};

export type UseHarnessPromotionResult = {
  showSendToHarness: boolean;
  setShowSendToHarness: Dispatch<SetStateAction<boolean>>;
  batchHarnessTarget: { colId: string; folderId?: string } | undefined;
  setBatchHarnessTarget: Dispatch<SetStateAction<{ colId: string; folderId?: string } | undefined>>;
  catalogHarnessEndpoint: CatalogHarnessEndpointState;
  setCatalogHarnessEndpoint: Dispatch<SetStateAction<CatalogHarnessEndpointState>>;
  pendingEditTest: PendingEditTestState;
  setPendingEditTest: Dispatch<SetStateAction<PendingEditTestState>>;
  handleSendToHarnessConfirm: (payload: SendToHarnessPayload) => void;
  handleBatchSendToHarnessConfirm: (payload: BatchSendToHarnessPayload) => void;
  harnessPromotionContext: PromotionContext | null;
  catalogHarnessPromotionCtx: PromotionContext | null;
};

export function useHarnessPromotion(params: UseHarnessPromotionParams): UseHarnessPromotionResult {
  const {
    wb,
    featureGroups,
    setFeatureGroups,
    selectedEnvId,
    selectedSvcId,
    setSelectedEnvId,
    setSelectedSvcId,
    appGlobalAuthProfiles,
    microservices,
    environments,
    toast,
    setActiveTab,
  } = params;

  const [showSendToHarness, setShowSendToHarness] = useState(false);
  const [batchHarnessTarget, setBatchHarnessTarget] = useState<{ colId: string; folderId?: string } | undefined>();
  const [catalogHarnessEndpoint, setCatalogHarnessEndpoint] = useState<CatalogHarnessEndpointState>();
  const [pendingEditTest, setPendingEditTest] = useState<PendingEditTestState>();

  const harnessPromotionContext = useMemo((): PromotionContext | null => {
    if (!wb.selectedCollection || !wb.selectedRequest) return null;
    return {
      collection: wb.selectedCollection,
      folderId: findReqParentFolder(wb.selectedCollection.folders ?? [], wb.selectedRequest.id)?.id,
      selectedEnvId: wb.selectedEnvId,
      globalAuthProfiles: appGlobalAuthProfiles,
      microservices,
      appEnvironments: environments,
    };
  }, [
    wb.selectedCollection,
    wb.selectedRequest,
    wb.selectedEnvId,
    appGlobalAuthProfiles,
    microservices,
    environments,
  ]);

  const handleSendToHarnessConfirm = useCallback((payload: SendToHarnessPayload) => {
    const effectiveEnvId = payload.environmentId ?? selectedEnvId;
    const effectiveSvcId = payload.microserviceId ?? selectedSvcId;

    const result = promoteToFeatureGroups(featureGroups, payload.scenario, {
      targetGroupId: payload.targetGroupId,
      targetScenarioId: payload.targetScenarioId,
      newGroupName: payload.newGroupName,
      newScenarioName: payload.newScenarioName,
      environmentId: effectiveEnvId,
      microserviceId: effectiveSvcId,
    });
    setFeatureGroups(result.featureGroups);

    // Switch sidebar to the target env/microservice so the user sees the new group
    if (effectiveEnvId && effectiveEnvId !== selectedEnvId) {
      setSelectedEnvId(effectiveEnvId);
    }
    if (effectiveSvcId && effectiveSvcId !== selectedSvcId) {
      setSelectedSvcId(effectiveSvcId);
    }

    setShowSendToHarness(false);
    setCatalogHarnessEndpoint(undefined);
    setActiveTab('scenarios');

    toast.show('success', 'Sent to Harness', `Test "${payload.scenario.name}" created`);

    if (payload.openEditorAfter) {
      setPendingEditTest({
        featureId: result.createdGroupId,
        scenarioId: result.createdScenarioId,
        testId: payload.scenario.id,
      });
    }
  }, [
    featureGroups,
    setFeatureGroups,
    selectedEnvId,
    selectedSvcId,
    setSelectedEnvId,
    setSelectedSvcId,
    toast,
    setActiveTab,
  ]);

  const handleBatchSendToHarnessConfirm = useCallback((payload: BatchSendToHarnessPayload) => {
    const col = wb.collections.find(c => c.id === payload.collectionId);
    if (!col) return;
    const effectiveEnvId = payload.environmentId ?? selectedEnvId;
    const effectiveSvcId = payload.microserviceId ?? selectedSvcId;

    const knownEnv = effectiveEnvId && environments.some(e => e.id === effectiveEnvId);
    const resolvedEnvForUrls = knownEnv ? effectiveEnvId : (wb.selectedEnvId ?? effectiveEnvId);

    const ctx: PromotionContext = {
      collection: col,
      selectedEnvId: resolvedEnvForUrls,
      globalAuthProfiles: appGlobalAuthProfiles,
      microservices,
      appEnvironments: environments,
    };
    const { featureGroup, promotedRequestIds } = batchPromoteCollection(
      col, ctx, payload.selectedRequestIds,
      { validationPreset: payload.validationPreset, authMode: payload.authMode },
      effectiveEnvId, effectiveSvcId,
    );
    setFeatureGroups(prev => [...prev, featureGroup]);
    setBatchHarnessTarget(undefined);
    setActiveTab('scenarios');

    toast.show('success', 'Batch sent to Harness', `${promotedRequestIds.length} tests created in "${featureGroup.name}"`);
  }, [wb, appGlobalAuthProfiles, microservices, environments, selectedEnvId, selectedSvcId, setFeatureGroups, toast, setActiveTab]);

  const catalogHarnessPromotionCtx = useMemo((): PromotionContext | null => {
    if (!catalogHarnessEndpoint) return null;
    const { entry, endpoint } = catalogHarnessEndpoint;
    const currentVersion = entry.versions.find(v => v.id === entry.currentVersionId);
    const tempReq = catalogEndpointToRequest(
      endpoint, entry.servers, { type: 'none' },
      entry.id, entry.name, currentVersion?.version,
    );
    return {
      collection: { id: '__catalog__', name: entry.name, mode: 'direct', requests: [tempReq] },
      globalAuthProfiles: [],
      microservices: [],
    };
  }, [catalogHarnessEndpoint]);

  return {
    showSendToHarness,
    setShowSendToHarness,
    batchHarnessTarget,
    setBatchHarnessTarget,
    catalogHarnessEndpoint,
    setCatalogHarnessEndpoint,
    pendingEditTest,
    setPendingEditTest,
    handleSendToHarnessConfirm,
    handleBatchSendToHarnessConfirm,
    harnessPromotionContext,
    catalogHarnessPromotionCtx,
  };
}
