/**
 * Returns true when the app is running inside a Tauri desktop shell.
 * Works both at startup and after dynamic import of @tauri-apps/api.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Playwright GQL-13 / API Mock E2E sets this so Chromium can exercise
 * desktop-gated UI (Start listener, mock panel) while still using the
 * web companion on :3001 — `isTauri()` stays false.
 */
export function isE2eDesktopShim(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as Record<string, unknown>).__RF_E2E_MOCK_DESKTOP__ === true;
}

/**
 * Returns true when running in a Node.js environment (CLI mode).
 */
export function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

/**
 * Returns true when the current environment supports Web Workers.
 */
export function supportsWorkers(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Returns true when the app is running on localhost (local dev / evaluator clone).
 * Used to show a "git pull" update banner for non-Tauri local users.
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
