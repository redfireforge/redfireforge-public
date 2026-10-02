import { useCallback, useMemo, useRef, useState } from 'react';
import {
  dispatchKafkaOperation,
  toKafkaUiSafeError,
  type KafkaUiSafeError,
} from '@shared/kafka/kafkaClient';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';
import type { KafkaTopicSummary } from '@shared/kafka/kafkaConfig';

export type TopicHealthFilter = 'all' | 'healthy' | 'degraded' | 'unknown';
export type TopicPartitionBucket = 'any' | '1-4' | '5-12' | '12+';
export type TopicRetentionBucket = 'any' | '<1d' | '1-7d' | '>7d';

export interface KafkaTopicPartitionDetail {
  partitionId: number;
  leader: number;
  replicas: number[];
  isr: number[];
  earliestOffset: string;
  latestOffset: string;
  messageCount: number;
}

export interface KafkaTopicConsumerGroupSummary {
  groupId: string;
  state: string;
  totalLag: number;
}

export interface KafkaTopicDetail {
  name: string;
  partitionCount: number;
  replicationFactor: number;
  isInternal: boolean;
  partitions: KafkaTopicPartitionDetail[];
  consumerGroups: KafkaTopicConsumerGroupSummary[];
  config: Record<string, string>;
  healthStatus: 'healthy' | 'degraded' | 'unknown';
  /** Desktop fills consumer groups after partitions are already on screen. */
  groupsPending?: boolean;
}

export interface UseTopicExplorerReturn {
  searchText: string;
  setSearchText: (v: string) => void;
  healthFilter: TopicHealthFilter;
  setHealthFilter: (v: TopicHealthFilter) => void;
  partitionFilter: TopicPartitionBucket;
  setPartitionFilter: (v: TopicPartitionBucket) => void;
  retentionFilter: TopicRetentionBucket;
  setRetentionFilter: (v: TopicRetentionBucket) => void;
  showInternal: boolean;
  setShowInternal: (v: boolean) => void;
  domainChip: string | null;
  setDomainChip: (v: string | null) => void;

  filteredTopics: KafkaTopicSummary[];
  domainChips: string[];
  hasCachedDetails: boolean;

  selectedTopicName: string | null;
  selectTopic: (name: string | null) => void;
  detailCache: Map<string, KafkaTopicDetail>;
  selectedDetail: KafkaTopicDetail | null;
  detailLoading: boolean;
  detailError: KafkaUiSafeError | null;
}

export interface UseTopicExplorerDeps {
  dispatch?: typeof dispatchKafkaOperation;
}

function matchesPartitionBucket(count: number, bucket: TopicPartitionBucket): boolean {
  if (bucket === 'any') return true;
  if (bucket === '1-4') return count >= 1 && count <= 4;
  if (bucket === '5-12') return count >= 5 && count <= 12;
  return count > 12;
}

function matchesRetentionBucket(retentionMs: number, bucket: TopicRetentionBucket): boolean {
  if (bucket === 'any') return true;
  if (bucket === '<1d') return retentionMs < 86_400_000;
  if (bucket === '1-7d') return retentionMs >= 86_400_000 && retentionMs <= 604_800_000;
  return retentionMs > 604_800_000;
}

