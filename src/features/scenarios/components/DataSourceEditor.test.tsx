/**
 * @vitest-environment jsdom
 */
import { type ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { selectOption, selectOptionByIndex } from '@test-utils/customSelectHelper';
import DataSourceEditor from './DataSourceEditor';
import {
  makeScenario,
  makeDataSource,
  makeDataTransferWithId as _makeDataTransferWithId,
} from './__test-utils__/dataSourceEditorTestHelpers';
import { Scenario, DataSource, SharedDataSource, DataSourceColumn, DataSourceRow } from '@shared/types';
vi.mock('uuid', () => ({ v4: () => `uuid-${Math.random().toString(36).slice(2, 8)}` }));

const useDataSourceTagsHarness = vi.hoisted(() => ({
  mismatchTagCounts: false,
}));

vi.mock('../hooks/useDataSourceTags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useDataSourceTags')>();
  return {
    useDataSourceTags: (...args: Parameters<typeof actual.useDataSourceTags>) => {
      const result = actual.useDataSourceTags(...args);
      if (!useDataSourceTagsHarness.mismatchTagCounts) return result;
      return { ...result, allTags: ['ghost-tag'], tagCounts: {} };
    },
  };
});

const hoistedMocks = vi.hoisted(() => {
  let fetchHookOverride: (() => unknown) | null = null;
  return {
    handleImport: vi.fn().mockResolvedValue(undefined),
    setFetchHookOverride: (fn: typeof fetchHookOverride) => {
      fetchHookOverride = fn;
    },
    getFetchHookOverride: () => fetchHookOverride,
    lastPopulateAdapter: null as null | { fetchSampleData?: () => Promise<unknown> },
  };
});

vi.mock('../hooks/useDataSourceImport', () => ({
  useDataSourceImport: () => ({ handleImport: hoistedMocks.handleImport }),
}));

vi.mock('../hooks/useDataSourceFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useDataSourceFetch')>();
  return {
    ...actual,
    useDataSourceFetch: (
      opts: Parameters<typeof actual.useDataSourceFetch>[0],
    ): ReturnType<typeof actual.useDataSourceFetch> => {
      const override = hoistedMocks.getFetchHookOverride();
      if (override) return override() as ReturnType<typeof actual.useDataSourceFetch>;
      return actual.useDataSourceFetch(opts);
    },
  };
});

/** Mock DataMapperModal for populate tests. */
vi.mock('../../../shared/components/data-mapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/components/data-mapper')>();
  return {
    ...actual,
    DataMapperModal: function MockDataMapperModal({
      onSave,
      onCancel,
      adapter,
    }: {
      onSave: (output: unknown) => void;
      onCancel: () => void;
      adapter: { title: string; fetchSampleData?: () => Promise<unknown> };
    }) {
      const isPopulate = adapter.title === 'API Response → Data Source';
      hoistedMocks.lastPopulateAdapter = isPopulate ? adapter : null;
      return (
        <div>
          <h2>{adapter.title}</h2>
          {isPopulate ? (
            <>
              <button
                type="button"
                onClick={() =>
                  (onSave as (o: { columns: DataSourceColumn[]; rows: DataSourceRow[]; mode: 'append' | 'replace' }) => void)({
                    columns: [],
                    rows: [{ id: 'pop-row', values: {}, enabled: true }],
                    mode: 'append',
                  })}
              >
                Mock Append
              </button>
              <button
                type="button"
                onClick={() =>
                  (onSave as (o: { columns: DataSourceColumn[]; rows: DataSourceRow[]; mode: 'append' | 'replace' }) => void)({
                    columns: [],
                    rows: [{ id: 'repl-row', values: {}, enabled: true }],
                    mode: 'replace',
                  })}
              >
                Mock Replace
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="mock-column-mapper-save"
              onClick={() =>
                onSave([
                  { id: 'c1', name: 'vin', type: 'body', mapping: 'vin' },
                  { id: 'c-mapped', name: 'extra', type: 'param', mapping: 'q' },
                ] as DataSourceColumn[])
              }
            >
              Mock Column Apply
            </button>
          )}
          <button type="button" onClick={onCancel}>
            Close Populate
          </button>
        </div>
      );
    },
  };
});

/** @deprecated Old PopulateFromApiModal mock removed — now using DataMapperModal mock above. */

