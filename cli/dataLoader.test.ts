import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDataFile, buildDataSourceFromInline } from './dataLoader';
import { readFileSync } from 'fs';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter}`),
}));

describe('dataLoader', () => {
  beforeEach(() => {
    resetAllMocks();
    uuidCounter = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadDataFile', () => {
    describe('CSV files', () => {
      it('parses a simple CSV file', () => {
        const csvContent = `userId,channel,status
42,WEB,200
99,MOBILE,201`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/data.csv');

        expect(result.label).toBe('/path/to/data.csv');
        expect(result.source).toEqual({ type: 'file', filePath: '/path/to/data.csv' });
        expect(result.columns).toHaveLength(3);
        expect(result.columns[0].name).toBe('userId');
        expect(result.columns[0].type).toBe('param');
        expect(result.columns[1].name).toBe('channel');
        expect(result.columns[2].name).toBe('status');
        expect(result.rows).toHaveLength(2);
      });

      it('handles validate: column prefix', () => {
        const csvContent = `userId,validate:status
42,200`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/data.csv');

        const validateCol = result.columns.find(c => c.name === 'validate:status');
        expect(validateCol?.type).toBe('validate');
        expect(validateCol?.mapping).toBe('status');
      });

      it('handles header: column prefix', () => {
        const csvContent = `userId,header:Authorization
42,Bearer token123`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/data.csv');

        const headerCol = result.columns.find(c => c.name === 'header:Authorization');
        expect(headerCol?.type).toBe('header');
        expect(headerCol?.mapping).toBe('Authorization');
      });

      it('trims column header whitespace', () => {
        const csvContent = `  userId  ,  channel  
42,WEB`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/data.csv');

        expect(result.columns[0].name).toBe('userId');
        expect(result.columns[1].name).toBe('channel');
      });

      it('throws on CSV parse error', () => {
        const badCsv = `col1,col2
