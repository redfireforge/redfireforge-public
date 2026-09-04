/**
 * @vitest-environment jsdom
 *
 * Tests for the lazy-import .catch() path in AppDemoShellMount.
 * Kept in a separate file from AppDemoShellMount.coverage-gaps.test.tsx so
 * vi.resetModules() / vi.doMock calls don't interfere with that file's
 * hoisted vi.mock.
 *
 * Strategy: make the dynamic import() succeed (vitest can wrap throwing
 * factories in its own Error), but make the property access inside .then()
 * throw — so .catch() receives the exact rejection value, unwrapped.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Minimal error boundary used as a test harness to capture rethrows. */
function makeCatcher(onCatch: (e: Error) => void) {
  return class Catcher extends React.Component<
    { children: React.ReactNode },
    { caught: boolean }
  > {
    constructor(p: { children: React.ReactNode }) {
      super(p);
      this.state = { caught: false };
    }
    static getDerivedStateFromError() {
      return { caught: true };
    }
    componentDidCatch(e: Error): void {
      onCatch(e);
    }
    render() {
      return this.state.caught ? null : this.props.children;
    }
  };
}

/**
 * Renders AppDemoShellMount with a mock that makes the .then() callback
 * inside the lazy() factory reject with `thenRejection`. This reaches the
 * .catch() block with the real rejection value (not vitest-wrapped).
 */
async function renderWithThenRejection(thenRejection: unknown) {
  // The import itself succeeds, but accessing the named export inside .then()
  // throws — causing the .then() promise to reject with the real value.
  vi.doMock('../demo/DemoShellHost', () => ({
    get DemoShellHost(): never {
      throw thenRejection;
    },
  }));
  // Replace the real boundary with a passthrough so our Catcher below sees
  // the throw from DemoShellChunkError directly.
  vi.doMock('../demo/DemoShellErrorBoundary', () => ({
    DemoShellErrorBoundary: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  }));

  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Fresh import so DemoShellHost lazy() is created with the doMocks in place.
  const { default: AppDemoShellMount } = await import('./AppDemoShellMount');

  let caught: Error | undefined;
  const Catcher = makeCatcher((e) => {
    caught = e;
  });

  await act(async () => {
    render(
      React.createElement(
        Catcher,
        null,
        React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(AppDemoShellMount, { enabled: true } as never),
        ),
      ),
    );
    // Let the micro-task queue drain so the lazy promise settles.
    await new Promise<void>((r) => setTimeout(r, 20));
  });

  return { caught, consoleSpy };
}

describe('AppDemoShellMount – lazy import .catch() path', () => {
  it('uses err.message and rethrows it when the rejection is an Error object', async () => {
    const err = new Error('ChunkLoadError: chunk 42 failed to fetch');
    const { caught, consoleSpy } = await renderWithThenRejection(err);

    // The .catch() block logs the raw error
    expect(consoleSpy).toHaveBeenCalledWith(
      '[DemoShellHost] Chunk failed to load',
      err,
    );
    // DemoShellChunkError throws new Error(err.message), caught by Catcher
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toBe('ChunkLoadError: chunk 42 failed to fetch');
  });

  it('uses String(err) when the rejection is a non-Error value', async () => {
    const { caught, consoleSpy } = await renderWithThenRejection('plain-string-failure');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[DemoShellHost] Chunk failed to load',
      'plain-string-failure',
    );
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toBe('plain-string-failure');
  });

  it('falls back to the default message when the rejection yields an empty message', async () => {
    const { caught } = await renderWithThenRejection(new Error(''));

    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toBe('Failed to load Learning Hub');
  });
});
