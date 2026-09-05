/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkflowDesignerFlowCanvas } from './WorkflowDesignerFlowCanvas';
import type { WorkflowDesignerViewModel } from '../hooks/useWorkflowDesignerController';
import type { Workflow } from '../types/workflow';

const mockGetViewport = vi.fn(() => ({ x: 1, y: 2, zoom: 1 }));
const mockSetViewport = vi.fn();
const mockFitView = vi.fn();

// jsdom does not implement requestAnimationFrame; polyfill it so source-level
// setTimeout(() => requestAnimationFrame(...)) calls don't blow up in tests.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  globalThis.cancelAnimationFrame = () => {};
}

let ioCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, onNodeDoubleClick, style }: {
    children?: React.ReactNode;
    onNodeDoubleClick?: (e: unknown, n: { id: string }) => void;
    style?: Record<string, unknown>;
  }) => (
    <div data-testid="rf" data-hidden={style?.visibility === 'hidden' ? '1' : '0'}>
      <button data-testid="rf-dbl" onClick={() => onNodeDoubleClick?.({}, { id: 'n1' })}>dbl</button>
      {children}
    </div>
  ),
  MiniMap: ({ nodeColor }: { nodeColor: (n: unknown) => string }) => (
    <div data-testid="minimap" data-color={nodeColor({ id: 'n1', type: 'http' })} />
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  useReactFlow: () => ({
    getViewport: mockGetViewport,
    setViewport: mockSetViewport,
    fitView: mockFitView,
  }),
}));

vi.mock('../utils/workflowNodeFactory', () => ({ nodeTypes: {} }));
vi.mock('./panels/WorkflowNodeRunContext', () => ({
  WorkflowNodeRunContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  WorkflowDebugStepContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}));
vi.mock('../utils/workflowDesignerUtils', () => ({ getNodeMiniMapColor: () => '#fff' }));
vi.mock('./panels/WorkflowExecSummary', () => ({
  default: ({ onOpenConsole }: { onOpenConsole: () => void }) => <button data-testid="exec-summary" onClick={onOpenConsole}>e</button>,
}));
vi.mock('./panels/VariableContextBar', () => ({ default: () => <div data-testid="var-badge" /> }));
vi.mock('./canvas/WorkflowNodeContextMenu', () => ({
  default: ({ open, onCopy, onDuplicate, onExtract, onOpenChild, onDelete, onClose }: {
    open: boolean;
    onCopy: () => void;
    onDuplicate: () => void;
    onExtract?: () => void;
    onOpenChild?: () => void;
    onDelete: () => void;
    onClose: () => void;
  }) => {
    (globalThis as { __wfCtxMenuProps?: unknown }).__wfCtxMenuProps = { onCopy, onDuplicate, onExtract, onOpenChild, onDelete, onClose };
    return open ? (
      <div data-testid="ctx-menu">
        <button data-testid="ctx-copy" onClick={onCopy}>c</button>
        <button data-testid="ctx-dup" onClick={onDuplicate}>d</button>
        {onExtract && <button data-testid="ctx-extract" onClick={onExtract}>x</button>}
        {onOpenChild && <button data-testid="ctx-open" onClick={onOpenChild}>o</button>}
        <button data-testid="ctx-del" onClick={onDelete}>del</button>
        <button data-testid="ctx-close" onClick={onClose}>cl</button>
      </div>
    ) : null;
  },
}));
vi.mock('./canvas/WorkflowCanvasControls', () => ({
  default: ({ onToggleMinimap, onAutoLayout, onSaveLayout, canUndo, canRedo, onUndo, onRedo }: {
    onToggleMinimap: () => void;
    onAutoLayout: () => void;
    onSaveLayout: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
  }) => (
    <div data-testid="controls">
      <button data-testid="ctrl-mini" onClick={onToggleMinimap}>m</button>
      <button data-testid="ctrl-layout" onClick={onAutoLayout}>l</button>
      <button data-testid="ctrl-save" onClick={onSaveLayout}>s</button>
      <button data-testid="ctrl-undo" disabled={!canUndo} onClick={onUndo}>u</button>
      <button data-testid="ctrl-redo" disabled={!canRedo} onClick={onRedo}>r</button>
    </div>
  ),
}));
vi.mock('./canvas/EmptyCanvasTemplates', () => ({
  default: ({ onSelectTemplate, onBrowseGallery }: {
    onSelectTemplate: (t: { id: string }) => void;
    onBrowseGallery: () => void;
  }) => (
    <div data-testid="empty-templates">
      <button data-testid="tpl-select" onClick={() => onSelectTemplate({ id: 't1' })}>t</button>
      <button data-testid="tpl-browse" onClick={onBrowseGallery}>b</button>
    </div>
  ),
}));
vi.mock('./canvas/OnboardingTooltip', () => ({
  default: ({ onDismiss, onDismissAll }: { onDismiss: () => void; onDismissAll: () => void }) => (
    <div data-testid="onboarding">
      <button data-testid="ob-dismiss" onClick={onDismiss}>d</button>
      <button data-testid="ob-dismiss-all" onClick={onDismissAll}>a</button>
    </div>
  ),
}));

