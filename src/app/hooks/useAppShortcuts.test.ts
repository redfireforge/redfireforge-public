/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppShortcuts, GLOBAL_SHORTCUTS } from './useAppShortcuts';

function pressKey(key: string, opts: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  target?: EventTarget | null;
} = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  vi.spyOn(event, 'preventDefault');
  Object.defineProperty(event, 'target', { value: opts.target ?? document.body, enumerable: true });
  window.dispatchEvent(event);
  return event;
}

describe('useAppShortcuts', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onToggle when ? is pressed without a modifier', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    pressKey('?');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('prevents the default event when ? is pressed', () => {
    renderHook(() => useAppShortcuts(vi.fn()));
    const event = pressKey('?');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not call onToggle when a different key is pressed', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    pressKey('a');
    pressKey('Escape');
    pressKey('Enter');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not call onToggle when ? is pressed with metaKey', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    pressKey('?', { metaKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not call onToggle when ? is pressed with ctrlKey', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    pressKey('?', { ctrlKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not call onToggle when ? is pressed inside an INPUT', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    const input = document.createElement('input');
    pressKey('?', { target: input });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not call onToggle when ? is pressed inside a TEXTAREA', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    const textarea = document.createElement('textarea');
    pressKey('?', { target: textarea });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not call onToggle when ? is pressed inside a contenteditable element', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    const div = document.createElement('div');
    div.contentEditable = 'true';
    pressKey('?', { target: div });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not call onToggle when ? is pressed inside a monaco editor', () => {
    const onToggle = vi.fn();
    renderHook(() => useAppShortcuts(onToggle));
    const monacoContainer = document.createElement('div');
    monacoContainer.className = 'monaco-editor';
    const inner = document.createElement('div');
    monacoContainer.appendChild(inner);
    document.body.appendChild(monacoContainer);
    pressKey('?', { target: inner });
    expect(onToggle).not.toHaveBeenCalled();
    monacoContainer.remove();
  });

  it('removes the keydown listener on unmount', () => {
    const onToggle = vi.fn();
    const { unmount } = renderHook(() => useAppShortcuts(onToggle));
    unmount();
    pressKey('?');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('re-registers the listener when onToggle reference changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook<void, { cb: () => void }>(
      ({ cb }) => useAppShortcuts(cb),
      { initialProps: { cb: first } },
    );
    pressKey('?');
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second });
    pressKey('?');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe('GLOBAL_SHORTCUTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(GLOBAL_SHORTCUTS)).toBe(true);
    expect(GLOBAL_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('includes the ? shortcut', () => {
    const questionMark = GLOBAL_SHORTCUTS.find((s) => s.key === '?');
    expect(questionMark).toBeDefined();
    expect(questionMark?.display).toBe('?');
  });

  it('each shortcut has all required fields', () => {
    for (const s of GLOBAL_SHORTCUTS) {
      expect(s.key).toBeTruthy();
      expect(s.category).toBe('Global');
      expect(s.label).toBeTruthy();
      expect(s.display).toBeTruthy();
    }
  });
});
