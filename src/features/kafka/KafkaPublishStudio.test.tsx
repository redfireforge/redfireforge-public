/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { selectOption, selectOptionByTestId } from '@test-utils/customSelectHelper';
import { KafkaPublishStudio } from './KafkaPublishStudio';
import type { UseKafkaMessageStudioReturn } from '@app/hooks/useKafkaMessageStudio';
import type { KafkaPublishDraft } from './types';

vi.mock('./KafkaBodyEditorModal', () => ({
  default: ({ onChange, onClose, format }: { onChange: (v: string) => void; onClose: () => void; format: string }) => (
    <div data-testid="mock-kafka-body-editor" data-format={format}>
      <button type="button" data-testid="mock-kafka-body-editor-change" onClick={() => onChange('{"from":"editor"}')}>change</button>
      <button type="button" data-testid="mock-kafka-body-editor-close" onClick={onClose}>close</button>
    </div>
  ),
}));

function basePublishDraft(): KafkaPublishDraft {
  return {
    topic: 'orders.events', key: '', keyFormat: 'string', partition: '', acks: -1,
    timeoutMs: '', headers: [], body: '{"hello":"world"}', bodyFormat: 'json',
  };
}

function makeStudio(overrides?: Partial<UseKafkaMessageStudioReturn>): UseKafkaMessageStudioReturn {
  return {
    publishDraft: basePublishDraft(),
    setPublishDraft: vi.fn(),
    publishLoading: false,
    publishResult: null,
    publishError: null,
    sendOnce: vi.fn().mockResolvedValue(undefined),
    validateJsonBody: vi.fn().mockReturnValue(true),
    consumeDraft: {
      topic: '', groupId: 'redfireforge-debug-12345678', startPosition: 'latest',
      timeoutMs: '10000', maxMessages: '50', keyEquals: '', headerMatch: '',
      jsonPath: '', jsonPathEquals: '',
    },
    setConsumeDraft: vi.fn(),
    consumeLoading: false,
    consumeResult: null,
    consumeTimedOut: false,
    consumeError: null,
    selectedMessageIndex: null,
    selectedMessage: null,
    selectMessage: vi.fn(),
    consumeOnce: vi.fn().mockResolvedValue(undefined),
    hasMore: false,
    loadMore: vi.fn().mockResolvedValue(undefined),
    loadMoreLoading: false,
    clearPublishResult: vi.fn(),
    clearConsumeResult: vi.fn(),
    consumeMessageCount: 0,
    ...overrides,
  } as UseKafkaMessageStudioReturn;
}

const defaultTemplateProps = () => ({
  publishTemplates: [] as { id: string; name: string; createdAt: string; draft: KafkaPublishDraft }[],
  templatesLoading: false,
  onSaveTemplate: vi.fn().mockResolvedValue(undefined),
  onLoadTemplate: vi.fn(),
  onDeleteTemplate: vi.fn().mockResolvedValue(undefined),
});