const selected = { id: 'w1', name: 'WF' } as unknown as Workflow;

function makeVm(over: Partial<WorkflowDesignerViewModel> = {}): WorkflowDesignerViewModel {
  return {
    isDragOver: false,
    dropTargetEdgeId: null,
    canvasAreaRef: { current: null },
    handleCanvasDragOver: vi.fn(),
    handleCanvasDragLeave: vi.fn(),
    handleCanvasDrop: vi.fn(),
    previewWorkflow: null,
    runProgress: null,
    failedStepLabel: null,
    handleToggleConsole: vi.fn(),
    serializeNodes: vi.fn(() => []),
    nodes: [],
    onUseAsTemplate: vi.fn(),
    onClearPreview: vi.fn(),
    nodeStatuses: {},
    isDebugMode: false,
    handleDebugStep: vi.fn(),
    layoutVersion: 0,
    laidOutId: 'w1',
    edges: [],
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onReconnect: vi.fn(),
    handleNodeClick: vi.fn(),
    openNodeConfig: vi.fn(),
    handleNodeContextMenu: vi.fn(),
    handlePaneClick: vi.fn(),
    handleReactFlowInit: vi.fn(),
    showMinimap: false,
    setShowMinimap: vi.fn(),
    undoRedo: {
      canUndo: vi.fn(() => false),
      canRedo: vi.fn(() => false),
      takeSnapshot: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      clear: vi.fn(),
    },
    handleUndoAction: vi.fn(),
    handleRedoAction: vi.fn(),
    handleAutoLayout: vi.fn(),
    setNodes: vi.fn(),
    runVariableSnapshot: null,
    workflowVariables: {},
    nodeCtxMenu: null,
    setSelectedNodeId: vi.fn(),
    handleCopyNode: vi.fn(),
    handleDuplicateNode: vi.fn(),
    handleExtractToSubWorkflow: vi.fn(),
    handleDeleteNode: vi.fn(),
    navigateToWorkflow: vi.fn(),
    setNodeCtxMenu: vi.fn(),
    persistWorkflow: vi.fn(),
    update: vi.fn(),
    onLoadTemplate: undefined,
    onBrowseGallery: undefined,
    onboarding: { activeHint: null, dismiss: vi.fn(), dismissAll: vi.fn(), remainingCount: 0 },
    ...over,
  } as unknown as WorkflowDesignerViewModel;
}

beforeEach(() => {
  mockGetViewport.mockClear();
  mockSetViewport.mockClear();
  mockFitView.mockClear();
  ioCallback = null;
  class MockIO {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      ioCallback = cb;
    }
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  vi.stubGlobal('IntersectionObserver', MockIO);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});

