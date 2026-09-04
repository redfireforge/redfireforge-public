/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('KeyboardShortcutsModal', () => {
  it('renders the modal with the correct test id', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeTruthy();
  });

  it('has role="dialog" on the modal element', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
  });

  it('has aria-modal="true" on the dialog element', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('renders the title "Keyboard shortcuts"', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
  });

  it('renders the Global shortcuts section', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Global')).toBeTruthy();
  });

  it('renders the Workflow shortcuts sections', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Workflow')).toBeTruthy();
  });

  it('renders the Requests section', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Requests')).toBeTruthy();
  });

  it('renders at least one <kbd> element per shortcut', () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const kbdElements = container.querySelectorAll('.ks-modal-key');
    expect(kbdElements.length).toBeGreaterThan(0);
  });

  it('renders the ? shortcut row', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Open keyboard shortcuts')).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('renders a "Send request" shortcut row', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Send request')).toBeTruthy();
  });

  it('renders a footer Close button and no header ×', () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('Close')).toBeTruthy();
    expect(container.querySelector('.ram-modal-close')).toBeNull();
  });

  it('calls onClose when the footer Close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('enables drag on the title bar', () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const header = container.querySelector('.ks-modal-header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.cursor).toBe('move');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the overlay backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardShortcutsModal onClose={onClose} />);
    const overlay = container.querySelector('.ks-modal-overlay');
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside the dialog', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders shortcut rows with label and key elements', () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const rows = container.querySelectorAll('.ks-modal-row');
    expect(rows.length).toBeGreaterThan(5);
    for (const row of Array.from(rows)) {
      expect(row.querySelector('.ks-modal-label')).toBeTruthy();
      expect(row.querySelector('.ks-modal-keys')).toBeTruthy();
    }
  });

  it('renders plus separators for multi-part key combos', () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const plusSeparators = container.querySelectorAll('.ks-modal-sep');
    expect(plusSeparators.length).toBeGreaterThan(0);
  });

  it('has the correct CSS class on the modal shell', () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const shell = container.querySelector('.ks-modal-shell');
    expect(shell).toBeTruthy();
  });

  it('displays Workflow-specific shortcuts like Save', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('displays Canvas section shortcuts like Zoom to fit', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Zoom to fit')).toBeTruthy();
  });

  it('displays Editing section shortcuts like Undo', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByText('Undo')).toBeTruthy();
  });
});
