import { describe, it, expect, vi } from 'vitest';
import {
  autoDetectColumns,
  createEmptyDataSource,
  createDataSourceWithTemplatizedUrl,
  createEmptyRow,
  createEmptyColumn,
  buildUrlTemplate,
  syncUrlFromTemplate,
  dataSourceRowHasValues,
} from './dataSourceUtils';
import type { Scenario } from '@shared/types';
import { makeScenario } from '@test-utils/factories';
import * as dataSourceContract from './dataSourceContract';

vi.mock('uuid', () => {
  let counter = 0;
  return { v4: () => `test-uuid-${counter++}` };
});

describe('autoDetectColumns', () => {
  it('returns empty array for simple URL without params or variables', () => {
    const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/api' }));
    expect(cols).toHaveLength(0);
  });

  it('detects query parameters', () => {
    const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/api?channel=WEB&status=active' }));
    const paramCols = cols.filter(c => c.type === 'param');
    expect(paramCols).toHaveLength(2);
    expect(paramCols[0].name).toBe('channel');
    expect(paramCols[0].mapping).toBe('channel');
    expect(paramCols[1].name).toBe('status');
  });

  it('detects existing {{varName}} path placeholders in URL', () => {
    const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/vehicles/{{vin}}/details' }));
    const pathCols = cols.filter(c => c.type === 'path');
    expect(pathCols).toHaveLength(1);
    expect(pathCols[0].name).toBe('vin');
    expect(pathCols[0].mapping).toBe('vin');
  });

  it('does not detect literal path segments as variables', () => {
    // Without {{...}}, no path columns should be detected
    const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/vehicles/12345/details' }));
    const pathCols = cols.filter(c => c.type === 'path');
    expect(pathCols).toHaveLength(0);
  });

  it('detects body template variables', () => {
    const cols = autoDetectColumns(makeScenario({
      url: 'https://api.example.com/api',
      body: '{"vin": "{{vin}}", "channel": "{{channel}}"}',
    }));
    const bodyCols = cols.filter(c => c.type === 'body');
    expect(bodyCols).toHaveLength(2);
    expect(bodyCols[0].name).toBe('vin');
    expect(bodyCols[0].mapping).toBe('vin');
    expect(bodyCols[1].name).toBe('channel');
  });

  it('detects header template variables', () => {
    const cols = autoDetectColumns(makeScenario({
      url: 'https://api.example.com/api',
      headers: [{ key: 'X-Token', value: '{{authToken}}' }],
    }));
    const headerCols = cols.filter(c => c.type === 'header');
    expect(headerCols).toHaveLength(1);
    expect(headerCols[0].name).toBe('authToken');
    expect(headerCols[0].mapping).toBe('authToken');
  });

  it('deduplicates variables across types', () => {
    const cols = autoDetectColumns(makeScenario({
      url: 'https://api.example.com/api?vin=123',
      body: '{"vin": "{{vin}}"}', // same name as query param, but different type
    }));
    // vin appears as param and body — both should exist (different types)
    expect(cols.filter(c => c.name === 'vin')).toHaveLength(2);
  });

  it('does not duplicate same variable within same type', () => {
    const cols = autoDetectColumns(makeScenario({
      url: 'https://api.example.com/api',
      body: '{"a": "{{vin}}", "b": "{{vin}}"}',
    }));
    const bodyCols = cols.filter(c => c.type === 'body');
    expect(bodyCols).toHaveLength(1);
  });

  it('skips duplicate query keys (second occurrence)', () => {
    const cols = autoDetectColumns(makeScenario({
      url: 'https://api.example.com/api?dup=first&dup=second',
    }));
    expect(cols.filter(c => c.type === 'param' && c.name === 'dup')).toHaveLength(1);
  });

  it('ignores falsy scenario.body so no body columns are inferred', () => {
    const scenario = { ...makeScenario({ url: 'https://api.example.com/api', body: '' }), body: undefined } as unknown as Scenario;
    expect(autoDetectColumns(scenario).filter(c => c.type === 'body')).toHaveLength(0);
  });

  it('treats undefined headers like an empty array', () => {
    const scenario = makeScenario() as Scenario;
    (scenario as { headers?: typeof scenario.headers }).headers = undefined as unknown as typeof scenario.headers;
    expect(autoDetectColumns(scenario)).toHaveLength(0);
  });

  it('collects vars from header key and value and dedupes same name across key/value', () => {
    const cols = autoDetectColumns(makeScenario({
      url: 'https://api.example.com/api',
      headers: [{ key: 'X-{{token}}', value: '{{token}}' }],
    }));
    expect(cols.filter(c => c.type === 'header' && c.name === 'token')).toHaveLength(1);
  });

  it('still parses malformed URL string without throwing and skips query params when parse fails', () => {
    const cols = autoDetectColumns(makeScenario({ url: ':::not-a-valid-url:::' }));
    expect(cols.filter(c => c.type === 'param')).toHaveLength(0);
  });

  it('does not add param columns when the query pair has an empty key', () => {
    const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/api?=valueOnly' }));
    expect(cols.filter(c => c.type === 'param')).toHaveLength(0);
  });

  it('skips repeated path placeholders when extractor yields duplicate names', () => {
    const originalExtract = dataSourceContract.extractTemplateVariables.bind(dataSourceContract);
    const spy = vi.spyOn(dataSourceContract, 'extractTemplateVariables').mockImplementation((val: string) => (
      val.includes('__PATH_DUP_MARKER__') ? ['vin', 'vin'] : originalExtract(val)
    ));
    try {
      const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/__PATH_DUP_MARKER__/' }));
      expect(cols.filter(c => c.type === 'path')).toHaveLength(1);
      expect(cols[0].name).toBe('vin');
    } finally {
      spy.mockRestore();
    }
  });

  it('skips repeated body placeholders when extractor yields duplicate names', () => {
    const originalExtract = dataSourceContract.extractTemplateVariables.bind(dataSourceContract);
    const spy = vi.spyOn(dataSourceContract, 'extractTemplateVariables').mockImplementation((val: string) => (
      val === '__BODY_DUP_MARKER__' ? ['id', 'id'] : originalExtract(val)
    ));
    try {
      const cols = autoDetectColumns(makeScenario({ url: 'https://api.example.com/', body: '__BODY_DUP_MARKER__' }));
      expect(cols.filter(c => c.type === 'body')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createEmptyDataSource', () => {
  it('creates a table with auto-detected columns and one empty row', () => {
    const table = createEmptyDataSource(makeScenario({ url: 'https://api.example.com/api?foo=bar' }));
    expect(table.id).toMatch(/^test-uuid-/);
    expect(table.columns.length).toBeGreaterThanOrEqual(1);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].enabled).toBe(false);
    expect(table.source.type).toBe('inline');
  });

  it('creates a table with no columns for plain URL', () => {
    const table = createEmptyDataSource(makeScenario({ url: 'https://api.example.com/api' }));
    expect(table.columns).toHaveLength(0);
    expect(table.rows).toHaveLength(1);
  });
});

describe('createEmptyRow', () => {
  it('creates a disabled blank row for each column', () => {
    const columns = [
      { id: 'c1', name: 'vin', type: 'body' as const, mapping: 'vin' },
      { id: 'c2', name: 'channel', type: 'param' as const, mapping: 'channel' },
    ];
    const row = createEmptyRow(columns);
    expect(row.id).toMatch(/^test-uuid-/);
    expect(row.enabled).toBe(false);
    expect(row.values).toEqual({ c1: '', c2: '' });
  });
});

describe('dataSourceRowHasValues', () => {
  const columns = [
    { id: 'c1', name: 'userId', type: 'path' as const, mapping: 'userId' },
    { id: 'c2', name: 'expect', type: 'validate' as const, mapping: '$.id' },
  ];

  it('is false for blank request cells even when validate is set', () => {
    expect(dataSourceRowHasValues({ values: { c1: '', c2: '1' } }, columns)).toBe(false);
  });

  it('is true when a request cell has a value', () => {
    expect(dataSourceRowHasValues({ values: { c1: '42', c2: '' } }, columns)).toBe(true);
  });
});

describe('createEmptyColumn', () => {
  it('creates column with default name', () => {
    const col = createEmptyColumn([]);
    expect(col.name).toBe('column');
    expect(col.type).toBe('param');
    expect(col.mapping).toBe('column');
  });

  it('avoids name collision with existing columns', () => {
    const existing = [{ id: 'x', name: 'column', type: 'param' as const, mapping: 'column' }];
    const col = createEmptyColumn(existing);
    expect(col.name).toBe('column_1');
  });

  it('increments past multiple reserved names column, column_1, …', () => {
    const existing = [
      { id: 'a', name: 'column', type: 'param' as const, mapping: 'a' },
      { id: 'b', name: 'column_1', type: 'param' as const, mapping: 'b' },
      { id: 'c', name: 'column_2', type: 'param' as const, mapping: 'c' },
    ];
    expect(createEmptyColumn(existing).name).toBe('column_3');
  });
});

describe('createDataSourceWithTemplatizedUrl', () => {
  it('detects query params, pre-fills row, and builds urlTemplate with {{param}} placeholders', () => {
    const scenario = makeScenario({
      url: 'https://api.example.com/vehicles/1HGCM82633A004995/offers?channel=WEB&country=MX',
    });
    const { dataSource, url } = createDataSourceWithTemplatizedUrl(scenario);

    // URL should NOT be modified (no auto path templatization)
    expect(url).toContain('1HGCM82633A004995');
    expect(url).not.toContain('{{');

    // Only query param columns (no path columns — VIN not auto-detected)
    const pathCols = dataSource.columns.filter(c => c.type === 'path');
    const paramCols = dataSource.columns.filter(c => c.type === 'param');
    expect(pathCols).toHaveLength(0);
    expect(paramCols).toHaveLength(2);

    // First row should be pre-filled with param values
    const row = dataSource.rows[0];
    const channelCol = paramCols.find(c => c.name === 'channel')!;
    expect(row.values[channelCol.id]).toBe('WEB');
    const countryCol = paramCols.find(c => c.name === 'country')!;
    expect(row.values[countryCol.id]).toBe('MX');

    // urlTemplate should have {{param}} placeholders
    expect(dataSource.urlTemplate).toBe(
      'https://api.example.com/vehicles/1HGCM82633A004995/offers?channel={{channel}}&country={{country}}'
    );
  });

  it('detects existing {{vin}} placeholder as path column and includes in urlTemplate', () => {
    const scenario = makeScenario({
      url: 'https://api.example.com/vehicles/{{vin}}/offers?channel=WEB',
    });
    const { dataSource, url } = createDataSourceWithTemplatizedUrl(scenario);

    expect(url).toContain('{{vin}}');
    const pathCols = dataSource.columns.filter(c => c.type === 'path');
    expect(pathCols).toHaveLength(1);
    expect(pathCols[0].name).toBe('vin');

    // urlTemplate preserves {{vin}} and templatizes params
    expect(dataSource.urlTemplate).toBe(
      'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}'
    );
  });

  it('preserves URL when no variables detected', () => {
    const scenario = makeScenario({ url: 'https://api.example.com/status?env=prod' });
    const { dataSource, url } = createDataSourceWithTemplatizedUrl(scenario);

    expect(url).toBe('https://api.example.com/status?env=prod');
    expect(dataSource.columns).toHaveLength(1); // just the param
    expect(dataSource.urlTemplate).toBe('https://api.example.com/status?env={{env}}');
  });

  it('handles URL that URL() cannot parse: no param fill, urlTemplate is full string', () => {
    const raw = ':::bad-url:::?should=stay';
    const scenario = makeScenario({ url: raw });
    const { dataSource, url } = createDataSourceWithTemplatizedUrl(scenario);
    expect(url).toBe(raw);
    expect(dataSource.columns.filter(c => c.type === 'param')).toHaveLength(0);
    expect(dataSource.urlTemplate).toBe(raw.split('?')[0]);
  });

  it('does not hydrate row cells for unnamed query segments (no matching column)', () => {
    const scenario = makeScenario({ url: 'https://api.example.com/only-path?=ghost' });
    const { dataSource } = createDataSourceWithTemplatizedUrl(scenario);
    expect(dataSource.columns.filter(c => c.type === 'param')).toHaveLength(0);
    expect(dataSource.rows[0].values).toEqual({});
  });
});

describe('buildUrlTemplate', () => {
  it('replaces param values with {{paramName}} placeholders', () => {
    const columns = [
      { id: '1', name: 'channel', type: 'param' as const, mapping: 'channel' },
      { id: '2', name: 'country', type: 'param' as const, mapping: 'country' },
    ];
    const result = buildUrlTemplate('https://example.com/api?channel=WEB&country=MX', columns);
    expect(result).toBe('https://example.com/api?channel={{channel}}&country={{country}}');
  });

  it('preserves existing {{varName}} in path', () => {
    const columns = [
      { id: '1', name: 'vin', type: 'path' as const, mapping: 'vin' },
      { id: '2', name: 'env', type: 'param' as const, mapping: 'env' },
    ];
    const result = buildUrlTemplate('https://example.com/vehicles/{{vin}}/offers?env=prod', columns);
    expect(result).toBe('https://example.com/vehicles/{{vin}}/offers?env={{env}}');
  });

  it('returns base path when no param columns', () => {
    const columns = [
      { id: '1', name: 'vin', type: 'path' as const, mapping: 'vin' },
    ];
    const result = buildUrlTemplate('https://example.com/vehicles/{{vin}}/offers', columns);
    expect(result).toBe('https://example.com/vehicles/{{vin}}/offers');
  });

  it('uses full URL as base path when URL has no query string', () => {
    expect(buildUrlTemplate('https://example.com/api', [{ id: '1', name: 'x', type: 'path' as const, mapping: 'x' }])).toBe('https://example.com/api');
  });
});

describe('syncUrlFromTemplate', () => {
  it('replaces draft path using template path and preserves draft query', () => {
    expect(syncUrlFromTemplate('https://old.com/old?q=1', 'https://new.com/new?ignored=2')).toBe('https://new.com/new?q=1');
  });

  it('uses full template when it has no query and draft has no query', () => {
    expect(syncUrlFromTemplate('https://a.com/x', 'https://b.com/y')).toBe('https://b.com/y');
  });

  it('appends draft query when template has no ?', () => {
    expect(syncUrlFromTemplate('https://a.com/x?z=9', 'https://b.com/y')).toBe('https://b.com/y?z=9');
  });

  it('uses only template path when draft has no query', () => {
    expect(syncUrlFromTemplate('https://a.com/plain', 'https://b.com/tmpl?u=1')).toBe('https://b.com/tmpl');
  });
});
