/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KAFKA_AUTO_CONNECT_ON_STARTUP_KEY,
  KAFKA_CLUSTERS_KEY,
  KAFKA_CONSUME_FORMS_KEY,
  KAFKA_CONSUME_TEMPLATES_KEY,
  KAFKA_CONSUME_TOPICS_KEY,
  KAFKA_PUBLISH_TEMPLATES_KEY,
  KAFKA_SELECTED_CLUSTER_KEY,
  loadKafkaAutoConnectOnStartup,
  loadKafkaClusters,
  loadKafkaConsumeForm,
  loadKafkaConsumeTemplates,
  loadKafkaConsumeTopic,
  loadKafkaPublishForm,
  loadKafkaPublishTemplates,
  loadSelectedKafkaClusterId,
  saveKafkaAutoConnectOnStartup,
  saveKafkaClusters,
  saveKafkaConsumeForm,
  saveKafkaConsumeTemplates,
  saveKafkaConsumeTopic,
  saveKafkaPublishForm,
  saveKafkaPublishTemplates,
  saveSelectedKafkaClusterId,
  type KafkaConsumeTemplate,
  type KafkaPublishTemplate,
} from './kafkaStorage';
import type { KafkaClusterConfig } from './kafkaConfig';

const LEGACY_CLUSTER_KEY = 'perf-test-kafka-clusters';
const LEGACY_SELECTED_KEY = 'perf-test-kafka-selected-cluster';

const sampleCluster: KafkaClusterConfig = {
  clusterId: 'local-dev',
  name: 'Local Dev',
  clientId: 'redfireforge-local-dev',
  brokers: ['127.0.0.1:19092'],
  auth: { mode: 'none' },
  tls: { enabled: false, rejectUnauthorized: true },
  createdAt: 1,
  updatedAt: 2,
};

beforeEach(() => {
  localStorage.clear();
});

describe('kafkaStorage', () => {
  it('saves and loads clusters via canonical key', async () => {
    await saveKafkaClusters([sampleCluster]);

    const loaded = await loadKafkaClusters();
    expect(loaded).toEqual([sampleCluster]);
  });

  it('migrates legacy cluster payload and normalizes shape', async () => {
    localStorage.setItem(LEGACY_CLUSTER_KEY, JSON.stringify([
      {
        id: 'legacy-cluster',
        brokers: '127.0.0.1:19092, 127.0.0.1:19092',
        authMode: 'plain',
        username: 'legacy-user',
        password: 'legacy-pass',
      },
      {
        id: 'legacy-cluster',
        brokers: ['127.0.0.1:19093'],
        auth: { mode: 'none' },
      },
      {
        id: 'invalid-entry',
        brokers: [],
      },
    ]));

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].clusterId).toBe('legacy-cluster');
    expect(loaded[0].brokers).toEqual(['127.0.0.1:19093']);
    expect(loaded[0].name).toBe('legacy-cluster');
    expect(localStorage.getItem(LEGACY_CLUSTER_KEY)).toBeNull();
    expect(localStorage.getItem(KAFKA_CLUSTERS_KEY)).not.toBeNull();
  });

  it('returns empty clusters on malformed persisted payload', async () => {
    localStorage.setItem(KAFKA_CLUSTERS_KEY, '{broken-json');

    const loaded = await loadKafkaClusters();
    expect(loaded).toEqual([]);
  });

  it('saves and loads selected cluster id', async () => {
    await saveSelectedKafkaClusterId('local-dev');
    expect(await loadSelectedKafkaClusterId()).toBe('local-dev');

    await saveSelectedKafkaClusterId(null);
    expect(await loadSelectedKafkaClusterId()).toBeNull();
  });

  it('migrates legacy selected-cluster key to canonical key', async () => {
    localStorage.setItem(LEGACY_SELECTED_KEY, 'legacy-selected');

    const selected = await loadSelectedKafkaClusterId();
    expect(selected).toBe('legacy-selected');
    expect(localStorage.getItem(LEGACY_SELECTED_KEY)).toBeNull();
    expect(localStorage.getItem(KAFKA_SELECTED_CLUSTER_KEY)).toBe('legacy-selected');
  });

  it('removes blank canonical selected-cluster value', async () => {
    localStorage.setItem(KAFKA_SELECTED_CLUSTER_KEY, '   ');

    const selected = await loadSelectedKafkaClusterId();
    expect(selected).toBeNull();
    expect(localStorage.getItem(KAFKA_SELECTED_CLUSTER_KEY)).toBeNull();
  });

  it('saves and loads startup auto-connect preference', async () => {
    await saveKafkaAutoConnectOnStartup(true);
    expect(await loadKafkaAutoConnectOnStartup()).toBe(true);

    await saveKafkaAutoConnectOnStartup(false);
    expect(await loadKafkaAutoConnectOnStartup()).toBe(false);
  });

  it('normalizes malformed startup auto-connect value to false', async () => {
    localStorage.setItem(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, 'sometimes');

    expect(await loadKafkaAutoConnectOnStartup()).toBe(false);
    expect(localStorage.getItem(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY)).toBeNull();
  });
});

