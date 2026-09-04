/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLatestRelease,
  getDownloadUrl,
  detectOSTarget,
  getCurrentVersion,
  isNewerVersion,
  isOfficialStableRelease,
  type ReleaseAsset,
} from './latestRelease';

function makeRelease(overrides: Partial<{
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  name: string;
  body: string | null;
  assets: ReleaseAsset[];
}> = {}) {
  return {
    tag_name: 'v1.2.3',
    prerelease: false,
    draft: false,
    published_at: '2026-08-30T00:00:00Z',
    body: 'notes',
    assets: [] as ReleaseAsset[],
    html_url: 'https://github.com/redfireforge/redfireforge-public/releases/tag/v1.2.3',
    name: 'RedfireForge v1.2.3',
    ...overrides,
  };
}

describe('isOfficialStableRelease', () => {
  it('accepts official stable tags', () => {
    expect(isOfficialStableRelease('v1.2.3')).toBe(true);
    expect(isOfficialStableRelease('1.2.3')).toBe(true);
  });

  it('rejects alpha/beta/rc/pre tags', () => {
    expect(isOfficialStableRelease('v1.2.3-beta.1')).toBe(false);
    expect(isOfficialStableRelease('v1.2.3-alpha.2')).toBe(false);
    expect(isOfficialStableRelease('v1.0.0-rc.1')).toBe(false);
    expect(isOfficialStableRelease('0.8.1-beta.1')).toBe(false);
  });

  it('rejects GitHub prerelease and draft flags', () => {
    expect(isOfficialStableRelease('v1.2.3', 'RedfireForge', true, false)).toBe(false);
    expect(isOfficialStableRelease('v1.2.3', 'RedfireForge', false, true)).toBe(false);
  });

  it('rejects Learning Hub release names', () => {
    expect(isOfficialStableRelease('v1.2.3', 'RedfireForge Learning Hub v1.2.3')).toBe(false);
    expect(isOfficialStableRelease('v1.2.3', 'RedfireForge-LearningHub')).toBe(false);
  });
});

describe('isNewerVersion', () => {
  it('returns true when latest is strictly newer', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
  });

  it('returns false when latest is same or older', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  it('never treats beta/alpha as newer', () => {
    expect(isNewerVersion('1.0.0', '1.1.0-beta.1')).toBe(false);
    expect(isNewerVersion('1.0.0', '2.0.0-alpha.1')).toBe(false);
  });

  it('returns false for unparseable versions', () => {
    expect(isNewerVersion('bad', '1.0.0')).toBe(false);
  });
});

describe('getDownloadUrl', () => {
  const assets: ReleaseAsset[] = [
    { name: 'RedfireForge_1.2.3_aarch64.dmg', browser_download_url: 'https://a.dmg', size: 1 },
    { name: 'RedfireForge_1.2.3_x64.dmg', browser_download_url: 'https://x.dmg', size: 1 },
    { name: 'RedfireForge_1.2.3_x64-setup.exe', browser_download_url: 'https://w.exe', size: 1 },
    { name: 'RedfireForge_1.2.3_amd64.AppImage', browser_download_url: 'https://l.AppImage', size: 1 },
    { name: 'redfireforge_1.2.3_amd64.deb', browser_download_url: 'https://l.deb', size: 1 },
  ];

  it('matches each OS target', () => {
    expect(getDownloadUrl(assets, 'macos-arm')).toBe('https://a.dmg');
    expect(getDownloadUrl(assets, 'macos-x64')).toBe('https://x.dmg');
    expect(getDownloadUrl(assets, 'windows-x64')).toBe('https://w.exe');
    expect(getDownloadUrl(assets, 'linux-appimage')).toBe('https://l.AppImage');
    expect(getDownloadUrl(assets, 'linux-deb')).toBe('https://l.deb');
  });

  it('returns null when no matching asset', () => {
    expect(getDownloadUrl([], 'macos-arm')).toBeNull();
  });

  it('ignores Learning Hub installers on a shared vX.Y.Z release', () => {
    const mixed: ReleaseAsset[] = [
      { name: 'RedfireForge-LearningHub-1.2.3-linux-amd64.AppImage', browser_download_url: 'https://lh.AppImage', size: 1 },
      { name: 'RedfireForge_1.2.3_amd64.AppImage', browser_download_url: 'https://std.AppImage', size: 1 },
      { name: 'RedfireForge-LearningHub-1.2.3-linux-amd64.deb', browser_download_url: 'https://lh.deb', size: 1 },
      { name: 'RedfireForge_1.2.3_amd64.deb', browser_download_url: 'https://std.deb', size: 1 },
    ];
    expect(getDownloadUrl(mixed, 'linux-appimage')).toBe('https://std.AppImage');
    expect(getDownloadUrl(mixed, 'linux-deb')).toBe('https://std.deb');
  });
});

describe('detectOSTarget', () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
  });

  it('detects Windows', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0)', configurable: true });
    expect(detectOSTarget()).toBe('windows-x64');
  });

  it('detects Linux', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64)', configurable: true });
    expect(detectOSTarget()).toBe('linux-appimage');
  });

  it('detects Intel Mac', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    });
    expect(detectOSTarget()).toBe('macos-x64');
  });

  it('defaults Apple Silicon for non-Intel Mac UA', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Mac OS X 14_0)',
      configurable: true,
    });
    expect(detectOSTarget()).toBe('macos-arm');
  });

  it('defaults to macos-arm for unknown UA', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'SomeBot/1.0', configurable: true });
    expect(detectOSTarget()).toBe('macos-arm');
  });
});

describe('getCurrentVersion', () => {
  it('returns a string version (Vite define or safe fallback)', () => {
    const v = getCurrentVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});

describe('fetchLatestRelease', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the first official stable Standard release', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        makeRelease({ tag_name: 'v1.3.0-beta.1', prerelease: true, name: 'Beta' }),
        makeRelease({ tag_name: 'v1.2.3', name: 'RedfireForge Learning Hub v1.2.3' }),
        makeRelease({ tag_name: 'v1.2.3', name: 'RedfireForge v1.2.3' }),
      ],
    } as Response);

    const release = await fetchLatestRelease();
    expect(release?.version).toBe('1.2.3');
    expect(release?.tagName).toBe('v1.2.3');
  });

  it('skips drafts and Learning Hub even when tag is stable', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        makeRelease({ draft: true }),
        makeRelease({ name: 'RedfireForge LearningHub 1.2.3' }),
        makeRelease({ tag_name: 'v1.2.0', name: 'RedfireForge v1.2.0' }),
      ],
    } as Response);

    const release = await fetchLatestRelease();
    expect(release?.version).toBe('1.2.0');
  });

  it('returns null when API fails', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network'));
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('returns null when no stable release exists', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [makeRelease({ tag_name: 'v1.0.0-beta.1', prerelease: true })],
    } as Response);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('caches the result in sessionStorage', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [makeRelease()],
    } as Response);

    await fetchLatestRelease();
    expect(fetch).toHaveBeenCalledTimes(1);

    const again = await fetchLatestRelease();
    expect(again?.version).toBe('1.2.3');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores corrupt sessionStorage cache', async () => {
    sessionStorage.setItem('rff-latest-release', 'not-json');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [makeRelease({ tag_name: 'v9.9.9' })],
    } as Response);
    const release = await fetchLatestRelease();
    expect(release?.version).toBe('9.9.9');
  });

  it('uses empty body when release body is null', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [makeRelease({ body: null })],
    } as Response);
    const release = await fetchLatestRelease();
    expect(release?.body).toBe('');
  });
});
