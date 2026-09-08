// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsExportImportTab from './SettingsExportImportTab';
import type { Environment, Microservice, FeatureGroup, GlobalAuthProfile } from '@shared/types';

// ── Mock platform ──
let mockIsTauri = false;
vi.mock('../../shared/utils/platform', () => ({
  isTauri: () => mockIsTauri,
}));

// ── Mock file saver ──
vi.mock('../../shared/utils/fileSaver', () => ({
  saveJsonFile: vi.fn().mockResolvedValue(undefined),
  buildExportFilename: vi.fn().mockReturnValue('redfire-export.json'),
  openJsonFile: vi.fn().mockResolvedValue(null),
}));

// ── Mock version helpers so branches are controllable ──
let mockHasVersionData = false;
vi.mock('../scenarios/utils/scenarioImportExport', () => ({
  countVersions: vi.fn().mockReturnValue({
    responseVersionCount: 0,
    rulesVersionCount: 0,
    definitionVersionCount: 0,
    structureLogCount: 0,
  }),
  hasVersionData: vi.fn(() => mockHasVersionData),
  stripVersions: vi.fn((data: unknown) => data),
}));

import { saveJsonFile, buildExportFilename, openJsonFile } from '@shared/utils/fileSaver';
import { countVersions, stripVersions } from '../scenarios/utils/scenarioImportExport';

const mSave = vi.mocked(saveJsonFile);
const mBuildName = vi.mocked(buildExportFilename);
const mOpenFile = vi.mocked(openJsonFile);
const mCountVersions = vi.mocked(countVersions);
const mStrip = vi.mocked(stripVersions);

function makeEnv(id: string, name = id): Environment {
  return { id, name };
}
function makeSvc(id: string, baseUrls: Record<string, string> = {}): Microservice {
  return { id, name: id, baseUrls };
}
function makeAuth(id: string, type: GlobalAuthProfile['auth']['type'] = 'bearer'): GlobalAuthProfile {
  return { id, name: id, auth: { type } as GlobalAuthProfile['auth'] };
}

function renderTab(overrides: Partial<React.ComponentProps<typeof SettingsExportImportTab>> = {}) {
  const onImport = overrides.onImport ?? vi.fn();
  const props: React.ComponentProps<typeof SettingsExportImportTab> = {
    environments: overrides.environments ?? [makeEnv('e1', 'Dev'), makeEnv('e2', 'Prod')],
    microservices: overrides.microservices ?? [makeSvc('s1', { e1: 'http://dev' })],
    featureGroups: overrides.featureGroups ?? [],
    appGlobalAuthProfiles: overrides.appGlobalAuthProfiles ?? [],
    onImport,
  };
  return { onImport, ...render(<SettingsExportImportTab {...props} />) };
}

beforeEach(() => {
  resetAllMocks();
  mockIsTauri = false;
  mockHasVersionData = false;
  mSave.mockResolvedValue(undefined);
  mBuildName.mockReturnValue('redfire-export.json');
  mOpenFile.mockResolvedValue(null);
  mCountVersions.mockReturnValue({
    responseVersionCount: 0,
    rulesVersionCount: 0,
    definitionVersionCount: 0,
    structureLogCount: 0,
  });
  mStrip.mockImplementation((data: unknown) => data);
});

