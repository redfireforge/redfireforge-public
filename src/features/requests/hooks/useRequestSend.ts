import { useCallback } from 'react';
import type {
  RequestCollection, RequestItem,
  GlobalAuthProfile, Scenario, AuthConfig,
} from '@shared/types';
import { httpFetch } from '@shared/utils/httpClient';
import { serializeWithContentType } from '@shared/utils/bodySerializer';
import { applyAuthHeaders } from '@shared/utils/applyAuthHeaders';
import type { HttpResponse } from '@shared/utils/httpClient';
import { isClientManagedRequestHeader } from '@shared/utils/outboundRequestHeaders';
import { isTauri } from '@shared/utils/platform';
import { yieldToPaint } from '@shared/utils/yieldToPaint';
import { flushSync } from 'react-dom';
import type { ConsoleLine, ResponseHistoryEntry } from './useResponseCache';
import { resolveFullSendUrl } from '../utils/requestUrlResolver';
import { formatBytes, toErrorMessage } from '@shared/utils/helpers';
import type { UrlResolverContext } from '../utils/requestUrlResolver';

export interface UseRequestSendOptions {
  request: RequestItem;
  collection: RequestCollection;
  parentSubCollection?: import('../../../shared/types').RequestFolder;
  appGlobalAuthProfiles: GlobalAuthProfile[];
  appMicroservices?: import('../../../shared/types').Microservice[];
  selectedEnvId?: string;
  subColEnvId?: string;
  urlCtx: UrlResolverContext;
  asDraftScenario: () => Scenario;
  setResponse: (r: HttpResponse | null) => void;
  setResponseTime: (t: number) => void;
  setSendAllResults: (r: null) => void;
  setConsoleLines: (lines: ConsoleLine[]) => void;
  pushHistory: (entry: Omit<ResponseHistoryEntry, 'id'>) => string;
  setActiveHistoryId: (id: string | null) => void;
}

export function resolveEffectiveAuth(
  request: RequestItem,
  parentSubCollection: import('../../../shared/types').RequestFolder | undefined,
  collection: RequestCollection,
  linkedSvc: import('../../../shared/types').Microservice | undefined,
  appGlobalAuthProfiles: GlobalAuthProfile[],
  envId?: string,
): AuthConfig {
  if (request.auth?.type !== 'none' && request.auth?.type !== 'inherit') return request.auth;
  if (parentSubCollection?.auth?.type && parentSubCollection.auth.type !== 'none' && parentSubCollection.auth.type !== 'inherit') {
    return parentSubCollection.auth;
  }
  if (envId && collection.authPerEnv?.[envId]) {
    const envAuth = collection.authPerEnv[envId];
    if (envAuth.type && envAuth.type !== 'none') return envAuth;
  }
  if (collection.auth?.type && collection.auth.type !== 'none') return collection.auth;
  if (linkedSvc?.authProfileIds && envId) {
    const profileId = linkedSvc.authProfileIds[envId];
    if (profileId) {
      const profile = appGlobalAuthProfiles.find(p => p.id === profileId);
      if (profile) return { ...profile.auth, globalProfileId: profile.id };
    }
  }
  return { type: 'none' };
}

export async function buildRequestHeaders(
  scenario: Scenario,
  contentType: string | null,
  resolveAuth: (envId?: string) => AuthConfig,
  envId?: string,
): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  for (const kv of scenario.headers) {
    if (kv.enabled === false) continue;
    const key = kv.key.trim();
    if (!key) continue;
    // Skip hop-by-hop / transport headers so undici does not see
    // `connection` + `Connection` (journal Open in Requests → Send).
    if (isClientManagedRequestHeader(key)) continue;
    h[key] = kv.value;
  }
  if (contentType) {
    if (contentType.startsWith('multipart/form-data')) h['Content-Type'] = contentType;
    else if (!h['Content-Type']) h['Content-Type'] = contentType;
  }
  const auth = resolveAuth(envId);
  if (auth && auth.type !== 'none') {
    await applyAuthHeaders(auth, h);
  }
  return h;
}

