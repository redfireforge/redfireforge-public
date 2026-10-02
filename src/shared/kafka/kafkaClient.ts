import { httpFetch, type HttpResponse } from '../utils/httpClient';

export type KafkaOperation =
  | 'connect'
  | 'disconnect'
  | 'status'
  | 'topics'
  | 'produce'
  | 'consume-once'
  | 'subscribe'
  | 'subscriptions'
  | 'unsubscribe'
  | 'subscription-messages'
  | 'topic-detail'
  | 'topic-groups'
  | 'schema-subjects'
  | 'schema-versions'
  | 'schema-fetch';

type KafkaMethod = 'GET' | 'POST';

interface KafkaOperationSpec {
  method: KafkaMethod;
  path: string;
  queryKeys?: string[];
}

export interface KafkaDispatchRequest {
  op: KafkaOperation;
  method: KafkaMethod;
  path: string;
  query: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface KafkaEnvelope<T = unknown> {
  ok: boolean;
  op: KafkaOperation | string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
  meta?: {
    timestamp?: string;
    durationMs?: number;
  };
}

export type KafkaUiErrorKind =
  | 'auth'
  | 'tls'
  | 'timeout'
  | 'network'
  | 'validation'
  | 'cluster'
  | 'server'
  | 'unknown';

/**
 * Schema registry configuration for Avro/Protobuf/JSON-Schema encode/decode.
 * Mirrors the server-side KafkaSchemaConfig — declared independently here so
 * this shared module has no dependency on src-server types.
 */
export interface KafkaSchemaConfig {
  registryUrl: string;
  auth?: { username: string; password: string };
  /** Explicit subject name. Defaults to `{topic}-value` (TopicNameStrategy) when absent. */
  subject?: string;
  /** Schema version to use. Defaults to latest when absent. */
  version?: number;
  format: 'avro' | 'protobuf' | 'json-schema';
}

export interface KafkaUiSafeError {
  kind: KafkaUiErrorKind;
  code: string;
  message: string;
  retryable: boolean;
}

export class KafkaClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly operation: KafkaOperation;

  constructor(
    operation: KafkaOperation,
    message: string,
    options?: { code?: string; retryable?: boolean },
  ) {
    super(message);
    this.name = 'KafkaClientError';
    this.operation = operation;
    this.code = options?.code ?? 'KAFKA_CLIENT_ERROR';
    this.retryable = options?.retryable ?? true;
  }
}

function classifyKafkaUiError(code: string, message: string): KafkaUiErrorKind {
  const normalizedCode = code.toUpperCase();
  const normalizedMessage = message.toLowerCase();

  if (normalizedCode.includes('AUTH') || normalizedMessage.includes('auth') || normalizedMessage.includes('credential')) {
    return 'auth';
  }
  if (normalizedCode.includes('TLS') || normalizedMessage.includes('tls') || normalizedMessage.includes('certificate')) {
    return 'tls';
  }
  if (normalizedCode.includes('TIMEOUT') || normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out')) {
    return 'timeout';
  }
  if (
    normalizedCode.includes('NETWORK')
    || normalizedCode.includes('PROXY')
    || normalizedCode.includes('BROKER')
    || normalizedMessage.includes('network')
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('connection refused')
    || normalizedMessage.includes('econnrefused')
    || normalizedMessage.includes('enotfound')
    || normalizedMessage.includes('getaddrinfo')
  ) {
    return 'network';
  }
  if (normalizedCode.includes('INVALID')) {
    return 'validation';
  }
  if (normalizedCode.includes('MISMATCH') || normalizedCode.includes('NOT_CONNECTED')) {
    return 'cluster';
  }
  if (normalizedCode.startsWith('KAFKA_')) {
    return 'server';
  }
  return 'unknown';
}

