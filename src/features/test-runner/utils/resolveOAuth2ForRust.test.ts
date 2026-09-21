import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeScenario } from '@test-utils/factories';
import type { AuthConfig } from '@shared/types';

vi.mock('@engine/core/tokenManager', () => ({
  acquireOAuth2Token: vi.fn(),
}));

import { acquireOAuth2Token } from '@engine/core/tokenManager';
import { resolveOAuth2ScenariosForRust, scenarioUsesOAuth2 } from './resolveOAuth2ForRust';

const mockAcquire = vi.mocked(acquireOAuth2Token);

function oauth2Auth(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    type: 'oauth2',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'cid',
    clientSecret: 'csec',
    ...overrides,
  };
}

beforeEach(() => {
  mockAcquire.mockReset();
  mockAcquire.mockResolvedValue('access-token');
});

describe('scenarioUsesOAuth2', () => {
  it('is true only for oauth2 auth', () => {
    expect(scenarioUsesOAuth2(makeScenario({ auth: oauth2Auth() }))).toBe(true);
    expect(scenarioUsesOAuth2(makeScenario({ auth: { type: 'bearer', token: 't' } }))).toBe(false);
    expect(scenarioUsesOAuth2(makeScenario({ auth: { type: 'none' } }))).toBe(false);
  });
});

describe('resolveOAuth2ScenariosForRust', () => {
  it('leaves non-oauth2 scenarios unchanged', async () => {
    const bearer = makeScenario({ id: 'b', auth: { type: 'bearer', token: 'keep' } });
    const none = makeScenario({ id: 'n', auth: { type: 'none' } });
    const resolved = await resolveOAuth2ScenariosForRust([bearer, none]);
    expect(resolved).toEqual([bearer, none]);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it('rewrites oauth2 scenarios to bearer with the acquired token', async () => {
    const scenario = makeScenario({
      id: 'oauth',
      name: 'Get Digimimo',
      auth: oauth2Auth(),
    });
    const [resolved] = await resolveOAuth2ScenariosForRust([scenario]);
    expect(resolved.auth).toEqual({ type: 'bearer', token: 'access-token', prefix: 'Bearer' });
    expect(resolved.id).toBe('oauth');
    expect(resolved.name).toBe('Get Digimimo');
    expect(mockAcquire).toHaveBeenCalledWith(scenario.auth);
  });

  it('shares one token request for identical oauth2 credentials', async () => {
    const auth = oauth2Auth();
    const a = makeScenario({ id: 'a', auth });
    const b = makeScenario({ id: 'b', auth });
    const resolved = await resolveOAuth2ScenariosForRust([a, b]);
    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(resolved.every((s) => s.auth.type === 'bearer' && s.auth.token === 'access-token')).toBe(true);
  });

  it('acquires separately for different oauth2 clients', async () => {
    mockAcquire
      .mockResolvedValueOnce('token-a')
      .mockResolvedValueOnce('token-b');
    const a = makeScenario({ id: 'a', auth: oauth2Auth({ clientId: 'one' }) });
    const b = makeScenario({ id: 'b', auth: oauth2Auth({ clientId: 'two' }) });
    const resolved = await resolveOAuth2ScenariosForRust([a, b]);
    expect(mockAcquire).toHaveBeenCalledTimes(2);
    expect(resolved[0].auth.token).toBe('token-a');
    expect(resolved[1].auth.token).toBe('token-b');
  });

  it('propagates token acquisition failures', async () => {
    mockAcquire.mockRejectedValueOnce(new Error('OAuth2 token request failed: 401'));
    await expect(
      resolveOAuth2ScenariosForRust([makeScenario({ auth: oauth2Auth() })]),
    ).rejects.toThrow('OAuth2 token request failed: 401');
  });

  it('treats empty oauth2 credentials as one cache key', async () => {
    const incomplete = makeScenario({ id: 'x', auth: { type: 'oauth2' } });
    await resolveOAuth2ScenariosForRust([incomplete, { ...incomplete, id: 'y' }]);
    expect(mockAcquire).toHaveBeenCalledTimes(1);
  });
});