// ── additional branch coverage ──────────────────────────────────────────────

describe('kafkaStorage – parseClusters non-array JSON (line 53)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns empty array when stored JSON is a valid object (not array)', async () => {
    // JSON.parse succeeds but !Array.isArray → hits the line 53 return []
    localStorage.setItem(KAFKA_CLUSTERS_KEY, JSON.stringify({ clusterId: 'x' }));
    const clusters = await loadKafkaClusters();
    expect(clusters).toEqual([]);
  });
});

describe('kafkaStorage – no data at all (line 87)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns empty array when both canonical and legacy keys are absent', async () => {
    // Nothing in storage → firstKeyHit returns null → hits line 87 return []
    const clusters = await loadKafkaClusters();
    expect(clusters).toEqual([]);
  });
});

describe('kafkaStorage – re-normalisation on mismatch (line 80)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('re-saves clusters when normalisation changes the canonical form', async () => {
    const rawCluster = {
      clusterId: 'c-resave',
      name: 'Resave Test',
      clientId: 'ci',
      brokers: ['127.0.0.1:9092'],
      auth: { mode: 'none' },
      tls: { enabled: false },
      createdAt: 1000,
      updatedAt: 1000,
      __extra: 'stripped',
    };
    localStorage.setItem(KAFKA_CLUSTERS_KEY, JSON.stringify([rawCluster]));

    const clusters = await loadKafkaClusters();
    expect(clusters.length).toBe(1);
    expect(clusters[0].clusterId).toBe('c-resave');
    const storedAfter = localStorage.getItem(KAFKA_CLUSTERS_KEY);
    expect(storedAfter).not.toContain('__extra');
  });
});

describe('kafkaStorage – loadKafkaAutoConnectOnStartup with null key (line 136)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns false when auto-connect key is absent (null stored)', async () => {
    // No key set → readKey returns null → hits line 136 return false
    const result = await loadKafkaAutoConnectOnStartup();
    expect(result).toBe(false);
  });
});

describe('kafkaStorage – legacy selected-cluster migration (lines 120-121, 136)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('migrates a valid legacy selected-cluster ID to the new key', async () => {
    const LEGACY_SEL = 'perf-test-kafka-selected-cluster';
    localStorage.setItem(LEGACY_SEL, '  legacy-cluster-id  ');

    const selected = await loadSelectedKafkaClusterId();
    expect(selected).toBe('legacy-cluster-id');
    expect(localStorage.getItem(KAFKA_SELECTED_CLUSTER_KEY)).toBe('legacy-cluster-id');
    expect(localStorage.getItem(LEGACY_SEL)).toBeNull();
  });

  it('removes legacy selected-cluster key when the stored value is blank', async () => {
    const LEGACY_SEL = 'perf-test-kafka-selected-cluster';
    localStorage.setItem(LEGACY_SEL, '   ');

    const selected = await loadSelectedKafkaClusterId();
    expect(selected).toBeNull();
    expect(localStorage.getItem(LEGACY_SEL)).toBeNull();
  });
});

// ── Template storage ───────────────────────────────────────────────────────

