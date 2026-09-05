import type {
  TransportType,
  KafkaAssertionTarget,
  KafkaProduceActionConfig,
  KafkaConsumeActionConfig,
  KafkaResultMeta,
  GrpcResultMeta,
  ApiMockResultMeta,
} from './kafka';
import type {
  ScenarioActionType,
  WsAssertionTarget,
  WsNumericAssertionTarget,
  WsConnectActionConfig,
  WsSendActionConfig,
  WsReceiveActionConfig,
  WsResultMeta,
} from './websocket';
import type { GrpcHarnessCallActionConfig } from './grpc-harness';
import type { SlaTarget, TestConfig } from './runner-config';
import type { HttpMethod } from './requests';

export interface Environment {
  id: string;
  name: string;
}

export type ProtocolKey = 'http' | 'websocket' | 'sse' | 'graphql' | 'grpc';

export interface ProtocolEndpoint {
  baseUrl: string;               // protocol-specific base URL / address
  path?: string;                 // optional default path (e.g. /graphql, /subscriptions)
  tls?: boolean;                 // override TLS for this protocol
}

export interface Microservice {
  id: string;
  name: string;
  baseUrls: Record<string, string>;        // environmentId -> base URL
  authProfileIds?: Record<string, string>; // environmentId -> GlobalAuthProfile id
  customEnvs?: Environment[];              // additional (service-specific) environments
  protocolEndpoints?: Partial<Record<ProtocolKey, Record<string, ProtocolEndpoint>>>;
  /** Protocols explicitly added by the user. Omitted = derive from baseUrls / protocolEndpoints for backward compat. */
  enabledProtocols?: ProtocolKey[];
  /** Protocol-level variables that apply to all environments: varName → value.
   *  Overridden by envVars for the same key; protocol-derived vars (grpcHost, etc.) take highest precedence. */
  globalVars?: Record<string, string>;
  /** Per-environment variable overrides: envId → varName → value.
   *  Override globalVars for the same key; protocol-derived vars still take highest precedence. */
  envVars?: Record<string, Record<string, string>>;
}

export interface KeyValue {
  key: string;
  value: string;
  /**
   * Whether this entry is included when the request is sent.
   * Absent/undefined is treated as enabled (true) for backward compatibility;
   * only explicitly disabled entries persist `enabled: false`.
   */
  enabled?: boolean;
}

export type AuthType = 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'oauth2';

export interface AuthConfig {
  type: AuthType;
  // Basic & Digest
  username?: string;
  password?: string;
  // Bearer
  token?: string;
  prefix?: string;
  // API Key
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyIn?: 'header' | 'query';
  // OAuth2 Client Credentials
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  // Links to a GlobalAuthProfile by id
  globalProfileId?: string;
  // Catalog UI state: tracks inherited security scheme / global profile binding
  __inherit?: boolean;
  __schemeName?: string;
  __globalProfileId?: string;
  __globalProfileName?: string;
}

export type ValidationMode = 'none' | 'full' | 'selective';

export type FieldOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'regex'
  | 'is_true'
  | 'is_false'
  | 'is_null'
  | 'is_not_null'
  | 'is_empty'
  | 'is_not_empty'
  | 'exists'
  | 'not_exists'
  | 'is_type'
  | 'in'
  | 'not_in'
  | 'between'
  | 'close_to';

export interface ExpectedField {
  jsonPath: string;
  expectedValue: string;
  operator?: FieldOperator;
  operatorValue?: string;
  negate?: boolean;
  /** Original mapper expression (e.g. `$maxBy(...)`) — preserved for DSL round-trip. */
  expression?: string;
}

export type SelectiveMode = 'include' | 'exclude';

export interface ResponseVersion {
  id: string;
  timestamp: number;
  label?: string;
  json: string;
  validationMode?: ValidationMode;
  selectiveMode?: SelectiveMode;
  expectedFields?: ExpectedField[];
  excludedPaths?: string[];
  unorderedArrays?: boolean;
}

