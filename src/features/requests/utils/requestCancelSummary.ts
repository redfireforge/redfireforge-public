import type { HttpResponse } from '@shared/utils/httpClient';

export const REQUEST_CANCELLED_MESSAGE = 'Request was cancelled';
export const REQUEST_CANCELLED_LEAD = 'Stopped by Cancel request before a response arrived.';

export type CancelledSendPhase = 'preparing' | 'sending';

export interface CancelledSendSummary {
  method: string;
  url: string;
  phase: CancelledSendPhase;
  elapsedMs: number;
  cancelledAt: string;
}

const PHASE_LABEL: Record<CancelledSendPhase, string> = {
  preparing: 'Preparing request',
  sending: 'Sending request',
};

export function cancelledPhaseLabel(phase: CancelledSendPhase): string {
  return PHASE_LABEL[phase];
}

export function formatCancelledElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

export type RequestSendPhase = CancelledSendPhase;
export const requestSendPhaseLabel = cancelledPhaseLabel;
export const formatSendingElapsed = formatCancelledElapsed;

export function buildCancelledSendSummary(input: CancelledSendSummary): CancelledSendSummary {
  return {
    method: input.method || 'GET',
    url: input.url,
    phase: input.phase,
    elapsedMs: Math.max(0, input.elapsedMs),
    cancelledAt: input.cancelledAt,
  };
}

export function formatCancelledPreview(summary: CancelledSendSummary): string {
  const s = buildCancelledSendSummary(summary);
  return [
    REQUEST_CANCELLED_MESSAGE,
    '',
    REQUEST_CANCELLED_LEAD,
    '',
    `Request: ${s.method} ${s.url}`,
    `Stopped during: ${cancelledPhaseLabel(s.phase)}`,
    `Elapsed: ${formatCancelledElapsed(s.elapsedMs)}`,
    'Received: 0 B',
    `Cancelled at: ${s.cancelledAt}`,
  ].join('\n');
}

export function cancelledConsoleNotes(summary: CancelledSendSummary): string[] {
  const s = buildCancelledSendSummary(summary);
  return [
    REQUEST_CANCELLED_MESSAGE,
    `Stopped by user during ${cancelledPhaseLabel(s.phase)} after ${formatCancelledElapsed(s.elapsedMs)}`,
    'No response received',
  ];
}

export function isCancelledSendError(error?: string): boolean {
  return Boolean(error?.startsWith(REQUEST_CANCELLED_MESSAGE));
}

export function parseCancelledPreviewFacts(error: string): { label: string; value: string }[] {
  const labels = new Set(['Request', 'Stopped during', 'Elapsed', 'Received', 'Cancelled at']);
  const facts: { label: string; value: string }[] = [];
  for (const line of error.split('\n')) {
    const sep = line.indexOf(': ');
    if (sep === -1) continue;
    const label = line.slice(0, sep);
    if (!labels.has(label)) continue;
    facts.push({ label, value: line.slice(sep + 2) });
  }
  return facts;
}

export function buildCancelledSendResponse(summary?: CancelledSendSummary): HttpResponse {
  return {
    status: 0,
    statusText: 'Error',
    headers: {},
    body: '',
    error: summary ? formatCancelledPreview(summary) : REQUEST_CANCELLED_MESSAGE,
  };
}
