import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthConfig, Scenario } from '@shared/types';
import { TokenManager, acquireOAuth2Token, resetSharedTokenManager } from './tokenManager';
import { makeScenario as _makeScenario } from '@test-utils/factories';

vi.mock('@shared/utils/httpClient', () => ({
  httpFetch: vi.fn(),
}));

import { httpFetch } from '@shared/utils/httpClient';

const mockedFetch = vi.mocked(httpFetch);

function makeOAuth2Auth(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    type: 'oauth2',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'my-client',
    clientSecret: 'my-secret',
    ...overrides,
  };
}

const makeScenario = (auth: AuthConfig): Scenario =>
  _makeScenario({ id: 's1', name: 'Test', url: 'https://example.com', auth });

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('TokenManager', () => {
  beforeEach(() => {
    resetAllMocks();
    resetSharedTokenManager();
  });

  it('returns undefined for non-oauth2 auth', async () => {
    const tm = new TokenManager();
    const result = await tm.getToken(makeScenario({ type: 'bearer', token: 'x' }));
    expect(result).toBeUndefined();
  });

  it('acquires token from token URL', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    const tm = new TokenManager();
    const result = await tm.getToken(makeScenario(makeOAuth2Auth()));
    expect(result).toBe(token);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('caches token and does not refetch within expiry', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    const tm = new TokenManager();
    const auth = makeOAuth2Auth();
    await tm.getToken(makeScenario(auth));
    const result2 = await tm.getToken(makeScenario(auth));
    expect(result2).toBe(token);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent requests for same credentials', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    const tm = new TokenManager();
    const auth = makeOAuth2Auth();
    const [r1, r2] = await Promise.all([
      tm.getToken(makeScenario(auth)),
      tm.getToken(makeScenario(auth)),
    ]);
    expect(r1).toBe(token);
    expect(r2).toBe(token);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches expired token', async () => {
    const expiredToken = makeJwt({ exp: Math.floor(Date.now() / 1000) - 100 });
    const freshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

    mockedFetch
      .mockResolvedValueOnce({
        status: 200, statusText: 'OK', headers: {},
        body: JSON.stringify({ access_token: expiredToken }),
      })
      .mockResolvedValueOnce({
        status: 200, statusText: 'OK', headers: {},
        body: JSON.stringify({ access_token: freshToken }),
      });

    const tm = new TokenManager();
    const auth = makeOAuth2Auth();
    const r1 = await tm.getToken(makeScenario(auth));
    expect(r1).toBe(expiredToken);
    const r2 = await tm.getToken(makeScenario(auth));
    expect(r2).toBe(freshToken);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('throws when token request fails with error', async () => {
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: 'tok' }),
      error: 'Connection refused',
    });

    const tm = new TokenManager();
    await expect(tm.getToken(makeScenario(makeOAuth2Auth()))).rejects.toThrow('OAuth2 token request failed');
  });

  it('throws when token request returns 400+', async () => {
    mockedFetch.mockResolvedValueOnce({
      status: 401, statusText: 'Unauthorized', headers: {},
      body: 'invalid_client',
    });

    const tm = new TokenManager();
    await expect(tm.getToken(makeScenario(makeOAuth2Auth()))).rejects.toThrow('401');
  });

  it('throws when missing tokenUrl', async () => {
    const tm = new TokenManager();
    await expect(
      tm.getToken(makeScenario({ type: 'oauth2', clientId: 'c', clientSecret: 's' }))
    ).rejects.toThrow('tokenUrl');
  });

  it('throws when missing clientId', async () => {
    const tm = new TokenManager();
    await expect(
      tm.getToken(makeScenario({ type: 'oauth2', tokenUrl: 'https://a.com', clientSecret: 's' }))
    ).rejects.toThrow('clientId');
  });

  it('handles token without exp claim, defaults to 30 min', async () => {
    const token = makeJwt({ sub: 'test' }); // no exp
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    const tm = new TokenManager();
    const result = await tm.getToken(makeScenario(makeOAuth2Auth()));
    expect(result).toBe(token);
    const result2 = await tm.getToken(makeScenario(makeOAuth2Auth()));
    expect(result2).toBe(token);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('handles malformed JWT token gracefully', async () => {
    const token = 'not-a-jwt';
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    const tm = new TokenManager();
    const result = await tm.getToken(makeScenario(makeOAuth2Auth()));
    expect(result).toBe(token);
  });

  it('getTokenForAuth rejects non-oauth2 auth', async () => {
    const tm = new TokenManager();
    await expect(tm.getTokenForAuth({ type: 'bearer', token: 'x' })).rejects.toThrow('oauth2');
  });
});

describe('acquireOAuth2Token (shared cache)', () => {
  beforeEach(() => {
    resetAllMocks();
    resetSharedTokenManager();
  });

  it('reuses a cached token across Requests-style sends', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mockedFetch.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    const auth = makeOAuth2Auth();
    await expect(acquireOAuth2Token(auth)).resolves.toBe(token);
    await expect(acquireOAuth2Token(auth)).resolves.toBe(token);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not share cache with a freshly constructed TokenManager', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mockedFetch.mockResolvedValue({
      status: 200, statusText: 'OK', headers: {},
      body: JSON.stringify({ access_token: token }),
    });

    await acquireOAuth2Token(makeOAuth2Auth());
    const tm = new TokenManager();
    await tm.getToken(makeScenario(makeOAuth2Auth()));
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});