describe('SettingsExportImportTab — export pane', () => {
  it('renders export pane by default with all envs selected', () => {
    renderTab();
    expect(screen.getByText('Export & Import')).toBeTruthy();
    expect(screen.getByText('Environments')).toBeTruthy();
    expect(screen.getByText('(2/2)')).toBeTruthy();
    expect(screen.getByText(/Export \(2 selected\)/)).toBeTruthy();
  });

  it('shows an empty state when there are no environments or auth profiles', () => {
    renderTab({ environments: [], appGlobalAuthProfiles: [] });
    expect(screen.getByText('No environments to export yet. Add one on the Environments tab.')).toBeTruthy();
    expect(screen.getByText('No global auth profiles to include.')).toBeTruthy();
    expect(screen.getByText(/Export \(0 selected\)/)).toBeTruthy();
    const exportBtn = screen.getByText(/Export \(0 selected\)/).closest('button') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
  });

  it('toggles a single environment off and on', () => {
    renderTab();
    const checkboxes = document.querySelectorAll('.exi-items .exi-item input[type="checkbox"]');
    fireEvent.click(checkboxes[0]); // turn one off
    expect(screen.getByText(/Export \(1 selected\)/)).toBeTruthy();
    fireEvent.click(checkboxes[0]); // back on
    expect(screen.getByText(/Export \(2 selected\)/)).toBeTruthy();
  });

  it('toggles all environments off via group header then back on', () => {
    renderTab();
    const groupCheckbox = document.querySelector('.exi-group-header input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(groupCheckbox); // all -> none
    expect(screen.getByText(/Export \(0 selected\)/)).toBeTruthy();
    const exportBtn = screen.getByText(/Export \(0 selected\)/).closest('button') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    fireEvent.click(groupCheckbox); // none -> all
    expect(screen.getByText(/Export \(2 selected\)/)).toBeTruthy();
  });

  it('renders auth profiles group and toggles them', () => {
    renderTab({ appGlobalAuthProfiles: [makeAuth('a1', 'bearer'), makeAuth('a2', 'oauth2')] });
    expect(screen.getByText('Global Auth Profiles')).toBeTruthy();
    expect(screen.getByText('BEARER')).toBeTruthy();
    expect(screen.getByText('OAUTH2')).toBeTruthy();
    const authGroupHeaders = document.querySelectorAll('.exi-group-header');
    const authHeaderCb = authGroupHeaders[1].querySelector('input') as HTMLInputElement;
    fireEvent.click(authHeaderCb); // deselect all auth
    expect(screen.getByText(/Export \(2 selected\)/)).toBeTruthy(); // 2 envs only
  });

  it('exports selected data including masked oauth2 + non-oauth2 secrets', async () => {
    renderTab({
      microservices: [makeSvc('s1', { e1: 'http://dev' }), makeSvc('s2', { other: 'x' })],
      appGlobalAuthProfiles: [makeAuth('a1', 'oauth2'), makeAuth('a2', 'apikey')],
    });
    // enable masking
    const maskCb = document.querySelector('.exi-mask input') as HTMLInputElement;
    fireEvent.click(maskCb);
    fireEvent.click(screen.getByText(/Export \(/).closest('button')!);
    await waitFor(() => expect(mSave).toHaveBeenCalled());
    expect(mBuildName).toHaveBeenCalledWith({ level: 'data', name: 'redfire-export' });
    const [payload, name] = mSave.mock.calls[0];
    expect(name).toBe('redfire-export.json');
    const data = payload as Record<string, unknown>;
    expect(Array.isArray(data.appGlobalAuthProfiles)).toBe(true);
    // s2 has no selected env -> excluded
    expect((data.microservices as unknown[]).length).toBe(1);
  });

  it('includes protocolEndpoints on exported microservices', async () => {
    const svcWithProtocols: Microservice = {
      id: 's1',
      name: 'Orders',
      baseUrls: { e1: 'https://api.dev' },
      protocolEndpoints: {
        websocket: { e1: { baseUrl: 'wss://ws.dev' } },
        graphql: { e1: { baseUrl: 'https://gql.dev', path: '/v1/query' } },
      },
    };
    renderTab({ microservices: [svcWithProtocols] });
    fireEvent.click(screen.getByText(/Export \(/).closest('button')!);
    await waitFor(() => expect(mSave).toHaveBeenCalled());
    const [payload] = mSave.mock.calls[0];
    const exported = (payload as { microservices: Microservice[] }).microservices[0];
    expect(exported.protocolEndpoints?.websocket?.e1?.baseUrl).toBe('wss://ws.dev');
    expect(exported.protocolEndpoints?.graphql?.e1?.path).toBe('/v1/query');
  });

  it('strips versions on export when version toggles are off', async () => {
    mockHasVersionData = true;
    mCountVersions.mockReturnValue({
      responseVersionCount: 3,
      rulesVersionCount: 2,
      definitionVersionCount: 0,
      structureLogCount: 0,
    });
    renderTab({ featureGroups: [{ id: 'fg', name: 'FG', scenarios: [] } as FeatureGroup] });
    // uncheck "include response versions"
    expect(screen.getByText(/Include response versions \(3\)/)).toBeTruthy();
    expect(screen.getByText(/Include rules versions \(2\)/)).toBeTruthy();
    const versionCbs = document.querySelectorAll('.exi-version-opts input[type="checkbox"]');
    fireEvent.click(versionCbs[0]);
    fireEvent.click(versionCbs[1]);
    fireEvent.click(screen.getByText(/Export \(/).closest('button')!);
    await waitFor(() => expect(mStrip).toHaveBeenCalled());
  });
});

describe('SettingsExportImportTab — import pane', () => {
  function switchToImport() {
    fireEvent.click(screen.getByText('Import'));
  }

  function makeFile(content: string, name = 'data.json') {
    return new File([content], name, { type: 'application/json' });
  }

  const validJson = JSON.stringify({
    environments: [{ id: 'eX', name: 'NewEnv' }, { id: 'e1', name: 'Dev' }],
    microservices: [{ id: 'sX', name: 'NewSvc', baseUrls: {} }],
    featureGroups: [{ id: 'fgX', name: 'FG', scenarios: [], projectId: 'p1' }],
    globalAuthProfiles: [{ id: 'aX', name: 'AuthX', auth: { type: 'bearer' } }],
    appGlobalAuthProfiles: [{ id: 'aY', name: 'AuthY', auth: { type: 'none' } }],
    exportedAt: '2024-01-01T00:00:00.000Z',
    version: '3.0',
  });

  it('shows dropzone and browses via hidden input on web', () => {
    renderTab();
    switchToImport();
    expect(screen.getByText('Drop file here')).toBeTruthy();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
  });

  it('parses a valid file selected via the hidden input', async () => {
    renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(validJson)] } });
    await waitFor(() => expect(screen.getByText('data.json')).toBeTruthy());
    expect(screen.getByText('v3.0', { exact: false })).toBeTruthy();
    expect(screen.getByText(/1 new environment/)).toBeTruthy(); // e1 exists, eX new
    expect(screen.getByText(/1 exist/)).toBeTruthy();
    expect(screen.getByText(/1 new microservice/)).toBeTruthy();
    expect(screen.getByText(/1 feature group/)).toBeTruthy();
    // auth checkbox (globalAuthProfiles + appGlobalAuthProfiles = 2)
    expect(screen.getByText(/Include 2 auth profiles/)).toBeTruthy();
  });

  it('imports parsed data and filters existing ids', async () => {
    const { onImport } = renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(validJson)] } });
    await waitFor(() => expect(screen.getByText('data.json')).toBeTruthy());
    fireEvent.click(screen.getByText('↑ Import'));
    expect(onImport).toHaveBeenCalledTimes(1);
    const arg = onImport.mock.calls[0][0];
    expect(arg.environments).toHaveLength(1); // only eX is new
    expect(arg.microservices).toHaveLength(1);
    expect(arg.globalAuthProfiles).toHaveLength(2);
    // preview cleared after import
    expect(screen.getByText('Drop file here')).toBeTruthy();
  });

  it('omits auth on import when the auth checkbox is unchecked', async () => {
    const { onImport } = renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(validJson)] } });
    await waitFor(() => expect(screen.getByText(/Include 2 auth profiles/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Include 2 auth profiles/).closest('label')!.querySelector('input')!);
    fireEvent.click(screen.getByText('↑ Import'));
    expect(onImport.mock.calls[0][0].globalAuthProfiles).toBeUndefined();
  });

  it('strips versions on import when version toggles are off', async () => {
    mockHasVersionData = true;
    mCountVersions.mockReturnValue({
      responseVersionCount: 2,
      rulesVersionCount: 1,
      definitionVersionCount: 0,
      structureLogCount: 0,
    });
    const { onImport } = renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(validJson)] } });
    await waitFor(() => expect(screen.getByText('↑ Import')).toBeTruthy());
    const versionCbs = document.querySelectorAll('.exi-import-preview .exi-version-opts input[type="checkbox"]');
    fireEvent.click(versionCbs[0]); // uncheck response versions
    fireEvent.click(versionCbs[1]); // uncheck rules versions
    fireEvent.click(screen.getByText('↑ Import'));
    expect(mStrip).toHaveBeenCalled();
    expect(onImport).toHaveBeenCalled();
  });

  it('clears the preview via the ✕ button', async () => {
    renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(validJson)] } });
    await waitFor(() => expect(screen.getByText('data.json')).toBeTruthy());
    fireEvent.click(screen.getByText('✕'));
    expect(screen.getByText('Drop file here')).toBeTruthy();
  });

  it('shows error for unrecognized JSON content', async () => {
    renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile('{"foo":"bar"}')] } });
    await waitFor(() => expect(screen.getByText('File does not contain recognizable data.')).toBeTruthy());
  });

  it('shows error for invalid JSON', async () => {
    renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile('not json')] } });
    await waitFor(() => expect(screen.getByText('Invalid JSON file.')).toBeTruthy());
  });

  it('ignores file selection when no file chosen', () => {
    renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(screen.getByText('Drop file here')).toBeTruthy();
  });

  it('handles drag over, drag leave, and drop with a file', async () => {
    renderTab();
    switchToImport();
    const dropzone = document.querySelector('.exi-dropzone') as HTMLElement;
    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain('dragging');
    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain('dragging');
    fireEvent.drop(dropzone, { dataTransfer: { files: [makeFile(validJson)] } });
    await waitFor(() => expect(screen.getByText('data.json')).toBeTruthy());
  });

  it('ignores a drop with no file', () => {
    renderTab();
    switchToImport();
    const dropzone = document.querySelector('.exi-dropzone') as HTMLElement;
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });
    expect(screen.getByText('Drop file here')).toBeTruthy();
  });

  it('opens the hidden file input when the dropzone is clicked on web', () => {
    renderTab();
    switchToImport();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    fireEvent.click(document.querySelector('.exi-dropzone') as HTMLElement);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('shows an error when FileReader fails on file select', async () => {
    const OrigFR = global.FileReader;
    class FakeFR {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result = '';
      readAsText() { this.onerror?.(); }
    }
    // @ts-expect-error test stub
    global.FileReader = FakeFR;
    try {
      renderTab();
      switchToImport();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [makeFile('x')] } });
      await waitFor(() => expect(screen.getByText('Failed to read file.')).toBeTruthy());
    } finally {
      global.FileReader = OrigFR;
    }
  });

  it('shows an error when FileReader fails on drop', async () => {
    const OrigFR = global.FileReader;
    class FakeFR {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result = '';
      readAsText() { this.onerror?.(); }
    }
    // @ts-expect-error test stub
    global.FileReader = FakeFR;
    try {
      renderTab();
      switchToImport();
      const dropzone = document.querySelector('.exi-dropzone') as HTMLElement;
      fireEvent.drop(dropzone, { dataTransfer: { files: [makeFile('x')] } });
      await waitFor(() => expect(screen.getByText('Failed to read file.')).toBeTruthy());
    } finally {
      global.FileReader = OrigFR;
    }
  });

  it('uses the Tauri open dialog when running in Tauri', async () => {
    mockIsTauri = true;
    mOpenFile.mockResolvedValue({ name: 'tauri.json', content: validJson });
    renderTab();
    switchToImport();
    // No hidden file input in tauri mode
    expect(document.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(document.querySelector('.exi-dropzone') as HTMLElement);
    await waitFor(() => expect(screen.getByText('tauri.json')).toBeTruthy());
  });

  it('does nothing when the Tauri dialog is cancelled', async () => {
    mockIsTauri = true;
    mOpenFile.mockResolvedValue(null);
    renderTab();
    switchToImport();
    fireEvent.click(document.querySelector('.exi-dropzone') as HTMLElement);
    await Promise.resolve();
    expect(screen.getByText('Drop file here')).toBeTruthy();
  });

  it('renders preview without version meta when exportedAt missing', async () => {
    renderTab();
    switchToImport();
    const noMeta = JSON.stringify({
      environments: [{ id: 'eX', name: 'NewEnv' }],
      version: '2.0',
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([noMeta], 'n.json')] } });
    await waitFor(() => expect(screen.getByText('v2.0')).toBeTruthy());
  });
});

