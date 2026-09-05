/* eslint-disable react-refresh/only-export-components -- shared test helpers
   intentionally combine fixtures, JSX component factories, and wrapper
   builders used across DataSourceEditor test splits. */
/**
 * Shared fixtures + mock factory builders for DataSourceEditor test splits.
 *
 * The vi.hoisted/mock registration calls must remain in each test file due to Vitest's
 * per-file hoisting. This module exports pure helpers (data fixtures,
 * wrapper-component factories) that the per-file mock factories can call.
 *
 * IMPORTANT: This module must NOT import `../DataSourceEditor` (avoid
 * circular mock-resolution hangs).
 */
import type { ComponentProps, JSX } from 'react';
import type {
  Scenario,
  DataSource,
  DataSourceColumn,
  DataSourceRow,
} from '@shared/types';

// ─── Data fixtures ───────────────────────────────────────────────────

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 's1',
    name: 'Test',
    url: 'https://api.example.com/api?channel=WEB',
    method: 'GET',
    headers: [],
    body: '',
    auth: { type: 'none' },
    validation: { mode: 'none' },
    ...overrides,
  } as Scenario;
}

export function makeDataSource(): DataSource {
  return {
    id: 'dt1',
    columns: [
      { id: 'c1', name: 'vin', type: 'body', mapping: 'vin' },
      { id: 'c2', name: 'channel', type: 'param', mapping: 'channel' },
    ],
    rows: [
      { id: 'r1', values: { c1: '1HGCM8', c2: 'WEB' }, enabled: true },
      { id: 'r2', values: { c1: '2HGES1', c2: 'APP' }, enabled: true },
    ],
    source: { type: 'inline' },
  };
}

export function makeDataTransferWithId(id: string): DataTransfer {
  const store: Record<string, string> = { 'text/plain': id };
  return {
    effectAllowed: 'all',
    dropEffect: 'move',
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? '',
  } as unknown as DataTransfer;
}

// ─── Wrapper-mock factory builders ───────────────────────────────────
// The DataSourceEditor tests rely on Vitest mock factories that wrap the
// real component with hidden "probe" buttons used to drive specific code paths.
// Each builder receives the original component and returns the wrapped one.

type GridProps = ComponentProps<React.FunctionComponent<{
  setEditingRowId: (id: string) => void;
}>>;

export function buildDataSourceGridTableWrapper<P extends { setEditingRowId: (id: string) => void }>(
  ActualGrid: (props: P) => JSX.Element,
) {
  return function DataSourceGridTableWithGhostRowProbe(props: P): JSX.Element {
    return (
      <>
        <button
          type="button"
          data-testid="probe-open-row-detail-ghost"
          style={{ position: 'absolute', left: -3200, width: 1, height: 1, overflow: 'hidden' }}
          onClick={() => props.setEditingRowId('no-such-row-id')}
        >
          probe ghost row detail
        </button>
        <ActualGrid {...props} />
      </>
    );
  };
}

export function buildDataSourceToolbarWrapper<P extends {
  onDetachWithCopy: () => void;
  onShowPromoteModal: () => void;
}>(ActualToolbar: (props: P) => JSX.Element) {
  return function DataSourceToolbarWithDetachProbe(props: P): JSX.Element {
    return (
      <>
        <button
          type="button"
          data-testid="probe-detach-with-copy"
          style={{ position: 'absolute', left: -3000, width: 1, height: 1, overflow: 'hidden' }}
          onClick={() => props.onDetachWithCopy()}
        >
          probe detach copy
        </button>
        <button
          type="button"
          data-testid="probe-show-promote-modal"
          style={{ position: 'absolute', left: -3100, width: 1, height: 1, overflow: 'hidden' }}
          onClick={() => props.onShowPromoteModal()}
        >
          probe promote modal
        </button>
        <ActualToolbar {...props} />
      </>
    );
  };
}

interface RowDetailMockProps {
  onSave: (updatedRow: DataSourceRow, newColumns?: DataSourceColumn[]) => void;
  onClose: () => void;
  row: DataSourceRow;
  draft: Scenario;
  dataTable: DataSource;
  rowIndex: number;
  onFetchRow?: unknown;
}

export function MockDataSourceRowDetailModal({
  onSave,
  onClose,
  row,
}: RowDetailMockProps): JSX.Element {
  return (
    <div className="data-source-row-detail-modal">
      <button type="button" onClick={() => onSave({ ...row, label: 'from-modal' })}>
        Save
      </button>
      <button
        type="button"
        onClick={() =>
          onSave(
            { ...row, values: { ...row.values, 'new-val-col': '' } },
            [{ id: 'new-val-col', name: 'n1', type: 'validate', mapping: '$.x' }],
          )
        }
      >
        Save With New Columns
      </button>
      <button type="button" onClick={onClose}>
        Close Row Detail
      </button>
    </div>
  );
}

// Internal type aid for GridProps; not exported.
export type _GridProps = GridProps;
