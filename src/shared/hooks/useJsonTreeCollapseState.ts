import { useState, useCallback, useRef, useLayoutEffect } from 'react';

/**
 * Shared hook for JSON tree expand/collapse state.
 * Encapsulates the repeated collapsedSet state + toggle + collapse-all / expand-all
 * pattern used across request, response, and workflow response body components.
 *
 * Pass `documentKey` + `defaultCollapsed` so a new payload (Send, history restore)
 * applies a shallow default collapse on the *first* render — before React mounts
 * thousands of expanded tree nodes.
 */
export function useJsonTreeCollapseState(
  documentKey?: string | null,
  defaultCollapsed?: Set<string>,
) {
  const [collapseKey, setCollapseKey] = useState<string | null | undefined>(documentKey);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(() => defaultCollapsed ?? new Set());
  // Sticky "Expand all" intent. While active it overrides the search-focus
  // auto-collapse (which otherwise keeps only match branches open), so
  // Expand all actually expands every node even during a live search.
  // Cleared by Collapse all; a single collapse toggle just re-adds that node.
  const [expandAllActive, setExpandAllActive] = useState(false);

  const isStaleDocument = documentKey !== undefined && documentKey !== collapseKey;
  const effectiveCollapsed = isStaleDocument
    ? (defaultCollapsed ?? new Set())
    : collapsedSet;
  const effectiveExpandAll = isStaleDocument ? false : expandAllActive;

  useLayoutEffect(() => {
    if (documentKey === undefined) return;
    if (documentKey === collapseKey) return;
    setCollapseKey(documentKey);
    setExpandAllActive(false);
    setCollapsedSet(defaultCollapsed ?? new Set());
  }, [documentKey, defaultCollapsed, collapseKey]);

  const handleTreeToggle = useCallback((path: string) => {
    setCollapsedSet(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleCollapseAll = useCallback((paths: Set<string>) => {
    setExpandAllActive(false);
    setCollapsedSet(paths);
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandAllActive(true);
    setCollapsedSet(new Set());
  }, []);

  return {
    collapsedSet: effectiveCollapsed,
    expandAllActive: effectiveExpandAll,
    handleTreeToggle,
    handleCollapseAll,
    handleExpandAll,
  };
}

/**
 * Builds a ref-stable handleMatchCountChange callback that clamps the active
 * match index when the number of matches shrinks (e.g. on search term change).
 *
 * Returns a memoized handler that safely clamps via a ref, avoiding stale closure issues.
 */
export function useMatchCountChange(
  setMatchCount: (n: number) => void,
  setMatchIdx: (i: number) => void,
  currentMatchIdxRef: React.RefObject<number>,
): (count: number) => void {
  return useCallback((count: number) => {
    setMatchCount(count);
    if ((currentMatchIdxRef.current ?? 0) >= count) {
      setMatchIdx(Math.max(0, count - 1));
    }
  }, [setMatchCount, setMatchIdx, currentMatchIdxRef]);
}

export { useRef };
