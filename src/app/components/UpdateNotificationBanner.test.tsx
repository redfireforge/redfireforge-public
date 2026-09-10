/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateNotificationBanner } from './UpdateNotificationBanner';
import type { AppUpdaterState } from '../hooks/useAppUpdater';

const mockUseAppUpdater = vi.fn<[], AppUpdaterState>();
vi.mock('../hooks/useAppUpdater', () => ({
  useAppUpdater: () => mockUseAppUpdater(),
}));

function makeState(overrides: Partial<AppUpdaterState> = {}): AppUpdaterState {
  return {
    status: 'idle',
    mode: 'tauri',
    updateInfo: null,
    downloadProgress: 0,
    errorMessage: null,
    installUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
    ...overrides,
  };
}

describe('UpdateNotificationBanner', () => {
  beforeEach(() => {
    mockUseAppUpdater.mockReset();
  });

  it('renders nothing when idle', () => {
    mockUseAppUpdater.mockReturnValue(makeState({ status: 'idle' }));
    const { container } = render(<UpdateNotificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while checking', () => {
    mockUseAppUpdater.mockReturnValue(makeState({ status: 'checking' }));
    const { container } = render(<UpdateNotificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an error banner and dismisses it', () => {
    const dismissUpdate = vi.fn();
    mockUseAppUpdater.mockReturnValue(
      makeState({ status: 'error', errorMessage: 'network down', dismissUpdate }),
    );
    render(<UpdateNotificationBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Update failed: network down');
    fireEvent.click(screen.getByTestId('update-banner-dismiss'));
    expect(dismissUpdate).toHaveBeenCalled();
  });

  it('shows a downloading banner with progress percentage', () => {
    mockUseAppUpdater.mockReturnValue(makeState({ status: 'downloading', downloadProgress: 42 }));
    render(<UpdateNotificationBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Downloading update — 42%');
  });

  it('shows a downloading banner without a percentage when progress is zero', () => {
    mockUseAppUpdater.mockReturnValue(makeState({ status: 'downloading', downloadProgress: 0 }));
    render(<UpdateNotificationBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Downloading update…');
  });

  it('shows an available banner with the first line of the release notes and installs on click', () => {
    const installUpdate = vi.fn();
    const dismissUpdate = vi.fn();
    mockUseAppUpdater.mockReturnValue(
      makeState({
        status: 'available',
        updateInfo: { version: '1.2.3', body: 'Fixed bugs\nAnd more' },
        installUpdate,
        dismissUpdate,
      }),
    );
    render(<UpdateNotificationBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('RedfireForge 1.2.3 is available — Fixed bugs');
    fireEvent.click(screen.getByText('Install & Restart'));
    expect(installUpdate).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('update-banner-dismiss'));
    expect(dismissUpdate).toHaveBeenCalled();
  });

  it('shows an available banner without release notes when body is null', () => {
    mockUseAppUpdater.mockReturnValue(
      makeState({ status: 'available', updateInfo: { version: '1.2.3', body: null } }),
    );
    render(<UpdateNotificationBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('RedfireForge 1.2.3 is available');
  });

  it('renders nothing when status is available but updateInfo is missing', () => {
    mockUseAppUpdater.mockReturnValue(makeState({ status: 'available', updateInfo: null }));
    const { container } = render(<UpdateNotificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('localhost variant', () => {
    it('shows an amber git-pull banner with inline code', () => {
      const dismissUpdate = vi.fn();
      mockUseAppUpdater.mockReturnValue(
        makeState({
          status: 'available',
          mode: 'localhost',
          updateInfo: { version: '2.0.0', body: null },
          dismissUpdate,
        }),
      );
      render(<UpdateNotificationBanner />);
      const banner = screen.getByRole('status');
      expect(banner.className).toContain('update-banner--localhost');
      expect(banner).toHaveTextContent('v2.0.0 is available on GitHub');
      expect(banner).toHaveTextContent('git pull origin master');
      expect(banner.querySelector('code')).toBeTruthy();
    });

    it('dismisses the localhost banner', () => {
      const dismissUpdate = vi.fn();
      mockUseAppUpdater.mockReturnValue(
        makeState({
          status: 'available',
          mode: 'localhost',
          updateInfo: { version: '2.0.0', body: null },
          dismissUpdate,
        }),
      );
      render(<UpdateNotificationBanner />);
      fireEvent.click(screen.getByTestId('update-banner-dismiss'));
      expect(dismissUpdate).toHaveBeenCalled();
    });

    it('does not show Install & Restart for localhost mode', () => {
      mockUseAppUpdater.mockReturnValue(
        makeState({ status: 'available', mode: 'localhost', updateInfo: { version: '2.0.0', body: null } }),
      );
      render(<UpdateNotificationBanner />);
      expect(screen.queryByText('Install & Restart')).toBeNull();
    });
  });
});
