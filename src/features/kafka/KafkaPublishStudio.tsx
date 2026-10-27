import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CustomSelect } from '@shared/components/CustomSelect';
import { useListCrud } from '@shared/hooks/useListCrud';
import KafkaSchemaConfigSection from '../workflow/components/configs/KafkaSchemaConfigSection';
import type { UseKafkaMessageStudioReturn } from '@app/hooks/useKafkaMessageStudio';
import type { KafkaPublishTemplate } from '@shared/kafka/kafkaStorage';
import type { KafkaSerdeFormat } from './types';
import { validateBase64, validateHex } from './kafkaMessageStudioUtils';
import { parseKafkaHeadersClipboard } from './kafkaHeaderClipboard';
import { KafkaTemplateControls } from './KafkaTemplateControls';

const KafkaBodyEditorModal = lazy(() => import('./KafkaBodyEditorModal'));

interface KafkaPublishStudioProps {
  studio: UseKafkaMessageStudioReturn;
  /** The currently active cluster ID, forwarded into produce request. */
  clusterId: string;
  // ── Template props (Phase 2) ──────────────────────────────────────────
  publishTemplates: KafkaPublishTemplate[];
  templatesLoading: boolean;
  onSaveTemplate: (name: string) => Promise<void>;
  onLoadTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => Promise<void>;
  // ── Workflow integration (Phase 3D) ────────────────────────────────────
  lastWorkflowOutput?: Record<string, string> | null;
  /** When false, the Send button is disabled and a connection notice is shown.
   *  Templates are always accessible regardless of connection state. */
  connected?: boolean;
}

