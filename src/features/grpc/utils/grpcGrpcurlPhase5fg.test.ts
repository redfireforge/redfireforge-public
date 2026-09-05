/**
 * Phase 5F + 5G — grpcurl import/export parity and golden command tests.
 */
import { describe, expect, it } from 'vitest';
import { createGrpcSavedRequestFromSnapshot } from '@shared/grpc/grpcSavedRequest';
import { FIXTURE_UNARY_CALL_REQUEST } from '@shared/grpc/contractFixtures';
import {
  GRPC_GRPCURL_FLAG_COMPAT_MATRIX,
  buildGrpcurlInvokeCommand,
  buildGrpcurlInvokeCommandFromSavedRequest,
  buildGrpcurlInvokeCommandFromSnapshot,
  compareGrpcGrpcurlSemanticParity,
  grpcGrpcurlImportToTabPatch,
  parseGrpcurlCommand,
} from './grpcGrpcurl';

describe('Phase 5F — grpcurl import parser', () => {
  it('imports descriptor flags (-proto, -protoset, -import-path)', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -import-path ./proto -proto echo/echo.proto -protoset ./echo.protoset localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.descriptorFlags?.importPaths).toEqual(['./proto']);
    expect(parsed.descriptorFlags?.protoPaths).toEqual(['echo/echo.proto']);
    expect(parsed.descriptorFlags?.protosetPath).toBe('./echo.protoset');
    expect(parsed.warnings.some((w) => w.includes('Descriptor flags'))).toBe(true);
  });

  it('imports TLS file paths and infers mtls mode', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -cacert ./ca.pem -cert ./client.pem -key ./client.key localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.tlsMode).toBe('mtls');
    expect(parsed.tlsFilePaths).toEqual({
      caCertPath: './ca.pem',
      certPath: './client.pem',
      keyPath: './client.key',
    });
  });

  it('imports repeated -H headers including -bin base64 values', () => {
    const payload = Buffer.from('hello-bin').toString('base64');
    const parsed = parseGrpcurlCommand(
      `grpcurl -H 'x-tenant: test' -H 'payload-bin: ${payload}' localhost:50051 echo.EchoService/Echo`,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.metadata['x-tenant']).toBe('test');
    expect(parsed.metadata['payload-bin']).toBe(payload);
  });

  it('rejects -d @ file body references', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -d @ localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/file references/i);
  });

  it('reports -insecure as unsupported with guidance', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -insecure localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.unsupportedFlags).toContain('-insecure');
    expect(parsed.warnings.some((w) => w.includes('insecure'))).toBe(true);
  });

  it('normalizes import to tab patch with descriptor and tls hints', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -authority grpc.internal -cacert ca.pem localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const patch = grpcGrpcurlImportToTabPatch(parsed);
    expect(patch.tlsConfig?.serverNameOverride).toBe('grpc.internal');
    expect(patch.tlsFilePaths?.caCertPath).toBe('ca.pem');
    expect(patch.tlsMode).toBe('tls');
  });

  it('parses multi-line shell continuations and IPv6 targets', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl \\\n  -plaintext \\\n  [::1]:50051 \\\n  echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.targetAddress).toBe('[::1]:50051');
    expect(parsed.tlsMode).toBe('disabled');
  });

  it('warns on duplicate -H headers and incomplete mTLS cert/key pairs', () => {
    const dup = parseGrpcurlCommand(
      'grpcurl -H "x-trace: 1" -H "x-trace: 2" localhost:50051 echo.EchoService/Echo',
    );
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    expect(dup.metadata['x-trace']).toBe('2');
    expect(dup.warnings.some((w) => w.includes('Duplicate -H'))).toBe(true);

    const partial = parseGrpcurlCommand(
      'grpcurl -cert ./client.pem localhost:50051 echo.EchoService/Echo',
    );
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.tlsMode).toBe('tls');
    expect(partial.warnings.some((w) => w.includes('mTLS'))).toBe(true);
  });

  it('round-trips import paths containing spaces', () => {
    const exported = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      descriptorFlags: { importPaths: ['./my proto'], protoPaths: [] },
    });
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.descriptorFlags?.importPaths).toEqual(['./my proto']);
  });

  it('parses -format json before -d and header values containing colons', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -format json -d \'{"message":"hi"}\' -H "x-custom: part: two" localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.body).toEqual({ message: 'hi' });
    expect(parsed.metadata['x-custom']).toBe('part: two');
  });

  it('normalizes mixed-case metadata keys on export for round-trip', () => {
    const exported = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
      metadata: { 'X-Tenant': 'test' },
    });
    expect(exported).toContain('x-tenant: test');
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.metadata['x-tenant']).toBe('test');
  });
});

