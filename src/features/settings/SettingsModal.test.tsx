// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { selectOption } from '@test-utils/customSelectHelper';
import SettingsPage from './SettingsModal';
import type { GlobalAuthProfile, AuthType } from '@shared/types';

// ── Mock storage ──
vi.mock('../../shared/utils/storage', () => ({
  getStorageUsage: vi.fn().mockResolvedValue({ usedBytes: 0, entries: {} }),
  getMaxRuns: vi.fn().mockResolvedValue(50),
}));

// ── Mock audit log ──
vi.mock('../audit/utils/auditLog', () => ({
  logAuthProfileCreated: vi.fn(),
  logAuthProfileDeleted: vi.fn(),
  logAuthProfileRenamed: vi.fn(),
  logAuthProfileUpdated: vi.fn(),
}));

// ── Mock child tabs/panels to isolate this component ──
vi.mock('./SettingsStorageTab', () => ({ default: () => <div data-testid="storage-tab" /> }));
vi.mock('./SettingsExportImportTab', () => ({ default: () => <div data-testid="export-import-tab" /> }));
vi.mock('../audit/components/AuditLogPanel', () => ({ default: () => <div data-testid="audit-log-panel" /> }));
vi.mock('@redfireforge/demo-hub/components/DockerStacksSettings', () => ({
  DockerStacksSettings: () => <div data-testid="docker-settings" />,
}));

// ── Mock useAuthVerify hook with mutable module-level state ──
let mockAuthVerifying = false;
let mockAuthVerifyResult: { ok: boolean; message: string } | null = null;
const mockVerify = vi.fn();
const mockSetVerifyResult = vi.fn();
vi.mock('../requests/hooks/useAuthVerify', () => ({
  useAuthVerify: () => ({
    authVerifying: mockAuthVerifying,
    authVerifyResult: mockAuthVerifyResult,
    setAuthVerifyResult: mockSetVerifyResult,
    verifyAuth: mockVerify,
  }),
}));

import {
  logAuthProfileCreated,
  logAuthProfileDeleted,
  logAuthProfileRenamed,
  logAuthProfileUpdated,
} from '../audit/utils/auditLog';
import {
  requestOpenDockerSettings,
  resetDockerSettingsNav,
} from '@redfireforge/demo-hub/utils/dockerSettingsNav';

const mCreated = vi.mocked(logAuthProfileCreated);
const mDeleted = vi.mocked(logAuthProfileDeleted);
const mRenamed = vi.mocked(logAuthProfileRenamed);
const mUpdated = vi.mocked(logAuthProfileUpdated);

function makeProfile(id: string, name: string, type: AuthType = 'none'): GlobalAuthProfile {
  return { id, name, auth: { type } as GlobalAuthProfile['auth'] };
}

/** Stateful harness so setAppGlobalAuthProfiles updates re-render with new profiles. */
function Harness({
  initialProfiles = [],
  confirmImpl,
  onImport = vi.fn(),
}: {
  initialProfiles?: GlobalAuthProfile[];
  confirmImpl?: (message: string, onConfirm: () => void) => void;
  onImport?: (data: unknown) => void;
}) {
  const [profiles, setProfiles] = useState<GlobalAuthProfile[]>(initialProfiles);
  return (
    <SettingsPage
      appGlobalAuthProfiles={profiles}
      setAppGlobalAuthProfiles={setProfiles}
      environments={[{ id: 'e1', name: 'Dev' }]}
      microservices={[{ id: 's1', name: 'Svc', baseUrls: {} }]}
      featureGroups={[]}
      onImport={onImport as never}
      confirm={confirmImpl ?? ((_m, cb) => cb())}
    />
  );
}

beforeEach(() => {
  resetAllMocks();
  mockAuthVerifying = false;
  mockAuthVerifyResult = null;
  resetDockerSettingsNav();
});

