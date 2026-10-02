import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dispatchKafkaOperation,
  toKafkaUiSafeError,
  type KafkaUiSafeError,
} from '@shared/kafka/kafkaClient';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';
import type { KafkaConsumeCursor, KafkaConsumeResultRow } from './types';
import { buildConsumeFilter } from './kafkaMessageStudioUtils';

export type TimeWindow = 'latest' | 'last-1h' | 'last-24h' | 'earliest';
export type SortOrder = 'asc' | 'desc';

export interface TopicMessageBrowserDraft {
  groupId: string;
  timeWindow: TimeWindow;
  partition: string;
  timeoutMs: string;
  maxMessages: string;
  keyEquals: string;
  headerMatch: string;
  jsonPath: string;
  jsonPathEquals: string;
  bodyContains: string;
  sortOrder: SortOrder;
}

export interface UseTopicMessageBrowserReturn {
  draft: TopicMessageBrowserDraft;
  setDraft: (patch: Partial<TopicMessageBrowserDraft>) => void;
  loading: boolean;
  result: KafkaConsumeResultRow[] | null;
  timedOut: boolean;
  messageCount: number;
  error: KafkaUiSafeError | null;
  selectedIndex: number | null;
  selectedMessage: KafkaConsumeResultRow | null;
  selectMessage: (index: number | null) => void;
  consumeOnce: () => Promise<void>;
  clearResult: () => void;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadMoreLoading: boolean;
}

export interface UseTopicMessageBrowserDeps {
  dispatch?: typeof dispatchKafkaOperation;
}

function makeGroupId(): string {
  return `redfireforge-debug-${Math.random().toString(36).slice(2, 10)}`;
}

function recentWindowMs(timeWindow: TimeWindow): number | null {
  if (timeWindow === 'last-1h') return 3_600_000;
  if (timeWindow === 'last-24h') return 86_400_000;
  return null;
}

