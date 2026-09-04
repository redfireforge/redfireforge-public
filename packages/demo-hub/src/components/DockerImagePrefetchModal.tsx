import { useEffect } from 'react';
import { useDockerImagePrefetch } from '../hooks/useDockerImagePrefetch';

export default function DockerImagePrefetchModal() {
  const {
    ready,
    showFirstLaunch,
    error,
    choice,
    running,
    declinePrefetch,
    openDesktop,
    startPrefetch,
  } = useDockerImagePrefetch();

  const visible = ready && (showFirstLaunch || Boolean(error));

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void declinePrefetch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, declinePrefetch]);

  if (!visible) return null;

  const showAsk = choice === null && !running;

  return (
    <div className="docker-prefetch-overlay" data-testid="docker-prefetch-overlay">
      <div
        className="docker-prefetch-modal"
        role="dialog"
        aria-labelledby="docker-prefetch-title"
        data-testid="docker-prefetch-modal"
      >
        <div className="docker-prefetch-modal__header">
          <h2 id="docker-prefetch-title">Download lesson images?</h2>
        </div>
        <div className="docker-prefetch-modal__body">
          <p>
            About 2 GB. Docker Desktop must be running. You can do this later from Settings → Docker.
          </p>
          {error && (
            <p className="docker-prefetch-modal__error" data-testid="docker-prefetch-error">
              {error}
            </p>
          )}
        </div>
        <div className="docker-prefetch-modal__footer">
          {showAsk || error ? (
            <>
              {error?.includes('not running') && (
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="docker-prefetch-open-docker"
                  onClick={() => { void openDesktop(); }}
                >
                  Open Docker Desktop
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                data-testid="docker-prefetch-not-now"
                onClick={() => { void declinePrefetch(); }}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="docker-prefetch-download"
                disabled={running}
                onClick={() => { void startPrefetch(); }}
              >
                {error ? 'Retry' : 'Download now'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
