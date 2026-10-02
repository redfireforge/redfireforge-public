/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import KafkaMessageDetailModal from './KafkaMessageDetailModal';
import type { KafkaConsumeResultRow } from './types';

const message: KafkaConsumeResultRow = {
  topic: 'offers',
  partition: 1,
  offset: '72600',
  timestamp: '1759154633000',
  key: 'order-1',
  value: JSON.stringify({ accountType: 'DD', note: 'accountType again' }),
  headers: { trace: 'abc' },
};

function renderModal() {
  return render(
    <KafkaMessageDetailModal message={message} onClose={vi.fn()} />,
  );
}

describe('KafkaMessageDetailModal body search', () => {
  it('places a search field under Message Body', () => {
    renderModal();
    const title = screen.getByText('Message Body');
    const search = screen.getByTestId('kmd-body-search');
    expect(title.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.compareDocumentPosition(screen.getByTestId('kmd-body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('highlights matches and moves between them', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('kmd-body-search'), { target: { value: 'accountType' } });
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('1/2');
    expect(screen.getByTestId('kmd-body-search-current').textContent).toBe('accountType');

    fireEvent.click(screen.getByTestId('kmd-body-search-next'));
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('2/2');

    fireEvent.click(screen.getByTestId('kmd-body-search-prev'));
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('1/2');

    fireEvent.keyDown(screen.getByTestId('kmd-body-search'), { key: 'Enter' });
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('2/2');
    fireEvent.keyDown(screen.getByTestId('kmd-body-search'), { key: 'Enter', shiftKey: true });
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('1/2');
  });

  it('reports no matches and clears on Escape without closing', () => {
    const onClose = vi.fn();
    render(<KafkaMessageDetailModal message={message} onClose={onClose} />);
    const search = screen.getByTestId('kmd-body-search');
    fireEvent.change(search, { target: { value: 'missing-field' } });
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('No matches');
    expect((screen.getByTestId('kmd-body-search-next') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('can ignore case or match case', () => {
    renderModal();
    const search = screen.getByTestId('kmd-body-search');
    expect(screen.getByTestId('kmd-body-search-ignore-case').className).toContain('is-active');

    fireEvent.change(search, { target: { value: 'dd' } });
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('1/1');

    fireEvent.click(screen.getByTestId('kmd-body-search-match-case'));
    expect(screen.getByTestId('kmd-body-search-match-case').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('No matches');

    fireEvent.change(search, { target: { value: 'DD' } });
    expect(screen.getByTestId('kmd-body-search-count').textContent).toBe('1/1');
    expect(screen.getByTestId('kmd-body-search-current').textContent).toBe('DD');
  });

  it('copies the selected header text with Command+C', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderModal();
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'abc' } as Selection);
    fireEvent.keyDown(screen.getByText('abc'), { key: 'c', metaKey: true });
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('copies a header selection with Ctrl+C and skips fields, modifiers, and empty selections', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { unmount } = renderModal();
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'abc' } as Selection);

    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith('abc');

    writeText.mockClear();
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true, altKey: true });
    fireEvent.keyDown(document.body, { key: 'v', metaKey: true });
    fireEvent.keyDown(screen.getByTestId('kmd-body-search'), { key: 'c', metaKey: true });
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    fireEvent.keyDown(area, { key: 'c', metaKey: true });
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: 'c', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(writeText).not.toHaveBeenCalled();

    selection.mockReturnValue({ toString: () => '' } as Selection);
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    expect(writeText).not.toHaveBeenCalled();
    unmount();
  });

  it('focuses the body search on Cmd+F', () => {
    renderModal();
    const search = screen.getByTestId('kmd-body-search');
    fireEvent.keyDown(document, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(search);
  });

  it('copies the key and payload, then clears the copied state', () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderModal();

    fireEvent.click(screen.getByTestId('kmd-copy-key'));
    expect(writeText).toHaveBeenCalledWith('order-1');
    expect(screen.getByTestId('kmd-copy-key').textContent).toContain('Copied');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByTestId('kmd-copy-key').textContent).toBe('Copy');

    fireEvent.click(screen.getByTestId('kmd-copy-payload'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('accountType'));
    expect(screen.getByTestId('kmd-copy-payload').textContent).toContain('Copied');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByTestId('kmd-copy-payload').textContent).toBe('Copy');

    fireEvent.click(screen.getByTestId('kmd-body-search-prev'));
    fireEvent.click(screen.getByTestId('kmd-toggle-headers'));
    expect(screen.queryByTestId('kmd-headers')).toBeNull();
    vi.useRealTimers();
  });

  it('collapses sections, ignores an empty copy, and closes from the overlay', () => {
    const onClose = vi.fn();
    const onUse = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <KafkaMessageDetailModal
        message={{ ...message, key: undefined, headers: {}, timestamp: '', value: 'not-json' }}
        onClose={onClose}
        onUseAsWorkflowInput={onUse}
      />,
    );

    expect(screen.getByTestId('kmd-body').textContent).toContain('not-json');
    expect(screen.getByTestId('kmd-timestamp').textContent).toBe('—');
    expect(screen.getByTestId('kmd-key').textContent).toBe('—');
    expect(screen.queryByTestId('kmd-headers')).toBeNull();

    fireEvent.change(screen.getByTestId('kmd-body-search'), { target: { value: 'not-json' } });
    expect(screen.getByTestId('kmd-body-search-current').textContent).toBe('not-json');
    fireEvent.click(screen.getByTestId('kmd-body-search-prev'));

    fireEvent.click(screen.getByTestId('kmd-body-search-ignore-case'));
    fireEvent.click(screen.getByTestId('kmd-toggle-details'));
    expect(screen.queryByTestId('kmd-offset')).toBeNull();
    fireEvent.click(screen.getByTestId('kmd-toggle-key'));
    expect(screen.queryByTestId('kmd-key')).toBeNull();

    const copyKey = screen.getByTestId('kmd-copy-key') as HTMLButtonElement;
    copyKey.disabled = false;
    fireEvent.click(copyKey);
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('kmd-body-search'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('kmd-workflow-btn'));
    expect(onUse).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('kafka-message-detail-modal'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();

    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });
});
