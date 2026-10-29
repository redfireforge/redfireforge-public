import { readKey, removeKey, writeKey } from '../utils/storage';
import { isTauri } from '../utils/platform';
import { normalizeKafkaClusterConfig, type KafkaClusterConfig } from './kafkaConfig';
import type { KafkaSchemaConfig } from './kafkaClient';
import type { KafkaConsumeDraft, KafkaPublishDraft } from '../../features/kafka/types';

/** Tauri bundle IDs — each build keeps its own Application Support folder. */
export const TAURI_STANDARD_APP_ID = 'com.redfireforge.desktop';
export const TAURI_DEMO_APP_ID = 'com.redfireforge.desktop.demo';

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

type StorageHitSource = 'primary' | 'localStorage' | 'sibling';

interface KeyValueHit {
  key: string;
  value: string;
  source: StorageHitSource;
}

function readWebLocalStorageKey(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(key);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function clearWebLocalStorageKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function readSiblingAppDataValue(key: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const currentDir = (await appDataDir()).replace(/\\/g, '/');
    let siblingDir: string | null = null;
    if (currentDir.includes(TAURI_DEMO_APP_ID)) {
      siblingDir = currentDir.replace(TAURI_DEMO_APP_ID, TAURI_STANDARD_APP_ID);
    } else if (currentDir.includes(TAURI_STANDARD_APP_ID)) {
      siblingDir = currentDir.replace(TAURI_STANDARD_APP_ID, TAURI_DEMO_APP_ID);
    }
    if (!siblingDir || siblingDir === currentDir) return null;
    const sep = siblingDir.endsWith('/') ? '' : '/';
    return await readTextFile(`${siblingDir}${sep}${key}.json`);
  } catch {
    return null;
  }
}

/** Primary store first, then webview localStorage and sibling Tauri app data (desktop upgrades). */
async function firstKeyHit(keys: readonly string[]): Promise<KeyValueHit | null> {
  for (const key of keys) {
    const value = await readKey(key);
    if (value) {
      return { key, value, source: 'primary' };
    }
  }
  if (!isTauri()) {
    return null;
  }
  for (const key of keys) {
    const value = readWebLocalStorageKey(key);
    if (value) {
      return { key, value, source: 'localStorage' };
    }
  }
  for (const key of keys) {
    const value = await readSiblingAppDataValue(key);
    if (value) {
      return { key, value, source: 'sibling' };
    }
  }
  return null;
}

async function finalizeImportedKey(hit: KeyValueHit, canonicalKey: string): Promise<void> {
  if (hit.source === 'localStorage') {
    clearWebLocalStorageKey(hit.key);
    return;
  }
  if (hit.source === 'primary' && hit.key !== canonicalKey) {
    await removeKey(hit.key);
  }
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
  const hit = await firstKeyHit([KAFKA_CLUSTERS_KEY, ...LEGACY_KAFKA_CLUSTER_KEYS]);
  if (!hit) {
    return [];
  }

  const parsed = parseClusters(hit.value);
  if (hit.key === KAFKA_CLUSTERS_KEY && hit.source === 'primary') {
    if (JSON.stringify(parsed) !== hit.value) {
      await saveKafkaClusters(parsed);
    }
    return parsed;
  }

  await saveKafkaClusters(parsed);
  await finalizeImportedKey(hit, KAFKA_CLUSTERS_KEY);
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
  const hit = await firstKeyHit([KAFKA_SELECTED_CLUSTER_KEY, ...LEGACY_KAFKA_SELECTED_CLUSTER_KEYS]);
  if (!hit) {
    return null;
  }

  const trimmed = hit.value.trim();
  if (trimmed.length === 0) {
    if (hit.source === 'primary') {
      await removeKey(hit.key);
    }
    return null;
  }

  if (hit.key === KAFKA_SELECTED_CLUSTER_KEY && hit.source === 'primary') {
    return trimmed;
  }

  await writeKey(KAFKA_SELECTED_CLUSTER_KEY, trimmed);
  await finalizeImportedKey(hit, KAFKA_SELECTED_CLUSTER_KEY);
  return trimmed;
}

export async function saveKafkaAutoConnectOnStartup(enabled: boolean): Promise<void> {
  await writeKey(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, enabled ? 'true' : 'false');
}

