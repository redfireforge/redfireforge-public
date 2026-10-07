/**
 * Phase 9C — proxied exchange → inactive route/sample drafts with redaction + dedup.
 */
import type {
  ApiMockCapturedRequestV1,
  ApiMockDiagnosticV1,
  ApiMockRouteV1,
  ApiMockServerSettingsV1,
  ApiMockSimulationSampleV1,
} from './contracts';
import { DEFAULT_SETTINGS } from './defaults';
import { convertSourceToRule, type ConversionResult } from './sourceToRule';

export interface ProxiedResponseCapture {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  contentType?: string;
}

export interface ApiMockRecordedDraftV1 {
  id: string;
  fingerprint: string;
  recordedAt: string;
  route: ApiMockRouteV1;
  sample: ApiMockSimulationSampleV1;
  diagnostics: ApiMockDiagnosticV1[];
}

const DEFAULT_SECRET_HEADERS = DEFAULT_SETTINGS.redaction.headerNames.map(h => h.toLowerCase());

/** Transport and body metadata. Content-Type stays on the response body. */
const RESPONSE_HEADER_SKIP = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'set-cookie',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-redfireforge-mock',
]);

function responseHeadersToVariant(
  headers: Record<string, string | string[]>,
  headerNames: string[],
  preserveScheme: boolean,
): Array<{ id: string; key: string; value: string; enabled: boolean }> {
  const redacted = redactHeaderMap(headers, headerNames, preserveScheme);
  const rows: Array<{ id: string; key: string; value: string; enabled: boolean }> = [];
  for (const [key, value] of Object.entries(redacted)) {
    if (!key || RESPONSE_HEADER_SKIP.has(key.toLowerCase())) continue;
    rows.push({
      id: `hdr-${crypto.randomUUID().slice(0, 8)}`,
      key,
      value,
      enabled: true,
    });
  }
  return rows;
}

export function draftFingerprint(method: string, path: string, status: number): string {
  return `${method.toUpperCase()} ${path} → ${status}`;
}

export function redactHeaderMap(
  headers: Record<string, string | string[]>,
  headerNames: string[] = DEFAULT_SECRET_HEADERS,
  preserveScheme = true,
): Record<string, string> {
  const names = new Set(headerNames.map(h => h.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(headers)) {
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw);
    if (!names.has(k.toLowerCase())) {
      out[k] = value;
      continue;
    }
    if (preserveScheme) {
      const m = value.match(/^(\S+)\s+/);
      out[k] = m ? `${m[1]} [REDACTED]` : '[REDACTED]';
    } else {
      out[k] = '[REDACTED]';
    }
  }
  return out;
}

/** Build an inactive draft route + sample from a successful proxied exchange. */
export function proxiedExchangeToDraft(
  request: ApiMockCapturedRequestV1,
  response: ProxiedResponseCapture,
  settings?: ApiMockServerSettingsV1,
): ConversionResult {
  const redaction = settings?.redaction ?? DEFAULT_SETTINGS.redaction;
  const headers = redactHeaderMap(
    request.headers as Record<string, string | string[]>,
    redaction.headerNames,
    redaction.preserveScheme,
  );
  const query = Object.fromEntries(
    Object.entries(request.query ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? '' : String(v)]),
  );
  const contentType = response.contentType
    ?? (Array.isArray(response.headers['content-type'])
      ? response.headers['content-type'][0]
      : response.headers['content-type'] as string | undefined)
    ?? (Array.isArray(response.headers['Content-Type'])
      ? response.headers['Content-Type'][0]
      : response.headers['Content-Type'] as string | undefined);

  const result = convertSourceToRule(
    {
      method: request.method,
      path: request.path,
      headers,
      query,
      body: typeof request.body === 'string' ? request.body : undefined,
      contentType: headers['content-type'] ?? headers['Content-Type'],
      responseBody: response.body,
      responseContentType: contentType,
      status: response.status,
    },
    {
      sourceKind: 'journal',
      sourceLabel: `Proxy record ${draftFingerprint(request.method, request.path, response.status)}`,
    },
  );

  const diagnostics = [...result.diagnostics];
  const secretHits = Object.keys(request.headers).filter(k =>
    redaction.headerNames.map(h => h.toLowerCase()).includes(k.toLowerCase()),
  ).length;
  if (secretHits > 0) {
    diagnostics.push({
      code: 'AMS-REDACTION-SECRET-DETECTED',
      severity: 'warning',
      path: '/recording',
      message: `Redacted ${secretHits} secret header(s) from recorded draft. Review before enabling.`,
    });
  }

  const recordedHeaders = responseHeadersToVariant(
    response.headers,
    redaction.headerNames,
    redaction.preserveScheme,
  );
  return {
    ...result,
    route: {
      ...result.route,
      enabled: false,
      name: `Recorded ${request.method} ${request.path}`,
      responses: result.route.responses.map((variant, index) => (
        index === 0 ? { ...variant, headers: recordedHeaders } : variant
      )),
    },
    diagnostics,
  };
}

