/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CatalogRequestBodyView from './CatalogRequestBodyView';

const BODY = JSON.stringify({
  enrollmentPayload: {
    enrollmentType: 'string',
    pendingActivation: false,
    count: 2,
  },
});

describe('CatalogRequestBodyView', () => {
  it('renders a recognized JSON tree with search, expand, collapse, and copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    Element.prototype.scrollIntoView = vi.fn();
    render(<CatalogRequestBodyView json={BODY} />);

    expect(screen.getByPlaceholderText('Search request body...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse All' })).toBeInTheDocument();
    expect(screen.getByText('"enrollmentType"')).toBeInTheDocument();
    expect(document.querySelector('.jt-str')?.textContent).toContain('string');
    expect(document.querySelector('.jt-bool')?.textContent).toBe('false');
    expect(document.querySelector('.jt-num')?.textContent).toBe('2');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse All' }));
    expect(screen.queryByText('"enrollmentType"')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand All' }));
    expect(screen.getByText('"enrollmentType"')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search request body...'), { target: { value: 'pending' } });
    expect(document.querySelector('.jt-key-match')?.textContent).toContain('pending');
    expect(screen.getByText('1/1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByPlaceholderText('Search request body...')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Copy request body' }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(JSON.parse(BODY), null, 2));
  });

  it('edits the body in try-it-out and returns to the tree when the JSON is valid', async () => {
    const onChange = vi.fn();
    render(<CatalogRequestBodyView json={BODY} editable onChange={onChange} />);

    await userEvent.click(screen.getByTestId('catalog-body-edit'));
    const editor = screen.getByTestId('catalog-body-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"vin":"ABC"}' } });
    expect(onChange).toHaveBeenCalledWith('{"vin":"ABC"}');

    await userEvent.click(screen.getByTestId('catalog-body-preview'));
    expect(screen.getByTestId('catalog-request-body-json')).toBeInTheDocument();
  });

  it('renders an empty body without a copy button', () => {
    render(<CatalogRequestBodyView json="" />);
    expect(screen.queryByRole('button', { name: 'Copy request body' })).not.toBeInTheDocument();
  });

  it('shows raw text and skips collapse when the example is not JSON', async () => {
    render(<CatalogRequestBodyView json="not-json" />);
    expect(screen.getByText('not-json')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse All' }));
    expect(screen.getByText('not-json')).toBeInTheDocument();
  });

  it('keeps the editor open when the body is not JSON', () => {
    render(<CatalogRequestBodyView json="not-json" editable onChange={vi.fn()} />);
    expect(screen.getByTestId('catalog-body-editor')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-body-preview')).toBeDisabled();
  });

  it('resizes the body from the bottom-right handle', () => {
    render(<CatalogRequestBodyView json={BODY} />);
    const frame = screen.getByTestId('catalog-request-body-json');
    const handle = screen.getByRole('button', { name: 'Resize request body' });
    const release = vi.fn();
    handle.setPointerCapture = vi.fn(() => { throw new Error('unsupported'); });
    handle.releasePointerCapture = release;
    handle.hasPointerCapture = vi.fn().mockReturnValue(false);
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerMove(handle, { clientY: 400 });
    expect(frame).toHaveStyle({ height: '280px' });

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 180, pointerId: 1 });
    expect(frame).toHaveStyle({ height: '360px' });

    handle.hasPointerCapture = vi.fn().mockReturnValue(true);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(release).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
    expect(frame).toHaveStyle({ height: '360px' });

    fireEvent.pointerDown(handle, { clientY: 180, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: -40, pointerId: 1 });
    expect(frame).toHaveStyle({ height: '160px' });
    handle.hasPointerCapture = vi.fn().mockReturnValue(false);
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });
});
