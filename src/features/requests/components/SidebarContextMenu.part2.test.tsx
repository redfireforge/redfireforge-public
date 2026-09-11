/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import SidebarContextMenu from './SidebarContextMenu';
import type { RequestCollection, RequestFolder, RequestItem } from '@shared/types';
import type { CtxMenuData } from './RequestsSidebar';

function req(id: string, name: string): RequestItem {
  return {
    id,
    name,
    method: 'GET',
    url: '/a',
    headers: [],
    body: '',
    auth: { type: 'none' },
  };
}

function makeBaseCallbacks() {
  return {
    dismiss: vi.fn(),
    onNewRequest: vi.fn(),
    onEditCollection: vi.fn(),
    onDuplicateCollection: vi.fn(),
    onDeleteCollection: vi.fn(),
    onEditSubCollection: vi.fn(),
    onDuplicateFolder: vi.fn(),
    onDuplicateRequest: vi.fn(),
    onDeleteFolder: vi.fn(),
    onDeleteRequest: vi.fn(),
    onMoveFolder: vi.fn(),
    onMoveFolderTo: vi.fn(),
    onMoveRequest: vi.fn(),
    onMoveRequestToCollection: vi.fn(),
    onMoveFolderToCollection: vi.fn(),
    onMergeCollectionInto: vi.fn(),
    countAllRequests: vi.fn(() => 0),
    startAddFolder: vi.fn(),
    getSubColEligibleCount: vi.fn(() => 1),
    startRenameFolder: vi.fn(),
    handleExportCollection: vi.fn(),
    handleExportFolder: vi.fn(),
    handleImportToCollection: vi.fn(),
    handleImportToFolder: vi.fn(),
    setConfirmDelete: vi.fn(),
    onNewCollection: vi.fn(),
    startAddGroup: vi.fn(),
    startRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onDuplicateGroup: vi.fn(),
    onMoveToGroup: vi.fn(),
    handleExportGroup: vi.fn(),
  };
}

