import type {
  KafkaConnectionConfig,
  KafkaConsumeOnceRequest,
  KafkaConsumeRecord,
  KafkaOperation,
  KafkaProduceRequest,
  KafkaRouteEnvelope,
} from './contracts.js';
import { createKafkaErrorEnvelope } from './contracts.js';

// ── Cluster mismatch guard ────────────────────────────────────────────────────

/**
 * Returns an error envelope when `requestClusterId` is provided and differs
 * from `activeClusterId`.  Returns `null` when the check passes.
 *
 * Consolidates the repeated cluster-mismatch guard that appears in
 * KafkaService, KafkaSubscriptionStore, and operation modules.
 */
export function checkClusterMismatch(
  op: KafkaOperation,
  requestClusterId: string | undefined,
  activeClusterId: string | undefined,
): KafkaRouteEnvelope<never> | null {
  if (requestClusterId && activeClusterId && requestClusterId !== activeClusterId) {
    return createKafkaErrorEnvelope(op, {
      code: 'KAFKA_CLUSTER_MISMATCH',
      message: `Request cluster '${requestClusterId}' does not match active cluster '${activeClusterId}'`,
    });
  }
  return null;
}

export function validateConnectionConfig(connection: KafkaConnectionConfig): { code: string; message: string } | null {
  if (!connection.clusterId?.trim()) {
    return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.clusterId is required' };
  }
  if (!connection.clientId?.trim()) {
    return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.clientId is required' };
  }
  if (!Array.isArray(connection.brokers) || connection.brokers.length === 0) {
    return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.brokers must contain at least one broker' };
  }
  if (connection.brokers.some((broker) => !broker || !broker.trim())) {
    return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.brokers cannot include empty values' };
  }

  const auth = connection.auth;
  if (auth && auth.mode !== 'none') {
    if (!auth.username?.trim()) {
      return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.auth.username is required for authenticated modes' };
    }
    if (!auth.password?.trim()) {
      return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.auth.password is required for authenticated modes' };
    }
  }

  const tls = connection.tls;
  if (tls?.enabled) {
    const hasCert = Boolean(tls.certPem?.trim());
    const hasKey = Boolean(tls.keyPem?.trim());
    if (hasCert !== hasKey) {
      return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.tls.certPem and connection.tls.keyPem must be provided together' };
    }
    if (tls.passphrase?.trim() && !hasKey) {
      return { code: 'KAFKA_INVALID_CONNECTION', message: 'connection.tls.passphrase requires connection.tls.keyPem' };
    }
  }

  return null;
}

export function validateKafkaProduceRequest(request: KafkaProduceRequest): { code: string; message: string } | null {
  if (!request.topic?.trim()) {
    return { code: 'KAFKA_INVALID_PRODUCE', message: 'topic is required' };
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return { code: 'KAFKA_INVALID_PRODUCE', message: 'messages must contain at least one message' };
  }
  if (request.messages.some((message) => typeof message.value !== 'string')) {
    return { code: 'KAFKA_INVALID_PRODUCE', message: 'all message values must be strings' };
  }
  return null;
}

export function validateKafkaConsumeRequest(request: KafkaConsumeOnceRequest): { code: string; message: string } | null {
  if (!request.topic?.trim()) {
    return { code: 'KAFKA_INVALID_CONSUME_ONCE', message: 'topic is required' };
  }
  if (request.maxMessages != null && request.maxMessages < 1) {
    return { code: 'KAFKA_INVALID_CONSUME_ONCE', message: 'maxMessages must be >= 1' };
  }
  if (request.timeoutMs != null && request.timeoutMs < 1) {
    return { code: 'KAFKA_INVALID_CONSUME_ONCE', message: 'timeoutMs must be >= 1' };
  }
  return null;
}

export function readKafkaJsonPath(jsonText: string, path: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const trimmed = path.trim();
  if (!trimmed.startsWith('$.')) {
    return null;
  }

  const tokens = trimmed
    .slice(2)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: unknown = parsed;
  for (const token of tokens) {
    if (current == null) {
      return null;
    }
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return null;
      }
      current = current[idx];
      continue;
    }
    if (typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[token];
  }

  if (current == null) {
    return null;
  }

  if (typeof current === 'string') {
    return current;
  }
  return JSON.stringify(current);
}

/** Match the raw record or the text after JSON string escapes are decoded. */
export function kafkaBodyHasText(value: string, needle: string): boolean {
  const normalized = needle.trim().replace(/[\u201c\u201d\u201e]/g, '"').toLowerCase();
  if (!normalized) return true;
  const raw = value.toLowerCase();
  const text = jsonUnescape(raw);
  const needleText = jsonUnescape(normalized);
  return raw.includes(normalized)
    || raw.includes(needleText)
    || text.includes(normalized)
    || text.includes(needleText);
}

function jsonUnescape(input: string): string {
  return input.replace(/\\(["\\/nrt])/g, (_match, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    if (ch === 'r') return '\r';
    return ch;
  });
}

export function matchesKafkaConsumeFilter(record: KafkaConsumeRecord, filter?: KafkaConsumeOnceRequest['filter']): boolean {
  if (!filter) {
    return true;
  }

  if (filter.keyEquals != null && record.key !== filter.keyEquals) {
    return false;
  }

  if (filter.headersMatch) {
    const headers = record.headers ?? {};
    for (const [key, expected] of Object.entries(filter.headersMatch)) {
      if (headers[key] !== expected) {
        return false;
      }
    }
  }

  if (filter.jsonPath) {
    const actual = readKafkaJsonPath(record.value, filter.jsonPath);
    const expected = filter.jsonEquals;
    if (expected != null) {
      if (actual !== expected) {
        return false;
      }
    } else if (actual == null) {
      return false;
    }
  }

  if (filter.bodyContains != null && filter.bodyContains !== '') {
    if (!kafkaBodyHasText(record.value, filter.bodyContains)) {
      return false;
    }
  }

  return true;
}
