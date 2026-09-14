import { lazy, Suspense, type ComponentType, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Environment, GlobalAuthProfile, Microservice, RequestCollection } from '@shared/types';
import type { Workflow } from '@workflow/types/workflow';
import type { UseRequestsReturn } from '../../features/requests/hooks/useRequests';
import type { WorkflowFoldersHook } from '@workflow/hooks/useWorkflowFolders';
import type { RequestFolder } from '@shared/types';
import { DEMO_HUB_ENABLED } from '../../config/features';
import RequestCollectionModal from '../../features/requests/components/RequestCollectionModal';
import SubCollectionModal from '../../features/requests/components/SubCollectionModal';
import FolderPickerModal from '@workflow/components/modals/FolderPickerModal';
import RustTestPanelOverlay from './RustTestPanelOverlay';

const DemoLeaveDialog = DEMO_HUB_ENABLED
  ? lazy(() => import('./DemoLeaveDialog'))
  : null;

export interface AppShellOverlaysProps {
  showWbCollectionModal: boolean;
  setShowWbCollectionModal: (open: boolean) => void;
  editingWbCollection: RequestCollection | null;
  setEditingWbCollection: (col: RequestCollection | null) => void;
  newColMode: 'direct' | 'multi-env' | undefined;
  setNewColGroupId: (id: string | undefined) => void;
  setNewColMode: Dispatch<SetStateAction<'direct' | 'multi-env' | undefined>>;
  wb: UseRequestsReturn;
  environments: Environment[];
  microservices: Microservice[];
  appGlobalAuthProfiles: GlobalAuthProfile[];
  handleWbSaveCollection: (col: Omit<RequestCollection, 'id' | 'requests'> & { id?: string }) => void;
  editingSubCol: { colId: string; folderId: string } | null;
  setEditingSubCol: (val: { colId: string; folderId: string } | null) => void;
  subColForEdit: { col: RequestCollection; folder: RequestFolder } | null;
  confirmDialogElement: ReactNode;
  pendingTemplateImport: Workflow | null;
  setPendingTemplateImport: Dispatch<SetStateAction<Workflow | null>>;
  wfFolders: WorkflowFoldersHook;
  handleTemplatePickFolder: (folderId: string | null) => void;
  RustExecutorTestPanel: ComponentType | null | undefined;
  demoLeave: { onStay: () => void; onLeave: () => void } | null;
}

export default function AppShellOverlays({
  showWbCollectionModal,
  setShowWbCollectionModal,
  editingWbCollection,
  setEditingWbCollection,
  newColMode,
  setNewColGroupId,
  setNewColMode,
  wb,
  environments,
  microservices,
  appGlobalAuthProfiles,
  handleWbSaveCollection,
  editingSubCol,
  setEditingSubCol,
  subColForEdit,
  confirmDialogElement,
  pendingTemplateImport,
  setPendingTemplateImport,
  wfFolders,
  handleTemplatePickFolder,
  RustExecutorTestPanel,
  demoLeave,
}: AppShellOverlaysProps) {
  return (
    <>
      {showWbCollectionModal && (
        <RequestCollectionModal
          collection={editingWbCollection}
          collections={wb.collections}
          environments={environments}
          appEnvironments={environments}
          appMicroservices={microservices}
          globalAuthProfiles={appGlobalAuthProfiles}
          defaultMode={newColMode}
          onSave={handleWbSaveCollection}
          onClose={() => { setShowWbCollectionModal(false); setEditingWbCollection(null); setNewColGroupId(undefined); setNewColMode(undefined); }}
        />
      )}

      {editingSubCol && subColForEdit && (
        <SubCollectionModal
          subCollection={subColForEdit.folder}
          parentCollection={subColForEdit.col}
          environments={environments}
          microservices={microservices}
          globalAuthProfiles={appGlobalAuthProfiles}
          onSave={(patch) => wb.updateSubCollection(editingSubCol.colId, editingSubCol.folderId, patch)}
          onClose={() => setEditingSubCol(null)}
        />
      )}

      {confirmDialogElement}

      <FolderPickerModal
        open={pendingTemplateImport !== null}
        folders={wfFolders.folders}
        title="Save Template To..."
        onCancel={() => setPendingTemplateImport(null)}
        onPick={handleTemplatePickFolder}
      />

      {RustExecutorTestPanel && <RustTestPanelOverlay Panel={RustExecutorTestPanel} />}
      {DEMO_HUB_ENABLED && DemoLeaveDialog && demoLeave && (
        <Suspense fallback={null}>
          <DemoLeaveDialog onStay={demoLeave.onStay} onLeave={demoLeave.onLeave} />
        </Suspense>
      )}
    </>
  );
}
