import { v4 as uuidv4 } from 'uuid';
import type {
  AuthConfig,
  Environment,
  GlobalAuthProfile,
  Microservice,
  RequestCollection,
  RequestFolder,
  RequestItem,
  Scenario,
  ValidationConfig,
} from '@shared/types';
import {
  collectKnownHostBases,
  resolveBaseUrl,
  stripKnownBaseToRelative,
  type UrlResolverContext,
} from './requestUrlResolver';
import { findAncestorSubCollection, findReqParentFolder } from './requestTree';
import { resolveCollectionBaseUrls, resolveSubColBoundEnvId } from './subCollectionEnvs';

export interface PromotionContext {
  collection: RequestCollection;
  folderId?: string;
  selectedEnvId?: string;
  globalAuthProfiles: GlobalAuthProfile[];
  microservices: Microservice[];
  appEnvironments?: Environment[];
}

export interface PromotionOptions {
  validationPreset?: 'none' | 'status-200';
  authMode?: 'concrete' | 'inherit';
  openEditorAfter?: boolean;
}

/**
 * Resolve auth from the Requests inheritance chain:
 *   Request → Parent Folder → Per-Env → Collection → Microservice Global Profile → none
 *
 * Extracted from RequestEditor.resolveEffectiveAuth as a pure function.
 */
export function resolveRequestAuth(
  request: Pick<RequestItem, 'auth'>,
  collection: Pick<RequestCollection, 'auth' | 'authPerEnv' | 'microserviceId'>,
  parentFolder: Pick<RequestFolder, 'auth'> | undefined,
  envId: string | undefined,
  microservices: Pick<Microservice, 'id' | 'authProfileIds'>[],
  globalAuthProfiles: Pick<GlobalAuthProfile, 'id' | 'auth'>[],
): AuthConfig {
  if (request.auth?.type !== 'none' && request.auth?.type !== 'inherit') {
    return request.auth;
  }

  if (parentFolder?.auth?.type && parentFolder.auth.type !== 'none' && parentFolder.auth.type !== 'inherit') {
    return parentFolder.auth;
  }

  if (envId && collection.authPerEnv?.[envId]) {
    const envAuth = collection.authPerEnv[envId];
    if (envAuth.type && envAuth.type !== 'none') return envAuth;
  }

  if (collection.auth?.type && collection.auth.type !== 'none') {
    return collection.auth;
  }

  const linkedSvc = collection.microserviceId
    ? microservices.find(s => s.id === collection.microserviceId)
    : undefined;

  if (linkedSvc?.authProfileIds && envId) {
    const profileId = linkedSvc.authProfileIds[envId];
    if (profileId) {
      const profile = globalAuthProfiles.find(p => p.id === profileId);
      if (profile) return { ...profile.auth, globalProfileId: profile.id };
    }
  }

  return { type: 'none' };
}

function findParentFolder(
  folders: RequestFolder[] | undefined,
  targetFolderId: string,
): RequestFolder | undefined {
  if (!folders) return undefined;
  for (const f of folders) {
    if (f.id === targetFolderId) return f;
    const nested = findParentFolder(f.folders, targetFolderId);
    if (nested) return nested;
  }
  return undefined;
}

function isHostFolder(folder: RequestFolder | undefined): folder is RequestFolder {
  if (!folder) return false;
  return !!folder.isSubCollection || (!!folder.baseUrls && Object.keys(folder.baseUrls).length > 0);
}

function resolvePromotionFolders(
  request: Pick<RequestItem, 'id'>,
  collection: RequestCollection,
  folderId?: string,
): { containingFolder: RequestFolder | undefined; parentSub: RequestFolder | undefined } {
  const byRequest = findReqParentFolder(collection.folders ?? [], request.id) ?? undefined;
  const byFolderId = folderId ? findParentFolder(collection.folders, folderId) : undefined;
  const containingFolder = byRequest ?? byFolderId;
  const parentSub = findAncestorSubCollection(collection.folders ?? [], request.id)
    ?? (isHostFolder(containingFolder) ? containingFolder : undefined)
    ?? undefined;
  return { containingFolder, parentSub };
}

