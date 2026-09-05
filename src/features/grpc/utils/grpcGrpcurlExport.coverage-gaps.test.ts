/**
 * Phase 5G — coverage gaps for grpcGrpcurlExport.
 */
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_UNARY_CALL_REQUEST } from '@shared/grpc/contractFixtures';
import { createGrpcSavedRequestFromSnapshot } from '@shared/grpc/grpcSavedRequest';
import * as grpcAuthPolicy from '@shared/grpc/grpcAuthPolicy';
import {
  buildGrpcurlInvokeCommandFromSavedRequest,
  buildGrpcurlInvokeCommandFromSnapshot,
  compareGrpcGrpcurlSemanticParity,
  resolveGrpcurlExportContextForTabRequest,
} from './grpcGrpcurlExport';
import { parseGrpcurlCommand } from './grpcGrpcurlCore';

describe('grpcGrpcurlExport coverage gaps', () => {
  it('compareGrpcGrpcurlSemanticParity reports field mismatches', () => {
    const parsed = parseGrpcurlCommand('grpcurl -plaintext localhost:59999 echo.EchoService/Echo');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mismatches = compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
    });
    expect(mismatches.some((m) => m.includes('targetAddress'))).toBe(true);
  });

  it('compareGrpcGrpcurlSemanticParity detects service, method, tls, and body drift', () => {
    const parsed = parseGrpcurlCommand('grpcurl localhost:50051 echo.EchoService/Echo');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'other.Service',
      methodName: 'Echo',
      tlsMode: 'tls',
    }).some((m) => m.includes('serviceFullName'))).toBe(true);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Other',
      tlsMode: 'tls',
    }).some((m) => m.includes('methodName'))).toBe(true);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
    }).some((m) => m.includes('tlsMode'))).toBe(true);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      body: { message: 'x' },
    }).some((m) => m.includes('body'))).toBe(true);
  });

  it('compareGrpcGrpcurlSemanticParity normalizes mixed-case expected metadata keys', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -H "x-tenant: test" localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      metadata: { 'X-Tenant': 'test' },
    })).toEqual([]);
  });

  it('compareGrpcGrpcurlSemanticParity detects metadata and descriptor drift', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -proto a.proto -import-path ./p localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      metadata: { 'x-tenant': 'missing' },
    }).some((m) => m.includes('metadata'))).toBe(true);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      descriptorFlags: { protoPaths: ['b.proto'], importPaths: [] },
    }).some((m) => m.includes('protoPaths'))).toBe(true);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      descriptorFlags: { protoPaths: ['a.proto'], importPaths: ['./other'] },
    }).some((m) => m.includes('importPaths'))).toBe(true);
  });

  it('compareGrpcGrpcurlSemanticParity detects tls file path and authority drift', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -authority grpc.internal -cacert ca.pem localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      serverNameOverride: 'other.internal',
    }).some((m) => m.includes('serverNameOverride'))).toBe(true);
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      tlsFilePaths: { caCertPath: './other.pem' },
    }).some((m) => m.includes('caCertPath'))).toBe(true);
  });

  it('compareGrpcGrpcurlSemanticParity detects protoset path drift', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -protoset baseline.protoset localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(compareGrpcGrpcurlSemanticParity(parsed, {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      descriptorFlags: { protosetPath: 'other.protoset', protoPaths: undefined, importPaths: undefined },
    }).some((m) => m.includes('protosetPath'))).toBe(true);
  });

  it('buildGrpcurlInvokeCommandFromSavedRequest uses template target when saved target missing', () => {
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-06-29T12:00:00.000Z',
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: {},
        metadata: {},
        timeoutMs: 30_000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-06-29T12:00:00.000Z' },
    );
    saved.target = undefined;
    const command = buildGrpcurlInvokeCommandFromSavedRequest(saved);
    expect(command).toContain('{{grpcHost}}');
  });

  it('buildGrpcurlInvokeCommandFromSavedRequest falls back tlsMode to disabled', () => {
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-06-29T12:00:00.000Z',
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: {},
        metadata: {},
        timeoutMs: 30_000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-06-29T12:00:00.000Z' },
    );
    saved.tlsMode = undefined;
    const command = buildGrpcurlInvokeCommandFromSavedRequest(saved);
    expect(command).toContain('-plaintext');
  });

  it('buildGrpcurlInvokeCommandFromSnapshot exports snapshot fields', () => {
    const command = buildGrpcurlInvokeCommandFromSnapshot({
      tabId: 'tab-1',
      requestId: 'req-1',
      capturedAt: '2026-06-29T12:00:00.000Z',
      callType: 'unary',
      target: {
        address: 'localhost:50051',
        tlsMode: 'tls',
        tlsConfig: { serverNameOverride: 'grpc.internal' },
      },
      service: 'echo.EchoService',
      method: 'Echo',
      body: { message: 'snap' },
      metadata: { 'x-trace': '1' },
      timeoutMs: 30_000,
      descriptorKey: 'desc-1',
    });
    expect(command).toContain('-authority grpc.internal');
    expect(command).not.toContain('-plaintext');
    expect(command).toContain('x-trace');
  });

  it('buildGrpcurlInvokeCommandFromSnapshot falls back to snapshot metadata when auth policy throws', () => {
    const spy = vi.spyOn(grpcAuthPolicy, 'prepareGrpcExecuteRequestMetadata').mockImplementationOnce(() => {
      throw new Error('forced prepare failure');
    });
    const command = buildGrpcurlInvokeCommandFromSnapshot({
      tabId: 'tab-1',
      requestId: 'req-1',
      capturedAt: '2026-06-29T12:00:00.000Z',
      callType: 'unary',
      target: {
        address: 'localhost:50051',
      },
      service: 'echo.EchoService',
      method: 'Echo',
      body: { message: 'snap' },
      metadata: { 'x-trace': '1' },
      timeoutMs: 30_000,
      descriptorKey: 'desc-1',
    });
    expect(command).toContain('x-trace: 1');
    spy.mockRestore();
  });

  it('buildGrpcurlInvokeCommandFromSnapshot includes real auth metadata and keeps redacted keys as hints', () => {
    const command = buildGrpcurlInvokeCommandFromSnapshot({
      tabId: 'tab-1',
      requestId: 'req-1',
      capturedAt: '2026-06-29T12:00:00.000Z',
      callType: 'unary',
      target: {
        address: 'localhost:50051',
        tlsMode: 'disabled',
      },
      service: 'echo.EchoService',
      method: 'Echo',
      body: { message: 'snap' },
      metadata: { 'x-trace': '1' },
      auth: { type: 'api_key', apiKeyName: 'x-api-key', apiKeyValue: 'secret-live' },
      timeoutMs: 30_000,
      descriptorKey: 'desc-1',
    });
    expect(command).toContain('-plaintext');
    expect(command).toContain('x-api-key: secret-live');
    expect(command).toContain('x-trace: 1');

    const redactedCommand = buildGrpcurlInvokeCommandFromSnapshot({
      tabId: 'tab-1',
      requestId: 'req-2',
      capturedAt: '2026-06-29T12:00:00.000Z',
      callType: 'unary',
      target: {
        address: 'localhost:50051',
        tlsMode: 'disabled',
      },
      service: 'echo.EchoService',
      method: 'Echo',
      body: { message: 'snap' },
      metadata: { 'x-trace': '1' },
      auth: { type: 'api_key', apiKeyName: 'x-api-key', apiKeyValue: '[REDACTED]' },
      timeoutMs: 30_000,
      descriptorKey: 'desc-1',
    });
    expect(redactedCommand).not.toContain('x-api-key: [REDACTED]');
    expect(redactedCommand).toContain('x-api-key: <SET_X_API_KEY>');
    expect(redactedCommand).toContain('x-trace: 1');
  });

  it('resolveGrpcurlExportContextForTabRequest matches active tab service/method only', () => {
    const context = {
      tlsFilePaths: { caCertPath: './ca.pem' },
      descriptorFlags: { importPaths: ['./proto'], protoPaths: [] },
    };
    expect(resolveGrpcurlExportContextForTabRequest(
      { service: 'echo.EchoService', method: 'Echo', grpcurlExportContext: context },
      'echo.EchoService',
      'Echo',
    )).toEqual(context);
    expect(resolveGrpcurlExportContextForTabRequest(
      { service: 'echo.EchoService', method: 'Echo', grpcurlExportContext: context },
      'echo.EchoService',
      'ServerStream',
    )).toBeUndefined();
  });
});
