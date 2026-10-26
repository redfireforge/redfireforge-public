/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataMapperValidation } from './useDataMapperValidation';
import { DataMapperValidationDeps } from './useDataMapperValidation';
import { Mapping } from '../types';

function makeDeps(overrides: Partial<DataMapperValidationDeps> = {}): DataMapperValidationDeps {
  return {
    caps: { codeEditor: true },
    adapter: {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({ expectedFields: [] }),
      deserialize: vi.fn().mockReturnValue([]),
    } as unknown as DataMapperValidationDeps['adapter'],
    mappings: [],
    activeSourceId: 'src1',
    setMappings: vi.fn(),
    onChange: vi.fn(),
    skipNextOnChangeRef: { current: false },
    initialData: undefined,
    effectiveTarget: {},
    onAssertionsChange: vi.fn(),
    flushRef: undefined,
    showRulesView: false,
    handleFetchTargetSchema: vi.fn().mockResolvedValue(undefined),
    setSourceSample: vi.fn(),
    setToast: vi.fn(),
    ...overrides,
  };
}

describe('useDataMapperValidation', () => {
  it('initializes with empty assertions when no initialData', () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationSamplePaths).toEqual([]);
    expect(result.current.validationSync).toBeDefined();
  });

  it('computes validationSamplePaths from effectiveTarget.sampleData', () => {
    const deps = makeDeps({
      effectiveTarget: { sampleData: JSON.stringify({ a: 1, b: { c: 2 } }) },
    });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationSamplePaths).toContain('a');
    expect(result.current.validationSamplePaths).toContain('b.c');
  });

  it('computes validationFields from adapter.serialize', () => {
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({
        expectedFields: [{ jsonPath: 'status', operator: 'equals', operatorValue: 'active' }],
      }),
      deserialize: vi.fn().mockReturnValue([]),
    } as unknown as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({ adapter, mappings: [{ id: 'm1', sourcePath: 'status', targetPath: 'status', sourceId: 'src1' }] });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationSync).toBeDefined();
  });

  it('handleAddArrayAssertion adds a length assertion', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleAddArrayAssertion('items', 'length');
    });

    expect(onAssertionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'arrayLength', jsonPath: '$.items' })]),
    );
  });

  it('handleAddArrayAssertion adds a contains assertion', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleAddArrayAssertion('data', 'contains');
    });

    expect(onAssertionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'arrayContains', jsonPath: '$.data' })]),
    );
  });

  it('handleAddArrayAssertion adds each and subset assertions', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => { result.current.handleAddArrayAssertion('arr', 'each'); });
    expect(onAssertionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'each' })]),
    );

    act(() => { result.current.handleAddArrayAssertion('$.arr2', 'subset'); });
    expect(onAssertionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'containsSubset', jsonPath: '$.arr2' })]),
    );
  });

  it('handleUpdateArrayAssertion patches an existing assertion in place', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => { result.current.handleAddArrayAssertion('items', 'length'); });
    onAssertionsChange.mockClear();

    act(() => { result.current.handleUpdateArrayAssertion(0, { value: 7 } as never); });
    expect(onAssertionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'arrayLength', value: 7 })]),
    );
  });

  it('handleUpdateArrayAssertion no-ops on out-of-range index', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => { result.current.handleAddArrayAssertion('items', 'length'); });
    onAssertionsChange.mockClear();

    act(() => { result.current.handleUpdateArrayAssertion(-1, { value: 9 } as never); });
    act(() => { result.current.handleUpdateArrayAssertion(99, { value: 9 } as never); });
    expect(onAssertionsChange).not.toHaveBeenCalled();
  });

  it('handleRemoveArrayAssertion removes by index and notifies', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => { result.current.handleAddArrayAssertion('items', 'length'); });
    act(() => { result.current.handleAddArrayAssertion('items', 'contains'); });
    onAssertionsChange.mockClear();

    act(() => { result.current.handleRemoveArrayAssertion(0); });
    const lastCall = onAssertionsChange.mock.calls.at(-1)?.[0] as Array<{ type: string }>;
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0].type).toBe('arrayContains');
  });

  it('handleRemoveArrayAssertion no-ops on out-of-range index', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => { result.current.handleAddArrayAssertion('items', 'length'); });
    onAssertionsChange.mockClear();

    act(() => { result.current.handleRemoveArrayAssertion(-1); });
    act(() => { result.current.handleRemoveArrayAssertion(42); });
    expect(onAssertionsChange).not.toHaveBeenCalled();
  });

  it('handleVerifyAll enables verify and calls verifyAll', () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useDataMapperValidation(deps));
    act(() => { result.current.handleVerifyAll(); });
    expect(result.current.verifyHook.result).toBeDefined();
  });

  it('handleToggleAutoVerify toggles auto-verify state', () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.autoVerifyEnabled).toBe(false);
    act(() => { result.current.handleToggleAutoVerify(); });
    expect(result.current.autoVerifyEnabled).toBe(true);
    act(() => { result.current.handleToggleAutoVerify(); });
    expect(result.current.autoVerifyEnabled).toBe(false);
  });

  it('handleFetchAndVerify calls fetchTargetSchema and enables verify', async () => {
    const handleFetchTargetSchema = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({}),
      deserialize: vi.fn().mockReturnValue([]),
      fetchTargetSchema: vi.fn(),
    } as unknown as DataMapperValidationDeps['adapter'];
    const setToast = vi.fn();
    const deps = makeDeps({ adapter, handleFetchTargetSchema, setToast });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    await act(async () => { await result.current.handleFetchAndVerify(); });
    expect(handleFetchTargetSchema).toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith('Fetching live response…');
  });

  it('handleFetchAndVerify handles errors', async () => {
    const handleFetchTargetSchema = vi.fn().mockRejectedValue(new Error('network'));
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({}),
      deserialize: vi.fn().mockReturnValue([]),
      fetchTargetSchema: vi.fn(),
    } as unknown as DataMapperValidationDeps['adapter'];
    const setToast = vi.fn();
    const deps = makeDeps({ adapter, handleFetchTargetSchema, setToast });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    await act(async () => { await result.current.handleFetchAndVerify(); });
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('Fetch failed'));
  });

  it('handleUpdateValidationFields merges fields with existing mappings', () => {
    const setMappings = vi.fn();
    const onChange = vi.fn();
    const existingMapping: Mapping = {
      id: 'm1',
      sourcePath: 'status',
      sourceId: 'src1',
      targetPath: 'status',
    };
    const deps = makeDeps({ mappings: [existingMapping], setMappings, onChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([
        { jsonPath: 'status', operator: 'equals' as const, operatorValue: 'active' },
        { jsonPath: 'name', operator: 'exists' as const },
      ]);
    });

    expect(setMappings).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ targetPath: 'status', operator: 'equals' }),
      expect.objectContaining({ targetPath: 'name', operator: 'exists' }),
    ]));
    expect(onChange).toHaveBeenCalled();
  });

  it('handleUpdateValidationFields keeps expression-based mappings', () => {
    const setMappings = vi.fn();
    const existingMapping: Mapping = {
      id: 'm1',
      sourcePath: 'x',
      sourceId: 'src1',
      targetPath: 'y',
      expression: '$upper(x)',
    };
    const deps = makeDeps({ mappings: [existingMapping], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([]);
    });

    expect(setMappings).toHaveBeenCalledWith([existingMapping]);
  });

  it('initializes assertions from initialData', () => {
    const initialAssertions = [{ type: 'arrayLength' as const, jsonPath: '$.items', operator: '>=', value: 1 }];
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({
      initialData: { assertions: initialAssertions } as unknown,
      onAssertionsChange,
    });
    renderHook(() => useDataMapperValidation(deps));
    expect(onAssertionsChange).toHaveBeenCalledWith(initialAssertions);
  });

  it('returns empty validationFields when code editor capability is off', () => {
    const serialize = vi.fn().mockReturnValue({ expectedFields: [{ jsonPath: 'x' }] });
    const adapter = { ...makeDeps().adapter, serialize } as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({ caps: { codeEditor: false }, adapter });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationFields).toEqual([]);
    expect(serialize).not.toHaveBeenCalled();
  });

  it('returns empty validationFields when serialize output lacks expectedFields', () => {
    const adapter = {
      ...makeDeps().adapter,
      serialize: vi.fn().mockReturnValue({ other: true }),
    } as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({ adapter });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationFields).toEqual([]);
  });

  it('returns empty validationFields when serialize throws', () => {
    const adapter = {
      ...makeDeps().adapter,
      serialize: vi.fn(() => {
        throw new Error('serialize fail');
      }),
    } as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({ adapter });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationFields).toEqual([]);
  });

  it('ignores malformed sample JSON when building validationSamplePaths', () => {
    const brokenJson = '{"broken": ';
    const deps = makeDeps({ effectiveTarget: { sampleData: brokenJson } });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationSamplePaths).toEqual([]);
  });

  it('parses object sampleData without JSON.parse', () => {
    const sampleData = { nested: { leaf: 1 } };
    const deps = makeDeps({ effectiveTarget: { sampleData } });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationSamplePaths.length).toBeGreaterThan(0);
  });

  it('updates assertions when initialData reference changes', () => {
    const a1 = [{ type: 'arrayLength' as const, jsonPath: '$.a', operator: '>=' as const, value: 1 }];
    const a2 = [{ type: 'arrayLength' as const, jsonPath: '$.b', operator: '>=' as const, value: 2 }];
    const onAssertionsChange = vi.fn();
    const { result, rerender } = renderHook(
      (p: DataMapperValidationDeps) => useDataMapperValidation(p),
      {
        initialProps: makeDeps({
          initialData: { assertions: a1 } as unknown,
          onAssertionsChange,
        }),
      },
    );

    expect(result.current.validationAssertions).toEqual(a1);

    rerender(
      makeDeps({
        initialData: { assertions: a2 } as unknown,
        onAssertionsChange,
      }),
    );

    expect(result.current.validationAssertions).toEqual(a2);
    expect(onAssertionsChange).toHaveBeenCalledWith(a2);
  });

  it('assigns flushRef to validation flush and clears on unmount', () => {
    const flushRef = { current: null as (() => void) | null };
    const deps = makeDeps({ flushRef, showRulesView: true });
    const { result, unmount } = renderHook(() => useDataMapperValidation(deps));

    expect(typeof flushRef.current).toBe('function');
    expect(flushRef.current).toBe(result.current.validationSync.flushPending);

    unmount();
    expect(flushRef.current).toBeNull();
  });

  it('handleFetchAndVerify returns immediately when adapter has no fetchTargetSchema', async () => {
    const adapter = { ...makeDeps().adapter, fetchTargetSchema: undefined } as DataMapperValidationDeps['adapter'];
    const handleFetchTargetSchema = vi.fn();
    const setToast = vi.fn();
    const deps = makeDeps({ adapter, handleFetchTargetSchema, setToast });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    await act(async () => {
      await result.current.handleFetchAndVerify();
    });

    expect(handleFetchTargetSchema).not.toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalledWith('Fetching live response…');
  });

  it('handleUpdateValidationFields preserves operatorValue from mapping when field omits operatorValue', () => {
    const setMappings = vi.fn();
    const existingMapping: Mapping = {
      id: 'm1',
      sourcePath: '$.status',
      sourceId: 'src1',
      targetPath: '$.status',
      operatorValue: 'fallback',
    };
    const deps = makeDeps({ mappings: [existingMapping], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([
        {
          jsonPath: '$.status',
          operator: 'equals' as const,
          expectedValue: undefined as unknown as string,
          operatorValue: undefined,
        },
      ]);
    });

    expect(setMappings).toHaveBeenCalledWith([
      expect.objectContaining({ operatorValue: 'fallback' }),
    ]);
  });

  it('handleUpdateValidationAssertions updates local state and notifies parent', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({ onAssertionsChange });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    const next = [{ type: 'existence' as const, jsonPath: '$.x', expectExists: true }];
    act(() => {
      result.current.handleUpdateValidationAssertions(next);
    });

    expect(result.current.validationAssertions).toEqual(next);
    expect(onAssertionsChange).toHaveBeenCalledWith(next);
  });

  it('handleUpdateValidationFields drops plain mappings absent from incoming fields unless they carry expressions', () => {
    const setMappings = vi.fn();
    const plain: Mapping = { id: 'drop', sourcePath: 'gone', sourceId: 'src1', targetPath: 'gone' };
    const withExpr: Mapping = { id: 'keep', sourcePath: 'e', sourceId: 'src1', targetPath: 'e', expression: '$upper($.x)' };
    const deps = makeDeps({ mappings: [plain, withExpr], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([]);
    });

    expect(setMappings).toHaveBeenCalledWith([withExpr]);
  });

  it('handleUpdateValidationFields applies negate from matching expectedField', () => {
    const setMappings = vi.fn();
    const m: Mapping = { id: 'm1', sourcePath: 'status', sourceId: 'src1', targetPath: '$.status', operatorValue: 'x' };
    const deps = makeDeps({ mappings: [m], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([
        {
          jsonPath: '$.status',
          operator: 'equals',
          negate: true,
          operatorValue: 'active',
          expectedValue: 'active',
        },
      ]);
    });

    expect(setMappings).toHaveBeenCalledWith([
      expect.objectContaining({ negate: true, operator: 'equals' }),
    ]);
  });

  it('handleUpdateValidationFields inserts negate on newly added validation fields only when negate is truthy', () => {
    const setMappings = vi.fn();
    const deps = makeDeps({ mappings: [], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([
        {
          jsonPath: '$.new',
          operator: 'exists',
          negate: true,
          expectedValue: '',
        },
      ]);
    });

    expect(setMappings).toHaveBeenCalledWith([
      expect.objectContaining({
        targetPath: '$.new',
        sourcePath: '$.new',
        negate: true,
      }),
    ]);
  });

  it('validationFields memo returns empty when serializer output omits expectedFields key', () => {
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn(() => ({ otherPayload: [] })),
      deserialize: vi.fn().mockReturnValue([]),
    } as unknown as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({ adapter, mappings: [] });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(adapter.serialize).toHaveBeenCalled();
    expect(result.current.validationFields).toEqual([]);
  });

  it('handleFetchAndVerify mirrors fetchSampleData into the source when available', async () => {
    const fetchSampleData = vi.fn().mockResolvedValue({ ok: true });
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({}),
      deserialize: vi.fn().mockReturnValue([]),
      fetchTargetSchema: vi.fn(),
      fetchSampleData,
    } as unknown as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({
      adapter,
      handleFetchTargetSchema: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    await act(async () => {
      await result.current.handleFetchAndVerify();
    });

    expect(fetchSampleData).toHaveBeenCalled();
    expect(result.current.verifyEnabled).toBe(true);
    expect(result.current.autoVerifyEnabled).toBe(true);
  });

  it('handleFetchAndVerify ignores fetchSampleData failures', async () => {
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({}),
      deserialize: vi.fn().mockReturnValue([]),
      fetchTargetSchema: vi.fn(),
      fetchSampleData: vi.fn().mockRejectedValue(new Error('source down')),
    } as unknown as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({
      adapter,
      handleFetchTargetSchema: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    await act(async () => {
      await result.current.handleFetchAndVerify();
    });

    expect(result.current.verifyEnabled).toBe(true);
  });

  it('treats null expectedFields from serialize as an empty list', () => {
    const adapter = {
      ...makeDeps().adapter,
      serialize: vi.fn().mockReturnValue({ expectedFields: null }),
    } as DataMapperValidationDeps['adapter'];
    const deps = makeDeps({ adapter });
    const { result } = renderHook(() => useDataMapperValidation(deps));
    expect(result.current.validationFields).toEqual([]);
  });

  it('syncs empty assertions array when initialData omits assertions', () => {
    const onAssertionsChange = vi.fn();
    const deps = makeDeps({
      initialData: { other: true } as unknown,
      onAssertionsChange,
    });
    renderHook(() => useDataMapperValidation(deps));
    expect(onAssertionsChange).not.toHaveBeenCalled();
  });

  it('handleUpdateValidationFields skips mappings whose operator or negate no longer match', () => {
    const setMappings = vi.fn();
    const mapping: Mapping = {
      id: 'm1',
      sourcePath: 'status',
      targetPath: 'status',
      sourceId: 'src1',
      operator: 'equals',
      negate: true,
    };
    const deps = makeDeps({ mappings: [mapping], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([
        { jsonPath: 'status', operator: 'equals', negate: false },
      ]);
    });

    expect(setMappings).toHaveBeenCalledWith([
      expect.objectContaining({ id: expect.any(String), sourcePath: 'status' }),
    ]);
  });

  it('handleUpdateValidationFields matches mappings by sourcePath when targetPath differs', () => {
    const setMappings = vi.fn();
    const mapping: Mapping = {
      id: 'm1',
      sourcePath: '$.status',
      targetPath: 'statusAlias',
      sourceId: 'src1',
      operator: 'equals',
      operatorValue: 'old',
    };
    const deps = makeDeps({ mappings: [mapping], setMappings });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    act(() => {
      result.current.handleUpdateValidationFields([
        {
          jsonPath: '$.status',
          operator: 'equals',
          expectedValue: 'new',
        },
      ]);
    });

    expect(setMappings).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'm1',
        operatorValue: 'new',
      }),
    ]);
  });

  it('handleFetchAndVerify reports unknown error detail when rejection is not Error', async () => {
    const adapter = {
      label: 'test',
      contextId: 'ctx',
      sources: [{ id: 'src1', label: 'Source 1' }],
      target: { label: 'Target', allowCustomFields: false },
      serialize: vi.fn().mockReturnValue({}),
      deserialize: vi.fn().mockReturnValue([]),
      fetchTargetSchema: vi.fn(),
    } as unknown as DataMapperValidationDeps['adapter'];
    const setToast = vi.fn();
    const deps = makeDeps({
      adapter,
      handleFetchTargetSchema: vi.fn(() => Promise.reject('boom')),
      setToast,
    });
    const { result } = renderHook(() => useDataMapperValidation(deps));

    await act(async () => {
      await result.current.handleFetchAndVerify();
    });

    expect(setToast).toHaveBeenCalledWith('Fetch failed: unknown error');
  });
});
