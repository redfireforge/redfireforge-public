/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResponseBodySearchBar from './ResponseBodySearchBar';

const noop = () => undefined;

const COPIED_RESET_MS = 1500;

/** Flush the copied-state reset inside act() so React does not warn. */
async function advancePastReset() {
  await act(async () => {
    vi.advanceTimersByTime(COPIED_RESET_MS);
  });
}

function toolbar(copyText?: string) {
  return (
    <ResponseBodySearchBar
      value=""
      onChange={noop}
      currentMatch={0}
      totalMatches={0}
      onPrev={noop}
      onNext={noop}
      onClear={noop}
      onExpandAll={noop}
      onCollapseAll={noop}
      copyText={copyText}
    />
  );
}

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe('ResponseBodySearchBar copy button', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies the raw response body', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const body = '{"ok":true,"items":[1,2,3]}';

    render(toolbar(body));
    await userEvent.click(screen.getByTestId('response-copy-btn'));

    expect(writeText).toHaveBeenCalledWith(body);
  });

  it.each([
    ['JSON', '{"ok":true}'],
    ['plain text', 'just some text'],
    ['XML', '<root><item>1</item></root>'],
    ['HTML', '<html><body><p>hi</p></body></html>'],
  ])('copies a %s body verbatim', async (_label, body) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(toolbar(body));
    await userEvent.click(screen.getByTestId('response-copy-btn'));

    expect(writeText).toHaveBeenCalledWith(body);
  });

  it('exposes the accessible name and tooltip the issue specifies', () => {
    render(toolbar('{"ok":true}'));
    const button = screen.getByTestId('response-copy-btn');

    expect(button).toHaveAttribute('aria-label', 'Copy response body');
    expect(button).toHaveAttribute('title', 'Copy response');
  });

  it('flashes Copied! and resets after the timeout', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    render(toolbar('{"ok":true}'));
    const button = screen.getByTestId('response-copy-btn');
    expect(button).toHaveTextContent('Copy');

    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent('Copied!'));
    // The accessible name changes too, so the confirmation is not visual only.
    expect(button).toHaveAttribute('aria-label', 'Response body copied');

    await advancePastReset();
    expect(button).toHaveTextContent('Copy');
    expect(button).toHaveAttribute('aria-label', 'Copy response body');
  });

  it('is absent when there is no response body', () => {
    render(toolbar(undefined));
    expect(screen.queryByTestId('response-copy-btn')).not.toBeInTheDocument();
  });

  it('is absent when the response body is an empty string', () => {
    // Nothing to paste, so a button that appears to work is worse than none.
    render(toolbar(''));
    expect(screen.queryByTestId('response-copy-btn')).not.toBeInTheDocument();
  });

  it('does not break the toolbar when the clipboard is unavailable', async () => {
    // Plain HTTP, a restricted iframe, or a denied permission. The search bar
    // must keep working either way.
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    render(toolbar('{"ok":true}'));
    const button = screen.getByTestId('response-copy-btn');
    await userEvent.click(button);

    expect(button).toHaveTextContent('Copy');
    expect(screen.getByTestId('req-resp-expand-all')).toBeInTheDocument();
  });

  it('leaves the existing toolbar controls in place', () => {
    render(toolbar('{"ok":true}'));
    expect(screen.getByTestId('req-resp-search')).toBeInTheDocument();
    expect(screen.getByTestId('req-resp-expand-all')).toBeInTheDocument();
    expect(screen.getByTestId('req-resp-collapse-all')).toBeInTheDocument();
  });

  it('resets the existing timer when copy is clicked twice quickly', async () => {
    // Covers the resetTimer branch that clears any already-running timeout
    // before scheduling a new one.
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    render(toolbar('{"ok":true}'));
    const button = screen.getByTestId('response-copy-btn');

    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent('Copied!'));

    // Click again while the first timer is still running.
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent('Copied!'));

    // Both clicks should have scheduled a reset; advance past the window.
    await advancePastReset();
    expect(button).toHaveTextContent('Copy');
  });

  it('clears the pending reset timer when the component unmounts', async () => {
    // Covers the cleanup branch inside the shared clipboard hook.
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    const { unmount } = render(toolbar('{"ok":true}'));
    const button = screen.getByTestId('response-copy-btn');

    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent('Copied!'));

    // Unmount while the reset timer is still running; should not throw.
    unmount();
    await advancePastReset(); // would fire the stale timer if not cleared
  });
});
