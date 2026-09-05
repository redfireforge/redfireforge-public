/**
 * Shared test helpers for dataSourceExpander tests
 */
import type { Scenario, DataSource, DataSourceColumn, DataSourceRow, TestScenario, FeatureGroup } from '@shared/types';
import { makeScenario as _makeScenario } from '@test-utils/factories';

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return _makeScenario({
    url: 'https://api.example.com/users/{{userId}}/posts?channel={{channel}}',
    headers: [{ key: 'X-Custom', value: 'static' }],
    ...overrides,
  });
}

export function makeColumns(): DataSourceColumn[] {
  return [
    { id: 'col-uid', name: 'userId', type: 'path', mapping: 'userId' },
    { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
    { id: 'col-val', name: 'expectedStatus', type: 'validate', mapping: '$.status' },
  ];
}

export function makeRow(id: string, userId: string, channel: string, expected = 'active', enabled = true): DataSourceRow {
  return {
    id,
    values: { 'col-uid': userId, 'col-ch': channel, 'col-val': expected },
    enabled,
  };
}

export function makeDataSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    id: 'dt-1',
    columns: makeColumns(),
    rows: [
      makeRow('r1', '42', 'WEB'),
      makeRow('r2', '99', 'APP'),
      makeRow('r3', '7', 'MOBILE', 'pending', false), // disabled
    ],
    source: { type: 'inline' },
    ...overrides,
  };
}

export function makeTestScenario(overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id: 'ts-1',
    name: 'Test Scenario',
    kind: 'standard',
    tests: [],
    ...overrides,
  };
}

export function makeFeatureGroup(scenarios: TestScenario[], overrides: Partial<FeatureGroup> = {}): FeatureGroup {
  return {
    id: 'fg-1',
    name: 'Feature Group',
    scenarios,
    ...overrides,
  };
}
