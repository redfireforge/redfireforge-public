/**
 * @vitest-environment jsdom
 */
import { SetStateAction } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkflowNodeActions, buildServiceFromCollection } from './useWorkflowNodeActions';
import { WorkflowRFNode, WorkflowRFEdge } from '../utils/workflowNodeFactory';
import { Workflow, WorkflowNode, WorkflowNodeData, HttpNodeData, WorkflowService } from '../types/workflow';
import { RequestCollection, Environment, Microservice, GlobalAuthProfile } from '@shared/types';
import { CatalogEntry } from '../../catalog/types/catalog';
import { ToastApi } from '../components/WorkflowToastProvider';
import { ExtractResult } from '../utils/workflowExtractSubWorkflow';

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  }),
}));

type NodeActionsOpts = Parameters<typeof useWorkflowNodeActions>[0];

const minimalWorkflow = (): Workflow => ({
  id: 'wf-1',
  name: 'Test',
  schemaVersion: 5,
  variables: {},
  hostProfiles: [],
  authProfiles: [],
  services: [],
  nodes: [],
  edges: [],
  createdAt: 0,
  updatedAt: 0,
});

vi.mock('uuid', () => ({ v4: vi.fn(() => 'mock-uuid') }));
vi.mock('../utils/workflowNodeFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/workflowNodeFactory')>();
  return {
    ...actual,
    defaultNodeData: (type: Parameters<typeof actual.defaultNodeData>[0]) =>
      ({ ...actual.defaultNodeData(type), label: `New ${type}` }),
  };
});
vi.mock('../utils/workflowNodeMerge', () => ({
  mergeWorkflowNodeData: (existing: WorkflowNodeData, patch: Partial<WorkflowNodeData>) =>
    ({ ...existing, ...patch } as WorkflowNodeData),
}));
vi.mock('../utils/workflowRequestHost', () => ({
  resolveQuickTestHostForRequest: vi.fn(() => ({})),
}));
vi.mock('../utils/workflowExtractSubWorkflow', () => ({
  extractToSubWorkflow: vi.fn(() => null),
}));
vi.mock('../components/panels/WorkflowNewNodeContext', () => ({
  markNodeAsNew: vi.fn(),
}));

import { extractToSubWorkflow } from '../utils/workflowExtractSubWorkflow';
const mockExtract = vi.mocked(extractToSubWorkflow);

const makeRef = <T,>(value: T) => ({ current: value });

const defaultOpts = (): NodeActionsOpts => ({
  selected: minimalWorkflow(),
  collections: [] as RequestCollection[],
  catalogEntries: [] as CatalogEntry[],
  environments: [] as Environment[],
  microservices: [] as Microservice[],
  selectedEnvId: 'env-1',
  resolvedBaseUrl: 'http://localhost',
  selectedNodeId: null as string | null,
  setSelectedNodeId: vi.fn(),
  setNodes: vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => (typeof fn === 'function' ? fn([]) : fn)),
  setEdges: vi.fn((fn: SetStateAction<WorkflowRFEdge[]>) => (typeof fn === 'function' ? fn([]) : fn)),
  setNodeInitialVars: vi.fn(),
  nodeInitialVarsRef: makeRef({}),
  nodesRef: makeRef([] as WorkflowRFNode[]),
  edgesRef: makeRef([] as WorkflowRFEdge[]),
  serializeNodes: vi.fn((nodes: WorkflowRFNode[]) => nodes as unknown as WorkflowNode[]),
  serializeEdges: vi.fn((edges: WorkflowRFEdge[]) => edges),
  update: vi.fn(),
  persistWorkflow: vi.fn(),
  undoRedo: { takeSnapshot: vi.fn() },
  workflows: [] as Workflow[],
  create: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() } as ToastApi,
  nextNodeYRef: makeRef(100),
});

