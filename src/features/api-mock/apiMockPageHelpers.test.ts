/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApiMockServerDefinitionV1 } from '@shared/api-mock/contracts';
import { DEFAULT_SETTINGS, AUTO_PORT_RANGE } from '@shared/api-mock/defaults';
import {
  applyRouteDelete,
  applyRouteUpdate,
  buildUpdatedRoutesPatch,
  buildRuntimeMaps,
  computeHydrationResult,
  deriveSimulateDefaults,
  findSelectedRoute,
  formatConflictAnalysisMessage,
  formatImportedRoutesMessage,
  getConflictAnalysisTarget,
  isLiveRuntimeStatus,
  mergeConflictAcknowledgements,
  mergeRuntimeInfo,
  parsePortOwnerServerId,
  pickNextAutoPort,
  tryPickNextAutoPort,
  findPortOwner,
  formatPortTakenMessage,
  resolveNextAutoPort,
  reorderServers,
  duplicateServerDefinition,
  formatStopAndCloseMessage,
  formatTabLimitMessage,
  STOP_AND_CLOSE_CONFIRM_OPTIONS,
  TAB_LIMIT_CONFIRM_OPTIONS,
  downloadJsonFile,
  isApiMockLiveDemoActive,
  saveTextFileToDisk,
  resolveHydratedActiveServerId,
  restoreDeletedRoute,
  restoreDeletedRouteInList,
  runConflictAnalysis,
} from './apiMockPageHelpers';

const ts = '2026-08-12T00:00:00.000Z';

function makeServer(id: string, method: ApiMockServerDefinitionV1['routes'][0]['method'] = 'GET', path = '/users'): ApiMockServerDefinitionV1 {
  return {
    id,
    name: `Mock Server ${id}`,
    enabled: true,
    host: '127.0.0.1',
    port: 4600,
    basePath: '',
    folders: [],
    routes: [{
      id: `${id}-r1`,
      name: 'Route',
      enabled: true,
      method,
      path: { kind: 'exact', value: path },
      priority: 10,
      predicates: { id: 'pg', combinator: 'all', children: [] },
      responseMode: 'rules',
      responses: [],
      tags: [],
      createdAt: ts,
      updatedAt: ts,
    }],
    samples: [{
      id: 's1',
      name: 'GET /users',
      routeId: `${id}-r1`,
      request: {
        method: 'GET', path: '/users', rawPath: '/users', query: {}, headers: {}, cookies: {},
        body: null, bodyTruncated: false, receivedAt: ts,
      },
      expected: { outcome: 'matched', routeId: `${id}-r1`, status: 200 },
    }],
    variables: [],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: ts,
    updatedAt: ts,
  };
}

