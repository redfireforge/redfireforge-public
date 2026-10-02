export type KafkaAuthMode = 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512' | 'oauthbearer';

export interface KafkaAuthConfig {
  mode: KafkaAuthMode;
  username?: string;
  password?: string;
}

export interface KafkaTlsConfig {
  enabled: boolean;
  rejectUnauthorized?: boolean;
  serverName?: string;
  caPem?: string;
  certPem?: string;
  keyPem?: string;
  passphrase?: string;
}

export interface KafkaClusterConfig {
  clusterId: string;
  name: string;
  clientId: string;
  brokers: string[];
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  auth: KafkaAuthConfig;
  tls: KafkaTlsConfig;
  createdAt: number;
  updatedAt: number;
}

export interface KafkaTopicSummary {
  name: string;
  partitions: number;
  isInternal: boolean;
}

export type KafkaConnectionState = 'disconnected' | 'testing' | 'connected' | 'error';

export interface KafkaConnectionSnapshot {
  state: KafkaConnectionState;
  clusterId?: string;
  connectedAt?: string;
  lastError?: string;
}

const VALID_AUTH_MODES: ReadonlySet<KafkaAuthMode> = new Set(['none', 'plain', 'scram-sha-256', 'scram-sha-512', 'oauthbearer']);

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function parseBrokers(input: unknown): string[] {
  if (Array.isArray(input)) {
    const next = input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);
    return [...new Set(next)];
  }

  if (typeof input === 'string') {
    const next = input
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return [...new Set(next)];
  }

  return [];
}

function parseAuth(input: unknown): KafkaAuthConfig {
  if (input && typeof input === 'object') {
    const source = input as Record<string, unknown>;
    const modeCandidate = asTrimmedString(source.mode);
    const mode = modeCandidate && VALID_AUTH_MODES.has(modeCandidate as KafkaAuthMode)
      ? (modeCandidate as KafkaAuthMode)
      : 'none';
    const username = asTrimmedString(source.username) ?? undefined;
    const password = asTrimmedString(source.password) ?? undefined;
    if (mode === 'none' || mode === 'oauthbearer') {
      return { mode };
    }
    return { mode, username, password };
  }

  if (typeof input === 'string' && VALID_AUTH_MODES.has(input as KafkaAuthMode)) {
    return { mode: input as KafkaAuthMode };
  }

  return { mode: 'none' };
}

function parseTls(input: unknown): KafkaTlsConfig {
  if (!input || typeof input !== 'object') {
    return { enabled: false, rejectUnauthorized: true };
  }

  const source = input as Record<string, unknown>;
  return {
    enabled: source.enabled === true,
    rejectUnauthorized: source.rejectUnauthorized === false ? false : true,
    serverName: asTrimmedString(source.serverName) ?? undefined,
    caPem: asTrimmedString(source.caPem) ?? undefined,
    certPem: asTrimmedString(source.certPem) ?? undefined,
    keyPem: asTrimmedString(source.keyPem) ?? undefined,
    passphrase: asTrimmedString(source.passphrase) ?? undefined,
  };
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function normalizeKafkaClusterConfig(candidate: unknown, now = Date.now()): KafkaClusterConfig | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const source = candidate as Record<string, unknown>;
  const clusterId = asTrimmedString(source.clusterId) ?? asTrimmedString(source.id);
  const brokers = parseBrokers(source.brokers);

  if (!clusterId || brokers.length === 0) {
    return null;
  }

  const createdAt = parseTimestamp(source.createdAt, now);
  const updatedAt = parseTimestamp(source.updatedAt, createdAt);
  const auth = parseAuth(source.auth ?? source.authMode);

  if (auth.mode !== 'none' && auth.mode !== 'oauthbearer') {
    auth.username = auth.username ?? asTrimmedString(source.username) ?? undefined;
    auth.password = auth.password ?? asTrimmedString(source.password) ?? undefined;
  }

  return {
    clusterId,
    name: asTrimmedString(source.name) ?? clusterId,
    clientId: asTrimmedString(source.clientId) ?? `redfireforge-${clusterId}`,
    brokers,
    connectionTimeoutMs: asOptionalNumber(source.connectionTimeoutMs),
    requestTimeoutMs: asOptionalNumber(source.requestTimeoutMs),
    auth,
    tls: parseTls(source.tls),
    createdAt,
    updatedAt: updatedAt < createdAt ? createdAt : updatedAt,
  };
}
