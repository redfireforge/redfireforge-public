import { isTauri } from './platform';

/**
 * Open an https/http URL in the system browser.
 * Tauri webviews ignore plain `<a target="_blank">` / `window.open` for
 * external URLs — use the shell plugin there.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url || typeof url !== 'string') return;
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
