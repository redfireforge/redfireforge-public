import { describe, it, expect } from 'vitest';
import {
  resolveBaseUrl,
  buildDisplayUrl,
  resolveFullSendUrl,
  collectKnownHostBases,
  stripKnownBaseToRelative,
  urlStartsWithHostBase,
} from './requestUrlResolver';
import type { UrlResolverContext } from './requestUrlResolver';

function ctx(overrides: Partial<UrlResolverContext> = {}): UrlResolverContext {
  return {
    collectionMode: 'multi-env',
    resolvedColBaseUrls: {},
    ...overrides,
  };
}

describe('resolveBaseUrl', () => {
  it('returns null when no base URLs configured', () => {
    expect(resolveBaseUrl(ctx())).toBeNull();
  });

  it('returns sub-collection base URL matching subColEnvId', () => {
    const c = ctx({
      subColEnvId: 'env1',
      parentSubCollection: { baseUrls: { env1: 'https://sub.api.com/' } },
    });
    expect(resolveBaseUrl(c)).toBe('https://sub.api.com');
  });

  it('returns first sub-collection base URL when envId does not match', () => {
    const c = ctx({
      subColEnvId: 'env2',
      parentSubCollection: { baseUrls: { env1: 'https://first.api.com/' } },
    });
    expect(resolveBaseUrl(c)).toBe('https://first.api.com');
  });

  it('returns collection base URL when no sub-collection', () => {
    const c = ctx({
      selectedEnvId: 'env1',
      resolvedColBaseUrls: { env1: 'https://col.api.com/' },
    });
    expect(resolveBaseUrl(c)).toBe('https://col.api.com');
  });

  it('prefers sub-collection base over collection base', () => {
    const c = ctx({
      subColEnvId: 'env1',
      parentSubCollection: { baseUrls: { env1: 'https://sub.api.com' } },
      resolvedColBaseUrls: { env1: 'https://col.api.com' },
    });
    expect(resolveBaseUrl(c)).toBe('https://sub.api.com');
  });

  it('falls back to selectedEnvId when subColEnvId not set', () => {
    const c = ctx({
      selectedEnvId: 'env1',
      resolvedColBaseUrls: { env1: 'https://api.com/v1/' },
    });
    expect(resolveBaseUrl(c)).toBe('https://api.com/v1');
  });

  it('strips trailing slashes', () => {
    const c = ctx({
      subColEnvId: 'e',
      parentSubCollection: { baseUrls: { e: 'https://api.com///' } },
    });
    expect(resolveBaseUrl(c)).toBe('https://api.com');
  });
});

describe('buildDisplayUrl', () => {
  it('returns path as-is for direct mode', () => {
    expect(buildDisplayUrl('/api/test', ctx({ collectionMode: 'direct' }))).toBe('/api/test');
  });

  it('returns full URL if already absolute', () => {
    expect(buildDisplayUrl('https://api.com/test', ctx())).toBe('https://api.com/test');
  });

  it('prepends base URL for relative path', () => {
    const c = ctx({ selectedEnvId: 'e1', resolvedColBaseUrls: { e1: 'https://api.com' } });
    expect(buildDisplayUrl('/users', c)).toBe('https://api.com/users');
  });

  it('adds leading slash if missing', () => {
    const c = ctx({ selectedEnvId: 'e1', resolvedColBaseUrls: { e1: 'https://api.com' } });
    expect(buildDisplayUrl('users', c)).toBe('https://api.com/users');
  });

  it('returns relative path when no base URL', () => {
    expect(buildDisplayUrl('/users', ctx())).toBe('/users');
  });
});

