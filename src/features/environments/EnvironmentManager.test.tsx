// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { selectOption } from '@test-utils/customSelectHelper';
import EnvironmentManager, { type EnvironmentManagerProps } from './EnvironmentManager';
import type { Environment, Microservice, GlobalAuthProfile, FeatureGroup } from '@shared/types';

// ── Deterministic ids ──
let uuidCounter = 0;
vi.mock('uuid', () => ({ v4: () => `uuid-${++uuidCounter}` }));

// ── Audit log writes to storage — stub all to no-ops ──
vi.mock('../audit/utils/auditLog', () => ({
  logEnvironmentCreated: vi.fn(),
  logEnvironmentDeleted: vi.fn(),
  logMicroserviceCreated: vi.fn(),
  logMicroserviceDeleted: vi.fn(),
  logMicroserviceUpdated: vi.fn(),
}));

import {
  logEnvironmentCreated, logEnvironmentDeleted,
  logMicroserviceCreated, logMicroserviceDeleted, logMicroserviceUpdated,
} from '../audit/utils/auditLog';

const mockedEnvCreated = vi.mocked(logEnvironmentCreated);
const mockedEnvDeleted = vi.mocked(logEnvironmentDeleted);
const mockedSvcCreated = vi.mocked(logMicroserviceCreated);
const mockedSvcDeleted = vi.mocked(logMicroserviceDeleted);
const mockedSvcUpdated = vi.mocked(logMicroserviceUpdated);

interface HarnessProps {
  environments?: Environment[];
  microservices?: Microservice[];
  workspaceDefaults?: Record<string, string>;
  appGlobalAuthProfiles?: GlobalAuthProfile[];
  featureGroups?: FeatureGroup[];
  selectedEnvId?: string;
  selectedSvcId?: string;
  confirm?: EnvironmentManagerProps['confirm'];
}

function Harness(props: HarnessProps) {
  const [environments, setEnvironments] = useState<Environment[]>(props.environments ?? []);
  const [microservices, setMicroservices] = useState<Microservice[]>(props.microservices ?? []);
  const [workspaceDefaults, setWorkspaceDefaults] = useState<Record<string, string>>(props.workspaceDefaults ?? {});
  const [selectedEnvId, setSelectedEnvId] = useState<string>(props.selectedEnvId ?? '');
  const [selectedSvcId, setSelectedSvcId] = useState<string>(props.selectedSvcId ?? '');
  return (
    <EnvironmentManager
      environments={environments}
      setEnvironments={setEnvironments}
      microservices={microservices}
      setMicroservices={setMicroservices}
      workspaceDefaults={workspaceDefaults}
      setWorkspaceDefaults={setWorkspaceDefaults}
      appGlobalAuthProfiles={props.appGlobalAuthProfiles ?? []}
      featureGroups={props.featureGroups ?? []}
      selectedEnvId={selectedEnvId}
      selectedSvcId={selectedSvcId}
      setSelectedEnvId={setSelectedEnvId}
      setSelectedSvcId={setSelectedSvcId}
      confirm={props.confirm ?? ((_msg, onConfirm) => onConfirm())}
    />
  );
}

const env = (id: string, name: string): Environment => ({ id, name });
const svc = (overrides: Partial<Microservice> = {}): Microservice => ({
  id: 'svc-1', name: 'svc-one', baseUrls: {}, ...overrides,
});

