import type { RequestCollection, RequestFolder } from '@shared/types';

export interface UrlResolverContext {
  collectionMode: RequestCollection['mode'];
  resolvedColBaseUrls: Record<string, string>;
  parentSubCollection?: Pick<RequestFolder, 'baseUrls'>;
  subColEnvId?: string;
  selectedEnvId?: string;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** True when `url` is `base` or `base` followed by `/`, `?`, or `#`. */
export function urlStartsWithHostBase(url: string, base: string): boolean {
  if (!url.startsWith(base)) return false;
  const rest = url.slice(base.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('?') || rest.startsWith('#');
}

/**
 * Every hostname this collection can send to — mapped collection bases, raw collection
 * bases, linked microservice bases, and every folder override. Used to strip a stale
 * env host after a request is moved between sub-collections.
 */
export function collectKnownHostBases(
  resolvedColBaseUrls: Record<string, string>,
  collection: Pick<RequestCollection, 'baseUrls' | 'microserviceId' | 'folders'>,
  microservices: { id: string; baseUrls?: Record<string, string> }[],
): string[] {
  const urls: string[] = [];
  const add = (raw?: string) => {
    if (!raw) return;
    const trimmed = trimTrailingSlash(raw);
    if (trimmed) urls.push(trimmed);
  };
  for (const u of Object.values(resolvedColBaseUrls)) add(u);
  for (const u of Object.values(collection.baseUrls ?? {})) add(u);
  const svc = collection.microserviceId
    ? microservices.find(s => s.id === collection.microserviceId)
    : undefined;
  if (svc?.baseUrls) {
    for (const u of Object.values(svc.baseUrls)) add(u);
  }
  const walk = (folders: RequestFolder[] | undefined) => {
    if (!folders) return;
    for (const f of folders) {
      if (f.baseUrls) {
        for (const u of Object.values(f.baseUrls)) add(u);
      }
      walk(f.folders);
    }
  };
  walk(collection.folders);
  return [...new Set(urls)].sort((a, b) => b.length - a.length);
}

/**
 * Multi-env Requests store a path (or an absolute URL from another env). If the host
 * matches a known collection/microservice/folder base, strip it so the current
 * sub-collection host can be applied. Unknown hosts stay absolute.
 */
export function stripKnownBaseToRelative(
  url: string,
  collectionMode: RequestCollection['mode'],
  knownBases: string[],
): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
  if (collectionMode !== 'multi-env') return url;
  const matched = knownBases.find(b => urlStartsWithHostBase(url, b));
  if (!matched) return url;
  const rest = url.slice(matched.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

export function resolveBaseUrl(ctx: UrlResolverContext): string | null {
  // Inside a sub-collection, resolve strictly via its bound env (`subColEnvId`). Never silently
  // fall back to the workbench's active env — that produced wrong base URLs for orphaned
  // sub-collections whose name/selectedEnvId no longer maps to a configured environment.
  const envId = ctx.parentSubCollection ? ctx.subColEnvId : (ctx.subColEnvId || ctx.selectedEnvId);

  if (ctx.parentSubCollection?.baseUrls) {
    const subBaseUrls = ctx.parentSubCollection.baseUrls;
    if (envId && subBaseUrls[envId]) {
      return subBaseUrls[envId].replace(/\/+$/, '');
    }
    const firstBase = Object.values(subBaseUrls)[0];
    if (firstBase) return firstBase.replace(/\/+$/, '');
  }

  if (envId && ctx.resolvedColBaseUrls[envId]) {
    return ctx.resolvedColBaseUrls[envId].replace(/\/+$/, '');
  }

  return null;
}

export function buildDisplayUrl(relativePath: string, ctx: UrlResolverContext): string {
  if (ctx.collectionMode === 'direct') return relativePath;
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) return relativePath;

  const base = resolveBaseUrl(ctx);
  if (!base) return relativePath;

  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${base}${path}`;
}

export function resolveFullSendUrl(
  relativeUrl: string,
  ctx: UrlResolverContext,
): { url: string; error?: string } {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return { url: relativeUrl };
  }

  const base = resolveBaseUrl(ctx);
  if (base) {
    const path = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
    return { url: `${base}${path}` };
  }

  const error = ctx.collectionMode === 'multi-env'
    ? 'Cannot send: no base URL configured for the selected environment. Edit collection settings to add hostnames.'
    : 'Cannot send: URL must be a full URL (e.g. https://api.example.com/...).';
  return { url: relativeUrl, error };
}
