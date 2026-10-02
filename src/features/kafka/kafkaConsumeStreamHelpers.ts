import type { KafkaConsumeResultRow } from './types';
import { matchesKafkaResultSearch } from './kafkaMessageStudioUtils';

export interface IndexedStreamRow {
  row: KafkaConsumeResultRow;
  index: number;
}

export function filterIndexedStreamRows(
  rows: KafkaConsumeResultRow[],
  streamSearch: string,
  caseSensitive = false,
): IndexedStreamRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => matchesKafkaResultSearch(row, streamSearch, caseSensitive));
}

export function formatStreamCountLabel(
  totalMessages: number,
  filteredCount: number,
  streamSearchActive: boolean,
): string {
  if (streamSearchActive) {
    return `${filteredCount} of ${totalMessages} message${totalMessages !== 1 ? 's' : ''}`;
  }
  return `${totalMessages} message${totalMessages !== 1 ? 's' : ''}`;
}

export function getStreamEmptyStateText(isStreaming: boolean): string {
  return isStreaming ? 'Waiting for messages…' : 'No stream messages';
}
