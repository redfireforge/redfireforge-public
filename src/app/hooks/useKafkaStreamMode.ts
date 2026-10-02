import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dispatchKafkaOperation,
  envelopeErrorToUiError,
  toKafkaUiSafeError,
  type KafkaUiSafeError,
} from '@shared/kafka/kafkaClient';
import {
  listenKafkaSubscriptionEnded,
  listenKafkaSubscriptionError,
  listenKafkaSubscriptionMessage,
  type KafkaSubscriptionEnded,
  type KafkaSubscriptionError,
  type KafkaSubscriptionMessage,
} from '@shared/kafka/kafkaNativeTauriTransport';
import { isTauri } from '@shared/utils/platform';
import type { UseKafkaStateReturn } from './useKafkaState';
import type { KafkaConsumeDraft, KafkaConsumeResultRow } from '../../features/kafka/types';
import { buildSubscribeRequest } from '../../features/kafka/kafkaMessageStudioUtils';

const POLL_INTERVAL_MS = 1000;

export interface UseKafkaStreamModeReturn {
  isStreaming: boolean;
  streamMessages: KafkaConsumeResultRow[];
  streamError: KafkaUiSafeError | null;
  streamSubscriptionId: string | null;
  streamMaxReached: boolean;
  cursorGap: boolean;

  startStream: (draft: KafkaConsumeDraft, clusterId: string) => Promise<void>;
  stopStream: () => Promise<void>;
  clearStreamMessages: () => void;

  selectedStreamIndex: number | null;
  selectedStreamMessage: KafkaConsumeResultRow | null;
  selectStreamMessage: (index: number | null) => void;
}

export interface UseKafkaStreamModeDeps {
  dispatch?: typeof dispatchKafkaOperation;
  /** Desktop tests inject these so the hook does not import the Tauri event API. */
  listenMessages?: (callback: (payload: KafkaSubscriptionMessage) => void) => Promise<() => void>;
  listenErrors?: (callback: (payload: KafkaSubscriptionError) => void) => Promise<() => void>;
  listenEnded?: (callback: (payload: KafkaSubscriptionEnded) => void) => Promise<() => void>;
}

