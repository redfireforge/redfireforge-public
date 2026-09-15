/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequestsSidebarHeader } from './RequestsSidebarHeader';
import type { RequestCollection } from '@shared/types';

const importFn = vi.hoisted(() => vi.fn());

vi.mock('../utils/requestsSidebarImportExport', () => ({
  handleImportToCollection: (...args: unknown[]) => importFn(...args),
}));

function setup(overrides: Partial<Parameters<typeof RequestsSidebarHeader>[0]> = {}) {
  const props = {
    collections: [] as RequestCollection[],
    toast: { show: vi.fn() },
    onImportCollection: vi.fn(),
    onImportFolder: vi.fn(),
    onAddGroup: vi.fn(),
    selectMode: false,
    clearSelection: vi.fn(),
    isAllExpanded: false,
    toggleExpandAll: vi.fn(),
    onExportAll: vi.fn(),
    showAddMenu: false,
    setShowAddMenu: vi.fn(),
    addMenuRef: { current: null },
    startAddGroup: vi.fn(),
    onNewCollection: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    ...overrides,
  };
  render(<RequestsSidebarHeader {...props} />);
  return props;
}

describe('RequestsSidebarHeader', () => {
  beforeEach(() => {
    importFn.mockClear();
  });

  it('exports, expands, and toggles the add menu', () => {
    const props = setup();
    fireEvent.click(screen.getByTitle('Export All'));
    expect(props.onExportAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('req-sidebar-expand-all'));
    expect(props.toggleExpandAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('req-sidebar-add-btn'));
    expect(props.setShowAddMenu).toHaveBeenCalledWith(true);
  });

  it('shows shrink, clear-selection, search clear, and add-menu actions', () => {
    const props = setup({
      selectMode: true,
      isAllExpanded: true,
      showAddMenu: true,
      search: 'ping',
    });
    fireEvent.click(screen.getByTestId('req-sidebar-clear-selection'));
    expect(props.clearSelection).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('req-sidebar-expand-all').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTitle('Clear search'));
    expect(props.setSearch).toHaveBeenCalledWith('');
    fireEvent.change(screen.getByTestId('req-sidebar-search'), { target: { value: 'users' } });
    expect(props.setSearch).toHaveBeenCalledWith('users');
    fireEvent.click(screen.getByTestId('req-add-group'));
    expect(props.startAddGroup).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('req-add-url-collection'));
    expect(props.onNewCollection).toHaveBeenCalledWith('direct');
    fireEvent.click(screen.getByTestId('req-add-env-collection'));
    expect(props.onNewCollection).toHaveBeenCalledWith('multi-env');
  });

  it('imports from the header file input', async () => {
    const props = setup();
    const input = screen.getByTestId('req-sidebar-import-input') as HTMLInputElement;
    const file = new File(['{"type":"requests-all"}'], 'import.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(importFn).toHaveBeenCalledWith(expect.objectContaining({
        collections: props.collections,
        fileContent: '{"type":"requests-all"}',
      }));
    });
  });

  it('ignores empty file-input changes', () => {
    setup();
    fireEvent.change(screen.getByTestId('req-sidebar-import-input'), { target: { files: [] } });
    expect(importFn).not.toHaveBeenCalled();
  });
});
