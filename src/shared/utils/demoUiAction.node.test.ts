/**
 * @vitest-environment node
 *
 * Covers the SSR guards that are unreachable under jsdom (no `document`).
 */
import { describe, it, expect } from 'vitest';
import {
  beginDemoUiAction,
  endDemoUiAction,
  isDemoUiActionActive,
  runWithDemoUiAction,
} from './demoUiAction';

describe('demoUiAction (node environment)', () => {
  it('has no document to mark', () => {
    expect(typeof document).toBe('undefined');
  });

  it('begin is a no-op without document', () => {
    expect(() => beginDemoUiAction()).not.toThrow();
  });

  it('end is a no-op without document', () => {
    expect(() => endDemoUiAction()).not.toThrow();
  });

  it('isDemoUiActionActive is false without document', () => {
    expect(isDemoUiActionActive()).toBe(false);
  });

  it('runWithDemoUiAction still returns the callback result', () => {
    expect(runWithDemoUiAction(() => 'value')).toBe('value');
  });
});
