/**
 * Data Source Expander — resolves a single Scenario with an attached DataSource
 * into N concrete Scenarios, one per enabled data row, with variables substituted
 * into URL path, query params, headers, body, and validation fields.
 */
import type { Scenario, DataSourceColumn, DataSourceRow, DataSubset, KeyValue, ExpectedField, ValidationConfig, SharedDataSource, TestScenario, FeatureGroup, Assertion } from '@shared/types';
import { interpolateGrpcHarnessCallAction } from '@shared/grpc/grpcHarnessDataSourceInterpolation';
import { isTemplateToken, decodeTemplateBraces, substituteBodyColumnTemplateVars } from '@shared/utils/templateHelpers';

// ─── Shared Data Source Resolution ────────────────────────────

/**
 * Resolve a Scenario's data source: if it references a shared data source,
 * attach the shared DataSource inline. Returns the scenario unchanged if
 * it already has inline data or no data source at all.
 */
export function resolveSharedDataSource(
  scenario: Scenario,
  sharedDataSources?: SharedDataSource[],
): Scenario {
  if (!scenario.sharedDataSourceId || scenario.dataSource) return scenario;
  if (!sharedDataSources || sharedDataSources.length === 0) return scenario;

  const shared = sharedDataSources.find(s => s.id === scenario.sharedDataSourceId);
  if (!shared) return scenario;
  return { ...scenario, dataSource: shared.dataSource };
}

/**
 * Resolve all tests in a queue, attaching shared data sources.
 */
export function resolveSharedDataSources(
  queue: Scenario[],
  sharedDataSources: SharedDataSource[],
): Scenario[] {
  return queue.map(sc => {
    if (!sc.sharedDataSourceId || sc.dataSource) return sc;
    const shared = sharedDataSources.find(s => s.id === sc.sharedDataSourceId);
    if (!shared) return sc;
    return { ...sc, dataSource: shared.dataSource };
  });
}

// ─── Helpers ──────────────────────────────────────────────────

/** Build a human-readable label for a data row (e.g., "Row 1: vin=1HG..338, channel=WEB"). */
export function buildRowLabel(row: DataSourceRow, columns: DataSourceColumn[], index: number): string {
  const parts = columns
    .filter(c => c.type !== 'validate')
    .slice(0, 3) // limit to first 3 non-validate columns
    .map(c => {
      const val = row.values[c.id] ?? '';
      const truncated = val.length > 16 ? val.slice(0, 14) + '…' : val;
      return `${c.name}=${truncated}`;
    });
  const suffix = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `Row ${index + 1}${suffix}`;
}

/** Replace all `{{varName}}` placeholders in a string with values from the variable map. */
function substituteVariables(template: string, vars: Record<string, string>): string {
  return substituteBodyColumnTemplateVars(template, vars);
}

/** Substitute into a numeric assertion field: template as a string, then re-parse as a number. */
function substituteNumericValue(raw: number, vars: Record<string, string>): number {
  const substituted = substituteVariables(String(raw), vars);
  if (!substituted.trim()) return raw;
  const parsed = Number(substituted);
  return Number.isNaN(parsed) ? raw : parsed;
}

/**
 * Substitute {{columnName}} row variables into an assertion's simple string/number fields.
 * Assertion types with structured or code-like fields (`date`'s reference object, `jsonSchema`,
 * `custom` expressions) are left untouched — blind substitution there would be unsafe or meaningless.
 */
function substituteAssertionVariables(a: Assertion, vars: Record<string, string>): Assertion {
  switch (a.type) {
    case 'status':
      return { ...a, expected: substituteVariables(a.expected, vars) };
    case 'header':
    case 'each':
    case 'kafkaField':
    case 'wsField':
      return a.value !== undefined ? { ...a, value: substituteVariables(a.value, vars) } : a;
    case 'regex':
      return { ...a, pattern: substituteVariables(a.pattern, vars) };
    case 'arrayLength':
    case 'numeric':
    case 'bodySize':
      return { ...a, value: substituteNumericValue(a.value, vars) };
    case 'wsNumericField':
      return { ...a, value: substituteNumericValue(a.value, vars) };
    case 'arrayContains':
      return { ...a, value: substituteVariables(a.value, vars) };
    case 'containsSubset':
      return { ...a, expected: substituteVariables(a.expected, vars) };
    case 'datePrecise':
      return { ...a, reference: substituteVariables(a.reference, vars) };
    default:
      return a;
  }
}

