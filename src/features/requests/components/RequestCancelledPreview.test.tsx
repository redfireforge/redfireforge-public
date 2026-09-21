/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RequestCancelledPreview from './RequestCancelledPreview';
import { REQUEST_CANCELLED_MESSAGE, formatCancelledPreview } from '../utils/requestCancelSummary';

describe('RequestCancelledPreview', () => {
  it('renders the title when only the legacy one-line error is present', () => {
    render(<RequestCancelledPreview error={REQUEST_CANCELLED_MESSAGE} />);
    expect(screen.getByTestId('req-cancelled-preview')).toHaveTextContent(REQUEST_CANCELLED_MESSAGE);
    expect(screen.queryByText('Stopped during')).toBeNull();
  });

  it('renders request, phase, elapsed, and timestamp facts', () => {
    render(<RequestCancelledPreview error={formatCancelledPreview({
      method: 'POST',
      url: 'https://api.example.com/offers',
      phase: 'preparing',
      elapsedMs: 240,
      cancelledAt: '2026-09-21T10:00:00.000Z',
    })} />);
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('POST https://api.example.com/offers')).toBeInTheDocument();
    expect(screen.getByText('Preparing request')).toBeInTheDocument();
    expect(screen.getByText('0.2 s')).toBeInTheDocument();
    expect(screen.getByText('2026-09-21T10:00:00.000Z')).toBeInTheDocument();
  });
});
