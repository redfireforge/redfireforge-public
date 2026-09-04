import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CustomSelect } from '@shared/components/CustomSelect';
import type { GlobalAuthProfile, AuthType, Environment, Microservice, FeatureGroup } from '@shared/types';
import { useAuthVerify } from '../requests/hooks/useAuthVerify';
import { getStorageUsage, getMaxRuns } from '@shared/utils/storage';
import SettingsStorageTab from './SettingsStorageTab';
import SettingsExportImportTab from './SettingsExportImportTab';
import AuditLogPanel from '../audit/components/AuditLogPanel';
import { logAuthProfileCreated, logAuthProfileDeleted, logAuthProfileRenamed, logAuthProfileUpdated } from '../audit/utils/auditLog';
import { DEMO_HUB_ENABLED } from '../../config/features';
import {
  consumeOpenDockerSettingsRequest,
  OPEN_DOCKER_SETTINGS_EVENT,
} from '@redfireforge/demo-hub/utils/dockerSettingsNav';

const DockerStacksSettings = DEMO_HUB_ENABLED
  ? React.lazy(() =>
      import('@redfireforge/demo-hub/components/DockerStacksSettings').then((mod) => ({
        default: mod.DockerStacksSettings,
      })),
    )
  : null;

export interface SettingsPageProps {
  appGlobalAuthProfiles: GlobalAuthProfile[];
  setAppGlobalAuthProfiles: React.Dispatch<React.SetStateAction<GlobalAuthProfile[]>>;
  environments: Environment[];
  microservices: Microservice[];
  featureGroups: FeatureGroup[];
  onImport: (data: {
    environments?: Environment[];
    microservices?: Microservice[];
    featureGroups?: FeatureGroup[];
    globalAuthProfiles?: GlobalAuthProfile[];
  }) => void;
  confirm: (message: string, onConfirm: () => void) => void;
}