export async function loadKafkaAutoConnectOnStartup(): Promise<boolean> {
  const hit = await firstKeyHit([KAFKA_AUTO_CONNECT_ON_STARTUP_KEY]);
  if (!hit) {
    return false;
  }

  const normalized = hit.value.trim().toLowerCase();
  if (normalized === 'true') {
    if (hit.key !== KAFKA_AUTO_CONNECT_ON_STARTUP_KEY || hit.source !== 'primary') {
      await saveKafkaAutoConnectOnStartup(true);
      await finalizeImportedKey(hit, KAFKA_AUTO_CONNECT_ON_STARTUP_KEY);
    }
    return true;
  }
  if (normalized === 'false') {
    if (hit.key !== KAFKA_AUTO_CONNECT_ON_STARTUP_KEY || hit.source !== 'primary') {
      await saveKafkaAutoConnectOnStartup(false);
      await finalizeImportedKey(hit, KAFKA_AUTO_CONNECT_ON_STARTUP_KEY);
    }
    return false;
  }

  if (hit.source === 'primary') {
    await removeKey(hit.key);
  }
  return false;
}

// ── Publish / Consume templates ────────────────────────────────────────────

export const KAFKA_PUBLISH_TEMPLATES_KEY = 'perf-test-kafka-publish-templates-v1';
export const KAFKA_CONSUME_TEMPLATES_KEY = 'perf-test-kafka-consume-templates-v1';
/** Last Consume topic per cluster id. Survives an app restart. */
export const KAFKA_CONSUME_TOPICS_KEY = 'perf-test-kafka-consume-topics-v1';
export const KAFKA_CONSUME_FORMS_KEY = 'perf-test-kafka-consume-forms-v1';
export const KAFKA_PUBLISH_FORMS_KEY = 'perf-test-kafka-publish-forms-v1';

/** Consume form fields restored after a restart, per cluster. */
export interface KafkaConsumeFormSnapshot {
  topic: string;
  groupId: string;
  startPosition: 'latest' | 'earliest';
  timeoutMs: string;
  maxMessages: string;
  keyEquals: string;
  headerMatch: string;
  jsonPath: string;
  jsonPathEquals: string;
  bodyContains: string;
  sortOrder: 'asc' | 'desc';
  schemaConfig?: KafkaSchemaConfig;
}

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
  const hit = await firstKeyHit([KAFKA_PUBLISH_TEMPLATES_KEY]);
  if (!hit) return [];
  if (hit.key !== KAFKA_PUBLISH_TEMPLATES_KEY || hit.source !== 'primary') {
    const templates = parseTemplates<KafkaPublishTemplate>(hit.value);
    await saveKafkaPublishTemplates(templates);
    await finalizeImportedKey(hit, KAFKA_PUBLISH_TEMPLATES_KEY);
    return templates;
  }
  return parseTemplates<KafkaPublishTemplate>(hit.value);
}

export async function saveKafkaPublishTemplates(
  templates: KafkaPublishTemplate[],
): Promise<void> {
  await writeKey(KAFKA_PUBLISH_TEMPLATES_KEY, JSON.stringify(templates));
}

export async function loadKafkaConsumeTemplates(): Promise<KafkaConsumeTemplate[]> {
  const hit = await firstKeyHit([KAFKA_CONSUME_TEMPLATES_KEY]);
  if (!hit) return [];
  if (hit.key !== KAFKA_CONSUME_TEMPLATES_KEY || hit.source !== 'primary') {
    const templates = parseTemplates<KafkaConsumeTemplate>(hit.value);
    await saveKafkaConsumeTemplates(templates);
    await finalizeImportedKey(hit, KAFKA_CONSUME_TEMPLATES_KEY);
    return templates;
  }
  return parseTemplates<KafkaConsumeTemplate>(hit.value);
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
  const hit = await firstKeyHit([KAFKA_CONSUME_TOPICS_KEY]);
  if (!hit) return '';
  const topics = parseConsumeTopics(hit.value);
  if (hit.key !== KAFKA_CONSUME_TOPICS_KEY || hit.source !== 'primary') {
    if (Object.keys(topics).length > 0) {
      await writeKey(KAFKA_CONSUME_TOPICS_KEY, JSON.stringify(topics));
    }
    await finalizeImportedKey(hit, KAFKA_CONSUME_TOPICS_KEY);
  }
  return topics[clusterId] ?? '';
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseSchemaConfig(value: unknown): KafkaSchemaConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const format = source.format;
  if (format !== 'avro' && format !== 'protobuf' && format !== 'json-schema') return undefined;
  if (typeof source.registryUrl !== 'string') return undefined;
  const config: KafkaSchemaConfig = { registryUrl: source.registryUrl, format };
  if (typeof source.subject === 'string' && source.subject.trim()) config.subject = source.subject;
  if (typeof source.version === 'number' && Number.isFinite(source.version)) config.version = source.version;
  const auth = source.auth;
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const row = auth as Record<string, unknown>;
    if (typeof row.username === 'string' && typeof row.password === 'string') {
      config.auth = { username: row.username, password: row.password };
    }
  }
  return config;
}