function normalizeUnresolvedQueryPlaceholders(url: string): string {
  try {
    const u = new URL(url);
    for (const [key, value] of u.searchParams.entries()) {
      if (isTemplateToken(value)) {
        u.searchParams.set(key, '');
      }
    }
    return decodeTemplateBraces(u.toString());
  } catch {
    return decodeTemplateBraces(url);
  }
}

// ─── Column Resolution ───────────────────────────────────────

/** Apply path column values — replace {{varName}} in URL path segments. */
function applyPathColumns(url: string, columns: DataSourceColumn[], row: DataSourceRow): string {
  const vars: Record<string, string> = {};
  for (const col of columns) {
    if (col.type === 'path') {
      const rowValue = row.values[col.id] ?? '';
      if (!rowValue || isTemplateToken(rowValue)) continue;
      const mapping = (col.mapping ?? '').trim();
      const name = (col.name ?? '').trim();
      const hasMappingPlaceholder = mapping ? url.includes(`{{${mapping}}}`) : false;
      const hasNamePlaceholder = name ? url.includes(`{{${name}}}`) : false;
      const key = hasMappingPlaceholder || !hasNamePlaceholder ? mapping : name;
      if (key) {
        vars[key] = rowValue;
      }
    }
  }
  return substituteVariables(url, vars);
}

/** Apply param column values — set/override query parameters. */
function applyParamColumns(url: string, columns: DataSourceColumn[], row: DataSourceRow): string {
  const paramCols = columns.filter(c => c.type === 'param');
  if (paramCols.length === 0) return normalizeUnresolvedQueryPlaceholders(url);

  // First, substitute {{placeholder}} in the URL template (same pattern as path/body columns)
  const vars: Record<string, string> = {};
  for (const col of paramCols) {
    const rowValue = row.values[col.id] ?? '';
    if (!rowValue || isTemplateToken(rowValue)) continue;
    const mapping = (col.mapping ?? '').trim();
    const name = (col.name ?? '').trim();
    if (mapping) vars[mapping] = rowValue;
    if (name && name !== mapping) vars[name] = rowValue;
  }
  const substituted = substituteVariables(url, vars);

  try {
    // Then use URL parsing to ensure proper encoding
    const u = new URL(substituted);
    const existingKeys = new Set(Array.from(u.searchParams.keys()));
    for (const col of paramCols) {
      const value = row.values[col.id];
      if (value !== undefined && value !== '' && !isTemplateToken(value)) {
        const mapping = (col.mapping ?? '').trim();
        const name = (col.name ?? '').trim();
        const key = mapping && (existingKeys.has(mapping) || !name || !existingKeys.has(name))
          ? mapping
          : name || mapping;
        if (key) u.searchParams.set(key, value);
      }
    }
    for (const [key, current] of u.searchParams.entries()) {
      if (isTemplateToken(current)) {
        u.searchParams.set(key, '');
      }
    }
    return u.toString();
  } catch {
    return normalizeUnresolvedQueryPlaceholders(substituted);
  }
}

/** Apply header column values — set/override headers. */
function applyHeaderColumns(headers: KeyValue[], columns: DataSourceColumn[], row: DataSourceRow): KeyValue[] {
  const headerCols = columns.filter(c => c.type === 'header');
  if (headerCols.length === 0) return headers;

  const result = [...headers];
  for (const col of headerCols) {
    const value = row.values[col.id] ?? '';
    const existing = result.findIndex(h => h.key.toLowerCase() === col.mapping.toLowerCase());
    if (existing >= 0) {
      result[existing] = { key: col.mapping, value };
    } else {
      result.push({ key: col.mapping, value });
    }
  }
  return result;
}

/** Apply body column values — replace {{varName}} in request body. */
function applyBodyColumns(body: string, columns: DataSourceColumn[], row: DataSourceRow): string {
  const bodyCols = columns.filter(c => c.type === 'body');
  if (bodyCols.length === 0 || !body) return body;

  const vars: Record<string, string> = {};
  for (const col of bodyCols) {
    vars[col.mapping] = row.values[col.id] ?? '';
  }
  return substituteVariables(body, vars);
}

// ─── Main Expander ────────────────────────────────────────────

/**
 * Resolve a Scenario's data source row into a concrete Scenario with
 * all variables substituted and data row metadata attached.
 */
