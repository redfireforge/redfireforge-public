import { useMemo, useRef, useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';
import { ChevronIcon, bestEffortFormat, countTextMatches } from '@shared/components/jsonTreeShared';
import { buildJsonTree } from '@shared/utils/jsonTreeModel';
import type { JsonTreeNode } from '@shared/utils/jsonTreeModel';

/** @deprecated Use `JsonTreeNode` from `shared/utils/jsonTreeModel` */
export type JNode = JsonTreeNode;

// eslint-disable-next-line react-refresh/only-export-components
export function buildJTree(val: unknown, key: string): JNode {
  const node = buildJsonTree(val, key, '', { trackPaths: false });
  fixArrayKeys(node);
  return node;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildJTreeFromBody(body: string | null | undefined): JNode | null {
  if (!body) return null;
  try {
    return buildJTree(JSON.parse(body), '');
  } catch {
    return null;
  }
}

/**
 * Paths that should start collapsed so large API payloads do not mount every
 * nested row on first paint (the Requests "Sending..." spinner otherwise stays
 * up for seconds after the HTTP call has already finished).
 *
 * Keeps the root object open, collapses array items, nested objects (depth ≥ 2),
 * and large arrays (more than 24 elements).
 */
export const JSON_TREE_LARGE_ARRAY_COLLAPSE = 24;

// eslint-disable-next-line react-refresh/only-export-components
export function collectDefaultCollapsedPaths(node: JNode, prefix = '', depth = 0): string[] {
  const paths: string[] = [];
  const kids = node.children;
  if (!kids?.length) return paths;
  for (const child of kids) {
    const p = `${prefix}/${child.key}`;
    const childDepth = depth + 1;
    const childHasKids = (child.children?.length ?? 0) > 0;
    if (childHasKids) {
      const collapseNested = childDepth >= 2;
      const collapseArrayItem = node.type === 'array';
      const collapseLargeArray = child.type === 'array'
        && (child.children?.length ?? 0) > JSON_TREE_LARGE_ARRAY_COLLAPSE;
      if (collapseNested || collapseArrayItem || collapseLargeArray) {
        paths.push(p);
      }
      paths.push(...collectDefaultCollapsedPaths(child, p, childDepth));
    }
  }
  return paths;
}

/** The unified model uses `[i]` keys for array children; legacy JNode uses plain `"i"`. */
function fixArrayKeys(node: JNode): void {
  if (!node.children) return;
  if (node.type === 'array') {
    node.children.forEach((child, i) => { child.key = String(i); });
  }
  node.children.forEach(fixArrayKeys);
}

// eslint-disable-next-line react-refresh/only-export-components
export function collectJTreePaths(node: { key: string; children?: { key: string; children?: unknown[] }[] }, prefix: string): string[] {
  const paths: string[] = [];
  if (node.children) {
    for (const child of node.children) {
      const p = `${prefix}/${child.key}`;
      paths.push(p);
      paths.push(...collectJTreePaths(child as Parameters<typeof collectJTreePaths>[0], p));
    }
  }
  return paths;
}

// eslint-disable-next-line react-refresh/only-export-components
export function nodeMatches(node: JNode, term: string): boolean {
  if (!term) return false;
  const lower = term.toLowerCase();
  if (node.key.toLowerCase().includes(lower)) return true;
  if (node.type !== 'object' && node.type !== 'array' && String(node.value ?? '').toLowerCase().includes(lower)) return true;
  return (node.children ?? []).some(c => nodeMatches(c, term));
}

// eslint-disable-next-line react-refresh/only-export-components
export function collectMatchNodes(node: JNode, term: string, results: JNode[]): void {
  if (!term) return;
  const lower = term.toLowerCase();
  const selfMatch = node.key.toLowerCase().includes(lower) ||
    (node.type !== 'object' && node.type !== 'array' && String(node.value ?? '').toLowerCase().includes(lower));
  if (selfMatch) results.push(node);
  (node.children ?? []).forEach(c => collectMatchNodes(c, term, results));
}

/** Like collectMatchNodes but also records each match's tree path (for ancestor expansion). */
function collectMatchNodesWithPaths(
  node: JNode, term: string, results: { node: JNode; path: string }[], currentPath = '',
): void {
  if (!term) return;
  const lower = term.toLowerCase();
  const selfMatch = node.key.toLowerCase().includes(lower) ||
    (node.type !== 'object' && node.type !== 'array' && String(node.value ?? '').toLowerCase().includes(lower));
  if (selfMatch) results.push({ node, path: currentPath });
  (node.children ?? []).forEach(c =>
    collectMatchNodesWithPaths(c, term, results, `${currentPath}/${c.key}`),
  );
}

/** Compute all ancestor paths for a given tree path (e.g. "/a/b/c" → {"", "/a", "/a/b", "/a/b/c"}). */
function getAncestorPaths(path: string): Set<string> {
  const set = new Set<string>();
  const segments = path.split('/');
  let p = '';
  set.add(p); // root
  for (let i = 1; i < segments.length; i++) {
    p += '/' + segments[i];
    set.add(p);
  }
  return set;
}

function highlightSearch(text: string, search: string): ReactNode {
  if (!search) return text;
  const lower = text.toLowerCase();
  const term = search.toLowerCase();
  const parts: ReactNode[] = [];
  let last = 0;
  let idx = lower.indexOf(term, last);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(<mark key={idx} className="req-search-highlight">{text.slice(idx, idx + search.length)}</mark>);
    last = idx + search.length;
    idx = lower.indexOf(term, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? <>{parts}</> : text;
}

function JsonTreeNode({ node, depth, search, activeMatchNode, activeMatchRef, collapsedSet, onToggle, path, forceExpandAll }: {
  node: JNode; depth: number; search: string;
  activeMatchNode: JNode | null; activeMatchRef: RefObject<HTMLDivElement | null>;
  collapsedSet: Set<string>; onToggle: (path: string) => void; path: string;
  forceExpandAll?: boolean;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const hasMatchDescendant = useMemo(() => search ? nodeMatches(node, search) : false, [node, search]);

  // User's explicit collapse (collapsedSet) always wins.
  // When search is active, auto-expand nodes with matching descendants — unless
  // Expand all is in effect (forceExpandAll), in which case every node stays open
  // so the user can browse the whole document while a search is highlighted.
  const expanded = !collapsedSet.has(path) && (forceExpandAll || !search || hasMatchDescendant);

  const lower = search?.toLowerCase() ?? '';
  const keyMatch = lower && node.key.toLowerCase().includes(lower);
  const valStr = node.type !== 'object' && node.type !== 'array' ? String(node.value ?? '') : '';
  const valMatch = lower && valStr.toLowerCase().includes(lower);
  const isSelfMatch = keyMatch || valMatch;
  const isActiveMatch = activeMatchNode === node;

  const renderValue = () => {
    if (node.type === 'object') {
      if (!hasChildren) return <span className="jt-bracket">{'{}'}</span>;
      return <span className="jt-bracket">{expanded ? '{' : `{ ${node.children!.length} }`}</span>;
    }
    if (node.type === 'array') {
      if (!hasChildren) return <span className="jt-bracket">{'[]'}</span>;
      return <span className="jt-bracket">{expanded ? '[' : `[ ${node.children!.length} ]`}</span>;
    }
    if (node.type === 'string') {
      const txt = `"${node.value}"`;
      return <span className="jt-str">{search ? highlightSearch(txt, search) : txt}</span>;
    }
    if (node.type === 'number') return <span className="jt-num">{search ? highlightSearch(valStr, search) : valStr}</span>;
    if (node.type === 'boolean') return <span className="jt-bool">{valStr}</span>;
    return <span className="jt-null">null</span>;
  };

  const closingBracket = hasChildren && expanded ? (node.type === 'array' ? ']' : '}') : null;

  return (
    <div>
      <div
        ref={isActiveMatch ? activeMatchRef : undefined}
        className={`jt-row ${isActiveMatch ? 'jt-active-match' : isSelfMatch ? 'jt-match' : ''}`}
        style={{ paddingLeft: depth * 18 }}
      >
        {hasChildren ? (
          <span className={`jt-toggle ${expanded ? '' : 'jt-toggle--collapsed'}`} onClick={() => onToggle(path)}>
            <ChevronIcon />
          </span>
        ) : (
          <span className="jt-toggle-spacer" />
        )}
        {depth > 0 && (
          <span className={`jt-key ${keyMatch ? 'jt-key-match' : ''}`}>
            {search ? highlightSearch(`"${node.key}"`, search) : `"${node.key}"`}
          </span>
        )}
        {depth > 0 && <span className="jt-colon">: </span>}
        {renderValue()}
        {!hasChildren && depth > 0 && <span className="jt-comma">,</span>}
      </div>
      {hasChildren && expanded && (
        <div className="jt-children">
          {node.children!.map((child, i) => (
            <JsonTreeNode key={`${child.key}-${i}`} node={child} depth={depth + 1}
              search={search} activeMatchNode={activeMatchNode} activeMatchRef={activeMatchRef}
              collapsedSet={collapsedSet} onToggle={onToggle} path={`${path}/${child.key}`}
              forceExpandAll={forceExpandAll} />
          ))}
          <div className="jt-row" style={{ paddingLeft: depth * 18 }}>
            <span className="jt-toggle-spacer" />
            <span className="jt-bracket">{closingBracket}</span>
            <span className="jt-comma">,</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders best-effort-formatted raw body with text search + match highlighting.
 * Used when the response body is truncated/malformed JSON that cannot be parsed into a tree.
 */
function RawBodyWithSearch({ body, search, currentMatchIdx = 0, onMatchCountChange }: {
  body: string;
  search?: string;
  currentMatchIdx?: number;
  onMatchCountChange?: (count: number) => void;
}) {
  const formatted = useMemo(() => bestEffortFormat(body), [body]);
  const activeRef = useRef<HTMLElement>(null);

  const matchCount = useMemo(() => countTextMatches(formatted, search ?? ''), [formatted, search]);

  useEffect(() => {
    onMatchCountChange?.(matchCount);
  }, [matchCount, onMatchCountChange]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentMatchIdx, search]);

  const highlighted = useMemo((): ReactNode => {
    if (!search) return formatted;
    const lower = formatted.toLowerCase();
    const term = search.toLowerCase();
    const parts: ReactNode[] = [];
    let last = 0;
    let idx = lower.indexOf(term, last);
    let matchNum = 0;
    while (idx !== -1) {
      if (idx > last) parts.push(formatted.slice(last, idx));
      const isActive = matchNum === currentMatchIdx;
      parts.push(
        <mark
          key={idx}
          ref={isActive ? activeRef : undefined}
          className={isActive ? 'req-search-highlight jt-active-match' : 'req-search-highlight'}
        >
          {formatted.slice(idx, idx + search.length)}
        </mark>,
      );
      matchNum++;
      last = idx + search.length;
      idx = lower.indexOf(term, last);
    }
    if (last < formatted.length) parts.push(formatted.slice(last));
    return <>{parts}</>;
  }, [formatted, search, currentMatchIdx]);

  return (
    <div className="req-json-preview-wrapper">
      <pre className="jt-raw jt-raw-formatted">{highlighted}</pre>
    </div>
  );
}

export default function JsonPreview({ body, error, search, currentMatchIdx = 0, onMatchCountChange, collapsedSet, onToggle, prebuiltTree, forceExpandAll }: {
  body: string; error?: string; search?: string;
  currentMatchIdx?: number;
  onMatchCountChange?: (count: number) => void;
  collapsedSet: Set<string>; onToggle: (path: string) => void;
  prebuiltTree?: JNode | null;
  /** When true, Expand all overrides the search-focus auto-collapse so every node stays open. */
  forceExpandAll?: boolean;
}) {
  const activeMatchRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => {
    if (prebuiltTree !== undefined) return prebuiltTree;
    if (error || !body) return null;
    return buildJTreeFromBody(body);
  }, [body, error, prebuiltTree]);

  const matchNodesWithPaths = useMemo(() => {
    if (!tree || !search) return [];
    const results: { node: JNode; path: string }[] = [];
    collectMatchNodesWithPaths(tree, search, results);
    return results;
  }, [tree, search]);

  const matchNodes = useMemo(() => matchNodesWithPaths.map(m => m.node), [matchNodesWithPaths]);

  useEffect(() => {
    onMatchCountChange?.(matchNodes.length);
  }, [matchNodes.length, onMatchCountChange]);

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentMatchIdx, search]);

  // When navigating to a match, uncollapse its ancestor paths so it becomes visible
  useEffect(() => {
    const active = matchNodesWithPaths[currentMatchIdx];
    if (!active) return;
    const ancestors = getAncestorPaths(active.path);
    ancestors.forEach(p => {
      if (collapsedSet.has(p)) onToggle(p);
    });
  }, [currentMatchIdx, matchNodesWithPaths]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeNode = matchNodes[currentMatchIdx] ?? null;

  if (error) return <div className="req-json-preview-wrapper"><pre className="jt-error">{error}</pre></div>;
  if (!body) return <div className="req-json-preview-wrapper"><pre className="jt-error">(empty response)</pre></div>;
  if (!tree) {
    return (
      <RawBodyWithSearch
        body={body}
        search={search}
        currentMatchIdx={currentMatchIdx}
        onMatchCountChange={onMatchCountChange}
      />
    );
  }

  return (
    <div className="req-json-preview-wrapper" data-testid="req-json-preview">
      <div className="jt-tree">
        <JsonTreeNode node={tree} depth={0} search={search ?? ''}
          activeMatchNode={activeNode} activeMatchRef={activeMatchRef}
          collapsedSet={collapsedSet} onToggle={onToggle} path=""
          forceExpandAll={forceExpandAll} />
      </div>
    </div>
  );
}
