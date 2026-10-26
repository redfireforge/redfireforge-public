/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scenario, FeatureGroup } from '@shared/types';
import { useDataSourceSetupState, type DataSourceSetupProps } from './useDataSourceSetupState';

const generateExcelTemplateMock = vi.fn(() => ({ sheet: 'mock' }));
const downloadExcelMock = vi.fn(async () => {});
const sharedMocks = vi.hoisted(() => ({
  proxyFetchMock: vi.fn(),
  applyAuthHeadersMock: vi.fn(async () => {}),
}));

vi.mock('../utils/csvTemplate', async () => {
  const actual = await vi.importActual<typeof import('../utils/csvTemplate')>('../utils/csvTemplate');
  return {
    ...actual,
    generateExcelTemplate: (...args: unknown[]) => generateExcelTemplateMock(...args),
    downloadExcel: (...args: unknown[]) => downloadExcelMock(...args),
  };
});

vi.mock('@engine/core/executor', () => ({
  proxyFetch: (...args: unknown[]) => sharedMocks.proxyFetchMock(...args),
}));

vi.mock('../../../shared/utils/applyAuthHeaders', () => ({
  applyAuthHeaders: (...args: unknown[]) => sharedMocks.applyAuthHeadersMock(...args),
}));

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 't1',
    name: 'Scenario A',
    method: 'GET',
    url: 'https://api.example.com/users/123?q=search',
    headers: [
      { key: '', value: 'ignored' },
      { key: 'X-Trace', value: 'abc' },
    ],
    body: '',
    auth: { type: 'none' },
    validation: { mode: 'status', expectedFields: [] },
    ...overrides,
  } as Scenario;
}

function makeFeatureGroups(): FeatureGroup[] {
  return [
    {
      id: 'fg1',
      name: 'FG1',
      scenarios: [
        { id: 'sc1', name: 'SC1', kind: 'standard', tests: [] },
        { id: 'sc2', name: 'SC2', kind: 'parameterized', tests: [] },
      ],
    },
  ];
}

function makeProps(overrides: Partial<DataSourceSetupProps> = {}): DataSourceSetupProps {
  return {
    test: makeScenario(),
    mode: 'parameterize',
    onApply: vi.fn(),
    onClose: vi.fn(),
    onFetchRow: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: {}, body: '{"ok":true}' })),
    featureGroups: makeFeatureGroups(),
    editingTest: { fgId: 'fg1', scenarioId: 'sc1', testId: 't1' },
    sourceName: 'Source',
    ...overrides,
  };
}

beforeEach(() => {
  generateExcelTemplateMock.mockClear();
  downloadExcelMock.mockClear();
});

