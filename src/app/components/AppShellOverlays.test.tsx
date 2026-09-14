/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShellOverlays from './AppShellOverlays';

vi.mock('../../features/requests/components/RequestCollectionModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button type="button" data-testid="wb-col-modal" onClick={onClose} />
  ),
}));
vi.mock('../../features/requests/components/SubCollectionModal', () => ({
  default: ({ onClose, onSave }: { onClose: () => void; onSave: (p: object) => void }) => (
    <div>
      <button type="button" data-testid="sub-col-modal" onClick={onClose} />
      <button type="button" data-testid="sub-col-save" onClick={() => onSave({})} />
    </div>
  ),
}));
vi.mock('@workflow/components/modals/FolderPickerModal', () => ({
  default: ({ open, onCancel }: { open: boolean; onCancel: () => void }) => (
    open ? <button type="button" data-testid="folder-picker" onClick={onCancel} /> : null
  ),
}));
vi.mock('./RustTestPanelOverlay', () => ({
  default: () => <div data-testid="rust-overlay" />,
}));

afterEach(() => cleanup());

function renderOverlays(overrides: Partial<Parameters<typeof AppShellOverlays>[0]> = {}) {
  return render(
    <AppShellOverlays
      showWbCollectionModal={false}
      setShowWbCollectionModal={vi.fn()}
      editingWbCollection={null}
      setEditingWbCollection={vi.fn()}
      newColMode={undefined}
      setNewColGroupId={vi.fn()}
      setNewColMode={vi.fn()}
      wb={{ collections: [], updateSubCollection: vi.fn() } as never}
      environments={[]}
      microservices={[]}
      appGlobalAuthProfiles={[]}
      handleWbSaveCollection={vi.fn()}
      editingSubCol={null}
      setEditingSubCol={vi.fn()}
      subColForEdit={null}
      confirmDialogElement={null}
      pendingTemplateImport={null}
      setPendingTemplateImport={vi.fn()}
      wfFolders={{ folders: [] } as never}
      handleTemplatePickFolder={vi.fn()}
      RustExecutorTestPanel={null}
      liveDemoLeave={null}
      {...overrides}
    />,
  );
}

describe('AppShellOverlays', () => {
  it('renders the live-demo leave dialog and wires Stay / Leave', () => {
    const onStay = vi.fn();
    const onLeave = vi.fn();
    renderOverlays({ liveDemoLeave: { onStay, onLeave } });
    fireEvent.click(screen.getByTestId('live-demo-leave-stay'));
    fireEvent.click(screen.getByTestId('live-demo-leave-leave'));
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('hides the leave dialog when liveDemoLeave is null', () => {
    renderOverlays();
    expect(screen.queryByTestId('live-demo-leave-overlay')).toBeNull();
  });

  it('renders collection, sub-collection, rust, and folder picker overlays', () => {
    const setShowWbCollectionModal = vi.fn();
    const setEditingWbCollection = vi.fn();
    const setNewColGroupId = vi.fn();
    const setNewColMode = vi.fn();
    const setEditingSubCol = vi.fn();
    const setPendingTemplateImport = vi.fn();
    const updateSubCollection = vi.fn();
    renderOverlays({
      showWbCollectionModal: true,
      setShowWbCollectionModal,
      setEditingWbCollection,
      setNewColGroupId,
      setNewColMode,
      setEditingSubCol,
      setPendingTemplateImport,
      wb: { collections: [], updateSubCollection } as never,
      editingSubCol: { colId: 'c1', folderId: 'f1' },
      subColForEdit: { col: { id: 'c1' }, folder: { id: 'f1' } } as never,
      pendingTemplateImport: { id: 'wf' } as never,
      RustExecutorTestPanel: () => null,
      confirmDialogElement: <div data-testid="confirm-slot" />,
    });
    fireEvent.click(screen.getByTestId('wb-col-modal'));
    fireEvent.click(screen.getByTestId('sub-col-save'));
    fireEvent.click(screen.getByTestId('sub-col-modal'));
    fireEvent.click(screen.getByTestId('folder-picker'));
    expect(setShowWbCollectionModal).toHaveBeenCalledWith(false);
    expect(setEditingWbCollection).toHaveBeenCalledWith(null);
    expect(setNewColGroupId).toHaveBeenCalledWith(undefined);
    expect(setNewColMode).toHaveBeenCalledWith(undefined);
    expect(updateSubCollection).toHaveBeenCalled();
    expect(setEditingSubCol).toHaveBeenCalledWith(null);
    expect(setPendingTemplateImport).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('rust-overlay')).toBeTruthy();
    expect(screen.getByTestId('confirm-slot')).toBeTruthy();
  });
});
