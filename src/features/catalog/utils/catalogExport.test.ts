import { describe, it, expect } from 'vitest';
import type { CatalogEndpoint, CatalogServer, SavedEndpointValues } from '../types/catalog';
import { buildExportRequests, buildCatalogExport } from './catalogExport';
import type { CatalogExportPayload, CatalogExportContext } from './catalogExport';

function makeEndpoint(overrides: Partial<CatalogEndpoint> = {}): CatalogEndpoint {
  return {
    id: 'ep-1',
    summary: 'Get users',
    method: 'GET',
    path: '/users',
    parameters: [],
    responses: [],
    tags: [],
    ...overrides,
  };
}

function makeSaved(overrides: Partial<SavedEndpointValues> = {}): SavedEndpointValues {
  return { params: {}, headers: {}, body: '', ...overrides };
}

// ─── buildExportRequests ─────────────────────────────────

describe('buildExportRequests', () => {
  it('creates a request with correct method, name, and URL', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.example.com', '', {}, new Set(), {});
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe('GET');
    expect(reqs[0].name).toBe('Get users');
    expect(reqs[0].url).toBe('https://api.example.com/users');
  });

  it('uses custom name when provided', () => {
    const ep = makeEndpoint({ id: 'ep-1' });
    const reqs = buildExportRequests([ep], 'https://api.com', '', { 'ep-1': 'My Custom Name' }, new Set(), {});
    expect(reqs[0].name).toBe('My Custom Name');
  });

  it('falls back to method + path when summary is empty', () => {
    const ep = makeEndpoint({ summary: '', method: 'POST', path: '/items' });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].name).toBe('POST /items');
  });

  it('appends server path prefix correctly', () => {
    const ep = makeEndpoint({ path: '/users' });
    const reqs = buildExportRequests([ep], 'https://api.com', '/api/v1', {}, new Set(), {});
    expect(reqs[0].url).toBe('https://api.com/api/v1/users');
  });

  it('normalizes path without leading slash', () => {
    const ep = makeEndpoint({ path: 'users' });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].url).toBe('https://api.com/users');
  });

  it('strips trailing slashes from base URL', () => {
    const ep = makeEndpoint({ path: '/users' });
    const reqs = buildExportRequests([ep], 'https://api.com/', '', {}, new Set(), {});
    expect(reqs[0].url).toBe('https://api.com/users');
  });

  it('replaces path parameters with saved values', () => {
    const ep = makeEndpoint({
      id: 'ep-1',
      path: '/users/{userId}/orders/{orderId}',
      parameters: [
        { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
      ],
    });
    const saved: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ params: { userId: '123', orderId: '456' } }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(['ep-1']), saved);
    expect(reqs[0].url).toBe('https://api.com/users/123/orders/456');
  });

  it('keeps path parameter placeholders when no saved value', () => {
    const ep = makeEndpoint({
      path: '/users/{userId}',
      parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
    });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].url).toBe('https://api.com/users/{userId}');
  });

  it('appends query parameters from saved values', () => {
    const ep = makeEndpoint({
      id: 'ep-1',
      path: '/search',
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
      ],
    });
    const saved: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ params: { q: 'test', page: '2' } }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(['ep-1']), saved);
    expect(reqs[0].url).toBe('https://api.com/search?q=test&page=2');
  });

  it('does not append query params when no saved value', () => {
    const ep = makeEndpoint({
      path: '/search',
      parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
    });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].url).toBe('https://api.com/search');
    expect(reqs[0].savedQueryParams).toHaveLength(1);
    expect(reqs[0].savedQueryParams![0].value).toBe('');
  });

  it('always includes Content-Type header', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].headers[0]).toEqual({ key: 'Content-Type', value: 'application/json' });
  });

  it('includes spec-defined header parameters', () => {
    const ep = makeEndpoint({
      id: 'ep-1',
      parameters: [{ name: 'X-Custom', in: 'header', required: false, schema: { type: 'string' } }],
    });
    const saved: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ headers: { 'X-Custom': 'myvalue' } }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(['ep-1']), saved);
    expect(reqs[0].headers).toHaveLength(2);
    expect(reqs[0].headers[1]).toEqual({ key: 'X-Custom', value: 'myvalue' });
  });

  it('includes saved body when sample is selected', () => {
    const ep = makeEndpoint({ id: 'ep-1', method: 'POST' });
    const saved: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ body: '{"name":"test"}' }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(['ep-1']), saved);
    expect(reqs[0].body).toBe('{"name":"test"}');
    expect(reqs[0].bodyType).toBe('json');
  });

  it('does not include body when sample not selected', () => {
    const ep = makeEndpoint({ id: 'ep-1', method: 'POST' });
    const saved: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ body: '{"name":"test"}' }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), saved);
    expect(reqs[0].body).toBe('');
    expect(reqs[0].bodyType).toBeUndefined();
  });

  it('sets auth to inherit', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].auth).toEqual({ type: 'inherit' });
  });

  it('URL-encodes query parameter keys and values', () => {
    const ep = makeEndpoint({
      id: 'ep-1',
      path: '/search',
      parameters: [{ name: 'q&key', in: 'query', required: false, schema: { type: 'string' } }],
    });
    const saved: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ params: { 'q&key': 'hello world' } }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(['ep-1']), saved);
    expect(reqs[0].url).toContain('q%26key=hello%20world');
  });

  it('generates unique ids for each request', () => {
    const ep1 = makeEndpoint({ id: 'ep-1' });
    const ep2 = makeEndpoint({ id: 'ep-2', summary: 'Second' });
    const reqs = buildExportRequests([ep1, ep2], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].id).not.toBe(reqs[1].id);
    expect(reqs[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ─── buildCatalogExport ──────────────────────────────────

describe('buildCatalogExport', () => {
  const basePayload: CatalogExportPayload = {
    collectionName: 'test-api',
    envs: [
      { envId: 'env-test', envName: 'test', baseUrl: 'https://test.example.com' },
      { envId: 'env-prod', envName: 'prod', baseUrl: 'https://prod.example.com' },
    ],
    endpoints: [makeEndpoint()],
    customNames: {},
    sampleEpIds: new Set(),
    savedEpValues: {},
  };

  const baseContext: CatalogExportContext = {
    servers: [{ url: 'https://api.example.com' }] as CatalogServer[],
    microserviceId: 'svc-1',
    versionLabel: '1.0.0',
    existingEnvNames: new Map(),
  };

  it('creates a collection with version suffix', () => {
    const { collection } = buildCatalogExport(basePayload, baseContext);
    expect(collection.name).toBe('test-api (1.0.0)');
    expect(collection.mode).toBe('multi-env');
    expect(collection.microserviceId).toBe('svc-1');
  });

  it('omits version suffix when versionLabel is undefined', () => {
    const ctx = { ...baseContext, versionLabel: undefined };
    const { collection } = buildCatalogExport(basePayload, ctx);
    expect(collection.name).toBe('test-api');
  });

  it('creates environment folders as sub-collections', () => {
    const { collection } = buildCatalogExport(basePayload, baseContext);
    expect(collection.folders).toHaveLength(2);
    expect(collection.folders![0].name).toBe('test');
    expect(collection.folders![1].name).toBe('prod');
    expect(collection.folders![0].isSubCollection).toBe(true);
    expect(collection.folders![1].isSubCollection).toBe(true);
  });

  it('each env folder has requests built with the correct base URL', () => {
    const { collection } = buildCatalogExport(basePayload, baseContext);
    expect(collection.folders![0].requests[0].url).toContain('test.example.com');
    expect(collection.folders![1].requests[0].url).toContain('prod.example.com');
  });

  it('maps existing wb environments by name', () => {
    const ctx = {
      ...baseContext,
      existingEnvNames: new Map([['test', 'req-test-id']]),
    };
    const { collection, newEnvironments } = buildCatalogExport(basePayload, ctx);
    expect(newEnvironments).toHaveLength(1);
    expect(newEnvironments[0].name).toBe('prod');
    expect(collection.baseUrls!['req-test-id']).toBe('https://test.example.com');
  });

  it('creates new environments for unknown env names', () => {
    const { newEnvironments } = buildCatalogExport(basePayload, baseContext);
    expect(newEnvironments).toHaveLength(2);
    expect(newEnvironments.map(e => e.name)).toEqual(['test', 'prod']);
  });

  it('collection baseUrls maps wbEnvIds to base URLs', () => {
    const { collection, newEnvironments } = buildCatalogExport(basePayload, baseContext);
    for (const ne of newEnvironments) {
      expect(collection.baseUrls![ne.id]).toBeDefined();
    }
  });

  it('collection has no root-level requests', () => {
    const { collection } = buildCatalogExport(basePayload, baseContext);
    expect(collection.requests).toHaveLength(0);
  });

  it('env folders have baseUrls and selectedEnvId', () => {
    const { collection, newEnvironments } = buildCatalogExport(basePayload, baseContext);
    const t01Env = newEnvironments.find(e => e.name === 'test')!;
    const t01Folder = collection.folders![0];
    expect(t01Folder.selectedEnvId).toBe(t01Env.id);
    expect(t01Folder.baseUrls![t01Env.id]).toBe('https://test.example.com');
  });

  it('env folders have empty sub-folders array', () => {
    const { collection } = buildCatalogExport(basePayload, baseContext);
    for (const folder of collection.folders!) {
      expect(folder.folders).toEqual([]);
    }
  });

  it('handles empty endpoints', () => {
    const payload = { ...basePayload, endpoints: [] };
    const { collection } = buildCatalogExport(payload, baseContext);
    expect(collection.folders![0].requests).toHaveLength(0);
  });

  it('handles empty envs', () => {
    const payload = { ...basePayload, envs: [] };
    const { collection, newEnvironments } = buildCatalogExport(payload, baseContext);
    expect(collection.folders).toHaveLength(0);
    expect(newEnvironments).toHaveLength(0);
    expect(Object.keys(collection.baseUrls!)).toHaveLength(0);
  });

  it('handles servers with path prefix', () => {
    const ctx = {
      ...baseContext,
      servers: [{ url: 'https://api.example.com/api/v2' }] as CatalogServer[],
    };
    const { collection } = buildCatalogExport(basePayload, ctx);
    expect(collection.folders![0].requests[0].url).toContain('/api/v2/users');
  });

  it('generates unique IDs for collection and folders', () => {
    const result1 = buildCatalogExport(basePayload, baseContext);
    const result2 = buildCatalogExport(basePayload, baseContext);
    expect(result1.collection.id).not.toBe(result2.collection.id);
  });

  it('sets groupId on collection when provided in context', () => {
    const ctx = { ...baseContext, groupId: 'grp-1' };
    const { collection } = buildCatalogExport(basePayload, ctx);
    expect(collection.groupId).toBe('grp-1');
  });

  it('sets sourceSpec on requests from catalogEntryName and versionLabel', () => {
    const ctx = { ...baseContext, catalogEntryName: 'Payment API', versionLabel: 'v2.1' };
    const { collection } = buildCatalogExport(basePayload, ctx);
    const req = collection.folders![0].requests[0];
    expect(req.catalogMeta).toBeDefined();
    expect(req.catalogMeta!.sourceSpec).toBe('Payment API v2.1');
  });

  it('sets sourceSpec without version when versionLabel is undefined', () => {
    const ctx = { ...baseContext, versionLabel: undefined, catalogEntryName: 'My API' };
    const { collection } = buildCatalogExport(basePayload, ctx);
    const req = collection.folders![0].requests[0];
    expect(req.catalogMeta!.sourceSpec).toBe('My API');
  });
});

// ─── catalogMeta population ─────────────────────────────

describe('catalogMeta on exported requests', () => {
  it('populates basic metadata from endpoint', () => {
    const ep = makeEndpoint({
      operationId: 'getUsers',
      description: 'Returns a list of users',
      path: '/users',
      tags: ['users', 'admin'],
    });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    const meta = reqs[0].catalogMeta;
    expect(meta).toBeDefined();
    expect(meta!.operationId).toBe('getUsers');
    expect(meta!.description).toBe('Returns a list of users');
    expect(meta!.originalPath).toBe('/users');
    expect(meta!.tags).toEqual(['users', 'admin']);
  });

  it('includes deprecated flag when set', () => {
    const ep = makeEndpoint({ deprecated: true });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].catalogMeta!.deprecated).toBe(true);
  });

  it('omits deprecated flag when not set', () => {
    const ep = makeEndpoint({ deprecated: false });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].catalogMeta!.deprecated).toBeUndefined();
  });

  it('includes parameter metadata', () => {
    const ep = makeEndpoint({
      parameters: [
        { name: 'id', in: 'path', required: true, description: 'User ID', schema: { type: 'string' } },
        { name: 'q', in: 'query', required: false, description: 'Search query', schema: { type: 'string' } },
      ],
    });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    const params = reqs[0].catalogMeta!.parameters!;
    expect(params).toHaveLength(2);
    expect(params[0]).toEqual({ name: 'id', in: 'path', required: true, description: 'User ID', type: 'string' });
    expect(params[1]).toEqual({ name: 'q', in: 'query', required: false, description: 'Search query', type: 'string' });
  });

  it('includes expected responses', () => {
    const ep = makeEndpoint({
      responses: [
        { statusCode: '200', description: 'Success' },
        { statusCode: '404', description: 'Not found' },
      ],
    });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    const resp = reqs[0].catalogMeta!.expectedResponses!;
    expect(resp).toHaveLength(2);
    expect(resp[0]).toEqual({ statusCode: '200', description: 'Success' });
    expect(resp[1]).toEqual({ statusCode: '404', description: 'Not found' });
  });

  it('includes security requirements', () => {
    const ep = makeEndpoint({ security: ['bearerAuth', 'apiKey'] });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].catalogMeta!.security).toEqual(['bearerAuth', 'apiKey']);
  });

  it('passes sourceSpec label through', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {}, 'Payment API v3');
    expect(reqs[0].catalogMeta!.sourceSpec).toBe('Payment API v3');
  });

  it('handles endpoint with minimal fields', () => {
    const ep = makeEndpoint({ operationId: undefined, description: undefined, security: undefined });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    const meta = reqs[0].catalogMeta!;
    expect(meta.operationId).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.security).toBeUndefined();
    expect(meta.tags).toEqual([]);
    expect(meta.originalPath).toBe('/users');
  });

  it('uses saved header values from epVals when endpoint is in sampleEpIds', () => {
    const ep = makeEndpoint({
      parameters: [
        { name: 'X-Custom', in: 'header', required: false, schema: { type: 'string' } },
      ],
    });
    const sampleIds = new Set(['ep-1']);
    const vals: Record<string, SavedEndpointValues> = {
      'ep-1': makeSaved({ headers: { 'X-Custom': 'saved-value' } }),
    };
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, sampleIds, vals);
    const customHeader = reqs[0].headers.find(h => h.key === 'X-Custom');
    expect(customHeader?.value).toBe('saved-value');
  });

  it('sets catalogEntryId when provided', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {}, undefined, 'entry-abc');
    expect(reqs[0].catalogMeta!.catalogEntryId).toBe('entry-abc');
  });

  it('sets catalogEndpointId from endpoint id', () => {
    const ep = makeEndpoint({ id: 'ep-xyz' });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].catalogMeta!.catalogEndpointId).toBe('ep-xyz');
  });

  it('sets catalogVersion when provided', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {}, undefined, undefined, '2.1.0');
    expect(reqs[0].catalogMeta!.catalogVersion).toBe('2.1.0');
  });

  it('leaves catalogEntryId/catalogVersion undefined when not provided', () => {
    const ep = makeEndpoint();
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {});
    expect(reqs[0].catalogMeta!.catalogEntryId).toBeUndefined();
    expect(reqs[0].catalogMeta!.catalogVersion).toBeUndefined();
  });
});

