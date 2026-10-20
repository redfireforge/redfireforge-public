import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useJsonTreeCollapseState, useMatchCountChange } from '@shared/hooks/useJsonTreeCollapseState';
import JsonPreview, {
  buildJTreeFromBody,
  collectJTreePaths,
  defaultCollapsedPathsForPreview,
} from '../../requests/components/JsonTreePreview';
import ResponseBodySearchBar from '../../requests/components/ResponseBodySearchBar';

interface Props {
  json: string;
  /** Try it out can switch to a text editor. The example view stays on the tree. */
  editable?: boolean;
  onChange?: (value: string) => void;
}

const MIN_BODY_HEIGHT = 160;
const DEFAULT_BODY_HEIGHT = 280;

function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/**
 * Catalog request body as the same collapsible JSON tree used by response preview:
 * search, expand, collapse, and copy. Try it out can still edit the text.
 */
export default function CatalogRequestBodyView({ json, editable = false, onChange }: Props) {
  const tree = useMemo(() => buildJTreeFromBody(json), [json]);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [matchIdx, setMatchIdx] = useState(0);
  const matchIdxRef = useRef(0);
  matchIdxRef.current = matchIdx;
  const handleMatchCountChange = useMatchCountChange(setMatchCount, setMatchIdx, matchIdxRef);

  const defaultCollapsed = useMemo(
    () => (tree ? new Set(defaultCollapsedPathsForPreview(tree, json.length)) : new Set<string>()),
    [tree, json],
  );
  const {
    collapsedSet, expandAllActive, handleTreeToggle, handleCollapseAll, handleExpandAll,
  } = useJsonTreeCollapseState(json, defaultCollapsed);

  const showEditor = editable && (editing || !tree);
  const copyText = json.trim() ? prettyJson(json) : undefined;
  const [height, setHeight] = useState(DEFAULT_BODY_HEIGHT);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  function onResizePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is missing in some test environments. Drag still follows move events.
    }
    dragRef.current = { y: e.clientY, h: height };
  }
  function onResizePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setHeight(Math.max(MIN_BODY_HEIGHT, drag.h + (e.clientY - drag.y)));
  }
  function onResizePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div className="sw-request-json-frame" data-testid="catalog-request-body-json" style={{ height }}>
      <div className="sw-request-json">
        {showEditor ? (
          <>
            <div className="sw-request-json-editbar">
              <button
                type="button"
                className="jt-expand-collapse-btn"
                data-testid="catalog-body-preview"
                disabled={!tree}
                onClick={() => setEditing(false)}
              >
                Preview
              </button>
            </div>
            <textarea
              className="sw-body-editor"
              data-testid="catalog-body-editor"
              rows={12}
              value={json}
              onChange={e => onChange?.(e.target.value)}
              spellCheck={false}
            />
          </>
        ) : (
          <>
            <ResponseBodySearchBar
              value={search}
              onChange={setSearch}
              currentMatch={matchCount === 0 ? 0 : matchIdx + 1}
              totalMatches={matchCount}
              onPrev={() => setMatchIdx(i => (i - 1 + matchCount) % matchCount)}
              onNext={() => setMatchIdx(i => (i + 1) % matchCount)}
              onClear={() => { setSearch(''); setMatchCount(0); setMatchIdx(0); }}
              onExpandAll={handleExpandAll}
              onCollapseAll={() => {
                if (!tree) return;
                handleCollapseAll(new Set(['', ...collectJTreePaths(tree, '')]));
              }}
              copyText={copyText}
              placeholder="Search request body..."
              copyAriaLabel="Copy request body"
              copiedAriaLabel="Request body copied"
              copyTitle="Copy request body"
              trailing={editable ? (
                <button
                  type="button"
                  className="jt-expand-collapse-btn"
                  data-testid="catalog-body-edit"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </button>
              ) : undefined}
            />
            <JsonPreview
              body={json}
              search={search}
              collapsedSet={collapsedSet}
              onToggle={handleTreeToggle}
              prebuiltTree={tree}
              forceExpandAll={expandAllActive}
              currentMatchIdx={matchIdx}
              onMatchCountChange={handleMatchCountChange}
            />
          </>
        )}
      </div>
      <button
        type="button"
        className="sw-request-json-resize"
        data-testid="catalog-body-resize"
        aria-label="Resize request body"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
    </div>
  );
}
