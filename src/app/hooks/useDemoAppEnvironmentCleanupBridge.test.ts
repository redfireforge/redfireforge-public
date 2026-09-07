/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDemoAppEnvironmentCleanupBridge } from './useDemoAppEnvironmentCleanupBridge';
import {
  GQL_DEMO_ENV_NAME,
  GQL_DEMO_SVC_NAME,
  GQL_STUDIO_DEMO_ENV_NAME,
} from '@redfireforge/demo-hub/lessons/env-manager-lesson-helpers';

vi.mock('@redfireforge/demo-hub/lessons/gql-demo-app-environment-cleanup', () => ({
  purgeGqlDemoLessonEnvironmentsFromStorage: vi.fn(async () => ({
    removedStudioEnv: true,
    removedEmEnvId: 'e-demo',
    removedEmSvcId: 's-demo',
    resetEnvSelection: true,
    resetSvcSelection: true,
  })),
}));

import { purgeGqlDemoLessonEnvironmentsFromStorage } from '@redfireforge/demo-hub/lessons/gql-demo-app-environment-cleanup';

describe('useDemoAppEnvironmentCleanupBridge', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments;
    delete (window as unknown as Record<string, unknown>).__demoDeleteGqlEnvByName;
  });

  it('registers __demoPurgeGqlLessonEnvironments and syncs React state', async () => {
    const setEnvironments = vi.fn((fn: (prev: { id: string; name: string }[]) => unknown) => {
      if (typeof fn === 'function') {
        return fn([
          { id: 'e-demo', name: GQL_DEMO_ENV_NAME },
          { id: 'e-user', name: 'test' },
        ]);
      }
      return fn;
    });
    const setMicroservices = vi.fn((fn: (prev: { id: string; name: string }[]) => unknown) => {
      if (typeof fn === 'function') {
        return fn([
          { id: 's-demo', name: GQL_DEMO_SVC_NAME },
          { id: 's-user', name: 'api' },
        ]);
      }
      return fn;
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    const deleteStudioEnv = vi.fn();
    (window as unknown as Record<string, unknown>).__demoDeleteGqlEnvByName = deleteStudioEnv;

    const { unmount } = renderHook(() => useDemoAppEnvironmentCleanupBridge({
      selectedEnvId: 'e-demo',
      selectedSvcId: 's-demo',
      setEnvironments,
      setMicroservices,
      setSelectedEnvId,
      setSelectedSvcId,
    }));

    const purge = (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments as () => Promise<void>;
    expect(purge).toBeTypeOf('function');

    await act(async () => { await purge(); });

    expect(purgeGqlDemoLessonEnvironmentsFromStorage).toHaveBeenCalled();
    expect(setEnvironments).toHaveBeenCalled();
    expect(setMicroservices).toHaveBeenCalled();
    expect(setSelectedEnvId).toHaveBeenCalledWith('e-user');
    expect(setSelectedSvcId).toHaveBeenCalledWith('s-user');
    expect(deleteStudioEnv).toHaveBeenCalledWith(GQL_STUDIO_DEMO_ENV_NAME);

    unmount();
    expect((window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments).toBeUndefined();
  });

  it('does not reset selection when removed ids do not match current selection', async () => {
    vi.mocked(purgeGqlDemoLessonEnvironmentsFromStorage).mockResolvedValueOnce({
      removedStudioEnv: false,
      removedEmEnvId: 'e-other',
      removedEmSvcId: 's-other',
      resetEnvSelection: false,
      resetSvcSelection: false,
    });
    const setEnvironments = vi.fn((fn: (prev: { id: string; name: string }[]) => unknown) => {
      if (typeof fn === 'function') return fn([{ id: 'e-user', name: 'test' }]);
      return fn;
    });
    const setMicroservices = vi.fn((fn: (prev: { id: string; name: string }[]) => unknown) => {
      if (typeof fn === 'function') return fn([{ id: 's-user', name: 'api' }]);
      return fn;
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();

    renderHook(() => useDemoAppEnvironmentCleanupBridge({
      selectedEnvId: 'e-user',
      selectedSvcId: 's-user',
      setEnvironments,
      setMicroservices,
      setSelectedEnvId,
      setSelectedSvcId,
    }));

    const purge = (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments as () => Promise<void>;
    await act(async () => { await purge(); });

    expect(setSelectedEnvId).not.toHaveBeenCalled();
    expect(setSelectedSvcId).not.toHaveBeenCalled();
  });

  it('skips studio env delete when purge did not remove studio env', async () => {
    vi.mocked(purgeGqlDemoLessonEnvironmentsFromStorage).mockResolvedValueOnce({
      removedStudioEnv: false,
      removedEmEnvId: undefined,
      removedEmSvcId: undefined,
      resetEnvSelection: false,
      resetSvcSelection: false,
    });
    const deleteStudioEnv = vi.fn();
    (window as unknown as Record<string, unknown>).__demoDeleteGqlEnvByName = deleteStudioEnv;

    renderHook(() => useDemoAppEnvironmentCleanupBridge({
      selectedEnvId: '',
      selectedSvcId: '',
      setEnvironments: vi.fn(),
      setMicroservices: vi.fn(),
      setSelectedEnvId: vi.fn(),
      setSelectedSvcId: vi.fn(),
    }));

    const purge = (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments as () => Promise<void>;
    await act(async () => { await purge(); });

    expect(deleteStudioEnv).not.toHaveBeenCalled();
  });

  it('resets selection to empty string when no envs remain after purge', async () => {
    vi.mocked(purgeGqlDemoLessonEnvironmentsFromStorage).mockResolvedValueOnce({
      removedStudioEnv: false,
      removedEmEnvId: 'e-demo',
      removedEmSvcId: 's-demo',
      resetEnvSelection: true,
      resetSvcSelection: true,
    });
    const setSelectedEnvId = vi.fn();
    const setSelectedSvcId = vi.fn();
    renderHook(() => useDemoAppEnvironmentCleanupBridge({
      selectedEnvId: 'e-demo',
      selectedSvcId: 's-demo',
      setEnvironments: vi.fn((fn) => (typeof fn === 'function' ? fn([{ id: 'e-demo', name: GQL_DEMO_ENV_NAME }]) : fn)),
      setMicroservices: vi.fn((fn) => (typeof fn === 'function' ? fn([{ id: 's-demo', name: GQL_DEMO_SVC_NAME }]) : fn)),
      setSelectedEnvId,
      setSelectedSvcId,
    }));
    const purge = (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments as () => Promise<void>;
    await act(async () => { await purge(); });
    expect(setSelectedEnvId).toHaveBeenCalledWith('');
    expect(setSelectedSvcId).toHaveBeenCalledWith('');
  });

  it('handles missing __demoDeleteGqlEnvByName when studio env was removed', async () => {
    vi.mocked(purgeGqlDemoLessonEnvironmentsFromStorage).mockResolvedValueOnce({
      removedStudioEnv: true,
      removedEmEnvId: undefined,
      removedEmSvcId: undefined,
      resetEnvSelection: false,
      resetSvcSelection: false,
    });
    delete (window as unknown as Record<string, unknown>).__demoDeleteGqlEnvByName;

    renderHook(() => useDemoAppEnvironmentCleanupBridge({
      selectedEnvId: '',
      selectedSvcId: '',
      setEnvironments: vi.fn(),
      setMicroservices: vi.fn(),
      setSelectedEnvId: vi.fn(),
      setSelectedSvcId: vi.fn(),
    }));

    const purge = (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments as () => Promise<void>;
    await expect(act(async () => { await purge(); })).resolves.not.toThrow();
  });
});
