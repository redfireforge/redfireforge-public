import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseKafkaMessageStudioReturn } from '@app/hooks/useKafkaMessageStudio';
import type { UseKafkaStreamModeReturn } from '@app/hooks/useKafkaStreamMode';
import type { KafkaConsumeResultRow } from './types';
import { exportResultSet } from './kafkaMessageStudioUtils';
import { filterIndexedStreamRows } from './kafkaConsumeStreamHelpers';

/**
 * E2E bridge: __kafkaInjectConsumeResults(rows) injects mock rows directly
 * into the consume results without needing a real Kafka cluster.
 */
export function useKafkaConsumeE2eBridge(studio: UseKafkaMessageStudioReturn): void {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__kafkaInjectConsumeResults = (rows: KafkaConsumeResultRow[]) => {
      studio.consumeOnce();
      const studioAny = studio as unknown as Record<string, unknown>;
      if (typeof studioAny.__setConsumeResult === 'function') {
        (studioAny.__setConsumeResult as (r: typeof rows) => void)(rows);
      }
    };
    return () => { delete w.__kafkaInjectConsumeResults; };
  }, [studio]);
}

/**
 * Triggers a re-render every 30s so relative timestamps stay fresh.
 */
export function useRelativeTimestampTick(intervalMs = 30_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

interface UseKafkaConsumeStreamViewArgs {
  streamMode: UseKafkaStreamModeReturn;
  consumeDraftTopic: string;
  clusterId: string;
  consumeDraft: UseKafkaMessageStudioReturn['consumeDraft'];
}

export function useKafkaConsumeStreamView({
  streamMode,
  consumeDraftTopic,
  clusterId,
  consumeDraft,
}: UseKafkaConsumeStreamViewArgs) {
  const streamListRef = useRef<HTMLDivElement>(null);
  const streamActionRowRef = useRef<HTMLDivElement>(null);
  const streamResultsZoneRef = useRef<HTMLDivElement>(null);
  const [streamPinnedToBottom, setStreamPinnedToBottom] = useState(true);
  const [streamSearch, setStreamSearch] = useState('');
  const [streamSearchCaseSensitive, setStreamSearchCaseSensitive] = useState(false);

  useEffect(() => {
    const el = streamListRef.current;
    if (!el || !streamPinnedToBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [streamMode.streamMessages.length, streamPinnedToBottom]);

  const handleStreamScroll = useCallback(() => {
    const el = streamListRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStreamPinnedToBottom(atBottom);
  }, []);

  const scrollStreamToBottom = useCallback(() => {
    const el = streamListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStreamPinnedToBottom(true);
  }, []);

  useEffect(() => {
    if (streamMode.isStreaming) {
      setStreamPinnedToBottom(true);
    }
  }, [streamMode.isStreaming]);

  useEffect(() => {
    if (!streamMode.isStreaming) return;
    const target = streamResultsZoneRef.current;
    if (!target) return;
    const findScrollParent = (el: HTMLElement): HTMLElement | null => {
      let node: HTMLElement | null = el.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY)) return node;
        node = node.parentElement;
      }
      return null;
    };
    const scrollParent = findScrollParent(target) ?? document.documentElement;
    const targetTop = target.getBoundingClientRect().top
      - scrollParent.getBoundingClientRect().top
      + scrollParent.scrollTop
      - 8;
    scrollParent.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, [streamMode.isStreaming]);

  const streamMessagesRef = useRef(streamMode.streamMessages);
  streamMessagesRef.current = streamMode.streamMessages;

  const handleExportStream = useCallback(() => {
    if (streamMessagesRef.current.length > 0) {
      void exportResultSet(streamMessagesRef.current, consumeDraftTopic);
    }
  }, [consumeDraftTopic]);

  const handleClearStream = useCallback(() => {
    setStreamSearch('');
    streamMode.clearStreamMessages();
  }, [streamMode]);

  const handleStartStream = useCallback(() => {
    void streamMode.startStream(consumeDraft, clusterId);
  }, [streamMode, consumeDraft, clusterId]);

  const handleStopStream = useCallback(() => {
    void streamMode.stopStream();
  }, [streamMode]);

  const streamSearchActive = streamSearch.trim().length > 0;
  const filteredStreamRows = filterIndexedStreamRows(
    streamMode.streamMessages,
    streamSearch,
    streamSearchCaseSensitive,
  );

  return {
    streamListRef,
    streamActionRowRef,
    streamResultsZoneRef,
    streamPinnedToBottom,
    streamSearch,
    setStreamSearch,
    streamSearchCaseSensitive,
    setStreamSearchCaseSensitive,
    handleStreamScroll,
    scrollStreamToBottom,
    handleExportStream,
    handleClearStream,
    handleStartStream,
    handleStopStream,
    streamSearchActive,
    filteredStreamRows,
  };
}