function keepRowsInTimeWindow(
  rows: KafkaConsumeResultRow[],
  timeWindow: TimeWindow,
  now = Date.now(),
): KafkaConsumeResultRow[] {
  const windowMs = recentWindowMs(timeWindow);
  if (windowMs == null) return rows;
  const cutoff = now - windowMs;
  return rows.filter((row) => {
    const ts = parseInt(row.timestamp ?? '', 10);
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function makeDefaultDraft(): TopicMessageBrowserDraft {
  return {
    groupId: makeGroupId(),
    timeWindow: 'latest',
    partition: '',
    timeoutMs: '10000',
    maxMessages: '50',
    keyEquals: '',
    headerMatch: '',
    jsonPath: '',
    jsonPathEquals: '',
    bodyContains: '',
    sortOrder: 'asc',
  };
}

export function useTopicMessageBrowser(
  topicName: string,
  kafkaState: UseKafkaStateReturn,
  deps?: UseTopicMessageBrowserDeps,
): UseTopicMessageBrowserReturn {
  const dispatch = deps?.dispatch ?? dispatchKafkaOperation;

  const [draft, setDraftState] = useState<TopicMessageBrowserDraft>(makeDefaultDraft);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KafkaConsumeResultRow[] | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<KafkaUiSafeError | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<KafkaConsumeCursor[] | null>(null);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const prevTopicRef = useRef(topicName);

  useEffect(() => {
    if (prevTopicRef.current !== topicName) {
      prevTopicRef.current = topicName;
      setResult(null);
      setError(null);
      setTimedOut(false);
      setSelectedIndex(null);
    }
  }, [topicName]);

  const setDraft = useCallback((patch: Partial<TopicMessageBrowserDraft>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const buildBody = useCallback((seekOffsets?: KafkaConsumeCursor[]) => {
    // Latest and Last 1/24 hours read records already on the topic, starting at
    // the newest. Last 1/24 hours then drops rows older than that window.
    // Earliest starts at the beginning. Waiting at the high watermark returns
    // nothing unless a new record arrives during the timeout.
    const fromBeginning = draft.timeWindow === 'earliest';
    const fetchNewestAvailable = draft.timeWindow !== 'earliest';
    const filter = buildConsumeFilter({
      topic: topicName,
      groupId: draft.groupId,
      startPosition: fromBeginning ? 'earliest' : 'latest',
      timeoutMs: draft.timeoutMs,
      maxMessages: draft.maxMessages,
      keyEquals: draft.keyEquals,
      headerMatch: draft.headerMatch,
      jsonPath: draft.jsonPath,
      jsonPathEquals: draft.jsonPathEquals,
      bodyContains: draft.bodyContains,
    });

    const body: Record<string, unknown> = {
      clusterId: kafkaState.selectedClusterId ?? '',
      topic: topicName,
      groupId: draft.groupId,
      fromBeginning,
      timeoutMs: parseInt(draft.timeoutMs, 10) || 10_000,
      maxMessages: parseInt(draft.maxMessages, 10) || 50,
    };
    if (draft.partition.trim()) body.partition = parseInt(draft.partition, 10);
    if (filter) body.filter = filter;
    // Server `sortOrder: 'desc'` seeks to high-N (newest available). Always use that for
    // Latest; otherwise honour the user's Sort Order for Earliest / last-* windows.
    if (fetchNewestAvailable || draft.sortOrder === 'desc') {
      body.sortOrder = 'desc';
    }
    if (seekOffsets && seekOffsets.length > 0) body.seekOffsets = seekOffsets;
    return body;
  }, [topicName, draft, kafkaState.selectedClusterId]);

  const consumeOnce = useCallback(async () => {
    if (!topicName.trim()) return;
    setLoading(true);
    setError(null);
    setTimedOut(false);
    setSelectedIndex(null);
    setHasMore(false);
    setNextCursor(null);

    const body = buildBody();

    try {
      const envelope = await dispatch<{
        topic: string;
        messages: KafkaConsumeResultRow[];
        timedOut?: boolean;
        hasMore?: boolean;
        nextCursor?: KafkaConsumeCursor[];
      }>('consume-once', body);

      if (envelope.ok && envelope.data) {
        let rows = keepRowsInTimeWindow(envelope.data.messages ?? [], draft.timeWindow);
        // Newest fetch comes back newest-first; re-order when the user chose Oldest First.
        if (draft.timeWindow !== 'earliest' && draft.sortOrder === 'asc') {
          rows = [...rows].sort((a, b) => parseInt(a.offset, 10) - parseInt(b.offset, 10));
        }
        setResult(rows);
        setTimedOut(envelope.data.timedOut === true);
        setHasMore(envelope.data.hasMore ?? false);
        setNextCursor(envelope.data.nextCursor ?? null);
      }
    } catch (err) {
      setError(toKafkaUiSafeError(err, 'consume-once'));
    } finally {
      setLoading(false);
    }
  }, [topicName, draft, buildBody, dispatch]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || nextCursor.length === 0) return;
    setLoadMoreLoading(true);
    try {
      const body = buildBody(nextCursor);
      const envelope = await dispatch<{
        messages: KafkaConsumeResultRow[];
        hasMore?: boolean;
        nextCursor?: KafkaConsumeCursor[];
      }>('consume-once', body);
      if (envelope.ok && envelope.data) {
        const more = keepRowsInTimeWindow(envelope.data.messages ?? [], draft.timeWindow);
        setResult((prev) => (prev ? [...prev, ...more] : more));
        setHasMore(envelope.data.hasMore ?? false);
        setNextCursor(envelope.data.nextCursor ?? null);
      }
    } catch (err) {
      setError(toKafkaUiSafeError(err, 'consume-once'));
    } finally {
      setLoadMoreLoading(false);
    }
  }, [nextCursor, buildBody, dispatch, draft.timeWindow]);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
    setTimedOut(false);
    setSelectedIndex(null);
    setHasMore(false);
    setNextCursor(null);
  }, []);

  const selectMessage = useCallback((index: number | null) => {
    setSelectedIndex(index);
  }, []);

  const selectedMessage = selectedIndex !== null && result ? result[selectedIndex] ?? null : null;
  const messageCount = result?.length ?? 0;

  return {
    draft, setDraft,
    loading, result, timedOut, messageCount,
    error,
    selectedIndex, selectedMessage, selectMessage,
    consumeOnce, clearResult,
    hasMore, loadMore, loadMoreLoading,
  };
}
