import {
  type Tab,
  domainOf,
  isApiTab,
  isApiMockTab,
  isWorkflowTab,
  isHarnessTab,
  isGalleryTab,
  isSettingsTab,
  isProtocolsTab,
  isDemoTab,
  getLastProtocolsTab,
} from '../utils/appTabUtils';
import { DEMO_HUB_ENABLED } from '../../config/features';
import { isHumanLiveDemoTabExit } from '../demo/liveDemoTabGuard';

interface AppActivityBarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

function ActivityBarIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="ab-icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function demoLockClass(target: Tab, activeTab: Tab): string {
  return isHumanLiveDemoTabExit(target, activeTab) ? ' ab-btn--demo-locked' : '';
}

function demoLockTitle(base: string, target: Tab, activeTab: Tab): string {
  return isHumanLiveDemoTabExit(target, activeTab)
    ? `${base} — finish or exit the live demo first`
    : base;
}

export default function AppActivityBar({ activeTab, setActiveTab }: AppActivityBarProps) {
  return (
    <nav className="activity-bar">
      <button
        className={`ab-btn ${domainOf(activeTab) === 'api' ? 'active' : ''}${demoLockClass('requests', activeTab)}`}
        onClick={() => { if (!isApiTab(activeTab)) setActiveTab('requests'); }}
        title={demoLockTitle('API', 'requests', activeTab)}
        data-testid="ab-api"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">API</span>
      </button>
      <button
        className={`ab-btn ${domainOf(activeTab) === 'api-mock' ? 'active' : ''}${demoLockClass('api-mock-studio', activeTab)}`}
        onClick={() => { if (!isApiMockTab(activeTab)) setActiveTab('api-mock-studio'); }}
        title={demoLockTitle('API Mock', 'api-mock-studio', activeTab)}
        data-testid="ab-api-mock"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">API Mock</span>
      </button>
      <button
        className={`ab-btn ${domainOf(activeTab) === 'workflow' ? 'active' : ''}${demoLockClass('workflow', activeTab)}`}
        onClick={() => { if (!isWorkflowTab(activeTab)) setActiveTab('workflow'); }}
        title={demoLockTitle('Workflow', 'workflow', activeTab)}
        data-testid="ab-workflow"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 009 9" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">Workflow</span>
      </button>
      <button
        className={`ab-btn ${domainOf(activeTab) === 'testing' ? 'active' : ''}${demoLockClass('scenarios', activeTab)}`}
        onClick={() => { if (!isHarnessTab(activeTab)) setActiveTab('scenarios'); }}
        title={demoLockTitle('Harness', 'scenarios', activeTab)}
        data-testid="nav-harness"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12l2 2 4-4" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">Harness</span>
      </button>
      <button
        className={`ab-btn ${domainOf(activeTab) === 'protocols' ? 'active' : ''}${demoLockClass(getLastProtocolsTab(), activeTab)}`}
        onClick={() => { if (!isProtocolsTab(activeTab)) setActiveTab(getLastProtocolsTab()); }}
        title={demoLockTitle('Protocols', getLastProtocolsTab(), activeTab)}
        data-testid="ab-protocols"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <path d="M5 12h14" />
            <path d="M5 8h14" />
            <path d="M5 16h14" />
            <path d="M17 6l4 2-4 2" />
            <path d="M17 14l4 2-4 2" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">Protocols</span>
      </button>
      {DEMO_HUB_ENABLED && (
      <button
        className={`ab-btn ${domainOf(activeTab) === 'demo' ? 'active' : ''}${demoLockClass('demo-hub', activeTab)}`}
        onClick={() => { if (!isDemoTab(activeTab)) setActiveTab('demo-hub'); }}
        title={demoLockTitle('Demo Hub', 'demo-hub', activeTab)}
        data-testid="ab-demo-hub"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <path d="M12 3v18" />
            <path d="M5 6l7 4 7-4" />
            <path d="M5 10l7 4 7-4" />
            <path d="M5 14l7 4 7-4" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">Demo Hub</span>
      </button>
      )}
      <button
        className={`ab-btn ${domainOf(activeTab) === 'gallery' ? 'active' : ''}${demoLockClass('gallery', activeTab)}`}
        onClick={() => { if (!isGalleryTab(activeTab)) setActiveTab('gallery'); }}
        title={demoLockTitle('Gallery', 'gallery', activeTab)}
        data-testid="ab-gallery"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">Gallery</span>
      </button>
      <div className="ab-spacer" />
      <button
        className={`ab-btn ${domainOf(activeTab) === 'settings' ? 'active' : ''}${demoLockClass('environments', activeTab)}`}
        onClick={() => { if (!isSettingsTab(activeTab)) setActiveTab('environments'); }}
        title={demoLockTitle('Settings', 'environments', activeTab)}
        data-testid="ab-settings"
      >
        <span className="ab-icon">
          <ActivityBarIcon>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </ActivityBarIcon>
        </span>
        <span className="ab-label">Settings</span>
      </button>
    </nav>
  );
}
