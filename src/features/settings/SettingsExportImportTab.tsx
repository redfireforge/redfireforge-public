import { useState, useMemo, useRef, useCallback } from 'react';
import type { Environment, Microservice, FeatureGroup, GlobalAuthProfile } from '@shared/types';
import { saveJsonFile, buildExportFilename, openJsonFile } from '@shared/utils/fileSaver';
import { isTauri } from '@shared/utils/platform';
import { countVersions, hasVersionData, stripVersions } from '../scenarios/utils/scenarioImportExport';

interface ParsedImport {
  environments: Environment[];
  microservices: Microservice[];
  featureGroups: FeatureGroup[];
  globalAuthProfiles: GlobalAuthProfile[];
  exportedAt?: string;
  version?: string;
}

interface Props {
  environments: Environment[];
  microservices: Microservice[];
  featureGroups: FeatureGroup[];
  appGlobalAuthProfiles: GlobalAuthProfile[];
  onImport: (data: {
    environments?: Environment[];
    microservices?: Microservice[];
    featureGroups?: FeatureGroup[];
    globalAuthProfiles?: GlobalAuthProfile[];
  }) => void;
}

export default function SettingsExportImportTab({ environments, microservices, featureGroups, appGlobalAuthProfiles, onImport }: Props) {
  // ── Export state ──
  const [exportEnvs, setExportEnvs] = useState<Set<string>>(() => new Set(environments.map(e => e.id)));
  const [exportAuth, setExportAuth] = useState<Set<string>>(() => new Set(appGlobalAuthProfiles.map(a => a.id)));
  const [maskSecrets, setMaskSecrets] = useState(false);
  const [includeResponseVersions, setIncludeResponseVersions] = useState(true);
  const [includeRulesVersions, setIncludeRulesVersions] = useState(true);

  // ── Import state ──
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importAuth, setImportAuth] = useState(true);
  const [importResponseVersions, setImportResponseVersions] = useState(true);
  const [importRulesVersions, setImportRulesVersions] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalSelected = exportEnvs.size + exportAuth.size;
  const exportVersionCounts = useMemo(() => countVersions(featureGroups), [featureGroups]);

  const toggleAll = (ids: string[], set: Set<string>, setter: (s: Set<string>) => void) => {
    if (ids.every(id => set.has(id))) setter(new Set());
    else setter(new Set(ids));
  };

  const toggle = (id: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  // ── Export handler ──
  const handleExport = async () => {
    const selectedEnvs = environments.filter(e => exportEnvs.has(e.id));
    const selectedSvcs = microservices.filter(s => {
      const envIds = Object.keys(s.baseUrls ?? {});
      return envIds.some(eid => exportEnvs.has(eid));
    });

    let exportFgs = featureGroups;
    if (!includeResponseVersions || !includeRulesVersions) {
      exportFgs = stripVersions(featureGroups, { includeResponseVersions, includeRulesVersions, includeDefinitionVersions: true, includeStructureLog: true }) as FeatureGroup[];
    }

    const data: Record<string, unknown> = {
      environments: selectedEnvs,
      microservices: selectedSvcs,
      featureGroups: exportFgs,
      exportedAt: new Date().toISOString(),
      version: '3.0',
    };

    if (exportAuth.size > 0) {
      let profiles = appGlobalAuthProfiles.filter(a => exportAuth.has(a.id));
      if (maskSecrets) {
        profiles = profiles.map(p => ({
          ...p,
          auth: { ...p.auth, clientSecret: p.auth.type === 'oauth2' ? '***masked***' : (p.auth as unknown as Record<string, unknown>).clientSecret } as typeof p.auth,
        }));
      }
      data.appGlobalAuthProfiles = profiles;
    }

    const filename = buildExportFilename({ level: 'data', name: 'redfire-export' });
    await saveJsonFile(data, filename);
  };

  // ── Import file processing ──
  const processJson = useCallback((jsonText: string, name: string) => {
    setFileName(name);
    setParseError(null);
    setParsed(null);
    try {
      const data = JSON.parse(jsonText);
      if (Array.isArray(data.environments) || Array.isArray(data.microservices) || Array.isArray(data.featureGroups)) {
        let fgs: FeatureGroup[] = data.featureGroups ?? [];
        fgs = fgs.map((fg: FeatureGroup) => {
          const copy = { ...fg };
          if ('projectId' in copy) delete (copy as Record<string, unknown>).projectId;
          return copy;
        });
        const auth: GlobalAuthProfile[] = [...(data.globalAuthProfiles ?? []), ...(data.appGlobalAuthProfiles ?? [])];
        setParsed({
          environments: data.environments ?? [],
          microservices: data.microservices ?? [],
          featureGroups: fgs,
          globalAuthProfiles: auth,
          exportedAt: data.exportedAt,
          version: data.version,
        });
        return;
      }
      setParseError('File does not contain recognizable data.');
    } catch {
      setParseError('Invalid JSON file.');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processJson(reader.result as string, file.name);
    reader.onerror = () => setParseError('Failed to read file.');
    reader.readAsText(file);
  };

  const handleTauriOpen = useCallback(async () => {
    const result = await openJsonFile();
    if (!result) return;
    processJson(result.content, result.name);
  }, [processJson]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processJson(reader.result as string, file.name);
    reader.onerror = () => setParseError('Failed to read file.');
    reader.readAsText(file);
  }, [processJson]);

  const handleImport = () => {
    if (!parsed) return;
    const existingEnvIds = new Set(environments.map(e => e.id));
    const existingSvcIds = new Set(microservices.map(s => s.id));
    const existingAuthIds = new Set(appGlobalAuthProfiles.map(a => a.id));
    let fgs = parsed.featureGroups;
    if (!importResponseVersions || !importRulesVersions) {
      fgs = stripVersions(fgs, { includeResponseVersions: importResponseVersions, includeRulesVersions: importRulesVersions, includeDefinitionVersions: true, includeStructureLog: true }) as FeatureGroup[];
    }
    onImport({
      environments: parsed.environments.filter(e => !existingEnvIds.has(e.id)),
      microservices: parsed.microservices.filter(s => !existingSvcIds.has(s.id)),
      featureGroups: fgs,
      globalAuthProfiles: importAuth ? parsed.globalAuthProfiles.filter(a => !existingAuthIds.has(a.id)) : undefined,
    });
    setParsed(null);
    setFileName('');
  };

  const importSummary = useMemo(() => {
    if (!parsed) return null;
    const existingEnvIds = new Set(environments.map(e => e.id));
    const existingSvcIds = new Set(microservices.map(s => s.id));
    return {
      newEnvs: parsed.environments.filter(e => !existingEnvIds.has(e.id)).length,
      totalEnvs: parsed.environments.length,
      newSvcs: parsed.microservices.filter(s => !existingSvcIds.has(s.id)).length,
      totalSvcs: parsed.microservices.length,
      fgs: parsed.featureGroups.length,
      auth: parsed.globalAuthProfiles.length,
      ...countVersions(parsed.featureGroups),
    };
  }, [parsed, environments, microservices]);

  return (
    <div className="settings-section storage-tab exi-inline">
      <h4>Export &amp; Import</h4>
      <p className="settings-section-desc">Export all environments and auth profiles to a JSON file, or import from one.</p>

      <div className="storage-grid">
        <section className="storage-card">
          <header className="storage-card-header">
            <div>
              <h5 className="storage-card-title">Export</h5>
              <p className="storage-card-desc">Choose what to include in the JSON file.</p>
            </div>
            <div className="storage-usage-summary">
              <span className="storage-usage-value">{totalSelected}</span>
              <span className="storage-stat-hint">selected</span>
            </div>
          </header>

          <div className="exi-group">
            <label className="exi-group-header">
              <input
                type="checkbox"
                checked={environments.length > 0 && environments.every(e => exportEnvs.has(e.id))}
                disabled={environments.length === 0}
                onChange={() => toggleAll(environments.map(e => e.id), exportEnvs, setExportEnvs)}
                aria-label="Select all environments"
              />
              <strong>Environments</strong>
              <span className="exi-count">({exportEnvs.size}/{environments.length})</span>
            </label>
            {environments.length === 0 ? (
              <p className="empty-hint">No environments to export yet. Add one on the Environments tab.</p>
            ) : (
              <div className="exi-items">
                {environments.map(e => (
                  <label key={e.id} className="exi-item">
                    <input type="checkbox" checked={exportEnvs.has(e.id)} onChange={() => toggle(e.id, exportEnvs, setExportEnvs)} />
                    <span className="exi-item-name">{e.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="exi-group">
            <label className="exi-group-header">
              <input
                type="checkbox"
                checked={appGlobalAuthProfiles.length > 0 && appGlobalAuthProfiles.every(a => exportAuth.has(a.id))}
                disabled={appGlobalAuthProfiles.length === 0}
                onChange={() => toggleAll(appGlobalAuthProfiles.map(a => a.id), exportAuth, setExportAuth)}
                aria-label="Select all global auth profiles"
              />
              <strong>Global Auth Profiles</strong>
              <span className="exi-count">({exportAuth.size}/{appGlobalAuthProfiles.length})</span>
            </label>
            {appGlobalAuthProfiles.length === 0 ? (
              <p className="empty-hint">No global auth profiles to include.</p>
            ) : (
              <div className="exi-items">
                {appGlobalAuthProfiles.map(a => (
                  <label key={a.id} className="exi-item">
                    <input type="checkbox" checked={exportAuth.has(a.id)} onChange={() => toggle(a.id, exportAuth, setExportAuth)} />
                    <span className="exi-item-name">{a.name}</span>
                    <span className={`auth-badge ${a.auth.type === 'none' ? 'auth-badge-none' : `auth-badge-type-${a.auth.type}`}`}>
                      {a.auth.type === 'none' ? 'No Auth' : a.auth.type.toUpperCase()}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="storage-danger-row">
            <div className="exi-footer-opts">
              <label className="exi-item exi-mask">
                <input type="checkbox" checked={maskSecrets} onChange={(e) => setMaskSecrets(e.target.checked)} />
                Mask secrets on export
              </label>
              {hasVersionData(featureGroups) && (
                <div className="exi-version-opts">
                  {exportVersionCounts.responseVersionCount > 0 && (
                    <label className="exi-item">
                      <input type="checkbox" checked={includeResponseVersions} onChange={(e) => setIncludeResponseVersions(e.target.checked)} />
                      Include response versions ({exportVersionCounts.responseVersionCount})
                    </label>
                  )}
                  {exportVersionCounts.rulesVersionCount > 0 && (
                    <label className="exi-item">
                      <input type="checkbox" checked={includeRulesVersions} onChange={(e) => setIncludeRulesVersions(e.target.checked)} />
                      Include rules versions ({exportVersionCounts.rulesVersionCount})
                    </label>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleExport} disabled={totalSelected === 0}>
              Export ({totalSelected} selected)
            </button>
          </div>
        </section>

        <section className="storage-card">
          <header className="storage-card-header">
            <div>
              <h5 className="storage-card-title">Import</h5>
              <p className="storage-card-desc">Drop a JSON file or browse to merge new items. Existing IDs are skipped.</p>
            </div>
          </header>

          {!parsed ? (
            <div
              className={`exi-dropzone${dragging ? ' dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={isTauri() ? handleTauriOpen : () => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (isTauri()) void handleTauriOpen();
                  else fileRef.current?.click();
                }
              }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <span className="exi-dropzone-label">Drop file here</span>
              <span className="exi-dropzone-or">or</span>
              <span className="btn btn-secondary btn-sm">Browse files</span>
              <span className="exi-dropzone-formats">.json</span>
              {!isTauri() && <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileSelect} />}
            </div>
          ) : (
            <div className="exi-import-preview">
              <div className="exi-import-file">
                <div className="exi-import-file-info">
                  <span className="exi-import-file-name">{fileName}</span>
                  {parsed.version && <span className="exi-import-file-meta">v{parsed.version}{parsed.exportedAt ? ` · ${new Date(parsed.exportedAt).toLocaleDateString()}` : ''}</span>}
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setParsed(null); setFileName(''); }}>✕</button>
              </div>

              {importSummary && (
                <div className="exi-import-summary">
                  <span className="storage-cleanup-label">Contents</span>
                  {importSummary.totalEnvs > 0 && (
                    <div className="exi-import-row">
                      <span>{importSummary.newEnvs} new environment{importSummary.newEnvs !== 1 ? 's' : ''}</span>
                      {importSummary.totalEnvs !== importSummary.newEnvs && <span className="exi-skip">{importSummary.totalEnvs - importSummary.newEnvs} exist</span>}
                    </div>
                  )}
                  {importSummary.totalSvcs > 0 && (
                    <div className="exi-import-row">
                      <span>{importSummary.newSvcs} new microservice{importSummary.newSvcs !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {importSummary.fgs > 0 && (
                    <div className="exi-import-row">
                      <span>{importSummary.fgs} feature group{importSummary.fgs !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              )}

              {parsed.globalAuthProfiles.length > 0 && (
                <label className="exi-item">
                  <input type="checkbox" checked={importAuth} onChange={(e) => setImportAuth(e.target.checked)} />
                  Include {parsed.globalAuthProfiles.length} auth profile{parsed.globalAuthProfiles.length !== 1 ? 's' : ''}
                </label>
              )}

              {importSummary && hasVersionData(parsed?.featureGroups) && (
                <div className="exi-version-opts">
                  {importSummary.responseVersionCount > 0 && (
                    <label className="exi-item">
                      <input type="checkbox" checked={importResponseVersions} onChange={(e) => setImportResponseVersions(e.target.checked)} />
                      Include response versions ({importSummary.responseVersionCount})
                    </label>
                  )}
                  {importSummary.rulesVersionCount > 0 && (
                    <label className="exi-item">
                      <input type="checkbox" checked={importRulesVersions} onChange={(e) => setImportRulesVersions(e.target.checked)} />
                      Include rules versions ({importSummary.rulesVersionCount})
                    </label>
                  )}
                </div>
              )}

              <div className="storage-danger-row">
                <p className="storage-card-desc">Merges new IDs only. Existing environments and profiles are left unchanged.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleImport}>
                  ↑ Import
                </button>
              </div>
            </div>
          )}
          {parseError && <div className="exi-error">{parseError}</div>}
        </section>
      </div>
    </div>
  );
}
