/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SendToHarnessModal from './SendToHarnessModal';
import type { Environment, FeatureGroup, Microservice, RequestItem } from '@shared/types';
import type { PromotionContext } from '../utils/requestToScenario';

interface CascadeProps {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string }[];
  onCreate?: () => void;
  newValue?: string;
  onNewValueChange?: (v: string) => void;
  isCreating?: boolean;
}
vi.mock('./CascadeSelect', () => ({
  CascadeSelect: (props: CascadeProps) => (
    <div data-testid={`cascade-${props.label}`}>
      <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">--</option>
        {props.options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {props.onCreate && (
        <button onClick={props.onCreate}>create-{props.label}</button>
      )}
      {props.isCreating && (
        <input
          aria-label={`new-${props.label}`}
          value={props.newValue ?? ''}
          onChange={(e) => props.onNewValueChange?.(e.target.value)}
        />
      )}
    </div>
  ),
}));

interface OptionsGridProps {
  setAuthMode: (m: 'concrete' | 'inherit') => void;
  setValidationPreset: (p: 'none' | 'status-200') => void;
}
vi.mock('./send-harness-shared/HarnessOptionsGrid', () => ({
  default: (props: OptionsGridProps) => (
    <div data-testid="options-grid">
      <button onClick={() => props.setAuthMode('inherit')}>set-inherit</button>
      <button onClick={() => props.setValidationPreset('status-200')}>set-200</button>
    </div>
  ),
}));

const createScenarioFromRequest = vi.fn();
vi.mock('../utils/requestToScenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/requestToScenario')>();
  return {
    ...actual,
    createScenarioFromRequest: (...args: unknown[]) => createScenarioFromRequest(...args),
  };
});

const request: RequestItem = {
  id: 'r1',
  name: 'Ping',
  method: 'POST',
  url: '/health',
  headers: [],
  body: '',
  auth: { type: 'none' },
  catalogMeta: { originalPath: '/orig', sourceSpec: 'spec.yaml' } as RequestItem['catalogMeta'],
};

const environments: Environment[] = [{ id: 'e1', name: 'Dev' }];
const microservices: Microservice[] = [
  { id: 'm1', name: 'Payments', baseUrls: { e1: 'https://pay' }, customEnvs: [{ id: 'ce1', name: 'Custom' }] },
];
const featureGroups: FeatureGroup[] = [
  {
    id: 'g1',
    name: 'Group 1',
    scenarios: [{ id: 'sc1', name: 'Scenario 1', kind: 'standard', tests: [] }],
  },
];

const promotionContext: PromotionContext = {
  collection: { id: 'c1', name: 'API', mode: 'direct', requests: [], folders: [] },
  environments: [],
  globalAuthProfiles: [],
  microservices,
};

function setup(overrides: { defaultValidationPreset?: 'none' | 'status-200' } = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <SendToHarnessModal
      request={request}
      promotionContext={promotionContext}
      featureGroups={featureGroups}
      environments={environments}
      microservices={microservices}
      onConfirm={onConfirm}
      onClose={onClose}
      defaultValidationPreset={overrides.defaultValidationPreset}
    />,
  );
  return { onConfirm, onClose };
}

function selectConcreteTarget() {
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'e1' } });
  fireEvent.change(screen.getByLabelText('Microservice'), { target: { value: 'm1' } });
  fireEvent.change(screen.getByLabelText('Feature Group'), { target: { value: 'g1' } });
  fireEvent.change(screen.getByLabelText('Test Scenario'), { target: { value: 'sc1' } });
}

beforeEach(() => {
  createScenarioFromRequest.mockReset();
  createScenarioFromRequest.mockImplementation((req: RequestItem) => ({
    id: 's',
    name: 'S',
    method: req.method,
    url: req.url,
    headers: [{ key: 'X', value: '1' }],
    body: '',
    auth: { type: 'none' },
    validation: { rules: [], expectedStatus: '', expectedBody: '' },
  }));
});

