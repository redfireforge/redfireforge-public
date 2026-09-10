import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, isLocalhost } from '@shared/utils/platform';
import {
  fetchLatestRelease,
  getCurrentVersion,
  isNewerVersion,
  isOfficialStableRelease,
} from '@shared/utils/latestRelease';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'error';
export type UpdateMode = 'tauri' | 'localhost';

export interface AppUpdaterState {
  status: UpdateStatus;
  mode: UpdateMode;
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  errorMessage: string | null;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

function dismissKey(version: string) {
  return `rff-update-dismissed-v${version}`;
}

function readDismissed(version: string): boolean {
  try {
    if (localStorage.getItem(dismissKey(version))) return true;
  } catch {
    /* storage blocked */
  }
  try {
    if (sessionStorage.getItem(dismissKey(version))) return true;
  } catch {
    /* storage blocked */
  }
  return false;
}

function rememberDismissed(version: string): void {
  try {
    localStorage.setItem(dismissKey(version), '1');
  } catch {
    /* storage blocked */
  }
  try {
    sessionStorage.setItem(dismissKey(version), '1');
  } catch {
    /* storage blocked */
  }
  void import('@shared/utils/storage').then(({ writeKey }) => {
    void writeKey(dismissKey(version), '1');
  }).catch(() => {
    /* Tauri store unavailable */
  });
}

function shouldSkipDevDesktopUpdater(): boolean {
  return Boolean(import.meta.env.DEV) && isTauri() && import.meta.env.MODE !== 'test';
}

export function useAppUpdater(): AppUpdaterState {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [mode, setMode] = useState<UpdateMode>('tauri');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkGen = useRef(0);
  const updateInfoRef = useRef<UpdateInfo | null>(null);
  updateInfoRef.current = updateInfo;

  useEffect(() => {
    // `tauri:dev` must not prompt to install a GitHub release over a debug build.
    if (shouldSkipDevDesktopUpdater()) return;

    const CHECK_DELAY_MS = 3000;
    const gen = ++checkGen.current;

    if (isTauri()) {
      const timer = setTimeout(() => { void checkTauriUpdate(gen); }, CHECK_DELAY_MS);
      return () => {
        checkGen.current += 1;
        clearTimeout(timer);
      };
    }

    if (isLocalhost()) {
      setMode('localhost');
      const timer = setTimeout(() => { void checkLocalhostUpdate(gen); }, CHECK_DELAY_MS);
      return () => {
        checkGen.current += 1;
        clearTimeout(timer);
      };
    }
  }, []);

  async function checkTauriUpdate(gen: number) {
    try {
      setStatus('checking');
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (gen !== checkGen.current) return;
      if (update?.available) {
        // Only notify for official stable tags — never alpha/beta/rc
        if (!isOfficialStableRelease(update.version)) {
          setStatus('idle');
          return;
        }
        const info = { version: update.version, body: update.body ?? null };
        if (readDismissed(info.version)) {
          setStatus('idle');
          return;
        }
        setUpdateInfo(info);
        setStatus('available');
      } else {
        setStatus('idle');
      }
    } catch {
      if (gen === checkGen.current) setStatus('idle');
    }
  }

  async function checkLocalhostUpdate(gen: number) {
    try {
      setStatus('checking');
      const release = await fetchLatestRelease();
      if (gen !== checkGen.current) return;
      if (release && isNewerVersion(getCurrentVersion(), release.version)) {
        if (readDismissed(release.version)) {
          setStatus('idle');
          return;
        }
        setUpdateInfo({ version: release.version, body: release.body || null });
        setStatus('available');
      } else {
        setStatus('idle');
      }
    } catch {
      if (gen === checkGen.current) setStatus('idle');
    }
  }

  async function installUpdate() {
    if (!updateInfo) return;
    try {
      setStatus('downloading');
      setDownloadProgress(0);

      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (!update?.available) return;

      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100));
        } else if (event.event === 'Finished') {
          setDownloadProgress(100);
        }
      });

      await relaunch();
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : 'Update failed');
    }
  }

  const dismissUpdate = useCallback(() => {
    checkGen.current += 1;
    const info = updateInfoRef.current;
    if (info) rememberDismissed(info.version);
    setStatus('idle');
    setUpdateInfo(null);
  }, []);

  return { status, mode, updateInfo, downloadProgress, errorMessage, installUpdate, dismissUpdate };
}
