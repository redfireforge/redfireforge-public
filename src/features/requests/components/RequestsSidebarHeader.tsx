import type { RefObject } from 'react';
import type { RequestCollection, RequestFolder } from '@shared/types';
import { modeIcon } from './RequestsSidebarLogic';
import { handleImportToCollection as importToCollectionFromFile, type ToastLike } from '../utils/requestsSidebarImportExport';

interface Props {
  collections: RequestCollection[];
  toast: ToastLike;
  onImportCollection: (col: RequestCollection) => void;
  onImportFolder: (colId: string, folder: RequestFolder, parentFolderId?: string) => void;
  onAddGroup: (name: string, parentGroupId?: string) => string;
  selectMode: boolean;
  clearSelection: () => void;
  isAllExpanded: boolean;
  toggleExpandAll: () => void;
  onExportAll: () => void;
  showAddMenu: boolean;
  setShowAddMenu: (open: boolean) => void;
  addMenuRef: RefObject<HTMLDivElement | null>;
  startAddGroup: () => void;
  onNewCollection: (mode?: 'direct' | 'multi-env', groupId?: string) => void;
  search: string;
  setSearch: (value: string) => void;
}

function importSidebarFile(
  file: File | undefined,
  args: {
    collections: RequestCollection[];
    toast: ToastLike;
    onImportCollection: (col: RequestCollection) => void;
    onImportFolder: (colId: string, folder: RequestFolder, parentFolderId?: string) => void;
    onAddGroup: (name: string, parentGroupId?: string) => string;
  },
): void {
  if (!file) return;
  void file.text().then((fileContent) => {
    void importToCollectionFromFile({ ...args, fileContent });
  });
}

export function RequestsSidebarHeader({
  collections,
  toast,
  onImportCollection,
  onImportFolder,
  onAddGroup,
  selectMode,
  clearSelection,
  isAllExpanded,
  toggleExpandAll,
  onExportAll,
  showAddMenu,
  setShowAddMenu,
  addMenuRef,
  startAddGroup,
  onNewCollection,
  search,
  setSearch,
}: Props) {
  return (
    <>
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
          <button className="req-icon-btn" onClick={onExportAll} title="Export All" data-testid="req-sidebar-export-all">&#8613;</button>
          <label className="req-icon-btn req-import-label" title="Import" data-testid="req-sidebar-import">
            <input
              type="file"
              className="req-import-file-input"
              data-testid="req-sidebar-import-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                importSidebarFile(file, {
                  collections,
                  toast,
                  onImportCollection,
                  onImportFolder,
                  onAddGroup,
                });
              }}
            />
            <span aria-hidden="true">&#8615;</span>
          </label>
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
    </>
  );
}
