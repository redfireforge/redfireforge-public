import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import {
  dispatchKafkaOperation,
  envelopeErrorToUiError,
  toKafkaUiSafeError,
  type KafkaUiSafeError,
} from '@shared/kafka/kafkaClient';
import type { UseKafkaStateReturn } from './useKafkaState';
import type {
  KafkaConsumeCursor,
  KafkaConsumeDraft,
  KafkaConsumeResultRow,
  KafkaPublishDraft,
  KafkaPublishResult,
} from '../../features/kafka/types';
import {
  buildConsumeRequest,
  buildPublishRequest,
  validateAndFormatJson,
} from '../../features/kafka/kafkaMessageStudioUtils';
import { loadKafkaConsumeForm, loadKafkaPublishForm, saveKafkaConsumeForm, saveKafkaPublishForm } from '@shared/kafka/kafkaStorage';

// ── Public interface ───────────────────────────────────────────────────────

export interface UseKafkaMessageStudioReturn {
  // Publish
  publishDraft: KafkaPublishDraft;
  setPublishDraft: (patch: Partial<KafkaPublishDraft>) => void;
  publishLoading: boolean;
  publishResult: KafkaPublishResult | null;
  publishError: KafkaUiSafeError | null;
  sendOnce: () => Promise<void>;
  validateJsonBody: () => boolean;

  // Consume
  consumeDraft: KafkaConsumeDraft;
  setConsumeDraft: (patch: Partial<KafkaConsumeDraft>) => void;
  consumeLoading: boolean;
  consumeResult: KafkaConsumeResultRow[] | null;
  consumeTimedOut: boolean;
  consumeError: KafkaUiSafeError | null;
  selectedMessageIndex: number | null;
  selectedMessage: KafkaConsumeResultRow | null;
  selectMessage: (index: number | null) => void;
  consumeOnce: () => Promise<void>;

  // Pagination
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadMoreLoading: boolean;

  // Utilities / reset
  clearPublishResult: () => void;
  clearConsumeResult: () => void;
  /** 0 before first consume; equals consumeResult?.length ?? 0 */
  consumeMessageCount: number;
}

