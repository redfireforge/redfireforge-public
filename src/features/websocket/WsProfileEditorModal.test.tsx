/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { selectOption } from '@test-utils/customSelectHelper';
import { ProfileEditorModal } from './WsProfileEditorModal';
import type { WsConnectionProfile } from '@shared/websocket/types';

function makeProfile(overrides?: Partial<WsConnectionProfile>): WsConnectionProfile {
  return {
    id: 'p1',
    name: 'Existing Profile',
    url: 'wss://example.com/ws',
    headers: [{ key: 'X-A', value: '1', enabled: true }],
    queryParams: [{ key: 'q', value: 'v', enabled: true }],
    subprotocols: 'graphql-ws',
    autoReconnect: true,
    maxReconnectAttempts: 7,
    reconnectIntervalMs: 4000,
    backoffMultiplier: 2,
    maxMessages: 2000,
    notes: 'hello',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  resetAllMocks();
});

describe('ProfileEditorModal', () => {
  it('renders "New Profile" title with defaults when no initial/prefill', () => {
    render(<ProfileEditorModal existingNames={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('New Profile')).toBeTruthy();
    expect((screen.getByTestId('profile-url-input') as HTMLInputElement).value).toBe('wss://');
    expect(screen.getByTestId('profile-save-btn')).toBeTruthy();
  });

  it('renders "Edit Profile" and prefills fields from initial', () => {
    render(
      <ProfileEditorModal initial={makeProfile()} existingNames={['Existing Profile']} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('Edit Profile')).toBeTruthy();
    expect((screen.getByTestId('profile-name-input') as HTMLInputElement).value).toBe('Existing Profile');
    expect((screen.getByTestId('profile-url-input') as HTMLInputElement).value).toBe('wss://example.com/ws');
    expect(screen.getByText('Save Changes')).toBeTruthy();
  });

  it('prefills fields from a prefill draft when no initial', () => {
    render(
      <ProfileEditorModal
        prefill={{ name: 'Draft', url: 'ws://draft', notes: 'n', headers: [{ key: 'h', value: '1', enabled: true }] }}
        existingNames={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByTestId('profile-name-input') as HTMLInputElement).value).toBe('Draft');
    expect((screen.getByTestId('profile-url-input') as HTMLInputElement).value).toBe('ws://draft');
  });

  it('clones prefill headers and query params on mount', () => {
    render(
      <ProfileEditorModal
        prefill={{
          name: 'Draft',
          url: 'wss://draft',
          headers: [{ key: 'Pref-H', value: '1', enabled: true }],
          queryParams: [{ key: 'Pref-Q', value: '2', enabled: true }],
        }}
        existingNames={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Pref-H')).toBeTruthy();
    expect(screen.getByDisplayValue('Pref-Q')).toBeTruthy();
  });

  it('falls back to prefill key-value lists when initial profile omits them', () => {
    const base = makeProfile();
    render(
      <ProfileEditorModal
        initial={{ ...base, headers: undefined, queryParams: undefined }}
        prefill={{
          headers: [{ key: 'Fallback-H', value: '1', enabled: true }],
          queryParams: [{ key: 'Fallback-Q', value: '2', enabled: true }],
        }}
        existingNames={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Fallback-H')).toBeTruthy();
    expect(screen.getByDisplayValue('Fallback-Q')).toBeTruthy();
  });

  it('shows a duplicate-name error and disables save', () => {
    render(<ProfileEditorModal existingNames={['Taken']} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Taken' } });
    expect(screen.getByText('A profile with this name already exists')).toBeTruthy();
    expect((screen.getByTestId('profile-save-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a URL validation error for non-ws URLs', () => {
    render(<ProfileEditorModal existingNames={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Ok' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'http://nope' } });
    expect(screen.getByText('URL must start with ws:// or wss://')).toBeTruthy();
    expect((screen.getByTestId('profile-save-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables save and calls onSave with clamped values', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'New One' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://valid/ws' } });
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'New One',
      url: 'wss://valid/ws',
      autoReconnect: false,
      maxMessages: 1000,
    });
  });

  it('does not call onSave when invalid (handleSave guard)', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    // name empty -> invalid; click does nothing (button disabled, but guard also protects)
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onCancel from the Cancel button', () => {
    const onCancel = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('profile-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape keydown', () => {
    const onCancel = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('profile-editor-modal'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('saves on Enter keydown from an input when valid', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'EnterSave' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://x' } });
    fireEvent.keyDown(screen.getByTestId('profile-name-input'), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not save on Enter when the target is not an input', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'EnterSave' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://x' } });
    fireEvent.keyDown(screen.getByTestId('profile-editor-modal'), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('edits subprotocols, notes and max messages and persists them on save', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Full' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://full' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. graphql-ws, json'), { target: { value: 'json' } });
    fireEvent.change(screen.getByPlaceholderText('Optional notes...'), { target: { value: 'my note' } });
    const maxMsgs = screen.getAllByRole('spinbutton').find((el) => (el as HTMLInputElement).max === '50000')!;
    fireEvent.change(maxMsgs, { target: { value: '3000' } });
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      subprotocols: 'json',
      notes: 'my note',
      maxMessages: 3000,
    });
  });

  it('toggles auto-reconnect and edits reconnect fields', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Recon' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://recon' } });
    fireEvent.click(screen.getByRole('checkbox'));
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const maxAttempts = spinners.find((el) => el.max === '50')!;
    const retryInterval = spinners.find((el) => el.max === '60000')!;
    fireEvent.change(maxAttempts, { target: { value: '9' } });
    fireEvent.change(retryInterval, { target: { value: '5000' } });
    selectOption(screen.getByLabelText('Backoff multiplier').closest('.cs-wrapper')!, '1.5×');
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      autoReconnect: true,
      maxReconnectAttempts: 9,
      reconnectIntervalMs: 5000,
      backoffMultiplier: 1.5,
    });
  });

  it('clamps out-of-range reconnect fields on save', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Clamp' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://clamp' } });
    fireEvent.click(screen.getByRole('checkbox'));
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const maxAttempts = spinners.find((el) => el.max === '50')!;
    const retryInterval = spinners.find((el) => el.max === '60000')!;
    const maxMsgs = spinners.find((el) => el.max === '50000')!;
    fireEvent.change(maxAttempts, { target: { value: '999' } });
    fireEvent.change(retryInterval, { target: { value: '100' } });
    fireEvent.change(maxMsgs, { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      maxReconnectAttempts: 50,
      reconnectIntervalMs: 500,
      maxMessages: 100,
    });
  });

  it('falls back to defaults when reconnect inputs are cleared to NaN', () => {
    render(<ProfileEditorModal existingNames={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const maxAttempts = spinners.find((el) => el.max === '50')!;
    const retryInterval = spinners.find((el) => el.max === '60000')!;
    const maxMsgs = spinners.find((el) => el.max === '50000')!;
    fireEvent.change(maxAttempts, { target: { value: '' } });
    fireEvent.change(retryInterval, { target: { value: '' } });
    fireEvent.change(maxMsgs, { target: { value: '' } });
    expect(maxAttempts.value).toBe('5');
    expect(retryInterval.value).toBe('3000');
    expect(maxMsgs.value).toBe('1000');
  });

  it('adds a header and a query param and persists them on save', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'KV' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://kv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add headers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add query parameters' }));
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    const saved = onSave.mock.calls[0][0];
    expect(saved.headers).toHaveLength(1);
    expect(saved.queryParams).toHaveLength(1);
  });

  it('renders existing headers and query params from initial profile', () => {
    render(
      <ProfileEditorModal initial={makeProfile()} existingNames={[]} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect((screen.getByDisplayValue('X-A') as HTMLInputElement)).toBeTruthy();
    expect((screen.getByDisplayValue('q') as HTMLInputElement)).toBeTruthy();
  });

  it('disables save when the profile name exceeds 100 characters', () => {
    render(<ProfileEditorModal existingNames={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'x'.repeat(101) } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://valid' } });
    expect((screen.getByTestId('profile-save-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows saving when editing the same initial profile name (not a duplicate)', () => {
    const onSave = vi.fn();
    render(
      <ProfileEditorModal
        initial={makeProfile({ name: 'Keep Me' })}
        existingNames={['Keep Me', 'Other']}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('omits notes from the saved payload when the notes field is blank', () => {
    const onSave = vi.fn();
    render(<ProfileEditorModal existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'NoNotes' } });
    fireEvent.change(screen.getByTestId('profile-url-input'), { target: { value: 'wss://x' } });
    fireEvent.change(screen.getByPlaceholderText('Optional notes...'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(onSave.mock.calls[0][0].notes).toBeUndefined();
  });

  it('clears all headers and query params via the Delete all buttons', () => {
    const onSave = vi.fn();
    render(
      <ProfileEditorModal initial={makeProfile()} existingNames={[]} onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete all headers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all query parameters' }));
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    const saved = onSave.mock.calls[0][0];
    expect(saved.headers).toHaveLength(0);
    expect(saved.queryParams).toHaveLength(0);
  });
});
