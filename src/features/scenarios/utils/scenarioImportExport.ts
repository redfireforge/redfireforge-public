import { v4 as uuidv4 } from 'uuid';
import type { TestScenario, FeatureGroup, Scenario } from '@shared/types';
import {
  redactGrpcAuthConfig,
  redactGrpcMetadataForExport,
} from '@shared/grpc/grpcRedaction';
import { assertGrpcCrossFeatureExportSafe } from '@shared/grpc/grpcPersistRedactionMiddleware';

export interface VersionExportOptions {
  includeResponseVersions: boolean;
  includeRulesVersions: boolean;
  includeDefinitionVersions: boolean;
  includeStructureLog: boolean;
}

export const DEFAULT_VERSION_EXPORT: VersionExportOptions = {
  includeResponseVersions: true,
  includeRulesVersions: true,
  includeDefinitionVersions: true,
  includeStructureLog: true,
};

/** Strip version arrays from a single Scenario based on options. */
function stripTestVersions(test: Scenario, opts: VersionExportOptions): Scenario {
  if (opts.includeResponseVersions && opts.includeRulesVersions && opts.includeDefinitionVersions) return test;
  const result = { ...test };
  const validation = { ...test.validation };
  if (!opts.includeResponseVersions) delete validation.responseVersions;
  if (!opts.includeRulesVersions) delete validation.rulesVersions;
  if (!opts.includeDefinitionVersions) delete result.definitionVersions;
  return { ...result, validation };
}

/** Strip version arrays from scenarios. */
function stripScenarioVersions(scenarios: TestScenario[], opts: VersionExportOptions): TestScenario[] {
  return scenarios.map((sc) => ({
    ...sc,
    tests: sc.tests.map((t) => stripTestVersions(t, opts)),
  }));
}

/**
 * Strip response/rules version arrays from exported data at any level.
 * Handles FeatureGroup[], FeatureGroup, TestScenario[], TestScenario, Scenario.
 */
export function stripVersions(data: unknown, opts: VersionExportOptions): unknown {
  if (opts.includeResponseVersions && opts.includeRulesVersions && opts.includeDefinitionVersions && opts.includeStructureLog) return data;

  // Single Scenario (test)
  if (data && typeof data === 'object' && 'url' in data && 'method' in data && 'validation' in data) {
    return stripTestVersions(data as Scenario, opts);
  }
  // Single TestScenario
  if (data && typeof data === 'object' && 'tests' in data && Array.isArray((data as TestScenario).tests) && !('scenarios' in data)) {
    const sc = data as TestScenario;
    return { ...sc, tests: sc.tests.map((t) => stripTestVersions(t, opts)) };
  }
  // Single FeatureGroup
  if (data && typeof data === 'object' && 'scenarios' in data && Array.isArray((data as FeatureGroup).scenarios)) {
    const fg = data as FeatureGroup;
    const stripped: FeatureGroup = { ...fg, scenarios: stripScenarioVersions(fg.scenarios, opts) };
    if (!opts.includeStructureLog) delete stripped.structureLog;
    return stripped;
  }
  // Array of FeatureGroups or TestScenarios
  if (Array.isArray(data)) {
    return data.map((item) => stripVersions(item, opts));
  }
  return data;
}

/** Count how many tests have version data in the given data structure. */
export function countVersions(data: unknown): { responseVersionCount: number; rulesVersionCount: number; definitionVersionCount: number; structureLogCount: number } {
  let responseVersionCount = 0;
  let rulesVersionCount = 0;
  let definitionVersionCount = 0;
  let structureLogCount = 0;

  function walkTest(t: Scenario) {
    if (t.validation?.responseVersions?.length) responseVersionCount += t.validation.responseVersions.length;
    if (t.validation?.rulesVersions?.length) rulesVersionCount += t.validation.rulesVersions.length;
    if (t.definitionVersions?.length) definitionVersionCount += t.definitionVersions.length;
  }
  function walkScenarios(scenarios: TestScenario[]) {
    for (const sc of scenarios) sc.tests.forEach(walkTest);
  }

  if (data && typeof data === 'object' && 'url' in data && 'method' in data && 'validation' in data) {
    walkTest(data as Scenario);
  } else if (data && typeof data === 'object' && 'tests' in data && Array.isArray((data as TestScenario).tests) && !('scenarios' in data)) {
    (data as TestScenario).tests.forEach(walkTest);
  } else if (data && typeof data === 'object' && 'scenarios' in data && Array.isArray((data as FeatureGroup).scenarios)) {
    const fg = data as FeatureGroup;
    walkScenarios(fg.scenarios);
    if (fg.structureLog?.length) structureLogCount += fg.structureLog.length;
  } else if (Array.isArray(data)) {
    for (const item of data) {
      const c = countVersions(item);
      responseVersionCount += c.responseVersionCount;
      rulesVersionCount += c.rulesVersionCount;
      definitionVersionCount += c.definitionVersionCount;
      structureLogCount += c.structureLogCount;
    }
  }

  return { responseVersionCount, rulesVersionCount, definitionVersionCount, structureLogCount };
}

