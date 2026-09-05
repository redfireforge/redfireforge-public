import { useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';

import type { SubWorkflowNodeData, Workflow } from '../types/workflow';
import type { WorkflowDesignerViewModel } from '../hooks/useWorkflowDesignerController';
import { useHasLayoutSize } from '../hooks/useHasLayoutSize';
import { reactFlowOnError } from '../utils/reactFlowOnError';
import { nodeTypes, type WorkflowRFNode, type WorkflowRFEdge } from '../utils/workflowNodeFactory';
import { WorkflowNodeRunContext, WorkflowDebugStepContext } from './panels/WorkflowNodeRunContext';
import { PublishedCatalogContext } from '../contexts/PublishedCatalogContext';
import { getNodeMiniMapColor } from '../utils/workflowDesignerUtils';
import WorkflowExecSummary from './panels/WorkflowExecSummary';
import VariableContextBadge from './panels/VariableContextBar';
import WorkflowNodeContextMenu from './canvas/WorkflowNodeContextMenu';
import WorkflowCanvasControls from './canvas/WorkflowCanvasControls';
import EmptyCanvasTemplates from './canvas/EmptyCanvasTemplates';
import OnboardingTooltip from './canvas/OnboardingTooltip';
import type { EmptyCanvasTemplate } from '../data/emptyCanvasTemplates';
import type { CatalogFolder } from '../../catalog/types/catalog';

/** During Demo Hub Preparing, animate fits at duration 0 so nodes do not slide. */
function demoBootFitDuration(preferred: number): number {
  return document.body.getAttribute('data-demo-bootstrapping') === '1' ? 0 : preferred;
}

/** Delay + optional RAF. Always clear on unmount so a pending timeout cannot
 *  call requestAnimationFrame after jsdom teardown (Vitest unhandled error). */
function scheduleAfterLayout(delayMs: number, work: () => void): () => void {
  const timer = setTimeout(() => {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') {
      raf(() => work());
      return;
    }
    work();
  }, delayMs);
  return () => clearTimeout(timer);
}

