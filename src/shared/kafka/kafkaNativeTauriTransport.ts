/**
 * Native Tauri transport for Kafka operations.
 *
 * Wires each KafkaOperation to the corresponding Tauri Rust command via
 * `invoke` from @tauri-apps/api/core.  Both @tauri-apps/api/core and
 * @tauri-apps/api/event are dynamically imported INSIDE the function bodies
 * — never at the top level — so this module can be imported in browser/dev
 * mode without exploding when the Tauri global is absent.
 *
 * Command name table  (KafkaOperation → Rust fn name):
 *   connect      → kafka_connect
 *   disconnect   → kafka_disconnect
 *   status       → kafka_status
 *   topics       → kafka_topics
 *   produce      → kafka_produce
 *   consume-once → kafka_consume_once   ← hyphen → underscore
 *   subscribe    → kafka_subscribe
 *   subscriptions→ kafka_subscriptions
 *   unsubscribe  → kafka_unsubscribe
 *
 * Invoke args strategy:
 *   POST with struct param:   { [paramKey]: request.body ?? {} }
 *     Tauri v2 requires each Rust command parameter to be keyed by its name.
 *     e.g. kafka_produce(state, request: KafkaProduceRequest) → { request: {...} }
 *   POST body already keyed:  request.body ?? {}  (no paramKey wrapping)
 *     connect: useKafkaState.toConnectRequest returns { connection: KafkaConnectionConfig }
 *     so body is already { connection: {...} } — Tauri gets the right shape without wrapping.
 *     disconnect: body is flat { clusterId? } primitives.
 *   GET operations:           restoreQueryTypes(request.query)
 *     buildQuery() serialises JS booleans to the strings 'true'/'false' for
 *     URL query-string use; Rust Option<bool> parameters need actual JSON
 *     booleans, not strings, so the helper below restores them.
 */

import {
  KafkaClientError,
  defaultTransport,
  throwIfEnvelopeNotOk,
  type KafkaClientTransport,
  type KafkaDispatchRequest,
  type KafkaEnvelope,
  type KafkaOperation,
} from './kafkaClient';

// ── Command name + parameter key mapping ────────────────────────────────────
//
// Tauri v2 invoke() passes args as a keyed JSON object where each key is the
// Rust parameter name (snake_case auto-converted to camelCase by Tauri).
// For commands with a single named STRUCT parameter, the body must be wrapped:
//   invoke('kafka_produce', { request: { topic, messages, ... } })
//   invoke('kafka_connect', { connection: { clusterId, ... } })
// For commands with primitive parameters (disconnect, status, topics,
// subscriptions) the body/query is already keyed by param name and is passed
// flat — no wrapping needed.
//
// See also: src/features/test-runner/utils/rustBridge.ts
//   invoke('start_load_test', { plan }) — same pattern.

interface CommandSpec {
  command: string;
  /**
   * Rust parameter name for struct-typed POST params.  When set, the request
   * body is wrapped as `{ [paramKey]: body }` before passing to invoke.
   * Omit for commands whose POST args are a flat set of primitive params
   * (e.g. kafka_disconnect takes `cluster_id: Option<String>` — camelCased
   * to `clusterId` by Tauri — which matches the flat body directly).
   */
  paramKey?: string;
}