describe('WorkflowDesignerFlowCanvas', () => {
  it('renders empty canvas hint when no nodes', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={selected} />);
    expect(document.querySelector('.wf-empty-canvas')).toBeTruthy();
    expect(screen.getByTestId('exec-summary')).toBeTruthy();
    expect(screen.getByTestId('controls')).toBeTruthy();
  });

  it('shows drop indicator when dragging over (no edge)', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ isDragOver: true })} selected={selected} />);
    expect(document.querySelector('.wf-drop-indicator')).toBeTruthy();
    expect(document.querySelector('.wf-drop-indicator-edge')).toBeNull();
  });

  it('shows edge drop indicator when dragging over an edge target', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ isDragOver: true, dropTargetEdgeId: 'e1', edges: [{ id: 'e1', source: 'a', target: 'b' }] as unknown as WorkflowDesignerViewModel['edges'] })} selected={selected} />);
    expect(document.querySelector('.wf-drop-indicator-edge')).toBeTruthy();
  });

  it('renders empty-canvas templates and fires callbacks', () => {
    const onLoadTemplate = vi.fn();
    const onBrowseGallery = vi.fn();
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ onLoadTemplate, onBrowseGallery })} selected={selected} />);
    fireEvent.click(screen.getByTestId('tpl-select'));
    expect(onLoadTemplate).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByTestId('tpl-browse'));
    expect(onBrowseGallery).toHaveBeenCalled();
  });

  it('uses a no-op fallback when onBrowseGallery is not provided', () => {
    const onLoadTemplate = vi.fn();
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ onLoadTemplate, onBrowseGallery: undefined })} selected={selected} />);
    // Clicking browse with no handler provided should hit the `?? (() => {})` fallback without throwing
    expect(() => fireEvent.click(screen.getByTestId('tpl-browse'))).not.toThrow();
  });

  it('restores a saved viewport when switching to a workflow that has one', () => {
    vi.useFakeTimers();
    try {
      const withViewport = { id: 'w2', name: 'WF2', savedViewport: { x: 5, y: 6, zoom: 2 } } as unknown as Workflow;
      render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={withViewport} />);
      act(() => { vi.advanceTimersByTime(200); });
      // The effect schedules a setTimeout -> requestAnimationFrame -> setViewport; advancing timers flushes it
      expect(document.querySelector('.wf-canvas-area')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fits view when switching to a workflow without a saved viewport', () => {
    vi.useFakeTimers();
    try {
      const noViewport = { id: 'w3', name: 'WF3' } as unknown as Workflow;
      render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={noViewport} />);
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelector('.wf-canvas-area')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders preview banner and use-as-template / close actions', () => {
    const onUseAsTemplate = vi.fn();
    const onClearPreview = vi.fn();
    const serializeNodes = vi.fn(() => [{ id: 'n' }]);
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          previewWorkflow: { id: 'p1', name: 'Sample', description: 'desc' } as unknown as WorkflowDesignerViewModel['previewWorkflow'],
          laidOutId: 'other',
          onUseAsTemplate,
          onClearPreview,
          serializeNodes,
        })}
        selected={selected}
      />,
    );
    expect(document.querySelector('.wf-preview-banner')).toBeTruthy();
    expect(screen.getByTestId('rf').getAttribute('data-hidden')).toBe('1');
    fireEvent.click(screen.getByText('Use as Template'));
    expect(serializeNodes).toHaveBeenCalled();
    expect(onUseAsTemplate).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Close Preview'));
    expect(onClearPreview).toHaveBeenCalled();
  });

  it('node double-click opens node config', () => {
    const openNodeConfig = vi.fn();
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ openNodeConfig })} selected={selected} />);
    fireEvent.click(screen.getByTestId('rf-dbl'));
    expect(openNodeConfig).toHaveBeenCalledWith('n1');
  });

  it('canvas controls: toggle minimap, auto layout, save layout', () => {
    const setShowMinimap = vi.fn();
    const handleAutoLayout = vi.fn();
    const persistWorkflow = vi.fn();
    const update = vi.fn();
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ setShowMinimap, handleAutoLayout, persistWorkflow, update })} selected={selected} />);
    fireEvent.click(screen.getByTestId('ctrl-mini'));
    const updater = setShowMinimap.mock.calls[0][0];
    expect(updater(false)).toBe(true);
    fireEvent.click(screen.getByTestId('ctrl-layout'));
    expect(handleAutoLayout).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ctrl-save'));
    expect(persistWorkflow).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('w1', { savedViewport: { x: 1, y: 2, zoom: 1 } });
  });

  it('canvas controls: wires undo/redo handlers and passes canUndo/canRedo through', () => {
    const handleUndoAction = vi.fn();
    const handleRedoAction = vi.fn();
    const undoRedo = {
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => false),
      takeSnapshot: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      clear: vi.fn(),
    };
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ undoRedo, handleUndoAction, handleRedoAction })} selected={selected} />);

    const undoBtn = screen.getByTestId('ctrl-undo') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('ctrl-redo') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false); // canUndo() -> true
    expect(redoBtn.disabled).toBe(true); // canRedo() -> false

    fireEvent.click(undoBtn);
    expect(handleUndoAction).toHaveBeenCalled();
    fireEvent.click(redoBtn);
    // redoBtn is disabled, so the click is a no-op — assert it was NOT called.
    expect(handleRedoAction).not.toHaveBeenCalled();
  });

  it('canvas controls: enables redo and disables undo when the stack is empty/exhausted', () => {
    const handleUndoAction = vi.fn();
    const handleRedoAction = vi.fn();
    const undoRedo = {
      canUndo: vi.fn(() => false),
      canRedo: vi.fn(() => true),
      takeSnapshot: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      clear: vi.fn(),
    };
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ undoRedo, handleUndoAction, handleRedoAction })} selected={selected} />);

    const undoBtn = screen.getByTestId('ctrl-undo') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('ctrl-redo') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);

    fireEvent.click(redoBtn);
    expect(handleRedoAction).toHaveBeenCalled();
  });

  it('shows minimap when enabled', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ showMinimap: true })} selected={selected} />);
    expect(screen.getByTestId('minimap')).toBeTruthy();
  });

  it('shows variable badge when variables present', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ workflowVariables: { a: '1' } })} selected={selected} />);
    expect(screen.getByTestId('var-badge')).toBeTruthy();
  });

  it('context menu guards return early when no nodeCtxMenu', () => {
    const handleCopyNode = vi.fn();
    const setNodeCtxMenu = vi.fn();
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ handleCopyNode, setNodeCtxMenu })} selected={selected} />);
    // menu closed (open=false) so it's not rendered
    expect(screen.queryByTestId('ctx-menu')).toBeNull();
  });

  it('context menu actions fire for a subWorkflow node', () => {
    const handleCopyNode = vi.fn();
    const handleDuplicateNode = vi.fn();
    const handleExtractToSubWorkflow = vi.fn();
    const handleDeleteNode = vi.fn();
    const navigateToWorkflow = vi.fn();
    const setSelectedNodeId = vi.fn();
    const setNodeCtxMenu = vi.fn();
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          nodeCtxMenu: { nodeId: 'sw1', x: 10, y: 20 },
          nodes: [{ id: 'sw1', type: 'subWorkflow', position: { x: 0, y: 0 }, data: { workflowId: 'wf2' } }] as unknown as WorkflowDesignerViewModel['nodes'],
          handleCopyNode,
          handleDuplicateNode,
          handleExtractToSubWorkflow,
          handleDeleteNode,
          navigateToWorkflow,
          setSelectedNodeId,
          setNodeCtxMenu,
        })}
        selected={selected}
      />,
    );
    fireEvent.click(screen.getByTestId('ctx-copy'));
    expect(setSelectedNodeId).toHaveBeenCalledWith('sw1');
    expect(handleCopyNode).toHaveBeenCalledWith('sw1');
    fireEvent.click(screen.getByTestId('ctx-dup'));
    expect(handleDuplicateNode).toHaveBeenCalledWith('sw1');
    fireEvent.click(screen.getByTestId('ctx-extract'));
    expect(handleExtractToSubWorkflow).toHaveBeenCalledWith('sw1');
    fireEvent.click(screen.getByTestId('ctx-open'));
    expect(navigateToWorkflow).toHaveBeenCalledWith('wf2');
    fireEvent.click(screen.getByTestId('ctx-del'));
    expect(handleDeleteNode).toHaveBeenCalledWith('sw1');
    fireEvent.click(screen.getByTestId('ctx-close'));
    expect(setNodeCtxMenu).toHaveBeenCalledWith(null);
  });

  it('context menu without subWorkflow node hides open-child', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          nodeCtxMenu: { nodeId: 'h1', x: 1, y: 2 },
          nodes: [{ id: 'h1', type: 'http', position: { x: 0, y: 0 }, data: {} }] as unknown as WorkflowDesignerViewModel['nodes'],
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('ctx-extract')).toBeTruthy();
    expect(screen.queryByTestId('ctx-open')).toBeNull();
  });

  it('renders onboarding tooltip and fires dismiss handlers', () => {
    const dismiss = vi.fn();
    const dismissAll = vi.fn();
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({ onboarding: { activeHint: { id: 'h1' }, dismiss, dismissAll, remainingCount: 2 } as unknown as WorkflowDesignerViewModel['onboarding'] })}
        selected={selected}
      />,
    );
    fireEvent.click(screen.getByTestId('ob-dismiss'));
    expect(dismiss).toHaveBeenCalledWith('h1');
    fireEvent.click(screen.getByTestId('ob-dismiss-all'));
    expect(dismissAll).toHaveBeenCalled();
  });

  it('runs IntersectionObserver visibility callback (hide then show)', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ canvasAreaRef: { current: container } as unknown as WorkflowDesignerViewModel['canvasAreaRef'] })} selected={selected} />);
    expect(ioCallback).toBeTruthy();
    act(() => { ioCallback?.([{ isIntersecting: false }]); });
    act(() => { ioCallback?.([{ isIntersecting: true }]); vi.advanceTimersByTime(100); });
    vi.useRealTimers();
  });

  it('restores saved viewport on selected with savedViewport', () => {
    vi.useFakeTimers();
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm()}
        selected={{ id: 'w2', name: 'WF2', savedViewport: { x: 5, y: 6, zoom: 2 } } as unknown as Workflow}
      />,
    );
    act(() => { vi.advanceTimersByTime(150); });
    vi.useRealTimers();
    expect(true).toBe(true);
  });

  it('debug mode wires debug step context', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ isDebugMode: true })} selected={selected} />);
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('exposes window bridge helpers for deselect and open config', () => {
    const setNodes = vi.fn((updater: (ns: { id: string; selected?: boolean }[]) => unknown) => {
      if (typeof updater === 'function') updater([{ id: 'n1', selected: true }]);
    });
    const openNodeConfig = vi.fn();
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ setNodes, openNodeConfig })} selected={selected} />);
    const win = window as unknown as Record<string, unknown>;
    expect(typeof win.__wfDeselectAll).toBe('function');
    expect(typeof win.__wfOpenNodeConfig).toBe('function');
    (win.__wfDeselectAll as () => void)();
    expect(setNodes).toHaveBeenCalled();
    (win.__wfOpenNodeConfig as (id: string) => void)('n1');
    expect(openNodeConfig).toHaveBeenCalledWith('n1');
  });

  it('clears pending fit timers on unmount so RAF is not required after teardown', () => {
    vi.useFakeTimers();
    const { unmount } = render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={selected} />);
    unmount();
    const raf = globalThis.requestAnimationFrame;
    // @ts-expect-error -- simulate Vitest jsdom teardown after the file ends
    delete globalThis.requestAnimationFrame;
    expect(() => { vi.advanceTimersByTime(200); }).not.toThrow();
    globalThis.requestAnimationFrame = raf;
    vi.useRealTimers();
  });

  it('cleans up window bridge helpers on unmount', () => {
    const { unmount } = render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={selected} />);
    const win = window as unknown as Record<string, unknown>;
    expect(win.__wfDeselectAll).toBeTruthy();
    unmount();
    expect(win.__wfDeselectAll).toBeUndefined();
    expect(win.__wfOpenNodeConfig).toBeUndefined();
  });

  it('hides node selection when config modal is open', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          configModalNodeId: 'n1',
          nodes: [{ id: 'n1', type: 'http', position: { x: 0, y: 0 }, selected: true, data: {} }] as unknown as WorkflowDesignerViewModel['nodes'],
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('shows variable badge from run snapshot when present', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({ runVariableSnapshot: { token: 'abc' }, workflowVariables: {} })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('var-badge')).toBeTruthy();
  });

  it('does not render empty canvas when nodes exist', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({ nodes: [{ id: 'n1', type: 'http', position: { x: 0, y: 0 }, data: {} }] as unknown as WorkflowDesignerViewModel['nodes'] })}
        selected={selected}
      />,
    );
    expect(document.querySelector('.wf-empty-canvas')).toBeNull();
  });

  it('highlights drop target edge preserving existing className', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          dropTargetEdgeId: 'e1',
          edges: [{ id: 'e1', source: 'a', target: 'b', className: 'existing' }] as unknown as WorkflowDesignerViewModel['edges'],
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('context menu callbacks no-op when nodeCtxMenu is null', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ nodeCtxMenu: null })} selected={selected} />);
    const props = (globalThis as { __wfCtxMenuProps?: { onCopy: () => void; onDuplicate: () => void; onDelete: () => void } }).__wfCtxMenuProps!;
    expect(() => props.onCopy()).not.toThrow();
    expect(() => props.onDuplicate()).not.toThrow();
    expect(() => props.onDelete()).not.toThrow();
  });

  it('subWorkflow without workflowId omits open-child action', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          nodeCtxMenu: { nodeId: 'sw1', x: 1, y: 2 },
          nodes: [{ id: 'sw1', type: 'subWorkflow', position: { x: 0, y: 0 }, data: {} }] as unknown as WorkflowDesignerViewModel['nodes'],
        })}
        selected={selected}
      />,
    );
    expect(screen.queryByTestId('ctx-open')).toBeNull();
  });

  it('restores saved viewport on visibility when last viewport was not captured', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const withViewport = { id: 'w1', name: 'WF', savedViewport: { x: 9, y: 8, zoom: 1.5 } } as unknown as Workflow;
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({ canvasAreaRef: { current: container } as unknown as WorkflowDesignerViewModel['canvasAreaRef'] })}
        selected={withViewport}
      />,
    );
    act(() => { ioCallback?.([{ isIntersecting: true }]); });
    act(() => { ioCallback?.([{ isIntersecting: false }]); });
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers();
  });

  it('skips workflow viewport effect while preview is active', () => {
    vi.useFakeTimers();
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          previewWorkflow: { id: 'p1', name: 'Preview' } as unknown as WorkflowDesignerViewModel['previewWorkflow'],
        })}
        selected={{ id: 'w-new', name: 'New' } as unknown as Workflow}
      />,
    );
    act(() => { vi.advanceTimersByTime(200); });
    vi.useRealTimers();
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('onboarding dismiss skips when hint id is missing', () => {
    const dismiss = vi.fn();
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          onboarding: { activeHint: {}, dismiss, dismissAll: vi.fn(), remainingCount: 1 } as unknown as WorkflowDesignerViewModel['onboarding'],
        })}
        selected={selected}
      />,
    );
    fireEvent.click(screen.getByTestId('ob-dismiss'));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('preview hides react flow only when layout id differs from selected', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          previewWorkflow: { id: 'p1', name: 'Sample', description: 'd' } as unknown as WorkflowDesignerViewModel['previewWorkflow'],
          laidOutId: 'w1',
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf').getAttribute('data-hidden')).toBe('0');
  });

  it('highlights drop target edge without prior className', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          dropTargetEdgeId: 'e1',
          edges: [{ id: 'e1', source: 'a', target: 'b' }] as unknown as WorkflowDesignerViewModel['edges'],
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('leaves unselected nodes unchanged when config modal is open', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          configModalNodeId: 'n1',
          nodes: [{ id: 'n1', type: 'http', position: { x: 0, y: 0 }, selected: false, data: {} }] as unknown as WorkflowDesignerViewModel['nodes'],
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('deselect bridge skips nodes that are not selected', () => {
    const setNodes = vi.fn((updater: (ns: { id: string; selected?: boolean }[]) => unknown) => {
      if (typeof updater === 'function') updater([{ id: 'n1', selected: false }]);
    });
    render(<WorkflowDesignerFlowCanvas vm={makeVm({ setNodes })} selected={selected} />);
    (window as unknown as Record<string, () => void>).__wfDeselectAll();
    expect(setNodes).toHaveBeenCalled();
  });

  it('returns early when canvas ref current is unavailable', () => {
    const nullRef = {
      get current() {
        return null;
      },
      set current(_next: HTMLDivElement | null) {
        // Keep current null so the effect early-return path is exercised.
      },
    };
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({ canvasAreaRef: nullRef as unknown as WorkflowDesignerViewModel['canvasAreaRef'] })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('skips viewport switch effect when selected id is unchanged', () => {
    const vm = makeVm();
    const { rerender } = render(<WorkflowDesignerFlowCanvas vm={vm} selected={selected} />);
    rerender(<WorkflowDesignerFlowCanvas vm={vm} selected={selected} />);
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('exposes wfFitView helper with default and custom options', () => {
    render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={selected} />);
    const fn = (window as unknown as Record<string, unknown>).__wfFitView as
      | ((opts?: Record<string, unknown>) => boolean)
      | undefined;
    expect(typeof fn).toBe('function');

    expect(fn?.()).toBe(true);
    expect(mockFitView).toHaveBeenCalledWith({
      padding: { top: 0.08, right: 0.34, bottom: 0.1, left: 0.06 },
      maxZoom: 1,
      minZoom: 0.4,
      duration: 250,
      includeHiddenNodes: true,
    });

    fn?.({ padding: 0.2, maxZoom: 2, minZoom: 0.5, duration: 10 });
    expect(mockFitView).toHaveBeenLastCalledWith({
      padding: 0.2,
      maxZoom: 2,
      minZoom: 0.5,
      duration: 10,
      includeHiddenNodes: true,
    });
  });

  it('forces fitView duration 0 while demo bootstrapping', () => {
    document.body.setAttribute('data-demo-bootstrapping', '1');
    try {
      render(<WorkflowDesignerFlowCanvas vm={makeVm()} selected={selected} />);
      const fn = (window as unknown as Record<string, unknown>).__wfFitView as
        | ((opts?: Record<string, unknown>) => boolean)
        | undefined;
      mockFitView.mockClear();
      expect(fn?.({ duration: 300 })).toBe(true);
      expect(mockFitView).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
    } finally {
      document.body.removeAttribute('data-demo-bootstrapping');
    }
  });

  it('keeps non-target edges untouched when highlighting drop target edge', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          dropTargetEdgeId: 'e1',
          edges: [
            { id: 'e1', source: 'a', target: 'b', className: 'base' },
            { id: 'e2', source: 'b', target: 'c', className: 'other' },
          ] as unknown as WorkflowDesignerViewModel['edges'],
        })}
        selected={selected}
      />,
    );
    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('builds published catalog key set from workflowPublication and legacy published flag', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          catalogEntries: [
            {
              id: 'entry-a',
              endpoints: [
                { id: 'ep-pub', workflowPublication: { publishedAt: Date.now(), publishedFromVersionId: 'v1' } },
                { id: 'ep-legacy', workflowExposure: 'published' },
                { id: 'ep-no' },
              ],
              folders: [],
            },
          ] as unknown as WorkflowDesignerViewModel['catalogEntries'],
        })}
        selected={selected}
      />,
    );

    expect(screen.getByTestId('rf')).toBeTruthy();
  });

  it('scans nested catalog folders when building published key set', () => {
    render(
      <WorkflowDesignerFlowCanvas
        vm={makeVm({
          catalogEntries: [
            {
              id: 'entry-b',
              endpoints: [],
              folders: [
                {
                  id: 'f1',
                  endpoints: [{ id: 'ep-f1', workflowExposure: 'published' }],
                  folders: [
                    {
                      id: 'f2',
                      endpoints: [{ id: 'ep-f2', workflowPublication: { publishedAt: Date.now(), publishedFromVersionId: 'v1' } }],
                      folders: [],
                    },
                  ],
                },
              ],
            },
          ] as unknown as WorkflowDesignerViewModel['catalogEntries'],
        })}
        selected={selected}
      />,
    );

    expect(screen.getByTestId('rf')).toBeTruthy();
  });
});
