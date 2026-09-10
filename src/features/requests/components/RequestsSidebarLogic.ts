import type { Environment, Microservice, RequestCollection, RequestFolder, RequestItem } from '@shared/types';
import {
  computeEligibleSubColEnvs,
  getSubColAddBlockReason,
  subColAddDisabledTitle,
  type SubColAddBlockReason,
  type SubColEnvOption,
} from '../utils/subCollectionEnvs';
import { findFolderDeep, findReqFolderAncestors, findRequestInCollection, findReqParentFolder } from '../utils/requestTree';

export function hasAuth(col: RequestCollection): boolean {
  return !!col.auth && col.auth.type !== 'none' && col.auth.type !== 'inherit';
}

export function authLabel(col: RequestCollection): string {
  if (!col.auth) return '';
  switch (col.auth.type) {
    case 'bearer': return 'Bearer';
    case 'basic': return 'Basic';
    case 'apikey': return 'API Key';
    case 'oauth2': return 'OAuth2';
    default: return '';
  }
}

export function modeIcon(mode: RequestCollection['mode']): string {
  if (mode === 'group') return '\uD83D\uDDC2\uFE0F';
  if (mode === 'multi-env') return '\uD83C\uDF10';
  return '\uD83D\uDCE1';
}

export function modeBadge(mode: RequestCollection['mode']): string {
  if (mode === 'group') return 'GRP';
  if (mode === 'multi-env') return 'ENV';
  return 'URL';
}

export function mergeExpandedIds(prev: Set<string>, ids: string[]): Set<string> {
  const next = new Set(prev);
  for (const id of ids) next.add(id);
  if (next.size === prev.size && [...next].every(id => prev.has(id))) return prev;
  return next;
}

export function getSelectedRequestCollection(collections: RequestCollection[], selectedCollectionId?: string): RequestCollection | undefined {
  if (!selectedCollectionId) return undefined;
  return collections.find(c => c.id === selectedCollectionId);
}

export function getSelectedRequestFolderIds(col: RequestCollection | undefined, selectedRequestId?: string): string[] {
  if (!col || !selectedRequestId) return [];
  return findReqFolderAncestors(col.folders ?? [], selectedRequestId);
}

export function scrollSelectedRequestIntoView(selectedRequestId?: string): void {
  if (!selectedRequestId) return;
  const el = document.querySelector<HTMLElement>(`[data-req-id="${selectedRequestId}"]`);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function getSubColEligibleEnvsForCollection(
  collections: RequestCollection[],
  environments: Environment[],
  microservices: Microservice[],
  colId: string,
  _parentFolderId?: string,
): SubColEnvOption[] {
  const col = collections.find(c => c.id === colId);
  if (!col) return [];
  return computeEligibleSubColEnvs(col, environments, microservices);
}

export function getSubColAddBlockReasonForCollection(
  collections: RequestCollection[],
  environments: Environment[],
  microservices: Microservice[],
  colId: string,
): SubColAddBlockReason | null {
  const col = collections.find(c => c.id === colId);
  if (!col) return 'no-base-urls';
  return getSubColAddBlockReason(col, environments, microservices);
}

export function getSubColAddDisabledTitleForCollection(
  collections: RequestCollection[],
  environments: Environment[],
  microservices: Microservice[],
  colId: string,
): string | undefined {
  return subColAddDisabledTitle(
    getSubColAddBlockReasonForCollection(collections, environments, microservices, colId),
  );
}

export function resolveSubCollectionEnv(target: { colId: string; parentFolderId?: string } | null, envId: string, environments: Environment[]) {
  if (!target || !envId) return null;
  const env = environments.find(e => e.id === envId);
  if (!env) return null;
  return { target, env };
}

export function getNewFolderSiblings(collections: RequestCollection[], target: { colId: string; parentFolderId?: string } | null): RequestFolder[] {
  if (!target) return [];
  const col = collections.find(c => c.id === target.colId);
  return target.parentFolderId
    ? findFolderDeep(col?.folders ?? [], target.parentFolderId)?.folders ?? []
    : col?.folders ?? [];
}

export function getNewRequestSiblings(collections: RequestCollection[], target: { colId: string; folderId?: string } | null): RequestItem[] | null {
  if (!target) return null;
  const col = collections.find(c => c.id === target.colId);
  if (!col) return null;
  return target.folderId
    ? (findFolderDeep(col.folders ?? [], target.folderId)?.requests ?? [])
    : col.requests;
}

export function getDuplicateRequestSiblings(collections: RequestCollection[], target: { colId: string; reqId: string } | null): RequestItem[] | null {
  if (!target) return null;
  const col = collections.find(c => c.id === target.colId);
  if (!col) return null;
  const parentFolder = findReqParentFolder(col.folders ?? [], target.reqId);
  return parentFolder ? parentFolder.requests : col.requests;
}

export function startDuplicateRequestState(collections: RequestCollection[], colId: string, reqId: string) {
  const col = collections.find(c => c.id === colId);
  if (!col) return null;
  const orig = findRequestInCollection(col, reqId);
  if (!orig) return null;
  return {
    target: { colId, reqId },
    name: `${orig.name || 'Request'} (copy)`,
  };
}

export function addCollectionRequestsToSelection(
  prev: Map<string, { colId: string; name: string; method: string }>,
  col: RequestCollection,
) {
  const next = new Map(prev);
  const addReqs = (reqs: { id: string; name: string; url: string; method: string }[], cId: string) => {
    for (const r of reqs) next.set(r.id, { colId: cId, name: r.name || r.url || 'Untitled', method: r.method });
  };
  const walkFolders = (folders: RequestFolder[]) => {
    for (const f of folders) {
      addReqs(f.requests, col.id);
      walkFolders(f.folders ?? []);
    }
  };
  addReqs(col.requests, col.id);
  walkFolders(col.folders ?? []);
  return next;
}

export function removeCollectionRequestsFromSelection(
  prev: Map<string, { colId: string; name: string; method: string }>,
  col: RequestCollection,
) {
  const next = new Map(prev);
  const removeReqs = (reqs: { id: string }[]) => {
    for (const r of reqs) next.delete(r.id);
  };
  const walkFolders = (folders: RequestFolder[]) => {
    for (const f of folders) {
      removeReqs(f.requests);
      walkFolders(f.folders ?? []);
    }
  };
  removeReqs(col.requests);
  walkFolders(col.folders ?? []);
  return next;
}