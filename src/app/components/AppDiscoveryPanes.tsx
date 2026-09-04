import { GalleryPage, type GalleryPageProps } from '../../features/gallery/GalleryPage';
import TrainingTracksView from '../../features/training/TrainingTracksView';
import { DEMO_HUB_ENABLED } from '../../config/features';
import { DEMO_HUB_MOUNT_ID, registerDemoHubMount } from '../demo/demoHubRuntimeRef';
import type { Tab } from '../utils/appTabUtils';

interface Props {
  activeTab: Tab;
  gallery: Pick<GalleryPageProps,
    | 'importedSamples'
    | 'onImportRequest'
    | 'onTryItRequest'
    | 'onImportCatalog'
    | 'onImportTest'
    | 'onImportWorkflow'
    | 'onImportApiMock'
    | 'onNavigateTo'
  >;
  galleryInitialDomain?: GalleryPageProps['initialDomain'];
  onOpenGallery: () => void;
}

export function AppDiscoveryPanes({
  activeTab,
  gallery,
  galleryInitialDomain,
  onOpenGallery,
}: Props) {
  return (
    <>
      {activeTab === 'gallery' && (
        <div className="app-tab-pane gallery-pane">
          <GalleryPage
            importedSamples={gallery.importedSamples}
            onImportRequest={gallery.onImportRequest}
            onTryItRequest={gallery.onTryItRequest}
            onImportCatalog={gallery.onImportCatalog}
            onImportTest={gallery.onImportTest}
            onImportWorkflow={gallery.onImportWorkflow}
            onImportApiMock={gallery.onImportApiMock}
            onNavigateTo={gallery.onNavigateTo}
            initialDomain={galleryInitialDomain}
          />
        </div>
      )}
      {DEMO_HUB_ENABLED && activeTab === 'demo-hub' && (
        <div
          id={DEMO_HUB_MOUNT_ID}
          className="app-tab-pane demo-hub-pane"
          ref={registerDemoHubMount}
        />
      )}
      {activeTab === 'training' && (
        <div className="app-tab-pane training-pane">
          <TrainingTracksView onNavigateToSample={onOpenGallery} />
        </div>
      )}
    </>
  );
}
