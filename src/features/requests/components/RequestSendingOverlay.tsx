import { memo, useEffect, useState } from 'react';
import {
  formatSendingElapsed,
  type RequestSendPhase,
} from '../utils/requestCancelSummary';

function SendingCheckIcon() {
  return (
    <svg className="req-sending-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 8.2 L7.1 10.2 L11.2 5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendingPendingIcon() {
  return (
    <svg className="req-sending-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Ticks only this text node so the overlay card and editor do not re-render with the clock. */
function SendingElapsedClock() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const started = performance.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - started);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      className="req-sending-overlay-elapsed"
      data-testid="req-sending-elapsed"
      aria-hidden="true"
    >
      {formatSendingElapsed(elapsedMs)}
    </span>
  );
}

interface Props {
  phase: RequestSendPhase;
  onCancel: () => void;
}

function RequestSendingOverlay({ phase, onCancel }: Props) {
  const preparingDone = phase === 'sending';

  return (
    <div
      className="req-sending-overlay"
      data-testid="req-sending-overlay"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-busy="true"
    >
      <div className="req-sending-overlay-card">
        <div className="req-sending-steps">
          <div className={`req-sending-step ${preparingDone ? 'is-done' : 'is-active'}`}>
            {preparingDone ? <SendingCheckIcon /> : <span className="req-spinner" aria-hidden="true" />}
            <span
              className="req-sending-overlay-label"
              data-testid={preparingDone ? undefined : 'req-sending-label'}
            >
              Preparing request
            </span>
            {preparingDone ? <span className="req-sending-overlay-elapsed" aria-hidden="true" /> : <SendingElapsedClock />}
          </div>
          <div className={`req-sending-step ${phase === 'sending' ? 'is-active' : 'is-pending'}`}>
            {phase === 'sending'
              ? <span className="req-spinner" aria-hidden="true" />
              : <SendingPendingIcon />}
            <span
              className="req-sending-overlay-label"
              data-testid={phase === 'sending' ? 'req-sending-label' : undefined}
            >
              Sending request
            </span>
            {phase === 'sending' ? <SendingElapsedClock /> : <span className="req-sending-overlay-elapsed" aria-hidden="true" />}
          </div>
        </div>
        <button
          type="button"
          className="req-sending-cancel-btn"
          data-testid="req-sending-cancel"
          onClick={onCancel}
        >
          Cancel request
        </button>
      </div>
    </div>
  );
}

export default memo(RequestSendingOverlay);
