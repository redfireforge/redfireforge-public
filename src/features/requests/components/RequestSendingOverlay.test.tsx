/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import RequestSendingOverlay from './RequestSendingOverlay';
import { formatSendingElapsed, requestSendPhaseLabel } from '../utils/requestCancelSummary';

describe('formatSendingElapsed', () => {
  it('formats tenths of a second like Insomnia', () => {
    expect(formatSendingElapsed(0)).toBe('0.0 s');
    expect(formatSendingElapsed(2300)).toBe('2.3 s');
    expect(formatSendingElapsed(-10)).toBe('0.0 s');
  });
});

describe('requestSendPhaseLabel', () => {
  it('names preparing and sending phases', () => {
    expect(requestSendPhaseLabel('preparing')).toBe('Preparing request');
    expect(requestSendPhaseLabel('sending')).toBe('Sending request');
  });
});

describe('RequestSendingOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.mocked(performance.now).mockRestore();
    vi.useRealTimers();
  });

  it('shows Sending request and ticks elapsed time', () => {
    render(<RequestSendingOverlay phase="sending" onCancel={vi.fn()} />);
    expect(screen.getByTestId('req-sending-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('req-sending-label')).toHaveTextContent('Sending request');
    expect(screen.getByTestId('req-sending-elapsed')).toHaveTextContent('0.0 s');

    vi.mocked(performance.now).mockReturnValue(1200);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('req-sending-elapsed')).toHaveTextContent('1.2 s');
    expect(screen.getByTestId('req-sending-elapsed')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows Preparing request before the HTTP call starts', () => {
    render(<RequestSendingOverlay phase="preparing" onCancel={vi.fn()} />);
    expect(screen.getByTestId('req-sending-label')).toHaveTextContent('Preparing request');
    expect(screen.getByText('Sending request')).toBeInTheDocument();
  });

  it('marks preparing complete while sending', () => {
    render(<RequestSendingOverlay phase="sending" onCancel={vi.fn()} />);
    expect(screen.getByText('Preparing request')).toBeInTheDocument();
    expect(screen.getByTestId('req-sending-label')).toHaveTextContent('Sending request');
  });

  it('calls onCancel from Cancel request', () => {
    const onCancel = vi.fn();
    render(<RequestSendingOverlay phase="sending" onCancel={onCancel} />);
    screen.getByTestId('req-sending-cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