describe('useWorkflowNodeActions', () => {
  beforeEach(() => resetAllMocks());

  it('handleAddNode adds a node to canvas', () => {
    const opts = defaultOpts();
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddNode('http'));
    expect(opts.undoRedo.takeSnapshot).toHaveBeenCalledWith('Add node');
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('advances nextNodeYRef after adding a node', () => {
    const opts = defaultOpts();
    opts.nextNodeYRef.current = 100;
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddNode('http'));
    // Node placed in visible viewport center; nextNodeYRef advances by 120 from placement Y
    expect(opts.nextNodeYRef.current).toBeGreaterThan(100);
  });

  it('finds non-overlapping placement when center is occupied', () => {
    const opts = defaultOpts();
    opts.nodesRef.current = [
      { id: 'a', type: 'http', position: { x: 290, y: 255 }, data: { label: 'a' } as WorkflowNodeData },
      { id: 'b', type: 'http', position: { x: 290, y: 405 }, data: { label: 'b' } as WorkflowNodeData },
    ];
    let capturedNodes: WorkflowRFNode[] = [];
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      capturedNodes = typeof fn === 'function' ? fn(opts.nodesRef.current) : fn;
      return capturedNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddNode('http'));
    expect(capturedNodes.length).toBe(3);
    const added = capturedNodes[2];
    expect(added.position).not.toEqual({ x: 290, y: 255 });
  });

  it('falls back to spiral search when initial fallback still overlaps', () => {
    const opts = defaultOpts();
    opts.nodesRef.current = [
      { id: 'a', type: 'http', position: { x: 290, y: 255 }, data: { label: 'a' } as WorkflowNodeData },
      { id: 'b', type: 'http', position: { x: 290, y: 405 }, data: { label: 'b' } as WorkflowNodeData },
    ];
    const maxSpy = vi.spyOn(Math, 'max').mockReturnValue(255);
    let capturedNodes: WorkflowRFNode[] = [];
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      capturedNodes = typeof fn === 'function' ? fn(opts.nodesRef.current) : fn;
      return capturedNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddNode('http'));
    expect(capturedNodes.length).toBe(3);
    const added = capturedNodes[2];
    expect(added.position).toEqual({ x: 570, y: 255 });
    maxSpy.mockRestore();
  });

  it('does nothing when selected is null', () => {
    const opts = defaultOpts();
    opts.selected = null;
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddNode('http'));
    expect(opts.setNodes).not.toHaveBeenCalled();
  });

  it('exposes __wfAddNode with preset id, label, and position', () => {
    const opts = defaultOpts();
    const { unmount } = renderHook(() => useWorkflowNodeActions(opts));
    const win = window as unknown as Record<string, (t: string, id?: string, label?: string, pos?: { x: number; y: number }) => string>;
    expect(win.__wfAddNode).toBeTypeOf('function');
    act(() => win.__wfAddNode('graphqlMutation', 'gql18-delete', 'Delete User', { x: 780, y: 280 }));
    expect(opts.setNodes).toHaveBeenCalled();
    expect(opts.undoRedo.takeSnapshot).toHaveBeenCalledWith('Add node');
    unmount();
    expect(win.__wfAddNode).toBeUndefined();
  });

  it('exposes __wfAddNode simple mode and returns last added id', () => {
    const opts = defaultOpts();
    const { unmount } = renderHook(() => useWorkflowNodeActions(opts));
    const win = window as unknown as Record<string, (t: string) => string | undefined>;
    const addedId = win.__wfAddNode('http');
    expect(addedId).toBe('mock-uuid');
    unmount();
  });

  it('addNodeToCanvasWithPreset is idempotent for duplicate ids', () => {
    const opts = defaultOpts();
    const existing: WorkflowRFNode = {
      id: 'gql18-delete',
      type: 'graphqlMutation',
      position: { x: 1, y: 2 },
      data: { label: 'Delete User' } as WorkflowNodeData,
    };
    opts.nodesRef = makeRef([existing]);
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.addNodeToCanvasWithPreset(
      'graphqlMutation',
      'gql18-delete',
      'Delete User',
      { x: 780, y: 280 },
    ));
    expect(opts.setNodes).not.toHaveBeenCalled();
  });

  it('handleDeleteNode removes node and related edges', () => {
    const opts = defaultOpts();
    const node: WorkflowRFNode = { id: 'n1', type: 'http', position: { x: 0, y: 0 }, data: { label: 'n1' } as WorkflowNodeData };
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => (typeof fn === 'function' ? fn([node]) : fn));
    opts.setEdges = vi.fn((fn: SetStateAction<WorkflowRFEdge[]>) => (typeof fn === 'function' ? fn([{ id: 'e1', source: 'n1', target: 'n2' }]) : fn));
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleDeleteNode('n1'));
    expect(opts.undoRedo.takeSnapshot).toHaveBeenCalledWith('Delete node');
    expect(opts.setNodes).toHaveBeenCalled();
    expect(opts.setEdges).toHaveBeenCalled();
    expect(opts.setNodeInitialVars).toHaveBeenCalled();
  });

  it('handleDeleteNode clears selectedNodeId when deleting selected', () => {
    const opts = defaultOpts();
    opts.selectedNodeId = 'n1';
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleDeleteNode('n1'));
    expect(opts.setSelectedNodeId).toHaveBeenCalledWith(null);
  });

  it('handleDeleteNode removes orphaned service when last referencing node is deleted', () => {
    const opts = defaultOpts();
    const httpNode: WorkflowRFNode = {
      id: 'n1', type: 'http', position: { x: 0, y: 0 },
      data: { label: 'Test', serviceId: 'svc-1' } as WorkflowNodeData,
    };
    opts.nodesRef = makeRef([httpNode]);
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => (typeof fn === 'function' ? fn([httpNode]) : fn));
    const setWorkflowServices = vi.fn((fn: SetStateAction<WorkflowService[]>) => {
      if (typeof fn === 'function') fn([{ id: 'svc-1', name: 'Test Service', endpoints: [] }]);
    });
    opts.setWorkflowServices = setWorkflowServices;
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleDeleteNode('n1'));
    expect(setWorkflowServices).toHaveBeenCalled();
  });

  it('handleDeleteNode keeps service when other nodes still reference it', () => {
    const opts = defaultOpts();
    const httpNode1: WorkflowRFNode = {
      id: 'n1', type: 'http', position: { x: 0, y: 0 },
      data: { label: 'Node 1', serviceId: 'svc-1' } as WorkflowNodeData,
    };
    const httpNode2: WorkflowRFNode = {
      id: 'n2', type: 'http', position: { x: 0, y: 100 },
      data: { label: 'Node 2', serviceId: 'svc-1' } as WorkflowNodeData,
    };
    opts.nodesRef = makeRef([httpNode1, httpNode2]);
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => (typeof fn === 'function' ? fn([httpNode1, httpNode2]) : fn));
    const setWorkflowServices = vi.fn();
    opts.setWorkflowServices = setWorkflowServices;
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleDeleteNode('n1'));
    expect(setWorkflowServices).not.toHaveBeenCalled();
  });

  it('handleDeleteNode does not clear selectedNodeId for other nodes', () => {
    const opts = defaultOpts();
    opts.selectedNodeId = 'n2';
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleDeleteNode('n1'));
    expect(opts.setSelectedNodeId).not.toHaveBeenCalled();
  });

  it('handleDeleteNode initial-vars cleanup updater removes deleted key', () => {
    const opts = defaultOpts();
    let state: Record<string, Record<string, unknown>> = { n1: { token: 'x' }, keep: { y: 1 } };
    opts.setNodeInitialVars = vi.fn((fn: SetStateAction<Record<string, Record<string, unknown>>>) => {
      state = typeof fn === 'function' ? fn(state) : fn;
      return state;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleDeleteNode('n1'));
    expect(state.n1).toBeUndefined();
    expect(state.keep).toEqual({ y: 1 });
  });

  it('handleUpdateNode with initialVariables updates nodeInitialVarsRef', () => {
    const opts = defaultOpts();
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleUpdateNode('n1', { initialVariables: { token: 'xyz' } }));
    expect(opts.nodeInitialVarsRef.current.n1).toEqual({ token: 'xyz' });
    expect(opts.setNodeInitialVars).toHaveBeenCalled();
    expect(opts.persistWorkflow).toHaveBeenCalled();
  });

  it('handleUpdateNode with non-IV patch updates via setNodes', () => {
    const opts = defaultOpts();
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      const resultNodes = fn([{ id: 'n1', type: 'http', data: { label: 'Old' }, position: { x: 0, y: 0 } }]);
      opts.nodesRef.current = resultNodes;
      return resultNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleUpdateNode('n1', { label: 'New' }));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromRequest finds request in collection', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [{ id: 'req-1', name: 'Get Users', url: '/users', method: 'GET' }],
      folders: [],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-1'));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromRequest does nothing for missing collection', () => {
    const opts = defaultOpts();
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('missing', 'req-1'));
    expect(opts.setNodes).not.toHaveBeenCalled();
  });

  it('handleAddFromRequest searches folders recursively', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [],
      folders: [{
        id: 'f1', name: 'Folder', requests: [
          { id: 'req-deep', name: 'Deep', url: '/deep', method: 'POST' },
        ], folders: [],
      }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-deep'));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromCatalog adds endpoint from catalog', () => {
    const opts = defaultOpts();
    opts.catalogEntries = [{
      id: 'cat-1',
      servers: [{ url: 'https://api.example.com' }],
      endpoints: [{ id: 'ep-1', path: '/pets', method: 'get', summary: 'List Pets' }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('cat-1', 'ep-1'));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromCatalog does nothing for missing entry', () => {
    const opts = defaultOpts();
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('missing', 'ep-1'));
    expect(opts.setNodes).not.toHaveBeenCalled();
  });

  it('handleAddFromCatalog does nothing for missing endpoint', () => {
    const opts = defaultOpts();
    opts.catalogEntries = [{
      id: 'cat-1',
      servers: [{ url: 'https://api.example.com' }],
      endpoints: [{ id: 'ep-1', path: '/pets', method: 'get', summary: 'List Pets' }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('cat-1', 'ep-99'));
    expect(opts.setNodes).not.toHaveBeenCalled();
  });

  it('handleAddFromCatalog searches nested folders for endpoint', () => {
    const opts = defaultOpts();
    opts.catalogEntries = [{
      id: 'cat-1',
      servers: [{ url: 'https://api.example.com' }],
      endpoints: [],
      folders: [{
        id: 'f1',
        name: 'Pets',
        endpoints: [{ id: 'ep-nested', path: '/nested', method: 'get', summary: 'Nested Pet' }],
        folders: [],
      }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('cat-1', 'ep-nested'));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromCatalog searches deeply nested folders', () => {
    const opts = defaultOpts();
    opts.catalogEntries = [{
      id: 'cat-1',
      servers: [{ url: 'https://api.example.com' }],
      endpoints: [],
      folders: [{
        id: 'f1',
        name: 'Top',
        endpoints: [],
        folders: [{
          id: 'f2',
          name: 'Sub',
          endpoints: [{ id: 'ep-deep', path: '/deep', method: 'post', summary: 'Deep' }],
          folders: [],
        }],
      }],
    }];
    let capturedNodes: WorkflowRFNode[] = [];
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      capturedNodes = typeof fn === 'function' ? fn([]) : fn;
      return capturedNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('cat-1', 'ep-deep'));
    expect(capturedNodes).toHaveLength(1);
    expect((capturedNodes[0].data as HttpNodeData).scenario.method).toBe('POST');
  });

  it('handleAddFromCatalog uses relative URL when server list is empty', () => {
    const opts = defaultOpts();
    opts.catalogEntries = [{
      id: 'cat-1',
      servers: [],
      endpoints: [{ id: 'ep-1', path: '/z', method: 'get', summary: '' }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('cat-1', 'ep-1'));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromCatalog populates scenario from workflowValues', () => {
    const opts = defaultOpts();
    opts.catalogEntries = [{
      id: 'cat-1',
      servers: [{ url: 'https://api.example.com' }],
      endpoints: [{
        id: 'ep-1', path: '/users/{userId}/orders', method: 'get', summary: 'User Orders',
        exposedToWorkflow: true,
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'X-Correlation-Id', in: 'header', required: false, schema: { type: 'string' } },
        ],
        workflowValues: {
          paramValues: { userId: '42', status: 'active' },
          headerValues: { 'X-Correlation-Id': 'abc-123', 'X-Extra': 'extra' },
          body: '{"filter":"recent"}',
        },
      }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromCatalog('cat-1', 'ep-1'));
    expect(opts.setNodes).toHaveBeenCalled();
    const updater = (opts.setNodes as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const nodes = typeof updater === 'function' ? updater([]) : updater;
    const data = nodes[0].data as HttpNodeData;
    expect(data.scenario.url).toBe('https://api.example.com/users/42/orders?status=active');
    expect(data.scenario.headers).toEqual(expect.arrayContaining([
      { key: 'X-Correlation-Id', value: 'abc-123' },
      { key: 'X-Extra', value: 'extra' },
    ]));
    expect(data.scenario.body).toBe('{"filter":"recent"}');
    expect(data.catalogRef).toEqual({ entryId: 'cat-1', endpointId: 'ep-1', method: 'GET', path: '/users/{userId}/orders' });
  });

  it('handleAddFromRequest does nothing when request not found anywhere', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [{ id: 'req-1', name: 'R1', url: '/', method: 'GET' }],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-missing'));
    expect(opts.setNodes).not.toHaveBeenCalled();
  });

  it('handleAddFromRequest searches nested folders', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [],
      folders: [{
        id: 'f1', name: 'Top', requests: [],
        folders: [{
          id: 'f2', name: 'Sub', requests: [
            { id: 'req-nested', name: 'Nested', url: '/nested', method: 'PUT' },
          ], folders: [],
        }],
      }],
    }];
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-nested'));
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleAddFromRequest sets specVersionMode to latest by default', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [{
        id: 'req-v', name: 'Versioned', url: '/v', method: 'GET',
        headers: [], body: '', auth: { type: 'none' },
        specVersions: [{
          id: 'sv-1', catalogVersion: '1.0.0', catalogEntryId: 'e1', catalogEndpointId: 'ep-1',
          importedAt: 1000, url: '/v', method: 'GET', headers: [], body: '',
        }],
        activeSpecVersionId: 'sv-1',
      }],
      folders: [],
    }];
    let capturedNodes: WorkflowRFNode[] = [];
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      capturedNodes = typeof fn === 'function' ? fn([]) : fn;
      return capturedNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-v'));
    expect(capturedNodes).toHaveLength(1);
    const nodeData = capturedNodes[0].data;
    expect(nodeData.specVersionMode).toBe('latest');
    expect(nodeData.sourceSpecVersionId).toBe('sv-1');
  });

  it('handleAddFromRequest populates scenario sourceRequestId and sourceSpecVersionId', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [{
        id: 'req-v2', name: 'V2', url: '/v2', method: 'POST',
        headers: [], body: '', auth: { type: 'none' },
        specVersions: [
          { id: 'sv-a', catalogVersion: '1.0.0', catalogEntryId: 'e1', catalogEndpointId: 'ep-1', importedAt: 1000, url: '/v', method: 'GET', headers: [], body: '' },
          { id: 'sv-b', catalogVersion: '2.0.0', catalogEntryId: 'e1', catalogEndpointId: 'ep-1', importedAt: 2000, url: '/v2', method: 'POST', headers: [], body: '' },
        ],
        activeSpecVersionId: 'sv-b',
      }],
      folders: [],
    }];
    let capturedNodes: WorkflowRFNode[] = [];
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      capturedNodes = typeof fn === 'function' ? fn([]) : fn;
      return capturedNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-v2'));
    const scenario = capturedNodes[0].data.scenario;
    expect(scenario.sourceRequestId).toBe('req-v2');
    expect(scenario.sourceSpecVersionId).toBe('sv-b');
    expect(scenario.sourceSpecVersionLabel).toBe('2.0.0');
  });

  it('handleAddFromRequest omits version fields for non-versioned request', () => {
    const opts = defaultOpts();
    opts.collections = [{
      id: 'col-1',
      requests: [{ id: 'req-plain', name: 'Plain', url: '/p', method: 'GET', headers: [], body: '', auth: { type: 'none' } }],
      folders: [],
    }];
    let capturedNodes: WorkflowRFNode[] = [];
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      capturedNodes = typeof fn === 'function' ? fn([]) : fn;
      return capturedNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleAddFromRequest('col-1', 'req-plain'));
    const scenario = capturedNodes[0].data.scenario;
    expect(scenario.sourceRequestId).toBe('req-plain');
    expect(scenario.sourceSpecVersionId).toBeUndefined();
    expect(scenario.sourceSpecVersionLabel).toBeUndefined();
  });

  it('handleUpdateNode with initialVariables AND other patch fields', () => {
    const opts = defaultOpts();
    opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
      const resultNodes = fn([{ id: 'n1', type: 'http', data: { label: 'Old' }, position: { x: 0, y: 0 } }]);
      opts.nodesRef.current = resultNodes;
      return resultNodes;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleUpdateNode('n1', { initialVariables: { token: 'x' }, label: 'Updated' }));
    expect(opts.nodeInitialVarsRef.current.n1).toEqual({ token: 'x' });
    expect(opts.setNodeInitialVars).toHaveBeenCalled();
    expect(opts.setNodes).toHaveBeenCalled();
  });

  it('handleUpdateNode initialVariables-only applies callback updater', () => {
    const opts = defaultOpts();
    let state: Record<string, Record<string, unknown>> = { old: { k: 'v' } };
    opts.setNodeInitialVars = vi.fn((fn: SetStateAction<Record<string, Record<string, unknown>>>) => {
      state = typeof fn === 'function' ? fn(state) : fn;
      return state;
    });
    const { result } = renderHook(() => useWorkflowNodeActions(opts));
    act(() => result.current.handleUpdateNode('n-iv', { initialVariables: { token: 'abc' } }));
    expect(state['n-iv']).toEqual({ token: 'abc' });
  });

  describe('handleExtractToSubWorkflow', () => {
    it('does nothing when selected is null', () => {
      const opts = defaultOpts();
      opts.selected = null;
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleExtractToSubWorkflow('n1'));
      expect(mockExtract).not.toHaveBeenCalled();
    });

    it('does nothing when prompt returns empty', () => {
      const opts = defaultOpts();
      vi.stubGlobal('prompt', vi.fn(() => ''));
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleExtractToSubWorkflow('n1'));
      expect(mockExtract).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('shows toast warning when extraction returns null', () => {
      const opts = defaultOpts();
      vi.stubGlobal('prompt', vi.fn(() => 'Sub WF'));
      mockExtract.mockReturnValue(null);
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleExtractToSubWorkflow('n1'));
      expect(mockExtract).toHaveBeenCalled();
      expect(opts.toast.show).toHaveBeenCalledWith('warning', 'Cannot extract', expect.any(String));
      vi.unstubAllGlobals();
    });

    it('performs full extraction when result is valid', () => {
      const opts = defaultOpts();
      vi.stubGlobal('prompt', vi.fn(() => 'Auth Sub'));

      const extractResult = {
        childWorkflow: {
          name: 'Auth Sub',
          nodes: [{ id: 'cn1', type: 'http', data: {}, position: { x: 0, y: 0 } }],
          edges: [],
          variables: { key: 'val' },
        },
        subWorkflowNode: {
          id: 'sw-1',
          type: 'subWorkflow',
          data: { label: 'Auth Sub', workflowId: '', workflowName: '' },
          position: { x: 0, y: 0 },
        },
        extractedNodeIds: new Set(['n1']),
        extractedEdgeIds: new Set(['e1']),
      };
      mockExtract.mockReturnValue(extractResult as ExtractResult);

      const createdWf: Workflow = { ...minimalWorkflow(), id: 'new-wf', name: 'Auth Sub' };
      opts.workflows = [createdWf];
      opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => (typeof fn === 'function' ? fn([
        { id: 'n1', type: 'http', data: { label: 'n1' } as WorkflowNodeData, position: { x: 0, y: 0 } },
        { id: 'n2', type: 'http', data: { label: 'n2' } as WorkflowNodeData, position: { x: 0, y: 100 } },
      ]) : fn));
      opts.setEdges = vi.fn((fn: SetStateAction<WorkflowRFEdge[]>) => (typeof fn === 'function' ? fn([
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ]) : fn));

      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleExtractToSubWorkflow('n1'));

      expect(opts.undoRedo.takeSnapshot).toHaveBeenCalledWith('Extract to sub-workflow');
      expect(opts.create).toHaveBeenCalledWith('Auth Sub');
      expect(opts.update).toHaveBeenCalledWith('new-wf', expect.objectContaining({
        nodes: extractResult.childWorkflow.nodes,
        edges: extractResult.childWorkflow.edges,
        variables: extractResult.childWorkflow.variables,
      }));
      expect(opts.toast.show).toHaveBeenCalledWith('success', 'Extracted', expect.stringContaining('Auth Sub'));

      vi.unstubAllGlobals();
    });

    it('handles extraction when created workflow not found', () => {
      const opts = defaultOpts();
      vi.stubGlobal('prompt', vi.fn(() => 'Missing WF'));

      const extractResult = {
        childWorkflow: { name: 'Missing WF', nodes: [], edges: [], variables: {} },
        subWorkflowNode: { id: 'sw-1', type: 'subWorkflow', data: { label: 'Missing WF' }, position: { x: 0, y: 0 } },
        extractedNodeIds: new Set(['n1']),
        extractedEdgeIds: new Set<string>(),
      };
      mockExtract.mockReturnValue(extractResult as ExtractResult);
      opts.workflows = [];

      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleExtractToSubWorkflow('n1'));

      expect(opts.create).toHaveBeenCalledWith('Missing WF');
      expect(opts.update).not.toHaveBeenCalled();
      expect(opts.toast.show).toHaveBeenCalledWith('success', 'Extracted', expect.any(String));

      vi.unstubAllGlobals();
    });
  });

  describe('auto-service from request', () => {
    const msEnvs: Environment[] = [
      { id: 'env-test', name: 'test' },
      { id: 'env-prod', name: 'prod' },
    ];
    const ms: Microservice = {
      id: 'ms-1', name: 'Trial Offer',
      baseUrls: { 'env-test': 'https://test.api.example.com', 'env-prod': 'https://prod.api.example.com' },
      authProfileIds: { 'env-test': 'auth-1' },
    };
    const authProfiles: GlobalAuthProfile[] = [
      { id: 'auth-1', name: 'OAuth TEST', auth: { type: 'oauth2', clientId: 'x', clientSecret: 's', tokenUrl: 'u' } },
    ];
    const colWithMs: RequestCollection = {
      id: 'col-1', name: 'Trial Offer', mode: 'multi-env', microserviceId: 'ms-1',
      auth: { type: 'bearer', token: 'fallback' },
      requests: [{ id: 'req-1', name: 'Get Offers', url: '/offers', method: 'GET' }],
      folders: [],
    };

    it('auto-creates service and sets serviceId on node', () => {
      const opts = defaultOpts();
      opts.collections = [colWithMs];
      opts.environments = msEnvs;
      opts.microservices = [ms];
      opts.globalAuthProfiles = authProfiles;
      opts.workflowServices = [];
      const setWfSvc = vi.fn((fn: SetStateAction<WorkflowService[]>) => {
        if (typeof fn === 'function') fn([]);
      });
      opts.setWorkflowServices = setWfSvc;
      opts.workflowServicesRef = makeRef([] as WorkflowService[]);
      let capturedNodes: WorkflowRFNode[] = [];
      opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
        capturedNodes = typeof fn === 'function' ? fn([]) : fn;
        return capturedNodes;
      });
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleAddFromRequest('col-1', 'req-1'));

      expect(setWfSvc).toHaveBeenCalled();
      expect(opts.workflowServicesRef!.current).toHaveLength(1);
      expect(capturedNodes).toHaveLength(1);
      const nodeData = capturedNodes[0].data as HttpNodeData;
      expect(nodeData.serviceId).toBe('mock-uuid');
      expect(nodeData.scenario.auth.type).toBe('inherit');
    });

    it('strips base URL from absolute request URL when auto-binding service', () => {
      const opts = defaultOpts();
      const colAbsUrl: RequestCollection = {
        ...colWithMs,
        requests: [{ id: 'req-abs', name: 'Absolute', url: 'https://test.api.example.com/sales/offers', method: 'GET' }],
      };
      opts.collections = [colAbsUrl];
      opts.environments = msEnvs;
      opts.microservices = [ms];
      opts.globalAuthProfiles = authProfiles;
      opts.workflowServices = [];
      opts.selectedEnvId = 'env-test';
      const setWfSvc = vi.fn((fn: SetStateAction<WorkflowService[]>) => {
        if (typeof fn === 'function') fn([]);
      });
      opts.setWorkflowServices = setWfSvc;
      let capturedNodes: WorkflowRFNode[] = [];
      opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
        capturedNodes = typeof fn === 'function' ? fn([]) : fn;
        return capturedNodes;
      });
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleAddFromRequest('col-1', 'req-abs'));

      expect(capturedNodes).toHaveLength(1);
      const nodeData = capturedNodes[0].data as HttpNodeData;
      expect(nodeData.serviceId).toBe('mock-uuid');
      expect(nodeData.scenario.url).toBe('/sales/offers');
    });

    it('reuses existing service when microserviceId matches', () => {
      const opts = defaultOpts();
      opts.collections = [colWithMs];
      opts.environments = msEnvs;
      opts.microservices = [ms];
      opts.globalAuthProfiles = authProfiles;
      opts.workflowServices = [{ id: 'existing-svc', name: 'Trial Offer', endpoints: [], microserviceId: 'ms-1' }];
      const setWfSvc = vi.fn();
      opts.setWorkflowServices = setWfSvc;
      let capturedNodes: WorkflowRFNode[] = [];
      opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
        capturedNodes = typeof fn === 'function' ? fn([]) : fn;
        return capturedNodes;
      });
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleAddFromRequest('col-1', 'req-1'));

      expect(setWfSvc).not.toHaveBeenCalled();
      const nodeData = capturedNodes[0].data as HttpNodeData;
      expect(nodeData.serviceId).toBe('existing-svc');
    });

    it('falls back to hostPatch when collection has no microservice', () => {
      const opts = defaultOpts();
      const colNoMs: RequestCollection = {
        id: 'col-2', name: 'Ad Hoc', mode: 'direct',
        requests: [{ id: 'req-2', name: 'Ping', url: 'http://localhost/ping', method: 'GET' }],
        folders: [],
      };
      opts.collections = [colNoMs];
      opts.setWorkflowServices = vi.fn();
      let capturedNodes: WorkflowRFNode[] = [];
      opts.setNodes = vi.fn((fn: SetStateAction<WorkflowRFNode[]>) => {
        capturedNodes = typeof fn === 'function' ? fn([]) : fn;
        return capturedNodes;
      });
      const { result } = renderHook(() => useWorkflowNodeActions(opts));
      act(() => result.current.handleAddFromRequest('col-2', 'req-2'));

      expect(opts.setWorkflowServices).not.toHaveBeenCalled();
      const nodeData = capturedNodes[0].data as HttpNodeData;
      expect(nodeData.serviceId).toBeUndefined();
    });
  });
});

