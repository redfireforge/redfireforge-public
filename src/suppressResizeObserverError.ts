/**
 * Swallow known benign browser / editor console noise that is not an app bug:
 * - Chromium ResizeObserver nested-layout Error events (Vite overlays otherwise)
 * - Monaco / @monaco-editor/react cancelation rejections when editors remount
 *   (React StrictMode, tab switches) — `{ type: 'cancelation', msg: '...' }`
 */

function isResizeObserverNoise(reasonOrMessage: unknown): boolean {
  const msg = reasonOrMessage instanceof Error
    ? reasonOrMessage.message
    : String(reasonOrMessage ?? '');
  return msg.includes('ResizeObserver');
}

/** Vite HMR / forward-console: sending after the websocket dropped loops forever (#22407). */
function isViteHmrDisconnectNoise(reasonOrMessage: unknown): boolean {
  const msg = reasonOrMessage instanceof Error
    ? reasonOrMessage.message
    : String(reasonOrMessage ?? '');
  return msg.includes('send was called before connect')
    || msg.includes('invoke was called before connect');
}

/** Monaco rejects cancelled work with a plain object (not Error) — Chrome shows "Object". */
function isCanceledNoise(text: string): boolean {
  const msg = text.trim().toLowerCase();
  return (
    msg === 'canceled'
    || msg === 'cancelled'
    || msg === 'canceled: canceled'
    || msg === 'cancelled: cancelled'
    || msg.includes('canceled: canceled')
    || msg.includes('cancelled: cancelled')
    || msg.includes('operation is manually canceled')
    || msg.includes('operation is manually cancelled')
  );
}

function isMonacoCancelation(reason: unknown): boolean {
  if (typeof reason === 'string') return isCanceledNoise(reason);
  if (!reason || typeof reason !== 'object') return false;
  const r = reason as { type?: unknown; name?: unknown; msg?: unknown; message?: unknown };
  if (r.type === 'cancelation' || r.type === 'cancellation') return true;
  if (r.name === 'Canceled' || r.name === 'Cancelled') return true;
  return isCanceledNoise(String(r.msg ?? r.message ?? ''));
}

function isBenignConsoleNoise(event: Event): boolean {
  if (event.type === 'unhandledrejection') {
    const reason = (event as PromiseRejectionEvent).reason;
    return isResizeObserverNoise(reason)
      || isViteHmrDisconnectNoise(reason)
      || isMonacoCancelation(reason);
  }
  const e = event as ErrorEvent;
  const m = e.message
    || (e.error instanceof Error ? e.error.message : e.error != null ? String(e.error) : '');
  return isResizeObserverNoise(m)
    || isViteHmrDisconnectNoise(m)
    || isCanceledNoise(m)
    || isMonacoCancelation(e.error);
}

function swallowBenignConsoleNoise(event: Event) {
  if (!isBenignConsoleNoise(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isCanceledConsoleArg(value: unknown): boolean {
  if (typeof value === 'string') {
    return isCanceledNoise(value) || isViteHmrDisconnectNoise(value);
  }
  if (value instanceof Error) {
    return isViteHmrDisconnectNoise(value) || isMonacoCancelation(value);
  }
  return isMonacoCancelation(value);
}

const nativeConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (args.some(isCanceledConsoleArg)) return;
  nativeConsoleError(...args);
};

window.addEventListener('error', swallowBenignConsoleNoise, true);
window.addEventListener('unhandledrejection', swallowBenignConsoleNoise, true);
