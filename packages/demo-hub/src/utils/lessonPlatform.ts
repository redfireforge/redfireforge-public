import { isTauri } from '@shared/utils/platform';
import type { DemoLesson } from '../types';

/** Playwright GQL-13 E2E sets this flag to exercise desktop mock flows in Chromium. */
function isGql13E2eDesktopShim(): boolean {
  return typeof window !== 'undefined'
    && (window as unknown as Record<string, unknown>).__RF_E2E_MOCK_DESKTOP__ === true;
}

/** True when a desktop-only lesson cannot be started in the current runtime. */
export function isLessonDesktopOnlyBlocked(lesson: DemoLesson): boolean {
  if (isGql13E2eDesktopShim()) return false;
  return Boolean(lesson.desktopOnly) && !isTauri();
}

/**
 * Local Vite / loopback hosts where the user can run Docker themselves.
 * `*.localhost` is RFC 6761 loopback (Vite can serve as `app.localhost`).
 * `[::1]` / `[::1].` is IPv6 loopback (optional brackets, optional FQDN dot).
 * `::ffff:127.0.0.1`, `0:0:0:0:0:ffff:127.0.0.1`, and hex `::ffff:7f00:1`
 * are IPv4-mapped IPv6 loopback.
 */
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

export function isLocalDemoWebHost(hostname: string): boolean {
  // Trailing FQDN dot first, then IPv6 brackets — `[::1].` must stay loopback.
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
 * True when a Docker-dependent lesson is being viewed in a hosted web environment.
 * In this case the PrerequisiteGate should be replaced with DesktopOnlyGate
 * because users cannot run local Docker backends against a cloud-hosted demo.
 *
 * Local loopback hosts are treated as local dev — Docker lessons run
 * normally there since the developer can spin up Docker on their own machine.
 */
export function isDockerLessonBlockedOnWeb(lesson: DemoLesson): boolean {
  if (isGql13E2eDesktopShim()) return false;
  if (isTauri()) return false;

  if (typeof window !== 'undefined' && isLocalDemoWebHost(window.location.hostname)) {
    return false;
  }

  return Boolean(
    lesson.dockerEndpoint || (lesson.dockerEndpoints && lesson.dockerEndpoints.length > 0),
  );
}
