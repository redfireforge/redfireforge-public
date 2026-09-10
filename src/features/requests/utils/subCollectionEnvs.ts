import type { RequestCollection, RequestFolder, Microservice } from '@shared/types';

export interface NamedEnv {
  id: string;
  name: string;
}

export interface SubColEnvOption {
  id: string;
  name: string;
}

/**
 * Resolve the per-environment base URLs configured for a multi-env collection, keyed by
 * **Settings environment ID**.
 *
 * - **Linked microservice** → the microservice's per-env base URLs (mapped by env name to the
 *   Settings env, mirroring `RequestEditor.resolvedColBaseUrls`).
 * - **None (manual)** → the collection's own `baseUrls`.
 * - **Non-multi-env collections** → empty (no per-env hostnames).
 */
export function resolveCollectionBaseUrls(
  collection: RequestCollection,
  environments: NamedEnv[],
  microservices: Microservice[] | undefined,
): Record<string, string> {
  if (collection.mode !== 'multi-env') return {};

  if (collection.microserviceId) {
    const svc = microservices?.find(s => s.id === collection.microserviceId);
    if (!svc) return {};
    const knownEnvs = [...environments, ...(svc.customEnvs ?? [])];
    const mapped: Record<string, string> = {};
    for (const [svcEnvId, url] of Object.entries(svc.baseUrls)) {
      if (!url) continue;
      const svcEnv = knownEnvs.find(e => e.id === svcEnvId);
      if (!svcEnv) continue;
      const env = environments.find(e => e.name === svcEnv.name);
      if (env) mapped[env.id] = url;
    }
    return mapped;
  }

  return collection.baseUrls ?? {};
}

/** Toast / menu copy when no collection env has a base URL yet. */
export const SUB_COL_NO_BASE_URLS_TOAST = 'Configure a base URL for at least one environment in this collection before adding a sub-collection.';
export const SUB_COL_NO_BASE_URLS_TITLE = 'Configure a base URL for an environment first';
/** Toast / menu copy when every configured env already has a sub-collection. */
export const SUB_COL_ALL_USED_TOAST = 'Every environment already has a sub-collection. Remove or rebind one before adding another.';
export const SUB_COL_ALL_USED_TITLE = 'Every environment already has a sub-collection';

export type SubColAddBlockReason = 'no-base-urls' | 'all-used';

/**
 * Map a sub-collection to a Settings environment ID.
 * Prefers `selectedEnvId` (id or name), then the folder name — so a stale or
 * microservice-scoped id still excludes the env the user already bound.
 */
export function resolveSubColBoundEnvId(
  folder: RequestFolder,
  environments: NamedEnv[],
): string | undefined {
  if (folder.selectedEnvId) {
    const raw = folder.selectedEnvId;
    const byId = environments.find(e => e.id === raw);
    if (byId) return byId.id;
    const byStoredName = environments.find(e => e.name.toLowerCase() === raw.toLowerCase());
    if (byStoredName) return byStoredName.id;
  }
  return environments.find(e => e.name.toLowerCase() === folder.name.toLowerCase())?.id;
}

/**
 * Environment IDs already bound to a sibling sub-collection at a given tree level. Used to enforce
 * **one sub-collection per environment**. Falls back to a name match for legacy sub-collections
 * that predate explicit `selectedEnvId`.
 */
export function usedSubColEnvIds(
  siblings: RequestFolder[],
  environments: NamedEnv[],
  excludeFolderId?: string,
): Set<string> {
  const used = new Set<string>();
  for (const f of siblings) {
    if (!f.isSubCollection) continue;
    if (excludeFolderId && f.id === excludeFolderId) continue;
    const envId = resolveSubColBoundEnvId(f, environments);
    if (envId) used.add(envId);
  }
  return used;
}

/** Flatten every sub-collection folder in a collection (any depth). */
export function collectSubCollections(folders: RequestFolder[]): RequestFolder[] {
  const out: RequestFolder[] = [];
  for (const f of folders) {
    if (f.isSubCollection) out.push(f);
    if (f.folders?.length) out.push(...collectSubCollections(f.folders));
  }
  return out;
}

/**
 * Env IDs bound to any sub-collection in the whole collection (used by the edit modal to enforce
 * one-per-env), optionally excluding the folder currently being edited.
 */
export function usedEnvIdsInCollection(
  collection: RequestCollection,
  environments: NamedEnv[],
  excludeFolderId?: string,
): Set<string> {
  return usedSubColEnvIds(collectSubCollections(collection.folders ?? []), environments, excludeFolderId);
}

/**
 * Compute the environments eligible for a **new** sub-collection under `collection`:
 *
 * - Eligible = Settings envs that have a configured base URL for the collection
 *   (`resolveCollectionBaseUrls`).
 * - Minus envs already used by any sub-collection in the collection (one-per-env).
 *
 * Order follows `environments`.
 */
export function computeEligibleSubColEnvs(
  collection: RequestCollection,
  environments: NamedEnv[],
  microservices: Microservice[] | undefined,
): SubColEnvOption[] {
  if (collection.mode !== 'multi-env') return [];
  const resolved = resolveCollectionBaseUrls(collection, environments, microservices);
  const used = usedEnvIdsInCollection(collection, environments);
  return environments
    .filter(e => resolved[e.id] && !used.has(e.id))
    .map(e => ({ id: e.id, name: e.name }));
}

/** Why Add Sub-Collection is blocked, or `null` when at least one env is eligible. */
export function getSubColAddBlockReason(
  collection: RequestCollection,
  environments: NamedEnv[],
  microservices: Microservice[] | undefined,
): SubColAddBlockReason | null {
  if (collection.mode !== 'multi-env') return 'no-base-urls';
  const resolved = resolveCollectionBaseUrls(collection, environments, microservices);
  if (Object.keys(resolved).length === 0) return 'no-base-urls';
  if (computeEligibleSubColEnvs(collection, environments, microservices).length === 0) return 'all-used';
  return null;
}

export function subColAddDisabledTitle(reason: SubColAddBlockReason | null): string | undefined {
  if (reason === 'all-used') return SUB_COL_ALL_USED_TITLE;
  if (reason === 'no-base-urls') return SUB_COL_NO_BASE_URLS_TITLE;
  return undefined;
}
