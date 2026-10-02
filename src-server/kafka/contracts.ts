export type KafkaOperation =
  | 'connect'
  | 'disconnect'
  | 'status'
  | 'topics'
  | 'topic-detail'
  | 'produce'
  | 'consume-once'
  | 'subscribe'
  | 'subscriptions'
  | 'unsubscribe'
  | 'subscription-messages'
  // Phase 10 — Schema Registry operations (server-side only in Phase 10A/10B;
  // frontend KafkaOperation in kafkaClient.ts is updated in Phase 10C lockstep)
  | 'schema-subjects'
  | 'schema-versions'
  | 'schema-fetch';

export type KafkaServiceState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Serialization format for key and value fields in a produce request. */
export type KafkaSerdeFormat = 'string' | 'json' | 'base64' | 'hex';

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

export interface KafkaConnectionConfig {
  clusterId: string;
  clientId: string;
  brokers: string[];
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  auth?: KafkaAuthConfig;
  tls?: KafkaTlsConfig;
}

export interface KafkaConnectRequest {
  connection: KafkaConnectionConfig;
}

export interface KafkaDisconnectRequest {
  clusterId?: string;
}

export interface KafkaStatusRequest {
  clusterId?: string;
}

export interface KafkaTopicsRequest {
  clusterId?: string;
  includeInternal?: boolean;
}

/**
 * Phase 10 — Schema Registry configuration.
 * Attached at the request level (not per-message) so all messages in a batch
 * are encoded/decoded with the same schema.
 *
 * Security note: `auth` carries credentials and MUST travel in the request body,
 * never as query params (OWASP A02 — Cryptographic Failures / Credential Exposure).
 */
export interface KafkaSchemaConfig {
  /** URL of the Confluent-compatible Schema Registry. */
  registryUrl: string;
  /** Optional Basic-auth credentials for the registry endpoint. */
  auth?: { username: string; password: string };
  /**
   * Subject name override.  When absent, the server derives it from the topic
   * using TopicNameStrategy: `{topic}-value`.
   * Key encoding is out of scope for Phase 10; `{topic}-key` subjects are
   * never requested in the initial implementation.
   */
  subject?: string;
  /** Schema version to use.  When absent, the latest version is resolved. */
  version?: number;
  /** Wire format — Avro, Protobuf, or JSON Schema. */
  format: 'avro' | 'protobuf' | 'json-schema';
}

export interface KafkaProduceMessage {
  key?: string;
  value: string;
  headers?: Record<string, string>;
  partition?: number;
  timestamp?: string;
}

export interface KafkaProduceRequest {
  clusterId?: string;
  topic: string;
  messages: KafkaProduceMessage[];
  acks?: number;
  timeoutMs?: number;
  /**
   * Phase 10 — Optional schema encoding config.
   * When present, each message value is Avro/Protobuf/JSON Schema encoded before
   * being sent to the broker.  Applied uniformly to all messages in the batch.
   * Per-message schema config is not supported in the initial phase.
   * When absent, messages are sent as plain JSON (no behavioral change).
   */
  schemaConfig?: KafkaSchemaConfig;
  /**
   * Serde format for the message body.  Default: 'json' (UTF-8 string, backward compat).
   * 'base64' and 'hex' cause the server to decode the string to a raw Buffer before sending.
   * Ignored when schemaConfig is present (schema encoding takes precedence).
   */
  bodyFormat?: KafkaSerdeFormat;
  /**
   * Serde format for the message key.  Default: 'string' (UTF-8 key string).
   * 'base64' and 'hex' cause the server to decode the key string to a raw Buffer.
   */
  keyFormat?: KafkaSerdeFormat;
}

export interface KafkaProduceRecordResult {
  partition: number;
  offset: string;
  timestamp?: string;
}

export interface KafkaProduceResult {
  clusterId?: string;
  topic: string;
  sentCount: number;
  records: KafkaProduceRecordResult[];
  /**
   * Phase 10 — Wire encoding used for message values.
   * Present only when `schemaConfig` was supplied in the request.
   * `KafkaConsumeRecord` does NOT include this field — the server always decodes
   * before returning so clients always receive plain JSON in `value`.
   */
  valueEncoding?: 'avro' | 'protobuf' | 'json-schema' | 'plain' | 'base64' | 'hex';
}

export interface KafkaMessageFilter {
  keyEquals?: string;
  headersMatch?: Record<string, string>;
  jsonPath?: string;
  jsonEquals?: string;
  /** Case-insensitive substring search within the raw message body. */
  bodyContains?: string;
}

export interface KafkaConsumeOnceRequest {
  clusterId?: string;
  topic: string;
  groupId?: string;
  fromBeginning?: boolean;
  timeoutMs?: number;
  maxMessages?: number;
  filter?: KafkaMessageFilter;
  /**
   * Phase 10 — Optional schema decode config.
   * When present, raw Avro/Protobuf/JSON Schema bytes are decoded back to plain JSON
   * before being returned in `KafkaConsumeRecord.value`.
   * Subscribe-path schema decode is out of scope for Phase 10B.
   * When absent, message values are returned as plain UTF-8 strings (no change).
   */
  schemaConfig?: KafkaSchemaConfig;
  /**
   * Sort order for returned messages.
   * 'asc' (default) returns oldest-first; 'desc' returns newest-first.
   * When 'desc', the server fetches the last N messages from the topic tail.
   */
  sortOrder?: 'asc' | 'desc';
  /**
   * Explicit per-partition seek offsets for pagination.
   * When provided, the consumer seeks to these offsets before consuming.
   * Used by "Load More" to resume from a previous cursor position.
   */
  seekOffsets?: Array<{ partition: number; offset: string }>;
}

