import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DemoLesson } from '../types';
import { isLessonDesktopOnlyBlocked, isDockerLessonBlockedOnWeb, isLocalDemoWebHost } from './lessonPlatform';

vi.mock('@shared/utils/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/utils/platform')>();
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    isDesktopRuntimeAvailable: vi.fn(() => false),
  };
});

import { isTauri, isDesktopRuntimeAvailable } from '@shared/utils/platform';

const desktopLesson: DemoLesson = {
  id: 'gql-mock-server',
  domainId: 'protocols',
  name: 'Mock Server',
  description: 'Desktop mock proxy demo',
  estimatedMinutes: 6,
  desktopOnly: true,
  concept: { title: 'Mock', body: 'Body' },
  steps: [{ id: 's1', title: 'Step', description: 'Desc' }],
};

const dockerLesson: DemoLesson = {
  id: 'gql-docker',
  domainId: 'protocols',
  name: 'GraphQL Docker',
  description: 'Needs docker',
  estimatedMinutes: 5,
  dockerEndpoint: 'http://localhost:4010/graphql',
  dockerCommand: 'docker compose up',
  concept: { title: 'GQL', body: 'Body' },
  steps: [{ id: 's1', title: 'Step', description: 'Desc' }],
};

describe('isLessonDesktopOnlyBlocked', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false for lessons without desktopOnly', () => {
    expect(isLessonDesktopOnlyBlocked({ ...desktopLesson, desktopOnly: undefined })).toBe(false);
  });

  it('returns false on desktop when lesson is desktop-only', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
    expect(isLessonDesktopOnlyBlocked(desktopLesson)).toBe(false);
  });

  it('returns true on hosted web when lesson is desktop-only', () => {
    expect(isLessonDesktopOnlyBlocked(desktopLesson)).toBe(true);
  });

  it('returns false on a local clone when lesson is desktop-only', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
    expect(isLessonDesktopOnlyBlocked(desktopLesson)).toBe(false);
  });

  it('returns false on web when GQL-13 E2E desktop shim is active', () => {
    vi.stubGlobal('window', { __RF_E2E_MOCK_DESKTOP__: true } as Window & typeof globalThis);
    expect(isLessonDesktopOnlyBlocked(desktopLesson)).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('isDockerLessonBlockedOnWeb', () => {
  const noDockerLesson: DemoLesson = {
    ...dockerLesson,
    dockerEndpoint: undefined,
    dockerEndpoints: undefined,
  };

  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false for a lesson with no docker endpoint', () => {
    vi.stubGlobal('window', { location: { hostname: 'demo.redfireforge.com' } });
    expect(isDockerLessonBlockedOnWeb(noDockerLesson)).toBe(false);
  });

  it('returns false when running in Tauri (desktop)', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.stubGlobal('window', { location: { hostname: 'demo.redfireforge.com' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns false on localhost (local dev)', () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns false on 127.0.0.1 (local dev)', () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns false on 127.0.0.2 (loopback /8)', () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.2' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns false on ::1 (IPv6 loopback)', () => {
    vi.stubGlobal('window', { location: { hostname: '::1' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns false on [::1] and *.localhost (RFC 6761 loopback)', () => {
    vi.stubGlobal('window', { location: { hostname: '[::1]' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
    vi.stubGlobal('window', { location: { hostname: 'app.localhost' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns true on a hosted domain when lesson has dockerEndpoint', () => {
    vi.stubGlobal('window', { location: { hostname: 'demo.redfireforge.com' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(true);
    vi.stubGlobal('window', { location: { hostname: 'app.redfireforge.com' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(true);
  });

  it('returns true when lesson uses dockerEndpoints array on a hosted domain', () => {
    vi.stubGlobal('window', { location: { hostname: 'demo.redfireforge.com' } });
    const multi: DemoLesson = { ...noDockerLesson, dockerEndpoints: ['http://localhost:4010/health'] };
    expect(isDockerLessonBlockedOnWeb(multi)).toBe(true);
  });

  it('isLocalDemoWebHost covers loopback spellings', () => {
    expect(isLocalDemoWebHost('localhost')).toBe(true);
    expect(isLocalDemoWebHost('localhost.')).toBe(true);
    expect(isLocalDemoWebHost('127.0.0.1')).toBe(true);
    expect(isLocalDemoWebHost('127.0.0.2')).toBe(true);
    expect(isLocalDemoWebHost('::1')).toBe(true);
    expect(isLocalDemoWebHost('[::1]')).toBe(true);
    expect(isLocalDemoWebHost('app.localhost')).toBe(true);
    expect(isLocalDemoWebHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLocalDemoWebHost('[::ffff:127.0.0.1]')).toBe(true);
    expect(isLocalDemoWebHost('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isLocalDemoWebHost('[::1].')).toBe(true);
    expect(isLocalDemoWebHost('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
    expect(isLocalDemoWebHost('[0:0:0:0:0:ffff:127.0.0.2]')).toBe(true);
    expect(isLocalDemoWebHost('::ffff:7f00:1')).toBe(true);
    expect(isLocalDemoWebHost('[::ffff:7f00:1].')).toBe(true);
    expect(isLocalDemoWebHost('0:0:0:0:0:ffff:7f00:1')).toBe(true);
    expect(isLocalDemoWebHost('::ffff:c0a8:10a')).toBe(false);
    expect(isLocalDemoWebHost('0:0:0:0:0:ffff:192.168.1.10')).toBe(false);
    expect(isLocalDemoWebHost('127.999.0.1')).toBe(false);
    expect(isLocalDemoWebHost('demo.redfireforge.com')).toBe(false);
    expect(isLocalDemoWebHost('192.168.1.10')).toBe(false);
  });

  it('treats app.localhost as local so helper enablement is not the narrow isLocalhost() list', () => {
    expect(isLocalDemoWebHost('app.localhost')).toBe(true);
    expect(isLocalDemoWebHost('demo.redfireforge.com')).toBe(false);
  });

  it('returns false on IPv4-mapped IPv6 loopback (local dev)', () => {
    vi.stubGlobal('window', { location: { hostname: '::ffff:127.0.0.1' } });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });

  it('returns false on hosted domain when E2E desktop shim is active', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'demo.redfireforge.com' },
      __RF_E2E_MOCK_DESKTOP__: true,
    });
    expect(isDockerLessonBlockedOnWeb(dockerLesson)).toBe(false);
  });
});
