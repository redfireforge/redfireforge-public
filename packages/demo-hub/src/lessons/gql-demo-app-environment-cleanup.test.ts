/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GQL_DEMO_ENV_NAME,
  GQL_DEMO_SVC_NAME,
  GQL_STUDIO_DEMO_ENV_NAME,
} from './env-manager-lesson-helpers';
import { purgeGqlDemoLessonEnvironmentsFromStorage } from './gql-demo-app-environment-cleanup';

vi.mock('../adapters', () => ({
  purgeGqlStudioEnvironmentsByName: vi.fn(),
}));

vi.mock('./gql-demo-storage-cleanup', () => ({
  purgeGqlDemoEphemeralStorage: vi.fn().mockResolvedValue({
    profilesRemoved: 0,
    runnerConfigsRemoved: 0,
    staleKeysRemoved: 0,
    freedKB: 0,
  }),
}));

vi.mock('@shared/utils/storage', () => ({
  loadEnvironments: vi.fn(),
  saveEnvironments: vi.fn(),
  loadMicroservices: vi.fn(),
  saveMicroservices: vi.fn(),
  loadSelectedEnvId: vi.fn(),
  loadSelectedSvcId: vi.fn(),
  saveSelectedEnvId: vi.fn(),
  saveSelectedSvcId: vi.fn(),
}));

import { purgeGqlStudioEnvironmentsByName } from '../adapters';
import { purgeGqlDemoEphemeralStorage } from './gql-demo-storage-cleanup';
import {
  loadEnvironments,
  saveEnvironments,
  loadMicroservices,
  saveMicroservices,
  loadSelectedEnvId,
  loadSelectedSvcId,
  saveSelectedEnvId,
  saveSelectedSvcId,
} from '@shared/utils/storage';

describe('purgeGqlDemoLessonEnvironmentsFromStorage', () => {
  beforeEach(() => {
    vi.mocked(purgeGqlStudioEnvironmentsByName).mockReset();
    vi.mocked(purgeGqlDemoEphemeralStorage).mockClear();
    vi.mocked(loadEnvironments).mockReset();
    vi.mocked(saveEnvironments).mockReset();
    vi.mocked(loadMicroservices).mockReset();
    vi.mocked(saveMicroservices).mockReset();
    vi.mocked(loadSelectedEnvId).mockReset();
    vi.mocked(loadSelectedSvcId).mockReset();
    vi.mocked(saveSelectedEnvId).mockReset();
    vi.mocked(saveSelectedSvcId).mockReset();
  });

  it('removes Demo studio env, GraphQL Demo env, and graphql-demo microservice from storage', async () => {
    vi.mocked(purgeGqlStudioEnvironmentsByName).mockResolvedValue(true);
    vi.mocked(loadEnvironments).mockResolvedValue([
      { id: 'e-demo', name: GQL_DEMO_ENV_NAME },
      { id: 'e-user', name: 'test' },
    ] as never);
    vi.mocked(loadMicroservices).mockResolvedValue([
      { id: 's-demo', name: GQL_DEMO_SVC_NAME, baseUrls: {} },
      { id: 's-user', name: 'api', baseUrls: {} },
    ] as never);
    vi.mocked(loadSelectedEnvId).mockResolvedValue('e-demo');
    vi.mocked(loadSelectedSvcId).mockResolvedValue('s-demo');

    const result = await purgeGqlDemoLessonEnvironmentsFromStorage();

    expect(purgeGqlStudioEnvironmentsByName).toHaveBeenCalledWith(GQL_STUDIO_DEMO_ENV_NAME);
    expect(purgeGqlDemoEphemeralStorage).toHaveBeenCalled();
    expect(result.removedStudioEnv).toBe(true);
    expect(result.removedEmEnvId).toBe('e-demo');
    expect(result.removedEmSvcId).toBe('s-demo');
    expect(result.resetEnvSelection).toBe(true);
    expect(result.resetSvcSelection).toBe(true);
    expect(saveEnvironments).toHaveBeenCalledWith([{ id: 'e-user', name: 'test' }]);
    expect(saveMicroservices).toHaveBeenCalledWith([{ id: 's-user', name: 'api', baseUrls: {} }]);
    expect(saveSelectedEnvId).toHaveBeenCalledWith('e-user');
    expect(saveSelectedSvcId).toHaveBeenCalledWith('s-user');
  });
});