const samplePublishTemplate: KafkaPublishTemplate = {
  id: 'tpl-pub-1',
  name: 'Place Order Event',
  createdAt: '2026-06-05T10:00:00.000Z',
  draft: {
    topic: 'orders.created',
    key: 'customer-123',
    partition: '',
    acks: -1,
    timeoutMs: '5000',
    headers: [{ id: 'h1', key: 'x-source', value: 'studio', enabled: true }],
    body: '{"orderId":"abc"}',
  },
};

const sampleConsumeTemplate: KafkaConsumeTemplate = {
  id: 'tpl-con-1',
  name: 'Watch Orders',
  createdAt: '2026-06-05T10:00:00.000Z',
  draft: {
    topic: 'orders.created',
    groupId: 'redfireforge-debug-stored',
    startPosition: 'earliest',
    timeoutMs: '5000',
    maxMessages: '20',
    keyEquals: '',
    headerMatch: '',
    jsonPath: '',
    jsonPathEquals: '',
    bodyContains: '',
  },
};

describe('kafkaStorage – publish templates', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns empty array when no templates stored', async () => {
    expect(await loadKafkaPublishTemplates()).toEqual([]);
  });

  it('saves and loads publish templates', async () => {
    await saveKafkaPublishTemplates([samplePublishTemplate]);
    const loaded = await loadKafkaPublishTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('tpl-pub-1');
    expect(loaded[0].draft.topic).toBe('orders.created');
  });

  it('overwrites templates on re-save', async () => {
    await saveKafkaPublishTemplates([samplePublishTemplate]);
    const second: KafkaPublishTemplate = { ...samplePublishTemplate, id: 'tpl-pub-2', name: 'Second' };
    await saveKafkaPublishTemplates([samplePublishTemplate, second]);
    const loaded = await loadKafkaPublishTemplates();
    expect(loaded).toHaveLength(2);
  });

  it('returns empty array for malformed stored JSON', async () => {
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, '{bad json}');
    expect(await loadKafkaPublishTemplates()).toEqual([]);
  });

  it('returns empty array when stored JSON is an object (not array)', async () => {
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, JSON.stringify({ id: 'x' }));
    expect(await loadKafkaPublishTemplates()).toEqual([]);
  });

  it('saves empty array (clears all templates)', async () => {
    await saveKafkaPublishTemplates([samplePublishTemplate]);
    await saveKafkaPublishTemplates([]);
    expect(await loadKafkaPublishTemplates()).toEqual([]);
  });

  it('filters out entries with missing id field', async () => {
    const corrupt = JSON.stringify([
      { name: 'No ID', draft: { topic: 'x' } },
      samplePublishTemplate,
    ]);
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, corrupt);
    const loaded = await loadKafkaPublishTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('tpl-pub-1');
  });

  it('filters out entries with missing name field', async () => {
    const corrupt = JSON.stringify([
      { id: 'x', draft: { topic: 'x' } },
      samplePublishTemplate,
    ]);
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, corrupt);
    const loaded = await loadKafkaPublishTemplates();
    expect(loaded).toHaveLength(1);
  });

  it('filters out entries with null draft', async () => {
    const corrupt = JSON.stringify([
      { id: 'x', name: 'Bad', draft: null },
      samplePublishTemplate,
    ]);
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, corrupt);
    const loaded = await loadKafkaPublishTemplates();
    expect(loaded).toHaveLength(1);
  });

  it('filters out non-object entries from array', async () => {
    const corrupt = JSON.stringify([
      'just a string',
      42,
      null,
      samplePublishTemplate,
    ]);
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, corrupt);
    const loaded = await loadKafkaPublishTemplates();
    expect(loaded).toHaveLength(1);
  });
});

describe('kafkaStorage – consume templates', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns empty array when no templates stored', async () => {
    expect(await loadKafkaConsumeTemplates()).toEqual([]);
  });

  it('saves and loads consume templates', async () => {
    await saveKafkaConsumeTemplates([sampleConsumeTemplate]);
    const loaded = await loadKafkaConsumeTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('tpl-con-1');
    expect(loaded[0].draft.topic).toBe('orders.created');
  });

  it('overwrites templates on re-save', async () => {
    await saveKafkaConsumeTemplates([sampleConsumeTemplate]);
    const second: KafkaConsumeTemplate = { ...sampleConsumeTemplate, id: 'tpl-con-2', name: 'Second' };
    await saveKafkaConsumeTemplates([sampleConsumeTemplate, second]);
    const loaded = await loadKafkaConsumeTemplates();
    expect(loaded).toHaveLength(2);
  });

  it('returns empty array for malformed stored JSON', async () => {
    localStorage.setItem(KAFKA_CONSUME_TEMPLATES_KEY, 'not-json');
    expect(await loadKafkaConsumeTemplates()).toEqual([]);
  });

  it('saves empty array (clears all templates)', async () => {
    await saveKafkaConsumeTemplates([sampleConsumeTemplate]);
    await saveKafkaConsumeTemplates([]);
    expect(await loadKafkaConsumeTemplates()).toEqual([]);
  });
});