export default function SettingsPage({
  appGlobalAuthProfiles,
  setAppGlobalAuthProfiles,
  environments,
  microservices,
  featureGroups,
  onImport,
  confirm,
}: SettingsPageProps) {
  const [settingsTab, setSettingsTab] = useState<'globalAuth' | 'exportImport' | 'storage' | 'auditLog' | 'docker'>('globalAuth');
  const [maxRunsLocal, setMaxRunsLocal] = useState(50);
  const [storageUsage, setStorageUsage] = useState<{ usedBytes: number; entries: Record<string, number> }>({ usedBytes: 0, entries: {} });
  const [storageExpanded, setStorageExpanded] = useState(false);
  const [editingGlobalAuth, setEditingGlobalAuth] = useState<string | null>(null);
  const [newGlobalProfileName, setNewGlobalProfileName] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const { authVerifying, authVerifyResult, setAuthVerifyResult, verifyAuth: verifyProfileAuth } = useAuthVerify();

  useEffect(() => {
    void (async () => {
      const [usage, maxR] = await Promise.all([getStorageUsage(), getMaxRuns()]);
      setStorageUsage(usage);
      setMaxRunsLocal(maxR);
    })();
  }, []);

  useEffect(() => {
    if (!DEMO_HUB_ENABLED) return undefined;
    if (consumeOpenDockerSettingsRequest()) setSettingsTab('docker');
    const onOpen = () => {
      consumeOpenDockerSettingsRequest();
      setSettingsTab('docker');
    };
    window.addEventListener(OPEN_DOCKER_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DOCKER_SETTINGS_EVENT, onOpen);
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h2>Settings</h2>
      </div>
      <div className="settings-split">
      <nav className="settings-nav">
        <button type="button" className={`settings-nav-item ${settingsTab === 'globalAuth' ? 'active' : ''}`} onClick={() => setSettingsTab('globalAuth')}>Global Auth Profiles</button>
        <button type="button" className={`settings-nav-item ${settingsTab === 'exportImport' ? 'active' : ''}`} onClick={() => setSettingsTab('exportImport')}>Export & Import</button>
        <button type="button" className={`settings-nav-item ${settingsTab === 'storage' ? 'active' : ''}`} onClick={() => setSettingsTab('storage')}>Storage</button>
        <button type="button" className={`settings-nav-item ${settingsTab === 'auditLog' ? 'active' : ''}`} onClick={() => setSettingsTab('auditLog')}>Audit Log</button>
        {DEMO_HUB_ENABLED && (
          <button
            type="button"
            className={`settings-nav-item ${settingsTab === 'docker' ? 'active' : ''}`}
            data-testid="settings-tab-docker"
            onClick={() => setSettingsTab('docker')}
          >
            Docker
          </button>
        )}
      </nav>

      <div className="settings-content">
        {settingsTab === 'globalAuth' && (
          <div className="settings-section">
            <h4>Global Auth Profiles</h4>
            <p className="settings-section-desc">
              Shared across all environments. Feature Groups and microservices can reference these profiles.
            </p>
            <div className="settings-add-row">
              <input
                placeholder="Profile name (e.g. shared-oauth2, company-bearer)"
                value={newGlobalProfileName}
                onChange={(e) => setNewGlobalProfileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newGlobalProfileName.trim()) {
                    const id = uuidv4();
                    const name = newGlobalProfileName.trim();
                    setAppGlobalAuthProfiles((prev) => [...prev, { id, name, auth: { type: 'none' } }]);
                    setNewGlobalProfileName('');
                    setEditingGlobalAuth(id);
                    void logAuthProfileCreated(name, id);
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const id = uuidv4();
                  const name = newGlobalProfileName.trim();
                  setAppGlobalAuthProfiles((prev) => [...prev, { id, name, auth: { type: 'none' } }]);
                  setNewGlobalProfileName('');
                  setEditingGlobalAuth(id);
                  void logAuthProfileCreated(name, id);
                }}
                disabled={!newGlobalProfileName.trim()}
              >
                Add
              </button>
            </div>

            {appGlobalAuthProfiles.length === 0 && <div className="empty-hint">No global auth profiles yet.</div>}
            {appGlobalAuthProfiles.map((profile) => {
              const isAuthEditing = editingGlobalAuth === profile.id;
              const profileAuth = profile.auth;

              return (
                <div key={profile.id} className="global-auth-profile-card">
                  <div className="global-auth-profile-header">
                    <input
                      className="global-auth-profile-name"
                      value={profile.name}
                      onChange={(e) => {
                        setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, name: e.target.value } : authProfile));
                      }}
                      onBlur={(e) => {
                        const newName = e.target.value.trim();
                        const oldProfile = appGlobalAuthProfiles.find((p) => p.id === profile.id);
                        if (oldProfile && oldProfile.name !== newName && newName) {
                          void logAuthProfileRenamed(profile.id, oldProfile.name, newName);
                        }
                      }}
                    />
                    <span className={`auth-badge ${profileAuth.type === 'none' ? 'auth-badge-none' : `auth-badge-type-${profileAuth.type}`}`}>
                      {profileAuth.type === 'none' ? 'No Auth' : profileAuth.type.toUpperCase()}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setEditingGlobalAuth(isAuthEditing ? null : profile.id);
                        setAuthVerifyResult(null);
                        setShowSecret(false);
                      }}
                    >
                      {isAuthEditing ? 'Collapse' : 'Configure'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-outline"
                      onClick={() => {
                        confirm(`Delete global auth profile "${profile.name}"?`, () => {
                          setAppGlobalAuthProfiles((prev) => prev.filter((authProfile) => authProfile.id !== profile.id));
                          if (editingGlobalAuth === profile.id) setEditingGlobalAuth(null);
                          void logAuthProfileDeleted(profile.name, profile.id);
                        });
                      }}
                    >
                      Delete
                    </button>
                  </div>

                  {isAuthEditing && (
                    <div className="global-auth-profile-body">
                      <div className="auth-type-select">
                        <label>Type</label>
                        <CustomSelect
                          value={profileAuth.type}
                          onChange={(v) => {
                            const newType = v as AuthType;
                            const oldType = profileAuth.type;
                            setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, type: newType } } : authProfile));
                            if (oldType !== newType) {
                              void logAuthProfileUpdated(profile.name, profile.id, [{ field: 'type', oldValue: oldType, newValue: newType }]);
                            }
                          }}
                          options={[
                            { value: 'none', label: 'No Auth' },
                            { value: 'basic', label: 'Basic Auth' },
                            { value: 'bearer', label: 'Bearer Token' },
                            { value: 'apikey', label: 'API Key' },
                            { value: 'digest', label: 'Digest Auth' },
                            { value: 'oauth2', label: 'OAuth2 Client Credentials' },
                          ]}
                        />
                      </div>

                      {profileAuth.type === 'basic' && (
                        <div className="form-row two-col">
                          <div>
                            <label>Username</label>
                            <input value={profileAuth.username || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, username: e.target.value } } : authProfile))} />
                          </div>
                          <div>
                            <label>Password</label>
                            <div className="secret-input-wrap">
                              <input type={showSecret ? 'text' : 'password'} value={profileAuth.password || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, password: e.target.value } } : authProfile))} />
                              <button type="button" className="secret-toggle" onClick={() => setShowSecret((value) => !value)} title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁'}</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {profileAuth.type === 'bearer' && (
                        <div className="form-row two-col">
                          <div>
                            <label>Token</label>
                            <input value={profileAuth.token || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, token: e.target.value } } : authProfile))} placeholder="eyJhbGciOi..." />
                          </div>
                          <div>
                            <label>Prefix</label>
                            <input value={profileAuth.prefix ?? 'Bearer'} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, prefix: e.target.value } } : authProfile))} placeholder="Bearer" />
                          </div>
                        </div>
                      )}

                      {profileAuth.type === 'apikey' && (
                        <>
                          <div className="form-row two-col">
                            <div>
                              <label>Key Name</label>
                              <input value={profileAuth.apiKeyName || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, apiKeyName: e.target.value } } : authProfile))} placeholder="X-API-Key" />
                            </div>
                            <div>
                              <label>Key Value</label>
                              <input value={profileAuth.apiKeyValue || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, apiKeyValue: e.target.value } } : authProfile))} placeholder="your-api-key" />
                            </div>
                          </div>
                          <div className="form-row">
                            <label>Add to</label>
                            <div className="radio-group">
                              <label className="radio-label"><input type="radio" checked={profileAuth.apiKeyIn !== 'query'} onChange={() => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, apiKeyIn: 'header' } } : authProfile))} />Header</label>
                              <label className="radio-label"><input type="radio" checked={profileAuth.apiKeyIn === 'query'} onChange={() => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, apiKeyIn: 'query' } } : authProfile))} />Query Parameter</label>
                            </div>
                          </div>
                        </>
                      )}

                      {profileAuth.type === 'digest' && (
                        <div className="form-row two-col">
                          <div>
                            <label>Username</label>
                            <input value={profileAuth.username || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, username: e.target.value } } : authProfile))} />
                          </div>
                          <div>
                            <label>Password</label>
                            <div className="secret-input-wrap">
                              <input type={showSecret ? 'text' : 'password'} value={profileAuth.password || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, password: e.target.value } } : authProfile))} />
                              <button type="button" className="secret-toggle" onClick={() => setShowSecret((value) => !value)} title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁'}</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {profileAuth.type === 'oauth2' && (
                        <>
                          <div className="form-row">
                            <label>Token URL</label>
                            <input value={profileAuth.tokenUrl || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, tokenUrl: e.target.value } } : authProfile))} placeholder="https://auth.example.com/oauth/token" />
                          </div>
                          <div className="form-row two-col">
                            <div>
                              <label>Client ID</label>
                              <input value={profileAuth.clientId || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, clientId: e.target.value } } : authProfile))} />
                            </div>
                            <div>
                              <label>Client Secret</label>
                              <div className="secret-input-wrap">
                                <input type={showSecret ? 'text' : 'password'} value={profileAuth.clientSecret || ''} onChange={(e) => setAppGlobalAuthProfiles((prev) => prev.map((authProfile) => authProfile.id === profile.id ? { ...authProfile, auth: { ...profileAuth, clientSecret: e.target.value } } : authProfile))} />
                                <button type="button" className="secret-toggle" onClick={() => setShowSecret((value) => !value)} title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁'}</button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {profileAuth.type !== 'none' && (
                        <div className="auth-verify-section">
                          <button type="button" className="btn btn-sm btn-verify" onClick={() => verifyProfileAuth(profileAuth)} disabled={authVerifying}>{authVerifying ? 'Verifying...' : 'Verify Auth'}</button>
                          {authVerifyResult && (
                            <div className={`auth-verify-result ${authVerifyResult.ok ? 'auth-verify-ok' : 'auth-verify-fail'}`}>
                              <span className="auth-verify-icon">{authVerifyResult.ok ? '✓' : '✗'}</span>
                              {authVerifyResult.message}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {settingsTab === 'storage' && (
          <SettingsStorageTab
            storageUsage={storageUsage}
            setStorageUsage={setStorageUsage}
            maxRunsLocal={maxRunsLocal}
            setMaxRunsLocal={setMaxRunsLocal}
            storageExpanded={storageExpanded}
            setStorageExpanded={setStorageExpanded}
          />
        )}

        {settingsTab === 'exportImport' && (
          <SettingsExportImportTab
            environments={environments}
            microservices={microservices}
            featureGroups={featureGroups}
            appGlobalAuthProfiles={appGlobalAuthProfiles}
            onImport={onImport}
          />
        )}

        {settingsTab === 'auditLog' && (
          <AuditLogPanel />
        )}

        {DEMO_HUB_ENABLED && settingsTab === 'docker' && DockerStacksSettings && (
          <React.Suspense fallback={<div className="docker-settings__loading">Loading Docker settings…</div>}>
            <DockerStacksSettings confirm={confirm} />
          </React.Suspense>
        )}
      </div>
      </div>
    </div>
  );
}
