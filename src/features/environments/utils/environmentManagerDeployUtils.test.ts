import { describe, it, expect } from 'vitest';
import type { Microservice } from '@shared/types';
import {
  applyAddAdditionalEnv,
  applyDeleteAdditionalEnv,
  applyToggleDeploy,
  isDuplicateAdditionalEnvName,
} from './environmentManagerDeployUtils';

const svcA: Microservice = {
  id: 'svc-a',
  name: 'alpha',
  baseUrls: { e1: 'https://a.example.com' },
  customEnvs: [{ id: 'c1', name: 'staging' }],
  authProfileIds: { c1: 'auth-1' },
  protocolEndpoints: { sse: { c1: { baseUrl: 'https://events.example.com' } } },
};

const svcB: Microservice = {
  id: 'svc-b',
  name: 'beta',
  baseUrls: { e1: 'https://b.example.com' },
};

describe('applyToggleDeploy', () => {
  it('undeploys an environment when already deployed', () => {
    const next = applyToggleDeploy([svcA, svcB], 'svc-a', 'e1');
    expect(next[0].baseUrls).not.toHaveProperty('e1');
    expect(next[1]).toBe(svcB);
  });

  it('deploys an environment when not yet present', () => {
    const next = applyToggleDeploy([svcA], 'svc-a', 'e2');
    expect(next[0].baseUrls.e2).toBe('');
  });

  it('leaves other microservices unchanged', () => {
    const next = applyToggleDeploy([svcA, svcB], 'svc-a', 'e1');
    expect(next[1]).toEqual(svcB);
  });
});

describe('isDuplicateAdditionalEnvName', () => {
  it('detects duplicates against global environments', () => {
    expect(isDuplicateAdditionalEnvName('TEST', [{ name: 'test' }], svcA)).toBe(true);
  });

  it('detects duplicates against existing custom envs', () => {
    expect(isDuplicateAdditionalEnvName('staging', [], svcA)).toBe(true);
  });

  it('returns false for unique names', () => {
    expect(isDuplicateAdditionalEnvName('qa-2', [{ name: 'test' }], svcA)).toBe(false);
  });
});

describe('applyAddAdditionalEnv', () => {
  it('adds a custom environment only to the target microservice', () => {
    const next = applyAddAdditionalEnv([svcA, svcB], 'svc-a', 'c2', 'qa-2');
    expect(next[0].customEnvs).toEqual([
      { id: 'c1', name: 'staging' },
      { id: 'c2', name: 'qa-2' },
    ]);
    expect(next[0].baseUrls.c2).toBe('');
    expect(next[1]).toBe(svcB);
  });
});

describe('applyDeleteAdditionalEnv', () => {
  it('removes custom env data and strips protocol endpoints for the target service', () => {
    const next = applyDeleteAdditionalEnv([svcA, svcB], 'svc-a', 'c1');
    expect(next[0].customEnvs).toEqual([]);
    expect(next[0].baseUrls).not.toHaveProperty('c1');
    expect(next[0].authProfileIds).toEqual({});
    expect(next[0].protocolEndpoints).toBeUndefined();
    expect(next[1]).toBe(svcB);
  });

  it('handles microservices without authProfileIds when deleting custom env', () => {
    const svcNoAuth: Microservice = {
      id: 'svc-a',
      name: 'alpha',
      baseUrls: { c1: '' },
      customEnvs: [{ id: 'c1', name: 'staging' }],
    };
    const next = applyDeleteAdditionalEnv([svcNoAuth], 'svc-a', 'c1');
    expect(next[0].authProfileIds).toEqual({});
  });

  it('clears envVars map entry when deleting the last custom env override bucket', () => {
    const svcWithEnvVars: Microservice = {
      ...svcA,
      envVars: { c1: { token: 'secret' } },
    };
    const next = applyDeleteAdditionalEnv([svcWithEnvVars], 'svc-a', 'c1');
    expect(next[0].envVars).toBeUndefined();
  });

  it('preserves other envVars when deleting one custom env', () => {
    const svcWithEnvVars: Microservice = {
      ...svcA,
      customEnvs: [
        { id: 'c1', name: 'staging' },
        { id: 'c2', name: 'qa' },
      ],
      baseUrls: { c1: '', c2: '' },
      envVars: { c1: { token: 'a' }, c2: { token: 'b' } },
    };
    const next = applyDeleteAdditionalEnv([svcWithEnvVars], 'svc-a', 'c1');
    expect(next[0].envVars).toEqual({ c2: { token: 'b' } });
  });
});
