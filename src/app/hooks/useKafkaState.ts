import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadKafkaAutoConnectOnStartup,
  loadKafkaClusters,
  loadSelectedKafkaClusterId,
  saveKafkaAutoConnectOnStartup,
  saveKafkaClusters,
  saveSelectedKafkaClusterId,
} from '@shared/kafka/kafkaStorage';
import {
  dispatchKafkaOperation,
  type KafkaUiSafeError,
  toKafkaUiSafeError,
} from '@shared/kafka/kafkaClient';
import type {
  KafkaClusterConfig,
  KafkaConnectionSnapshot,
  KafkaConnectionState,
  KafkaTopicSummary,
} from '@shared/kafka/kafkaConfig';

const DEFAULT_CONNECTION_SNAPSHOT: KafkaConnectionSnapshot = {
  state: 'disconnected',
};

const STATUS_POLL_BASE_INTERVAL_MS = 4_000;
const STATUS_POLL_MAX_INTERVAL_MS = 30_000;
const STATUS_POLL_MAX_FAILURE_STREAK = 6;

export interface UseKafkaStateReturn {
  loaded: boolean;
  clusters: KafkaClusterConfig[];
  selectedClusterId: string | null;
  selectedCluster: KafkaClusterConfig | null;
  connection: KafkaConnectionSnapshot;
  lastError: string | null;
  lastErrorDetail: KafkaUiSafeError | null;
  statusPollFailureStreak: number;
  autoConnectOnStartup: boolean;
  setAutoConnectOnStartup: (enabled: boolean) => void;
  topics: KafkaTopicSummary[];
  topicsLoading: boolean;
  topicsError: KafkaUiSafeError | null;
  includeInternalTopics: boolean;
  setIncludeInternalTopics: (enabled: boolean) => void;
  setSelectedClusterId: (clusterId: string | null) => void;
  upsertCluster: (cluster: KafkaClusterConfig) => void;
  removeCluster: (clusterId: string) => void;
  replaceClusters: (clusters: KafkaClusterConfig[]) => void;
  connectSelectedCluster: () => Promise<boolean>;
  disconnectActiveCluster: () => Promise<boolean>;
  testSelectedClusterConnection: () => Promise<boolean>;
  lastTestResult: { ok: boolean; clusterId: string } | null;
  refreshConnectionStatus: (options?: { force?: boolean }) => Promise<void>;
  refreshTopics: () => Promise<void>;
  setConnectionState: (state: KafkaConnectionState, options?: { clusterId?: string; lastError?: string; connectedAt?: string; lastErrorDetail?: KafkaUiSafeError | null }) => void;
  clearError: () => void;
}

function resolveSelectedClusterId(clusters: KafkaClusterConfig[], selectedClusterId: string | null): string | null {
  if (selectedClusterId && clusters.some((cluster) => cluster.clusterId === selectedClusterId)) {
    return selectedClusterId;
  }
  return clusters[0]?.clusterId ?? null;
}

function nextBackoffDelayMs(failureStreak: number): number {
  const bounded = Math.min(Math.max(failureStreak, 0), STATUS_POLL_MAX_FAILURE_STREAK);
  const computed = STATUS_POLL_BASE_INTERVAL_MS * (2 ** bounded);
  return Math.min(computed, STATUS_POLL_MAX_INTERVAL_MS);
}

