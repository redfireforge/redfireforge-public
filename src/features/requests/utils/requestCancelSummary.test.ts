/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  REQUEST_CANCELLED_MESSAGE,
  REQUEST_CANCELLED_LEAD,
  buildCancelledSendResponse,
  buildCancelledSendSummary,
  cancelledConsoleNotes,
  formatCancelledElapsed,
  formatCancelledPreview,
  isCancelledSendError,
  parseCancelledPreviewFacts,
} from './requestCancelSummary';

const sample = buildCancelledSendSummary({
  method: 'GET',
  url: 'https://api.example.com/offers',
  phase: 'sending',
  elapsedMs: 13884,
  cancelledAt: '2026-09-21T10:49:51.000Z',
});

describe('requestCancelSummary', () => {
  it('formats elapsed like Insomnia tenths of a second', () => {
    expect(formatCancelledElapsed(0)).toBe('0.0 s');
    expect(formatCancelledElapsed(13884)).toBe('13.9 s');
  });

  it('builds a preview with request, phase, elapsed, and timestamp', () => {
    const text = formatCancelledPreview(sample);
    expect(text.startsWith(REQUEST_CANCELLED_MESSAGE)).toBe(true);
    expect(text).toContain(REQUEST_CANCELLED_LEAD);
    expect(text).toContain('Request: GET https://api.example.com/offers');
    expect(text).toContain('Stopped during: Sending request');
    expect(text).toContain('Elapsed: 13.9 s');
    expect(text).toContain('Received: 0 B');
    expect(text).toContain('Cancelled at: 2026-09-21T10:49:51.000Z');
  });

  it('adds console notes after the Insomnia cancel line', () => {
    expect(cancelledConsoleNotes(sample)).toEqual([
      REQUEST_CANCELLED_MESSAGE,
      'Stopped by user during Sending request after 13.9 s',
      'No response received',
    ]);
  });

  it('defaults an empty method and clamps negative elapsed', () => {
    const text = formatCancelledPreview({
      method: '',
      url: 'https://api.example.com/x',
      phase: 'preparing',
      elapsedMs: -20,
      cancelledAt: '2026-09-21T10:00:00.000Z',
    });
    expect(text).toContain('Request: GET https://api.example.com/x');
    expect(text).toContain('Elapsed: 0.0 s');
    expect(text).toContain('Stopped during: Preparing request');
  });

  it('parses labeled facts from the preview text', () => {
    expect(parseCancelledPreviewFacts(formatCancelledPreview(sample))).toEqual([
      { label: 'Request', value: 'GET https://api.example.com/offers' },
      { label: 'Stopped during', value: 'Sending request' },
      { label: 'Elapsed', value: '13.9 s' },
      { label: 'Received', value: '0 B' },
      { label: 'Cancelled at', value: '2026-09-21T10:49:51.000Z' },
    ]);
  });

  it('skips unlabeled and unknown preview lines', () => {
    expect(parseCancelledPreviewFacts([
      REQUEST_CANCELLED_MESSAGE,
      'not a fact',
      'Note: ignore this',
      'Elapsed: 1.0 s',
    ].join('\n'))).toEqual([{ label: 'Elapsed', value: '1.0 s' }]);
  });

  it('detects cancelled errors including the one-line legacy form', () => {
    expect(isCancelledSendError(REQUEST_CANCELLED_MESSAGE)).toBe(true);
    expect(isCancelledSendError(formatCancelledPreview(sample))).toBe(true);
    expect(isCancelledSendError('Cannot send')).toBe(false);
  });

  it('stores the formatted preview on the Error response', () => {
    expect(buildCancelledSendResponse(sample).error).toBe(formatCancelledPreview(sample));
    expect(buildCancelledSendResponse().error).toBe(REQUEST_CANCELLED_MESSAGE);
  });
});
