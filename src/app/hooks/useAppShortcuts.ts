import { useEffect } from 'react';

export interface ShortcutDef {
  key: string;
  category: string;
  label: string;
  display: string;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

export const GLOBAL_SHORTCUTS: ShortcutDef[] = [
  { key: '?', category: 'Global', label: 'Open keyboard shortcuts', display: '?' },
];

/**
 * Registers the global `?` key handler that toggles the keyboard shortcuts modal.
 * Ignores the key when focus is inside an input, textarea, or contenteditable element.
 */
export function useAppShortcuts(onToggle: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.contentEditable === 'true' ||
        !!target.closest?.('.monaco-editor');
      if (isInput) return;
      e.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);
}
