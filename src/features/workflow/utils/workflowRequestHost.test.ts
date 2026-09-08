import { describe, expect, it } from 'vitest';
import { resolveQuickTestHostForRequest } from './workflowRequestHost';
import type { Environment, Microservice, RequestCollection, RequestItem } from '@shared/types';

const envT01: Environment = { id: 'e-test', name: 'test' };
const envP01: Environment = { id: 'e-prod', name: 'prod' };

const msOrders: Microservice = {
  id: 'ms-orders',
  name: 'order-api',
  baseUrls: { 'e-test': 'https://orders.apps.test/', 'e-prod': 'https://orders.prod/' },
};

const msProfiles: Microservice = {
  id: 'ms-profiles',
  name: 'profile-read',
  baseUrls: { 'e-test': 'https://profile-read.apps.test/', 'e-prod': 'https://profiles.prod/' },
};

function makeReq(id: string): RequestItem {
  return {
    id,
    name: 'R',
    method: 'GET',
    url: '/path',
    headers: [],
    body: '',
    auth: { type: 'none' },
  };
}

describe('resolveQuickTestHostForRequest', () => {
  it('maps subcollection base to env + microservice when URLs match the catalog', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [],
      folders: [
        {
          id: 'sub',
          name: 'profiles',
          isSubCollection: true,
          selectedEnvId: 'e-test',
          baseUrls: { 'e-test': 'https://profile-read.apps.test/' },
          requests: [makeReq('r1')],
        },
      ],
    };
    const harnessBase = 'https://orders.apps.test';
    const r = resolveQuickTestHostForRequest(
      col,
      makeReq('r1'),
      'e-test',
      harnessBase,
      [msOrders, msProfiles],
      [envT01, envP01],
    );
    expect(r.hostMicroserviceId).toBe('ms-profiles');
    expect(r.hostEnvironmentId).toBe('e-test');
    expect(r.hostBaseUrl).toBeUndefined();
  });

  it('stores hostBaseUrl when the resolved base does not match any microservice', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [],
      folders: [
        {
          id: 'sub',
          name: 'legacy',
          isSubCollection: true,
          selectedEnvId: 'e-test',
          baseUrls: { 'e-test': 'https://custom-legacy.example.com/' },
          requests: [makeReq('r2')],
        },
      ],
    };
    const r = resolveQuickTestHostForRequest(
      col,
      makeReq('r2'),
      'e-test',
      'https://orders.apps.test',
      [msOrders],
      [envT01],
    );
    expect(r.hostBaseUrl).toBe('https://custom-legacy.example.com');
    expect(r.hostMicroserviceId).toBeUndefined();
  });

  it('returns empty patch when resolved base matches the harness', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [makeReq('top')],
      folders: [],
    };
    const r = resolveQuickTestHostForRequest(
      col,
      makeReq('top'),
      'e-test',
      'https://orders.apps.test/',
      [msOrders],
      [envT01],
    );
    expect(r).toEqual({});
  });

  it('infers profile-read from absolute request URL when collection base matches harness', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [],
      folders: [],
    };
    const req = {
      ...makeReq('r-abs'),
      url: 'https://profile-read.apps.test/orgs/1/users/u-123',
    };
    const r = resolveQuickTestHostForRequest(
      col,
      req,
      'e-test',
      'https://orders.apps.test/',
      [msOrders, msProfiles],
      [envT01],
    );
    expect(r.hostMicroserviceId).toBe('ms-profiles');
    expect(r.hostEnvironmentId).toBe('e-test');
  });

  it('returns hostBaseUrl when absolute URL does not match any microservice', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [],
      folders: [],
    };
    const req = {
      ...makeReq('r-custom'),
      url: 'https://custom-api.example.com/resource',
    };
    const r = resolveQuickTestHostForRequest(
      col,
      req,
      'e-test',
      'https://orders.apps.test/',
      [msOrders],
      [envT01],
    );
    expect(r.hostBaseUrl).toBe('https://custom-api.example.com');
  });

  it('returns empty when relative URL and no resolved base (no microserviceId)', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'url',
      requests: [makeReq('r1')],
      folders: [],
    };
    const r = resolveQuickTestHostForRequest(
      col,
      makeReq('r1'),
      'e-test',
      'https://harness.example.com',
      [],
      [envT01],
    );
    expect(r).toEqual({});
  });

  it('falls back to microserviceId+envId when no resolved base and collection has microservice', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [makeReq('r1')],
      folders: [],
    };
    const r = resolveQuickTestHostForRequest(
      col,
      makeReq('r1'),
      'e-test',
      'https://unrelated.com',
      [msOrders],
      [envT01],
    );
    expect(r.hostMicroserviceId).toBe('ms-orders');
    expect(r.hostEnvironmentId).toBe('e-test');
  });

  it('uses absolute URL when collection has microserviceId but no resolved base for env', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [],
      folders: [],
    };
    const req = {
      ...makeReq('r-abs'),
      url: 'https://profile-read.apps.test/path',
    };
    // Use an envId that has no matching base URL in ms-orders
    const r = resolveQuickTestHostForRequest(
      col,
      req,
      'e-unknown',
      'https://no-match.com',
      [msOrders, msProfiles],
      [envT01],
    );
    expect(r.hostMicroserviceId).toBe('ms-profiles');
    expect(r.hostEnvironmentId).toBe('e-test');
  });

  it('matches subcollection by name when no selectedEnvId', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'multi-env',
      microserviceId: 'ms-orders',
      requests: [],
      folders: [
        {
          id: 'sub',
          name: 'test',
          isSubCollection: true,
          baseUrls: { 'e-test': 'https://custom.apps.test/' },
          requests: [makeReq('r1')],
        },
      ],
    };
    const r = resolveQuickTestHostForRequest(
      col,
      makeReq('r1'),
      'e-test',
      'https://harness.example.com',
      [msOrders],
      [envT01],
    );
    expect(r.hostBaseUrl).toBe('https://custom.apps.test');
  });

  it('returns empty when absolute URL matches harness base', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'C',
      mode: 'url',
      requests: [],
      folders: [],
    };
    const req = {
      ...makeReq('r1'),
      url: 'https://harness.example.com/api/resource',
    };
    const r = resolveQuickTestHostForRequest(
      col,
      req,
      'e-test',
      'https://harness.example.com',
      [],
      [envT01],
    );
    expect(r).toEqual({});
  });
});

