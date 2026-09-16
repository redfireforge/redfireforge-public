interface Props {
  /** Which run type the dashboard is filtered to; decides the wording and the destination. */
  runTypeFilter: 'all' | 'test' | 'workflow';
  /** Navigate to a top-level tab. Omitted when the host cannot navigate, which hides the CTA. */
  onNavigate?: (tab: 'runner' | 'workflow-runner') => void;
}

/**
 * Shown on the Results dashboard before anything has been run (issue #56).
 *
 * A heading + next-step line + tab CTA so the panel is not a blank area.
 */
export function ResultsEmptyState({ runTypeFilter, onNavigate }: Props) {
  const isWorkflow = runTypeFilter === 'workflow';
  const destination = isWorkflow ? 'workflow-runner' : 'runner';
  const subtitle = isWorkflow
    ? 'Run a workflow from the Workflow Runner to see results here.'
    : 'Run a test from the Test Runner or Parameterized Runner to see results here.';
  const action = isWorkflow ? 'Go to Workflow Runner' : 'Go to Test Runner';

  return (
    <div className="results-empty-state" data-testid="results-empty-state">
      <div className="results-empty-state-icon-ring" aria-hidden="true">
        <svg
          className="results-empty-state-icon"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </svg>
      </div>
      <h3 className="results-empty-state-message">No results yet</h3>
      <p className="results-empty-state-subtitle">{subtitle}</p>
      {onNavigate && (
        <button
          type="button"
          className="btn btn-primary results-empty-state-cta"
          onClick={() => onNavigate(destination)}
          data-testid="results-empty-state-cta"
        >
          {action}
        </button>
      )}
    </div>
  );
}
