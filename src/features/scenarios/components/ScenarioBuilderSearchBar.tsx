export function ScenarioBuilderSearchBar({
  searchQuery,
  onSearchQueryChange,
  showSearchHelp,
  onToggleSearchHelp,
  isSearching,
  matchCount,
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  showSearchHelp: boolean;
  onToggleSearchHelp: () => void;
  isSearching: boolean;
  matchCount: number;
}) {
  return (
    <div className="builder-search-wrapper">
      <div className="builder-search-bar">
        <input
          className="builder-search-input"
          type="text"
          placeholder='Search tests, URLs, methods, tags...'
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
        {isSearching && (
          <>
            <span className="builder-search-count">{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>
            <button className="btn btn-xs btn-ghost" onClick={() => onSearchQueryChange('')}>Clear</button>
          </>
        )}
        <button
          type="button"
          className="btn btn-xs btn-ghost"
          onClick={onToggleSearchHelp}
          title="Search syntax help"
          data-testid="har-search-help-btn"
        >
          ?
        </button>
      </div>
      {showSearchHelp && (
        <div className="search-help">
          <table className="search-help-table">
            <tbody>
              <tr><td><code>trial</code></td><td>Substring match (case-insensitive)</td></tr>
              <tr><td><code>"Connected Trial"</code></td><td>Exact phrase (word boundary)</td></tr>
              <tr><td><code>trial AND US</code></td><td>Both terms must match</td></tr>
              <tr><td><code>trial OR spike</code></td><td>Either term matches</td></tr>
              <tr><td><code>NOT CA</code> or <code>-CA</code></td><td>Exclude term</td></tr>
              <tr><td><code>(US OR CA) AND trial</code></td><td>Group with parentheses</td></tr>
              <tr><td><code>onboard US -FL</code></td><td>Implicit AND between terms</td></tr>
            </tbody>
          </table>
          <div className="search-help-fields">Searches: name, URL, method, headers, body, auth, validation rules &amp; expected values</div>
        </div>
      )}
    </div>
  );
}