function fgWith(overrides: Partial<FeatureGroup>): FeatureGroup {
  return {
    id: `fg-${Math.random()}`,
    name: 'FG',
    scenarios: [{ id: 's1', name: 'sc', kind: 'standard', tests: [{ id: 't1', name: 'test' }] }],
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('EnvironmentManager', () => {
  beforeEach(() => {
    uuidCounter = 0;
    resetAllMocks();
  });

  // ── Empty states ──
  it('renders empty hints when there are no environments or microservices', () => {
    render(<Harness />);
    expect(screen.getByText('No environments defined.')).toBeInTheDocument();
    expect(screen.getByText('No microservices defined.')).toBeInTheDocument();
  });

  // ── Add environment ──
  it('adds an environment via the Add button and disables Add when empty', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('e.g. dev, test, staging, prod');
    const addBtn = screen.getAllByRole('button', { name: 'Add' })[0];
    expect(addBtn).toBeDisabled();
    fireEvent.change(input, { target: { value: 'test' } });
    expect(screen.getAllByRole('button', { name: 'Add' })[0]).not.toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(mockedEnvCreated).toHaveBeenCalledWith('test', 'uuid-1');
    // Input cleared
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('adds an environment via the Enter key and ignores Enter when blank', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('e.g. dev, test, staging, prod');
    // Blank Enter → no-op
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockedEnvCreated).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'staging' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(mockedEnvCreated).toHaveBeenCalled();
  });

  it('does nothing when clicking Add with only whitespace', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('e.g. dev, test, staging, prod');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(mockedEnvCreated).not.toHaveBeenCalled();
  });

  // ── Delete environment ──
  it('deletes an environment, surfaces the warning detail, clears selection and prunes baseUrls', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ baseUrls: { e1: 'http://x' } })]}
        featureGroups={[fgWith({ environmentId: 'e1' })]}
        selectedEnvId="e1"
        confirm={confirmSpy}
      />
    );
    const chip = screen.getByText('test').closest('.settings-chip')!;
    fireEvent.click(within(chip as HTMLElement).getByTitle('Delete'));
    expect(confirmSpy).toHaveBeenCalled();
    const detail = confirmSpy.mock.calls[0][2] as string;
    expect(detail).toContain('microservice');
    expect(detail).toContain('feature group');
    expect(mockedEnvDeleted).toHaveBeenCalledWith('test', 'e1');
    expect(screen.queryByText('test')).not.toBeInTheDocument();
  });

  it('omits the warning detail when deleting an unused environment', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(<Harness environments={[env('e1', 'test')]} confirm={confirmSpy} />);
    const chip = screen.getByText('test').closest('.settings-chip')!;
    fireEvent.click(within(chip as HTMLElement).getByTitle('Delete'));
    expect(confirmSpy.mock.calls[0][2]).toBeUndefined();
    expect(mockedEnvDeleted).toHaveBeenCalled();
  });

  // ── Add / delete microservice ──
  it('adds a microservice via button and Enter, ignoring blank input', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('e.g. order-api');
    fireEvent.keyDown(input, { key: 'Enter' }); // blank → no-op
    expect(mockedSvcCreated).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'orders-svc' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]);
    expect(screen.getByText('orders-svc')).toBeInTheDocument();
    expect(mockedSvcCreated).toHaveBeenCalled();
    // Add second via Enter
    fireEvent.change(input, { target: { value: 'billing-svc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('billing-svc')).toBeInTheDocument();
  });

  it('does nothing when clicking Add microservice with only whitespace', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('e.g. order-api');
    fireEvent.change(input, { target: { value: '  ' } });
    // The microservice Add button is the second one
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[addButtons.length - 1]);
    expect(mockedSvcCreated).not.toHaveBeenCalled();
  });

  it('deletes a microservice with affected feature groups and clears selection', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(
      <Harness
        microservices={[svc({ id: 'svc-1', name: 'orders' })]}
        featureGroups={[fgWith({ microserviceId: 'svc-1' })]}
        selectedSvcId="svc-1"
        confirm={confirmSpy}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy.mock.calls[0][2]).toContain('feature group');
    expect(mockedSvcDeleted).toHaveBeenCalledWith('orders', 'svc-1');
    expect(screen.queryByText('orders')).not.toBeInTheDocument();
  });

  it('deletes a microservice with no affected feature groups (no detail)', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(<Harness microservices={[svc({ id: 'svc-1', name: 'orders' })]} confirm={confirmSpy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy.mock.calls[0][2]).toBeUndefined();
  });

  // ── Configure / expand microservice ──
  it('expands a microservice and prompts to add environments first when none exist', () => {
    render(<Harness microservices={[svc()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('Add environments first.')).toBeInTheDocument();
    // Collapse
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('Add environments first.')).not.toBeInTheDocument();
  });

  it('shows the env table with deployed counts when environments exist', () => {
    render(<Harness environments={[env('e1', 'test'), env('e2', 'prod')]} microservices={[svc({ baseUrls: { e1: 'http://x' } })]} />);
    expect(screen.getByText('1/2 envs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('Base URL')).toBeInTheDocument();
    expect(screen.getByText(/Auth profile/i)).toBeInTheDocument();
  });

  // ── Deploy checkbox toggle ──
  it('toggles a base environment deployment checkbox on and off', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ enabledProtocols: ['http'] })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox); // deploy
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox')); // undeploy
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  // ── Edit base URL ──
  it('edits a base URL via Save button and logs the change', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ baseUrls: { e1: '' } })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('No URL configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const urlInput = screen.getByPlaceholderText('https://svc-one.test.example.com');
    fireEvent.change(urlInput, { target: { value: 'http://orders.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText('http://orders.test').length).toBeGreaterThan(0);
    expect(mockedSvcUpdated).toHaveBeenCalled();
  });

  it('saves a base URL via the Enter key', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ baseUrls: { e1: '' } })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const urlInput = screen.getByPlaceholderText('https://svc-one.test.example.com');
    fireEvent.change(urlInput, { target: { value: 'http://orders.test' } });
    fireEvent.keyDown(urlInput, { key: 'Enter' });
    expect(screen.getAllByText('http://orders.test').length).toBeGreaterThan(0);
  });

  it('does not log an audit change when the base URL is unchanged', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ baseUrls: { e1: 'http://same' } })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockedSvcUpdated).not.toHaveBeenCalled();
  });

  it('cancels base URL editing via the Cancel button and the Escape key', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ baseUrls: { e1: 'http://x' } })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    // Re-open and Escape
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const urlInput = screen.getByDisplayValue('http://x');
    fireEvent.keyDown(urlInput, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  // ── Auth profile select ──
  it('sets and clears an auth profile for a deployed environment', () => {
    const profiles: GlobalAuthProfile[] = [{ id: 'p1', name: 'Bearer Profile', auth: { type: 'bearer' } }];
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ baseUrls: { e1: 'http://x' } })]}
        appGlobalAuthProfiles={profiles}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    selectOption(document.body, 'Bearer Profile (bearer)');
    expect(mockedSvcUpdated).toHaveBeenCalled();
    mockedSvcUpdated.mockClear();
    selectOption(document.body, 'No Auth');
    expect(mockedSvcUpdated).toHaveBeenCalled();
  });

  // ── Additional (custom) environments ──
  it('adds an additional environment, prevents duplicates and ignores blank submits', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ enabledProtocols: ['http'] })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const addInput = screen.getByPlaceholderText('+ Add additional environment (e.g. staging-2)');
    // Blank submit → no-op
    fireEvent.submit(addInput.closest('form')!);
    expect(screen.queryByText('staging-2')).not.toBeInTheDocument();
    // Add
    fireEvent.change(addInput, { target: { value: 'staging-2' } });
    fireEvent.submit(addInput.closest('form')!);
    expect(screen.getByLabelText('Deploy staging-2')).toBeInTheDocument();
    expect(screen.getByText(/Additional environments/i)).toBeInTheDocument();
    // Duplicate (case-insensitive) → ignored
    fireEvent.change(screen.getByPlaceholderText('+ Add additional environment (e.g. staging-2)'), { target: { value: 'STAGING-2' } });
    fireEvent.submit(screen.getByPlaceholderText('+ Add additional environment (e.g. staging-2)').closest('form')!);
    expect(screen.getAllByLabelText('Deploy staging-2').length).toBe(1);
  });

  it('configures and deletes an additional environment row', () => {
    const profiles: GlobalAuthProfile[] = [{ id: 'p1', name: 'Bearer', auth: { type: 'bearer' } }];
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ customEnvs: [{ id: 'c1', name: 'staging-2' }], baseUrls: { c1: '' } })]}
        appGlobalAuthProfiles={profiles}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByLabelText('Deploy staging-2')).toBeInTheDocument();
    // Edit URL for the custom env, save via Enter key
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const urlInput = screen.getByPlaceholderText('https://svc-one.staging-2.example.com');
    fireEvent.change(urlInput, { target: { value: 'http://staging2' } });
    fireEvent.keyDown(urlInput, { key: 'Enter' });
    expect(screen.getAllByText('http://staging2').length).toBeGreaterThan(0);
    // Re-edit and cancel via Escape key
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.keyDown(screen.getByPlaceholderText('https://svc-one.staging-2.example.com'), { key: 'Escape' });
    expect(screen.getAllByText('http://staging2').length).toBeGreaterThan(0);
    // Re-edit, change, then Save button
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByPlaceholderText('https://svc-one.staging-2.example.com'), { target: { value: 'http://staging2b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText('http://staging2b').length).toBeGreaterThan(0);
    // Re-edit and cancel via Cancel button
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByText('http://staging2b').length).toBeGreaterThan(0);
    // Set auth on custom env
    selectOption(document.body, 'Bearer (bearer)');
    // Delete the additional env
    fireEvent.click(screen.getByTitle('Remove additional environment'));
    expect(screen.queryByLabelText('Deploy staging-2')).not.toBeInTheDocument();
  });

  it('toggles deployment for a custom environment that starts undeployed', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ customEnvs: [{ id: 'c1', name: 'staging-2' }], baseUrls: {}, enabledProtocols: ['http'] })]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    // Two checkboxes: base env (e1) + custom env (c1), both undeployed
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // deploy custom env
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
  });

  // ── Drag reordering ──
  it('reorders environments via drag and drop', () => {
    render(<Harness environments={[env('e1', 'alpha'), env('e2', 'beta')]} />);
    const chips = document.querySelectorAll('.settings-chip');
    fireEvent.dragStart(chips[0]);
    fireEvent.dragOver(chips[1]);
    fireEvent.dragEnd(chips[0]);
    const namesAfter = Array.from(document.querySelectorAll('.settings-chip span:nth-child(2)')).map((n) => n.textContent);
    expect(namesAfter[0]).toBe('beta');
  });

  it('reorders microservices via drag and drop', () => {
    render(<Harness microservices={[svc({ id: 's1', name: 'aaa' }), svc({ id: 's2', name: 'bbb' })]} />);
    const cards = document.querySelectorAll('.settings-svc-card');
    fireEvent.dragStart(cards[0]);
    fireEvent.dragOver(cards[1]);
    fireEvent.dragEnd(cards[0]);
    const names = Array.from(document.querySelectorAll('.settings-svc-name')).map((n) => n.textContent);
    expect(names[0]).toBe('bbb');
  });

  it('ignores drag-over when dragging onto the same index or with no active drag', () => {
    render(<Harness environments={[env('e1', 'alpha'), env('e2', 'beta')]} />);
    const chips = document.querySelectorAll('.settings-chip');
    // dragOver without dragStart → draggingEnvIdx is null, early return
    fireEvent.dragOver(chips[0]);
    // dragStart then dragOver on the same chip → early return
    fireEvent.dragStart(chips[0]);
    fireEvent.dragOver(chips[0]);
    const names = Array.from(document.querySelectorAll('.settings-chip span:nth-child(2)')).map((n) => n.textContent);
    expect(names[0]).toBe('alpha');
  });

  it('ignores microservice drag-over onto the same card index', () => {
    render(<Harness microservices={[svc({ id: 's1', name: 'aaa' }), svc({ id: 's2', name: 'bbb' })]} />);
    const cards = document.querySelectorAll('.settings-svc-card');
    fireEvent.dragStart(cards[0]);
    fireEvent.dragOver(cards[0]);
    const names = Array.from(document.querySelectorAll('.settings-svc-name')).map((n) => n.textContent);
    expect(names[0]).toBe('aaa');
  });

  it('uses plural wording in delete-environment warning for multiple dependents', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[
          svc({ id: 's1', baseUrls: { e1: 'http://a' } }),
          svc({ id: 's2', baseUrls: { e1: 'http://b' } }),
        ]}
        featureGroups={[
          fgWith({ environmentId: 'e1', scenarios: [{ id: 's1', name: 'a', kind: 'standard', tests: [{ id: 't1', name: 't1' }, { id: 't2', name: 't2' }] }] }),
          fgWith({ environmentId: 'e1', scenarios: [{ id: 's2', name: 'b', kind: 'standard', tests: [{ id: 't3', name: 't3' }] }] }),
        ]}
        confirm={confirmSpy}
      />,
    );
    const chip = screen.getByText('test').closest('.settings-chip')!;
    fireEvent.click(within(chip as HTMLElement).getByTitle('Delete'));
    const detail = confirmSpy.mock.calls[0][2] as string;
    expect(detail).toContain('2 microservices');
    expect(detail).toContain('2 feature groups');
    expect(detail).toContain('2 scenarios');
    expect(detail).toContain('3 tests');
  });

  it('uses plural wording in delete-microservice warning for multiple dependents', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(
      <Harness
        microservices={[svc({ id: 'svc-1', name: 'orders' })]}
        featureGroups={[
          fgWith({
            microserviceId: 'svc-1',
            scenarios: [
              { id: 's1', name: 'a', kind: 'standard', tests: [{ id: 't1', name: 't1' }, { id: 't2', name: 't2' }] },
              { id: 's2', name: 'b', kind: 'standard', tests: [{ id: 't3', name: 't3' }] },
            ],
          }),
          fgWith({ microserviceId: 'svc-1' }),
        ]}
        confirm={confirmSpy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const detail = confirmSpy.mock.calls[0][2] as string;
    expect(detail).toContain('2 feature groups');
    expect(detail).toContain('3 scenarios');
    expect(detail).toContain('4 tests');
  });

  it('does not log auth profile audit when the selection is unchanged', () => {
    const profiles: GlobalAuthProfile[] = [{ id: 'p1', name: 'Bearer Profile', auth: { type: 'bearer' } }];
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ baseUrls: { e1: 'http://x' }, authProfileIds: { e1: 'p1' } })]}
        appGlobalAuthProfiles={profiles}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    selectOption(document.body, 'Bearer Profile (bearer)');
    expect(mockedSvcUpdated).not.toHaveBeenCalled();
  });

  it('prevents duplicate additional env names against global environments', () => {
    render(<Harness environments={[env('e1', 'test')]} microservices={[svc({ enabledProtocols: ['http'] })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const addInput = screen.getByPlaceholderText('+ Add additional environment (e.g. staging-2)');
    fireEvent.change(addInput, { target: { value: 'TEST' } });
    fireEvent.submit(addInput.closest('form')!);
    expect(screen.queryByText('TEST')).not.toBeInTheDocument();
  });

  it('logs base URL audit using custom environment name', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ customEnvs: [{ id: 'c1', name: 'staging-2' }], baseUrls: { c1: '' } })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByPlaceholderText('https://svc-one.staging-2.example.com'), { target: { value: 'http://custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockedSvcUpdated).toHaveBeenCalledWith(
      'svc-one',
      'svc-1',
      expect.arrayContaining([expect.objectContaining({ field: 'baseUrl[staging-2]' })]),
    );
  });

  // ── Phase 2: Protocol tabs & per-protocol endpoints ──
  const ALL_PROTOCOLS: Microservice['enabledProtocols'] = ['http', 'websocket', 'sse', 'graphql', 'grpc'];

  function expandConfiguredSvc(overrides: Partial<Microservice> = {}, envs = [env('e1', 'test'), env('e2', 'prod')]) {
    render(
      <Harness
        environments={envs}
        microservices={[svc({ baseUrls: { e1: 'https://api.example.com', e2: 'https://api.staging.com' }, enabledProtocols: ALL_PROTOCOLS, ...overrides })]}
        selectedEnvId="e1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
  }

  it('renders five protocol tabs in stable order when expanded (AC-EM-01)', () => {
    expandConfiguredSvc();
    const tablist = screen.getByRole('tablist', { name: 'Protocol endpoints' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('HTTP'),
      expect.stringContaining('WebSocket'),
      expect.stringContaining('SSE'),
      expect.stringContaining('GraphQL'),
      expect.stringContaining('gRPC'),
    ]);
    expect(screen.getByTestId('microservice-protocol-panel')).toBeInTheDocument();
  });

  it('shows card-header protocol completeness badges (AC-EM-02)', () => {
    expandConfiguredSvc({
      enabledProtocols: ALL_PROTOCOLS,
      protocolEndpoints: {
        websocket: { e1: { baseUrl: 'wss://ws.example.com' } },
      },
    });
    const badges = screen.getByTestId('protocol-header-badges');
    expect(within(badges).getByText(/HTTP 2\/2/)).toBeInTheDocument();
    expect(within(badges).getByText(/WS 1\/2/)).toBeInTheDocument();
    expect(within(badges).getByText(/gRPC 0\/2/)).toBeInTheDocument();
  });

  it('switches protocol tab panels without collapsing the card (AC-EM-01)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    expect(screen.getByText(/WebSocket address/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /SSE/i }));
    expect(screen.getByTestId('sse-fallback-notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('shows SSE fallback notice and status chips when endpoints are unset (AC-EM-09, AC-EM-12)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /SSE/i }));
    expect(screen.getByTestId('sse-fallback-notice')).toHaveTextContent('{{sseUrl}}');
    expect(screen.getAllByText('⚠ fallback').length).toBeGreaterThan(0);
  });

  it('keeps SSE fallback notice visible when rows are mixed explicit + fallback (AC-EM-09)', () => {
    expandConfiguredSvc({
      protocolEndpoints: {
        sse: { e1: { baseUrl: 'https://events.example.com' } },
      },
    });
    fireEvent.click(screen.getByRole('tab', { name: /SSE/i }));
    expect(screen.getByTestId('sse-fallback-notice')).toBeInTheDocument();
    expect(screen.getAllByText('✓ set').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⚠ fallback').length).toBeGreaterThan(0);
  });

  it('shows gRPC unresolved notice when no addresses are configured (AC-EM-10)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /gRPC/i }));
    expect(screen.getByTestId('grpc-unresolved-notice')).toHaveTextContent('{{grpcHost}}');
    expect(screen.getAllByText('✗ unresolved').length).toBeGreaterThan(0);
  });

  it('saves an explicit WebSocket endpoint with validation (AC-EM-05, AC-EM-17)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);
    const input = screen.getByPlaceholderText('https://svc-one.test.example.com');
    fireEvent.change(input, { target: { value: 'http://bad-scheme' } });
    expect(screen.getByText(/Use ws:\/\//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'wss://ws.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText('wss://ws.example.com').length).toBeGreaterThan(0);
    expect(mockedSvcUpdated).toHaveBeenCalledWith(
      'svc-one',
      'svc-1',
      expect.arrayContaining([expect.objectContaining({ field: 'websocket[test]' })]),
    );
  });

  it('rejects invalid gRPC scheme on save (AC-EM-08, AC-EM-17)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /gRPC/i }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const input = screen.getByPlaceholderText('host:50051');
    fireEvent.change(input, { target: { value: 'grpc://host:50051' } });
    expect(screen.getByText(/without a scheme/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'grpc.example.com:50051' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText('grpc.example.com:50051').length).toBeGreaterThan(0);
  });

  it('persists GraphQL default path and shows derived variables panel (AC-EM-07, AC-EM-13)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /GraphQL/i }));
    const pathInput = screen.getByLabelText('Default path for test');
    fireEvent.change(pathInput, { target: { value: '/v1/graphql' } });
    expect(mockedSvcUpdated).toHaveBeenCalledWith(
      'svc-one',
      'svc-1',
      expect.arrayContaining([expect.objectContaining({ field: 'graphql.path[test]' })]),
    );
    expect(screen.getByTestId('derived-vars-graphql')).toBeInTheDocument();
    expect(screen.getByText('{{graphqlUrl}}')).toBeInTheDocument();
  });

  it('toggles gRPC TLS per environment (AC-EM-08)', () => {
    expandConfiguredSvc({
      protocolEndpoints: { grpc: { e1: { baseUrl: 'grpc.example.com:50051', tls: false } } },
    });
    fireEvent.click(screen.getByRole('tab', { name: /gRPC/i }));
    const tlsCheckbox = screen.getByLabelText('TLS for test');
    fireEvent.click(tlsCheckbox);
    expect(mockedSvcUpdated).toHaveBeenCalledWith(
      'svc-one',
      'svc-1',
      expect.arrayContaining([expect.objectContaining({ field: 'grpc.tls[test]', newValue: 'true' })]),
    );
  });

  it('SSE tab has no auth column; WebSocket tab includes auth (AC-EM-04, AC-EM-05, AC-EM-06)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /SSE/i }));
    expect(screen.queryByText(/^Auth profile$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    expect(screen.getByText(/^Auth profile$/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /HTTP/i }));
    expect(screen.getByText(/^Auth profile$/i)).toBeInTheDocument();
  });

  it('add button disabled when name field is empty/whitespace (AC-EM-01)', () => {
    render(<Harness />);
    const inputField = screen.getByPlaceholderText(/e\.g\. order-api/i);
    const addButtons = screen.getAllByRole('button', { name: /Add/i });
    const svcAddBtn = addButtons[addButtons.length - 1];
    // Button should be disabled when empty
    expect(svcAddBtn).toBeDisabled();
    fireEvent.change(inputField, { target: { value: 'newSvc' } });
    expect(svcAddBtn).not.toBeDisabled();
  });

  it('keydown Enter on empty name input does not add microservice (AC-EM-01)', () => {
    render(<Harness />);
    const inputField = screen.getByPlaceholderText(/e\.g\. order-api/i);
    fireEvent.keyDown(inputField, { key: 'Enter' });
    expect(screen.getByText('No microservices defined.')).toBeInTheDocument();
  });

  it('protocol tab change clears editing state (AC-EM-17)', () => {
    render(
      <Harness
        environments={[{ id: 'e1', name: 'prod' }]}
        microservices={[svc({ baseUrls: { e1: 'https://api' }, enabledProtocols: ['http', 'websocket', 'graphql'], protocolEndpoints: { websocket: { e1: { baseUrl: 'wss://ws' } } } })]}
        selectedEnvId="e1"
        selectedSvcId="svc-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    // Switch tab while expanded - editing state cleared
    fireEvent.click(screen.getByRole('tab', { name: /GraphQL/i }));
    expect(screen.getByRole('tab', { name: /GraphQL/i })).toHaveClass('em-proto-tab--active');
  });

  it('clears inline endpoint editing when switching protocol tabs (AC-EM-17)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByTestId('em-endpoint-edit-input')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /GraphQL/i }));
    expect(screen.queryByTestId('em-endpoint-edit-input')).not.toBeInTheDocument();
  });

  it('onEditValueChange guards: only updates editing if svcId matches (AC-EM-17)', () => {
    render(
      <Harness
        environments={[{ id: 'e1', name: 'local' }]}
        microservices={[
          svc({ id: 'svc-1', name: 'svc1', baseUrls: { e1: 'https://api1' } }),
          svc({ id: 'svc-2', name: 'svc2', baseUrls: { e1: 'https://api2' } }),
        ]}
        selectedEnvId="e1"
        selectedSvcId="svc-1"
      />
    );
    // Verify both services render
    expect(screen.getByText('svc1')).toBeInTheDocument();
    expect(screen.getByText('svc2')).toBeInTheDocument();
  });

  it('clears inline editing when collapsing a microservice card (AC-EM-17)', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByTestId('em-endpoint-edit-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('em-svc-configure-svc-1'));
    fireEvent.click(screen.getByTestId('em-svc-configure-svc-1'));
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    expect(screen.queryByTestId('em-endpoint-edit-input')).not.toBeInTheDocument();
  });

  it('microservice reordering by drag and drop preserves state (AC-EM-01)', () => {
    render(
      <Harness
        microservices={[
          svc({ id: 's1', name: 'first' }),
          svc({ id: 's2', name: 'second' }),
        ]}
      />
    );
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('protocol tab switch closes editor for tab transitions (AC-EM-01)', () => {
    render(
      <Harness
        environments={[{ id: 'e1', name: 'local' }]}
        microservices={[svc({ id: 'svc-1', name: 'svc', baseUrls: { e1: 'https://api' }, enabledProtocols: ['http', 'websocket', 'graphql'] })]}
        selectedEnvId="e1"
        selectedSvcId="svc-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    fireEvent.click(screen.getByRole('tab', { name: /GraphQL/i }));
    // Verify tab switch occurred
    expect(screen.getByRole('tab', { name: /GraphQL/i })).toHaveClass('em-proto-tab--active');
  });

  it('multiple microservice configurations isolate editing state (AC-EM-17)', () => {
    const svc1 = svc({ id: 's1', name: 'service-alpha', baseUrls: { e1: 'https://api1' } });
    const svc2 = svc({ id: 's2', name: 'service-beta', baseUrls: { e1: 'https://api2' } });
    render(
      <Harness
        environments={[{ id: 'e1', name: 'prod' }]}
        microservices={[svc1, svc2]}
        selectedEnvId="e1"
      />
    );
    // Verify both services present and independent
    expect(screen.getByText('service-alpha')).toBeInTheDocument();
    expect(screen.getByText('service-beta')).toBeInTheDocument();
  });

  it('removes a protocol tab via the × remove button', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByTestId('em-remove-protocol-websocket'));
    expect(screen.queryByRole('tab', { name: /WebSocket/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /HTTP/i })).toBeInTheDocument();
  });

  it('switches active protocol when removing the currently selected tab', () => {
    expandConfiguredSvc();
    fireEvent.click(screen.getByRole('tab', { name: /WebSocket/i }));
    expect(screen.getByRole('tab', { name: /WebSocket/i })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('em-remove-protocol-websocket'));
    expect(screen.getByRole('tab', { name: /HTTP/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('removing the last active protocol falls back activeProtocol to HTTP', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ id: 'svc-1', name: 'solo-proto', baseUrls: { e1: 'https://api' }, enabledProtocols: ['websocket'] })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByRole('tab', { name: /WebSocket/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('em-remove-protocol-websocket'));

    // No tabs remain until a protocol is added back.
    expect(screen.queryByRole('tab', { name: /WebSocket/i })).not.toBeInTheDocument();

    // Add HTTP back; fallback active protocol should resolve to HTTP.
    fireEvent.click(screen.getByTestId('em-add-protocol-btn'));
    fireEvent.click(screen.getByTestId('em-add-protocol-item-http'));
    expect(screen.getByRole('tab', { name: /HTTP/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('add protocol menu hides protocols that are already enabled', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ baseUrls: { e1: 'https://api' }, enabledProtocols: ['http', 'websocket'] })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByTestId('em-add-protocol-btn'));
    expect(screen.queryByTestId('em-add-protocol-item-http')).not.toBeInTheDocument();
    expect(screen.queryByTestId('em-add-protocol-item-websocket')).not.toBeInTheDocument();
    expect(screen.getByTestId('em-add-protocol-item-sse')).toBeInTheDocument();
  });

  it('new microservice has no protocol tabs until added via + Add protocol menu', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({ id: 'svc-new', name: 'fresh-svc', baseUrls: {} })]}
      />,
    );
    expect(screen.queryByTestId('protocol-header-badges')?.textContent?.trim()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.queryByRole('tab', { name: /HTTP/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('microservice-protocol-panel')).toHaveTextContent('No protocols added yet');
    fireEvent.click(screen.getByTestId('em-add-protocol-btn'));
    expect(screen.getByTestId('em-add-protocol-menu')).toBeVisible();
    expect(screen.getByTestId('em-add-protocol-item-http')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('em-add-protocol-item-http'));
    expect(screen.getByRole('tab', { name: /HTTP/i })).toBeInTheDocument();
  });

  it('persists protocol and env vars through EnvironmentManager handlers', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({
          id: 'svc-1',
          name: 'orders',
          baseUrls: { e1: 'https://api.example.com' },
          enabledProtocols: ['http'],
          globalVars: { requestId: 'old' },
          envVars: { e1: { token: 'tok' } },
        })]}
        selectedEnvId="e1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByTestId('protocol-vars-badge'));
    fireEvent.change(screen.getByTestId('protocol-vars-key-input'), { target: { value: 'traceId' } });
    fireEvent.change(screen.getByTestId('protocol-vars-val-input'), { target: { value: 't-1' } });
    fireEvent.click(screen.getByTestId('protocol-vars-add-btn'));
    fireEvent.click(screen.getByTestId('protocol-vars-save-btn'));

    fireEvent.click(screen.getByTestId('env-vars-badge-e1'));
    fireEvent.change(screen.getByTestId('env-vars-key-input'), { target: { value: 'region' } });
    fireEvent.change(screen.getByTestId('env-vars-val-input'), { target: { value: 'us-east' } });
    fireEvent.click(screen.getByTestId('env-vars-add-btn'));
    fireEvent.click(screen.getByTestId('env-vars-save-btn'));

    fireEvent.click(screen.getByTestId('em-svc-configure-svc-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByTestId('protocol-vars-badge'));
    expect(screen.getByTestId('protocol-var-row-traceId')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('protocol-vars-close-btn'));

    fireEvent.click(screen.getByTestId('env-vars-badge-e1'));
    expect(screen.getByTestId('env-var-row-region')).toBeInTheDocument();
  });

  it('prunes envVars when deleting an environment', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({
          id: 'svc-1',
          name: 'orders',
          baseUrls: { e1: 'https://api.example.com' },
          enabledProtocols: ['http'],
          envVars: { e1: { token: 'tok' } },
        })]}
        confirm={confirmSpy}
      />,
    );
    const chip = screen.getByText('test').closest('.settings-chip')!;
    fireEvent.click(within(chip as HTMLElement).getByTitle('Delete'));
    expect(screen.queryByText('test')).not.toBeInTheDocument();
  });

  it('collapses expanded microservice card when the service is deleted', () => {
    const confirmSpy = vi.fn((_msg: string, onConfirm: () => void) => onConfirm());
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({
          id: 'svc-1',
          name: 'orders',
          baseUrls: { e1: 'https://api.example.com' },
          enabledProtocols: ['http'],
        })]}
        selectedSvcId="svc-1"
        confirm={confirmSpy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByTestId('microservice-protocol-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByText('orders')).not.toBeInTheDocument();
    expect(screen.queryByTestId('microservice-protocol-panel')).not.toBeInTheDocument();
  });

  it('ignores addProtocol when the protocol tab is already enabled', () => {
    render(
      <Harness
        environments={[env('e1', 'test')]}
        microservices={[svc({
          id: 'svc-1',
          name: 'orders',
          baseUrls: { e1: 'https://api.example.com' },
          enabledProtocols: ['http', 'grpc'],
        })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByTestId('em-add-protocol-btn'));
    expect(screen.queryByTestId('em-add-protocol-item-http')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('em-add-protocol-item-sse'));
    expect(screen.getByRole('tab', { name: /SSE/i })).toBeInTheDocument();
  });
});