/** Returns true if data contains any response, rules, or definition version entries. */
export function hasVersionData(data: unknown): boolean {
  const c = countVersions(data);
  return c.responseVersionCount > 0 || c.rulesVersionCount > 0 || c.definitionVersionCount > 0 || c.structureLogCount > 0;
}

export function reIdScenarios(scenarios: TestScenario[]): TestScenario[] {
  return scenarios.map((sc) => ({ ...sc, id: uuidv4(), tests: sc.tests.map((t) => normalizeTestFields({ ...t, id: uuidv4() })) }));
}

/**
 * Normalize legacy field names in imported test data.
 * Handles: expectedFields using "path"/"value" instead of "jsonPath"/"expectedValue".
 */
export function normalizeTestFields(test: Scenario): Scenario {
  if (!test.validation?.expectedFields?.length) return test;
  const fields = test.validation.expectedFields.map(f => {
    const raw = f as unknown as Record<string, unknown>;
    return {
      ...f,
      jsonPath: f.jsonPath || (raw.path as string) || '',
      expectedValue: f.expectedValue || (raw.value as string) || '',
    };
  });
  return { ...test, validation: { ...test.validation, expectedFields: fields } };
}

export interface ScenarioExportWrap {
  _exportMeta: {
    microservice?: string;
    environment?: string;
    exportedAt: string;
    level: string;
    includesResponseVersions?: boolean;
    includesRulesVersions?: boolean;
    includesDefinitionVersions?: boolean;
  };
  data: unknown;
}

export function wrapExport(
  data: unknown,
  level: string,
  opts: { microservice?: string; environment?: string },
  versionOpts?: VersionExportOptions,
): ScenarioExportWrap {
  const effectiveOpts = versionOpts ?? DEFAULT_VERSION_EXPORT;
  const stripped = stripVersions(data, effectiveOpts);
  const redacted = redactGrpcScenarioDefinitionsForExport(stripped);
  assertGrpcCrossFeatureExportSafe({ scenario_definition_export: redacted }, 'scenario_definition_export');
  return {
    _exportMeta: {
      microservice: opts.microservice,
      environment: opts.environment,
      exportedAt: new Date().toISOString(),
      level,
      includesResponseVersions: effectiveOpts.includeResponseVersions,
      includesRulesVersions: effectiveOpts.includeRulesVersions,
      includesDefinitionVersions: effectiveOpts.includeDefinitionVersions,
    },
    data: redacted,
  };
}

function redactGrpcScenarioDefinitionsForExport(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => redactGrpcScenarioDefinitionsForExport(entry));
  }
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (isFeatureGroup(data)) {
    return {
      ...data,
      scenarios: data.scenarios.map((scenario) => redactGrpcScenarioDefinitionsForExport(scenario) as TestScenario),
    };
  }

  if (isTestScenario(data)) {
    return {
      ...data,
      tests: data.tests.map((test) => redactGrpcScenarioDefinitionsForExport(test) as Scenario),
    };
  }

  if (isScenario(data)) {
    const grpc = data.grpcCallAction;
    if (!grpc) {
      return data;
    }
    return {
      ...data,
      grpcCallAction: {
        ...grpc,
        metadata: redactGrpcMetadataForExport(grpc.metadata, grpc.auth),
        auth: redactGrpcAuthConfig(grpc.auth),
      },
    };
  }

  return data;
}

function isScenario(data: unknown): data is Scenario {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<Scenario>;
  return typeof candidate.url === 'string'
    && typeof candidate.method === 'string'
    && typeof candidate.validation === 'object';
}

function isTestScenario(data: unknown): data is TestScenario {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<TestScenario>;
  return Array.isArray(candidate.tests) && !('scenarios' in (data as Record<string, unknown>));
}

function isFeatureGroup(data: unknown): data is FeatureGroup {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<FeatureGroup>;
  return Array.isArray(candidate.scenarios);
}

export interface UnwrapResult {
  data: unknown;
  meta?: ScenarioExportWrap['_exportMeta'];
}

export function unwrapImport(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && '_exportMeta' in raw && 'data' in raw) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

export function unwrapImportWithMeta(raw: unknown): UnwrapResult {
  if (raw && typeof raw === 'object' && '_exportMeta' in raw && 'data' in raw) {
    const wrap = raw as ScenarioExportWrap;
    return { data: wrap.data, meta: wrap._exportMeta };
  }
  return { data: raw };
}

export function pickJsonFile(onLoad: (data: unknown) => void, onError?: (msg: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  if (input.style) input.style.display = 'none';
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    input.remove?.();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        onLoad(JSON.parse(ev.target?.result as string));
      } catch { onError?.('Failed to parse JSON file.'); }
    };
    reader.readAsText(file);
  };
  if (input instanceof HTMLInputElement) {
    document.body.appendChild(input);
  }
  input.click();
}
