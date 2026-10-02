import { useCallback, useMemo, useState } from 'react';
import { CustomSelect } from '@shared/components/CustomSelect';
import type { KafkaTopicDetail } from './useTopicExplorer';
import type { UseTopicMessageBrowserReturn } from './useTopicMessageBrowser';
import type { TimeWindow } from './useTopicMessageBrowser';
import { valuePreview, exportResultSet } from './kafkaMessageStudioUtils';
import type { KafkaUiSafeError } from '@shared/kafka/kafkaClient';
import KafkaMessageDetailModal from './KafkaMessageDetailModal';

type DetailTab = 'messages' | 'partitions' | 'groups' | 'config';

interface KafkaTopicDetailPanelProps {
  detail: KafkaTopicDetail | null;
  loading: boolean;
  error: KafkaUiSafeError | null;
  browser: UseTopicMessageBrowserReturn;
}

const TIME_WINDOW_OPTIONS = [
  { value: 'latest', label: 'Latest', detail: 'Newest available messages' },
  { value: 'last-1h', label: 'Last 1 Hour', detail: 'Messages from the past hour' },
  { value: 'last-24h', label: 'Last 24 Hours', detail: 'Messages from the past day' },
  { value: 'earliest', label: 'Earliest', detail: 'Replay from the beginning' },
] as const;

const SORT_ORDER_OPTIONS = [
  { value: 'asc', label: 'Oldest First', detail: 'Ascending chronological order' },
  { value: 'desc', label: 'Newest First', detail: 'Descending chronological order' },
] as const;

