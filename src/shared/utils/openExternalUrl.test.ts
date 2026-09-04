/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openExternalUrl } from './openExternalUrl';

const open = vi.fn(async () => {});
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (...args: unknown[]) => open(...args),
}));

vi.mock('./platform', () => ({
  isTauri: vi.fn(() => false),
}));

import { isTauri } from './platform';

describe('openExternalUrl', () => {
  beforeEach(() => {
    open.mockReset();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses window.open on web', async () => {
    const winOpen = vi.fn();
    vi.stubGlobal('window', { ...window, open: winOpen });
    await openExternalUrl('https://example.com');
    expect(winOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(open).not.toHaveBeenCalled();
  });

  it('uses the shell plugin on Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const winOpen = vi.fn();
    vi.stubGlobal('window', { ...window, open: winOpen });
    await openExternalUrl('https://tally.so/r/1AaNzQ');
    expect(open).toHaveBeenCalledWith('https://tally.so/r/1AaNzQ');
    expect(winOpen).not.toHaveBeenCalled();
  });

  it('no-ops on empty urls', async () => {
    await openExternalUrl('');
    expect(open).not.toHaveBeenCalled();
  });

  it('no-ops on non-string urls', async () => {
    await openExternalUrl(undefined as unknown as string);
    await openExternalUrl(null as unknown as string);
    expect(open).not.toHaveBeenCalled();
  });

  it('no-ops when window is undefined', async () => {
    vi.stubGlobal('window', undefined);
    await openExternalUrl('https://example.com');
    expect(open).not.toHaveBeenCalled();
  });
});
