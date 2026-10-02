import { useRef } from 'react';
import type { Tab } from '../utils/appTabUtils';
import type { Microservice, GlobalAuthProfile } from '@shared/types';
import type { UseKafkaStateReturn } from '../hooks/useKafkaState';
import { KafkaMessageStudioPage } from '../../features/kafka/KafkaMessageStudioPage';
import { WebSocketStudioPage } from '../../features/websocket/WebSocketStudioPage';
import { SseStudioPage } from '../../features/sse/SseStudioPage';
import { GraphqlStudioPage } from '@graphql/GraphqlStudioPage';
import { GrpcStudioPage } from '@grpc/GrpcStudioPage';
import { ApiMockStudioPage } from '../../features/api-mock/ApiMockStudioPage';

type Props = {
  activeTab: Tab;
  kafkaState: UseKafkaStateReturn;
  onNavigateToKafkaSettings: () => void;
  onUseAsWorkflowInput: (payload: string, meta: { topic: string; partition: number; offset: string }) => void;
  lastWorkflowOutput: Record<string, string> | null;
  resolvedBaseUrl: string;
  selectedEnvName?: string;
  selectedSvcName?: string;
  selectedSvc?: Microservice;
  selectedEnvId?: string;
  appGlobalAuthProfiles: GlobalAuthProfile[];
  workspaceDefaults: Record<string, string>;
};

export default function AppProtocolStudios({
  activeTab,
  kafkaState,
  onNavigateToKafkaSettings,
  onUseAsWorkflowInput,
  lastWorkflowOutput,
  resolvedBaseUrl,
  selectedEnvName,
  selectedSvcName,
  selectedSvc,
  selectedEnvId,
  appGlobalAuthProfiles,
  workspaceDefaults,
}: Props) {
  const apiMockMounted = useRef(false);
  const kafkaMounted = useRef(false);
  if (activeTab === 'api-mock-studio') apiMockMounted.current = true;
  if (activeTab === 'kafka-message-studio') kafkaMounted.current = true;

  return (
    <>
      {kafkaMounted.current && (
        <div
          className="app-tab-pane"
          style={{ display: activeTab === 'kafka-message-studio' ? 'flex' : 'none', flexDirection: 'column' }}
        >
          <KafkaMessageStudioPage
            kafkaState={kafkaState}
            onNavigateToKafkaSettings={onNavigateToKafkaSettings}
            onUseAsWorkflowInput={onUseAsWorkflowInput}
            lastWorkflowOutput={lastWorkflowOutput}
          />
        </div>
      )}

      {activeTab === 'websocket-studio' && (
        <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <WebSocketStudioPage
            resolvedBaseUrl={resolvedBaseUrl}
            envName={selectedEnvName}
            svcName={selectedSvcName}
            selectedSvc={selectedSvc}
            selectedEnvId={selectedEnvId}
            globalAuthProfiles={appGlobalAuthProfiles}
          />
        </div>
      )}

      {activeTab === 'sse-studio' && (
        <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <SseStudioPage
            resolvedBaseUrl={resolvedBaseUrl}
            envName={selectedEnvName}
            svcName={selectedSvcName}
            selectedSvc={selectedSvc}
            selectedEnvId={selectedEnvId}
            globalAuthProfiles={appGlobalAuthProfiles}
          />
        </div>
      )}

      {activeTab === 'graphql-studio' && (
        <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <GraphqlStudioPage
            resolvedBaseUrl={resolvedBaseUrl}
            envName={selectedEnvName}
            svcName={selectedSvcName}
            selectedSvc={selectedSvc}
            selectedEnvId={selectedEnvId}
            globalAuthProfiles={appGlobalAuthProfiles}
          />
        </div>
      )}

      {activeTab === 'grpc-studio' && (
        <div className="app-tab-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <GrpcStudioPage
            resolvedBaseUrl={resolvedBaseUrl}
            envName={selectedEnvName}
            svcName={selectedSvcName}
            selectedSvc={selectedSvc}
            selectedEnvId={selectedEnvId}
            workspaceDefaultsOverride={workspaceDefaults}
            globalAuthProfiles={appGlobalAuthProfiles}
          />
        </div>
      )}

      {apiMockMounted.current && (
        <div className="app-tab-pane" style={{ display: activeTab === 'api-mock-studio' ? 'flex' : 'none', flexDirection: 'column' }}>
          <ApiMockStudioPage />
        </div>
      )}
    </>
  );
}