export function KafkaPublishStudio({
  studio,
  publishTemplates,
  templatesLoading,
  onSaveTemplate,
  onLoadTemplate,
  onDeleteTemplate,
  lastWorkflowOutput,
  connected = true,
}: KafkaPublishStudioProps) {
  const { publishDraft, setPublishDraft, publishLoading, publishResult, publishError } = studio;

  const { update: updateHeader, remove: removeHeader, move: moveHeader } =
    useListCrud(publishDraft.headers, (items) => setPublishDraft({ headers: items }));

  const addHeader = useCallback(() => {
    setPublishDraft({
      headers: [
        ...publishDraft.headers,
        { id: `h-${Date.now()}`, key: '', value: '', enabled: true },
      ],
    });
    setHeadersExpanded(true);
  }, [publishDraft.headers, setPublishDraft]);

  const pasteHeaders = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseKafkaHeadersClipboard(text);
      if (!parsed) {
        setHeaderPasteError('Clipboard is not a header list. Copy headers from a message first.');
        return;
      }
      const stamp = Date.now();
      setPublishDraft({
        headers: parsed.map((row, index) => ({
          id: `h-paste-${stamp}-${index}`,
          key: row.key,
          value: row.value,
          enabled: true,
        })),
      });
      setHeaderPasteError(null);
      setHeadersExpanded(true);
    } catch {
      setHeaderPasteError('Could not read the clipboard.');
    }
  }, [setPublishDraft]);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [decodePreview, setDecodePreview] = useState<{ text: string; ok: boolean } | null>(null);
  const [bodyEditorOpen, setBodyEditorOpen] = useState(false);
  const [headersExpanded, setHeadersExpanded] = useState(true);
  const [headerPasteError, setHeaderPasteError] = useState<string | null>(null);
  const topicEmpty = publishDraft.topic.trim() === '';
  const bodyEmpty = publishDraft.body.trim() === '';
  const canSend = !topicEmpty && !publishLoading && connected;
  const publishAcksValue = ['-1', '0', '1'].includes(String(publishDraft.acks))
    ? String(publishDraft.acks)
    : '-1';

  const handleSend = useCallback(() => {
    void studio.sendOnce();
  }, [studio]);

  const handleFormatJson = useCallback(() => {
    studio.validateJsonBody();
  }, [studio]);

  const handleDecodePreview = useCallback(() => {
    const fmt = publishDraft.bodyFormat ?? 'json';
    const result = fmt === 'base64' ? validateBase64(publishDraft.body) : validateHex(publishDraft.body);
    if (result.ok && result.byteCount !== undefined) {
      const preview = result.utf8Preview ? ` — “${result.utf8Preview}${result.byteCount > 60 ? '…' : ''}”` : '';
      setDecodePreview({ text: `${result.byteCount} bytes${preview}`, ok: true });
    } else {
      setDecodePreview({ text: result.error ?? 'Invalid encoding', ok: false });
    }
  }, [publishDraft.body, publishDraft.bodyFormat]);

  // ── Workflow variable dropdown (Phase 3D) ──────────────────────────────
  const [wfDropdownOpen, setWfDropdownOpen] = useState(false);
  const [wfSearch, setWfSearch] = useState('');
  const wfDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wfDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (wfDropdownRef.current && !wfDropdownRef.current.contains(e.target as Node)) {
        setWfDropdownOpen(false);
        setWfSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [wfDropdownOpen]);

  const workflowEntries = lastWorkflowOutput ? Object.entries(lastWorkflowOutput) : [];
  const filteredWfEntries = wfSearch
    ? workflowEntries.filter(([k]) => k.toLowerCase().includes(wfSearch.toLowerCase()))
    : workflowEntries;

  const handleSelectWfVariable = useCallback((value: string) => {
    let body: string;
    try {
      body = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      body = value;
    }
    setPublishDraft({ body });
    setWfDropdownOpen(false);
    setWfSearch('');
  }, [setPublishDraft]);

  return (
    <div className="kafka-ms-card">
      <div className="kafka-ms-card-header">
        <div className="kafka-ms-card-header-left">
          <span className="kafka-ms-card-title">Publish</span>
          <span className="kafka-ms-card-subtitle">Send a message to a topic</span>
        </div>
        <KafkaTemplateControls
          templates={publishTemplates}
          templatesLoading={templatesLoading}
          onLoad={onLoadTemplate}
          onSave={onSaveTemplate}
          onDelete={onDeleteTemplate}
          testIdPrefix="pub"
        />
      </div>

      <div className="kafka-ms-body">
        {/* ── Form: single-row label-left layout ── */}
        <div className="kafka-ms-form">

          {/* Topic */}
          <div className="kafka-ms-form-row">
            <label className="kafka-ms-form-label" htmlFor="kms-pub-topic">
              Topic<span className="kafka-ms-required-dot" aria-hidden="true">*</span>
            </label>
            <div className="kafka-ms-form-ctrl">
              <input
                id="kms-pub-topic"
                className="kafka-ms-form-input"
                type="text"
                placeholder="e.g. orders.events"
                value={publishDraft.topic}
                onChange={(e) => setPublishDraft({ topic: e.target.value })}
                onBlur={() => setTouched((p) => ({ ...p, topic: true }))}
                data-testid="pub-topic-input"
              />
              {touched.topic && topicEmpty && (
                <span className="kafka-ms-field-hint" data-testid="pub-topic-hint">Topic is required</span>
              )}
            </div>
          </div>

          {/* Acks */}
          <div className="kafka-ms-form-row">
            <label className="kafka-ms-form-label" htmlFor="kms-pub-acks">Acks</label>
            <div className="kafka-ms-form-ctrl">
              <CustomSelect
                className="kafka-ms-form-select kafka-ms-form-select--acks"
                value={publishAcksValue}
                onChange={(v) => setPublishDraft({ acks: Number(v) as -1 | 0 | 1 })}
                options={[
                  { value: '-1', label: 'All (–1)', detail: 'Wait for all in-sync replicas — strongest durability' },
                  { value: '1', label: 'Leader (1)', detail: 'Wait for leader only — balanced' },
                  { value: '0', label: 'None (0)', detail: 'No acknowledgement — fire and forget' },
                ]}
                aria-label="Acks"
                data-testid="pub-acks-select"
              />
            </div>
          </div>

          {/* Key */}
          <div className="kafka-ms-form-row">
            <label className="kafka-ms-form-label" htmlFor="kms-pub-key">
              Key<span className="kafka-ms-optional-tag">optional</span>
            </label>
            <div className="kafka-ms-form-ctrl kafka-ms-form-ctrl--inline">
              <CustomSelect
                aria-label="Key format"
                className="kafka-ms-form-select kafka-ms-form-select--fmt"
                value={publishDraft.keyFormat ?? 'string'}
                onChange={(v) => setPublishDraft({ keyFormat: v as KafkaSerdeFormat })}
                data-testid="pub-key-format"
                options={[
                  { value: 'string', label: 'String', detail: 'UTF-8 text' },
                  { value: 'base64', label: 'Base64', detail: 'Binary encoding' },
                  { value: 'hex', label: 'Hex', detail: 'Hexadecimal' },
                ]}
              />
              <input
                id="kms-pub-key"
                className="kafka-ms-form-input kafka-ms-form-input--mono kafka-ms-form-input--grow"
                type="text"
                placeholder="Enter message key (optional)"
                value={publishDraft.key}
                onChange={(e) => setPublishDraft({ key: e.target.value })}
                data-testid="pub-key-input"
              />
            </div>
          </div>

          {/* Partition */}
          <div className="kafka-ms-form-row">
            <label className="kafka-ms-form-label" htmlFor="kms-pub-partition">Partition</label>
            <div className="kafka-ms-form-ctrl kafka-ms-form-ctrl--inline">
              <input
                id="kms-pub-partition"
                className="kafka-ms-form-input kafka-ms-form-input--short"
                type="text"
                placeholder="auto"
                value={publishDraft.partition}
                onChange={(e) => setPublishDraft({ partition: e.target.value })}
              />
              <span className="kafka-ms-form-hint">Leave empty to auto-assign</span>
            </div>
          </div>

          {/* Timeout */}
          <div className="kafka-ms-form-row">
            <label className="kafka-ms-form-label" htmlFor="kms-pub-timeout">Timeout (ms)</label>
            <div className="kafka-ms-form-ctrl kafka-ms-form-ctrl--inline">
              <input
                id="kms-pub-timeout"
                className="kafka-ms-form-input kafka-ms-form-input--short"
                type="text"
                placeholder="30 000"
                value={publishDraft.timeoutMs}
                onChange={(e) => setPublishDraft({ timeoutMs: e.target.value })}
              />
            </div>
          </div>

        </div>

        {/* ── Headers ── */}
        <div className="kafka-ms-section">
          <div className="kafka-ms-section-header">
            <span className="kafka-ms-section-title">
              Headers
              {publishDraft.headers.length > 0 && (
                <span className="kafka-ms-section-count">{publishDraft.headers.length}</span>
              )}
            </span>
            <span className="kafka-ms-section-actions">
              <button
                type="button"
                className="kafka-ms-collapse-btn"
                onClick={() => setHeadersExpanded((open) => !open)}
                aria-expanded={headersExpanded}
                aria-controls="kafka-pub-headers-body"
                data-testid="pub-headers-toggle"
              >
                {headersExpanded ? 'Shrink' : 'Expand'}
                <span className={`kafka-ms-collapse-chevron${headersExpanded ? '' : ' collapsed'}`} aria-hidden="true">▾</span>
              </button>
              <button
                type="button"
                className="kafka-ms-add-btn"
                onClick={() => { void pasteHeaders(); }}
                title="Paste copied headers and replace this list"
                data-testid="pub-paste-headers"
              >
                Paste
              </button>
              <button
                className="kafka-ms-add-btn"
                onClick={addHeader}
                title="Add header"
              >
                + Add
              </button>
            </span>
          </div>
          <div
            id="kafka-pub-headers-body"
            className={`kafka-ms-headers-body${headersExpanded ? '' : ' is-shrunk'}`}
            data-testid="pub-headers-body"
          >
          {headerPasteError && (
            <p className="kafka-ms-empty-state" data-testid="pub-paste-headers-error">{headerPasteError}</p>
          )}
          {publishDraft.headers.length === 0 ? (
            <p className="kafka-ms-empty-state">No custom headers configured</p>
          ) : (
            <div className="kafka-ms-kv-list">
              {publishDraft.headers.map((row, idx) => (
                <div key={row.id} className="kafka-ms-kv-row">
                  <input
                    type="checkbox"
                    aria-label="enabled"
                    checked={row.enabled}
                    onChange={(e) => updateHeader(idx, { ...row, enabled: e.target.checked })}
                  />
                  <input
                    type="text"
                    placeholder="header-key"
                    value={row.key}
                    onChange={(e) => updateHeader(idx, { ...row, key: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => updateHeader(idx, { ...row, value: e.target.value })}
                  />
                  <span className="kafka-ms-kv-actions">
                    {idx > 0 && (
                      <button
                        className="kafka-ms-move-btn"
                        onClick={() => moveHeader(idx, -1)}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                    )}
                    <button
                      className="kafka-ms-remove-btn"
                      onClick={() => removeHeader(idx)}
                      aria-label="Remove header"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* Body */}
        <div className="kafka-ms-field full">
          <div className="kafka-ms-field-label-row">
            <label htmlFor="kms-pub-body">Message Body</label>
            <div className="kafka-ms-field-label-actions">
              <button
                type="button"
                className="kafka-ms-expand-btn"
                onClick={() => setBodyEditorOpen(true)}
                title="Open full-screen body editor"
                aria-label="Open full-screen body editor"
                data-testid="pub-body-expand"
              >
                <svg
                  className="kafka-ms-expand-btn__icon"
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="currentColor"
                    d="M2 2h4v1.5H3.5V6H2V2zm8 0h4v4h-1.5V3.5H10V2zM2 10h1.5v2.5H6V14H2v-4zm8 2.5V14h4v-4h-1.5v2.5H10z"
                  />
                </svg>
                Expand
              </button>
              <CustomSelect
                aria-label="Body format"
                className="kafka-ms-form-select kafka-ms-form-select--fmt kafka-ms-form-select--body"
                value={publishDraft.bodyFormat ?? 'json'}
                onChange={(v) => {
                  setPublishDraft({ bodyFormat: v as KafkaSerdeFormat });
                  setDecodePreview(null);
                }}
                data-testid="pub-body-format"
                options={[
                  { value: 'json', label: 'JSON', detail: 'Structured data' },
                  { value: 'string', label: 'String', detail: 'Plain text' },
                  { value: 'base64', label: 'Base64', detail: 'Binary encoding' },
                  { value: 'hex', label: 'Hex', detail: 'Hexadecimal' },
                ]}
              />
              {(publishDraft.bodyFormat == null || publishDraft.bodyFormat === 'json') && (
                <button
                  type="button"
                  className="kafka-ms-pretty-badge"
                  onClick={handleFormatJson}
                  title="Pretty Format JSON"
                  data-testid="pub-pretty-format-badge"
                >
                  Pretty Format
                </button>
              )}
              {(publishDraft.bodyFormat === 'base64' || publishDraft.bodyFormat === 'hex') && (
                <button
                  type="button"
                  className="kafka-ms-pretty-badge"
                  onClick={handleDecodePreview}
                  title={`Preview decoded ${publishDraft.bodyFormat} bytes`}
                  data-testid="pub-decode-preview-badge"
                >
                  Preview
                </button>
              )}
            </div>
          </div>
          <textarea
            id="kms-pub-body"
            className="kafka-ms-textarea"
            placeholder={
              publishDraft.bodyFormat === 'base64' ? 'aGVsbG8gd29ybGQ='
              : publishDraft.bodyFormat === 'hex' ? '68 65 6c 6c 6f'
              : publishDraft.bodyFormat === 'string' ? 'Plain text value'
              : '{"key": "value"}'
            }
            value={publishDraft.body}
            onChange={(e) => { setPublishDraft({ body: e.target.value }); setDecodePreview(null); }}
            onBlur={() => setTouched((p) => ({ ...p, body: true }))}
          />
          {decodePreview && (
            <span
              className={`kafka-ms-decode-preview${decodePreview.ok ? '' : ' kafka-ms-decode-preview--error'}`}
              data-testid="pub-decode-preview-result"
            >
              {decodePreview.text}
            </span>
          )}
          {touched.body && bodyEmpty && (
            <span className="kafka-ms-field-hint" data-testid="pub-body-hint">Message body is required</span>
          )}
        </div>

        {/* Schema Registry */}
        <KafkaSchemaConfigSection
          value={publishDraft.schemaConfig}
          onChange={(next) => setPublishDraft({ schemaConfig: next })}
          topic={publishDraft.topic}
        />

        {/* Action row */}
        <div className="kafka-ms-action-row">
          <button
            className="kafka-ms-primary-btn"
            disabled={!canSend}
            onClick={handleSend}
            data-testid="pub-send-btn"
            title={!connected ? 'Not connected — configure a Kafka cluster first' : topicEmpty ? 'Topic is required' : undefined}
          >
            {publishLoading ? 'Sending…' : 'Send Once'}
          </button>
          {!connected && (
            <span className="kafka-ms-disconnected-hint" data-testid="pub-disconnected-hint" role="status">
              <span className="kafka-ms-disconnected-hint__icon" aria-hidden="true">!</span>
              <span className="kafka-ms-disconnected-hint__text">Not connected</span>
            </span>
          )}
          <button
            className="kafka-ms-secondary-btn"
            onClick={handleFormatJson}
            title="Validate and format JSON body"
            data-testid="pub-format-btn"
          >
            Validate &amp; Format JSON
          </button>
          <div className="kafka-ms-wf-dropdown-anchor" ref={wfDropdownRef}>
            <button
              className="kafka-ms-secondary-btn"
              onClick={() => setWfDropdownOpen((o) => !o)}
              disabled={!lastWorkflowOutput || workflowEntries.length === 0}
              title={workflowEntries.length === 0 ? 'Run a workflow first' : 'Map a workflow output variable into the message body'}
              data-testid="pub-map-workflow-btn"
            >
              Map from Workflow ▾
            </button>
            {wfDropdownOpen && workflowEntries.length > 0 && (
              <div className="kafka-ms-wf-dropdown" data-testid="pub-wf-dropdown">
                <input
                  className="kafka-ms-wf-search"
                  type="text"
                  placeholder="Search variables…"
                  value={wfSearch}
                  onChange={(e) => setWfSearch(e.target.value)}
                  autoFocus
                  data-testid="pub-wf-search"
                />
                <div className="kafka-ms-wf-list">
                  {filteredWfEntries.length === 0 ? (
                    <div className="kafka-ms-wf-empty">No matching variables</div>
                  ) : (
                    filteredWfEntries.map(([key, val]) => (
                      <div
                        key={key}
                        className="kafka-ms-wf-item"
                        onClick={() => handleSelectWfVariable(val)}
                        data-testid={`pub-wf-var-${key}`}
                      >
                        <span className="kafka-ms-wf-item-name">{key}</span>
                        <span className="kafka-ms-wf-item-preview">{val.length > 60 ? val.slice(0, 60) + '…' : val}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          {(publishResult || publishError) && (
            <button
              className="kafka-ms-ghost-btn"
              onClick={studio.clearPublishResult}
              data-testid="pub-clear-btn"
            >
              Clear
            </button>
          )}
        </div>

        {/* Error */}
        {publishError && (
          <div className="kafka-ms-inline-error" data-testid="pub-error">
            {publishError.message}
            {!publishError.retryable && (
              <span className="kafka-ms-error-tag"> (non-retryable)</span>
            )}
          </div>
        )}

        {/* Success result */}
        {publishResult && !publishError && (
          <div className="kafka-ms-result-success" data-testid="pub-result">
            <span className="kafka-ms-result-sent">
              ✓ Sent {publishResult.sentCount} message{publishResult.sentCount !== 1 ? 's' : ''} to{' '}
              <strong>{publishResult.topic}</strong>
            </span>
            {publishResult.records.map((r, i) => (
              <span key={i} className="kafka-ms-result-record">
                partition {r.partition}, offset {r.offset}
                {r.timestamp ? `, ts ${r.timestamp}` : ''}
              </span>
            ))}
            {publishResult.valueEncoding && (
              <span className="kafka-ms-result-encoding">
                Encoding: {publishResult.valueEncoding}
              </span>
            )}
          </div>
        )}
      </div>

      {bodyEditorOpen && (
        <Suspense fallback={null}>
          <KafkaBodyEditorModal
            value={publishDraft.body}
            onChange={(v) => setPublishDraft({ body: v })}
            onClose={() => setBodyEditorOpen(false)}
            format={publishDraft.bodyFormat ?? 'json'}
          />
        </Suspense>
      )}
    </div>
  );
}
