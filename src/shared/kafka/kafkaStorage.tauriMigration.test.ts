/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KafkaClusterConfig } from './kafkaConfig';
import {
  KAFKA_CLUSTERS_KEY,
  KAFKA_SELECTED_CLUSTER_KEY,
  loadKafkaClusters,
  loadSelectedKafkaClusterId,
  TAURI_DEMO_APP_ID,
  TAURI_STANDARD_APP_ID,
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
});
