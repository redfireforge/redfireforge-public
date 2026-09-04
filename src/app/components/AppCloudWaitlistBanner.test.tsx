/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppCloudWaitlistBanner } from './AppCloudWaitlistBanner';

const STORAGE_KEY = 'cloud-waitlist-dismissed';

const readKey = vi.fn<(key: string) => Promise<string | null>>();
const writeKey = vi.fn<(key: string, value: string) => Promise<void>>();
const openExternalUrl = vi.fn(async () => {});

vi.mock('../../shared/utils/storage', () => ({
  readKey: (...args: [string]) => readKey(...args),
  writeKey: (...args: [string, string]) => writeKey(...args),
}));

vi.mock('../../shared/utils/openExternalUrl', () => ({
  openExternalUrl: (...args: [string]) => openExternalUrl(...args),
}));

describe('AppCloudWaitlistBanner', () => {
  beforeEach(() => {
    readKey.mockReset();
    writeKey.mockReset();
    openExternalUrl.mockReset();
    readKey.mockResolvedValue(null);
    vi.stubGlobal('navigator', { webdriver: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing while the dismiss flag is still loading', () => {
    readKey.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AppCloudWaitlistBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the banner was already dismissed', async () => {
    readKey.mockResolvedValue('true');
    const { container } = render(<AppCloudWaitlistBanner />);
    await waitFor(() => expect(readKey).toHaveBeenCalledWith(STORAGE_KEY));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the waitlist banner for a first-time web visitor', async () => {
    render(<AppCloudWaitlistBanner />);
    expect(await screen.findByRole('status', { name: 'RedfireForge Cloud waitlist' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join the waitlist →' })).toHaveAttribute(
      'href',
      'https://tally.so/r/1AaNzQ?source=in-app',
    );
    expect(screen.getByRole('link', { name: /Privacy Policy/i })).toHaveAttribute('target', '_blank');
  });

  it('opens Privacy Policy and waitlist URLs via openExternalUrl', async () => {
    render(<AppCloudWaitlistBanner />);
    await screen.findByRole('status', { name: 'RedfireForge Cloud waitlist' });
    fireEvent.click(screen.getByRole('link', { name: 'Privacy Policy' }));
    expect(openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/redfireforge/redfireforge-public/blob/master/PRIVACY.md',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Join the waitlist →' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://tally.so/r/1AaNzQ?source=in-app');
  });

  it('opens Privacy Policy and waitlist URLs via openExternalUrl', async () => {
    render(<AppCloudWaitlistBanner />);
    await screen.findByRole('status', { name: 'RedfireForge Cloud waitlist' });
    fireEvent.click(screen.getByRole('link', { name: 'Privacy Policy' }));
    expect(openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/redfireforge/redfireforge-public/blob/master/PRIVACY.md',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Join the waitlist →' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://tally.so/r/1AaNzQ?source=in-app');
  });

  it('persists dismiss and hides the banner', async () => {
    render(<AppCloudWaitlistBanner />);
    const banner = await screen.findByRole('status', { name: 'RedfireForge Cloud waitlist' });
    fireEvent.click(screen.getByLabelText('Dismiss waitlist banner'));
    expect(writeKey).toHaveBeenCalledWith(STORAGE_KEY, 'true');
    expect(banner).not.toBeInTheDocument();
  });

  it('never renders in Playwright even when storage says the banner is new', async () => {
    vi.stubGlobal('navigator', { webdriver: true });
    const { container } = render(<AppCloudWaitlistBanner />);
    await Promise.resolve();
    expect(readKey).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