export interface UseKafkaMessageStudioDeps {
  /** Injectable dispatch for unit tests — defaults to dispatchKafkaOperation. */
  dispatch?: typeof dispatchKafkaOperation;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useKafkaMessageStudio(
  kafkaState: UseKafkaStateReturn,
  deps?: UseKafkaMessageStudioDeps,
): UseKafkaMessageStudioReturn {
  const dispatch = deps?.dispatch ?? dispatchKafkaOperation;

  // ── Publish state ────────────────────────────────────────────────────────
  const [publishDraftState, setPublishDraftState] = useState<KafkaPublishDraft>({
    topic: '',
    key: '',
    keyFormat: 'string',
    partition: '',
    acks: -1,
    timeoutMs: '',
    headers: [],
    body: '',
    bodyFormat: 'json',
  });

  const [publishLoading, setPublishLoading] = useState(false);
  const [publishResult, setPublishResult] = useState<KafkaPublishResult | null>(null);
  const [publishError, setPublishError] = useState<KafkaUiSafeError | null>(null);

  // ── Consume state ────────────────────────────────────────────────────────
  const [consumeDraftState, setConsumeDraftState] = useState<KafkaConsumeDraft>(() => ({
    topic: '',
    groupId: `redfireforge-debug-${uuid().slice(0, 8)}`,
    startPosition: 'latest',
    timeoutMs: '10000',
    maxMessages: '50',
    keyEquals: '',
    headerMatch: '',
    jsonPath: '',
    jsonPathEquals: '',
    bodyContains: '',
  }));

  const [consumeLoading, setConsumeLoading] = useState(false);
  const [consumeResult, setConsumeResult] = useState<KafkaConsumeResultRow[] | null>(null);
  const [consumeTimedOut, setConsumeTimedOut] = useState(false);
  const [consumeError, setConsumeError] = useState<KafkaUiSafeError | null>(null);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<KafkaConsumeCursor[] | null>(null);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const seenConsumeCluster = useRef<string | null>(null);
  const consumeDraftEdited = useRef(false);
  const [consumeTopicReady, setConsumeTopicReady] = useState<string | null>(null);
  const seenPublishCluster = useRef<string | null>(null);
  const publishDraftEdited = useRef(false);
  const [publishFormReady, setPublishFormReady] = useState<string | null>(null);

  const selectedClusterId = kafkaState.selectedClusterId ?? '';

  useEffect(() => {
    let cancelled = false;
    const switching = seenConsumeCluster.current !== null
      && seenConsumeCluster.current !== selectedClusterId;
    setConsumeTopicReady(null);
    void loadKafkaConsumeForm(selectedClusterId).then((saved) => {
      if (cancelled) return;
      setConsumeDraftState((prev) => {
        if (!switching && consumeDraftEdited.current) return prev;
        consumeDraftEdited.current = false;
        if (!saved) {
          if (!switching) return prev;
          return {
            ...prev,
            topic: '',
            startPosition: 'latest',
            timeoutMs: '10000',
            maxMessages: '50',
            keyEquals: '',
            headerMatch: '',
            jsonPath: '',
            jsonPathEquals: '',
            bodyContains: '',
            sortOrder: 'asc',
            schemaConfig: undefined,
          };
        }
        return {
          ...prev,
          topic: saved.topic,
          groupId: saved.groupId || prev.groupId,
          startPosition: saved.startPosition,
          timeoutMs: saved.timeoutMs || prev.timeoutMs,
          maxMessages: saved.maxMessages || prev.maxMessages,
          keyEquals: saved.keyEquals,
          headerMatch: saved.headerMatch,
          jsonPath: saved.jsonPath,
          jsonPathEquals: saved.jsonPathEquals,
          bodyContains: saved.bodyContains,
          sortOrder: saved.sortOrder,
          schemaConfig: saved.schemaConfig,
        };
      });
      seenConsumeCluster.current = selectedClusterId;
      setConsumeTopicReady(selectedClusterId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedClusterId]);

  useEffect(() => {
    if (consumeTopicReady !== selectedClusterId) return;
    const draft = consumeDraftState;
    const handle = window.setTimeout(() => {
      void saveKafkaConsumeForm(selectedClusterId, draft);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [consumeDraftState, selectedClusterId, consumeTopicReady]);

  useEffect(() => {
    if (!selectedClusterId) return;
    let cancelled = false;
    const switching = seenPublishCluster.current !== null
      && seenPublishCluster.current !== selectedClusterId;
    setPublishFormReady(null);
    void loadKafkaPublishForm(selectedClusterId).then((saved) => {
      if (cancelled) return;
      setPublishDraftState((prev) => {
        if (!switching && publishDraftEdited.current) return prev;
        publishDraftEdited.current = false;
        if (!saved) {
          if (!switching) return prev;
          return {
            topic: '',
            key: '',
            keyFormat: 'string',
            partition: '',
            acks: -1,
            timeoutMs: '',
            headers: [],
            body: '',
            bodyFormat: 'json',
          };
        }
        return saved;
      });
      seenPublishCluster.current = selectedClusterId;
      setPublishFormReady(selectedClusterId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedClusterId]);

  useEffect(() => {
    if (!selectedClusterId || publishFormReady !== selectedClusterId) return;
    const draft = publishDraftState;
    const handle = window.setTimeout(() => {
      void saveKafkaPublishForm(selectedClusterId, draft);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [publishDraftState, selectedClusterId, publishFormReady]);

  // ── Setters ──────────────────────────────────────────────────────────────
  const setPublishDraft = useCallback((patch: Partial<KafkaPublishDraft>) => {
    publishDraftEdited.current = true;
    setPublishDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setConsumeDraft = useCallback((patch: Partial<KafkaConsumeDraft>) => {
    consumeDraftEdited.current = true;
    setConsumeDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── validateJsonBody ─────────────────────────────────────────────────────
  const validateJsonBody = useCallback((): boolean => {
    const result = validateAndFormatJson(publishDraftState.body);
    if (result.ok && result.formatted !== undefined) {
      setPublishDraftState((prev) => ({ ...prev, body: result.formatted! }));
    }
    if (!result.ok) {
      setPublishError({
        kind: 'validation',
        code: 'INVALID_JSON',
        message: result.error ?? 'Invalid JSON',
        retryable: false,
      });
    } else {
      // Clear a prior JSON validation error
      setPublishError((prev) =>
        prev?.code === 'INVALID_JSON' ? null : prev,
      );
    }
    return result.ok;
  }, [publishDraftState.body]);

  // ── sendOnce ─────────────────────────────────────────────────────────────
  const sendOnce = useCallback(async () => {
    const clusterId = kafkaState.selectedClusterId ?? '';
    setPublishResult(null);
    setPublishError(null);

    // Validate JSON body before sending — only applies when bodyFormat is 'json'
    if (publishDraftState.bodyFormat === 'json' && publishDraftState.body.trim()) {
      const jsonResult = validateAndFormatJson(publishDraftState.body);
      if (!jsonResult.ok) {
        setPublishError({
          kind: 'validation',
          code: 'INVALID_JSON',
          message: jsonResult.error ?? 'Invalid JSON',
          retryable: false,
        });
        return;
      }
    }

    setPublishLoading(true);
    try {
      const body = buildPublishRequest(publishDraftState, clusterId);
      const envelope = await dispatch<KafkaPublishResult>('produce', body);
      if (!envelope.ok || !envelope.data) {
        setPublishError(envelopeErrorToUiError(envelope, 'Produce failed', 'PRODUCE_FAILED'));
        return;
      }
      setPublishResult(envelope.data);
    } catch (err) {
      setPublishError(toKafkaUiSafeError(err, 'produce'));
    } finally {
      setPublishLoading(false);
    }
  }, [kafkaState.selectedClusterId, publishDraftState, dispatch]);

  // ── consumeOnce ──────────────────────────────────────────────────────────
  const consumeOnce = useCallback(async () => {
    const clusterId = kafkaState.selectedClusterId ?? '';
    setConsumeLoading(true);
    setConsumeResult(null);
    setConsumeError(null);
    setConsumeTimedOut(false);
    setSelectedMessageIndex(null);
    setHasMore(false);
    setNextCursor(null);
    try {
      const body = buildConsumeRequest(consumeDraftState, clusterId);
      const envelope = await dispatch<{
        messageCount: number;
        messages: KafkaConsumeResultRow[];
        timedOut: boolean;
        hasMore?: boolean;
        nextCursor?: KafkaConsumeCursor[];
      }>('consume-once', body);
      if (!envelope.ok || !envelope.data) {
        setConsumeError(envelopeErrorToUiError(envelope, 'Consume failed', 'CONSUME_FAILED'));
        return;
      }
      setConsumeResult(envelope.data.messages);
      setConsumeTimedOut(envelope.data.timedOut);
      setHasMore(envelope.data.hasMore ?? false);
      setNextCursor(envelope.data.nextCursor ?? null);
    } catch (err) {
      setConsumeError(toKafkaUiSafeError(err, 'consume-once'));
    } finally {
      setConsumeLoading(false);
    }
  }, [kafkaState.selectedClusterId, consumeDraftState, dispatch]);

  // ── loadMore (pagination) ───────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!nextCursor || nextCursor.length === 0) return;
    const clusterId = kafkaState.selectedClusterId ?? '';
    setLoadMoreLoading(true);
    try {
      const body = buildConsumeRequest(consumeDraftState, clusterId, nextCursor);
      const envelope = await dispatch<{
        messageCount: number;
        messages: KafkaConsumeResultRow[];
        timedOut: boolean;
        hasMore?: boolean;
        nextCursor?: KafkaConsumeCursor[];
      }>('consume-once', body);
      if (!envelope.ok || !envelope.data) {
        setConsumeError(envelopeErrorToUiError(envelope, 'Load more failed', 'CONSUME_FAILED'));
        return;
      }
      setConsumeResult((prev) =>
        prev ? [...prev, ...envelope.data!.messages] : envelope.data!.messages,
      );
      setHasMore(envelope.data.hasMore ?? false);
      setNextCursor(envelope.data.nextCursor ?? null);
    } catch (err) {
      setConsumeError(toKafkaUiSafeError(err, 'consume-once'));
    } finally {
      setLoadMoreLoading(false);
    }
  }, [kafkaState.selectedClusterId, consumeDraftState, nextCursor, dispatch]);

  // ── Utilities ────────────────────────────────────────────────────────────
  const clearPublishResult = useCallback(() => {
    setPublishResult(null);
    setPublishError(null);
  }, []);

  const clearConsumeResult = useCallback(() => {
    setConsumeResult(null);
    setConsumeError(null);
    setConsumeTimedOut(false);
    setSelectedMessageIndex(null);
    setHasMore(false);
    setNextCursor(null);
  }, []);

  const selectMessage = useCallback((index: number | null) => {
    setSelectedMessageIndex(index);
  }, []);

  const selectedMessage =
    selectedMessageIndex !== null && consumeResult
      ? (consumeResult[selectedMessageIndex] ?? null)
      : null;

  const consumeMessageCount = consumeResult?.length ?? 0;

  return {
    publishDraft: publishDraftState,
    setPublishDraft,
    publishLoading,
    publishResult,
    publishError,
    sendOnce,
    validateJsonBody,

    consumeDraft: consumeDraftState,
    setConsumeDraft,
    consumeLoading,
    consumeResult,
    consumeTimedOut,
    consumeError,
    selectedMessageIndex,
    selectedMessage,
    selectMessage,
    consumeOnce,

    hasMore,
    loadMore,
    loadMoreLoading,

    clearPublishResult,
    clearConsumeResult,
    consumeMessageCount,
  };
}
