/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KafkaPublishBodySearch,
  KafkaPublishBodySearchBar,
  KafkaPublishBodySearchEditor,
} from './KafkaPublishBodySearch';
import { findTextMatches, scrollTextareaToMatch } from './kafkaBodyTextSearch';

describe('findTextMatches', () => {
  it('finds case-insensitive matches and skips a blank query', () => {
    expect(findTextMatches('Apple apple', '  ')).toEqual([]);
    expect(findTextMatches('Apple apple', 'APPLE')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ]);
  });
});

describe('scrollTextareaToMatch', () => {
  it('scrolls toward the line that holds the match', () => {
    const area = document.createElement('textarea');
    area.value = 'one\ntwo\nthree\nfour';
    area.style.lineHeight = '20px';
    Object.defineProperty(area, 'clientHeight', { value: 20 });
    document.body.appendChild(area);
    scrollTextareaToMatch(area, area.value.indexOf('four'));
    expect(area.scrollTop).toBeGreaterThan(0);
    area.remove();
  });

  it('uses a fallback line height when the computed value is not a number', () => {
    const area = document.createElement('textarea');
    area.value = 'one\ntwo';
    document.body.appendChild(area);
    scrollTextareaToMatch(area, 0);
    expect(area.scrollTop).toBe(0);
    area.remove();
  });
});

function Harness({ text }: { text: string }) {
  return (
    <KafkaPublishBodySearch text={text}>
      <textarea aria-label="Message body content" value={text} readOnly />
    </KafkaPublishBodySearch>
  );
}

function EditableHarness() {
  const [text, setText] = useState('apple pie');
  return (
    <KafkaPublishBodySearch text={text}>
      <textarea
        aria-label="Message body content"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </KafkaPublishBodySearch>
  );
}

describe('KafkaPublishBodySearch', () => {
  it('places the search field between the title and Expand', () => {
    render(
      <KafkaPublishBodySearch text="apple">
        <div>
          <span>Message Body</span>
          <KafkaPublishBodySearchBar />
          <button type="button">Expand</button>
        </div>
        <KafkaPublishBodySearchEditor>
          <textarea aria-label="Message body content" value="apple" readOnly />
        </KafkaPublishBodySearchEditor>
      </KafkaPublishBodySearch>,
    );
    const title = screen.getByText('Message Body');
    const search = screen.getByTestId('pub-body-search');
    const expand = screen.getByRole('button', { name: 'Expand' });
    expect(title.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('highlights the current match and moves with the arrows and Enter', async () => {
    const user = userEvent.setup();
    render(<Harness text={'apple\nbanana\napple'} />);
    const search = screen.getByTestId('pub-body-search');

    await user.type(search, 'apple');
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByTestId('pub-body-search-current').textContent).toBe('apple');
    expect(screen.getByTestId('pub-body-search-current').className).toContain('is-current');

    const box = (values: Partial<DOMRect>): DOMRect => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
      ...values,
    });
    const proto = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('kafka-ms-body-shell')) return box({ bottom: 80, height: 80, width: 200 });
      if (this.tagName === 'MARK') return box({ top: 120, bottom: 136, height: 16, width: 40 });
      return proto.call(this);
    });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('pub-body-shell').scrollTop).toBeGreaterThan(0);
    spy.mockRestore();
    expect(screen.getByText('2/2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('1/2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('1/2')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeTruthy();

    fireEvent.keyDown(search, { key: 'Enter' });
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((search as HTMLInputElement).value).toBe('');
    await user.type(search, 'apple');
    await user.clear(search);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.queryByText('2/2')).toBeNull();
  });

  it('keeps an edited character instead of replacing the highlighted match', async () => {
    const user = userEvent.setup();
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');
    render(<EditableHarness />);
    await user.type(screen.getByTestId('pub-body-search'), 'apple');
    select.mockClear();
    const area = screen.getByLabelText('Message body content') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'apXple pie' } });
    expect(area.value).toBe('apXple pie');
    expect(screen.queryByTestId('pub-body-search-current')).toBeNull();
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });

  it('shows no match when the body does not contain the query', async () => {
    const user = userEvent.setup();
    render(<Harness text="hello" />);
    await user.type(screen.getByTestId('pub-body-search'), 'zzz');
    expect(screen.getByText('No match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.keyDown(screen.getByTestId('pub-body-search'), { key: 'Enter' });
    expect(screen.getByText('No match')).toBeTruthy();
  });
});
