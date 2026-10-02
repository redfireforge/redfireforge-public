import type { KafkaAuthMode, KafkaClusterConfig } from '@shared/kafka/kafkaConfig';
import { eventHubResourceFromBrokers } from '@shared/kafka/azureEventHubResource';

export interface KafkaClusterDraft {
  clusterId: string;
  name: string;
  clientId: string;
  brokers: string[];
  connectionTimeoutMs: string;
  requestTimeoutMs: string;
  authMode: KafkaAuthMode;
  authUsername: string;
  authPassword: string;
  tlsEnabled: boolean;
  tlsRejectUnauthorized: boolean;
  tlsServerName: string;
  tlsCaPem: string;
  tlsCertPem: string;
  tlsKeyPem: string;
  tlsPassphrase: string;
}

export interface KafkaClusterDraftErrors {
  clusterId?: string;
  name?: string;
  clientId?: string;
  connectionTimeoutMs?: string;
  requestTimeoutMs?: string;
  authUsername?: string;
  authPassword?: string;
  tlsCertPem?: string;
  tlsKeyPem?: string;
  tlsPassphrase?: string;
  tlsEnabled?: string;
  brokers?: string;
  brokerRows?: Record<number, string>;
}

export function clusterIdFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_.\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function defaultClusterDraft(seed = Date.now()): KafkaClusterDraft {
  const clusterId = `kafka-cluster-${seed}`;
  return {
    clusterId,
    name: 'New Kafka Cluster',
    clientId: `redfireforge-${clusterId}`,
    brokers: ['127.0.0.1:19092'],
    connectionTimeoutMs: '',
    requestTimeoutMs: '',
    authMode: 'none',
    authUsername: '',
    authPassword: '',
    tlsEnabled: false,
    tlsRejectUnauthorized: true,
    tlsServerName: '',
    tlsCaPem: '',
    tlsCertPem: '',
    tlsKeyPem: '',
    tlsPassphrase: '',
  };
}

/**
 * Normalize broker row inputs into unique host:port entries.
 * Supports comma-delimited input in a single row, e.g. "a:9092, b:9092".
 */
export function normalizeBrokerEntries(values: string[]): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      if (!normalized.includes(part)) {
        normalized.push(part);
      }
    }
  }
  return normalized;
}

export function draftFromCluster(cluster: KafkaClusterConfig): KafkaClusterDraft {
  return {
    clusterId: cluster.clusterId,
    name: cluster.name,
    clientId: cluster.clientId,
    brokers: cluster.brokers.length > 0 ? [...cluster.brokers] : [''],
    connectionTimeoutMs: cluster.connectionTimeoutMs != null ? String(cluster.connectionTimeoutMs) : '',
    requestTimeoutMs: cluster.requestTimeoutMs != null ? String(cluster.requestTimeoutMs) : '',
    authMode: cluster.auth.mode,
    authUsername: cluster.auth.username ?? '',
    authPassword: cluster.auth.password ?? '',
    tlsEnabled: cluster.tls.enabled,
    tlsRejectUnauthorized: cluster.tls.rejectUnauthorized ?? true,
    tlsServerName: cluster.tls.serverName ?? '',
    tlsCaPem: cluster.tls.caPem ?? '',
    tlsCertPem: cluster.tls.certPem ?? '',
    tlsKeyPem: cluster.tls.keyPem ?? '',
    tlsPassphrase: cluster.tls.passphrase ?? '',
  };
}

export function authConfigFromDraft(draft: KafkaClusterDraft): KafkaClusterConfig['auth'] {
  if (draft.authMode === 'none' || draft.authMode === 'oauthbearer') {
    return { mode: draft.authMode };
  }
  return {
    mode: draft.authMode,
    username: draft.authUsername.trim(),
    password: draft.authPassword.trim(),
  };
}

const BROKER_PATTERN = /^[^\s:]+:\d{2,5}$/;

