import { useCallback, useState } from 'react';
import { useKafkaMessageStudio } from '@app/hooks/useKafkaMessageStudio';
import { useKafkaTemplates } from '@app/hooks/useKafkaTemplates';
import { useKafkaStreamMode } from '@app/hooks/useKafkaStreamMode';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';
import { KafkaStudioGuard } from './KafkaStudioGuard';
import { KafkaPublishStudio } from './KafkaPublishStudio';
import { KafkaConsumeStudio } from './KafkaConsumeStudio';
import { KafkaTopicExplorerContent } from './KafkaTopicExplorerPage';
import { KafkaSchemaRegistryContent } from './KafkaSchemaRegistryPage';

type KafkaStudioTab = 'publish' | 'consume' | 'topics' | 'schema';
export type KafkaConsumeMode = 'once' | 'stream';

interface KafkaMessageStudioPageProps {
  kafkaState: UseKafkaStateReturn;
  onNavigateToKafkaSettings: () => void;
  onUseAsWorkflowInput?: (payload: string, meta: { topic: string; partition: number; offset: string }) => void;
  lastWorkflowOutput?: Record<string, string> | null;
}

export function KafkaMessageStudioPage({
  kafkaState,
  onNavigateToKafkaSettings,
  onUseAsWorkflowInput,
  lastWorkflowOutput,
}: KafkaMessageStudioPageProps) {
  const [activeTab, setActiveTab] = useState<KafkaStudioTab>('publish');
  /** First visit mounts Topics; later tab switches hide it so the selection and filters stay. */
  const [topicsMounted, setTopicsMounted] = useState(false);
  const showTab = useCallback((tab: KafkaStudioTab) => {
    if (tab === 'topics') setTopicsMounted(true);
    setActiveTab(tab);
  }, []);
  /** Survives Publish/Topics/Schema switches — ConsumeStudio unmounts with the outer tab. */
  const [consumeMode, setConsumeMode] = useState<KafkaConsumeMode>('once');
  const studio = useKafkaMessageStudio(kafkaState);
  const templates = useKafkaTemplates();
  const streamMode = useKafkaStreamMode(kafkaState);

  // ── Publish template handlers ────────────────────────────────────────────
  const handleSavePublishTemplate = useCallback(
    (name: string) => templates.savePublishTemplate(name, studio.publishDraft),
    [templates, studio.publishDraft],
  );

  const handleLoadPublishTemplate = useCallback(
    (id: string) => {
      const draft = templates.loadPublishTemplate(id);
      if (draft) studio.setPublishDraft(draft);
    },
    [templates, studio],
  );

  // ── Consume template handlers ────────────────────────────────────────────
  const handleSaveConsumeTemplate = useCallback(
    (name: string) => templates.saveConsumeTemplate(name, studio.consumeDraft),
    [templates, studio.consumeDraft],
  );

  const handleLoadConsumeTemplate = useCallback(
    (id: string) => {
      // groupId is stripped by the hook — the patch merge preserves the current session's groupId
      const draft = templates.loadConsumeTemplate(id);
      if (draft) studio.setConsumeDraft(draft);
    },
    [templates, studio],
  );

  if (!kafkaState.loaded) {
    return (
      <div className="kafka-message-studio-page">
        <p className="kafka-ms-loading">Loading Kafka settings…</p>
      </div>
    );
  }

  const isConnected = kafkaState.connection.state === 'connected';
  const clusterId = kafkaState.selectedClusterId ?? '';

  return (
    <div className="kafka-message-studio-page">
      <div className="builder-tabs kafka-ms-studio-tabs">
        <button
          type="button"
          className={`builder-tab ${activeTab === 'publish' ? 'active' : ''}`}
          onClick={() => showTab('publish')}
          data-testid="tab-publish"
        >
          Publish
        </button>
        <button
          type="button"
          className={`builder-tab ${activeTab === 'consume' ? 'active' : ''}`}
          onClick={() => showTab('consume')}
          data-testid="tab-consume"
        >
          Consume
        </button>
        <button
          type="button"
          className={`builder-tab ${activeTab === 'topics' ? 'active' : ''}`}
          onClick={() => showTab('topics')}
          data-testid="tab-topics"
        >
          Topics
        </button>
        <button
          type="button"
          className={`builder-tab ${activeTab === 'schema' ? 'active' : ''}`}
          onClick={() => showTab('schema')}
          data-testid="tab-schema"
        >
          Schema Registry
        </button>
      </div>
      {templates.templateError && (
        <div className="kafka-ms-template-error" data-testid="template-error">
          Template error: {templates.templateError}
        </div>
      )}
      <div className="kafka-ms-tab-content">
        {activeTab === 'publish' && (
          <KafkaPublishStudio
            studio={studio}
            clusterId={clusterId}
            publishTemplates={templates.publishTemplates}
            templatesLoading={templates.templatesLoading}
            onSaveTemplate={handleSavePublishTemplate}
            onLoadTemplate={handleLoadPublishTemplate}
            onDeleteTemplate={templates.deletePublishTemplate}
            lastWorkflowOutput={lastWorkflowOutput}
            connected={isConnected}
          />
        )}
        {activeTab === 'consume' && (
          <KafkaConsumeStudio
            studio={studio}
            clusterId={clusterId}
            consumeTemplates={templates.consumeTemplates}
            templatesLoading={templates.templatesLoading}
            onSaveConsumeTemplate={handleSaveConsumeTemplate}
            onLoadConsumeTemplate={handleLoadConsumeTemplate}
            onDeleteConsumeTemplate={templates.deleteConsumeTemplate}
            streamMode={streamMode}
            consumeMode={consumeMode}
            onConsumeModeChange={setConsumeMode}
            onUseAsWorkflowInput={onUseAsWorkflowInput}
            connected={isConnected}
          />
        )}
        {topicsMounted && (
          <div
            className="kafka-ms-tab-pane"
            hidden={activeTab !== 'topics'}
            data-testid="kafka-topics-pane"
          >
            {!isConnected ? (
              <KafkaStudioGuard
                connection={kafkaState.connection}
                hasClusters={kafkaState.clusters.length > 0}
                onNavigateToSettings={onNavigateToKafkaSettings}
              />
            ) : (
              <KafkaTopicExplorerContent kafkaState={kafkaState} />
            )}
          </div>
        )}
        {activeTab === 'schema' && (
          <KafkaSchemaRegistryContent kafkaState={kafkaState} />
        )}
      </div>
    </div>
  );
}