// ─── specVersions on exported requests ──────────────────

describe('specVersions on exported requests', () => {
  it('creates specVersions array with one entry on first export', () => {
    const ep = makeEndpoint({ id: 'ep-1' });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {}, undefined, 'entry-1', '1.0.0');
    expect(reqs[0].specVersions).toHaveLength(1);
    expect(reqs[0].activeSpecVersionId).toBe(reqs[0].specVersions![0].id);
  });

  it('specVersion snapshot matches request fields', () => {
    const ep = makeEndpoint({ id: 'ep-1', method: 'POST', path: '/items' });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {}, undefined, 'entry-1', '2.0.0');
    const sv = reqs[0].specVersions![0];
    expect(sv.url).toBe(reqs[0].url);
    expect(sv.method).toBe(reqs[0].method);
    expect(sv.catalogVersion).toBe('2.0.0');
    expect(sv.catalogEntryId).toBe('entry-1');
    expect(sv.catalogEndpointId).toBe('ep-1');
    expect(sv.importedAt).toBeGreaterThan(0);
  });

  it('specVersion includes savedQueryParams', () => {
    const ep = makeEndpoint({
      id: 'ep-1',
      path: '/search',
      parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
    });
    const reqs = buildExportRequests([ep], 'https://api.com', '', {}, new Set(), {}, undefined, 'entry-1', '1.0.0');
    expect(reqs[0].specVersions![0].savedQueryParams).toEqual(reqs[0].savedQueryParams);
  });
});

