import type { ApiMockDiagnosticV1, ApiMockRouteV1 } from '@shared/api-mock/contracts';
import type { SourceRequest } from '@shared/api-mock/sourceToRule';
import { parseCurl } from '@shared/utils/curlParser';

export type ApiMockImportSourceId = 'curl' | 'catalog' | 'requests' | 'openapi' | 'wiremock' | 'native' | 'har';
export type ImportMode = 'merge' | 'replace' | 'copy';
export type ImportSource = ApiMockImportSourceId;

export interface ImportOptions {
  mode: ImportMode;
  newFolderName?: string;
}

export interface PreviewState {
  routes: ApiMockRouteV1[];
  diagnostics: ApiMockDiagnosticV1[];
  lossReport: string[];
}

export interface CatalogPick {
  key: string;
  label: string;
  method: string;
  path: string;
}

export interface RequestPick {
  key: string;
  label: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
}

export const IMPORT_SOURCES: Array<{ id: ImportSource; label: string; hint: string }> = [
  { id: 'curl', label: 'cURL command', hint: 'Generate rule and sample' },
  { id: 'openapi', label: 'OpenAPI / Swagger', hint: 'Paste JSON or YAML' },
  { id: 'catalog', label: 'Catalog endpoints', hint: 'Select one or many operations' },
  { id: 'requests', label: 'Requests collection', hint: 'Promote items or folders' },
  { id: 'native', label: 'RedfireForge export', hint: 'Native round-trip' },
  { id: 'wiremock', label: 'WireMock mappings', hint: 'Import stub definitions' },
  { id: 'har', label: 'HAR capture', hint: 'Browser/devtools archive (redacted)' },
];

export function parseCurlToSource(curl: string): SourceRequest {
  const parsed = parseCurl(curl);
  const requested = curl.match(/(?:-X|--request)\s+['"]?([A-Za-z]+)/i)?.[1];
  const method = requested ?? parsed.method ?? 'GET';
  const rawUrl = parsed.url?.trim() || '/';
  const { path, query } = splitCurlUrl(rawUrl);
  const headers: Record<string, string> = {};
  for (const header of parsed.headers ?? []) {
    if (!header.key) continue;
    headers[header.key] = header.value;
  }
  const body = parsed.body || undefined;
  const ct = headers['Content-Type'] || headers['content-type'];
  return { method, path, query, headers, body, contentType: ct };
}

function splitCurlUrl(rawUrl: string): { path: string; query: Record<string, string> } {
  const query: Record<string, string> = {};
  try {
    const url = new URL(rawUrl);
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    return { path: url.pathname || '/', query };
  } catch {
    const [pathPart, search = ''] = rawUrl.split('?');
    if (search) {
      for (const pair of search.split('&')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
      }
    }
    return { path: pathPart || '/', query };
  }
}

export function responseStatusMeta(status: number): { statusClass: string; statusText: string } {
  const statusClass = status < 300 ? 'success' : status < 500 ? 'warning' : 'danger';
  const statusText = status < 300 ? 'OK' : status < 400 ? 'Redirect' : status < 500 ? 'Client Error' : 'Server Error';
  return { statusClass, statusText };
}

export function splitPathParams(pathValue: string): string[] {
  return pathValue.split(/(\{[^}]+\})/);
}
