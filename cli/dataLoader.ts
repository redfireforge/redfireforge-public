/**
 * CLI data file loader — parses CSV and JSON data files into DataSource structures.
 * Supports:
 *   - CSV files (via papaparse)
 *   - JSON files (array of objects)
 */
import { readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Papa from 'papaparse';
import type { DataSource, DataSourceColumn, DataSourceRow } from '../src/shared/types';

/**
 * Load a data file (CSV or JSON) and return a DataSource.
 * Column types are inferred from column names:
 *   - `validate:*` → validate column
 *   - `header:*` → header column
 *   - `_tags`, `_label`, `_note`, `_enabled` → row metadata (not sent as request params)
 *   - everything else → param (query/body variable)
 */
const SPECIAL_ROW_COLUMNS = new Set(['_tags', '_label', '_note', '_enabled']);

export function loadDataFile(filePath: string): DataSource {
  const content = readFileSync(filePath, 'utf-8');
  const ext = filePath.toLowerCase();

  let rawRows: Record<string, string>[];

  if (ext.endsWith('.csv')) {
    const parsed = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });
    if (parsed.errors.length > 0) {
      const first = parsed.errors[0];
      throw new Error(`CSV parse error at row ${first.row}: ${first.message}`);
    }
    rawRows = parsed.data;
  } else if (ext.endsWith('.json')) {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
      throw new Error('JSON data file must be an array of objects');
    }
    rawRows = data.map((item: Record<string, unknown>) => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(item)) {
        row[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return row;
    });
  } else {
    throw new Error(`Unsupported data file format: ${filePath}. Use .csv or .json`);
  }

  if (rawRows.length === 0) {
    throw new Error(`Data file is empty: ${filePath}`);
  }

  // Build columns from the keys of the first row — special row-metadata columns
  // (_tags/_label/_note/_enabled) are excluded so they never leak into requests as params.
  const colNames = Object.keys(rawRows[0]).filter(name => !SPECIAL_ROW_COLUMNS.has(name));
  const columns: DataSourceColumn[] = colNames.map((name) => {
    const id = uuidv4();
    let type: DataSourceColumn['type'] = 'param';
    let mapping = name;

    if (name.startsWith('validate:')) {
      type = 'validate';
      mapping = name.slice('validate:'.length).trim();
    } else if (name.startsWith('header:')) {
      type = 'header';
      mapping = name.slice('header:'.length).trim();
    }

    return { id, name, type, mapping };
  });

  // Build rows
  const rows: DataSourceRow[] = rawRows.map((raw, idx) => {
    const values: Record<string, string> = {};
    for (let i = 0; i < colNames.length; i++) {
      values[columns[i].id] = raw[colNames[i]] ?? '';
    }
    const tags = raw._tags
      ? raw._tags.split(';').map(t => t.trim().toLowerCase()).filter(Boolean)
      : undefined;
    const label = raw._label?.trim() || `Row ${idx + 1}`;
    const note = raw._note?.trim() || undefined;
    const enabled = raw._enabled?.trim().toLowerCase() !== 'false';
    return {
      id: uuidv4(),
      label,
      values,
      enabled,
      tags: tags?.length ? tags : undefined,
      note,
    };
  });

  return {
    id: uuidv4(),
    label: filePath,
    columns,
    rows,
    source: { type: 'file', filePath },
  };
}

/**
 * Build a DataSource from inline YAML/JSON data definition.
 * Expected format:
 * ```yaml
 * data:
 *   columns: [userId, channel, "validate:status"]
 *   rows:
 *     - [42, WEB, 200]
 *     - [99, MOBILE, 200]
 * ```
 * Or object-style rows:
 * ```yaml
 * data:
 *   rows:
 *     - { userId: 42, channel: WEB }
 *     - { userId: 99, channel: MOBILE }
 * ```
 */
export function buildDataSourceFromInline(
  data: { columns?: string[]; rows: (string[] | Record<string, unknown>)[] },
): DataSource {
  if (!data.rows || data.rows.length === 0) {
    throw new Error('Inline data must have a non-empty "rows" array');
  }

  const firstRow = data.rows[0];
  const isObjectRows = !Array.isArray(firstRow);

  let colNames: string[];
  if (isObjectRows) {
    colNames = Object.keys(firstRow as Record<string, unknown>);
  } else if (data.columns) {
    colNames = data.columns;
  } else {
    throw new Error('Array-style rows require a "columns" list in the data definition');
  }

  const columns: DataSourceColumn[] = colNames.map((name) => {
    const id = uuidv4();
    let type: DataSourceColumn['type'] = 'param';
    let mapping = name;

    if (name.startsWith('validate:')) {
      type = 'validate';
      mapping = name.slice('validate:'.length).trim();
    } else if (name.startsWith('header:')) {
      type = 'header';
      mapping = name.slice('header:'.length).trim();
    }

    return { id, name, type, mapping };
  });

  const rows: DataSourceRow[] = data.rows.map((raw, idx) => {
    const values: Record<string, string> = {};
    if (Array.isArray(raw)) {
      for (let i = 0; i < columns.length; i++) {
        values[columns[i].id] = raw[i] != null ? String(raw[i]) : '';
      }
    } else {
      const obj = raw as Record<string, unknown>;
      for (let i = 0; i < colNames.length; i++) {
        values[columns[i].id] = obj[colNames[i]] != null ? String(obj[colNames[i]]) : '';
      }
    }
    return {
      id: uuidv4(),
      label: `Row ${idx + 1}`,
      values,
      enabled: true,
    };
  });

  return {
    id: uuidv4(),
    label: 'inline',
    columns,
    rows,
    source: { type: 'inline' },
  };
}