function resolveAbsoluteUrl(
  request: RequestItem,
  collection: RequestCollection,
  parentSub: RequestFolder | undefined,
  selectedEnvId: string | undefined,
  subColEnvId: string | undefined,
  resolvedColBaseUrls: Record<string, string>,
  microservices: { id: string; baseUrls?: Record<string, string> }[],
): string {
  const knownBases = collectKnownHostBases(resolvedColBaseUrls, collection, microservices);
  const pathOrUrl = stripKnownBaseToRelative(request.url, collection.mode, knownBases);

  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return bakeQueryParams(pathOrUrl, request.savedQueryParams);
  }

  const ctx: UrlResolverContext = {
    collectionMode: collection.mode,
    resolvedColBaseUrls,
    parentSubCollection: parentSub,
    subColEnvId,
    selectedEnvId,
  };

  let base = resolveBaseUrl(ctx);

  if (!base) {
    const subUrls = parentSub?.baseUrls;
    const fallbackMap = subUrls && Object.keys(subUrls).length > 0 ? subUrls : collection.baseUrls;
    if (fallbackMap) {
      const first = Object.values(fallbackMap)[0];
      if (first) base = first.replace(/\/+$/, '');
    }
  }

  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  const absolute = base ? `${base}${path}` : pathOrUrl;
  return bakeQueryParams(absolute, request.savedQueryParams);
}

function bakeQueryParams(
  url: string,
  params?: { key: string; value: string; enabled: boolean }[],
): string {
  if (!params) return url;
  const enabled = params.filter(p => p.enabled && p.key.trim());
  if (enabled.length === 0) return url;

  const baseUrl = url.split('?')[0];
  const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  return `${baseUrl}?${qs}`;
}

function resolvePathParams(url: string, params?: { key: string; value: string }[]): string {
  if (!params) return url;
  let resolved = url;
  for (const p of params) {
    if (p.value) {
      resolved = resolved.replace(`{${p.key}}`, encodeURIComponent(p.value));
    }
  }
  return resolved;
}

function resolveMicroserviceBaseUrl(
  collection: RequestCollection,
  microservices: Pick<Microservice, 'id' | 'baseUrls'>[],
  selectedEnvId: string | undefined,
  appEnvironments?: Pick<Environment, 'id' | 'name'>[],
): string | null {
  if (!collection.microserviceId) return null;
  const svc = microservices.find(s => s.id === collection.microserviceId);
  if (!svc?.baseUrls) return null;

  if (selectedEnvId && svc.baseUrls[selectedEnvId]) {
    return svc.baseUrls[selectedEnvId].replace(/\/+$/, '');
  }

  if (selectedEnvId && appEnvironments) {
    const appEnv = appEnvironments.find(e => e.id === selectedEnvId);
    if (appEnv) {
      for (const [envId, url] of Object.entries(svc.baseUrls)) {
        const matchEnv = appEnvironments.find(e => e.id === envId);
        if (matchEnv?.name === appEnv.name && url) {
          return url.replace(/\/+$/, '');
        }
      }
    }
  }

  const first = Object.values(svc.baseUrls).find(u => u);
  return first ? first.replace(/\/+$/, '') : null;
}

/**
 * Default Environment for Send to Harness: the request’s sub-collection binding,
 * then the workbench/collection selection.
 */
export function resolveDefaultPromotionEnvId(
  request: Pick<RequestItem, 'id'>,
  context: Pick<PromotionContext, 'collection' | 'folderId' | 'selectedEnvId' | 'appEnvironments'>,
): string | undefined {
  const settingsEnvs = context.appEnvironments ?? [];
  const { parentSub } = resolvePromotionFolders(request, context.collection, context.folderId);
  if (parentSub) {
    return resolveSubColBoundEnvId(parentSub, settingsEnvs) ?? parentSub.selectedEnvId ?? context.selectedEnvId;
  }
  return context.selectedEnvId;
}

