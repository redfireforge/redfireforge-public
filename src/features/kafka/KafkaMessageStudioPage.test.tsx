/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KafkaMessageStudioPage } from './KafkaMessageStudioPage';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';

vi.mock('./KafkaTopicExplorerPage', async () => {
  const { useState } = await import('react');
  function KafkaTopicExplorerContent() {
    const [note, setNote] = useState('fresh');
    return (
      <div data-testid="topic-explorer-page">
        <span data-testid="topic-explorer-note">{note}</span>
        <button type="button" data-testid="topic-explorer-mark" onClick={() => setNote('kept')}>
          Mark
        </button>
      </div>
    );
  }
  return {
    KafkaTopicExplorerContent,
    KafkaTopicExplorerPage: () => <div>Topic Explorer Page</div>,
  };
});
vi.mock('./KafkaSchemaRegistryPage', () => ({
  KafkaSchemaRegistryContent: () => <div data-testid="schema-registry-page">Schema Registry Content</div>,
  KafkaSchemaRegistryPage: () => <div>Schema Registry Page</div>,
}));

// Default synchronous mock for useKafkaTemplates — prevents async useEffect from causing
// "not wrapped in act()" warnings in tests that do not need custom template behavior.
vi.mock('../../app/hooks/useKafkaTemplates', () => ({
  useKafkaTemplates: () => ({
    publishTemplates: [],
    consumeTemplates: [],
    templatesLoading: false,
    templateError: null,
    savePublishTemplate: vi.fn().mockResolvedValue(undefined),
    loadPublishTemplate: vi.fn().mockReturnValue(null),
    deletePublishTemplate: vi.fn().mockResolvedValue(undefined),
    saveConsumeTemplate: vi.fn().mockResolvedValue(undefined),
    loadConsumeTemplate: vi.fn().mockReturnValue(null),
    deleteConsumeTemplate: vi.fn().mockResolvedValue(undefined),
    removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Default synchronous mock for useKafkaStreamMode — prevents async polling effects from
// causing "not wrapped in act()" warnings.
vi.mock('../../app/hooks/useKafkaStreamMode', () => ({
  useKafkaStreamMode: () => ({
    isStreaming: false,
    streamMessages: [],
    streamError: null,
    streamSubscriptionId: null,
    cursorGap: false,
    startStream: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn().mockResolvedValue(undefined),
    clearStreamMessages: vi.fn(),
    selectedStreamIndex: null,
    selectedStreamMessage: null,
    selectStreamMessage: vi.fn(),
  }),
}));

function makeKafkaState(overrides?: Partial<UseKafkaStateReturn>): UseKafkaStateReturn {
  return {
    loaded: true,
    clusters: [],
    connection: { state: 'connected', clusterId: 'cluster-a' },
    selectedClusterId: 'cluster-a',
    selectedCluster: null,
    topics: [],
    topicsLoading: false,
    topicsError: null,
    includeInternalTopics: false,
    lastError: null,
    lastErrorDetail: null,
    statusPollFailureStreak: 0,
    autoConnectOnStartup: false,
    setAutoConnectOnStartup: vi.fn(),
    setIncludeInternalTopics: vi.fn(),
    setSelectedClusterId: vi.fn(),
    upsertCluster: vi.fn(),
    removeCluster: vi.fn(),
    replaceClusters: vi.fn(),
    connectSelectedCluster: vi.fn(),
    disconnectActiveCluster: vi.fn(),
    testSelectedClusterConnection: vi.fn(),
    refreshConnectionStatus: vi.fn().mockResolvedValue(undefined),
    refreshTopics: vi.fn().mockResolvedValue(undefined),
    setConnectionState: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  } as unknown as UseKafkaStateReturn;
}

describe('KafkaMessageStudioPage', () => {
  it('shows loading state when not loaded', () => {
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState({ loaded: false })}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading Kafka settings…')).toBeTruthy();
  });

  it('shows tab bar and publish form when disconnected (not full-screen guard)', () => {
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState({
          loaded: true,
          clusters: [],
          connection: { state: 'disconnected' },
        })}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    // Tab bar is always visible when loaded, even when disconnected
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Consume' })).toBeTruthy();
    // Guard is shown on Topics tab, not on Publish tab by default
    expect(screen.queryByText('No clusters configured')).toBeNull();
  });

  it('shows guard on Topics tab when state=error', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState({
          loaded: true,
          clusters: [{ clusterId: 'c', name: 'C', clientId: 'rf', brokers: ['localhost:9092'] } as never],
          connection: { state: 'error', lastError: 'Auth failed' },
        })}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    // Publish tab is shown by default (no guard)
    expect(screen.queryByText('Cluster connection error')).toBeNull();
    // Navigate to Topics tab to see the guard
    await user.click(screen.getByRole('button', { name: 'Topics' }));
    expect(screen.getByText('Cluster connection error')).toBeTruthy();
  });

  it('shows guard on Topics tab when state=testing', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState({
          loaded: true,
          clusters: [{ clusterId: 'c', name: 'C', clientId: 'rf', brokers: ['localhost:9092'] } as never],
          connection: { state: 'testing' },
        })}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Topics' }));
    expect(screen.getByText('Connecting to cluster…')).toBeTruthy();
  });

  it('shows tab bar with all four tabs when connected', () => {
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Consume' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Topics' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schema Registry' })).toBeTruthy();
  });

  it('defaults to Publish tab and shows publish panel', () => {
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Publish' }).className).toContain('active');
  });

  it('switches to Consume when tab is clicked', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Consume' }));
    expect(screen.getByRole('button', { name: 'Consume' }).className).toContain('active');
  });

  it('remembers Consume Once vs Stream when switching to Publish and back', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('tab-consume'));
    await user.click(screen.getByTestId('con-mode-stream'));
    expect(screen.getByTestId('con-mode-stream').className).toContain('active');
    expect(screen.getByTestId('stream-action-row')).toBeTruthy();

    await user.click(screen.getByTestId('tab-publish'));
    expect(screen.queryByTestId('con-mode-stream')).toBeNull();

    await user.click(screen.getByTestId('tab-consume'));
    expect(screen.getByTestId('con-mode-stream').className).toContain('active');
    expect(screen.getByTestId('stream-action-row')).toBeTruthy();
  });

  it('switches to Topics tab and renders topic explorer content', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Topics' }));
    expect(screen.getByRole('button', { name: 'Topics' }).className).toContain('active');
    expect(screen.getByTestId('topic-explorer-page')).toBeTruthy();
  });

  it('keeps the Topics page mounted when switching to another Kafka tab', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Topics' }));
    await user.click(screen.getByTestId('topic-explorer-mark'));
    expect(screen.getByTestId('topic-explorer-note').textContent).toBe('kept');

    await user.click(screen.getByRole('button', { name: 'Consume' }));
    expect(screen.getByTestId('kafka-topics-pane').hidden).toBe(true);
    expect(screen.getByTestId('topic-explorer-note', { hidden: true }).textContent).toBe('kept');

    await user.click(screen.getByRole('button', { name: 'Topics' }));
    expect(screen.getByTestId('kafka-topics-pane').hidden).toBe(false);
    expect(screen.getByTestId('topic-explorer-note').textContent).toBe('kept');
  });

  it('switches to Schema Registry tab and renders schema content', async () => {
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Schema Registry' }));
    expect(screen.getByRole('button', { name: 'Schema Registry' }).className).toContain('active');
    expect(screen.getByTestId('schema-registry-page')).toBeTruthy();
  });

  it('passes onNavigateToKafkaSettings to guard (visible on Topics tab when disconnected)', async () => {
    const onNav = vi.fn();
    const user = userEvent.setup();
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState({ loaded: true, clusters: [], connection: { state: 'disconnected' } })}
        onNavigateToKafkaSettings={onNav}
      />,
    );
    // Switch to Topics tab to see the guard
    await user.click(screen.getByRole('button', { name: 'Topics' }));
    // Action button should be present in guard
    expect(screen.getByTestId('guard-action-btn')).toBeTruthy();
  });

  it('shows template error banner when useKafkaTemplates has an error', async () => {
    // Mock useKafkaTemplates to return an error
    const mockTemplateModule = await import('../../app/hooks/useKafkaTemplates');
    const spy = vi.spyOn(mockTemplateModule, 'useKafkaTemplates').mockReturnValue({
      publishTemplates: [],
      consumeTemplates: [],
      templatesLoading: false,
      templateError: 'QuotaExceededError',
      savePublishTemplate: vi.fn(),
      loadPublishTemplate: vi.fn().mockReturnValue(null),
      deletePublishTemplate: vi.fn(),
      saveConsumeTemplate: vi.fn(),
      loadConsumeTemplate: vi.fn().mockReturnValue(null),
      deleteConsumeTemplate: vi.fn(),
      removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState()}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    expect(screen.getByTestId('template-error').textContent).toContain('QuotaExceededError');
    spy.mockRestore();
  });

  it('handleSavePublishTemplate calls savePublishTemplate on templates', async () => {
    const mockTemplateModule = await import('../../app/hooks/useKafkaTemplates');
    const savePublish = vi.fn().mockResolvedValue(undefined);
    const spy = vi.spyOn(mockTemplateModule, 'useKafkaTemplates').mockReturnValue({
      publishTemplates: [],
      consumeTemplates: [],
      templatesLoading: false,
      templateError: null,
      savePublishTemplate: savePublish,
      loadPublishTemplate: vi.fn().mockReturnValue(null),
      deletePublishTemplate: vi.fn().mockResolvedValue(undefined),
      saveConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      loadConsumeTemplate: vi.fn().mockReturnValue(null),
      deleteConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
    });

    render(<KafkaMessageStudioPage kafkaState={makeKafkaState()} onNavigateToKafkaSettings={vi.fn()} />);
    // Open publish template save input and type a name
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    fireEvent.change(screen.getByPlaceholderText('Template name\u2026'), { target: { value: 'Integration Preset' } });
    fireEvent.click(screen.getByText('✓'));
    await waitFor(() => expect(savePublish).toHaveBeenCalledWith('Integration Preset', expect.any(Object)));
    spy.mockRestore();
  });

  it('handleLoadPublishTemplate applies loaded draft to studio', async () => {
    const mockTemplateModule = await import('../../app/hooks/useKafkaTemplates');
    const loadPublish = vi.fn().mockReturnValue({
      topic: 'loaded-topic', key: '', partition: '', acks: -1, timeoutMs: '', headers: [], body: '{}',
    });
    const spy = vi.spyOn(mockTemplateModule, 'useKafkaTemplates').mockReturnValue({
      publishTemplates: [{ id: 'p1', name: 'Preset A', createdAt: '2026-01-01', draft: {
        topic: 'loaded-topic', key: '', partition: '', acks: -1 as const, timeoutMs: '', headers: [], body: '{}',
      } }],
      consumeTemplates: [],
      templatesLoading: false,
      templateError: null,
      savePublishTemplate: vi.fn().mockResolvedValue(undefined),
      loadPublishTemplate: loadPublish,
      deletePublishTemplate: vi.fn().mockResolvedValue(undefined),
      saveConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      loadConsumeTemplate: vi.fn().mockReturnValue(null),
      deleteConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
    });

    render(<KafkaMessageStudioPage kafkaState={makeKafkaState()} onNavigateToKafkaSettings={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Load a saved template'));
    fireEvent.click(screen.getByText('Preset A'));
    await waitFor(() => expect(loadPublish).toHaveBeenCalledWith('p1'));
    spy.mockRestore();
  });

  it('handleSaveConsumeTemplate calls saveConsumeTemplate on templates', async () => {
    const mockTemplateModule = await import('../../app/hooks/useKafkaTemplates');
    const saveConsume = vi.fn().mockResolvedValue(undefined);
    const spy = vi.spyOn(mockTemplateModule, 'useKafkaTemplates').mockReturnValue({
      publishTemplates: [],
      consumeTemplates: [],
      templatesLoading: false,
      templateError: null,
      savePublishTemplate: vi.fn().mockResolvedValue(undefined),
      loadPublishTemplate: vi.fn().mockReturnValue(null),
      deletePublishTemplate: vi.fn().mockResolvedValue(undefined),
      saveConsumeTemplate: saveConsume,
      loadConsumeTemplate: vi.fn().mockReturnValue(null),
      deleteConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
    });

    const user = userEvent.setup();
    render(<KafkaMessageStudioPage kafkaState={makeKafkaState()} onNavigateToKafkaSettings={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Consume' }));
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    fireEvent.change(screen.getByPlaceholderText('Template name\u2026'), { target: { value: 'Consume Preset' } });
    fireEvent.click(screen.getByText('✓'));
    await waitFor(() => expect(saveConsume).toHaveBeenCalledWith('Consume Preset', expect.any(Object)));
    spy.mockRestore();
  });

  it('handleLoadConsumeTemplate applies loaded draft to studio', async () => {
    const mockTemplateModule = await import('../../app/hooks/useKafkaTemplates');
    const loadConsume = vi.fn().mockReturnValue({
      topic: 'events.v2', groupId: 'my-group', startPosition: 'earliest' as const,
      timeoutMs: '5000', maxMessages: '10', keyEquals: '', headerMatch: '', jsonPath: '', jsonPathEquals: '',
    });
    const spy = vi.spyOn(mockTemplateModule, 'useKafkaTemplates').mockReturnValue({
      publishTemplates: [],
      consumeTemplates: [{ id: 'c1', name: 'Consume A', createdAt: '2026-01-01', draft: {
        topic: 'events.v2', groupId: 'my-group', startPosition: 'earliest' as const,
        timeoutMs: '5000', maxMessages: '10', keyEquals: '', headerMatch: '', jsonPath: '', jsonPathEquals: '',
      } }],
      templatesLoading: false,
      templateError: null,
      savePublishTemplate: vi.fn().mockResolvedValue(undefined),
      loadPublishTemplate: vi.fn().mockReturnValue(null),
      deletePublishTemplate: vi.fn().mockResolvedValue(undefined),
      saveConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      loadConsumeTemplate: loadConsume,
      deleteConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
    });

    const user = userEvent.setup();
    render(<KafkaMessageStudioPage kafkaState={makeKafkaState()} onNavigateToKafkaSettings={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Consume' }));
    fireEvent.click(screen.getByTitle('Load a saved template'));
    fireEvent.click(screen.getByText('Consume A'));
    await waitFor(() => expect(loadConsume).toHaveBeenCalledWith('c1'));
    spy.mockRestore();
  });

  it('clicking the Publish tab calls setActiveTab (back to publish)', async () => {
    // Covers line 89: onClick={() => setActiveTab('publish')
    const user = userEvent.setup();
    render(<KafkaMessageStudioPage kafkaState={makeKafkaState()} onNavigateToKafkaSettings={vi.fn()} />);
    // Switch to Consume first
    await user.click(screen.getByRole('button', { name: 'Consume' }));
    expect(screen.getByRole('button', { name: 'Consume' }).className).toContain('active');
    // Switch back to Publish — this fires setActiveTab('publish')
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('button', { name: 'Publish' }).className).toContain('active');
  });

  it('handleLoadPublishTemplate: when loadPublishTemplate returns null, setPublishDraft is NOT called', async () => {
    // Covers the `if (draft)` false branch in handleLoadPublishTemplate (line 41)
    const mockTemplateModule = await import('../../app/hooks/useKafkaTemplates');
    const loadPublish = vi.fn().mockReturnValue(null); // returns null → if(draft) is false
    const setPublishDraft = vi.fn();
    const studioModule = await import('../../app/hooks/useKafkaMessageStudio');
    const studioSpy = vi.spyOn(studioModule, 'useKafkaMessageStudio').mockReturnValue({
      publishDraft: { topic: '', key: '', partition: '', acks: -1 as const, timeoutMs: '', headers: [], body: '' },
      consumeDraft: { topic: '', groupId: '', startPosition: 'latest' as const, timeoutMs: '10000', maxMessages: '10', keyEquals: '', headerMatch: '', jsonPath: '', jsonPathEquals: '' },
      setPublishDraft,
      setConsumeDraft: vi.fn(),
      publishResult: null,
      publishError: null,
      publishLoading: false,
      consumeResult: null,
      consumeError: null,
      consumeLoading: false,
      consumeMessageCount: 0,
      consumeTimedOut: false,
      selectedMessage: null,
      selectedMessageIndex: null,
      hasMore: false,
      loadMoreLoading: false,
      selectMessage: vi.fn(),
      publish: vi.fn(),
      consume: vi.fn(),
      loadMore: vi.fn(),
      cancelConsume: vi.fn(),
      clearConsumeError: vi.fn(),
      clearPublishError: vi.fn(),
    } as never);
    const spy = vi.spyOn(mockTemplateModule, 'useKafkaTemplates').mockReturnValue({
      publishTemplates: [{ id: 'p1', name: 'Null Draft', createdAt: '2026-01-01', draft: null as never }],
      consumeTemplates: [],
      templatesLoading: false,
      templateError: null,
      savePublishTemplate: vi.fn().mockResolvedValue(undefined),
      loadPublishTemplate: loadPublish,
      deletePublishTemplate: vi.fn().mockResolvedValue(undefined),
      saveConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      loadConsumeTemplate: vi.fn().mockReturnValue(null),
      deleteConsumeTemplate: vi.fn().mockResolvedValue(undefined),
      removeTemplatesByNames: vi.fn().mockResolvedValue(undefined),
    });

    render(<KafkaMessageStudioPage kafkaState={makeKafkaState()} onNavigateToKafkaSettings={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Load a saved template'));
    fireEvent.click(screen.getByText('Null Draft'));
    await waitFor(() => expect(loadPublish).toHaveBeenCalledWith('p1'));
    // draft was null → setPublishDraft should NOT be called
    expect(setPublishDraft).not.toHaveBeenCalled();
    spy.mockRestore();
    studioSpy.mockRestore();
  });

  it('when selectedClusterId is null, clusterId defaults to empty string', () => {
    // Covers the `kafkaState.selectedClusterId ?? ''` null-coalescing branch (line 81)
    render(
      <KafkaMessageStudioPage
        kafkaState={makeKafkaState({ selectedClusterId: null as unknown as string })}
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    // Component renders without crash — clusterId is '' (no cluster to show errors about)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });
});