describe('SettingsPage — navigation', () => {
  it('renders globalAuth tab by default and loads storage usage', async () => {
    render(<Harness />);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Global Auth Profiles' })).toBeTruthy();
    expect(screen.getByText('No global auth profiles yet.')).toBeTruthy();
    const { getStorageUsage } = await import('../../shared/utils/storage');
    await waitFor(() => expect(getStorageUsage).toHaveBeenCalled());
  });

  it('switches between all four nav tabs', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Storage' }));
    expect(screen.getByTestId('storage-tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export & Import' }));
    expect(screen.getByTestId('export-import-tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Audit Log' }));
    expect(screen.getByTestId('audit-log-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Global Auth Profiles' }));
    expect(screen.getByRole('heading', { name: 'Global Auth Profiles' })).toBeTruthy();
  });

  it('opens the Learning Hub Docker tab from nav and from the manage event', async () => {
    const { OPEN_DOCKER_SETTINGS_EVENT } = await import('@redfireforge/demo-hub/utils/dockerSettingsNav');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('settings-tab-docker'));
    await waitFor(() => expect(screen.getByTestId('docker-settings')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Storage' }));
    expect(screen.queryByTestId('docker-settings')).toBeNull();
    fireEvent(window, new CustomEvent(OPEN_DOCKER_SETTINGS_EVENT));
    await waitFor(() => expect(screen.getByTestId('docker-settings')).toBeTruthy());
  });

  it('does not reopen Docker after the manage event was already handled', async () => {
    const { unmount } = render(<Harness />);
    requestOpenDockerSettings();
    await waitFor(() => expect(screen.getByTestId('docker-settings')).toBeTruthy());
    unmount();
    render(<Harness />);
    expect(screen.queryByTestId('docker-settings')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Global Auth Profiles' })).toBeTruthy();
  });
});

describe('SettingsPage — add profile', () => {
  function nameInput() {
    return screen.getByPlaceholderText(/Profile name/) as HTMLInputElement;
  }

  it('adds a profile via the Add button and logs creation', () => {
    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: 'my-profile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mCreated).toHaveBeenCalledWith('my-profile', expect.any(String));
    // editing opens automatically -> Type select appears
    expect(screen.getByText('Type')).toBeTruthy();
  });

  it('does not add when the name is blank (Add button disabled / guarded)', () => {
    render(<Harness />);
    const addBtn = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    // typing whitespace keeps it effectively empty after trim
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect(addBtn.disabled).toBe(true);
  });

  it('adds a profile via Enter key with a trimmed name', () => {
    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: '  bearer-x  ' } });
    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    expect(mCreated).toHaveBeenCalledWith('bearer-x', expect.any(String));
  });

  it('ignores Enter when the name is empty', () => {
    render(<Harness />);
    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    expect(mCreated).not.toHaveBeenCalled();
  });
});

