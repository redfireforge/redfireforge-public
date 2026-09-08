import { describe, expect, it } from 'vitest';
import { resolveHttpNodeBaseUrl, resolveServiceBaseUrl, resolveServiceAuth } from './workflowHostResolve';
import { HttpNodeData, WorkflowService } from '../types/workflow';
import { Microservice, GlobalAuthProfile } from '@shared/types';

const minimalScenario = (): HttpNodeData['scenario'] => ({
  id: 's', name: 's', url: '/', method: 'GET',
  headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' },
});

// ── resolveServiceBaseUrl ───────────────

describe('resolveServiceBaseUrl', () => {
  const microservices: Microservice[] = [
    { id: 'ms-1', name: 'MS1', baseUrls: { test: 'https://ms1.test.com/', prod: 'https://ms1.prod.com' } },
  ];

  it('resolves from endpoint matrix for selected env', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc',
      endpoints: [
        { envId: 'test', url: 'https://test.api.com/', enabled: true, authMode: 'inherit', source: 'manual' },
      ],
    };
    expect(resolveServiceBaseUrl(svc, [], 'test')).toBe('https://test.api.com');
  });

  it('falls back to __all__ endpoint when env not found', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc',
      endpoints: [
        { envId: '__all__', url: 'https://all.api.com/', enabled: true, authMode: 'inherit', source: 'manual' },
      ],
    };
    expect(resolveServiceBaseUrl(svc, [], 'test')).toBe('https://all.api.com');
  });

  it('falls back to first enabled endpoint with URL', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc',
      endpoints: [
        { envId: 'prod', url: 'https://prod.api.com/', enabled: true, authMode: 'inherit', source: 'manual' },
      ],
    };
    expect(resolveServiceBaseUrl(svc, [], 'test')).toBe('https://prod.api.com');
  });

  it('skips disabled endpoints', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc',
      endpoints: [
        { envId: 'test', url: 'https://disabled.com', enabled: false, authMode: 'inherit', source: 'manual' },
      ],
    };
    expect(resolveServiceBaseUrl(svc, [], 'test')).toBeUndefined();
  });

  it('resolves from microservice baseUrls when no endpoints', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', microserviceId: 'ms-1', endpoints: [] };
    expect(resolveServiceBaseUrl(svc, microservices, 'test')).toBe('https://ms1.test.com');
  });

  it('falls back to first microservice baseUrl when env not found', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', microserviceId: 'ms-1', endpoints: [] };
    expect(resolveServiceBaseUrl(svc, microservices, 'nonexistent')).toBe('https://ms1.test.com');
  });

  it('returns undefined for unknown microservice', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', microserviceId: 'ms-unknown', endpoints: [] };
    expect(resolveServiceBaseUrl(svc, microservices)).toBeUndefined();
  });

  it('resolves legacy direct urlMode', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', urlMode: 'direct', directUrl: 'https://direct.com/' };
    expect(resolveServiceBaseUrl(svc, [])).toBe('https://direct.com');
  });

  it('resolves legacy adhoc urlMode', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', urlMode: 'adhoc', adhocUrl: 'https://adhoc.com/' };
    expect(resolveServiceBaseUrl(svc, [])).toBe('https://adhoc.com');
  });

  it('resolves legacy multi-env urlMode', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc', urlMode: 'multi-env',
      baseUrls: { test: 'https://test.com/', prod: 'https://prod.com' },
    };
    expect(resolveServiceBaseUrl(svc, [], 'test')).toBe('https://test.com');
  });

  it('returns first baseUrl for multi-env when env not found', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc', urlMode: 'multi-env',
      baseUrls: { prod: 'https://prod.com' },
    };
    expect(resolveServiceBaseUrl(svc, [], 'unknown')).toBe('https://prod.com');
  });

  it('returns undefined for empty directUrl', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', urlMode: 'direct', directUrl: '  ' };
    expect(resolveServiceBaseUrl(svc, [])).toBeUndefined();
  });

  it('handles default urlMode (undefined) as direct', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', directUrl: 'https://fallback.com/' };
    expect(resolveServiceBaseUrl(svc, [])).toBe('https://fallback.com');
  });

  it('returns undefined when no selectedEnvId and no endpoints', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', microserviceId: 'ms-1', endpoints: [] };
    // No selectedEnvId, falls back to first baseUrl
    expect(resolveServiceBaseUrl(svc, microservices)).toBe('https://ms1.test.com');
  });
});

