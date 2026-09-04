// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GlobalAuthProfile } from '@shared/types';

vi.mock('../../config/features', () => ({
  DEMO_HUB_ENABLED: false,
}));

vi.mock('../../shared/utils/storage', () => ({
  getStorageUsage: vi.fn().mockResolvedValue({ usedBytes: 0, entries: {} }),
  getMaxRuns: vi.fn().mockResolvedValue(50),
}));

vi.mock('../audit/utils/auditLog', () => ({
  logAuthProfileCreated: vi.fn(),
  logAuthProfileDeleted: vi.fn(),
  logAuthProfileRenamed: vi.fn(),
  logAuthProfileUpdated: vi.fn(),
}));

vi.mock('./SettingsStorageTab', () => ({ default: () => <div data-testid="storage-tab" /> }));
vi.mock('./SettingsExportImportTab', () => ({ default: () => <div data-testid="export-import-tab" /> }));
vi.mock('../audit/components/AuditLogPanel', () => ({ default: () => <div data-testid="audit-log-panel" /> }));
vi.mock('../requests/hooks/useAuthVerify', () => ({
  useAuthVerify: () => ({
    authVerifying: false,
    authVerifyResult: null,
    setAuthVerifyResult: vi.fn(),
    verifyAuth: vi.fn(),
  }),
}));

import SettingsPage from './SettingsModal';
import { OPEN_DOCKER_SETTINGS_EVENT, requestOpenDockerSettings } from '@redfireforge/demo-hub/utils/dockerSettingsNav';

function Harness() {
  const [profiles, setProfiles] = useState<GlobalAuthProfile[]>([]);
  return (
    <SettingsPage
      appGlobalAuthProfiles={profiles}
      setAppGlobalAuthProfiles={setProfiles}
      environments={[{ id: 'e1', name: 'Dev' }]}
      microservices={[{ id: 's1', name: 'Svc', baseUrls: {} }]}
      featureGroups={[]}
      onImport={vi.fn()}
      confirm={(_m, cb) => cb()}
    />
  );
}

describe('SettingsPage — Learning Hub disabled', () => {
  it('hides the Docker tab and ignores the manage-settings event', () => {
    requestOpenDockerSettings();
    render(<Harness />);
    expect(screen.queryByTestId('settings-tab-docker')).toBeNull();
    expect(screen.queryByTestId('docker-settings')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Global Auth Profiles' })).toBeTruthy();
    fireEvent(window, new CustomEvent(OPEN_DOCKER_SETTINGS_EVENT));
    expect(screen.queryByTestId('docker-settings')).toBeNull();
  });
});
