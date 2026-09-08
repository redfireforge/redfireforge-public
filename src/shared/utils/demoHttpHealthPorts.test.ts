/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { isDemoHttpHealthPort, isDemoHttpHealthUrl, normalizeDemoHttpHealthPath } from './demoHttpHealthPorts';

describe('isDemoHttpHealthPort / isDemoHttpHealthUrl', () => {
  it('allows GraphQL TLS, mTLS, plain GraphQL, gRPC echo, and Kafka Console ports', () => {
    expect(isDemoHttpHealthPort(4010)).toBe(true);
    expect(isDemoHttpHealthPort(4444)).toBe(true);
    expect(isDemoHttpHealthPort(4446)).toBe(true);
    expect(isDemoHttpHealthPort(50052)).toBe(true);
    expect(isDemoHttpHealthPort(18080)).toBe(true);
    expect(isDemoHttpHealthPort(3001)).toBe(false);
    expect(isDemoHttpHealthPort(80)).toBe(false);
  });

  it('matches loopback URLs on those ports regardless of path', () => {
    expect(isDemoHttpHealthUrl('http://127.0.0.1:4444/health')).toBe(true);
    expect(isDemoHttpHealthUrl('http://localhost:4446/health')).toBe(true);
    expect(isDemoHttpHealthUrl('http://localhost:4010/graphql')).toBe(true);
    expect(isDemoHttpHealthUrl('http://localhost:50052/health')).toBe(true);
    expect(isDemoHttpHealthUrl('http://localhost:18080')).toBe(true);
    expect(isDemoHttpHealthUrl('http://[::1]:4444/health')).toBe(true);
    expect(isDemoHttpHealthUrl('http://example.com:4444/health')).toBe(false);
    expect(isDemoHttpHealthUrl('http://localhost:3001/health')).toBe(false);
    expect(isDemoHttpHealthUrl('not-a-url')).toBe(false);
  });

  it('normalizes probe paths to / or /health', () => {
    expect(normalizeDemoHttpHealthPath('/')).toBe('/');
    expect(normalizeDemoHttpHealthPath('')).toBe('/');
    expect(normalizeDemoHttpHealthPath(undefined)).toBe('/health');
    expect(normalizeDemoHttpHealthPath('/health')).toBe('/health');
    expect(normalizeDemoHttpHealthPath('/graphql')).toBe('/health');
  });
});
