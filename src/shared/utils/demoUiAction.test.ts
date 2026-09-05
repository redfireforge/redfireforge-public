/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginDemoUiAction,
  endDemoUiAction,
  isDemoUiActionActive,
  runWithDemoUiAction,
} from './demoUiAction';

describe('demoUiAction', () => {
  afterEach(() => {
    document.body.removeAttribute('data-rf-demo-ui-action');
  });

  it('is inactive by default', () => {
    expect(isDemoUiActionActive()).toBe(false);
  });

  it('tracks nested begin/end pairs', () => {
    beginDemoUiAction();
    expect(isDemoUiActionActive()).toBe(true);
    beginDemoUiAction();
    expect(isDemoUiActionActive()).toBe(true);
    endDemoUiAction();
    expect(isDemoUiActionActive()).toBe(true);
    endDemoUiAction();
    expect(isDemoUiActionActive()).toBe(false);
  });

  it('stays inactive when end is called without a matching begin', () => {
    endDemoUiAction();
    expect(isDemoUiActionActive()).toBe(false);
    expect(document.body.hasAttribute('data-rf-demo-ui-action')).toBe(false);
  });

  it('runs a callback while active and clears afterward', () => {
    let sawActive = false;
    runWithDemoUiAction(() => {
      sawActive = isDemoUiActionActive();
    });
    expect(sawActive).toBe(true);
    expect(isDemoUiActionActive()).toBe(false);
  });

  it('clears even when the callback throws', () => {
    expect(() => runWithDemoUiAction(() => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(isDemoUiActionActive()).toBe(false);
  });
});
