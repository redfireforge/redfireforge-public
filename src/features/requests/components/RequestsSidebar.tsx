import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CustomSelect } from '@shared/components/CustomSelect';
import type { RequestCollection, RequestFolder, Environment, Microservice } from '@shared/types';
import { findSiblingFolders, collectGroupAncestors } from '../utils/requestTree';
import { SUB_COL_ALL_USED_TOAST, SUB_COL_NO_BASE_URLS_TOAST } from '../utils/subCollectionEnvs';
import { toggleSetItem } from '@shared/utils/setToggle';
import SidebarContextMenu from './SidebarContextMenu';
import { RequestsSidebarDialogs } from './RequestsSidebarDialogs';
import { RequestsSidebarTree } from './RequestsSidebarTree';
import {
  addCollectionRequestsToSelection,
  authLabel,
  getDuplicateRequestSiblings,
  getNewFolderSiblings,
  getNewRequestSiblings,
  getSelectedRequestCollection,
  getSelectedRequestFolderIds,
  getSubColAddBlockReasonForCollection,
  getSubColAddDisabledTitleForCollection,
  getSubColEligibleEnvsForCollection,
  hasAuth,
  mergeExpandedIds,
  modeBadge,
  modeIcon,
  removeCollectionRequestsFromSelection,
  resolveSubCollectionEnv,
  scrollSelectedRequestIntoView,
  startDuplicateRequestState,
} from './RequestsSidebarLogic';
import { useToast } from '@shared/hooks/useToast';
import { useRequestsSidebarSearch } from '../hooks/useRequestsSidebarSearch';
import { useRequestsSidebarDnD } from '../hooks/useRequestsSidebarDnD';
import {
  handleExportAll as exportAllToFile,
  handleExportCollection as exportCollectionToFile,
  handleExportFolder as exportFolderToFile,
  handleExportGroup as exportGroupToFile,
  handleImportToCollection as importToCollectionFromFile,
  handleImportToFolder as importToFolderFromFile,
} from '../utils/requestsSidebarImportExport';

interface Props {
  collections: RequestCollection[];
  environments: Environment[];
  microservices: Microservice[];
  selectedCollectionId?: string;
  selectedRequestId?: string;
  onSelectCollection: (colId: string) => void;
  onSelectRequest: (colId: string, reqId: string) => void;
  onNewCollection: (mode?: 'direct' | 'multi-env', groupId?: string) => void;
  onEditCollection: (col: RequestCollection) => void;
  onDeleteCollection: (colId: string) => void;
  onDuplicateCollection: (colId: string) => void;
  onNewRequest: (colId: string, folderId?: string, name?: string) => void;
  onDeleteRequest: (colId: string, reqId: string) => void;
  onDuplicateRequest: (colId: string, reqId: string, name?: string) => void;
  onAddFolder: (colId: string, name: string, parentFolderId?: string) => void;
  onAddSubCollection: (colId: string, name: string, parentFolderId?: string, selectedEnvId?: string) => void;
  onEditSubCollection: (colId: string, folderId: string) => void;
  onRenameFolder: (colId: string, folderId: string, name: string) => void;
  onDeleteFolder: (colId: string, folderId: string) => void;
  onDuplicateFolder: (colId: string, folderId: string) => void;
  onMoveFolder: (colId: string, folderId: string, direction: 'up' | 'down') => void;
  onMoveFolderTo: (colId: string, folderId: string, targetParentFolderId: string | null) => void;
  onMoveRequest: (colId: string, reqId: string, targetFolderId: string | null, beforeReqId?: string) => void;
  onMoveRequestToCollection: (srcColId: string, reqId: string, destColId: string, destFolderId: string | null) => void;
  onMoveFolderToCollection: (srcColId: string, folderId: string, destColId: string, destParentFolderId: string | null) => void;
  onMergeCollectionInto: (srcColId: string, destColId: string) => void;
  countAllRequests: (col: RequestCollection) => number;
  onImportCollection: (col: RequestCollection) => void;
  onImportFolder: (colId: string, folder: RequestFolder, parentFolderId?: string) => void;
  onAddGroup: (name: string, parentGroupId?: string) => string;
  onRenameGroup: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onMoveToGroup: (colId: string, targetGroupId: string | undefined) => void;
  onDuplicateGroup: (groupId: string) => void;
  onSendCollectionToHarness?: (colId: string) => void;
  onSendFolderToHarness?: (colId: string, folderId: string) => void;
  harnessRequestIds?: Set<string>;
  /** Request IDs that currently have an open tab (shown as a dot indicator). */
  openTabRequestIds?: Set<string>;
  onExportToApiMock?: (colId: string, reqId: string) => void;
}

