/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { RequestCollection } from '@shared/types';
import {
  addCollectionRequestsToSelection,
  authLabel,
  getDuplicateRequestSiblings,
  getNewFolderSiblings,
  getNewRequestSiblings,
  getSelectedRequestCollection,
  getSelectedRequestFolderIds,
  getSubColAddBlockReasonForCollection,
  getSubColAddDisabledTitleForCollection,
  getSubColEligibleEnvsForCollection,
  hasAuth,
  mergeExpandedIds,
  modeBadge,
  modeIcon,
  removeCollectionRequestsFromSelection,
  resolveSubCollectionEnv,
  scrollSelectedRequestIntoView,
  startDuplicateRequestState,
} from './RequestsSidebarLogic';

const makeCollection = (overrides: Partial<RequestCollection> = {}): RequestCollection => ({
  id: 'c1',
  name: 'C1',
  mode: 'direct',
  requests: [],
  folders: [],
  ...overrides,
}) as RequestCollection;

describe('RequestsSidebarLogic', () => {
  it('covers auth and mode helpers', () => {
    expect(hasAuth(makeCollection({ auth: undefined as never }))).toBe(false);
    expect(hasAuth(makeCollection({ auth: { type: 'bearer' } as never }))).toBe(true);
    expect(authLabel(makeCollection({ auth: undefined as never }))).toBe('');
    expect(authLabel(makeCollection({ auth: { type: 'apikey' } as never }))).toBe('API Key');
    expect(authLabel(makeCollection({ auth: { type: 'custom' } as never }))).toBe('');
    expect(modeIcon('group')).toContain('\uD83D');
    expect(modeIcon('multi-env')).toContain('\uD83C');
    expect(modeBadge('group')).toBe('GRP');
    expect(modeBadge('multi-env')).toBe('ENV');
    expect(modeBadge('direct')).toBe('URL');
  });

  it('covers inherit and none auth branches', () => {
    expect(hasAuth(makeCollection({ auth: { type: 'none' } as never }))).toBe(false);
    expect(hasAuth(makeCollection({ auth: { type: 'inherit' } as never }))).toBe(false);
    expect(authLabel(makeCollection({ auth: { type: 'basic' } as never }))).toBe('Basic');
    expect(authLabel(makeCollection({ auth: { type: 'oauth2' } as never }))).toBe('OAuth2');
  });

  it('merges expanded ids and returns original set when unchanged', () => {
    const prev = new Set(['a']);
    expect(mergeExpandedIds(prev, ['a'])).toBe(prev);
    const next = mergeExpandedIds(prev, ['b']);
    expect(next).not.toBe(prev);
    expect([...next]).toEqual(['a', 'b']);
  });

  it('finds selected collection and folder ancestors', () => {
    const col = makeCollection({
      requests: [],
      folders: [{ id: 'f1', name: 'F1', requests: [{ id: 'r1', name: 'R1', method: 'GET', url: '', headers: [] }], folders: [] }] as never,
    });
    expect(getSelectedRequestCollection([col], 'c1')).toBe(col);
    expect(getSelectedRequestCollection([col], 'missing')).toBeUndefined();
    expect(getSelectedRequestFolderIds(col, 'r1')).toEqual(['f1']);
    expect(getSelectedRequestFolderIds(undefined, 'r1')).toEqual([]);
    expect(getSelectedRequestFolderIds(col, undefined)).toEqual([]);
  });

  it('scrolls selected request only when element exists', () => {
    const scrollIntoView = vi.fn();
    const el = document.createElement('div');
    el.setAttribute('data-req-id', 'r1');
    (el as HTMLElement).scrollIntoView = scrollIntoView;
    document.body.appendChild(el);
    scrollSelectedRequestIntoView('r1');
    expect(scrollIntoView).toHaveBeenCalled();
    scrollSelectedRequestIntoView('missing');
    scrollSelectedRequestIntoView(undefined);
  });

  it('resolves envs and siblings for folder/request operations', () => {
    const col = makeCollection({
      baseUrls: { e1: 'https://x' } as never,
      folders: [{ id: 'f1', name: 'F1', requests: [{ id: 'r1', name: 'R1', method: 'GET', url: '', headers: [] }], folders: undefined as never }] as never,
    });
    expect(getSubColEligibleEnvsForCollection([col], [{ id: 'e1', name: 'dev' } as never], [], 'missing')).toEqual([]);
    expect(getSubColEligibleEnvsForCollection([col], [{ id: 'e1', name: 'dev' } as never], [], 'c1').length).toBeGreaterThanOrEqual(0);
    expect(getSubColAddBlockReasonForCollection([col], [{ id: 'e1', name: 'dev' } as never], [], 'missing')).toBe('no-base-urls');
    expect(getSubColAddDisabledTitleForCollection(
      [makeCollection({ id: 'c1', mode: 'multi-env', baseUrls: { e1: 'https://x' } as never })],
      [{ id: 'e1', name: 'dev' } as never],
      [],
      'c1',
    )).toBeUndefined();
    expect(getSubColAddBlockReasonForCollection(
      [makeCollection({
        id: 'c1',
        mode: 'multi-env',
        baseUrls: { e1: 'https://x' } as never,
        folders: [{ id: 'f-dev', name: 'dev', isSubCollection: true, selectedEnvId: 'e1', requests: [], folders: [] }] as never,
      })],
      [{ id: 'e1', name: 'dev' } as never],
      [],
      'c1',
    )).toBe('all-used');
    expect(getSubColAddDisabledTitleForCollection(
      [makeCollection({ id: 'c1', mode: 'multi-env' })],
      [{ id: 'e1', name: 'dev' } as never],
      [],
      'c1',
    )).toBe('Configure a base URL for an environment first');
    expect(getNewFolderSiblings([col], { colId: 'missing', parentFolderId: 'f1' })).toEqual([]);
    expect(getNewFolderSiblings([col], null)).toEqual([]);
    expect(getNewFolderSiblings([col], { colId: 'c1' })).toEqual(col.folders);
    expect(getNewRequestSiblings([col], { colId: 'missing', folderId: 'f1' })).toBeNull();
    expect(getNewRequestSiblings([col], null)).toBeNull();
    expect(getNewRequestSiblings([col], { colId: 'c1' })?.length).toBe(0);
    expect(getNewRequestSiblings([col], { colId: 'c1', folderId: 'f1' })?.length).toBe(1);
    expect(getDuplicateRequestSiblings([col], { colId: 'c1', reqId: 'r1' })?.length).toBe(1);
    expect(getDuplicateRequestSiblings([col], null)).toBeNull();
    expect(getDuplicateRequestSiblings([col], { colId: 'missing', reqId: 'r1' })).toBeNull();
    expect(resolveSubCollectionEnv(null, 'e1', [{ id: 'e1', name: 'dev' } as never])).toBeNull();
    expect(resolveSubCollectionEnv({ colId: 'c1' }, '', [{ id: 'e1', name: 'dev' } as never])).toBeNull();
    expect(resolveSubCollectionEnv({ colId: 'c1' }, 'missing', [{ id: 'e1', name: 'dev' } as never])).toBeNull();
  });

  it('builds duplicate request state with fallback name', () => {
    const col = makeCollection({ requests: [{ id: 'r1', name: '', method: 'GET', url: '', headers: [] }] as never });
    expect(startDuplicateRequestState([col], 'c1', 'r1')?.name).toBe('Request (copy)');
    expect(startDuplicateRequestState([col], 'missing', 'r1')).toBeNull();
    expect(startDuplicateRequestState([col], 'c1', 'missing')).toBeNull();
  });

  it('adds and removes collection requests including untitled and undefined nested folders', () => {
    const col = makeCollection({
      requests: [{ id: 'root', name: '', url: '', method: 'GET', headers: [] }] as never,
      folders: [{ id: 'f1', name: 'F1', requests: [{ id: 'child', name: 'Child', url: '', method: 'POST', headers: [] }], folders: undefined as never }] as never,
    });
    const added = addCollectionRequestsToSelection(new Map(), col);
    expect(added.get('root')?.name).toBe('Untitled');
    expect(added.get('child')?.method).toBe('POST');
    const removed = removeCollectionRequestsFromSelection(added, col);
    expect(removed.size).toBe(0);
  });

  it('covers selection add/remove helpers with deeply nested folders', () => {
    const col = makeCollection({
      requests: [{ id: 'root', name: 'Root', url: '', method: 'GET', headers: [] }] as never,
      folders: [{
        id: 'f1',
        name: 'F1',
        requests: [],
        folders: [{ id: 'f2', name: 'F2', requests: [{ id: 'deep', name: '', url: '/deep', method: 'PUT', headers: [] }], folders: [] }],
      }] as never,
    });
    const added = addCollectionRequestsToSelection(new Map(), col);
    expect(added.get('deep')?.name).toBe('/deep');
    expect(added.get('deep')?.method).toBe('PUT');
    const removed = removeCollectionRequestsFromSelection(added, col);
    expect(removed.size).toBe(0);
  });
});