describe('KafkaPublishStudio', () => {
  it('renders topic input with current value', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    const input = screen.getByTestId('pub-topic-input') as HTMLInputElement;
    expect(input.value).toBe('orders.events');
  });

  it('Send Once button is enabled when topic is set', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    const btn = screen.getByTestId('pub-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('Send Once button is disabled when topic is empty', () => {
    const studio = makeStudio({
      publishDraft: { ...basePublishDraft(), topic: '' },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    const btn = screen.getByTestId('pub-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Send Once button is disabled while loading', () => {
    render(<KafkaPublishStudio studio={makeStudio({ publishLoading: true })} clusterId="c" {...defaultTemplateProps()} />);
    const btn = screen.getByTestId('pub-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Sending…');
  });

  it('calls sendOnce when Send Once is clicked', () => {
    const studio = makeStudio();
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTestId('pub-send-btn'));
    expect(studio.sendOnce).toHaveBeenCalledOnce();
  });

  it('calls validateJsonBody when Validate & Format JSON is clicked', () => {
    const studio = makeStudio();
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByText('Validate & Format JSON'));
    expect(studio.validateJsonBody).toHaveBeenCalledOnce();
  });

  it('shows error message when publishError is set', () => {
    const studio = makeStudio({
      publishError: { kind: 'server', code: 'TOPIC_MISSING', message: 'Topic not found', retryable: true },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-error').textContent).toContain('Topic not found');
  });

  it('shows non-retryable tag for non-retryable publish errors', () => {
    const studio = makeStudio({
      publishError: { kind: 'server', code: 'ERR', message: 'Fatal error', retryable: false },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-error').textContent).toContain('(non-retryable)');
  });

  it('shows success result when publishResult is set', () => {
    const studio = makeStudio({
      publishResult: { topic: 'orders.events', sentCount: 1, records: [{ partition: 0, offset: '42' }] },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-result').textContent).toContain('1 message');
    expect(screen.getByTestId('pub-result').textContent).toContain('orders.events');
  });

  it('calls clearPublishResult when Clear is clicked', () => {
    const studio = makeStudio({
      publishResult: { topic: 't', sentCount: 1, records: [] },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(studio.clearPublishResult).toHaveBeenCalledOnce();
  });

  it('calls setPublishDraft when topic input changes', () => {
    const studio = makeStudio();
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.change(screen.getByTestId('pub-topic-input'), { target: { value: 'new-topic' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ topic: 'new-topic' });
  });

  it('adds a header row when + Add is clicked', () => {
    const studio = makeStudio();
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByText('+ Add'));
    expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.arrayContaining([expect.objectContaining({ enabled: true })]) }),
    );
  });

  it('shows "No headers" when headers array is empty', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByText(/no custom headers/i)).toBeTruthy();
  });

  it('shows inline validation hint when topic is blurred while empty', () => {
    const studio = makeStudio({
      publishDraft: { ...basePublishDraft(), topic: '' },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.queryByTestId('pub-topic-hint')).toBeNull();
    fireEvent.blur(screen.getByTestId('pub-topic-input'));
    expect(screen.getByTestId('pub-topic-hint').textContent).toBe('Topic is required');
  });

  it('shows inline validation hint when body is blurred while empty', () => {
    const studio = makeStudio({
      publishDraft: { ...basePublishDraft(), body: '' },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.queryByTestId('pub-body-hint')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Message Body'));
    expect(screen.getByTestId('pub-body-hint').textContent).toBe('Message body is required');
  });

  it('opens and closes template Load dropdown', () => {
    const tplProps = defaultTemplateProps();
    tplProps.publishTemplates = [
      { id: 'tpl-1', name: 'My Template', createdAt: '2026-01-01', draft: basePublishDraft() },
    ];
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    fireEvent.click(screen.getByTitle('Load a saved template'));
    expect(screen.getByText('My Template')).toBeTruthy();
  });

  it('loads a template when clicked from dropdown', () => {
    const tplProps = defaultTemplateProps();
    tplProps.publishTemplates = [
      { id: 'tpl-1', name: 'My Template', createdAt: '2026-01-01', draft: basePublishDraft() },
    ];
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    fireEvent.click(screen.getByTitle('Load a saved template'));
    fireEvent.click(screen.getByText('My Template'));
    expect(tplProps.onLoadTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('shows "No saved templates" when list is empty', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTitle('Load a saved template'));
    expect(screen.getByText('No saved templates yet')).toBeTruthy();
  });
});

// ─────────────────────── Workflow Integration (Phase 3D) ───────────────────────

describe('KafkaPublishStudio — Map from Workflow', () => {
  const WF_OUTPUT = { response_body: '{"status":"ok"}', total_count: '42', raw_text: 'hello' };

  it('[Map from Workflow] disabled when no workflow output', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    const btn = screen.getByTestId('pub-map-workflow-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('[Map from Workflow] disabled when output is null', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={null} />);
    const btn = screen.getByTestId('pub-map-workflow-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('[Map from Workflow] enabled when output has entries', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    const btn = screen.getByTestId('pub-map-workflow-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('opens dropdown with variable entries', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    expect(screen.getByTestId('pub-wf-dropdown')).toBeTruthy();
    expect(screen.getByTestId('pub-wf-var-response_body')).toBeTruthy();
    expect(screen.getByTestId('pub-wf-var-total_count')).toBeTruthy();
    expect(screen.getByTestId('pub-wf-var-raw_text')).toBeTruthy();
  });

  it('selecting a JSON variable fills body with pretty-printed value', () => {
    const studio = makeStudio();
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    fireEvent.click(screen.getByTestId('pub-wf-var-response_body'));
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ body: JSON.stringify({ status: 'ok' }, null, 2) });
  });

  it('selecting a non-JSON variable fills body as raw string', () => {
    const studio = makeStudio();
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    fireEvent.click(screen.getByTestId('pub-wf-var-raw_text'));
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ body: 'hello' });
  });

  it('search input filters variables', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    fireEvent.change(screen.getByTestId('pub-wf-search'), { target: { value: 'count' } });
    expect(screen.queryByTestId('pub-wf-var-response_body')).toBeNull();
    expect(screen.getByTestId('pub-wf-var-total_count')).toBeTruthy();
  });

  it('shows "No matching variables" when search has no results', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    fireEvent.change(screen.getByTestId('pub-wf-search'), { target: { value: 'zzzzz' } });
    expect(screen.getByText('No matching variables')).toBeTruthy();
  });

  it('has tooltip "Run a workflow first" when disabled', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    const btn = screen.getByTestId('pub-map-workflow-btn');
    expect(btn.getAttribute('title')).toBe('Run a workflow first');
  });
});

// ─────────────────────── Template Save / Delete ───────────────────────

describe('KafkaPublishStudio — Template Save', () => {
  it('opens save input when Save button clicked', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    expect(screen.getByPlaceholderText('Template name\u2026')).toBeTruthy();
  });

  it('confirm button disabled when save name is empty', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    expect((screen.getByText('✓') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onSaveTemplate when confirm button clicked with name', async () => {
    const tplProps = defaultTemplateProps();
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    fireEvent.change(screen.getByPlaceholderText('Template name\u2026'), { target: { value: 'My Publish Preset' } });
    fireEvent.click(screen.getByText('✓'));
    await waitFor(() => expect(tplProps.onSaveTemplate).toHaveBeenCalledWith('My Publish Preset'));
  });

  it('calls onSaveTemplate when Enter pressed in save input', async () => {
    const tplProps = defaultTemplateProps();
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    const input = screen.getByPlaceholderText('Template name\u2026');
    fireEvent.change(input, { target: { value: 'My Publish Preset' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(tplProps.onSaveTemplate).toHaveBeenCalledWith('My Publish Preset'));
  });

  it('closes save input on Escape key', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    const input = screen.getByPlaceholderText('Template name\u2026');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Template name\u2026')).toBeNull();
  });

  it('cancel button closes save input', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByPlaceholderText('Template name\u2026')).toBeNull();
  });

  it('calls onDeleteTemplate when delete button clicked on template item', async () => {
    const tplProps = defaultTemplateProps();
    tplProps.publishTemplates = [
      { id: 'pub-1', name: 'My Preset', createdAt: '2026-01-01', draft: basePublishDraft() },
    ];
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    fireEvent.click(screen.getByTitle('Load a saved template'));
    expect(screen.getByTestId('pub-tmpl-dropdown')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Delete "My Preset"'));
    await waitFor(() => expect(tplProps.onDeleteTemplate).toHaveBeenCalledWith('pub-1'));
    await waitFor(() => expect(screen.queryByTestId('pub-tmpl-dropdown')).toBeNull());
  });
});

// ─────────────────────── Form Fields ───────────────────────

describe('KafkaPublishStudio — Form Fields', () => {
  let studio: UseKafkaMessageStudioReturn;

  beforeEach(() => {
    studio = makeStudio();
  });

  it('calls setPublishDraft when Acks select changes', () => {
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    selectOption(screen.getByLabelText('Acks').closest('.cs-wrapper')!, 'Leader (1)');
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ acks: 1 });
  });

  it('calls setPublishDraft when Key format select changes', () => {
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    selectOption(screen.getByLabelText('Key format').closest('.cs-wrapper')!, 'Hex');
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ keyFormat: 'hex' });
  });

  it('calls setPublishDraft when Key input changes', () => {
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.change(screen.getByTestId('pub-key-input'), { target: { value: 'my-key' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ key: 'my-key' });
  });

  it('calls setPublishDraft when Partition input changes', () => {
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.change(screen.getByLabelText('Partition'), { target: { value: '2' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ partition: '2' });
  });

  it('calls setPublishDraft when Timeout changes', () => {
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '5000' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ timeoutMs: '5000' });
  });

  it('calls setPublishDraft when Message Body textarea changes', () => {
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.change(screen.getByLabelText('Message Body'), { target: { value: '{"new":"body"}' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ body: '{"new":"body"}' });
  });
});

