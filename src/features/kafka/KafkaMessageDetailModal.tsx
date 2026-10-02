import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalDrag } from '@shared/hooks/useModalDrag';
import { useModalResize } from '@shared/hooks/useModalResize';
import ModalResizeHandles from '@shared/components/ModalResizeHandles';
import type { KafkaConsumeResultRow } from './types';
import { parseKafkaTimestamp, formatKafkaDateTime, formatTimestampTooltip } from './kafkaTimestamp';

interface BodyMatch {
  start: number;
  end: number;
}

function findBodyMatches(text: string, query: string, caseSensitive: boolean): BodyMatch[] {
  const raw = query.trim();
  if (!raw) return [];
  const needle = caseSensitive ? raw : raw.toLowerCase();
  const haystack = caseSensitive ? text : text.toLowerCase();
  const matches: BodyMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    matches.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return matches;
}

interface KafkaMessageDetailModalProps {
  message: KafkaConsumeResultRow;
  onClose: () => void;
  onUseAsWorkflowInput?: () => void;
}

export default function KafkaMessageDetailModal({
  message,
  onClose,
  onUseAsWorkflowInput,
}: KafkaMessageDetailModalProps) {
  const [copied, setCopied] = useState<'key' | 'payload' | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [keyOpen, setKeyOpen] = useState(true);
  const [headersOpen, setHeadersOpen] = useState(true);
  const [bodyQuery, setBodyQuery] = useState('');
  const [bodyCaseSensitive, setBodyCaseSensitive] = useState(false);
  const [bodyMatchIndex, setBodyMatchIndex] = useState(0);
  const bodySearchRef = useRef<HTMLInputElement>(null);
  const currentHitRef = useRef<HTMLElement | null>(null);

  const { onDragStart, modalStyle, overlayStyle } = useModalDrag(true);
  const { resizeStyle, onRightEdge, onCorner, onBottomEdge } = useModalResize(420, 300);

  const combinedModalStyle: React.CSSProperties = {
    ...modalStyle,
    ...resizeStyle,
  };

  const prettyValue = useMemo(() => {
    try { return JSON.stringify(JSON.parse(message.value), null, 2); }
    catch { return message.value; }
  }, [message.value]);

  const bodyMatches = useMemo(
    () => findBodyMatches(prettyValue, bodyQuery, bodyCaseSensitive),
    [prettyValue, bodyQuery, bodyCaseSensitive],
  );
  const activeMatch = bodyMatches.length === 0 ? 0 : bodyMatchIndex % bodyMatches.length;

  useEffect(() => {
    currentHitRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeMatch, bodyMatches.length, bodyQuery]);

  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        bodySearchRef.current?.focus();
        bodySearchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onFind);
    return () => document.removeEventListener('keydown', onFind);
  }, []);

  const headers = message.headers && Object.keys(message.headers).length > 0
    ? Object.entries(message.headers)
    : null;

  const tsDate = parseKafkaTimestamp(message.timestamp);
  const tsFormatted = tsDate ? formatKafkaDateTime(tsDate) : '—';
  const tsTooltip = tsDate ? formatTimestampTooltip(tsDate) : undefined;

  const handleCopyKey = useCallback(() => {
    if (message.key) {
      void navigator.clipboard.writeText(message.key);
      setCopied('key');
      setTimeout(() => setCopied(null), 1500);
    }
  }, [message.key]);

  const handleCopyPayload = useCallback(() => {
    void navigator.clipboard.writeText(prettyValue);
    setCopied('payload');
    setTimeout(() => setCopied(null), 1500);
  }, [prettyValue]);

  const showBodyMatch = useCallback((delta: number) => {
    if (bodyMatches.length === 0) return;
    setBodyMatchIndex((index) => (index + delta + bodyMatches.length) % bodyMatches.length);
  }, [bodyMatches.length]);

  const handleBodyQuery = useCallback((value: string) => {
    setBodyQuery(value);
    setBodyMatchIndex(0);
  }, []);

  const handleBodyCase = useCallback((caseSensitive: boolean) => {
    setBodyCaseSensitive(caseSensitive);
    setBodyMatchIndex(0);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const bodyContent = useMemo(() => {
    if (bodyMatches.length === 0) return prettyValue;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    bodyMatches.forEach((hit, index) => {
      if (hit.start > cursor) parts.push(prettyValue.slice(cursor, hit.start));
      const current = index === activeMatch;
      parts.push(
        <mark
          key={`${hit.start}-${hit.end}`}
          ref={current ? currentHitRef : undefined}
          className={`kmd-search-hit${current ? ' is-current' : ''}`}
          data-testid={current ? 'kmd-body-search-current' : undefined}
        >
          {prettyValue.slice(hit.start, hit.end)}
        </mark>,
      );
      cursor = hit.end;
    });
    if (cursor < prettyValue.length) parts.push(prettyValue.slice(cursor));
    return parts;
  }, [prettyValue, bodyMatches, activeMatch]);

  return createPortal(
    <div
      className="kmd-overlay"
      style={overlayStyle}
      onKeyDown={handleKeyDown}
    >
      <div
        className="kmd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Message Detail"
        data-testid="kafka-message-detail-modal"
        style={combinedModalStyle}
      >
        {/* ── Header (drag handle) ── */}
        <div className="kmd-header" onMouseDown={onDragStart}>
          <div className="kmd-header-left">
            <span className="kmd-title">Message Detail</span>
            <span className="kmd-subtitle">
              Partition {message.partition}
              <span aria-hidden="true"> · </span>
              Offset {message.offset}
            </span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="kmd-body">
          {/* Metadata grid */}
          <div className={`kmd-section${detailsOpen ? '' : ' is-collapsed'}`}>
            <div className="kmd-section-header">
              <button
                type="button"
                className="kmd-section-toggle"
                aria-expanded={detailsOpen}
                aria-controls="kmd-details-panel"
                data-testid="kmd-toggle-details"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                <span className={`kmd-chevron${detailsOpen ? ' is-open' : ''}`} aria-hidden="true" />
                <span className="kmd-section-title">Details</span>
              </button>
            </div>
            {detailsOpen && (
              <div className="kmd-meta-grid" id="kmd-details-panel">
                <div className="kmd-meta-item">
                  <span className="kmd-meta-label">Offset</span>
                  <span className="kmd-meta-value" data-testid="kmd-offset">{message.offset}</span>
                </div>
                <div className="kmd-meta-item">
                  <span className="kmd-meta-label">Partition</span>
                  <span className="kmd-meta-value" data-testid="kmd-partition">{message.partition}</span>
                </div>
                <div className="kmd-meta-item">
                  <span className="kmd-meta-label">Timestamp</span>
                  <span className="kmd-meta-value" data-testid="kmd-timestamp" title={tsTooltip}>
                    {tsFormatted}
                  </span>
                </div>
                <div className="kmd-meta-item">
                  <span className="kmd-meta-label">Topic</span>
                  <span className="kmd-meta-value kmd-meta-mono" data-testid="kmd-topic">{message.topic}</span>
                </div>
              </div>
            )}
          </div>

          {/* Key */}
          <div className={`kmd-section${keyOpen ? '' : ' is-collapsed'}`}>
            <div className="kmd-section-header">
              <button
                type="button"
                className="kmd-section-toggle"
                aria-expanded={keyOpen}
                aria-controls="kmd-key-panel"
                data-testid="kmd-toggle-key"
                onClick={() => setKeyOpen((open) => !open)}
              >
                <span className={`kmd-chevron${keyOpen ? ' is-open' : ''}`} aria-hidden="true" />
                <span className="kmd-section-title">Key</span>
              </button>
              <button
                className="kmd-copy-btn"
                onClick={handleCopyKey}
                disabled={!message.key}
                data-testid="kmd-copy-key"
              >
                {copied === 'key' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            {keyOpen && (
              <pre className="kmd-pre kmd-pre--key" id="kmd-key-panel" data-testid="kmd-key">
                {message.key ?? '—'}
              </pre>
            )}
          </div>

          {/* Headers */}
          {headers && (
            <div className={`kmd-section kmd-section--headers${headersOpen ? '' : ' is-collapsed'}`}>
              <div className="kmd-section-header">
                <button
                  type="button"
                  className="kmd-section-toggle"
                  aria-expanded={headersOpen}
                  aria-controls="kmd-headers-panel"
                  data-testid="kmd-toggle-headers"
                  onClick={() => setHeadersOpen((open) => !open)}
                >
                  <span className={`kmd-chevron${headersOpen ? ' is-open' : ''}`} aria-hidden="true" />
                  <span className="kmd-section-title">
                    Headers <span className="kmd-badge">{headers.length}</span>
                  </span>
                </button>
              </div>
              {headersOpen && (
                <div className="kmd-headers-scroll" id="kmd-headers-panel">
                  <table className="kmd-headers-table" data-testid="kmd-headers">
                    <thead>
                      <tr><th>Key</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      {headers.map(([k, v]) => (
                        <tr key={k}><td className="kmd-header-key">{k}</td><td>{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Message Body */}
          <div className="kmd-section kmd-section--body">
            <div className="kmd-section-header">
              <span className="kmd-section-title">Message Body</span>
              <button
                className="kmd-copy-btn"
                onClick={handleCopyPayload}
                data-testid="kmd-copy-payload"
              >
                {copied === 'payload' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="kmd-search-bar">
              <input
                ref={bodySearchRef}
                className="kmd-search-input"
                type="text"
                placeholder="Search body"
                aria-label="Search message body"
                value={bodyQuery}
                onChange={(event) => handleBodyQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    if (bodyQuery) {
                      event.preventDefault();
                      event.stopPropagation();
                      handleBodyQuery('');
                    }
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    showBodyMatch(event.shiftKey ? -1 : 1);
                  }
                }}
                data-testid="kmd-body-search"
              />
              <div className="kmd-search-case" role="group" aria-label="Case matching">
                <button
                  type="button"
                  className={bodyCaseSensitive ? '' : 'is-active'}
                  aria-pressed={!bodyCaseSensitive}
                  onClick={() => handleBodyCase(false)}
                  data-testid="kmd-body-search-ignore-case"
                >
                  Ignore case
                </button>
                <button
                  type="button"
                  className={bodyCaseSensitive ? 'is-active' : ''}
                  aria-pressed={bodyCaseSensitive}
                  onClick={() => handleBodyCase(true)}
                  data-testid="kmd-body-search-match-case"
                >
                  Match case
                </button>
              </div>
              {bodyQuery.trim() && (
                <span className="kmd-search-count" data-testid="kmd-body-search-count">
                  {bodyMatches.length > 0 ? `${activeMatch + 1}/${bodyMatches.length}` : 'No matches'}
                </span>
              )}
              <button
                type="button"
                className="kmd-search-nav"
                onClick={() => showBodyMatch(-1)}
                disabled={bodyMatches.length === 0}
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
                data-testid="kmd-body-search-prev"
              >
                ▲
              </button>
              <button
                type="button"
                className="kmd-search-nav"
                onClick={() => showBodyMatch(1)}
                disabled={bodyMatches.length === 0}
                title="Next match (Enter)"
                aria-label="Next match"
                data-testid="kmd-body-search-next"
              >
                ▼
              </button>
            </div>
            <pre className="kmd-pre kmd-pre--body" data-testid="kmd-body">
              {bodyContent}
            </pre>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="kmd-footer">
          {onUseAsWorkflowInput && (
            <button
              className="kmd-workflow-btn"
              onClick={onUseAsWorkflowInput}
              data-testid="kmd-workflow-btn"
            >
              Use as Workflow Input
            </button>
          )}
          <button
            className="kmd-close-btn"
            onClick={onClose}
            data-testid="kmd-close-btn"
          >
            Close
          </button>
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
