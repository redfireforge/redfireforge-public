/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KafkaClusterConfig } from './kafkaConfig';
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
  loadKafkaPublishTemplates,
  loadSelectedKafkaClusterId,
  TAURI_DEMO_APP_ID,
  TAURI_STANDARD_APP_ID,
  type KafkaConsumeTemplate,
  type KafkaPublishTemplate,
} from './kafkaStorage';

const isTauriMock = vi.hoisted(() => vi.fn(() => true));
const readKeyMock = vi.hoisted(() => vi.fn(async () => null as string | null));
const writeKeyMock = vi.hoisted(() => vi.fn(async () => undefined));
const removeKeyMock = vi.hoisted(() => vi.fn(async () => undefined));
const appDataDirMock = vi.hoisted(() => vi.fn(async () => `/Users/me/Library/Application Support/${TAURI_DEMO_APP_ID}/`));
const readTextFileMock = vi.hoisted(() => vi.fn(async () => null as string | null));

vi.mock('../utils/platform', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('../utils/storage', () => ({
  readKey: (key: string) => readKeyMock(key),
  writeKey: (key: string, value: string) => writeKeyMock(key, value),
  removeKey: (key: string) => removeKeyMock(key),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: () => appDataDirMock(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (path: string) => readTextFileMock(path),
}));

const sampleCluster: KafkaClusterConfig = {
  clusterId: 'prod',
  name: 'Prod',
  clientId: 'redfireforge-prod',
  brokers: ['kafka.example:9092'],
  auth: { mode: 'none' },
  tls: { enabled: false, rejectUnauthorized: true },
  createdAt: 1,
  updatedAt: 2,
};

describe('kafkaStorage — desktop migration', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    readKeyMock.mockReset().mockResolvedValue(null);
    writeKeyMock.mockReset().mockResolvedValue(undefined);
    removeKeyMock.mockReset().mockResolvedValue(undefined);
    appDataDirMock.mockReset().mockResolvedValue(`/Users/me/Library/Application Support/${TAURI_DEMO_APP_ID}/`);
    readTextFileMock.mockReset().mockResolvedValue(null);
    localStorage.clear();
  });

  it('imports clusters from webview localStorage when the Tauri store is empty', async () => {
    localStorage.setItem(KAFKA_CLUSTERS_KEY, JSON.stringify([sampleCluster]));

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].clusterId).toBe('prod');
    expect(writeKeyMock).toHaveBeenCalledWith(KAFKA_CLUSTERS_KEY, expect.any(String));
    expect(localStorage.getItem(KAFKA_CLUSTERS_KEY)).toBeNull();
  });

  it('imports clusters from the sibling Standard app data folder on Learning Hub builds', async () => {
    const siblingPath = `/Users/me/Library/Application Support/${TAURI_STANDARD_APP_ID}/perf-test-kafka-clusters-v1.json`;
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path === siblingPath) {
        return JSON.stringify([sampleCluster]);
      }
      return null;
    });

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(readTextFileMock).toHaveBeenCalledWith(siblingPath);
    expect(writeKeyMock).toHaveBeenCalledWith(KAFKA_CLUSTERS_KEY, expect.any(String));
  });

  it('imports selected cluster id from sibling app data', async () => {
    const siblingPath = `/Users/me/Library/Application Support/${TAURI_STANDARD_APP_ID}/perf-test-kafka-selected-cluster-id.json`;
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path === siblingPath) return 'prod';
      return null;
    });

    const selected = await loadSelectedKafkaClusterId();

    expect(selected).toBe('prod');
    expect(writeKeyMock).toHaveBeenCalledWith(KAFKA_SELECTED_CLUSTER_KEY, 'prod');
  });

  it('imports clusters from the sibling Learning Hub folder on Standard builds', async () => {
    appDataDirMock.mockResolvedValue(
      `/Users/me/Library/Application Support/${TAURI_STANDARD_APP_ID}/`,
    );
    const siblingPath = `/Users/me/Library/Application Support/${TAURI_DEMO_APP_ID}/perf-test-kafka-clusters-v1.json`;
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path === siblingPath) return JSON.stringify([sampleCluster]);
      return null;
    });

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(readTextFileMock).toHaveBeenCalledWith(siblingPath);
  });

  it('ignores sibling reads when app data path is unrecognized', async () => {
    appDataDirMock.mockResolvedValue('/tmp/unknown-app-id/');
    localStorage.setItem(KAFKA_CLUSTERS_KEY, JSON.stringify([sampleCluster]));

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(readTextFileMock).not.toHaveBeenCalled();
  });

  it('treats sibling read failures as missing data', async () => {
    readTextFileMock.mockRejectedValue(new Error('ENOENT'));
    localStorage.setItem(KAFKA_CLUSTERS_KEY, JSON.stringify([sampleCluster]));

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
  });

  it('imports auto-connect preference from webview localStorage', async () => {
    localStorage.setItem(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, 'true');

    expect(await loadKafkaAutoConnectOnStartup()).toBe(true);
    expect(writeKeyMock).toHaveBeenCalledWith(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, 'true');
    expect(localStorage.getItem(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY)).toBeNull();
  });

  it('imports auto-connect false from webview localStorage', async () => {
    localStorage.setItem(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, 'false');

    expect(await loadKafkaAutoConnectOnStartup()).toBe(false);
    expect(writeKeyMock).toHaveBeenCalledWith(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, 'false');
  });

  it('returns false for malformed auto-connect values in webview localStorage', async () => {
    localStorage.setItem(KAFKA_AUTO_CONNECT_ON_STARTUP_KEY, 'maybe');

    expect(await loadKafkaAutoConnectOnStartup()).toBe(false);
  });

  it('imports publish templates from webview localStorage', async () => {
    const template: KafkaPublishTemplate = {
      id: 'tpl-1',
      name: 'Orders',
      createdAt: '2026-10-20T00:00:00.000Z',
      draft: {
        topic: 'orders',
        key: '',
        partition: '',
        acks: -1,
        timeoutMs: '5000',
        headers: [],
        body: '{}',
      },
    };
    localStorage.setItem(KAFKA_PUBLISH_TEMPLATES_KEY, JSON.stringify([template]));

    const loaded = await loadKafkaPublishTemplates();

    expect(loaded).toHaveLength(1);
    expect(writeKeyMock).toHaveBeenCalledWith(
      KAFKA_PUBLISH_TEMPLATES_KEY,
      expect.any(String),
    );
    expect(localStorage.getItem(KAFKA_PUBLISH_TEMPLATES_KEY)).toBeNull();
  });

  it('imports consume templates from webview localStorage', async () => {
    const template: KafkaConsumeTemplate = {
      id: 'tpl-c-1',
      name: 'Watch',
      createdAt: '2026-10-20T00:00:00.000Z',
      draft: {
        topic: 'orders',
        groupId: 'g1',
        startPosition: 'latest',
        timeoutMs: '5000',
        maxMessages: '10',
        keyEquals: '',
        headerMatch: '',
        jsonPath: '',
        jsonPathEquals: '',
        bodyContains: '',
      },
    };
    localStorage.setItem(KAFKA_CONSUME_TEMPLATES_KEY, JSON.stringify([template]));

    const loaded = await loadKafkaConsumeTemplates();

    expect(loaded).toHaveLength(1);
    expect(writeKeyMock).toHaveBeenCalledWith(
      KAFKA_CONSUME_TEMPLATES_KEY,
      expect.any(String),
    );
  });

  it('imports consume forms from webview localStorage', async () => {
    localStorage.setItem(KAFKA_CONSUME_FORMS_KEY, JSON.stringify({
      prod: {
        topic: ' orders ',
        groupId: ' g ',
        startPosition: 'earliest',
        timeoutMs: ' 10 ',
        maxMessages: ' 5 ',
        bodyContains: 'open',
        sortOrder: 'desc',
        schemaConfig: {
          registryUrl: 'http://schema',
          format: 'avro',
          subject: 'orders-value',
          version: 3,
          auth: { username: 'user', password: 'secret' },
        },
      },
    }));

    const saved = await loadKafkaConsumeForm('prod');

    expect(saved?.topic).toBe('orders');
    expect(saved?.schemaConfig?.subject).toBe('orders-value');
    expect(saved?.schemaConfig?.version).toBe(3);
    expect(saved?.schemaConfig?.auth?.username).toBe('user');
    expect(writeKeyMock).toHaveBeenCalledWith(KAFKA_CONSUME_FORMS_KEY, expect.any(String));
    expect(localStorage.getItem(KAFKA_CONSUME_FORMS_KEY)).toBeNull();
  });

  it('does not rewrite consume forms when the imported payload has none', async () => {
    localStorage.setItem(KAFKA_CONSUME_FORMS_KEY, '[]');

    expect(await loadKafkaConsumeForm('prod')).toBeNull();
    expect(writeKeyMock).not.toHaveBeenCalledWith(KAFKA_CONSUME_FORMS_KEY, expect.any(String));
  });

  it('imports consume topics from webview localStorage', async () => {
    localStorage.setItem(
      KAFKA_CONSUME_TOPICS_KEY,
      JSON.stringify({ prod: '  sales-offer  ', other: '   ' }),
    );

    expect(await loadKafkaConsumeTopic('prod')).toBe('sales-offer');
    expect(writeKeyMock).toHaveBeenCalledWith(
      KAFKA_CONSUME_TOPICS_KEY,
      JSON.stringify({ prod: 'sales-offer' }),
    );
    expect(localStorage.getItem(KAFKA_CONSUME_TOPICS_KEY)).toBeNull();
  });

  it('skips rewriting consume topics when imported map is empty', async () => {
    localStorage.setItem(KAFKA_CONSUME_TOPICS_KEY, JSON.stringify({ empty: '   ' }));

    expect(await loadKafkaConsumeTopic('empty')).toBe('');
    expect(writeKeyMock).not.toHaveBeenCalledWith(
      KAFKA_CONSUME_TOPICS_KEY,
      expect.any(String),
    );
  });

  it('removes legacy primary cluster key after migration', async () => {
    const legacyKey = 'perf-test-kafka-clusters';
    readKeyMock.mockImplementation(async (key: string) => {
      if (key === KAFKA_CLUSTERS_KEY) return null;
      if (key === legacyKey) return JSON.stringify([sampleCluster]);
      return null;
    });

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(removeKeyMock).toHaveBeenCalledWith(legacyKey);
  });

  it('returns canonical clusters without re-save when primary payload is already normalized', async () => {
    const canonical = JSON.stringify([sampleCluster]);
    readKeyMock.mockImplementation(async (key: string) => {
      if (key === KAFKA_CLUSTERS_KEY) return canonical;
      return null;
    });

    const loaded = await loadKafkaClusters();

    expect(loaded).toHaveLength(1);
    expect(writeKeyMock).not.toHaveBeenCalled();
  });
});
