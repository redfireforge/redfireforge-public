/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MicroserviceProtocolPanel,
  type MicroserviceProtocolPanelProps,
} from './MicroserviceProtocolPanel';
import type { Environment, GlobalAuthProfile, Microservice } from '@shared/types';

function makeProps(overrides: Partial<MicroserviceProtocolPanelProps> = {}): MicroserviceProtocolPanelProps {
  const svc: Microservice = {
    id: 'svc-1',
    name: 'demo-svc',
    baseUrls: { e1: 'https://api.example.com', e2: '' },
    enabledProtocols: ['http', 'websocket', 'sse', 'graphql', 'grpc'],
    protocolEndpoints: {
      graphql: { e1: { baseUrl: 'https://gql.example.com', path: '/graphql' } },
      grpc: { e1: { baseUrl: 'grpc.example.com:50051', tls: false } },
      sse: { e2: { baseUrl: '' } },
    },
    globalVars: { requestId: 'global-req' },
    envVars: { e1: { token: 'local-token' } },
    customEnvs: [{ id: 'c1', name: 'staging' }],
    ...overrides.svc,
  };
  const environments: Environment[] = overrides.environments ?? [
    { id: 'e1', name: 'test' },
    { id: 'e2', name: 'prod' },
  ];
  return {
    svc,
    environments,
    appGlobalAuthProfiles: overrides.appGlobalAuthProfiles ?? [
      { id: 'auth-1', name: 'Basic', auth: { type: 'basic', username: 'u', password: 'p' } },
    ] as GlobalAuthProfile[],
    selectedEnvId: 'e1',
    activeProtocol: overrides.activeProtocol ?? 'http',
    enabledProtocols: svc.enabledProtocols ?? ['http', 'websocket', 'sse', 'graphql', 'grpc'],
    onProtocolChange: vi.fn(),
    onAddProtocol: vi.fn(),
    onRemoveProtocol: vi.fn(),
    editing: null,
    onStartEdit: vi.fn(),
    onEditValueChange: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveEdit: vi.fn(),
    onToggleDeploy: vi.fn(),
    onSetAuthProfile: vi.fn(),
    onGraphqlPathChange: vi.fn(),
    onToggleGrpcTls: vi.fn(),
    newAdditionalEnvName: '',
    onNewAdditionalEnvNameChange: vi.fn(),
    onAddAdditionalEnv: vi.fn(),
    onDeleteAdditionalEnv: vi.fn(),
    onSetGlobalVar: vi.fn(),
    onDeleteGlobalVar: vi.fn(),
    onSetEnvVar: vi.fn(),
    onDeleteEnvVar: vi.fn(),
    ...overrides,
  };
}

