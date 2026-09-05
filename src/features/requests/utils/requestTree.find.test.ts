import { describe, it, expect } from 'vitest';
import type { RequestFolder, RequestItem, RequestCollection } from '@shared/types';
import {
  findFolderDeep,
  findReqInFolders,
  findRequestInCollection,
  findAncestorSubCollection,
  collectAllRequests,
  collectAllRequestsFromCollection,
  cloneRequest,
  cloneFolder,
  extractFolderDeep,
  isDescendantOf,
  findReqParentFolder,
  findSiblingFolders,
} from './requestTree';

function makeReq(id: string, name = ''): RequestItem {
  return {
    id, name: name || id, method: 'GET', url: '/test', headers: [], body: '',
    auth: { type: 'none' },
  };
}

function makeFolder(id: string, requests: RequestItem[] = [], subfolders: RequestFolder[] = []): RequestFolder {
  return { id, name: id, requests, folders: subfolders };
}

function makeCollection(overrides: Partial<RequestCollection> = {}): RequestCollection {
  return {
    id: 'col-1', name: 'Test Collection', mode: 'direct',
    requests: [], folders: [], ...overrides,
  };
}

// ─── findFolderDeep ──────────────────────────────────────

describe('findFolderDeep', () => {
  it('returns null for empty folders', () => {
    expect(findFolderDeep([], 'any')).toBeNull();
  });

  it('finds a top-level folder', () => {
    const f = makeFolder('f1');
    expect(findFolderDeep([f], 'f1')).toBe(f);
  });

  it('finds a deeply nested folder', () => {
    const deep = makeFolder('deep');
    const mid = makeFolder('mid', [], [deep]);
    const top = makeFolder('top', [], [mid]);
    expect(findFolderDeep([top], 'deep')).toBe(deep);
  });

  it('returns null when folder not found', () => {
    const f = makeFolder('f1');
    expect(findFolderDeep([f], 'nonexistent')).toBeNull();
  });
});

// ─── findReqInFolders ────────────────────────────────────

describe('findReqInFolders', () => {
  it('returns null for empty folders', () => {
    expect(findReqInFolders([], 'any')).toBeNull();
  });

  it('finds a request in a folder', () => {
    const req = makeReq('r1');
    const f = makeFolder('f1', [req]);
    expect(findReqInFolders([f], 'r1')).toBe(req);
  });

  it('finds a request in nested folders', () => {
    const req = makeReq('r1');
    const inner = makeFolder('inner', [req]);
    const outer = makeFolder('outer', [], [inner]);
    expect(findReqInFolders([outer], 'r1')).toBe(req);
  });

  it('returns null when request not found', () => {
    const f = makeFolder('f1', [makeReq('r1')]);
    expect(findReqInFolders([f], 'r99')).toBeNull();
  });
});

// ─── findRequestInCollection ─────────────────────────────

describe('findRequestInCollection', () => {
  it('finds a request at collection root', () => {
    const req = makeReq('r1');
    const col = makeCollection({ requests: [req] });
    expect(findRequestInCollection(col, 'r1')).toBe(req);
  });

  it('finds a request inside a folder', () => {
    const req = makeReq('r1');
    const col = makeCollection({ folders: [makeFolder('f1', [req])] });
    expect(findRequestInCollection(col, 'r1')).toBe(req);
  });

  it('returns null when not found', () => {
    const col = makeCollection();
    expect(findRequestInCollection(col, 'missing')).toBeNull();
  });
});

// ─── findAncestorSubCollection ───────────────────────────

describe('findAncestorSubCollection', () => {
  it('returns the subcollection folder that contains the request', () => {
    const sub = {
      id: 'sub',
      name: 'S',
      isSubCollection: true,
      baseUrls: {},
      requests: [makeReq('r1')],
    };
    const top = makeFolder('top', [], [sub]);
    expect(findAncestorSubCollection([top], 'r1')).toEqual(sub);
  });

  it('returns null when no folder is marked as sub-collection', () => {
    const f = makeFolder('f', [makeReq('r1')]);
    expect(findAncestorSubCollection([f], 'r1')).toBeNull();
  });

  it('finds a folder with baseUrls even when isSubCollection is unset', () => {
    const sub = {
      id: 'sub',
      name: 'profiles',
      requests: [makeReq('r1')],
      baseUrls: { e1: 'https://ons.example.com/' },
    };
    const top = makeFolder('top', [], [sub]);
    expect(findAncestorSubCollection([top], 'r1')).toEqual(sub);
  });

  it('returns null when the request id is not in any folder', () => {
    const nested = makeFolder('nested', [], [makeFolder('inner', [makeReq('r1')])]);
    expect(findAncestorSubCollection([makeFolder('other'), nested], 'missing')).toBeNull();
  });
});

// ─── collectAllRequestsFromCollection ────────────────────

describe('collectAllRequestsFromCollection', () => {
  it('collects root requests and nested folder requests', () => {
    const inner = makeFolder('inner', [makeReq('r2')]);
    const outer = makeFolder('outer', [makeReq('r1')], [inner]);
    const col: RequestCollection = {
      id: 'c1',
      name: 'Collection',
      requests: [makeReq('root')],
      folders: [outer],
    };
    expect(collectAllRequestsFromCollection(col).map((r) => r.id)).toEqual(['root', 'r1', 'r2']);
  });

  it('returns only root requests when there are no folders', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'Collection',
      requests: [makeReq('a'), makeReq('b')],
    };
    expect(collectAllRequestsFromCollection(col)).toHaveLength(2);
  });

  it('handles collections with empty folder lists', () => {
    const col: RequestCollection = {
      id: 'c1',
      name: 'Collection',
      requests: [],
      folders: [],
    };
    expect(collectAllRequestsFromCollection(col)).toEqual([]);
  });
});