describe('resolveFullSendUrl', () => {
  it('passes through absolute URLs', () => {
    const result = resolveFullSendUrl('https://api.com/test', ctx());
    expect(result).toEqual({ url: 'https://api.com/test' });
  });

  it('resolves relative URL with base', () => {
    const c = ctx({ selectedEnvId: 'e1', resolvedColBaseUrls: { e1: 'https://api.com' } });
    const result = resolveFullSendUrl('/users', c);
    expect(result).toEqual({ url: 'https://api.com/users' });
  });

  it('adds leading slash for relative URL', () => {
    const c = ctx({ selectedEnvId: 'e1', resolvedColBaseUrls: { e1: 'https://api.com' } });
    const result = resolveFullSendUrl('users', c);
    expect(result).toEqual({ url: 'https://api.com/users' });
  });

  it('returns multi-env error when no base URL in multi-env mode', () => {
    const result = resolveFullSendUrl('/users', ctx({ collectionMode: 'multi-env' }));
    expect(result.error).toContain('no base URL configured');
  });

  it('returns direct mode error when no base URL in direct mode', () => {
    const result = resolveFullSendUrl('/users', ctx({ collectionMode: 'direct' }));
    expect(result.error).toContain('full URL');
  });

  it('returns http URL passthrough', () => {
    const result = resolveFullSendUrl('http://localhost:3000/api', ctx());
    expect(result).toEqual({ url: 'http://localhost:3000/api' });
  });
});

describe('resolveBaseUrl — additional branches', () => {
  it('returns null when sub-collection baseUrls is empty', () => {
    const c = ctx({
      parentSubCollection: { baseUrls: {} },
    });
    expect(resolveBaseUrl(c)).toBeNull();
  });
});

describe('urlStartsWithHostBase', () => {
  it('accepts the base, a path, query, or hash — not a longer hostname', () => {
    const base = 'https://t01.example.com';
    expect(urlStartsWithHostBase(`${base}/v1`, base)).toBe(true);
    expect(urlStartsWithHostBase(`${base}?q=1`, base)).toBe(true);
    expect(urlStartsWithHostBase(`${base}#top`, base)).toBe(true);
    expect(urlStartsWithHostBase(base, base)).toBe(true);
    expect(urlStartsWithHostBase('https://t01.example.com.evil.com/v1', base)).toBe(false);
  });
});

describe('collectKnownHostBases', () => {
  it('collects mapped, collection, microservice, and folder bases, longest first', () => {
    const bases = collectKnownHostBases(
      { e1: 'https://mapped.example.com/' },
      {
        baseUrls: { e1: 'https://col.example.com' },
        microserviceId: 'svc',
        folders: [{
          id: 'f',
          name: 'local',
          requests: [],
          folders: [{
            id: 'child',
            name: 'child',
            requests: [],
            folders: [],
            baseUrls: { e1: 'http://localhost:8080' },
          }],
        }],
      },
      [{ id: 'svc', baseUrls: { e1: 'https://ms.example.com/api/' } }],
    );
    expect(bases[0]).toBe('https://mapped.example.com');
    expect(bases).toEqual(expect.arrayContaining([
      'https://mapped.example.com',
      'https://col.example.com',
      'https://ms.example.com/api',
      'http://localhost:8080',
    ]));
  });

  it('skips empty strings and unknown microservice ids', () => {
    expect(collectKnownHostBases(
      { e1: '' },
      { baseUrls: { e1: '' }, microserviceId: 'missing', folders: [] },
      [{ id: 'other', baseUrls: { e1: 'https://nope.example.com' } }],
    )).toEqual([]);
  });
});

describe('stripKnownBaseToRelative', () => {
  const t01 = 'https://t01.example.com';

  it('leaves relative and direct-mode absolute URLs unchanged', () => {
    expect(stripKnownBaseToRelative('/v1', 'multi-env', [t01])).toBe('/v1');
    expect(stripKnownBaseToRelative(`${t01}/v1`, 'direct', [t01])).toBe(`${t01}/v1`);
  });

  it('strips a known host and keeps query or hash on a bare origin', () => {
    expect(stripKnownBaseToRelative(`${t01}/v1/ping`, 'multi-env', [t01])).toBe('/v1/ping');
    expect(stripKnownBaseToRelative(`${t01}?q=1`, 'multi-env', [t01])).toBe('/?q=1');
    expect(stripKnownBaseToRelative(`${t01}#x`, 'multi-env', [t01])).toBe('/#x');
    expect(stripKnownBaseToRelative(t01, 'multi-env', [t01])).toBe('/');
  });

  it('keeps an unknown host absolute', () => {
    expect(stripKnownBaseToRelative('https://other.example.com/v1', 'multi-env', [t01]))
      .toBe('https://other.example.com/v1');
  });
});