vi.mock('./DataSourceRowDetailModal', async () => {
  const h = await import('./__test-utils__/dataSourceEditorTestHelpers');
  return { default: h.MockDataSourceRowDetailModal };
});

vi.mock('./DataSourceGridTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DataSourceGridTable')>();
  const h = await import('./__test-utils__/dataSourceEditorTestHelpers');
  return { default: h.buildDataSourceGridTableWrapper(actual.default) };
});

vi.mock('./DataSourceToolbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DataSourceToolbar')>();
  const h = await import('./__test-utils__/dataSourceEditorTestHelpers');
  return { default: h.buildDataSourceToolbarWrapper(actual.default) };
});

vi.mock('./DataSourceSetupModal', async (importOriginal) => {
  const { default: DataSourceSetupModal } = await importOriginal<typeof import('./DataSourceSetupModal')>();
  return {
    default: function DataSourceSetupModalWithTestShortcut(props: Record<string, unknown>) {
      const test = props.test as Scenario;
      const onApply = props.onApply as (d: DataSource, url: string, opts?: { auth?: Scenario['auth'] }) => void;
      const mode = props.mode as string;
      const showAuthShortcut = mode === 'configure' && !!test.dataSource;
      return (
        <>
          {showAuthShortcut ? (
            <>
              <button
                type="button"
                data-testid="ds-setup-auth-apply"
                style={{ position: 'absolute', left: -2000, width: 1, height: 1, overflow: 'hidden' }}
                onClick={() =>
                  onApply(
                    test.dataSource!,
                    test.dataSource!.urlTemplate || test.url || '',
                    { auth: { type: 'bearer', token: 'test-token' } },
                  )}
              />
              <button
                type="button"
                data-testid="ds-setup-no-auth-apply"
                style={{ position: 'absolute', left: -2100, width: 1, height: 1, overflow: 'hidden' }}
                onClick={() =>
                  onApply(
                    test.dataSource!,
                    test.dataSource!.urlTemplate || test.url || '',
                    undefined,
                  )}
              />
            </>
          ) : null}
          <DataSourceSetupModal {...(props as ComponentProps<typeof DataSourceSetupModal>)} />
        </>
      );
    },
  };
});


