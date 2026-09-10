/**
 * Express proxy JSON envelope transport — shared by stream client and Phase 10B adapters.
 */
import { httpFetch, resolveCompanionServerUrl } from '../utils/httpClient';
import { isTauri } from '../utils/platform';
import type { GrpcOperation, GrpcRouteEnvelope, GrpcSuccessEnvelope } from './contracts';
import { GrpcApiClientError } from './grpcApiClient';

/** Tauri has no Vite `/api` proxy — send companion routes to :3001. */
export function resolveGrpcExpressProxyUrl(path: string): string {
  return isTauri() ? resolveCompanionServerUrl(path) : path;
}

function headersFromInit(init: RequestInit): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers) && !(init.headers instanceof Headers)) {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  return headers;
}

function parseExpressProxyJsonBody(
  op: GrpcOperation,
  body: string,
  status: number,
): GrpcRouteEnvelope<unknown> {
  try {
    return JSON.parse(body) as GrpcRouteEnvelope<unknown>;
  } catch {
    throw new GrpcApiClientError(op, `gRPC ${op} transport returned non-JSON response (HTTP ${status})`, {
      code: 'GRPC_INVALID_ENVELOPE',
      retryable: false,
    });
  }
}

export async function expressGrpcProxyJsonFetch(
  path: string,
  init: RequestInit,
  op: GrpcOperation = 'stream_start',
): Promise<GrpcRouteEnvelope<unknown>> {
  // Web keeps relative `fetch` so Vite can proxy `/api` → :3001.
  // Tauri has no such proxy — `httpFetch` rewrites to the companion.
  if (isTauri()) {
    const method = init.method ?? 'GET';
    const headers = headersFromInit(init);
    const bodyText = typeof init.body === 'string' ? init.body : undefined;
    const response = await httpFetch(path, method, headers, bodyText, init.signal ?? undefined);
    if (response.error) {
      throw new GrpcApiClientError(op, response.error, {
        code: 'GRPC_NETWORK_ERROR',
        retryable: true,
      });
    }
    return parseExpressProxyJsonBody(op, response.body, response.status);
  }

  const response = await fetch(path, init);
  const body = await response.text();
  return parseExpressProxyJsonBody(op, body, response.status);
}

function throwIfNotOk<T>(
  op: GrpcOperation,
  envelope: GrpcRouteEnvelope<T>,
): asserts envelope is GrpcSuccessEnvelope<T> {
  if (!envelope.ok) {
    const code = envelope.error.code?.trim() || 'GRPC_CLIENT_ERROR';
    const message = envelope.error.message?.trim() || `gRPC ${op} failed (${code})`;
    throw new GrpcApiClientError(op, message, {
      code,
      retryable: envelope.error.retryable ?? false,
      category: envelope.error.category,
      details: envelope.error.details,
    });
  }
}

export async function expressGrpcProxyDispatchJson<T>(
  op: GrpcOperation,
  path: string,
  init: RequestInit,
  transport: (path: string, init: RequestInit, op: GrpcOperation) => Promise<GrpcRouteEnvelope<unknown>> = expressGrpcProxyJsonFetch,
): Promise<GrpcSuccessEnvelope<T>> {
  const raw = await transport(path, init, op);
  const envelope = raw as GrpcRouteEnvelope<T>;
  if (envelope.op !== op) {
    throw new GrpcApiClientError(op, `gRPC ${op} returned mismatched operation (${envelope.op})`, {
      code: 'GRPC_MISMATCHED_ENVELOPE',
      retryable: false,
    });
  }
  throwIfNotOk(op, envelope);
  return envelope as GrpcSuccessEnvelope<T>;
}

export function buildGrpcStreamQuery(
  tabId: string,
  extra?: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  params.set('tabId', tabId);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
  }
  return params.toString();
}

type GrpcStreamJsonTransport = (
  path: string,
  init: RequestInit,
  op: GrpcOperation,
) => Promise<GrpcRouteEnvelope<unknown>>;

let streamJsonTransportOverride: GrpcStreamJsonTransport | null = null;

/** Phase 7F — native stream transport override (Tauri) for JSON stream_start envelope. */
export function setGrpcExpressStreamJsonTransportOverride(
  transport: GrpcStreamJsonTransport | null,
): void {
  streamJsonTransportOverride = transport;
}

export function resolveGrpcExpressStreamJsonTransport(): GrpcStreamJsonTransport {
  return streamJsonTransportOverride ?? expressGrpcProxyJsonFetch;
}
