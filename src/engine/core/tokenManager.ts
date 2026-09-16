import type { AuthConfig, Scenario } from '@shared/types';
import { httpFetch } from '@shared/utils/httpClient';

const TOKEN_EXPIRY_BUFFER_SEC = 30;

function parseJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload));
    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch {
    return null;
  }
}

interface CachedToken {
  token: string;
  expiresSec: number;
}

/** Raw token HTTP call — used by TokenManager so caching cannot recurse. */
async function fetchOAuth2Token(auth: AuthConfig): Promise<string> {
  if (!auth.tokenUrl || !auth.clientId || !auth.clientSecret) {
    throw new Error('OAuth2 requires tokenUrl, clientId, and clientSecret');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
  });
  const result = await httpFetch(
    auth.tokenUrl,
    'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body.toString()
  );
  if (result.error) {
    throw new Error(`OAuth2 token request failed: ${result.error}`);
  }
  if (result.status >= 400) {
    throw new Error(`OAuth2 token request failed: ${result.status} ${result.statusText} - ${result.body}`);
  }
  const data = JSON.parse(result.body);
  return data.access_token;
}

let _sharedTokenManager: TokenManager | null = null;

export function sharedTokenManager(): TokenManager {
  if (!_sharedTokenManager) _sharedTokenManager = new TokenManager();
  return _sharedTokenManager;
}

/** Test-only: drop the process-wide Requests/UI token cache. */
export function resetSharedTokenManager(): void {
  _sharedTokenManager = null;
}

/**
 * Acquire an OAuth2 access token, reusing a process-wide cache (JWT expiry
 * with a 30s buffer). Requests Send used to call the token URL on every click.
 */
export async function acquireOAuth2Token(auth: AuthConfig): Promise<string> {
  return sharedTokenManager().getTokenForAuth(auth);
}

export class TokenManager {
  private cache = new Map<string, CachedToken>();
  private pending = new Map<string, Promise<string>>();

  private credKey(auth: AuthConfig): string {
    return `${auth.tokenUrl}|${auth.clientId}|${auth.clientSecret}`;
  }

  private isExpired(entry: CachedToken): boolean {
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= entry.expiresSec - TOKEN_EXPIRY_BUFFER_SEC;
  }

  async getTokenForAuth(auth: AuthConfig): Promise<string> {
    if (auth.type !== 'oauth2') {
      throw new Error('getTokenForAuth requires oauth2 auth');
    }
    const key = this.credKey(auth);
    const cached = this.cache.get(key);
    if (cached && !this.isExpired(cached)) return cached.token;

    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const refreshPromise = this.refresh(key, auth);
    this.pending.set(key, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.pending.delete(key);
    }
  }

  async getToken(scenario: Scenario): Promise<string | undefined> {
    if (scenario.auth?.type !== 'oauth2') return undefined;
    return this.getTokenForAuth(scenario.auth);
  }

  private async refresh(key: string, auth: AuthConfig): Promise<string> {
    const token = await fetchOAuth2Token(auth);
    const exp = parseJwtExpiry(token);
    const expiresSec = exp ?? Math.floor(Date.now() / 1000) + 1800;
    this.cache.set(key, { token, expiresSec });
    return token;
  }
}
