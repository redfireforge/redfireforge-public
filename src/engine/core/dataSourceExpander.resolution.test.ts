/**
 * dataSourceExpander Resolution Tests
 * Split from monolithic dataSourceExpander.test.ts (961 lines -> ~360 lines)
 * Tests: resolveScenarioFromDataRow - URL/body/header substitution logic
 */
import { describe, it, expect } from 'vitest';
import { resolveScenarioFromDataRow } from './dataSourceExpander';
import { DataSourceColumn, DataSourceRow } from '@shared/types';
import { makeScenario, makeColumns, makeRow, makeDataSource } from './__test-utils__/dataSourceExpanderHelpers';

describe('resolveScenarioFromDataRow', () => {
  it('substitutes path variables in URL', () => {
    const base = makeScenario();
    const cols = makeColumns();
    const row = makeRow('r1', '42', 'WEB');
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('/users/42/');
  });

  it('sets query parameters from param columns', () => {
    const base = makeScenario();
    const cols = makeColumns();
    const row = makeRow('r1', '42', 'WEB');
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.searchParams.get('channel')).toBe('WEB');
  });

  it('replaces {{placeholder}} with empty string when param column value is empty', () => {
    const base = makeScenario({
      url: 'https://api.example.com/data?channel={{channel}}&code={{code}}',
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'channel', type: 'param', mapping: 'channel' },
      { id: 'c2', name: 'code', type: 'param', mapping: 'code' },
    ];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'WEB', c2: '' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.searchParams.get('channel')).toBe('WEB');
    expect(url.searchParams.get('code')).toBe('');
    expect(resolved.url).not.toContain('{{');
    expect(resolved.url).not.toContain('%7B%7B');
  });

  it('replaces body variables from body columns', () => {
    const base = makeScenario({
      url: 'https://api.example.com/login',
      method: 'POST',
      body: '{"username":"{{user}}","password":"{{pass}}"}',
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'user', type: 'body', mapping: 'user' },
      { id: 'c2', name: 'pass', type: 'body', mapping: 'pass' },
    ];
    const row: DataSourceRow = {
      id: 'r1',
      values: { c1: 'alice', c2: 'secret' },
      enabled: true,
    };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.body).toBe('{"username":"alice","password":"secret"}');
  });

  it('adds header values from header columns', () => {
    const base = makeScenario({
      headers: [{ key: 'Content-Type', value: 'application/json' }],
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'token', type: 'header', mapping: 'X-Auth-Token' },
    ];
    const row: DataSourceRow = {
      id: 'r1',
      values: { c1: 'tok_abc123' },
      enabled: true,
    };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.headers).toContainEqual({ key: 'X-Auth-Token', value: 'tok_abc123' });
    expect(resolved.headers).toContainEqual({ key: 'Content-Type', value: 'application/json' });
  });

  it('overrides existing headers by name (case-insensitive)', () => {
    const base = makeScenario({
      headers: [{ key: 'X-Custom', value: 'old-value' }],
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'custom', type: 'header', mapping: 'X-Custom' },
    ];
    const row: DataSourceRow = {
      id: 'r1',
      values: { c1: 'new-value' },
      enabled: true,
    };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.headers).toEqual([{ key: 'X-Custom', value: 'new-value' }]);
  });

  it('clears dataSource on expanded scenarios', () => {
    const base = makeScenario({ dataSource: makeDataSource() });
    const cols = makeColumns();
    const row = makeRow('r1', '42', 'WEB');
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.dataSource).toBeUndefined();
  });

  it('sets dataRowId and dataRowLabel', () => {
    const base = makeScenario();
    const cols = makeColumns();
    const row = makeRow('r1', '42', 'WEB');
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.dataRowId).toBe('r1');
    expect(resolved.dataRowLabel).toBe('Row 1: userId=42, channel=WEB');
  });

  it('preserves featureGroupName and groupName', () => {
    const base = makeScenario({ featureGroupName: 'FG', groupName: 'GRP' });
    const cols = makeColumns();
    const row = makeRow('r1', '42', 'WEB');
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.featureGroupName).toBe('FG');
    expect(resolved.groupName).toBe('GRP');
  });

  it('leaves unmatched {{variables}} in place', () => {
    const base = makeScenario({
      url: 'https://api.example.com/{{region}}/users',
    });
    const resolved = resolveScenarioFromDataRow(base, [], makeRow('r1', '', ''), 0);
    expect(resolved.url).toContain('{{region}}');
  });

  it('uses column name as path var key when URL placeholder matches name but not mapping', () => {
    const base = makeScenario({
      url: 'https://api.example.com/users/{{userId}}/posts',
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'userId', type: 'path', mapping: 'uid' },
    ];
    const row: DataSourceRow = { id: 'r1', values: { c1: '99' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('/users/99/posts');
  });

  it('uses mapping as path var key when URL contains {{mapping}} placeholder', () => {
    const base = makeScenario({
      url: 'https://api.example.com/users/{{uid}}/posts',
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'userId', type: 'path', mapping: 'uid' },
    ];
    const row: DataSourceRow = { id: 'r1', values: { c1: '77' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('/users/77/posts');
  });

  it('skips path substitution when row value is a lone template token', () => {
    const base = makeScenario({ url: 'https://api.example.com/users/{{userId}}/posts' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'userId', type: 'path', mapping: 'userId' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: '{{fromElsewhere}}' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('{{userId}}');
  });

  it('falls back through normalizeUnresolvedQueryPlaceholders when base URL is not parseable (no param columns)', () => {
    const base = makeScenario({ url: 'not-a-valid-url' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'userId', type: 'path', mapping: 'userId' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: '1' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toBe('not-a-valid-url');
  });

  it('falls back when param substitution yields a non-parseable URL', () => {
    const base = makeScenario({ url: 'not-a-valid-url?channel={{channel}}' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'channel', type: 'param', mapping: 'channel' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'WEB' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('channel');
    expect(resolved.url).not.toContain('{{channel}}');
  });

  it('does not rewrite body when body is empty despite body columns', () => {
    const base = makeScenario({ url: 'https://api.example.com/x', body: '' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'x', type: 'body', mapping: 'x' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'hello' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.body).toBe('');
  });

  it('sets unorderedArrays when arrayValidationMode has unordered and no expected fields', () => {
    const base = makeScenario({ validation: { mode: 'full' } });
    const cols = makeColumns();
    const row: DataSourceRow = {
      id: 'r1',
      values: { 'col-uid': '1', 'col-ch': 'WEB', 'col-val': '' },
      enabled: true,
    };
    const resolved = resolveScenarioFromDataRow(
      base,
      cols,
      row,
      0,
      { items: 'unordered' },
      'full',
    );
    expect(resolved.validation.unorderedArrays).toBe(true);
    expect(resolved.validation.expectedFields).toBeUndefined();
  });

  it('merges unorderedArrays from arrayValidationMode into selective validation when expected fields exist', () => {
    const base = makeScenario({ validation: { mode: 'full', unorderedArrays: false } });
    const cols = makeColumns();
    const row = makeRow('r1', '1', 'WEB', '200');
    const resolved = resolveScenarioFromDataRow(
      base,
      cols,
      row,
      0,
      { items: 'unordered' },
      'full',
    );
    expect(resolved.validation.mode).toBe('selective');
    expect(resolved.validation.unorderedArrays).toBe(true);
  });

  it('prefers name key for new query param when URL has both mapping and name keys and row supplies both', () => {
    const base = makeScenario({
      url: 'https://api.example.com/data?channel={{channel}}&ch={{ch}}',
    });
    const cols: DataSourceColumn[] = [
      { id: 'c1', name: 'ch', type: 'param', mapping: 'channel' },
    ];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'APP' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.searchParams.get('channel')).toBe('APP');
    expect(url.searchParams.get('ch')).toBe('APP');
  });

  it('clears template-only query param values after path substitution', () => {
    const base = makeScenario({
      url: 'https://api.example.com/users/{{userId}}/data?extra={{extra}}',
    });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'userId', type: 'path', mapping: 'userId' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: '5' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.pathname).toContain('/users/5/');
    expect(url.searchParams.get('extra')).toBe('');
  });

  it('clears query params that stay as template tokens after param substitution pass', () => {
    const base = makeScenario({
      url: 'https://api.example.com/data?channel={{channel}}&orphan={{orphan}}',
    });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'channel', type: 'param', mapping: 'channel' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'WEB' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.searchParams.get('channel')).toBe('WEB');
    expect(url.searchParams.get('orphan')).toBe('');
  });

  it('does not merge param values that are empty or lone placeholder tokens', () => {
    const base = makeScenario({
      url: 'https://api.example.com/data?a={{a}}&b={{b}}',
    });
    const cols: DataSourceColumn[] = [
      { id: 'ca', name: 'a', type: 'param', mapping: 'a' },
      { id: 'cb', name: 'b', type: 'param', mapping: 'b' },
    ];
    const row: DataSourceRow = { id: 'r1', values: { ca: '', cb: '{{nested}}' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.searchParams.get('a')).toBe('');
    expect(url.searchParams.get('b')).toBe('');
  });

  it('omits path vars when mapping and name are both blank', () => {
    const base = makeScenario({ url: 'https://api.example.com/users/{{userId}}/x' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: '', type: 'path', mapping: '' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: '99' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('{{userId}}');
  });

  it('keeps existing validation unorderedArrays when expected fields apply and mode was already unordered', () => {
    const base = makeScenario({
      validation: { mode: 'full', unorderedArrays: true },
    });
    const cols = makeColumns();
    const row = makeRow('r1', '1', 'WEB', '200');
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0, undefined, 'full');
    expect(resolved.validation.unorderedArrays).toBe(true);
  });

  it('selects name over mapping for new query key when mapping key is absent from URL', () => {
    const base = makeScenario({
      url: 'https://api.example.com/data?ch={{ch}}',
    });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'ch', type: 'param', mapping: 'channel' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'X' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    const url = new URL(resolved.url);
    expect(url.searchParams.get('ch')).toBe('X');
    expect(url.searchParams.has('channel')).toBe(false);
  });

  it('ignores param mapping when computed query key is blank', () => {
    const base = makeScenario({ url: 'https://api.example.com/data?x=1' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: '', type: 'param', mapping: '' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'oops' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('x=1');
  });

  it('uses empty string for header column when row omits that cell', () => {
    const base = makeScenario({ headers: [] });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 't', type: 'header', mapping: 'X-Token' }];
    const row: DataSourceRow = { id: 'r1', values: {}, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.headers).toContainEqual({ key: 'X-Token', value: '' });
  });

  it('substitutes body placeholders with empty string when row omits that cell', () => {
    const base = makeScenario({
      url: 'https://api.example.com/x',
      body: '{"a":"{{a}}"}',
    });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'a', type: 'body', mapping: 'a' }];
    const row: DataSourceRow = { id: 'r1', values: {}, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.body).toBe('{"a":""}');
  });

  it('path column with empty mapping falls back to name placeholder (lines 88/90 false branch)', () => {
    // mapping is empty, name is used as placeholder key
    const base = makeScenario({ url: 'https://api.example.com/users/{{userId}}/orders' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'userId', type: 'path', mapping: '' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: '42' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('42');
    expect(resolved.url).not.toContain('{{userId}}');
  });

  it('path column with empty name skips name lookup (line 91 false branch)', () => {
    // name is empty, mapping is used
    const base = makeScenario({ url: 'https://api.example.com/users/{{uid}}/orders' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: '', type: 'path', mapping: 'uid' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: '99' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('99');
    expect(resolved.url).not.toContain('{{uid}}');
  });

  it('param column with empty mapping skips vars[mapping] (line 113 false branch)', () => {
    const base = makeScenario({ url: 'https://api.example.com/data?x={{val}}' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'val', type: 'param', mapping: '' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'hello' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    // 'val' should be substituted via name
    expect(resolved.url).toContain('val=hello');
  });

  it('param column with name matching mapping skips duplicate vars (line 114 false branch)', () => {
    const base = makeScenario({ url: 'https://api.example.com/data?cat=a' });
    // name === mapping — should not add duplicate
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'cat', type: 'param', mapping: 'cat' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'b' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('cat=b');
  });

  it('param col uses name when mapping not in existingKeys but name is (lines 127-128 false branch)', () => {
    // URL has ?sortBy=asc — existingKeys = {'sortBy'}
    // Column mapping='order', name='sortBy'
    // mapping is truthy: 'order'
    // has('order') = false, !name = false, !has('sortBy') = false
    // => condition is false → key = 'sortBy' (name)
    const base = makeScenario({ url: 'https://api.example.com/data?sortBy=asc' });
    const cols: DataSourceColumn[] = [{ id: 'c1', name: 'sortBy', type: 'param', mapping: 'order' }];
    const row: DataSourceRow = { id: 'r1', values: { c1: 'desc' }, enabled: true };
    const resolved = resolveScenarioFromDataRow(base, cols, row, 0);
    expect(resolved.url).toContain('sortBy=desc');
  });
});
