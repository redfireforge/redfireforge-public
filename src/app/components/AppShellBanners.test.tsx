/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { AppShellBanners } from './AppShellBanners';

vi.mock('./UpdateNotificationBanner', () => ({
  UpdateNotificationBanner: () => <div data-testid="update-banner-stub" />,
}));

vi.mock('./AppCloudWaitlistBanner', () => ({
  AppCloudWaitlistBanner: () => <div data-testid="waitlist-banner-stub" />,
}));

describe('AppShellBanners', () => {
  it('mounts the update and waitlist banners', () => {
    render(<AppShellBanners />);
    expect(screen.getByTestId('update-banner-stub')).toBeInTheDocument();
    expect(screen.getByTestId('waitlist-banner-stub')).toBeInTheDocument();
  });
});