export interface KafkaSubscribeRequest {
  clusterId?: string;
  topic: string;
  groupId?: string;
  fromBeginning?: boolean;
  filter?: KafkaMessageFilter;
  maxInMemoryMessages?: number;
}

export interface KafkaSubscriptionsRequest {
  clusterId?: string;
}

export interface KafkaUnsubscribeRequest {
  clusterId?: string;
  subscriptionId: string;
}

export interface KafkaServiceStatus {
  state: KafkaServiceState;
  clusterId?: string;
  connectedAt?: string;
  lastError?: string;
  subscriptionCount?: number;
}

export interface KafkaConnectResult {
  status: KafkaServiceStatus;
  reusedExistingConnection: boolean;
}

export interface KafkaDisconnectResult {
  status: KafkaServiceStatus;
  disconnected: boolean;
  cleanedSubscriptions: number;
}

export interface KafkaTopicSummary {
  name: string;
  partitions: number;
  isInternal: boolean;
}

export interface KafkaTopicsResult {
  clusterId?: string;
  topics: KafkaTopicSummary[];
}

export interface KafkaConsumeRecord {
  topic: string;
  partition: number;
  offset: string;
  timestamp?: string;
  key?: string;
  value: string;
  headers?: Record<string, string>;
}

export interface KafkaConsumeResult {
  messageCount: number;
  messages: KafkaConsumeRecord[];
  timedOut: boolean;
  /** True when additional messages exist beyond this page. */
  hasMore?: boolean;
  /**
   * Per-partition offsets for fetching the next page.
   * For 'asc': offset of the first unconsumed message per partition.
   * For 'desc': offset of the oldest message not yet returned.
   */
  nextCursor?: Array<{ partition: number; offset: string }>;
}

export interface KafkaSubscribeInfo {
  subscriptionId: string;
  topic: string;
  groupId: string;
  createdAt: string;
}

export interface KafkaSubscribeResult {
  clusterId?: string;
  subscription: KafkaSubscribeInfo;
}

export interface KafkaSubscriptionsResult {
  clusterId?: string;
  subscriptions: KafkaSubscribeInfo[];
}

export interface KafkaUnsubscribeResult {
  clusterId?: string;
  subscriptionId: string;
  unsubscribed: boolean;
}

export interface KafkaSubscriptionMessagesRequest {
  clusterId?: string;
  subscriptionId: string;
  sinceCursor?: number;
}

export interface KafkaSubscriptionMessagesResult {
  subscriptionId: string;
  messages: KafkaConsumeRecord[];
  cursor: number;
  bufferSize: number;
  maxInMemoryMessages: number;
  cursorGap?: boolean;
}

export interface KafkaEnvelopeMeta {
  requestId?: string;
  durationMs?: number;
  timestamp: string;
}

export interface KafkaSuccessEnvelope<TData> {
  ok: true;
  op: KafkaOperation;
  data: TData;
  meta: KafkaEnvelopeMeta;
}

export interface KafkaErrorBody {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface KafkaErrorEnvelope {
  ok: false;
  op: KafkaOperation;
  error: KafkaErrorBody;
  meta: KafkaEnvelopeMeta;
}

export type KafkaRouteEnvelope<TData> = KafkaSuccessEnvelope<TData> | KafkaErrorEnvelope;

export function createKafkaSuccessEnvelope<TData>(
  op: KafkaOperation,
  data: TData,
  meta?: Partial<KafkaEnvelopeMeta>,
): KafkaSuccessEnvelope<TData> {
  return {
    ok: true,
    op,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

export function createKafkaErrorEnvelope(
  op: KafkaOperation,
  error: KafkaErrorBody,
  meta?: Partial<KafkaEnvelopeMeta>,
): KafkaErrorEnvelope {
  return {
    ok: false,
    op,
    error,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

// ── Phase 10 — Schema Registry request / response types ──────────────────────

/**
 * Request body for `POST /api/kafka/schema-subjects`.
 * Returns the list of all subjects registered in the schema registry.
 */
export interface KafkaSchemaSubjectsRequest {
  schemaConfig: KafkaSchemaConfig;
}

export interface KafkaSchemaSubjectsResult {
  subjects: Array<{ name: string; schemaType?: string }>;
}

/**
 * Request body for `POST /api/kafka/schema-versions`.
 * Returns the list of versions available for a given subject.
 */
export interface KafkaSchemaVersionsRequest {
  schemaConfig: KafkaSchemaConfig;
  subject: string;
}

export interface KafkaSchemaVersionsResult {
  subject: string;
  versions: number[];
}

/**
 * Request body for `POST /api/kafka/schema-fetch`.
 * Returns the schema definition for a given subject and version.
 * When `version` is absent, the latest version is returned.
 */
export interface KafkaSchemaFetchRequest {
  schemaConfig: KafkaSchemaConfig;
  subject: string;
  version?: number;
}

export interface KafkaSchemaFetchResult {
  subject: string;
  version: number;
  id: number;
  schema: string;
  schemaType: string;
}

export interface KafkaTopicDetailRequest {
  clusterId?: string;
}

export interface KafkaTopicPartitionDetail {
  partitionId: number;
  leader: number;
  replicas: number[];
  isr: number[];
  earliestOffset: string;
  latestOffset: string;
  messageCount: number;
}

export interface KafkaTopicConsumerGroupSummary {
  groupId: string;
  state: string;
  totalLag: number;
}

export interface KafkaTopicDetail {
  name: string;
  partitionCount: number;
  replicationFactor: number;
  isInternal: boolean;
  partitions: KafkaTopicPartitionDetail[];
  consumerGroups: KafkaTopicConsumerGroupSummary[];
  config: Record<string, string>;
  healthStatus: 'healthy' | 'degraded' | 'unknown';
}

export type KafkaTopicDetailResponse = KafkaTopicDetail;