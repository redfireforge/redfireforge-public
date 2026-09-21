import {
  REQUEST_CANCELLED_LEAD,
  REQUEST_CANCELLED_MESSAGE,
  parseCancelledPreviewFacts,
} from '../utils/requestCancelSummary';

export default function RequestCancelledPreview({ error }: { error: string }) {
  const facts = parseCancelledPreviewFacts(error);

  return (
    <div className="req-cancelled-preview" data-testid="req-cancelled-preview">
      <div className="req-cancelled-preview-title">{REQUEST_CANCELLED_MESSAGE}</div>
      <p className="req-cancelled-preview-lead">{REQUEST_CANCELLED_LEAD}</p>
      {facts.length > 0 && (
        <dl className="req-cancelled-preview-facts">
          {facts.map((fact) => (
            <div className="req-cancelled-preview-row" key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
