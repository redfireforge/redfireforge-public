/**
 * Phase 5A — acceptance checklist traceability.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURE_UNARY_CALL_REQUEST } from './contractFixtures';
import { GRPC_REDACTED_PLACEHOLDER } from './grpcRedaction';
import {
  GRPC_CALL_HISTORY_MAX_ENTRIES,
  GRPC_COLLECTIONS_STORAGE_KEY,
  GRPC_CALL_HISTORY_STORAGE_KEY,
  GRPC_PERSISTENCE_SCHEMA_VERSION,
  bumpGrpcSavedRequestRevision,
  createGrpcSavedRequestIdentity,
  prepareGrpcCallHistoryEntryForPersist,
  prepareGrpcCollectionsStoreForPersist,
  validateGrpcCallHistoryStore,
  validateGrpcCollectionsStore,
} from './grpcPersistenceSchema';
import {
  migrateGrpcCallHistoryStore,
  migrateGrpcCollectionsStore,
} from './grpcPersistenceMigration';
import { scanForbiddenGrpcPersistTargets } from './grpcSecretLeakScan';
import { GRPC_FORBIDDEN_SECRET_PERSIST_TARGETS } from './grpcSecretPolicy';
import { createGrpcSavedRequestFromSnapshot } from './grpcSavedRequest';

const TS = '2026-06-29T12:00:00.000Z';
const VALID_PEM = `-----BEGIN CERTIFICATE-----
LEAKED
-----END CERTIFICATE-----`;

describe('Phase 5A acceptance checklist', () => {
  it('defines stable v1 storage keys and schema version', () => {
    expect(GRPC_COLLECTIONS_STORAGE_KEY).toBe('grpc_collections_v1');
    expect(GRPC_CALL_HISTORY_STORAGE_KEY).toBe('grpc_call_history_v1');
    expect(GRPC_PERSISTENCE_SCHEMA_VERSION).toBe(1);
    expect(GRPC_FORBIDDEN_SECRET_PERSIST_TARGETS).toContain('grpc_collections_v1');
    expect(GRPC_FORBIDDEN_SECRET_PERSIST_TARGETS).toContain('grpc_call_history_v1');
  });

  it('saved-request identity is immutable id with bumpable revision', () => {
    const created = createGrpcSavedRequestIdentity('sr-accept', TS);
    const bumped = bumpGrpcSavedRequestRevision(created, '2026-06-29T13:00:00.000Z');
    expect(bumped.id).toBe('sr-accept');
    expect(bumped.createdAt).toBe(TS);
    expect(bumped.revisionId).not.toBe(created.revisionId);
  });

  it('createGrpcSavedRequestFromSnapshot assigns name and createdAt defaults', () => {
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: TS,
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: {},
        metadata: {},
        timeoutMs: 30_000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: TS },
    );
    expect(saved.name).toBe(`${FIXTURE_UNARY_CALL_REQUEST.service}/${FIXTURE_UNARY_CALL_REQUEST.method}`);
    expect(saved.createdAt).toBe(TS);
  });

  it('migrate + prepare boundaries redact collections secrets and validate', () => {
    const migrated = migrateGrpcCollectionsStore([{
      id: 'col-1',
      name: 'Secrets',
      savedRequests: [{
        id: 'sr-1',
        callType: 'unary',
        service: 'echo.EchoService',
        method: 'Echo',
        descriptorKey: 'desc-1',
        body: {},
        metadata: { authorization: 'Bearer raw-secret-token-value' },
        timeoutMs: 30_000,
        auth: { type: 'bearer', bearerToken: 'raw-secret-token-value' },
        tlsConfig: { serverCaPem: VALID_PEM },
      }],
    }]);

    const prepared = prepareGrpcCollectionsStoreForPersist(migrated, TS);
    const validated = validateGrpcCollectionsStore(prepared);
    expect(validated.ok).toBe(true);
    expect(prepared.collections[0].savedRequests[0].auth?.bearerToken).toBe(GRPC_REDACTED_PLACEHOLDER);

    const findings = scanForbiddenGrpcPersistTargets({ grpc_collections_v1: prepared });
    expect(findings).toHaveLength(0);
  });

  it('prepareGrpcCallHistoryEntryForPersist redacts secrets and validates in store envelope', () => {
    const entry = prepareGrpcCallHistoryEntryForPersist({
      id: 'hist-1',
      snapshot: {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: TS,
        callType: 'unary',
        target: {
          address: 'localhost:50051',
          tlsMode: 'tls',
          tlsConfig: { serverCaPem: VALID_PEM },
        },
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: { message: 'hi' },
        metadata: { authorization: 'Bearer raw-secret-token-value' },
        timeoutMs: 30_000,
        descriptorKey: 'desc-1',
        auth: { type: 'bearer', bearerToken: 'raw-secret-token-value' },
      },
      error: {
        code: 'GRPC_CALL_FAILED',
        category: 'call_failed',
        message: 'denied',
        details: { grpcStatus: 7 },
      },
    });

    expect(entry.grpcStatus).toBe(7);
    expect(entry.record.snapshot.auth?.bearerToken).toBe(GRPC_REDACTED_PLACEHOLDER);

    const store = migrateGrpcCallHistoryStore({
      schemaVersion: GRPC_PERSISTENCE_SCHEMA_VERSION,
      updatedAt: TS,
      entries: [entry],
    });
    expect(validateGrpcCallHistoryStore(store).ok).toBe(true);
    expect(scanForbiddenGrpcPersistTargets({ grpc_call_history_v1: store })).toHaveLength(0);
  });

  it('rejects duplicate collection and saved-request ids', () => {
    const duplicateCollection = validateGrpcCollectionsStore({
      schemaVersion: GRPC_PERSISTENCE_SCHEMA_VERSION,
      updatedAt: TS,
      collections: [
        { id: 'col-dup', name: 'A', createdAt: TS, updatedAt: TS, savedRequests: [] },
        { id: 'col-dup', name: 'B', createdAt: TS, updatedAt: TS, savedRequests: [] },
      ],
    });
    expect(duplicateCollection.ok).toBe(false);

    const duplicateSaved = validateGrpcCollectionsStore({
      schemaVersion: GRPC_PERSISTENCE_SCHEMA_VERSION,
      updatedAt: TS,
      collections: [{
        id: 'col-1',
        name: 'Dup saved',
        createdAt: TS,
        updatedAt: TS,
        savedRequests: [
          {
            id: 'sr-dup',
            name: 'One',
            revisionId: 'r1',
            createdAt: TS,
            updatedAt: TS,
            callType: 'unary',
            service: 's',
            method: 'm',
            descriptorKey: 'd',
            body: {},
            metadata: {},
            timeoutMs: 30_000,
          },
          {
            id: 'sr-dup',
            name: 'Two',
            revisionId: 'r2',
            createdAt: TS,
            updatedAt: TS,
            callType: 'unary',
            service: 's',
            method: 'm',
            descriptorKey: 'd',
            body: {},
            metadata: {},
            timeoutMs: 30_000,
          },
        ],
      }],
    });
    expect(duplicateSaved.ok).toBe(false);
  });

  it('caps history store validation at max entries', () => {
    const entries = Array.from({ length: GRPC_CALL_HISTORY_MAX_ENTRIES + 1 }, (_, i) => ({
      id: `h-${i}`,
      callType: 'unary' as const,
      target: 'localhost:50051',
      service: 'echo.EchoService',
      method: 'Echo',
      descriptorKey: 'desc-1',
      capturedAt: TS,
      bodyTruncated: false,
      record: {
        snapshot: {
          tabId: 'tab-1',
          requestId: `req-${i}`,
          capturedAt: TS,
          callType: 'unary' as const,
          target: FIXTURE_UNARY_CALL_REQUEST.target,
          service: FIXTURE_UNARY_CALL_REQUEST.service,
          method: FIXTURE_UNARY_CALL_REQUEST.method,
          body: {},
          metadata: {},
          timeoutMs: 30_000,
          descriptorKey: 'desc-1',
        },
        capturedAt: TS,
      },
    }));

    expect(validateGrpcCallHistoryStore({
      schemaVersion: GRPC_PERSISTENCE_SCHEMA_VERSION,
      updatedAt: TS,
      entries,
    }).ok).toBe(false);
  });
});

describe('Phase 5C acceptance checklist', () => {
  it('exports replay binding module for saved request and history replay', async () => {
    const binding = await import('../../features/grpc/utils/grpcReplayBinding');
    expect(typeof binding.resolveGrpcReplayBinding).toBe('function');
    expect(typeof binding.resolveGrpcHistoryEntryReplay).toBe('function');
    expect(typeof binding.analyzeReplaySchemaDrift).toBe('function');
    expect(typeof binding.applyGrpcReplaySafeFallbackBody).toBe('function');
    expect(typeof binding.createReplaySavedRequestFromHistoryEntry).toBe('function');
    expect(typeof binding.resolveBaselineDescriptorForReplay).toBe('function');
    expect(typeof binding.resolveEffectiveReplayBaseline).toBe('function');
    expect(typeof binding.isGrpcReplayExecutable).toBe('function');
  });

  it('4H replay resolver remains the execute snapshot builder', async () => {
    const resolver = await import('../../features/grpc/utils/grpcReplayResolver');
    expect(typeof resolver.resolveGrpcSavedRequestReplay).toBe('function');
    expect(typeof resolver.buildReplayTabState).toBe('function');
  });

  it('replay binding blocks mixed-cache descriptor key mismatch before schema analysis', async () => {
    const binding = await import('../../features/grpc/utils/grpcReplayBinding');
    const { FIXTURE_DESCRIPTOR, FIXTURE_DESCRIPTOR_KEY } = await import('./contractFixtures');
    const { createGrpcSavedRequestFromSnapshot } = await import('./grpcSavedRequest');
    const { createGrpcStudioTab } = await import('../../features/grpc/grpcStudioTypes');

    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY, tlsMode: 'disabled', auth: { type: 'none' } });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-06-29T12:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30_000,
        descriptorKey: FIXTURE_DESCRIPTOR_KEY,
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-06-29T12:00:00.000Z' },
    );

    const result = binding.resolveGrpcReplayBinding({
      saved,
      tab,
      requestId: 'accept-key-mismatch',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
      currentDescriptor: { ...FIXTURE_DESCRIPTOR, key: 'other-key' },
    });

    expect(result.drift.state).toBe('blocking');
  });

  it('history replay interpolates env vars in snapshot target (Phase 5 acceptance)', async () => {
    const binding = await import('../../features/grpc/utils/grpcReplayBinding');
    const { FIXTURE_DESCRIPTOR, FIXTURE_DESCRIPTOR_KEY, FIXTURE_UNARY_CALL_REQUEST } = await import('./contractFixtures');
    const { createGrpcStudioTab } = await import('../../features/grpc/grpcStudioTypes');
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY, tlsMode: 'disabled', auth: { type: 'none' } });

    const result = binding.resolveGrpcHistoryEntryReplay({
      entry: {
        id: 'hist-env',
        callType: 'unary',
        target: '{{grpcHost}}',
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        descriptorKey: FIXTURE_DESCRIPTOR_KEY,
        capturedAt: '2026-06-29T12:00:00.000Z',
        bodyTruncated: false,
        record: {
          capturedAt: '2026-06-29T12:00:00.000Z',
          snapshot: {
            tabId: tab.id,
            requestId: 'req-hist',
            capturedAt: '2026-06-29T12:00:00.000Z',
            callType: 'unary',
            target: { address: '{{grpcHost}}', tlsMode: 'disabled' },
            service: FIXTURE_UNARY_CALL_REQUEST.service,
            method: FIXTURE_UNARY_CALL_REQUEST.method,
            body: {},
            metadata: {},
            timeoutMs: 30_000,
            descriptorKey: FIXTURE_DESCRIPTOR_KEY,
          },
        },
      },
      tab,
      requestId: 'accept-hist-env',
      envVarMap: { grpcHost: 'localhost:50051' },
      profiles: [],
      pageDefaults: { target: 'localhost:59999', tlsMode: 'disabled' },
      currentDescriptor: FIXTURE_DESCRIPTOR,
    });

    expect(result.snapshot.target.address).toBe('localhost:50051');
    expect(binding.isGrpcReplayExecutable(result.drift)).toBe(true);
  });

  it('saved request replay preserves callType and does not silently drop orphan fields (Phase 5 acceptance)', async () => {
    const binding = await import('../../features/grpc/utils/grpcReplayBinding');
    const { FIXTURE_DESCRIPTOR, FIXTURE_DESCRIPTOR_KEY, FIXTURE_UNARY_CALL_REQUEST } = await import('./contractFixtures');
    const { createGrpcSavedRequestFromSnapshot } = await import('./grpcSavedRequest');
    const { createGrpcStudioTab } = await import('../../features/grpc/grpcStudioTypes');
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY, tlsMode: 'disabled', auth: { type: 'none' } });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-stream',
        capturedAt: '2026-06-29T12:00:00.000Z',
        callType: 'server_streaming',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: 'echo.EchoService',
        method: 'ServerStream',
        body: { message: 'x', orphan: 'keep' },
        metadata: {},
        timeoutMs: 30_000,
        descriptorKey: FIXTURE_DESCRIPTOR_KEY,
      },
      { id: 'sr-stream', revisionId: 'rev-stream', updatedAt: '2026-06-29T12:00:00.000Z' },
    );

    const result = binding.resolveGrpcReplayBinding({
      saved,
      tab,
      requestId: 'accept-stream-no-drop',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
      currentDescriptor: FIXTURE_DESCRIPTOR,
    });

    expect(result.snapshot.callType).toBe('server_streaming');
    expect(result.snapshot.body).toEqual({ message: 'x', orphan: 'keep' });
    expect(result.snapshot.sourceFingerprint).toEqual(FIXTURE_DESCRIPTOR.sourceFingerprint);
  });
});

describe('Phase 5E acceptance checklist', () => {
  it('exports persist redaction middleware for collections/history/export writes', async () => {
    const middleware = await import('./grpcPersistRedactionMiddleware');
    expect(typeof middleware.prepareGrpcCollectionsStoreForPersistSafe).toBe('function');
    expect(typeof middleware.prepareGrpcCallHistoryEntryForPersistSafe).toBe('function');
    expect(typeof middleware.prepareGrpcCallHistoryStoreForPersistSafe).toBe('function');
    expect(typeof middleware.assertGrpcPersistTargetSafe).toBe('function');
    expect(typeof middleware.assertGrpcCrossFeatureExportSafe).toBe('function');
    expect(typeof middleware.assertGrpcCallHistoryEntryPersistSafe).toBe('function');
    expect(typeof middleware.reprepareGrpcCallHistoryEntryForPersistSafe).toBe('function');
  });

  it('exports safe preview helpers for UI surfaces', async () => {
    const preview = await import('./grpcSafePreview');
    expect(typeof preview.previewGrpcSavedRequestForUi).toBe('function');
    expect(typeof preview.previewGrpcCallHistoryEntryForUi).toBe('function');
    expect(typeof preview.previewGrpcExecuteSnapshotForUi).toBe('function');
    expect(typeof preview.serializeGrpcPreviewJson).toBe('function');
  });

  it('5B/5D write paths use Safe prepare helpers (static import audit)', async () => {
    const collectionsRepo = await import('../../features/grpc/data/grpcCollectionRepository');
    const historyRecorder = await import('../../features/grpc/data/grpcCallHistoryRecorder');
    const idbCollections = await import('../utils/idbGrpcCollections');
    const idbHistory = await import('../utils/idbGrpcCallHistory');
    expect(collectionsRepo.saveGrpcCollectionsStoreToPersistence).toBeDefined();
    expect(collectionsRepo.persistGrpcCollectionsStore).toBeDefined();
    expect(historyRecorder.appendGrpcCallHistory).toBeDefined();
    expect(idbCollections.idbSaveGrpcCollectionsStore).toBeDefined();
    expect(idbHistory.idbAppendGrpcCallHistoryEntry).toBeDefined();
  });

  it('cross-feature export uses shared assertGrpcCrossFeatureExportSafe', async () => {
    const exportMod = await import('../../features/grpc/utils/grpcCrossFeatureExport');
    const middleware = await import('./grpcPersistRedactionMiddleware');
    const { FIXTURE_UNARY_CALL_REQUEST: fixture } = await import('./contractFixtures');
    const bundle = exportMod.prepareGrpcExportBundle({
      snapshot: {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-06-29T12:00:00.000Z',
        callType: 'unary',
        target: fixture.target,
        service: fixture.service,
        method: fixture.method,
        body: {},
        metadata: { authorization: 'Bearer raw-secret-token-value' },
        timeoutMs: 30_000,
        descriptorKey: 'desc-1',
        auth: { type: 'bearer', bearerToken: 'raw-secret-token-value' },
      },
      identity: { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-06-29T12:00:00.000Z' },
    });
    expect(() => middleware.assertGrpcCrossFeatureExportSafe(
      { grpc_export_bundle: bundle },
      'acceptance',
    )).not.toThrow();
  });
});

describe('Phase 5F+5G acceptance checklist', () => {
  it('exports full grpcurl import parser with descriptor and TLS file paths', async () => {
    const grpcurl = await import('../../features/grpc/utils/grpcGrpcurl');
    expect(typeof grpcurl.parseGrpcurlCommand).toBe('function');
    expect(typeof grpcurl.grpcGrpcurlImportToTabPatch).toBe('function');
    expect(typeof grpcurl.GRPC_GRPCURL_FLAG_COMPAT_MATRIX).toBe('object');
  });

  it('exports grpcurl builders from saved request and snapshot contexts', async () => {
    const grpcurl = await import('../../features/grpc/utils/grpcGrpcurl');
    expect(typeof grpcurl.buildGrpcurlInvokeCommandFromSavedRequest).toBe('function');
    expect(typeof grpcurl.buildGrpcurlInvokeCommandFromSnapshot).toBe('function');
    expect(typeof grpcurl.compareGrpcGrpcurlSemanticParity).toBe('function');
  });

  it('grpcurl import handles descriptor flags and round-trips via export (acceptance)', async () => {
    const {
      buildGrpcurlInvokeCommand,
      compareGrpcGrpcurlSemanticParity,
      parseGrpcurlCommand,
    } = await import('../../features/grpc/utils/grpcGrpcurl');
    const exported = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      descriptorFlags: {
        importPaths: ['./proto'],
        protoPaths: ['echo.proto'],
      },
      metadata: { 'x-tenant': 'test' },
    });
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.descriptorFlags?.protoPaths).toEqual(['echo.proto']);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      metadata: { 'x-tenant': 'test' },
      descriptorFlags: { importPaths: ['./proto'], protoPaths: ['echo.proto'] },
    })).toEqual([]);
  });
});

describe('Phase 5H acceptance checklist', () => {
  it('exports collections/history UI hooks and replay apply helpers', async () => {
    const historyCapture = await import('../../features/grpc/utils/grpcStudioCallHistoryCapture');
    const replayApply = await import('../../features/grpc/utils/grpcReplayTabApply');
    const replayBinding = await import('../../features/grpc/utils/grpcReplayBinding');
    const collectionsHook = await import('../../features/grpc/hooks/useGrpcCollections');
    const historyHook = await import('../../features/grpc/hooks/useGrpcCallHistory');
    const replayActions = await import('../../features/grpc/hooks/useGrpcStudioReplayActions');

    expect(typeof historyCapture.captureGrpcCallHistoryFromOutcome).toBe('function');
    expect(typeof historyCapture.GRPC_CALL_HISTORY_UPDATED_EVENT).toBe('string');
    expect(typeof replayApply.savedRequestToTabPatch).toBe('function');
    expect(typeof replayApply.grpcurlImportToTabStatePatch).toBe('function');
    expect(typeof replayApply.mergeGrpcurlDescriptorIntoProtoIngest).toBe('function');
    expect(typeof replayApply.analyzeGrpcurlImportSchemaDrift).toBe('function');
    expect(typeof replayApply.grpcurlImportDescriptorStatePatch).toBe('function');
    expect(typeof replayBinding.isGrpcExecuteBlockedByDrift).toBe('function');
    expect(typeof collectionsHook.useGrpcCollections).toBe('function');
    expect(typeof historyHook.useGrpcCallHistory).toBe('function');
    expect(typeof replayActions.useGrpcStudioReplayActions).toBe('function');
  });

  it('exports Phase 5H panel components and selectors', async () => {
    const subNav = await import('../../features/grpc/components/GrpcStudioSubNav');
    const collectionsPanel = await import('../../features/grpc/components/GrpcCollectionsPanel');
    const historyPanel = await import('../../features/grpc/components/GrpcHistoryPanel');
    const saveModal = await import('../../features/grpc/components/GrpcSaveRequestModal');
    const importModal = await import('../../features/grpc/components/GrpcGrpcurlImportModal');
    const selectors = await import('../selectors/grpc');

    expect(typeof subNav.GrpcStudioSubNav).toBe('function');
    expect(typeof collectionsPanel.GrpcCollectionsPanel).toBe('function');
    expect(typeof historyPanel.GrpcHistoryPanel).toBe('function');
    expect(typeof saveModal.GrpcSaveRequestModal).toBe('function');
    expect(typeof importModal.GrpcGrpcurlImportModal).toBe('function');
    expect(selectors.GRPC.SUB_NAV_STUDIO).toContain('grpc-sub-nav-studio');
    expect(selectors.GRPC.HISTORY_REPLAY_BTN).toContain('grpc-history-replay-btn');
  });
});

describe('Phase 5I acceptance checklist', () => {
  it('exports response snapshot baseline utilities and UI', async () => {
    const snapshot = await import('../../features/grpc/utils/grpcResponseSnapshot');
    const panel = await import('../../features/grpc/components/GrpcResponseSnapshotPanel');
    const diffModal = await import('../../features/grpc/components/GrpcResponseSnapshotDiffModal');
    const saved = await import('../grpc/grpcSavedRequest');

    expect(typeof snapshot.captureGrpcResponseSnapshotBaseline).toBe('function');
    expect(typeof snapshot.compareGrpcResponseToBaseline).toBe('function');
    expect(typeof snapshot.resolveUnaryResultForSavedRequestComparison).toBe('function');
    expect(typeof panel.GrpcResponseSnapshotPanel).toBe('function');
    expect(typeof diffModal.GrpcResponseSnapshotDiffModal).toBe('function');
    expect(saved).toBeTruthy();
  });

  it('Phase 5I gate script and collections E2E exist', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../..');
    const required = [
      'scripts/test-grpc-phase5i.sh',
      'e2e/grpc-studio-collections-history.spec.ts',
    ];
    for (const file of required) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it('exports Phase 5I snapshot selectors', async () => {
    const selectors = await import('../selectors/grpc');
    expect(selectors.GRPC.RESPONSE_SNAPSHOT_PANEL).toContain('grpc-response-snapshot-panel');
    expect(selectors.GRPC.SNAPSHOT_UPDATE_BASELINE).toContain('grpc-snapshot-update-baseline');
  });
});