export type CtxMenuData = {
  x: number; y: number;
  type: 'collection' | 'folder' | 'request' | 'group';
  colId: string; folderId?: string; reqId?: string;
};
type CtxMenu = CtxMenuData | null;

export default function RequestsSidebar({
  collections, environments, microservices, selectedCollectionId, selectedRequestId,
  onSelectCollection, onSelectRequest, onNewCollection,
  onEditCollection, onDeleteCollection, onDuplicateCollection, onNewRequest, onDeleteRequest,
  onDuplicateRequest, onAddFolder, onAddSubCollection, onEditSubCollection, onRenameFolder, onDeleteFolder, onDuplicateFolder, onMoveFolder,
  onMoveFolderTo, onMoveRequest, onMoveRequestToCollection, onMoveFolderToCollection, onMergeCollectionInto, countAllRequests,
  onImportCollection, onImportFolder,
  onAddGroup, onRenameGroup, onDeleteGroup, onMoveToGroup, onDuplicateGroup,
  onSendCollectionToHarness,
  onSendFolderToHarness,
  harnessRequestIds,
  openTabRequestIds,
  onExportToApiMock,
}: Props) {
  const toast = useToast();
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set(collections.map(c => c.id)));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<CtxMenu>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showFolderMoveMenu, setShowFolderMoveMenu] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<{ colId: string; folderId: string } | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [newFolderTarget, setNewFolderTarget] = useState<{ colId: string; parentFolderId?: string; isSubCollection?: boolean } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameGroupVal, setRenameGroupVal] = useState('');
  const renameGroupRef = useRef<HTMLInputElement>(null);
  const [newGroupTarget, setNewGroupTarget] = useState<string | undefined>(undefined);
  const [newGroupName, setNewGroupName] = useState('');
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const [newReqTarget, setNewReqTarget] = useState<{ colId: string; folderId?: string } | null>(null);
  const [newReqName, setNewReqName] = useState('');
  const [newReqError, setNewReqError] = useState('');

  const [dupReqTarget, setDupReqTarget] = useState<{ colId: string; reqId: string } | null>(null);
  const [dupReqName, setDupReqName] = useState('');
  const [dupReqError, setDupReqError] = useState('');

  // ─── Multi-select state ──────────────────────────────
  const [selectedReqIds, setSelectedReqIds] = useState<Map<string, { colId: string; name: string; method: string }>>(new Map());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const selectMode = selectedReqIds.size > 0;

  const clearSelection = useCallback(() => {
    setSelectedReqIds(new Map());
  }, []);

  const toggleReqSelection = useCallback((e: React.MouseEvent, reqId: string, colId: string, name: string, method: string) => {
    e.stopPropagation();
    setSelectedReqIds(prev => {
      const next = new Map(prev);
      if (next.has(reqId)) next.delete(reqId);
      else next.set(reqId, { colId, name, method });
      return next;
    });
  }, []);

  const selectAllInCollection = useCallback((col: RequestCollection) => {
    setSelectedReqIds(prev => addCollectionRequestsToSelection(prev, col));
  }, []);

  const deselectAllInCollection = useCallback((col: RequestCollection) => {
    setSelectedReqIds(prev => removeCollectionRequestsFromSelection(prev, col));
  }, []);

  const confirmBulkDelete = useCallback(() => {
    for (const [reqId, { colId }] of selectedReqIds) {
      onDeleteRequest(colId, reqId);
    }
    setSelectedReqIds(new Map());
    setBulkDeleteConfirm(false);
  }, [selectedReqIds, onDeleteRequest]);

  const nonGroupCollections = useMemo(() => collections.filter(c => c.mode !== 'group'), [collections]);

  const allColIds = useMemo(() => collections.map(c => c.id), [collections]);
  const allFolderIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (folders: RequestFolder[]) => {
      for (const f of folders) { ids.push(f.id); walk(f.folders ?? []); }
    };
    collections.forEach(c => walk(c.folders ?? []));
    return ids;
  }, [collections]);
  const isAllExpanded = useMemo(() =>
    allColIds.length > 0 &&
    allColIds.every(id => expandedCols.has(id)) &&
    allFolderIds.every(id => expandedFolders.has(id)),
    [allColIds, allFolderIds, expandedCols, expandedFolders]);
  const toggleExpandAll = useCallback(() => {
    if (isAllExpanded) {
      setExpandedCols(new Set());
      setExpandedFolders(new Set());
    } else {
      setExpandedCols(new Set(allColIds));
      setExpandedFolders(new Set(allFolderIds));
    }
  }, [isAllExpanded, allColIds, allFolderIds]);

  const {
    search,
    setSearch,
    searchLower,
    matchesSearch,
    folderMatchesSearch,
    requestMatchesSearch,
    groupMatchesSearch,
    filteredCollections,
  } = useRequestsSidebarSearch(collections);

  const {
    dragItem,
    dragItemRef,
    lastDragRef,
    dropTarget,
    setDropTarget,
    dropInsert,
    setDropInsert,
    autoExpandTimerRef,
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
  } = useRequestsSidebarDnD({
    collections,
    onMoveRequest,
    onMoveRequestToCollection,
    onMoveFolderTo,
    onMoveFolderToCollection,
    onMergeCollectionInto,
    onMoveToGroup,
  });

  const dismissCtx = useCallback(() => {
    setContextMenu(null); setShowMoveMenu(false); setShowFolderMoveMenu(false);
  }, []);

  // Shared onDragLeave for collection/group containers with auto-expand timer cleanup.
  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTarget(null);
      if (autoExpandTimerRef.current) { clearTimeout(autoExpandTimerRef.current); autoExpandTimerRef.current = null; }
    }
  }, [setDropTarget, autoExpandTimerRef]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => dismissCtx();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu, dismissCtx]);

  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showAddMenu]);

  // ─── Reveal selected request in sidebar (expand ancestors + scroll) ───
  useEffect(() => {
    if (!selectedRequestId || !selectedCollectionId) return;
    const col = getSelectedRequestCollection(collections, selectedCollectionId);
    if (!col) return;

    const groupIds = collectGroupAncestors(col.id, collections);
    const folderIds = getSelectedRequestFolderIds(col, selectedRequestId);

    setExpandedCols(prev => mergeExpandedIds(prev, [col.id, ...groupIds]));

    if (folderIds.length > 0) {
      setExpandedFolders(prev => mergeExpandedIds(prev, folderIds));
    }

    requestAnimationFrame(() => scrollSelectedRequestIntoView(selectedRequestId));
  }, [selectedRequestId, selectedCollectionId, collections]);

  const toggleCol = (colId: string) => {
    toggleSetItem(setExpandedCols, colId);
  };
  const toggleFolder = (folderId: string) => {
    toggleSetItem(setExpandedFolders, folderId);
  };

  const handleContext = (e: React.MouseEvent, type: CtxMenuData['type'], colId: string, folderId?: string, reqId?: string) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, colId, folderId, reqId });
    setShowMoveMenu(false); setShowFolderMoveMenu(false);
  };

  const getSubColEligibleEnvs = useCallback((colId: string, parentFolderId?: string) => (
    getSubColEligibleEnvsForCollection(collections, environments, microservices, colId, parentFolderId)
  ), [collections, environments, microservices]);

  const startAddFolder = (colId: string, parentFolderId?: string, isSubCollection?: boolean) => {
    if (isSubCollection && getSubColEligibleEnvs(colId, parentFolderId).length === 0) {
      const reason = getSubColAddBlockReasonForCollection(collections, environments, microservices, colId);
      if (reason === 'all-used') {
        toast.show('info', 'All environments in use', SUB_COL_ALL_USED_TOAST);
      } else {
        toast.show('info', 'No environments available', SUB_COL_NO_BASE_URLS_TOAST);
      }
      setContextMenu(null);
      return;
    }
    setNewFolderTarget({ colId, parentFolderId, isSubCollection }); setNewFolderName(''); setContextMenu(null);
    setExpandedCols((prev) => new Set(prev).add(colId));
    if (parentFolderId) setExpandedFolders((prev) => new Set(prev).add(parentFolderId));
  };
  const commitAddSubCollection = (envId: string) => {
    const resolved = resolveSubCollectionEnv(newFolderTarget, envId, environments);
    if (!resolved) { setNewFolderTarget(null); return; }
    onAddSubCollection(resolved.target.colId, resolved.env.name, resolved.target.parentFolderId, resolved.env.id);
    setExpandedCols((prev) => new Set(prev).add(resolved.target.colId));
    if (resolved.target.parentFolderId) {
      const parentFolderId = resolved.target.parentFolderId;
      setExpandedFolders((prev) => new Set(prev).add(parentFolderId));
    }
    setNewFolderTarget(null); setNewFolderName('');
  };
  const commitAddFolder = () => {
    // Sub-collections are created via the eligible-env dropdown (commitAddSubCollection), not here.
    if (newFolderTarget && !newFolderTarget.isSubCollection && newFolderName.trim()) {
      const siblings = getNewFolderSiblings(collections, newFolderTarget);
      const nameExists = siblings.some(f => f.name.toLowerCase() === newFolderName.trim().toLowerCase());
      if (nameExists) {
        toast.show('warning', 'Name already exists', `A folder or sub-collection with the name "${newFolderName.trim()}" already exists at this level.`);
        return;
      }
      onAddFolder(newFolderTarget.colId, newFolderName.trim(), newFolderTarget.parentFolderId);
    }
    setNewFolderTarget(null); setNewFolderName('');
  };
  const renderNewFolderInput = (colId: string, parentFolderId?: string) => {
    if (newFolderTarget?.isSubCollection) {
      const eligible = getSubColEligibleEnvs(colId, parentFolderId);
      return (
        <div className="req-new-folder-row">
          <span className="req-folder-icon">📦</span>
          <CustomSelect
            className="req-subcol-env-select"
            size="sm"
            data-testid="req-subcol-env-select"
            value=""
            onChange={commitAddSubCollection}
            options={eligible.map((env) => ({ value: env.id, label: env.name }))}
            placeholder="Select environment…"
            aria-label="Sub-collection environment"
            menuMatchTriggerWidth
          />
        </div>
      );
    }
    return (
      <div className="req-new-folder-row">
        <span className="req-folder-icon">📁</span>
        <input className="req-inline-input" data-testid="req-folder-name-input" value={newFolderName} placeholder="Folder name"
          onChange={(e) => setNewFolderName(e.target.value)} onBlur={commitAddFolder}
          onKeyDown={(e) => { if (e.key === 'Enter') commitAddFolder(); if (e.key === 'Escape') setNewFolderTarget(null); }} autoFocus />
      </div>
    );
  };

  // ─── New Request prompt ──────────────────────────────
  const startNewRequest = (colId: string, folderId?: string) => {
    setNewReqTarget({ colId, folderId });
    setNewReqName('');
    setNewReqError('');
    setContextMenu(null);
    setExpandedCols(prev => new Set(prev).add(colId));
    if (folderId) setExpandedFolders(prev => new Set(prev).add(folderId));
  };

  const commitNewRequest = () => {
    if (!newReqTarget) return;
    const trimmed = newReqName.trim();
    if (!trimmed) { setNewReqError('Name is required'); return; }

    const siblingsAtLevel = getNewRequestSiblings(collections, newReqTarget);
    if (siblingsAtLevel) {
      if (siblingsAtLevel.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
        setNewReqError(`"${trimmed}" already exists`);
        return;
      }
    }

    onNewRequest(newReqTarget.colId, newReqTarget.folderId, trimmed);
    setNewReqTarget(null);
    setNewReqName('');
    setNewReqError('');
  };

  const cancelNewRequest = () => {
    setNewReqTarget(null);
    setNewReqName('');
    setNewReqError('');
  };

  const startDuplicateRequest = (colId: string, reqId: string) => {
    const nextState = startDuplicateRequestState(collections, colId, reqId);
    if (!nextState) return;
    setDupReqTarget(nextState.target);
    setDupReqName(nextState.name);
    setDupReqError('');
    setContextMenu(null);
  };

  const commitDuplicateRequest = () => {
    if (!dupReqTarget) return;
    const trimmed = dupReqName.trim();
    if (!trimmed) { setDupReqError('Name is required'); return; }

    const siblingsAtLevel = getDuplicateRequestSiblings(collections, dupReqTarget);
    if (siblingsAtLevel) {
      if (siblingsAtLevel.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
        setDupReqError(`"${trimmed}" already exists`);
        return;
      }
    }

    onDuplicateRequest(dupReqTarget.colId, dupReqTarget.reqId, trimmed);
    setDupReqTarget(null);
    setDupReqName('');
    setDupReqError('');
  };

  const cancelDuplicateRequest = () => {
    setDupReqTarget(null);
    setDupReqName('');
    setDupReqError('');
  };

  const startRenameFolder = (colId: string, folderId: string, currentName: string) => {
    setRenamingFolder({ colId, folderId }); setRenameVal(currentName); setContextMenu(null);
    setTimeout(() => renameRef.current?.focus(), 50);
  };
  const commitRenameFolder = () => {
    if (renamingFolder && renameVal.trim()) {
      const col = collections.find(c => c.id === renamingFolder.colId);
      const siblings = findSiblingFolders(col?.folders ?? [], renamingFolder.folderId) ?? [];
      const nameExists = siblings.some(f => f.id !== renamingFolder.folderId && f.name.toLowerCase() === renameVal.trim().toLowerCase());
      if (nameExists) {
        toast.show('warning', 'Name already exists', `A folder or sub-collection with the name "${renameVal.trim()}" already exists at this level.`);
        return;
      }
      onRenameFolder(renamingFolder.colId, renamingFolder.folderId, renameVal.trim());
    }
    setRenamingFolder(null);
  };

  const startRenameGroup = (groupId: string, currentName: string) => {
    setRenamingGroup(groupId); setRenameGroupVal(currentName); setContextMenu(null);
    setTimeout(() => renameGroupRef.current?.focus(), 50);
  };
  const commitRenameGroup = () => {
    if (renamingGroup && renameGroupVal.trim()) {
      onRenameGroup(renamingGroup, renameGroupVal.trim());
    }
    setRenamingGroup(null);
  };

  const startAddGroup = (parentGroupId?: string) => {
    setNewGroupTarget(parentGroupId); setNewGroupName(''); setShowNewGroupInput(true); setContextMenu(null);
    if (parentGroupId) setExpandedCols((prev) => new Set(prev).add(parentGroupId));
  };
  const commitAddGroup = () => {
    if (newGroupName.trim()) {
      const id = onAddGroup(newGroupName.trim(), newGroupTarget);
      setExpandedCols((prev) => new Set(prev).add(id));
    }
    setShowNewGroupInput(false); setNewGroupName(''); setNewGroupTarget(undefined);
  };

  // ─── Export / Import ──────────────────────────────────

  const handleExportAll = async () => {
    await exportAllToFile(collections);
  };

  const handleExportCollection = async (colId: string) => {
    await exportCollectionToFile(collections, colId);
    setContextMenu(null);
  };

  const handleExportFolder = async (colId: string, folderId: string) => {
    await exportFolderToFile(collections, colId, folderId);
    setContextMenu(null);
  };

  const handleExportGroup = async (groupId: string) => {
    await exportGroupToFile(collections, groupId);
    setContextMenu(null);
  };

  const handleImportToCollection = async (colId?: string, targetGroupId?: string) => {
    setContextMenu(null);
    await importToCollectionFromFile({
      collections,
      toast,
      colId,
      targetGroupId,
      onImportCollection,
      onImportFolder,
      onAddGroup,
    });
  };

  const handleImportToFolder = async (colId: string, parentFolderId: string) => {
    setContextMenu(null);
    await importToFolderFromFile({
      collections,
      toast,
      colId,
      parentFolderId,
      onImportFolder,
    });
  };

  return (
    <div className="req-sidebar" data-testid="req-sidebar">
      <div className="req-sidebar-header">
        <span className="req-sidebar-title">COLLECTIONS</span>
        <div className="req-sidebar-actions">
          {selectMode && (
            <button
              className="req-icon-btn req-select-mode-btn active"
              onClick={clearSelection}
              title="Clear selection"
              aria-label="Clear selection"
              data-testid="req-sidebar-clear-selection"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            className={`req-icon-btn ${isAllExpanded ? 'active' : ''}`}
            onClick={toggleExpandAll}
            title={isAllExpanded ? 'Shrink All' : 'Expand All'}
            aria-label={isAllExpanded ? 'Shrink all collections' : 'Expand all collections'}
            aria-pressed={isAllExpanded}
            data-testid="req-sidebar-expand-all"
          >{isAllExpanded ? '\u229F' : '\u229E'}</button>
          <button className="req-icon-btn" onClick={handleExportAll} title="Export All" data-testid="req-sidebar-export-all">&#8613;</button>
          <button className="req-icon-btn" onClick={() => handleImportToCollection()} title="Import" data-testid="req-sidebar-import">&#8615;</button>
          <div className="req-add-menu-wrapper" ref={addMenuRef}>
            <button className="req-icon-btn" onClick={() => setShowAddMenu(!showAddMenu)} title="Add new..." data-testid="req-sidebar-add-btn">+</button>
            {showAddMenu && (
              <div className="req-add-dropdown" data-testid="req-add-dropdown">
                <button data-testid="req-add-group" onClick={() => { startAddGroup(); setShowAddMenu(false); }}>
                  {modeIcon('group')} Group
                </button>
                <button data-testid="req-add-url-collection" onClick={() => { onNewCollection('direct'); setShowAddMenu(false); }}>
                  {modeIcon('direct')} URL Collection
                </button>
                <button data-testid="req-add-env-collection" onClick={() => { onNewCollection('multi-env'); setShowAddMenu(false); }}>
                  {modeIcon('multi-env')} ENV Collection
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="req-sidebar-search">
        <input
          type="text"
          className="req-sidebar-search-input"
          placeholder="Search collections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search collections and requests"
          data-testid="req-sidebar-search"
        />
        {search && (
          <button
            className="req-sidebar-search-clear"
            onClick={() => setSearch('')}
            title="Clear search"
          >&times;</button>
        )}
      </div>

      <RequestsSidebarTree
        collections={collections}
        filteredCollections={filteredCollections}
        searchLower={searchLower}
        matchesSearch={matchesSearch}
        folderMatchesSearch={folderMatchesSearch}
        requestMatchesSearch={requestMatchesSearch}
        groupMatchesSearch={groupMatchesSearch}
        expandedCols={expandedCols}
        expandedFolders={expandedFolders}
        selectedCollectionId={selectedCollectionId}
        selectedRequestId={selectedRequestId}
        renamingFolder={renamingFolder}
        renameVal={renameVal}
        setRenameVal={setRenameVal}
        commitRenameFolder={commitRenameFolder}
        setRenamingFolder={setRenamingFolder}
        renameRef={renameRef}
        renamingGroup={renamingGroup}
        renameGroupVal={renameGroupVal}
        setRenameGroupVal={setRenameGroupVal}
        commitRenameGroup={commitRenameGroup}
        setRenamingGroup={setRenamingGroup}
        renameGroupRef={renameGroupRef}
        newFolderTarget={newFolderTarget}
        renderNewFolderInput={renderNewFolderInput}
        showNewGroupInput={showNewGroupInput}
        newGroupTarget={newGroupTarget}
        newGroupName={newGroupName}
        setNewGroupName={setNewGroupName}
        commitAddGroup={commitAddGroup}
        setShowNewGroupInput={setShowNewGroupInput}
        dropTarget={dropTarget}
        dragItem={dragItem}
        dragItemRef={dragItemRef}
        lastDragRef={lastDragRef}
        autoExpandTimerRef={autoExpandTimerRef}
        handleContainerDragLeave={handleContainerDragLeave}
        handleDragOver={handleDragOver}
        handleDragLeave={handleDragLeave}
        handleDrop={handleDrop}
        handleGroupDrop={handleGroupDrop}
        handleFolderDrop={handleFolderDrop}
        handleReqDragOver={handleReqDragOver}
        handleReqDrop={handleReqDrop}
        handleRootDrop={handleRootDrop}
        handleCollectionDragStart={handleCollectionDragStart}
        handleReqDragStart={handleReqDragStart}
        handleFolderDragStart={handleFolderDragStart}
        handleDragEnd={handleDragEnd}
        toggleCol={toggleCol}
        toggleFolder={toggleFolder}
        handleContext={handleContext}
        onSelectCollection={onSelectCollection}
        onSelectRequest={onSelectRequest}
        onEditCollection={onEditCollection}
        countAllRequests={countAllRequests}
        hasAuth={hasAuth}
        authLabel={authLabel}
        modeIcon={modeIcon}
        modeBadge={modeBadge}
        selectedReqIds={selectedReqIds}
        toggleReqSelection={toggleReqSelection}
        clearSelection={clearSelection}
        selectMode={selectMode}
        selectAllInCollection={selectAllInCollection}
        deselectAllInCollection={deselectAllInCollection}
        setDropInsert={setDropInsert}
        dropInsert={dropInsert}
        openTabRequestIds={openTabRequestIds}
        harnessRequestIds={harnessRequestIds}
        onNewCollection={() => onNewCollection()}
        dismissContextMenus={dismissCtx}
      />

      {contextMenu && (
        <SidebarContextMenu
          contextMenu={contextMenu}
          collections={collections}
          nonGroupCollections={nonGroupCollections}
          showMoveMenu={showMoveMenu}
          showFolderMoveMenu={showFolderMoveMenu}
          setShowMoveMenu={setShowMoveMenu}
          setShowFolderMoveMenu={setShowFolderMoveMenu}
          dismiss={dismissCtx}
          onNewRequest={startNewRequest}
          onEditCollection={onEditCollection}
          onDuplicateCollection={onDuplicateCollection}
          onDeleteCollection={onDeleteCollection}
          onEditSubCollection={onEditSubCollection}
          onDuplicateFolder={onDuplicateFolder}
          onDuplicateRequest={startDuplicateRequest}
          onDeleteFolder={onDeleteFolder}
          onDeleteRequest={onDeleteRequest}
          onMoveFolder={onMoveFolder}
          onMoveFolderTo={onMoveFolderTo}
          onMoveRequest={onMoveRequest}
          onMoveRequestToCollection={onMoveRequestToCollection}
          onMoveFolderToCollection={onMoveFolderToCollection}
          onMergeCollectionInto={onMergeCollectionInto}
          countAllRequests={countAllRequests}
          startAddFolder={startAddFolder}
          getSubColEligibleCount={(colId, parentFolderId) => getSubColEligibleEnvs(colId, parentFolderId).length}
          getSubColAddDisabledTitle={(colId) => getSubColAddDisabledTitleForCollection(collections, environments, microservices, colId)}
          startRenameFolder={startRenameFolder}
          handleExportCollection={handleExportCollection}
          handleExportFolder={handleExportFolder}
          handleImportToCollection={handleImportToCollection}
          handleImportToFolder={handleImportToFolder}
          setConfirmDelete={setConfirmDelete}
          onNewCollection={onNewCollection}
          startAddGroup={startAddGroup}
          startRenameGroup={startRenameGroup}
          onDeleteGroup={onDeleteGroup}
          onDuplicateGroup={onDuplicateGroup}
          onMoveToGroup={onMoveToGroup}
          handleExportGroup={handleExportGroup}
          onSendCollectionToHarness={onSendCollectionToHarness}
          onSendFolderToHarness={onSendFolderToHarness}
          onExportToApiMock={onExportToApiMock}
        />
      )}

      <RequestsSidebarDialogs
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        newReqTarget={newReqTarget}
        newReqName={newReqName}
        setNewReqName={setNewReqName}
        newReqError={newReqError}
        setNewReqError={setNewReqError}
        commitNewRequest={commitNewRequest}
        cancelNewRequest={cancelNewRequest}
        dupReqTarget={dupReqTarget}
        dupReqName={dupReqName}
        setDupReqName={setDupReqName}
        dupReqError={dupReqError}
        setDupReqError={setDupReqError}
        commitDuplicateRequest={commitDuplicateRequest}
        cancelDuplicateRequest={cancelDuplicateRequest}
        selectMode={selectMode}
        selectedReqIds={selectedReqIds}
        clearSelection={clearSelection}
        bulkDeleteConfirm={bulkDeleteConfirm}
        setBulkDeleteConfirm={setBulkDeleteConfirm}
        confirmBulkDelete={confirmBulkDelete}
        setSelectedReqIds={setSelectedReqIds}
      />

    </div>
  );
}
