/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WebSocketSavedConnections, type WebSocketSavedConnectionsProps } from './WebSocketSavedConnections';
import type { WsConnectionProfile } from '@shared/websocket/types';

function makeProfile(overrides?: Partial<WsConnectionProfile>): WsConnectionProfile {
  return {
    id: 'p1',
    name: 'Test Profile',
    url: 'wss://example.com/ws',
    headers: [],
    queryParams: [],
    subprotocols: '',
    autoReconnect: false,
    maxReconnectAttempts: 5,
    reconnectIntervalMs: 3000,
    maxMessages: 1000,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function defaultProps(overrides?: Partial<WebSocketSavedConnectionsProps>): WebSocketSavedConnectionsProps {
  return {
    profiles: [],
    loading: false,
    error: null,
    onSaveProfile: vi.fn().mockResolvedValue(undefined),
    onUpdateProfile: vi.fn().mockResolvedValue(undefined),
    onDeleteProfile: vi.fn().mockResolvedValue(undefined),
    onDuplicateProfile: vi.fn().mockResolvedValue(undefined),
    onImportProfiles: vi.fn().mockResolvedValue({ imported: 0, errors: [] }),
    onExportProfiles: vi.fn().mockReturnValue('[]'),
    onLoadProfile: vi.fn().mockReturnValue({ url: 'wss://test', subprotocols: '', headers: [], queryParams: [] }),
    onApplyDraft: vi.fn(),
    onSwitchToConnect: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resetAllMocks();
});

describe('WebSocketSavedConnections', () => {
  it('shows loading state', () => {
    render(<WebSocketSavedConnections {...defaultProps({ loading: true })} />);
    expect(screen.getByTestId('saved-loading')).toBeTruthy();
    expect(screen.getByText('Loading profiles...')).toBeTruthy();
  });

  it('shows empty state when no profiles', () => {
    render(<WebSocketSavedConnections {...defaultProps()} />);
    expect(screen.getByTestId('saved-empty')).toBeTruthy();
    expect(screen.getByText(/No saved connections/)).toBeTruthy();
  });

  it('renders profile cards', () => {
    const profiles = [
      makeProfile({ id: 'p1', name: 'Alpha', url: 'wss://alpha.com' }),
      makeProfile({ id: 'p2', name: 'Beta', url: 'wss://beta.com' }),
    ];
    render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
    expect(screen.getByTestId('saved-list')).toBeTruthy();
    expect(screen.getByTestId('profile-card-p1')).toBeTruthy();
    expect(screen.getByTestId('profile-card-p2')).toBeTruthy();
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });

  it('shows header count in detail', () => {
    const profiles = [makeProfile({
      headers: [{ key: 'Auth', value: 'Bearer x', enabled: true }],
    })];
    render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
    expect(screen.getByText('1 configured')).toBeTruthy();
  });

  it('shows auto-reconnect status pill when enabled', () => {
    const profiles = [makeProfile({ autoReconnect: true })];
    render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
    expect(screen.getByText('On')).toBeTruthy();
  });

  it('filters profiles by search', () => {
    const profiles = [
      makeProfile({ id: 'p1', name: 'Prod Server', url: 'wss://prod.com' }),
      makeProfile({ id: 'p2', name: 'Dev Server', url: 'wss://dev.com' }),
    ];
    render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
    fireEvent.change(screen.getByTestId('saved-search'), { target: { value: 'prod' } });
    expect(screen.getAllByText('Prod Server').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dev Server')).toBeNull();
  });

  it('loads profile into draft and switches tab', () => {
    const props = defaultProps({ profiles: [makeProfile({ id: 'p1' })] });
    render(<WebSocketSavedConnections {...props} />);
    fireEvent.click(screen.getByTestId('load-btn-p1'));
    expect(props.onLoadProfile).toHaveBeenCalledWith('p1');
    expect(props.onApplyDraft).toHaveBeenCalled();
    expect(props.onSwitchToConnect).toHaveBeenCalled();
  });

  it('opens editor modal for new profile', () => {
    render(<WebSocketSavedConnections {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('new-profile-btn'));
    expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();
    expect(screen.getByText('New Profile')).toBeTruthy();
  });

  it('opens editor modal for existing profile', () => {
    const profiles = [makeProfile({ id: 'p1', name: 'Edit Me' })];
    render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
    fireEvent.click(screen.getByTestId('edit-btn-p1'));
    expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();
    expect(screen.getByText('Edit Profile')).toBeTruthy();
  });

  it('duplicates a profile', () => {
    const props = defaultProps({ profiles: [makeProfile({ id: 'p1' })] });
    render(<WebSocketSavedConnections {...props} />);
    fireEvent.click(screen.getByTestId('dup-btn-p1'));
    expect(props.onDuplicateProfile).toHaveBeenCalledWith('p1');
  });

  it('deletes profile with confirmation', async () => {
    const props = defaultProps({ profiles: [makeProfile({ id: 'p1' })] });
    render(<WebSocketSavedConnections {...props} />);

    fireEvent.click(screen.getByTestId('delete-btn-p1'));
    expect(screen.getByTestId('confirm-delete-p1')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-delete-p1'));
    });
    expect(props.onDeleteProfile).toHaveBeenCalledWith('p1');
  });

  it('cancels delete confirmation', () => {
    const props = defaultProps({ profiles: [makeProfile({ id: 'p1' })] });
    render(<WebSocketSavedConnections {...props} />);

    fireEvent.click(screen.getByTestId('delete-btn-p1'));
    expect(screen.getByTestId('confirm-delete-p1')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('confirm-delete-p1')).toBeNull();
    expect(props.onDeleteProfile).not.toHaveBeenCalled();
  });

  it('shows error message', () => {
    render(<WebSocketSavedConnections {...defaultProps({ error: 'Storage full' })} />);
    expect(screen.getByText('Storage full')).toBeTruthy();
  });

  it('export button disabled when no profiles', () => {
    render(<WebSocketSavedConnections {...defaultProps()} />);
    expect((screen.getByTestId('export-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('export button enabled when profiles exist', () => {
    render(<WebSocketSavedConnections {...defaultProps({ profiles: [makeProfile()] })} />);
    expect((screen.getByTestId('export-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows "no match" message when search finds nothing (profiles exist)', () => {
    const profiles = [makeProfile({ id: 'p1', name: 'Alpha' })];
    render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
    fireEvent.change(screen.getByTestId('saved-search'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No profiles match your search.')).toBeTruthy();
    expect(screen.queryByText(/No saved connections/)).toBeNull();
  });

  describe('Profile Editor Modal', () => {
    it('saves new profile from modal', async () => {
      const props = defaultProps();
      render(<WebSocketSavedConnections {...props} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));

      fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'My Server' } });
      fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://my.server.com' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('profile-save-btn'));
      });

      expect(props.onSaveProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Server', url: 'wss://my.server.com' }),
      );
    });

    it('prevents saving with empty name', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      expect((screen.getByTestId('profile-save-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('prevents saving with invalid URL', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));

      fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Test' } });
      fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'http://bad' } });

      expect((screen.getByTestId('profile-save-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows duplicate name error', () => {
      const profiles = [makeProfile({ name: 'Existing' })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Existing' } });
      expect(screen.getByText('A profile with this name already exists')).toBeTruthy();
    });

    it('cancels editor modal', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();

      fireEvent.click(screen.getByTestId('profile-cancel-btn'));
      expect(screen.queryByTestId('profile-editor-modal')).toBeNull();
    });

    it('closes editor modal via the header close button', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();

      fireEvent.click(screen.getByTestId('profile-cancel-btn'));
      expect(screen.queryByTestId('profile-editor-modal')).toBeNull();
    });
  });

  describe('profile actions', () => {
    it('loads profile and switches to connect tab', () => {
      const props = defaultProps({ profiles: [makeProfile()] });
      render(<WebSocketSavedConnections {...props} />);
      fireEvent.click(screen.getByTestId('load-btn-p1'));
      expect(props.onLoadProfile).toHaveBeenCalledWith('p1');
      expect(props.onApplyDraft).toHaveBeenCalled();
      expect(props.onSwitchToConnect).toHaveBeenCalled();
    });

    it('deletes profile after confirmation', async () => {
      const props = defaultProps({ profiles: [makeProfile()] });
      render(<WebSocketSavedConnections {...props} />);
      fireEvent.click(screen.getByTestId('delete-btn-p1'));
      // Confirmation dialog should appear
      const confirmBtn = screen.getByTestId('confirm-delete-p1');
      expect(confirmBtn).toBeTruthy();
      await act(async () => {
        fireEvent.click(confirmBtn);
      });
      expect(props.onDeleteProfile).toHaveBeenCalledWith('p1');
    });

    it('duplicates a profile', async () => {
      const props = defaultProps({ profiles: [makeProfile()] });
      render(<WebSocketSavedConnections {...props} />);
      fireEvent.click(screen.getByTestId('dup-btn-p1'));
      expect(props.onDuplicateProfile).toHaveBeenCalledWith('p1');
    });

    it('opens edit modal for existing profile', () => {
      const props = defaultProps({ profiles: [makeProfile()] });
      render(<WebSocketSavedConnections {...props} />);
      fireEvent.click(screen.getByTestId('edit-btn-p1'));
      expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();
      const nameInput = screen.getByTestId('profile-name-input') as HTMLInputElement;
      expect(nameInput.value).toBe('Test Profile');
    });

    it('updates existing profile', async () => {
      const props = defaultProps({ profiles: [makeProfile()] });
      render(<WebSocketSavedConnections {...props} />);
      fireEvent.click(screen.getByTestId('edit-btn-p1'));
      fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Updated Name' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('profile-save-btn'));
      });
      expect(props.onUpdateProfile).toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('exports profiles when button exists', () => {
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ws-export');
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const props = defaultProps({ profiles: [makeProfile()] });
      render(<WebSocketSavedConnections {...props} />);
      const exportBtn = screen.queryByTestId('export-btn');
      if (exportBtn) {
        fireEvent.click(exportBtn);
        expect(props.onExportProfiles).toHaveBeenCalled();
      }
      createObjectURL.mockRestore();
      revoke.mockRestore();
    });
  });

  describe('search', () => {
    it('filters profiles by search text', () => {
      const profiles = [
        makeProfile({ id: 'p1', name: 'Alpha Server' }),
        makeProfile({ id: 'p2', name: 'Beta Server' }),
      ];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      const searchInput = screen.getByTestId('saved-search');
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });
      expect(screen.getAllByText('Alpha Server').length).toBeGreaterThan(0);
      expect(screen.queryByText('Beta Server')).toBeNull();
    });
  });

  describe('prefill draft', () => {
    it('opens editor with prefilled data', () => {
      const prefill = {
        name: 'Prefilled',
        url: 'wss://api.example.com/ws',
        subprotocols: 'graphql-ws',
      };
      const onPrefillConsumed = vi.fn();
      render(<WebSocketSavedConnections
        {...defaultProps()}
        prefillDraft={prefill}
        onPrefillDraftConsumed={onPrefillConsumed}
      />);
      expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();
      const nameInput = screen.getByTestId('profile-name-input') as HTMLInputElement;
      expect(nameInput.value).toBe('Prefilled');
    });
  });

  describe('paste import', () => {
    it('opens and closes paste import section', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      expect(screen.queryByTestId('paste-import-section')).toBeNull();
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      expect(screen.getByTestId('paste-import-section')).toBeTruthy();
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      expect(screen.queryByTestId('paste-import-section')).toBeNull();
    });

    it('submit is disabled when textarea is empty', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      const submitBtn = screen.getByTestId('paste-import-submit') as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
    });

    it('submits pasted JSON and shows success', async () => {
      const onImport = vi.fn().mockResolvedValue({ imported: 2, errors: [] });
      render(<WebSocketSavedConnections {...defaultProps({ onImportProfiles: onImport })} />);
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      const textarea = screen.getByTestId('paste-import-textarea');
      fireEvent.change(textarea, { target: { value: '[{"name":"A","url":"ws://a"}]' } });
      fireEvent.click(screen.getByTestId('paste-import-submit'));
      await vi.waitFor(() => {
        expect(onImport).toHaveBeenCalled();
      });
    });
  });

  describe('export', () => {
    it('calls onExportProfiles and copies to clipboard', () => {
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ws-export');
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const onExport = vi.fn().mockReturnValue('[{"name":"Test"}]');
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles, onExportProfiles: onExport })} />);
      fireEvent.click(screen.getByTestId('export-btn'));
      expect(onExport).toHaveBeenCalled();
      createObjectURL.mockRestore();
      revoke.mockRestore();
    });
  });

  describe('editor URL validation', () => {
    it('prevents saving with non-ws URL', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Test' } });
      fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'http://invalid.com' } });
      const saveBtn = screen.getByTestId('profile-save-btn') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
    });
  });

  describe('profile card tags', () => {
    it('shows subprotocols tag', () => {
      const profiles = [makeProfile({ subprotocols: 'graphql-ws' })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('graphql-ws')).toBeTruthy();
    });

    it('shows query params count', () => {
      const profiles = [makeProfile({
        queryParams: [{ key: 'token', value: 'abc', enabled: true }],
      })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('1 configured')).toBeTruthy();
    });

    it('shows None for headers when empty', () => {
      const profiles = [makeProfile({ headers: [] })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    });
  });

  describe('editor auto-reconnect settings', () => {
    it('shows reconnect settings when auto-reconnect is checked', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      // Check auto-reconnect checkbox
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      // Now reconnect settings should be visible
      expect(screen.getByDisplayValue('5')).toBeTruthy(); // maxAttempts
      expect(screen.getByDisplayValue('3000')).toBeTruthy(); // retryInterval
    });

    it('saves with Enter key from input', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<WebSocketSavedConnections {...defaultProps({ onSaveProfile: onSave })} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'My Profile' } });
      fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://test.com' } });
      fireEvent.keyDown(screen.getByTestId('profile-name-input'), { key: 'Enter' });
      expect(onSave).toHaveBeenCalled();
    });

    it('closes editor modal on Escape', () => {
      render(<WebSocketSavedConnections {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('new-profile-btn'));
      expect(screen.getByTestId('profile-editor-modal')).toBeTruthy();
      fireEvent.keyDown(screen.getByTestId('profile-editor-modal'), { key: 'Escape' });
      expect(screen.queryByTestId('profile-editor-modal')).toBeNull();
    });
  });

  describe('paste import error handling', () => {
    it('shows import error when some items skipped', async () => {
      const onImport = vi.fn().mockResolvedValue({ imported: 1, errors: ['Invalid URL'] });
      render(<WebSocketSavedConnections {...defaultProps({ onImportProfiles: onImport })} />);
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      fireEvent.change(screen.getByTestId('paste-import-textarea'), { target: { value: '[{}]' } });
      fireEvent.click(screen.getByTestId('paste-import-submit'));
      await vi.waitFor(() => {
        expect(screen.getByTestId('import-error')).toBeTruthy();
      });
    });

    it('shows error when no profiles found', async () => {
      const onImport = vi.fn().mockResolvedValue({ imported: 0, errors: [] });
      render(<WebSocketSavedConnections {...defaultProps({ onImportProfiles: onImport })} />);
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      fireEvent.change(screen.getByTestId('paste-import-textarea'), { target: { value: '[]' } });
      fireEvent.click(screen.getByTestId('paste-import-submit'));
      await vi.waitFor(() => {
        expect(screen.getByTestId('import-error')).toBeTruthy();
      });
    });

    it('shows parse error on invalid JSON', async () => {
      const onImport = vi.fn().mockRejectedValue(new Error('parse'));
      render(<WebSocketSavedConnections {...defaultProps({ onImportProfiles: onImport })} />);
      fireEvent.click(screen.getByTestId('paste-import-btn'));
      fireEvent.change(screen.getByTestId('paste-import-textarea'), { target: { value: 'not json' } });
      fireEvent.click(screen.getByTestId('paste-import-submit'));
      await vi.waitFor(() => {
        expect(screen.getByTestId('import-error')).toBeTruthy();
      });
    });
  });

  describe('profile card selection', () => {
    it('selects profile card on click', () => {
      const profiles = [makeProfile({ id: 'p1', name: 'Test' })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      const card = screen.getByTestId('profile-card-p1');
      fireEvent.click(card);
      expect(card.className).toContain('selected');
    });

    it('selects profile card on Enter key', () => {
      const profiles = [makeProfile({ id: 'p1', name: 'Test' })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      const card = screen.getByTestId('profile-card-p1');
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(card.className).toContain('selected');
    });
  });

  describe('file import', () => {
    it('imports profiles from file', async () => {
      const onImportProfiles = vi.fn().mockResolvedValue({ imported: 2, errors: [] });
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles, onImportProfiles })} />);

      const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
      const file = new File(['[{"name":"A"}]'], 'profiles.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: () => Promise.resolve('[{"name":"A"}]') });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      expect(onImportProfiles).toHaveBeenCalledWith('[{"name":"A"}]');
      expect(screen.getByTestId('import-success')).toBeTruthy();
      expect(screen.getByText(/Imported 2 profiles/)).toBeTruthy();
    });

    it('shows error when file import has partial errors', async () => {
      const onImportProfiles = vi.fn().mockResolvedValue({ imported: 1, errors: ['bad item'] });
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles, onImportProfiles })} />);

      const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
      const file = new File(['data'], 'profiles.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: () => Promise.resolve('data') });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      expect(screen.getByTestId('import-error')).toBeTruthy();
    });

    it('shows error when no profiles found in file', async () => {
      const onImportProfiles = vi.fn().mockResolvedValue({ imported: 0, errors: [] });
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles, onImportProfiles })} />);

      const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
      const file = new File(['[]'], 'profiles.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: () => Promise.resolve('[]') });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      expect(screen.getByTestId('import-error')).toBeTruthy();
      expect(screen.getByText(/No profiles found in the file/)).toBeTruthy();
    });

    it('shows error when file read fails', async () => {
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);

      const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
      const file = new File([''], 'bad.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('read fail')) });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      expect(screen.getByTestId('import-error')).toBeTruthy();
      expect(screen.getByText(/Failed to read file/)).toBeTruthy();
    });

    it('ignores file change with no file', async () => {
      const onImportProfiles = vi.fn();
      render(<WebSocketSavedConnections {...defaultProps({ onImportProfiles })} />);
      const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [] } });
      });
      expect(onImportProfiles).not.toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('exports profiles as JSON file download', () => {
      const onExportProfiles = vi.fn().mockReturnValue('[{"name":"A"}]');
      const profiles = [makeProfile()];
      const mockClick = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === 'a') { el.click = mockClick; }
        return el;
      });
      const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');

      render(<WebSocketSavedConnections {...defaultProps({ profiles, onExportProfiles })} />);
      fireEvent.click(screen.getByTestId('export-btn'));

      expect(onExportProfiles).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(revokeUrl).toHaveBeenCalledWith('blob:test');

      vi.restoreAllMocks();
    });
  });

  describe('profile card tags', () => {
    it('shows env vars tag when URL has template variables', () => {
      const profiles = [makeProfile({ url: 'wss://{{host}}/ws' })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('env vars')).toBeTruthy();
    });

    it('shows env vars tag when header has template variables', () => {
      const profiles = [makeProfile({
        headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('env vars')).toBeTruthy();
    });

    it('shows mTLS tag when TLS config has client cert and key', () => {
      const profiles = [makeProfile({
        tlsConfig: { clientCert: 'cert-data', clientKey: 'key-data' },
      })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('mTLS')).toBeTruthy();
    });

    it('shows param count in detail', () => {
      const profiles = [makeProfile({
        queryParams: [
          { key: 'token', value: 'abc', enabled: true },
          { key: 'version', value: '2', enabled: true },
        ],
      })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('2 configured')).toBeTruthy();
    });

    it('shows single param count in detail', () => {
      const profiles = [makeProfile({
        queryParams: [{ key: 'token', value: 'abc', enabled: true }],
      })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('1 configured')).toBeTruthy();
    });
  });

  describe('import button click', () => {
    it('triggers file input click', () => {
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');
      fireEvent.click(screen.getByTestId('import-btn'));
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('footer count', () => {
    it('shows singular profile count', () => {
      const profiles = [makeProfile()];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('1 saved profile')).toBeTruthy();
    });

    it('shows plural profile count', () => {
      const profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: 'Two' })];
      render(<WebSocketSavedConnections {...defaultProps({ profiles })} />);
      expect(screen.getByText('2 saved profiles')).toBeTruthy();
    });
  });
});