export interface RulesVersion {
  id: string;
  timestamp: number;
  label?: string;
  validationMode: ValidationMode;
  selectiveMode?: SelectiveMode;
  expectedFields: ExpectedField[];
  excludedPaths?: string[];
  unorderedArrays?: boolean;
  assertions?: Assertion[];
}

export type AssertionOperator = 'equals' | 'contains' | 'regex' | 'exists';

export type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=';

export type DateReference =
  | { kind: 'today'; timezone: 'utc' | 'local' }
  | { kind: 'fixed'; iso: string };

export type JsonTypeName = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';

type AssertionBase = { negate?: boolean };

export type Assertion =
  | (AssertionBase & { type: 'status'; expected: string })
  | (AssertionBase & { type: 'responseTime'; maxMs: number })
  | (AssertionBase & { type: 'header'; name: string; operator: AssertionOperator; value?: string })
  | (AssertionBase & { type: 'regex'; jsonPath: string; pattern: string })
  | (AssertionBase & { type: 'arrayLength'; jsonPath: string; operator: ComparisonOperator; value: number })
  | (AssertionBase & { type: 'numeric'; jsonPath: string; operator: ComparisonOperator; value: number })
  | (AssertionBase & { type: 'date'; jsonPath: string; operator: ComparisonOperator; reference: DateReference })
  | (AssertionBase & { type: 'typeCheck'; jsonPath: string; expectedType: JsonTypeName })
  | (AssertionBase & { type: 'existence'; jsonPath: string; expectExists: boolean })
  | (AssertionBase & { type: 'arrayContains'; jsonPath: string; value: string; mode: 'any' | 'all' | 'only' | 'none' })
  | (AssertionBase & { type: 'each'; jsonPath: string; fieldPath: string; operator: FieldOperator; value?: string })
  | (AssertionBase & { type: 'containsSubset'; jsonPath: string; expected: string })
  | (AssertionBase & { type: 'jsonSchema'; schema: string })
  | (AssertionBase & { type: 'bodySize'; operator: ComparisonOperator; value: number; unit: 'bytes' | 'kb' | 'mb' })
  | (AssertionBase & { type: 'datePrecise'; jsonPath: string; operator: ComparisonOperator; reference: string; precision: 'day' | 'hour' | 'minute' | 'second' | 'millisecond' })
  | (AssertionBase & { type: 'custom'; expression: string; description?: string })
  /**
   * Kafka field assertion — evaluates against `kafkaResultMeta` on a Kafka action result.
   * Target selector paths: `kafka.body`, `kafka.key`, `kafka.partition`, `kafka.offset`,
   * `kafka.header.<headerName>` (e.g. `kafka.header.x-order-id`).
   */
  | (AssertionBase & { type: 'kafkaField'; target: KafkaAssertionTarget; operator: AssertionOperator; value?: string })
  /**
   * WebSocket field assertion (string-based) — evaluates against the WS message body,
   * frame type, protocol, connection ID, upgrade headers, or JSONPath into the message.
   * Uses `AssertionOperator` (equals/contains/regex/exists).
   */
  | (AssertionBase & { type: 'wsField'; target: WsAssertionTarget; operator: AssertionOperator; value?: string })
  /**
   * WebSocket numeric field assertion — evaluates `ws.latencyMs` or `ws.size` using
   * `ComparisonOperator` (`<`, `>`, `<=`, `>=`, `=`, `!=`).
   */
  | (AssertionBase & { type: 'wsNumericField'; target: WsNumericAssertionTarget; operator: ComparisonOperator; value: number });

export interface ValidationConfig {
  mode: ValidationMode;
  expectedJson?: string;
  expectedFields?: ExpectedField[];
  selectiveMode?: SelectiveMode;
  sampleJson?: string;
  excludedPaths?: string[];
  unorderedArrays?: boolean;
  responseVersions?: ResponseVersion[];
  rulesVersions?: RulesVersion[];
  assertions?: Assertion[];
}

export type BodyType = 'none' | 'json' | 'xml' | 'text' | 'form-urlencoded' | 'form-data' | 'file';