describe('buildServiceFromCollection', () => {
  const envs: Environment[] = [
    { id: 'env-test', name: 'test' },
    { id: 'env-prod', name: 'prod' },
  ];
  const ms: Microservice = {
    id: 'ms-1', name: 'Trial Offer',
    baseUrls: { 'env-test': 'https://test.example.com', 'env-prod': '' },
    authProfileIds: { 'env-test': 'auth-1' },
  };
  const authProfiles: GlobalAuthProfile[] = [
    { id: 'auth-1', name: 'OAuth TEST', auth: { type: 'oauth2', clientId: 'c', clientSecret: 's', tokenUrl: 'u' } },
  ];

  it('returns undefined when collection has no microserviceId', () => {
    const col: RequestCollection = { id: 'c1', name: 'X', mode: 'direct', requests: [], folders: [] };
    expect(buildServiceFromCollection(col, [ms], envs, authProfiles, [])).toBeUndefined();
  });

  it('returns undefined when microservice not found', () => {
    const col: RequestCollection = { id: 'c1', name: 'X', mode: 'multi-env', microserviceId: 'missing', requests: [], folders: [] };
    expect(buildServiceFromCollection(col, [ms], envs, authProfiles, [])).toBeUndefined();
  });

  it('returns existing service when microserviceId already bound', () => {
    const col: RequestCollection = { id: 'c1', name: 'X', mode: 'multi-env', microserviceId: 'ms-1', requests: [], folders: [] };
    const existing = { id: 'svc-existing', name: 'Trial Offer', endpoints: [], microserviceId: 'ms-1' };
    const result = buildServiceFromCollection(col, [ms], envs, authProfiles, [existing]);
    expect(result).toBe(existing);
  });

  it('creates a new service with endpoints from microservice', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'X', mode: 'multi-env', microserviceId: 'ms-1',
      auth: { type: 'bearer', token: 'default' },
      requests: [], folders: [],
    };
    const result = buildServiceFromCollection(col, [ms], envs, authProfiles, []);
    expect(result).toBeDefined();
    expect(result!.name).toBe('Trial Offer');
    expect(result!.microserviceId).toBe('ms-1');
    expect(result!.endpoints).toHaveLength(2);

    const t01Ep = result!.endpoints.find(ep => ep.envId === 'env-test')!;
    expect(t01Ep.url).toBe('https://test.example.com');
    expect(t01Ep.enabled).toBe(true);
    expect(t01Ep.authMode).toBe('custom');
    expect(t01Ep.source).toBe('microservice');

    const p01Ep = result!.endpoints.find(ep => ep.envId === 'env-prod')!;
    expect(p01Ep.url).toBe('');
    expect(p01Ep.enabled).toBe(false);
    expect(p01Ep.authMode).toBe('inherit');

    expect(result!.defaultAuth).toEqual({ type: 'bearer', token: 'default' });
  });

  it('omits defaultAuth when collection auth is none', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'X', mode: 'multi-env', microserviceId: 'ms-1',
      auth: { type: 'none' },
      requests: [], folders: [],
    };
    const result = buildServiceFromCollection(col, [ms], envs, authProfiles, []);
    expect(result!.defaultAuth).toBeUndefined();
  });

  it('includes customEnvs from microservice when building endpoints', () => {
    const msWithCustom: Microservice = {
      ...ms,
      customEnvs: [{ id: 'env-custom', name: 'Custom Env' }],
      baseUrls: { ...ms.baseUrls, 'env-custom': 'https://custom.example.com' },
    };
    const col: RequestCollection = {
      id: 'c1', name: 'X', mode: 'multi-env', microserviceId: 'ms-1',
      requests: [], folders: [],
    };
    const result = buildServiceFromCollection(col, [msWithCustom], envs, authProfiles, []);
    expect(result!.endpoints).toHaveLength(3);
    const customEp = result!.endpoints.find(ep => ep.envId === 'env-custom');
    expect(customEp?.url).toBe('https://custom.example.com');
    expect(customEp?.enabled).toBe(true);
  });
});
