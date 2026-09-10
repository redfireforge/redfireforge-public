import { useState, useCallback, useEffect, useRef } from 'react';
import type { RequestCollection } from '@shared/types';

export type DragItem =
  | { kind: 'request'; reqId: string; colId: string }
  | { kind: 'folder'; folderId: string; colId: string }
  | { kind: 'collection'; colId: string }
  | null;

/** Custom MIME — WKWebView may omit this from `types` during dragover. */
export const SIDEBAR_DRAG_MIME = 'application/x-rff-sidebar';
const SIDEBAR_DRAG_PREFIX = 'rff-sidebar:';

export function serializeSidebarDrag(item: NonNullable<DragItem>): string {
  if (item.kind === 'request') return `${SIDEBAR_DRAG_PREFIX}request:${item.colId}:${item.reqId}`;
  if (item.kind === 'folder') return `${SIDEBAR_DRAG_PREFIX}folder:${item.colId}:${item.folderId}`;
  return `${SIDEBAR_DRAG_PREFIX}collection:${item.colId}`;
}

export function parseSidebarDrag(raw: string | undefined | null): NonNullable<DragItem> | null {
  if (!raw || !raw.startsWith(SIDEBAR_DRAG_PREFIX)) return null;
  const rest = raw.slice(SIDEBAR_DRAG_PREFIX.length);
  const kindEnd = rest.indexOf(':');
  if (kindEnd < 0) return null;
  const kind = rest.slice(0, kindEnd);
  const afterKind = rest.slice(kindEnd + 1);
  if (kind === 'collection') {
    return afterKind ? { kind: 'collection', colId: afterKind } : null;
  }
  const colEnd = afterKind.indexOf(':');
  if (colEnd < 0) return null;
  const colId = afterKind.slice(0, colEnd);
  const id = afterKind.slice(colEnd + 1);
  if (!colId || !id) return null;
  if (kind === 'request') return { kind: 'request', colId, reqId: id };
  if (kind === 'folder') return { kind: 'folder', colId, folderId: id };
  return null;
}

function readTransferPayload(e: React.DragEvent): string {
  try {
    return e.dataTransfer.getData(SIDEBAR_DRAG_MIME) || e.dataTransfer.getData('text/plain') || '';
  } catch {
    return '';
  }
}

function writeSidebarDrag(e: React.DragEvent, item: NonNullable<DragItem>) {
  e.dataTransfer.effectAllowed = 'move';
  const payload = serializeSidebarDrag(item);
  try {
    e.dataTransfer.setData(SIDEBAR_DRAG_MIME, payload);
  } catch {
    /* some WebViews reject custom MIME types */
  }
  e.dataTransfer.setData('text/plain', payload);
}

type OnMoveRequest = (colId: string, reqId: string, targetFolderId: string | null, beforeReqId?: string) => void;
type OnMoveRequestToCollection = (
  srcColId: string,
  reqId: string,
  destColId: string,
  destFolderId: string | null,
) => void;
type OnMoveFolderTo = (colId: string, folderId: string, targetParentFolderId: string | null) => void;
type OnMoveFolderToCollection = (
  srcColId: string,
  folderId: string,
  destColId: string,
  destParentFolderId: string | null,
) => void;
type OnMergeCollectionInto = (srcColId: string, destColId: string) => void;
type OnMoveToGroup = (colId: string, targetGroupId: string | undefined) => void;

export interface UseRequestsSidebarDnDParams {
  collections: RequestCollection[];
  onMoveRequest: OnMoveRequest;
  onMoveRequestToCollection: OnMoveRequestToCollection;
  onMoveFolderTo: OnMoveFolderTo;
  onMoveFolderToCollection: OnMoveFolderToCollection;
  onMergeCollectionInto: OnMergeCollectionInto;
  onMoveToGroup: OnMoveToGroup;
}