// ─────────────────────── Header Row Actions ───────────────────────

describe('KafkaPublishStudio — Header Row Actions', () => {
  function renderWithHeader() {
    const draft = { ...basePublishDraft(), headers: [{ id: 'h-1', key: 'x-env', value: 'prod', enabled: true }] };
    const studio = makeStudio({ publishDraft: draft });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    return studio;
  }

  it('calls setPublishDraft when header key changes', () => {
    const studio = renderWithHeader();
    fireEvent.change(screen.getByPlaceholderText('header-key'), { target: { value: 'x-region' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ headers: [expect.objectContaining({ key: 'x-region' })] }),
    );
  });

  it('calls setPublishDraft when header value changes', () => {
    const studio = renderWithHeader();
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'eu-west' } });
    expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ headers: [expect.objectContaining({ value: 'eu-west' })] }),
    );
  });

  it('calls setPublishDraft when header enabled checkbox changes', () => {
    const studio = renderWithHeader();
    fireEvent.click(screen.getByRole('checkbox', { name: 'enabled' }));
    expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ headers: [expect.objectContaining({ enabled: false })] }),
    );
  });

  it('replaces the header list from a pasted clipboard', async () => {
    const studio = renderWithHeader();
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn().mockResolvedValue('[{"key":"application.name","value":"ons-enrollment-core"}]'),
      },
    });
    fireEvent.click(screen.getByTestId('pub-paste-headers'));
    await waitFor(() => expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [expect.objectContaining({ key: 'application.name', value: 'ons-enrollment-core', enabled: true })],
      }),
    ));
  });

  it('reports a paste that is not a header list', async () => {
    renderWithHeader();
    Object.assign(navigator, {
      clipboard: { readText: vi.fn().mockResolvedValue('not headers') },
    });
    fireEvent.click(screen.getByTestId('pub-paste-headers'));
    expect((await screen.findByTestId('pub-paste-headers-error')).textContent)
      .toContain('Clipboard is not a header list');
  });

  it('reports when the clipboard cannot be read', async () => {
    renderWithHeader();
    Object.assign(navigator, {
      clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    fireEvent.click(screen.getByTestId('pub-paste-headers'));
    expect((await screen.findByTestId('pub-paste-headers-error')).textContent)
      .toContain('Could not read the clipboard');
  });

  it('shrinks the header list so the message body stays in view', () => {
    renderWithHeader();
    const body = screen.getByTestId('pub-headers-body');
    const toggle = screen.getByTestId('pub-headers-toggle');
    expect(body.className).not.toContain('is-shrunk');
    expect(toggle.textContent).toContain('Shrink');

    fireEvent.click(toggle);
    expect(body.className).toContain('is-shrunk');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Expand');
    expect(screen.getByLabelText('Message Body')).toBeTruthy();

    fireEvent.click(screen.getByTestId('pub-headers-toggle'));
    expect(body.className).not.toContain('is-shrunk');
    expect(screen.getByPlaceholderText('header-key')).toBeTruthy();
  });

  it('calls setPublishDraft when remove header button clicked', () => {
    const studio = renderWithHeader();
    fireEvent.click(screen.getByLabelText('Remove header'));
    expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ headers: [] }),
    );
  });

  it('shows move-up button for second header row', () => {
    const draft = {
      ...basePublishDraft(),
      headers: [
        { id: 'h-1', key: 'k1', value: 'v1', enabled: true },
        { id: 'h-2', key: 'k2', value: 'v2', enabled: true },
      ],
    };
    const studio = makeStudio({ publishDraft: draft });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    const moveUpBtn = screen.getByLabelText('Move up');
    expect(moveUpBtn).toBeTruthy();
    fireEvent.click(moveUpBtn);
    expect(studio.setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.arrayContaining([expect.objectContaining({ id: 'h-2' })]) }),
    );
  });

  it('outside click closes dropdown when dropdownOpen is true', () => {
    const tplProps = defaultTemplateProps();
    tplProps.publishTemplates = [
      { id: 'tpl-1', name: 'My Template', createdAt: '2026-01-01', draft: basePublishDraft() },
    ];
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    // Open dropdown
    fireEvent.click(screen.getByTitle('Load a saved template'));
    expect(screen.getByText('My Template')).toBeTruthy();
    // Click outside (on document body)
    fireEvent.mouseDown(document.body);
    // Dropdown should close
    expect(screen.queryByText('My Template')).toBeNull();
  });

  it('outside click on wf dropdown closes it', () => {
    const WF_OUTPUT = { some_var: 'value' };
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...defaultTemplateProps()} lastWorkflowOutput={WF_OUTPUT} />);
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    expect(screen.getByTestId('pub-wf-dropdown')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('pub-wf-dropdown')).toBeNull();
  });

  it('handleSaveSubmit: no-op when save name is blank', async () => {
    const tplProps = defaultTemplateProps();
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" {...tplProps} />);
    fireEvent.click(screen.getByTitle('Save current settings as a template'));
    // Don't type anything — name is empty
    fireEvent.click(screen.getByText('✓'));
    // Wait a tick to ensure async handler completes
    await waitFor(() => expect(tplProps.onSaveTemplate).not.toHaveBeenCalled());
  });

  it('schemaConfig onChange calls setPublishDraft', () => {
    // Covers line 356: onChange={(next) => setPublishDraft({ schemaConfig: next })}
    const setPublishDraft = vi.fn();
    render(<KafkaPublishStudio studio={makeStudio({ setPublishDraft })} clusterId="c" {...defaultTemplateProps()} />);

    const schemaCheckbox = screen.getAllByRole('checkbox').at(-1) as HTMLInputElement;
    fireEvent.click(schemaCheckbox);

    expect(setPublishDraft).toHaveBeenCalledWith(
      expect.objectContaining({ schemaConfig: { registryUrl: '', format: 'avro' } }),
    );
  });

  it('shows valueEncoding badge when publishResult has valueEncoding set', () => {
    // Covers lines 455-457: {publishResult.valueEncoding && <span>Encoding: ...</span>}
    const studio = makeStudio({
      publishResult: { topic: 'orders.events', sentCount: 1, records: [{ partition: 0, offset: '42' }], valueEncoding: 'avro' },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-result').textContent).toContain('Encoding: avro');
  });

  it('shows plural "messages" when sentCount is greater than 1', () => {
    // Covers the `sentCount !== 1 ? 's' : ''` true branch (sentCount > 1)
    const studio = makeStudio({
      publishResult: { topic: 'events', sentCount: 3, records: [] },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-result').textContent).toContain('3 messages');
  });

  it('shows timestamp in record row when r.timestamp is set', () => {
    // Covers the `r.timestamp ? \`, ts ...\` : ''` true branch
    const studio = makeStudio({
      publishResult: { topic: 'orders', sentCount: 1, records: [{ partition: 0, offset: '5', timestamp: '1700000000000' }] },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-result').textContent).toContain('ts 1700000000000');
  });

  it('clears the decode preview when the body format changes', async () => {
    const studio = makeStudio({
      publishDraft: { ...basePublishDraft(), body: 'aGVsbG8=', bodyFormat: 'base64' },
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTestId('pub-decode-preview-badge'));
    await screen.findByTestId('pub-decode-preview-result');
    selectOptionByTestId('pub-body-format', 'JSON');
    expect(studio.setPublishDraft).toHaveBeenCalledWith(expect.objectContaining({ bodyFormat: 'json' }));
    expect(screen.queryByTestId('pub-decode-preview-result')).toBeNull();
  });

  it('shows decode-preview badge when bodyFormat is base64 and calls handler', async () => {
    // Covers lines 66-72: handleDecodePreview for base64 format
    const studio = makeStudio({
      publishDraft: { topic: 'test', body: 'aGVsbG8=', bodyFormat: 'base64', acks: 1, headers: [] } as Parameters<typeof makeStudio>[0]['publishDraft'],
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    const badge = screen.getByTestId('pub-decode-preview-badge');
    expect(badge).toBeTruthy();
    fireEvent.click(badge);
    // After click, the decode preview result should appear
    await waitFor(() => {
      const result = screen.queryByTestId('pub-decode-preview-result');
      expect(result).toBeTruthy();
    });
  });

  it('shows decode-preview badge for hex format and handles invalid hex', async () => {
    // Covers lines 67 cond-expr: fmt === 'base64' is false, so validateHex is called
    const studio = makeStudio({
      publishDraft: { topic: 'test', body: 'ZZ ZZ ZZ', bodyFormat: 'hex', acks: 1, headers: [] } as Parameters<typeof makeStudio>[0]['publishDraft'],
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    const badge = screen.getByTestId('pub-decode-preview-badge');
    fireEvent.click(badge);
    await waitFor(() => {
      const result = screen.queryByTestId('pub-decode-preview-result');
      expect(result).toBeTruthy();
    });
  });

  it('decode preview shows utf8Preview with "…" for long base64 body (line 69 cond-expr)', async () => {
    // A base64 string that decodes to >60 bytes
    const longStr = 'A'.repeat(70);
    const encoded = btoa(longStr);
    const studio = makeStudio({
      publishDraft: { topic: 'test', body: encoded, bodyFormat: 'base64', acks: 1, headers: [] } as Parameters<typeof makeStudio>[0]['publishDraft'],
    });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);
    fireEvent.click(screen.getByTestId('pub-decode-preview-badge'));
    await waitFor(() => {
      const result = screen.queryByTestId('pub-decode-preview-result');
      expect(result).toBeTruthy();
      // Long body (>60 bytes) should include '…'
      expect(result?.textContent).toContain('…');
    });
  });

  it('shows disconnected hint and disabled Send title when not connected', () => {
    render(<KafkaPublishStudio studio={makeStudio()} clusterId="c" connected={false} {...defaultTemplateProps()} />);
    expect(screen.getByTestId('pub-disconnected-hint')).toBeTruthy();
    expect(screen.getByTestId('pub-send-btn').getAttribute('title')).toContain('Not connected');
  });

  it('truncates long workflow variable previews in map dropdown', () => {
    const longVal = 'x'.repeat(80);
    render(
      <KafkaPublishStudio
        studio={makeStudio()}
        clusterId="c"
        {...defaultTemplateProps()}
        lastWorkflowOutput={{ long_output: longVal }}
      />,
    );
    fireEvent.click(screen.getByTestId('pub-map-workflow-btn'));
    expect(screen.getByTestId('pub-wf-var-long_output').textContent).toContain('…');
  });

  it('opens body editor and applies updates from lazy modal callbacks', async () => {
    const studio = makeStudio({ publishDraft: { ...basePublishDraft(), bodyFormat: undefined as unknown as 'json' } });
    render(<KafkaPublishStudio studio={studio} clusterId="c" {...defaultTemplateProps()} />);

    fireEvent.click(screen.getByTestId('pub-body-expand'));
    await waitFor(() => expect(screen.getByTestId('mock-kafka-body-editor')).toBeTruthy());
    expect(screen.getByTestId('mock-kafka-body-editor').getAttribute('data-format')).toBe('json');

    fireEvent.click(screen.getByTestId('mock-kafka-body-editor-change'));
    expect(studio.setPublishDraft).toHaveBeenCalledWith({ body: '{"from":"editor"}' });

    fireEvent.click(screen.getByTestId('mock-kafka-body-editor-close'));
    await waitFor(() => expect(screen.queryByTestId('mock-kafka-body-editor')).toBeNull());
  });

  it('acks 0 shows "None (0)" label, acks -1 shows "All (–1)" label (lines 169/170)', () => {
    const studio0 = makeStudio({
      publishDraft: { topic: 't', body: '', bodyFormat: 'json', acks: 0, headers: [] } as Parameters<typeof makeStudio>[0]['publishDraft'],
    });
    const { unmount } = render(<KafkaPublishStudio studio={studio0} clusterId="c" {...defaultTemplateProps()} />);
    expect(document.body.textContent).toContain('None (0)');
    unmount();

    const studioN1 = makeStudio({
      publishDraft: { topic: 't', body: '', bodyFormat: 'json', acks: -1, headers: [] } as Parameters<typeof makeStudio>[0]['publishDraft'],
    });
    render(<KafkaPublishStudio studio={studioN1} clusterId="c" {...defaultTemplateProps()} />);
    expect(document.body.textContent).toContain('All (–1)');
  });
});