describe('DataSourceEditor', () => {
  beforeEach(() => {
    hoistedMocks.setFetchHookOverride(null);
    hoistedMocks.handleImport.mockClear();
    hoistedMocks.lastPopulateAdapter = null;
    useDataSourceTagsHarness.mismatchTagCounts = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  describe('no data source', () => {
    it('renders empty state with setup buttons', () => {
      render(<DataSourceEditor draft={makeScenario()} onDraftChange={vi.fn()} />);
      expect(screen.getByText(/Quick Setup/)).toBeTruthy();
      expect(screen.getByText('Configure Wizard')).toBeTruthy();
      expect(screen.getByText(/No data source attached/)).toBeTruthy();
    });

    it('opens wizard on Configure Wizard click', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario()} onDraftChange={onChange} />);
      fireEvent.click(screen.getByText('Configure Wizard'));
      // Opens the setup modal
      expect(screen.getByText('Configure Data Source')).toBeTruthy();
    });

    it('Quick Setup auto-creates data source from URL params', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ url: 'https://api.example.com/api?channel=WEB' })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByText(/Quick Setup/));
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource).toBeTruthy();
      expect(updated.dataSource!.columns.length).toBeGreaterThan(0);
    });
  });

  describe('with data source', () => {
    it('renders DATA SOURCE label and row count', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('Data Source')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy(); // badge
    });

    it('renders column headers', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('vin')).toBeTruthy();
      expect(screen.getByText('channel')).toBeTruthy();
    });

    it('renders cell values', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      expect(screen.getByDisplayValue('1HGCM8')).toBeTruthy();
      expect(screen.getByDisplayValue('WEB')).toBeTruthy();
    });

    it('calls onDraftChange when cell value changes', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.change(screen.getByDisplayValue('1HGCM8'), { target: { value: '3VWFE2' } });
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows[0].values.c1).toBe('3VWFE2');
    });

    it('adds a row when + Row is clicked', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByText('+ Row'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows).toHaveLength(3);
    });

    it('adds a column when + Column is clicked', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByText('+ Column'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.columns).toHaveLength(3);
      // Each existing row should have the new column's value
      expect(Object.keys(updated.dataSource!.rows[0].values)).toHaveLength(3);
    });

    it('opens column mapper and applies mapped columns', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByTitle('Data Mapper: drag columns to URL path, query, body, header, or validate slots'));
      expect(screen.getByText('Columns → Request Template')).toBeTruthy();
      fireEvent.click(screen.getByTestId('mock-column-mapper-save'));
      const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Scenario;
      expect(updated.dataSource!.columns).toHaveLength(2);
      expect(updated.dataSource!.columns.some((c) => c.id === 'c-mapped')).toBe(true);
      expect(screen.queryByTestId('mock-column-mapper-save')).toBeNull();
    });

    it('closes column mapper via modal cancel', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      fireEvent.click(screen.getByTitle('Data Mapper: drag columns to URL path, query, body, header, or validate slots'));
      expect(screen.getByText('Columns → Request Template')).toBeTruthy();
      fireEvent.click(screen.getByText('Close Populate'));
      expect(screen.queryByText('Columns → Request Template')).toBeNull();
    });

    it('toggles row enabled/disabled', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const checkboxes = document.querySelectorAll<HTMLInputElement>('.data-source-td-checkbox input[type="checkbox"]');
      fireEvent.click(checkboxes[0]);
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows[0].enabled).toBe(false);
    });

    it('deletes a row', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const deleteButtons = screen.getAllByTitle('Delete row');
      fireEvent.click(deleteButtons[0]);
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows).toHaveLength(1);
      expect(updated.dataSource!.rows[0].id).toBe('r2');
    });

    it('deletes all rows (resets to one empty row)', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByTitle('Delete all rows'));
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows).toHaveLength(1);
      expect(updated.dataSource!.rows[0].values.c1).toBe('');
    });

    it('removes a column and its values from all rows', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const removeColBtns = screen.getAllByTitle('Remove column');
      fireEvent.click(removeColBtns[0]); // remove 'vin'
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.columns).toHaveLength(1);
      expect(updated.dataSource!.columns[0].name).toBe('channel');
      expect(updated.dataSource!.rows[0].values).not.toHaveProperty('c1');
    });

    it('moves row up', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const moveUpBtns = screen.getAllByTitle('Move up');
      fireEvent.click(moveUpBtns[1]); // move row 2 up
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows[0].id).toBe('r2');
      expect(updated.dataSource!.rows[1].id).toBe('r1');
    });

    it('renders run preview with correct count', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      expect(screen.getByText(/Run Preview: 2 enabled rows → 2 requests/)).toBeTruthy();
    });

    it('removes entire table when Remove is clicked', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByTitle('Remove entire data source'));
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource).toBeUndefined();
    });

    it('changes distribution strategy', () => {
      const onChange = vi.fn();
      const { container } = render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      selectOption(container, 'Random');
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.distribution).toBe('random');
    });

    it('renders search input', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      expect(screen.getByPlaceholderText('Search rows…')).toBeTruthy();
    });

    it('filters rows by search query', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: '1HGCM8' } });
      const cells = document.querySelectorAll('.data-source-cell-input');
      const vinCells = Array.from(cells).filter((c) => (c as HTMLInputElement).value === '1HGCM8');
      expect(vinCells.length).toBe(1);
      expect(document.querySelectorAll('.data-source-row').length).toBe(1);
    });

    it('shows row count when search is active', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: '1HGCM8' } });
      expect(screen.getByText(/1 of 2 rows/)).toBeTruthy();
    });

    it('duplicates a row', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const dupBtns = screen.getAllByTitle('Duplicate row');
      fireEvent.click(dupBtns[0]);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows).toHaveLength(3);
    });

    it('shows and edits row label', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const labelInputs = screen.getAllByPlaceholderText(/Row \d+/);
      fireEvent.change(labelInputs[0], { target: { value: 'My Label' } });
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows[0].label).toBe('My Label');
    });

    it('starts column rename on click', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      fireEvent.click(screen.getByText('vin'));
      const input = document.querySelector('.data-source-col-name-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('vin');
    });

    it('renames a column', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByText('vin'));
      const input = document.querySelector('.data-source-col-name-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'vehicleId' } });
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.columns[0].name).toBe('vehicleId');
    });

    it('changes column type', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      selectOption(screen.getAllByLabelText('Column type')[0].closest('.cs-wrapper')!, 'Header');
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.columns[0].type).toBe('header');
    });

    it('sorts by column', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      const sortBtns = screen.getAllByTitle('Sort by this column');
      fireEvent.click(sortBtns[0]);
      expect(sortBtns[0].textContent).toContain('▲');
    });

    it('marks row as sample', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const sampleBtns = screen.getAllByTitle('Mark as sample');
      fireEvent.click(sampleBtns[0]);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.rows[0].isSample).toBe(true);
    });

    it('opens edit row detail modal', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      const editBtns = screen.getAllByTitle('Edit row details');
      fireEvent.click(editBtns[0]);
      // The DataSourceRowDetailModal should be rendered
      expect(document.querySelector('.data-source-row-detail-modal, [class*="row-detail"]') || screen.queryByText(/Row.*Detail/i) || screen.queryByText(/Save/)).toBeTruthy();
    });
  });

  describe('file source info bar', () => {
    it('renders file info when source type is file', () => {
      const ds = makeDataSource();
      ds.source = { type: 'file', filePath: '/data/users.csv', fileLastRead: '2024-01-15T10:30:00Z', fileRowCount: 100 };
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('/data/users.csv')).toBeTruthy();
      expect(screen.getByText(/100 rows/)).toBeTruthy();
      expect(screen.getByText('↻ Reload')).toBeTruthy();
    });

    it('shows import timestamp without row count when fileRowCount is omitted', () => {
      const ds = makeDataSource();
      ds.source = { type: 'file', filePath: '/data/x.csv', fileLastRead: '2024-06-01T12:00:00Z' };
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('/data/x.csv')).toBeTruthy();
      const metaEl = screen.getByText(/^Imported /);
      expect(metaEl.textContent).toMatch(/Imported/);
      expect(metaEl.textContent).not.toMatch(/rows/);
    });

    it('renders Switch to Inline button', () => {
      const ds = makeDataSource();
      ds.source = { type: 'file', filePath: '/data/users.csv' };
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('Switch to Inline')).toBeTruthy();
    });

    it('switches to inline on button click', () => {
      const ds = makeDataSource();
      ds.source = { type: 'file', filePath: '/data/users.csv' };
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={onChange} />);
      fireEvent.click(screen.getByText('Switch to Inline'));
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.dataSource!.source.type).toBe('inline');
    });
  });

  describe('fetch error display', () => {
    it('does not show fetch error when there is none', () => {
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={vi.fn()} />);
      expect(screen.queryByText(/Fetch error/)).toBeNull();
    });
  });

  describe('shared data source support', () => {
    const makeSharedDs = (): SharedDataSource => ({
      id: 'shared-1',
      name: 'Shared Users',
      dataSource: makeDataSource(),
      tags: ['users'],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
    });

    it('renders linked shared data source badge', () => {
      const shared = makeSharedDs();
      render(
        <DataSourceEditor
          draft={makeScenario({ dataSource: makeDataSource(), sharedDataSourceId: 'shared-1' })}
          onDraftChange={vi.fn()}
          sharedDataSources={[shared]}
        />
      );
      expect(screen.getByText(/Shared Users/)).toBeTruthy();
    });

    it('links a shared data source via select', () => {
      const shared = makeSharedDs();
      const onChange = vi.fn();
      const { container } = render(
        <DataSourceEditor
          draft={makeScenario({ dataSource: makeDataSource() })}
          onDraftChange={onChange}
          sharedDataSources={[shared]}
        />
      );
      selectOptionByIndex(container, 0, 'Shared Users (2 rows)');
      expect(onChange).toHaveBeenCalled();
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.sharedDataSourceId).toBe('shared-1');
    });

    it('does not close detach menu on mousedown inside the dropdown', () => {
      const shared = makeSharedDs();
      render(
        <DataSourceEditor
          draft={makeScenario({ dataSource: makeDataSource(), sharedDataSourceId: 'shared-1' })}
          onDraftChange={vi.fn()}
          sharedDataSources={[shared]}
        />
      );
      fireEvent.click(screen.getByTitle('Detach from shared data source'));
      const copyBtn = screen.getByTitle('Copy shared data to this test\'s inline data, then unlink');
      fireEvent.mouseDown(copyBtn);
      expect(screen.getByTitle('Copy shared data to this test\'s inline data, then unlink')).toBeTruthy();
    });

    it('detaches shared DS with copy', () => {
      const shared = makeSharedDs();
      const onChange = vi.fn();
      render(
        <DataSourceEditor
          draft={makeScenario({ dataSource: makeDataSource(), sharedDataSourceId: 'shared-1' })}
          onDraftChange={onChange}
          sharedDataSources={[shared]}
        />
      );
      const detachBtn = screen.getByTitle('Detach from shared data source');
      fireEvent.click(detachBtn);
      const copyBtn = screen.getByTitle('Copy shared data to this test\'s inline data, then unlink');
      fireEvent.click(copyBtn);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.sharedDataSourceId).toBeUndefined();
      expect(updated.dataSource).toBeTruthy();
    });

    it('detaches shared DS unlink only', () => {
      const shared = makeSharedDs();
      const onChange = vi.fn();
      render(
        <DataSourceEditor
          draft={makeScenario({ dataSource: makeDataSource(), sharedDataSourceId: 'shared-1' })}
          onDraftChange={onChange}
          sharedDataSources={[shared]}
        />
      );
      const detachBtn = screen.getByTitle('Detach from shared data source');
      fireEvent.click(detachBtn);
      const unlinkBtn = screen.getByTitle('Just remove the link, test will have no data');
      fireEvent.click(unlinkBtn);
      const updated = onChange.mock.calls[0][0] as Scenario;
      expect(updated.sharedDataSourceId).toBeUndefined();
    });
  });

  describe('tags and subsets', () => {
    it('shows tag filter bar when rows have tags', () => {
      const ds = makeDataSource();
      ds.rows[0].tags = ['vip'];
      ds.rows[1].tags = ['vip', 'premium'];
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('Filter:')).toBeTruthy();
      expect(screen.getByText(/🏷 vip/)).toBeTruthy();
    });

    it('filters by tag when tag button clicked', () => {
      const ds = makeDataSource();
      ds.rows[0].tags = ['vip'];
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={vi.fn()} />);
      const vipBtn = screen.getByText(/🏷 vip/);
      fireEvent.click(vipBtn);
      expect(screen.getByText(/1 of 2 rows/)).toBeTruthy();
    });

    it('adds tag to a row', () => {
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: makeDataSource() })} onDraftChange={onChange} />);
      const addTagBtns = screen.getAllByTitle('Add tag');
      fireEvent.click(addTagBtns[0]);
      const tagInput = screen.getByPlaceholderText('tag…');
      fireEvent.change(tagInput, { target: { value: 'production' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });
      expect(onChange).toHaveBeenCalled();
    });

    it('shows subsets section when subsets exist', () => {
      const ds = makeDataSource();
      ds.subsets = [{ name: 'VIP Set', filter: { type: 'tags', tags: ['vip'], mode: 'any' } }];
      ds.rows[0].tags = ['vip'];
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={vi.fn()} />);
      expect(screen.getByText('Subsets:')).toBeTruthy();
      expect(screen.getByText('VIP Set')).toBeTruthy();
    });

    it('removes a subset', () => {
      const ds = makeDataSource();
      ds.subsets = [{ name: 'VIP Set', filter: { type: 'tags', tags: ['vip'], mode: 'any' } }];
      ds.rows[0].tags = ['vip'];
      const onChange = vi.fn();
      render(<DataSourceEditor draft={makeScenario({ dataSource: ds })} onDraftChange={onChange} />);
      const removeBtn = screen.getByTitle('Remove subset');
      fireEvent.click(removeBtn);
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('promote to shared', () => {
    it('opens promote modal', () => {
      const onChange = vi.fn();
      const onPromote = vi.fn().mockReturnValue('new-shared-id');
      render(
        <DataSourceEditor
          draft={makeScenario({ dataSource: makeDataSource() })}
          onDraftChange={onChange}
          onPromoteToShared={onPromote}
        />
      );
      fireEvent.click(screen.getByTitle('Promote inline data to a shared data source'));
      // PromoteToSharedModal renders with a name input for the shared DS
      expect(screen.getByPlaceholderText(/name/i) || document.querySelector('[class*="promote"]')).toBeTruthy();
    });
  });

});
