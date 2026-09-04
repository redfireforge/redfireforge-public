import { Component, useLayoutEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DEMO_HUB_MOUNT_ID, useDemoHubMountEl } from './demoHubRuntimeRef';

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: ReactNode;
}

function DemoShellErrorFallback({ error }: { error: Error | null }) {
  const mountEl = useDemoHubMountEl();
  const [legacyMount, setLegacyMount] = useState<HTMLElement | null>(null);
  const message = error?.message ?? 'unknown';

  useLayoutEffect(() => {
    setLegacyMount(document.getElementById(DEMO_HUB_MOUNT_ID));
  }, []);

  const target = mountEl ?? legacyMount;
  const card = (
    <div
      id="demo-hub-error"
      className="demo-hub-crash"
      data-error={message}
      role="alert"
    >
      <p className="demo-hub-crash-title">Learning Hub failed to load</p>
      <p className="demo-hub-crash-message">{message}</p>
      <button
        type="button"
        className="demo-hub-crash-reload"
        onClick={() => window.location.reload()}
      >
        Reload Learning Hub
      </button>
    </div>
  );

  if (target) return createPortal(card, target);
  return card;
}

/**
 * Error boundary specifically for the lazy-loaded DemoShellHost.
 *
 * Without this, any throw inside DemoShellHost (or its chunk import) escapes
 * Suspense and unmounts the entire React tree — leaving just the background
 * colour. This boundary catches those errors, keeps the rest of the app alive,
 * and shows the failure in the Learning Hub pane.
 */
export class DemoShellErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DemoShellHost] Crashed — Learning Hub will be disabled for this session.', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <DemoShellErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
