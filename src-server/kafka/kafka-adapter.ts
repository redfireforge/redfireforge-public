import { Kafka } from 'kafkajs';
import type { KafkaConfig, SASLOptions } from 'kafkajs';
import type { ConnectionOptions } from 'node:tls';

// Register Snappy compression codec for kafkajs (Redpanda default compression)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const kafkajs = require('kafkajs');
const SnappyCodec = require('kafkajs-snappy');
kafkajs.CompressionCodecs[kafkajs.CompressionTypes.Snappy] = SnappyCodec;

// Suppress the KafkaJS v2 default-partitioner switch warning — we intentionally
// use the new default partitioner and don't need the migration reminder.
process.env['KAFKAJS_NO_PARTITIONER_WARNING'] = '1';
import { acquireAzureEventHubToken } from './azure-event-hub-token.js';
import type {
  KafkaConnectionConfig,
  KafkaTopicPartitionDetail,
  KafkaTopicConsumerGroupSummary,
  KafkaTopicDetail,
} from './contracts.js';

export type { KafkaTopicPartitionDetail, KafkaTopicConsumerGroupSummary, KafkaTopicDetail };

const TOPIC_INTERESTING_CONFIGS = [
  'retention.ms', 'retention.bytes', 'cleanup.policy',
  'max.message.bytes', 'min.insync.replicas',
  'compression.type', 'delete.retention.ms',
];

export interface KafkaTopicMetadata {
  name: string;
  partitions: number;
}

export interface KafkaPartitionOffsets {
  partition: number;
  low: string;
  high: string;
}

export interface KafkaAdminAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTopics(): Promise<string[]>;
  fetchTopicMetadata(): Promise<KafkaTopicMetadata[]>;
  fetchTopicDetail(topicName: string): Promise<KafkaTopicDetail>;
  fetchTopicOffsets(topic: string): Promise<KafkaPartitionOffsets[]>;
}

export interface KafkaProducerMessage {
  key?: string;
  /**
   * Plain string for non-schema messages; raw Confluent wire-format `Buffer`
   * for schema-encoded messages (Avro/Protobuf). KafkaJS accepts both.
   */
  value: string | Buffer;
  headers?: Record<string, string>;
  partition?: number;
  timestamp?: string;
}

export interface KafkaProducerResult {
  partition: number;
  offset: string;
  timestamp?: string;
}

export interface KafkaProducerAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(payload: {
    topic: string;
    acks?: number;
    timeout?: number;
    messages: KafkaProducerMessage[];
  }): Promise<KafkaProducerResult[]>;
}

export interface KafkaConsumerRecord {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  key?: string;
  value: string;
  headers?: Record<string, string>;
  /**
   * Phase 10 — Raw message bytes before UTF-8 conversion.
   * Populated alongside `value` (the toString('utf-8') version) so that
   * `kafka-service.ts` can use the raw Buffer for Avro/Protobuf schema decode.
   * Avro binary bytes are NOT valid UTF-8 and are corrupted by the toString
   * conversion used for `value`.
   * This field is server-side only — it is never serialized to clients.
   */
  rawValue?: Buffer;
}

