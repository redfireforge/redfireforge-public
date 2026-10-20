import { readKey, removeKey, writeKey } from '../utils/storage';
import { normalizeKafkaClusterConfig, type KafkaClusterConfig } from './kafkaConfig';
import type { KafkaConsumeDraft, KafkaPublishDraft } from '../../features/kafka/types';

export const KAFKA_CLUSTERS_KEY = 'perf-test-kafka-clusters-v1';
export const KAFKA_SELECTED_CLUSTER_KEY = 'perf-test-kafka-selected-cluster-id';
export const KAFKA_AUTO_CONNECT_ON_STARTUP_KEY = 'perf-test-kafka-auto-connect-on-startup';

const LEGACY_KAFKA_CLUSTER_KEYS = [
  'perf-test-kafka-clusters',
  'kafka-clusters',
];

const LEGACY_KAFKA_SELECTED_CLUSTER_KEYS = [
  'perf-test-kafka-selected-cluster',
  'kafka-selected-cluster',
];

interface KeyValueHit {
  key: string;
  value: string;
}

async function firstKeyHit(keys: readonly string[]): Promise<KeyValueHit | null> {
  for (const key of keys) {
    const value = await readKey(key);
    if (value) {
      return { key, value };
    }
  }
  return null;
}

function dedupeClusters(clusters: KafkaClusterConfig[]): KafkaClusterConfig[] {
  const seen = new Set<string>();
  const result: KafkaClusterConfig[] = [];

  for (let idx = clusters.length - 1; idx >= 0; idx -= 1) {
    const cluster = clusters[idx];
    if (seen.has(cluster.clusterId)) {
      continue;
    }
    seen.add(cluster.clusterId);
    result.unshift(cluster);
  }

  return result;
}

function parseClusters(raw: string): KafkaClusterConfig[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();
    const normalized: KafkaClusterConfig[] = [];
    for (const item of parsed) {
      const cluster = normalizeKafkaClusterConfig(item, now);
      if (cluster) {
        normalized.push(cluster);
      }
    }

    return dedupeClusters(normalized);
  } catch {
    return [];
  }
}

export async function saveKafkaClusters(clusters: KafkaClusterConfig[]): Promise<void> {
  await writeKey(KAFKA_CLUSTERS_KEY, JSON.stringify(clusters));
}

export async function loadKafkaClusters(): Promise<KafkaClusterConfig[]> {
  const canonical = await readKey(KAFKA_CLUSTERS_KEY);
  if (canonical) {
    const parsed = parseClusters(canonical);
    if (JSON.stringify(parsed) !== canonical) {
      await saveKafkaClusters(parsed);
    }
    return parsed;
  }

  const legacy = await firstKeyHit(LEGACY_KAFKA_CLUSTER_KEYS);
  if (!legacy) {
    return [];
  }

  const parsed = parseClusters(legacy.value);
  await saveKafkaClusters(parsed);
  await removeKey(legacy.key);
  return parsed;
}

export async function saveSelectedKafkaClusterId(clusterId: string | null): Promise<void> {
  if (clusterId && clusterId.trim().length > 0) {
    await writeKey(KAFKA_SELECTED_CLUSTER_KEY, clusterId.trim());
    return;
  }
  await removeKey(KAFKA_SELECTED_CLUSTER_KEY);
}

export async function loadSelectedKafkaClusterId(): Promise<string | null> {
  const selected = await readKey(KAFKA_SELECTED_CLUSTER_KEY);
  if (selected && selected.trim().length > 0) {
    return selected.trim();
  }
  if (selected != null) {
    await removeKey(KAFKA_SELECTED_CLUSTER_KEY);
  }

  const legacy = await firstKeyHit(LEGACY_KAFKA_SELECTED_CLUSTER_KEYS);
  if (!legacy) {
    return null;
  }

  const trimmed = legacy.value.trim();
  if (trimmed.length === 0) {
    await removeKey(legacy.key);
    return null;
  }

  await writeKey(KAFKA_SELECTED_CLUSTER_KEY, trimmed);
  await removeKey(legacy.key);
  return trimmed;
}

