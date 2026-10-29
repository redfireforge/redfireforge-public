/**
 * Shared Kafka Studio types — consumed by Phases 1–5.
 * Lives in src/features/kafka/ rather than src/shared/ because these types are
 * UI-layer concepts (drafts, result rows) not shared with the server.
 */

import type { KafkaSchemaConfig } from '@shared/kafka/kafkaClient';

// ── Header row (Publish panel) ─────────────────────────────────────────────

export interface KafkaHeaderRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

// ── Serde format ──────────────────────────────────────────────────────────

/** Serialization format for key and value fields in the Publish panel. */
export type KafkaSerdeFormat = 'string' | 'json' | 'base64' | 'hex';

// ── Publish draft ──────────────────────────────────────────────────────────

export interface KafkaPublishDraft {
  topic: string;
  key: string;
  /** Encoding format for the key. Default: 'string'. */
  keyFormat: KafkaSerdeFormat;
  /** '' = auto, numeric string = explicit partition number */
  partition: string;
  acks: -1 | 0 | 1;
  timeoutMs: string;
  headers: KafkaHeaderRow[];
  /** Headers removed by Delete headers, kept so Restore headers can put them back. */
  deletedHeaders?: KafkaHeaderRow[];
  /** False when the header list is shrunk. Missing means expanded. */
  headersExpanded?: boolean;
  body: string;
  /** Encoding format for the message body. Default: 'json'. */
  bodyFormat: KafkaSerdeFormat;
  schemaConfig?: KafkaSchemaConfig;
}

// ── Consume draft ──────────────────────────────────────────────────────────

export interface KafkaConsumeDraft {
  topic: string;
  groupId: string;
  startPosition: 'latest' | 'earliest';
  timeoutMs: string;
  maxMessages: string;
  /** Exact key match → server KafkaMessageFilter.keyEquals */
  keyEquals: string;
  /** 'key=value' string → server KafkaMessageFilter.headersMatch: { key: 'value' } */
  headerMatch: string;
  jsonPath: string;
  jsonPathEquals: string;
  /** Case-insensitive substring search within the raw message body */
  bodyContains: string;
  schemaConfig?: KafkaSchemaConfig;
  /** Sort order: 'asc' = oldest first (default), 'desc' = newest first. */
  sortOrder?: 'asc' | 'desc';
}

/** Cursor for pagination — per-partition offsets for next page. */
export interface KafkaConsumeCursor {
  partition: number;
  offset: string;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface KafkaPublishResult {
  topic: string;
  sentCount: number;
  records: Array<{ partition: number; offset: string; timestamp?: string }>;
  valueEncoding?: string;
}

/** Single row in the Consume results table — mirrors server KafkaConsumeRecord. */
export interface KafkaConsumeResultRow {
  topic: string;
  partition: number;
  offset: string;
  timestamp?: string;
  key?: string;
  value: string;
  headers?: Record<string, string>;
}