describe('SettingsPage — profile editing', () => {
  it('renames a profile on blur when the name actually changed', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'old-name')]} />);
    const nameField = document.querySelector('.global-auth-profile-name') as HTMLInputElement;
    // Blur with a different value while state still holds the old name so the
    // rename-detection branch (oldProfile.name !== newName) fires.
    fireEvent.blur(nameField, { target: { value: 'new-name' } });
    expect(mRenamed).toHaveBeenCalledWith('p1', 'old-name', 'new-name');
  });

  it('does not log a rename when the name is unchanged', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'same')]} />);
    const nameField = document.querySelector('.global-auth-profile-name') as HTMLInputElement;
    fireEvent.blur(nameField, { target: { value: 'same' } });
    expect(mRenamed).not.toHaveBeenCalled();
  });

  it('updates the profile name as the user types', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'a')]} />);
    const nameField = document.querySelector('.global-auth-profile-name') as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: 'renamed' } });
    expect((document.querySelector('.global-auth-profile-name') as HTMLInputElement).value).toBe('renamed');
  });

  it('shows a No Auth badge for none-type and a type badge otherwise', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'none'), makeProfile('p2', 'b', 'bearer')]} />);
    expect(screen.getByText('No Auth')).toBeTruthy();
    expect(screen.getByText('BEARER')).toBeTruthy();
  });

  it('toggles Configure/Collapse and resets verify result + secret', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'none')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(mockSetVerifyResult).toHaveBeenCalledWith(null);
    expect(screen.getByText('Type')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('Type')).toBeNull();
  });

  it('deletes a profile through confirm and logs deletion', () => {
    const confirmImpl = vi.fn((_m: string, cb: () => void) => cb());
    render(<Harness initialProfiles={[makeProfile('p1', 'doomed')]} confirmImpl={confirmImpl} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmImpl).toHaveBeenCalledWith('Delete global auth profile "doomed"?', expect.any(Function));
    expect(mDeleted).toHaveBeenCalledWith('doomed', 'p1');
    expect(document.querySelector('.global-auth-profile-card')).toBeNull();
  });

  it('does not delete when confirm is cancelled', () => {
    const confirmImpl = vi.fn(); // never invokes the callback
    render(<Harness initialProfiles={[makeProfile('p1', 'kept')]} confirmImpl={confirmImpl} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mDeleted).not.toHaveBeenCalled();
    expect(document.querySelector('.global-auth-profile-card')).toBeTruthy();
  });
});

describe('SettingsPage — auth type fields', () => {
  function openConfig(profiles: GlobalAuthProfile[]) {
    render(<Harness initialProfiles={profiles} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  }

  it('changes the auth type and logs the update', () => {
    openConfig([makeProfile('p1', 'a', 'none')]);
    selectOption(document.querySelector('.auth-type-select')!, 'Bearer Token');
    expect(mUpdated).toHaveBeenCalledWith('a', 'p1', [
      { field: 'type', oldValue: 'none', newValue: 'bearer' },
    ]);
  });

  it('does not log when the selected type is unchanged', () => {
    openConfig([makeProfile('p1', 'a', 'bearer')]);
    selectOption(document.querySelector('.auth-type-select')!, 'Bearer Token');
    expect(mUpdated).not.toHaveBeenCalled();
  });

  it('renders basic fields and toggles the secret', () => {
    openConfig([makeProfile('p1', 'a', 'basic')]);
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    const inputs = document.querySelectorAll('.form-row.two-col input');
    fireEvent.change(inputs[0], { target: { value: 'user' } });
    fireEvent.change(inputs[1], { target: { value: 'pass' } });
    const pwd = document.querySelector('.secret-input-wrap input') as HTMLInputElement;
    expect(pwd.type).toBe('password');
    fireEvent.click(document.querySelector('.secret-toggle') as HTMLElement);
    expect((document.querySelector('.secret-input-wrap input') as HTMLInputElement).type).toBe('text');
  });

  it('renders bearer fields and edits token/prefix', () => {
    openConfig([makeProfile('p1', 'a', 'bearer')]);
    expect(screen.getByText('Token')).toBeTruthy();
    expect(screen.getByText('Prefix')).toBeTruthy();
    const tokenInput = screen.getByPlaceholderText('eyJhbGciOi...') as HTMLInputElement;
    fireEvent.change(tokenInput, { target: { value: 'tok' } });
    const prefixInput = screen.getByPlaceholderText('Bearer') as HTMLInputElement;
    fireEvent.change(prefixInput, { target: { value: 'Token' } });
  });

  it('renders apikey fields with header/query radios', () => {
    openConfig([makeProfile('p1', 'a', 'apikey')]);
    expect(screen.getByText('Key Name')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('X-API-Key'), { target: { value: 'X-Key' } });
    fireEvent.change(screen.getByPlaceholderText('your-api-key'), { target: { value: 'v' } });
    const radios = document.querySelectorAll('.radio-group input[type="radio"]');
    fireEvent.click(radios[1]); // query
    fireEvent.click(radios[0]); // header
  });

  it('renders digest fields', () => {
    openConfig([makeProfile('p1', 'a', 'digest')]);
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    const inputs = document.querySelectorAll('.form-row.two-col input');
    fireEvent.change(inputs[0], { target: { value: 'user' } });
    fireEvent.change(inputs[1], { target: { value: 'pass' } });
    fireEvent.click(document.querySelector('.secret-toggle') as HTMLElement);
  });

  it('renders oauth2 fields and edits them', () => {
    openConfig([makeProfile('p1', 'a', 'oauth2')]);
    expect(screen.getByText('Token URL')).toBeTruthy();
    expect(screen.getByText('Client ID')).toBeTruthy();
    expect(screen.getByText('Client Secret')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), { target: { value: 'u' } });
    const inputs = document.querySelectorAll('.form-row.two-col input');
    fireEvent.change(inputs[0], { target: { value: 'client-id' } });
    fireEvent.change(inputs[1], { target: { value: 'secret' } });
    fireEvent.click(document.querySelector('.secret-toggle') as HTMLElement);
  });
});