const COMMAND_MAP: Record<KafkaOperation, CommandSpec> = {
  // NOTE: No paramKey for connect.  useKafkaState.toConnectRequest already wraps the
  // KafkaConnectionConfig in { connection: {...} }, so the dispatch body is already
  // { connection: <KafkaConnectionConfig> }.  Passing it as-is gives Tauri exactly the
  // args it needs: invoke('kafka_connect', { connection: {...} }).  Adding paramKey here
  // would double-wrap to { connection: { connection: {...} } } — wrong.
  connect: { command: 'kafka_connect' },
  disconnect: { command: 'kafka_disconnect' },         // flat: clusterId
  status: { command: 'kafka_status' },                 // GET
  topics: { command: 'kafka_topics' },                 // GET
  produce: { command: 'kafka_produce', paramKey: 'request' },
  'consume-once': { command: 'kafka_consume_once', paramKey: 'request' },
  subscribe: { command: 'kafka_subscribe', paramKey: 'request' },
  subscriptions: { command: 'kafka_subscriptions' },   // GET
  unsubscribe: { command: 'kafka_unsubscribe', paramKey: 'request' },
  // Phase 3A — ring buffer polling via Express; no native Rust command yet
  'subscription-messages': { command: '_server_proxy' },
  'topic-detail': { command: 'kafka_topic_detail' },
  'topic-groups': { command: 'kafka_topic_groups' },
  // Schema registry ops: no Rust command — always route through the Express server proxy
  'schema-subjects': { command: '_server_proxy' },
  'schema-versions': { command: '_server_proxy' },
  'schema-fetch': { command: '_server_proxy' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Restore JS booleans that buildQuery() serialised to strings for URL params.
 * Only 'true' and 'false' are mapped; all other strings stay as-is.
 */
function topicNameFromDetailPath(path: string): string | undefined {
  const match = /\/topics\/([^/?]+)\/(?:detail|groups)/.exec(path);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function restoreQueryTypes(
  query: Record<string, string>,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === 'true') result[key] = true;
    else if (value === 'false') result[key] = false;
    else result[key] = value;
  }
  return result;
}

// ── Transport ─────────────────────────────────────────────────────────────────

/**
 * KafkaClientTransport backed by Tauri invoke.
 *
 * Throws KafkaClientError when:
 *   a) invoke itself throws (IPC error, unknown command, …)
 *   b) the returned Rust envelope has ok === false (application-level error)
 *
 * This matches the behaviour of parseEnvelope() in the server-proxy path so
 * all existing call-site error handling continues to work unchanged.
 */
export const kafkaNativeTauriTransport: KafkaClientTransport = async (
  request: KafkaDispatchRequest,
): Promise<KafkaEnvelope> => {
  const { command, paramKey } = COMMAND_MAP[request.op];

  // Schema registry ops and schema-aware produce/consume always go through the
  // server proxy (Express route) — never native Tauri invoke.
  if (
    command === '_server_proxy' ||
    (request.op === 'produce' && request.body?.['schemaConfig'] != null) ||
    (request.op === 'consume-once' && request.body?.['schemaConfig'] != null)
  ) {
    return defaultTransport(request);
  }

  const { invoke } = await import('@tauri-apps/api/core');

  const body = request.body ?? {};
  const args: Record<string, unknown> =
    request.method === 'GET'
      ? { ...restoreQueryTypes(request.query) }
      : paramKey !== undefined
        ? { [paramKey]: body }
        : { ...body };
  if (request.op === 'topic-detail' || request.op === 'topic-groups') {
    const topicName = topicNameFromDetailPath(request.path);
    if (topicName) args.topicName = topicName;
  }

  let envelope: KafkaEnvelope;
  try {
    envelope = await invoke<KafkaEnvelope>(command, args);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new KafkaClientError(request.op, message, {
      code: 'KAFKA_INVOKE_ERROR',
      retryable: true,
    });
  }

  throwIfEnvelopeNotOk(request.op, envelope);
  return envelope;
};

// ── Subscription streaming ────────────────────────────────────────────────────

/**
 * Payload shape for "kafka-subscription-message" Tauri events.
 * Mirrors KafkaSubscriptionEventPayload from src-tauri/src/kafka/commands.rs
 * and KafkaConsumeRecord from src-server/kafka/contracts.ts.
 * Defined inline here because src/ cannot import from src-server/.
 */
export interface KafkaSubscriptionMessage {
  subscriptionId: string;
  record: {
    topic: string;
    partition: number;
    offset: string;
    timestamp?: string;
    key?: string;
    value: string;
    headers?: Record<string, string>;
  };
}

/**
 * Listen for streaming Kafka subscription messages from the native consumer.
 *
 * Returns the Tauri unlisten function — call it to stop receiving events.
 *
 * This is SEPARATE from the KafkaClientTransport mechanism.  The `subscribe`
 * operation (via dispatchKafkaOperation) only handles the synchronous
 * registration invoke and returns the subscriptionId.  Actual message events
 * are delivered here via Tauri's event bus.
 *
 * Usage:
 *   const unlisten = await listenKafkaSubscriptionMessage((msg) => {
 *     console.log(msg.subscriptionId, msg.record);
 *   });
 *   // later, when done or on unsubscribe:
 *   unlisten();
 */
export async function listenKafkaSubscriptionMessage(
  callback: (payload: KafkaSubscriptionMessage) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<KafkaSubscriptionMessage>(
    'kafka-subscription-message',
    (e) => callback(e.payload),
  );
}

export interface KafkaSubscriptionError {
  subscriptionId: string;
  message: string;
}

export interface KafkaSubscriptionEnded {
  subscriptionId: string;
  reason: string;
}

/** Broker failure for a desktop stream. The web app polls instead. */
export async function listenKafkaSubscriptionError(
  callback: (payload: KafkaSubscriptionError) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<KafkaSubscriptionError>(
    'kafka-subscription-error',
    (e) => callback(e.payload),
  );
}

export async function listenKafkaSubscriptionEnded(
  callback: (payload: KafkaSubscriptionEnded) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<KafkaSubscriptionEnded>(
    'kafka-subscription-ended',
    (e) => callback(e.payload),
  );
}
