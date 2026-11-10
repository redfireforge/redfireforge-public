/**
 * kafka-consume-once.ts
 *
 * Standalone implementation of the one-shot consume-once operation.
 * Extracted from KafkaService to keep kafka-service.ts under the 900-line threshold.
 *
 * Supports pagination (seekOffsets) and reverse-order (sortOrder: 'desc') via
 * admin-assisted offset lookups and consumer.seek().
 */

import {
  createKafkaErrorEnvelope,
  createKafkaSuccessEnvelope,
  type KafkaConsumeOnceRequest,
  type KafkaConsumeResult,
  type KafkaConsumeRecord,
  type KafkaConnectionConfig,
  type KafkaRouteEnvelope,
} from './contracts.js';
import type { KafkaRuntimeAdapter } from './kafka-adapter.js';
import { matchesKafkaConsumeFilter, validateKafkaConsumeRequest } from './kafka-service-utils.js';
import {
  decodeValue,
  SchemaRegistryError,
  SCHEMA_ERROR_CODES,
} from './schema-registry-client.js';
import {
  DEFAULT_CLEANUP_TIMEOUT_MS,
  resolveRequestTimeout,
  safeDisconnectConsumer,
  withTimeout,
} from './kafka-service-helpers.js';
import { randomUUID } from 'node:crypto';

/**
 * Fetch per-partition earliest/latest offsets via a short-lived admin connection.
 * Used for desc-mode (newest-first) to calculate where to seek.
 */
async function fetchPartitionOffsets(
  runtimeAdapter: KafkaRuntimeAdapter,
  connection: KafkaConnectionConfig,
  topic: string,
): Promise<Array<{ partition: number; low: number; high: number }>> {
  const admin = runtimeAdapter.createAdmin(connection);
  try {
    await withTimeout(admin.connect(), resolveRequestTimeout(connection), 'admin-connect');
    const offsets = await withTimeout(
      admin.fetchTopicOffsets(topic),
      resolveRequestTimeout(connection),
      'admin-offsets',
    );
    return offsets.map((o) => ({
      partition: o.partition,
      low: parseInt(o.low, 10) || 0,
      high: parseInt(o.high, 10) || 0,
    }));
  } finally {
    try { await admin.disconnect(); } catch { /* cleanup */ }
  }
}

/**
 * Calculate per-partition seek offsets to read the last N messages across
 * all partitions. Distributes maxMessages proportionally across partitions
 * based on their message count.
 */
function computeDescSeekOffsets(
  partitionOffsets: Array<{ partition: number; low: number; high: number }>,
  maxMessages: number,
): Array<{ partition: number; offset: string }> {
  const totalMessages = partitionOffsets.reduce(
    (sum, p) => sum + Math.max(0, p.high - p.low),
    0,
  );

  if (totalMessages === 0) return [];

  return partitionOffsets
    .filter((p) => p.high > p.low)
    .map((p) => {
      const partitionCount = p.high - p.low;
      const share = Math.ceil((partitionCount / totalMessages) * maxMessages);
      const seekTo = Math.max(p.low, p.high - share);
      return { partition: p.partition, offset: String(seekTo) };
    });
}

/**
 * Compute next-page cursor for 'asc' direction.
 * Returns the next offset to read per partition (max consumed offset + 1).
 */
function computeAscNextCursor(
  messages: KafkaConsumeRecord[],
): Array<{ partition: number; offset: string }> {
  const maxByPartition = new Map<number, number>();
  for (const m of messages) {
    const off = parseInt(m.offset, 10);
    const current = maxByPartition.get(m.partition);
    if (current === undefined || off > current) {
      maxByPartition.set(m.partition, off);
    }
  }
  return Array.from(maxByPartition.entries()).map(([partition, maxOff]) => ({
    partition,
    offset: String(maxOff + 1),
  }));
}

/**
 * Compute next-page cursor for 'desc' direction.
 * Returns the offset just before the earliest consumed message per partition.
 */