export type ExtractionSource = 'body' | 'header' | 'status';

export interface Extraction {
  name: string;
  source: ExtractionSource;
  expression: string;
  fallback?: string;
}

/** Snapshot of a test definition at a point in time (excludes id, validation, runtime fields). */
export interface TestDefinitionSnapshot {
  name: string;
  url: string;
  method: HttpMethod | 'KAFKA' | 'WEBSOCKET' | 'GRPC';
  headers: KeyValue[];
  body: string;
  bodyType?: BodyType;
  bodyForm?: KeyValue[];
  auth: AuthConfig;
  extractions?: Extraction[];
  actionType?: ScenarioActionType;
  wsConnectAction?: WsConnectActionConfig;
  wsSendAction?: WsSendActionConfig;
  wsReceiveAction?: WsReceiveActionConfig;
  kafkaProduceAction?: KafkaProduceActionConfig;
  kafkaConsumeAction?: KafkaConsumeActionConfig;
  grpcCallAction?: GrpcHarnessCallActionConfig;
}

export interface TestDefinitionVersion {
  id: string;
  timestamp: number;
  label?: string;
  changeSummary?: string;
  snapshot: TestDefinitionSnapshot;
}

// ─── Data Table types (parameterized testing) ────────────────

export interface DataSourceColumn {
  /** Stable column identifier — used as key in DataSourceRow.values */
  id: string;
  /** Human-readable display name: e.g. "VIN", "Channel" */
  name: string;
  /** Where this column binds in the request */
  type: 'path' | 'param' | 'body' | 'header' | 'validate';
  /** For 'path': variable name in URL. For 'param': query param name. For 'validate': JSONPath. */
  mapping: string;
  /** Optional human-readable description */
  description?: string;
}

export interface DataSourceRow {
  /** Unique row ID for stable identity across edits */
  id: string;
  /** Optional user-provided row label for identification */
  label?: string;
  /** Column id → value */
  values: Record<string, string>;
  /** Whether this row is enabled (unchecked rows are skipped) */
  enabled: boolean;
  /** User-assigned tags for categorization and filtered execution */
  tags?: string[];
  /** Optional note/annotation for this row */
  note?: string;
  /** Whether this row is a sample row (dev-curated example with expected values) */
  isSample?: boolean;
}

export type DataSourceType = 'inline' | 'file';

export interface DataSourceOrigin {
  type: DataSourceType;
  /** For 'file': relative or absolute path to CSV/Excel/JSON file */
  filePath?: string;
  /** For 'file': last-read timestamp for staleness detection */
  fileLastRead?: number;
  /** For 'file': row count at last read (for quick display without parsing) */
  fileRowCount?: number;
}

export interface DataSource {
  /** Unique ID */
  id: string;
  /** Optional human-readable name for this data source */
  label?: string;
  /** Column definitions — order matters for display */
  columns: DataSourceColumn[];
  /** Data rows (inline source only; file source reads at execution time) */
  rows: DataSourceRow[];
  /** Where the data lives */
  source: DataSourceOrigin;
  /** Row distribution strategy during execution. Defaults to 'sequential' when omitted. */
  distribution?: 'sequential' | 'random' | 'round-robin';
  /** URL template with {{variable}} placeholders — separate from the main URL */
  urlTemplate?: string;
  /** Validation contract: wildcard field patterns (e.g. "offers[*].offerName") that define
   *  which response fields should generate validate columns. Array length is determined
   *  dynamically from each API response — columns expand automatically. */
  validationContract?: string[];
  /** Per-array validation mode: 'ordered' validates by index position, 'unordered' checks
   *  that expected values exist anywhere in the array. Key is the array prefix (e.g. "offers[*]"). */
  arrayValidationMode?: Record<string, 'ordered' | 'unordered'>;
  /** Named subsets for filtered execution */
  subsets?: DataSubset[];
  /** Validation mode: none (skip), selective (sample rows only), full (all rows) */
  validationMode?: 'none' | 'selective' | 'full';
}