// ── resolveHttpNodeBaseUrl ──────────────

describe('resolveHttpNodeBaseUrl', () => {
  const microservices: Microservice[] = [
    { id: 'svc-a', name: 'A', baseUrls: { test: 'https://a.example.com/', prod: 'https://a-prod.example.com' } },
  ];

  it('returns undefined when host fields missing', () => {
    const d: HttpNodeData = { label: 'x', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, microservices)).toBeUndefined();
  });

  it('resolves when both ids set', () => {
    const d: HttpNodeData = {
      label: 'x', hostEnvironmentId: 'test', hostMicroserviceId: 'svc-a',
      scenario: minimalScenario(),
    };
    expect(resolveHttpNodeBaseUrl(d, microservices)).toBe('https://a.example.com');
  });

  it('prefers explicit hostBaseUrl over env + microservice', () => {
    const d: HttpNodeData = {
      label: 'x', hostBaseUrl: 'https://ons.example.com/',
      hostEnvironmentId: 'test', hostMicroserviceId: 'svc-a',
      scenario: minimalScenario(),
    };
    expect(resolveHttpNodeBaseUrl(d, microservices)).toBe('https://ons.example.com');
  });

  it('resolves via serviceId and services array', () => {
    const services: WorkflowService[] = [{
      id: 'svc-1', name: 'S',
      endpoints: [{ envId: 'test', url: 'https://svc.test.com', enabled: true, authMode: 'inherit', source: 'manual' }],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 'svc-1', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, [], undefined, services, 'test')).toBe('https://svc.test.com');
  });

  it('returns undefined when serviceId not found in services', () => {
    const d: HttpNodeData = { label: 'x', serviceId: 'missing', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, [], undefined, [{ id: 'other', name: 'O' }], 'test')).toBeUndefined();
  });

  it('resolves via hostProfileId', () => {
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-1', scenario: minimalScenario() };
    const hostProfiles = [{ id: 'hp-1', name: 'H', hostBaseUrl: 'https://profile.com/' }];
    expect(resolveHttpNodeBaseUrl(d, [], hostProfiles)).toBe('https://profile.com');
  });

  it('resolves hostProfile with env+microservice', () => {
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-1', scenario: minimalScenario() };
    const hostProfiles = [{ id: 'hp-1', name: 'H', hostEnvironmentId: 'test', hostMicroserviceId: 'svc-a' }];
    expect(resolveHttpNodeBaseUrl(d, microservices, hostProfiles)).toBe('https://a.example.com');
  });

  it('returns undefined for hostProfile with missing env', () => {
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-1', scenario: minimalScenario() };
    const hostProfiles = [{ id: 'hp-1', name: 'H', hostEnvironmentId: '', hostMicroserviceId: '' }];
    expect(resolveHttpNodeBaseUrl(d, microservices, hostProfiles)).toBeUndefined();
  });

  it('returns undefined for unknown hostProfileId', () => {
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-missing', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, [], [{ id: 'hp-other', name: 'O' }])).toBeUndefined();
  });

  it('returns undefined when microservice env has no URL', () => {
    const d: HttpNodeData = {
      label: 'x', hostEnvironmentId: 'missing-env', hostMicroserviceId: 'svc-a',
      scenario: minimalScenario(),
    };
    expect(resolveHttpNodeBaseUrl(d, microservices)).toBeUndefined();
  });

  it('returns undefined for unknown microserviceId', () => {
    const d: HttpNodeData = {
      label: 'x', hostEnvironmentId: 'test', hostMicroserviceId: 'unknown',
      scenario: minimalScenario(),
    };
    expect(resolveHttpNodeBaseUrl(d, microservices)).toBeUndefined();
  });
});

// ── resolveServiceAuth ──────────────────