describe('kafkaStorage – consume topic', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns an empty topic when nothing is stored', async () => {
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('');
  });

  it('saves and loads the topic for one cluster', async () => {
    await saveKafkaConsumeTopic('cluster-a', '  222043-sales-offer  ');
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('222043-sales-offer');
    expect(await loadKafkaConsumeTopic('cluster-b')).toBe('');
  });

  it('keeps other clusters when one topic is cleared', async () => {
    await saveKafkaConsumeTopic('cluster-a', 'orders');
    await saveKafkaConsumeTopic('cluster-b', 'payments');
    await saveKafkaConsumeTopic('cluster-a', '   ');
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('');
    expect(await loadKafkaConsumeTopic('cluster-b')).toBe('payments');
  });

  it('removes the key when the last topic is cleared', async () => {
    await saveKafkaConsumeTopic('cluster-a', 'orders');
    await saveKafkaConsumeTopic('cluster-a', '');
    expect(localStorage.getItem(KAFKA_CONSUME_TOPICS_KEY)).toBeNull();
  });

  it('saves and loads the consume form, including filters', async () => {
    await saveKafkaConsumeForm('cluster-a', {
      topic: 'orders',
      groupId: 'group-1',
      startPosition: 'earliest',
      timeoutMs: '100000',
      maxMessages: '500',
      keyEquals: 'k',
      headerMatch: 'h=v',
      jsonPath: '$.event.header.name',
      jsonPathEquals: 'OrderCreated',
      bodyContains: 'status',
      sortOrder: 'desc',
      schemaConfig: { registryUrl: 'http://schema', format: 'json-schema', auth: { username: 'u', password: 'p' } },
    });
    const saved = await loadKafkaConsumeForm('cluster-a');
    expect(saved?.jsonPathEquals).toBe('OrderCreated');
    expect(saved?.bodyContains).toBe('status');
    expect(saved?.sortOrder).toBe('desc');
    expect(saved?.schemaConfig?.auth?.username).toBe('u');
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('orders');
    expect(await loadKafkaConsumeForm('cluster-b')).toBeNull();
  });

  it('drops optional schema fields that are blank or the wrong type', async () => {
    await saveKafkaConsumeForm('cluster-a', {
      topic: 'orders',
      groupId: 'group-1',
      startPosition: 'latest',
      timeoutMs: '1000',
      maxMessages: '10',
      keyEquals: '',
      headerMatch: '',
      jsonPath: '',
      jsonPathEquals: '',
      bodyContains: '',
      sortOrder: 'asc',
      schemaConfig: {
        registryUrl: 'http://schema',
        format: 'protobuf',
        subject: '   ',
        version: Number.NaN,
        auth: { username: 'user' },
      } as never,
    });
    const saved = await loadKafkaConsumeForm('cluster-a');
    expect(saved?.startPosition).toBe('latest');
    expect(saved?.sortOrder).toBe('asc');
    expect(saved?.schemaConfig).toEqual({ registryUrl: 'http://schema', format: 'protobuf' });

    localStorage.setItem(KAFKA_CONSUME_FORMS_KEY, JSON.stringify({
      'cluster-a': {
        topic: 'orders',
        schemaConfig: { format: 'avro', registryUrl: 4, version: Number.POSITIVE_INFINITY, auth: ['user'] },
      },
    }));
    expect((await loadKafkaConsumeForm('cluster-a'))?.schemaConfig).toBeUndefined();
    localStorage.setItem(KAFKA_CONSUME_FORMS_KEY, 'null');
    localStorage.removeItem(KAFKA_CONSUME_TOPICS_KEY);
    expect(await loadKafkaConsumeForm('cluster-a')).toBeNull();
  });

  it('falls back to a previously saved topic when no form exists', async () => {
    await saveKafkaConsumeTopic('cluster-a', 'legacy-topic');
    const saved = await loadKafkaConsumeForm('cluster-a');
    expect(saved?.topic).toBe('legacy-topic');
    expect(saved?.jsonPath).toBe('');
  });

  it('ignores a malformed consume form and keeps a valid sibling', async () => {
    localStorage.setItem(KAFKA_CONSUME_FORMS_KEY, 'not-json');
    expect(await loadKafkaConsumeForm('cluster-a')).toBeNull();
    localStorage.setItem(KAFKA_CONSUME_FORMS_KEY, JSON.stringify({
      'cluster-a': { topic: 'orders', jsonPath: 4, startPosition: 'nope', schemaConfig: { format: 'xml' } },
      'cluster-b': 'bad',
    }));
    const saved = await loadKafkaConsumeForm('cluster-a');
    expect(saved?.topic).toBe('orders');
    expect(saved?.jsonPath).toBe('');
    expect(saved?.startPosition).toBe('latest');
    expect(saved?.schemaConfig).toBeUndefined();
    expect(await loadKafkaConsumeForm('cluster-b')).toBeNull();
  });

  it('saves and restores a publish form for one cluster', async () => {
    await saveKafkaPublishForm('cluster-a', {
      topic: 'orders.events',
      key: 'order-1',
      keyFormat: 'string',
      partition: '2',
      acks: 1,
      timeoutMs: '30000',
      headers: [
        { id: 'h-1', key: 'application.name', value: 'ons-enrollment-core', enabled: true },
        { id: '', key: '', value: '', enabled: true },
      ],
      body: '{"ok":true}',
      bodyFormat: 'json',
      schemaConfig: { registryUrl: 'http://schema', format: 'avro' },
    });
    const saved = await loadKafkaPublishForm('cluster-a');
    expect(saved?.topic).toBe('orders.events');
    expect(saved?.headers).toEqual([
      { id: 'h-1', key: 'application.name', value: 'ons-enrollment-core', enabled: true },
    ]);
    expect(saved?.acks).toBe(1);
    expect(saved?.schemaConfig?.format).toBe('avro');
    expect(await loadKafkaPublishForm('cluster-b')).toBeNull();
    expect(await loadKafkaPublishForm('')).toBeNull();
  });

  it('repairs a malformed publish form and keeps a valid sibling', async () => {
    localStorage.setItem('perf-test-kafka-publish-forms-v1', JSON.stringify({
      'cluster-a': {
        topic: ' orders ',
        acks: 9,
        keyFormat: 'nope',
        bodyFormat: 'hex',
        headers: [{ key: 'trace', value: 12, enabled: false }, 'bad', { key: '', value: '' }],
      },
      'cluster-b': 'bad',
    }));
    const saved = await loadKafkaPublishForm('cluster-a');
    expect(saved?.topic).toBe('orders');
    expect(saved?.acks).toBe(-1);
    expect(saved?.keyFormat).toBe('string');
    expect(saved?.bodyFormat).toBe('hex');
    expect(saved?.headers).toEqual([
      { id: 'h-restored-0', key: 'trace', value: '12', enabled: false },
    ]);
    expect(await loadKafkaPublishForm('cluster-b')).toBeNull();
    localStorage.setItem('perf-test-kafka-publish-forms-v1', 'not-json');
    expect(await loadKafkaPublishForm('cluster-a')).toBeNull();
  });

  it('ignores malformed stored topics', async () => {
    localStorage.setItem(KAFKA_CONSUME_TOPICS_KEY, 'not-json');
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('');
    localStorage.setItem(KAFKA_CONSUME_TOPICS_KEY, '["orders"]');
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('');
    localStorage.setItem(KAFKA_CONSUME_TOPICS_KEY, JSON.stringify({ 'cluster-a': '  ', 'cluster-b': 4 }));
    expect(await loadKafkaConsumeTopic('cluster-a')).toBe('');
    expect(await loadKafkaConsumeTopic('cluster-b')).toBe('');
  });
});