function computeDescNextCursor(
  messages: KafkaConsumeRecord[],
  partitionOffsets: Array<{ partition: number; low: number; high: number }>,
): Array<{ partition: number; offset: string }> {
  const minByPartition = new Map<number, number>();
  for (const m of messages) {
    const off = parseInt(m.offset, 10);
    const current = minByPartition.get(m.partition);
    if (current === undefined || off < current) {
      minByPartition.set(m.partition, off);
    }
  }

  const lowMap = new Map(partitionOffsets.map((p) => [p.partition, p.low]));
  const result: Array<{ partition: number; offset: string }> = [];
  for (const [partition, minOff] of minByPartition) {
    const low = lowMap.get(partition) ?? 0;
    if (minOff > low) {
      result.push({ partition, offset: String(minOff) });
    }
  }
  return result;
}

export async function executeConsumeOnce(
  runtimeAdapter: KafkaRuntimeAdapter,
  connection: KafkaConnectionConfig,
  request: KafkaConsumeOnceRequest,
): Promise<KafkaRouteEnvelope<KafkaConsumeResult>> {
  const validationError = validateKafkaConsumeRequest(request);
  if (validationError) {
    return createKafkaErrorEnvelope('consume-once', validationError);
  }

  const maxMessages = Math.max(request.maxMessages ?? 1, 1);
  const timeoutMs = Math.max(request.timeoutMs ?? resolveRequestTimeout(connection), 1);
  const groupId = request.groupId ?? `redfireforge-consume-once-${randomUUID().slice(0, 8)}`;
  const sortOrder = request.sortOrder ?? 'asc';
  const seekOffsets = request.seekOffsets;

  const needsOffsets = sortOrder === 'desc' || !!seekOffsets;

  let partitionOffsets: Array<{ partition: number; low: number; high: number }> | undefined;
  if (needsOffsets && !seekOffsets) {
    try {
      partitionOffsets = await fetchPartitionOffsets(runtimeAdapter, connection, request.topic);
    } catch (error) {
      return createKafkaErrorEnvelope('consume-once', {
        code: 'KAFKA_CONSUME_ONCE_FAILED',
        message: `Failed to fetch partition offsets: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  const consumer = runtimeAdapter.createConsumer(connection, groupId);
  const messages: KafkaConsumeRecord[] = [];

  let settle: ((result: KafkaConsumeResult) => Promise<void>) | null = null;
  let settled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let stopPromise: Promise<void> | null = null;

  const settleResult = async (result: KafkaConsumeResult): Promise<void> => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (!stopPromise) {
      stopPromise = consumer.stop().catch(() => {});
    }
    if (settle) {
      await settle(result);
    }
  };

  try {
    await withTimeout(consumer.connect(), resolveRequestTimeout(connection), 'consume-connect');

    // When seeking to specific offsets, always subscribe from beginning so
    // the seek positions take effect. For desc without explicit seekOffsets,
    // also subscribe from beginning so the computed seek offsets work.
    const useFromBeginning = needsOffsets || (request.fromBeginning ?? false);
    await withTimeout(
      consumer.subscribe(request.topic, useFromBeginning),
      resolveRequestTimeout(connection),
      'consume-subscribe',
    );

    // Apply seek offsets
    const effectiveSeekOffsets = seekOffsets
      ?? (sortOrder === 'desc' && partitionOffsets
        ? computeDescSeekOffsets(partitionOffsets, maxMessages)
        : undefined);

    // NOTE: consumer.seek() must be called AFTER consumer.run() because KafkaJS
    // initialises `this.runner` synchronously at the start of run() — calling seek
    // before run() throws "Consumer group was not initialized, consumer#run must be
    // called first". Seeks are applied inside the resultPromise constructor, right
    // after `void consumer.run(...)` starts the runner.

    const resultPromise = new Promise<KafkaConsumeResult>((resolve, reject) => {
      settle = async (result) => {
        resolve(result);
      };

      timeoutHandle = setTimeout(() => {
        const snapshot = [...messages];
        void settleResult({
          messageCount: snapshot.length,
          messages: snapshot,
          timedOut: snapshot.length < maxMessages,
        }).catch(reject);
      }, timeoutMs);

      void consumer.run(async (record) => {
        if (settled) {
          return;
        }

        // Schema decode before the filter so JSONPath and Body Contains
        // search the JSON shown in the table, not the raw Avro/protobuf bytes.
        const { rawValue: _rawValue, ...strippedRecord } = record;
        let consumeRecord: KafkaConsumeRecord = strippedRecord;
        if (request.schemaConfig && _rawValue) {
          try {
            const decoded = await decodeValue(request.schemaConfig, _rawValue);
            consumeRecord = {
              topic: record.topic,
              partition: record.partition,
              offset: record.offset,
              timestamp: record.timestamp,
              key: record.key,
              value: JSON.stringify(decoded),
              headers: record.headers,
            };
          } catch (decodeError) {
            if (decodeError instanceof SchemaRegistryError) {
              await settleResult({
                messageCount: 0,
                messages: [],
                timedOut: false,
                schemaError: {
                  code: decodeError.code,
                  message: decodeError.message,
                },
              } as KafkaConsumeResult & { schemaError?: { code: string; message: string } });
              return;
            }
            throw decodeError;
          }
        }

        if (!matchesKafkaConsumeFilter(consumeRecord, request.filter)) {
          return;
        }

        messages.push(consumeRecord);
        if (messages.length >= maxMessages) {
          const snapshot = [...messages];
          await settleResult({
            messageCount: snapshot.length,
            messages: snapshot,
            timedOut: false,
          });
        }
      }).catch((error) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (!stopPromise) {
          stopPromise = consumer.stop().catch(() => {});
        }
        reject(error);
      });

      // Apply seek offsets AFTER consumer.run() has been called. KafkaJS sets
      // this.runner synchronously at the start of run(), so by the time the
      // line above executes, the runner is initialised and seek() is safe to call.
      if (effectiveSeekOffsets && effectiveSeekOffsets.length > 0) {
        for (const so of effectiveSeekOffsets) {
          consumer.seek(request.topic, so.partition, so.offset);
        }
      }
    });

    const result = await resultPromise;

    // Phase 10B — surface schema decode errors
    const schemaErr = (result as KafkaConsumeResult & { schemaError?: { code: string; message: string } }).schemaError;
    if (schemaErr) {
      return createKafkaErrorEnvelope('consume-once', {
        code: schemaErr.code,
        message: schemaErr.message,
        retryable: schemaErr.code === SCHEMA_ERROR_CODES.REGISTRY_UNREACHABLE,
      });
    }

    // Compute pagination metadata
    let hasMore = false;
    let nextCursor: Array<{ partition: number; offset: string }> | undefined;

    if (result.messages.length > 0) {
      if (sortOrder === 'desc') {
        // For desc: sort messages by offset descending
        result.messages.sort((a, b) => parseInt(b.offset, 10) - parseInt(a.offset, 10));

        // Fetch offsets if we don't already have them (e.g. seekOffsets was provided)
        if (!partitionOffsets) {
          try {
            partitionOffsets = await fetchPartitionOffsets(runtimeAdapter, connection, request.topic);
          } catch { /* non-fatal — omit cursor */ }
        }
        if (partitionOffsets) {
          nextCursor = computeDescNextCursor(result.messages, partitionOffsets);
          hasMore = nextCursor.length > 0;
        }
      } else {
        // asc: check if there are more messages beyond what was returned
        nextCursor = computeAscNextCursor(result.messages);

        // Fetch offsets to check hasMore
        if (!partitionOffsets) {
          try {
            partitionOffsets = await fetchPartitionOffsets(runtimeAdapter, connection, request.topic);
          } catch { /* non-fatal */ }
        }
        if (partitionOffsets) {
          const highMap = new Map(partitionOffsets.map((p) => [p.partition, p.high]));
          hasMore = nextCursor.some((c) => {
            const high = highMap.get(c.partition) ?? 0;
            return parseInt(c.offset, 10) < high;
          });
        } else {
          hasMore = result.messageCount >= maxMessages;
        }
      }
    }

    return createKafkaSuccessEnvelope('consume-once', {
      ...result,
      hasMore,
      nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : undefined,
    });
  } catch (error) {
    if (error instanceof SchemaRegistryError) {
      return createKafkaErrorEnvelope('consume-once', {
        code: error.code,
        message: error.message,
        retryable: error.code === SCHEMA_ERROR_CODES.REGISTRY_UNREACHABLE,
      });
    }
    return createKafkaErrorEnvelope('consume-once', {
      code: 'KAFKA_CONSUME_ONCE_FAILED',
      message: String(error instanceof Error ? error.message : error),
      retryable: true,
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (stopPromise) {
      try {
        await withTimeout(stopPromise, DEFAULT_CLEANUP_TIMEOUT_MS, 'consume-stop');
      } catch {
        // Slow or stuck stop should not block the consume-once response forever.
      }
    }
    await safeDisconnectConsumer(consumer);
  }
}
