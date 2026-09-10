/**
 * buildSelectedTests Utility Tests
 * Split from monolithic ScenarioSelector.test.tsx (979 lines)
 * Tests: buildSelectedTests function - test selection, URL rewriting, validation logic
 */
import { describe, it, expect } from 'vitest';
import { buildSelectedTests } from '../utils/buildSelectedTests';
import { mockFeatureGroups } from './ScenarioSelector.test.utils';
import type { FeatureGroup } from '@shared/types';

describe('buildSelectedTests', () => {
  it('returns empty array when no scenarios selected', () => {
    const result = buildSelectedTests(
      mockFeatureGroups,
      new Set(),
      'hardcoded',
      '',
      undefined,
      false,
      false,
      'default',
      false,
      [],
    );
    expect(result).toEqual([]);
  });

  it('returns tests for selected scenarios', () => {
    const result = buildSelectedTests(
      mockFeatureGroups,
      new Set(['sc1']),
      'hardcoded',
      '',
      undefined,
      false,
      false,
      'default',
      false,
      [],
    );
    
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Create User');
    expect(result[1].name).toBe('Get User');
  });

  it('replaces host when settings mode is used with relative URLs', () => {
    const relativeUrlGroups: FeatureGroup[] = [{
      id: 'fg1',
      name: 'User API',
      scenarios: [{
        id: 'sc1',
        name: 'User CRUD',
        tests: [
          { id: 't1', name: 'Create User', method: 'POST', url: '/users', headers: [], validation: { mode: 'none' }, auth: { type: 'none' } },
          { id: 't2', name: 'Get User', method: 'GET', url: '/users/1', headers: [], validation: { mode: 'none' }, auth: { type: 'none' } },
        ],
      }],
    }];
    const result = buildSelectedTests(
      relativeUrlGroups,
      new Set(['sc1']),
      'settings',
      '',
      'https://staging.example.com',
      false,
      false,
      'default',
      false,
      [],
    );
    
    expect(result[0].url).toBe('https://staging.example.com/users');
    expect(result[1].url).toBe('https://staging.example.com/users/1');
  });

  it('rewrites absolute URLs when settings mode is used', () => {
    const result = buildSelectedTests(
      mockFeatureGroups,
      new Set(['sc1']),
      'settings',
      '',
      'https://staging.example.com',
      false,
      false,
      'default',
      false,
      [],
    );

    expect(result[0].url).toBe('https://staging.example.com/users');
    expect(result[1].url).toBe('https://staging.example.com/users/1');
  });

  it('replaces host when custom mode is used with relative URLs', () => {
    const relativeUrlGroups: FeatureGroup[] = [{
      id: 'fg1',
      name: 'User API',
      scenarios: [{
        id: 'sc1',
        name: 'User CRUD',
        tests: [
          { id: 't1', name: 'Create User', method: 'POST', url: '/users', headers: [], validation: { mode: 'none' }, auth: { type: 'none' } },
          { id: 't2', name: 'Get User', method: 'GET', url: '/users/1', headers: [], validation: { mode: 'none' }, auth: { type: 'none' } },
        ],
      }],
    }];
    const result = buildSelectedTests(
      relativeUrlGroups,
      new Set(['sc1']),
      'custom',
      'https://custom.example.com',
      undefined,
      false,
      false,
      'default',
      false,
      [],
    );
    
    expect(result[0].url).toBe('https://custom.example.com/users');
  });

  it('adds feature and group names to tests', () => {
    const result = buildSelectedTests(
      mockFeatureGroups,
      new Set(['sc1']),
      'hardcoded',
      '',
      undefined,
      false,
      false,
      'default',
      false,
      [],
    );
    
    expect(result[0].featureGroupName).toBe('User API');
    expect(result[0].groupName).toBe('User CRUD');
  });

  it('applies validationOverride to dataSource rows', () => {
    const fgs: FeatureGroup[] = [{
      id: 'fg1',
      name: 'API',
      scenarios: [{
        id: 'sc1',
        name: 'Test',
        tests: [{
          id: 't1',
          name: 'T',
          method: 'GET',
          url: '/api',
          headers: [],
          validation: { mode: 'none' },
          auth: { type: 'none' },
          dataSource: { columns: [], rows: [{ id: 'r1', enabled: true, values: {} }] },
        }],
      }],
    }];

    const result = buildSelectedTests(fgs, new Set(['sc1']), 'hardcoded', '', undefined, false, false, 'full', 'default', []);
    expect(result[0].dataSource?.validationMode).toBe('full');
  });

  it('sets validation to none when skipValidation and no dataSource', () => {
    const result = buildSelectedTests(
      mockFeatureGroups,
      new Set(['sc1']),
      'hardcoded',
      '',
      undefined,
      true,
      false,
      'default',
      false,
      [],
    );
    expect(result[0].validation).toEqual({ mode: 'none' });
  });

  it('applies forceUnordered to selective validation', () => {
    const fgs: FeatureGroup[] = [{
      id: 'fg1',
      name: 'API',
      scenarios: [{
        id: 'sc1',
        name: 'Test',
        tests: [{
          id: 't1',
          name: 'T',
          method: 'GET',
          url: '/api',
          headers: [],
          validation: { mode: 'selective', fields: [] },
          auth: { type: 'none' },
        }],
      }],
    }];

    const result = buildSelectedTests(fgs, new Set(['sc1']), 'hardcoded', '', undefined, false, false, 'default', 'force-on', []);
    expect((result[0].validation as { unorderedArrays?: boolean }).unorderedArrays).toBe(true);
  });

  it('does not apply forceUnordered to non-selective validation', () => {
    const result = buildSelectedTests(
      mockFeatureGroups,
      new Set(['sc1']),
      'hardcoded',
      '',
      undefined,
      false,
      false,
      'default',
      'force-on',
      [],
    );
    expect((result[0].validation as { unorderedArrays?: boolean }).unorderedArrays).toBeUndefined();
  });

  it('does not replace host for gallery sources', () => {
    const fgs: FeatureGroup[] = [{
      id: 'fg-gal',
      name: 'Gallery',
      source: 'gallery',
      scenarios: [{
        id: 'sc-g',
        name: 'G',
        tests: [{ id: 't1', name: 'T', method: 'GET', url: 'https://gallery.api/items', headers: [], validation: { mode: 'none' }, auth: { type: 'none' } }],
      }],
    }];

    const result = buildSelectedTests(fgs, new Set(['sc-g']), 'settings', '', 'https://staging.com', false, false, 'default', 'default', []);
    expect(result[0].url).toBe('https://gallery.api/items');
  });
});
