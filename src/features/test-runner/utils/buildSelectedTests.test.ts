import { describe, it, expect } from 'vitest';
import { buildSelectedTests } from './buildSelectedTests';
import { makeScenario } from '@test-utils/factories';
import type { FeatureGroup, Assertion, DataSource } from '@shared/types';

function makeFg(overrides: Partial<FeatureGroup> = {}): FeatureGroup {
  return {
    id: 'fg-1',
    name: 'FG',
    scenarios: [{
      id: 'sc-1',
      name: 'Scenario 1',
      kind: 'standard',
      tests: [makeScenario()],
    }],
    ...overrides,
  };
}

const selectAll = (fg: FeatureGroup) => new Set(fg.scenarios.map(s => s.id));

describe('buildSelectedTests', () => {
  it('returns tests with featureGroupName and groupName', () => {
    const fg = makeFg();
    const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
    expect(result).toHaveLength(1);
    expect(result[0].featureGroupName).toBe('FG');
    expect(result[0].groupName).toBe('Scenario 1');
  });

  it('skips unselected scenarios', () => {
    const fg = makeFg();
    const result = buildSelectedTests([fg], new Set(['non-existent']), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
    expect(result).toHaveLength(0);
  });

  describe('skipValidation', () => {
    it('forces mode to none when skipValidation is true', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', expectedFields: [{ path: '$.id', value: '1' }] } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, true, false, 'default', 'default', []);
      expect(result[0].validation.mode).toBe('none');
    });

    it('preserves assertions when skipValidation forces mode to none', () => {
      const assertions: Assertion[] = [
        { type: 'status', expected: '200' },
        { type: 'responseTime', maxMs: 5000 },
      ];
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', assertions, expectedFields: [{ path: '$.id', value: '1' }] } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, true, false, 'default', 'default', []);
      expect(result[0].validation.mode).toBe('none');
      expect(result[0].validation.assertions).toEqual(assertions);
      expect(result[0].validation.expectedFields).toEqual([{ path: '$.id', value: '1' }]);
    });

    it('overrides validationOverride when skipValidation is true', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'full', expectedJson: '{}' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, true, false, 'full', 'default', []);
      expect(result[0].validation.mode).toBe('none');
    });
  });

  describe('validationOverride', () => {
    it('applies none override to non-data-source tests', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'none', 'default', []);
      expect(result[0].validation.mode).toBe('none');
    });

    it('keeps default when validationOverride is default', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
      expect(result[0].validation.mode).toBe('selective');
    });

    it('applies override to data-source tests', () => {
      const ds: DataSource = { type: 'csv', rows: [], columns: [], validationMode: 'full' };
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ dataSource: ds, validation: { mode: 'selective' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'none', 'default', []);
      expect(result[0].dataSource?.validationMode).toBe('none');
    });
  });

  describe('forceUnordered', () => {
    it('force-on sets unorderedArrays on selective validation', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'force-on', []);
      expect(result[0].validation.unorderedArrays).toBe(true);
    });

    it('force-off clears unorderedArrays on selective validation', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', unorderedArrays: true } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'force-off', []);
      expect(result[0].validation.unorderedArrays).toBe(false);
    });

    it('default preserves scenario unorderedArrays setting', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', unorderedArrays: true } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
      expect(result[0].validation.unorderedArrays).toBe(true);
    });

    it('does not set unorderedArrays on non-selective modes', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'full' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'force-on', []);
      expect(result[0].validation.unorderedArrays).toBeUndefined();
    });
  });

  describe('host resolution', () => {
    it('prepends settings base URL to relative paths', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ url: '/api/test' })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'settings', '', 'https://new.com', false, false, 'default', 'default', []);
      expect(result[0].url).toBe('https://new.com/api/test');
    });

    it('prepends custom base URL to relative paths', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ url: '/api/test' })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'custom', 'https://custom.com', undefined, false, false, 'default', 'default', []);
      expect(result[0].url).toBe('https://custom.com/api/test');
    });

    it('rewrites absolute URLs onto the Settings host', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ url: 'https://httpbin.org/status/204' })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'settings', '', 'https://jsonplaceholder.typicode.com', false, false, 'default', 'default', []);
      expect(result[0].url).toBe('https://jsonplaceholder.typicode.com/status/204');
    });

    it('does not replace host for gallery feature groups', () => {
      const fg = makeFg({
        source: 'gallery',
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ url: 'https://gallery.com/api' })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'settings', '', 'https://override.com', false, false, 'default', 'default', []);
      expect(result[0].url).toBe('https://gallery.com/api');
    });
  });

  describe('scenarioTags', () => {
    it('copies tags from TestScenario to each test', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'Smoke Tests', kind: 'standard',
          tags: ['smoke', 'critical'],
          tests: [makeScenario({ id: 't1' }), makeScenario({ id: 't2' })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
      expect(result).toHaveLength(2);
      expect(result[0].scenarioTags).toEqual(['smoke', 'critical']);
      expect(result[1].scenarioTags).toEqual(['smoke', 'critical']);
    });

    it('handles scenarios without tags (undefined)', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'No Tags', kind: 'standard',
          tests: [makeScenario()],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
      expect(result[0].scenarioTags).toBeUndefined();
    });

    it('handles scenarios with empty tags array', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'Empty Tags', kind: 'standard',
          tags: [],
          tests: [makeScenario()],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
      expect(result[0].scenarioTags).toEqual([]);
    });
  });

  describe('gallery source handling', () => {
    it('uses the original test URL unchanged when feature group source is gallery', () => {
      const galleryFg = makeFg({
        source: 'gallery',
        scenarios: [{
          id: 'sc-gallery', name: 'Gallery Test', kind: 'standard',
          tests: [makeScenario({ url: '/gallery/endpoint' })],
        }],
      });
      const selected = new Set(['sc-gallery']);
      const result = buildSelectedTests(
        [galleryFg], selected, 'settings', '', 'https://api.example.com', false, false, 'default', 'default', [],
      );
      expect(result).toHaveLength(1);
      // Gallery tests ignore effectiveBaseUrl and keep their original URL
      expect(result[0].url).toBe('/gallery/endpoint');
    });

    it('applies baseUrl only to non-gallery feature groups', () => {
      const normalFg = makeFg({
        scenarios: [{
          id: 'sc-normal', name: 'Normal Test', kind: 'standard',
          tests: [makeScenario({ url: '/users' })],
        }],
      });
      const result = buildSelectedTests(
        [normalFg], selectAll(normalFg), 'settings', '', 'https://api.example.com', false, false, 'default', 'default', [],
      );
      expect(result[0].url).toBe('https://api.example.com/users');
    });
  });

  describe('host resolution — settings with undefined resolvedBaseUrl', () => {
    it('uses original URL when hostMode is settings but resolvedBaseUrl is undefined', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ url: '/api/test' })],
        }],
      });
      // resolvedBaseUrl is undefined → effectiveBaseUrl = '' → URL unchanged
      const result = buildSelectedTests([fg], selectAll(fg), 'settings', '', undefined, false, false, 'default', 'default', []);
      expect(result[0].url).toBe('/api/test');
    });
  });

  describe('validationOverride — dataSource + runtimeMode edge cases', () => {
    it('does NOT override validation mode when runtimeMode is full and no dataSource', () => {
      // !dataSource=true but runtimeMode='full' (not 'none') → if-body skipped
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'full', 'default', []);
      // runtimeMode='full' but condition is runtimeMode==='none', so mode stays 'selective'
      // But wait: 'full' override applies to non-data-source via runtimeMode, not via the none-branch
      // The validationOverride='full' path doesn't touch validation.mode via the none-check
      expect(result[0].validation.mode).toBe('selective');
    });

    it('does NOT override validation when dataSource exists and runtimeMode is none', () => {
      // dataSource exists → !dataSource=false → if-body skipped (short-circuit)
      const ds: DataSource = { type: 'csv', rows: [], columns: [], validationMode: 'full' };
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ dataSource: ds, validation: { mode: 'selective' } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'none', 'default', []);
      // dataSource present → none-mode-override branch is skipped
      expect(result[0].validation.mode).toBe('selective');
      // but dataSource.validationMode IS overridden to 'none' via the first if-block
      expect(result[0].dataSource?.validationMode).toBe('none');
    });
  });

  describe('skipAssertions', () => {
    it('clears assertions when skipAssertions is true and assertions exist', () => {
      const assertions: Assertion[] = [{ type: 'status', expected: '200' }];
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', assertions } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, true, 'default', 'default', []);
      expect(result[0].validation.assertions).toEqual([]);
    });

    it('preserves assertions when skipAssertions is false', () => {
      const assertions: Assertion[] = [{ type: 'status', expected: '200' }];
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', assertions } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, false, 'default', 'default', []);
      expect(result[0].validation.assertions).toEqual(assertions);
    });

    it('no-op when skipAssertions true but assertions is empty', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({ validation: { mode: 'selective', assertions: [] } })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, true, 'default', 'default', []);
      expect(result[0].validation.assertions).toEqual([]);
    });

    it('clears grpcCallAction.assertions when skipAssertions is true', () => {
      const fg = makeFg({
        scenarios: [{
          id: 'sc-1', name: 'S', kind: 'standard',
          tests: [makeScenario({
            actionType: 'grpcCall',
            method: 'GRPC',
            grpcCallAction: {
              callType: 'unary',
              target: 'localhost:50051',
              descriptorKey: 'echo-v1',
              service: 'echo.EchoService',
              method: 'Echo',
              body: {},
              assertions: [{ grpcStatus: 0 }],
            },
          })],
        }],
      });
      const result = buildSelectedTests([fg], selectAll(fg), 'hardcoded', '', undefined, false, true, 'default', 'default', []);
      expect(result[0].grpcCallAction?.assertions).toEqual([]);
    });
  });
});
