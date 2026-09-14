import { useCallback, useState } from 'react';
import type { Tab } from '../utils/appTabUtils';
import { demoHubRuntimeRef } from '../demo/demoHubRuntimeRef';
import { isHumanLiveDemoTabExit } from '../demo/liveDemoTabGuard';
import type { UseRequestsReturn } from '../../features/requests/hooks/useRequests';
import type { RequestItem } from '@shared/types';
import { sampleWorkflowCatalog } from '../../data/galleries/workflows';

export interface UseAppNavigationCallbacksOptions {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  setResultsRunTypeFilter: (filter: 'all' | 'test' | 'workflow' | undefined) => void;
  setWorkflowRunnerInitialId: (id: string | null) => void;
  setWorkflowRunnerInitialVariables: (vars: Record<string, string> | null) => void;
  wb: UseRequestsReturn;
  previewRequest: { request: RequestItem } | null;
  setPreviewRequest: (r: null) => void;
  setGalleryInitialDomain: (d: import('../../data/galleries/types').GalleryDomain | undefined) => void;
  gallery: { onImportWorkflow: (entry: import('../../data/galleries/types').GalleryEntry<unknown>) => void };
}

export function useAppNavigationCallbacks({
  activeTab,
  setActiveTab,
  setResultsRunTypeFilter,
  setWorkflowRunnerInitialId,
  setWorkflowRunnerInitialVariables,
  wb,
  previewRequest,
  setPreviewRequest,
  setGalleryInitialDomain,
  gallery,
}: UseAppNavigationCallbacksOptions) {
  const [pendingLeaveTab, setPendingLeaveTab] = useState<Tab | null>(null);

  const handleSetActiveTab = useCallback((tab: Tab) => {
    if (isHumanLiveDemoTabExit(tab, activeTab)) {
      setPendingLeaveTab(tab);
      return;
    }
    setActiveTab(tab);
  }, [setActiveTab, activeTab]);

  const stayInLiveDemo = useCallback(() => {
    setPendingLeaveTab(null);
  }, []);

  const leaveLiveDemo = useCallback(() => {
    const tab = pendingLeaveTab;
    setPendingLeaveTab(null);
    if (!tab) return;
    void demoHubRuntimeRef.current.exitLiveDemo().then(() => setActiveTab(tab));
  }, [pendingLeaveTab, setActiveTab]);

  const handleCompleteToResults = useCallback((runType?: 'test' | 'workflow') => {
    setResultsRunTypeFilter(runType);
    setActiveTab('results');
  }, [setActiveTab, setResultsRunTypeFilter]);

  const handleNavigateToKafkaSettings = useCallback(() => {
    setActiveTab('kafka-settings');
  }, [setActiveTab]);

  const handleUseAsWorkflowInput = useCallback((
    payload: string,
    meta: { topic: string; partition: number; offset: string },
  ) => {
    setWorkflowRunnerInitialVariables({
      kafka_message: payload,
      kafka_topic: meta.topic,
      kafka_partition: String(meta.partition),
      kafka_offset: meta.offset,
    });
    setActiveTab('workflow-runner');
  }, [setActiveTab, setWorkflowRunnerInitialVariables]);

  const handleRunInHarness = useCallback((workflowId: string) => {
    setWorkflowRunnerInitialId(workflowId);
    setActiveTab('workflow-runner');
  }, [setActiveTab, setWorkflowRunnerInitialId]);

  const handleImportPreview = useCallback(() => {
    if (!previewRequest) return;
    const req = previewRequest.request;
    const GALLERY_COL_NAME = 'Gallery Samples';
    const col = wb.collections.find(c => c.name === GALLERY_COL_NAME);
    const colId = col ? col.id : wb.addCollection({ name: GALLERY_COL_NAME, mode: 'direct' });
    const reqId = wb.addRequest(colId);
    wb.updateRequest(colId, reqId, {
      name: req.name,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      bodyType: req.bodyType,
      auth: req.auth,
    });
    setPreviewRequest(null);
  }, [previewRequest, wb, setPreviewRequest]);

  const handleLoadWorkflowTemplate = useCallback((gallerySampleId: string) => {
    const entry = sampleWorkflowCatalog.find(e => e.id === gallerySampleId);
    if (entry) {
      gallery.onImportWorkflow(entry);
    }
  }, [gallery]);

  const handleBrowseGallery = useCallback(() => {
    setGalleryInitialDomain('workflows');
    setActiveTab('gallery');
  }, [setActiveTab, setGalleryInitialDomain]);

  return {
    handleSetActiveTab,
    pendingLiveDemoLeaveTab: pendingLeaveTab,
    stayInLiveDemo,
    leaveLiveDemo,
    handleCompleteToResults,
    handleNavigateToKafkaSettings,
    handleUseAsWorkflowInput,
    handleRunInHarness,
    handleImportPreview,
    handleLoadWorkflowTemplate,
    handleBrowseGallery,
  };
}
