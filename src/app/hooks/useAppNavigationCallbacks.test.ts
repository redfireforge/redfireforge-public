/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppNavigationCallbacks } from './useAppNavigationCallbacks';
import { demoHubRuntimeRef } from '../demo/demoHubRuntimeRef';
vi.mock('../../data/galleries/workflows', () => ({
  sampleWorkflowCatalog: [
    { id: 'wf-sample-1', name: 'Sample 1' },
    { id: 'wf-sample-2', name: 'Sample 2' },
  ],
}));
const mockShouldExit = vi.hoisted(() => vi.fn(() => false));
vi.mock('../demo/liveDemoTabGuard', () => ({
  isHumanDemoTabExit: mockShouldExit,
}));

function makeOptions(overrides: Partial<Parameters<typeof useAppNavigationCallbacks>[0]> = {}) {
  return {
    activeTab: 'scenarios' as never,
    setActiveTab: vi.fn(),
    setResultsRunTypeFilter: vi.fn(),
    setWorkflowRunnerInitialId: vi.fn(),
    setWorkflowRunnerInitialVariables: vi.fn(),
    wb: {
      collections: [],
      addCollection: vi.fn(() => 'new-col'),
      addRequest: vi.fn(() => 'new-req'),
      updateRequest: vi.fn(),
    } as never,
    previewRequest: null,
    setPreviewRequest: vi.fn(),
    setGalleryInitialDomain: vi.fn(),
    gallery: { onImportWorkflow: vi.fn() },
    ...overrides,
  };
}

