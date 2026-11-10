import { kafkaBodyHasText } from '@shared/kafka/bodyContainsQuery';
import type { KafkaConsumeResultRow } from './types';
import { matchesKafkaResultSearch } from './kafkaMessageStudioUtils';

export interface IndexedStreamRow {
  row: KafkaConsumeResultRow;
  index: number;
}

function queryText(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function filterIndexedStreamRows(
  rows: KafkaConsumeResultRow[],
  streamSearch: string,
  caseSensitive = false,
  bodyContains = '',
): IndexedStreamRow[] {
  const bodyQuery = queryText(bodyContains);
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => matchesKafkaResultSearch(row, streamSearch, caseSensitive))
    .filter(({ row }) => !bodyQuery || kafkaBodyHasText(row.value ?? '', bodyQuery));
}

/** True when the result search or Body Contains is narrowing the current page. */
export function resultListFilterActive(resultSearch: string | undefined, bodyContains: string | undefined): boolean {
  return queryText(resultSearch).length > 0 || queryText(bodyContains).length > 0;
}

/** Text for the empty state when the current page has rows the filters hide. */
export function describeResultFilter(resultSearch: string | undefined, bodyContains: string | undefined): string {
  return [queryText(resultSearch), queryText(bodyContains)].filter(Boolean).join(' · ');
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
