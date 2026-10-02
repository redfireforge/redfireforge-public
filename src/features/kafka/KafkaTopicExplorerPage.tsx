import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';
import { KafkaStudioGuard } from './KafkaStudioGuard';
import { useTopicExplorer } from './useTopicExplorer';
import type { TopicHealthFilter, TopicPartitionBucket, TopicRetentionBucket } from './useTopicExplorer';
import { useTopicMessageBrowser } from './useTopicMessageBrowser';
import { KafkaTopicDetailPanel } from './KafkaTopicDetailPanel';
import { useCallback, useEffect, useMemo, useState } from 'react';

type FilterDropdownKey = 'health' | 'partition' | 'retention';

interface FilterDropdownOption<T extends string> {
  value: T;
  label: string;
}

interface FilterDropdownProps<T extends string> {
  id: FilterDropdownKey;
  value: T;
  options: FilterDropdownOption<T>[];
  isOpen: boolean;
  onToggle: (id: FilterDropdownKey) => void;
  onSelect: (value: T) => void;
  disabled?: boolean;
  title?: string;
  testId: string;
}

function FilterDropdown<T extends string>({
  id,
  value,
  options,
  isOpen,
  onToggle,
  onSelect,
  disabled = false,
  title,
  testId,
}: FilterDropdownProps<T>) {
  const selected = useMemo(() => options.find((opt) => opt.value === value) ?? options[0], [options, value]);

  return (
    <div className="kafka-explorer-filter-dropdown">
      <button
        type="button"
        className={`kafka-explorer-filter-trigger${disabled ? ' disabled' : ''}`}
        onClick={() => { if (!disabled) onToggle(id); }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        title={title}
        data-testid={testId}
      >
        <span>{selected?.label ?? value}</span>
        <span className="kafka-explorer-filter-chevron" aria-hidden>▾</span>
      </button>

      {isOpen && !disabled && (
        <div className="kafka-explorer-filter-menu" role="listbox" aria-label={`${id} filter options`}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`kafka-explorer-filter-option${opt.value === value ? ' active' : ''}`}
              role="option"
              aria-selected={opt.value === value}
              onClick={() => onSelect(opt.value)}
              data-testid={`${testId}-opt-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface KafkaTopicExplorerPageProps {
  kafkaState: UseKafkaStateReturn;
  onNavigateToKafkaSettings: () => void;
}

export interface KafkaTopicExplorerContentProps {
  kafkaState: UseKafkaStateReturn;
}

function formatTraffic(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function KafkaTopicExplorerContent({ kafkaState }: KafkaTopicExplorerContentProps) {
  const explorer = useTopicExplorer(kafkaState);
  const topicName = explorer.selectedTopicName ?? '';
  const browser = useTopicMessageBrowser(topicName, kafkaState);
  const [openFilter, setOpenFilter] = useState<FilterDropdownKey | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);

  useEffect(() => {
    if (!openFilter) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.kafka-explorer-filter-dropdown')) {
        setOpenFilter(null);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenFilter(null);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [openFilter]);

  const healthOptions: FilterDropdownOption<TopicHealthFilter>[] = [
    { value: 'all', label: 'Health: All' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'degraded', label: 'Warning' },
    { value: 'unknown', label: 'Unknown' },
  ];
  const partitionOptions: FilterDropdownOption<TopicPartitionBucket>[] = [
    { value: 'any', label: 'Parts: Any' },
    { value: '1-4', label: '1-4' },
    { value: '5-12', label: '5-12' },
    { value: '12+', label: '12+' },
  ];
  const retentionOptions: FilterDropdownOption<TopicRetentionBucket>[] = [
    { value: 'any', label: 'Retention: Any' },
    { value: '<1d', label: '< 1 day' },
    { value: '1-7d', label: '1-7 days' },
    { value: '>7d', label: '> 7 days' },
  ];

  const handleRowClick = useCallback((name: string) => {
    void explorer.selectTopic(explorer.selectedTopicName === name ? null : name);
  }, [explorer]);

  return (
    <div
      className={`kafka-explorer-layout${listCollapsed ? ' kafka-explorer-layout--collapsed' : ''}`}
      data-testid="topic-explorer-page"
    >
      <div className="kafka-explorer-list-card" data-testid="topic-list-panel">
        <div className="kafka-explorer-list-header">
          <span className="kafka-ms-card-title">Topics</span>
          <span className="kafka-ms-card-subtitle">{explorer.filteredTopics.length} of {kafkaState.topics.length}</span>
        </div>

        <div className="kafka-explorer-filters">
          <input
            type="text"
            className="kafka-explorer-search"
            placeholder="Search topics…"
            value={explorer.searchText}
            onChange={(e) => explorer.setSearchText(e.target.value)}
            data-testid="topic-search"
          />
          <div className="kafka-explorer-filter-row" data-testid="topic-filter-row">
            <FilterDropdown
              id="health"
              value={explorer.healthFilter}
              options={healthOptions}
              isOpen={openFilter === 'health'}
              onToggle={setOpenFilter}
              onSelect={(next) => {
                explorer.setHealthFilter(next);
                setOpenFilter(null);
              }}
              disabled={!explorer.hasCachedDetails}
              title={explorer.hasCachedDetails ? undefined : 'Load a topic to populate this filter'}
              testId="health-filter"
            />
            <FilterDropdown
              id="partition"
              value={explorer.partitionFilter}
              options={partitionOptions}
              isOpen={openFilter === 'partition'}
              onToggle={setOpenFilter}
              onSelect={(next) => {
                explorer.setPartitionFilter(next);
                setOpenFilter(null);
              }}
              testId="partition-filter"
            />
            <FilterDropdown
              id="retention"
              value={explorer.retentionFilter}
              options={retentionOptions}
              isOpen={openFilter === 'retention'}
              onToggle={setOpenFilter}
              onSelect={(next) => {
                explorer.setRetentionFilter(next);
                setOpenFilter(null);
              }}
              disabled={!explorer.hasCachedDetails}
              title={explorer.hasCachedDetails ? undefined : 'Load a topic to populate this filter'}
              testId="retention-filter"
            />
            <label className="kafka-explorer-internal-toggle">
              <input type="checkbox" checked={explorer.showInternal} onChange={(e) => explorer.setShowInternal(e.target.checked)} />
              Internal
            </label>
          </div>
        </div>

        <div className="kafka-explorer-chipbar" data-testid="domain-chips">
          <button
            className={`kafka-topic-chip ${!explorer.domainChip ? 'active' : ''}`}
            onClick={() => explorer.setDomainChip(null)}
          >
            All
          </button>
          {explorer.domainChips.map((chip) => (
            <button
              key={chip}
              className={`kafka-topic-chip ${explorer.domainChip === chip ? 'active' : ''}`}
              onClick={() => explorer.setDomainChip(explorer.domainChip === chip ? null : chip)}
            >
              {chip}
            </button>
          ))}
          <button
            className={`kafka-topic-chip kafka-topic-chip-special ${explorer.domainChip === '__active' ? 'active' : ''} ${!explorer.hasCachedDetails ? 'disabled' : ''}`}
            onClick={() => explorer.hasCachedDetails && explorer.setDomainChip(explorer.domainChip === '__active' ? null : '__active')}
            title={explorer.hasCachedDetails ? 'Topics with messages' : 'Load a topic to populate this filter'}
            disabled={!explorer.hasCachedDetails}
          >
            Recently Active
          </button>
          <button
            className={`kafka-topic-chip kafka-topic-chip-special ${explorer.domainChip === '__lagging' ? 'active' : ''} ${!explorer.hasCachedDetails ? 'disabled' : ''}`}
            onClick={() => explorer.hasCachedDetails && explorer.setDomainChip(explorer.domainChip === '__lagging' ? null : '__lagging')}
            title={explorer.hasCachedDetails ? 'Topics with lagging consumers' : 'Load a topic to populate this filter'}
            disabled={!explorer.hasCachedDetails}
          >
            Lagging Consumers
          </button>
        </div>

        <div className="kafka-explorer-table-wrap" data-testid="topic-table-wrap">
          <table className="kafka-explorer-topic-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Parts</th>
                <th>Repl</th>
                <th>Traffic</th>
                <th>CGs</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {explorer.filteredTopics.length === 0 ? (
                <tr><td colSpan={6} className="kafka-ms-empty-state">No topics match the current filters</td></tr>
              ) : (
                explorer.filteredTopics.map((t) => {
                  const cached = explorer.detailCache.get(t.name);
                  const isSelected = explorer.selectedTopicName === t.name;
                  return (
                    <tr
                      key={t.name}
                      className={isSelected ? 'selected' : ''}
                      onClick={() => handleRowClick(t.name)}
                      style={{ cursor: 'pointer' }}
                      data-testid={`topic-row-${t.name}`}
                    >
                      <td>
                        <div className="kafka-explorer-topic-name">{t.name}</div>
                        {t.isInternal && <span className="kafka-topic-kind-badge">Internal</span>}
                      </td>
                      <td>{t.partitions}</td>
                      <td>{cached ? cached.replicationFactor : '—'}</td>
                      <td>{cached ? formatTraffic(cached.partitions.reduce((s, p) => s + p.messageCount, 0)) : '—'}</td>
                      <td>{cached ? (cached.groupsPending ? '…' : cached.consumerGroups.length) : '—'}</td>
                      <td>
                        {cached ? (
                          <span className={`kafka-topic-health-badge kafka-topic-health-${cached.healthStatus}`}>
                            {cached.healthStatus === 'healthy' ? '● OK' : cached.healthStatus === 'degraded' ? '⚠ Warn' : '?'}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <button
        type="button"
        className="kafka-explorer-divider-btn"
        onClick={() => setListCollapsed((v) => !v)}
        aria-label={listCollapsed ? 'Expand topic list' : 'Collapse topic list'}
        title={listCollapsed ? 'Expand topic list' : 'Collapse topic list'}
        data-testid="topic-list-collapse-btn"
      >
        <span aria-hidden="true">{listCollapsed ? '▶' : '◀'}</span>
      </button>

      <div className="kafka-explorer-detail-slot">
        {explorer.selectedTopicName ? (
          <KafkaTopicDetailPanel
            detail={explorer.selectedDetail}
            loading={explorer.detailLoading}
            error={explorer.detailError}
            browser={browser}
          />
        ) : (
          <div className="kafka-explorer-detail-empty" data-testid="topic-detail-empty">
            Select a topic to inspect messages, partitions, and consumer groups.
          </div>
        )}
      </div>
    </div>
  );
}

export function KafkaTopicExplorerPage({ kafkaState, onNavigateToKafkaSettings }: KafkaTopicExplorerPageProps) {
  if (!kafkaState.loaded) {
    return <div className="kafka-message-studio-page"><p className="kafka-ms-loading">Loading Kafka settings…</p></div>;
  }

  if (kafkaState.connection.state !== 'connected') {
    return (
      <div className="kafka-message-studio-page">
        <KafkaStudioGuard
          connection={kafkaState.connection}
          hasClusters={kafkaState.clusters.length > 0}
          onNavigateToSettings={onNavigateToKafkaSettings}
        />
      </div>
    );
  }

  return <KafkaTopicExplorerContent kafkaState={kafkaState} />;
}