describe('useAppNavigationCallbacks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockShouldExit.mockReturnValue(false);
    demoHubRuntimeRef.current = {
      state: { view: 'idle', selectedLesson: null },
      suppressLiveTabExitRef: { current: false },
      exitLiveDemo: vi.fn(),
    } as never;
  });

  afterEach(() => {
    document.body.removeAttribute('data-rf-demo-ui-action');
    vi.restoreAllMocks();
  });

  describe('handleSetActiveTab', () => {
    it('calls setActiveTab directly when demo not active', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleSetActiveTab('results'));
      expect(opts.setActiveTab).toHaveBeenCalledWith('results');
    });

    it('shows the leave dialog and exits only after Leave demo', async () => {
      mockShouldExit.mockReturnValue(true);
      const exitPromise = Promise.resolve();
      demoHubRuntimeRef.current = {
        state: { view: 'live', selectedLesson: { id: 'l1' } },
        suppressLiveTabExitRef: { current: false },
        exitLiveDemo: vi.fn(() => exitPromise),
      } as never;
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleSetActiveTab('results'));
      expect(opts.setActiveTab).not.toHaveBeenCalled();
      expect(result.current.pendingDemoLeaveTab).toBe('results');
      await act(async () => { result.current.leaveDemo(); });
      await act(async () => { await exitPromise; });
      expect(demoHubRuntimeRef.current.exitLiveDemo).toHaveBeenCalled();
      expect(opts.setActiveTab).toHaveBeenCalledWith('results');
    });

    it('does not navigate when Stay is chosen', () => {
      mockShouldExit.mockReturnValue(true);
      demoHubRuntimeRef.current = {
        state: { view: 'live', selectedLesson: { id: 'l1' } },
        suppressLiveTabExitRef: { current: false },
        exitLiveDemo: vi.fn(),
      } as never;
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleSetActiveTab('results'));
      act(() => { result.current.stayInDemo(); });
      expect(opts.setActiveTab).not.toHaveBeenCalled();
      expect(demoHubRuntimeRef.current.exitLiveDemo).not.toHaveBeenCalled();
      expect(result.current.pendingDemoLeaveTab).toBeNull();
    });

    it('does nothing when Leave is invoked with no pending tab', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => { result.current.leaveDemo(); });
      expect(opts.setActiveTab).not.toHaveBeenCalled();
      expect(demoHubRuntimeRef.current.exitLiveDemo).not.toHaveBeenCalled();
    });

    it('navigates directly when the guard says the click is not a human leave', () => {
      mockShouldExit.mockReturnValue(false);
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleSetActiveTab('results'));
      expect(opts.setActiveTab).toHaveBeenCalledWith('results');
    });
  });

  describe('handleCompleteToResults', () => {
    it('sets run type filter and navigates to results', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleCompleteToResults('test'));
      expect(opts.setResultsRunTypeFilter).toHaveBeenCalledWith('test');
      expect(opts.setActiveTab).toHaveBeenCalledWith('results');
    });

    it('works without run type', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleCompleteToResults());
      expect(opts.setResultsRunTypeFilter).toHaveBeenCalledWith(undefined);
      expect(opts.setActiveTab).toHaveBeenCalledWith('results');
    });
  });

  describe('handleNavigateToKafkaSettings', () => {
    it('navigates to kafka-settings tab', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleNavigateToKafkaSettings());
      expect(opts.setActiveTab).toHaveBeenCalledWith('kafka-settings');
    });
  });

  describe('handleUseAsWorkflowInput', () => {
    it('sets workflow runner variables and navigates', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleUseAsWorkflowInput(
        '{"key": "val"}',
        { topic: 'test-topic', partition: 0, offset: '5' },
      ));
      expect(opts.setWorkflowRunnerInitialVariables).toHaveBeenCalledWith({
        kafka_message: '{"key": "val"}',
        kafka_topic: 'test-topic',
        kafka_partition: '0',
        kafka_offset: '5',
      });
      expect(opts.setActiveTab).toHaveBeenCalledWith('workflow-runner');
    });
  });

  describe('handleRunInHarness', () => {
    it('sets workflow ID and navigates', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleRunInHarness('wf-123'));
      expect(opts.setWorkflowRunnerInitialId).toHaveBeenCalledWith('wf-123');
      expect(opts.setActiveTab).toHaveBeenCalledWith('workflow-runner');
    });
  });

  describe('handleImportPreview', () => {
    it('does nothing when previewRequest is null', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleImportPreview());
      expect(opts.wb.addRequest).not.toHaveBeenCalled();
    });

    it('imports preview request into Gallery Samples collection', () => {
      const previewReq = {
        request: {
          name: 'Preview', method: 'POST', url: '/api/test',
          headers: [{ key: 'Accept', value: 'json' }],
          body: '{}', bodyType: 'json', auth: { type: 'none' },
        },
      };
      const opts = makeOptions({ previewRequest: previewReq as never });
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleImportPreview());
      expect(opts.wb.addCollection).toHaveBeenCalled();
      expect(opts.wb.addRequest).toHaveBeenCalled();
      expect(opts.wb.updateRequest).toHaveBeenCalled();
      expect(opts.setPreviewRequest).toHaveBeenCalledWith(null);
    });
  });

  describe('handleLoadWorkflowTemplate', () => {
    it('imports matching template from catalog', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleLoadWorkflowTemplate('wf-sample-1'));
      expect(opts.gallery.onImportWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'wf-sample-1' }),
      );
    });

    it('does nothing for non-existent template', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleLoadWorkflowTemplate('non-existent'));
      expect(opts.gallery.onImportWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('handleBrowseGallery', () => {
    it('sets gallery domain and navigates', () => {
      const opts = makeOptions();
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleBrowseGallery());
      expect(opts.setGalleryInitialDomain).toHaveBeenCalledWith('workflows');
      expect(opts.setActiveTab).toHaveBeenCalledWith('gallery');
    });
  });

  describe('handleImportPreview — reuses existing collection', () => {
    it('finds existing Gallery Samples collection instead of creating new', () => {
      const previewReq = {
        request: {
          name: 'P', method: 'GET', url: '/', headers: [],
          body: '', bodyType: 'none', auth: { type: 'none' },
        },
      };
      const existingCol = { id: 'existing-col', name: 'Gallery Samples' };
      const opts = makeOptions({
        previewRequest: previewReq as never,
        wb: {
          collections: [existingCol],
          addCollection: vi.fn(),
          addRequest: vi.fn(() => 'new-req'),
          updateRequest: vi.fn(),
        } as never,
      });
      const { result } = renderHook(() => useAppNavigationCallbacks(opts));
      act(() => result.current.handleImportPreview());
      expect(opts.wb.addCollection).not.toHaveBeenCalled();
      expect(opts.wb.addRequest).toHaveBeenCalledWith('existing-col');
    });
  });
});