/** A named subset of data rows for filtered execution. */
export interface DataSubset {
  /** Unique name: e.g. "US Region Only", "Edge Cases" */
  name: string;
  /** Filter rule — either tag-based or explicit row IDs */
  filter: { type: 'tags'; tags: string[]; mode: 'any' | 'all' }
        | { type: 'rows'; rowIds: string[] };
}

/** Fetch configuration for API-driven population / verification of shared data sources. */
export interface SharedDataSourceFetchConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: KeyValue[];
  body?: string;
  bodyType?: BodyType;
  auth?: AuthConfig;
  /** Raw cURL command last provided by user (for edit/reuse). */
  rawCurl?: string;
  /** Optional variable mappings for URL path segments (customized in Shared DS fetch panel). */
  pathVariables?: Array<{ segmentIndex: number; variableName: string }>;
}

/** A shared data source that can be referenced by multiple tests. */
export interface SharedDataSource {
  /** Unique ID */
  id: string;
  /** Human-readable name: e.g. "Production VINs" */
  name: string;
  /** Tags for categorization (e.g., "prod", "qa", "vins") */
  tags?: string[];
  /** The actual data source definition */
  dataSource: DataSource;
  /** Timestamp of last edit */
  updatedAt: number;
  /** Timestamp of creation */
  createdAt?: number;
  /** Optional fetch configuration for API-driven population / verification */
  fetchConfig?: SharedDataSourceFetchConfig;
}

// ─────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'KAFKA' | 'WEBSOCKET' | 'GRPC';
  headers: KeyValue[];
  body: string;
  bodyType?: BodyType;
  bodyForm?: KeyValue[];
  auth: AuthConfig;
  validation: ValidationConfig;
  extractions?: Extraction[];
  fetchHostOverride?: string;
  fetchHostEnabled?: boolean;
  featureGroupName?: string;
  groupName?: string;
  definitionVersions?: TestDefinitionVersion[];
  /** Attached data source for parameterized execution */
  dataSource?: DataSource;
  /** Reference to a shared data source (by ID) — mutually exclusive with inline dataSource */
  sharedDataSourceId?: string;
  /** Transient: set by data source expansion — row ID for result tagging */
  dataRowId?: string;
  /** Transient: set by data source expansion — display label for result tagging */
  dataRowLabel?: string;
  /** ID of the test this was created from via "Create Parameterized Copy" */
  sourceTestId?: string;
  /** When created from a versioned request: the originating request ID */
  sourceRequestId?: string;
  /** When created from a versioned request: the spec version snapshot ID */
  sourceSpecVersionId?: string;
  /** Human label for the pinned spec version (e.g. "1.0.7") */
  sourceSpecVersionLabel?: string;
  /** Transient: inherited from parent TestScenario for result tagging */
  scenarioTags?: string[];
  /** SLA acceptance criteria for this individual test. Collected at run time into TestConfig.slaTargets. */
  slaTargets?: SlaTarget[];
  /**
   * Transport action type. Absent or `'http'` means standard HTTP request.
   * Older saved scenarios without this field are always treated as `'http'` by all consumers.
   */
  actionType?: ScenarioActionType;
  /** Configuration for a Kafka produce action (present when `actionType === 'kafkaProduce'`). */
  kafkaProduceAction?: KafkaProduceActionConfig;
  /** Configuration for a Kafka consume action (present when `actionType === 'kafkaConsume'`). */
  kafkaConsumeAction?: KafkaConsumeActionConfig;
  /** Configuration for a WS connect action (present when `actionType === 'wsConnect'`). */
  wsConnectAction?: WsConnectActionConfig;
  /** Configuration for a WS send action (present when `actionType === 'wsSend'`). */
  wsSendAction?: WsSendActionConfig;
  /** Configuration for a WS receive action (present when `actionType === 'wsReceive'`). */
  wsReceiveAction?: WsReceiveActionConfig;
  /** Configuration for a gRPC harness call (present when `actionType === 'grpcCall'`). */
  grpcCallAction?: GrpcHarnessCallActionConfig;
}

