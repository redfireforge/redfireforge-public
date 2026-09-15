import { describe, expect, it, vi } from 'vitest';
import { yieldToPaint } from './yieldToPaint';

describe('yieldToPaint', () => {
  it('resolves after two animation frames', async () => {
    const frames: Array<FrameRequestCallback> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    let done = false;
    const pending = yieldToPaint().then(() => { done = true; });
    expect(done).toBe(false);
    expect(frames).toHaveLength(1);

    frames[0](0);
    expect(done).toBe(false);
    expect(frames).toHaveLength(2);

    frames[1](16);
    await pending;
    expect(done).toBe(true);
    vi.unstubAllGlobals();
  });

  it('falls back to setTimeout when rAF is missing', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    await yieldToPaint();
    expect(timeout).toHaveBeenCalled();
    timeout.mockRestore();
    vi.unstubAllGlobals();
  });
});