describe('SendToHarnessModal', () => {
  it('renders header, origin path and step indicators', () => {
    setup();
    expect(screen.getByText('Send to Harness')).toBeInTheDocument();
    expect(screen.getByText('/orig')).toBeInTheDocument();
    expect(screen.getByText('spec.yaml')).toBeInTheDocument();
    expect(screen.getByText('1 Target')).toBeInTheDocument();
  });

  it('keeps Next disabled until full target chain is chosen', () => {
    setup();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    selectConcreteTarget();
    expect(next).toBeEnabled();
  });

  it('advances to options step and back', () => {
    setup();
    selectConcreteTarget();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('options-grid')).toBeInTheDocument();
    expect(screen.getByText('Group 1')).toBeInTheDocument(); // breadcrumb grp name
    expect(screen.getByText('Scenario 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('1 Target')).toBeInTheDocument();
    expect(screen.queryByTestId('options-grid')).toBeNull();
  });

  it('confirms with concrete group and scenario targets', () => {
    const { onConfirm } = setup();
    selectConcreteTarget();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      targetGroupId: 'g1',
      targetScenarioId: 'sc1',
      newGroupName: undefined,
      newScenarioName: undefined,
      environmentId: 'e1',
      microserviceId: 'm1',
      openEditorAfter: false,
    }));
  });

  it('supports creating a new group (auto-new scenario)', () => {
    const { onConfirm } = setup();
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Microservice'), { target: { value: 'm1' } });
    fireEvent.click(screen.getByRole('button', { name: 'create-Feature Group' }));
    fireEvent.change(screen.getByLabelText('new-Feature Group'), { target: { value: 'New Grp' } });
    fireEvent.change(screen.getByLabelText('new-Test Scenario'), { target: { value: 'New Scn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      targetGroupId: undefined,
      targetScenarioId: undefined,
      newGroupName: 'New Grp',
      newScenarioName: 'New Scn',
    }));
  });

  it('supports creating a new scenario within an existing group', () => {
    const { onConfirm } = setup();
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Microservice'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('Feature Group'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'create-Test Scenario' }));
    fireEvent.change(screen.getByLabelText('new-Test Scenario'), { target: { value: 'Brand New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      targetGroupId: 'g1',
      targetScenarioId: undefined,
      newScenarioName: 'Brand New',
    }));
  });

  it('toggles options (auth mode, validation, open editor)', () => {
    const { onConfirm } = setup();
    selectConcreteTarget();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-inherit' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-200' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ openEditorAfter: true }));
    // createScenarioFromRequest invoked with inherit + status-200 options
    expect(createScenarioFromRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ selectedEnvId: 'e1' }),
      expect.objectContaining({ authMode: 'inherit', validationPreset: 'status-200' }),
    );
  });

  it('lists custom environments from microservices in env options', () => {
    setup();
    const envSelect = screen.getByLabelText('Environment') as HTMLSelectElement;
    const optionTexts = Array.from(envSelect.options).map((o) => o.textContent);
    expect(optionTexts).toContain('Custom (Payments)');
  });

  it('honors defaultValidationPreset', () => {
    const { onConfirm } = setup({ defaultValidationPreset: 'status-200' });
    selectConcreteTarget();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }));
    expect(createScenarioFromRequest).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({ selectedEnvId: 'e1' }),
      expect.objectContaining({ validationPreset: 'status-200' }),
    );
    expect(onConfirm).toHaveBeenCalled();
  });

  it('cancels via Cancel button', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('resets child selections when environment changes', () => {
    setup();
    selectConcreteTarget();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    // Change env -> resets svc/group/scenario, disabling Next again
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('defaults Environment to the request sub-collection and snapshots a later env change', () => {
    const req = { ...request, id: 'in-local' };
    const envs: Environment[] = [
      { id: 'e-t01', name: 't01' },
      { id: 'e-local', name: 'local-t01' },
    ];
    const svcs: Microservice[] = [{
      id: 'm1',
      name: 'SPA',
      baseUrls: { 'e-t01': 'https://t01.example.com', 'e-local': 'http://localhost:8080' },
    }];
    const onConfirm = vi.fn();
    render(
      <SendToHarnessModal
        request={req}
        promotionContext={{
          collection: {
            id: 'c1',
            name: 'API',
            mode: 'multi-env',
            microserviceId: 'm1',
            requests: [],
            folders: [{
              id: 'local',
              name: 'local-t01',
              isSubCollection: true,
              selectedEnvId: 'e-local',
              requests: [req],
              folders: [],
            }],
          },
          selectedEnvId: 'e-t01',
          appEnvironments: envs,
          globalAuthProfiles: [],
          microservices: svcs,
        }}
        featureGroups={featureGroups}
        environments={envs}
        microservices={svcs}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Environment') as HTMLSelectElement).value).toBe('e-local');
    expect((screen.getByLabelText('Microservice') as HTMLSelectElement).value).toBe('m1');

    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'e-t01' } });
    fireEvent.change(screen.getByLabelText('Feature Group'), { target: { value: 'g1' } });
    fireEvent.change(screen.getByLabelText('Test Scenario'), { target: { value: 'sc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }));
    expect(createScenarioFromRequest).toHaveBeenLastCalledWith(
      req,
      expect.objectContaining({ selectedEnvId: 'e-t01' }),
      expect.anything(),
    );
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'e-t01' }));
  });

  it('shows catalog version badge when request has an active spec version', () => {
    const versionedRequest = {
      ...request,
      activeSpecVersionId: 'v1',
      specVersions: [{ id: 'v1', catalogVersion: '2.1.0' }],
    };
    render(
      <SendToHarnessModal
        request={versionedRequest}
        promotionContext={promotionContext}
        featureGroups={featureGroups}
        environments={environments}
        microservices={microservices}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('v2.1.0')).toBeInTheDocument();
  });

  it('shows plural header count in preview when multiple headers exist', () => {
    createScenarioFromRequest.mockImplementation((req: RequestItem) => ({
      id: 's',
      name: 'S',
      method: req.method,
      url: req.url,
      headers: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }],
      body: '',
      auth: { type: 'none' },
      validation: { rules: [], expectedStatus: '', expectedBody: '' },
    }));
    setup();
    selectConcreteTarget();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2 headers')).toBeInTheDocument();
  });
});
