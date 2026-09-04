import { useState, useEffect, useCallback, type MouseEvent } from 'react';
import { readKey, writeKey } from '../../shared/utils/storage';
import { openExternalUrl } from '../../shared/utils/openExternalUrl';

const TALLY_URL = 'https://tally.so/r/1AaNzQ';
const PRIVACY_URL = 'https://github.com/redfireforge/redfireforge-public/blob/master/PRIVACY.md';
const STORAGE_KEY = 'cloud-waitlist-dismissed';

/** Playwright sets `navigator.webdriver`. Promo chrome must not shift layout in E2E. */
function isAutomatedBrowser(): boolean {
  return Boolean((globalThis as { navigator?: { webdriver?: boolean } }).navigator?.webdriver);
}

export function AppCloudWaitlistBanner() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (isAutomatedBrowser()) return;
    readKey(STORAGE_KEY).then((val) => setDismissed(val === 'true'));
  }, []);

  const dismiss = () => {
    setDismissed(true);
    writeKey(STORAGE_KEY, 'true');
  };

  const openLink = useCallback((url: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternalUrl(url);
  }, []);

  if (isAutomatedBrowser() || dismissed !== false) return null;

  return (
    <div className="waitlist-banner" role="status" aria-label="RedfireForge Cloud waitlist">
      <span className="waitlist-banner__icon" aria-hidden>☁️</span>
      <span className="waitlist-banner__text">
        <strong>RedfireForge Cloud</strong> is coming — hosted testing, team workspaces &amp; CI integration.{' '}
        <a
          className="waitlist-banner__privacy"
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openLink(PRIVACY_URL)}
        >
          Privacy Policy
        </a>
      </span>
      <a
        className="waitlist-banner__cta"
        href={`${TALLY_URL}?source=in-app`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={openLink(`${TALLY_URL}?source=in-app`)}
      >
        Join the waitlist →
      </a>
      <button
        className="waitlist-banner__dismiss"
        onClick={dismiss}
        aria-label="Dismiss waitlist banner"
      >
        ✕
      </button>
    </div>
  );
}
