/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  MicroserviceProtocolPanel,
  type MicroserviceProtocolPanelProps,
} from './MicroserviceProtocolPanel';
import type { Environment, GlobalAuthProfile, Microservice } from '@shared/types';

function makeProps(overrides: Partial<MicroserviceProtocolPanelProps> = {}): MicroserviceProtocolPanelProps {
  const svc: Microservice = {
    id: 'svc-1',
    name: 'demo-svc',
    baseUrls: { e1: 'https://api.example.com' },
    enabledProtocols: ['http', 'graphql', 'grpc'],
    protocolEndpoints: {
      graphql: { e1: { baseUrl: 'https://gql.example.com', path: '/graphql' } },
    },
    ...overrides.svc,
  };
  const environments: Environment[] = overrides.environments ?? [{ id: 'e1', name: 'test' }];
  return {
    svc,
    environments,
    appGlobalAuthProfiles: overrides.appGlobalAuthProfiles ?? [
      { id: 'auth-1', name: 'Basic', auth: { type: 'basic', username: 'u', password: 'p' } },
    ] as GlobalAuthProfile[],
    selectedEnvId: 'e1',
    activeProtocol: overrides.activeProtocol ?? 'grpc',
    enabledProtocols: svc.enabledProtocols ?? ['http', 'graphql', 'grpc'],
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

describe('MicroserviceProtocolPanel', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('renders empty state when no protocols are enabled', () => {
    render(
      <MicroserviceProtocolPanel
        {...makeProps({ enabledProtocols: [], activeProtocol: 'http' })}
      />,
    );
    expect(screen.getByText(/No protocols added yet/)).toBeInTheDocument();
  });

  it('does not render add menu when every protocol is already enabled', () => {
    render(
      <MicroserviceProtocolPanel
        {...makeProps({
          enabledProtocols: ['http', 'websocket', 'sse', 'graphql', 'grpc'],
          activeProtocol: 'http',
        })}
      />,
    );
    expect(screen.queryByTestId('em-add-protocol-btn')).not.toBeInTheDocument();
  });

  it('shows gRPC unresolved notice and Not configured label for empty grpc rows', () => {
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'grpc' })} />);
    expect(screen.getByTestId('grpc-unresolved-notice')).toBeInTheDocument();
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('✗ unresolved').length).toBeGreaterThan(0);
  });

  it('closes add protocol menu on outside mousedown', () => {
    vi.useFakeTimers();
    render(
      <MicroserviceProtocolPanel
        {...makeProps({ enabledProtocols: ['http'], activeProtocol: 'http' })}
      />,
    );
    fireEvent.click(screen.getByTestId('em-add-protocol-btn'));
    expect(screen.getByTestId('em-add-protocol-menu')).toBeVisible();
    act(() => { vi.runAllTimers(); });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('em-add-protocol-menu')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('calls onAddProtocol when selecting a menu item', () => {
    const props = makeProps({ enabledProtocols: ['http'], activeProtocol: 'http' });
    render(<MicroserviceProtocolPanel {...props} />);
    fireEvent.click(screen.getByTestId('em-add-protocol-btn'));
    fireEvent.click(screen.getByTestId('em-add-protocol-item-sse'));
    expect(props.onAddProtocol).toHaveBeenCalledWith('sse');
  });

  it('shows graphql path input on graphql tab', () => {
    render(<MicroserviceProtocolPanel {...makeProps({ activeProtocol: 'graphql' })} />);
    expect(screen.getByTestId('em-graphql-path-input')).toHaveValue('/graphql');
  });

  it('renders ProtocolHeaderBadges via exported helper counts', async () => {
    const { ProtocolHeaderBadges } = await import('./MicroserviceProtocolPanel');
    render(
      <ProtocolHeaderBadges
        svc={makeProps().svc}
        environments={[{ id: 'e1', name: 'test' }]}
        enabledProtocols={['http', 'grpc']}
      />,
    );
    expect(screen.getByTestId('protocol-header-badges')).toHaveTextContent('HTTP');
    expect(screen.getByTestId('protocol-header-badges')).toHaveTextContent('gRPC');
  });
});
