/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataSourceRows } from './useDataSourceRows';
import type { DataSource } from '@shared/types';

vi.mock('uuid', () => ({ v4: () => `uuid-${Math.random().toString(36).slice(2, 8)}` }));

function makeDataSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    id: 'ds1',
    columns: [
      { id: 'c1', name: 'vin', type: 'param', mapping: 'vin' },
      { id: 'c2', name: 'channel', type: 'param', mapping: 'channel' },
    ],
    rows: [
      { id: 'r1', values: { c1: 'AAA', c2: 'WEB' }, enabled: true },
      { id: 'r2', values: { c1: 'BBB', c2: 'APP' }, enabled: true },
      { id: 'r3', values: { c1: 'CCC', c2: 'MOBILE' }, enabled: false },
    ],
    source: { type: 'inline' },
    ...overrides,
  };
}

describe('useDataSourceRows', () => {
  describe('Row CRUD', () => {
    it('addRow appends a new empty disabled row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.addRow());
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(4);
      expect(updated.rows[3].values.c1).toBe('');
      expect(updated.rows[3].enabled).toBe(false);
    });

    it('addSampleRow appends an enabled sample row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.addSampleRow());
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[3].isSample).toBe(true);
      expect(updated.rows[3].enabled).toBe(true);
    });

    it('updateCell enables a disabled blank row when a value is typed', () => {
      const onChange = vi.fn();
      const ds = makeDataSource({
        rows: [{ id: 'r1', values: { c1: '', c2: '' }, enabled: false }],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.updateCell('r1', 'c1', '42'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].values.c1).toBe('42');
      expect(updated.rows[0].enabled).toBe(true);
    });

    it('removeRow removes and keeps at least one row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource({ rows: [{ id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true }] });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.removeRow('r1'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(1);
      expect(updated.rows[0].id).not.toBe('r1'); // new empty row
    });

    it('moveRow swaps rows', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.moveRow('r2', 'up'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].id).toBe('r2');
      expect(updated.rows[1].id).toBe('r1');
    });

    it('moveRow no-ops at list boundaries', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.moveRow('r1', 'up'));
      act(() => result.current.moveRow('r3', 'down'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('moveRow no-ops for unknown row id', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.moveRow('missing', 'down'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('duplicateRow no-ops for unknown row id', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.duplicateRow('missing'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('duplicateRow creates a copy after the source', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.duplicateRow('r1'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(4);
      expect(updated.rows[1].values.c1).toBe('AAA');
      expect(updated.rows[1].id).not.toBe('r1');
    });

    it('toggleRow flips enabled', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.toggleRow('r1'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].enabled).toBe(false);
    });

    it('toggleRow does not disable sample rows', () => {
      const onChange = vi.fn();
      const ds = makeDataSource({ rows: [{ id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true, isSample: true }] });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.toggleRow('r1'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('toggleRow can enable a disabled sample row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource({
        rows: [{ id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: false, isSample: true }],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.toggleRow('r1'));
      expect(onChange).toHaveBeenCalled();
      expect((onChange.mock.calls[0][0] as DataSource).rows[0].enabled).toBe(true);
    });

    it('toggleSample flips isSample', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.toggleSample('r1'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].isSample).toBe(true);
    });

    it('updateCell updates a specific cell value', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.updateCell('r1', 'c1', 'ZZZ'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].values.c1).toBe('ZZZ');
    });

    it('updateRowLabel sets the label', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.updateRowLabel('r1', 'My Row'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].label).toBe('My Row');
    });

    it('updateRowNote sets the note', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.updateRowNote('r1', 'some note'));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].note).toBe('some note');
    });

    it('updateRowNote clears note when empty', () => {
      const onChange = vi.fn();
      const ds = makeDataSource({ rows: [{ id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true, note: 'old' }] });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.updateRowNote('r1', ''));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].note).toBeUndefined();
    });

    it('deleteAllRows resets to one empty row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.deleteAllRows());
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(1);
      expect(updated.rows[0].values.c1).toBe('');
    });
  });

  describe('Bulk operations', () => {
    it('selectAll selects all rows', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.selectAll());
      expect(result.current.selectedRows.size).toBe(3);
    });

    it('clearSelection empties selection', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.selectAll());
      act(() => result.current.clearSelection());
      expect(result.current.selectedRows.size).toBe(0);
    });

    it('bulkEnable enables selected rows and clears selection', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => {
        result.current.handleRowSelect('r3', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent);
      });
      act(() => result.current.bulkEnable(true));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[2].enabled).toBe(true);
      expect(result.current.selectedRows.size).toBe(0);
    });

    it('bulkEnable disables selected rows', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => {
        result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent);
      });
      act(() => result.current.bulkEnable(false));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].enabled).toBe(false);
    });

    it('shift click selects range when anchor is after target row', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleRowSelect('r3', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      act(() => result.current.handleRowSelect('r1', { shiftKey: true, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.size).toBe(3);
    });

    it('bulkDelete removes selected rows', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.selectAll());
      act(() => result.current.bulkDelete());
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(1);
      expect(updated.rows[0].values.c1).toBe('');
    });

    it('bulkDuplicate duplicates selected rows', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => {
        result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent);
      });
      act(() => result.current.bulkDuplicate());
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(4);
      expect(updated.rows[1].values.c1).toBe('AAA');
      expect(updated.rows[1].id).not.toBe('r1');
    });

    it('updateCell no-ops when dataSource is undefined', () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: undefined, onChange }));
      act(() => result.current.updateCell('r1', 'c1', 'x'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('bulkDuplicate with empty selection calls onChange with unchanged row count', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.bulkDuplicate());
      expect(onChange).toHaveBeenCalledTimes(1);
      expect((onChange.mock.calls[0][0] as DataSource).rows).toHaveLength(3);
    });

    it('bulkEnable with empty selection updates rows via same mapping', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.bulkEnable(true));
      expect(onChange).toHaveBeenCalled();
    });

    it('bulkDuplicate inserts copies after the last selected row when multi-select', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      act(() => result.current.handleRowSelect('r2', { shiftKey: false, ctrlKey: true, metaKey: false } as unknown as React.MouseEvent));
      act(() => result.current.bulkDuplicate());
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows.length).toBe(5);
      expect(result.current.selectedRows.size).toBe(0);
    });

    it('bulk operations no-op when dataSource is undefined', () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: undefined, onChange }));
      act(() => result.current.selectAll());
      act(() => result.current.bulkDelete());
      act(() => result.current.bulkEnable(true));
      act(() => result.current.bulkDuplicate());
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Search / sort / filter', () => {
    it('__untagged__ includes rows without tags property', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'a', c2: 'b' }, enabled: true },
          { id: 'r2', values: { c1: 'c', c2: 'd' }, enabled: true, tags: ['smoke'] },
        ],
      });
      delete (ds.rows[0] as { tags?: string[] }).tags;
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setFilterTag('__untagged__'));
      expect(result.current.filteredSortedRows.map(r => r.id)).toEqual(['r1']);
    });

    it('filteredSortedRows is empty when dataSource is undefined', () => {
      const { result } = renderHook(() => useDataSourceRows({ dataSource: undefined, onChange: vi.fn() }));
      expect(result.current.filteredSortedRows).toEqual([]);
    });

    it('search matches cells when row label property is absent', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'needle-x', c2: 'y' }, enabled: true },
        ],
      });
      delete (ds.rows[0] as { label?: string }).label;
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('needle'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
    });

    it('sort preserves order when compared cell values tie', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'tie', c2: 'a' }, enabled: true },
          { id: 'r2', values: { c1: 'tie', c2: 'b' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.filteredSortedRows.map(r => r.id)).toEqual(['r1', 'r2']);
    });

    it('search matches cell text case-insensitively', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'LoWeR', c2: 'y' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('lower'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
    });

    it('filteredSortedRows filters by search query', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('BBB'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
      expect(result.current.filteredSortedRows[0].id).toBe('r2');
    });

    it('filteredSortedRows matches row labels', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'x', c2: 'y' }, enabled: true, label: 'Alpha row' },
          { id: 'r2', values: { c1: 'z', c2: 'w' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('alpha'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
      expect(result.current.filteredSortedRows[0].id).toBe('r1');
    });

    it('filteredSortedRows matches cell text when label is absent', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'hidden-gem', c2: 'y' }, enabled: true },
          { id: 'r2', values: { c1: 'a', c2: 'b' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('gem'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
      expect(result.current.filteredSortedRows[0].id).toBe('r1');
    });

    it('filteredSortedRows skips rows when label is undefined and values miss query', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'a', c2: 'b' }, enabled: true, label: undefined },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('zzz'));
      expect(result.current.filteredSortedRows).toHaveLength(0);
    });

    it('handleSortColumn cycles asc desc asc on same column', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.sortDir).toBe('asc');
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.sortDir).toBe('desc');
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.sortDir).toBe('asc');
    });

    it('sort treats missing cell key as empty string', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'z' }, enabled: true },
          { id: 'r2', values: { c2: 'only' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleSortColumn('c1'));
      const ids = result.current.filteredSortedRows.map(r => r.id);
      expect(ids[0]).toBe('r2');
    });

    it('search falls back to values when row label is empty string', () => {
      const ds = makeDataSource({
        rows: [{ id: 'r1', values: { c1: 'needle' }, enabled: true, label: '' }],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setSearchQuery('need'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
    });

    it('filteredSortedRows sorts by column', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleSortColumn('c1'));
      const ids = result.current.filteredSortedRows.map(r => r.id);
      expect(ids).toEqual(['r1', 'r2', 'r3']); // AAA, BBB, CCC ascending
    });

    it('handleSortColumn toggles direction on repeated click', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.sortDir).toBe('asc');
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.sortDir).toBe('desc');
    });

    it('handleSortColumn resets to ascending when switching columns', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleSortColumn('c1'));
      act(() => result.current.handleSortColumn('c1'));
      expect(result.current.sortDir).toBe('desc');
      act(() => result.current.handleSortColumn('c2'));
      expect(result.current.sortCol).toBe('c2');
      expect(result.current.sortDir).toBe('asc');
    });

    it('does not sort column values when selected sort id is not a real column', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      const before = result.current.filteredSortedRows.map(r => r.id);
      act(() => result.current.handleSortColumn('ghost-col'));
      expect(result.current.sortCol).toBe('ghost-col');
      expect(result.current.filteredSortedRows.map(r => r.id)).toEqual(before);
    });

    it('filteredSortedRows filters by tag', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true, tags: ['smoke'] },
          { id: 'r2', values: { c1: 'C', c2: 'D' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setFilterTag('smoke'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
      expect(result.current.filteredSortedRows[0].id).toBe('r1');
    });

    it('filteredSortedRows filters untagged', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true, tags: ['smoke'] },
          { id: 'r2', values: { c1: 'C', c2: 'D' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setFilterTag('__untagged__'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
      expect(result.current.filteredSortedRows[0].id).toBe('r2');
    });

    it('shows all rows when filter tag cleared', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true, tags: ['smoke'] },
          { id: 'r2', values: { c1: 'C', c2: 'D' }, enabled: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.setFilterTag('smoke'));
      expect(result.current.filteredSortedRows).toHaveLength(1);
      act(() => result.current.setFilterTag(null));
      expect(result.current.filteredSortedRows.map(r => r.id).sort()).toEqual(['r1', 'r2']);
    });

    it('sample rows sort to top', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true },
          { id: 'r2', values: { c1: 'C', c2: 'D' }, enabled: true, isSample: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      expect(result.current.filteredSortedRows[0].id).toBe('r2');
    });

    it('ranks multiple sample rows ahead of ordinary rows while preserving intra-group order', () => {
      const ds = makeDataSource({
        rows: [
          { id: 'r1', values: { c1: 'A', c2: 'B' }, enabled: true },
          { id: 'r2', values: { c1: 'C', c2: 'D' }, enabled: true, isSample: true },
          { id: 'r3', values: { c1: 'E', c2: 'F' }, enabled: true, isSample: true },
        ],
      });
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      expect(result.current.filteredSortedRows.map(r => r.id)).toEqual(['r2', 'r3', 'r1']);
    });
  });

  describe('enabledCount', () => {
    it('counts enabled rows', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      expect(result.current.enabledCount).toBe(2);
    });
  });

  describe('no dataSource', () => {
    it('operations are no-ops when dataSource is undefined', () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: undefined, onChange }));
      act(() => result.current.addRow());
      act(() => result.current.removeRow('x'));
      act(() => result.current.moveRow('x', 'up'));
      expect(onChange).not.toHaveBeenCalled();
      expect(result.current.filteredSortedRows).toEqual([]);
      expect(result.current.enabledCount).toBe(0);
    });

    it('does not change selection helpers when dataSource is undefined', () => {
      const { result } = renderHook(() => useDataSourceRows({ dataSource: undefined, onChange: vi.fn() }));
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      act(() => result.current.selectAll());
      expect(result.current.selectedRows.size).toBe(0);
    });
  });

  describe('handleRowSelect', () => {
    it('selects a single row on plain click', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleRowSelect('r2', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.has('r2')).toBe(true);
      expect(result.current.selectedRows.size).toBe(1);
    });

    it('selects range with shift click', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      // First plain click on r1
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      // Shift+click on r3
      act(() => result.current.handleRowSelect('r3', { shiftKey: true, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.has('r1')).toBe(true);
      expect(result.current.selectedRows.has('r2')).toBe(true);
      expect(result.current.selectedRows.has('r3')).toBe(true);
      expect(result.current.selectedRows.size).toBe(3);
    });

    it('toggles individual row with ctrl click', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      // Ctrl+click r2 to add to selection
      act(() => result.current.handleRowSelect('r2', { shiftKey: false, ctrlKey: true, metaKey: false } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.has('r1')).toBe(true);
      expect(result.current.selectedRows.has('r2')).toBe(true);
      // Ctrl+click r1 to deselect it
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: true, metaKey: false } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.has('r1')).toBe(false);
      expect(result.current.selectedRows.has('r2')).toBe(true);
    });

    it('toggles individual row with meta click', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: true } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.has('r1')).toBe(true);
    });

    it('shift click without prior anchor behaves like plain selection', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      act(() => result.current.handleRowSelect('r2', { shiftKey: true, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      expect(result.current.selectedRows.has('r2')).toBe(true);
      expect(result.current.selectedRows.size).toBe(1);
    });
  });

  describe('drag and drop', () => {
    it('handleDragStart sets dragRowId and dataTransfer', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      const mockEvent = {
        dataTransfer: { effectAllowed: '', setData: vi.fn() },
      } as unknown as React.DragEvent;
      act(() => result.current.handleDragStart('r1', mockEvent));
      expect(result.current.dragRowId).toBe('r1');
      expect(mockEvent.dataTransfer.effectAllowed).toBe('move');
      expect(mockEvent.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'r1');
    });

    it('handleDragOver prevents default and sets dropEffect', () => {
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange: vi.fn() }));
      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { dropEffect: '' },
      } as unknown as React.DragEvent;
      act(() => result.current.handleDragOver(mockEvent));
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.dataTransfer.dropEffect).toBe('move');
    });

    it('handleDrop reorders row from drag source to target', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      // Start drag from r1
      const startEvent = { dataTransfer: { effectAllowed: '', setData: vi.fn() } } as unknown as React.DragEvent;
      act(() => result.current.handleDragStart('r1', startEvent));
      // Drop on r3
      const dropEvent = { preventDefault: vi.fn() } as unknown as React.DragEvent;
      act(() => result.current.handleDrop('r3', dropEvent));
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows[0].id).toBe('r2');
      expect(updated.rows[1].id).toBe('r3');
      expect(updated.rows[2].id).toBe('r1');
      expect(result.current.dragRowId).toBeNull();
    });

    it('handleDrop does nothing when same row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      const startEvent = { dataTransfer: { effectAllowed: '', setData: vi.fn() } } as unknown as React.DragEvent;
      act(() => result.current.handleDragStart('r1', startEvent));
      const dropEvent = { preventDefault: vi.fn() } as unknown as React.DragEvent;
      act(() => result.current.handleDrop('r1', dropEvent));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('handleDrop no-ops when dragRowId cleared', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      const dropEvent = { preventDefault: vi.fn() } as unknown as React.DragEvent;
      act(() => result.current.handleDrop('r2', dropEvent));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('handleDrop no-ops for unknown target row ids', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      const startEvent = { dataTransfer: { effectAllowed: '', setData: vi.fn() } } as unknown as React.DragEvent;
      act(() => result.current.handleDragStart('r1', startEvent));
      const dropEvent = { preventDefault: vi.fn() } as unknown as React.DragEvent;
      act(() => result.current.handleDrop('missing', dropEvent));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('bulkDelete with partial selection does not insert placeholder row', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      act(() => result.current.handleRowSelect('r1', { shiftKey: false, ctrlKey: false, metaKey: false } as unknown as React.MouseEvent));
      act(() => result.current.bulkDelete());
      const updated = onChange.mock.calls[0][0] as DataSource;
      expect(updated.rows).toHaveLength(2);
    });

    it('handleDrop no-ops when source row id missing from data', () => {
      const onChange = vi.fn();
      const ds = makeDataSource();
      const { result } = renderHook(() => useDataSourceRows({ dataSource: ds, onChange }));
      const startEvent = { dataTransfer: { effectAllowed: '', setData: vi.fn() } } as unknown as React.DragEvent;
      act(() => result.current.handleDragStart('nope', startEvent));
      const dropEvent = { preventDefault: vi.fn() } as unknown as React.DragEvent;
      act(() => result.current.handleDrop('r2', dropEvent));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
