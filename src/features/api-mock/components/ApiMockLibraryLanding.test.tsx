/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApiMockLibraryLanding } from './ApiMockLibraryLanding';
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';

vi.mock('../../../shared/utils/platform', () => ({
  isDesktopRuntimeAvailable: vi.fn(() => true),
}));

describe('ApiMockLibraryLanding', () => {
  it('shows the no-open-server hint and creates a new server', () => {
    const onCreate = vi.fn();
    render(
      <div className="api-mock-root">
        <ApiMockLibraryLanding onCreate={onCreate} />
      </div>,
    );

    expect(screen.getByTestId('api-mock-library-landing')).toBeTruthy();
    expect(screen.getByText('API Mock Studio')).toBeTruthy();
    expect(screen.queryByTestId('api-mock-landing-desktop-notice')).toBeNull();
    fireEvent.click(screen.getByTestId('api-mock-landing-create'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('shows the desktop-required notice on hosted web', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValueOnce(false);
    render(
      <div className="api-mock-root">
        <ApiMockLibraryLanding onCreate={vi.fn()} />
      </div>,
    );
    expect(screen.getByTestId('api-mock-landing-desktop-notice')).toBeTruthy();
  });
});