export function useTopicExplorer(
  kafkaState: UseKafkaStateReturn,
  deps?: UseTopicExplorerDeps,
): UseTopicExplorerReturn {
  const dispatch = deps?.dispatch ?? dispatchKafkaOperation;

  const [searchText, setSearchText] = useState('');
  const [healthFilter, setHealthFilter] = useState<TopicHealthFilter>('all');
  const [partitionFilter, setPartitionFilter] = useState<TopicPartitionBucket>('any');
  const [retentionFilter, setRetentionFilter] = useState<TopicRetentionBucket>('any');
  const [showInternal, setShowInternal] = useState(false);
  const [domainChip, setDomainChip] = useState<string | null>(null);

  const [selectedTopicName, setSelectedTopicName] = useState<string | null>(null);
  const detailCacheRef = useRef(new Map<string, KafkaTopicDetail>());
  const [detailCacheVersion, setDetailCacheVersion] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<KafkaUiSafeError | null>(null);

  const domainChips = useMemo(() => {
    const prefixes = new Set<string>();
    for (const t of kafkaState.topics) {
      const dot = t.name.indexOf('.');
      if (dot > 0) prefixes.add(t.name.substring(0, dot));
    }
    return [...prefixes].sort();
  }, [kafkaState.topics]);

  const filteredTopics = useMemo(() => {
    const cache = detailCacheRef.current;
    const lowerSearch = searchText.toLowerCase();
    return kafkaState.topics.filter((t) => {
      if (!showInternal && t.isInternal) return false;
      if (lowerSearch && !t.name.toLowerCase().includes(lowerSearch)) return false;
      if (!matchesPartitionBucket(t.partitions, partitionFilter)) return false;
      if (domainChip) {
        if (domainChip === '__lagging') {
          const detail = cache.get(t.name);
          if (!detail) return false;
          if (!detail.consumerGroups.some((g) => g.totalLag > 0)) return false;
        } else if (domainChip === '__active') {
          const detail = cache.get(t.name);
          if (!detail) return false;
          if (!detail.partitions.some((p) => p.messageCount > 0)) return false;
        } else if (!t.name.startsWith(domainChip + '.')) {
          return false;
        }
      }
      if (healthFilter !== 'all') {
        const detail = cache.get(t.name);
        if (!detail) return healthFilter === 'unknown';
        if (detail.healthStatus !== healthFilter) return false;
      }
      if (retentionFilter !== 'any') {
        const detail = cache.get(t.name);
        if (!detail) return false;
        const ms = parseInt(detail.config['retention.ms'] ?? '', 10);
        if (isNaN(ms)) return false;
        if (!matchesRetentionBucket(ms, retentionFilter)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kafkaState.topics, searchText, healthFilter, partitionFilter, retentionFilter, showInternal, domainChip, detailCacheVersion]);

  const loadTopicGroups = useCallback(async (topicName: string, clusterId: string) => {
    try {
      const envelope = await dispatch<{ consumerGroups: KafkaTopicConsumerGroupSummary[] }>('topic-groups', {
        topicName,
        clusterId,
      });
      const current = detailCacheRef.current.get(topicName);
      if (!current) return;
      detailCacheRef.current.set(topicName, {
        ...current,
        consumerGroups: envelope.ok && envelope.data ? envelope.data.consumerGroups ?? [] : current.consumerGroups,
        groupsPending: false,
      });
      setDetailCacheVersion((v) => v + 1);
    } catch {
      const current = detailCacheRef.current.get(topicName);
      if (!current?.groupsPending) return;
      detailCacheRef.current.set(topicName, { ...current, groupsPending: false });
      setDetailCacheVersion((v) => v + 1);
    }
  }, [dispatch]);

  const selectTopic = useCallback(async (name: string | null) => {
    setSelectedTopicName(name);
    setDetailError(null);
    if (!name) return;

    if (detailCacheRef.current.has(name)) return;

    setDetailLoading(true);
    try {
      const envelope = await dispatch<KafkaTopicDetail>('topic-detail', {
        topicName: name,
        clusterId: kafkaState.selectedClusterId ?? '',
      });
      if (envelope.ok && envelope.data) {
        detailCacheRef.current.set(name, envelope.data);
        setDetailCacheVersion((v) => v + 1);
        if (envelope.data.groupsPending) {
          void loadTopicGroups(name, kafkaState.selectedClusterId ?? '');
        }
      }
    } catch (err) {
      setDetailError(toKafkaUiSafeError(err, 'topic-detail'));
    } finally {
      setDetailLoading(false);
    }
  }, [dispatch, kafkaState.selectedClusterId, loadTopicGroups]);

  const selectedDetail = selectedTopicName ? detailCacheRef.current.get(selectedTopicName) ?? null : null;

  const hasCachedDetails = detailCacheRef.current.size > 0;

  return {
    searchText, setSearchText,
    healthFilter, setHealthFilter,
    partitionFilter, setPartitionFilter,
    retentionFilter, setRetentionFilter,
    showInternal, setShowInternal,
    domainChip, setDomainChip,
    filteredTopics,
    domainChips,
    hasCachedDetails,
    selectedTopicName, selectTopic,
    detailCache: detailCacheRef.current,
    selectedDetail,
    detailLoading, detailError,
  };
}