describe('useDataSourceSetupState coverage branches', () => {
  it('persists changed contract patterns on close when existing dataSource is present', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const test = makeScenario({
      dataSource: {
        id: 'ds1',
        source: { type: 'inline' },
        columns: [],
        rows: [],
        urlTemplate: 'https://api.example.com/users/{{id}}',
        validationContract: ['a[*].b'],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, onApply, onClose })));

    act(() => {
      result.current.setContractPatterns(new Set(['a[*].b', 'c[*].d']));
    });

    act(() => {
      result.current.handleClose();
    });

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        validationContract: ['a[*].b', 'c[*].d'],
      }),
      'https://api.example.com/users/{{id}}',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('handles fetch error and HTTP status branches in validate fetch flow', async () => {
    const onFetchRow = vi
      .fn()
      .mockResolvedValueOnce({
        status: 500,
        statusText: 'ERR',
        headers: {},
        body: 'x',
        error: 'network-fail',
      })
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        headers: {},
        body: 'missing',
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: '{"ok":true}',
      });

    const { result } = renderHook(() =>
      useDataSourceSetupState(
        makeProps({
          onFetchRow,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleFetchForValidate();
    });
    expect(result.current.fetchError?.message).toBe('network-fail');

    await act(async () => {
      await result.current.handleFetchForValidate();
    });
    expect(result.current.fetchError?.message).toContain('HTTP 404');

    await act(async () => {
      await result.current.handleFetchForValidate();
    });
    expect(result.current.fetchError).toBeNull();
    expect(result.current.sampleJson).toBe('{"ok":true}');
    expect(onFetchRow).toHaveBeenCalledWith(
      expect.any(String),
      'GET',
      { 'X-Trace': 'abc' },
      undefined,
      expect.any(Object),
    );
  });

  it('initializes header and body selections from existing data source metadata', () => {
    const test = makeScenario({
      body: '{"token":"{{token}}"}',
      dataSource: {
        id: 'ds1',
        source: { type: 'inline' },
        columns: [
          { id: 'h1', name: 'trace', type: 'header', mapping: 'x-trace' },
          { id: 'b1', name: 'payload', type: 'body', mapping: 'token' },
        ],
        rows: [],
        urlTemplate: 'https://api.example.com/users/{{id}}?q={{q}}',
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test })));

    expect(result.current.headerSelections['X-Trace']).toEqual({ enabled: true, name: 'trace' });
    expect(result.current.bodyVariableCandidates).toEqual(['token']);
    expect(result.current.bodySelections.token).toEqual({ enabled: true, name: 'payload' });
  });

  it('closes without applying when contract patterns are unchanged', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const test = makeScenario({
      dataSource: {
        id: 'ds1',
        source: { type: 'inline' },
        columns: [],
        rows: [],
        urlTemplate: 'https://api.example.com/users/{{id}}',
        validationContract: ['a[*].b'],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, onApply, onClose })));

    act(() => {
      result.current.handleClose();
    });

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('uses proxyFetch when no fetch callback is provided', async () => {
    sharedMocks.proxyFetchMock
      .mockResolvedValueOnce({ status: 500, statusText: 'ERR', headers: {}, body: 'x', error: 'network-fail' })
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: 'missing' })
      .mockRejectedValueOnce(new Error('proxy boom'));

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ onFetchRow: undefined })));

    await act(async () => {
      await result.current.handleFetchForValidate();
    });
    expect(result.current.fetchError?.message).toBe('network-fail');

    await act(async () => {
      await result.current.handleFetchForValidate();
    });
    expect(result.current.fetchError?.message).toContain('HTTP 404');

    await act(async () => {
      await result.current.handleFetchForValidate();
    });
    expect(result.current.fetchError?.message).toBe('proxy boom');
    expect(sharedMocks.applyAuthHeadersMock).toHaveBeenCalled();
  });

  it('adds missing validate columns in review mode', () => {
    const { result } = renderHook(() => useDataSourceSetupState(makeProps()));

    act(() => {
      result.current.setColumnDefs([
        {
          type: 'path',
          fullKey: 'path:id',
          mapping: 'id',
          autoName: 'id',
          customName: 'id',
        },
      ]);
      result.current.setValidateFields([
        { jsonPath: '$.user.name', expectedValue: 'Ada' },
      ]);
    });

    act(() => {
      result.current.enterStep4Create();
    });

    expect(result.current.columnDefs.some((column) => column.type === 'validate' && column.mapping === '$.user.name')).toBe(true);
  });

  it('applies parameterize data with existing rows and derived defaults', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const test = makeScenario({
      url: 'https://api.example.com/users/123?q=search',
      dataSource: {
        id: 'ds3',
        source: { type: 'inline' },
        urlTemplate: 'https://api.example.com/users/{{id}}?q={{q}}',
        columns: [
          { id: 'p1', name: 'userId', type: 'path', mapping: 'id' },
          { id: 'q1', name: 'query', type: 'param', mapping: 'q' },
          { id: 'v1', name: 'status', type: 'validate', mapping: '$.status' },
        ],
        rows: [
          { id: 'r1', enabled: true, values: { p1: '123', q1: 'search', v1: 'ok' } },
        ],
        validationContract: ['$.status'],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, onApply, onClose })));

    act(() => {
      result.current.setColumnDefs([
        { type: 'path', fullKey: 'path:id', mapping: 'id', autoName: 'id', customName: 'userId' },
        { type: 'param', fullKey: 'param:q', mapping: 'q', autoName: 'q', customName: 'query' },
        { type: 'validate', fullKey: 'validate:$.status', mapping: '$.status', autoName: 'status', customName: 'status', sampleValue: 'ok' },
      ]);
      result.current.setValidateFields([{ jsonPath: '$.status', expectedValue: 'ok' }]);
      result.current.setContractPatterns(new Set(['$.status', '$.extra']));
      result.current.setCopyName('Copy');
    });

    act(() => {
      result.current.handleApply();
    });

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        validationContract: ['$.status', '$.extra'],
      }),
      'https://api.example.com/users/{{id}}?q={{query}}',
      expect.objectContaining({
        copyName: 'Copy',
        newScenarioName: 'Parameterized Tests',
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('applies parameterize data without existing rows using sample JSON defaults', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const test = makeScenario({
      body: '{"user":{"name":"Ada"}}',
      validation: {
        mode: 'status',
        expectedFields: [{ jsonPath: '$.user.name', expectedValue: 'Ada' }],
        sampleJson: '{"user":{"name":"Ada"}}',
      },
      dataSource: undefined,
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, onApply, onClose })));

    act(() => {
      result.current.setColumnDefs([
        { type: 'path', fullKey: 'path:id', mapping: 'id', autoName: 'id', customName: 'id' },
        { type: 'param', fullKey: 'param:q', mapping: 'q', autoName: 'q', customName: 'q' },
        { type: 'validate', fullKey: 'validate:$.user.name', mapping: '$.user.name', autoName: 'user_name', customName: 'user_name', sampleValue: 'Ada' },
      ]);
      result.current.setValidateFields([{ jsonPath: '$.user.name', expectedValue: 'Ada' }]);
      result.current.setCopyName('Copy');
    });

    act(() => {
      result.current.handleApply();
    });

    expect(onApply).toHaveBeenCalled();
    const [dataTable] = onApply.mock.calls[0];
    expect(dataTable.rows[0].enabled).toBe(true);
    expect(dataTable.rows[0].isSample).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('applies parameterize payload and uses default new scenario name when blank', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ onApply, onClose })));

    act(() => {
      result.current.setColumnDefs([
        {
          type: 'param',
          fullKey: 'param:q',
          mapping: 'q',
          autoName: 'q',
          customName: 'q',
        },
      ]);
      result.current.setTargetScenarioId('__new__');
      result.current.setNewScenarioName('   ');
      result.current.setCopyName('Copy A');
    });

    act(() => {
      result.current.handleApply();
    });

    expect(onApply).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        copyName: 'Copy A',
        targetScenarioId: undefined,
        newScenarioName: 'Parameterized Tests',
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('exports using existing rows and name-column mapping branch', async () => {
    const onClose = vi.fn();
    const test = makeScenario({
      dataSource: {
        id: 'ds2',
        source: { type: 'inline' },
        urlTemplate: 'https://api.example.com/users/{{id}}?q={{q}}',
        columns: [
          { id: 'c1', name: 'q', type: 'param', mapping: 'q' },
        ],
        rows: [
          { id: 'r1', label: 'Row Label', enabled: true, values: { c1: 'hello' } },
        ],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, mode: 'export', onClose })));

    act(() => {
      result.current.setColumnDefs([
        {
          type: 'name',
          fullKey: 'name:name',
          mapping: 'name',
          autoName: 'name',
          customName: 'scenario_name',
        },
        {
          type: 'param',
          fullKey: 'param:q',
          mapping: 'q',
          autoName: 'q',
          customName: 'q',
        },
      ]);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(generateExcelTemplateMock).toHaveBeenCalled();
    expect(downloadExcelMock).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('_template.xlsx'));
    expect(onClose).toHaveBeenCalled();
  });

  it('exports a template when there are no existing rows', async () => {
    const onClose = vi.fn();
    const test = makeScenario({
      dataSource: {
        id: 'ds-empty',
        source: { type: 'inline' },
        urlTemplate: 'https://api.example.com/users/{{id}}',
        columns: [],
        rows: [],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, mode: 'export', onClose })));

    act(() => {
      result.current.setColumnDefs([
        {
          type: 'name',
          fullKey: 'name:name',
          mapping: 'name',
          autoName: 'name',
          customName: 'scenario_name',
        },
      ]);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(generateExcelTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dataRows: undefined,
      }),
    );
    expect(downloadExcelMock).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('disables url param columns that were not remembered when param columns already exist', () => {
    const test = makeScenario({
      url: 'https://api.example.com/users/{{id}}?q=1&page=2',
      dataSource: {
        id: 'ds-params',
        source: { type: 'inline' },
        urlTemplate: 'https://api.example.com/users/{{id}}?q={{q}}',
        columns: [{ id: 'c-q', name: 'q', type: 'param', mapping: 'q' }],
        rows: [{ id: 'r1', enabled: true, values: { 'c-q': 'hello' } }],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test })));

    expect(result.current.paramSelections.q?.enabled).toBe(true);
    expect(result.current.paramSelections.page?.enabled).toBe(false);
  });

  it('handleApply seeds first-row path values from literal URL segments when stored values are templates', () => {
    const onApply = vi.fn();
    const test = makeScenario({
      url: 'https://api.example.com/users/123',
      dataSource: {
        id: 'ds-path',
        source: { type: 'inline' },
        urlTemplate: 'https://api.example.com/users/{{id}}',
        columns: [{ id: 'c-id', name: 'id', type: 'path', mapping: 'id' }],
        rows: [{ id: 'r1', enabled: true, values: { 'c-id': '{{id}}' } }],
      },
    });

    const { result } = renderHook(() => useDataSourceSetupState(makeProps({ test, onApply })));

    act(() => {
      result.current.setColumnDefs([
        {
          type: 'path',
          fullKey: 'path:id',
          mapping: 'id',
          autoName: 'id',
          customName: 'id',
        },
      ]);
    });

    act(() => {
      result.current.handleApply();
    });

    expect(onApply).toHaveBeenCalled();
    const applied = onApply.mock.calls[0]![0]!;
    const colId = applied.columns.find((c) => c.mapping === 'id')!.id;
    expect(applied.rows[0]!.values[colId]).toBe('123');
  });
});