/** Drop overlay, preview banner, React Flow instance, variable badge, and node context menu. */
export function WorkflowDesignerFlowCanvas({
  vm,
  selected,
}: {
  vm: WorkflowDesignerViewModel;
  selected: Workflow;
}) {
  const {
    isDragOver,
    dropTargetEdgeId,
    canvasAreaRef,
    handleCanvasDragOver,
    handleCanvasDragLeave,
    handleCanvasDrop,
    previewWorkflow,
    runProgress,
    failedStepLabel,
    handleToggleConsole,
    serializeNodes,
    nodes,
    onUseAsTemplate,
    onClearPreview,
    nodeStatuses,
    isDebugMode,
    handleDebugStep,
    layoutVersion,
    laidOutId,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onReconnect,
    handleNodeClick,
    openNodeConfig,
    handleNodeContextMenu,
    handlePaneClick,
    handleReactFlowInit,
    showMinimap,
    setShowMinimap,
    undoRedo,
    handleUndoAction,
    handleRedoAction,
    handleAutoLayout,
    setNodes: _setNodes,
    runVariableSnapshot,
    workflowVariables,
    nodeCtxMenu,
    configModalNodeId,
    setSelectedNodeId,
    handleCopyNode,
    handleDuplicateNode,
    handleExtractToSubWorkflow,
    handleDeleteNode,
    navigateToWorkflow,
    setNodeCtxMenu,
    persistWorkflow,
    update,
    onLoadTemplate,
    onBrowseGallery,
    onboarding,
    catalogEntries = [],
  } = vm;

  const publishedCatalogKeys = useMemo(() => {
    const keys = new Set<string>();
    const isPublished = (ep: { workflowPublication?: unknown; workflowExposure?: string }) =>
      !!(ep.workflowPublication || ep.workflowExposure === 'published');
    const scanFolders = (folders: CatalogFolder[], entryId: string) => {
      for (const f of folders) {
        for (const ep of f.endpoints) if (isPublished(ep)) keys.add(`${entryId}::${ep.id}`);
        scanFolders(f.folders, entryId);
      }
    };
    for (const entry of catalogEntries) {
      for (const ep of entry.endpoints) if (isPublished(ep)) keys.add(`${entry.id}::${ep.id}`);
      scanFolders(entry.folders, entry.id);
    }
    return keys;
  }, [catalogEntries]);

  const { getViewport, setViewport, fitView } = useReactFlow();
  // All refs must stay above effects and remain unconditional (Rules of Hooks).
  // Gate on the absolute RF host — same box RF measures (offsetWidth/Height).
  const reactFlowHostRef = useRef<HTMLDivElement>(null);
  const lastViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const visibilityRef = useRef(true);
  const prevWorkflowIdRef = useRef<string | null>(null);
  const wasSizedRef = useRef(false);
  const canvasHasSize = useHasLayoutSize(reactFlowHostRef);

  // Detect when the canvas becomes hidden/visible (parent has hidden attribute).
  // Save viewport before hiding, restore it when shown again.
  useEffect(() => {
    const container = canvasAreaRef.current;
    if (!container) return;
    let cancelRestore: (() => void) | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = entry.isIntersecting;
        if (!isVisible && visibilityRef.current) {
          lastViewportRef.current = getViewport();
        } else if (isVisible && !visibilityRef.current) {
          const vp = lastViewportRef.current ?? selectedRef.current?.savedViewport;
          if (vp) {
            cancelRestore?.();
            cancelRestore = scheduleAfterLayout(50, () => setViewport(vp, { duration: 0 }));
          }
        }
        visibilityRef.current = isVisible;
      },
      { threshold: 0.01 },
    );
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelRestore?.();
    };
  }, [canvasAreaRef, getViewport, setViewport]);

  // Restore saved viewport when switching to a workflow that has one saved,
  // or fit view for workflows without a saved viewport.
  // onInit handles the initial mount; this handles subsequent workflow switches.
  // Uses setTimeout to let ReactFlow finish measuring node dimensions first.
  useEffect(() => {
    if (!canvasHasSize) return;
    if (previewWorkflow) return;
    if (!selected) return;
    if (prevWorkflowIdRef.current === selected.id) return;
    prevWorkflowIdRef.current = selected.id;
    return scheduleAfterLayout(120, () => {
      // Always fit on workflow open — never zoom past 100% (small graphs stay regular size).
      fitView({
        padding: 0.08,
        maxZoom: 1,
        minZoom: 0.4,
        duration: demoBootFitDuration(200),
      });
    });
  }, [selected, previewWorkflow, setViewport, fitView, canvasHasSize]);

  // After the canvas regains size (tab shown / console un-maximized), fit again.
  useEffect(() => {
    let cancelFit: (() => void) | undefined;
    if (canvasHasSize && !wasSizedRef.current && !previewWorkflow) {
      cancelFit = scheduleAfterLayout(50, () => {
        fitView({
          padding: 0.08,
          maxZoom: 1,
          minZoom: 0.4,
          duration: demoBootFitDuration(200),
        });
      });
    }
    wasSizedRef.current = canvasHasSize;
    return () => cancelFit?.();
  }, [canvasHasSize, previewWorkflow, fitView]);

  // Expose demo-player bridge helpers so lesson actions can manipulate the canvas
  // without relying on synthetic mouse events (which ReactFlow ignores).
  //   window.__wfDeselectAll()         — clears .selected on every node
  //   window.__wfOpenNodeConfig(id)    — opens config modal for a node by id
  //   window.__wfFitView(opts?)        — fits viewport; demo defaults leave room for LiveDemo panel
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__wfDeselectAll = () => {
      _setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__wfDeselectAll;
    };
  }, [_setNodes]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__wfOpenNodeConfig = (nodeId: string) => {
      // Deselect all nodes first so the highlight ring is gone before the config renders
      _setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      openNodeConfig(nodeId);
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__wfOpenNodeConfig;
    };
  }, [_setNodes, openNodeConfig]);

  useEffect(() => {
    type DemoFitOpts = {
      padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
      maxZoom?: number;
      minZoom?: number;
      duration?: number;
    };
    (window as unknown as Record<string, unknown>).__wfFitView = (opts?: DemoFitOpts) => {
      // Default asymmetric padding: LiveDemo card covers the right side of the canvas.
      fitView({
        padding: opts?.padding ?? { top: 0.08, right: 0.34, bottom: 0.1, left: 0.06 },
        // Default maxZoom 1 — demo small graphs must not inflate past 100%.
        maxZoom: opts?.maxZoom ?? 1,
        minZoom: opts?.minZoom ?? 0.4,
        duration: demoBootFitDuration(opts?.duration ?? 250),
        includeHiddenNodes: true,
      });
      return true;
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__wfFitView;
    };
  }, [fitView]);

  // When a node config modal is open, clear the ReactFlow-level `selected` flag so the
  // node's highlight ring does not bleed into its configuration panel view.
  const displayNodes = useMemo(
    () => (configModalNodeId ? nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) : nodes),
    [nodes, configModalNodeId],
  );

  return (
    <div
      className={`wf-canvas-area ${isDragOver ? 'wf-canvas-drag-over' : ''}`}
      ref={canvasAreaRef}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
    >
      {isDragOver && !dropTargetEdgeId && (
        <div className="wf-drop-indicator">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Drop here to add node
        </div>
      )}
      {isDragOver && dropTargetEdgeId && (
        <div className="wf-drop-indicator wf-drop-indicator-edge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="3"/></svg>
          Insert between nodes
        </div>
      )}
      {nodes.length === 0 && !previewWorkflow && !isDragOver && (
        <div className="wf-empty-canvas">
          <svg className="wf-empty-canvas-icon" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="12" width="26" height="16" rx="4" />
            <rect x="46" y="12" width="26" height="16" rx="4" />
            <rect x="27" y="52" width="26" height="16" rx="4" />
            <line x1="21" y1="28" x2="21" y2="40" />
            <line x1="21" y1="40" x2="40" y2="40" />
            <line x1="40" y1="40" x2="40" y2="52" />
            <line x1="59" y1="28" x2="59" y2="40" />
            <line x1="59" y1="40" x2="40" y2="40" />
            <circle cx="40" cy="40" r="2.5" fill="currentColor" stroke="none" />
          </svg>
          <p className="wf-empty-canvas-title">Drop your first node here</p>
          <p className="wf-empty-canvas-hint">Drag a block from the palette on the left, or press <kbd>⌘K</kbd> for commands</p>
          {onLoadTemplate && (
            <EmptyCanvasTemplates
              onSelectTemplate={(t: EmptyCanvasTemplate) => onLoadTemplate(t.id)}
              onBrowseGallery={onBrowseGallery ?? (() => {})}
            />
          )}
        </div>
      )}
      {!previewWorkflow && (
        <WorkflowExecSummary
          runProgress={runProgress}
          failedStepLabel={failedStepLabel}
          onOpenConsole={handleToggleConsole}
        />
      )}
      {previewWorkflow && (
        <div className="wf-preview-banner" data-testid="wf-sample-preview-banner">
          <span>📚 Sample Preview: <strong>{previewWorkflow.name}</strong></span>
          <span className="wf-preview-desc">{previewWorkflow.description}</span>
          <div className="wf-preview-actions">
            <button className="btn btn-sm btn-primary" onClick={() => {
              const currentNodes = serializeNodes(nodes);
              onUseAsTemplate({ ...previewWorkflow, nodes: currentNodes });
            }}>Use as Template</button>
            <button
              className="btn btn-sm"
              data-testid="wf-sample-preview-close"
              onClick={onClearPreview}
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
      {/* Absolute host gives RF a definite 100% box (RF forces position:relative). */}
      <div className="wf-react-flow-host" ref={reactFlowHostRef}>
      {canvasHasSize && (
      <PublishedCatalogContext.Provider value={publishedCatalogKeys}>
      <WorkflowNodeRunContext.Provider value={nodeStatuses}>
      <WorkflowDebugStepContext.Provider value={isDebugMode ? handleDebugStep : null}>
        <ReactFlow<WorkflowRFNode, WorkflowRFEdge>
          key={layoutVersion}
          style={previewWorkflow && laidOutId !== selected?.id ? { visibility: 'hidden' as const } : undefined}
          nodes={displayNodes}
          edges={dropTargetEdgeId ? edges.map(e => e.id === dropTargetEdgeId ? { ...e, className: (e.className ? e.className + ' ' : '') + 'wf-edge-drop-target' } : e) : edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={(_event, node) => openNodeConfig(node.id)}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          onInit={handleReactFlowInit}
          onError={reactFlowOnError}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={40}
          deleteKeyCode={['Backspace', 'Delete']}
          edgesReconnectable
          defaultEdgeOptions={{
            animated: false,
            style: { stroke: 'var(--border)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 12, color: 'var(--border)' },
          }}
        >
          <WorkflowCanvasControls
            showMinimap={showMinimap}
            onToggleMinimap={() => setShowMinimap(v => !v)}
            disableLayout={!!previewWorkflow}
            savedViewport={selected.savedViewport}
            onAutoLayout={handleAutoLayout}
            canUndo={undoRedo.canUndo()}
            canRedo={undoRedo.canRedo()}
            onUndo={handleUndoAction}
            onRedo={handleRedoAction}
            onSaveLayout={() => {
              if (selected) {
                persistWorkflow();
                const vp = getViewport();
                update(selected.id, { savedViewport: { x: vp.x, y: vp.y, zoom: vp.zoom } });
              }
            }}
          />
          {showMinimap && (
            <MiniMap
              pannable
              zoomable
              style={{ background: 'var(--surface)' }}
              nodeColor={(node) => getNodeMiniMapColor(node, nodeStatuses)}
            />
          )}
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <marker id="wf-arrow-pass" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
              </marker>
              <marker id="wf-arrow-fail" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
              </marker>
              <marker id="wf-arrow-animated" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
              </marker>
            </defs>
          </svg>
        </ReactFlow>
      </WorkflowDebugStepContext.Provider>
      </WorkflowNodeRunContext.Provider>
      </PublishedCatalogContext.Provider>
      )}
      </div>

      {Object.keys(runVariableSnapshot ?? workflowVariables).length > 0 && (
        <VariableContextBadge variables={runVariableSnapshot ?? workflowVariables} />
      )}

      <WorkflowNodeContextMenu
        open={!!nodeCtxMenu}
        x={nodeCtxMenu?.x ?? 0}
        y={nodeCtxMenu?.y ?? 0}
        onCopy={() => {
          if (!nodeCtxMenu) return;
          setSelectedNodeId(nodeCtxMenu.nodeId);
          handleCopyNode(nodeCtxMenu.nodeId);
        }}
        onDuplicate={() => {
          if (!nodeCtxMenu) return;
          setSelectedNodeId(nodeCtxMenu.nodeId);
          handleDuplicateNode(nodeCtxMenu.nodeId);
        }}
        onExtract={nodeCtxMenu ? (() => {
          handleExtractToSubWorkflow(nodeCtxMenu.nodeId);
        }) : undefined}
        onOpenChild={(() => {
          if (!nodeCtxMenu) return undefined;
          const n = nodes.find((x) => x.id === nodeCtxMenu.nodeId);
          if (n?.type !== 'subWorkflow') return undefined;
          const data = n.data as SubWorkflowNodeData;
          if (!data.workflowId) return undefined;
          return () => navigateToWorkflow(data.workflowId);
        })()}
        onDelete={() => {
          if (!nodeCtxMenu) return;
          handleDeleteNode(nodeCtxMenu.nodeId);
        }}
        onClose={() => setNodeCtxMenu(null)}
      />
      {onboarding.activeHint && !previewWorkflow && (
        <OnboardingTooltip
          hint={onboarding.activeHint}
          onDismiss={() => {
            const hintId = onboarding.activeHint?.id;
            if (hintId) onboarding.dismiss(hintId);
          }}
          onDismissAll={onboarding.dismissAll}
          remainingCount={onboarding.remainingCount}
        />
      )}
    </div>
  );
}