export function useKafkaStreamMode(
  kafkaState: UseKafkaStateReturn,
  deps?: UseKafkaStreamModeDeps,
): UseKafkaStreamModeReturn {
  const dispatch = deps?.dispatch ?? dispatchKafkaOperation;

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamMessages, setStreamMessages] = useState<KafkaConsumeResultRow[]>([]);
  const [streamError, setStreamError] = useState<KafkaUiSafeError | null>(null);
  const [streamSubscriptionId, setStreamSubscriptionId] = useState<string | null>(null);
  const [streamMaxReached, setStreamMaxReached] = useState(false);
  const [cursorGap, setCursorGap] = useState(false);
  const [selectedStreamIndex, setSelectedStreamIndex] = useState<number | null>(null);

  const sinceCursorRef = useRef(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const subscriptionIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const maxMessagesRef = useRef(50);
  const messageCountRef = useRef(0);
  const stopStreamRef = useRef<() => Promise<void>>(async () => {});

  const rememberRows = useCallback((rows: KafkaConsumeResultRow[]) => {
    const room = maxMessagesRef.current - messageCountRef.current;
    if (room <= 0 || rows.length === 0) return;
    const taken = rows.slice(0, room);
    messageCountRef.current += taken.length;
    setStreamMessages((prev) => [...prev, ...taken]);
    if (messageCountRef.current >= maxMessagesRef.current) {
      setStreamMaxReached(true);
      void stopStreamRef.current();
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const stopNativeListen = useCallback(() => {
    const unlisten = unlistenRef.current;
    unlistenRef.current = null;
    if (unlisten) unlisten();
  }, []);

  const pollMessages = useCallback(async () => {
    const subId = subscriptionIdRef.current;
    if (!subId || !isStreamingRef.current) return;

    try {
      const envelope = await dispatch<{
        subscriptionId: string;
        messages: KafkaConsumeResultRow[];
        cursor: number;
        cursorGap?: boolean;
      }>('subscription-messages', {
        subscriptionId: subId,
        sinceCursor: sinceCursorRef.current,
        clusterId: kafkaState.selectedClusterId ?? '',
      });

      if (!isStreamingRef.current) return;

      if (envelope.ok && envelope.data) {
        if (envelope.data.messages.length > 0) {
          rememberRows(envelope.data.messages);
        }
        sinceCursorRef.current = envelope.data.cursor;
        if (envelope.data.cursorGap) {
          setCursorGap(true);
        }
      }
    } catch (err) {
      if (!isStreamingRef.current) return;
      setStreamError(toKafkaUiSafeError(err, 'subscription-messages'));
    }
  }, [dispatch, kafkaState.selectedClusterId, rememberRows]);

  const startStream = useCallback(async (draft: KafkaConsumeDraft, clusterId: string) => {
    if (!draft.topic.trim()) {
      setStreamError({
        kind: 'validation',
        code: 'KAFKA_INVALID_SUBSCRIBE',
        message: 'Topic is required',
        retryable: false,
      });
      return;
    }

    if (kafkaState.connection.state !== 'connected') {
      setStreamError({
        kind: 'cluster',
        code: 'KAFKA_NOT_CONNECTED',
        message: 'Cluster is not connected',
        retryable: false,
      });
      return;
    }

    setStreamError(null);
    setStreamMaxReached(false);
    setCursorGap(false);
    sinceCursorRef.current = 0;
    messageCountRef.current = 0;
    const maxRaw = parseInt(draft.maxMessages, 10);
    maxMessagesRef.current = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 50;

    try {
      const body = buildSubscribeRequest(draft, clusterId);
      const envelope = await dispatch<{
        clusterId?: string;
        subscription: { subscriptionId: string; topic: string; groupId: string; createdAt: string };
      }>('subscribe', body);

      if (!envelope.ok || !envelope.data) {
        setStreamError(envelopeErrorToUiError(envelope, 'Subscribe failed', 'KAFKA_SUBSCRIBE_FAILED'));
        return;
      }

      const subId = envelope.data.subscription.subscriptionId;
      subscriptionIdRef.current = subId;
      isStreamingRef.current = true;
      setStreamSubscriptionId(subId);
      setIsStreaming(true);

      stopPolling();
      stopNativeListen();
      if (isTauri()) {
        const onMessage = deps?.listenMessages ?? listenKafkaSubscriptionMessage;
        const onError = deps?.listenErrors ?? listenKafkaSubscriptionError;
        const onEnded = deps?.listenEnded ?? listenKafkaSubscriptionEnded;
        const stopMessages = await onMessage((msg) => {
          if (!isStreamingRef.current || msg.subscriptionId !== subId) return;
          rememberRows([msg.record]);
        });
        const stopErrors = await onError((err) => {
          if (!isStreamingRef.current || err.subscriptionId !== subId) return;
          setStreamError({
            kind: 'server',
            code: 'KAFKA_SUBSCRIBE_FAILED',
            message: err.message,
            retryable: true,
          });
        });
        const stopEnded = await onEnded((ended) => {
          if (ended.subscriptionId !== subId || ended.reason !== 'max-reached') return;
          setStreamMaxReached(true);
          void stopStreamRef.current();
        });
        unlistenRef.current = () => {
          stopMessages();
          stopErrors();
          stopEnded();
        };
      } else {
        pollingRef.current = setInterval(() => { void pollMessages(); }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setStreamError(toKafkaUiSafeError(err, 'subscribe'));
    }
  }, [kafkaState.connection.state, dispatch, pollMessages, rememberRows, stopPolling, stopNativeListen, deps?.listenMessages, deps?.listenErrors, deps?.listenEnded]);

  const stopStream = useCallback(async () => {
    stopPolling();
    stopNativeListen();
    isStreamingRef.current = false;
    setIsStreaming(false);

    const subId = subscriptionIdRef.current;
    if (subId) {
      try {
        await dispatch('unsubscribe', {
          subscriptionId: subId,
          clusterId: kafkaState.selectedClusterId ?? '',
        });
      } catch {
        // Best-effort unsubscribe — don't block UI
      }
      subscriptionIdRef.current = null;
      setStreamSubscriptionId(null);
    }
  }, [dispatch, kafkaState.selectedClusterId, stopPolling, stopNativeListen]);

  stopStreamRef.current = stopStream;

  const clearStreamMessages = useCallback(() => {
    setStreamMessages([]);
    setStreamMaxReached(false);
    messageCountRef.current = 0;
    setCursorGap(false);
    sinceCursorRef.current = 0;
    setSelectedStreamIndex(null);
  }, []);

  const selectStreamMessage = useCallback((index: number | null) => {
    setSelectedStreamIndex(index);
  }, []);

  // Auto-stop on disconnect
  useEffect(() => {
    if (kafkaState.connection.state !== 'connected' && isStreamingRef.current) {
      stopPolling();
      stopNativeListen();
      isStreamingRef.current = false;
      setIsStreaming(false);
      subscriptionIdRef.current = null;
      setStreamSubscriptionId(null);
      setStreamError(null);
    }
  }, [kafkaState.connection.state, stopPolling, stopNativeListen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopNativeListen();
      isStreamingRef.current = false;
    };
  }, [stopPolling, stopNativeListen]);

  const selectedStreamMessage =
    selectedStreamIndex !== null && streamMessages[selectedStreamIndex]
      ? streamMessages[selectedStreamIndex]
      : null;

  return {
    isStreaming,
    streamMessages,
    streamError,
    streamSubscriptionId,
    streamMaxReached,
    cursorGap,
    startStream,
    stopStream,
    clearStreamMessages,
    selectedStreamIndex,
    selectedStreamMessage,
    selectStreamMessage,
  };
}
