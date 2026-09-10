/** @vitest-environment jsdom */

import '@testing-library/jest-dom';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestCollection } from '@shared/types';
import {
  parseSidebarDrag,
  serializeSidebarDrag,
  SIDEBAR_DRAG_MIME,
  useRequestsSidebarDnD,
} from './useRequestsSidebarDnD';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeDataTransfer() {
  const store: Record<string, string> = {};
  const dt = {
    effectAllowed: '',
    dropEffect: '',
    types: [] as string[],
    setData: vi.fn((type: string, val: string) => {
      store[type] = val;
      if (!dt.types.includes(type)) dt.types.push(type);
    }),
    getData: vi.fn((type: string) => store[type] ?? ''),
  };
  return dt;
}

function evt(partial?: Partial<React.DragEvent>): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: makeDataTransfer() as unknown as DataTransfer,
    ...partial,
  } as React.DragEvent;
}

describe('useRequestsSidebarDnD', () => {
  it('tracks drag lifecycle and clears refs on drag end clearing timers', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD(makeParams()));

    const e = evt();
    act(() => result.current.handleReqDragStart(e, 'c1', 'r1'));
    expect(result.current.dragItem).toEqual({ kind: 'request', reqId: 'r1', colId: 'c1' });

    result.current.autoExpandTimerRef.current = 1 as unknown as ReturnType<typeof setTimeout>;

    act(() => result.current.handleDragEnd());

    expect(result.current.dragItem).toBeNull();
    expect(result.current.dropTarget).toBeNull();
    expect(result.current.dropInsert).toBeNull();
    expect(result.current.autoExpandTimerRef.current).toBeNull();
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current.lastDragRef.current).toBeNull();
    vi.useRealTimers();
  });

  it('collection drop on non-group merges; on group calls onMoveToGroup', () => {
    const onMergeCollectionInto = vi.fn();
    const onMoveToGroup = vi.fn();
    const collections: RequestCollection[] = [
      { id: 'a', name: 'A', mode: 'direct', requests: [] },
      { id: 'b', name: 'B', mode: 'group', requests: [] },
    ];

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), collections, onMergeCollectionInto, onMoveToGroup }));

    const start = evt();
    act(() => result.current.handleCollectionDragStart(start, 'a'));

    const drop = evt();
    act(() => result.current.handleDrop(drop, 'b', null));

    expect(onMoveToGroup).toHaveBeenCalledWith('a', 'b');
    expect(onMergeCollectionInto).not.toHaveBeenCalled();
  });

  it('collection drop on direct collection merges when ids differ', () => {
    const onMergeCollectionInto = vi.fn();
    const collections: RequestCollection[] = [
      { id: 'a', name: 'A', mode: 'direct', requests: [] },
      { id: 'c', name: 'C', mode: 'direct', requests: [] },
    ];

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), collections, onMergeCollectionInto }));

    act(() => result.current.handleCollectionDragStart(evt(), 'a'));
    act(() => result.current.handleDrop(evt(), 'c', null));

    expect(onMergeCollectionInto).toHaveBeenCalledWith('a', 'c');
  });

  it('request drop same collection vs cross collection', () => {
    const onMoveRequest = vi.fn();
    const onMoveRequestToCollection = vi.fn();

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequest, onMoveRequestToCollection }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDrop(evt(), 'c1', 'f1'));
    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'r1', 'f1');

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDrop(evt(), 'c2', null));
    expect(onMoveRequestToCollection).toHaveBeenCalledWith('c1', 'r1', 'c2', null);
  });

  it('folder drop to root same collection vs cross collection', () => {
    const onMoveFolderTo = vi.fn();
    const onMoveFolderToCollection = vi.fn();

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveFolderTo, onMoveFolderToCollection }));

    act(() => result.current.handleFolderDragStart(evt(), 'c1', 'f1'));
    act(() => result.current.handleDrop(evt(), 'c1', null));
    expect(onMoveFolderTo).toHaveBeenCalledWith('c1', 'f1', null);

    act(() => result.current.handleFolderDragStart(evt(), 'c1', 'f1'));
    act(() => result.current.handleDrop(evt(), 'c2', 'f2'));
    expect(onMoveFolderToCollection).toHaveBeenCalledWith('c1', 'f1', 'c2', 'f2');
  });

  it('handleGroupDrop moves collection into group', () => {
    const onMoveToGroup = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveToGroup }));

    act(() => result.current.handleCollectionDragStart(evt(), 'colA'));
    act(() => result.current.handleGroupDrop(evt(), 'grp1'));

    expect(onMoveToGroup).toHaveBeenCalledWith('colA', 'grp1');
  });

  it('handleFolderDrop moves request and folder with guard on same folder', () => {
    const onMoveRequest = vi.fn();
    const onMoveFolderTo = vi.fn();

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequest, onMoveFolderTo }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleFolderDrop(evt(), 'c1', 'f9'));
    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'r1', 'f9');

    act(() => result.current.handleFolderDragStart(evt(), 'c1', 'f1'));
    act(() => result.current.handleFolderDrop(evt(), 'c1', 'f1'));
    expect(onMoveFolderTo).not.toHaveBeenCalled();
  });

  it('handleReqDragOver sets before vs after insertion marker', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'drag-me'));

    const above = evt({
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 40 }),
      } as unknown as HTMLElement,
      clientY: 110,
    });
    act(() => result.current.handleReqDragOver(above, 'c1', 'r2', 'fx'));
    expect(result.current.dropInsert).toEqual({ beforeReqId: 'r2', folderId: 'fx' });

    const below = evt({
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 40 }),
      } as unknown as HTMLElement,
      clientY: 130,
    });
    act(() => result.current.handleReqDragOver(below, 'c1', 'r2', 'fx'));
    expect(result.current.dropInsert).toEqual({ beforeReqId: 'r2:after', folderId: 'fx' });
  });

  it('handleReqDrop uses insertion order before and after placeholders', () => {
    const onMoveRequest = vi.fn();
    const requests = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'moving'));
    act(() => {
      result.current.setDropInsert({ beforeReqId: 'r2:after', folderId: 'froot' });
    });
    act(() => result.current.handleReqDrop(evt(), 'c1', 'froot', requests));

    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'moving', 'froot', 'r3');
  });

  it('handleRootDrop clears grouped collection assignment', () => {
    const collections: RequestCollection[] = [
      { id: 'gcol', name: 'G', mode: 'direct', requests: [], groupId: 'g1' },
    ];
    const onMoveToGroup = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), collections, onMoveToGroup }));

    act(() => result.current.handleCollectionDragStart(evt(), 'gcol'));
    act(() => result.current.handleRootDrop(evt()));

    expect(onMoveToGroup).toHaveBeenCalledWith('gcol', undefined);
  });

  it('handleRootDrop ignores collections without groupId', () => {
    const collections: RequestCollection[] = [{ id: 'plain', name: 'P', mode: 'direct', requests: [] }];
    const onMoveToGroup = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), collections, onMoveToGroup }));

    act(() => result.current.handleCollectionDragStart(evt(), 'plain'));
    act(() => result.current.handleRootDrop(evt()));
    expect(onMoveToGroup).not.toHaveBeenCalled();
    expect(result.current.dragItem).toBeNull();
  });

  it('handleGroupDrop ignores dragged requests', () => {
    const onMoveToGroup = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveToGroup }));
    act(() => result.current.handleReqDragStart(evt(), 'cx', 'r1'));
    act(() => result.current.handleGroupDrop(evt(), 'grp1'));
    expect(onMoveToGroup).not.toHaveBeenCalled();
    expect(result.current.dragItem).toBeNull();
  });

  it('handleReqDragOver maps undefined folder buckets to null', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'drag'));
    act(() =>
      result.current.handleReqDragOver(
        evt({
          currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 10 }) } as unknown as HTMLElement,
          clientY: 4,
        }),
        'c1',
        'r-anchor',
        undefined,
      ),
    );
    expect(result.current.dropInsert).toEqual({ beforeReqId: 'r-anchor', folderId: null });
  });

  it('handleReqDrop honors before markers within the same collection', () => {
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'move'));
    act(() => {
      result.current.setDropInsert({ beforeReqId: 'r2', folderId: 'fold' });
    });
    act(() =>
      result.current.handleReqDrop(evt(), 'c1', 'fold', [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]),
    );
    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'move', 'fold', 'r2');
  });

  it('relocates sibling folders inside the same collection', () => {
    const onMoveFolderTo = vi.fn();
    const innerB = {
      id: 'inner-b',
      name: 'B',
      requests: [],
      folders: [{ id: 'leaf', name: 'L', folders: [], requests: [] }],
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const col: RequestCollection = {
      id: 'c-shared',
      name: 'Shared',
      mode: 'direct',
      requests: [],
      folders: [
        { id: 'outer-a', name: 'A', requests: [], folders: [innerB] },
      ],
    };

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveFolderTo }));

    act(() => result.current.handleFolderDragStart(evt(), 'c-shared', 'leaf'));
    act(() => result.current.handleFolderDrop(evt(), 'c-shared', 'inner-b'));

    expect(onMoveFolderTo).toHaveBeenCalledWith('c-shared', 'leaf', 'inner-b');
  });

  it('handleReqDrop allows trailing insertion after the final row', () => {
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'move'));
    act(() => {
      result.current.setDropInsert({ beforeReqId: 'r2:after', folderId: null });
    });
    act(() => result.current.handleReqDrop(evt(), 'c1', undefined, [{ id: 'r1' }, { id: 'r2' }]));
    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'move', null, undefined);
  });

  it('handleDragOver no-ops without active drag item', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));

    act(() => {
      result.current.handleDragOver(evt(), 'tgt');
    });

    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDragOver sets drop target whenever drag snapshot exists', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'cx', 'rx'));

    const e = evt();
    act(() => result.current.handleDragOver(e, 'drop-zone'));

    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.dropTarget).toBe('drop-zone');
    act(() => result.current.handleDragLeave());
    expect(result.current.dropTarget).toBeNull();
  });

  it('handleReqDragOver skips when hovering the dragged row', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'cx', 'same'));

    const e = evt({
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) } as unknown as HTMLElement,
      clientY: 10,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    act(() => result.current.handleReqDragOver(e, 'cx', 'same', undefined));
    expect(result.current.dropInsert).toBeNull();

    act(() => result.current.handleReqDragStart(evt(), 'cx', 'other'));

    act(() =>
      result.current.handleReqDragOver(
        { ...e, preventDefault: vi.fn(), stopPropagation: vi.fn() },
        'cx',
        'same',
        undefined,
      ),
    );

    expect(result.current.dropInsert).not.toBeNull();
  });

  it('handleReqDrop without ordering hint uses folder fallback', () => {
    const onMoveRequest = vi.fn();
    const onMoveRequestToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequest, onMoveRequestToCollection }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'move'));
    act(() => result.current.handleReqDrop(evt(), 'c1', 'subf', [{ id: 'a' }]));

    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'move', 'subf');
  });

  it('handleReqDrop without insert moves across collections', () => {
    const onMoveRequestToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequestToCollection }));

    act(() => result.current.handleReqDragStart(evt(), 'c-src', 'floating'));
    act(() => result.current.handleReqDrop(evt(), 'c-dst', undefined, [{ id: 'z' }]));

    expect(onMoveRequestToCollection).toHaveBeenCalledWith('c-src', 'floating', 'c-dst', null);
  });

  it('relocates folders across collections toward nested anchors', () => {
    const onMoveFolderToCollection = vi.fn();
    const foldersA = [{ id: 'move-me', name: 'M', folders: [], requests: [] }];
    const colA: RequestCollection = { id: 'col-a', name: 'A', mode: 'direct', requests: [], folders: foldersA };
    const colB: RequestCollection = {
      id: 'col-b',
      name: 'B',
      mode: 'direct',
      requests: [],
      folders: [{ id: 'dest', name: 'D', folders: [], requests: [] }],
    };

    const { result } = renderHook(() =>
      useRequestsSidebarDnD({
        ...makeParams(),
        collections: [colA, colB],
        onMoveFolderToCollection,
      }));

    act(() => result.current.handleFolderDragStart(evt(), 'col-a', 'move-me'));
    act(() => result.current.handleFolderDrop(evt(), 'col-b', 'dest'));

    expect(onMoveFolderToCollection).toHaveBeenCalledWith('col-a', 'move-me', 'col-b', 'dest');
  });

  it('drops requests onto foreign folder targets via request-to-collection mover', () => {
    const onMoveRequestToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({
        ...makeParams(),
        onMoveRequestToCollection,
      }));

    act(() => result.current.handleReqDragStart(evt(), 'col-a', 'req-x'));
    act(() => result.current.handleFolderDrop(evt(), 'col-b', 'fdest'));

    expect(onMoveRequestToCollection).toHaveBeenCalledWith('col-a', 'req-x', 'col-b', 'fdest');
  });

  it('folder drop on same collection with explicit folder target is ignored', () => {
    const onMoveFolderTo = vi.fn();
    const onMoveFolderToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({
        ...makeParams(),
        onMoveFolderTo,
        onMoveFolderToCollection,
      }));

    act(() => result.current.handleFolderDragStart(evt(), 'c1', 'fx'));
    act(() => result.current.handleDrop(evt(), 'c1', 'nested'));

    expect(onMoveFolderTo).not.toHaveBeenCalled();
    expect(onMoveFolderToCollection).not.toHaveBeenCalled();
  });

  it('collection drop onto same id does not merge or regroup', () => {
    const onMergeCollectionInto = vi.fn();
    const onMoveToGroup = vi.fn();
    const collections: RequestCollection[] = [
      { id: 'same', name: 'S', mode: 'direct', requests: [] },
    ];
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({
        ...makeParams(),
        collections,
        onMergeCollectionInto,
        onMoveToGroup,
      }));

    act(() => result.current.handleCollectionDragStart(evt(), 'same'));
    act(() => result.current.handleDrop(evt(), 'same', null));

    expect(onMergeCollectionInto).not.toHaveBeenCalled();
    expect(onMoveToGroup).not.toHaveBeenCalled();
  });

  it('group drop ignores identical collection id', () => {
    const onMoveToGroup = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveToGroup }));

    act(() => result.current.handleCollectionDragStart(evt(), 'grp'));
    act(() => result.current.handleGroupDrop(evt(), 'grp'));

    expect(onMoveToGroup).not.toHaveBeenCalled();
  });

  it('handleReqDrop with insert hint uses cross-collection mover when source differs', () => {
    const onMoveRequestToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequestToCollection }));

    act(() => result.current.handleReqDragStart(evt(), 'c-a', 'drag'));
    act(() => {
      result.current.setDropInsert({ beforeReqId: 'r2', folderId: 'sub' });
    });
    act(() => result.current.handleReqDrop(evt(), 'c-b', 'sub', [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]));

    expect(onMoveRequestToCollection).toHaveBeenCalledWith('c-a', 'drag', 'c-b', 'sub');
  });

  it('handleReqDrop with stale insert anchors falls back to folder placement', () => {
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'mv'));
    act(() => {
      result.current.setDropInsert({ beforeReqId: 'ghost', folderId: null });
    });
    act(() => result.current.handleReqDrop(evt(), 'c1', undefined, [{ id: 'stay' }]));

    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'mv', null, undefined);
  });

  it('root drop returns grouped collections back to the unfiled rack', () => {
    const onMoveToGroup = vi.fn();
    const collections: RequestCollection[] = [
      { id: 'cg', name: 'Grouped', mode: 'direct', requests: [], groupId: 'grp' },
    ];
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), collections, onMoveToGroup }));

    act(() => result.current.handleCollectionDragStart(evt(), 'cg'));
    act(() => result.current.handleRootDrop(evt()));

    expect(onMoveToGroup).toHaveBeenCalledWith('cg', undefined);
  });

  it('root drop skips collections that are not anchored to a sidebar group', () => {
    const onMoveToGroup = vi.fn();
    const collections: RequestCollection[] = [
      { id: 'solo', name: 'Solo', mode: 'direct', requests: [] },
    ];
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), collections, onMoveToGroup }));

    act(() => result.current.handleCollectionDragStart(evt(), 'solo'));
    act(() => result.current.handleRootDrop(evt()));

    expect(onMoveToGroup).not.toHaveBeenCalled();
  });

  it('root drop ignores drags that originate from request rows', () => {
    const onMoveToGroup = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveToGroup }));

    act(() => result.current.handleReqDragStart(evt(), 'c-x', 'rq'));
    act(() => result.current.handleRootDrop(evt()));

    expect(onMoveToGroup).not.toHaveBeenCalled();
  });

  it('req drag-hover ignores events until a draggable request snapshot exists', () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));

    act(() =>
      result.current.handleReqDragOver(
        {
          preventDefault,
          stopPropagation: vi.fn(),
          dataTransfer: { dropEffect: '' } as DataTransfer,
          currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) } as HTMLElement,
          clientY: 5,
        } as unknown as React.DragEvent,
        'c',
        'r1',
        'f',
      ),
    );

    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.dropInsert).toBeNull();
  });

  it('req drag-hover bails early when hovering the originating row id', () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));

    act(() => result.current.handleReqDragStart(evt(), 'col', 'r1'));

    act(() =>
      result.current.handleReqDragOver(
        {
          preventDefault,
          stopPropagation: vi.fn(),
          dataTransfer: { dropEffect: '' } as DataTransfer,
          currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) } as HTMLElement,
          clientY: 10,
        } as unknown as React.DragEvent,
        'col',
        'r1',
        undefined,
      ),
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('collection drag-hover no-ops while nothing is tracked in the sidebar drag buffer', () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));

    act(() =>
      result.current.handleDragOver(
        { preventDefault, dataTransfer: { dropEffect: '' } as DataTransfer } as unknown as React.DragEvent,
        'tgt',
      ),
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores drops when no drag payload is registered', () => {
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));
    act(() => result.current.handleDrop(evt(), 'c1', null));
    expect(onMoveRequest).not.toHaveBeenCalled();
  });

  it('ignores request slot drops until a request drag begins', () => {
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));
    act(() => result.current.handleReqDrop(evt(), 'c1', null, [{ id: 'r1' }]));
    expect(onMoveRequest).not.toHaveBeenCalled();
  });

  it('serializes and parses sidebar drag payloads', () => {
    expect(parseSidebarDrag(serializeSidebarDrag({ kind: 'request', colId: 'c1', reqId: 'r1' })))
      .toEqual({ kind: 'request', colId: 'c1', reqId: 'r1' });
    expect(parseSidebarDrag(serializeSidebarDrag({ kind: 'folder', colId: 'c1', folderId: 'f1' })))
      .toEqual({ kind: 'folder', colId: 'c1', folderId: 'f1' });
    expect(parseSidebarDrag(serializeSidebarDrag({ kind: 'collection', colId: 'c1' })))
      .toEqual({ kind: 'collection', colId: 'c1' });
    expect(parseSidebarDrag('plain-id')).toBeNull();
    expect(parseSidebarDrag('rff-sidebar:unknown:x')).toBeNull();
    expect(parseSidebarDrag('rff-sidebar:nocolon')).toBeNull();
    expect(parseSidebarDrag('rff-sidebar:collection:')).toBeNull();
    expect(parseSidebarDrag('rff-sidebar:request:col:')).toBeNull();
    expect(parseSidebarDrag('rff-sidebar:widget:c1:id1')).toBeNull();
  });

  it('blocks folder drag-start while a request drag is in progress', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    const folderStart = evt();
    act(() => result.current.handleFolderDragStart(folderStart, 'c1', 'f1'));
    expect(folderStart.preventDefault).toHaveBeenCalled();
    expect(result.current.dragItem).toEqual({ kind: 'request', reqId: 'r1', colId: 'c1' });
  });

  it('blocks folder drag-start from last-drag after dragend', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDragEnd());
    const folderStart = evt();
    act(() => result.current.handleFolderDragStart(folderStart, 'c1', 'f1'));
    expect(folderStart.preventDefault).toHaveBeenCalled();
  });

  it('clears a pending last-drag timer when a new drag starts', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDragEnd());
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r2'));
    expect(result.current.dragItem).toEqual({ kind: 'request', reqId: 'r2', colId: 'c1' });
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current.lastDragRef.current).toEqual({ kind: 'request', reqId: 'r2', colId: 'c1' });
    vi.useRealTimers();
  });

  it('replaces a pending last-drag timer on a second dragend', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDragEnd());
    act(() => result.current.handleDragEnd());
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current.lastDragRef.current).toBeNull();
    vi.useRealTimers();
  });

  it('clears drag timers on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useRequestsSidebarDnD(makeParams()));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDragEnd());
    result.current.autoExpandTimerRef.current = setTimeout(() => { /* cleanup target */ }, 5000);
    unmount();
    vi.useRealTimers();
  });

  it('group and folder drops no-op when nothing is being dragged', () => {
    const onMoveToGroup = vi.fn();
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveToGroup, onMoveRequest }));
    act(() => result.current.handleGroupDrop(evt(), 'g1'));
    act(() => result.current.handleFolderDrop(evt(), 'c1', 'f1'));
    expect(onMoveToGroup).not.toHaveBeenCalled();
    expect(onMoveRequest).not.toHaveBeenCalled();
  });

  it('request drop without insert marker moves across collections', () => {
    const onMoveRequestToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequestToCollection }));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleReqDrop(evt(), 'c2', 'f9', [{ id: 'r9' }]));
    expect(onMoveRequestToCollection).toHaveBeenCalledWith('c1', 'r1', 'c2', 'f9');
  });

  it('request drop with insert marker moves across collections', () => {
    const onMoveRequestToCollection = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveRequestToCollection }));
    act(() => result.current.handleReqDragStart(evt(), 'c1', 'moving'));
    act(() => { result.current.setDropInsert({ beforeReqId: 'r2', folderId: 'froot' }); });
    act(() => result.current.handleReqDrop(evt(), 'c2', 'froot', [{ id: 'r2' }]));
    expect(onMoveRequestToCollection).toHaveBeenCalledWith('c1', 'moving', 'c2', 'froot');
  });

  it('folder drop still moves after dragend cleared the in-memory item (WKWebView order)', () => {
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDragEnd());
    expect(result.current.dragItem).toBeNull();

    act(() => result.current.handleFolderDrop(evt(), 'c1', 't01'));
    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'r1', 't01');
  });

  it('folder drop reads the persisted payload after last-drag expiry', () => {
    vi.useFakeTimers();
    const onMoveRequest = vi.fn();
    const { result } = renderHook(() => useRequestsSidebarDnD({ ...makeParams(), onMoveRequest }));

    const start = evt();
    act(() => result.current.handleReqDragStart(start, 'c1', 'r1'));
    expect(start.dataTransfer.setData).toHaveBeenCalledWith(
      SIDEBAR_DRAG_MIME,
      'rff-sidebar:request:c1:r1',
    );

    act(() => result.current.handleDragEnd());
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current.lastDragRef.current).toBeNull();

    const drop = evt({ dataTransfer: start.dataTransfer });
    act(() => result.current.handleFolderDrop(drop, 'c1', 't01'));
    expect(onMoveRequest).toHaveBeenCalledWith('c1', 'r1', 't01');
    vi.useRealTimers();
  });

  it('dragover still preventDefault after dragend so WKWebView can fire drop', () => {
    const { result } = renderHook(() => useRequestsSidebarDnD(makeParams()));

    act(() => result.current.handleReqDragStart(evt(), 'c1', 'r1'));
    act(() => result.current.handleDragEnd());

    const over = evt();
    act(() => result.current.handleDragOver(over, 't01'));
    expect(over.preventDefault).toHaveBeenCalled();
    expect(result.current.dropTarget).toBe('t01');
  });

  it('folder drop ignores reposition requests when the hovered folder equals the dragged folder id', () => {
    const onMoveFolderTo = vi.fn();
    const { result } = renderHook(() =>
      useRequestsSidebarDnD({ ...makeParams(), onMoveFolderTo }));

    act(() => result.current.handleFolderDragStart(evt(), 'col', 'f1'));

    act(() => result.current.handleFolderDrop(evt(), 'col', 'f1'));

    expect(onMoveFolderTo).not.toHaveBeenCalled();
    expect(result.current.dragItem).toBeNull();
  });
});

function makeParams(): Parameters<typeof useRequestsSidebarDnD>[0] {
  return {
    collections: [],
    onMoveRequest: vi.fn(),
    onMoveRequestToCollection: vi.fn(),
    onMoveFolderTo: vi.fn(),
    onMoveFolderToCollection: vi.fn(),
    onMergeCollectionInto: vi.fn(),
    onMoveToGroup: vi.fn(),
  };
}