"unterminated`;
        vi.mocked(readFileSync).mockReturnValue(badCsv);

        expect(() => loadDataFile('/path/to/bad.csv')).toThrow(/CSV parse error/);
      });

      it('throws on empty CSV file', () => {
        const emptyCsv = `userId,channel`;
        vi.mocked(readFileSync).mockReturnValue(emptyCsv);

        expect(() => loadDataFile('/path/to/empty.csv')).toThrow(/Data file is empty/);
      });

      it('handles CSV with uppercase extension', () => {
        const csvContent = `userId,channel
42,WEB`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/DATA.CSV');

        expect(result.rows).toHaveLength(1);
      });

      // ─── Special Row-Metadata Columns (BUG-3 / BUG-2 CSV half) ────────

      describe('_tags/_label/_note/_enabled columns', () => {
        it('excludes special columns from the columns list (no longer leak as params)', () => {
          const csvContent = `userId,name,_tags,_label,_note,_enabled
1,Alice,smoke;critical,happy-path,Standard lookup,true`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.columns.map(c => c.name)).toEqual(['userId', 'name']);
        });

        it('parses _tags as a semicolon-separated, lowercased, trimmed tag array', () => {
          const csvContent = `userId,_tags
1,"smoke;Critical ; regression"`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.rows[0].tags).toEqual(['smoke', 'critical', 'regression']);
        });

        it('leaves tags undefined when _tags is empty or missing', () => {
          const csvContent = `userId,_tags
1,`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.rows[0].tags).toBeUndefined();
        });

        it('uses _label as the row label, overriding the default "Row N"', () => {
          const csvContent = `userId,_label
1,happy-path`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.rows[0].label).toBe('happy-path');
        });

        it('falls back to "Row N" when _label is empty', () => {
          const csvContent = `userId,_label
1,`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.rows[0].label).toBe('Row 1');
        });

        it('maps _note to row.note', () => {
          const csvContent = `userId,_note
1,Edge case`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.rows[0].note).toBe('Edge case');
        });

        it('parses _enabled: false disables the row; anything else (including missing) is enabled', () => {
          const csvContent = `userId,_enabled
1,false
2,true
3,`;
          vi.mocked(readFileSync).mockReturnValue(csvContent);

          const result = loadDataFile('/path/to/data.csv');

          expect(result.rows[0].enabled).toBe(false);
          expect(result.rows[1].enabled).toBe(true);
          expect(result.rows[2].enabled).toBe(true);
        });
      });
    });

    describe('JSON files', () => {
      it('parses a simple JSON array', () => {
        const jsonContent = JSON.stringify([
          { userId: 42, channel: 'WEB' },
          { userId: 99, channel: 'MOBILE' },
        ]);
        vi.mocked(readFileSync).mockReturnValue(jsonContent);

        const result = loadDataFile('/path/to/data.json');

        expect(result.label).toBe('/path/to/data.json');
        expect(result.source).toEqual({ type: 'file', filePath: '/path/to/data.json' });
        expect(result.columns).toHaveLength(2);
        expect(result.rows).toHaveLength(2);
      });

      it('converts non-string values to JSON strings', () => {
        const jsonContent = JSON.stringify([
          { userId: 42, nested: { foo: 'bar' }, arr: [1, 2, 3] },
        ]);
        vi.mocked(readFileSync).mockReturnValue(jsonContent);

        const result = loadDataFile('/path/to/data.json');

        const row = result.rows[0];
        const userIdCol = result.columns.find(c => c.name === 'userId')!;
        const nestedCol = result.columns.find(c => c.name === 'nested')!;
        const arrCol = result.columns.find(c => c.name === 'arr')!;

        expect(row.values[userIdCol.id]).toBe('42');
        expect(row.values[nestedCol.id]).toBe('{"foo":"bar"}');
        expect(row.values[arrCol.id]).toBe('[1,2,3]');
      });

      it('handles validate: and header: prefixes in JSON', () => {
        const jsonContent = JSON.stringify([
          { userId: 42, 'validate:status': 200, 'header:Authorization': 'Bearer token' },
        ]);
        vi.mocked(readFileSync).mockReturnValue(jsonContent);

        const result = loadDataFile('/path/to/data.json');

        const validateCol = result.columns.find(c => c.name === 'validate:status');
        const headerCol = result.columns.find(c => c.name === 'header:Authorization');
        expect(validateCol?.type).toBe('validate');
        expect(validateCol?.mapping).toBe('status');
        expect(headerCol?.type).toBe('header');
        expect(headerCol?.mapping).toBe('Authorization');
      });

      it('throws if JSON is not an array', () => {
        const jsonContent = JSON.stringify({ userId: 42 });
        vi.mocked(readFileSync).mockReturnValue(jsonContent);

        expect(() => loadDataFile('/path/to/data.json')).toThrow(/must be an array of objects/);
      });

      it('throws on empty JSON array', () => {
        const jsonContent = JSON.stringify([]);
        vi.mocked(readFileSync).mockReturnValue(jsonContent);

        expect(() => loadDataFile('/path/to/empty.json')).toThrow(/Data file is empty/);
      });

      it('handles string values without modification', () => {
        const jsonContent = JSON.stringify([
          { userId: '42', message: 'hello world' },
        ]);
        vi.mocked(readFileSync).mockReturnValue(jsonContent);

        const result = loadDataFile('/path/to/data.json');

        const row = result.rows[0];
        const userIdCol = result.columns.find(c => c.name === 'userId')!;
        const msgCol = result.columns.find(c => c.name === 'message')!;

        expect(row.values[userIdCol.id]).toBe('42');
        expect(row.values[msgCol.id]).toBe('hello world');
      });
    });

    describe('unsupported formats', () => {
      it('throws on unsupported file extension', () => {
        vi.mocked(readFileSync).mockReturnValue('some content');

        expect(() => loadDataFile('/path/to/data.xml')).toThrow(/Unsupported data file format/);
        expect(() => loadDataFile('/path/to/data.txt')).toThrow(/Unsupported data file format/);
        expect(() => loadDataFile('/path/to/data.yaml')).toThrow(/Unsupported data file format/);
      });
    });

    describe('row structure', () => {
      it('creates rows with correct structure', () => {
        const csvContent = `userId,channel
42,WEB`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/data.csv');
        const row = result.rows[0];

        expect(row.id).toMatch(/^mock-uuid-/);
        expect(row.label).toBe('Row 1');
        expect(row.enabled).toBe(true);
        expect(Object.keys(row.values)).toHaveLength(2);
      });

      it('handles missing values as empty strings', () => {
        const csvContent = `userId,channel,optional
42,WEB,`;
        vi.mocked(readFileSync).mockReturnValue(csvContent);

        const result = loadDataFile('/path/to/data.csv');
        const row = result.rows[0];
        const optionalCol = result.columns.find(c => c.name === 'optional')!;

        expect(row.values[optionalCol.id]).toBe('');
      });
    });
  });

  describe('buildDataSourceFromInline', () => {
    describe('object-style rows', () => {
      it('builds DataSource from object rows', () => {
        const data = {
          rows: [
            { userId: 42, channel: 'WEB' },
            { userId: 99, channel: 'MOBILE' },
          ],
        };

        const result = buildDataSourceFromInline(data);

        expect(result.label).toBe('inline');
        expect(result.source).toEqual({ type: 'inline' });
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0].name).toBe('userId');
        expect(result.columns[1].name).toBe('channel');
        expect(result.rows).toHaveLength(2);
      });

      it('handles validate: and header: prefixes', () => {
        const data = {
          rows: [
            { userId: 42, 'validate:status': 200, 'header:Auth': 'token' },
          ],
        };

        const result = buildDataSourceFromInline(data);

        const validateCol = result.columns.find(c => c.name === 'validate:status');
        const headerCol = result.columns.find(c => c.name === 'header:Auth');
        expect(validateCol?.type).toBe('validate');
        expect(validateCol?.mapping).toBe('status');
        expect(headerCol?.type).toBe('header');
        expect(headerCol?.mapping).toBe('Auth');
      });

      it('converts non-string values to strings', () => {
        const data = {
          rows: [
            { num: 42, bool: true, obj: { a: 1 } },
          ],
        };

        const result = buildDataSourceFromInline(data);
        const row = result.rows[0];
        const numCol = result.columns.find(c => c.name === 'num')!;
        const boolCol = result.columns.find(c => c.name === 'bool')!;

        expect(row.values[numCol.id]).toBe('42');
        expect(row.values[boolCol.id]).toBe('true');
      });

      it('handles null values as empty strings', () => {
        const data = {
          rows: [
            { userId: 42, optional: null },
          ],
        };

        const result = buildDataSourceFromInline(data);
        const row = result.rows[0];
        const optionalCol = result.columns.find(c => c.name === 'optional')!;

        expect(row.values[optionalCol.id]).toBe('');
      });
    });

    describe('array-style rows', () => {
      it('builds DataSource from array rows with columns', () => {
        const data = {
          columns: ['userId', 'channel', 'validate:status'],
          rows: [
            ['42', 'WEB', '200'],
            ['99', 'MOBILE', '201'],
          ],
        };

        const result = buildDataSourceFromInline(data);

        expect(result.columns).toHaveLength(3);
        expect(result.columns[0].name).toBe('userId');
        expect(result.columns[0].type).toBe('param');
        expect(result.columns[2].name).toBe('validate:status');
        expect(result.columns[2].type).toBe('validate');
        expect(result.rows).toHaveLength(2);
      });

      it('throws if array rows have no columns definition', () => {
        const data = {
          rows: [
            ['42', 'WEB'],
          ],
        };

        expect(() => buildDataSourceFromInline(data)).toThrow(/require a "columns" list/);
      });

      it('handles numeric values in array rows', () => {
        const data = {
          columns: ['userId', 'score'],
          rows: [
            [42, 100],
          ],
        };

        const result = buildDataSourceFromInline(data);
        const row = result.rows[0];
        const userIdCol = result.columns.find(c => c.name === 'userId')!;
        const scoreCol = result.columns.find(c => c.name === 'score')!;

        expect(row.values[userIdCol.id]).toBe('42');
        expect(row.values[scoreCol.id]).toBe('100');
      });

      it('handles null/undefined values in array rows', () => {
        const data = {
          columns: ['userId', 'optional'],
          rows: [
            [42, null],
            [99, undefined],
          ],
        };

        const result = buildDataSourceFromInline(data);
        const optionalCol = result.columns.find(c => c.name === 'optional')!;

        expect(result.rows[0].values[optionalCol.id]).toBe('');
        expect(result.rows[1].values[optionalCol.id]).toBe('');
      });
    });

    describe('validation', () => {
      it('throws on empty rows array', () => {
        expect(() => buildDataSourceFromInline({ rows: [] })).toThrow(/non-empty "rows" array/);
      });

      it('throws on missing rows property', () => {
        expect(() => buildDataSourceFromInline({} as never)).toThrow(/non-empty "rows" array/);
      });
    });

    describe('row structure', () => {
      it('creates rows with incremental labels', () => {
        const data = {
          rows: [
            { userId: 1 },
            { userId: 2 },
            { userId: 3 },
          ],
        };

        const result = buildDataSourceFromInline(data);

        expect(result.rows[0].label).toBe('Row 1');
        expect(result.rows[1].label).toBe('Row 2');
        expect(result.rows[2].label).toBe('Row 3');
      });

      it('sets enabled to true for all rows', () => {
        const data = {
          rows: [
            { userId: 1 },
            { userId: 2 },
          ],
        };

        const result = buildDataSourceFromInline(data);

        expect(result.rows.every(r => r.enabled)).toBe(true);
      });
    });
  });
});