export function resolveScenarioFromDataRow(
  base: Scenario,
  columns: DataSourceColumn[],
  row: DataSourceRow,
  rowIndex: number,
  arrayValidationMode?: Record<string, 'ordered' | 'unordered'>,
  validationMode?: 'none' | 'selective' | 'full',
): Scenario {
  let url = decodeTemplateBraces(base.url);
  url = applyPathColumns(url, columns, row);
  url = applyParamColumns(url, columns, row);

  const headers = applyHeaderColumns(base.headers, columns, row);
  const body = applyBodyColumns(base.body, columns, row);
  const label = buildRowLabel(row, columns, rowIndex);

  // Build body-column variable map for Kafka field interpolation.
  // The same {{varName}} substitution used for HTTP body also applies to all
  // Kafka config string fields — no new DataSourceColumn.type variant is needed.
  const bodyCols = columns.filter(c => c.type === 'body');
  const bodyVars: Record<string, string> = {};
  for (const col of bodyCols) {
    bodyVars[col.mapping] = row.values[col.id] ?? '';
  }
  const hasBodyVars = bodyCols.length > 0;

  // Build a variable map for assertion-field substitution from ALL data source columns —
  // broader than bodyVars above, since custom assertions may template off any column
  // (e.g. a `validate` column's expected value), not just `body` ones. Path/param/body
  // columns key by their variable-name `mapping`; `validate` columns key by their
  // human-readable `name` instead, since their `mapping` holds a JSONPath.
  const assertionVars: Record<string, string> = { ...bodyVars };
  for (const col of columns) {
    if (col.type === 'body') continue;
    const key = col.type === 'validate' ? col.name : col.mapping;
    assertionVars[key] = row.values[col.id] ?? '';
  }
  const hasAssertionVars = Object.keys(assertionVars).length > 0;

  // Apply variable substitution to Kafka produce config fields
  const kafkaProduceAction = base.kafkaProduceAction && hasBodyVars
    ? {
        ...base.kafkaProduceAction,
        topic: substituteVariables(base.kafkaProduceAction.topic, bodyVars),
        key: base.kafkaProduceAction.key !== undefined
          ? substituteVariables(base.kafkaProduceAction.key, bodyVars)
          : undefined,
        value: base.kafkaProduceAction.value !== undefined
          ? substituteVariables(base.kafkaProduceAction.value, bodyVars)
          : undefined,
        headers: base.kafkaProduceAction.headers
          ? Object.fromEntries(
              Object.entries(base.kafkaProduceAction.headers).map(
                ([k, v]) => [k, substituteVariables(v, bodyVars)],
              ),
            )
          : undefined,
      }
    : base.kafkaProduceAction;

  // Apply variable substitution to Kafka consume config fields
  const kafkaConsumeAction = base.kafkaConsumeAction && hasBodyVars
    ? {
        ...base.kafkaConsumeAction,
        topic: substituteVariables(base.kafkaConsumeAction.topic, bodyVars),
        filter: base.kafkaConsumeAction.filter
          ? {
              ...base.kafkaConsumeAction.filter,
              keyEquals: base.kafkaConsumeAction.filter.keyEquals !== undefined
                ? substituteVariables(base.kafkaConsumeAction.filter.keyEquals, bodyVars)
                : undefined,
              jsonEquals: base.kafkaConsumeAction.filter.jsonEquals !== undefined
                ? substituteVariables(base.kafkaConsumeAction.filter.jsonEquals, bodyVars)
                : undefined,
              headersMatch: base.kafkaConsumeAction.filter.headersMatch
                ? Object.fromEntries(
                    Object.entries(base.kafkaConsumeAction.filter.headersMatch).map(
                      ([k, v]) => [k, substituteVariables(v, bodyVars)],
                    ),
                  )
                : undefined,
            }
          : undefined,
      }
    : base.kafkaConsumeAction;

  // Apply variable substitution to WS connect action config fields
  const wsConnectAction = base.wsConnectAction && hasBodyVars
    ? {
        ...base.wsConnectAction,
        url: substituteVariables(base.wsConnectAction.url, bodyVars),
        connectionId: base.wsConnectAction.connectionId !== undefined
          ? substituteVariables(base.wsConnectAction.connectionId, bodyVars)
          : undefined,
        headers: base.wsConnectAction.headers
          ? base.wsConnectAction.headers.map(h => ({
              ...h,
              value: substituteVariables(h.value, bodyVars),
            }))
          : undefined,
        queryParams: base.wsConnectAction.queryParams
          ? base.wsConnectAction.queryParams.map(qp => ({
              ...qp,
              value: substituteVariables(qp.value, bodyVars),
            }))
          : undefined,
        subprotocols: base.wsConnectAction.subprotocols !== undefined
          ? substituteVariables(base.wsConnectAction.subprotocols, bodyVars)
          : undefined,
      }
    : base.wsConnectAction;

  // Apply variable substitution to WS send action config fields
  const wsSendAction = base.wsSendAction && hasBodyVars
    ? {
        ...base.wsSendAction,
        message: substituteVariables(base.wsSendAction.message, bodyVars),
        url: base.wsSendAction.url !== undefined
          ? substituteVariables(base.wsSendAction.url, bodyVars)
          : undefined,
        connectionRef: base.wsSendAction.connectionRef !== undefined
          ? substituteVariables(base.wsSendAction.connectionRef, bodyVars)
          : undefined,
      }
    : base.wsSendAction;

  // Apply variable substitution to WS receive action config fields
  const wsReceiveAction = base.wsReceiveAction && hasBodyVars
    ? {
        ...base.wsReceiveAction,
        url: base.wsReceiveAction.url !== undefined
          ? substituteVariables(base.wsReceiveAction.url, bodyVars)
          : undefined,
        connectionRef: base.wsReceiveAction.connectionRef !== undefined
          ? substituteVariables(base.wsReceiveAction.connectionRef, bodyVars)
          : undefined,
        matchCriteria: base.wsReceiveAction.matchCriteria
          ? {
              ...base.wsReceiveAction.matchCriteria,
              contentContains: base.wsReceiveAction.matchCriteria.contentContains !== undefined
                ? substituteVariables(base.wsReceiveAction.matchCriteria.contentContains, bodyVars)
                : undefined,
              contentRegex: base.wsReceiveAction.matchCriteria.contentRegex !== undefined
                ? substituteVariables(base.wsReceiveAction.matchCriteria.contentRegex, bodyVars)
                : undefined,
              jsonPathValue: base.wsReceiveAction.matchCriteria.jsonPathValue !== undefined
                ? substituteVariables(base.wsReceiveAction.matchCriteria.jsonPathValue, bodyVars)
                : undefined,
              jsonPathMatch: base.wsReceiveAction.matchCriteria.jsonPathMatch !== undefined
                ? substituteVariables(base.wsReceiveAction.matchCriteria.jsonPathMatch, bodyVars)
                : undefined,
            }
          : undefined,
      }
    : base.wsReceiveAction;

  const grpcCallAction = interpolateGrpcHarnessCallAction(
    base.grpcCallAction,
    bodyVars,
    hasBodyVars,
  );

  // Build expectedFields from validate columns that have values in this row
  const validateCols = columns.filter(c => c.type === 'validate');
  const expectedFields: ExpectedField[] = validateCols
    .filter(col => row.values[col.id]?.trim())
    .map(col => ({ jsonPath: col.mapping, expectedValue: row.values[col.id].trim() }));

  // Determine validation config based on validationMode + isSample
  // - 'none': skip validation entirely for all rows
  // - 'selective': only validate sample rows (isSample=true)
  // - 'full': validate all rows that have validate column values
  const effectiveMode = validationMode ?? 'full';
  const skipValidation = effectiveMode === 'none'
    || (effectiveMode === 'selective' && !row.isSample);

  const hasUnordered = arrayValidationMode && Object.values(arrayValidationMode).some(m => m === 'unordered');
  let validation: ValidationConfig = base.validation;

  if (skipValidation) {
    // Force validation off for this row
    validation = { ...validation, mode: 'none' };
  } else if (expectedFields.length > 0) {
    validation = {
      ...validation,
      mode: 'selective',
      expectedFields,
      unorderedArrays: hasUnordered || validation.unorderedArrays || false,
    };
  } else if (hasUnordered && !validation.unorderedArrays) {
    validation = { ...validation, unorderedArrays: true };
  }

  // Substitute row-driven {{columnName}} variables into assertion fields so parameterized
  // rows can template expected values (e.g. status expected "{{expectedStatus}}", regex pattern
  // "{{expectedName}}", kafka.key equals "{{orderId}}", ws.size < "{{maxBytes}}").
  if (hasAssertionVars && validation.assertions?.length) {
    validation = {
      ...validation,
      assertions: validation.assertions.map(a => substituteAssertionVariables(a, assertionVars)),
    };
  }

  return {
    ...base,
    url,
    headers,
    body,
    validation,
    kafkaProduceAction,
    kafkaConsumeAction,
    wsConnectAction,
    wsSendAction,
    wsReceiveAction,
    grpcCallAction,
    // Clear the data source on expanded scenarios — they are already resolved
    dataSource: undefined,
    // Tag with row context for result tracking
    dataRowId: row.id,
    dataRowLabel: label,
  };
}

