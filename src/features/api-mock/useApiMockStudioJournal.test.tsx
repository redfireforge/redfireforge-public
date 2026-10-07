/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRef, useState } from 'react';
import type { ApiMockServerDefinitionV1, ApiMockTransactionV1 } from '@shared/api-mock/contracts';
import type { ScenarioStateSnapshot } from './apiMockControlClient';
import type { RuntimeInfo } from './apiMockStudioFactory';
import type { ApiMockWorkspaceSnapshot } from './useApiMockStudioPersistence';

const transactions = vi.fn();
const state = vi.fn();
const recordedDrafts = vi.fn();
const ackRecordedDrafts = vi.fn();
const mergeRecordedDraftsIntoRoutes = vi.fn();

vi.mock('./apiMockControlClient', () => ({
  apiMockControlClient: {
    transactions: (...args: unknown[]) => transactions(...args),
    state: (...args: unknown[]) => state(...args),
    recordedDrafts: (...args: unknown[]) => recordedDrafts(...args),
    ackRecordedDrafts: (...args: unknown[]) => ackRecordedDrafts(...args),
  },
}));
vi.mock('../../shared/api-mock/proxyRecording', () => ({
  mergeRecordedDraftsIntoRoutes: (...args: unknown[]) => mergeRecordedDraftsIntoRoutes(...args),
}));

import { useApiMockStudioJournal } from './useApiMockStudioJournal';

const server = { id: 'srv-1', routes: [] } as unknown as ApiMockServerDefinitionV1;

function Probe({
  activeServerId = 'srv-1',
  activeStatus = 'running' as RuntimeInfo['status'],
  servers = [server],
}: {
  activeServerId?: string;
  activeStatus?: RuntimeInfo['status'];
  servers?: ApiMockServerDefinitionV1[];
}) {
  const latestRef = useRef<ApiMockWorkspaceSnapshot>({ servers, activeServerId, openTabIds: [] });
  latestRef.current = { servers, activeServerId, openTabIds: [] };
  const [txs, setTransactions] = useState<ApiMockTransactionV1[]>([]);
  const [scenarioState, setScenarioState] = useState<ScenarioStateSnapshot | null>(null);
  const [runtime, setRuntime] = useState<Record<string, RuntimeInfo>>({});
  const [srv, setServers] = useState(servers);
  const [liveMessage, setLiveMessage] = useState('');
  const status = runtime[activeServerId ?? '']?.status ?? activeStatus;
  useApiMockStudioJournal({
    activeServerId, activeStatus: status, latestRef,
    setTransactions, setScenarioState, setRuntime, setServers, setLiveMessage,
  });
  return (
    <div>
      <span data-testid="tx">{txs.length}</span>
      <span data-testid="state">{scenarioState ? 'yes' : 'no'}</span>
      <span data-testid="live">{liveMessage}</span>
      <span data-testid="routes">{srv[0]?.routes.length ?? 0}</span>
      {Object.entries(runtime).map(([id, r]) => (
        <span key={id} data-testid={`rt-${id}`}>{r.status}</span>
      ))}
    </div>
  );
}

