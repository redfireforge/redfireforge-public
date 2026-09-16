/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import Papa from 'papaparse';
import { generateCsvTemplate, parseCsvToScenarios, downloadCsv } from './csvTemplateCsv';
import type { Scenario } from '@shared/types';
import { META_LINE_PREFIX } from './csvTemplateTypes';

function minimalScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 't1',
    name: 'N',
    url: 'https://example.com/api',
    method: 'GET',
    headers: [],
    body: '',
    auth: { type: 'none' },
    validation: { mode: 'none' },
    ...overrides,
  };
}

describe('csvTemplateCsv — generate and parse', () => {
  it('parseCsvToScenarios leaves meta null when metadata line is absent', () => {
    const csv = 'name,url\nRow,https://example.test/';
    const result = parseCsvToScenarios(csv);
    expect(result.meta).toBeNull();
    expect(result.validRows).toBe(1);
  });

  it('generateCsvTemplate prefixes meta and a single sample row', () => {
    const test = minimalScenario();
    const csv = generateCsvTemplate({ test, pathVariables: [] });
    expect(csv.startsWith(META_LINE_PREFIX)).toBe(true);
    expect(csv).toContain('name');
    expect(csv).toContain('https://example.com/api');
  });

  it('parseCsvToScenarios strips valid metadata and parses rows', () => {
    const test = minimalScenario({ name: 'Row1' });
    const csv = generateCsvTemplate({ test, pathVariables: [] });
    const result = parseCsvToScenarios(csv);
    expect(result.meta).toBeTruthy();
    expect(result.validRows).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].scenario?.name).toBe('Row1');
  });

  it('parseCsvToScenarios keeps meta null when metadata JSON is invalid', () => {
    const body = 'name,url\nX,https://x.test/';
    const csv = `${META_LINE_PREFIX}{broken\n${body}`;
    const result = parseCsvToScenarios(csv);
    expect(result.meta).toBeNull();
    expect(result.validRows).toBe(1);
  });

  it('parseCsvToScenarios records error rows when name is missing', () => {
    const csv = 'name,url\n,https://x.test/';
    const result = parseCsvToScenarios(csv);
    expect(result.errorRows).toBe(1);
    expect(result.rows[0].scenario).toBeNull();
  });

  it('parseCsvToScenarios tracks valid and invalid rows together', () => {
    const csv = 'name,url\nRow,https://ok.test/\n,https://bad.test/';
    const result = parseCsvToScenarios(csv);
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(1);
    expect(result.errorRows).toBe(1);
  });

  it('defaults columns to empty array when Papa result omits meta.fields', () => {
    const parseSpy = vi.spyOn(Papa, 'parse').mockReturnValue({
      data: [],
      meta: {},
      errors: [],
    } as Papa.ParseResult<Record<string, string>>);
    const result = parseCsvToScenarios('name,url\n');
    expect(result.columns).toEqual([]);
    parseSpy.mockRestore();
  });
});

describe('downloadCsv', () => {
  it('downloads CSV through a data URL so Chrome keeps the real filename', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const click = vi.fn();
    const appendChild = vi.fn();
    const remove = vi.fn();
    const anchor = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click,
      setAttribute: vi.fn(),
      remove,
    } as unknown as HTMLAnchorElement;
    const createEl = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChild);

    await downloadCsv('h1,h2\na,b', 'export.csv');

    expect(createEl).toHaveBeenCalledWith('a');
    expect(anchor.href.startsWith('data:application/octet-stream;charset=utf-8,')).toBe(true);
    expect(anchor.href).toContain(encodeURIComponent('h1,h2\na,b'));
    expect(anchor.download).toBe('export.csv');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();

    createObjectURL.mockRestore();
    createEl.mockRestore();
  });
});
