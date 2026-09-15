/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useJsonTreeCollapseState, useMatchCountChange } from './useJsonTreeCollapseState';

describe('useJsonTreeCollapseState', () => {
  it('toggles nodes, collapses all, and expands all', () => {
    const { result } = renderHook(() => useJsonTreeCollapseState());

    act(() => {
      result.current.handleTreeToggle('root.items[0]');
    });
    expect(result.current.collapsedSet.has('root.items[0]')).toBe(true);

    act(() => {
      result.current.handleTreeToggle('root.items[0]');
    });
    expect(result.current.collapsedSet.has('root.items[0]')).toBe(false);

    act(() => {
      result.current.handleCollapseAll(new Set(['a', 'b']));
    });
    expect([...result.current.collapsedSet]).toEqual(['a', 'b']);

    act(() => {
      result.current.handleExpandAll();
    });
    expect(result.current.collapsedSet.size).toBe(0);
  });

  it('tracks the sticky Expand all mode: on for expand-all, off for collapse-all, unchanged by a single toggle', () => {
    const { result } = renderHook(() => useJsonTreeCollapseState());
    expect(result.current.expandAllActive).toBe(false);

    act(() => { result.current.handleExpandAll(); });
    expect(result.current.expandAllActive).toBe(true);

    // A single node toggle keeps the sticky mode (the node just re-enters the collapsed set).
    act(() => { result.current.handleTreeToggle('a'); });
    expect(result.current.expandAllActive).toBe(true);

    act(() => { result.current.handleCollapseAll(new Set(['a', 'b'])); });
    expect(result.current.expandAllActive).toBe(false);
  });

  it('applies defaultCollapsed on the first render of a new documentKey and clears Expand all', () => {
    const firstDefaults = new Set(['/products/0']);
    const { result, rerender } = renderHook(
      ({ key, defaults }) => useJsonTreeCollapseState(key, defaults),
      { initialProps: { key: 'body-a', defaults: firstDefaults } },
    );

    expect(result.current.collapsedSet.has('/products/0')).toBe(true);

    act(() => { result.current.handleExpandAll(); });
    expect(result.current.expandAllActive).toBe(true);
    expect(result.current.collapsedSet.size).toBe(0);

    const secondDefaults = new Set(['/products/0', '/products/1']);
    rerender({ key: 'body-b', defaults: secondDefaults });

    expect(result.current.expandAllActive).toBe(false);
    expect(result.current.collapsedSet.has('/products/1')).toBe(true);
  });
});

describe('useMatchCountChange', () => {
  it('clamps the active match index when the count shrinks below the current index', () => {
    const setMatchCount = vi.fn();
    const setMatchIdx = vi.fn();
    const currentMatchIdxRef = { current: 5 } as React.RefObject<number>;

    const { result } = renderHook(() => useMatchCountChange(setMatchCount, setMatchIdx, currentMatchIdxRef));
    act(() => {
      result.current(3);
    });

    expect(setMatchCount).toHaveBeenCalledWith(3);
    expect(setMatchIdx).toHaveBeenCalledWith(2);
  });

  it('does not clamp when the current index is nullish or already in range', () => {
    const setMatchCount = vi.fn();
    const setMatchIdx = vi.fn();
    const currentMatchIdxRef = { current: null } as unknown as React.RefObject<number>;

    const { result, rerender } = renderHook(
      ({ refValue }) => useMatchCountChange(setMatchCount, setMatchIdx, refValue),
      { initialProps: { refValue: currentMatchIdxRef } },
    );

    act(() => {
      result.current(2);
    });
    expect(setMatchIdx).not.toHaveBeenCalled();

    const inRangeRef = { current: 1 } as React.RefObject<number>;
    rerender({ refValue: inRangeRef });
    act(() => {
      result.current(3);
    });
    expect(setMatchIdx).not.toHaveBeenCalled();
  });

  it('clamps to zero when count becomes zero', () => {
    const setMatchCount = vi.fn();
    const setMatchIdx = vi.fn();
    const currentMatchIdxRef = { current: 2 } as React.RefObject<number>;

    const { result } = renderHook(() =>
      useMatchCountChange(setMatchCount, setMatchIdx, currentMatchIdxRef),
    );

    act(() => {
      result.current(0);
    });

    expect(setMatchCount).toHaveBeenCalledWith(0);
    expect(setMatchIdx).toHaveBeenCalledWith(0);
  });
});