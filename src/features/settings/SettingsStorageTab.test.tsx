// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import SettingsStorageTab from './SettingsStorageTab';
import type { SettingsStorageTabProps } from './SettingsStorageTab';

// ── Mock platform (isWeb = !isTauri()) ──
let mockIsTauri = false;
vi.mock('../../shared/utils/platform', () => ({
  isTauri: () => mockIsTauri,
}));

// ── Mock storage layer ──
vi.mock('../../shared/utils/storage', () => ({
  setMaxRuns: vi.fn().mockResolvedValue(undefined),
  getStorageUsage: vi.fn().mockResolvedValue({ usedBytes: 0, entries: {} }),
  deleteRunsOlderThan: vi.fn().mockResolvedValue(0),
  clearAllTestRuns: vi.fn().mockResolvedValue(undefined),
  loadTestRunsLite: vi.fn().mockResolvedValue([]),
  cleanupStaleStorageKeys: vi.fn().mockReturnValue({ removed: 0, freedKB: 0 }),
  compactWorkflowStorage: vi.fn().mockResolvedValue({ beforeKB: 0, afterKB: 0 }),
}));

vi.mock('@redfireforge/demo-hub/lessons/gql-demo-storage-cleanup', () => ({
  purgeGqlDemoEphemeralStorage: vi.fn().mockResolvedValue({
    profilesRemoved: 0,
    runnerConfigsRemoved: 0,
    staleKeysRemoved: 0,
    freedKB: 0,
  }),
}));

import {
  setMaxRuns,
  getStorageUsage,
  deleteRunsOlderThan,
  clearAllTestRuns,
  loadTestRunsLite,
  cleanupStaleStorageKeys,
  compactWorkflowStorage,
} from '@shared/utils/storage';
import { purgeGqlDemoEphemeralStorage } from '@redfireforge/demo-hub/lessons/gql-demo-storage-cleanup';

const mGetUsage = vi.mocked(getStorageUsage);
const mLoadRuns = vi.mocked(loadTestRunsLite);
const mDeleteOlder = vi.mocked(deleteRunsOlderThan);
const mClearAll = vi.mocked(clearAllTestRuns);
const mSetMaxRuns = vi.mocked(setMaxRuns);
const mStale = vi.mocked(cleanupStaleStorageKeys);
const mCompact = vi.mocked(compactWorkflowStorage);
const mDemoPurge = vi.mocked(purgeGqlDemoEphemeralStorage);

function Harness(overrides: Partial<SettingsStorageTabProps> = {}) {
  const [storageUsage, setStorageUsage] = useState(
    overrides.storageUsage ?? { usedBytes: 0, entries: {} },
  );
  const [maxRunsLocal, setMaxRunsLocal] = useState(overrides.maxRunsLocal ?? 50);
  const [storageExpanded, setStorageExpanded] = useState(overrides.storageExpanded ?? false);
  return (
    <SettingsStorageTab
      storageUsage={storageUsage}
      setStorageUsage={setStorageUsage}
      maxRunsLocal={maxRunsLocal}
      setMaxRunsLocal={setMaxRunsLocal}
      storageExpanded={storageExpanded}
      setStorageExpanded={setStorageExpanded}
    />
  );
}

beforeEach(() => {
  resetAllMocks();
  vi.useRealTimers();
  mockIsTauri = false;
  mGetUsage.mockResolvedValue({ usedBytes: 0, entries: {} });
  mLoadRuns.mockResolvedValue([]);
  mDeleteOlder.mockResolvedValue(0);
  mClearAll.mockResolvedValue(undefined);
  mSetMaxRuns.mockResolvedValue(undefined);
  mStale.mockReturnValue({ removed: 0, freedKB: 0 });
  mCompact.mockResolvedValue({ beforeKB: 0, afterKB: 0 });
});

