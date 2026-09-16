/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RequestImportExportMenu from './RequestImportExportMenu';

describe('RequestImportExportMenu', () => {
  it('opens a portaled menu and runs cURL / JSON actions', () => {
    const onCurlImport = vi.fn();
    const onCurlExport = vi.fn();
    const onJsonImport = vi.fn();
    const onJsonExport = vi.fn();
    render(
      <RequestImportExportMenu
        onCurlImport={onCurlImport}
        onCurlExport={onCurlExport}
        onJsonImport={onJsonImport}
        onJsonExport={onJsonExport}
      />,
    );

    fireEvent.click(screen.getByTitle('Import / Export'));
    expect(screen.getByTestId('req-action-dropdown').parentElement).toBe(document.body);

    fireEvent.click(screen.getByRole('button', { name: 'cURL Import' }));
    expect(onCurlImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Import / Export'));
    fireEvent.click(screen.getByTestId('req-json-import-btn'));
    expect(onJsonImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Import / Export'));
    fireEvent.click(screen.getByTestId('req-json-export-btn'));
    expect(onJsonExport).toHaveBeenCalledTimes(1);
  });

  it('toggles closed from the button and ignores mousedown on the button or menu', () => {
    render(
      <RequestImportExportMenu
        onCurlImport={vi.fn()}
        onCurlExport={vi.fn()}
        onJsonImport={vi.fn()}
        onJsonExport={vi.fn()}
      />,
    );
    const trigger = screen.getByTitle('Import / Export');
    fireEvent.click(trigger);
    expect(screen.getByTestId('req-action-dropdown')).toBeTruthy();

    fireEvent.mouseDown(trigger);
    expect(screen.getByTestId('req-action-dropdown')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('req-action-dropdown'));
    expect(screen.getByTestId('req-action-dropdown')).toBeTruthy();

    fireEvent.click(screen.getByTestId('req-curl-export-btn'));
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByTestId('req-action-dropdown')).toBeNull();
  });

  it('closes when clicking outside the menu', () => {
    render(
      <RequestImportExportMenu
        onCurlImport={vi.fn()}
        onCurlExport={vi.fn()}
        onJsonImport={vi.fn()}
        onJsonExport={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('Import / Export'));
    expect(screen.getByTestId('req-action-dropdown')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('req-action-dropdown')).toBeNull();
  });
});
