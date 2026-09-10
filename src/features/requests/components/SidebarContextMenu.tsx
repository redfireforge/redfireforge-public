import { useState, useRef, useLayoutEffect } from 'react';
import type { RequestCollection, RequestFolder } from '@shared/types';
import { collectAllGroups, collectGroupIds, countGroupRequests, findFolderDeep, findSiblingFolders, countFolderReqs } from '../utils/requestTree';
import type { CtxMenuData } from './RequestsSidebar';

function PositionedSubmenu({ children, show }: { children: React.ReactNode; show: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!show) return;
    const wrapper = wrapperRef.current;
    const submenu = submenuRef.current;
    if (!wrapper || !submenu) return;
    const rect = wrapper.getBoundingClientRect();
    const subRect = submenu.getBoundingClientRect();
    let left = rect.right + 2;
    let top = rect.top - 4;
    if (left + subRect.width > window.innerWidth - 10) {
      left = rect.left - subRect.width - 2;
    }
    if (top + subRect.height > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - subRect.height - 10);
    }
    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;
  });

  return (
    <div className="req-ctx-submenu-wrapper" ref={wrapperRef}>
      {show && (
        <div className="req-ctx-submenu" ref={submenuRef}>
          {children}
        </div>
      )}
    </div>
  );
}

interface Props {
  contextMenu: CtxMenuData;
  collections: RequestCollection[];
  nonGroupCollections: RequestCollection[];
  showMoveMenu: boolean;
  showFolderMoveMenu: boolean;
  setShowMoveMenu: (v: boolean) => void;
  setShowFolderMoveMenu: (v: boolean) => void;
  dismiss: () => void;
  onNewRequest: (colId: string, folderId?: string) => void;
  onEditCollection: (col: RequestCollection) => void;
  onDuplicateCollection: (colId: string) => void;
  onDeleteCollection: (colId: string) => void;
  onEditSubCollection: (colId: string, folderId: string) => void;
  onDuplicateFolder: (colId: string, folderId: string) => void;
  onDuplicateRequest: (colId: string, reqId: string) => void;
  onDeleteFolder: (colId: string, folderId: string) => void;
  onDeleteRequest: (colId: string, reqId: string) => void;
  onMoveFolder: (colId: string, folderId: string, direction: 'up' | 'down') => void;
  onMoveFolderTo: (colId: string, folderId: string, targetParentFolderId: string | null) => void;
  onMoveRequest: (colId: string, reqId: string, targetFolderId: string | null) => void;
  onMoveRequestToCollection: (srcColId: string, reqId: string, destColId: string, destFolderId: string | null) => void;
  onMoveFolderToCollection: (srcColId: string, folderId: string, destColId: string, destParentFolderId: string | null) => void;
  onMergeCollectionInto: (srcColId: string, destColId: string) => void;
  countAllRequests: (col: RequestCollection) => number;
  startAddFolder: (colId: string, parentFolderId: string | undefined, isSubCollection: boolean) => void;
  getSubColEligibleCount: (colId: string, parentFolderId?: string) => number;
  getSubColAddDisabledTitle?: (colId: string, parentFolderId?: string) => string | undefined;
  startRenameFolder: (colId: string, folderId: string, currentName: string) => void;
  handleExportCollection: (colId: string) => void;
  handleExportFolder: (colId: string, folderId: string) => void;
  handleImportToCollection: (colId?: string, targetGroupId?: string) => void;
  handleImportToFolder: (colId: string, folderId: string) => void;
  setConfirmDelete: (v: { message: string; onConfirm: () => void } | null) => void;
  onNewCollection: (mode?: 'direct' | 'multi-env', groupId?: string) => void;
  startAddGroup: (parentGroupId?: string) => void;
  startRenameGroup: (groupId: string, currentName: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDuplicateGroup: (groupId: string) => void;
  onMoveToGroup: (colId: string, targetGroupId: string | undefined) => void;
  handleExportGroup: (groupId: string) => void;
  onSendCollectionToHarness?: (colId: string) => void;
  onSendFolderToHarness?: (colId: string, folderId: string) => void;
  onExportToApiMock?: (colId: string, reqId: string) => void;
}

function findReqInFoldersDeep(folders: RequestFolder[], reqId: string): string | undefined {
  for (const f of folders) {
    if (f.requests.some(r => r.id === reqId)) return f.id;
    const deep = findReqInFoldersDeep(f.folders ?? [], reqId);
    if (deep) return deep;
  }
  return undefined;
}

function findRequestLocation(col: RequestCollection, reqId: string): string | null | undefined {
  if (col.requests.some(r => r.id === reqId)) return null;
  return findReqInFoldersDeep(col.folders ?? [], reqId);
}

function findParentFolderId(folders: RequestFolder[], targetId: string): string | null | undefined {
  for (const f of folders) {
    if ((f.folders ?? []).some(sf => sf.id === targetId)) return f.id;
    const deep = findParentFolderId(f.folders ?? [], targetId);
    if (deep !== undefined) return deep;
  }
  return undefined;
}

function getFolderLocation(col: RequestCollection, folderId: string): string | null | undefined {
  if ((col.folders ?? []).some(f => f.id === folderId)) return null;
  return findParentFolderId(col.folders ?? [], folderId);
}

function isAncestorOf(folders: RequestFolder[], ancestorId: string, descendantId: string): boolean {
  const ancestor = findFolderDeep(folders, ancestorId);
  if (!ancestor) return false;
  return !!findFolderDeep(ancestor.folders ?? [], descendantId);
}

function findRequestName(col: RequestCollection, reqId: string): string {
  const root = col.requests.find(r => r.id === reqId);
  if (root) return root.name || 'Untitled';
  function findInFolders(folders: RequestFolder[]): string | null {
    for (const f of folders) {
      const r = f.requests.find(r => r.id === reqId);
      if (r) return r.name || 'Untitled';
      const deep = findInFolders(f.folders ?? []);
      if (deep) return deep;
    }
    return null;
  }
  return findInFolders(col.folders ?? []) ?? 'Untitled';
}

export default function SidebarContextMenu({
  contextMenu, collections, nonGroupCollections,
  showMoveMenu, showFolderMoveMenu,
  setShowMoveMenu, setShowFolderMoveMenu, dismiss,
  onNewRequest, onEditCollection, onDuplicateCollection, onDeleteCollection,
  onEditSubCollection, onDuplicateFolder, onDuplicateRequest,
  onDeleteFolder, onDeleteRequest,
  onMoveFolder, onMoveFolderTo, onMoveRequest,
  onMoveRequestToCollection, onMoveFolderToCollection, onMergeCollectionInto,
  countAllRequests, startAddFolder, getSubColEligibleCount, getSubColAddDisabledTitle, startRenameFolder,
  handleExportCollection, handleExportFolder,
  handleImportToCollection, handleImportToFolder,
  setConfirmDelete,
  onNewCollection, startAddGroup, startRenameGroup,
  onDeleteGroup, onDuplicateGroup, onMoveToGroup, handleExportGroup,
  onSendCollectionToHarness,
  onSendFolderToHarness,
  onExportToApiMock,
}: Props) {
  const [showColMoveMenu, setShowColMoveMenu] = useState(false);
  const [reqMoveNav, setReqMoveNav] = useState<{ colId: string; folderId: string | null } | null>(null);
  const [folderMoveNav, setFolderMoveNav] = useState<{ colId: string; folderId: string | null } | null>(null);
  const ctxCol = collections.find(c => c.id === contextMenu.colId) ?? null;
  const ctxReqLocation = contextMenu.type === 'request' && ctxCol && contextMenu.reqId
    ? findRequestLocation(ctxCol, contextMenu.reqId) : undefined;
  const ctxFolderLocation = contextMenu.type === 'folder' && ctxCol && contextMenu.folderId
    ? getFolderLocation(ctxCol, contextMenu.folderId) : undefined;

  const allGroupsFlat = collectAllGroups(collections);

  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 10) {
      el.style.top = `${Math.max(10, window.innerHeight - rect.height - 10)}px`;
    }
    if (rect.right > window.innerWidth - 10) {
      el.style.left = `${Math.max(10, window.innerWidth - rect.width - 10)}px`;
    }
  });

  return (
    <div ref={menuRef} className="req-context-menu" data-testid="req-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(e) => e.stopPropagation()}>

      {/* ── Group context menu ── */}
      {contextMenu.type === 'group' && (() => {
        const group = collections.find(c => c.id === contextMenu.colId);
        if (!group) return null;
        const groupReqCount = countGroupRequests(group.id, collections);
        return (<>
          <button onClick={() => { startAddGroup(contextMenu.colId); }}>Add Group</button>
          <button onClick={() => { onNewCollection('direct', contextMenu.colId); dismiss(); }}>Add URL Collection</button>
          <button onClick={() => { onNewCollection('multi-env', contextMenu.colId); dismiss(); }}>Add ENV Collection</button>
          <hr className="req-ctx-divider" />
          <button onClick={() => startRenameGroup(contextMenu.colId, group.name)}>Rename</button>
          <button onClick={() => { onDuplicateGroup(contextMenu.colId); dismiss(); }}>Duplicate Group</button>

          {(allGroupsFlat.length > (group.groupId ? 0 : 1) || group.groupId) && (() => {
            const descendantIds = new Set(collectGroupIds(contextMenu.colId, collections));
            return (
            <div className="req-ctx-submenu-wrapper">
              <button onClick={() => setShowColMoveMenu(!showColMoveMenu)}>
                Move to... <span className="req-ctx-arrow">&#9656;</span>
              </button>
              <PositionedSubmenu show={showColMoveMenu}>
                  {group.groupId && (
                    <button onClick={() => { onMoveToGroup(contextMenu.colId, undefined); dismiss(); setShowColMoveMenu(false); }}>
                      &#128203; Root level
                    </button>
                  )}
                  {allGroupsFlat
                    .filter(({ group: g }) => !descendantIds.has(g.id) && g.id !== group.groupId)
                    .map(({ group: g, depth }) => (
                      <button key={g.id} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => { onMoveToGroup(contextMenu.colId, g.id); dismiss(); setShowColMoveMenu(false); }}>
                        &#128450;&#65039; {g.name}
                      </button>
                    ))}
              </PositionedSubmenu>
            </div>
            );
          })()}

          <hr className="req-ctx-divider" />
          <button onClick={() => handleExportGroup(contextMenu.colId)}>Export Group</button>
          <button onClick={() => handleImportToCollection(undefined, contextMenu.colId)}>Import into Group</button>
          <hr className="req-ctx-divider" />
          <button className="danger" onClick={() => {
            dismiss();
            setConfirmDelete({
              message: `Delete group "${group.name}"? Its ${groupReqCount > 0 ? `${groupReqCount} request${groupReqCount !== 1 ? 's' : ''} and ` : ''}children will be moved to the parent level.`,
              onConfirm: () => onDeleteGroup(contextMenu.colId),
            });
          }}>Delete Group</button>
        </>);
      })()}

      {/* ── Collection context menu ── */}
      {contextMenu.type === 'collection' && (<>
        <button onClick={() => { onNewRequest(contextMenu.colId); dismiss(); }}>Add Request</button>
        <button onClick={() => startAddFolder(contextMenu.colId, undefined, false)}>Add Folder</button>
        {ctxCol?.mode === 'multi-env' && (() => {
          const eligible = getSubColEligibleCount(contextMenu.colId);
          return (
            <button
              disabled={eligible === 0}
              title={eligible === 0
                ? (getSubColAddDisabledTitle?.(contextMenu.colId) ?? 'Configure a base URL for an environment first')
                : undefined}
              onClick={() => startAddFolder(contextMenu.colId, undefined, true)}
            >Add Sub-Collection</button>
          );
        })()}
        <button onClick={() => { const col = collections.find(c => c.id === contextMenu.colId); if (col) onEditCollection(col); dismiss(); }}>Edit Collection</button>
        <button onClick={() => { onDuplicateCollection(contextMenu.colId); dismiss(); }}>Duplicate Collection</button>
        <div className="req-ctx-submenu-wrapper">
          <button onClick={() => setShowColMoveMenu(!showColMoveMenu)}>
            Move to... <span className="req-ctx-arrow">&#9656;</span>
          </button>
          <PositionedSubmenu show={showColMoveMenu}>
              {ctxCol?.groupId && (
                <button onClick={() => { onMoveToGroup(contextMenu.colId, undefined); dismiss(); setShowColMoveMenu(false); }}>
                  &#128203; Root level
                </button>
              )}
              {allGroupsFlat
                .filter(({ group: g }) => g.id !== ctxCol?.groupId)
                .map(({ group: g, depth }) => (
                  <button key={g.id} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => { onMoveToGroup(contextMenu.colId, g.id); dismiss(); setShowColMoveMenu(false); }}>
                    &#128450;&#65039; {g.name}
                  </button>
                ))}
              {nonGroupCollections.filter(c => c.id !== contextMenu.colId).length > 0 && allGroupsFlat.length > 0 && (
                <div className="req-dropdown-divider" />
              )}
              {nonGroupCollections.filter(c => c.id !== contextMenu.colId).map(c => (
                <button key={c.id} onClick={() => { onMergeCollectionInto(contextMenu.colId, c.id); dismiss(); setShowColMoveMenu(false); }}>
                  &#128230; {c.name}
                </button>
              ))}
          </PositionedSubmenu>
        </div>
        <hr className="req-ctx-divider" />
        <button onClick={() => handleExportCollection(contextMenu.colId)}>Export Collection</button>
        <button onClick={() => handleImportToCollection(contextMenu.colId)}>Import into Collection</button>
        {onSendCollectionToHarness && (
          <>
            <hr className="req-ctx-divider" />
            <button onClick={() => { onSendCollectionToHarness(contextMenu.colId); dismiss(); }}>Send to Harness</button>
          </>
        )}
        <hr className="req-ctx-divider" />
        <button className="danger" onClick={() => {
          const colId = contextMenu.colId;
          const col = collections.find(c => c.id === colId);
          const reqCount = col ? countAllRequests(col) : 0;
          const msg = `Delete collection "${col?.name ?? ''}"${reqCount > 0 ? ` and its ${reqCount} request${reqCount > 1 ? 's' : ''}` : ''}?`;
          dismiss();
          setConfirmDelete({ message: msg, onConfirm: () => onDeleteCollection(colId) });
        }}>Delete Collection</button>
      </>)}

      {/* ── Folder context menu ── */}
      {contextMenu.type === 'folder' && contextMenu.folderId && (() => {
        const ctxFolder = findFolderDeep(ctxCol?.folders ?? [], contextMenu.folderId!);
        const isSub = ctxFolder?.isSubCollection;
        return (<>
          <button onClick={() => { onNewRequest(contextMenu.colId, contextMenu.folderId); dismiss(); }}>Add Request</button>
          <button onClick={() => startAddFolder(contextMenu.colId, contextMenu.folderId, false)}>Add Folder</button>
          {ctxCol?.mode === 'multi-env' && (() => {
            const eligible = getSubColEligibleCount(contextMenu.colId, contextMenu.folderId);
            return (
              <button
                disabled={eligible === 0}
                title={eligible === 0
                  ? (getSubColAddDisabledTitle?.(contextMenu.colId, contextMenu.folderId) ?? 'Configure a base URL for an environment first')
                  : undefined}
                onClick={() => startAddFolder(contextMenu.colId, contextMenu.folderId, true)}
              >Add Sub-Collection</button>
            );
          })()}
          {isSub && (
            <button onClick={() => { onEditSubCollection(contextMenu.colId, contextMenu.folderId!); dismiss(); }}>Edit Settings</button>
          )}
          <button onClick={() => {
            const col = collections.find(c => c.id === contextMenu.colId);
            const folder = findFolderDeep(col?.folders ?? [], contextMenu.folderId!);
            if (folder) startRenameFolder(contextMenu.colId, contextMenu.folderId!, folder.name);
          }}>Rename</button>
          {(() => {
            const col = collections.find(c => c.id === contextMenu.colId);
            const siblings = findSiblingFolders(col?.folders ?? [], contextMenu.folderId!);
            if (!siblings) return null;
            const idx = siblings.findIndex(f => f.id === contextMenu.folderId);
            return (<>
              {idx > 0 && <button onClick={() => { onMoveFolder(contextMenu.colId, contextMenu.folderId!, 'up'); dismiss(); }}>Move Up</button>}
              {idx < siblings.length - 1 && <button onClick={() => { onMoveFolder(contextMenu.colId, contextMenu.folderId!, 'down'); dismiss(); }}>Move Down</button>}
            </>);
          })()}
          {ctxCol && (
            <div className="req-ctx-submenu-wrapper">
              <button onClick={() => { setShowFolderMoveMenu(!showFolderMoveMenu); setFolderMoveNav(null); }}>
                Move to... <span className="req-ctx-arrow">&#9656;</span>
              </button>
              <PositionedSubmenu show={showFolderMoveMenu}>
                {folderMoveNav === null ? (() => {
                  const ordered = [
                    ...nonGroupCollections.filter(c => c.id === contextMenu.colId),
                    ...nonGroupCollections.filter(c => c.id !== contextMenu.colId),
                  ];
                  return ordered.map(c => {
                    const hasFolders = (() => {
                      if (c.id !== contextMenu.colId) return (c.folders ?? []).length > 0;
                      return (c.folders ?? []).some(f =>
                        f.id !== contextMenu.folderId &&
                        !isAncestorOf(c.folders ?? [], contextMenu.folderId!, f.id)
                      );
                    })();
                    const isSameCol = c.id === contextMenu.colId;
                    if (isSameCol && ctxFolderLocation === null && !hasFolders) return null;
                    return (
                      <button key={c.id} onClick={() => {
                        if (hasFolders) {
                          setFolderMoveNav({ colId: c.id, folderId: null });
                        } else if (isSameCol) {
                          onMoveFolderTo(contextMenu.colId, contextMenu.folderId!, null);
                          dismiss(); setShowFolderMoveMenu(false);
                        } else {
                          onMoveFolderToCollection(contextMenu.colId, contextMenu.folderId!, c.id, null);
                          dismiss(); setShowFolderMoveMenu(false);
                        }
                      }}>
                        {isSameCol ? '\u{1F4CB}' : '\u{1F4E6}'} {c.name}
                        {hasFolders && <span className="req-ctx-arrow">&#9656;</span>}
                      </button>
                    );
                  });
                })() : (() => {
                  const navCol = collections.find(c => c.id === folderMoveNav.colId);
                  if (!navCol) return null;
                  const curFolder = folderMoveNav.folderId
                    ? findFolderDeep(navCol.folders ?? [], folderMoveNav.folderId)
                    : null;
                  const rawChildren = curFolder ? (curFolder.folders ?? []) : (navCol.folders ?? []);
                  const childFolders = rawChildren.filter(f =>
                    f.id !== contextMenu.folderId! &&
                    !isAncestorOf(ctxCol?.folders ?? [], contextMenu.folderId!, f.id)
                  );
                  const isSameCol = folderMoveNav.colId === contextMenu.colId;
                  const isCurrentLoc = isSameCol && (folderMoveNav.folderId ?? null) === (ctxFolderLocation ?? null);
                  return (
                    <>
                      <button className="req-move-nav-back" onClick={() => {
                        if (folderMoveNav.folderId === null) {
                          setFolderMoveNav(null);
                        } else {
                          const pid = findParentFolderId(navCol.folders ?? [], folderMoveNav.folderId!);
                          setFolderMoveNav({ colId: folderMoveNav.colId, folderId: pid ?? null });
                        }
                      }}>
                        &#8592; Back
                      </button>
                      <div className="req-move-nav-header">
                        {curFolder ? curFolder.name : navCol.name}
                      </div>
                      {isCurrentLoc ? (
                        <div className="req-move-nav-current">&#10003; Current location</div>
                      ) : (
                        <button onClick={() => {
                          if (isSameCol) {
                            onMoveFolderTo(contextMenu.colId, contextMenu.folderId!, folderMoveNav.folderId);
                          } else {
                            onMoveFolderToCollection(contextMenu.colId, contextMenu.folderId!, folderMoveNav.colId, folderMoveNav.folderId);
                          }
                          dismiss(); setShowFolderMoveMenu(false);
                        }}>
                          &#128229; Move here
                        </button>
                      )}
                      {childFolders.length > 0 && <hr className="req-ctx-divider" />}
                      {childFolders.map(f => (
                        <button key={f.id} onClick={() => setFolderMoveNav({ colId: folderMoveNav.colId, folderId: f.id })}>
                          &#128193; {f.name}
                          {(f.folders ?? []).length > 0 && <span className="req-ctx-arrow">&#9656;</span>}
                        </button>
                      ))}
                      {childFolders.length === 0 && (
                        <div className="req-move-nav-empty">No sub-folders</div>
                      )}
                    </>
                  );
                })()}
              </PositionedSubmenu>
            </div>
          )}
          <button onClick={() => { onDuplicateFolder(contextMenu.colId, contextMenu.folderId!); dismiss(); }}>
            {isSub ? 'Duplicate Sub-Collection' : 'Duplicate Folder'}
          </button>
          <hr className="req-ctx-divider" />
          <button onClick={() => handleExportFolder(contextMenu.colId, contextMenu.folderId!)}>
            {isSub ? 'Export Sub-Collection' : 'Export Folder'}
          </button>
          <button onClick={() => handleImportToFolder(contextMenu.colId, contextMenu.folderId!)}>
            {isSub ? 'Import into Sub-Collection' : 'Import into Folder'}
          </button>
          {onSendFolderToHarness && (
            <>
              <hr className="req-ctx-divider" />
              <button onClick={() => { onSendFolderToHarness(contextMenu.colId, contextMenu.folderId!); dismiss(); }}>Send to Harness</button>
            </>
          )}
          <hr className="req-ctx-divider" />
          <button className="danger" onClick={() => {
            const colId = contextMenu.colId;
            const folderId = contextMenu.folderId!;
            const targetFolder = findFolderDeep(ctxCol?.folders ?? [], folderId);
            const folderReqs = targetFolder ? countFolderReqs(targetFolder) : 0;
            const label = isSub ? 'sub-collection' : 'folder';
            const msg = `Delete ${label} "${ctxFolder?.name ?? ''}"${folderReqs > 0 ? ` and its ${folderReqs} request${folderReqs > 1 ? 's' : ''}` : ''}?`;
            dismiss();
            setConfirmDelete({ message: msg, onConfirm: () => onDeleteFolder(colId, folderId) });
          }}>
            {isSub ? 'Delete Sub-Collection' : 'Delete Folder'}
          </button>
        </>);
      })()}

      {/* ── Request context menu ── */}
      {contextMenu.type === 'request' && contextMenu.reqId && (<>
        <button onClick={() => { onDuplicateRequest(contextMenu.colId, contextMenu.reqId!); dismiss(); }}>Duplicate</button>

        {ctxCol && (
          <div className="req-ctx-submenu-wrapper">
            <button onClick={() => { setShowMoveMenu(!showMoveMenu); setReqMoveNav(null); }}>
              Move to... <span className="req-ctx-arrow">&#9656;</span>
            </button>
            <PositionedSubmenu show={showMoveMenu}>
              {reqMoveNav === null ? (() => {
                const ordered = [
                  ...nonGroupCollections.filter(c => c.id === contextMenu.colId),
                  ...nonGroupCollections.filter(c => c.id !== contextMenu.colId),
                ];
                return ordered.map(c => {
                  const hasFolders = (c.folders ?? []).length > 0;
                  const isSameCol = c.id === contextMenu.colId;
                  if (isSameCol && ctxReqLocation === null && !hasFolders) return null;
                  return (
                    <button key={c.id} onClick={() => {
                      if (hasFolders) {
                        setReqMoveNav({ colId: c.id, folderId: null });
                      } else if (isSameCol) {
                        onMoveRequest(contextMenu.colId, contextMenu.reqId!, null);
                        dismiss(); setShowMoveMenu(false);
                      } else {
                        onMoveRequestToCollection(contextMenu.colId, contextMenu.reqId!, c.id, null);
                        dismiss(); setShowMoveMenu(false);
                      }
                    }}>
                      {isSameCol ? '\u{1F4CB}' : '\u{1F4E6}'} {c.name}
                      {hasFolders && <span className="req-ctx-arrow">&#9656;</span>}
                    </button>
                  );
                });
              })() : (() => {
                const navCol = collections.find(c => c.id === reqMoveNav.colId);
                if (!navCol) return null;
                const curFolder = reqMoveNav.folderId
                  ? findFolderDeep(navCol.folders ?? [], reqMoveNav.folderId)
                  : null;
                const childFolders = curFolder ? (curFolder.folders ?? []) : (navCol.folders ?? []);
                const isSameCol = reqMoveNav.colId === contextMenu.colId;
                const isCurrentLoc = isSameCol && (reqMoveNav.folderId ?? null) === (ctxReqLocation ?? null);
                return (
                  <>
                    <button className="req-move-nav-back" onClick={() => {
                      if (reqMoveNav.folderId === null) {
                        setReqMoveNav(null);
                      } else {
                        const pid = findParentFolderId(navCol.folders ?? [], reqMoveNav.folderId!);
                        setReqMoveNav({ colId: reqMoveNav.colId, folderId: pid ?? null });
                      }
                    }}>
                      &#8592; Back
                    </button>
                    <div className="req-move-nav-header">
                      {curFolder ? curFolder.name : navCol.name}
                    </div>
                    {isCurrentLoc ? (
                      <div className="req-move-nav-current">&#10003; Current location</div>
                    ) : (
                      <button onClick={() => {
                        if (isSameCol) {
                          onMoveRequest(contextMenu.colId, contextMenu.reqId!, reqMoveNav.folderId);
                        } else {
                          onMoveRequestToCollection(contextMenu.colId, contextMenu.reqId!, reqMoveNav.colId, reqMoveNav.folderId);
                        }
                        dismiss(); setShowMoveMenu(false);
                      }}>
                        &#128229; Move here
                      </button>
                    )}
                    {childFolders.length > 0 && <hr className="req-ctx-divider" />}
                    {childFolders.map(f => (
                      <button key={f.id} onClick={() => setReqMoveNav({ colId: reqMoveNav.colId, folderId: f.id })}>
                        &#128193; {f.name}
                        {(f.folders ?? []).length > 0 && <span className="req-ctx-arrow">&#9656;</span>}
                      </button>
                    ))}
                    {childFolders.length === 0 && (
                      <div className="req-move-nav-empty">No sub-folders</div>
                    )}
                  </>
                );
              })()}
            </PositionedSubmenu>
          </div>
        )}

        {onExportToApiMock && (
          <button data-testid="req-ctx-export-to-mock" onClick={() => { onExportToApiMock(contextMenu.colId, contextMenu.reqId!); dismiss(); }}>Export to API Mock</button>
        )}

        <button className="danger" onClick={() => {
          const colId = contextMenu.colId;
          const reqId = contextMenu.reqId!;
          const col = collections.find(c => c.id === colId);
          const reqName = col ? findRequestName(col, reqId) : 'Untitled';
          dismiss();
          setConfirmDelete({ message: `Delete request "${reqName}"?`, onConfirm: () => onDeleteRequest(colId, reqId) });
        }}>Delete</button>
      </>)}
    </div>
  );
}