describe('SettingsStorageTab', () => {
  it('renders web limit hint and loads run count on mount', async () => {
    mLoadRuns.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
    render(<Harness />);
    expect(screen.getByText('Storage')).toBeTruthy();
    expect(screen.getByText(/All data stored in IndexedDB/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
  });

  it('renders desktop (Tauri) limit hint and disk suffix', () => {
    mockIsTauri = true;
    render(<Harness storageUsage={{ usedBytes: 1024, entries: {} }} />);
    expect(screen.getByText('All data stored on disk (no size limit).')).toBeTruthy();
    expect(screen.getByText('/ disk')).toBeTruthy();
  });

  it('toggles the expand state when clicking total usage', () => {
    const setExpanded = vi.fn();
    render(
      <SettingsStorageTab
        storageUsage={{ usedBytes: 100, entries: {} }}
        setStorageUsage={vi.fn()}
        maxRunsLocal={50}
        setMaxRunsLocal={vi.fn()}
        storageExpanded={false}
        setStorageExpanded={setExpanded}
      />,
    );
    fireEvent.click(screen.getByText('Total usage'));
    expect(setExpanded).toHaveBeenCalledWith(true);
  });

  it('renders expanded entry breakdown with IndexedDB and localStorage badge (web)', () => {
    render(
      <Harness
        storageExpanded
        storageUsage={{
          usedBytes: 150,
          entries: { 'perf-test-runs (IndexedDB)': 100, 'perf-test-settings': 50 },
        }}
      />,
    );
    // IDB key keeps its label, no LS badge
    expect(screen.getByText('runs (IndexedDB)')).toBeTruthy();
    // non-IDB key on web shows LS badge
    expect(screen.getByText('LS')).toBeTruthy();
    expect(screen.getByText('settings')).toBeTruthy();
  });

  it('does not show LS badge for non-IDB keys on desktop', () => {
    mockIsTauri = true;
    render(
      <Harness
        storageExpanded
        storageUsage={{ usedBytes: 50, entries: { 'perf-test-settings': 50 } }}
      />,
    );
    expect(screen.queryByText('LS')).toBeNull();
  });

  it('updates max runs (clamps to 500, sets, refreshes)', async () => {
    render(<Harness />);
    const numInput = document.querySelector('#storage-max-runs') as HTMLInputElement;
    fireEvent.change(numInput, { target: { value: '999' } });
    await waitFor(() => expect(mSetMaxRuns).toHaveBeenCalledWith(500));
  });

  it('clamps max runs to minimum 1 on invalid input', async () => {
    render(<Harness />);
    const numInput = document.querySelector('#storage-max-runs') as HTMLInputElement;
    fireEvent.change(numInput, { target: { value: '' } });
    await waitFor(() => expect(mSetMaxRuns).toHaveBeenCalledWith(1));
  });

  it('deletes runs older than N days (plural message) and refreshes', async () => {
    mDeleteOlder.mockResolvedValue(3);
    render(<Harness />);
    fireEvent.click(screen.getByText('Older than 7 days'));
    await waitFor(() => expect(screen.getByText('Deleted 3 runs.')).toBeTruthy());
    expect(mDeleteOlder).toHaveBeenCalled();
    expect(mGetUsage).toHaveBeenCalled();
  });

  it('shows singular delete message for exactly 1 run', async () => {
    mDeleteOlder.mockResolvedValue(1);
    render(<Harness />);
    fireEvent.click(screen.getByText('Older than 1 day'));
    await waitFor(() => expect(screen.getByText('Deleted 1 run.')).toBeTruthy());
  });

  it('shows "No runs matched." when nothing deleted', async () => {
    mDeleteOlder.mockResolvedValue(0);
    render(<Harness />);
    fireEvent.click(screen.getByText('Older than 30 days'));
    await waitFor(() => expect(screen.getByText('No runs matched.')).toBeTruthy());
  });

  it('clears the action message after the timeout', async () => {
    vi.useFakeTimers();
    mDeleteOlder.mockResolvedValue(2);
    render(<Harness />);
    fireEvent.click(screen.getByText('Older than 90 days'));
    await vi.waitFor(() => expect(screen.getByText('Deleted 2 runs.')).toBeTruthy());
    await vi.advanceTimersByTimeAsync(3500);
    await vi.waitFor(() => expect(screen.queryByText('Deleted 2 runs.')).toBeNull());
    vi.useRealTimers();
  });

  it('shows confirm row, cancels, and clears all runs', async () => {
    render(<Harness />);
    // open confirm
    fireEvent.click(screen.getByText('Delete All Runs'));
    expect(screen.getByText('Are you sure? This cannot be undone.')).toBeTruthy();
    // cancel
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Are you sure? This cannot be undone.')).toBeNull();
    // re-open and confirm
    fireEvent.click(screen.getByText('Delete All Runs'));
    fireEvent.click(screen.getByText('Yes, Delete All'));
    await waitFor(() => expect(mClearAll).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('All test runs deleted.')).toBeTruthy());
  });

  it('cleans up stale data with freed bytes message and clears it', async () => {
    vi.useFakeTimers();
    mDemoPurge.mockResolvedValue({
      profilesRemoved: 1,
      runnerConfigsRemoved: 2,
      staleKeysRemoved: 0,
      freedKB: 5,
    });
    mStale.mockReturnValue({ removed: 2, freedKB: 10 });
    mCompact.mockResolvedValue({ beforeKB: 30, afterKB: 20 });
    render(<Harness />);
    fireEvent.click(screen.getByText('Clean Up Stale Data'));
    await vi.waitFor(() => expect(screen.getByText(/Freed ~25 KB \(1 demo profiles, 2 runner configs, 2 stale keys\)/)).toBeTruthy());
    await vi.advanceTimersByTimeAsync(5500);
    await vi.waitFor(() => expect(screen.queryByText(/Freed ~25 KB/)).toBeNull());
    vi.useRealTimers();
  });

  it('shows already-optimized message when nothing freed', async () => {
    mDemoPurge.mockResolvedValue({
      profilesRemoved: 0,
      runnerConfigsRemoved: 0,
      staleKeysRemoved: 0,
      freedKB: 0,
    });
    mStale.mockReturnValue({ removed: 0, freedKB: 0 });
    mCompact.mockResolvedValue({ beforeKB: 10, afterKB: 10 });
    render(<Harness />);
    fireEvent.click(screen.getByText('Clean Up Stale Data'));
    await waitFor(() => expect(screen.getByText('Storage is already optimized.')).toBeTruthy());
  });

  it('compacts workflow versions with freed message and clears it', async () => {
    vi.useFakeTimers();
    mCompact.mockResolvedValue({ beforeKB: 50, afterKB: 35 });
    render(<Harness />);
    fireEvent.click(screen.getByText('Compact Workflow Versions'));
    await vi.waitFor(() =>
      expect(screen.getByText(/Compacted workflow versions: 50 KB → 35 KB \(freed 15 KB\)/)).toBeTruthy(),
    );
    await vi.advanceTimersByTimeAsync(5500);
    await vi.waitFor(() => expect(screen.queryByText(/Compacted workflow versions/)).toBeNull());
    vi.useRealTimers();
  });

  it('shows already-compact message when no workflow versions freed', async () => {
    mCompact.mockResolvedValue({ beforeKB: 10, afterKB: 10 });
    render(<Harness />);
    fireEvent.click(screen.getByText('Compact Workflow Versions'));
    await waitFor(() => expect(screen.getByText('Workflow versions already compact.')).toBeTruthy());
  });
});
