/**
 * Phase 4H — grpcurl import/export parity tests.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGrpcurlInvokeCommand,
  grpcGrpcurlImportToTabPatch,
  parseGrpcurlCommand,
  tokenizeGrpcurlCommand,
} from './grpcGrpcurl';

describe('grpcGrpcurl import v1 (Phase 4H)', () => {
  it('tokenizeGrpcurlCommand respects single quotes', () => {
    expect(tokenizeGrpcurlCommand(`grpcurl -d '{"message":"hi"}' localhost:50051 svc/Method`))
      .toEqual(['grpcurl', '-d', '{"message":"hi"}', 'localhost:50051', 'svc/Method']);
  });

  it('parses plaintext unary invoke with body and headers', () => {
    const cmd = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
      body: { message: 'hello' },
      metadata: { 'x-request-id': 'abc' },
    });
    const parsed = parseGrpcurlCommand(cmd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.targetAddress).toBe('localhost:50051');
    expect(parsed.serviceFullName).toBe('echo.EchoService');
    expect(parsed.methodName).toBe('Echo');
    expect(parsed.tlsMode).toBe('disabled');
    expect(parsed.body).toEqual({ message: 'hello' });
    expect(parsed.metadata['x-request-id']).toBe('abc');
  });

  it('parses TLS invoke without -plaintext', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -authority grpc.example.com localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.tlsMode).toBe('tls');
    expect(parsed.serverNameOverride).toBe('grpc.example.com');
  });

  it('imports descriptor flags with Proto Management guidance (Phase 5F)', () => {
    const parsed = parseGrpcurlCommand(
      'grpcurl -proto echo.proto -import-path ./proto localhost:50051 echo.EchoService/Echo',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.descriptorFlags?.protoPaths).toEqual(['echo.proto']);
    expect(parsed.descriptorFlags?.importPaths).toEqual(['./proto']);
    expect(parsed.unsupportedFlags).not.toContain('-proto');
    expect(parsed.warnings.some((w) => w.includes('Descriptor flags'))).toBe(true);
  });

  it('omits secret metadata from grpcurl export', () => {
    const cmd = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
      metadata: {
        authorization: 'Bearer super-secret-token-value',
        'x-api-token': 'also-secret',
        'x-tenant': 'test',
      },
    });
    expect(cmd).not.toContain('super-secret');
    expect(cmd).not.toContain('also-secret');
    expect(cmd).toContain('x-tenant');
  });

  it('omits Bearer-shaped values from non-secret grpcurl header keys', () => {
    const cmd = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'disabled',
      metadata: {
        'x-custom': 'Bearer smuggled-token-value',
        'x-tenant': 'test',
      },
    });
    expect(cmd).not.toContain('smuggled-token');
    expect(cmd).toContain('x-tenant');
  });

  it('round-trips -authority through export and import', () => {
    const exported = buildGrpcurlInvokeCommand({
      targetAddress: 'localhost:50051',
      serviceFullName: 'echo.EchoService',
      methodName: 'Echo',
      tlsMode: 'tls',
      serverNameOverride: 'grpc.internal.example.com',
    });
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.tlsMode).toBe('tls');
    expect(parsed.serverNameOverride).toBe('grpc.internal.example.com');
    const patch = grpcGrpcurlImportToTabPatch(parsed);
    expect(patch.tlsConfig?.serverNameOverride).toBe('grpc.internal.example.com');
  });

  it('round-trips export → import → tab patch without semantic drift', () => {
    const exported = buildGrpcurlInvokeCommand({
      targetAddress: '{{grpcHost}}',
      serviceFullName: 'health.v1.Health',
      methodName: 'Check',
      tlsMode: 'disabled',
      body: { service: '' },
      metadata: { 'x-tenant': 'test' },
    });
    const parsed = parseGrpcurlCommand(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const patch = grpcGrpcurlImportToTabPatch(parsed);
    expect(patch.target).toBe('{{grpcHost}}');
    expect(patch.service).toBe('health.v1.Health');
    expect(patch.method).toBe('Check');
    expect(patch.tlsMode).toBe('disabled');
    expect(patch.body).toEqual({ service: '' });
    expect(patch.metadata['x-tenant']).toBe('test');
  });
});