export async function saveKafkaAutoConnectOnStartup(enabled: boolean): Promise<void> {
  await writeKey(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, enabled ? 'true' : 'false');
}

export async function loadKafkaAutoConnectOnStartup(): Promise<boolean> {
  const stored = await readKey(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY);
  if (stored == null) {
    return false;
  }

  const normalized = stored.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  await removeKey(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY);
  return false;
}

// ── Publish / Consume templates ────────────────────────────────────────────

export const KAFKA_PUBLISH_TEMPLATES_KEY = 'perf-test-kafka-publish-templates-v1';
export const KAFKA_CONSUME_TEMPLATES_KEY = 'perf-test-kafka-consume-templates-v1';
/** Last Consume topic per cluster id. Survives an app restart. */
export const KAFKA_CONSUME_TOPICS_KEY = 'perf-test-kafka-consume-topics-v1';

export interface KafkaPublishTemplate {
  id: string;
  name: string;
  createdAt: string;
  draft: KafkaPublishDraft;
}

export interface KafkaConsumeTemplate {
  id: string;
  name: string;
  createdAt: string;
  /**
   * Note: `groupId` is intentionally excluded when loading a template back
   * into the form — each consume session should start with a fresh group ID to
   * avoid inheriting committed offsets from previous sessions.
   */
  draft: KafkaConsumeDraft;
}

function isValidTemplateEntry(entry: unknown): boolean {
  return (
    typeof entry === 'object'
    && entry !== null
    && typeof (entry as Record<string, unknown>).id === 'string'
    && typeof (entry as Record<string, unknown>).name === 'string'
    && typeof (entry as Record<string, unknown>).draft === 'object'
    && (entry as Record<string, unknown>).draft !== null
  );
}

function parseTemplates<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidTemplateEntry) as T[];
  } catch {
    return [];
  }
}

export async function loadKafkaPublishTemplates(): Promise<KafkaPublishTemplate[]> {
  const raw = await readKey(KAFKA_PUBLISH_TEMPLATES_KEY);
  if (!raw) return [];
  return parseTemplates<KafkaPublishTemplate>(raw);
}

export async function saveKafkaPublishTemplates(
  templates: KafkaPublishTemplate[],
): Promise<void> {
  await writeKey(KAFKA_PUBLISH_TEMPLATES_KEY, JSON.stringify(templates));
}

export async function loadKafkaConsumeTemplates(): Promise<KafkaConsumeTemplate[]> {
  const raw = await readKey(KAFKA_CONSUME_TEMPLATES_KEY);
  if (!raw) return [];
  return parseTemplates<KafkaConsumeTemplate>(raw);
}

export async function saveKafkaConsumeTemplates(
  templates: KafkaConsumeTemplate[],
): Promise<void> {
  await writeKey(KAFKA_CONSUME_TEMPLATES_KEY, JSON.stringify(templates));
}

function parseConsumeTopics(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const topics: Record<string, string> = {};
    for (const [clusterId, topic] of Object.entries(parsed)) {
      if (typeof topic === 'string' && topic.trim()) {
        topics[clusterId] = topic.trim();
      }
    }
    return topics;
  } catch {
    return {};
  }
}

export async function loadKafkaConsumeTopic(clusterId: string): Promise<string> {
  const topics = parseConsumeTopics(await readKey(KAFKA_CONSUME_TOPICS_KEY));
  return topics[clusterId] ?? '';
}

export async function saveKafkaConsumeTopic(clusterId: string, topic: string): Promise<void> {
  const topics = parseConsumeTopics(await readKey(KAFKA_CONSUME_TOPICS_KEY));
  const trimmed = topic.trim();
  if (trimmed) {
    topics[clusterId] = trimmed;
  } else {
    delete topics[clusterId];
  }
  if (Object.keys(topics).length === 0) {
    await removeKey(KAFKA_CONSUME_TOPICS_KEY);
    return;
  }
  await writeKey(KAFKA_CONSUME_TOPICS_KEY, JSON.stringify(topics));
}