export type ScenarioKind = 'standard' | 'parameterized';

export interface TestScenario {
  id: string;
  name: string;
  kind: ScenarioKind;
  /** Tags for filtering/categorization (e.g., 'smoke', 'regression', 'critical') */
  tags?: string[];
  auth?: AuthConfig;
  tests: Scenario[];
  /** SLA acceptance criteria for this scenario. Collected at run time and embedded in TestConfig.slaTargets. */
  slaTargets?: SlaTarget[];
}

export function isParameterizedScenario(sc: TestScenario): boolean {
  return sc.kind === 'parameterized';
}

export interface GlobalAuthProfile {
  id: string;
  name: string;
  auth: AuthConfig;
}

/** Structure change tracking for FeatureGroups */
export type StructureChangeAction =
  | 'scenario-added' | 'scenario-removed' | 'scenario-renamed' | 'scenario-moved-in' | 'scenario-moved-out'
  | 'test-added' | 'test-removed' | 'test-renamed' | 'test-moved-in' | 'test-moved-out' | 'test-copied'
  | 'fg-renamed'
  | 'restored';

export interface StructureChangeEntry {
  id: string;
  timestamp: number;
  action: StructureChangeAction;
  /** Name of the entity that changed (scenario or test name) */
  entityName: string;
  /** Parent scenario name (for test-level changes) */
  scenarioName?: string;
  /** Additional detail (e.g. "from Scenario A" for moves, "old name → new name" for renames) */
  detail?: string;
}

export interface FeatureGroup {
  id: string;
  name: string;
  microserviceId?: string;
  environmentId?: string;
  auth?: AuthConfig;
  globalAuthProfileId?: string;
  scenarios: TestScenario[];
  /** Structure change log — tracks scenario/test add/remove/rename/move */
  structureLog?: StructureChangeEntry[];
  /** Origin of this feature group. Gallery-imported groups use absolute URLs and skip host replacement. */
  source?: 'user' | 'gallery';
  /** The gallery catalog entry ID this was imported from (e.g. 'test-user-api-smoke'). */
  gallerySampleId?: string;
  /** Hash of the gallery sample content at time of import — used to detect if the sample has been updated. */
  gallerySampleHash?: string;
  /** SLA acceptance criteria for the whole feature group (aggregate, across all scenarios). */
  slaTargets?: SlaTarget[];
}

// ─── Trash Box (soft-delete & recovery) ─────────────────────

export type TrashEntityType = 'featureGroup' | 'scenario' | 'test' | 'sharedDataSource';

export interface TrashItem {
  id: string;
  deletedAt: number;
  expiresAt: number;
  entityType: TrashEntityType;
  entityName: string;
  parentPath: string;
  parentFeatureGroupId?: string;
  parentScenarioId?: string;
  environmentId?: string;
  microserviceId?: string;
  childCounts?: { scenarios?: number; tests?: number };
  data: FeatureGroup | TestScenario | Scenario | SharedDataSource;
}

export interface TrashSettings {
  retentionDays: number;
  maxItems: number;
}

// ─────────────────────────────────────────────────────────────

export * from './runner-config';
export * from './kafka';
export * from './grpc-harness';
export * from './grpc-harness-snapshot';
export * from './websocket';
export * from './requests';

export interface FailureDetail {
  path: string;
  expected: string;
  actual: string;
}

export interface TimingBreakdown {
  dnsLookup: number;
  tcpConnect: number;
  tlsHandshake: number;
  ttfb: number;
  download: number;
  total: number;
}