export function useRequestsSidebarDnD({
  collections,
  onMoveRequest,
  onMoveRequestToCollection,
  onMoveFolderTo,
  onMoveFolderToCollection,
  onMergeCollectionInto,
  onMoveToGroup,
}: UseRequestsSidebarDnDParams) {
  const [dragItem, _setDragItem] = useState<DragItem>(null);
  const dragItemRef = useRef<DragItem>(null);
  /** Survives WKWebView `dragend`-before-`drop` so the drop can still resolve. */
  const lastDragRef = useRef<DragItem>(null);
  const lastDragClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDragItem = useCallback((v: DragItem) => {
    dragItemRef.current = v;
    if (v) {
      lastDragRef.current = v;
      if (lastDragClearTimerRef.current) {
        clearTimeout(lastDragClearTimerRef.current);
        lastDragClearTimerRef.current = null;
      }
    }
    _setDragItem(v);
  }, []);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropInsert, setDropInsert] = useState<{ beforeReqId: string; folderId: string | null } | null>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveDragItem = useCallback((e?: React.DragEvent): DragItem => {
    if (dragItemRef.current) return dragItemRef.current;
    if (e) {
      const parsed = parseSidebarDrag(readTransferPayload(e));
      if (parsed) return parsed;
    }
    return lastDragRef.current;
  }, []);

  const finishDrag = useCallback(() => {
    lastDragRef.current = null;
    if (lastDragClearTimerRef.current) {
      clearTimeout(lastDragClearTimerRef.current);
      lastDragClearTimerRef.current = null;
    }
    setDragItem(null);
    setDropTarget(null);
    setDropInsert(null);
  }, [setDragItem]);

  useEffect(() => () => {
    if (lastDragClearTimerRef.current) clearTimeout(lastDragClearTimerRef.current);
    if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
  }, []);

  const handleCollectionDragStart = useCallback((e: React.DragEvent, colId: string) => {
    const item = { kind: 'collection' as const, colId };
    setDragItem(item);
    writeSidebarDrag(e, item);
  }, [setDragItem]);

  const handleReqDragStart = useCallback((e: React.DragEvent, colId: string, reqId: string) => {
    e.stopPropagation();
    const item = { kind: 'request' as const, reqId, colId };
    setDragItem(item);
    writeSidebarDrag(e, item);
  }, [setDragItem]);

  const handleFolderDragStart = useCallback((e: React.DragEvent, colId: string, folderId: string) => {
    if (dragItemRef.current?.kind === 'request' || lastDragRef.current?.kind === 'request') {
      e.preventDefault();
      return;
    }
    const item = { kind: 'folder' as const, folderId, colId };
    setDragItem(item);
    writeSidebarDrag(e, item);
  }, [setDragItem]);

  const handleDragOver = useCallback((e: React.DragEvent, _targetId: string) => {
    if (!resolveDragItem(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(_targetId);
  }, [resolveDragItem]);

  const handleDragLeave = useCallback(() => setDropTarget(null), []);

  const handleDrop = useCallback((e: React.DragEvent, colId: string, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const di = resolveDragItem(e);
    if (!di) return;
    if (di.kind === 'collection') {
      const targetCol = collections.find(c => c.id === colId);
      if (targetCol?.mode === 'group') {
        if (di.colId !== colId) onMoveToGroup(di.colId, colId);
      } else if (di.colId !== colId) {
        onMergeCollectionInto(di.colId, colId);
      }
    } else if (di.kind === 'request') {
      if (di.colId === colId) {
        onMoveRequest(colId, di.reqId, targetFolderId);
      } else {
        onMoveRequestToCollection(di.colId, di.reqId, colId, targetFolderId);
      }
    } else if (di.kind === 'folder') {
      if (di.colId === colId && targetFolderId === null) {
        onMoveFolderTo(colId, di.folderId, null);
      } else if (di.colId !== colId) {
        onMoveFolderToCollection(di.colId, di.folderId, colId, targetFolderId);
      }
    }
    finishDrag();
  }, [collections, finishDrag, onMoveFolderTo, onMoveFolderToCollection, onMergeCollectionInto, onMoveRequest, onMoveRequestToCollection, onMoveToGroup, resolveDragItem]);

  const handleGroupDrop = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const di = resolveDragItem(e);
    if (!di) return;
    if (di.kind === 'collection' && di.colId !== groupId) {
      onMoveToGroup(di.colId, groupId);
    }
    finishDrag();
  }, [finishDrag, onMoveToGroup, resolveDragItem]);

  const handleFolderDrop = useCallback((e: React.DragEvent, colId: string, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const di = resolveDragItem(e);
    if (!di) return;
    if (di.kind === 'request') {
      if (di.colId === colId) {
        onMoveRequest(colId, di.reqId, targetFolderId);
      } else {
        onMoveRequestToCollection(di.colId, di.reqId, colId, targetFolderId);
      }
    } else if (di.kind === 'folder' && di.folderId !== targetFolderId) {
      if (di.colId === colId) {
        onMoveFolderTo(colId, di.folderId, targetFolderId);
      } else {
        onMoveFolderToCollection(di.colId, di.folderId, colId, targetFolderId);
      }
    }
    finishDrag();
  }, [finishDrag, onMoveFolderTo, onMoveFolderToCollection, onMoveRequest, onMoveRequestToCollection, resolveDragItem]);

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTarget(null);
    setDropInsert(null);
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    if (lastDragClearTimerRef.current) clearTimeout(lastDragClearTimerRef.current);
    lastDragClearTimerRef.current = setTimeout(() => {
      lastDragRef.current = null;
      lastDragClearTimerRef.current = null;
    }, 100);
  }, [setDragItem]);

  const handleReqDragOver = useCallback((e: React.DragEvent, _colId: string, reqId: string, folderId: string | undefined) => {
    const di = resolveDragItem(e);
    if (!di || di.kind !== 'request') return;
    if (di.reqId === reqId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      setDropInsert({ beforeReqId: reqId, folderId: folderId ?? null });
    } else {
      setDropInsert({ beforeReqId: `${reqId}:after`, folderId: folderId ?? null });
    }
  }, [resolveDragItem]);

  const handleReqDrop = useCallback((e: React.DragEvent, colId: string, folderId: string | undefined, requests: { id: string }[]) => {
    e.preventDefault();
    e.stopPropagation();
    const di = resolveDragItem(e);
    if (!di || di.kind !== 'request') return;
    const ins = dropInsert;
    finishDrag();
    if (!ins) {
      if (di.colId === colId) onMoveRequest(colId, di.reqId, folderId ?? null);
      else onMoveRequestToCollection(di.colId, di.reqId, colId, folderId ?? null);
      return;
    }
    const isAfter = ins.beforeReqId.endsWith(':after');
    const actualId = isAfter ? ins.beforeReqId.replace(':after', '') : ins.beforeReqId;
    const idx = requests.findIndex(r => r.id === actualId);
    const nextReq = isAfter ? requests[idx + 1] : requests[idx];
    const beforeId = nextReq?.id;
    if (di.colId === colId) onMoveRequest(colId, di.reqId, folderId ?? null, beforeId);
    else onMoveRequestToCollection(di.colId, di.reqId, colId, folderId ?? null);
  }, [dropInsert, finishDrag, onMoveRequest, onMoveRequestToCollection, resolveDragItem]);

  const handleRootDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const di = resolveDragItem(e);
    if (!di || di.kind !== 'collection') return;
    const col = collections.find(c => c.id === di.colId);
    if (col?.groupId) onMoveToGroup(di.colId, undefined);
    finishDrag();
  }, [collections, finishDrag, onMoveToGroup, resolveDragItem]);

  return {
    dragItem,
    dragItemRef,
    lastDragRef,
    dropTarget,
    setDropTarget,
    dropInsert,
    setDropInsert,
    autoExpandTimerRef,
    setDragItem,
    handleCollectionDragStart,
    handleReqDragStart,
    handleFolderDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleGroupDrop,
    handleFolderDrop,
    handleDragEnd,
    handleReqDragOver,
    handleReqDrop,
    handleRootDrop,
  };
}
