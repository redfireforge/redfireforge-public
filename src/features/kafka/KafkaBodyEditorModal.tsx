import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SearchMatchBar } from '@shared/components/SearchMatchBar';
import { useSearchMatchNavigation } from '@shared/hooks/useSearchMatchNavigation';
import { useModalDrag } from '@shared/hooks/useModalDrag';
import { useModalResize } from '@shared/hooks/useModalResize';
import ModalResizeHandles from '@shared/components/ModalResizeHandles';
import { straightenJsonQuotes } from './kafkaMessageStudioUtils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  format: string;
}

export default function KafkaBodyEditorModal({ value, onChange, onClose, format }: Props) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const currentHitRef = useRef<HTMLElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const isJson = format === 'json' || !format;
  const formatLabel = (format || 'json').toUpperCase();

  // Drag & resize
  const { onDragStart, overlayStyle, modalStyle } = useModalDrag(true, {
    modalRef,
    constrainToViewport: true,
    viewportPadding: 12,
  });
  const { resizeStyle, onRightEdge, onCorner, onBottomEdge } = useModalResize(720, 520);

  const handlePretty = useCallback(() => {
    try {
      const parsed = JSON.parse(draft);
      setDraft(JSON.stringify(parsed, null, 2));
    } catch { /* leave as-is */ }
  }, [draft]);

  const handleMinify = useCallback(() => {
    try {
      const parsed = JSON.parse(draft);
      setDraft(JSON.stringify(parsed));
    } catch { /* leave as-is */ }
  }, [draft]);

  const handleSave = useCallback(() => {
    onChange(draft);
    onClose();
  }, [draft, onChange, onClose]);

  const validJson = useMemo(() => {
    if (!isJson) return true;
    try { JSON.parse(draft); return true; } catch { return false; }
  }, [draft, isJson]);

  const lineCount = useMemo(() => draft.split('\n').length, [draft]);
  const charCount = draft.length;

  // Search
  const [searchTerm, setSearchTermRaw] = useState('');
  const [revealToken, setRevealToken] = useState(0);

  const matches = useMemo(() => {
    const term = searchTerm.trim();
    if (!term) return [] as Array<{ start: number; end: number }>;
    try {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const found: Array<{ start: number; end: number }> = [];
      let hit = re.exec(draft);
      while (hit) {
        if (hit[0].length === 0) {
          re.lastIndex += 1;
        } else {
          found.push({ start: hit.index, end: hit.index + hit[0].length });
        }
        hit = re.exec(draft);
      }
      return found;
    } catch {
      return [];
    }
  }, [draft, searchTerm]);

  const matchCount = matches.length;

  const {
    currentMatchIndex,
    setCurrentMatchIndex,
    goNext,
    goPrev,
    clear: clearSearch,
  } = useSearchMatchNavigation(matchCount);

  const setSearchTerm = useCallback((v: string) => {
    setSearchTermRaw(v);
    setCurrentMatchIndex(0);
    setRevealToken((token) => token + 1);
    if (!v.trim()) clearSearch();
  }, [clearSearch, setCurrentMatchIndex]);

  const revealMatch = useCallback((delta: number) => {
    if (delta < 0) goPrev();
    else goNext();
    setRevealToken((token) => token + 1);
  }, [goNext, goPrev]);

  const syncEditorScroll = useCallback(() => {
    const area = textareaRef.current;
    if (!area) return;
    const top = area.scrollTop;
    const left = area.scrollLeft;
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-left}px, ${-top}px)`;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.style.transform = `translateY(${-top}px)`;
    }
  }, []);

  useEffect(() => {
    if (revealToken === 0) return;
    const area = textareaRef.current;
    const hit = currentHitRef.current;
    if (!area || !hit) return;
    const areaRect = area.getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    if (areaRect.height <= 0) return;
    const deltaY = hitRect.top - areaRect.top - (areaRect.height - hitRect.height) / 2;
    const deltaX = hitRect.left - areaRect.left - 48;
    const pastRight = hitRect.right > areaRect.right - 16;
    area.scrollTop += deltaY;
    if (deltaX < 0 || pastRight) area.scrollLeft += deltaX;
    syncEditorScroll();
  }, [revealToken, syncEditorScroll]);

  const highlightedBody = useMemo(() => {
    if (matches.length === 0) return draft;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    matches.forEach((hit, index) => {
      if (hit.start > cursor) parts.push(draft.slice(cursor, hit.start));
      const current = index === currentMatchIndex;
      parts.push(
        <mark
          key={`${hit.start}-${hit.end}`}
          ref={current ? currentHitRef : undefined}
          className={`kbe-search-hit${current ? ' is-current' : ''}`}
          data-testid={current ? 'kbe-search-current' : undefined}
        >
          {draft.slice(hit.start, hit.end)}
        </mark>,
      );
      cursor = hit.end;
    });
    if (cursor < draft.length) parts.push(draft.slice(cursor));
    return parts;
  }, [draft, matches, currentMatchIndex]);

  // Cmd+F to focus search
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const lineNumbers = useMemo(() => {
    const lines = draft.split('\n');
    return lines.map((_, i) => i + 1);
  }, [draft]);

  const combinedModalStyle: React.CSSProperties = {
    ...modalStyle,
    ...resizeStyle,
  };

  return createPortal(
    <div
      className="kbe-overlay"
      style={overlayStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="kbe-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Message Body Editor"
        data-testid="kafka-body-editor-modal"
        ref={modalRef}
        style={combinedModalStyle}
      >
        {/* Header — drag handle (no close icon; Cancel/Apply live in footer) */}
        <div className="kbe-header" onMouseDown={onDragStart}>
          <div className="kbe-header-left">
            <div className="kbe-title-row">
              <span className="kbe-title">Message body</span>
              <span className="kbe-format-pill">{formatLabel}</span>
              {isJson && (
                <span
                  className={`kbe-json-badge ${validJson ? 'kbe-json-badge--ok' : 'kbe-json-badge--err'}`}
                >
                  {validJson ? 'Valid JSON' : 'Invalid JSON'}
                </span>
              )}
            </div>
            <span className="kbe-stats">
              {lineCount.toLocaleString()} {lineCount === 1 ? 'line' : 'lines'}
              {' · '}
              {charCount.toLocaleString()} chars
            </span>
          </div>
          <div className="kbe-header-right" onMouseDown={(e) => e.stopPropagation()}>
            <SearchMatchBar
              value={searchTerm}
              onChange={setSearchTerm}
              currentMatch={matchCount > 0 ? currentMatchIndex + 1 : 0}
              totalMatches={matchCount}
              onPrev={() => revealMatch(-1)}
              onNext={() => revealMatch(1)}
              onClear={() => setSearchTerm('')}
              placeholder="Search body…"
              className="kbe-search"
              inputRef={searchInputRef}
              ariaLabel="Search body content"
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || matchCount === 0) return;
                event.preventDefault();
                revealMatch(event.shiftKey ? -1 : 1);
              }}
            />
          </div>
        </div>

        {/* Toolbar */}
        {isJson && (
          <div className="kbe-toolbar">
            <div className="kbe-toolbar-actions">
              <button
                type="button"
                className="kbe-action-btn"
                onClick={handlePretty}
                title="Pretty-print JSON"
              >
                Pretty
              </button>
              <button
                type="button"
                className="kbe-action-btn"
                onClick={handleMinify}
                title="Minify JSON"
              >
                Minify
              </button>
            </div>
            <span className="kbe-toolbar-hint">Drag the header to reposition</span>
          </div>
        )}

        {/* Editor */}
        <div className="kbe-body">
          <div className="kbe-editor-wrap">
            <div className="kbe-line-numbers" aria-hidden="true">
              <div ref={lineNumbersRef} className="kbe-line-numbers-inner">
                {lineNumbers.map((n) => (
                  <span key={n} className="kbe-line-num">{n}</span>
                ))}
              </div>
            </div>
            <div className={`kbe-editor-pane${matchCount > 0 ? ' is-searching' : ''}`}>
              <pre ref={highlightRef} className="kbe-highlight kbe-editor-text" aria-hidden="true">
                {highlightedBody}
              </pre>
              <textarea
                ref={textareaRef}
                className="kbe-textarea kbe-editor-text"
                value={draft}
                onChange={(e) => setDraft(isJson ? straightenJsonQuotes(e.target.value) : e.target.value)}
                onScroll={syncEditorScroll}
                spellCheck={false}
                autoFocus
                aria-label="Message body content"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="kbe-footer">
          <span className="kbe-footer-hint">⌘F search · Esc close</span>
          <div className="kbe-footer-actions">
            <button type="button" className="kbe-btn kbe-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="kbe-btn kbe-btn--primary" onClick={handleSave}>
              Apply
            </button>
          </div>
        </div>

        <ModalResizeHandles
          onRightEdge={onRightEdge}
          onCorner={onCorner}
          onBottomEdge={onBottomEdge}
        />
      </div>
    </div>,
    document.body,
  );
}
