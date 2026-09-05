/**
 * @vitest-environment node
 *
 * Covers branches that are unreachable under jsdom (no `window` / no Worker).
 */
import { describe, it, expect } from 'vitest';
import { isTauri, isNode, supportsWorkers, isLocalhost, isDesktopRuntimeAvailable } from './platform';

describe('platform (node environment)', () => {
  it('isTauri is false without window', () => {
    expect(typeof window).toBe('undefined');
    expect(isTauri()).toBe(false);
  });

  it('isLocalhost is false without window', () => {
    expect(isLocalhost()).toBe(false);
  });

  it('isDesktopRuntimeAvailable is false without window', () => {
    expect(isDesktopRuntimeAvailable()).toBe(false);
  });

  it('isNode is true in Node', () => {
    expect(isNode()).toBe(true);
  });

  it('supportsWorkers is false without Worker', () => {
    expect(typeof Worker).toBe('undefined');
    expect(supportsWorkers()).toBe(false);
  });
});
