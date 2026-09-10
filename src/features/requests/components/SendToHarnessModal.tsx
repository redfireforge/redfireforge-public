import { useState, useMemo, useCallback } from 'react';
import { SWAGGER_METHOD_COLORS } from '@shared/constants/httpMethodColors';
import { useModalDrag } from '@shared/hooks/useModalDrag';
import HarnessOptionsGrid from './send-harness-shared/HarnessOptionsGrid';
import type {
  Environment,
  FeatureGroup,
  Microservice,
  RequestItem,
  Scenario,
  TestScenario,
} from '@shared/types';
import type { PromotionContext, PromotionOptions } from '../utils/requestToScenario';
import {
  createScenarioFromRequest,
  resolveDefaultPromotionEnvId,
  resolveDefaultPromotionSvcId,
} from '../utils/requestToScenario';
import { CascadeSelect } from './CascadeSelect';
import { useEscapeKey } from '@shared/hooks/useEscapeKey';
import { useHarnessEnvironmentCascade } from '../hooks/useHarnessEnvironmentCascade';

export interface SendToHarnessPayload {
  scenario: Scenario;
  targetGroupId?: string;
  targetScenarioId?: string;
  newGroupName?: string;
  newScenarioName?: string;
  openEditorAfter: boolean;
  environmentId?: string;
  microserviceId?: string;
}

interface Props {
  request: RequestItem;
  promotionContext: PromotionContext;
  featureGroups: FeatureGroup[];
  environments: Environment[];
  microservices: Microservice[];
  onConfirm: (payload: SendToHarnessPayload) => void;
  onClose: () => void;
  defaultValidationPreset?: 'none' | 'status-200';
}

type Step = 'target' | 'options';

