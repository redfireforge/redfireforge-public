import { useEffect } from 'react';

interface LiveDemoLeaveDialogProps {
  onStay: () => void;
  onLeave: () => void;
}

/** In-app Stay / Leave prompt — `window.confirm` is easy to miss in Tauri. */
export default function LiveDemoLeaveDialog({ onStay, onLeave }: LiveDemoLeaveDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onStay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStay]);

  return (
    <div className="live-demo-leave-overlay" data-testid="live-demo-leave-overlay">
      <div
        className="live-demo-leave-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-demo-leave-title"
      >
        <p id="live-demo-leave-title" className="live-demo-leave-title">Leave the live demo?</p>
        <p className="live-demo-leave-message">
          Navigating away will end the current demo session. Stay on this lesson, or leave and return to Demo Hub later.
        </p>
        <div className="live-demo-leave-actions">
          <button type="button" className="live-demo-leave-stay" onClick={onStay} data-testid="live-demo-leave-stay">
            Stay
          </button>
          <button type="button" className="live-demo-leave-leave" onClick={onLeave} data-testid="live-demo-leave-leave">
            Leave demo
          </button>
        </div>
      </div>
    </div>
  );
}
