declare const __APP_VERSION__: string;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface LatestRelease {
  tagName: string;
  version: string;
  publishedAt: string;
  body: string;
  assets: ReleaseAsset[];
  htmlUrl: string;
}

export type OSTarget =
  | 'macos-arm'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-appimage'
  | 'linux-deb';

const CACHE_KEY = 'rff-latest-release';
const CACHE_TTL_MS = 5 * 60 * 1000;

/** True for official stable tags only — rejects alpha/beta/rc/pre and leftover -lh releases. */
export function isOfficialStableRelease(tagName: string, name = '', prerelease = false, draft = false): boolean {
  if (draft || prerelease) return false;
  if (/Learning\s*Hub/i.test(name)) return false;
  // Defense in depth: reject prerelease suffixes even if GitHub's prerelease flag is wrong
  if (/-/.test(tagName.replace(/^v/, ''))) return false;
  return /^\d+\.\d+\.\d+$/.test(tagName.replace(/^v/, ''));
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached) as {
        data: LatestRelease;
        timestamp: number;
      };
      if (Date.now() - timestamp < CACHE_TTL_MS) return data;
    }
  } catch {
    // corrupt cache — fall through to fetch
  }

  try {
    const res = await fetch(
      'https://api.github.com/repos/redfireforge/redfireforge-public/releases',
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;
    const releases = await res.json() as Array<{
      tag_name: string;
      prerelease: boolean;
      draft: boolean;
      published_at: string;
      body: string | null;
      assets: ReleaseAsset[];
      html_url: string;
      name: string;
    }>;

    // Official stable Standard release only — never alpha/beta/rc or Learning Hub
    const stable = releases.find(r =>
      isOfficialStableRelease(r.tag_name, r.name, r.prerelease, r.draft),
    );
    if (!stable) return null;

    const data: LatestRelease = {
      tagName: stable.tag_name,
      version: stable.tag_name.replace(/^v/, ''),
      publishedAt: stable.published_at,
      body: stable.body ?? '',
      assets: stable.assets,
      htmlUrl: stable.html_url,
    };

    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch {
      // sessionStorage unavailable (private mode etc.) — ignore
    }
    return data;
  } catch {
    return null;
  }
}

function isLearningHubAsset(name: string): boolean {
  return /LearningHub/i.test(name);
}

export function getDownloadUrl(assets: ReleaseAsset[], target: OSTarget): string | null {
  const patterns: Record<OSTarget, RegExp> = {
    'macos-arm': /_aarch64\.dmg$/,
    'macos-x64': /_x64\.dmg$/,
    'windows-x64': /_x64-setup\.exe$/,
    'linux-appimage': /\.AppImage$/,
    'linux-deb': /\.deb$/,
  };
  const asset = assets.find(a => patterns[target].test(a.name) && !isLearningHubAsset(a.name));
  return asset?.browser_download_url ?? null;
}

export function detectOSTarget(): OSTarget {
  if (typeof navigator === 'undefined') return 'macos-arm';
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'windows-x64';
  if (ua.includes('Linux')) return 'linux-appimage';
  if (ua.includes('Mac OS X')) {
    // Hint only — unreliable under Rosetta 2; callers should show both macOS options
    return ua.includes('Intel Mac') ? 'macos-x64' : 'macos-arm';
  }
  return 'macos-arm';
}

/**
 * Returns the current app version from the Vite define global.
 * Use this instead of import.meta.env.VITE_APP_VERSION — that var does not exist.
 */
export function getCurrentVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
}

/** Simple semver comparison — returns true if `latest` is strictly newer than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  // Never notify for prerelease tags (e.g. 0.8.2-beta.1, 1.0.0-alpha.3)
  if (!isOfficialStableRelease(latest)) return false;
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);
  if ([cMaj, cMin, cPat, lMaj, lMin, lPat].some(n => Number.isNaN(n))) return false;
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}
