import type { IncomingMessage } from 'node:http';

function isLoopbackIPv4(host: string): boolean {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 127;
}

function ipv4FromMappedHex(host: string): string | null {
  const match = host.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return null;
  const hi = Number.parseInt(match[1], 16);
  const lo = Number.parseInt(match[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/** Hostname only (no port). Matches Demo Hub `isLocalDemoWebHost`. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[(.+)\]$/, '$1');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const mapped = host.startsWith('::ffff:')
    ? host.slice('::ffff:'.length)
    : host.startsWith('0:0:0:0:0:ffff:')
      ? host.slice('0:0:0:0:0:ffff:'.length)
      : host;
  if (isLoopbackIPv4(mapped)) return true;
  const hexMapped = ipv4FromMappedHex(host);
  return hexMapped ? isLoopbackIPv4(hexMapped) : false;
}

export function stripHostPort(hostHeader: string): string {
  const raw = hostHeader.trim().toLowerCase();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end !== -1) return raw.slice(1, end);
  }
  const colon = raw.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(raw.slice(colon + 1))) {
    return raw.slice(0, colon);
  }
  return raw;
}

export function isLoopbackHostHeader(hostHeader: string): boolean {
  return isLoopbackHostname(stripHostPort(hostHeader));
}

export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const host = remoteAddress.toLowerCase().replace(/%.+$/, '');
  return isLoopbackHostname(host);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Loopback `remoteAddress` AND loopback `Host`.
 * `X-Forwarded-Host` / `X-Forwarded-For` are ignored (Vite may bind 0.0.0.0).
 */
export function assertLocalDockerRequest(req: IncomingMessage): boolean {
  if (!isLoopbackRemoteAddress(req.socket?.remoteAddress)) return false;
  const host = headerValue(req.headers.host);
  if (!host) return false;
  return isLoopbackHostHeader(host);
}