export function toKafkaUiSafeError(error: unknown, op: KafkaOperation): KafkaUiSafeError {
  if (error instanceof KafkaClientError) {
    return {
      kind: classifyKafkaUiError(error.code, error.message),
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: classifyKafkaUiError('KAFKA_UNKNOWN_ERROR', message),
    code: 'KAFKA_UNKNOWN_ERROR',
    message: message && message.trim().length > 0 ? message : `Kafka ${op} failed`,
    retryable: true,
  };
}

/**
 * Convert a not-ok envelope's error fields into a KafkaUiSafeError for React state.
 * Callers should only invoke this after confirming `!envelope.ok`.
 *
 * @param envelope - The failed envelope.
 * @param fallbackMessage - Human-readable default when envelope has no message.
 * @param fallbackCode - Error code default when envelope has no code.
 */
export function envelopeErrorToUiError(
  envelope: KafkaEnvelope,
  fallbackMessage: string,
  fallbackCode: string,
): KafkaUiSafeError {
  const msg = envelope.error?.message ?? fallbackMessage;
  const code = envelope.error?.code ?? fallbackCode;
  const retryable = envelope.error?.retryable ?? true;
  return { kind: 'server', code, message: msg, retryable };
}

/**
 * Throw a KafkaClientError if the envelope indicates a failure.
 * Extracted so both the HTTP and Tauri transports can share identical logic.
 */
export function throwIfEnvelopeNotOk(op: KafkaOperation, envelope: KafkaEnvelope): void {
  if (!envelope.ok) {
    const code = envelope.error?.code?.trim();
    const message = envelope.error?.message?.trim();
    const fallback = code ? `Kafka ${op} failed (${code})` : `Kafka ${op} failed`;
    throw new KafkaClientError(op, message && message.length > 0 ? message : fallback, {
      code: code && code.length > 0 ? code : 'KAFKA_OPERATION_FAILED',
      retryable: envelope.error?.retryable ?? true,
    });
  }
}

export type KafkaClientTransport = (request: KafkaDispatchRequest) => Promise<KafkaEnvelope>;

const OPERATION_MAP: Record<KafkaOperation, KafkaOperationSpec> = {
  connect: { method: 'POST', path: '/api/kafka/connect' },
  disconnect: { method: 'POST', path: '/api/kafka/disconnect' },
  status: { method: 'GET', path: '/api/kafka/status', queryKeys: ['clusterId'] },
  topics: { method: 'GET', path: '/api/kafka/topics', queryKeys: ['clusterId', 'includeInternal'] },
  produce: { method: 'POST', path: '/api/kafka/produce' },
  'consume-once': { method: 'POST', path: '/api/kafka/consume-once' },
  subscribe: { method: 'POST', path: '/api/kafka/subscribe' },
  subscriptions: { method: 'GET', path: '/api/kafka/subscriptions', queryKeys: ['clusterId'] },
  unsubscribe: { method: 'POST', path: '/api/kafka/unsubscribe' },
  'subscription-messages': { method: 'GET', path: '/api/kafka/subscription-messages', queryKeys: ['subscriptionId', 'sinceCursor', 'clusterId'] },
  'topic-detail': { method: 'GET', path: '/api/kafka/topics/:topicName/detail', queryKeys: ['clusterId'] },
  'topic-groups': { method: 'GET', path: '/api/kafka/topics/:topicName/groups', queryKeys: ['clusterId'] },
  'schema-subjects': { method: 'POST', path: '/api/kafka/schema-subjects' },
  'schema-versions': { method: 'POST', path: '/api/kafka/schema-versions' },
  'schema-fetch': { method: 'POST', path: '/api/kafka/schema-fetch' },
};

let transportOverride: KafkaClientTransport | null = null;

export function setKafkaClientTransport(transport: KafkaClientTransport | null): void {
  transportOverride = transport;
}

function toQueryValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function buildQuery(
  request: Record<string, unknown> | undefined,
  keys: string[] | undefined,
): Record<string, string> {
  if (!request || !keys || keys.length === 0) {
    return {};
  }

  const query: Record<string, string> = {};
  for (const key of keys) {
    const value = toQueryValue(request[key]);
    if (value != null) {
      query[key] = value;
    }
  }
  return query;
}

function withQuery(path: string, query: Record<string, string>): string {
  const pairs = Object.entries(query);
  if (pairs.length === 0) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of pairs) {
    params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}

function parseEnvelope(op: KafkaOperation, response: HttpResponse): KafkaEnvelope {
  if (response.error) {
    throw new KafkaClientError(op, response.error, {
      code: 'KAFKA_NETWORK_ERROR',
      retryable: true,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body || '{}');
  } catch {
    throw new KafkaClientError(op, `Kafka ${op} returned non-JSON response`, {
      code: 'KAFKA_INVALID_RESPONSE',
      retryable: false,
    });
  }

  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed) || !('op' in parsed)) {
    throw new KafkaClientError(op, `Kafka ${op} returned invalid envelope`, {
      code: 'KAFKA_INVALID_ENVELOPE',
      retryable: false,
    });
  }

  const envelope = parsed as KafkaEnvelope;
  if (envelope.op !== op) {
    throw new KafkaClientError(op, `Kafka ${op} returned mismatched operation envelope (${envelope.op})`, {
      code: 'KAFKA_MISMATCHED_ENVELOPE',
      retryable: false,
    });
  }

  throwIfEnvelopeNotOk(op, envelope);
  return envelope;
}

export async function defaultTransport(request: KafkaDispatchRequest): Promise<KafkaEnvelope> {
  const url = withQuery(request.path, request.query);
  const headers: Record<string, string> = { Accept: 'application/json' };
  let bodyText: string | undefined;

  if (request.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(request.body ?? {});
  }

  const response = await httpFetch(url, request.method, headers, bodyText);
  return parseEnvelope(request.op, response);
}

export async function dispatchKafkaOperation<T = unknown>(
  op: KafkaOperation,
  request?: Record<string, unknown>,
): Promise<KafkaEnvelope<T>> {
  const spec = OPERATION_MAP[op];
  const query = buildQuery(request, spec.queryKeys);
  let path = spec.path;
  if (request) {
    path = path.replace(/:([a-zA-Z]+)/g, (_match, key) => {
      const val = request[key];
      return val != null ? encodeURIComponent(String(val)) : '';
    });
  }
  const dispatchRequest: KafkaDispatchRequest = {
    op,
    method: spec.method,
    path,
    query,
    body: spec.method === 'GET' ? undefined : request,
  };

  const transport = transportOverride ?? defaultTransport;
  return transport(dispatchRequest) as Promise<KafkaEnvelope<T>>;
}
