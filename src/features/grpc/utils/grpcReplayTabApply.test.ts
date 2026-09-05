/**
 * Phase 5H — replay tab patch helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_DESCRIPTOR,
  FIXTURE_DESCRIPTOR_KEY,
  FIXTURE_UNARY_CALL_REQUEST,
} from '@shared/grpc/contractFixtures';
import { createGrpcSavedRequestFromSnapshot } from '@shared/grpc/grpcSavedRequest';
import { createGrpcStudioTab, createEmptyTabDescriptorState } from '../grpcStudioTypes';
import {
  analyzeGrpcurlImportSchemaDrift,
  buildDriftDescriptorPatchFromAnalysis,
  grpcurlImportDescriptorStatePatch,
  grpcurlImportToTabStatePatch,
  mergeGrpcurlDescriptorIntoProtoIngest,
  savedRequestToTabPatch,
  shouldAutoReflectAfterGrpcurlImport,
} from './grpcReplayTabApply';
import { buildDescriptorMissingDrift } from './grpcReplayBinding';

const TS = '2026-06-29T12:00:00.000Z';

function makeSavedRequest() {
  const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY });
  return createGrpcSavedRequestFromSnapshot(
    {
      tabId: tab.id,
      requestId: 'req-1',
      capturedAt: TS,
      callType: 'unary',
      target: FIXTURE_UNARY_CALL_REQUEST.target,
      service: FIXTURE_UNARY_CALL_REQUEST.service,
      method: FIXTURE_UNARY_CALL_REQUEST.method,
      body: { message: 'saved-body' },
      metadata: { 'x-tenant': 'test' },
      timeoutMs: 30_000,
      descriptorKey: FIXTURE_DESCRIPTOR_KEY,
    },
    { id: 'sr-1', revisionId: 'rev-1', updatedAt: TS, name: 'Echo saved' },
  );
}

describe('grpcReplayTabApply (Phase 5H)', () => {
  it('savedRequestToTabPatch clears execute state and applies replay fields', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: FIXTURE_DESCRIPTOR_KEY,
      service: 'other.Service',
      method: 'Other',
      lifecycle: 'success',
      lastResult: { grpcStatus: 0, durationMs: 1, metadata: {}, body: {} },
    });
    const saved = makeSavedRequest();
    const patch = savedRequestToTabPatch(tab, saved);

    expect(patch.service).toBe(saved.service);
    expect(patch.method).toBe(saved.method);
    expect(patch.body).toEqual({ message: 'saved-body' });
    expect(patch.metadata).toEqual({ 'x-tenant': 'test' });
    expect(patch.lifecycle).toBe('idle');
    expect(patch.lastResult).toBeUndefined();
    expect(patch.lastExecuteSnapshot).toBeUndefined();
  });

  it('savedRequestToTabPatch honors bodyOverride', () => {
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY });
    const saved = makeSavedRequest();
    const patch = savedRequestToTabPatch(tab, saved, { message: 'override' });
    expect(patch.body).toEqual({ message: 'override' });
  });

  it('buildDriftDescriptorPatchFromAnalysis clears drift when none', () => {
    expect(buildDriftDescriptorPatchFromAnalysis(
      { state: 'none', message: '', issues: [], suggestedRebinds: [] },
      FIXTURE_DESCRIPTOR,
      FIXTURE_UNARY_CALL_REQUEST.service,
      FIXTURE_UNARY_CALL_REQUEST.method,
    )).toEqual({
      driftState: 'none',
      driftMessage: undefined,
      driftIssues: undefined,
      suggestedRebinds: undefined,
      driftStaleMethod: undefined,
      driftBaselineRequestSchema: undefined,
    });
  });

  it('buildDriftDescriptorPatchFromAnalysis captures blocking stale method', () => {
    const descriptorState = createEmptyTabDescriptorState();
    descriptorState.descriptor = FIXTURE_DESCRIPTOR;
    const patch = buildDriftDescriptorPatchFromAnalysis(
      {
        state: 'blocking',
        message: 'Method removed',
        issues: [{ kind: 'method_missing', message: 'Method Echo was removed' }],
        suggestedRebinds: [],
      },
      FIXTURE_DESCRIPTOR,
      FIXTURE_UNARY_CALL_REQUEST.service,
      FIXTURE_UNARY_CALL_REQUEST.method,
    );
    expect(patch.driftState).toBe('blocking');
    expect(patch.driftStaleMethod?.name).toBe('Echo');
  });

  it('savedRequestToTabPatch clears grpcurl export hints from prior import', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: FIXTURE_DESCRIPTOR_KEY,
      grpcurlExportContext: {
        tlsFilePaths: { caCertPath: './ca.pem' },
        descriptorFlags: { importPaths: ['./proto'], protoPaths: [] },
      },
    });
    const patch = savedRequestToTabPatch(tab, makeSavedRequest());
    expect(patch.grpcurlExportContext).toBeUndefined();
  });

  it('grpcurlImportToTabStatePatch preserves descriptorKey and applies import fields', () => {
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY, lifecycle: 'error' });
    const patch = grpcurlImportToTabStatePatch(tab, {
      ok: true,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'plaintext',
      metadata: { 'x-test': '1' },
      body: { message: 'from-grpcurl' },
      warnings: [],
      unsupportedFlags: [],
    });

    expect(patch.descriptorKey).toBe(FIXTURE_DESCRIPTOR_KEY);
    expect(patch.service).toBe('echo.EchoService');
    expect(patch.method).toBe('Echo');
    expect(patch.body).toEqual({ message: 'from-grpcurl' });
    expect(patch.lifecycle).toBe('idle');
    expect(patch.requestMode).toBe('form');
  });

  it('analyzeGrpcurlImportSchemaDrift flags orphan fields on import body', () => {
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY });
    const descriptorState = createEmptyTabDescriptorState();
    descriptorState.descriptor = FIXTURE_DESCRIPTOR;
    const drift = analyzeGrpcurlImportSchemaDrift(tab, descriptorState, {
      ok: true,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'plaintext',
      metadata: {},
      body: { message: 'hello', staleField: 'x' },
      warnings: [],
      unsupportedFlags: [],
    });
    expect(drift.state).toBe('warning');
  });

  it('analyzeGrpcurlImportSchemaDrift blocks when no descriptor is loaded', () => {
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY });
    const drift = analyzeGrpcurlImportSchemaDrift(tab, createEmptyTabDescriptorState(), {
      ok: true,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'plaintext',
      metadata: {},
      body: { message: 'hello' },
      warnings: [],
      unsupportedFlags: [],
    });
    expect(drift.state).toBe('blocking');
  });

  it('savedRequestToTabPatch resets requestMode to form', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: FIXTURE_DESCRIPTOR_KEY,
      requestMode: 'json',
    });
    const patch = savedRequestToTabPatch(tab, makeSavedRequest());
    expect(patch.requestMode).toBe('form');
  });

  it('grpcurlImportToTabStatePatch preserves tls and descriptor import hints', () => {
    const tab = createGrpcStudioTab({ descriptorKey: FIXTURE_DESCRIPTOR_KEY });
    const patch = grpcurlImportToTabStatePatch(tab, {
      ok: true,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      tlsFilePaths: { caCertPath: './ca.pem' },
      descriptorFlags: {
        importPaths: ['./proto'],
        protoPaths: ['echo/echo.proto'],
      },
      metadata: {},
      body: {},
      warnings: [],
      unsupportedFlags: [],
    });

    expect(patch.grpcurlExportContext).toEqual({
      tlsFilePaths: { caCertPath: './ca.pem' },
      descriptorFlags: {
        importPaths: ['./proto'],
        protoPaths: ['echo/echo.proto'],
      },
    });
  });

  it('mergeGrpcurlDescriptorIntoProtoIngest maps proto paths into tab proto ingest draft', () => {
    const merged = mergeGrpcurlDescriptorIntoProtoIngest(undefined, {
      importPaths: ['./proto'],
      protoPaths: ['echo/echo.proto'],
    });
    expect(merged?.source).toBe('proto_files');
    expect(merged?.importPaths).toEqual(['./proto']);
    expect(merged?.protoRoots).toEqual([
      {
        id: 'root-default',
        mountPath: 'root',
        files: [{ path: 'echo/echo.proto', content: '' }],
      },
    ]);
  });

  it('grpcurlImportDescriptorStatePatch updates proto ingest from import flags', () => {
    const descriptorState = createEmptyTabDescriptorState();
    const patch = grpcurlImportDescriptorStatePatch(descriptorState, {
      ok: true,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'plaintext',
      descriptorFlags: {
        protosetPath: './echo.protoset',
        importPaths: ['./proto'],
        protoPaths: [],
      },
      metadata: {},
      body: {},
      warnings: [],
      unsupportedFlags: [],
    });
    expect(patch?.protoIngest?.source).toBe('protoset');
    expect(patch?.protoIngest?.protosetFileName).toBe('echo.protoset');
    expect(patch?.protoIngest?.importPaths).toEqual(['./proto']);
  });

  it('shouldAutoReflectAfterGrpcurlImport is true for descriptor-missing plain imports', () => {
    const importResult = {
      ok: true as const,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'plaintext' as const,
      metadata: {},
      body: { message: 'hello' },
      warnings: [],
      unsupportedFlags: [],
    };
    const drift = buildDescriptorMissingDrift('echo.EchoService', 'Echo');
    expect(shouldAutoReflectAfterGrpcurlImport(drift, importResult)).toBe(true);
  });

  it('shouldAutoReflectAfterGrpcurlImport is false when import carries proto flags', () => {
    const importResult = {
      ok: true as const,
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'plaintext' as const,
      descriptorFlags: { protoPaths: ['echo.proto'], importPaths: ['./proto'] },
      metadata: {},
      body: { message: 'hello' },
      warnings: [],
      unsupportedFlags: [],
    };
    const drift = buildDescriptorMissingDrift('echo.EchoService', 'Echo');
    expect(shouldAutoReflectAfterGrpcurlImport(drift, importResult)).toBe(false);
  });
});
