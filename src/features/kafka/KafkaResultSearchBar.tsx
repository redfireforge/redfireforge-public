interface KafkaResultSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  idPrefix: string;
  placeholder?: string;
  ariaLabel?: string;
}

/** Filters messages already on screen. Clearing the box restores the full result. */
export function KafkaResultSearchBar({
  value,
  onChange,
  caseSensitive,
  onCaseSensitiveChange,
  idPrefix,
  placeholder = 'Search offset, key, value…',
  ariaLabel = 'Search returned messages',
}: KafkaResultSearchBarProps) {
  const active = value.trim().length > 0;
  return (
    <div className="kafka-ms-stream-search-wrap">
      <input
        type="search"
        className="kafka-ms-stream-search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`${idPrefix}-search-input`}
        aria-label={ariaLabel}
      />
      <div className="kmd-search-case" role="group" aria-label="Case matching">
        <button
          type="button"
          className={caseSensitive ? '' : 'is-active'}
          aria-pressed={!caseSensitive}
          onClick={() => onCaseSensitiveChange(false)}
          data-testid={`${idPrefix}-search-ignore-case`}
        >
          Ignore case
        </button>
        <button
          type="button"
          className={caseSensitive ? 'is-active' : ''}
          aria-pressed={caseSensitive}
          onClick={() => onCaseSensitiveChange(true)}
          data-testid={`${idPrefix}-search-match-case`}
        >
          Match case
        </button>
      </div>
      {active && (
        <button
          type="button"
          className="kafka-ms-stream-search-clear"
          onClick={() => onChange('')}
          data-testid={`${idPrefix}-search-clear`}
          aria-label="Clear search"
        >
          Clear
        </button>
      )}
    </div>
  );
}