describe('resolveServiceAuth', () => {
  const bearerAuth = { type: 'bearer' as const, token: 'tok' };
  const customAuth = { type: 'bearer' as const, token: 'custom-tok' };

  it('returns undefined when no serviceId', () => {
    const d: HttpNodeData = { label: 'x', scenario: minimalScenario() };
    expect(resolveServiceAuth(d)).toBeUndefined();
  });

  it('returns undefined when serviceId not found', () => {
    const d: HttpNodeData = { label: 'x', serviceId: 'missing', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, [{ id: 'other', name: 'O' }])).toBeUndefined();
  });

  it('returns custom auth from endpoint row', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S',
      endpoints: [{ envId: 'test', url: 'https://t.com', enabled: true, authMode: 'custom', auth: customAuth, source: 'manual' }],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(customAuth);
  });

  it('resolves inherited auth from microservice authProfileIds', () => {
    const ms: Microservice[] = [{ id: 'ms-1', name: 'MS', baseUrls: {}, authProfileIds: { test: 'ap-1' } }];
    const globalAuth: GlobalAuthProfile[] = [{ id: 'ap-1', name: 'A', auth: bearerAuth }];
    const services: WorkflowService[] = [{
      id: 's1', name: 'S', microserviceId: 'ms-1',
      endpoints: [{ envId: 'test', url: 'https://t.com', enabled: true, authMode: 'inherit', source: 'manual' }],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test', ms, globalAuth)).toEqual(bearerAuth);
  });

  it('falls back to defaultAuth', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S', defaultAuth: bearerAuth,
      endpoints: [],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(bearerAuth);
  });

  it('falls back to legacy authPerEnv', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S',
      authPerEnv: { test: bearerAuth },
      endpoints: [],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(bearerAuth);
  });

  it('falls back to legacy auth field', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S', auth: bearerAuth,
      endpoints: [],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(bearerAuth);
  });

  it('returns __all__ endpoint auth when env-specific not found', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S',
      endpoints: [{ envId: '__all__', url: 'https://a.com', enabled: true, authMode: 'custom', auth: customAuth, source: 'manual' }],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'any-env')).toEqual(customAuth);
  });

  it('resolves auth via microservice authProfileIds when endpoint inherits', () => {
    const apiKeyAuth = { type: 'apikey' as const, apiKeyName: 'X-Key', apiKeyValue: 'val', apiKeyIn: 'header' as const };
    const globalProfiles: GlobalAuthProfile[] = [
      { id: 'gp1', name: 'GP', auth: apiKeyAuth },
    ];
    const microservices: Microservice[] = [
      { id: 'ms1', name: 'MS', baseUrls: {}, authProfileIds: { test: 'gp1' } },
    ];
    const services: WorkflowService[] = [{
      id: 's1', name: 'S', microserviceId: 'ms1',
      endpoints: [{ envId: 'test', url: 'https://a.com', enabled: true, authMode: 'inherit', source: 'manual' }],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test', microservices, globalProfiles)).toEqual(apiKeyAuth);
  });

  it('falls back to legacy authPerEnv when no endpoints match', () => {
    const envAuth = { type: 'bearer' as const, token: 'env-tok' };
    const services: WorkflowService[] = [{
      id: 's1', name: 'S',
      authPerEnv: { test: envAuth },
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(envAuth);
  });
});

describe('resolveServiceBaseUrl — additional branches', () => {
  it('resolves endpoints without selectedEnvId (no env-specific match)', () => {
    const svc: WorkflowService = {
      id: 's1', name: 'Svc',
      endpoints: [
        { envId: '__all__', url: 'https://all.api.com/', enabled: true, authMode: 'inherit', source: 'manual' },
      ],
    };
    // No selectedEnvId — should skip env-specific, fall to __all__
    expect(resolveServiceBaseUrl(svc, [])).toBe('https://all.api.com');
  });

  it('resolves microservice without selectedEnvId falls to first baseUrl', () => {
    const ms: Microservice[] = [{ id: 'ms1', name: 'MS', baseUrls: { prod: 'https://prod.com/' } }];
    const svc: WorkflowService = { id: 's1', name: 'Svc', microserviceId: 'ms1', endpoints: [] };
    expect(resolveServiceBaseUrl(svc, ms)).toBe('https://prod.com');
  });

  it('returns undefined for adhoc with empty url', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', urlMode: 'adhoc', adhocUrl: '' };
    expect(resolveServiceBaseUrl(svc, [])).toBeUndefined();
  });

  it('returns undefined for multi-env with empty baseUrls', () => {
    const svc: WorkflowService = { id: 's1', name: 'Svc', urlMode: 'multi-env', baseUrls: {} };
    expect(resolveServiceBaseUrl(svc, [])).toBeUndefined();
  });

  it('returns undefined for microservice with empty baseUrl for env', () => {
    const ms: Microservice[] = [{ id: 'ms1', name: 'MS', baseUrls: { test: '  ' } }];
    const svc: WorkflowService = { id: 's1', name: 'Svc', microserviceId: 'ms1', endpoints: [] };
    expect(resolveServiceBaseUrl(svc, ms, 'test')).toBeUndefined();
  });
});

// ── envOverride ─────────────────────────

describe('resolveHttpNodeBaseUrl — envOverride', () => {
  const services: WorkflowService[] = [{
    id: 'svc-1', name: 'S',
    endpoints: [
      { envId: 'test', url: 'https://svc.test.com', enabled: true, authMode: 'inherit', source: 'manual' },
      { envId: '__adhoc__', url: 'https://svc.adhoc.com', enabled: true, authMode: 'inherit', source: 'manual' },
      { envId: 'prod', url: 'https://svc.prod.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ],
  }];

  it('uses envOverride instead of global selectedEnvId', () => {
    const d: HttpNodeData = { label: 'x', serviceId: 'svc-1', envOverride: '__adhoc__', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, [], undefined, services, 'test')).toBe('https://svc.adhoc.com');
  });

  it('uses global selectedEnvId when no envOverride', () => {
    const d: HttpNodeData = { label: 'x', serviceId: 'svc-1', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, [], undefined, services, 'test')).toBe('https://svc.test.com');
  });

  it('uses envOverride for prod while global is test', () => {
    const d: HttpNodeData = { label: 'x', serviceId: 'svc-1', envOverride: 'prod', scenario: minimalScenario() };
    expect(resolveHttpNodeBaseUrl(d, [], undefined, services, 'test')).toBe('https://svc.prod.com');
  });
});

describe('resolveServiceAuth — envOverride', () => {
  const testAuth = { type: 'bearer' as const, token: 'test-tok' };
  const adhocAuth = { type: 'bearer' as const, token: 'adhoc-tok' };

  it('uses envOverride instead of global selectedEnvId for auth', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S',
      endpoints: [
        { envId: 'test', url: 'https://t.com', enabled: true, authMode: 'custom', auth: testAuth, source: 'manual' },
        { envId: '__adhoc__', url: 'https://a.com', enabled: true, authMode: 'custom', auth: adhocAuth, source: 'manual' },
      ],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', envOverride: '__adhoc__', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(adhocAuth);
  });

  it('uses global selectedEnvId when no envOverride for auth', () => {
    const services: WorkflowService[] = [{
      id: 's1', name: 'S',
      endpoints: [
        { envId: 'test', url: 'https://t.com', enabled: true, authMode: 'custom', auth: testAuth, source: 'manual' },
        { envId: '__adhoc__', url: 'https://a.com', enabled: true, authMode: 'custom', auth: adhocAuth, source: 'manual' },
      ],
    }];
    const d: HttpNodeData = { label: 'x', serviceId: 's1', scenario: minimalScenario() };
    expect(resolveServiceAuth(d, services, 'test')).toEqual(testAuth);
  });
});