describe('SidebarContextMenu', () => {
  const baseCallbacks = makeBaseCallbacks();

  beforeEach(() => {
    for (const fn of Object.values(baseCallbacks)) {
      if (typeof fn === 'function' && 'mockClear' in fn) (fn as ReturnType<typeof vi.fn>).mockClear();
    }
  });

  function renderMenu(
    contextMenu: CtxMenuData,
    collections: RequestCollection[],
    overrides: Partial<Parameters<typeof SidebarContextMenu>[0]> = {},
  ) {
    return render(
      <SidebarContextMenu
        contextMenu={contextMenu}
        collections={collections}
        nonGroupCollections={collections.filter((c) => c.mode !== 'group')}
        showMoveMenu={false}
        showFolderMoveMenu={false}
        setShowMoveMenu={vi.fn()}
        setShowFolderMoveMenu={vi.fn()}
        {...baseCallbacks}
        {...overrides}
      />,
    );
  }

  it('request menu: move to nested folder in another collection via navigation', () => {
    const colA: RequestCollection = {
      id: 'a',
      name: 'ColA',
      mode: 'direct',
      requests: [req('rx', 'MoveMe')],
      folders: [],
    };
    const colB: RequestCollection = {
      id: 'b',
      name: 'ColB',
      mode: 'direct',
      requests: [],
      folders: [{ id: 'nest', name: 'Nested', requests: [], folders: [] }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'a', reqId: 'rx' },
      [colA, colB],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByRole('button', { name: /ColB/ }));
    fireEvent.click(screen.getByRole('button', { name: /Nested/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move here/ }));
    expect(baseCallbacks.onMoveRequestToCollection).toHaveBeenCalledWith('a', 'rx', 'b', 'nest');
  });

  it('request menu: move to root of another collection', () => {
    const colA: RequestCollection = {
      id: 'a', name: 'A', mode: 'direct', requests: [req('rx', 'X')], folders: [],
    };
    const colB: RequestCollection = {
      id: 'b', name: 'DestCol', mode: 'direct', requests: [], folders: [],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'a', reqId: 'rx' },
      [colA, colB],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByRole('button', { name: /DestCol/ }));
    expect(baseCallbacks.onMoveRequestToCollection).toHaveBeenCalledWith('a', 'rx', 'b', null);
  });

  it('request menu: move into deeply nested folder via drill-down navigation', () => {
    const colA: RequestCollection = {
      id: 'a',
      name: 'ColA',
      mode: 'direct',
      requests: [req('rx', 'MoveMe')],
      folders: [],
    };
    const colB: RequestCollection = {
      id: 'b',
      name: 'ColB',
      mode: 'direct',
      requests: [],
      folders: [{
        id: 'outer',
        name: 'Outer',
        requests: [],
        folders: [{ id: 'deep', name: 'Deep', requests: [], folders: [] }],
      }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'a', reqId: 'rx' },
      [colA, colB],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByRole('button', { name: /ColB/ }));
    fireEvent.click(screen.getByRole('button', { name: /Outer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Deep/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move here/ }));
    expect(baseCallbacks.onMoveRequestToCollection).toHaveBeenCalledWith('a', 'rx', 'b', 'deep');
  });

  it('request menu: nested back navigation from deep folder resolves parent folder id', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [{ ...req('r1', 'R1') }],
      folders: [{
        id: 'parent',
        name: 'Parent',
        requests: [],
        folders: [{ id: 'child', name: 'Child', requests: [], folders: [] }],
      }],
    };

    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [col],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );

    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /Parent/ }));
    fireEvent.click(screen.getByRole('button', { name: /Child/ }));
    fireEvent.click(screen.getByRole('button', { name: /← Back/ }));

    expect(screen.getByText('Parent')).toBeInTheDocument();
  });

  it('request menu: back from collection-root move nav returns to top list', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [{ ...req('r1', 'R1') }],
      folders: [{ id: 'f1', name: 'Folder', requests: [], folders: [] }],
    };

    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [col],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );

    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /← Back/ }));

    expect(screen.getByText('Move to...')).toBeInTheDocument();
  });

  it('request menu: unknown req id treats location as undefined for move targets', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [req('r1', 'R')],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'ghost' },
      [col],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    expect(screen.getByRole('button', { name: /📋 C/ })).toBeTruthy();
    fireEvent.click(screen.getByText('Move to...'));
    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /F/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move here/ }));
    expect(baseCallbacks.onMoveRequest).toHaveBeenCalledWith('c1', 'ghost', 'f1');
  });

  it('request menu: unknown req in same collection without folders moves to collection root', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [req('r1', 'R')],
      folders: [],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'ghost' },
      [col],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByText('Move to...'));
    fireEvent.click(screen.getByRole('button', { name: /C/ }));
    expect(baseCallbacks.onMoveRequest).toHaveBeenCalledWith('c1', 'ghost', null);
  });

  it('request menu: delete uses Untitled when request has no name in nested folder', () => {
    const unnamed = { ...req('r9', ''), name: '' };
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'fold1', name: 'F', requests: [unnamed], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r9' }, [col]);
    fireEvent.click(screen.getByText('Delete'));
    expect(baseCallbacks.setConfirmDelete).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Untitled'),
    }));
  });

  it('request menu: toggles move submenu via Move to button', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [req('r1', 'R')], folders: [],
    };
    const setMove = vi.fn();
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [col],
      { showMoveMenu: false, setShowMoveMenu: setMove },
    );
    fireEvent.click(screen.getByText('Move to...'));
    expect(setMove).toHaveBeenCalledWith(true);
  });

  it('folder menu: singular request in delete message', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [req('a', 'A')], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col]);
    fireEvent.click(screen.getByText('Delete Folder'));
    expect(baseCallbacks.setConfirmDelete.mock.calls[0][0].message).toMatch(/1 request[^s]/);
  });

  it('folder menu: rename no-ops when folder missing from tree', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'missing' }, [col]);
    fireEvent.click(screen.getByText('Rename'));
    expect(baseCallbacks.startRenameFolder).not.toHaveBeenCalled();
  });

  it('folder menu: rename passes resolved folder name', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'Fold', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col]);
    fireEvent.click(screen.getByText('Rename'));
    expect(baseCallbacks.startRenameFolder).toHaveBeenCalledWith('c1', 'f1', 'Fold');
  });

  it('collection menu: delete uses empty name when collection id missing', () => {
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'missing' }, [], {
      countAllRequests: () => 5,
    });
    fireEvent.click(screen.getByText('Delete Collection'));
    const msg = baseCallbacks.setConfirmDelete.mock.calls[0][0].message as string;
    expect(msg).toMatch(/^Delete collection ""\?$/);
  });

  it('folder move submenu works when collection has undefined folders', () => {
    const col = {
      id: 'c1', name: 'C', mode: 'direct' as const, requests: [], folders: undefined,
    } as RequestCollection;
    const { container } = render(
      <SidebarContextMenu
        contextMenu={{ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'n/a' }}
        collections={[col]}
        nonGroupCollections={[col]}
        showMoveMenu={false}
        showFolderMoveMenu
        setShowMoveMenu={vi.fn()}
        setShowFolderMoveMenu={vi.fn()}
        {...makeBaseCallbacks()}
      />,
    );
    expect(container.querySelector('.req-ctx-submenu')).toBeTruthy();
  });

  it('group menu: single root group omits move submenu', () => {
    const g1: RequestCollection = { id: 'g1', name: 'Solo', mode: 'group', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'group', colId: 'g1' }, [g1]);
    expect(screen.queryByText('Move to...')).toBeNull();
  });

  it('collection menu: add folder and sub-collection', () => {
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'multi-env', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'c1' }, [col]);
    fireEvent.click(screen.getByText('Add Folder'));
    expect(baseCallbacks.startAddFolder).toHaveBeenCalledWith('c1', undefined, false);
    fireEvent.click(screen.getByText('Add Sub-Collection'));
    expect(baseCallbacks.startAddFolder).toHaveBeenCalledWith('c1', undefined, true);
  });

  it('folder move submenu: same collection without valid targets hides current collection root option', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [],
      folders: [{ id: 'f1', name: 'Only', requests: [], folders: [] }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' },
      [col],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );

    // Because current folder is at root and no valid sibling/child targets exist,
    // same-collection root row is intentionally omitted.
    expect(screen.queryByRole('button', { name: /📋 C/ })).toBeNull();
  });

  it('folder move submenu: nested navigation back computes parent folder', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [],
      folders: [{
        id: 'root',
        name: 'Root',
        requests: [],
        folders: [{ id: 'inner', name: 'Inner', requests: [], folders: [] }],
      }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'inner' },
      [col],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );

    fireEvent.click(screen.getByText('Move to...'));
    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /Root/ }));
    fireEvent.click(screen.getByRole('button', { name: /← Back/ }));

    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('folder move submenu: same collection without folders moves folder to root', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [],
      folders: [{
        id: 'p',
        name: 'Parent',
        requests: [],
        folders: [{ id: 'f1', name: 'Child', requests: [], folders: [] }],
      }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' },
      [col],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );

    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move here/ }));
    expect(baseCallbacks.onMoveFolderTo).toHaveBeenCalledWith('c1', 'f1', null);
  });

  it('request move submenu: nested back navigation branch executes', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [],
      folders: [{
        id: 'p',
        name: 'Parent',
        requests: [{ id: 'r1', name: 'Req', method: 'GET', url: '/r', headers: [], body: '', auth: { type: 'none' } } as RequestItem],
        folders: [{ id: 'inner', name: 'Inner', requests: [], folders: [] }],
      }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [col],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );

    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /Parent/ }));
    fireEvent.click(screen.getByRole('button', { name: /← Back/ }));
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('folder move submenu: moves to root of another collection when destination has no folders', () => {
    const src: RequestCollection = {
      id: 'src',
      name: 'Src',
      mode: 'direct',
      requests: [],
      folders: [{ id: 'f1', name: 'Folder', requests: [], folders: [] }],
    };
    const dest: RequestCollection = {
      id: 'dest',
      name: 'Dest',
      mode: 'direct',
      requests: [],
      folders: [],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'src', folderId: 'f1' },
      [src, dest],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );

    fireEvent.click(screen.getByRole('button', { name: /Dest/ }));
    expect(baseCallbacks.onMoveFolderToCollection).toHaveBeenCalledWith('src', 'f1', 'dest', null);
  });

  it('collection menu: URL (direct) collection omits Add Sub-Collection', () => {
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'direct', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'c1' }, [col]);
    expect(screen.getByText('Add Folder')).toBeInTheDocument();
    expect(screen.queryByText('Add Sub-Collection')).not.toBeInTheDocument();
  });

  it('collection menu: disables Add Sub-Collection when no eligible envs', () => {
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'multi-env', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'c1' }, [col], {
      getSubColEligibleCount: vi.fn(() => 0),
    });
    const btn = screen.getByText('Add Sub-Collection');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Configure a base URL for an environment first');
  });

  it('collection menu: uses the all-used title when every env is bound', () => {
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'multi-env', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'c1' }, [col], {
      getSubColEligibleCount: vi.fn(() => 0),
      getSubColAddDisabledTitle: vi.fn(() => 'Every environment already has a sub-collection'),
    });
    const btn = screen.getByText('Add Sub-Collection');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Every environment already has a sub-collection');
  });

  it('request menu: omits move submenu when collection missing', () => {
    renderMenu({ x: 0, y: 0, type: 'request', colId: 'ghost', reqId: 'r1' }, []);
    expect(screen.queryByText('Move to...')).toBeNull();
    fireEvent.click(screen.getByText('Delete'));
    expect(baseCallbacks.setConfirmDelete.mock.calls[0][0].message).toContain('Untitled');
  });

  it('request menu: root unnamed request delete message', () => {
    const unnamed = { ...req('rx', ''), name: '' };
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [unnamed], folders: [],
    };
    renderMenu({ x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'rx' }, [col]);
    fireEvent.click(screen.getByText('Delete'));
    expect(baseCallbacks.setConfirmDelete.mock.calls[0][0].message).toContain('Untitled');
  });

  it('group menu: delete uses singular request in its clause', () => {
    const g1: RequestCollection = { id: 'g1', name: 'G1', mode: 'group', requests: [], folders: [] };
    const c1: RequestCollection = {
      id: 'c1', name: 'C1', mode: 'direct', groupId: 'g1', requests: [req('r1', 'R1')], folders: [],
    };
    renderMenu({ x: 0, y: 0, type: 'group', colId: 'g1' }, [g1, c1]);
    fireEvent.click(screen.getByText('Delete Group'));
    expect(baseCallbacks.setConfirmDelete.mock.calls[0][0].message).toMatch(/1 request and/);
  });

  it('group menu: move to peer root group', () => {
    const g1: RequestCollection = { id: 'g1', name: 'GA', mode: 'group', requests: [], folders: [] };
    const g2: RequestCollection = { id: 'g2', name: 'GB', mode: 'group', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'group', colId: 'g1' }, [g1, g2]);
    fireEvent.click(screen.getByText('Move to...'));
    fireEvent.click(screen.getByRole('button', { name: /GB/ }));
    expect(baseCallbacks.onMoveToGroup).toHaveBeenCalledWith('g1', 'g2');
  });

  it('collection menu: move lists merge target with group present', () => {
    const g1: RequestCollection = { id: 'g1', name: 'Grp', mode: 'group', requests: [], folders: [] };
    const a: RequestCollection = { id: 'a', name: 'A', mode: 'direct', requests: [], folders: [] };
    const b: RequestCollection = { id: 'b', name: 'Bmerge', mode: 'direct', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'a' }, [g1, a, b]);
    fireEvent.click(screen.getByText('Move to...'));
    fireEvent.click(screen.getByRole('button', { name: /Bmerge/ }));
    expect(baseCallbacks.onMergeCollectionInto).toHaveBeenCalledWith('a', 'b');
  });

  it('collection menu: edit skips when collection not in list', () => {
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'missing' }, []);
    fireEvent.click(screen.getByText('Edit Collection'));
    expect(baseCallbacks.onEditCollection).not.toHaveBeenCalled();
  });

  it('group delete confirm calls onDeleteGroup', () => {
    const g1: RequestCollection = { id: 'g1', name: 'G', mode: 'group', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'group', colId: 'g1' }, [g1]);
    fireEvent.click(screen.getByText('Delete Group'));
    const dlg = baseCallbacks.setConfirmDelete.mock.calls[0][0];
    dlg.onConfirm();
    expect(baseCallbacks.onDeleteGroup).toHaveBeenCalledWith('g1');
  });

  it('folder menu: add request into folder', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col]);
    fireEvent.click(screen.getByText('Add Request'));
    expect(baseCallbacks.onNewRequest).toHaveBeenCalledWith('c1', 'f1');
  });

  it('folder menu: add folder and sub-collection under parent', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'multi-env', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col]);
    fireEvent.click(screen.getByText('Add Folder'));
    expect(baseCallbacks.startAddFolder).toHaveBeenCalledWith('c1', 'f1', false);
    fireEvent.click(screen.getByText('Add Sub-Collection'));
    expect(baseCallbacks.startAddFolder).toHaveBeenCalledWith('c1', 'f1', true);
  });

  it('folder menu: URL (direct) collection omits Add Sub-Collection', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col]);
    expect(screen.getByText('Add Folder')).toBeInTheDocument();
    expect(screen.queryByText('Add Sub-Collection')).not.toBeInTheDocument();
  });

  it('folder at collection root omits collection name move target', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [],
      folders: [{ id: 'f1', name: 'RootF', requests: [], folders: [] }],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' },
      [col],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );
    expect(screen.queryByRole('button', { name: /📋 C/ })).toBeNull();
  });

  it('collection move submenu shows divider when groups and merge targets exist', () => {
    const g1: RequestCollection = { id: 'g1', name: 'Grp', mode: 'group', requests: [], folders: [] };
    const a: RequestCollection = { id: 'a', name: 'A', mode: 'direct', requests: [], folders: [] };
    const b: RequestCollection = { id: 'b', name: 'Bmerge', mode: 'direct', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'a' }, [g1, a, b]);
    fireEvent.click(screen.getByText('Move to...'));
    const dividers = document.querySelectorAll('.req-dropdown-divider');
    expect(dividers.length).toBeGreaterThan(0);
  });

  it('request move submenu shows other collections at top level', () => {
    const c1: RequestCollection = {
      id: 'c1', name: 'C1', mode: 'direct', requests: [req('r1', 'R')], folders: [],
    };
    const c2: RequestCollection = {
      id: 'c2', name: 'C2', mode: 'direct', requests: [], folders: [],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [c1, c2],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    expect(screen.getByRole('button', { name: /C2/ })).toBeTruthy();
  });

  it('folder move submenu shows other collections at top level', () => {
    const c1: RequestCollection = {
      id: 'c1', name: 'A', mode: 'direct', requests: [],
      folders: [{ id: 'fx', name: 'F', requests: [], folders: [] }],
    };
    const c2: RequestCollection = { id: 'c2', name: 'Other', mode: 'direct', requests: [], folders: [] };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'fx' },
      [c1, c2],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );
    expect(screen.getByRole('button', { name: /Other/ })).toBeTruthy();
  });

  it('folder menu hidden when folderId missing', () => {
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'direct', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1' } as CtxMenuData, [col]);
    expect(screen.queryByText('Add Request')).toBeNull();
  });

  it('group move lists excludes self group from targets', () => {
    const g1: RequestCollection = { id: 'g1', name: 'Self', mode: 'group', requests: [], folders: [] };
    const g2: RequestCollection = { id: 'g2', name: 'Peer', mode: 'group', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'group', colId: 'g1' }, [g1, g2]);
    fireEvent.click(screen.getByText('Move to...'));
    expect(screen.getByRole('button', { name: /Peer/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /📦\s*Self/ })).toBeNull();
  });

  it('folder menu hides move-to submenu when collection is missing', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'ghost', folderId: 'f1' }, [col]);
    expect(screen.queryByText('Move to...')).toBeNull();
    fireEvent.click(screen.getByText('Rename'));
    expect(baseCallbacks.startRenameFolder).not.toHaveBeenCalled();
  });

  it('request at collection root hides collection name target in move menu', () => {
    const c1: RequestCollection = {
      id: 'c1', name: 'C1', mode: 'direct', requests: [req('r1', 'R')], folders: [],
    };
    const c2: RequestCollection = { id: 'c2', name: 'C2', mode: 'direct', requests: [], folders: [] };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [c1, c2],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    expect(screen.queryByRole('button', { name: /📋 C1/ })).toBeNull();
  });

  it('folder move targets treat unknown folder id as non-ancestor for filtering', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [
        { id: 'f1', name: 'One', requests: [], folders: [] },
        { id: 'f2', name: 'Two', requests: [], folders: [] },
      ],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'ghost' },
      [col],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    expect(screen.getByRole('button', { name: /Two/ })).toBeTruthy();
  });

  it('navigable folder move handles undefined nested folders arrays', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [
        { id: 'p', name: 'Parent', requests: [], folders: undefined as unknown as RequestFolder[] },
        { id: 'leaf', name: 'Leaf', requests: [], folders: [] },
      ],
    };
    renderMenu(
      { x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'leaf' },
      [col],
      { showFolderMoveMenu: true, setShowFolderMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByRole('button', { name: /📋 C/ }));
    fireEvent.click(screen.getByRole('button', { name: /Parent/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move here/ }));
    expect(baseCallbacks.onMoveFolderTo).toHaveBeenCalledWith('c1', 'leaf', 'p');
  });

  it('context menu root stops click propagation', () => {
    const parentClick = vi.fn();
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'direct', requests: [], folders: [] };
    const { container } = render(
      <div onClick={parentClick}>
        <SidebarContextMenu
          contextMenu={{ x: 0, y: 0, type: 'collection', colId: 'c1' }}
          collections={[col]}
          nonGroupCollections={[col]}
          showMoveMenu={false}
          showFolderMoveMenu={false}
          setShowMoveMenu={vi.fn()}
          setShowFolderMoveMenu={vi.fn()}
          {...makeBaseCallbacks()}
        />
      </div>,
    );
    fireEvent.click(container.querySelector('.req-context-menu')!);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('collection menu omits Send to Harness when callback is absent', () => {
    const col: RequestCollection = { id: 'c1', name: 'C', mode: 'direct', requests: [], folders: [] };
    renderMenu({ x: 0, y: 0, type: 'collection', colId: 'c1' }, [col], {
      onSendCollectionToHarness: undefined,
    });
    expect(screen.queryByText('Send to Harness')).toBeNull();
  });

  it('folder menu omits Send to Harness when callback is absent', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'direct', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col], {
      onSendFolderToHarness: undefined,
    });
    expect(screen.queryByText('Send to Harness')).toBeNull();
  });

  it('folder menu disables Add Sub-Collection when no eligible envs', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'multi-env', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col], {
      getSubColEligibleCount: vi.fn(() => 0),
    });
    const btn = screen.getByText('Add Sub-Collection');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Configure a base URL for an environment first');
  });

  it('folder menu: uses the all-used title when every env is bound', () => {
    const col: RequestCollection = {
      id: 'c1', name: 'C', mode: 'multi-env', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], folders: [] }],
    };
    renderMenu({ x: 0, y: 0, type: 'folder', colId: 'c1', folderId: 'f1' }, [col], {
      getSubColEligibleCount: vi.fn(() => 0),
      getSubColAddDisabledTitle: vi.fn(() => 'Every environment already has a sub-collection'),
    });
    const btn = screen.getByText('Add Sub-Collection');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Every environment already has a sub-collection');
  });

  it('request move submenu handles destination collections with undefined folders', () => {
    const src: RequestCollection = {
      id: 'c1', name: 'Src', mode: 'direct', requests: [req('r1', 'R1')], folders: [],
    };
    const dst = {
      id: 'c2', name: 'Dest', mode: 'direct', requests: [], folders: undefined,
    } as RequestCollection;
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [src, dst],
      { showMoveMenu: true, setShowMoveMenu: vi.fn() },
    );
    fireEvent.click(screen.getByRole('button', { name: /Dest/ }));
    expect(baseCallbacks.onMoveRequestToCollection).toHaveBeenCalledWith('c1', 'r1', 'c2', null);
  });

  it('repositions context and submenu when they overflow viewport', () => {
    const origRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'innerWidth', { value: 460, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 460, configurable: true });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect() {
      const cls = String((this as HTMLElement).className || '');
      if (cls.includes('req-context-menu')) {
        return {
          x: 430, y: 430, left: 430, top: 430, right: 700, bottom: 700, width: 270, height: 270,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (cls.includes('req-ctx-submenu-wrapper')) {
        return {
          x: 420, y: 420, left: 420, top: 420, right: 450, bottom: 450, width: 30, height: 30,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (cls.includes('req-ctx-submenu')) {
        return {
          x: 0, y: 0, left: 0, top: 0, right: 280, bottom: 280, width: 280, height: 280,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 24, width: 40, height: 24,
        toJSON: () => ({}),
      } as DOMRect;
    });

    try {
      const c1: RequestCollection = {
        id: 'c1', name: 'C1', mode: 'direct', requests: [req('r1', 'R')], folders: [],
      };
      const c2: RequestCollection = {
        id: 'c2', name: 'C2', mode: 'direct', requests: [], folders: [],
      };
      renderMenu(
        { x: 450, y: 450, type: 'request', colId: 'c1', reqId: 'r1' },
        [c1, c2],
        { showMoveMenu: true, setShowMoveMenu: vi.fn() },
      );
      const menu = screen.getByTestId('req-context-menu') as HTMLElement;
      const submenu = document.querySelector('.req-ctx-submenu') as HTMLElement;
      expect(menu.style.left).not.toBe('');
      expect(menu.style.top).not.toBe('');
      expect(submenu.style.left).not.toBe('');
      expect(submenu.style.top).not.toBe('');
    } finally {
      vi.restoreAllMocks();
      HTMLElement.prototype.getBoundingClientRect = origRect;
    }
  });

  it('request menu exports to api mock when callback is provided', () => {
    const onExportToApiMock = vi.fn();
    const dismiss = vi.fn();
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'direct',
      requests: [req('r1', 'Get pets')],
      folders: [],
    };
    renderMenu(
      { x: 0, y: 0, type: 'request', colId: 'c1', reqId: 'r1' },
      [col],
      { onExportToApiMock, dismiss },
    );
    fireEvent.click(screen.getByText('Export to API Mock'));
    expect(onExportToApiMock).toHaveBeenCalledWith('c1', 'r1');
    expect(dismiss).toHaveBeenCalled();
  });
});
