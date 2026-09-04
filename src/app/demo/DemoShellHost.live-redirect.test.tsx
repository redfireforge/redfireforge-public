/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Dispatch, SetStateAction } from 'react';

const navigateToTab = vi.fn();
const suppressLiveTabExitRef = { current: false };
let liveView = true;
let isDemoBootstrapping = false;

vi.mock('@redfireforge/demo-hub/useDemoHub', () => ({
  useDemoHub: () => ({
    state: {
      view: liveView ? 'live' : 'concept',
      selectedLesson: {
        id: 'grpc-mock-server',
        initialTab: 'grpc-studio',
        name: 'Mock Server',
        concept: { title: 'T', body: 'B' },
        steps: [{ id: 's1', title: 'S1', description: 'D' }],
      },
      stepIndex: 0,
      isPlaying: false,
      selectedDomain: null,
      speed: 1,
    },
    suppressLiveTabExitRef,
    hubOpen: true,
    hubVisible: !liveView,
    stepPhase: 'reading',
    get isDemoBootstrapping() { return isDemoBootstrapping; },
    progress: { completedLessons: [], lessonSteps: {}, speed: 1 },
    openHub: vi.fn(),
    closeHub: vi.fn(),
    goBack: vi.fn(),
    goToDomains: vi.fn(),
    selectDomain: vi.fn(),
    selectLesson: vi.fn(),
    startLiveDemo: vi.fn(),
    exitLiveDemo: vi.fn(),
    nextStep: vi.fn(),
    toggleAutoPlay: vi.fn(),
    skipReading: vi.fn(),
    restartDemo: vi.fn(),
    confirmLessonComplete: vi.fn(),
    resetLesson: vi.fn(),
    resetLessons: vi.fn(),
    setLastCategory: vi.fn(),
  }),
}));

vi.mock('@redfireforge/demo-hub/DemoHub', () => ({
  default: () => <div data-testid="demo-hub-portal">Hub</div>,
}));
vi.mock('@redfireforge/demo-hub/LessonNotesContext', () => ({
  LessonNotesProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@redfireforge/demo-hub/LessonNotesPanel', () => ({ default: () => null }));
vi.mock('@redfireforge/demo-hub/demoBootFreeze', () => ({
  clearDemoBootFreeze: vi.fn(),
  revealDemoBootSurface: vi.fn(),
}));
vi.mock('../hooks/useDemoShortcuts', () => ({ useDemoShortcuts: () => {} }));
vi.mock('../hooks/useDemoSidebarBridge', () => ({ useDemoSidebarBridge: () => {} }));
vi.mock('../hooks/useDemoGlobalAuthBridge', () => ({ useDemoGlobalAuthBridge: () => {} }));
vi.mock('../hooks/useDemoWorkspaceDefaultsBridge', () => ({ useDemoWorkspaceDefaultsBridge: () => {} }));
vi.mock('../hooks/useDemoAppEnvironmentCleanupBridge', () => ({ useDemoAppEnvironmentCleanupBridge: () => {} }));
vi.mock('../hooks/useDemoSettingsEnvBridge', () => ({ useDemoSettingsEnvBridge: () => {} }));
vi.mock('../hooks/useDemoSettingsSvcBridge', () => ({ useDemoSettingsSvcBridge: () => {} }));
vi.mock('../components/AppLiveDemoOverlay', () => ({ default: () => null }));
vi.mock('./demoHubRuntimeRef', () => ({
  syncDemoHubRuntimeRef: () => {},
  resetDemoHubRuntimeRef: () => {},
  DEMO_HUB_MOUNT_ID: 'demo-hub-mount',
  useDemoHubMountEl: () => document.getElementById('demo-hub-mount'),
  registerDemoHubMount: () => {},
}));

import { DemoShellHost } from './DemoShellHost';

function renderHost(activeTab: 'demo-hub' | 'grpc-studio' = 'demo-hub') {
  const noopSet = (() => {}) as Dispatch<SetStateAction<unknown>>;
  if (!document.getElementById('demo-hub-mount')) {
    const mount = document.createElement('div');
    mount.id = 'demo-hub-mount';
    document.body.appendChild(mount);
  }
  return render(
    <DemoShellHost
      navigateToTab={navigateToTab}
      activeTab={activeTab as never}
      setSidebarCollapsed={noopSet as Dispatch<SetStateAction<boolean>>}
      setAppGlobalAuthProfiles={noopSet as never}
      setWorkspaceDefaults={noopSet as never}
      selectedEnvId=""
      selectedSvcId=""
      setEnvironments={noopSet as never}
      setMicroservices={noopSet as never}
      setSelectedEnvId={vi.fn()}
      setSelectedSvcId={vi.fn()}
    />,
  );
}

describe('DemoShellHost live→initialTab redirect', () => {
  beforeEach(() => {
    navigateToTab.mockClear();
    suppressLiveTabExitRef.current = false;
    liveView = true;
    isDemoBootstrapping = false;
    document.body.removeAttribute('data-demo-bootstrapping');
    document.getElementById('demo-hub-mount')?.remove();
  });

  it('redirects demo-hub → lesson initialTab while live', () => {
    renderHost('demo-hub');
    expect(navigateToTab).toHaveBeenCalledWith('grpc-studio');
  });

  it('does not redirect when exit suppress flag is set', () => {
    suppressLiveTabExitRef.current = true;
    renderHost('demo-hub');
    expect(navigateToTab).not.toHaveBeenCalled();
  });

  it('redirects during bootstrapping too (empty Demo Hub is worse)', () => {
    isDemoBootstrapping = true;
    renderHost('demo-hub');
    expect(navigateToTab).toHaveBeenCalledWith('grpc-studio');
  });

  it('does not remount Concept / LessonPlayer as a boot cover', () => {
    isDemoBootstrapping = true;
    renderHost('demo-hub');
    expect(document.body.getAttribute('data-demo-bootstrapping')).toBe('1');
    // The veil (demo-boot-freeze testid) is owned by installDemoBootFreeze —
    // this test only mounts DemoShellHost, which does not paint the veil.
    // The important assertion is that no LessonPlayer/Concept clone renders as a cover.
    expect(screen.queryByTestId('boot-hold-lesson-player')).toBeNull();
    // Hub portals only on demo-hub tab — not as a fullscreen concept hold.
    expect(screen.getByTestId('demo-hub-portal')).toBeInTheDocument();
  });

  it('stops portaling DemoHub after leaving demo-hub (no concept elevate)', () => {
    isDemoBootstrapping = true;
    const noopSet = (() => {}) as Dispatch<SetStateAction<unknown>>;
    const { rerender } = renderHost('demo-hub');
    rerender(
      <DemoShellHost
        navigateToTab={navigateToTab}
        activeTab={'grpc-studio' as never}
        setSidebarCollapsed={noopSet as Dispatch<SetStateAction<boolean>>}
        setAppGlobalAuthProfiles={noopSet as never}
        setWorkspaceDefaults={noopSet as never}
        selectedEnvId=""
        selectedSvcId=""
        setEnvironments={noopSet as never}
        setMicroservices={noopSet as never}
        setSelectedEnvId={vi.fn()}
        setSelectedSvcId={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('demo-hub-portal')).toBeNull();
  });
});