/**
 * Expand a Scenario with an attached DataSource into N concrete Scenarios,
 * one per enabled data row. Scenarios without a data source are returned as-is.
 *
 * @param scenario The base scenario (may or may not have a dataTable)
 * @returns Array of resolved scenarios. Length = enabled row count (or 1 if no table).
 */
export function expandDataSource(scenario: Scenario): Scenario[] {
  const dt = scenario.dataSource;
  if (!dt || dt.columns.length === 0 || dt.rows.length === 0) {
    return [scenario];
  }

  const enabledRows = dt.rows.filter(r => r.enabled !== false);
  if (enabledRows.length === 0) {
    return [scenario];
  }

  // Apply distribution strategy
  const orderedRows = applyDistribution(enabledRows, dt.distribution);

  return orderedRows.map((row, idx) =>
    resolveScenarioFromDataRow(scenario, dt.columns, row, idx, dt.arrayValidationMode, dt.validationMode),
  );
}

/**
 * Apply the distribution strategy to order/shuffle rows.
 */
function applyDistribution(
  rows: DataSourceRow[],
  distribution?: 'sequential' | 'random' | 'round-robin',
): DataSourceRow[] {
  const mode = distribution ?? 'sequential';

  if (mode === 'random') {
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // 'sequential' and 'round-robin' are identical for a single expansion pass.
  // 'round-robin' differs when the same data source is expanded across multiple VUs (Phase 6).
  return rows;
}

/**
 * Expand a queue of Scenarios, resolving any data sources into individual rows.
 * Non-parameterized scenarios pass through unchanged.
 */
export function expandQueue(queue: Scenario[]): Scenario[] {
  const expanded: Scenario[] = [];
  for (const scenario of queue) {
    expanded.push(...expandDataSource(scenario));
  }
  return expanded;
}

/**
 * Expand only specific data rows (by ID) from a Scenario's data source.
 * Used for re-running failed rows without re-executing the entire data set.
 *
 * @param scenario The base scenario with an attached dataSource
 * @param rowIds   The data row IDs to expand (e.g. failed row IDs from a previous run)
 * @returns Array of resolved scenarios, one per matching row
 */
export function expandDataSourceForRows(scenario: Scenario, rowIds: string[]): Scenario[] {
  const dt = scenario.dataSource;
  if (!dt || dt.columns.length === 0 || rowIds.length === 0) return [];

  const rowIdSet = new Set(rowIds);
  const matchedRows = dt.rows.filter(r => rowIdSet.has(r.id));
  if (matchedRows.length === 0) return [];

  return matchedRows.map((row, idx) =>
    resolveScenarioFromDataRow(scenario, dt.columns, row, idx, dt.arrayValidationMode, dt.validationMode),
  );
}

// ─── Tag & Subset Filtering ──────────────────────────────────

/** Built-in tag suggestions shown in the UI autocomplete. */
export const BUILT_IN_TAGS = ['happy-path', 'edge-case', 'negative', 'boundary', 'regression', 'smoke'] as const;

/**
 * Filter rows by tags.
 * @param rows  The rows to filter
 * @param tags  Tags to match against
 * @param mode  'any' = row matches if it has ANY of the tags, 'all' = row must have ALL tags
 */
export function filterRowsByTags(
  rows: DataSourceRow[],
  tags: string[],
  mode: 'any' | 'all' = 'any',
): DataSourceRow[] {
  if (tags.length === 0) return rows;
  return rows.filter(r => {
    const rowTags = r.tags ?? [];
    if (rowTags.length === 0) return false;
    return mode === 'any'
      ? tags.some(t => rowTags.includes(t))
      : tags.every(t => rowTags.includes(t));
  });
}

/**
 * Apply a DataSubset filter to rows.
 */
export function filterRowsBySubset(
  rows: DataSourceRow[],
  subset: DataSubset,
): DataSourceRow[] {
  if (subset.filter.type === 'tags') {
    return filterRowsByTags(rows, subset.filter.tags, subset.filter.mode);
  }
  const idSet = new Set(subset.filter.rowIds);
  return rows.filter(r => idSet.has(r.id));
}

/**
 * Collect all unique tags across all rows in a data source.
 */
export function collectAllTags(rows: DataSourceRow[]): string[] {
  const tagSet = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      tagSet.add(tag);
    }
  }
  return [...tagSet].sort();
}

