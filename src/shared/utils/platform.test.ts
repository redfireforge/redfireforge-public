/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isTauri, isE2eDesktopShim, isNode, supportsWorkers, isLocalhost } from './platform';

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

  it('isLocalhost is false for hosted hostnames', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'app.redfireforge.com' },
      writable: true,
      configurable: true,
    });
    expect(isLocalhost()).toBe(false);
  });
});