export interface KafkaConsumerAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(topic: string, fromBeginning?: boolean): Promise<void>;
  run(eachMessage: (record: KafkaConsumerRecord) => Promise<void> | void): Promise<void>;
  stop(): Promise<void>;
  pause(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void;
  resume(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void;
  seek(topic: string, partition: number, offset: string): void;
}

export interface KafkaRuntimeAdapter {
  createAdmin(connection: KafkaConnectionConfig): KafkaAdminAdapter;
  createProducer(connection: KafkaConnectionConfig): KafkaProducerAdapter;
  createConsumer(connection: KafkaConnectionConfig, groupId: string): KafkaConsumerAdapter;
}

function toSasl(config: KafkaConnectionConfig): SASLOptions | undefined {
  const auth = config.auth;
  if (!auth || auth.mode === 'none') {
    return undefined;
  }

  const username = auth.username ?? '';
  const password = auth.password ?? '';

  if (auth.mode === 'oauthbearer') {
    return {
      mechanism: 'oauthbearer',
      oauthBearerProvider: async () => ({
        value: await acquireAzureEventHubToken(config.brokers),
      }),
    };
  }

  if (auth.mode === 'plain') {
    return {
      mechanism: 'plain',
      username,
      password,
    };
  }

  if (auth.mode === 'scram-sha-256') {
    return {
      mechanism: 'scram-sha-256',
      username,
      password,
    };
  }

  return {
    mechanism: 'scram-sha-512',
    username,
    password,
  };
}

function toSsl(config: KafkaConnectionConfig): ConnectionOptions | undefined {
  const tls = config.tls;
  if (!tls?.enabled) {
    return undefined;
  }

  const ssl: ConnectionOptions = {
    rejectUnauthorized: tls.rejectUnauthorized ?? true,
  };

  if (tls.serverName) {
    ssl.servername = tls.serverName;
  }
  if (tls.caPem) {
    ssl.ca = [tls.caPem];
  }
  if (tls.certPem) {
    ssl.cert = tls.certPem;
  }
  if (tls.keyPem) {
    ssl.key = tls.keyPem;
  }
  if (tls.passphrase) {
    ssl.passphrase = tls.passphrase;
  }

  return ssl;
}

function toKafkaConfig(connection: KafkaConnectionConfig): KafkaConfig {
  return {
    clientId: connection.clientId,
    brokers: connection.brokers,
    connectionTimeout: connection.connectionTimeoutMs,
    requestTimeout: connection.requestTimeoutMs,
    ssl: toSsl(connection),
    sasl: toSasl(connection),
  };
}

class KafkaJsAdminAdapter implements KafkaAdminAdapter {
  constructor(private readonly admin: ReturnType<Kafka['admin']>) {}

  async connect(): Promise<void> {
    await this.admin.connect();
  }

  async disconnect(): Promise<void> {
    await this.admin.disconnect();
  }

  async listTopics(): Promise<string[]> {
    return this.admin.listTopics();
  }

  async fetchTopicMetadata(): Promise<KafkaTopicMetadata[]> {
    const metadata = await this.admin.fetchTopicMetadata();
    return metadata.topics.map((topic) => ({
      name: topic.name,
      partitions: topic.partitions.length,
    }));
  }

  async fetchTopicOffsets(topic: string): Promise<KafkaPartitionOffsets[]> {
    const offsets = await this.admin.fetchTopicOffsets(topic);
    return offsets.map((o) => ({
      partition: o.partition,
      low: o.low,
      high: o.high,
    }));
  }

  async fetchTopicDetail(topicName: string): Promise<KafkaTopicDetail> {
    const [metaResult, offsetsResult, configResult] = await Promise.all([
      this.admin.fetchTopicMetadata({ topics: [topicName] }),
      this.admin.fetchTopicOffsets(topicName),
      this.admin.describeConfigs({
        resources: [{ type: 2, name: topicName, configNames: TOPIC_INTERESTING_CONFIGS }],
      }),
    ]);

    const topicMeta = metaResult.topics[0];
    const isInternal = topicMeta ? (topicMeta as { isInternal?: boolean }).isInternal ?? false : false;

    const offsetMap = new Map<number, { low: string; high: string }>();
    for (const o of offsetsResult) {
      offsetMap.set(o.partition, { low: o.low, high: o.high });
    }

    const partitions: KafkaTopicPartitionDetail[] = (topicMeta?.partitions ?? []).map((p) => {
      const offsets = offsetMap.get(p.partitionId) ?? { low: '0', high: '0' };
      const earliest = offsets.low;
      const latest = offsets.high;
      const msgCount = Math.max(0, parseInt(latest, 10) - parseInt(earliest, 10));
      return {
        partitionId: p.partitionId,
        leader: p.leader,
        replicas: [...(p.replicas ?? [])],
        isr: [...(p.isr ?? [])],
        earliestOffset: earliest,
        latestOffset: latest,
        messageCount: isNaN(msgCount) ? 0 : msgCount,
      };
    });

    const replicationFactor = partitions.length > 0 ? partitions[0].replicas.length : 0;

    let healthStatus: 'healthy' | 'degraded' | 'unknown' = 'unknown';
    if (partitions.length > 0) {
      const degraded = partitions.some((p) => p.isr.length < p.replicas.length);
      healthStatus = degraded ? 'degraded' : 'healthy';
    }

    const config: Record<string, string> = {};
    const configEntries = configResult.resources?.[0]?.configEntries ?? [];
    for (const entry of configEntries) {
      if (entry.configName && entry.configValue != null) {
        config[entry.configName] = entry.configValue;
      }
    }

    let consumerGroups: KafkaTopicConsumerGroupSummary[] = [];
    try {
      const groupsResult = await Promise.race([
        this.fetchConsumerGroupsForTopic(topicName, offsetsResult),
        new Promise<KafkaTopicConsumerGroupSummary[]>((resolve) => setTimeout(() => resolve([]), 5000)),
      ]);
      consumerGroups = groupsResult;
    } catch {
      // best-effort
    }

    return {
      name: topicName,
      partitionCount: partitions.length,
      replicationFactor,
      isInternal,
      partitions,
      consumerGroups,
      config,
      healthStatus,
    };
  }

  private async fetchConsumerGroupsForTopic(
    topicName: string,
    topicOffsets: Array<{ partition: number; high: string }>,
  ): Promise<KafkaTopicConsumerGroupSummary[]> {
    const { groups } = await this.admin.listGroups();
    const results: KafkaTopicConsumerGroupSummary[] = [];

    const latestMap = new Map<number, number>();
    for (const o of topicOffsets) {
      latestMap.set(o.partition, parseInt(o.high, 10));
    }

    for (const group of groups) {
      try {
        const offsets = await this.admin.fetchOffsets({ groupId: group.groupId, topics: [topicName] });
        const topicOffsetEntries = offsets.find((t: { topic?: string }) => t.topic === topicName);
        if (!topicOffsetEntries) continue;

        const partitionOffsets = (topicOffsetEntries as { partitions?: Array<{ partition: number; offset: string }> }).partitions ?? [];
        let hasCommitted = false;
        let totalLag = 0;

        for (const po of partitionOffsets) {
          const committed = parseInt(po.offset, 10);
          if (committed >= 0) {
            hasCommitted = true;
            const latest = latestMap.get(po.partition) ?? 0;
            totalLag += Math.max(0, latest - committed);
          }
        }

        if (hasCommitted) {
          const desc = await this.admin.describeGroups([group.groupId]);
          const state = desc.groups?.[0]?.state ?? 'Unknown';
          results.push({ groupId: group.groupId, state, totalLag });
        }
      } catch {
        // skip individual group errors
      }
    }

    return results;
  }
}

class KafkaJsProducerAdapter implements KafkaProducerAdapter {
  constructor(private readonly producer: ReturnType<Kafka['producer']>) {}

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  async send(payload: {
    topic: string;
    acks?: number;
    timeout?: number;
    messages: KafkaProducerMessage[];
  }): Promise<KafkaProducerResult[]> {
    const result = await this.producer.send({
      topic: payload.topic,
      acks: payload.acks,
      timeout: payload.timeout,
      messages: payload.messages.map((message) => ({
        key: message.key,
        value: message.value,
        headers: message.headers,
        partition: message.partition,
        timestamp: message.timestamp,
      })),
    });

    return result.map((record) => ({
      partition: record.partition,
      offset: record.baseOffset,
      timestamp: record.logAppendTime,
    }));
  }
}

class KafkaJsConsumerAdapter implements KafkaConsumerAdapter {
  constructor(private readonly consumer: ReturnType<Kafka['consumer']>) {}

  async connect(): Promise<void> {
    await this.consumer.connect();
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }

  async subscribe(topic: string, fromBeginning = false): Promise<void> {
    await this.consumer.subscribe({ topic, fromBeginning });
  }

  async run(eachMessage: (record: KafkaConsumerRecord) => Promise<void> | void): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const headers: Record<string, string> = {};
        if (message.headers) {
          for (const [key, value] of Object.entries(message.headers)) {
            if (value == null) {
              continue;
            }
            if (Array.isArray(value)) {
              headers[key] = value.map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v))).join(',');
            } else {
              headers[key] = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
            }
          }
        }

        const key = message.key ? message.key.toString('utf8') : undefined;
        const value = message.value ? message.value.toString('utf8') : '';
        // Phase 10: preserve raw bytes so kafka-service.ts can schema-decode
        const rawValue: Buffer | undefined =
          message.value != null
            ? Buffer.isBuffer(message.value)
              ? message.value
              : Buffer.from(message.value)
            : undefined;
        await eachMessage({
          topic,
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
          key,
          value,
          headers,
          rawValue,
        });
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.stop();
  }

  pause(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void {
    this.consumer.pause(topicPartitions);
  }

  resume(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void {
    this.consumer.resume(topicPartitions);
  }

  seek(topic: string, partition: number, offset: string): void {
    this.consumer.seek({ topic, partition, offset: offset });
  }
}

export class KafkaJsRuntimeAdapter implements KafkaRuntimeAdapter {
  createAdmin(connection: KafkaConnectionConfig): KafkaAdminAdapter {
    const kafka = new Kafka(toKafkaConfig(connection));
    return new KafkaJsAdminAdapter(kafka.admin());
  }

  createProducer(connection: KafkaConnectionConfig): KafkaProducerAdapter {
    const kafka = new Kafka(toKafkaConfig(connection));
    return new KafkaJsProducerAdapter(kafka.producer());
  }

  createConsumer(connection: KafkaConnectionConfig, groupId: string): KafkaConsumerAdapter {
    const kafka = new Kafka(toKafkaConfig(connection));
    return new KafkaJsConsumerAdapter(kafka.consumer({ groupId }));
  }
}

export function createKafkaRuntimeAdapter(): KafkaRuntimeAdapter {
  return new KafkaJsRuntimeAdapter();
}