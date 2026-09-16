/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResultsEmptyState } from './ResultsEmptyState';

describe('ResultsEmptyState', () => {
  it('renders an icon, heading, subtitle and Test Runner call to action', () => {
    render(<ResultsEmptyState runTypeFilter="all" onNavigate={vi.fn()} />);

    const panel = screen.getByTestId('results-empty-state');
    expect(panel).toBeInTheDocument();
    expect(panel.querySelector('.results-empty-state-icon-ring')).toBeInTheDocument();
    expect(panel.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeInTheDocument();
    expect(screen.getByText(
      'Run a test from the Test Runner or Parameterized Runner to see results here.',
    )).toBeInTheDocument();
    expect(screen.getByTestId('results-empty-state-cta')).toHaveTextContent('Go to Test Runner');
  });

  it('navigates to the Test Runner when the call to action is used', async () => {
    const onNavigate = vi.fn();
    render(<ResultsEmptyState runTypeFilter="all" onNavigate={onNavigate} />);

    await userEvent.click(screen.getByTestId('results-empty-state-cta'));

    expect(onNavigate).toHaveBeenCalledWith('runner');
  });

  it('sends a workflow-filtered dashboard to the Workflow Runner instead', async () => {
    const onNavigate = vi.fn();
    render(<ResultsEmptyState runTypeFilter="workflow" onNavigate={onNavigate} />);

    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeInTheDocument();
    expect(screen.getByText(
      'Run a workflow from the Workflow Runner to see results here.',
    )).toBeInTheDocument();
    expect(screen.getByTestId('results-empty-state-cta')).toHaveTextContent('Go to Workflow Runner');
    await userEvent.click(screen.getByTestId('results-empty-state-cta'));

    expect(onNavigate).toHaveBeenCalledWith('workflow-runner');
  });

  it('treats a test-filtered dashboard like the unfiltered one', async () => {
    const onNavigate = vi.fn();
    render(<ResultsEmptyState runTypeFilter="test" onNavigate={onNavigate} />);

    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('results-empty-state-cta'));

    expect(onNavigate).toHaveBeenCalledWith('runner');
  });

  it('still explains the empty panel when the host cannot navigate', () => {
    render(<ResultsEmptyState runTypeFilter="all" />);

    expect(screen.getByTestId('results-empty-state')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeInTheDocument();
    expect(screen.queryByTestId('results-empty-state-cta')).not.toBeInTheDocument();
  });

  it('hides its decorative icon from assistive technology', () => {
    render(<ResultsEmptyState runTypeFilter="all" onNavigate={vi.fn()} />);
    expect(
      screen.getByTestId('results-empty-state').querySelector('svg'),
    ).toHaveAttribute('aria-hidden', 'true');
  });
});
