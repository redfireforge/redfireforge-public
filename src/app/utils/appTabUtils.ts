import { DEMO_HUB_ENABLED } from '../../config/features';
import { isTauri } from '@shared/utils/platform';

export type Tab = 'environments' | 'preferences' | 'kafka-settings' | 'requests' | 'catalog' | 'workflow' | 'workflow-executions' | 'webhook-deliveries' | 'workflow-runner' | 'gallery' | 'training' | 'scenarios' | 'runner' | 'param-runner' | 'results' | 'kafka-message-studio' | 'websocket-studio' | 'sse-studio' | 'graphql-studio' | 'grpc-studio' | 'api-mock-studio' | 'demo-hub';

export type Domain = 'api' | 'api-mock' | 'workflow' | 'testing' | 'gallery' | 'settings' | 'protocols' | 'demo';

const HARNESS_TABS = new Set<Tab>(['scenarios', 'runner', 'param-runner', 'workflow-runner', 'results']);
export const isHarnessTab = (t: Tab) => HARNESS_TABS.has(t);

const WORKFLOW_TABS = new Set<Tab>(['workflow', 'workflow-executions', 'webhook-deliveries']);
export const isWorkflowTab = (t: Tab) => WORKFLOW_TABS.has(t);

const GALLERY_TABS = new Set<Tab>(['gallery', 'training']);
export const isGalleryTab = (t: Tab) => GALLERY_TABS.has(t);

const API_TABS = new Set<Tab>(['requests', 'catalog']);
export const isApiTab = (t: Tab) => API_TABS.has(t);

const SETTINGS_TABS = new Set<Tab>(['environments', 'preferences', 'kafka-settings']);
export const isSettingsTab = (t: Tab) => SETTINGS_TABS.has(t);

const PROTOCOLS_TABS = new Set<Tab>(['kafka-message-studio', 'websocket-studio', 'sse-studio', 'graphql-studio', 'grpc-studio']);
export const isProtocolsTab = (t: Tab) => PROTOCOLS_TABS.has(t);

const API_MOCK_TABS = new Set<Tab>(['api-mock-studio']);
export const isApiMockTab = (t: Tab) => API_MOCK_TABS.has(t);

export const PROTOCOLS_DEFAULT_TAB: Tab = 'kafka-message-studio';
export const LAST_PROTOCOLS_TAB_STORAGE_KEY = 'app-last-protocols-tab';

let lastProtocolsTabCache: Tab = PROTOCOLS_DEFAULT_TAB;

/** Last Protocols sub-tab visited (GraphQL, Kafka, etc.) — used when re-entering from another domain. */
export function getLastProtocolsTab(): Tab {
  return lastProtocolsTabCache;
}

export function setLastProtocolsTab(tab: Tab): void {
  if (isProtocolsTab(tab)) {
    lastProtocolsTabCache = tab;
  }
}

const DEMO_TABS = new Set<Tab>(['demo-hub']);
export const isDemoTab = (t: Tab) => DEMO_HUB_ENABLED && DEMO_TABS.has(t);

/** Derive the active domain from the current tab. */
export function domainOf(tab: Tab): Domain {
  if (isApiTab(tab)) return 'api';
  if (isApiMockTab(tab)) return 'api-mock';
  if (isWorkflowTab(tab)) return 'workflow';
  if (isGalleryTab(tab)) return 'gallery';
  if (isHarnessTab(tab)) return 'testing';
  if (isProtocolsTab(tab)) return 'protocols';
  if (isDemoTab(tab)) return 'demo';
  return 'settings';
}

const ALL_TABS = new Set<Tab>(['environments', 'preferences', 'kafka-settings', 'requests', 'catalog', 'workflow', 'workflow-executions', 'webhook-deliveries', 'workflow-runner', 'gallery', 'training', 'scenarios', 'runner', 'param-runner', 'results', 'kafka-message-studio', 'websocket-studio', 'sse-studio', 'graphql-studio', 'grpc-studio', 'api-mock-studio', 'demo-hub']);
const TAB_QUERY = 'tab';
const DEFAULT_TAB: Tab = 'requests';

/** Read active tab from ?tab= so refresh keeps Environments / Workflow / Harness / etc. */
export function readTabFromUrl(): Tab {
  try {
    const q = new URLSearchParams(window.location.search).get(TAB_QUERY);
    if (q && ALL_TABS.has(q as Tab)) {
      if (q === 'demo-hub' && !DEMO_HUB_ENABLED) return DEFAULT_TAB;
      return q as Tab;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_TAB;
}

export function writeTabToUrl(tab: Tab): void {
  // Tauri serves the UI over a custom protocol. history.replaceState() with a
  // relative path can navigate WKWebView off tauri://localhost and leave the
  // native Reload error page (flash of UI, then blank). Desktop has no need
  // for shareable ?tab= URLs.
  if (isTauri()) return;
  const resolvedTab = tab === 'demo-hub' && !DEMO_HUB_ENABLED ? DEFAULT_TAB : tab;
  try {
    const url = new URL(window.location.href);
    if (resolvedTab === DEFAULT_TAB) {
      url.searchParams.delete(TAB_QUERY);
    } else {
      url.searchParams.set(TAB_QUERY, resolvedTab);
    }
    const serialized = url.pathname + (url.search ? url.search : '') + url.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (serialized !== current) {
      window.history.replaceState(window.history.state, '', serialized);
    }
  } catch {
    /* ignore */
  }
}
