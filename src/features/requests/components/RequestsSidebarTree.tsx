import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from 'react';
import type { CatalogRequestMeta, RequestCollection, RequestFolder } from '@shared/types';
import { countFolderReqs, countGroupRequests } from '../utils/requestTree';
import { METHOD_COLORS } from '@shared/constants/httpMethodColors';

export interface RequestsSidebarTreeProps {
  collections: RequestCollection[];
  filteredCollections: RequestCollection[];
  searchLower: string;
  matchesSearch: (col: RequestCollection, folders: RequestFolder[] | undefined, requests: { name: string; method: string; url: string }[]) => boolean;
  folderMatchesSearch: (folder: RequestFolder) => boolean;
  requestMatchesSearch: (request: { name: string; method: string; url: string }) => boolean;
  groupMatchesSearch: (group: RequestCollection) => boolean;
  expandedCols: Set<string>;
  expandedFolders: Set<string>;
  selectedCollectionId?: string;
  selectedRequestId?: string;
  renamingFolder: { colId: string; folderId: string } | null;
  renameVal: string;
  setRenameVal: Dispatch<SetStateAction<string>>;
  commitRenameFolder: () => void;
  setRenamingFolder: Dispatch<SetStateAction<{ colId: string; folderId: string } | null>>;
  renameRef: MutableRefObject<HTMLInputElement | null>;
  renamingGroup: string | null;
  renameGroupVal: string;
  setRenameGroupVal: Dispatch<SetStateAction<string>>;
  commitRenameGroup: () => void;
  setRenamingGroup: Dispatch<SetStateAction<string | null>>;
  renameGroupRef: MutableRefObject<HTMLInputElement | null>;
  newFolderTarget: { colId: string; parentFolderId?: string; isSubCollection?: boolean } | null;
  renderNewFolderInput: (colId: string, parentFolderId?: string) => ReactNode;
  showNewGroupInput: boolean;
  newGroupTarget?: string;
  newGroupName: string;
  setNewGroupName: Dispatch<SetStateAction<string>>;
  commitAddGroup: () => void;
  setShowNewGroupInput: Dispatch<SetStateAction<boolean>>;
  dropTarget: string | null;
  dragItem: { kind: string; reqId?: string; folderId?: string; colId?: string } | null;
  dragItemRef: MutableRefObject<{ kind: string; reqId?: string; folderId?: string; colId?: string } | null>;
  lastDragRef?: MutableRefObject<{ kind: string; reqId?: string; folderId?: string; colId?: string } | null>;
  autoExpandTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  handleContainerDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent, targetId: string) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent, colId: string, targetFolderId: string | null) => void;
  handleGroupDrop: (e: React.DragEvent, groupId: string) => void;
  handleFolderDrop: (e: React.DragEvent, colId: string, folderId: string) => void;
  handleReqDragOver: (e: React.DragEvent, colId: string, reqId: string, folderId?: string) => void;
  handleReqDrop: (e: React.DragEvent, colId: string, folderId: string | undefined, siblingRequests: { id: string }[]) => void;
  handleRootDrop: (e: React.DragEvent) => void;
  handleCollectionDragStart: (e: React.DragEvent, colId: string) => void;
  handleReqDragStart: (e: React.DragEvent, colId: string, reqId: string) => void;
  handleFolderDragStart: (e: React.DragEvent, colId: string, folderId: string) => void;
  handleDragEnd: () => void;
  toggleCol: (colId: string) => void;
  toggleFolder: (folderId: string) => void;
  handleContext: (e: React.MouseEvent, type: 'collection' | 'folder' | 'request' | 'group', colId: string, folderId?: string, reqId?: string) => void;
  onSelectCollection: (colId: string) => void;
  onSelectRequest: (colId: string, reqId: string) => void;
  onEditCollection: (col: RequestCollection) => void;
  countAllRequests: (col: RequestCollection) => number;
  hasAuth: (col: RequestCollection) => boolean;
  authLabel: (col: RequestCollection) => string;
  modeIcon: (mode: RequestCollection['mode']) => string;
  modeBadge: (mode: RequestCollection['mode']) => string;
  selectedReqIds: Map<string, { colId: string; name: string; method: string }>;
  toggleReqSelection: (e: React.MouseEvent, reqId: string, colId: string, name: string, method: string) => void;
  clearSelection: () => void;
  selectMode: boolean;
  selectAllInCollection: (col: RequestCollection) => void;
  deselectAllInCollection: (col: RequestCollection) => void;
  setDropInsert: Dispatch<SetStateAction<{ beforeReqId: string; folderId: string | null } | null>>;
  dropInsert: { beforeReqId: string; folderId: string | null } | null;
  openTabRequestIds?: Set<string>;
  harnessRequestIds?: Set<string>;
  onNewCollection: () => void;
  dismissContextMenus: () => void;
}