function toConnectRequest(cluster: KafkaClusterConfig): Record<string, unknown> {
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

function parseConnectionState(raw: unknown): KafkaConnectionState {
  if (raw === 'connected' || raw === 'testing' || raw === 'error') {
    return raw;
  }
  return 'disconnected';
}

function canBrowseTopics(
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
function connectionSnapshotsEqual(
  a: KafkaConnectionSnapshot,
  b: KafkaConnectionSnapshot,
): boolean {
  return a.state === b.state
    && a.clusterId === b.clusterId
    && a.connectedAt === b.connectedAt
    && a.lastError === b.lastError;
}

export function useKafkaState(): UseKafkaStateReturn {
  const [loaded, setLoaded] = useState(false);
  const [clusters, setClusters] = useState<KafkaClusterConfig[]>([]);
  const [selectedClusterId, setSelectedClusterIdState] = useState<string | null>(null);
  const [connection, setConnection] = useState<KafkaConnectionSnapshot>(DEFAULT_CONNECTION_SNAPSHOT);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastErrorDetail, setLastErrorDetail] = useState<KafkaUiSafeError | null>(null);
  const [statusPollFailureStreak, setStatusPollFailureStreak] = useState(0);
  const [autoConnectOnStartup, setAutoConnectOnStartupState] = useState(false);
  const [topics, setTopics] = useState<KafkaTopicSummary[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<KafkaUiSafeError | null>(null);
  const [includeInternalTopics, setIncludeInternalTopicsState] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastTestResult, setLastTestResult] = useState<{ ok: boolean; clusterId: string } | null>(null);

  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.clusterId === selectedClusterId) ?? null,
    [clusters, selectedClusterId],
  );

  const hydratedRef = useRef(false);
  const statusRequestInFlightCountRef = useRef(0);
  const latestStatusRequestIdRef = useRef(0);
  const latestTopicsRequestIdRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusPollFailureStreakRef = useRef(0);
  const startupAutoConnectAttemptedRef = useRef(false);
  const connectOperationInFlightRef = useRef(false);
  const testResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const updateFailureStreak = useCallback((value: number) => {
    const next = Math.min(Math.max(value, 0), STATUS_POLL_MAX_FAILURE_STREAK);
    if (statusPollFailureStreakRef.current === next) {
      return;
    }
    statusPollFailureStreakRef.current = next;
    setStatusPollFailureStreak(next);
  }, []);

  const reportPersistenceError = useCallback((error: unknown) => {
    setLastError(error instanceof Error ? error.message : String(error));
    setLastErrorDetail(null);
  }, []);

  const bumpRefreshNonce = useCallback(() => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  const refreshConnectionStatus = useCallback(async (options?: { force?: boolean }) => {
    if (!selectedClusterId) {
      updateFailureStreak(0);
      setConnection({ state: 'disconnected' });
      setLastErrorDetail(null);
      return;
    }

    if (connectOperationInFlightRef.current && !options?.force) {
      return;
    }

    if (statusRequestInFlightCountRef.current > 0 && !options?.force) {
      return;
    }

    const requestId = latestStatusRequestIdRef.current + 1;
    latestStatusRequestIdRef.current = requestId;
    const requestedClusterId = selectedClusterId;
    statusRequestInFlightCountRef.current += 1;
    try {
      const envelope = await dispatchKafkaOperation<Record<string, unknown>>('status', {
        clusterId: requestedClusterId,
      });

      if (latestStatusRequestIdRef.current !== requestId) {
        return;
      }

      const state = parseConnectionState(envelope.data?.state);
      const clusterIdFromServer = typeof envelope.data?.clusterId === 'string'
        ? envelope.data.clusterId
        : requestedClusterId;
      const connectedAt = typeof envelope.data?.connectedAt === 'string'
        ? envelope.data.connectedAt
        : undefined;

      setConnection((prev) => {
        // A later "disconnected" status is not a new result. Keep the connect
        // failure until the user clears it or a connect succeeds.
        if (state !== 'connected' && prev.state === 'error' && prev.clusterId === requestedClusterId && prev.lastError) {
          return prev;
        }
        const next: KafkaConnectionSnapshot = {
          state,
          clusterId: clusterIdFromServer,
          connectedAt,
        };
        return connectionSnapshotsEqual(prev, next) ? prev : next;
      });
      setLastError((prev) => {
        if (state !== 'connected' && connectionRef.current.state === 'error' && connectionRef.current.clusterId === requestedClusterId && prev) {
          return prev;
        }
        return null;
      });
      setLastErrorDetail((prev) => {
        if (state !== 'connected' && connectionRef.current.state === 'error' && connectionRef.current.clusterId === requestedClusterId && prev) {
          return prev;
        }
        return null;
      });
      if (state === 'connected' || connectionRef.current.state !== 'error') {
        updateFailureStreak(0);
      }
    } catch (error) {
      if (latestStatusRequestIdRef.current !== requestId) {
        return;
      }

      const uiError = toKafkaUiSafeError(error, 'status');
      setConnection((prev) => {
        const next: KafkaConnectionSnapshot = {
          ...prev,
          state: 'error',
          clusterId: requestedClusterId,
          lastError: uiError.message,
        };
        return connectionSnapshotsEqual(prev, next) ? prev : next;
      });
      setLastError(uiError.message);
      setLastErrorDetail(uiError);
      updateFailureStreak(statusPollFailureStreakRef.current + 1);
    } finally {
      statusRequestInFlightCountRef.current = Math.max(statusRequestInFlightCountRef.current - 1, 0);
    }
  }, [selectedClusterId, updateFailureStreak]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [storedClusters, storedSelectedClusterId, storedAutoConnectOnStartup] = await Promise.all([
          loadKafkaClusters(),
          loadSelectedKafkaClusterId(),
          loadKafkaAutoConnectOnStartup(),
        ]);

        if (cancelled) {
          return;
        }

        const resolvedSelectedId = resolveSelectedClusterId(storedClusters, storedSelectedClusterId);
        setClusters(storedClusters);
        setSelectedClusterIdState(resolvedSelectedId);
        setAutoConnectOnStartupState(storedAutoConnectOnStartup);
        setLastError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setClusters([]);
        setSelectedClusterIdState(null);
        reportPersistenceError(error);
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reportPersistenceError]);

  useEffect(() => {
    return () => {
      clearPollTimer();
    };
  }, [clearPollTimer]);

  useEffect(() => {
    return () => {
      if (testResultTimerRef.current) {
        clearTimeout(testResultTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    void saveKafkaClusters(clusters).catch(reportPersistenceError);
  }, [clusters, reportPersistenceError]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    void saveSelectedKafkaClusterId(selectedClusterId).catch(reportPersistenceError);
  }, [selectedClusterId, reportPersistenceError]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    void saveKafkaAutoConnectOnStartup(autoConnectOnStartup).catch(reportPersistenceError);
  }, [autoConnectOnStartup, reportPersistenceError]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    const resolvedSelectedId = resolveSelectedClusterId(clusters, selectedClusterId);
    if (resolvedSelectedId !== selectedClusterId) {
      setSelectedClusterIdState(resolvedSelectedId);
    }
  }, [clusters, selectedClusterId]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    void refreshConnectionStatus({ force: true });
  }, [loaded, selectedClusterId, refreshNonce, refreshConnectionStatus]);

  useEffect(() => {
    if (!loaded || !selectedClusterId) {
      clearPollTimer();
      return;
    }

    let cancelled = false;

    const schedulePoll = (delayMs: number) => {
      clearPollTimer();
      pollTimerRef.current = setTimeout(async () => {
        if (cancelled) {
          return;
        }

        await refreshConnectionStatus();
        if (cancelled) {
          return;
        }

        // Stop polling once the max failure streak is reached to prevent
        // console flooding when the companion server is unreachable.
        // Polling resumes via bumpRefreshNonce() on the next user-triggered
        // action (connect, cluster change, etc.).
        if (statusPollFailureStreakRef.current >= STATUS_POLL_MAX_FAILURE_STREAK) {
          return;
        }

        schedulePoll(nextBackoffDelayMs(statusPollFailureStreakRef.current));
      }, delayMs);
    };

    schedulePoll(nextBackoffDelayMs(statusPollFailureStreakRef.current));

    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [loaded, selectedClusterId, refreshNonce, clearPollTimer, refreshConnectionStatus]);

  const connectionState = connection.state;
  const connectionClusterId = connection.clusterId;

  const refreshTopics = useCallback(async () => {
    const snapshot: KafkaConnectionSnapshot = {
      state: connectionState,
      clusterId: connectionClusterId,
    };
    if (!canBrowseTopics(loaded, selectedClusterId, snapshot)) {
      setTopics([]);
      setTopicsError(null);
      setTopicsLoading(false);
      return;
    }

    const requestId = latestTopicsRequestIdRef.current + 1;
    latestTopicsRequestIdRef.current = requestId;
    setTopicsLoading(true);
    setTopicsError(null);

    try {
      const envelope = await dispatchKafkaOperation<{ clusterId?: string; topics?: KafkaTopicSummary[] }>('topics', {
        clusterId: selectedClusterId,
        includeInternal: includeInternalTopics,
      });

      if (latestTopicsRequestIdRef.current !== requestId) {
        return;
      }

      setTopics(Array.isArray(envelope.data?.topics) ? envelope.data.topics : []);
    } catch (error) {
      if (latestTopicsRequestIdRef.current !== requestId) {
        return;
      }

      setTopics([]);
      setTopicsError(toKafkaUiSafeError(error, 'topics'));
    } finally {
      if (latestTopicsRequestIdRef.current === requestId) {
        setTopicsLoading(false);
      }
    }
  }, [connectionClusterId, connectionState, includeInternalTopics, loaded, selectedClusterId]);

  useEffect(() => {
    const snapshot: KafkaConnectionSnapshot = {
      state: connectionState,
      clusterId: connectionClusterId,
    };
    if (!canBrowseTopics(loaded, selectedClusterId, snapshot)) {
      latestTopicsRequestIdRef.current += 1;
      setTopics([]);
      setTopicsError(null);
      setTopicsLoading(false);
      return;
    }

    void refreshTopics();
    // Intentionally keyed on connection state/clusterId (not the whole snapshot) so
    // status polling does not re-fetch topics every few seconds and spam 5xx in DevTools.
  }, [
    connectionClusterId,
    connectionState,
    includeInternalTopics,
    loaded,
    refreshTopics,
    selectedClusterId,
  ]);

  const setSelectedClusterId = useCallback((clusterId: string | null) => {
    setSelectedClusterIdState(clusterId);
    bumpRefreshNonce();
  }, [bumpRefreshNonce]);

  const setAutoConnectOnStartup = useCallback((enabled: boolean) => {
    setAutoConnectOnStartupState(enabled);
  }, []);

  const setIncludeInternalTopics = useCallback((enabled: boolean) => {
    setIncludeInternalTopicsState(enabled);
  }, []);

  const upsertCluster = useCallback((cluster: KafkaClusterConfig) => {
    setClusters((prev) => {
      const idx = prev.findIndex((item) => item.clusterId === cluster.clusterId);
      if (idx === -1) {
        return [...prev, cluster];
      }
      const next = [...prev];
      next[idx] = cluster;
      return next;
    });
    setSelectedClusterIdState(cluster.clusterId);
    bumpRefreshNonce();
  }, [bumpRefreshNonce]);

  const removeCluster = useCallback((clusterId: string) => {
    setClusters((prev) => prev.filter((cluster) => cluster.clusterId !== clusterId));
    setConnection((prev) => (prev.clusterId !== clusterId ? prev : { state: 'disconnected' }));
    setLastError((prev) => (connection.clusterId === clusterId ? null : prev));
    setLastErrorDetail((prev) => (connection.clusterId === clusterId ? null : prev));
    setTopics((prev) => (connection.clusterId === clusterId ? [] : prev));
    setTopicsError((prev) => (connection.clusterId === clusterId ? null : prev));
    bumpRefreshNonce();
  }, [bumpRefreshNonce, connection.clusterId]);

  const clearAllClusters = useCallback(() => {
    const activeClusterId = connection.clusterId ?? selectedClusterId;
    setClusters([]);
    setSelectedClusterIdState(null);
    setConnection(DEFAULT_CONNECTION_SNAPSHOT);
    setLastError(null);
    setLastErrorDetail(null);
    setTopics([]);
    setTopicsError(null);
    bumpRefreshNonce();
    if (activeClusterId) {
      void dispatchKafkaOperation('disconnect', { clusterId: activeClusterId }).catch(() => {
        /* broker may already be down during demo prep */
      });
    }
  }, [bumpRefreshNonce, connection.clusterId, selectedClusterId]);

  const replaceClusters = useCallback((nextClusters: KafkaClusterConfig[]) => {
    setClusters(nextClusters);
    bumpRefreshNonce();
  }, [bumpRefreshNonce]);

  const connectSelectedCluster = useCallback(async () => {
    if (!selectedCluster) {
      setLastError('No Kafka cluster is selected');
      setLastErrorDetail({
        kind: 'validation',
        code: 'KAFKA_NO_CLUSTER_SELECTED',
        message: 'No Kafka cluster is selected',
        retryable: false,
      });
      return false;
    }

    connectOperationInFlightRef.current = true;
    setConnection({ state: 'testing', clusterId: selectedCluster.clusterId });

    try {
      await dispatchKafkaOperation('connect', toConnectRequest(selectedCluster));
      updateFailureStreak(0);
      setLastErrorDetail(null);
      connectOperationInFlightRef.current = false;
      await refreshConnectionStatus({ force: true });
      // Restart status polling if it had paused after a failure streak.
      bumpRefreshNonce();
      return true;
    } catch (error) {
      connectOperationInFlightRef.current = false;
      const uiError = toKafkaUiSafeError(error, 'connect');
      setConnection({
        state: 'error',
        clusterId: selectedCluster.clusterId,
        lastError: uiError.message,
      });
      setLastError(uiError.message);
      setLastErrorDetail(uiError);
      updateFailureStreak(statusPollFailureStreakRef.current + 1);
      return false;
    }
  }, [bumpRefreshNonce, refreshConnectionStatus, selectedCluster, updateFailureStreak]);

  const disconnectActiveCluster = useCallback(async () => {
    const activeClusterId = connection.clusterId ?? selectedClusterId;
    if (!activeClusterId) {
      setConnection({ state: 'disconnected' });
      setLastError(null);
      setLastErrorDetail(null);
      updateFailureStreak(0);
      return true;
    }

    connectOperationInFlightRef.current = true;
    try {
      await dispatchKafkaOperation('disconnect', { clusterId: activeClusterId });
      connectOperationInFlightRef.current = false;
      setConnection({ state: 'disconnected' });
      setLastError(null);
      setLastErrorDetail(null);
      updateFailureStreak(0);
      bumpRefreshNonce();
      return true;
    } catch (error) {
      connectOperationInFlightRef.current = false;
      const uiError = toKafkaUiSafeError(error, 'disconnect');
      setConnection((prev) => ({
        ...prev,
        state: 'error',
        clusterId: activeClusterId,
        lastError: uiError.message,
      }));
      setLastError(uiError.message);
      setLastErrorDetail(uiError);
      updateFailureStreak(statusPollFailureStreakRef.current + 1);
      return false;
    }
  }, [bumpRefreshNonce, connection.clusterId, selectedClusterId, updateFailureStreak]);

  const testSelectedClusterConnection = useCallback(async () => {
    if (testResultTimerRef.current) {
      clearTimeout(testResultTimerRef.current);
      testResultTimerRef.current = null;
    }

    if (!selectedCluster) {
      setLastError('No Kafka cluster is selected');
      setLastErrorDetail({
        kind: 'validation',
        code: 'KAFKA_NO_CLUSTER_SELECTED',
        message: 'No Kafka cluster is selected',
        retryable: false,
      });
      return false;
    }

    // Already connected to this exact cluster — just verify via status refresh (non-destructive)
    if (connection.state === 'connected' && connection.clusterId === selectedCluster.clusterId) {
      await refreshConnectionStatus({ force: true });
      setLastTestResult({ ok: true, clusterId: selectedCluster.clusterId });
      // Keep Verified visible long enough for demos / reading pauses (was 5s).
      testResultTimerRef.current = setTimeout(() => setLastTestResult(null), 15_000);
      return true;
    }

    // Probe: connect → brief visual pause → disconnect (does not persist the connection)
    const ok = await connectSelectedCluster();
    setLastTestResult({ ok, clusterId: selectedCluster.clusterId });
    if (ok) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 800); });
      await disconnectActiveCluster();
      testResultTimerRef.current = setTimeout(() => setLastTestResult(null), 15_000);
    }
    return ok;
  }, [connection, connectSelectedCluster, disconnectActiveCluster, refreshConnectionStatus, selectedCluster]);

  useEffect(() => {
    if (!loaded || startupAutoConnectAttemptedRef.current) {
      return;
    }

    startupAutoConnectAttemptedRef.current = true;
    if (!autoConnectOnStartup || !selectedCluster) {
      return;
    }

    void connectSelectedCluster();
  }, [autoConnectOnStartup, connectSelectedCluster, loaded, selectedCluster]);

  const setConnectionState = useCallback((state: KafkaConnectionState, options?: { clusterId?: string; lastError?: string; connectedAt?: string; lastErrorDetail?: KafkaUiSafeError | null }) => {
    const next: KafkaConnectionSnapshot = {
      state,
      clusterId: options?.clusterId,
      connectedAt: options?.connectedAt,
      lastError: options?.lastError,
    };
    setConnection(next);
    setLastError(options?.lastError ?? null);
    setLastErrorDetail(options?.lastErrorDetail ?? null);
  }, []);

  const clearError = useCallback(() => {
    setLastError(null);
    setLastErrorDetail(null);
    setLastTestResult(null);
    setConnection((prev) => ({
      ...prev,
      lastError: undefined,
      state: prev.state === 'error' ? 'disconnected' : prev.state,
    }));
  }, []);

  // Demo-player bridge: lets lesson setup/cleanup delete clusters by ID or name.
  const removeClusterRef = useRef(removeCluster);
  removeClusterRef.current = removeCluster;
  const clearAllClustersRef = useRef(clearAllClusters);
  clearAllClustersRef.current = clearAllClusters;
  const upsertClusterRef = useRef(upsertCluster);
  upsertClusterRef.current = upsertCluster;
  const setConnectionStateRef = useRef(setConnectionState);
  setConnectionStateRef.current = setConnectionState;
  const clustersRef = useRef(clusters);
  clustersRef.current = clusters;
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__demoDeleteKafkaClusterById = (clusterId: string) => {
      removeClusterRef.current(clusterId);
    };
    w.__demoDeleteKafkaClusterByName = (name: string) => {
      const cluster = clustersRef.current.find((c) => c.name === name);
      if (cluster) removeClusterRef.current(cluster.clusterId);
    };
    w.__demoClearAllKafkaClusters = () => {
      // Do NOT wrap in flushSync. Demo boot (`startLiveDemo` / resume) already
      // calls flushSync right after `prepareBeforeNavigate`. Nested flushSync
      // re-enters App mid-update and corrupts the hook queue (Rules of Hooks /
      // "Should have a queue"). Cleared state still applies before Settings
      // mounts because prepare runs before the subsequent navigate flushSync.
      clearAllClustersRef.current();
    };
    w.__demoEnsurePlaintextKafkaCluster = () => {
      const now = Date.now();
      upsertClusterRef.current({
        clusterId: 'demo-cluster',
        name: 'Demo Cluster',
        clientId: 'redfireforge-demo',
        brokers: ['127.0.0.1:19092'],
        connectionTimeoutMs: 8000,
        requestTimeoutMs: 10000,
        auth: { mode: 'none' },
        tls: { enabled: false, rejectUnauthorized: true },
        createdAt: now,
        updatedAt: now,
      });
    };
    w.__demoMarkKafkaConnected = (clusterId: string) => {
      setConnectionStateRef.current('connected', {
        clusterId,
        connectedAt: new Date().toISOString(),
      });
    };
    return () => {
      delete w.__demoDeleteKafkaClusterById;
      delete w.__demoDeleteKafkaClusterByName;
      delete w.__demoClearAllKafkaClusters;
      delete w.__demoEnsurePlaintextKafkaCluster;
      delete w.__demoMarkKafkaConnected;
    };
  }, []);

  return {
    loaded,
    clusters,
    selectedClusterId,
    selectedCluster,
    connection,
    lastError,
    lastErrorDetail,
    statusPollFailureStreak,
    autoConnectOnStartup,
    setAutoConnectOnStartup,
    topics,
    topicsLoading,
    topicsError,
    includeInternalTopics,
    setIncludeInternalTopics,
    setSelectedClusterId,
    upsertCluster,
    removeCluster,
    replaceClusters,
    connectSelectedCluster,
    disconnectActiveCluster,
    testSelectedClusterConnection,
    lastTestResult,
    refreshConnectionStatus,
    refreshTopics,
    setConnectionState,
    clearError,
  };
}
