/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('suppressResizeObserverError', () => {
  let errorSpy: ReturnType<typeof vi.fn>;
  let rejectionSpy: ReturnType<typeof vi.fn>;
  const originalConsoleError = console.error;

  beforeEach(async () => {
    errorSpy = vi.fn();
    rejectionSpy = vi.fn();
    window.addEventListener('error', errorSpy);
    window.addEventListener('unhandledrejection', rejectionSpy);

    await import('./suppressResizeObserverError');
  });

  afterEach(() => {
    window.removeEventListener('error', errorSpy);
    window.removeEventListener('unhandledrejection', rejectionSpy);
    console.error = originalConsoleError;
    vi.resetModules();
  });

  it('swallows ErrorEvent with ResizeObserver message', () => {
    const event = new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
      cancelable: true,
    });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('does not swallow unrelated ErrorEvents', () => {
    const event = new ErrorEvent('error', {
      message: 'Some other error',
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('swallows unhandledrejection with ResizeObserver reason', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: new Error('ResizeObserver loop limit exceeded') });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not swallow unrelated unhandledrejection', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'reason', { value: new Error('Network failure') });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('handles string reason in unhandledrejection', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: 'ResizeObserver error string' });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('handles null reason in unhandledrejection', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: null });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('swallows ErrorEvent where error.message contains ResizeObserver (empty message)', () => {
    const event = new ErrorEvent('error', { cancelable: true });
    Object.defineProperty(event, 'error', { value: new Error('ResizeObserver loop completed') });
    Object.defineProperty(event, 'message', { value: '' });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('swallows ErrorEvent where error is a non-Error string containing ResizeObserver', () => {
    const event = new ErrorEvent('error', { cancelable: true });
    Object.defineProperty(event, 'error', { value: 'ResizeObserver loop' });
    Object.defineProperty(event, 'message', { value: '' });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('does not swallow ErrorEvent with null error and empty message', () => {
    const event = new ErrorEvent('error', { cancelable: true });
    Object.defineProperty(event, 'error', { value: null });
    Object.defineProperty(event, 'message', { value: '' });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('handles undefined reason in unhandledrejection', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: undefined });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('swallows Monaco cancelation unhandledrejection objects', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', {
      value: { type: 'cancelation', msg: 'operation is manually canceled' },
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('swallows Monaco Canceled Error unhandledrejection', () => {
    const err = new Error('Canceled');
    err.name = 'Canceled';
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: err });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('swallows string Canceled unhandledrejection', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: 'Canceled' });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('swallows ErrorEvent whose message is Uncaught (in promise) Canceled: Canceled', () => {
    const event = new ErrorEvent('error', {
      message: 'Uncaught (in promise) Canceled: Canceled',
      cancelable: true,
    });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('swallows ErrorEvent whose message is Canceled: Canceled', () => {
    const event = new ErrorEvent('error', {
      message: 'Canceled: Canceled',
      cancelable: true,
    });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('swallows Error with Canceled message even when name is Error', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: new Error('Canceled') });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not swallow unrelated plain-object unhandledrejection', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: { type: 'other', msg: 'boom' } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('swallows unhandledrejection whose object only has a canceled message field', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: { message: 'Canceled: Canceled' } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('swallows console.error when an argument is a canceled string', async () => {
    vi.resetModules();
    const native = vi.fn();
    console.error = native;
    await import('./suppressResizeObserverError');
    console.error('Canceled: Canceled');
    expect(native).not.toHaveBeenCalled();
  });

  it('swallows console.error when an argument is a Canceled Error', async () => {
    vi.resetModules();
    const native = vi.fn();
    console.error = native;
    await import('./suppressResizeObserverError');
    const err = new Error('Canceled');
    err.name = 'Canceled';
    console.error(err);
    expect(native).not.toHaveBeenCalled();
  });

  it('swallows console.error when an argument is a Monaco cancelation object', async () => {
    vi.resetModules();
    const native = vi.fn();
    console.error = native;
    await import('./suppressResizeObserverError');
    console.error({ type: 'cancelation', msg: 'operation is manually canceled' });
    expect(native).not.toHaveBeenCalled();
  });

  it('forwards unrelated console.error arguments to the native logger', async () => {
    vi.resetModules();
    const native = vi.fn();
    console.error = native;
    await import('./suppressResizeObserverError');
    console.error('real failure', 42);
    expect(native).toHaveBeenCalledWith('real failure', 42);
  });

  it('swallows unhandledrejection from Vite HMR send-before-connect', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: new Error('send was called before connect') });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('swallows unhandledrejection from Vite HMR invoke-before-connect', () => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'type', { value: 'unhandledrejection' });
    Object.defineProperty(event, 'reason', { value: new Error('invoke was called before connect') });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('swallows console.error for Vite HMR send-before-connect', async () => {
    vi.resetModules();
    const native = vi.fn();
    console.error = native;
    await import('./suppressResizeObserverError');
    console.error(new Error('send was called before connect'));
    expect(native).not.toHaveBeenCalled();
  });
});