describe('MicroserviceProtocolPanel coverage gaps', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('renders HTTP table with env vars badge and auth select for deployed rows', () => {
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'http' })} />);
    expect(screen.getByTestId('env-vars-badge-e1')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Auth profile').length).toBeGreaterThan(0);
    expect(screen.getByText('staging')).toBeInTheDocument();
  });

  it('opens protocol vars modal, edits rows, and saves merged global vars', () => {
    const props = makeProps({ activeProtocol: 'http' });
    render(<MicroserviceProtocolPanel {...props} />);
    fireEvent.click(screen.getByTestId('protocol-vars-badge'));
    const modal = screen.getByTestId('protocol-vars-modal');
    expect(modal).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('protocol-vars-key-input'), { target: { value: 'traceId' } });
    fireEvent.change(screen.getByTestId('protocol-vars-val-input'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('protocol-vars-add-btn'));

    const requestRow = within(modal).getByTestId('protocol-var-row-requestId');
    fireEvent.change(within(requestRow).getByTestId('protocol-var-value-requestId'), { target: { value: 'updated' } });
    fireEvent.click(within(requestRow).getByTestId('protocol-var-delete-requestId'));

    fireEvent.click(screen.getByTestId('protocol-vars-save-btn'));
    expect(props.onDeleteGlobalVar).toHaveBeenCalledWith('requestId');
    expect(props.onSetGlobalVar).toHaveBeenCalledWith('traceId', 'abc');
    expect(props.onSetGlobalVar).not.toHaveBeenCalledWith('requestId', 'updated');
  });

  it('closes protocol vars modal via overlay click and cancel button', () => {
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'http' })} />);
    fireEvent.click(screen.getByTestId('protocol-vars-badge'));
    fireEvent.click(screen.getByTestId('protocol-vars-close-btn'));
    expect(screen.queryByTestId('protocol-vars-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('protocol-vars-badge'));
    fireEvent.mouseDown(screen.getByTestId('protocol-vars-modal-overlay'));
    expect(screen.queryByTestId('protocol-vars-modal')).not.toBeInTheDocument();
  });

  it('opens env vars modal with global read-only rows and saves overrides', () => {
    const props = makeProps({ activeProtocol: 'http' });
    render(<MicroserviceProtocolPanel {...props} />);
    fireEvent.click(screen.getByTestId('env-vars-badge-e1'));
    const modal = screen.getByTestId('env-vars-modal');
    expect(within(modal).getByTestId('global-var-ref-row-requestId')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('env-vars-key-input'), { target: { value: 'extra' } });
    fireEvent.change(screen.getByTestId('env-vars-val-input'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByTestId('env-vars-add-btn'));

    const tokenRow = within(modal).getByTestId('env-var-row-token');
    fireEvent.change(within(tokenRow).getByTestId('env-var-value-token'), { target: { value: 'new-token' } });
    fireEvent.click(within(tokenRow).getByTestId('env-var-delete-token'));

    fireEvent.click(screen.getByTestId('env-vars-save-btn'));
    expect(props.onDeleteEnvVar).toHaveBeenCalledWith('e1', 'token');
    expect(props.onSetEnvVar).toHaveBeenCalledWith('e1', 'extra', 'v1');
  });

  it('supports draggable modal header and resize handle without throwing', () => {
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'http' })} />);
    fireEvent.click(screen.getByTestId('protocol-vars-badge'));
    const header = screen.getByTestId('protocol-vars-modal-header');
    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 140, clientY: 130 });
      fireEvent.mouseUp(document);
    });
    const handle = document.querySelector('.em-vars-modal-resize-handle');
    expect(handle).toBeTruthy();
    fireEvent.mouseDown(handle!, { clientX: 500, clientY: 400 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 560, clientY: 460 });
      fireEvent.mouseUp(document);
    });
  });

  it('shows SSE fallback notice when SSE rows use HTTP fallback', () => {
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'sse' })} />);
    expect(screen.getByTestId('sse-fallback-notice')).toHaveTextContent('{{sseUrl}}');
  });

  it('renders websocket auth column and grpc TLS toggle', () => {
    const grpcProps = makeProps({ activeProtocol: 'grpc' });
    const { rerender } = render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'websocket' })} />);
    expect(screen.getAllByLabelText('Auth profile').length).toBeGreaterThan(0);

    rerender(<MicroserviceProtocolPanel {...grpcProps} />);
    const tlsToggle = screen.getByLabelText('TLS for test');
    expect(tlsToggle).not.toBeChecked();
    fireEvent.click(tlsToggle);
    expect(grpcProps.onToggleGrpcTls).toHaveBeenCalledWith('e1', true);
  });

  it('submits additional environment form and deletes custom env auth row', () => {
    const props = makeProps({
      activeProtocol: 'http',
      newAdditionalEnvName: 'qa-2',
      svc: {
        id: 'svc-1',
        name: 'demo-svc',
        baseUrls: { e1: 'https://api.example.com', c1: 'https://staging.example.com' },
        enabledProtocols: ['http'],
        customEnvs: [{ id: 'c1', name: 'staging' }],
        envVars: { c1: { token: 'staging-token' } },
      },
    });
    render(<MicroserviceProtocolPanel {...props} />);
    fireEvent.click(screen.getByTestId('env-vars-badge-c1'));
    fireEvent.click(screen.getByTestId('env-vars-close-btn'));
    fireEvent.submit(screen.getByPlaceholderText('+ Add additional environment (e.g. staging-2)'));
    expect(props.onAddAdditionalEnv).toHaveBeenCalled();
    fireEvent.click(screen.getAllByTitle('Remove additional environment')[0]);
    expect(props.onDeleteAdditionalEnv).toHaveBeenCalledWith('c1');
  });

  it('covers websocket custom env deploy toggle and undeployed delete affordance', () => {
    const props = makeProps({
      activeProtocol: 'websocket',
      svc: {
        id: 'svc-1',
        name: 'demo-svc',
        baseUrls: { e1: 'https://api.example.com' },
        enabledProtocols: ['websocket'],
        customEnvs: [{ id: 'c2', name: 'qa' }],
        protocolEndpoints: { websocket: { e1: { baseUrl: 'wss://ws.example.com' } } },
      },
    });
    render(<MicroserviceProtocolPanel {...props} />);
    fireEvent.click(screen.getByLabelText('Deploy qa'));
    expect(props.onToggleDeploy).toHaveBeenCalledWith('c2');
    fireEvent.click(screen.getAllByTitle('Remove additional environment')[0]);
    expect(props.onDeleteAdditionalEnv).toHaveBeenCalledWith('c2');
  });

  it('enters endpoint edit mode on HTTP tab', () => {
    const onStartEdit = vi.fn();
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'http', onStartEdit })} />);
    fireEvent.click(screen.getAllByTestId('em-endpoint-edit-btn')[0]);
    expect(onStartEdit).toHaveBeenCalledWith({ kind: 'http', envId: 'e1', value: 'https://api.example.com' });
  });

  it('enters endpoint edit mode on grpc tab', () => {
    const onStartEdit = vi.fn();
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'grpc', onStartEdit })} />);
    fireEvent.click(screen.getAllByTestId('em-endpoint-edit-btn')[0]);
    expect(onStartEdit).toHaveBeenCalledWith({
      kind: 'protocol',
      protocol: 'grpc',
      envId: 'e1',
      value: 'grpc.example.com:50051',
    });
  });

  it('renders editing state with save disabled on invalid grpc value', () => {
    render(
      <MicroserviceProtocolPanel
        {...makeProps({
          activeProtocol: 'grpc',
          editing: { kind: 'protocol', protocol: 'grpc', envId: 'e1', value: 'grpc://bad' },
        })}
      />,
    );
    expect(screen.getByTestId('em-endpoint-save-btn')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('em-endpoint-edit-input'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByTestId('em-endpoint-edit-input'), { key: 'Enter' });
  });
});