describe('Phase 5G — grpcurl export builder', () => {
  it('exports descriptor and TLS file path flags in deterministic order', () => {
    const command = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'mtls',
      tlsFilePaths: {
        caCertPath: './ca.pem',
        certPath: './client.pem',
        keyPath: './client.key',
      },
      descriptorFlags: {
        importPaths: ['./proto'],
        protoPaths: ['echo/echo.proto'],
        protosetPath: './bundle.protoset',
      },
      metadata: { 'x-tenant': 'test' },
      body: { message: 'hi' },
    });
    expect(command).toMatch(/^grpcurl -import-path \.\/proto -proto echo\/echo\.proto -protoset \.\/bundle\.protoset -cacert \.\/ca\.pem -cert \.\/client\.pem -key \.\/client\.key/);
    expect(command).not.toContain('-plaintext');
    expect(command).toContain('-H');
    expect(command).toContain('-d');
    expect(command).toContain('echo.EchoService/Echo');
  });

  it('builds from saved request without embedding redacted secrets', () => {
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-06-29T12:00:00.000Z',
        callType: 'unary',
        target: { ...FIXTURE_UNARY_CALL_REQUEST.target, tlsMode: 'tls' },
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: { message: 'hello' },
        metadata: {
          authorization: 'Bearer raw-secret-token-value',
          'x-tenant': 'test',
        },
        timeoutMs: 30_000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-06-29T12:00:00.000Z' },
    );
    const command = buildGrpcurlInvokeCommandFromSavedRequest(saved, {
      descriptorFlags: { importPaths: ['./proto'], protoPaths: ['echo.proto'] },
      tlsFilePaths: { caCertPath: './ca.pem' },
    });
    expect(command).not.toContain('raw-secret');
    expect(command).toContain('x-tenant');
    expect(command).toContain('-import-path');
    expect(command).toContain('-cacert ./ca.pem');
  });

  it('builds from execute snapshot with env template target', () => {
    const snapshot = {
      tabId: 'tab-1',
      requestId: 'req-1',
      capturedAt: '2026-06-29T12:00:00.000Z',
      callType: 'unary' as const,
      target: { address: '{{grpcHost}}', tlsMode: 'disabled' as const },
      service: 'echo.EchoService',
      method: 'Echo',
      body: {},
      metadata: {},
      timeoutMs: 30_000,
      descriptorKey: 'desc-1',
    };
    const command = buildGrpcurlInvokeCommandFromSnapshot(snapshot);
    expect(command).toContain('-plaintext');
    expect(command).toContain('{{grpcHost}}');
  });

  it('documents option compatibility matrix entries', () => {
    expect(GRPC_GRPCURL_FLAG_COMPAT_MATRIX.length).toBeGreaterThanOrEqual(10);
    expect(GRPC_GRPCURL_FLAG_COMPAT_MATRIX.some((row) => row.flag === '-proto')).toBe(true);
    expect(GRPC_GRPCURL_FLAG_COMPAT_MATRIX.some((row) => row.flag === '-cacert')).toBe(true);
  });

  it('emits mTLS cert flags when export context supplies cert+key even if tlsMode is tls', () => {
    const command = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      tlsFilePaths: { certPath: './client.pem', keyPath: './client.key' },
    });
    expect(command).toContain('-cert ./client.pem');
    expect(command).toContain('-key ./client.key');
    expect(command).not.toContain('-plaintext');
  });
});

describe('Phase 5F+5G — import → export → import parity', () => {
  const GOLDEN_CONTEXT = {
    targetAddress: 'localhost:50051',
    serviceFullName: 'echo.EchoService',
    methodName: 'Echo',
    tlsMode: 'mtls' as const,
    body: { message: 'parity' },
    metadata: { 'x-tenant': 'test', 'payload-bin': Buffer.from('bin').toString('base64') },
    serverNameOverride: 'grpc.internal.example.com',
    tlsFilePaths: {
      caCertPath: './ca.pem',
      certPath: './client.pem',
      keyPath: './client.key',
    },
    descriptorFlags: {
      importPaths: ['./proto'],
      protoPaths: ['echo/echo.proto'],
      protosetPath: './bundle.protoset',
    },
  };

  it('round-trips full flag set without semantic drift', () => {
    const exported = buildGrpcurlInvokeCommand(GOLDEN_CONTEXT);
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mismatches = compareGrpcGrpcurlSemanticParity(parsed, GOLDEN_CONTEXT);
    expect(mismatches).toEqual([]);
  });

  it('round-trips descriptor paths regardless of export sort order', () => {
    const ctx = {
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls' as const,
      descriptorFlags: {
        importPaths: ['./b', './a'],
        protoPaths: ['z.proto', 'a.proto'],
      },
    };
    const exported = buildGrpcurlInvokeCommand(ctx);
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.descriptorFlags?.protoPaths).toEqual(['a.proto', 'z.proto']);
    expect(parsed.descriptorFlags?.importPaths).toEqual(['./a', './b']);
    expect(compareGrpcGrpcurlSemanticParity(parsed, ctx)).toEqual([]);
  });

  it('round-trips plaintext unary invoke (Phase 4H regression)', () => {
    const exported = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
      body: { message: 'hello' },
      metadata: { 'x-request-id': 'abc' },
    });
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.targetAddress).toBe('localhost:50051');
    expect(parsed.body).toEqual({ message: 'hello' });
    expect(parsed.metadata['x-request-id']).toBe('abc');
  });
});
