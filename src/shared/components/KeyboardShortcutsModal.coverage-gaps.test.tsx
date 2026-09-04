/**
 * @vitest-environment jsdom
 *
 * Coverage-gap tests for KeyboardShortcutsModal.
 * These use module-level mocks to exercise branches that the main test file
 * cannot reach because all real shortcuts belong to categories in CATEGORY_ORDER.
 *
 * Branches covered here:
 *  A) `ALL_SHORTCUTS.some((s) => s.category === cat)` → false
 *     (a category in CATEGORY_ORDER has no shortcuts in the active set)
 *  B) `!seen.has(s.category)` → true (lines 30-31)
 *     (a shortcut has a category NOT in CATEGORY_ORDER)
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// These mocks run before the module is imported (hoisted by Vitest).
vi.mock('@app/hooks/useAppShortcuts', () => ({
  GLOBAL_SHORTCUTS: [
    { key: '?', category: 'Global', label: 'Open keyboard shortcuts', display: '?' },
  ],
}));

vi.mock('@workflow/components/canvas/WorkflowShortcutsOverlay', () => ({
  // Only 'Workflow' — deliberately NO 'Canvas' or 'Editing' entries so those
  // CATEGORY_ORDER items hit the `some() === false` branch (branch A).
  SHORTCUTS: [
    { key: 'mod+s', category: 'Workflow', label: 'Save', display: 'Ctrl+S' },
  ],
}));

vi.mock('../../features/requests/hooks/useRequestShortcuts', () => ({
  // Use a category that does NOT appear in CATEGORY_ORDER ('Custom') so the
  // fallback loop at lines 30-31 is exercised (branch B).
  REQUEST_SHORTCUTS: [
    { key: 'mod+enter', category: 'Custom', label: 'Custom action', display: 'Ctrl+Enter' },
  ],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('KeyboardShortcutsModal — getCategories coverage gaps', () => {
  it('renders an unknown category (not in CATEGORY_ORDER) at the end of the list', async () => {
    const { default: KeyboardShortcutsModal } = await import('./KeyboardShortcutsModal');
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    // 'Global' and 'Workflow' are in CATEGORY_ORDER and have shortcuts → rendered
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Workflow')).toBeTruthy();
    // 'Custom' is NOT in CATEGORY_ORDER → rendered via the fallback branch (lines 30-31)
    expect(screen.getByText('Custom')).toBeTruthy();
    // 'Canvas' and 'Editing' are in CATEGORY_ORDER but have no shortcuts → not rendered
    expect(screen.queryByText('Canvas')).toBeNull();
    expect(screen.queryByText('Editing')).toBeNull();
  });

  it('renders shortcuts from the unknown category', async () => {
    const { default: KeyboardShortcutsModal } = await import('./KeyboardShortcutsModal');
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Custom action')).toBeTruthy();
  });
});
