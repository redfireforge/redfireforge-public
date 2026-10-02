import { useMemo, useRef, useState } from 'react';
import { useConfirmDialog } from '@app/hooks/useConfirmDialog';
import { normalizeKafkaClusterConfig } from '@shared/kafka/kafkaConfig';
import { saveJsonFile } from '@shared/utils/fileSaver';
import type { UseKafkaStateReturn } from '@app/hooks/useKafkaState';
import {
  defaultClusterDraft,
  draftFromCluster,
  hasDraftErrors,
  normalizeBrokerEntries,
  authConfigFromDraft,
  type KafkaClusterDraft,
  type KafkaClusterDraftErrors,
  validateKafkaClusterDraft,
} from './kafkaClusterForm';
import KafkaDiagnosticBanner from './KafkaDiagnosticBanner';
import {
  buildTlsConfig,
  formatBrokers,
  formatSecurityProfile,
  getClusterStatus,
  toDiagnosticBannerData,
  parseOptionalTimeoutMs,
} from './kafkaSettingsUtils';
import { KafkaClusterEditor } from './KafkaClusterEditor';

const EMPTY_ERRORS: KafkaClusterDraftErrors = {};

interface KafkaSettingsPageProps {
  kafkaState: UseKafkaStateReturn;
}

export default function KafkaSettingsPage({ kafkaState }: KafkaSettingsPageProps) {
  const {
    loaded,
    clusters,
    selectedClusterId,
    selectedCluster,
    connection,
    lastError,
    lastErrorDetail,
    autoConnectOnStartup,
    setAutoConnectOnStartup,
    setSelectedClusterId,
    upsertCluster,
    removeCluster,
    clearError,
    connectSelectedCluster,
    disconnectActiveCluster,
    refreshConnectionStatus,
    testSelectedClusterConnection,
    lastTestResult,
  } = kafkaState;
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  const [isCreateClusterIdCustomized, setIsCreateClusterIdCustomized] = useState(false);
  const [draft, setDraft] = useState<KafkaClusterDraft>(() => defaultClusterDraft());
  const [draftErrors, setDraftErrors] = useState<KafkaClusterDraftErrors>(EMPTY_ERRORS);
  const [pendingDeleteClusterId, setPendingDeleteClusterId] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialogElement } = useConfirmDialog();

  const handleExport = async () => {
    const date = new Date().toISOString().slice(0, 10);
    await saveJsonFile(
      { version: 1, exportedAt: Date.now(), clusters },
      `kafka-clusters-${date}.json`,
    );
  };

  const handleImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(reader.result as string);
        const rawClusters: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as Record<string, unknown>)?.clusters)
            ? ((parsed as Record<string, unknown>).clusters as unknown[])
            : [];
        let imported = 0;
        let skipped = 0;
        for (const raw of rawClusters) {
          const cluster = normalizeKafkaClusterConfig(raw);
          if (cluster) {
            upsertCluster(cluster);
            imported++;
          } else {
            skipped++;
          }
        }
        const msg =
          `Imported ${imported} cluster${imported !== 1 ? 's' : ''}` +
          (skipped > 0 ? `, ${skipped} skipped (invalid)` : '') + '.';
        setImportFeedback({ type: 'success', message: msg });
      } catch {
        setImportFeedback({ type: 'error', message: 'Import failed: invalid JSON file.' });
      }
      if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.onerror = () => {
      setImportFeedback({ type: 'error', message: 'Import failed: could not read file.' });
      if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.readAsText(file);
  };



  const connectionSummary = useMemo(() => {
    if (!loaded) {
      return 'Loading Kafka workspace state...';
    }

    if (connection.state === 'connected') {
      if (!connection.clusterId) return 'Connected';
      const matched = clusters.some((c) => c.clusterId === connection.clusterId);
      // Orphan session: server is connected under an id with no saved profile
      // (e.g. demo API probe). Cards correctly stay Idle — surface that clearly.
      if (!matched) {
        return `Connected to ${connection.clusterId} (no matching saved profile)`;
      }
      return `Connected to ${connection.clusterId}`;
    }

    if (connection.state === 'testing') {
      return 'Testing connection...';
    }

    if (connection.state === 'error') {
      return connection.lastError ?? 'Connection check failed';
    }

    return 'Disconnected';
  }, [loaded, connection, clusters]);

  const selectCluster = (clusterId: string) => {
    setSelectedClusterId(clusterId);
  };

  const selectedClusterSecuritySummary = useMemo(
    () => (selectedCluster ? formatSecurityProfile(selectedCluster) : null),
    [selectedCluster],
  );
  const hasStartupError = loaded && clusters.length === 0 && !!lastError && !lastErrorDetail;

  const canRunConnectionAction = loaded && !!selectedClusterId && editorMode == null;
  const canDisconnect = loaded && connection.state !== 'disconnected' && connection.state !== 'testing';

  const startCreate = () => {
    const created = defaultClusterDraft();
    setDraft(created);
    setEditorMode('create');
    setEditingClusterId(null);
    setIsCreateClusterIdCustomized(false);
    setPendingDeleteClusterId(null);
    setDraftErrors(EMPTY_ERRORS);
  };

  const startEdit = (clusterId: string) => {
    const cluster = clusters.find((item) => item.clusterId === clusterId);
    if (!cluster) {
      return;
    }
    setDraft(draftFromCluster(cluster));
    setEditorMode('edit');
    setEditingClusterId(clusterId);
    setIsCreateClusterIdCustomized(false);
    setPendingDeleteClusterId(null);
    setDraftErrors(EMPTY_ERRORS);
    selectCluster(clusterId);
  };

  const cancelEditor = () => {
    setEditorMode(null);
    setEditingClusterId(null);
    setIsCreateClusterIdCustomized(false);
    setPendingDeleteClusterId(null);
    setDraftErrors(EMPTY_ERRORS);
  };

  const saveDraft = () => {
    const errors = validateKafkaClusterDraft(draft, clusters, editorMode === 'edit' ? editingClusterId : null);
    setDraftErrors(errors);
    if (hasDraftErrors(errors)) {
      return;
    }

    const existing = editorMode === 'edit'
      ? clusters.find((cluster) => cluster.clusterId === editingClusterId)
      : undefined;
    const nextClusterId = draft.clusterId.trim();
    const now = Date.now();
    const cleanedBrokers = normalizeBrokerEntries(draft.brokers);

    if (editorMode === 'edit' && editingClusterId && editingClusterId !== nextClusterId) {
      removeCluster(editingClusterId);
    }

    upsertCluster({
      clusterId: nextClusterId,
      name: draft.name.trim(),
      clientId: draft.clientId.trim(),
      brokers: cleanedBrokers,
      connectionTimeoutMs: parseOptionalTimeoutMs(draft.connectionTimeoutMs),
      requestTimeoutMs: parseOptionalTimeoutMs(draft.requestTimeoutMs),
      auth: authConfigFromDraft(draft),
      tls: buildTlsConfig(draft),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    selectCluster(nextClusterId);
    setEditorMode(null);
    setEditingClusterId(null);
    setIsCreateClusterIdCustomized(false);
    setPendingDeleteClusterId(null);
    setDraftErrors(EMPTY_ERRORS);
  };

  const updateDraft = (updates: Partial<KafkaClusterDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
    setDraftErrors(EMPTY_ERRORS);
  };

  const updateBroker = (idx: number, value: string) => {
    setDraft((prev) => {
      const brokers = [...prev.brokers];
      brokers[idx] = value;
      return { ...prev, brokers };
    });
    setDraftErrors(EMPTY_ERRORS);
  };

  const addBrokerRow = () => {
    setDraft((prev) => ({ ...prev, brokers: [...prev.brokers, ''] }));
    setDraftErrors(EMPTY_ERRORS);
  };

  const removeBrokerRow = (idx: number) => {
    setDraft((prev) => {
      const brokers = prev.brokers.filter((_, itemIdx) => itemIdx !== idx);
      return { ...prev, brokers };
    });
    setDraftErrors(EMPTY_ERRORS);
  };

  const confirmDelete = () => {
    if (!editingClusterId) {
      return;
    }
    removeCluster(editingClusterId);
    setPendingDeleteClusterId(null);
    setEditorMode(null);
    setEditingClusterId(null);
    setIsCreateClusterIdCustomized(false);
    setDraftErrors(EMPTY_ERRORS);
  };

  const deleteCluster = (clusterId: string, clusterName: string) => {
    confirm(`Delete "${clusterName}"?`, () => {
      removeCluster(clusterId);
      if (editingClusterId === clusterId) {
        setEditorMode(null);
        setEditingClusterId(null);
        setIsCreateClusterIdCustomized(false);
        setDraftErrors(EMPTY_ERRORS);
      }
    });
  };

  return (
    <div className="settings-page kafka-settings-page" data-testid="kafka-settings-page">
      {confirmDialogElement}
      <div className="settings-page-header">
        <h2>Kafka Cluster Studio</h2>
        <p className="settings-section-desc">
          Configure broker profiles and manage connections.
        </p>
      </div>

      <div className="kafka-settings-content">
        {/* ── Studio grid: cluster panel (left) + editor panel (right) ── */}
        <div className="kafka-studio-grid">

          {/* ── LEFT: Cluster panel ── */}
          <section className="kafka-shell-card kafka-cluster-panel" aria-live="polite">
            <div className="kafka-shell-card-header">
              <div className="kafka-shell-card-title-row">
                <h3>Clusters</h3>
                <span className={`kafka-status-badge state-${connection.state}`}>{connection.state}</span>
              </div>
              <small className="kafka-section-subtitle">Saved profiles · fast switch · live health</small>
            </div>

            {loaded && (
              <div className="kafka-cluster-toolbar" data-testid="kafka-cluster-toolbar">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void handleExport()}
                  disabled={clusters.length === 0}
                  title="Export all cluster configs to a JSON file"
                  data-testid="kafka-export-btn"
                >
                  ↓ Export
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => importInputRef.current?.click()}
                  title="Import cluster configs from a JSON file"
                  data-testid="kafka-import-btn"
                >
                  ↑ Import
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={handleImportChange}
                  aria-hidden="true"
                />
                {clusters.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={startCreate}
                    data-testid="kafka-add-cluster-btn"
                  >
                    + New
                  </button>
                )}
              </div>
            )}

            {/* Import feedback */}
            {importFeedback && (
              <div
                className={`kafka-import-feedback kafka-import-feedback--${importFeedback.type}`}
                data-testid="kafka-import-feedback"
              >
                <span>{importFeedback.message}</span>
                <button
                  type="button"
                  className="kafka-import-feedback-dismiss"
                  onClick={() => setImportFeedback(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}

            {/* Loading */}
            {!loaded && (
              <p className="settings-section-desc kafka-panel-state" data-testid="kafka-settings-loading">
                Reading saved Kafka clusters and connection status.
              </p>
            )}

            {/* Startup error */}
            {hasStartupError && (
              <div className="kafka-shell-error kafka-panel-state" data-testid="kafka-settings-error">
                <strong>Unable to load Kafka settings</strong>
                <p>{lastError}</p>
              </div>
            )}

            {/* Empty state */}
            {loaded && clusters.length === 0 && !hasStartupError && (
              <div className="kafka-panel-state kafka-empty-state" data-testid="kafka-settings-empty">
                <p className="kafka-empty-title">No clusters configured yet</p>
                <p className="settings-section-desc">Add your first Kafka cluster to enable topic browsing and workflow integration.</p>
                <div className="kafka-shell-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={startCreate}
                    data-testid="kafka-empty-create-btn"
                  >
                    Create First Cluster
                  </button>
                </div>
              </div>
            )}

            {/* Cluster list */}
            {loaded && clusters.length > 0 && (
              <div className="kafka-cluster-shell-list" data-testid="kafka-settings-list">
                {clusters.map((cluster) => {
                  const isSelected = cluster.clusterId === selectedClusterId;
                  const clusterStatus = getClusterStatus(
                    cluster.clusterId,
                    selectedClusterId,
                    connection.state,
                    connection.clusterId,
                  );
                  return (
                    <div
                      key={cluster.clusterId}
                      className={`kafka-cluster-card ${isSelected ? 'selected' : ''}`}
                      data-testid={`kafka-cluster-card-${cluster.clusterId}`}
                    >
                      <button
                        type="button"
                        className="kafka-cluster-shell-row"
                        onClick={() => selectCluster(cluster.clusterId)}
                      >
                        <span className="kafka-cluster-shell-head">
                          <span className="kafka-cluster-shell-name">{cluster.name}</span>
                          <span className={`kafka-cluster-item-status kind-${clusterStatus.kind}`}>{clusterStatus.label}</span>
                        </span>
                        <span className="kafka-cluster-shell-meta">{formatBrokers(cluster.brokers)}</span>
                        <span className="kafka-cluster-shell-security-line">{formatSecurityProfile(cluster)}</span>
                      </button>
                      <div className="kafka-cluster-card-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => startEdit(cluster.clusterId)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteCluster(cluster.clusterId, cluster.name)}
                          title="Delete cluster"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected cluster hint */}
            {selectedCluster && (
              <div className="kafka-selected-cluster-hint" data-testid="kafka-selected-cluster-security">
                <span>Selected: <strong>{selectedCluster.name}</strong></span>
                <span className="kafka-inline-separator">•</span>
                <span>{selectedClusterSecuritySummary}</span>
              </div>
            )}

            {/* Diagnostic banner */}
            {lastErrorDetail && (
              <KafkaDiagnosticBanner
                detail={toDiagnosticBannerData(lastErrorDetail)}
                testId="kafka-diagnostic-banner"
              />
            )}

            {/* Connection controls — only shown when clusters exist */}
            {loaded && clusters.length > 0 && (
              <>
                <p className="kafka-shell-summary">{connectionSummary}</p>

                <div className="kafka-shell-actions">
                  <button
                    type="button"
                    className="btn btn-sm kafka-btn-soft-blue"
                    onClick={() => void testSelectedClusterConnection()}
                    disabled={!canRunConnectionAction || connection.state === 'testing'}
                    data-testid="kafka-test-btn"
                  >
                    Test Connection
                  </button>
                  {lastTestResult && (
                    <span
                      className={`kafka-test-result ${lastTestResult.ok ? 'kafka-test-result--ok' : 'kafka-test-result--fail'}`}
                      data-testid="kafka-test-result"
                    >
                      {lastTestResult.ok ? '✓ Verified' : '✗ Failed'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void connectSelectedCluster()}
                    disabled={!canRunConnectionAction || connection.state === 'testing' || (connection.state === 'connected' && connection.clusterId === selectedClusterId)}
                    data-testid="kafka-connect-btn"
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void disconnectActiveCluster()}
                    disabled={!canDisconnect}
                    data-testid="kafka-disconnect-btn"
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void refreshConnectionStatus({ force: true })}
                    disabled={!loaded || !selectedClusterId}
                  >
                    Refresh Status
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={clearError}
                    disabled={!lastError}
                  >
                    Clear Error
                  </button>
                </div>

                <div className="kafka-shell-preferences">
                  <label className="kafka-editor-checkbox" data-testid="kafka-auto-connect-toggle">
                    <input
                      type="checkbox"
                      checked={autoConnectOnStartup}
                      onChange={(event) => setAutoConnectOnStartup(event.target.checked)}
                    />
                    Auto-connect the selected cluster on startup
                  </label>
                  <span className="kafka-shell-preferences-note">
                    Restores the saved cluster selection and attempts a connection once when Kafka settings load.
                  </span>
                </div>
              </>
            )}
          </section>

          {/* ── RIGHT: Editor panel ── */}
          <KafkaClusterEditor
            loaded={loaded}
            editorMode={editorMode}
            draft={draft}
            draftErrors={draftErrors}
            editingClusterId={editingClusterId}
            pendingDeleteClusterId={pendingDeleteClusterId}
            isCreateClusterIdCustomized={isCreateClusterIdCustomized}
            setPendingDeleteClusterId={setPendingDeleteClusterId}
            setIsCreateClusterIdCustomized={setIsCreateClusterIdCustomized}
            cancelEditor={cancelEditor}
            saveDraft={saveDraft}
            updateDraft={updateDraft}
            updateBroker={updateBroker}
            addBrokerRow={addBrokerRow}
            removeBrokerRow={removeBrokerRow}
            confirmDelete={confirmDelete}
          />
        </div>

      </div>
    </div>
  );
}

