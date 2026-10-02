import { useState } from 'react';
import { CustomSelect } from '@shared/components/CustomSelect';
import {
  clusterIdFromName,
  type KafkaClusterDraft,
  type KafkaClusterDraftErrors,
} from './kafkaClusterForm';

export interface KafkaClusterEditorProps {
  loaded: boolean;
  editorMode: 'create' | 'edit' | null;
  draft: KafkaClusterDraft;
  draftErrors: KafkaClusterDraftErrors;
  editingClusterId: string | null;
  pendingDeleteClusterId: string | null;
  isCreateClusterIdCustomized: boolean;
  setPendingDeleteClusterId: (id: string | null) => void;
  setIsCreateClusterIdCustomized: (v: boolean) => void;
  cancelEditor: () => void;
  saveDraft: () => void;
  updateDraft: (updates: Partial<KafkaClusterDraft>) => void;
  updateBroker: (idx: number, value: string) => void;
  addBrokerRow: () => void;
  removeBrokerRow: (idx: number) => void;
  confirmDelete: () => void;
}

export function KafkaClusterEditor({
  loaded,
  editorMode,
  draft,
  draftErrors,
  editingClusterId,
  pendingDeleteClusterId,
  isCreateClusterIdCustomized,
  setPendingDeleteClusterId,
  setIsCreateClusterIdCustomized,
  cancelEditor,
  saveDraft,
  updateDraft,
  updateBroker,
  addBrokerRow,
  removeBrokerRow,
  confirmDelete,
}: KafkaClusterEditorProps) {
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showTlsPassphrase, setShowTlsPassphrase] = useState(false);

  return (
    <section
      className="kafka-shell-card kafka-editor-panel"
      data-testid={loaded ? 'kafka-cluster-editor' : undefined}
    >
      {!loaded ? (
        <p className="settings-section-desc">Loading cluster configuration...</p>
      ) : (
        <>
          <div className="kafka-shell-card-header kafka-editor-header">
            <div>
              <h3>{editorMode === 'edit' ? 'Edit Cluster' : 'Create Cluster'}</h3>
              {editorMode && (
                <small className="kafka-section-subtitle">
                  {editorMode === 'edit'
                    ? 'Update connection settings, auth, and TLS'
                    : 'Configure a new Kafka connection profile'}
                </small>
              )}
            </div>
            {editorMode && (
              <button type="button" className="btn btn-sm" onClick={cancelEditor}>
                Cancel
              </button>
            )}
          </div>

          {!editorMode && (
            <p className="settings-section-desc kafka-editor-placeholder">
              Select a saved cluster and click Edit, or click New Cluster to start configuring one.
            </p>
          )}

          {editorMode && (
            <div className="kafka-editor-grid">
              <div className="kafka-editor-field">
                <label htmlFor="kafka-cluster-name">Cluster Name</label>
                <input
                  id="kafka-cluster-name"
                  value={draft.name}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    const nextId = clusterIdFromName(nextName);
                    updateDraft({
                      name: nextName,
                      clusterId:
                        editorMode === 'create' && !isCreateClusterIdCustomized
                          ? nextId || draft.clusterId
                          : draft.clusterId,
                    });
                  }}
                  placeholder="Local Dev Kafka"
                />
                {draftErrors.name && <div className="kafka-editor-error">{draftErrors.name}</div>}
              </div>

              <div className="kafka-editor-field">
                <label htmlFor="kafka-cluster-id">Cluster ID</label>
                <input
                  id="kafka-cluster-id"
                  value={draft.clusterId}
                  onChange={(event) => {
                    if (editorMode === 'create') setIsCreateClusterIdCustomized(true);
                    updateDraft({ clusterId: event.target.value.trim() });
                  }}
                  placeholder="local-dev-kafka"
                />
                {draftErrors.clusterId && (
                  <div className="kafka-editor-error">{draftErrors.clusterId}</div>
                )}
              </div>

              <div className="kafka-editor-field kafka-editor-field-full">
                <label htmlFor="kafka-client-id">Client ID</label>
                <input
                  id="kafka-client-id"
                  value={draft.clientId}
                  onChange={(event) => updateDraft({ clientId: event.target.value })}
                  placeholder="redfireforge-local"
                />
                {draftErrors.clientId && (
                  <div className="kafka-editor-error">{draftErrors.clientId}</div>
                )}
              </div>

              <div className="kafka-editor-field">
                <label htmlFor="kafka-connection-timeout">Connection Timeout (ms)</label>
                <input
                  id="kafka-connection-timeout"
                  inputMode="numeric"
                  value={draft.connectionTimeoutMs}
                  onChange={(event) => updateDraft({ connectionTimeoutMs: event.target.value })}
                  placeholder="10000"
                />
                {draftErrors.connectionTimeoutMs && (
                  <div className="kafka-editor-error">{draftErrors.connectionTimeoutMs}</div>
                )}
              </div>

              <div className="kafka-editor-field">
                <label htmlFor="kafka-request-timeout">Request Timeout (ms)</label>
                <input
                  id="kafka-request-timeout"
                  inputMode="numeric"
                  value={draft.requestTimeoutMs}
                  onChange={(event) => updateDraft({ requestTimeoutMs: event.target.value })}
                  placeholder="10000"
                />
                {draftErrors.requestTimeoutMs && (
                  <div className="kafka-editor-error">{draftErrors.requestTimeoutMs}</div>
                )}
              </div>

              {/* Bootstrap Brokers subcard */}
              <div className="kafka-editor-field kafka-editor-field-full">
                <div className="kafka-subcard">
                  <div className="kafka-subcard-header">
                    <span className="kafka-subcard-title">Bootstrap Brokers</span>
                    <button type="button" className="btn btn-sm" onClick={addBrokerRow}>
                      Add Broker
                    </button>
                  </div>
                  <div className="kafka-editor-brokers-list">
                    {draft.brokers.map((broker, idx) => (
                      <div className="kafka-editor-broker-row" key={idx}>
                        <input
                          aria-label={`Broker ${idx + 1}`}
                          value={broker}
                          onChange={(event) => updateBroker(idx, event.target.value)}
                          placeholder="127.0.0.1:19092"
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => removeBrokerRow(idx)}
                          disabled={draft.brokers.length <= 1}
                        >
                          Remove
                        </button>
                        {draftErrors.brokerRows?.[idx] && (
                          <div className="kafka-editor-error">{draftErrors.brokerRows[idx]}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  {draftErrors.brokers && (
                    <div className="kafka-editor-error">{draftErrors.brokers}</div>
                  )}
                </div>
              </div>

              {/* Authentication subcard */}
              <div className="kafka-editor-field kafka-editor-field-full">
                <div className="kafka-subcard">
                  <div className="kafka-subcard-header">
                    <span className="kafka-subcard-title">Authentication</span>
                    <span className="kafka-editor-section-note">
                      PLAINTEXT, SASL/PLAIN, SCRAM, and Azure OAUTHBEARER supported.
                    </span>
                  </div>
                  <div className="kafka-editor-field">
                    <label htmlFor="kafka-auth-mode">Mechanism</label>
                    <CustomSelect
                      value={draft.authMode ?? 'none'}
                      onChange={(v) => {
                        const authMode = v as KafkaClusterDraft['authMode'];
                        updateDraft(authMode === 'oauthbearer'
                          ? { authMode, tlsEnabled: true }
                          : { authMode });
                      }}
                      options={[
                        { value: 'none', label: 'No authentication' },
                        { value: 'plain', label: 'SASL / PLAIN' },
                        { value: 'scram-sha-256', label: 'SCRAM-SHA-256' },
                        { value: 'scram-sha-512', label: 'SCRAM-SHA-512' },
                        { value: 'oauthbearer', label: 'Azure OAUTHBEARER' },
                      ]}
                      aria-label="Mechanism"
                    />
                    {draft.authMode === 'oauthbearer' && (
                      <div className="kafka-editor-section-note">
                        Uses the Azure CLI login on this machine. Run az login before connecting. No username or password.
                      </div>
                    )}
                  </div>
                  {(draft.authMode ?? 'none') !== 'none' && draft.authMode !== 'oauthbearer' && (
                    <div className="kafka-subcard-fields">
                      <div className="kafka-editor-field">
                        <label htmlFor="kafka-auth-username">Username</label>
                        <input
                          id="kafka-auth-username"
                          value={draft.authUsername}
                          onChange={(event) => updateDraft({ authUsername: event.target.value })}
                          placeholder="kafka-user"
                        />
                        {draftErrors.authUsername && (
                          <div className="kafka-editor-error">{draftErrors.authUsername}</div>
                        )}
                      </div>
                      <div className="kafka-editor-field">
                        <label htmlFor="kafka-auth-password">Password</label>
                        <div className="kafka-password-wrapper">
                          <input
                            id="kafka-auth-password"
                            type={showAuthPassword ? 'text' : 'password'}
                            value={draft.authPassword}
                            onChange={(event) => updateDraft({ authPassword: event.target.value })}
                            placeholder="Enter broker password"
                          />
                          <button
                            type="button"
                            className="kafka-password-reveal"
                            onClick={() => setShowAuthPassword((v) => !v)}
                            title={showAuthPassword ? 'Hide password' : 'Show password'}
                            aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
                          >
                            {showAuthPassword ? '🙈' : '👁'}
                          </button>
                        </div>
                        {draftErrors.authPassword && (
                          <div className="kafka-editor-error">{draftErrors.authPassword}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* TLS subcard */}
              <div className="kafka-editor-field kafka-editor-field-full">
                <div className="kafka-subcard">
                  <div className="kafka-subcard-header">
                    <span className="kafka-subcard-title">TLS / SSL</span>
                    <span className="kafka-editor-section-note">
                      Enable for secure broker connections.
                    </span>
                  </div>
                  <div className="kafka-editor-toggle-row">
                    <label className="kafka-editor-checkbox">
                      <input
                        type="checkbox"
                        data-testid="kafka-tls-toggle"
                        checked={draft.tlsEnabled}
                        onChange={(event) => updateDraft({ tlsEnabled: event.target.checked })}
                      />
                      Enable TLS
                    </label>
                    <label
                      className={`kafka-editor-checkbox${!draft.tlsEnabled ? ' kafka-editor-checkbox--disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        data-testid="kafka-tls-verify-toggle"
                        checked={draft.tlsRejectUnauthorized}
                        onChange={(event) =>
                          updateDraft({ tlsRejectUnauthorized: event.target.checked })
                        }
                        disabled={!draft.tlsEnabled}
                      />
                      Verify server certificate
                    </label>
                  </div>
                  {draftErrors.tlsEnabled && (
                    <div className="kafka-editor-error">{draftErrors.tlsEnabled}</div>
                  )}
                  {draft.tlsEnabled && (
                    <div className="kafka-subcard-fields">
                      <div className="kafka-editor-field kafka-editor-field-full">
                        <label htmlFor="kafka-tls-server-name">TLS Server Name</label>
                        <input
                          id="kafka-tls-server-name"
                          value={draft.tlsServerName}
                          onChange={(event) => updateDraft({ tlsServerName: event.target.value })}
                          placeholder="kafka.local"
                        />
                      </div>
                      <div className="kafka-editor-field kafka-editor-field-full">
                        <label htmlFor="kafka-tls-ca">CA PEM</label>
                        <textarea
                          id="kafka-tls-ca"
                          value={draft.tlsCaPem}
                          onChange={(event) => updateDraft({ tlsCaPem: event.target.value })}
                          placeholder="-----BEGIN CERTIFICATE-----"
                          rows={4}
                        />
                      </div>
                      <div className="kafka-editor-field kafka-editor-field-full">
                        <label htmlFor="kafka-tls-cert">Client Certificate PEM</label>
                        <textarea
                          id="kafka-tls-cert"
                          value={draft.tlsCertPem}
                          onChange={(event) => updateDraft({ tlsCertPem: event.target.value })}
                          placeholder="-----BEGIN CERTIFICATE-----"
                          rows={4}
                        />
                        {draftErrors.tlsCertPem && (
                          <div className="kafka-editor-error">{draftErrors.tlsCertPem}</div>
                        )}
                      </div>
                      <div className="kafka-editor-field kafka-editor-field-full">
                        <label htmlFor="kafka-tls-key">Client Private Key PEM</label>
                        <textarea
                          id="kafka-tls-key"
                          value={draft.tlsKeyPem}
                          onChange={(event) => updateDraft({ tlsKeyPem: event.target.value })}
                          placeholder="-----BEGIN PRIVATE KEY-----"
                          rows={4}
                        />
                        {draftErrors.tlsKeyPem && (
                          <div className="kafka-editor-error">{draftErrors.tlsKeyPem}</div>
                        )}
                      </div>
                      <div className="kafka-editor-field kafka-editor-field-full">
                        <label htmlFor="kafka-tls-passphrase">Key Passphrase</label>
                        <div className="kafka-password-wrapper">
                          <input
                            id="kafka-tls-passphrase"
                            type={showTlsPassphrase ? 'text' : 'password'}
                            value={draft.tlsPassphrase}
                            onChange={(event) => updateDraft({ tlsPassphrase: event.target.value })}
                            placeholder="Optional key passphrase"
                          />
                          <button
                            type="button"
                            className="kafka-password-reveal"
                            onClick={() => setShowTlsPassphrase((v) => !v)}
                            title={showTlsPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                            aria-label={showTlsPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                          >
                            {showTlsPassphrase ? '🙈' : '👁'}
                          </button>
                        </div>
                        {draftErrors.tlsPassphrase && (
                          <div className="kafka-editor-error">{draftErrors.tlsPassphrase}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer actions */}
              <div className="kafka-editor-footer">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={saveDraft}
                  data-testid="kafka-save-cluster-btn"
                >
                  Save Cluster
                </button>
                {editorMode === 'edit' && (
                  <>
                    {!pendingDeleteClusterId && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger-outline"
                        data-testid="kafka-delete-cluster-btn"
                        onClick={() => setPendingDeleteClusterId(editingClusterId)}
                      >
                        Delete Cluster
                      </button>
                    )}
                    {pendingDeleteClusterId && (
                      <div className="kafka-delete-confirm" data-testid="kafka-delete-confirm">
                        <span>Delete this cluster?</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          data-testid="kafka-confirm-delete-btn"
                          onClick={confirmDelete}
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setPendingDeleteClusterId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
