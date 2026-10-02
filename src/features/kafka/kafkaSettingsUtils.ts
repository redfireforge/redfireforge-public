import type { KafkaClusterConfig } from '@shared/kafka/kafkaConfig';
import type { KafkaUiSafeError } from '@shared/kafka/kafkaClient';
import type { KafkaClusterDraft } from './kafkaClusterForm';

const AUTH_MODE_LABELS = {
  none: 'No authentication',
  plain: 'SASL / PLAIN',
  'scram-sha-256': 'SCRAM-SHA-256',
  'scram-sha-512': 'SCRAM-SHA-512',
  oauthbearer: 'Azure OAUTHBEARER',
} as const;

export const DIAGNOSTIC_LABELS = {
  auth: 'Authentication issue',
  tls: 'TLS issue',
  timeout: 'Timeout',
  network: 'Network / broker reachability issue',
  validation: 'Configuration issue',
  cluster: 'Cluster state issue',
  server: 'Broker/server issue',
  unknown: 'Unknown issue',
} as const;

function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseOptionalTimeoutMs(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed ? Number.parseInt(trimmed, 10) : undefined;
}

export function buildTlsConfig(draft: KafkaClusterDraft): KafkaClusterConfig['tls'] {
  if (!draft.tlsEnabled) {
    return {
      enabled: false,
      rejectUnauthorized: true,
    };
  }

  return {
    enabled: true,
    rejectUnauthorized: draft.tlsRejectUnauthorized,
    serverName: trimToUndefined(draft.tlsServerName),
    caPem: trimToUndefined(draft.tlsCaPem),
    certPem: trimToUndefined(draft.tlsCertPem),
    keyPem: trimToUndefined(draft.tlsKeyPem),
    passphrase: trimToUndefined(draft.tlsPassphrase),
  };
}

export function formatBrokers(brokers: string[]): string {
  if (brokers.length <= 2) {
    return brokers.join(', ');
  }
  return `${brokers.slice(0, 2).join(', ')}, +${brokers.length - 2} more`;
}

export function formatSecurityProfile(cluster: KafkaClusterConfig): string {
  const parts: string[] = [AUTH_MODE_LABELS[cluster.auth.mode]];
  if (cluster.tls.enabled) {
    parts.push(cluster.tls.rejectUnauthorized === false ? 'TLS without cert verification' : 'TLS enabled');
  }
  return parts.join(' • ');
}

export function getClusterStatus(
  clusterId: string,
  selectedClusterId: string | null,
  connectionState: 'disconnected' | 'testing' | 'connected' | 'error',
  connectedClusterId?: string,
): { label: string; kind: 'connected' | 'idle' | 'failed' } {
  if (connectionState === 'connected' && connectedClusterId === clusterId) {
    return { label: 'Connected', kind: 'connected' };
  }
  if (connectionState === 'error' && selectedClusterId === clusterId) {
    return { label: 'Failed', kind: 'failed' };
  }
  return { label: 'Idle', kind: 'idle' };
}

export function formatDiagnosticHint(kind: keyof typeof DIAGNOSTIC_LABELS, retryable: boolean): string {
  switch (kind) {
    case 'auth':
      return 'Review the selected auth mode. SASL modes need a username and password. Azure OAUTHBEARER uses the Azure CLI login on this machine.';
    case 'tls':
      return 'Check CA, certificate, key, and TLS verification settings.';
    case 'timeout':
      return 'Try raising the connection or request timeout if the broker is slow to respond.';
    case 'network':
      return 'Verify broker hostnames, ports, Docker exposure, and local network reachability.';
    case 'validation':
      return 'Fix the highlighted cluster configuration fields and try again.';
    case 'cluster':
      return 'Refresh status or disconnect the active cluster before retrying.';
    default:
      return retryable ? 'You can retry after reviewing the cluster configuration.' : 'Review the cluster configuration before retrying.';
  }
}

export interface KafkaDiagnosticBannerData {
  kind: keyof typeof DIAGNOSTIC_LABELS;
  code: string;
  message: string;
  retryable: boolean;
}

export function toDiagnosticBannerData(error: KafkaUiSafeError): KafkaDiagnosticBannerData {
  return {
    kind: error.kind,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
}