// ─── collectAllRequests ──────────────────────────────────

describe('collectAllRequests', () => {
  it('collects from nested structure', () => {
    const inner = makeFolder('inner', [makeReq('r2')]);
    const outer = makeFolder('outer', [makeReq('r1')], [inner]);
    expect(collectAllRequests(outer)).toHaveLength(2);
  });

  it('returns empty for empty folder', () => {
    expect(collectAllRequests(makeFolder('empty'))).toHaveLength(0);
  });
});

// ─── cloneRequest / cloneFolder ──────────────────────────

describe('cloning', () => {
  it('cloneRequest produces a new id', () => {
    const req = makeReq('r1', 'test');
    const cloned = cloneRequest(req);
    expect(cloned.id).not.toBe('r1');
    expect(cloned.name).toBe('test');
  });

  it('cloneFolder produces new ids for all nested items', () => {
    const req = makeReq('r1');
    const inner = makeFolder('inner', [req]);
    const outer = makeFolder('outer', [], [inner]);
    const cloned = cloneFolder(outer);
    expect(cloned.id).not.toBe('outer');
    expect(cloned.folders![0].id).not.toBe('inner');
    expect(cloned.folders![0].requests[0].id).not.toBe('r1');
  });
});

// ─── extractFolderDeep ───────────────────────────────────

describe('extractFolderDeep', () => {
  it('extracts a top-level folder', () => {
    const f1 = makeFolder('f1');
    const f2 = makeFolder('f2');
    const { remaining, extracted } = extractFolderDeep([f1, f2], 'f1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('f2');
    expect(extracted?.id).toBe('f1');
  });

  it('extracts a nested folder', () => {
    const inner = makeFolder('inner');
    const outer = makeFolder('outer', [], [inner]);
    const { remaining, extracted } = extractFolderDeep([outer], 'inner');
    expect(remaining[0].folders).toHaveLength(0);
    expect(extracted?.id).toBe('inner');
  });

  it('returns null when not found', () => {
    const { extracted } = extractFolderDeep([makeFolder('f1')], 'missing');
    expect(extracted).toBeNull();
  });
});

// ─── isDescendantOf ──────────────────────────────────────

describe('isDescendantOf', () => {
  it('returns true for a direct child', () => {
    const child = makeFolder('child');
    const parent = makeFolder('parent', [], [child]);
    expect(isDescendantOf([parent], 'parent', 'child')).toBe(true);
  });

  it('returns true for a deeply nested descendant', () => {
    const deep = makeFolder('deep');
    const mid = makeFolder('mid', [], [deep]);
    const top = makeFolder('top', [], [mid]);
    expect(isDescendantOf([top], 'top', 'deep')).toBe(true);
  });

  it('returns false for unrelated folders', () => {
    const f1 = makeFolder('f1');
    const f2 = makeFolder('f2');
    expect(isDescendantOf([f1, f2], 'f1', 'f2')).toBe(false);
  });

  it('returns false when ancestor not found', () => {
    expect(isDescendantOf([], 'missing', 'any')).toBe(false);
  });
});

// ─── findReqParentFolder ─────────────────────────────────

describe('findReqParentFolder', () => {
  it('finds the direct parent folder', () => {
    const req = makeReq('r1');
    const f = makeFolder('f1', [req]);
    expect(findReqParentFolder([f], 'r1')?.id).toBe('f1');
  });

  it('finds a nested parent folder', () => {
    const req = makeReq('r1');
    const inner = makeFolder('inner', [req]);
    const outer = makeFolder('outer', [], [inner]);
    expect(findReqParentFolder([outer], 'r1')?.id).toBe('inner');
  });

  it('skips earlier root folders when the request lives in a later sibling', () => {
    const req = makeReq('r-target');
    const first = makeFolder('first', [], [makeFolder('deep', [makeReq('other')])]);
    const second = makeFolder('second', [req]);
    expect(findReqParentFolder([first, second], 'r-target')?.id).toBe('second');
  });

  it('returns null when not found', () => {
    expect(findReqParentFolder([makeFolder('f1')], 'missing')).toBeNull();
  });
});

// ─── findSiblingFolders ─────────────────────────────────

describe('findSiblingFolders', () => {
  it('returns top-level siblings', () => {
    const f1 = makeFolder('f1');
    const f2 = makeFolder('f2');
    expect(findSiblingFolders([f1, f2], 'f1')).toEqual([f1, f2]);
  });

  it('returns nested siblings', () => {
    const inner1 = makeFolder('inner1');
    const inner2 = makeFolder('inner2');
    const outer = makeFolder('outer', [], [inner1, inner2]);
    expect(findSiblingFolders([outer], 'inner1')).toEqual([inner1, inner2]);
  });

  it('returns null when not found', () => {
    const f = makeFolder('f1');
    expect(findSiblingFolders([f], 'nonexistent')).toBeNull();
  });
});