export function useRequestSend({
  request,
  collection,
  parentSubCollection,
  appGlobalAuthProfiles,
  appMicroservices,
  selectedEnvId,
  subColEnvId,
  urlCtx,
  asDraftScenario,
  setResponse,
  setResponseTime,
  setSendAllResults,
  setConsoleLines,
  pushHistory,
  setActiveHistoryId,
}: UseRequestSendOptions) {
  const linkedSvc = collection.microserviceId
    ? appMicroservices?.find(s => s.id === collection.microserviceId)
    : undefined;

  const resolveAuth = useCallback((envId?: string): AuthConfig => {
    return resolveEffectiveAuth(request, parentSubCollection, collection, linkedSvc, appGlobalAuthProfiles, envId);
  }, [request, parentSubCollection, collection, linkedSvc, appGlobalAuthProfiles]);

  const buildHeaders = useCallback(async (scenario: Scenario, contentType: string | null, envId?: string): Promise<Record<string, string>> => {
    return buildRequestHeaders(scenario, contentType, resolveAuth, envId);
  }, [resolveAuth]);

  const handleSend = useCallback(async (
    setSending: (v: boolean) => void,
    setBusy?: (v: boolean) => void,
  ) => {
    setBusy?.(true);
    setSendAllResults(null);
    const log: ConsoleLine[] = [];
    const info = (t: string) => log.push({ prefix: '*', text: t });
    const out = (t: string) => log.push({ prefix: '>', text: t });
    const inp = (t: string) => log.push({ prefix: '<', text: t });

    let sendUrl = '';
    let sendMethod = '';

    try {
      const scenario = asDraftScenario();
      sendMethod = scenario.method;

      {
        const { url: resolved, error: urlError } = resolveFullSendUrl(scenario.url, urlCtx);
        if (urlError) {
          info(`ERROR: ${urlError}`);
          setConsoleLines(log);
          setResponse({ status: 0, statusText: 'Error', headers: {}, body: urlError, error: urlError });
          setSending(false);
          setBusy?.(false);
          return;
        }
        scenario.url = resolved;
      }
      sendUrl = scenario.url;

      const { body: reqBody, contentType } = serializeWithContentType(scenario);

      log.push({ prefix: '', text: `Preparing request to ${scenario.url}` });
      info(`Current time is ${new Date().toISOString()}`);

      const effectiveEnvId = subColEnvId || selectedEnvId;
      const auth = resolveAuth(effectiveEnvId);
      if (auth.type === 'oauth2' && auth.tokenUrl) {
        info(`Acquiring OAuth2 token from ${auth.tokenUrl}`);
        info(`Client ID: ${auth.clientId}`);
        info(`Grant type: client_credentials`);
      }

      const headers = await buildHeaders(scenario, contentType, effectiveEnvId);

      if (auth.type === 'oauth2') info('OAuth2 token acquired successfully');
      if (auth.type === 'bearer') info('Using Bearer token authentication');
      if (auth.type === 'basic') info('Using Basic authentication');
      if (auth.type === 'apikey') info(`Using API Key in ${auth.apiKeyIn ?? 'header'}`);

      let hostname = '';
      try { hostname = new URL(scenario.url).hostname; } catch { /* intentionally empty */ }
      if (hostname) info(`Connecting to ${hostname}...`);
      info(isTauri() ? 'Using native HTTP (connection pool)' : 'Using browser fetch API');
      if (scenario.url.startsWith('https')) {
        info(isTauri() ? 'SSL/TLS handled by native client' : 'SSL/TLS handled by browser');
      }

      log.push({ prefix: '', text: '' });
      out(`${scenario.method} ${scenario.url.replace(/https?:\/\/[^/]+/, '')} HTTP/1.1`);
      if (hostname) out(`Host: ${hostname}`);
      for (const [k, v] of Object.entries(headers)) {
        out(`${k}: ${v}`);
      }
      out('');

      if (reqBody && reqBody.length > 0) {
        info(`Request body: ${formatBytes(reqBody.length)}`);
        if (reqBody.length <= 500) {
          log.push({ prefix: '#', text: reqBody });
        } else {
          log.push({ prefix: '#', text: reqBody.slice(0, 500) + `... (${reqBody.length - 500} more bytes)` });
        }
        log.push({ prefix: '', text: '' });
      }

      flushSync(() => setSending(true));
      const t0 = performance.now();
      const resp = await httpFetch(scenario.url, scenario.method, headers, reqBody);
      const elapsed = Math.round(performance.now() - t0);
      flushSync(() => {
        setSending(false);
        setResponseTime(elapsed);
        setBusy?.(false);
      });
      await yieldToPaint();

      log.push({ prefix: '', text: '' });
      inp(`HTTP/1.1 ${resp.status} ${resp.statusText}`);
      for (const [k, v] of Object.entries(resp.headers)) {
        inp(`${k}: ${v}`);
      }
      inp('');

      info(`Received ${formatBytes(resp.body?.length ?? 0)} in ${elapsed} ms`);
      info(`Response status: ${resp.status} ${resp.statusText}`);
      if (resp.timing) {
        info(`Timing: TTFB ${Math.round(resp.timing.ttfb)} ms, download ${Math.round(resp.timing.download)} ms`);
      }

      setResponse(resp);
      setConsoleLines(log);

      const hid = pushHistory({ timestamp: Date.now(), method: sendMethod, url: sendUrl, response: resp, responseTime: elapsed, consoleLines: log });
      setActiveHistoryId(hid);
    } catch (err) {
      const msg = toErrorMessage(err);
      log.push({ prefix: '', text: '' });
      info(`ERROR: ${msg}`);
      const errResp = { status: 0, statusText: 'Error', headers: {} as Record<string, string>, body: msg, error: msg };
      flushSync(() => {
        setSending(false);
        setResponseTime(0);
        setBusy?.(false);
      });
      await yieldToPaint();
      setResponse(errResp);
      setConsoleLines(log);

      const hid = pushHistory({ timestamp: Date.now(), method: sendMethod || 'GET', url: sendUrl || request.url, response: errResp, responseTime: 0, consoleLines: log });
      setActiveHistoryId(hid);
    } finally {
      setSending(false);
      setBusy?.(false);
    }
  }, [asDraftScenario, buildHeaders, resolveAuth, urlCtx, pushHistory, request.url,
      setResponse, setResponseTime, setSendAllResults, setConsoleLines, setActiveHistoryId,
      subColEnvId, selectedEnvId]);

  return {
    handleSend,
    resolveAuth,
    buildHeaders,
  };
}