export function resolveDefaultPromotionSvcId(
  collection: Pick<RequestCollection, 'microserviceId'>,
  microservices: Pick<Microservice, 'id' | 'baseUrls' | 'customEnvs'>[],
  envId: string | undefined,
): string | undefined {
  const id = collection.microserviceId;
  if (!id) return undefined;
  const svc = microservices.find(s => s.id === id);
  if (!svc) return undefined;
  if (!envId) return id;
  if (envId in (svc.baseUrls ?? {}) || (svc.customEnvs ?? []).some(ce => ce.id === envId)) return id;
  return undefined;
}

function buildValidation(preset?: 'none' | 'status-200'): ValidationConfig {
  if (preset === 'status-200') {
    return {
      mode: 'selective',
      assertions: [{ type: 'status', expected: '200' }],
    };
  }
  return { mode: 'none' };
}

/**
 * Convert a RequestItem into a standalone Scenario for Harness promotion.
 * One-time snapshot — no live link back to the request.
 */
export function createScenarioFromRequest(
  request: RequestItem,
  context: PromotionContext,
  options?: PromotionOptions,
): Scenario {
  const settingsEnvs = context.appEnvironments ?? [];
  const { containingFolder, parentSub } = resolvePromotionFolders(
    request,
    context.collection,
    context.folderId,
  );

  const boundEnvId = parentSub
    ? resolveSubColBoundEnvId(parentSub, settingsEnvs)
    : undefined;
  const subColEnvId = boundEnvId ?? parentSub?.selectedEnvId;
  // Send to Harness Environment picker wins when set; otherwise the current sub-collection.
  const effectiveEnvId = context.selectedEnvId ?? subColEnvId;
  const useSubColHost = !!parentSub && (!context.selectedEnvId || context.selectedEnvId === subColEnvId);
  const hostFolder = useSubColHost ? parentSub : undefined;
  const hostSubColEnvId = useSubColHost ? subColEnvId : undefined;

  const resolvedColBaseUrls = resolveCollectionBaseUrls(
    context.collection,
    settingsEnvs,
    context.microservices,
  );

  const authMode = options?.authMode ?? 'concrete';

  const auth: AuthConfig = authMode === 'inherit'
    ? { type: 'inherit' }
    : resolveRequestAuth(
        request,
        context.collection,
        containingFolder,
        effectiveEnvId,
        context.microservices,
        context.globalAuthProfiles,
      );

  let resolvedUrl = resolveAbsoluteUrl(
    request,
    context.collection,
    hostFolder,
    effectiveEnvId,
    hostSubColEnvId,
    resolvedColBaseUrls,
    context.microservices,
  );

  if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
    const svcBase = resolveMicroserviceBaseUrl(
      context.collection, context.microservices, effectiveEnvId, context.appEnvironments,
    );
    if (svcBase) {
      const path = resolvedUrl.startsWith('/') ? resolvedUrl : `/${resolvedUrl}`;
      resolvedUrl = `${svcBase}${path}`;
    }
  }

  resolvedUrl = resolvePathParams(resolvedUrl, request.savedPathParams);

  const activeVersion = request.specVersions?.find(v => v.id === request.activeSpecVersionId);
  const versionLabel = activeVersion?.catalogVersion;

  return {
    id: uuidv4(),
    name: request.name,
    url: resolvedUrl,
    method: request.method as Scenario['method'],
    headers: request.headers ? request.headers.filter(h => h.enabled !== false).map(h => ({ key: h.key, value: h.value })) : [],
    body: request.body ?? '',
    bodyType: request.bodyType,
    bodyForm: request.bodyForm ? [...request.bodyForm] : undefined,
    auth,
    validation: buildValidation(options?.validationPreset),
    sourceRequestId: request.id,
    sourceSpecVersionId: request.activeSpecVersionId,
    sourceSpecVersionLabel: versionLabel,
  };
}
