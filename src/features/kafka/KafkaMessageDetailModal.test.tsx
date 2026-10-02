/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('focuses the body search on Cmd+F', () => {
    renderModal();
    const search = screen.getByTestId('kmd-body-search');
    fireEvent.keyDown(document, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(search);
  });
});