describe('resolveHttpNodeBaseUrl — additional branches', () => {
  const microservices: Microservice[] = [
    { id: 'svc-a', name: 'A', baseUrls: { test: 'https://a.example.com/' } },
  ];

  it('resolves via hostProfile with env+microservice when profile baseUrl is empty', () => {
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-1', scenario: minimalScenario() };
    const hostProfiles = [{ id: 'hp-1', name: 'H', hostEnvironmentId: 'test', hostMicroserviceId: 'svc-a' }];
    expect(resolveHttpNodeBaseUrl(d, microservices, hostProfiles)).toBe('https://a.example.com');
  });

  it('returns undefined for hostProfile with unknown microserviceId', () => {
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-1', scenario: minimalScenario() };
    const hostProfiles = [{ id: 'hp-1', name: 'H', hostEnvironmentId: 'test', hostMicroserviceId: 'unknown' }];
    expect(resolveHttpNodeBaseUrl(d, microservices, hostProfiles)).toBeUndefined();
  });

  it('returns undefined for hostProfile with microservice but empty URL for env', () => {
    const ms: Microservice[] = [{ id: 'svc-b', name: 'B', baseUrls: { test: '  ' } }];
    const d: HttpNodeData = { label: 'x', hostProfileId: 'hp-1', scenario: minimalScenario() };
    const hostProfiles = [{ id: 'hp-1', name: 'H', hostEnvironmentId: 'test', hostMicroserviceId: 'svc-b' }];
    expect(resolveHttpNodeBaseUrl(d, ms, hostProfiles)).toBeUndefined();
  });
});
