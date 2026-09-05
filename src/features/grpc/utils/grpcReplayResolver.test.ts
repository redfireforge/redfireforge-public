/**
 * Phase 4H — replay resolver integration tests.
 */
import { describe, expect, it } from 'vitest';
import { createGrpcStudioTab } from '../grpcStudioTypes';
import { GRPC_REDACTED_PLACEHOLDER } from '@shared/grpc/grpcRedaction';
import { createGrpcSavedRequestFromSnapshot } from '@shared/grpc/grpcSavedRequest';
import { buildReplayTabState, resolveGrpcSavedRequestReplay } from './grpcReplayResolver';

const VALID_PEM = `-----BEGIN CERTIFICATE-----
TEST-CA
-----END CERTIFICATE-----`;

describe('grpcReplayResolver (Phase 4H)', () => {
  it('resolves env vars in saved target at replay time', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      tlsMode: 'disabled',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: '{{grpcHost}}', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: 'hello' },
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    saved.target = '{{grpcHost}}';

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-1',
      envVarMap: { grpcHost: 'localhost:50051' },
      profiles: [],
      pageDefaults: { target: 'localhost:59999', tlsMode: 'disabled' },
    });

    expect(snapshot.target.address).toBe('localhost:50051');
    expect(snapshot.body).toEqual({ message: 'hello' });
    expect(snapshot.service).toBe('echo.EchoService');
    expect(snapshot.interpolationEnv?.env.grpcHost).toBe('localhost:50051');
  });

  it('deep-interpolates saved body and metadata templates at replay time (Phase 9H)', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      tlsMode: 'disabled',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: '{{greeting}}', nested: { tag: '{{envName}}' } },
        metadata: { 'x-env': '{{envName}}' },
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      {
        rawBody: { message: '{{greeting}}', nested: { tag: '{{envName}}' } },
        rawMetadata: { 'x-env': '{{envName}}' },
      },
    );

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-deep-1',
      envVarMap: { grpcHost: 'localhost:50051', greeting: 'replayed', envName: 'dev' },
      profiles: [],
      pageDefaults: { target: 'localhost:59999', tlsMode: 'disabled' },
    });

    expect(snapshot.body).toEqual({ message: 'replayed', nested: { tag: 'dev' } });
    expect(snapshot.metadata?.['x-env']).toBe('dev');
  });

  it('uses tab vault secrets when saved auth is redacted', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50051',
      tlsMode: 'disabled',
      auth: { type: 'bearer', bearerToken: 'runtime-bearer-token' },
      metadata: { 'x-custom': 'manual' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: { authorization: 'Bearer stale-manual' },
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
        auth: { type: 'bearer', bearerToken: 'original-token' },
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    expect(saved.auth?.bearerToken).toBe(GRPC_REDACTED_PLACEHOLDER);

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-2',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.auth?.bearerToken).toBe('runtime-bearer-token');
    expect(snapshot.metadata?.authorization).toBe('Bearer runtime-bearer-token');
  });

  it('does not mutate source tab when building replay snapshot', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50051',
      service: 'echo.EchoService',
      method: 'ServerStream',
      body: { message: 'original' },
      tlsConfig: { serverCaPem: VALID_PEM },
      tlsMode: 'tls',
      auth: { type: 'none' },
    });
    const beforeService = tab.service;
    const beforeBody = structuredClone(tab.body);

    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'tls', tlsConfig: { serverCaPem: VALID_PEM } },
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: 'saved' },
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );

    resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-3',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(tab.service).toBe(beforeService);
    expect(tab.body).toEqual(beforeBody);
  });

  it('preserves non-secret saved metadata and applies auth precedence at replay', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50051',
      tlsMode: 'disabled',
      auth: { type: 'bearer', bearerToken: 'runtime-token' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: { message: 'replay-me' },
        metadata: { 'x-tenant': 'test', authorization: 'Bearer stale' },
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
        auth: { type: 'bearer', bearerToken: 'saved-redacted' },
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-4',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.metadata?.['x-tenant']).toBe('test');
    expect(snapshot.metadata?.authorization).toBe('Bearer runtime-token');
  });

  it('prefers tab serverNameOverride over saved value at replay', () => {
    // 50443 is the TLS-capable loopback fixture — 50051 is plaintext-only and
    // prepareGrpcTarget coerces sticky TLS to disabled for that port.
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50443',
      tlsMode: 'tls',
      tlsConfig: { serverNameOverride: 'tab.override.com' },
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: {
          address: 'localhost:50443',
          tlsMode: 'tls',
          tlsConfig: { serverNameOverride: 'saved.example.com' },
        },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-5',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50443', tlsMode: 'disabled' },
    });

    expect(snapshot.target.tlsConfig?.serverNameOverride).toBe('tab.override.com');
  });

  it('resolves saved connectionId to profile target at replay', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:59999',
      tlsMode: 'disabled',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:59999', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { connectionId: 'profile-staging' },
    );
    saved.target = undefined;
    saved.tlsMode = undefined;

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-6',
      envVarMap: {},
      profiles: [{
        id: 'profile-staging',
        name: 'Staging',
        target: 'staging.example.com:443',
        tlsMode: 'tls',
      }],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.target.address).toBe('staging.example.com:443');
    expect(snapshot.target.tlsMode).toBe('tls');
    expect(snapshot.interpolationEnv).toBeDefined();
    expect(snapshot.interpolationEnv?.env).toEqual({});
  });

  it('binds profile env variables on replay execute snapshot (Phase 9C)', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      tlsMode: 'disabled',
      auth: { type: 'none' },
      connectionId: 'profile-staging',
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: '{{grpcHost}}', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { connectionId: 'profile-staging' },
    );
    saved.target = '{{grpcHost}}';

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-profile-env',
      envVarMap: { grpcHost: 'env.example.com:50051' },
      profiles: [{
        id: 'profile-staging',
        name: 'Staging',
        target: '{{grpcHost}}',
        tlsMode: 'disabled',
        variables: { grpcHost: 'profile.example.com:50051' },
      }],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.target.address).toBe('profile.example.com:50051');
    expect(snapshot.interpolationEnv?.env.grpcHost).toBe('profile.example.com:50051');
  });

  it('uses tab vault TLS PEM at replay when saved PEM is redacted', () => {
    // 50443 is the TLS-capable loopback fixture — 50051 is plaintext-only and
    // prepareGrpcTarget coerces sticky TLS to disabled for that port.
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50443',
      tlsMode: 'tls',
      tlsConfig: { serverCaPem: VALID_PEM },
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50443', tlsMode: 'tls', tlsConfig: { serverCaPem: VALID_PEM } },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    expect(saved.tlsConfig?.serverCaPem).toBe('[REDACTED_PEM]');

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-7',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50443', tlsMode: 'disabled' },
    });

    expect(snapshot.target.tlsConfig?.serverCaPem).toBe(VALID_PEM);
  });

  it('replays oauth2 saved requests without client-side Authorization merge (Phase 4D)', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50051',
      tlsMode: 'disabled',
      auth: {
        type: 'oauth2',
        oauth2: {
          tokenUrl: 'https://auth.example.com/token',
          clientId: 'runtime-client',
          clientSecret: 'runtime-secret',
          scope: 'grpc.read',
        },
      },
      metadata: { 'x-trace': 'trace-1' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: { 'x-trace': 'trace-1', authorization: 'Bearer stale' },
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
        auth: {
          type: 'oauth2',
          oauth2: {
            tokenUrl: 'https://auth.example.com/token',
            clientId: 'saved-client',
            clientSecret: 'saved-secret',
          },
        },
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    expect(saved.auth?.oauth2?.clientSecret).toBe(GRPC_REDACTED_PLACEHOLDER);

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-8',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.auth?.type).toBe('oauth2');
    expect(snapshot.auth?.oauth2?.clientSecret).toBe('runtime-secret');
    expect(snapshot.auth?.oauth2?.clientId).toBe('saved-client');
    expect(snapshot.metadata).toEqual({ 'x-trace': 'trace-1' });
    expect(snapshot.metadata.authorization).toBeUndefined();
  });

  it('honors saved callType override for streaming replay', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'localhost:50051',
      tlsMode: 'disabled',
      service: 'echo.EchoService',
      method: 'Echo',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'server_streaming',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'ServerStream',
        body: { message: 'stream' },
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-9',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.callType).toBe('server_streaming');
    expect(snapshot.method).toBe('ServerStream');
  });

  it('does not inherit tab connection profile when saved request has explicit target', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'ignored.example.com:443',
      connectionId: 'profile-staging',
      tlsMode: 'tls',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    saved.tlsMode = undefined;

    const snapshot = resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-req-10',
      envVarMap: {},
      profiles: [{
        id: 'profile-staging',
        name: 'Staging',
        target: 'staging.example.com:443',
        tlsMode: 'tls',
      }],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    });

    expect(snapshot.target.address).toBe('localhost:50051');
    expect(snapshot.target.tlsMode).toBe('disabled');
  });

  it('buildReplayTabState falls back to tab target/connection/tls when saved has no explicit target', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: 'tab.example.com:443',
      connectionId: 'profile-from-tab',
      tlsMode: 'tls',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-fallback', revisionId: 'rev-fallback', updatedAt: '2026-01-01T00:00:00.000Z' },
    );

    saved.target = undefined;
    saved.connectionId = undefined;
    saved.tlsMode = undefined;

    const replay = buildReplayTabState(tab, saved);
    expect(replay.target).toBe('tab.example.com:443');
    expect(replay.connectionId).toBe('profile-from-tab');
    expect(replay.tlsMode).toBe('tls');
  });

  it('throws when replay target resolution is invalid after interpolation', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      tlsMode: 'disabled',
      auth: { type: 'none' },
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: '{{missingHost}}', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        metadata: {},
        timeoutMs: 30000,
        descriptorKey: 'desc-1',
      },
      { id: 'sr-invalid-target', revisionId: 'rev-invalid-target', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    saved.target = '{{missingHost}}';

    expect(() => resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-invalid-target',
      envVarMap: {},
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    })).toThrow('Resolve {{missingHost}} before connecting');
  });

  it('rejects cyclic env variables at replay bind time (Phase 9E)', () => {
    const tab = createGrpcStudioTab({
      descriptorKey: 'desc-1',
      target: '{{grpcHost}}',
      tlsMode: 'disabled',
    });
    const saved = createGrpcSavedRequestFromSnapshot(
      {
        tabId: tab.id,
        requestId: 'req-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        callType: 'unary',
        target: { address: 'localhost:50051', tlsMode: 'disabled' },
        service: 'echo.EchoService',
        method: 'Echo',
        body: {},
        descriptorKey: 'desc-1',
      },
      { id: 'sr-1', revisionId: 'rev-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    );

    expect(() => resolveGrpcSavedRequestReplay({
      saved,
      tab,
      requestId: 'replay-cycle',
      envVarMap: {
        grpcHost: '{{apiHost}}',
        apiHost: '{{grpcHost}}',
      },
      profiles: [],
      pageDefaults: { target: 'localhost:50051', tlsMode: 'disabled' },
    })).toThrow(/Circular variable reference/);
  });
});