export interface RequestResult {
  id: string;
  scenarioId: string;
  scenarioName: string;
  featureGroupName?: string;
  groupName?: string;
  url: string;
  method: string;
  httpStatus: number;
  responseTimeMs: number;
  responseBody: string;
  responseHeaders?: Record<string, string>;
  timestamp: number;
  passed: boolean;
  validationMode: ValidationMode;
  failureDetails: FailureDetail[];
  errorMessage?: string;
  timing?: TimingBreakdown;
  requestLog?: {
    headers: Record<string, string>;
    body?: string;
  };
  /** Data table row ID that produced this result (for parameterized tests) */
  dataRowId?: string;
  /** Human-readable row label (e.g., "Row 3: VIN=1HG...") for display */
  dataRowLabel?: string;
  /** Tags from the parent TestScenario (for result filtering/reporting) */
  scenarioTags?: string[];
  /** Which iteration (0-based) produced this result (for workflow load tests) */
  iterationIndex?: number;
  /** Which workflow node produced this result (for per-step metrics) */
  workflowNodeId?: string;
  /** True if the request was cancelled by user (e.g., Stop button) */
  cancelled?: boolean;
  /**
   * Transport type for this result. Absent or `'http'` means standard HTTP request.
   * Rendering components should guard `httpStatus`/method-badge display behind
   * `(r.transportType ?? 'http') === 'http'`.
   */
  transportType?: TransportType;
  /** Kafka-specific result metadata (populated when `transportType` is `'kafkaProduce'` or `'kafkaConsume'`). */
  kafkaResultMeta?: KafkaResultMeta;
  /** WebSocket-specific result metadata (populated when `transportType` is a WS action). */
  wsResultMeta?: WsResultMeta;
  /** gRPC-specific result metadata (workflow: `grpcUnary`/`grpcServerStream`; harness: `grpcCall`). */
  grpcResultMeta?: GrpcResultMeta;
  /** API Mock workflow node metadata (Phase 11). */
  apiMockResultMeta?: ApiMockResultMeta;
}

export interface TestSummary {
  tps: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  p999ResponseTime?: number;
  errorRate: number;
  errorsByStatus: Record<number, number>;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failedValidations: number;
  totalDurationMs: number;
  /** Average workflow iteration duration (only for workflow runs) */
  avgIterationTime?: number;
  /** Number of requests cancelled by user abort (excluded from error metrics) */
  cancelledRequests?: number;
  /** Requests not sent due to backpressure (constant-arrival mode only) */
  droppedRequests?: number;
  /** Highest achieved RPS (constant-arrival mode only) */
  peakRps?: number;
  /** Configured target RPS (constant-arrival mode only) */
  targetRps?: number;
  /**
   * Error classification counts for Kafka actions by category.
   * Categories: `'timeout'`, `'auth'`, `'network'`, `'assertion'`, `'unknown'`, etc.
   * Kept separate from `errorsByStatus` which is HTTP-status keyed.
   */
  kafkaErrorsByCategory?: Record<string, number>;
}


// ─── Workflow Execution Trace (Phase 7e) — extracted to ./trace ─────
import type { WorkflowExecutionTrace } from './trace';
export type {
  TraceCaptureLevel,
  ExecutionTraceOptions,
  CapturedHttpRequest,
  CapturedHttpResponse,
  AssertionResult,
  ExecutionEventDetails,
  ExecutionEvent,
  WorkflowIterationTrace,
  WorkflowExecutionTrace,
  CapturedKafkaNodeDetails,
  KafkaFailureClass,
  CapturedWsNodeDetails,
  CapturedGrpcNodeDetails,
  CapturedApiMockNodeDetails,
  WsFailureClass,
} from './trace';


// ─────────────────────────────────────────────────────────────

export interface TestRun {
  id: string;
  timestamp: number;
  config: TestConfig;
  summary: TestSummary;
  results: RequestResult[];
  projectName?: string;
  envName?: string;
  svcName?: string;
  baseUrl?: string;
  /** Name of the workflow (when executionMode is 'workflow') */
  workflowName?: string;
  /** Execution trace for workflow runs (Phase 7e: Visual Execution Replay) */
  executionTrace?: WorkflowExecutionTrace;
  /** Compressed execution trace (base64 lz-string). Mutually exclusive with executionTrace. */
  compressedTrace?: string;
  /** Lightweight flag set during save — true when compressedTrace exists. Used for lazy loading. */
  hasTrace?: boolean;
}