function validateOptionalPositiveInteger(value?: string): string | null {
  const normalizedValue = value?.trim() ?? '';
  if (!normalizedValue) {
    return null;
  }
  if (!/^\d+$/.test(normalizedValue)) {
    return 'Must be a whole number of milliseconds';
  }
  return Number(normalizedValue) >= 1 ? null : 'Must be at least 1 millisecond';
}

export function validateKafkaClusterDraft(
  draft: KafkaClusterDraft,
  existingClusters: KafkaClusterConfig[],
  editingClusterId: string | null,
): KafkaClusterDraftErrors {
  const errors: KafkaClusterDraftErrors = {};
  const clusterId = draft.clusterId.trim();
  const name = draft.name.trim();
  const clientId = draft.clientId.trim();

  if (!name) {
    errors.name = 'Name is required';
  }

  if (!clusterId) {
    errors.clusterId = 'Cluster ID is required';
  } else if (!/^[a-z0-9][a-z0-9-_.]*$/.test(clusterId)) {
    errors.clusterId = 'Cluster ID must contain only lowercase letters, numbers, dash, underscore, or dot';
  } else {
    const duplicate = existingClusters.some((cluster) => (
      cluster.clusterId === clusterId && cluster.clusterId !== editingClusterId
    ));
    if (duplicate) {
      errors.clusterId = 'Cluster ID must be unique';
    }
  }

  if (!clientId) {
    errors.clientId = 'Client ID is required';
  }

  const connectionTimeoutError = validateOptionalPositiveInteger(draft.connectionTimeoutMs);
  if (connectionTimeoutError) {
    errors.connectionTimeoutMs = connectionTimeoutError;
  }

  const requestTimeoutError = validateOptionalPositiveInteger(draft.requestTimeoutMs);
  if (requestTimeoutError) {
    errors.requestTimeoutMs = requestTimeoutError;
  }

  const authMode = draft.authMode ?? 'none';
  const authUsername = draft.authUsername?.trim() ?? '';
  const authPassword = draft.authPassword?.trim() ?? '';
  const needsCredentials = authMode === 'plain' || authMode === 'scram-sha-256' || authMode === 'scram-sha-512';

  if (needsCredentials) {
    if (!authUsername) {
      errors.authUsername = 'Username is required for authenticated modes';
    }
    if (!authPassword) {
      errors.authPassword = 'Password is required for authenticated modes';
    }
  }

  if (authMode === 'oauthbearer' && !(draft.tlsEnabled ?? false)) {
    errors.tlsEnabled = 'Azure OAUTHBEARER requires TLS';
  }

  if (draft.tlsEnabled ?? false) {
    const hasCert = (draft.tlsCertPem?.trim().length ?? 0) > 0;
    const hasKey = (draft.tlsKeyPem?.trim().length ?? 0) > 0;
    if (hasCert !== hasKey) {
      errors.tlsCertPem = 'Certificate and private key must be provided together';
      errors.tlsKeyPem = 'Certificate and private key must be provided together';
    }
    if ((draft.tlsPassphrase?.trim() ?? '') && !hasKey) {
      errors.tlsPassphrase = 'Passphrase requires a TLS private key';
    }
  }

  const brokerRows: Record<number, string> = {};
  const normalizedBrokers = normalizeBrokerEntries(draft.brokers);
  draft.brokers.forEach((value, idx) => {
    const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (entries.length === 0) {
      brokerRows[idx] = 'Broker host:port is required';
      return;
    }
    const invalidEntry = entries.find((entry) => !BROKER_PATTERN.test(entry));
    if (invalidEntry) {
      brokerRows[idx] = 'Each broker must use host:port format (comma-separated supported)';
    }
  });

  if (draft.brokers.length === 0 || normalizedBrokers.length === 0) {
    errors.brokers = 'At least one broker is required';
  } else if (authMode === 'oauthbearer' && !eventHubResourceFromBrokers(normalizedBrokers)) {
    errors.brokers = 'Azure OAUTHBEARER needs a broker on *.servicebus.windows.net';
  }
  if (Object.keys(brokerRows).length > 0) {
    errors.brokerRows = brokerRows;
  }

  return errors;
}

export function hasDraftErrors(errors: KafkaClusterDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}
