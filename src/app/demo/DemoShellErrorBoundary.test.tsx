/**
 * @vitest-environment jsdom
 *
 * Tests for AppDemoShellMount + DemoShellErrorBoundary.
 * Key behaviour: when DemoShellHost throws, the ErrorBoundary catches the crash
 * and keeps the rest of the React tree alive (no full unmount / blank screen).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DemoShellErrorBoundary } from '../demo/DemoShellErrorBoundary';
import { DEMO_HUB_MOUNT_ID, registerDemoHubMount } from '../demo/demoHubRuntimeRef';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── DemoShellErrorBoundary unit tests ────────────────────────────────────────

function BrokenChild(): never {
  throw new Error('demo crash');
}

function StableChild() {
  return <div data-testid="stable-child">OK</div>;
}

describe('DemoShellErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <DemoShellErrorBoundary>
        <StableChild />
      </DemoShellErrorBoundary>,
    );
    expect(screen.getByTestId('stable-child')).toBeTruthy();
  });

  it('renders a visible error card (not the child) when child throws', () => {
    // Suppress React's console.error during throw
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <DemoShellErrorBoundary>
        <BrokenChild />
      </DemoShellErrorBoundary>,
    );

    expect(screen.queryByTestId('stable-child')).toBeNull();
    const errNode = document.getElementById('demo-hub-error');
    expect(errNode).toBeTruthy();
    expect(errNode?.getAttribute('data-error')).toBe('demo crash');
    expect(errNode?.textContent).toContain('Learning Hub failed to load');
    expect(errNode?.textContent).toContain('demo crash');

    consoleSpy.mockRestore();
  });

  it('logs the error to console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <DemoShellErrorBoundary>
        <BrokenChild />
      </DemoShellErrorBoundary>,
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DemoShellHost] Crashed'),
      expect.any(Error),
      expect.anything(),
    );
  });

  it('siblings of the boundary are unaffected when child throws', () => {
    // Simulate the pattern in AppDemoShellMount — the boundary is outside the
    // main app div, so a crash must not unmount siblings.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <>
        <DemoShellErrorBoundary>
          <BrokenChild />
        </DemoShellErrorBoundary>
        <div data-testid="app-content">App is still alive</div>
      </>,
    );

    expect(screen.getByTestId('app-content')).toBeTruthy();
    consoleSpy.mockRestore();
  });

  it('applies act() so state updates flush without warnings', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      render(
        <DemoShellErrorBoundary>
          <BrokenChild />
        </DemoShellErrorBoundary>,
      );
    });

    expect(document.getElementById('demo-hub-error')).toBeTruthy();
    consoleSpy.mockRestore();
  });

  it('portals the error card into the Demo Hub mount when it is registered', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mount = document.createElement('div');
    mount.id = DEMO_HUB_MOUNT_ID;
    document.body.appendChild(mount);
    registerDemoHubMount(mount);

    render(
      <DemoShellErrorBoundary>
        <BrokenChild />
      </DemoShellErrorBoundary>,
    );

    expect(mount.querySelector('#demo-hub-error')).toBeTruthy();
    expect(mount.textContent).toContain('Learning Hub failed to load');
    registerDemoHubMount(null);
    mount.remove();
    consoleSpy.mockRestore();
  });
});
