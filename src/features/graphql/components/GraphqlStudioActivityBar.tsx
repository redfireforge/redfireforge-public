/**
 * GraphqlStudioActivityBar — Phase 3A (task 3A-15)
 *
 * Inner activity strip on the left side of GraphQL Studio (separate from the
 * app-level AppActivityBar). Has 3 icon tabs:
 *   History, Collections, Mock (Mock disabled + tooltip on hosted web)
 *
 * Active tab is persisted to localStorage. Panel slides in from the left,
 * pushing the editor pane inward.
 *
 * NOTE: loadPersistedActivityTab / persistActivityTab are in gqlActivityBarUtils.ts
 * to satisfy react-refresh/only-export-components (this file exports only components).
 */

import { useCallback } from 'react';
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';
import { persistActivityTab } from '../utils/gqlActivityBarUtils';
import type { GraphqlStudioActivityTab } from '@shared/types/graphql';

export interface GraphqlStudioActivityBarProps {
  activeTab: GraphqlStudioActivityTab | null;
  onTabChange: (tab: GraphqlStudioActivityTab | null) => void;
}

export function GraphqlStudioActivityBar({ activeTab, onTabChange }: GraphqlStudioActivityBarProps) {
  const desktopMode = isDesktopRuntimeAvailable();

  const handleTabClick = useCallback((tab: GraphqlStudioActivityTab) => {
    const next = activeTab === tab ? null : tab;
    onTabChange(next);
    persistActivityTab(next);
  }, [activeTab, onTabChange]);

  return (
    <div className="gql-activity-bar" role="tablist" aria-label="Studio panels" data-testid="gql-activity-bar">
      <ActivityTab
        id="history"
        label="History"
        active={activeTab === 'history'}
        onClick={() => handleTabClick('history')}
        icon={<HistoryIcon />}
        testId="gql-activity-history"
      />
      <ActivityTab
        id="collections"
        label="Collections"
        active={activeTab === 'collections'}
        onClick={() => handleTabClick('collections')}
        icon={<CollectionsIcon />}
        testId="gql-activity-collections"
      />
      <ActivityTab
        id="mock"
        label={desktopMode ? 'Mock' : 'Mock (desktop only)'}
        active={activeTab === 'mock'}
        onClick={() => { if (desktopMode) handleTabClick('mock'); }}
        icon={<MockIcon />}
        disabled={!desktopMode}
        testId="gql-activity-mock"
      />
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface ActivityTabProps {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}

function ActivityTab({ id, label, active, onClick, icon, disabled, testId }: ActivityTabProps) {
  return (
    <button
      type="button"
      role="tab"
      id={`gql-activity-tab-${id}`}
      aria-selected={active}
      aria-label={label}
      title={label}
      className={`gql-activity-tab${active ? ' gql-activity-tab--active' : ''}${disabled ? ' gql-activity-tab--disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CollectionsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function MockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