function parseConsumeForm(value: unknown): KafkaConsumeFormSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const schemaConfig = parseSchemaConfig(source.schemaConfig);
  return {
    topic: textField(source.topic).trim(),
    groupId: textField(source.groupId).trim(),
    startPosition: source.startPosition === 'earliest' ? 'earliest' : 'latest',
    timeoutMs: textField(source.timeoutMs).trim(),
    maxMessages: textField(source.maxMessages).trim(),
    keyEquals: textField(source.keyEquals),
    headerMatch: textField(source.headerMatch),
    jsonPath: textField(source.jsonPath),
    jsonPathEquals: textField(source.jsonPathEquals),
    bodyContains: textField(source.bodyContains),
    sortOrder: source.sortOrder === 'desc' ? 'desc' : 'asc',
    ...(schemaConfig ? { schemaConfig } : {}),
  };
}

function parseConsumeForms(raw: string | null): Record<string, KafkaConsumeFormSnapshot> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const forms: Record<string, KafkaConsumeFormSnapshot> = {};
    for (const [clusterId, value] of Object.entries(parsed)) {
      const form = parseConsumeForm(value);
      if (form) forms[clusterId] = form;
    }
    return forms;
  } catch {
    return {};
  }
}

export async function loadKafkaConsumeForm(clusterId: string): Promise<KafkaConsumeFormSnapshot | null> {
  const hit = await firstKeyHit([KAFKA_CONSUME_FORMS_KEY]);
  if (hit) {
    const forms = parseConsumeForms(hit.value);
    if (hit.key !== KAFKA_CONSUME_FORMS_KEY || hit.source !== 'primary') {
      if (Object.keys(forms).length > 0) {
        await writeKey(KAFKA_CONSUME_FORMS_KEY, JSON.stringify(forms));
      }
      await finalizeImportedKey(hit, KAFKA_CONSUME_FORMS_KEY);
    }
    if (forms[clusterId]) return forms[clusterId];
  }
  const topic = await loadKafkaConsumeTopic(clusterId);
  if (!topic) return null;
  return {
    topic,
    groupId: '',
    startPosition: 'latest',
    timeoutMs: '',
    maxMessages: '',
    keyEquals: '',
    headerMatch: '',
    jsonPath: '',
    jsonPathEquals: '',
    bodyContains: '',
    sortOrder: 'asc',
  };
}

export async function saveKafkaConsumeForm(
  clusterId: string,
  draft: KafkaConsumeDraft,
): Promise<void> {
  const hit = await firstKeyHit([KAFKA_CONSUME_FORMS_KEY]);
  const forms = parseConsumeForms(hit?.value ?? null);
  const schemaConfig = parseSchemaConfig(draft.schemaConfig);
  forms[clusterId] = {
    topic: draft.topic.trim(),
    groupId: draft.groupId.trim(),
    startPosition: draft.startPosition === 'earliest' ? 'earliest' : 'latest',
    timeoutMs: draft.timeoutMs.trim(),
    maxMessages: draft.maxMessages.trim(),
    keyEquals: draft.keyEquals,
    headerMatch: draft.headerMatch,
    jsonPath: draft.jsonPath,
    jsonPathEquals: draft.jsonPathEquals,
    bodyContains: draft.bodyContains,
    sortOrder: draft.sortOrder === 'desc' ? 'desc' : 'asc',
    ...(schemaConfig ? { schemaConfig } : {}),
  };
  await writeKey(KAFKA_CONSUME_FORMS_KEY, JSON.stringify(forms));
  await saveKafkaConsumeTopic(clusterId, draft.topic);
}

function parseSerdeFormat(value: unknown, fallback: 'string' | 'json'): 'string' | 'json' | 'base64' | 'hex' {
  if (value === 'string' || value === 'json' || value === 'base64' || value === 'hex') return value;
  return fallback;
}

