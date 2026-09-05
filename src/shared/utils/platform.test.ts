/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  isTauri,
  isE2eDesktopShim,
  isNode,
  supportsWorkers,
  isLocalhost,
  isLocalWebHost,
  isDesktopRuntimeAvailable,
} from './platform';

describe('platform', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window as Window & { __RF_E2E_MOCK_DESKTOP__?: unknown }).__RF_E2E_MOCK_DESKTOP__;
  });

  it('detects the Playwright desktop shim without treating the runtime as Tauri', () => {
    expect(isE2eDesktopShim()).toBe(false);
    (window as Window & { __RF_E2E_MOCK_DESKTOP__?: unknown }).__RF_E2E_MOCK_DESKTOP__ = true;
    expect(isE2eDesktopShim()).toBe(true);
    expect(isTauri()).toBe(false);
  });

  it('detects Tauri when __TAURI_INTERNALS__ is present', () => {
    expect(isTauri()).toBe(false);
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });

  it('detects Node via process.versions.node', () => {
    expect(typeof isNode()).toBe('boolean');
  });

  it('reports Worker support', () => {
    expect(supportsWorkers()).toBe(typeof Worker !== 'undefined');
  });

  it('isLocalhost is true for localhost, 127.0.0.1, and ::1', () => {
    for (const hostname of ['localhost', '127.0.0.1', '::1']) {
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, hostname },
        writable: true,
        configurable: true,
      });
      expect(isLocalhost()).toBe(true);
    }
  });

  it('isLocalhost is true for RFC 6761 *.localhost and loopback /8', () => {
    for (const hostname of ['app.localhost', '127.0.0.2', '[::1]']) {
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, hostname },
        writable: true,
        configurable: true,
      });
      expect(isLocalhost()).toBe(true);
    }
  });

  it('isLocalhost is false for hosted hostnames', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'app.redfireforge.com' },
      writable: true,
      configurable: true,
    });
    expect(isLocalhost()).toBe(false);
  });

  it('isLocalWebHost covers loopback spellings used by local clones', () => {
    expect(isLocalWebHost('localhost')).toBe(true);
    expect(isLocalWebHost('app.localhost')).toBe(true);
    expect(isLocalWebHost('127.0.0.1')).toBe(true);
    expect(isLocalWebHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLocalWebHost('demo.redfireforge.com')).toBe(false);
    expect(isLocalWebHost('192.168.1.10')).toBe(false);
  });

  it('isLocalWebHost resolves IPv6 loopback and bracketed/FQDN spellings', () => {
    expect(isLocalWebHost('::1')).toBe(true);
    expect(isLocalWebHost('[::1]')).toBe(true);
    expect(isLocalWebHost('[::1].')).toBe(true);
    expect(isLocalWebHost('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('isLocalWebHost resolves the long IPv4-mapped IPv6 prefix', () => {
    expect(isLocalWebHost('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
    expect(isLocalWebHost('0:0:0:0:0:ffff:192.168.1.10')).toBe(false);
  });

  it('isLocalWebHost decodes hex IPv4-mapped IPv6 loopback', () => {
    // ::ffff:7f00:1 is the hex spelling of 127.0.0.1
    expect(isLocalWebHost('::ffff:7f00:1')).toBe(true);
    expect(isLocalWebHost('0:0:0:0:0:ffff:7f00:1')).toBe(true);
    // c0a8:10a is 192.168.1.10 — mapped but not loopback
    expect(isLocalWebHost('::ffff:c0a8:10a')).toBe(false);
  });

  it('isLocalWebHost rejects dotted quads with out-of-range octets', () => {
    expect(isLocalWebHost('999.0.0.1')).toBe(false);
    expect(isLocalWebHost('127.0.0.999')).toBe(false);
  });

  it('isDesktopRuntimeAvailable is true on localhost web and false on hosted web', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'localhost' },
      writable: true,
      configurable: true,
    });
    expect(isDesktopRuntimeAvailable()).toBe(true);

    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'app.redfireforge.com' },
      writable: true,
      configurable: true,
    });
    expect(isDesktopRuntimeAvailable()).toBe(false);

    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isDesktopRuntimeAvailable()).toBe(true);
  });
});
