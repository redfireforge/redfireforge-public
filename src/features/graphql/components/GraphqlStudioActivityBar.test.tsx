/**
 * @vitest-environment jsdom
 *
 * GraphqlStudioActivityBar — unit tests.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
  isDesktopRuntimeAvailable: vi.fn(() => false),
}));

vi.mock('../utils/gqlActivityBarUtils', () => ({
  persistActivityTab: vi.fn(),
}));

import { isDesktopRuntimeAvailable } from '@shared/utils/platform';
import { persistActivityTab } from '../utils/gqlActivityBarUtils';
import { GraphqlStudioActivityBar } from './GraphqlStudioActivityBar';

const mockIsDesktopRuntimeAvailable = vi.mocked(isDesktopRuntimeAvailable);
const mockPersist = vi.mocked(persistActivityTab);

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDesktopRuntimeAvailable.mockReturnValue(false);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GraphqlStudioActivityBar — rendering', () => {
  it('renders all three activity tabs', () => {
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    expect(screen.getByTestId('gql-activity-history')).not.toBeNull();
    expect(screen.getByTestId('gql-activity-collections')).not.toBeNull();
    expect(screen.getByTestId('gql-activity-mock')).not.toBeNull();
  });

  it('renders the activity bar container with correct role', () => {
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    const bar = screen.getByTestId('gql-activity-bar');
    expect(bar.getAttribute('role')).toBe('tablist');
  });

  it('marks history tab as active when activeTab=history', () => {
    render(<GraphqlStudioActivityBar activeTab="history" onTabChange={vi.fn()} />);
    const historyBtn = screen.getByTestId('gql-activity-history');
    expect(historyBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('marks collections tab as active when activeTab=collections', () => {
    render(<GraphqlStudioActivityBar activeTab="collections" onTabChange={vi.fn()} />);
    const collectionsBtn = screen.getByTestId('gql-activity-collections');
    expect(collectionsBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('marks no tab as active when activeTab=null', () => {
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    const historyBtn = screen.getByTestId('gql-activity-history');
    const collectionsBtn = screen.getByTestId('gql-activity-collections');
    expect(historyBtn.getAttribute('aria-selected')).toBe('false');
    expect(collectionsBtn.getAttribute('aria-selected')).toBe('false');
  });

  it('disables mock tab on hosted web', () => {
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    const mockBtn = screen.getByTestId('gql-activity-mock');
    expect(mockBtn).toHaveProperty('disabled', true);
  });

  it('enables mock tab when desktop runtime is available', () => {
    mockIsDesktopRuntimeAvailable.mockReturnValue(true);
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    const mockBtn = screen.getByTestId('gql-activity-mock');
    expect(mockBtn).toHaveProperty('disabled', false);
  });
});

describe('GraphqlStudioActivityBar — tab click behavior', () => {
  it('calls onTabChange with the clicked tab when no tab is active', () => {
    const onTabChange = vi.fn();
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('gql-activity-history'));

    expect(onTabChange).toHaveBeenCalledWith('history');
  });

  it('calls onTabChange with null when clicking the already active tab (toggle off)', () => {
    const onTabChange = vi.fn();
    render(<GraphqlStudioActivityBar activeTab="history" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('gql-activity-history'));

    expect(onTabChange).toHaveBeenCalledWith(null);
  });

  it('persists the tab selection to storage', () => {
    const onTabChange = vi.fn();
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('gql-activity-collections'));

    expect(mockPersist).toHaveBeenCalledWith('collections');
  });

  it('persists null when toggling off', () => {
    const onTabChange = vi.fn();
    render(<GraphqlStudioActivityBar activeTab="collections" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('gql-activity-collections'));

    expect(mockPersist).toHaveBeenCalledWith(null);
  });

  it('does NOT call onTabChange when clicking disabled mock tab in web mode', () => {
    const onTabChange = vi.fn();
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('gql-activity-mock'));

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('calls onTabChange for mock tab when desktop runtime is available', () => {
    mockIsDesktopRuntimeAvailable.mockReturnValue(true);
    const onTabChange = vi.fn();
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('gql-activity-mock'));

    expect(onTabChange).toHaveBeenCalledWith('mock');
  });

  it('shows desktop mock label when runtime is available', () => {
    mockIsDesktopRuntimeAvailable.mockReturnValue(true);
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    const mockBtn = screen.getByTestId('gql-activity-mock');
    expect(mockBtn.getAttribute('aria-label')).toBe('Mock');
  });

  it('shows web-mode mock label in web mode', () => {
    render(<GraphqlStudioActivityBar activeTab={null} onTabChange={vi.fn()} />);
    const mockBtn = screen.getByTestId('gql-activity-mock');
    expect(mockBtn.getAttribute('aria-label')).toBe('Mock (desktop only)');
  });
});
