/**
 * Phase 4H — saved request contract tests.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURE_UNARY_CALL_REQUEST } from './contractFixtures';
import { GRPC_REDACTED_PLACEHOLDER } from './grpcRedaction';
import {
  createGrpcSavedRequestFromSnapshot,
  mergeAuthForReplay,
  mergeTlsConfigForReplay,
  redactGrpcSavedRequestForPersist,
  resolveSavedRequestTargetForPersist,
} from './grpcSavedRequest';

const VALID_PEM = `-----BEGIN CERTIFICATE-----
TEST-CA
-----END CERTIFICATE-----`;

describe('grpcSavedRequest (Phase 4H)', () => {
  it('redactGrpcSavedRequestForPersist strips raw secrets', () => {
    const saved = redactGrpcSavedRequestForPersist({
      id: 'sr-1',
      name: 'Echo / Echo',
      revisionId: 'rev-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      callType: 'unary',
      service: 'echo.EchoService',
      method: 'Echo',
      descriptorKey: 'desc-1',
      body: { message: 'hi' },
      metadata: { 'x-test': '1' },
      timeoutMs: 30000,
      auth: { type: 'bearer', bearerToken: 'secret-token-value' },
      tlsConfig: { serverCaPem: VALID_PEM },
    });
    expect(saved.auth?.bearerToken).toBe(GRPC_REDACTED_PLACEHOLDER);
    expect(saved.tlsConfig?.serverCaPem).toBe('[REDACTED_PEM]');
  });

  it('createGrpcSavedRequestFromSnapshot redacts before returning', () => {
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: FIXTURE_UNARY_CALL_REQUEST.body ?? {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
        auth: { type: 'bearer', bearerToken: 'secret-token-value' },
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    expect(saved.auth?.bearerToken).toBe(GRPC_REDACTED_PLACEHOLDER);
  });

  it('mergeAuthForReplay takes tab secrets when saved values are redacted', () => {
    const merged = mergeAuthForReplay(
      { type: 'bearer', bearerToken: GRPC_REDACTED_PLACEHOLDER },
      { type: 'bearer', bearerToken: 'runtime-token' },
    );
    expect(merged).toEqual({ type: 'bearer', bearerToken: 'runtime-token' });
  });

  it('mergeAuthForReplay keeps saved non-redacted secrets when present', () => {
    const merged = mergeAuthForReplay(
      { type: 'bearer', bearerToken: 'saved-token' },
      { type: 'bearer', bearerToken: 'runtime-token' },
    );
    expect(merged?.bearerToken).toBe('saved-token');
  });

  it('mergeTlsConfigForReplay prefers tab PEM when saved PEM is redacted', () => {
    const merged = mergeTlsConfigForReplay(
      { serverCaPem: '[REDACTED_PEM]', serverNameOverride: 'grpc.example.com' },
      { serverCaPem: VALID_PEM },
    );
    expect(merged?.serverCaPem).toBe(VALID_PEM);
    expect(merged?.serverNameOverride).toBe('grpc.example.com');
  });

  it('mergeTlsConfigForReplay prefers tab serverNameOverride when tab overrides', () => {
    const merged = mergeTlsConfigForReplay(
      { serverNameOverride: 'saved.example.com' },
      { serverNameOverride: 'tab.example.com' },
    );
    expect(merged?.serverNameOverride).toBe('tab.example.com');
  });

  it('mergeTlsConfigForReplay prefers tab PEM even when saved PEM is not redacted', () => {
    const merged = mergeTlsConfigForReplay(
      { serverCaPem: '-----BEGIN CERTIFICATE-----\nSAVED\n-----END CERTIFICATE-----' },
      { serverCaPem: VALID_PEM },
    );
    expect(merged?.serverCaPem).toBe(VALID_PEM);
  });

  it('mergeAuthForReplay uses tab auth when saved type differs and secrets are redacted', () => {
    const merged = mergeAuthForReplay(
      { type: 'bearer', bearerToken: GRPC_REDACTED_PLACEHOLDER },
      { type: 'basic', basicUsername: 'user', basicPassword: 'tab-password' },
    );
    expect(merged).toEqual({
      type: 'basic',
      basicUsername: 'user',
      basicPassword: 'tab-password',
    });
  });

  it('mergeAuthForReplay keeps saved auth when type differs but saved secrets are literal', () => {
    const merged = mergeAuthForReplay(
      { type: 'bearer', bearerToken: 'saved-literal-token' },
      { type: 'basic', basicUsername: 'user', basicPassword: 'tab-password' },
    );
    expect(merged?.type).toBe('bearer');
    expect(merged?.bearerToken).toBe('saved-literal-token');
  });

  it('resolveSavedRequestTargetForPersist keeps env template over resolved address', () => {
    const target = resolveSavedRequestTargetForPersist(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { rawTarget: '{{grpcHost}}' },
    );
    expect(target).toBe('{{grpcHost}}');
  });

  it('resolveSavedRequestTargetForPersist omits target for profile-only saves', () => {
    const target = resolveSavedRequestTargetForPersist(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { connectionId: 'profile-staging' },
    );
    expect(target).toBeUndefined();
  });

  it('createGrpcSavedRequestFromSnapshot captures connectionId from tab context', () => {
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: 'tab-1',
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: FIXTURE_UNARY_CALL_REQUEST.target,
        service: FIXTURE_UNARY_CALL_REQUEST.service,
        method: FIXTURE_UNARY_CALL_REQUEST.method,
        body: FIXTURE_UNARY_CALL_REQUEST.body ?? {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { connectionId: 'profile-staging' },
    );
    expect(saved.connectionId).toBe('profile-staging');
  });

  it('redactGrpcSavedRequestForPersist redacts authorization metadata', () => {
    const saved = redactGrpcSavedRequestForPersist({
      id: 'sr-1',
      name: 'Echo / Echo',
      revisionId: 'rev-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      callType: 'unary',
      service: 'echo.EchoService',
      method: 'Echo',
      descriptorKey: 'desc-1',
      body: {},
      metadata: { authorization: 'Bearer secret-token-value', 'x-tenant': 'test' },
      timeoutMs: 30000,
      auth: { type: 'bearer', bearerToken: 'secret-token-value' },
    });
    expect(saved.metadata.authorization).toBe(GRPC_REDACTED_PLACEHOLDER);
    expect(saved.metadata['x-tenant']).toBe('test');
  });
});
