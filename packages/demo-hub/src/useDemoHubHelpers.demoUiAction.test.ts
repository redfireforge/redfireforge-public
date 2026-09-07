/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoUiActionActive } from '@shared/utils/demoUiAction';
import { makeVisible } from './lessons/protocols/ws-test-utils';
import { buildDemoActionContext, buildQuietDemoActionContext } from './useDemoHubHelpers';

describe('demo action context — live-demo tab exit', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.removeAttribute('data-rf-demo-ui-action');
    vi.useRealTimers();
  });

  it('marks ctx.click as a demo UI action so the tab-exit confirm can skip', async () => {
    vi.useFakeTimers();
    let sawActive = false;
    const btn = document.createElement('button');
    btn.className = 'demo-nav-target';
    makeVisible(btn);
    btn.addEventListener('click', () => {
      sawActive = isDemoUiActionActive();
    });
    document.body.appendChild(btn);

    const ctx = buildDemoActionContext(vi.fn());
    const pending = ctx.click('.demo-nav-target');
    await vi.runAllTimersAsync();
    await pending;

    expect(sawActive).toBe(true);
    expect(isDemoUiActionActive()).toBe(false);
  });

  it('marks quiet ctx.click the same way', async () => {
    let sawActive = false;
    const btn = document.createElement('button');
    btn.className = 'demo-nav-target';
    makeVisible(btn);
    btn.addEventListener('click', () => {
      sawActive = isDemoUiActionActive();
    });
    document.body.appendChild(btn);

    const ctx = buildQuietDemoActionContext(vi.fn());
    await ctx.click('.demo-nav-target');

    expect(sawActive).toBe(true);
    expect(isDemoUiActionActive()).toBe(false);
  });
});
