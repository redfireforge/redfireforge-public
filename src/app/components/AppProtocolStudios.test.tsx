/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppProtocolStudios from './AppProtocolStudios';
import type { Microservice, GlobalAuthProfile } from '@shared/types';

vi.mock('../../features/kafka/KafkaMessageStudioPage', () => ({
  KafkaMessageStudioPage: () => <div data-testid="kafka-page" />,
}));
vi.mock('../../features/websocket/WebSocketStudioPage', () => ({
  WebSocketStudioPage: () => <div data-testid="websocket-page" />,
}));
vi.mock('../../features/sse/SseStudioPage', () => ({
  SseStudioPage: () => <div data-testid="sse-page" />,
}));
vi.mock('../../features/graphql/GraphqlStudioPage', () => ({
  GraphqlStudioPage: () => <div data-testid="graphql-page" />,
}));
vi.mock('../../features/grpc/GrpcStudioPage', () => ({
  GrpcStudioPage: () => <div data-testid="grpc-page" />,
}));
vi.mock('../../features/api-mock/ApiMockStudioPage', () => ({
  ApiMockStudioPage: () => <div data-testid="api-mock-page" />,
}));

const kafkaState = {} as never;
const onNavigateToKafkaSettings = vi.fn();
const onUseAsWorkflowInput = vi.fn();
const lastWorkflowOutput = null;
const resolvedBaseUrl = 'https://api.example.test';
const selectedSvc = { id: 'svc-1', name: 'Orders', baseUrls: {} } as Microservice;
const appGlobalAuthProfiles: GlobalAuthProfile[] = [];
const workspaceDefaults = {};

describe('AppProtocolStudios', () => {
  it('renders the matching studio page for each active tab', () => {
    render(
      <AppProtocolStudios
        activeTab="kafka-message-studio"
        kafkaState={kafkaState}
        onNavigateToKafkaSettings={onNavigateToKafkaSettings}
        onUseAsWorkflowInput={onUseAsWorkflowInput}
        lastWorkflowOutput={lastWorkflowOutput}
        resolvedBaseUrl={resolvedBaseUrl}
        selectedEnvName="Dev"
        selectedSvcName="Orders"
        selectedSvc={selectedSvc}
        selectedEnvId="env-dev"
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        workspaceDefaults={workspaceDefaults}
      />,
    );
    expect(screen.getByTestId('kafka-page')).toBeTruthy();

    render(
      <AppProtocolStudios
        activeTab="websocket-studio"
        kafkaState={kafkaState}
        onNavigateToKafkaSettings={onNavigateToKafkaSettings}
        onUseAsWorkflowInput={onUseAsWorkflowInput}
        lastWorkflowOutput={lastWorkflowOutput}
        resolvedBaseUrl={resolvedBaseUrl}
        selectedEnvName="Dev"
        selectedSvcName="Orders"
        selectedSvc={selectedSvc}
        selectedEnvId="env-dev"
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        workspaceDefaults={workspaceDefaults}
      />,
    );
    expect(screen.getByTestId('websocket-page')).toBeTruthy();

    render(
      <AppProtocolStudios
        activeTab="sse-studio"
        kafkaState={kafkaState}
        onNavigateToKafkaSettings={onNavigateToKafkaSettings}
        onUseAsWorkflowInput={onUseAsWorkflowInput}
        lastWorkflowOutput={lastWorkflowOutput}
        resolvedBaseUrl={resolvedBaseUrl}
        selectedEnvName="Dev"
        selectedSvcName="Orders"
        selectedSvc={selectedSvc}
        selectedEnvId="env-dev"
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        workspaceDefaults={workspaceDefaults}
      />,
    );
    expect(screen.getByTestId('sse-page')).toBeTruthy();

    render(
      <AppProtocolStudios
        activeTab="graphql-studio"
        kafkaState={kafkaState}
        onNavigateToKafkaSettings={onNavigateToKafkaSettings}
        onUseAsWorkflowInput={onUseAsWorkflowInput}
        lastWorkflowOutput={lastWorkflowOutput}
        resolvedBaseUrl={resolvedBaseUrl}
        selectedEnvName="Dev"
        selectedSvcName="Orders"
        selectedSvc={selectedSvc}
        selectedEnvId="env-dev"
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        workspaceDefaults={workspaceDefaults}
      />,
    );
    expect(screen.getByTestId('graphql-page')).toBeTruthy();

    render(
      <AppProtocolStudios
        activeTab="grpc-studio"
        kafkaState={kafkaState}
        onNavigateToKafkaSettings={onNavigateToKafkaSettings}
        onUseAsWorkflowInput={onUseAsWorkflowInput}
        lastWorkflowOutput={lastWorkflowOutput}
        resolvedBaseUrl={resolvedBaseUrl}
        selectedEnvName="Dev"
        selectedSvcName="Orders"
        selectedSvc={selectedSvc}
        selectedEnvId="env-dev"
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        workspaceDefaults={workspaceDefaults}
      />,
    );
    expect(screen.getByTestId('grpc-page')).toBeTruthy();
  });

  it('keeps the Kafka studio mounted when switching away', () => {
    const props = {
      kafkaState,
      onNavigateToKafkaSettings,
      onUseAsWorkflowInput,
      lastWorkflowOutput,
      resolvedBaseUrl,
      selectedEnvName: 'Dev',
      selectedSvcName: 'Orders',
      selectedSvc,
      selectedEnvId: 'env-dev',
      appGlobalAuthProfiles,
      workspaceDefaults,
    };

    const { rerender } = render(
      <AppProtocolStudios {...props} activeTab="kafka-message-studio" />,
    );
    const pane = screen.getByTestId('kafka-page').parentElement;
    expect(pane?.style.display).toBe('flex');

    rerender(<AppProtocolStudios {...props} activeTab="preferences" />);
    expect(screen.getByTestId('kafka-page')).toBeTruthy();
    expect(pane?.style.display).toBe('none');
  });

  it('renders api-mock studio when active and keeps it mounted when switching away', () => {
    const props = {
      kafkaState,
      onNavigateToKafkaSettings,
      onUseAsWorkflowInput,
      lastWorkflowOutput,
      resolvedBaseUrl,
      selectedEnvName: 'Dev',
      selectedSvcName: 'Orders',
      selectedSvc,
      selectedEnvId: 'env-dev',
      appGlobalAuthProfiles,
      workspaceDefaults,
    };

    const { rerender } = render(
      <AppProtocolStudios {...props} activeTab="api-mock-studio" />,
    );
    const pane = screen.getByTestId('api-mock-page').parentElement;
    expect(pane?.style.display).toBe('flex');

    rerender(<AppProtocolStudios {...props} activeTab="requests" />);
    expect(screen.getByTestId('api-mock-page')).toBeTruthy();
    expect(pane?.style.display).toBe('none');
  });

  it('renders nothing for an unrecognized tab', () => {
    const { container } = render(
      <AppProtocolStudios
        activeTab="requests"
        kafkaState={kafkaState}
        onNavigateToKafkaSettings={onNavigateToKafkaSettings}
        onUseAsWorkflowInput={onUseAsWorkflowInput}
        lastWorkflowOutput={lastWorkflowOutput}
        resolvedBaseUrl={resolvedBaseUrl}
        selectedEnvName="Dev"
        selectedSvcName="Orders"
        selectedSvc={selectedSvc}
        selectedEnvId="env-dev"
        appGlobalAuthProfiles={appGlobalAuthProfiles}
        workspaceDefaults={workspaceDefaults}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});