describe('SettingsPage — verify auth', () => {
  it('does not show the verify section for none-type profiles', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'none')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.queryByText('Verify Auth')).toBeNull();
  });

  it('calls verifyAuth when the verify button is clicked', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'bearer')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Auth' }));
    expect(mockVerify).toHaveBeenCalled();
  });

  it('disables the button and shows "Verifying..." while verifying', () => {
    mockAuthVerifying = true;
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'bearer')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const btn = screen.getByRole('button', { name: 'Verifying...' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders a successful verify result', () => {
    mockAuthVerifyResult = { ok: true, message: 'All good' };
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'bearer')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('All good')).toBeTruthy();
    expect(document.querySelector('.auth-verify-ok')).toBeTruthy();
  });

  it('renders a failed verify result', () => {
    mockAuthVerifyResult = { ok: false, message: 'Nope' };
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'bearer')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('Nope')).toBeTruthy();
    expect(document.querySelector('.auth-verify-fail')).toBeTruthy();
  });

  it('clears editing state when deleting the profile being edited', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'doomed', 'bearer')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('Type')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByText('Type')).toBeNull();
  });

  it('renders auth fields with empty defaults when optional values are missing', () => {
    const sparse: GlobalAuthProfile[] = [{
      id: 'p1',
      name: 'Sparse',
      auth: { type: 'basic' } as GlobalAuthProfile['auth'],
    }];
    render(<Harness initialProfiles={sparse} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const username = document.querySelector('.form-row.two-col input') as HTMLInputElement;
    expect(username.value).toBe('');
  });

  it('renders bearer prefix default when prefix is undefined', () => {
    render(<Harness initialProfiles={[{ id: 'p1', name: 'b', auth: { type: 'bearer' } as GlobalAuthProfile['auth'] }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect((screen.getByPlaceholderText('Bearer') as HTMLInputElement).value).toBe('Bearer');
  });

  it('renders apikey header radio as checked by default', () => {
    render(<Harness initialProfiles={[{ id: 'p1', name: 'k', auth: { type: 'apikey' } as GlobalAuthProfile['auth'] }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const headerRadio = document.querySelectorAll('.radio-group input[type="radio"]')[0] as HTMLInputElement;
    expect(headerRadio.checked).toBe(true);
  });

  it('does not log rename when trimmed name is empty', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'old-name')]} />);
    const nameField = document.querySelector('.global-auth-profile-name') as HTMLInputElement;
    fireEvent.blur(nameField, { target: { value: '   ' } });
    expect(mRenamed).not.toHaveBeenCalled();
  });

  it('updates only the targeted profile when multiple profiles exist', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'first'), makeProfile('p2', 'second')]} />);
    const fields = document.querySelectorAll('.global-auth-profile-name') as NodeListOf<HTMLInputElement>;
    fireEvent.change(fields[0], { target: { value: 'first-renamed' } });
    expect(fields[0].value).toBe('first-renamed');
    expect(fields[1].value).toBe('second');
  });

  it('preserves existing basic auth field values when editing', () => {
    render(<Harness initialProfiles={[{
      id: 'p1', name: 'basic-user',
      auth: { type: 'basic', username: 'alice', password: 'secret' },
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
    expect(inputs[0].value).toBe('alice');
    expect(inputs[1].value).toBe('secret');
    fireEvent.change(inputs[0], { target: { value: 'bob' } });
    expect(inputs[0].value).toBe('bob');
  });

  it('preserves existing bearer token and prefix values', () => {
    render(<Harness initialProfiles={[{
      id: 'p1', name: 'bearer-user',
      auth: { type: 'bearer', token: 'tok-123', prefix: 'Token' },
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect((screen.getByPlaceholderText('eyJhbGciOi...') as HTMLInputElement).value).toBe('tok-123');
    expect((screen.getByPlaceholderText('Bearer') as HTMLInputElement).value).toBe('Token');
  });

  it('preserves existing apikey values and query placement', () => {
    render(<Harness initialProfiles={[{
      id: 'p1', name: 'api-user',
      auth: { type: 'apikey', apiKeyName: 'X-Key', apiKeyValue: 'val', apiKeyIn: 'query' },
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect((screen.getByPlaceholderText('X-API-Key') as HTMLInputElement).value).toBe('X-Key');
    expect((screen.getByPlaceholderText('your-api-key') as HTMLInputElement).value).toBe('val');
    const queryRadio = document.querySelectorAll('.radio-group input[type="radio"]')[1] as HTMLInputElement;
    expect(queryRadio.checked).toBe(true);
  });

  it('changes auth type on one profile without mutating another profile', () => {
    render(<Harness initialProfiles={[
      makeProfile('p1', 'alpha', 'none'),
      makeProfile('p2', 'beta', 'bearer'),
    ]} />);
    const configureButtons = screen.getAllByRole('button', { name: 'Configure' });
    fireEvent.click(configureButtons[0]);
    selectOption(document.querySelector('.auth-type-select')!, 'Basic Auth');
    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);
    expect(screen.getByText('BEARER')).toBeTruthy();
  });

  it('preserves existing digest and oauth2 field values', () => {
    render(<Harness initialProfiles={[
      { id: 'p1', name: 'digest-user', auth: { type: 'digest', username: 'd-user', password: 'd-pass' } },
      { id: 'p2', name: 'oauth-user', auth: { type: 'oauth2', tokenUrl: 'https://auth/t', clientId: 'cid', clientSecret: 'sec' } },
    ]} />);
    const configureButtons = screen.getAllByRole('button', { name: 'Configure' });
    fireEvent.click(configureButtons[0]);
    let inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
    expect(inputs[0].value).toBe('d-user');
    expect(inputs[1].value).toBe('d-pass');

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);
    fireEvent.click(configureButtons[1]);
    expect((screen.getByPlaceholderText('https://auth.example.com/oauth/token') as HTMLInputElement).value).toBe('https://auth/t');
    inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
    expect(inputs[0].value).toBe('cid');
    expect(inputs[1].value).toBe('sec');
  });

  it('renders apikey header radio selected when apiKeyIn is header', () => {
    render(<Harness initialProfiles={[{
      id: 'p1', name: 'header-key',
      auth: { type: 'apikey', apiKeyName: 'K', apiKeyValue: 'V', apiKeyIn: 'header' },
    }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const headerRadio = document.querySelectorAll('.radio-group input[type="radio"]')[0] as HTMLInputElement;
    expect(headerRadio.checked).toBe(true);
  });

  it('shows Hide title on secret toggle when secrets are visible', () => {
    render(<Harness initialProfiles={[makeProfile('p1', 'a', 'basic')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const toggle = document.querySelector('.secret-toggle') as HTMLButtonElement;
    expect(toggle.title).toBe('Show');
    fireEvent.click(toggle);
    expect(toggle.title).toBe('Hide');
  });

  it('updates every auth field on one profile without changing the sibling', () => {
    render(<Harness initialProfiles={[
      {
        id: 'p1',
        name: 'alpha',
        auth: {
          type: 'basic',
          username: 'a',
          password: 'p',
        },
      },
      {
        id: 'p2',
        name: 'beta',
        auth: {
          type: 'basic',
          username: 'keep',
          password: 'keep-p',
        },
      },
    ]} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Configure' })[0]);
    const inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
    fireEvent.change(inputs[0], { target: { value: 'a2' } });
    fireEvent.change(inputs[1], { target: { value: 'p2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Configure' })[1]);
    const other = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
    expect(other[0].value).toBe('keep');
    expect(other[1].value).toBe('keep-p');
  });

  it('updates bearer, apikey, digest, and oauth2 fields without mutating the sibling', () => {
    const cases: GlobalAuthProfile[][] = [
      [
        { id: 'p1', name: 'alpha', auth: { type: 'bearer', token: 't1', prefix: 'Bearer' } },
        { id: 'p2', name: 'beta', auth: { type: 'bearer', token: 'keep', prefix: 'Tok' } },
      ],
      [
        { id: 'p1', name: 'alpha', auth: { type: 'apikey', apiKeyName: 'A', apiKeyValue: '1', apiKeyIn: 'header' } },
        { id: 'p2', name: 'beta', auth: { type: 'apikey', apiKeyName: 'Keep', apiKeyValue: 'K', apiKeyIn: 'query' } },
      ],
      [
        { id: 'p1', name: 'alpha', auth: { type: 'digest', username: 'a', password: 'p' } },
        { id: 'p2', name: 'beta', auth: { type: 'digest', username: 'keep', password: 'keep-p' } },
      ],
      [
        { id: 'p1', name: 'alpha', auth: { type: 'oauth2', tokenUrl: 'https://a', clientId: 'a', clientSecret: 's' } },
        { id: 'p2', name: 'beta', auth: { type: 'oauth2', tokenUrl: 'https://keep', clientId: 'keep', clientSecret: 'ks' } },
      ],
    ];
    for (const initial of cases) {
      const { unmount } = render(<Harness initialProfiles={initial} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'Configure' })[0]);
      if (initial[0].auth.type === 'bearer') {
        fireEvent.change(screen.getByPlaceholderText('eyJhbGciOi...'), { target: { value: 't2' } });
        fireEvent.change(screen.getByPlaceholderText('Bearer'), { target: { value: 'X' } });
      } else if (initial[0].auth.type === 'apikey') {
        fireEvent.change(screen.getByPlaceholderText('X-API-Key'), { target: { value: 'B' } });
        fireEvent.change(screen.getByPlaceholderText('your-api-key'), { target: { value: '2' } });
        const radios = document.querySelectorAll('.radio-group input[type="radio"]');
        fireEvent.click(radios[1]);
        fireEvent.click(radios[0]);
      } else if (initial[0].auth.type === 'digest') {
        const inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
        fireEvent.change(inputs[0], { target: { value: 'a2' } });
        fireEvent.change(inputs[1], { target: { value: 'p2' } });
      } else {
        fireEvent.change(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), { target: { value: 'https://b' } });
        const inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
        fireEvent.change(inputs[0], { target: { value: 'a2' } });
        fireEvent.change(inputs[1], { target: { value: 's2' } });
      }
      fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);
      fireEvent.click(screen.getAllByRole('button', { name: 'Configure' })[1]);
      if (initial[1].auth.type === 'bearer') {
        expect((screen.getByPlaceholderText('eyJhbGciOi...') as HTMLInputElement).value).toBe('keep');
        expect((screen.getByPlaceholderText('Bearer') as HTMLInputElement).value).toBe('Tok');
      } else if (initial[1].auth.type === 'apikey') {
        expect((screen.getByPlaceholderText('X-API-Key') as HTMLInputElement).value).toBe('Keep');
        const queryRadio = document.querySelectorAll('.radio-group input[type="radio"]')[1] as HTMLInputElement;
        expect(queryRadio.checked).toBe(true);
      } else if (initial[1].auth.type === 'digest') {
        const other = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
        expect(other[0].value).toBe('keep');
      } else {
        expect((screen.getByPlaceholderText('https://auth.example.com/oauth/token') as HTMLInputElement).value).toBe('https://keep');
      }
      unmount();
    }
  });

  it('updates auth fields on one profile without changing another profile', () => {
    render(<Harness initialProfiles={[
      { id: 'p1', name: 'alpha', auth: { type: 'bearer', token: 'tok-a', prefix: 'Bearer' } },
      { id: 'p2', name: 'beta', auth: { type: 'bearer', token: 'tok-b', prefix: 'Bearer' } },
    ]} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Configure' })[0]);
    fireEvent.change(screen.getByPlaceholderText('eyJhbGciOi...'), { target: { value: 'tok-a-updated' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Configure' })[1]);
    expect((screen.getByPlaceholderText('eyJhbGciOi...') as HTMLInputElement).value).toBe('tok-b');
  });

  it('renders empty controlled values for every auth type field group', () => {
    const types: AuthType[] = ['basic', 'bearer', 'apikey', 'digest', 'oauth2'];
    for (const type of types) {
      const { unmount } = render(<Harness initialProfiles={[makeProfile('p1', type, type)]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
      if (type === 'bearer') {
        const tokenInput = screen.getByPlaceholderText('eyJhbGciOi...') as HTMLInputElement;
        expect(tokenInput.value).toBe('');
        fireEvent.change(tokenInput, { target: { value: 'tok' } });
        fireEvent.change(tokenInput, { target: { value: '' } });
        expect((screen.getByPlaceholderText('Bearer') as HTMLInputElement).value).toBe('Bearer');
      }
      if (type === 'basic' || type === 'digest') {
        const inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
        expect(inputs[0].value).toBe('');
        fireEvent.change(inputs[0], { target: { value: 'user' } });
        fireEvent.change(inputs[0], { target: { value: '' } });
        fireEvent.change(inputs[1], { target: { value: 'pass' } });
        fireEvent.change(inputs[1], { target: { value: '' } });
      }
      if (type === 'apikey') {
        const keyName = screen.getByPlaceholderText('X-API-Key') as HTMLInputElement;
        const keyValue = screen.getByPlaceholderText('your-api-key') as HTMLInputElement;
        fireEvent.change(keyName, { target: { value: 'K' } });
        fireEvent.change(keyName, { target: { value: '' } });
        fireEvent.change(keyValue, { target: { value: 'V' } });
        fireEvent.change(keyValue, { target: { value: '' } });
      }
      if (type === 'oauth2') {
        const tokenUrl = screen.getByPlaceholderText('https://auth.example.com/oauth/token') as HTMLInputElement;
        fireEvent.change(tokenUrl, { target: { value: 'https://auth/t' } });
        fireEvent.change(tokenUrl, { target: { value: '' } });
        const inputs = document.querySelectorAll('.form-row.two-col input') as NodeListOf<HTMLInputElement>;
        fireEvent.change(inputs[0], { target: { value: 'cid' } });
        fireEvent.change(inputs[0], { target: { value: '' } });
        fireEvent.change(inputs[1], { target: { value: 'sec' } });
        fireEvent.change(inputs[1], { target: { value: '' } });
      }
      unmount();
    }
  });
});