function activeSidebarDrag(props: RequestsSidebarTreeProps) {
  return props.dragItemRef.current ?? props.lastDragRef?.current ?? null;
}

export function RequestsSidebarTree(props: RequestsSidebarTreeProps) {
  const renderRequest = (colId: string, reqId: string, method: string, name: string, url: string, inFolderId?: string, siblingRequests?: { id: string }[], meta?: CatalogRequestMeta) => {
    const isDragging = props.dragItem?.kind === 'request' && props.dragItem.reqId === reqId;
    const showBefore = props.dropInsert?.beforeReqId === reqId;
    const showAfter = props.dropInsert?.beforeReqId === reqId + ':after';
    const inHarness = props.harnessRequestIds?.has(reqId);
    const isChecked = props.selectedReqIds.has(reqId);
    return (
      <div key={reqId} className="req-req-drop-wrapper">
        {showBefore && <div className="req-drop-indicator" />}
        <div
          className={`req-req-item ${props.selectedRequestId === reqId ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${meta?.deprecated ? 'deprecated' : ''} ${isChecked ? 'bulk-selected' : ''}`}
          onClick={() => props.onSelectRequest(colId, reqId)}
          onContextMenu={(e) => props.handleContext(e, 'request', colId, inFolderId, reqId)}
          onDragOver={(e) => props.handleReqDragOver(e, colId, reqId, inFolderId)}
          onDragLeave={() => props.setDropInsert(null)}
          onDrop={(e) => props.handleReqDrop(e, colId, inFolderId, siblingRequests ?? [])}
          data-testid="req-req-item" data-req-name={name || url || 'Untitled'} data-req-id={reqId}
          draggable onDragStart={(e) => { e.stopPropagation(); props.handleReqDragStart(e, colId, reqId); }} onDragEnd={props.handleDragEnd}>
          <span
            className={`req-bulk-check ${isChecked ? 'checked' : ''}`}
            role="checkbox"
            aria-checked={isChecked}
            aria-label={`Select ${name || url || 'Untitled'}`}
            data-testid="req-bulk-checkbox"
            onClick={(e) => props.toggleReqSelection(e, reqId, colId, name || url || 'Untitled', method)}
          />
          <span className="req-req-method" style={{ color: METHOD_COLORS[method] || '#94a3b8' }}>{method}</span>
          <span className={`req-req-name ${meta?.deprecated ? 'deprecated' : ''}`} title={name || url}>{name || url || 'Untitled'}</span>
          {meta && <span className="req-req-catalog-badge" role="img" aria-label={meta.sourceSpec ? `Imported from API Catalog spec ${meta.sourceSpec}` : 'Imported from API Catalog'} title={meta.sourceSpec ? `From: ${meta.sourceSpec}` : 'From API Catalog'}>&#128203;</span>}
          {meta?.deprecated && <span className="req-req-deprecated-badge" role="img" aria-label="Deprecated endpoint" title="Deprecated">&#9888;&#65039;</span>}
          {inHarness && <span className="req-req-harness-badge" data-testid="req-in-harness-badge" title="Promoted to Harness">IN HARNESS</span>}
          {props.openTabRequestIds?.has(reqId) && <span className="req-req-tab-dot" title="Open in tab" />}
        </div>
        {showAfter && <div className="req-drop-indicator" />}
      </div>
    );
  };

  const renderFolder = (col: RequestCollection, folder: RequestFolder, depth: number): ReactNode => {
    if (props.searchLower && !props.folderMatchesSearch(folder)) return null;
    const isExpanded = props.expandedFolders.has(folder.id) || !!props.searchLower;
    const isRenaming = props.renamingFolder?.folderId === folder.id;
    const isDropTgt = props.dropTarget === folder.id;
    const isDraggingThis = props.dragItem?.kind === 'folder' && props.dragItem.folderId === folder.id;
    const subFolders = folder.folders ?? [];
    const isNewFolderHere = props.newFolderTarget?.parentFolderId === folder.id;
    const filteredRequests = props.searchLower ? folder.requests.filter(props.requestMatchesSearch) : folder.requests;

    return (
      <div key={folder.id}
        className={`req-folder-group ${isDropTgt ? 'drop-target' : ''} ${isDraggingThis ? 'dragging' : ''}`}
        style={{ paddingLeft: depth > 0 ? 8 : 0 }}
        onDragOver={(e) => props.handleDragOver(e, folder.id)}
        onDragLeave={props.handleDragLeave}
        onDrop={(e) => props.handleFolderDrop(e, col.id, folder.id)}>
        <div className="req-folder-header"
          onClick={() => props.toggleFolder(folder.id)}
          onContextMenu={(e) => props.handleContext(e, 'folder', col.id, folder.id)}
          onDragOver={(e) => { e.stopPropagation(); props.handleDragOver(e, folder.id); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); props.handleFolderDrop(e, col.id, folder.id); }}
          draggable onDragStart={(e) => {
            if (activeSidebarDrag(props)?.kind === 'request') {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
            props.handleFolderDragStart(e, col.id, folder.id);
          }} onDragEnd={props.handleDragEnd}>
          <span className="req-folder-arrow">{isExpanded ? '▾' : '▸'}</span>
          <span className="req-folder-icon">{folder.isSubCollection ? '📦' : '📁'}</span>
          {isRenaming ? (
            <input ref={props.renameRef} className="req-inline-input" value={props.renameVal}
              onChange={(e) => props.setRenameVal(e.target.value)} onBlur={props.commitRenameFolder}
              onKeyDown={(e) => { if (e.key === 'Enter') props.commitRenameFolder(); if (e.key === 'Escape') props.setRenamingFolder(null); }}
              onClick={(e) => e.stopPropagation()} autoFocus />
          ) : (
            <span className="req-folder-name" title={folder.name}>{folder.name}</span>
          )}
          <span className="req-folder-count">{countFolderReqs(folder)}</span>
        </div>
        {isExpanded && (
          <div className="req-folder-requests">
            {filteredRequests.map((req) => renderRequest(col.id, req.id, req.method, req.name, req.url, folder.id, folder.requests, req.catalogMeta))}
            {subFolders.map((sf) => renderFolder(col, sf, depth + 1))}
            {isNewFolderHere && props.renderNewFolderInput(col.id, folder.id)}
          </div>
        )}
      </div>
    );
  };

  const renderCollection = (col: RequestCollection, depth: number): ReactNode => {
    if (props.searchLower && !props.matchesSearch(col, col.folders, col.requests)) return null;
    const isExpCol = props.expandedCols.has(col.id) || !!props.searchLower;
    const isRootDropTarget = props.dropTarget === `root-${col.id}` || props.dropTarget === `col-header-${col.id}`;
    const filteredRootReqs = props.searchLower ? col.requests.filter(props.requestMatchesSearch) : col.requests;
    return (
      <div key={col.id} className={`req-col-group ${props.dropTarget === `col-header-${col.id}` ? 'col-drop-target' : ''}`}
        style={{ paddingLeft: depth > 0 ? 12 : 0 }}
        onDragOver={(e) => {
          const di = activeSidebarDrag(props);
          if (!di) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (di.kind === 'collection' && di.colId === col.id) return;
          props.setDropInsert(null);
          props.setDropInsert((prev) => prev);
        }}
        onDragLeave={props.handleContainerDragLeave}
        onDrop={(e) => {
          e.preventDefault();
          const di = activeSidebarDrag(props);
          if (!di) return;
          if (di.kind === 'collection' && di.colId === col.id) return;
          if (props.autoExpandTimerRef.current) { clearTimeout(props.autoExpandTimerRef.current); props.autoExpandTimerRef.current = null; }
          props.handleDrop(e, col.id, null);
        }}>
        <div className={`req-col-header ${props.selectedCollectionId === col.id && !props.selectedRequestId ? 'selected' : ''} ${props.dropTarget === `col-header-${col.id}` ? 'drop-target' : ''} ${props.dragItem?.kind === 'collection' && props.dragItem.colId === col.id ? 'dragging' : ''}`}
          onClick={() => { props.toggleCol(col.id); props.onSelectCollection(col.id); }}
          onContextMenu={(e) => props.handleContext(e, 'collection', col.id)}
          data-testid="req-col-item" data-col-name={col.name}
          draggable onDragStart={(e) => props.handleCollectionDragStart(e, col.id)} onDragEnd={props.handleDragEnd}>
          <span className="req-col-arrow">{isExpCol ? '▾' : '▸'}</span>
          <span className="req-col-icon">{props.modeIcon(col.mode)}</span>
          <span className="req-col-name" title={col.name}>{col.name}</span>
          <span className={`req-col-mode-badge ${col.mode}`}>{props.modeBadge(col.mode)}</span>
          {props.hasAuth(col) && <span className="req-col-auth-badge" title={`Auth: ${props.authLabel(col)}`}>&#128274;</span>}
          <span className="req-col-count">{props.countAllRequests(col)}</span>
          {props.selectMode && props.countAllRequests(col) > 0 && (() => {
            const allReqIds: string[] = [];
            const gatherIds = (reqs: { id: string }[]) => { for (const req of reqs) allReqIds.push(req.id); };
            const walkFlds = (folders: RequestFolder[]) => { for (const folder of folders) { gatherIds(folder.requests); walkFlds(folder.folders ?? []); } };
            gatherIds(col.requests);
            walkFlds(col.folders ?? []);
            const allSelected = allReqIds.length > 0 && allReqIds.every(id => props.selectedReqIds.has(id));
            return (
              <button
                className={`req-col-select-all-btn ${allSelected ? 'active' : ''}`}
                title={allSelected ? 'Deselect all in collection' : 'Select all in collection'}
                aria-label={allSelected ? 'Deselect all' : 'Select all'}
                data-testid="req-col-select-all"
                onClick={(e) => {
                  e.stopPropagation();
                  if (allSelected) props.deselectAllInCollection(col);
                  else props.selectAllInCollection(col);
                }}
              >{allSelected ? '☑' : '☐'}</button>
            );
          })()}
          <button className="req-col-edit-btn" title="Edit collection settings"
            onClick={(e) => { e.stopPropagation(); props.onEditCollection(col); }}>&#9998;</button>
        </div>

        {isExpCol && (
          <div className="req-req-list"
            onDragOver={(e) => { if (activeSidebarDrag(props)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
            onDrop={(e) => { e.preventDefault(); props.handleDrop(e, col.id, null); }}>
            <div className={`req-root-drop ${isRootDropTarget ? 'drop-target' : ''}`}
              onDragOver={(e) => props.handleDragOver(e, `root-${col.id}`)}
              onDragLeave={props.handleDragLeave}
              onDrop={(e) => props.handleDrop(e, col.id, null)}>
              {filteredRootReqs.map((req) => renderRequest(col.id, req.id, req.method, req.name, req.url, undefined, col.requests, req.catalogMeta))}
            </div>
            {(col.folders ?? []).map((folder) => renderFolder(col, folder, 0))}
            {props.newFolderTarget?.colId === col.id && !props.newFolderTarget.parentFolderId && props.renderNewFolderInput(col.id, undefined)}
          </div>
        )}
      </div>
    );
  };

  const renderGroup = (group: RequestCollection, depth: number): ReactNode => {
    if (props.searchLower && !props.groupMatchesSearch(group)) return null;
    const isExpanded = props.expandedCols.has(group.id) || !!props.searchLower;
    const isDropTgt = props.dropTarget === `group-${group.id}`;
    const isDraggingThis = props.dragItem?.kind === 'collection' && props.dragItem.colId === group.id;
    const isRenaming = props.renamingGroup === group.id;
    const groupReqCount = countGroupRequests(group.id, props.collections);
    const isNewGroupHere = props.showNewGroupInput && props.newGroupTarget === group.id;
    const children = props.collections.filter(c => c.groupId === group.id);

    return (
      <div key={group.id}
        className={`req-group-wrapper ${isDropTgt ? 'drop-target' : ''} ${isDraggingThis ? 'dragging' : ''}`}
        style={{ paddingLeft: depth > 0 ? 12 : 0 }}
        onDragOver={(e) => {
          const di = activeSidebarDrag(props);
          if (!di || di.kind !== 'collection') return;
          if (di.colId === group.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={props.handleContainerDragLeave}
        onDrop={(e) => props.handleGroupDrop(e, group.id)}>

        <div className={`req-group-header ${isDraggingThis ? 'dragging' : ''} ${isDropTgt ? 'drop-target' : ''}`}
          onClick={() => props.toggleCol(group.id)}
          onContextMenu={(e) => props.handleContext(e, 'group', group.id)}
          draggable onDragStart={(e) => props.handleCollectionDragStart(e, group.id)} onDragEnd={props.handleDragEnd}>
          <span className="req-col-arrow">{isExpanded ? '▾' : '▸'}</span>
          <span className="req-col-icon">{props.modeIcon('group')}</span>
          {isRenaming ? (
            <input ref={props.renameGroupRef} className="req-inline-input" value={props.renameGroupVal}
              onChange={(e) => props.setRenameGroupVal(e.target.value)} onBlur={props.commitRenameGroup}
              onKeyDown={(e) => { if (e.key === 'Enter') props.commitRenameGroup(); if (e.key === 'Escape') props.setRenamingGroup(null); }}
              onClick={(e) => e.stopPropagation()} autoFocus />
          ) : (
            <span className="req-col-name" title={group.name}>{group.name}</span>
          )}
          <span className="req-col-mode-badge group">GRP</span>
          <span className="req-col-count">{groupReqCount}</span>
        </div>

        {isExpanded && (
          <div className="req-group-children">
            {children.map((child) => child.mode === 'group' ? renderGroup(child, depth + 1) : renderCollection(child, depth + 1))}
            {isNewGroupHere && (
              <div className="req-new-folder-row" style={{ paddingLeft: 12 }}>
                <span className="req-folder-icon">{props.modeIcon('group')}</span>
                <input className="req-inline-input" value={props.newGroupName} placeholder="Group name"
                  onChange={(e) => props.setNewGroupName(e.target.value)} onBlur={props.commitAddGroup}
                  onKeyDown={(e) => { if (e.key === 'Enter') props.commitAddGroup(); if (e.key === 'Escape') { props.setShowNewGroupInput(false); props.setNewGroupName(''); } }} autoFocus />
              </div>
            )}
            {children.length === 0 && !isNewGroupHere && (
              <div className="req-group-empty" style={{ paddingLeft: (depth + 1) * 12 + 8 }}>Empty group</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="req-sidebar-list"
      onClick={() => props.dismissContextMenus()}
      onDragOver={(e) => {
        const di = activeSidebarDrag(props);
        if (!di || di.kind !== 'collection') return;
        const col = props.collections.find(c => c.id === di.colId);
        if (col?.groupId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          props.setDropInsert(null);
        }
      }}
      onDrop={props.handleRootDrop}>
      {props.collections.length === 0 && (
        <div className="req-sidebar-empty">No collections yet. <button className="btn-link-sm" onClick={() => props.onNewCollection()}>Create one</button></div>
      )}

      {props.filteredCollections.map((col) => col.mode === 'group' ? renderGroup(col, 0) : renderCollection(col, 0))}

      {props.showNewGroupInput && props.newGroupTarget === undefined && (
        <div className="req-new-folder-row">
          <span className="req-folder-icon">{props.modeIcon('group')}</span>
          <input className="req-inline-input" value={props.newGroupName} placeholder="Group name"
            onChange={(e) => props.setNewGroupName(e.target.value)} onBlur={props.commitAddGroup}
            onKeyDown={(e) => { if (e.key === 'Enter') props.commitAddGroup(); if (e.key === 'Escape') { props.setShowNewGroupInput(false); props.setNewGroupName(''); } }} autoFocus />
        </div>
      )}
    </div>
  );
}