describe('useApiMockStudioJournal', () => {
  beforeEach(() => {
    transactions.mockResolvedValue({ ok: true, data: { transactions: [{ id: 't1' }, { id: 't2' }] } });
    state.mockResolvedValue({ ok: true, data: { states: { cart: 'open' }, counters: {} } });
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [] } });
    ackRecordedDrafts.mockResolvedValue({ ok: true });
    mergeRecordedDraftsIntoRoutes.mockReturnValue({ added: 0, routes: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not poll when the listener is stopped', async () => {
    render(<Probe activeStatus="stopped" />);
    await act(async () => {});
    expect(transactions).not.toHaveBeenCalled();
  });

  it('polls journal, state, and drafts while running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Probe />);
    await waitFor(() => expect(transactions).toHaveBeenCalledWith('srv-1'));
    await waitFor(() => expect(screen.getByTestId('tx')).toHaveTextContent('2'));
    expect(screen.getByTestId('state')).toHaveTextContent('yes');
    const first = transactions.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(transactions.mock.calls.length).toBeGreaterThan(first);
  });

  it('stops polling when state says the listener is gone without touching other endpoints', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.mockResolvedValue({
      ok: false,
      error: { code: 'MOCK_RUNTIME_ERROR', message: 'not running', retry: false },
    });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('rt-srv-1')).toHaveTextContent('stopped'));
    // state-first gating means transactions/drafts never fire against a dead listener.
    expect(transactions).not.toHaveBeenCalled();
    expect(recordedDrafts).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(transactions).not.toHaveBeenCalled();
  });

  it('skips transactions and drafts on a retryable state failure but keeps polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.mockResolvedValueOnce({ ok: false, error: { retry: true } });
    render(<Probe />);
    // First cycle: state failed retryably — the other endpoints are not touched.
    await waitFor(() => expect(state).toHaveBeenCalled());
    expect(transactions).not.toHaveBeenCalled();
    expect(recordedDrafts).not.toHaveBeenCalled();
    // Badge is left alone (not reconciled to stopped) so the poll continues.
    expect(screen.queryByTestId('rt-srv-1')).toBeNull();
    // Next tick: state recovers and the journal fills in.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(transactions).toHaveBeenCalledWith('srv-1'));
  });

  it('stops polling after consecutive retryable state failures (companion down)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.mockResolvedValue({ ok: false, error: { retry: true } });
    render(<Probe />);
    // Drive 4 consecutive retryable failures (initial call + 3 interval ticks).
    await waitFor(() => expect(state).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 * 3); });
    const countAtMax = state.mock.calls.length;
    expect(countAtMax).toBeGreaterThanOrEqual(4);
    // After streak is saturated the interval is cleared — no more calls.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 * 10); });
    expect(state.mock.calls.length).toBe(countAtMax);
    // Badge is never reconciled to stopped for a retryable failure.
    expect(screen.queryByTestId('rt-srv-1')).toBeNull();
  });

  it('merges recorded drafts and acknowledges them', async () => {
    recordedDrafts.mockResolvedValue({
      ok: true,
      data: { drafts: [{ id: 'd1' }] },
    });
    mergeRecordedDraftsIntoRoutes.mockReturnValue({
      added: 1,
      routes: [{ id: 'draft-1' }],
    });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent(/Recorded 1 proxied exchange/));
    expect(ackRecordedDrafts).toHaveBeenCalledWith('srv-1', ['d1']);
    expect(screen.getByTestId('routes')).toHaveTextContent('1');
  });

  it('fills headers on an existing draft and acknowledges the capture', async () => {
    recordedDrafts.mockResolvedValue({
      ok: true,
      data: { drafts: [{ id: 'd-headers' }] },
    });
    mergeRecordedDraftsIntoRoutes.mockReturnValue({
      added: 0,
      updated: 1,
      routes: [{ id: 'draft-headers' }],
    });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent(/Filled response headers on 1 recorded draft/));
    expect(ackRecordedDrafts).toHaveBeenCalledWith('srv-1', ['d-headers']);
    expect(screen.getByTestId('routes')).toHaveTextContent('1');
  });

  it('acks drafts even when none were added and ignores a cancelled poll', async () => {
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [{ id: 'd2' }] } });
    mergeRecordedDraftsIntoRoutes.mockReturnValue({ added: 0, routes: [] });
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(ackRecordedDrafts).toHaveBeenCalledWith('srv-1', ['d2']));
    unmount();
    expect(screen.queryByTestId('tx')).toBeNull();
  });

  it('skips a poll that resolves after unmount', async () => {
    let settle!: (value: unknown) => void;
    state.mockResolvedValue({ ok: true, data: { states: {}, counters: {} } });
    transactions.mockReturnValue(new Promise(resolve => { settle = resolve; }));
    recordedDrafts.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(transactions).toHaveBeenCalled());
    unmount();
    await act(async () => {
      settle({ ok: true, data: { transactions: [{ id: 'late' }] } });
    });
  });

  it('skips a poll that resolves after unmount during the state fetch', async () => {
    let resolveState!: (value: unknown) => void;
    state.mockReturnValue(new Promise(resolve => { resolveState = resolve; }));
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(state).toHaveBeenCalledWith('srv-1'));
    unmount();
    await act(async () => {
      resolveState({ ok: true, data: { states: {}, counters: {} } });
    });
    expect(transactions).not.toHaveBeenCalled();
  });

  it('skips a poll that resolves after unmount during journal fetches', async () => {
    let resolveTransactions!: (value: unknown) => void;
    let resolveDrafts!: (value: unknown) => void;
    state.mockResolvedValue({ ok: true, data: { states: {}, counters: {} } });
    transactions.mockReturnValue(new Promise(resolve => { resolveTransactions = resolve; }));
    recordedDrafts.mockReturnValue(new Promise(resolve => { resolveDrafts = resolve; }));
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(transactions).toHaveBeenCalled());
    unmount();
    await act(async () => {
      resolveTransactions({ ok: true, data: { transactions: [] } });
      resolveDrafts({ ok: true, data: { drafts: [] } });
    });
  });

  it('leaves non-active servers unchanged when merging recorded drafts', async () => {
    const second = { id: 'srv-2', routes: [] } as unknown as ApiMockServerDefinitionV1;
    recordedDrafts.mockResolvedValue({ ok: true, data: { drafts: [{ id: 'd3' }] } });
    mergeRecordedDraftsIntoRoutes.mockReturnValue({ added: 1, routes: [{ id: 'draft-3' }] });
    render(<Probe servers={[server, second]} />);
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent(/Recorded 1 proxied exchange/));
    expect(screen.getByTestId('routes')).toHaveTextContent('1');
  });

  it('acks recorded drafts even when the draft host is missing from the library', async () => {
    // state is live, so the poll proceeds to drafts; the active server is not in
    // the library (servers=[]), so the merge is skipped but the drafts are acked.
    recordedDrafts.mockResolvedValue({
      ok: true,
      data: { drafts: [{ id: 'orphan' }] },
    });
    render(<Probe servers={[]} />);
    await waitFor(() => expect(recordedDrafts).toHaveBeenCalled());
    expect(ackRecordedDrafts).toHaveBeenCalledWith('srv-1', ['orphan']);
    expect(screen.queryByTestId('rt-srv-1')).toBeNull();
  });

  it('does not poll without an active server id', async () => {
    render(<Probe activeServerId="" />);
    await act(async () => {});
    expect(transactions).not.toHaveBeenCalled();
  });
});