export default function SendToHarnessModal({
  request, promotionContext, featureGroups, environments, microservices, onConfirm, onClose, defaultValidationPreset,
}: Props) {
  const [step, setStep] = useState<Step>('target');
  const { modalStyle, onPointerDragStart } = useModalDrag(true, { constrainToViewport: true });

  const inferredEnvId = useMemo(
    () => resolveDefaultPromotionEnvId(request, {
      collection: promotionContext.collection,
      folderId: promotionContext.folderId,
      selectedEnvId: promotionContext.selectedEnvId,
      appEnvironments: promotionContext.appEnvironments ?? environments,
    }),
    [request, promotionContext, environments],
  );

  // Cascade selections — start on the request’s current env/svc so a leftover
  // workbench env (e.g. t01 after moving into local-t01) is not the default.
  const [envId, setEnvId] = useState(inferredEnvId ?? '');
  const [svcId, setSvcId] = useState(
    () => resolveDefaultPromotionSvcId(promotionContext.collection, microservices, inferredEnvId) ?? '',
  );
  const [groupId, setGroupId] = useState('');
  const [scenarioId, setScenarioId] = useState('');

  // New item names (only for Feature Group and Scenario — env/svc must be created in Settings)
  const [newGroupName, setNewGroupName] = useState('');
  const [newScenarioName, setNewScenarioName] = useState('');

  // Options
  const [authMode, setAuthMode] = useState<'concrete' | 'inherit'>('concrete');
  const [validationPreset, setValidationPreset] = useState<'none' | 'status-200'>(defaultValidationPreset ?? 'none');
  const [openEditorAfter, setOpenEditorAfter] = useState(false);

  const isNewGroup = groupId === '__new__';
  const isNewScenario = scenarioId === '__new__';

  const { envOptions, filteredMicroservices } = useHarnessEnvironmentCascade(
    environments,
    microservices,
    envId,
  );

  // Filtered feature groups based on env + svc
  const filteredGroups = useMemo(() => {
    return featureGroups.filter(g => {
      if (envId && g.environmentId && g.environmentId !== envId) return false;
      if (svcId && g.microserviceId && g.microserviceId !== svcId) return false;
      return true;
    });
  }, [featureGroups, envId, svcId]);

  // Scenarios: empty if new group, otherwise from selected group
  const scenarios: TestScenario[] = useMemo(
    () => isNewGroup ? [] : (filteredGroups.find(g => g.id === groupId)?.scenarios ?? []),
    [filteredGroups, groupId, isNewGroup],
  );

  // Reset child selections when parent changes
  const handleEnvChange = (id: string) => {
    setEnvId(id);
    setSvcId(resolveDefaultPromotionSvcId(promotionContext.collection, microservices, id) ?? '');
    setGroupId('');
    setScenarioId('');
    setNewGroupName('');
    setNewScenarioName('');
  };

  const activePromotionContext = useMemo((): PromotionContext => ({
    ...promotionContext,
    selectedEnvId: envId || inferredEnvId || promotionContext.selectedEnvId,
    appEnvironments: promotionContext.appEnvironments ?? environments,
  }), [promotionContext, envId, inferredEnvId, environments]);

  const handleSvcChange = (id: string) => {
    setSvcId(id);
    setGroupId('');
    setScenarioId('');
    setNewGroupName('');
    setNewScenarioName('');
  };

  const handleGroupChange = (id: string) => {
    setGroupId(id);
    setNewGroupName('');
    if (id === '__new__') {
      setScenarioId('__new__');
      setNewScenarioName('');
    } else {
      setScenarioId('');
      setNewScenarioName('');
    }
  };

  // Validation
  const envReady = !!envId;
  const svcReady = !!svcId;
  const groupReady = isNewGroup ? newGroupName.trim() : groupId;
  const scenarioReady = isNewScenario ? newScenarioName.trim() : scenarioId;
  const canProceed = step === 'target'
    ? !!(envReady && svcReady && groupReady && scenarioReady)
    : true;

  const activeVersion = useMemo(
    () => request.specVersions?.find(v => v.id === request.activeSpecVersionId),
    [request],
  );

  const previewScenario = useMemo(() => {
    const options: PromotionOptions = { validationPreset, authMode };
    return createScenarioFromRequest(request, activePromotionContext, options);
  }, [request, activePromotionContext, validationPreset, authMode]);

  const handleConfirm = useCallback(() => {
    const options: PromotionOptions = { validationPreset, authMode };
    const scenario = createScenarioFromRequest(request, activePromotionContext, options);

    onConfirm({
      scenario,
      targetGroupId: isNewGroup ? undefined : groupId,
      targetScenarioId: (isNewGroup || isNewScenario) ? undefined : scenarioId,
      newGroupName: isNewGroup ? newGroupName.trim() : undefined,
      newScenarioName: (isNewGroup || isNewScenario) ? newScenarioName.trim() : undefined,
      openEditorAfter,
      environmentId: envId || undefined,
      microserviceId: svcId || undefined,
    });
  }, [
    request, activePromotionContext, validationPreset, authMode,
    envId, svcId, groupId, scenarioId,
    isNewGroup, isNewScenario,
    newGroupName, newScenarioName,
    openEditorAfter, onConfirm,
  ]);

  useEscapeKey(onClose);

  // Build breadcrumb summary for step 2
  const targetSummary = useMemo(() => {
    const envName = envOptions.find(e => e.id === envId)?.name ?? '';
    const svcName = microservices.find(s => s.id === svcId)?.name ?? '';
    const grpName = isNewGroup ? newGroupName.trim() : filteredGroups.find(g => g.id === groupId)?.name ?? '';
    const scName = isNewScenario ? newScenarioName.trim() : scenarios.find(s => s.id === scenarioId)?.name ?? '';
    return { envName, svcName, grpName, scName };
  }, [envId, svcId, groupId, scenarioId, isNewGroup, isNewScenario,
    newGroupName, newScenarioName, envOptions, microservices, filteredGroups, scenarios]);

  return (
    <div className="send-harness-overlay">
      <div className="send-harness-modal" data-testid="req-send-harness-modal" role="dialog" style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header — draggable */}
        <div className="send-harness-header" style={{ cursor: 'grab' }} onPointerDown={onPointerDragStart}>
          <div className="send-harness-title-row">
            <h3>Send to Harness</h3>
            <div className="send-harness-steps">
              <span className={`send-harness-step${step === 'target' ? ' active' : ''}`}>1 Target</span>
              <span className="send-harness-step-arrow">&rsaquo;</span>
              <span className={`send-harness-step${step === 'options' ? ' active' : ''}`}>2 Options</span>
            </div>
          </div>
          <div className="send-harness-origin-row">
            <span className="send-harness-method-pill" style={{ background: SWAGGER_METHOD_COLORS[request.method] + '22', color: SWAGGER_METHOD_COLORS[request.method] }}>{request.method}</span>
            <span className="send-harness-origin-path">{request.catalogMeta?.originalPath || request.url}</span>
            {request.catalogMeta?.sourceSpec && <span className="send-harness-origin-spec">{request.catalogMeta.sourceSpec}</span>}
            {activeVersion?.catalogVersion && <span className="send-harness-origin-ver">v{activeVersion.catalogVersion}</span>}
          </div>
        </div>

        {/* Step 1: Cascading Target Selection */}
        {step === 'target' && (
          <div className="send-harness-body">
            <CascadeSelect
              label="Environment"
              placeholder="Select environment..."
              value={envId}
              onChange={handleEnvChange}
              options={envOptions}
              settingsHint="Need a new environment? Go to Settings to create one."
            />

            <CascadeSelect
              label="Microservice"
              placeholder={envReady ? 'Select microservice...' : 'Select environment first...'}
              value={svcId}
              onChange={handleSvcChange}
              options={filteredMicroservices.map(s => ({ id: s.id, name: s.name }))}
              settingsHint="Need a new microservice? Go to Settings to create one."
            />

            <CascadeSelect
              label="Feature Group"
              placeholder={svcReady ? 'Select feature group...' : 'Select microservice first...'}
              value={groupId}
              onChange={handleGroupChange}
              options={filteredGroups.map(g => ({
                id: g.id,
                name: g.name,
                detail: `${g.scenarios.length} scenario${g.scenarios.length !== 1 ? 's' : ''}`,
              }))}
              onCreate={svcReady ? () => handleGroupChange('__new__') : undefined}
              newValue={newGroupName}
              onNewValueChange={setNewGroupName}
              isCreating={isNewGroup}
            />

            <CascadeSelect
              label="Test Scenario"
              placeholder={groupReady ? 'Select scenario...' : 'Select feature group first...'}
              value={scenarioId}
              onChange={setScenarioId}
              options={scenarios.map(s => ({
                id: s.id,
                name: s.name,
                detail: `${s.tests.length} test${s.tests.length !== 1 ? 's' : ''}`,
              }))}
              onCreate={groupReady ? () => setScenarioId('__new__') : undefined}
              newValue={newScenarioName}
              onNewValueChange={setNewScenarioName}
              isCreating={isNewScenario}
            />
          </div>
        )}

        {/* Step 2: Options */}
        {step === 'options' && (
          <div className="send-harness-body">
            {/* Target summary breadcrumb */}
            <div className="send-harness-target-summary">
              <span className="send-harness-summary-item send-harness-summary-env">{targetSummary.envName}</span>
              <span className="send-harness-summary-sep">/</span>
              <span className="send-harness-summary-item send-harness-summary-svc">{targetSummary.svcName}</span>
              <span className="send-harness-summary-sep">/</span>
              <span className="send-harness-summary-item">{targetSummary.grpName}</span>
              <span className="send-harness-summary-sep">/</span>
              <span className="send-harness-summary-item">{targetSummary.scName}</span>
            </div>

            <div className="send-harness-preview-card">
              <div className="send-harness-preview-main">
                <span className="send-harness-preview-method" style={{ color: SWAGGER_METHOD_COLORS[previewScenario.method] }}>
                  {previewScenario.method}
                </span>
                <span className="send-harness-preview-url" title={previewScenario.url}>
                  {previewScenario.url}
                </span>
              </div>
              <div className="send-harness-preview-meta">
                <span>Auth: {previewScenario.auth.type}</span>
                {previewScenario.headers.filter(h => h.key.trim()).length > 0 && (
                  <span>{previewScenario.headers.filter(h => h.key.trim()).length} header{previewScenario.headers.filter(h => h.key.trim()).length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>

            <HarnessOptionsGrid
              authMode={authMode} setAuthMode={setAuthMode}
              validationPreset={validationPreset} setValidationPreset={setValidationPreset}
            />

            <label className="send-harness-editor-toggle">
              <input type="checkbox" checked={openEditorAfter} onChange={e => setOpenEditorAfter(e.target.checked)} />
              <span>Open test editor after creation</span>
            </label>
          </div>
        )}

        {/* Footer */}
        <div className="send-harness-footer">
          <button className="send-harness-cancel-btn" data-testid="send-harness-cancel" onClick={onClose}>Cancel</button>
          <div className="send-harness-footer-right">
            {step === 'options' && (
              <button className="send-harness-back-btn" data-testid="send-harness-back" onClick={() => setStep('target')}>Back</button>
            )}
            {step === 'target' && (
              <button
                className="send-harness-next-btn"
                data-testid="send-harness-next"
                disabled={!canProceed}
                onClick={() => setStep('options')}
              >
                Next
              </button>
            )}
            {step === 'options' && (
              <button className="send-harness-confirm-btn" data-testid="send-harness-confirm" onClick={handleConfirm}>
                Send to Harness
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