function parsePublishHeaderList(value: unknown): KafkaPublishDraft['headers'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => parsePublishHeader(row, index))
    .filter((row): row is KafkaPublishDraft['headers'][number] => row !== null);
}

function parsePublishHeader(value: unknown, index: number): KafkaPublishDraft['headers'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const key = textField(row.key);
  const headerValue = row.value == null ? '' : String(row.value);
  if (!key && !headerValue) return null;
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `h-restored-${index}`;
  return { id, key, value: headerValue, enabled: row.enabled !== false };
}

function parsePublishForm(value: unknown): KafkaPublishDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const acks = source.acks === 0 || source.acks === 1 || source.acks === -1 ? source.acks : -1;
  const headers = parsePublishHeaderList(source.headers);
  const deletedHeaders = parsePublishHeaderList(source.deletedHeaders);
  const schemaConfig = parseSchemaConfig(source.schemaConfig);
  return {
    topic: textField(source.topic).trim(),
    key: textField(source.key),
    keyFormat: parseSerdeFormat(source.keyFormat, 'string'),
    partition: textField(source.partition).trim(),
    acks,
    timeoutMs: textField(source.timeoutMs).trim(),
    headers,
    ...(deletedHeaders.length > 0 ? { deletedHeaders } : {}),
    body: textField(source.body),
    bodyFormat: parseSerdeFormat(source.bodyFormat, 'json'),
    ...(source.headersExpanded === false ? { headersExpanded: false as const } : {}),
    ...(schemaConfig ? { schemaConfig } : {}),
  };
}

function parsePublishForms(raw: string | null): Record<string, KafkaPublishDraft> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const forms: Record<string, KafkaPublishDraft> = {};
    for (const [clusterId, value] of Object.entries(parsed)) {
      const form = parsePublishForm(value);
      if (form) forms[clusterId] = form;
    }
    return forms;
  } catch {
    return {};
  }
}

export async function loadKafkaPublishForm(clusterId: string): Promise<KafkaPublishDraft | null> {
  if (!clusterId) return null;
  const hit = await firstKeyHit([KAFKA_PUBLISH_FORMS_KEY]);
  if (!hit) return null;
  const forms = parsePublishForms(hit.value);
  if (hit.key !== KAFKA_PUBLISH_FORMS_KEY || hit.source !== 'primary') {
    if (Object.keys(forms).length > 0) {
      await writeKey(KAFKA_PUBLISH_FORMS_KEY, JSON.stringify(forms));
    }
    await finalizeImportedKey(hit, KAFKA_PUBLISH_FORMS_KEY);
  }
  return forms[clusterId] ?? null;
}

export async function saveKafkaPublishForm(clusterId: string, draft: KafkaPublishDraft): Promise<void> {
  if (!clusterId) return;
  const hit = await firstKeyHit([KAFKA_PUBLISH_FORMS_KEY]);
  const forms = parsePublishForms(hit?.value ?? null);
  const schemaConfig = parseSchemaConfig(draft.schemaConfig);
  forms[clusterId] = {
    topic: draft.topic.trim(),
    key: draft.key,
    keyFormat: parseSerdeFormat(draft.keyFormat, 'string'),
    partition: draft.partition.trim(),
    acks: draft.acks === 0 || draft.acks === 1 ? draft.acks : -1,
    timeoutMs: draft.timeoutMs.trim(),
    headers: draft.headers
      .filter((row) => row.key.trim() || row.value)
      .map((row, index) => ({
        id: row.id.trim() || `h-restored-${index}`,
        key: row.key,
        value: row.value,
        enabled: row.enabled !== false,
      })),
    ...(draft.deletedHeaders && draft.deletedHeaders.length > 0
      ? {
        deletedHeaders: draft.deletedHeaders
          .filter((row) => row.key.trim() || row.value)
          .map((row, index) => ({
            id: row.id.trim() || `h-deleted-${index}`,
            key: row.key,
            value: row.value,
            enabled: row.enabled !== false,
          })),
      }
      : {}),
    body: draft.body,
    bodyFormat: parseSerdeFormat(draft.bodyFormat, 'json'),
    ...(draft.headersExpanded === false ? { headersExpanded: false as const } : {}),
    ...(schemaConfig ? { schemaConfig } : {}),
  };
  await writeKey(KAFKA_PUBLISH_FORMS_KEY, JSON.stringify(forms));
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