export function toRecordedDraft(
  conversion: ConversionResult,
  fingerprint: string,
  recordedAt = new Date().toISOString(),
  id?: string,
): ApiMockRecordedDraftV1 {
  return {
    id: id ?? `rec-${crypto.randomUUID().slice(0, 10)}`,
    fingerprint,
    recordedAt,
    route: { ...conversion.route, enabled: false },
    sample: conversion.sample,
    diagnostics: conversion.diagnostics,
  };
}

/** Native listener capture — converted to a draft on poll, not in Rust. */
export interface NativeProxyCaptureV1 {
  id: string;
  fingerprint: string;
  recordedAt: string;
  request: ApiMockCapturedRequestV1;
  response: ProxiedResponseCapture;
  redaction?: {
    headerNames?: string[];
    jsonPaths?: string[];
    preserveScheme?: boolean;
  };
}

/** Convert a native proxied capture into a Studio draft, preserving native id/timestamp. */
export function nativeCaptureToDraft(capture: NativeProxyCaptureV1): ApiMockRecordedDraftV1 | null {
  try {
    const conversion = proxiedExchangeToDraft(
      capture.request,
      capture.response,
      {
        ...DEFAULT_SETTINGS,
        redaction: {
          headerNames: capture.redaction?.headerNames ?? DEFAULT_SETTINGS.redaction.headerNames,
          jsonPaths: capture.redaction?.jsonPaths ?? DEFAULT_SETTINGS.redaction.jsonPaths,
          preserveScheme: capture.redaction?.preserveScheme ?? DEFAULT_SETTINGS.redaction.preserveScheme,
        },
      },
    );
    return toRecordedDraft(conversion, capture.fingerprint, capture.recordedAt, capture.id);
  } catch {
    return null;
  }
}

/** Merge recorded drafts into workspace routes — skips fingerprints already present. */
function fillMissingResponseHeaders(existing: ApiMockRouteV1, incoming: ApiMockRouteV1): ApiMockRouteV1 | null {
  const source = incoming.responses[0];
  if (!source || source.headers.length === 0 || existing.responses.length === 0) return null;
  const enabled = existing.responses.findIndex(variant => variant.enabled);
  const target = enabled >= 0 ? enabled : 0;
  if (existing.responses[target].headers.length > 0) return null;
  return {
    ...existing,
    updatedAt: new Date().toISOString(),
    responses: existing.responses.map((variant, index) => (
      index === target ? { ...variant, headers: source.headers } : variant
    )),
  };
}

export function mergeRecordedDraftsIntoRoutes(
  existing: ApiMockRouteV1[],
  drafts: ApiMockRecordedDraftV1[],
): { routes: ApiMockRouteV1[]; added: number; skipped: number; updated: number } {
  const seen = new Set(existing.map(routeFingerprintFromRoute));
  const next = [...existing];
  let added = 0;
  let skipped = 0;
  let updated = 0;
  for (const draft of drafts) {
    if (seen.has(draft.fingerprint)) {
      const index = next.findIndex(route => routeFingerprintFromRoute(route) === draft.fingerprint);
      const filled = index >= 0 ? fillMissingResponseHeaders(next[index], draft.route) : null;
      if (filled) {
        next[index] = filled;
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    seen.add(draft.fingerprint);
    next.push({ ...draft.route, enabled: false });
    added += 1;
  }
  return { routes: next, added, skipped, updated };
}

export function routeFingerprintFromRoute(route: ApiMockRouteV1): string {
  const status = route.responses.find(r => r.enabled)?.status
    ?? route.responses[0]?.status
    ?? 200;
  return draftFingerprint(route.method, route.path.value, status);
}
