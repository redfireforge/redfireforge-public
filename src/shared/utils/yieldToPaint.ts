/**
 * Yield until the browser has painted pending React commits.
 * flushSync updates the DOM; this waits for that paint so later work
 * (JSON tree, history) cannot keep a stale "Sending…" frame on screen.
 */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}
