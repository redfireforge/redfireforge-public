import { Suspense, lazy } from 'react';
import type { DemoShellHostProps } from '../demo/DemoShellHost';
import { DemoShellErrorBoundary } from '../demo/DemoShellErrorBoundary';

// Always register the lazy chunk so Rolldown keeps demo-hub code (including
// demoHubApi stubs) in the DemoShellHost chunk rather than the main entry.
// When VITE_ENABLE_DEMO_HUB=false the chunk is generated but never loaded
// (orphan on disk) — this is intentional and accepted by audit-prod-demo-bundle.
const DemoShellHost = lazy(() =>
  import('../demo/DemoShellHost')
    .then((m) => ({ default: m.DemoShellHost }))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DemoShellHost] Chunk failed to load', err);
      return {
        default: function DemoShellChunkError() {
          throw new Error(message || 'Failed to load Learning Hub');
        },
      };
    }),
);

interface Props extends DemoShellHostProps {
  enabled: boolean;
}

export default function AppDemoShellMount({ enabled, ...props }: Props) {
  if (!enabled) return null;
  return (
    <DemoShellErrorBoundary>
      <Suspense fallback={null}>
        <DemoShellHost {...props} />
      </Suspense>
    </DemoShellErrorBoundary>
  );
}