// ─── catalogMeta via buildCatalogExport ─────────────────

describe('catalogMeta fields via buildCatalogExport', () => {
  it('populates catalogEntryId and catalogVersion from context', () => {
    const payload: CatalogExportPayload = {
      collectionName: 'test-api',
      envs: [{ envId: 'env-1', envName: 'dev', baseUrl: 'https://dev.api.com' }],
      endpoints: [makeEndpoint({ id: 'ep-42' })],
      customNames: {},
      sampleEpIds: new Set(),
      savedEpValues: {},
    };
    const ctx: CatalogExportContext = {
      servers: [{ url: 'https://api.com' }] as CatalogServer[],
      versionLabel: '3.0.1',
      existingEnvNames: new Map(),
      catalogEntryName: 'My API',
      catalogEntryId: 'entry-99',
    };
    const { collection } = buildCatalogExport(payload, ctx);
    const req = collection.folders![0].requests[0];
    expect(req.catalogMeta!.catalogEntryId).toBe('entry-99');
    expect(req.catalogMeta!.catalogEndpointId).toBe('ep-42');
    expect(req.catalogMeta!.catalogVersion).toBe('3.0.1');
    expect(req.catalogMeta!.sourceSpec).toBe('My API 3.0.1');
  });

  it('sets catalogEndpointId per endpoint when multiple endpoints', () => {
    const payload: CatalogExportPayload = {
      collectionName: 'multi',
      envs: [{ envId: 'env-1', envName: 'dev', baseUrl: 'https://dev.api.com' }],
      endpoints: [
        makeEndpoint({ id: 'ep-a', summary: 'A', path: '/a' }),
        makeEndpoint({ id: 'ep-b', summary: 'B', path: '/b' }),
      ],
      customNames: {},
      sampleEpIds: new Set(),
      savedEpValues: {},
    };
    const ctx: CatalogExportContext = {
      servers: [] as CatalogServer[],
      existingEnvNames: new Map(),
      catalogEntryId: 'entry-1',
      versionLabel: '1.0.0',
    };
    const { collection } = buildCatalogExport(payload, ctx);
    const reqs = collection.folders![0].requests;
    expect(reqs[0].catalogMeta!.catalogEndpointId).toBe('ep-a');
    expect(reqs[1].catalogMeta!.catalogEndpointId).toBe('ep-b');
    expect(reqs[0].catalogMeta!.catalogEntryId).toBe('entry-1');
    expect(reqs[1].catalogMeta!.catalogEntryId).toBe('entry-1');
  });
});
