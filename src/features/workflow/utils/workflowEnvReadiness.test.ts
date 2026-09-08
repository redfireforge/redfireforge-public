import { describe, it, expect } from 'vitest';
import { checkEnvReadiness, checkAllEnvReadiness } from './workflowEnvReadiness';
import type { WorkflowService } from '../types/workflow';

function makeService(id: string, name: string, endpoints: WorkflowService['endpoints'] = []): WorkflowService {
  return { id, name, endpoints };
}

describe('checkEnvReadiness', () => {
  it('returns ready when no services have endpoints', () => {
    const result = checkEnvReadiness('test', [makeService('s1', 'Svc')]);
    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.envId).toBe('test');
  });

  it('returns ready when all services have enabled endpoints for the env', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: 'test', url: 'https://test.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('reports issue when service endpoint is missing for the env', () => {
    const svc = makeService('s1', 'Svc A', [
      { envId: 'prod', url: 'https://prod.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].serviceName).toBe('Svc A');
    expect(result.issues[0].serviceId).toBe('s1');
    expect(result.issues[0].missingUrl).toBe(true);
  });

  it('reports issue when endpoint exists but is disabled', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: 'test', url: 'https://test.com', enabled: false, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it('reports issue when endpoint URL is empty', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: 'test', url: '  ', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(false);
  });

  it('handles multiple services with mixed readiness', () => {
    const ready = makeService('s1', 'Ready', [
      { envId: 'test', url: 'https://ok.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const missing = makeService('s2', 'Missing', [
      { envId: 'prod', url: 'https://prod.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkEnvReadiness('test', [ready, missing]);
    expect(result.ready).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].serviceName).toBe('Missing');
  });

  it('returns ready for empty services list', () => {
    const result = checkEnvReadiness('test', []);
    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('returns ready when service uses __all__ pseudo-env (same URL for all)', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: '__all__', url: 'https://api.example.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('prefers exact env match over __all__ fallback', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: '__all__', url: 'https://fallback.com', enabled: true, authMode: 'inherit', source: 'manual' },
      { envId: 'test', url: '', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    // Exact match found but URL is empty → should report missing (not fall back to __all__)
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(false);
  });

  it('falls back to __all__ when no exact env endpoint exists', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: '__all__', url: 'https://api.com', enabled: true, authMode: 'inherit', source: 'manual' },
      { envId: 'prod', url: 'https://prod.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    // test not in endpoints, but __all__ is → should be ready
    const result = checkEnvReadiness('test', [svc]);
    expect(result.ready).toBe(true);
  });
});

describe('checkAllEnvReadiness', () => {
  it('returns a map of readiness for all envs', () => {
    const svc = makeService('s1', 'Svc', [
      { envId: 'test', url: 'https://test.com', enabled: true, authMode: 'inherit', source: 'manual' },
    ]);
    const result = checkAllEnvReadiness(['test', 'prod'], [svc]);
    expect(result.size).toBe(2);
    expect(result.get('test')!.ready).toBe(true);
    expect(result.get('prod')!.ready).toBe(false);
  });

  it('returns empty map for no envs', () => {
    const result = checkAllEnvReadiness([], [makeService('s1', 'Svc')]);
    expect(result.size).toBe(0);
  });
});
