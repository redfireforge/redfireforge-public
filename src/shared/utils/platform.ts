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

function isLoopbackIPv4(host: string): boolean {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 127;
}

/** `::ffff:7f00:1` / `0:0:0:0:0:ffff:7f00:1` — hex form of IPv4-mapped IPv6. */
function ipv4FromMappedHex(host: string): string | null {
  const match = host.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return null;
  const hi = Number.parseInt(match[1], 16);
  const lo = Number.parseInt(match[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * Local Vite / loopback hosts where a cloned repo can run the companion.
 * `*.localhost` is RFC 6761 loopback (Vite can serve as `app.localhost`).
 * `[::1]` / `[::1].` is IPv6 loopback (optional brackets, optional FQDN dot).
 * `::ffff:127.0.0.1`, `0:0:0:0:0:ffff:127.0.0.1`, and hex `::ffff:7f00:1`
 * are IPv4-mapped IPv6 loopback.
 */
export function isLocalWebHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[(.+)\]$/, '$1');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }
  const mapped = host.startsWith('::ffff:')
    ? host.slice('::ffff:'.length)
    : host.startsWith('0:0:0:0:0:ffff:')
      ? host.slice('0:0:0:0:0:ffff:'.length)
      : host;
  if (isLoopbackIPv4(mapped)) return true;
  const hexMapped = ipv4FromMappedHex(host);
  return hexMapped ? isLoopbackIPv4(hexMapped) : false;
}

/**
 * Returns true when the app is running on a local loopback host
 * (cloned repo / `npm run dev` / evaluator). Used to enable companion-backed
 * features and the git-pull update banner for non-Tauri local users.
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  return isLocalWebHost(window.location.hostname);
}

/**
 * True when desktop-gated features may run:
 * Tauri shell, Playwright desktop shim, or a local clone (`npm run dev`).
 * Hosted / remote web stays false so Start / native studios stay disabled there.
 */
export function isDesktopRuntimeAvailable(): boolean {
  return isTauri() || isE2eDesktopShim() || isLocalhost();
}