/**
 * Count rows per tag.
 */
export function countRowsByTag(rows: DataSourceRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Expand a Scenario but only include rows matching the given tags.
 * Combines tag filtering with standard data source expansion.
 */
export function expandDataSourceWithTags(
  scenario: Scenario,
  tags: string[],
  mode: 'any' | 'all' = 'any',
): Scenario[] {
  const dt = scenario.dataSource;
  if (!dt || dt.columns.length === 0 || dt.rows.length === 0) {
    return [scenario];
  }

  let rows = dt.rows.filter(r => r.enabled);
  if (tags.length > 0) {
    rows = filterRowsByTags(rows, tags, mode);
  }
  if (rows.length === 0) return [];

  const orderedRows = applyDistribution(rows, dt.distribution);
  return orderedRows.map((row, idx) =>
    resolveScenarioFromDataRow(scenario, dt.columns, row, idx, dt.arrayValidationMode, dt.validationMode),
  );
}

/**
 * Expand a Scenario but only include rows matching a named subset.
 */
export function expandDataSourceWithSubset(
  scenario: Scenario,
  subsetName: string,
): Scenario[] {
  const dt = scenario.dataSource;
  if (!dt || dt.columns.length === 0 || dt.rows.length === 0) {
    return [scenario];
  }

  const subset = dt.subsets?.find(s => s.name === subsetName);
  if (!subset) return expandDataSource(scenario);

  let rows = dt.rows.filter(r => r.enabled);
  rows = filterRowsBySubset(rows, subset);
  if (rows.length === 0) return [];

  const orderedRows = applyDistribution(rows, dt.distribution);
  return orderedRows.map((row, idx) =>
    resolveScenarioFromDataRow(scenario, dt.columns, row, idx, dt.arrayValidationMode, dt.validationMode),
  );
}

// ─── Scenario-Level Tag Functions ─────────────────────────────

/** Built-in scenario-level tag suggestions (different purpose than data row tags). */
export const BUILT_IN_SCENARIO_TAGS = [
  'smoke',        // Fast sanity checks
  'regression',   // Full test suite
  'critical',     // Business-critical paths
  'integration',  // Cross-service tests
  'e2e',          // End-to-end flows
  'performance',  // Load/stress tests
  'slow',         // Long-running tests (>30s)
  'flaky',        // Known unstable tests
  'wip',          // Work in progress
  'skip',         // Temporarily disabled
] as const;

/**
 * Normalize a tag: lowercase, trim, remove special characters except hyphen and underscore.
 */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '');
}

