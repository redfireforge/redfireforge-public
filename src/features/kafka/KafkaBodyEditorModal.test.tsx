/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import KafkaBodyEditorModal from './KafkaBodyEditorModal';

describe('KafkaBodyEditorModal', () => {
  it('renders polished chrome with format pill and footer actions', () => {
    render(
      <KafkaBodyEditorModal
        value='{"key":"value"}'
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="json"
      />,
    );

    expect(screen.getByTestId('kafka-body-editor-modal')).toBeInTheDocument();
    expect(screen.getByText('Message body')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.getByText('Valid JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pretty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('applies draft edits and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <KafkaBodyEditorModal
        value='{"a":1}'
        onChange={onChange}
        onClose={onClose}
        format="json"
      />,
    );

    const textarea = screen.getByLabelText('Message body content');
    fireEvent.change(textarea, { target: { value: '{"a":2}' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith('{"a":2}');
    expect(onClose).toHaveBeenCalled();
  });

  it('pretty-prints valid JSON from the toolbar', async () => {
    const user = userEvent.setup();
    render(
      <KafkaBodyEditorModal
        value='{"a":1,"b":2}'
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="json"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pretty' }));
    expect(screen.getByLabelText('Message body content')).toHaveValue('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('handles invalid json in toolbar actions without mutating draft', async () => {
    const user = userEvent.setup();
    render(
      <KafkaBodyEditorModal
        value="{not-json"
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="json"
      />,
    );

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    const textarea = screen.getByLabelText('Message body content');
    expect(textarea).toHaveValue('{not-json');

    await user.click(screen.getByRole('button', { name: 'Pretty' }));
    await user.click(screen.getByRole('button', { name: 'Minify' }));

    expect(textarea).toHaveValue('{not-json');
  });

  it('renders non-json mode without validation badge or json toolbar', () => {
    render(
      <KafkaBodyEditorModal
        value="plain text body"
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="text"
      />,
    );

    expect(screen.getByText('TEXT')).toBeInTheDocument();
    expect(screen.queryByText('Valid JSON')).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid JSON')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pretty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minify' })).not.toBeInTheDocument();
  });

  it('supports keyboard shortcuts for search focus and escape close', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <KafkaBodyEditorModal
        value='{"a":1}'
        onChange={vi.fn()}
        onClose={onClose}
        format="json"
      />,
    );

    const searchInput = screen.getByLabelText('Search body content');
    expect(searchInput).not.toHaveFocus();

    await user.keyboard('{Meta>}f{/Meta}');
    expect(searchInput).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clears search and resets match state via clear button', async () => {
    const user = userEvent.setup();
    render(
      <KafkaBodyEditorModal
        value={'apple\nbanana\napple'}
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="json"
      />,
    );

    const searchInput = screen.getByLabelText('Search body content');
    await user.type(searchInput, 'apple');
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByTestId('kbe-search-current')).toHaveTextContent('apple');

    await user.click(screen.getByLabelText('Clear search'));
    expect(searchInput).toHaveValue('');
    expect(screen.queryByText('1/2')).not.toBeInTheDocument();
  });

  it('highlights the current match and moves to the next one', async () => {
    const user = userEvent.setup();
    render(
      <KafkaBodyEditorModal
        value={'apple\nbanana\napple'}
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="text"
      />,
    );

    const textarea = screen.getByLabelText('Message body content') as HTMLTextAreaElement;
    await user.type(screen.getByLabelText('Search body content'), 'apple');
    expect(screen.getByTestId('kbe-search-current')).toHaveTextContent('apple');
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(5);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(textarea.selectionStart).toBe('apple\nbanana\n'.length);
    expect(textarea.selectionEnd).toBe('apple\nbanana\napple'.length);

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(textarea.selectionStart).toBe(0);
  });

  it('scrolls the current match into view and steps with Enter', async () => {
    const user = userEvent.setup();
    render(
      <KafkaBodyEditorModal
        value={'apple\nbanana\napple'}
        onChange={vi.fn()}
        onClose={vi.fn()}
        format="text"
      />,
    );

    const search = screen.getByLabelText('Search body content');
    const textarea = screen.getByLabelText('Message body content') as HTMLTextAreaElement;
    await user.type(search, 'apple');

    const box = (values: Partial<DOMRect>): DOMRect => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
      ...values,
    });
    const proto = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('kbe-textarea')) {
        return box({ right: 120, bottom: 40, width: 120, height: 40 });
      }
      if (this.tagName === 'MARK') {
        return box({ top: 90, left: -10, right: 240, bottom: 110, width: 250, height: 20 });
      }
      return proto.call(this);
    });

    try {
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(textarea.scrollTop).toBeGreaterThan(0);
      expect(textarea.scrollLeft).toBeLessThan(0);
      fireEvent.scroll(textarea);
      expect(document.querySelector('.kbe-highlight')?.getAttribute('style')).toContain('translate');

      spy.mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('kbe-textarea')) {
          return box({ right: 400, bottom: 80, width: 400, height: 80 });
        }
        if (this.tagName === 'MARK') {
          return box({ top: 10, left: 80, right: 140, bottom: 30, width: 60, height: 20 });
        }
        return proto.call(this);
      });
      const scrollLeft = textarea.scrollLeft;
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(textarea.scrollLeft).toBe(scrollLeft);

      fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
      expect(screen.getByText('2/2')).toBeInTheDocument();
      fireEvent.keyDown(search, { key: 'Enter' });
      expect(screen.getByText('1/2')).toBeInTheDocument();
      await user.clear(search);
      fireEvent.keyDown(search, { key: 'Enter' });
      expect(screen.queryByText('2/2')).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('closes only when clicking overlay itself', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <KafkaBodyEditorModal
        value='{"a":1}'
        onChange={vi.fn()}
        onClose={onClose}
        format="json"
      />,
    );

    await user.click(screen.getByTestId('kafka-body-editor-modal'));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = document.querySelector('.kbe-overlay') as HTMLDivElement;
    expect(overlay).toBeTruthy();
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
