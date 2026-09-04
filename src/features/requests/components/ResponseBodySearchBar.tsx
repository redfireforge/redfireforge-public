import { useCopyToClipboard } from '@shared/hooks/useCopyToClipboard';
import { SearchMatchBar } from '@shared/components/SearchMatchBar';

interface Props {
  value: string;
  onChange: (v: string) => void;
  currentMatch: number;
  totalMatches: number;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Raw response text to copy. Omitted or empty hides the copy button. */
  copyText?: string;
}

const COPIED_RESET_MS = 1500;

/**
 * Response body search + expand/collapse toolbar used in RequestEditor
 * and ResponseDetailModal JSON preview sections.
 */
export default function ResponseBodySearchBar({
  value, onChange,
  currentMatch, totalMatches,
  onPrev, onNext, onClear,
  onExpandAll, onCollapseAll,
  copyText,
}: Props) {
  const [copied, copyToClipboard] = useCopyToClipboard(COPIED_RESET_MS);

  return (
    <div className="req-resp-search" data-testid="req-resp-search">
      <SearchMatchBar
        value={value}
        onChange={onChange}
        currentMatch={currentMatch}
        totalMatches={totalMatches}
        onPrev={onPrev}
        onNext={onNext}
        onClear={onClear}
        placeholder="Search response..."
        inputClassName="req-resp-search-input"
        countClassName="req-resp-search-count"
        navClassName="req-resp-search-nav"
        clearClassName="req-resp-search-clear"
      />
      <button className="jt-expand-collapse-btn" onClick={onExpandAll} data-testid="req-resp-expand-all">Expand All</button>
      <button className="jt-expand-collapse-btn" onClick={onCollapseAll} data-testid="req-resp-collapse-all">Collapse All</button>
      {copyText ? (
        <button
          type="button"
          className="jt-expand-collapse-btn"
          onClick={() => { void copyToClipboard(copyText); }}
          data-testid="response-copy-btn"
          // The label changes with the state, so a screen reader hears the
          // confirmation the sighted flash gives.
          aria-label={copied ? 'Response body copied' : 'Copy response body'}
          title={copied ? 'Copied!' : 'Copy response'}
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
          <span className="req-resp-copy-label">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      ) : null}
    </div>
  );
}