function formatTimestamp(ts?: string): string {
  if (!ts) return '—';
  const n = parseInt(ts, 10);
  if (isNaN(n) || n <= 0) return '—';
  const d = new Date(n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function stateColor(state: string): string {
  const s = state.toLowerCase();
  if (s === 'stable') return 'kafka-cg-state-green';
  if (s.includes('rebalance') || s.includes('completing')) return 'kafka-cg-state-amber';
  return 'kafka-cg-state-grey';
}

export function KafkaTopicDetailPanel({ detail, loading, error, browser }: KafkaTopicDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('messages');

  const selectedTimeWindow = useMemo(
    () => TIME_WINDOW_OPTIONS.find((option) => option.value === browser.draft.timeWindow)?.value ?? 'latest',
    [browser.draft.timeWindow],
  );

  const partitionOptions = useMemo(
    () => [
      { value: '', label: 'Any', detail: 'All partitions' },
      ...(detail?.partitions ?? []).map((p) => ({
        value: String(p.partitionId),
        label: String(p.partitionId),
        detail: `Partition ${p.partitionId}`,
      })),
    ],
    [detail?.partitions],
  );

  const selectedPartition = useMemo(
    () => (partitionOptions.some((option) => option.value === browser.draft.partition)
      ? browser.draft.partition
      : ''),
    [partitionOptions, browser.draft.partition],
  );

  const selectedSortOrder = useMemo(
    () => SORT_ORDER_OPTIONS.find((option) => option.value === browser.draft.sortOrder)?.value ?? 'asc',
    [browser.draft.sortOrder],
  );

  const handleConsume = useCallback(() => { void browser.consumeOnce(); }, [browser]);
  const handleLoadMore = useCallback(() => { void browser.loadMore(); }, [browser]);
  const handleExport = useCallback(() => {
    if (browser.result) void exportResultSet(browser.result, detail?.name ?? 'topic');
  }, [browser.result, detail?.name]);
  const handleCloseDetail = useCallback(() => {
    browser.selectMessage(null);
  }, [browser]);

  if (loading) {
    return (
      <div className="kafka-explorer-detail-card">
        <div className="kafka-explorer-detail-loading">Loading topic details…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kafka-explorer-detail-card">
        <div className="kafka-ms-inline-error">{error.message}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="kafka-explorer-detail-card">
        <div className="kafka-explorer-detail-empty">Select a topic to view details</div>
      </div>
    );
  }

  const totalMessages = detail.partitions.reduce((sum, p) => sum + p.messageCount, 0);

  return (
    <div className="kafka-explorer-detail-card">
      <div className="kafka-explorer-detail-header">
        <span className="kafka-explorer-detail-title">{detail.name}</span>
        <span className={`kafka-topic-health-badge kafka-topic-health-${detail.healthStatus}`}>
          {detail.healthStatus === 'healthy' ? '● OK' : detail.healthStatus === 'degraded' ? '⚠ Warn' : '? Unknown'}
        </span>
      </div>

      <div className="kafka-explorer-detail-tabs" data-testid="detail-tabs">
        {(['messages', 'partitions', 'groups', 'config'] as DetailTab[]).map((t) => (
          <button
            key={t}
            className={`kafka-explorer-detail-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
            data-testid={`detail-tab-${t}`}
          >
            {t === 'messages' ? 'Messages' : t === 'partitions' ? 'Partitions' : t === 'groups' ? 'Consumer Groups' : 'Config'}
          </button>
        ))}
      </div>

      <div className="kafka-explorer-detail-body">
        {tab === 'messages' && (
          <div data-testid="detail-messages-tab">
            <div className="kafka-explorer-metrics-row">
              <div className="kafka-explorer-metric-box">
                <span className="kafka-explorer-metric-label">Partitions</span>
                <span className="kafka-explorer-metric-value">{detail.partitionCount}</span>
              </div>
              <div className="kafka-explorer-metric-box">
                <span className="kafka-explorer-metric-label">Replication</span>
                <span className="kafka-explorer-metric-value">{detail.replicationFactor}</span>
              </div>
              <div className="kafka-explorer-metric-box">
                <span className="kafka-explorer-metric-label">Total Messages</span>
                <span className="kafka-explorer-metric-value">{formatNumber(totalMessages)}</span>
              </div>
              <div className="kafka-explorer-metric-box">
                <span className="kafka-explorer-metric-label">Consumer Groups</span>
                <span className="kafka-explorer-metric-value">{detail.groupsPending ? '…' : detail.consumerGroups.length}</span>
              </div>
            </div>

            <div className="kafka-ms-form kafka-ms-detail-message-form" data-testid="detail-messages-filters">
              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-time-window">Time Window</label>
                <div className="kafka-ms-form-ctrl">
                  <CustomSelect
                    className="kafka-ms-form-select kafka-ms-form-select--acks"
                    data-testid="detail-time-window"
                    value={selectedTimeWindow}
                    onChange={(v) => browser.setDraft({ timeWindow: v as TimeWindow })}
                    options={[...TIME_WINDOW_OPTIONS]}
                    aria-label="Time Window"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-partition">Partition</label>
                <div className="kafka-ms-form-ctrl">
                  <CustomSelect
                    className="kafka-ms-form-select kafka-ms-form-select--acks"
                    data-testid="detail-partition"
                    value={selectedPartition}
                    onChange={(v) => browser.setDraft({ partition: v })}
                    options={partitionOptions}
                    aria-label="Partition"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-key-match">Key Match</label>
                <div className="kafka-ms-form-ctrl">
                  <input
                    id="detail-key-match"
                    className="kafka-ms-form-input"
                    type="text"
                    placeholder="exact key"
                    value={browser.draft.keyEquals}
                    onChange={(e) => browser.setDraft({ keyEquals: e.target.value })}
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-header-match">Header Match</label>
                <div className="kafka-ms-form-ctrl">
                  <input
                    id="detail-header-match"
                    className="kafka-ms-form-input"
                    type="text"
                    placeholder="key=value"
                    value={browser.draft.headerMatch}
                    onChange={(e) => browser.setDraft({ headerMatch: e.target.value })}
                    data-testid="detail-header-match"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-jsonpath">JSONPath</label>
                <div className="kafka-ms-form-ctrl">
                  <input
                    id="detail-jsonpath"
                    className="kafka-ms-form-input"
                    type="text"
                    placeholder="$.store.name"
                    value={browser.draft.jsonPath}
                    onChange={(e) => browser.setDraft({ jsonPath: e.target.value })}
                    data-testid="detail-jsonpath"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-jsonpath-expected">JSONPath Expected</label>
                <div className="kafka-ms-form-ctrl">
                  <input
                    id="detail-jsonpath-expected"
                    className="kafka-ms-form-input"
                    type="text"
                    placeholder="expected value"
                    value={browser.draft.jsonPathEquals}
                    onChange={(e) => browser.setDraft({ jsonPathEquals: e.target.value })}
                    data-testid="detail-jsonpath-expected"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-body-contains">Body Contains</label>
                <div className="kafka-ms-form-ctrl">
                  <input
                    id="detail-body-contains"
                    className="kafka-ms-form-input"
                    type="text"
                    placeholder="substring match"
                    value={browser.draft.bodyContains}
                    onChange={(e) => browser.setDraft({ bodyContains: e.target.value })}
                    data-testid="detail-body-contains"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-max-messages">Max Messages</label>
                <div className="kafka-ms-form-ctrl kafka-ms-form-ctrl--inline">
                  <input
                    id="detail-max-messages"
                    className="kafka-ms-form-input kafka-ms-form-input--short"
                    type="text"
                    value={browser.draft.maxMessages}
                    onChange={(e) => browser.setDraft({ maxMessages: e.target.value })}
                    data-testid="detail-max-messages"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-timeout">Timeout (ms)</label>
                <div className="kafka-ms-form-ctrl kafka-ms-form-ctrl--inline">
                  <input
                    id="detail-timeout"
                    className="kafka-ms-form-input kafka-ms-form-input--short"
                    type="text"
                    value={browser.draft.timeoutMs}
                    onChange={(e) => browser.setDraft({ timeoutMs: e.target.value })}
                    data-testid="detail-timeout"
                    aria-label="Timeout (ms)"
                  />
                </div>
              </div>

              <div className="kafka-ms-form-row">
                <label className="kafka-ms-form-label" htmlFor="detail-sort-order">Sort Order</label>
                <div className="kafka-ms-form-ctrl">
                  <CustomSelect
                    className="kafka-ms-form-select kafka-ms-form-select--acks"
                    data-testid="detail-sort-order"
                    value={selectedSortOrder}
                    onChange={(v) => browser.setDraft({ sortOrder: v as 'asc' | 'desc' })}
                    options={[...SORT_ORDER_OPTIONS]}
                    aria-label="Sort Order"
                  />
                </div>
              </div>
            </div>

            <div className="kafka-ms-action-row">
              <button className="kafka-ms-primary-btn" disabled={browser.loading} onClick={handleConsume} data-testid="detail-consume-btn">
                {browser.loading ? 'Consuming…' : 'Consume Once'}
              </button>
              {browser.result !== null && (
                <>
                  <button className="kafka-ms-secondary-btn" onClick={handleExport} disabled={browser.messageCount === 0}>Export</button>
                  <button className="kafka-ms-ghost-btn" onClick={browser.clearResult}>Clear</button>
                </>
              )}
            </div>

            {browser.error && (
              <div className="kafka-ms-inline-error">{browser.error.message}</div>
            )}

            {browser.result !== null && !browser.error && (
              <div className="kafka-ms-results-zone" data-testid="detail-results">
                <div className="kafka-ms-results-header">
                  <span className="kafka-ms-results-count">
                    {browser.messageCount} message{browser.messageCount !== 1 ? 's' : ''}
                  </span>
                  {browser.timedOut && <span className="kafka-ms-timed-out-badge">timed out</span>}
                </div>
                {browser.messageCount === 0 ? (
                  <p className="kafka-ms-empty-state">No messages received</p>
                ) : (
                  <div className="kafka-ms-results-table-wrap">
                    <table className="kafka-ms-results-table">
                      <thead>
                        <tr><th>#</th><th>Offset</th><th>Partition</th><th>Timestamp</th><th>Key</th><th>Value</th></tr>
                      </thead>
                      <tbody>
                        {browser.result.map((row, idx) => (
                          <tr
                            key={`${row.partition}-${row.offset}`}
                            className={browser.selectedIndex === idx ? 'selected' : ''}
                            onClick={() => browser.selectMessage(browser.selectedIndex === idx ? null : idx)}
                            style={{ cursor: 'pointer' }}
                            data-testid={`detail-row-${idx}`}
                          >
                            <td>{idx + 1}</td>
                            <td>{row.offset}</td>
                            <td>{row.partition}</td>
                            <td>{formatTimestamp(row.timestamp)}</td>
                            <td>{row.key ?? '—'}</td>
                            <td>{valuePreview(row.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {browser.hasMore && (
                      <div className="kafka-ms-load-more-row" data-testid="detail-load-more-row">
                        <button
                          className="kafka-ms-secondary-btn"
                          onClick={handleLoadMore}
                          disabled={browser.loadMoreLoading}
                          data-testid="detail-load-more-btn"
                        >
                          {browser.loadMoreLoading ? 'Loading…' : 'Load More'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {browser.selectedMessage && (
              <KafkaMessageDetailModal
                message={browser.selectedMessage}
                onClose={handleCloseDetail}
              />
            )}
          </div>
        )}

        {tab === 'partitions' && (
          <div data-testid="detail-partitions-tab">
            <table className="kafka-partition-table">
              <thead>
                <tr><th>Partition</th><th>Leader</th><th>Replicas</th><th>ISR</th><th>Earliest</th><th>Latest</th><th>Messages</th></tr>
              </thead>
              <tbody>
                {detail.partitions.map((p) => (
                  <tr key={p.partitionId}>
                    <td>{p.partitionId}</td>
                    <td>{p.leader}</td>
                    <td>{p.replicas.join(', ')}</td>
                    <td>
                      <span className={`kafka-isr-fraction ${p.isr.length < p.replicas.length ? 'kafka-isr-amber' : ''}`}>
                        {p.isr.length} / {p.replicas.length}
                      </span>
                    </td>
                    <td>{p.earliestOffset}</td>
                    <td>{p.latestOffset}</td>
                    <td>{formatNumber(p.messageCount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}><strong>Total</strong></td>
                  <td><strong>{formatNumber(totalMessages)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {tab === 'groups' && (
          <div data-testid="detail-groups-tab">
            {detail.groupsPending ? (
              <p className="kafka-ms-empty-state">Loading consumer groups…</p>
            ) : detail.consumerGroups.length === 0 ? (
              <p className="kafka-ms-empty-state">No consumer groups found for this topic.</p>
            ) : (
              <table className="kafka-consumer-group-table">
                <thead>
                  <tr><th>Group ID</th><th>State</th><th>Total Lag</th></tr>
                </thead>
                <tbody>
                  {detail.consumerGroups.map((g) => (
                    <tr key={g.groupId}>
                      <td>{g.groupId}</td>
                      <td><span className={`kafka-cg-state-badge ${stateColor(g.state)}`}>{g.state}</span></td>
                      <td className={g.totalLag > 0 ? 'kafka-lag-amber' : 'kafka-lag-green'}>{formatNumber(g.totalLag)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'config' && (
          <div data-testid="detail-config-tab">
            {Object.keys(detail.config).length === 0 ? (
              <p className="kafka-ms-empty-state">No configuration data available.</p>
            ) : (
              <table className="kafka-config-table">
                <thead><tr><th>Config Key</th><th>Value</th></tr></thead>
                <tbody>
                  {Object.entries(detail.config).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
