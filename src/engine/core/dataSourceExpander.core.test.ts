/**
 * dataSourceExpander Core Tests
 * Split from monolithic dataSourceExpander.test.ts (961 lines -> ~230 lines)
 * Tests: buildRowLabel, expandDataSource, expandQueue
 */
import { describe, it, expect } from 'vitest';
import { expandDataSource, expandQueue, buildRowLabel } from './dataSourceExpander';
import { makeScenario, makeColumns, makeRow, makeDataSource } from './__test-utils__/dataSourceExpanderHelpers';

// ─── buildRowLabel ────────────────────────────────────────────

describe('buildRowLabel', () => {
  const cols = makeColumns();

  it('builds label from non-validate columns', () => {
    const row = makeRow('r1', '42', 'WEB');
    expect(buildRowLabel(row, cols, 0)).toBe('Row 1: userId=42, channel=WEB');
  });

  it('uses 1-based index', () => {
    const row = makeRow('r2', '99', 'APP');
    expect(buildRowLabel(row, cols, 4)).toBe('Row 5: userId=99, channel=APP');
  });

  it('truncates long values to 14 chars + ellipsis', () => {
    const row = makeRow('r1', 'ABCDEFGHIJKLMNOPQRST', 'X');
    const label = buildRowLabel(row, cols, 0);
    expect(label).toContain('userId=ABCDEFGHIJKLMN…');
  });

  it('limits to 3 non-validate columns', () => {
    const manyCols: DataSourceColumn[] = [
      { id: 'a', name: 'a', type: 'path', mapping: 'a' },
      { id: 'b', name: 'b', type: 'param', mapping: 'b' },
      { id: 'c', name: 'c', type: 'param', mapping: 'c' },
      { id: 'd', name: 'd', type: 'param', mapping: 'd' },
    ];
    const row: DataSourceRow = {
      id: 'r1',
      values: { a: '1', b: '2', c: '3', d: '4' },
      enabled: true,
    };
    const label = buildRowLabel(row, manyCols, 0);
    expect(label).toBe('Row 1: a=1, b=2, c=3');
    expect(label).not.toContain('d=4');
  });

  it('handles empty columns gracefully', () => {
    const row: DataSourceRow = { id: 'r1', values: {}, enabled: true };
    expect(buildRowLabel(row, [], 0)).toBe('Row 1');
  });
});

// ─── expandDataSource ──────────────────────────────────────────

describe('expandDataSource', () => {
  it('returns scenario as-is when no data source', () => {
    const sc = makeScenario();
    const result = expandDataSource(sc);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(sc);
  });

  it('returns scenario as-is when data source has no rows', () => {
    const sc = makeScenario({
      dataSource: makeDataSource({ rows: [] }),
    });
    const result = expandDataSource(sc);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(sc);
  });

  it('returns scenario as-is when data source has no columns', () => {
    const sc = makeScenario({
      dataSource: makeDataSource({ columns: [] }),
    });
    const result = expandDataSource(sc);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(sc);
  });

  it('expands to N scenarios for N enabled rows', () => {
    const dt = makeDataSource(); // 3 rows, 1 disabled
    const sc = makeScenario({ dataSource: dt });
    const result = expandDataSource(sc);
    expect(result).toHaveLength(2); // only enabled rows
  });

  it('returns scenario as-is when all rows are disabled', () => {
    const dt = makeDataSource({
      rows: [
        makeRow('r1', '1', 'A', '', false),
        makeRow('r2', '2', 'B', '', false),
      ],
    });
    const sc = makeScenario({ dataSource: dt });
    const result = expandDataSource(sc);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(sc);
  });

  it('each expanded scenario has correct URL', () => {
    const dt = makeDataSource();
    const sc = makeScenario({ dataSource: dt });
    const result = expandDataSource(sc);

    expect(result[0].url).toContain('/users/42/');
    expect(result[1].url).toContain('/users/99/');
  });

  it('each expanded scenario has unique dataRowId', () => {
    const dt = makeDataSource();
    const sc = makeScenario({ dataSource: dt });
    const result = expandDataSource(sc);

    expect(result[0].dataRowId).toBe('r1');
    expect(result[1].dataRowId).toBe('r2');
  });

  it('preserves sequential distribution by default', () => {
    const dt = makeDataSource();
    const sc = makeScenario({ dataSource: dt });
    const result = expandDataSource(sc);
    // r1 (42) before r2 (99) — sequential order
    expect(result[0].dataRowId).toBe('r1');
    expect(result[1].dataRowId).toBe('r2');
  });

  it('preserves row order for round-robin distribution (single expansion pass)', () => {
    const dt = makeDataSource({ distribution: 'round-robin' });
    const sc = makeScenario({ dataSource: dt });
    const result = expandDataSource(sc);
    expect(result[0].dataRowId).toBe('r1');
    expect(result[1].dataRowId).toBe('r2');
  });

  it('shuffles rows with random distribution', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow(`r${i}`, String(i), 'CH'),
    );
    const dt = makeDataSource({ rows, distribution: 'random' });
    const sc = makeScenario({ dataSource: dt });

    // Run multiple times — at least one should differ from sequential
    const orders = new Set<string>();
    for (let trial = 0; trial < 5; trial++) {
      const result = expandDataSource(sc);
      orders.add(result.map(r => r.dataRowId).join(','));
    }
    // With 20 rows, the chance of all 5 trials being sequential is negligible
    expect(orders.size).toBeGreaterThan(1);
  });
});

// ─── expandQueue ──────────────────────────────────────────────

describe('expandQueue', () => {
  it('passes through non-parameterized scenarios', () => {
    const sc1 = makeScenario({ id: 's1' });
    const sc2 = makeScenario({ id: 's2' });
    const result = expandQueue([sc1, sc2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(sc1);
    expect(result[1]).toBe(sc2);
  });

  it('expands parameterized scenarios in place', () => {
    const sc1 = makeScenario({ id: 's1' }); // no data source
    const sc2 = makeScenario({
      id: 's2',
      dataSource: makeDataSource(), // 2 enabled rows
    });
    const sc3 = makeScenario({ id: 's3' }); // no data source

    const result = expandQueue([sc1, sc2, sc3]);
    expect(result).toHaveLength(4); // 1 + 2 + 1
    expect(result[0].id).toBe('s1');
    expect(result[1].dataRowId).toBe('r1');
    expect(result[2].dataRowId).toBe('r2');
    expect(result[3].id).toBe('s3');
  });

  it('handles empty queue', () => {
    expect(expandQueue([])).toEqual([]);
  });
});