describe('SettingsExportImportTab — coverage gaps', () => {
  function switchToImport() {
    fireEvent.click(screen.getByText('Import'));
  }
  function makeFile(content: string, name = 'data.json') {
    return new File([content], name, { type: 'application/json' });
  }

  it('treats a microservice with no baseUrls map as unselected', async () => {
    renderTab({ microservices: [{ id: 's1', name: 's1' } as Microservice] });
    fireEvent.click(screen.getByText(/Export \(/).closest('button')!);
    await waitFor(() => expect(mSave).toHaveBeenCalled());
    const data = mSave.mock.calls[0][0] as Record<string, unknown>;
    expect((data.microservices as unknown[]).length).toBe(0);
  });

  it('renders the No Auth badge and toggles one auth profile', () => {
    renderTab({ appGlobalAuthProfiles: [makeAuth('a1', 'none'), makeAuth('a2', 'bearer')] });
    expect(screen.getByText('No Auth')).toBeTruthy();
    expect(screen.getByText('BEARER')).toBeTruthy();
    expect(screen.getByText(/Export \(4 selected\)/)).toBeTruthy();
    const authGroup = document.querySelectorAll('.exi-items')[1];
    const authBoxes = authGroup.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(authBoxes[0]);
    expect(screen.getByText(/Export \(3 selected\)/)).toBeTruthy();
  });

  it('opens the file picker from the dropzone via Enter and Space', () => {
    renderTab();
    switchToImport();
    const dropzone = document.querySelector('.exi-dropzone') as HTMLElement;
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    fireEvent.keyDown(dropzone, { key: 'Enter' });
    fireEvent.keyDown(dropzone, { key: ' ' });
    expect(clickSpy).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(dropzone, { key: 'Tab' });
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('opens the Tauri picker from the dropzone via Enter', async () => {
    mockIsTauri = true;
    mOpenFile.mockResolvedValue({ content: '{"environments":[]}', name: 'tauri.json' });
    renderTab();
    switchToImport();
    fireEvent.keyDown(document.querySelector('.exi-dropzone') as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(mOpenFile).toHaveBeenCalled());
  });

  it('parses a file that omits the environments array', async () => {
    renderTab();
    switchToImport();
    const partial = JSON.stringify({ microservices: [{ id: 'sZ', name: 'SZ', baseUrls: {} }] });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(partial, 'partial.json')] } });
    await waitFor(() => expect(screen.getByText('partial.json')).toBeTruthy());
    expect(screen.getByText(/1 new microservice/)).toBeTruthy();
  });

  it('pluralizes summary counts and shows a single auth profile', async () => {
    renderTab({ environments: [], microservices: [], appGlobalAuthProfiles: [] });
    switchToImport();
    const many = JSON.stringify({
      environments: [{ id: 'e1', name: 'A' }, { id: 'e2', name: 'B' }],
      microservices: [{ id: 's1', name: 'S1', baseUrls: {} }, { id: 's2', name: 'S2', baseUrls: {} }],
      featureGroups: [{ id: 'f1', name: 'F1' }, { id: 'f2', name: 'F2' }],
      globalAuthProfiles: [{ id: 'a1', name: 'A1', auth: { type: 'bearer' } }],
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(many, 'many.json')] } });
    await waitFor(() => expect(screen.getByText(/2 new environments/)).toBeTruthy());
    expect(screen.getByText(/2 new microservices/)).toBeTruthy();
    expect(screen.getByText(/2 feature groups/)).toBeTruthy();
    expect(screen.getByText(/Include 1 auth profile/)).toBeTruthy();
  });

  it('filters out auth profiles that already exist on import', async () => {
    const { onImport } = renderTab({ appGlobalAuthProfiles: [makeAuth('aX', 'bearer')] });
    switchToImport();
    const withAuth = JSON.stringify({
      environments: [],
      microservices: [],
      featureGroups: [],
      globalAuthProfiles: [{ id: 'aX', name: 'AuthX', auth: { type: 'bearer' } }],
      appGlobalAuthProfiles: [{ id: 'aY', name: 'AuthY', auth: { type: 'none' } }],
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeFile(withAuth)] } });
    await waitFor(() => expect(screen.getByText('data.json')).toBeTruthy());
    fireEvent.click(screen.getByText('↑ Import'));
    const arg = onImport.mock.calls[0][0];
    expect(arg.globalAuthProfiles).toHaveLength(1);
    expect(arg.globalAuthProfiles[0].id).toBe('aY');
  });
});
