import { describe, expect, it, vi } from 'vitest';
import * as utils from './kafkaMessageStudioUtils';
import {
  filterIndexedStreamRows,
  formatStreamCountLabel,
  getStreamEmptyStateText,
} from './kafkaConsumeStreamHelpers';

describe('kafkaConsumeStreamHelpers coverage gaps', () => {
  it('filters rows and keeps original indices', () => {
    const spy = vi.spyOn(utils, 'matchesKafkaResultSearch').mockImplementation((row, q) => {
      return String(row.topic).includes(q);
    });
    const rows = [
      { topic: 'orders' },
      { topic: 'payments' },
      { topic: 'orders-retry' },
    ] as Array<{ topic: string }> as never;

    const filtered = filterIndexedStreamRows(rows, 'orders');
    expect(filtered).toEqual([
      { row: rows[0], index: 0 },
      { row: rows[2], index: 2 },
    ]);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('can match the value with case sensitivity on or off', () => {
    const rows = [{ topic: 't', partition: 0, offset: '1', value: 'DD' }] as never;
    expect(filterIndexedStreamRows(rows, 'dd', false)).toHaveLength(1);
    expect(filterIndexedStreamRows(rows, 'dd', true)).toHaveLength(0);
  });

  it('formats count labels for filtered and unfiltered views', () => {
    expect(formatStreamCountLabel(5, 2, true)).toBe('2 of 5 messages');
    expect(formatStreamCountLabel(1, 1, true)).toBe('1 of 1 message');
    expect(formatStreamCountLabel(1, 1, false)).toBe('1 message');
    expect(formatStreamCountLabel(3, 3, false)).toBe('3 messages');
  });

  it('returns stream empty state text by streaming status', () => {
    expect(getStreamEmptyStateText(true)).toBe('Waiting for messages…');
    expect(getStreamEmptyStateText(false)).toBe('No stream messages');
  });
});
