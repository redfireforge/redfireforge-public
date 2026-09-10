import { useAppUpdater } from '../hooks/useAppUpdater';

export function UpdateNotificationBanner() {
  const { status, mode, updateInfo, downloadProgress, errorMessage, installUpdate, dismissUpdate } =
    useAppUpdater();

  if (status === 'idle' || status === 'checking') return null;

  if (status === 'error') {
    return (
      <div className="update-banner update-banner--error" role="alert">
        <button
          type="button"
          className="update-banner__dismiss"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissUpdate();
          }}
          aria-label="Dismiss"
          data-testid="update-banner-dismiss"
        >
          ✕
        </button>
        <span className="update-banner__icon">⚠</span>
        <span className="update-banner__text">Update failed: {errorMessage}</span>
      </div>
    );
  }

  if (status === 'available' && updateInfo && mode === 'localhost') {
    return (
      <div className="update-banner update-banner--localhost" role="status">
        <button
          type="button"
          className="update-banner__dismiss"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissUpdate();
          }}
          aria-label="Dismiss"
          data-testid="update-banner-dismiss"
        >
          ✕
        </button>
        <span className="update-banner__icon">ℹ</span>
        <span className="update-banner__text">
          <strong>v{updateInfo.version}</strong> is available on GitHub —
          run: <code className="update-banner__code">git pull origin master</code>
        </span>
      </div>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="update-banner update-banner--downloading" role="status">
        <span className="update-banner__icon update-banner__icon--spin">↻</span>
        <span className="update-banner__text">
          Downloading update{downloadProgress > 0 ? ` — ${downloadProgress}%` : '…'}
        </span>
        <div className="update-banner__progress">
          <div className="update-banner__progress-fill" style={{ width: `${downloadProgress}%` }} />
        </div>
      </div>
    );
  }

  if (status === 'available' && updateInfo) {
    return (
      <div className="update-banner update-banner--available" role="status">
        <button
          type="button"
          className="update-banner__dismiss"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissUpdate();
          }}
          aria-label="Dismiss"
          data-testid="update-banner-dismiss"
        >
          ✕
        </button>
        <span className="update-banner__icon">↑</span>
        <span className="update-banner__text">
          <strong>RedfireForge {updateInfo.version}</strong> is available
          {updateInfo.body ? ` — ${updateInfo.body.split('\n')[0]}` : ''}
        </span>
        <button type="button" className="update-banner__action" onClick={installUpdate}>
          Install &amp; Restart
        </button>
      </div>
    );
  }

  return null;
}