describe('apiMockPageHelpers', () => {
  it('resolves the hydrated active server id with and without an explicit value', () => {
    expect(resolveHydratedActiveServerId({ activeServerId: 'srv-2', servers: [makeServer('srv-1'), makeServer('srv-2')] })).toBe('srv-2');
    expect(resolveHydratedActiveServerId({ activeServerId: undefined, servers: [makeServer('srv-1'), makeServer('srv-2')] })).toBe('srv-1');
    expect(resolveHydratedActiveServerId({ activeServerId: undefined, servers: [] })).toBeUndefined();
    expect(resolveHydratedActiveServerId({ activeServerId: 'gone', servers: [makeServer('srv-1')] })).toBe('srv-1');
  });

  it('picks the lowest free auto-port so closed tabs free their ports for reuse', () => {
    expect(pickNextAutoPort([])).toBe(4600);
    expect(pickNextAutoPort([{ port: 4600 }])).toBe(4601);
    expect(pickNextAutoPort([{ port: 4600 }, { port: 4602 }])).toBe(4601);
    expect(pickNextAutoPort([{ port: 4600 }], AUTO_PORT_RANGE, [4601])).toBe(4602);
    expect(() => pickNextAutoPort(
      Array.from({ length: 3 }, (_, i) => ({ port: 10 + i })),
      { min: 10, max: 12 },
    )).toThrow(/No available port/);
    expect(tryPickNextAutoPort([{ port: 4600 }])).toBe(4601);
    expect(tryPickNextAutoPort(
      Array.from({ length: 3 }, (_, i) => ({ port: 10 + i })),
      { min: 10, max: 12 },
    )).toBeNull();
  });

  it('finds which saved mock already claims a listen port', () => {
    const users = { id: 'srv-users', name: 'Users API', port: 4600 };
    const payments = { id: 'srv-pay', name: 'Payments', port: 4602 };
    const parked = { id: 'srv-parked', name: 'Catalog', port: 4603 };
    expect(findPortOwner([users, payments], 4600, 'srv-pay')).toEqual(users);
    expect(findPortOwner([users, payments], 4602, 'srv-pay')).toBeUndefined();
    expect(findPortOwner([users, payments, parked], 4603, 'srv-pay')).toEqual(parked);
    expect(findPortOwner([users], 4600.5, 'srv-pay')).toBeUndefined();
    expect(formatPortTakenMessage(4600, 'Users API')).toBe('Port 4600 is already used by Users API. Pick another port.');
    expect(formatPortTakenMessage(4600, '  ')).toBe('Port 4600 is already used by another mock server. Pick another port.');
  });

  it('resolves the next auto-port with an OS availability probe', async () => {
    expect(await resolveNextAutoPort([{ port: 4600 }])).toBe(4601);
    expect(await resolveNextAutoPort(
      [{ port: 4600 }],
      { isAvailable: async port => port !== 4601 },
    )).toBe(4602);
    expect(await resolveNextAutoPort(
      [],
      { range: { min: 10, max: 12 }, isAvailable: async () => { throw new Error('probe down'); } },
    )).toBe(10);
    await expect(resolveNextAutoPort(
      [],
      { range: { min: 10, max: 11 }, excludePorts: [10], isAvailable: async () => false },
    )).rejects.toThrow(/No available port/);
  });

  it('duplicates a server without secrets and reorders tabs', () => {
    const src = makeServer('srv-1');
    src.settings = {
      ...src.settings,
      tls: {
        enabled: true,
        certPem: 'CERT',
        keyPem: 'SECRET-KEY',
        passphrase: 'pw',
        mtls: { enabled: true, clientCaPem: 'CA', clientKeyPem: 'CLIENT-KEY' },
      },
    };
    src.variables = [{ id: 'v1', key: 'token', value: 'secret', sensitive: true }];
    src.samples[0].request.headers = { Authorization: ['Bearer leaked'], Accept: ['application/json'] };
    src.samples[0].request.cookies = { sid: 'abc' };
    const copy = duplicateServerDefinition(src, 4601, ts);
    expect(copy.id).not.toBe(src.id);
    expect(copy.port).toBe(4601);
    expect(copy.name).toBe('Mock Server srv-1 copy');
    expect(copy.settings.tls?.keyPem).toBe('');
    expect(copy.settings.tls?.passphrase).toBeUndefined();
    expect(copy.settings.tls?.mtls?.clientKeyPem).toBeUndefined();
    expect(copy.variables[0].value).toBe('');
    expect(copy.samples[0].request.headers).toEqual({ Accept: ['application/json'] });
    expect(copy.samples[0].request.cookies).toEqual({});
    const noSamples = makeServer('srv-ns');
    (noSamples as { samples?: unknown }).samples = undefined;
    expect(duplicateServerDefinition(noSamples, 4603, ts).samples).toEqual([]);
    const noVars = makeServer('srv-nv');
    (noVars as { variables?: unknown }).variables = undefined;
    expect(duplicateServerDefinition(noVars, 4604, ts).variables).toEqual([]);
    expect(duplicateServerDefinition(copy, 4602, ts).name).toBe(copy.name);

    const items = ['a', 'b', 'c'];
    expect(reorderServers(items, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorderServers(items, 1, 1)).toBe(items);
    expect(formatTabLimitMessage(8)).toMatch(/at most 8/);
    expect(TAB_LIMIT_CONFIRM_OPTIONS.title).toBe('Tab limit');
    expect(TAB_LIMIT_CONFIRM_OPTIONS.confirmLabel).toBe('OK');

    const click = vi.fn();
    const originalCreateElement = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'a') {
        const anchor = originalCreateElement.call(document, 'a', options) as HTMLAnchorElement;
        anchor.click = click;
        return anchor;
      }
      return originalCreateElement.call(document, tagName, options);
    }) as typeof document.createElement);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:helpers');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(isApiMockLiveDemoActive()).toBe(false);
    downloadJsonFile('demo.har', { ok: true });
    expect(click).toHaveBeenCalled();
    createObjectURL.mockRestore();
    revoke.mockRestore();
    vi.restoreAllMocks();
  });

  it('skips JSON download while the live demo panel is open', () => {
    const panel = document.createElement('div');
    panel.className = 'demo-live-panel';
    document.body.append(panel);
    const click = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'a') {
        const anchor = originalCreateElement.call(document, 'a', options) as HTMLAnchorElement;
        anchor.click = click;
        return anchor;
      }
      return originalCreateElement.call(document, tagName, options);
    }) as typeof document.createElement);
    expect(isApiMockLiveDemoActive()).toBe(true);
    downloadJsonFile('demo.har', { ok: true });
    expect(click).not.toHaveBeenCalled();
    saveTextFileToDisk('forced.json', '{"ok":true}', 'application/json');
    expect(click).toHaveBeenCalled();
    panel.remove();
    vi.restoreAllMocks();
  });

  it('classifies live runtime statuses and parses port-owner ids', () => {
    expect(isLiveRuntimeStatus('running')).toBe(true);
    expect(isLiveRuntimeStatus('starting')).toBe(true);
    expect(isLiveRuntimeStatus('stopped')).toBe(false);
    expect(isLiveRuntimeStatus(undefined)).toBe(false);
    expect(parsePortOwnerServerId('Port 4601 is owned by server "srv-6187f22c"')).toBe('srv-6187f22c');
    expect(parsePortOwnerServerId('something else')).toBeUndefined();
  });

  it('computes hydration application only when not cancelled and servers exist', () => {
    expect(computeHydrationResult(true, { activeServerId: 'srv-1', servers: [makeServer('srv-1')] })).toEqual({ shouldApply: false });
    expect(computeHydrationResult(false, { activeServerId: undefined, servers: [] })).toEqual({ shouldApply: false });
    expect(computeHydrationResult(false, { activeServerId: undefined, servers: [makeServer('srv-1')] })).toEqual({
      shouldApply: true,
      servers: [makeServer('srv-1')],
      activeServerId: 'srv-1',
      openTabIds: ['srv-1'],
    });
    expect(computeHydrationResult(false, { activeServerId: 'gone', servers: [makeServer('srv-1')] })).toEqual({
      shouldApply: true,
      servers: [makeServer('srv-1')],
      activeServerId: 'srv-1',
      openTabIds: ['srv-1'],
    });
  });

  it('hydrates a parked server as library-only when it has no open tab', () => {
    const a = makeServer('srv-a');
    const b = makeServer('srv-b');
    expect(computeHydrationResult(false, { activeServerId: 'srv-a', servers: [a, b], openTabIds: ['srv-b'] })).toEqual({
      shouldApply: true,
      servers: [a, b],
      activeServerId: 'srv-b',
      openTabIds: ['srv-b'],
    });
    // Every tab closed: the library still hydrates, just with nothing selected.
    expect(computeHydrationResult(false, { activeServerId: 'srv-a', servers: [a, b], openTabIds: [] })).toEqual({
      shouldApply: true,
      servers: [a, b],
      activeServerId: undefined,
      openTabIds: [],
    });
  });

  it('formats singular and plural live messages', () => {
    expect(formatImportedRoutesMessage(1)).toBe('Imported 1 route as drafts.');
    expect(formatImportedRoutesMessage(2)).toBe('Imported 2 routes as drafts.');
    expect(formatConflictAnalysisMessage(0)).toBe('No route conflicts found.');
    expect(formatConflictAnalysisMessage(1)).toBe('1 potential conflict found.');
    expect(formatConflictAnalysisMessage(3)).toBe('3 potential conflicts found.');
  });

  it('derives simulate defaults for missing, GET, and ANY routes', () => {
    expect(deriveSimulateDefaults()).toEqual({ initialPath: '/', initialMethod: 'GET' });
    expect(deriveSimulateDefaults(makeServer('srv-1', 'GET', '/users').routes[0])).toEqual({ initialPath: '/users', initialMethod: 'GET' });
    expect(deriveSimulateDefaults(makeServer('srv-1', 'ANY', '').routes[0])).toEqual({ initialPath: '/', initialMethod: 'GET' });
    const parameterized = makeServer('srv-1', 'GET', '/users/:id');
    parameterized.routes[0].path = { kind: 'parameterized', value: '/users/:id' };
    expect(deriveSimulateDefaults(parameterized.routes[0])).toEqual({ initialPath: '/users/42', initialMethod: 'GET' });
    const braced = makeServer('srv-1', 'GET', '/orders/{orderId}');
    braced.routes[0].path = { kind: 'parameterized', value: '/orders/{orderId}' };
    expect(deriveSimulateDefaults(braced.routes[0])).toEqual({ initialPath: '/orders/42', initialMethod: 'GET' });
  });

  it('formats stop-and-close confirm copy for one or many tabs', () => {
    expect(formatStopAndCloseMessage([])).toBe('Stop and close "mock server"?');
    expect(formatStopAndCloseMessage(['Alpha'])).toBe('Stop and close "Alpha"?');
    expect(formatStopAndCloseMessage(['Alpha', 'Beta'])).toBe('Stop and close 2 mock servers? Running listeners will be stopped.');
  });

  it('keeps delete wording out of the stop-and-close confirm', () => {
    expect(STOP_AND_CLOSE_CONFIRM_OPTIONS.title).toBe('Stop and close');
    expect(STOP_AND_CLOSE_CONFIRM_OPTIONS.confirmLabel).toBe('Stop & Close');
    expect(STOP_AND_CLOSE_CONFIRM_OPTIONS.finalNote).not.toMatch(/cannot be undone/i);
  });

  it('builds runtime status and dirty maps', () => {
    const a = makeServer('a');
    const b = makeServer('b');
    const runtime = {
      a: { status: 'running', generation: 1, appliedJson: JSON.stringify(a) },
      b: { status: 'running', generation: 2, appliedJson: JSON.stringify({ ...b, name: 'old' }) },
    };
    const maps = buildRuntimeMaps([a, b], runtime);
    expect(maps.statusById).toEqual({ a: 'running', b: 'running' });
    expect(maps.dirtyById).toEqual({ a: false, b: true });
  });

  it('merges runtime info for new and existing entries', () => {
    expect(mergeRuntimeInfo({}, 'srv-1', { status: 'starting' })).toEqual({ 'srv-1': { status: 'starting', generation: 0 } });
    expect(mergeRuntimeInfo({ 'srv-1': { status: 'running', generation: 1, error: 'x' } }, 'srv-1', { generation: 2, error: undefined })).toEqual({
      'srv-1': { status: 'running', generation: 2, error: undefined },
    });
  });

  it('finds the selected route when present', () => {
    const server = makeServer('srv-1');
    expect(findSelectedRoute(undefined, 'srv-1-r1')).toBeUndefined();
    expect(findSelectedRoute(server, undefined)).toBeUndefined();
    expect(findSelectedRoute(server, 'srv-1-r1')?.id).toBe('srv-1-r1');
  });

  it('builds a route-update patch only when an active server exists', () => {
    const server = makeServer('srv-1');
    expect(buildUpdatedRoutesPatch(undefined, server, 'srv-1-r1', { name: 'Updated' })).toBeNull();
    expect(buildUpdatedRoutesPatch('srv-1', undefined, 'srv-1-r1', { name: 'Updated' })).toBeNull();
    const patch = buildUpdatedRoutesPatch('srv-1', server, 'srv-1-r1', { name: 'Updated' });
    expect(patch?.serverId).toBe('srv-1');
    expect(patch?.routes[0].name).toBe('Updated');
  });

  it('returns a conflict-analysis target only when there is an active server', () => {
    expect(getConflictAnalysisTarget(undefined)).toBeNull();
    const server = makeServer('srv-1');
    expect(getConflictAnalysisTarget(server)).toEqual({ serverId: 'srv-1', routes: server.routes });
  });

  it('applies route updates and no-ops when there is no active server', () => {
    const updateServer = vi.fn();
    const server = makeServer('srv-1');
    applyRouteUpdate(undefined, server, 'srv-1-r1', { name: 'Updated' }, updateServer);
    expect(updateServer).not.toHaveBeenCalled();

    applyRouteUpdate('srv-1', server, 'srv-1-r1', { name: 'Updated' }, updateServer);
    expect(updateServer).toHaveBeenCalledWith('srv-1', expect.objectContaining({ routes: [expect.objectContaining({ name: 'Updated' })] }));
  });

  it('applies route delete and clears selection only when deleting the selected route', () => {
    const updateServer = vi.fn();
    const setSelectedRouteId = vi.fn();
    const setLiveMessage = vi.fn();
    const server = makeServer('srv-1');
    server.samples.push({
      id: 's2',
      name: 'no-expected',
      routeId: 'srv-1-r1',
      request: server.samples[0].request,
    });

    applyRouteDelete('srv-1', server, 'other', 'srv-1-r1', updateServer, setSelectedRouteId, setLiveMessage);
    expect(updateServer).toHaveBeenCalledWith('srv-1', expect.objectContaining({
      routes: [],
      samples: [
        expect.objectContaining({
          id: 's1',
          routeId: undefined,
          expected: expect.objectContaining({ routeId: undefined, outcome: 'matched' }),
        }),
        expect.objectContaining({ id: 's2', routeId: undefined, expected: undefined }),
      ],
    }));
    expect(setSelectedRouteId).not.toHaveBeenCalled();
    expect(setLiveMessage).toHaveBeenCalledWith(expect.stringMatching(/deleted/i));

    applyRouteDelete('srv-1', server, 'srv-1-r1', 'srv-1-r1', updateServer, setSelectedRouteId, setLiveMessage);
    expect(setSelectedRouteId).toHaveBeenCalledWith(undefined);
  });

  it('restores a deleted route and re-attaches surviving samples', () => {
    const updateServer = vi.fn();
    const setSelectedRouteId = vi.fn();
    const setLiveMessage = vi.fn();
    const server = makeServer('srv-1');
    const extra = { ...makeServer('srv-1').routes[0], id: 'srv-1-r2', name: 'Keep' };
    server.routes.push(extra);

    const snapshot = applyRouteDelete('srv-1', server, 'srv-1-r1', 'srv-1-r1', updateServer, setSelectedRouteId, setLiveMessage);
    expect(snapshot?.attachedSampleIds).toEqual(['s1']);
    const afterDelete = {
      ...server,
      routes: [extra],
      samples: [{ ...server.samples[0], routeId: undefined, expected: { ...server.samples[0].expected, routeId: undefined } }],
    };
    expect(restoreDeletedRoute(afterDelete, snapshot!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(true);
    expect(updateServer).toHaveBeenLastCalledWith('srv-1', expect.objectContaining({
      routes: [expect.objectContaining({ id: 'srv-1-r1' }), extra],
      samples: [expect.objectContaining({ id: 's1', routeId: 'srv-1-r1' })],
    }));
    expect(setSelectedRouteId).toHaveBeenCalledWith('srv-1-r1');
    expect(restoreDeletedRoute({ ...afterDelete, samples: undefined, routes: [] }, snapshot!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(true);
    expect(restoreDeletedRoute(undefined, snapshot!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(false);
    expect(restoreDeletedRoute(afterDelete, null, updateServer, setSelectedRouteId, setLiveMessage)).toBe(false);
    expect(restoreDeletedRoute({ ...afterDelete, routes: [snapshot!.route] }, snapshot!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(false);

    const keepSelected = applyRouteDelete('srv-1', { ...server, routes: [extra, server.routes[0]] }, extra.id, server.routes[0].id, updateServer, setSelectedRouteId, setLiveMessage);
    expect(keepSelected?.priorSelectedRouteId).toBe(extra.id);
    expect(restoreDeletedRoute({ ...afterDelete, routes: [extra] }, keepSelected!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(true);
    expect(setSelectedRouteId).toHaveBeenLastCalledWith(extra.id);
    expect(restoreDeletedRouteInList(
      [{ ...afterDelete, id: 'other' }, afterDelete],
      snapshot!,
      updateServer,
      setSelectedRouteId,
      setLiveMessage,
    )).toBe(true);
    expect(restoreDeletedRouteInList([{ ...afterDelete, id: 'other' }], snapshot!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(false);
    expect(restoreDeletedRouteInList([], null, updateServer, setSelectedRouteId, setLiveMessage)).toBe(false);
    expect(applyRouteDelete(undefined, server, undefined, 'srv-1-r1', updateServer, setSelectedRouteId, setLiveMessage)).toBeUndefined();
    expect(applyRouteDelete('srv-1', server, undefined, 'missing', updateServer, setSelectedRouteId, setLiveMessage)).toBeUndefined();
    expect(applyRouteDelete('srv-other', server, undefined, 'srv-1-r1', updateServer, setSelectedRouteId, setLiveMessage)).toBeUndefined();
  });

  it('does not steal examples reassigned to another route during the undo window', () => {
    const updateServer = vi.fn();
    const setSelectedRouteId = vi.fn();
    const setLiveMessage = vi.fn();
    const server = makeServer('srv-1');
    const extra = { ...makeServer('srv-1').routes[0], id: 'srv-1-r2', name: 'Keep' };
    const snapshot = applyRouteDelete('srv-1', { ...server, routes: [...server.routes, extra] }, 'srv-1-r1', 'srv-1-r1', updateServer, setSelectedRouteId, setLiveMessage);
    const reassigned = {
      ...server,
      routes: [extra],
      samples: [{ ...server.samples[0], routeId: extra.id, expected: { ...server.samples[0].expected, routeId: extra.id } }],
    };
    expect(restoreDeletedRoute(reassigned, snapshot!, updateServer, setSelectedRouteId, setLiveMessage)).toBe(true);
    expect(updateServer).toHaveBeenLastCalledWith('srv-1', expect.objectContaining({
      samples: [expect.objectContaining({ id: 's1', routeId: extra.id })],
    }));
  });

  it('runs conflict analysis and no-ops without an active server', async () => {
    const analyze = vi.fn().mockResolvedValue({ findings: [{ ruleIds: ['a', 'b'] }] });
    const setConflictIds = vi.fn();
    const setLiveMessage = vi.fn();
    const setFindings = vi.fn();
    await runConflictAnalysis(undefined, analyze, setConflictIds, setLiveMessage, setFindings);
    expect(analyze).not.toHaveBeenCalled();

    const server = makeServer('srv-1');
    await runConflictAnalysis(server, analyze, setConflictIds, setLiveMessage, setFindings);
    expect(analyze).toHaveBeenCalledWith(server.routes, 'srv-1');
    expect(setConflictIds).toHaveBeenCalledWith(['a', 'b']);
    expect(setFindings).toHaveBeenCalledWith([{ ruleIds: ['a', 'b'] }]);
    expect(setLiveMessage).toHaveBeenCalledWith('1 potential conflict found.');
  });

  it('merges conflict acknowledgements when fingerprints are unchanged', () => {
    const previous = [{
      ruleIds: ['a', 'b'] as [string, string],
      ruleFingerprints: ['fp1', 'fp2'] as [string, string],
      acknowledgedAt: '2026-08-12T12:00:00.000Z',
    }];
    const next = [{
      ruleIds: ['a', 'b'] as [string, string],
      ruleFingerprints: ['fp1', 'fp2'] as [string, string],
    }, {
      ruleIds: ['c', 'd'] as [string, string],
      ruleFingerprints: ['fp3', 'fp4'] as [string, string],
    }];
    const merged = mergeConflictAcknowledgements(previous, next);
    expect(merged[0].acknowledgedAt).toBe('2026-08-12T12:00:00.000Z');
    expect(merged[0].acknowledgementStale).toBe(false);
    expect(merged[1].acknowledgedAt).toBeUndefined();
  });

  it('marks acknowledgements stale when fingerprints change', () => {
    const previous = [{
      ruleIds: ['a', 'b'] as [string, string],
      ruleFingerprints: ['fp1', 'fp2'] as [string, string],
      acknowledgedAt: '2026-08-12T12:00:00.000Z',
    }];
    const next = [{
      ruleIds: ['a', 'b'] as [string, string],
      ruleFingerprints: ['fp1-changed', 'fp2'] as [string, string],
    }];
    const merged = mergeConflictAcknowledgements(previous, next);
    expect(merged[0].acknowledgedAt).toBeUndefined();
    expect(merged[0].acknowledgementStale).toBe(true);
  });
});
