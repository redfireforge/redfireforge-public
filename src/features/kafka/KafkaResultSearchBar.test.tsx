/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KafkaResultSearchBar } from './KafkaResultSearchBar';

describe('KafkaResultSearchBar', () => {
  it('renders search input and case toggles with prefixed test ids', () => {
    render(
      <KafkaResultSearchBar
        value=""
        onChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        idPrefix="detail-result"
      />,
    );

    expect(screen.getByTestId('detail-result-search-input')).toBeTruthy();
    expect(screen.getByTestId('detail-result-search-ignore-case').className).toContain('is-active');
    expect(screen.queryByTestId('detail-result-search-clear')).toBeNull();
  });

  it('forwards input changes and shows Clear when the query is non-empty', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <KafkaResultSearchBar
        value=""
        onChange={onChange}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        idPrefix="consume-result"
      />,
    );

    fireEvent.change(screen.getByTestId('consume-result-search-input'), {
      target: { value: 'order-1' },
    });
    expect(onChange).toHaveBeenCalledWith('order-1');

    rerender(
      <KafkaResultSearchBar
        value="order-1"
        onChange={onChange}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        idPrefix="consume-result"
      />,
    );
    fireEvent.click(screen.getByTestId('consume-result-search-clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('switches between ignore case and match case', () => {
    const onCaseSensitiveChange = vi.fn();
    render(
      <KafkaResultSearchBar
        value=""
        onChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={onCaseSensitiveChange}
        idPrefix="stream"
      />,
    );

    fireEvent.click(screen.getByTestId('stream-search-match-case'));
    expect(onCaseSensitiveChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('stream-search-ignore-case'));
    expect(onCaseSensitiveChange).toHaveBeenCalledWith(false);
  });

  it('uses custom placeholder and aria label when provided', () => {
    render(
      <KafkaResultSearchBar
        value=""
        onChange={vi.fn()}
        caseSensitive
        onCaseSensitiveChange={vi.fn()}
        idPrefix="custom"
        placeholder="Find in body…"
        ariaLabel="Filter loaded messages"
      />,
    );

    const input = screen.getByTestId('custom-search-input') as HTMLInputElement;
    expect(input.placeholder).toBe('Find in body…');
    expect(input.getAttribute('aria-label')).toBe('Filter loaded messages');
    expect(screen.getByTestId('custom-search-match-case').className).toContain('is-active');
  });
});
