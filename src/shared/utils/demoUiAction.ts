/**
 * Marks in-flight Demo Hub UI actions (ctx.click / ctx.selectOption).
 * The live-demo tab-exit confirm must ignore these, while still prompting
 * when a human clicks the activity bar mid-lesson.
 */
const ATTR = 'data-rf-demo-ui-action';

export function beginDemoUiAction(): void {
  if (typeof document === 'undefined') return;
  const next = Number(document.body.getAttribute(ATTR) ?? '0') + 1;
  document.body.setAttribute(ATTR, String(next));
}

export function endDemoUiAction(): void {
  if (typeof document === 'undefined') return;
  const next = Math.max(0, Number(document.body.getAttribute(ATTR) ?? '0') - 1);
  if (next === 0) document.body.removeAttribute(ATTR);
  else document.body.setAttribute(ATTR, String(next));
}

export function isDemoUiActionActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Number(document.body.getAttribute(ATTR) ?? '0') > 0;
}

export function runWithDemoUiAction<T>(fn: () => T): T {
  beginDemoUiAction();
  try {
    return fn();
  } finally {
    endDemoUiAction();
  }
}
