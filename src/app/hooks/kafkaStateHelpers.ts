import type {
  KafkaClusterConfig,
  KafkaConnectionSnapshot,
  KafkaConnectionState,
} from '@shared/kafka/kafkaConfig';

export const DEFAULT_CONNECTION_SNAPSHOT: KafkaConnectionSnapshot = {
  state: 'disconnected',
};

const STATUS_POLL_BASE_INTERVAL_MS = 4_000;
const STATUS_POLL_MAX_INTERVAL_MS = 30_000;
export const STATUS_POLL_MAX_FAILURE_STREAK = 6;

export function resolveSelectedClusterId(
  clusters: KafkaClusterConfig[],
  selectedClusterId: string | null,
): string | null {
  if (selectedClusterId && clusters.some((cluster) => cluster.clusterId === selectedClusterId)) {
    return selectedClusterId;
  }
  return clusters[0]?.clusterId ?? null;
}

export function nextBackoffDelayMs(failureStreak: number): number {
  const bounded = Math.min(Math.max(failureStreak, 0), STATUS_POLL_MAX_FAILURE_STREAK);
  const computed = STATUS_POLL_BASE_INTERVAL_MS * (2 ** bounded);
  return Math.min(computed, STATUS_POLL_MAX_INTERVAL_MS);
}

export function toConnectRequest(cluster: KafkaClusterConfig): Record<string, unknown> {
  return {
    connection: {
      clusterId: cluster.clusterId,
      clientId: cluster.clientId,
      brokers: cluster.brokers,
      connectionTimeoutMs: cluster.connectionTimeoutMs,
      requestTimeoutMs: cluster.requestTimeoutMs,
      auth: cluster.auth,
      tls: cluster.tls,
    },
  };
}

export function parseConnectionState(raw: unknown): KafkaConnectionState {
  if (raw === 'connected' || raw === 'testing' || raw === 'error') {
    return raw;
  }
  return 'disconnected';
}

export function canBrowseTopics(
  loaded: boolean,
  selectedClusterId: string | null,
  connection: KafkaConnectionSnapshot,
): selectedClusterId is string {
  return loaded
    && !!selectedClusterId
    && connection.state === 'connected'
    && connection.clusterId === selectedClusterId;
}

/** Avoid status-poll churn creating a new connection object every few seconds. */
export function connectionSnapshotsEqual(
  a: KafkaConnectionSnapshot,
  b: KafkaConnectionSnapshot,
): boolean {
  return a.state === b.state
    && a.clusterId === b.clusterId
    && a.connectedAt === b.connectedAt
    && a.lastError === b.lastError;
}