/**
 * Filter TestScenarios by tags.
 * @param scenarios  The scenarios to filter
 * @param tags       Tags to match against (will be normalized to lowercase)
 * @param mode       'any' = scenario matches if it has ANY of the tags, 'all' = must have ALL tags
 */
export function filterScenariosByTags(
  scenarios: TestScenario[],
  tags: string[],
  mode: 'any' | 'all' = 'any',
): TestScenario[] {
  if (tags.length === 0) return scenarios;
  const normalizedTags = tags.map(t => t.toLowerCase().trim());
  return scenarios.filter(sc => {
    const scTags = sc.tags ?? [];
    if (scTags.length === 0) return false;
    return mode === 'any'
      ? normalizedTags.some(t => scTags.includes(t))
      : normalizedTags.every(t => scTags.includes(t));
  });
}

/**
 * Collect all unique tags across all scenarios in all feature groups.
 */
export function collectAllScenarioTags(featureGroups: FeatureGroup[]): string[] {
  const tagSet = new Set<string>();
  for (const fg of featureGroups) {
    for (const sc of fg.scenarios) {
      for (const tag of sc.tags ?? []) {
        tagSet.add(tag);
      }
    }
  }
  return [...tagSet].sort();
}

/**
 * Count how many scenarios have each tag.
 */
export function countScenariosByTag(featureGroups: FeatureGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fg of featureGroups) {
    for (const sc of fg.scenarios) {
      for (const tag of sc.tags ?? []) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
  }
  return counts;
}
