/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../adapters', () => ({
  purgeGqlStudioEnvironmentsByName: vi.fn(async () => false),
  purgeGqlDemoConnectionProfiles: vi.fn(async () => 0),
  purgeGqlDemoGlobalAuthProfiles: vi.fn(async () => 0),
  purgeGqlLesson9CollectionArtifacts: vi.fn(async () => ({ collectionsRemoved: 0, itemsRemoved: 0 })),
  purgeGqlLesson9DemoHistory: vi.fn(async () => 0),
  purgeGqlDemoBatchDetectionFlags: vi.fn(async () => 0),
  deleteGqlEnvironmentByName: vi.fn(),
}));

import {
  navigateToEnvironmentManager,
  expandFirstMicroservice,
  ensureFirstEnvDeployed,
  ensureNamedEnvDeployedOnProtocol,
  ensureProtocolDisabled,
  ensureSseDemoHeaderContext,
  ensureWsDemoEndpointConfigured,
  ensureWsDemoProtocolReady,
  ensureWsDemoHeaderContext,
  ensureGqlDemoProtocolReady,
  ensureGqlDemoEndpointConfigured,
  ensureGqlDemoHeaderContext,
  editNamedProtocolEndpoint,
  selectProtocolTab,
  editFirstProtocolEndpoint,
  configureProtocolEndpointInEnvManager,
  configureGraphqlEndpoint,
  navigateToWebSocketStudio,
  navigateToSseStudio,
  navigateToGraphqlStudio,
  navigateToGrpcStudio,
  createNamedEnvAndSvcVisible,
  ensureDemoEnvironment,
  ensureDemoMicroservice,
  expandNamedMicroservice,
  cleanupDemoMicroservice,
  cleanupDemoEnvironment,
  cleanupGqlDemoLessonEnvironment,
  selectEnvInHeaderVisible,
  selectSvcInHeaderVisible,
} from './env-manager-lesson-helpers';
import { makeCtx } from './protocols/ws-test-utils';
import { APP, EM } from '@shared/selectors';

function mockRect(el: Element, width: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('env-manager-lesson-helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('navigateToEnvironmentManager navigates via navigateToTab when manager absent', async () => {
    const ctx = makeCtx();
    await navigateToEnvironmentManager(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('environments');
    expect(ctx.waitFor).toHaveBeenCalledWith(EM.MANAGER); // waits for the element to appear
  });

  it('navigateToEnvironmentManager skips navigation when manager already visible', async () => {
    const manager = document.createElement('div');
    manager.className = 'env-manager';
    mockRect(manager, 100, 100);
    document.body.append(manager);
    const ctx = makeCtx();
    await navigateToEnvironmentManager(ctx);
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
    expect(ctx.waitFor).not.toHaveBeenCalled();
  });

  it('expandFirstMicroservice clicks configure when panel collapsed', async () => {
    document.body.innerHTML = '<button data-testid="em-svc-configure-svc1">Configure</button>';
    const ctx = makeCtx();
    await expandFirstMicroservice(ctx);
    expect(ctx.click).toHaveBeenCalledWith(EM.SVC_CONFIGURE);
    expect(ctx.waitFor).toHaveBeenCalledWith(EM.PROTOCOL_PANEL);
  });

  it('expandFirstMicroservice is no-op when protocol panel already open', async () => {
    document.body.innerHTML = '<div data-testid="microservice-protocol-panel"></div>';
    const ctx = makeCtx();
    await expandFirstMicroservice(ctx);
    expect(ctx.click).not.toHaveBeenCalled();
  });

  it('expandFirstMicroservice prefers first visible configure button', async () => {
    document.body.innerHTML = '<button data-testid="em-svc-configure-svc1">Configure</button>';
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({
        width: 120,
        height: 32,
        top: 0,
        left: 0,
        right: 120,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
    );
    const ctx = makeCtx();
    await expandFirstMicroservice(ctx);
    expect(ctx.click).toHaveBeenCalledWith(EM.SVC_CONFIGURE);
    rectSpy.mockRestore();
  });

  it('selectProtocolTab clicks websocket tab', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-websocket">WS</button>
      </div>`;
    const ctx = makeCtx();
    await selectProtocolTab(ctx, 'websocket');
    expect(ctx.click).toHaveBeenCalledWith(EM.PROTOCOL_TAB_WS);
  });

  it('editFirstProtocolEndpoint opens inline editor and saves', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-endpoint-edit-btn">Edit</button>
      </div>`;
    const ctx = makeCtx();
    await editFirstProtocolEndpoint(ctx, 'ws://localhost:9876');
    expect(ctx.click).toHaveBeenCalledWith(`${EM.PROTOCOL_PANEL} ${EM.ENDPOINT_EDIT}`);
    expect(ctx.fill).toHaveBeenCalledWith(EM.ENDPOINT_EDIT_INPUT, 'ws://localhost:9876');
    expect(ctx.click).toHaveBeenCalledWith(EM.ENDPOINT_SAVE);
  });

  it('configureProtocolEndpointInEnvManager runs full websocket flow', async () => {
    document.body.innerHTML = `
      <button data-testid="em-svc-configure-s1">Configure</button>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-http">HTTP</button>
        <button data-testid="em-protocol-tab-websocket">WS</button>
        <button data-testid="em-endpoint-edit-btn">Edit</button>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
      </div>`;
    const ctx = makeCtx();
    await configureProtocolEndpointInEnvManager(ctx, 'websocket', 'ws://localhost:9876', {
      httpFallbackBase: 'http://localhost:9876',
    });
    expect(ctx.navigateToTab).toHaveBeenCalledWith('environments');
    expect(ctx.click).toHaveBeenCalledWith(EM.PROTOCOL_TAB_HTTP);
    expect(ctx.click).toHaveBeenCalledWith(EM.PROTOCOL_TAB_WS);
  });

  it('ensureFirstEnvDeployed enables deploy checkbox when HTTP row is empty', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-http">HTTP</button>
        <div class="em-empty-deployed"></div>
        <table>
          <tr>
            <td><input type="checkbox" aria-label="Deploy local" /></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text"></code></td>
          </tr>
        </table>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
      </div>`;
    const deploy = document.querySelector('input[aria-label="Deploy local"]') as HTMLInputElement;
    const deployClick = vi.spyOn(deploy, 'click');
    const ctx = makeCtx();
    await ensureFirstEnvDeployed(ctx, 'http://localhost:9876');
    expect(deployClick).toHaveBeenCalled();
  });

  it('ensureFirstEnvDeployed does not re-click deploy checkbox when already checked', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-http">HTTP</button>
        <div class="em-empty-deployed"></div>
        <table>
          <tr>
            <td><input type="checkbox" aria-label="Deploy local" checked /></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text">http://localhost:9876</code></td>
          </tr>
        </table>
      </div>`;
    const deploy = document.querySelector('input[aria-label="Deploy local"]') as HTMLInputElement;
    const deployClick = vi.spyOn(deploy, 'click');
    const ctx = makeCtx();
    await ensureFirstEnvDeployed(ctx, 'http://localhost:9876');
    expect(deployClick).not.toHaveBeenCalled();
  });

  it('ensureFirstEnvDeployed returns early when row already has URL text', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-http">HTTP</button>
        <table>
          <tr>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text">https://api.example.com</code></td>
          </tr>
        </table>
      </div>`;
    const ctx = makeCtx();
    await ensureFirstEnvDeployed(ctx, 'http://localhost:9876');
    const editCalls = (ctx.click as ReturnType<typeof vi.fn>).mock.calls
      .map((c: string[]) => c[0])
      .filter((sel: string) => sel.includes('em-endpoint-edit-btn'));
    expect(editCalls.length).toBe(0);
  });

  it('ensureNamedEnvDeployedOnProtocol deploys a named environment on SSE tab', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-sse">SSE</button>
        <table>
          <tr>
            <td><input type="checkbox" aria-label="Deploy SSE Demo" /></td>
            <td><span class="em-env-chip">SSE Demo</span></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text"></code></td>
          </tr>
        </table>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
      </div>`;
    const deploy = document.querySelector('input[aria-label="Deploy SSE Demo"]') as HTMLInputElement;
    const deployClick = vi.spyOn(deploy, 'click');
    const ctx = makeCtx();
    await ensureNamedEnvDeployedOnProtocol(ctx, 'sse', 'SSE Demo');
    expect(deployClick).toHaveBeenCalled();
    expect(ctx.click).toHaveBeenCalledWith('[data-testid="em-protocol-tab-sse"]');
  });

  it('ensureSseDemoHeaderContext selects header options when already present', async () => {
    document.body.innerHTML = `
      <select data-testid="header-env-select">
        <option value="">Select env</option>
        <option value="e1">SSE Demo</option>
      </select>
      <select data-testid="header-svc-select">
        <option value="">Select svc</option>
        <option value="s1">sse-demo</option>
      </select>`;
    const ctx = makeCtx();
    await ensureSseDemoHeaderContext(ctx);
    expect(ctx.selectOption).toHaveBeenCalledWith('[data-testid="header-env-select"]', 'e1');
    expect(ctx.selectOption).toHaveBeenCalledWith('[data-testid="header-svc-select"]', 's1');
    expect(ctx.navigateToTab).not.toHaveBeenCalledWith('environments');
  });

  it('ensureSseDemoHeaderContext recreates demo data when header options are missing', async () => {
    document.body.innerHTML = `
      <select data-testid="header-env-select"><option value="">Environment…</option></select>
      <select data-testid="header-svc-select"><option value="">Service…</option></select>`;
    const ctx = makeCtx();
    await ensureSseDemoHeaderContext(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('environments');
  });

  it('ensureSseDemoHeaderContext uses bridge without opening header selects', async () => {
    document.body.innerHTML = `
      <select data-testid="header-env-select">
        <option value="">Select env</option>
        <option value="e1">SSE Demo</option>
      </select>
      <select data-testid="header-svc-select">
        <option value="">Select svc</option>
        <option value="s1">sse-demo</option>
      </select>`;
    const ensureEnv = vi.fn(() => 'e1');
    const ensureSvc = vi.fn(() => 's1');
    const selectEnvSvc = vi.fn();
    (window as unknown as Record<string, unknown>).__demoEnsureSettingsEnv = ensureEnv;
    (window as unknown as Record<string, unknown>).__demoEnsureSettingsSvc = ensureSvc;
    (window as unknown as Record<string, unknown>).__demoSelectEnvSvc = selectEnvSvc;
    try {
      const ctx = makeCtx();
      await ensureSseDemoHeaderContext(ctx);
      expect(ensureEnv).toHaveBeenCalledWith('SSE Demo');
      expect(ensureSvc).toHaveBeenCalledWith('sse-demo', { e1: 'http://localhost:3001' });
      expect(selectEnvSvc).toHaveBeenCalledWith('e1', 's1');
      // Bridge path must not open Environment/Service dropdowns (viewer flash).
      expect(ctx.selectOption).not.toHaveBeenCalled();
      expect(ctx.navigateToTab).not.toHaveBeenCalledWith('environments');
    } finally {
      delete (window as unknown as Record<string, unknown>).__demoEnsureSettingsEnv;
      delete (window as unknown as Record<string, unknown>).__demoEnsureSettingsSvc;
      delete (window as unknown as Record<string, unknown>).__demoSelectEnvSvc;
    }
  });

  it('ensureSseDemoHeaderContext is a no-op when env and svc are already selected', async () => {
    document.body.innerHTML = `
      <div data-testid="header-env-select"><span class="cs-text">SSE Demo</span></div>
      <div data-testid="header-svc-select"><span class="cs-text">sse-demo</span></div>`;
    const ensureEnv = vi.fn(() => 'e1');
    (window as unknown as Record<string, unknown>).__demoEnsureSettingsEnv = ensureEnv;
    (window as unknown as Record<string, unknown>).__demoEnsureSettingsSvc = vi.fn(() => 's1');
    (window as unknown as Record<string, unknown>).__demoSelectEnvSvc = vi.fn();
    try {
      const ctx = makeCtx();
      await ensureSseDemoHeaderContext(ctx);
      expect(ensureEnv).not.toHaveBeenCalled();
      expect(ctx.selectOption).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as Record<string, unknown>).__demoEnsureSettingsEnv;
      delete (window as unknown as Record<string, unknown>).__demoEnsureSettingsSvc;
      delete (window as unknown as Record<string, unknown>).__demoSelectEnvSvc;
    }
  });

  it('ensureProtocolDisabled clicks remove when HTTP tab is present (no viewer ripple)', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-http">HTTP</button>
        <button data-testid="em-remove-protocol-http">×</button>
      </div>`;
    const removeBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="em-remove-protocol-http"]',
    )!;
    const removeClickSpy = vi.spyOn(removeBtn, 'click');
    const ctx = makeCtx();
    await ensureProtocolDisabled(ctx, 'http');
    // Removal uses a plain DOM click so no demo ripple/highlight fires during setup.
    expect(removeClickSpy).toHaveBeenCalledTimes(1);
    expect(ctx.click).not.toHaveBeenCalled();
  });

  it('ensureProtocolDisabled is no-op when remove button is absent', async () => {
    document.body.innerHTML = `<div data-testid="microservice-protocol-panel"></div>`;
    const ctx = makeCtx();
    await ensureProtocolDisabled(ctx, 'http');
    expect(ctx.click).not.toHaveBeenCalled();
  });

  it('expandNamedMicroservice collapses a different expanded card before opening the target', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <div data-env-name="WebSocket Demo"></div>
      <div data-svc-name="other-svc">
        <div data-testid="microservice-protocol-panel">
          <button data-testid="em-svc-configure-other">Collapse</button>
        </div>
      </div>
      <div data-svc-name="ws-demo">
        <button data-testid="em-svc-configure-ws">Configure</button>
      </div>`;
    const otherCollapse = document.querySelector<HTMLButtonElement>('[data-testid="em-svc-configure-other"]')!;
    const wsConfigure = document.querySelector<HTMLButtonElement>('[data-testid="em-svc-configure-ws"]')!;
    const otherClick = vi.spyOn(otherCollapse, 'click');
    const wsClick = vi.spyOn(wsConfigure, 'click');
    const ctx = makeCtx();
    await expandNamedMicroservice(ctx, 'ws-demo');
    expect(otherClick).toHaveBeenCalled();
    expect(wsClick).toHaveBeenCalled();
  });

  it('ensureWsDemoEndpointConfigured removes stale HTTP tab and deploys WebSocket Demo row', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <div data-env-name="WebSocket Demo"></div>
      <div data-svc-name="ws-demo"></div>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-remove-protocol-http">×</button>
        <button data-testid="em-protocol-tab-http">HTTP</button>
        <button data-testid="em-add-protocol-btn">+ Add protocol</button>
        <button data-testid="em-protocol-tab-websocket">WebSocket</button>
        <table>
          <tr>
            <td><input type="checkbox" checked aria-label="Deploy dev" /></td>
            <td><span class="em-env-chip">dev</span></td>
          </tr>
          <tr>
            <td><input type="checkbox" aria-label="Deploy WebSocket Demo" /></td>
            <td><span class="em-env-chip">WebSocket Demo</span></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text"></code></td>
          </tr>
        </table>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
      </div>`;
    const d01Checkbox = document.querySelector<HTMLInputElement>('[aria-label="Deploy dev"]')!;
    const d01Click = vi.spyOn(d01Checkbox, 'click');
    const removeHttpBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="em-remove-protocol-http"]',
    )!;
    const removeHttpClick = vi.spyOn(removeHttpBtn, 'click');
    const ctx = makeCtx();
    await ensureWsDemoEndpointConfigured(ctx);
    expect(removeHttpClick).toHaveBeenCalled();
    expect(d01Click).toHaveBeenCalled();
    expect(ctx.click).toHaveBeenCalledWith('[data-testid="em-protocol-tab-websocket"]');
  });

  it('ensureWsDemoProtocolReady undeploys stale rows without saving endpoint URL', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <div data-env-name="WebSocket Demo"></div>
      <div data-svc-name="ws-demo"></div>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-websocket">WebSocket</button>
        <table>
          <tr>
            <td><input type="checkbox" checked aria-label="Deploy dev" /></td>
            <td><span class="em-env-chip">dev</span></td>
          </tr>
          <tr>
            <td><input type="checkbox" aria-label="Deploy WebSocket Demo" /></td>
            <td><span class="em-env-chip">WebSocket Demo</span></td>
          </tr>
        </table>
      </div>`;
    const d01Checkbox = document.querySelector<HTMLInputElement>('[aria-label="Deploy dev"]')!;
    const d01Click = vi.spyOn(d01Checkbox, 'click');
    const ctx = makeCtx();
    await ensureWsDemoProtocolReady(ctx);
    expect(d01Click).toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalledWith('[data-testid="em-endpoint-edit-input"]', expect.any(String));
  });

  it('ensureWsDemoEndpointConfigured saves endpoint on WebSocket Demo row', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <div data-env-name="WebSocket Demo"></div>
      <div data-svc-name="ws-demo"></div>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-add-protocol-btn">+ Add protocol</button>
        <button data-testid="em-protocol-tab-websocket">WebSocket</button>
        <table>
          <tr>
            <td><input type="checkbox" aria-label="Deploy WebSocket Demo" /></td>
            <td><span class="em-env-chip">WebSocket Demo</span></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text"></code></td>
          </tr>
        </table>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
      </div>`;
    const ctx = makeCtx();
    await ensureWsDemoEndpointConfigured(ctx);
    expect(ctx.click).toHaveBeenCalledWith('[data-testid="em-protocol-tab-websocket"]');
  });

  it('ensureWsDemoHeaderContext selects header options when already present', async () => {
    document.body.innerHTML = `
      <select data-testid="header-env-select">
        <option value="">Select env</option>
        <option value="e1">WebSocket Demo</option>
      </select>
      <select data-testid="header-svc-select">
        <option value="">Select svc</option>
        <option value="s1">ws-demo</option>
      </select>`;
    const ctx = makeCtx();
    await ensureWsDemoHeaderContext(ctx);
    expect(ctx.selectOption).toHaveBeenCalledWith('[data-testid="header-env-select"]', 'e1');
    expect(ctx.selectOption).toHaveBeenCalledWith('[data-testid="header-svc-select"]', 's1');
  });

  it('ensureGqlDemoProtocolReady removes HTTP tab and deploys GraphQL Demo row only', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <div data-env-name="GraphQL Demo"></div>
      <div data-svc-name="graphql-demo"></div>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-http" aria-selected="true">HTTP</button>
        <button data-testid="em-remove-protocol-http">Remove HTTP</button>
        <button data-testid="em-add-protocol-btn">+ Add protocol</button>
        <button data-testid="em-protocol-tab-graphql">GraphQL</button>
        <table>
          <tr>
            <td><input type="checkbox" checked aria-label="Deploy dev" /></td>
            <td><span class="em-env-chip">dev</span></td>
          </tr>
          <tr>
            <td><input type="checkbox" aria-label="Deploy GraphQL Demo" /></td>
            <td><span class="em-env-chip">GraphQL Demo</span></td>
          </tr>
        </table>
      </div>`;
    const d01Checkbox = document.querySelector<HTMLInputElement>('[aria-label="Deploy dev"]')!;
    const d01Click = vi.spyOn(d01Checkbox, 'click');
    const removeHttpBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="em-remove-protocol-http"]',
    )!;
    const removeHttpClick = vi.spyOn(removeHttpBtn, 'click');
    const ctx = makeCtx();
    await ensureGqlDemoProtocolReady(ctx);
    expect(removeHttpClick).toHaveBeenCalled();
    expect(d01Click).toHaveBeenCalled();
    expect(ctx.click).toHaveBeenCalledWith('[data-testid="em-protocol-tab-graphql"]');
  });

  it('ensureGqlDemoEndpointConfigured saves endpoint on GraphQL Demo row', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <div data-env-name="GraphQL Demo"></div>
      <div data-svc-name="graphql-demo"></div>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-add-protocol-btn">+ Add protocol</button>
        <button data-testid="em-protocol-tab-graphql">GraphQL</button>
        <table>
          <tr>
            <td><input type="checkbox" aria-label="Deploy GraphQL Demo" /></td>
            <td><span class="em-env-chip">GraphQL Demo</span></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit</button></td>
            <td><code class="em-url-text"></code></td>
          </tr>
        </table>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
        <input data-testid="em-graphql-path-input" value="/graphql" />
      </div>`;
    const ctx = makeCtx();
    await ensureGqlDemoEndpointConfigured(ctx);
    expect(ctx.click).toHaveBeenCalledWith('[data-testid="em-protocol-tab-graphql"]');
  });

  it('ensureGqlDemoHeaderContext selects header options when already present', async () => {
    document.body.innerHTML = `
      <div data-testid="gql-studio-page"></div>
      <select data-testid="header-env-select">
        <option value="">Select env</option>
        <option value="e1">GraphQL Demo</option>
      </select>
      <select data-testid="header-svc-select">
        <option value="">Select svc</option>
        <option value="s1">graphql-demo</option>
      </select>`;
    const ctx = makeCtx();
    await ensureGqlDemoHeaderContext(ctx);
    expect(ctx.selectOption).toHaveBeenCalledWith('[data-testid="header-env-select"]', 'e1');
    expect(ctx.selectOption).toHaveBeenCalledWith('[data-testid="header-svc-select"]', 's1');
    expect(ctx.navigateToTab).toHaveBeenCalledWith('graphql-studio');
  });

  it('ensureGqlDemoHeaderContext uses settings bridge without Environment Manager', async () => {
    document.body.innerHTML = `
      <div data-testid="gql-studio-page"></div>
      <div data-testid="header-env-select"><span class="cs-text">Other</span></div>
      <div data-testid="header-svc-select"><span class="cs-text">Other</span></div>`;
    const ensureEnv = vi.fn(() => 'env-gql');
    const ensureSvc = vi.fn(() => 'svc-gql');
    const selectEnvSvc = vi.fn(() => {
      document.querySelector('[data-testid="header-env-select"] .cs-text')!.textContent = 'GraphQL Demo';
      document.querySelector('[data-testid="header-svc-select"] .cs-text')!.textContent = 'graphql-demo';
    });
    (window as unknown as Record<string, unknown>).__demoEnsureSettingsEnv = ensureEnv;
    (window as unknown as Record<string, unknown>).__demoEnsureSettingsSvc = ensureSvc;
    (window as unknown as Record<string, unknown>).__demoSelectEnvSvc = selectEnvSvc;
    const ctx = makeCtx();
    await ensureGqlDemoHeaderContext(ctx);
    expect(ensureEnv).toHaveBeenCalledWith('GraphQL Demo');
    expect(ensureSvc).toHaveBeenCalledWith('graphql-demo', { 'env-gql': 'http://localhost:4010' });
    expect(selectEnvSvc).toHaveBeenCalledWith('env-gql', 'svc-gql');
    expect(ctx.navigateToTab).not.toHaveBeenCalledWith('environments');
    delete (window as unknown as Record<string, unknown>).__demoEnsureSettingsEnv;
    delete (window as unknown as Record<string, unknown>).__demoEnsureSettingsSvc;
    delete (window as unknown as Record<string, unknown>).__demoSelectEnvSvc;
  });

  it('editNamedProtocolEndpoint edits the row matching the environment name', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <table>
          <tr>
            <td><span class="em-env-chip">dev</span></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit dev</button></td>
          </tr>
          <tr>
            <td><span class="em-env-chip">SSE Demo</span></td>
            <td><button data-testid="em-endpoint-edit-btn">Edit SSE Demo</button></td>
          </tr>
        </table>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
      </div>`;
    const sseEditBtn = document.querySelectorAll('[data-testid="em-endpoint-edit-btn"]')[1] as HTMLButtonElement;
    const editClick = vi.spyOn(sseEditBtn, 'click');
    const ctx = makeCtx();
    await editNamedProtocolEndpoint(ctx, 'SSE Demo', 'http://localhost:3001');
    expect(editClick).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalledWith('[data-testid="em-endpoint-edit-input"]', 'http://localhost:3001');
  });

  it('configureProtocolEndpointInEnvManager supports graphql custom path without http fallback option', async () => {
    document.body.innerHTML = `
      <button data-testid="em-svc-configure-s1">Configure</button>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-graphql">GraphQL</button>
        <button data-testid="em-endpoint-edit-btn">Edit</button>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
        <input data-testid="em-graphql-path-input" value="/graphql" />
      </div>`;
    const ctx = makeCtx();
    await configureProtocolEndpointInEnvManager(ctx, 'graphql', 'http://localhost:4010', {
      graphqlPath: '/v2/query',
    });
    expect(ctx.click).toHaveBeenCalledWith(EM.PROTOCOL_TAB_GQL);
    expect(ctx.fill).toHaveBeenCalledWith(
      `${EM.PROTOCOL_PANEL} ${EM.GRAPHQL_PATH_INPUT}`,
      '/v2/query',
    );
  });

  it('configureProtocolEndpointInEnvManager uses default graphql path when options are omitted', async () => {
    document.body.innerHTML = `
      <button data-testid="em-svc-configure-s1">Configure</button>
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-graphql">GraphQL</button>
        <button data-testid="em-endpoint-edit-btn">Edit</button>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
        <input data-testid="em-graphql-path-input" value="/legacy" />
      </div>`;
    const ctx = makeCtx();
    await configureProtocolEndpointInEnvManager(ctx, 'graphql', 'http://localhost:4010');
    expect(ctx.fill).toHaveBeenCalledWith(
      `${EM.PROTOCOL_PANEL} ${EM.GRAPHQL_PATH_INPUT}`,
      '/graphql',
    );
  });

  it('configureGraphqlEndpoint fills default path when current path differs', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-graphql">GraphQL</button>
        <button data-testid="em-endpoint-edit-btn">Edit</button>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
        <input data-testid="em-graphql-path-input" value="/old" />
      </div>`;
    const ctx = makeCtx();
    await configureGraphqlEndpoint(ctx, 'http://localhost:4010', '/graphql');
    expect(ctx.fill).toHaveBeenCalledWith(
      `${EM.PROTOCOL_PANEL} ${EM.GRAPHQL_PATH_INPUT}`,
      '/graphql',
    );
  });

  it('configureGraphqlEndpoint skips path fill when current path already matches', async () => {
    document.body.innerHTML = `
      <div data-testid="microservice-protocol-panel">
        <button data-testid="em-protocol-tab-graphql">GraphQL</button>
        <button data-testid="em-endpoint-edit-btn">Edit</button>
        <input data-testid="em-endpoint-edit-input" />
        <button data-testid="em-endpoint-save-btn">Save</button>
        <input data-testid="em-graphql-path-input" value="/graphql" />
      </div>`;
    const ctx = makeCtx();
    await configureGraphqlEndpoint(ctx, 'http://localhost:4010', '/graphql');
    const pathFillCalls = (ctx.fill as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: string[]) => c[0] === `${EM.PROTOCOL_PANEL} ${EM.GRAPHQL_PATH_INPUT}`,
    );
    expect(pathFillCalls.length).toBe(0);
  });

  it('navigateToWebSocketStudio navigates via navigateToTab when studio absent', async () => {
    const ctx = makeCtx();
    await navigateToWebSocketStudio(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('websocket-studio');
  });

  it('navigateToWebSocketStudio is no-op when studio already visible', async () => {
    const page = document.createElement('div');
    page.dataset.testid = 'ws-studio';
    mockRect(page, 100, 100);
    document.body.append(page);
    const ctx = makeCtx();
    await navigateToWebSocketStudio(ctx);
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
  });

  it('navigateToSseStudio navigates via navigateToTab when studio absent', async () => {
    const ctx = makeCtx();
    await navigateToSseStudio(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('sse-studio');
  });

  it('navigateToSseStudio is no-op when studio already visible', async () => {
    const page = document.createElement('div');
    page.dataset.testid = 'sse-studio';
    mockRect(page, 100, 100);
    document.body.append(page);
    const ctx = makeCtx();
    await navigateToSseStudio(ctx);
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
  });

  it('navigateToGraphqlStudio navigates via navigateToTab when studio absent', async () => {
    const ctx = makeCtx();
    await navigateToGraphqlStudio(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('graphql-studio');
  });

  it('navigateToGraphqlStudio is no-op when studio already visible', async () => {
    const page = document.createElement('div');
    page.dataset.testid = 'gql-studio-page';
    mockRect(page, 100, 100);
    document.body.innerHTML = '';
    document.body.append(page);
    const ctx = makeCtx();
    await navigateToGraphqlStudio(ctx);
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
  });

  it('navigateToGraphqlStudio navigates when studio exists but is hidden', async () => {
    const page = document.createElement('div');
    page.dataset.testid = 'gql-studio-page';
    page.hidden = true;
    mockRect(page, 100, 100);
    document.body.innerHTML = '';
    document.body.append(page);
    const ctx = makeCtx();
    await navigateToGraphqlStudio(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('graphql-studio');
  });

  it('navigateToGrpcStudio navigates via navigateToTab when studio absent', async () => {
    const ctx = makeCtx();
    await navigateToGrpcStudio(ctx);
    expect(ctx.navigateToTab).toHaveBeenCalledWith('grpc-studio');
  });

  it('navigateToGrpcStudio is no-op when studio already visible', async () => {
    const page = document.createElement('div');
    page.dataset.testid = 'grpc-studio-page';
    mockRect(page, 100, 100);
    document.body.innerHTML = '';
    document.body.append(page);
    const ctx = makeCtx();
    await navigateToGrpcStudio(ctx);
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
  });

  // ── ensureDemoEnvironment ────────────────────────────────────────

  it('ensureDemoEnvironment creates env when name is absent', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <input data-testid="em-new-env-input" />
      <button data-testid="em-add-env-btn" type="button"></button>`;
    const addBtn = document.querySelector<HTMLButtonElement>(EM.ADD_ENV_BTN)!;
    const clickSpy = vi.fn(() => {
      const chip = document.createElement('div');
      chip.setAttribute('data-env-name', 'WebSocket Demo');
      document.body.appendChild(chip);
    });
    addBtn.addEventListener('click', clickSpy);
    const ctx = makeCtx();
    await ensureDemoEnvironment(ctx, 'WebSocket Demo');
    const input = document.querySelector<HTMLInputElement>(EM.ADD_ENV_INPUT);
    expect(input?.value).toBe('WebSocket Demo');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('ensureDemoEnvironment is no-op when env chip already in DOM', async () => {
    document.body.innerHTML =
      '<div class="env-manager"><div data-env-name="WebSocket Demo"></div></div>';
    const ctx = makeCtx();
    await ensureDemoEnvironment(ctx, 'WebSocket Demo');
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.click).not.toHaveBeenCalledWith(EM.ADD_ENV_BTN);
  });

  it('createNamedEnvAndSvcVisible paces env + svc creation for live viewers', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <input data-testid="em-new-env-input" />
      <button data-testid="em-add-env-btn" type="button"></button>
      <input data-testid="em-new-svc-input" />
      <button data-testid="em-add-svc-btn" type="button"></button>`;
    const envBtn = document.querySelector<HTMLButtonElement>(EM.ADD_ENV_BTN)!;
    const svcBtn = document.querySelector<HTMLButtonElement>(EM.ADD_SVC_BTN)!;
    envBtn.addEventListener('click', () => {
      const chip = document.createElement('div');
      chip.setAttribute('data-env-name', 'WebSocket Demo');
      document.body.appendChild(chip);
    });
    svcBtn.addEventListener('click', () => {
      const card = document.createElement('div');
      card.setAttribute('data-svc-name', 'ws-demo');
      document.body.appendChild(card);
    });
    const ctx = makeCtx();
    await createNamedEnvAndSvcVisible(ctx, 'WebSocket Demo', 'ws-demo');
    expect(document.querySelector('[data-env-name="WebSocket Demo"]')).toBeTruthy();
    expect(document.querySelector('[data-svc-name="ws-demo"]')).toBeTruthy();
    // Typed-name hold + chip hold (≥900ms / ≥1200ms) so creation is watchable
    expect(ctx.delay.mock.calls.some(([ms]) => (ms as number) >= 1200)).toBe(true);
  });

  // ── ensureDemoMicroservice ───────────────────────────────────────

  it('ensureDemoMicroservice creates svc when name is absent', async () => {
    document.body.innerHTML = `
      <div class="env-manager"></div>
      <input data-testid="em-new-svc-input" />
      <button data-testid="em-add-svc-btn" type="button"></button>`;
    const addBtn = document.querySelector<HTMLButtonElement>(EM.ADD_SVC_BTN)!;
    const clickSpy = vi.fn(() => {
      const card = document.createElement('div');
      card.setAttribute('data-svc-name', 'ws-demo');
      document.body.appendChild(card);
    });
    addBtn.addEventListener('click', clickSpy);
    const ctx = makeCtx();
    await ensureDemoMicroservice(ctx, 'ws-demo');
    const input = document.querySelector<HTMLInputElement>(EM.ADD_SVC_INPUT);
    expect(input?.value).toBe('ws-demo');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('ensureDemoMicroservice is no-op when svc card already in DOM', async () => {
    document.body.innerHTML =
      '<div class="env-manager"><div data-svc-name="ws-demo"></div></div>';
    const ctx = makeCtx();
    await ensureDemoMicroservice(ctx, 'ws-demo');
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.click).not.toHaveBeenCalledWith(EM.ADD_SVC_BTN);
  });

  // ── expandNamedMicroservice ──────────────────────────────────────

  it('expandNamedMicroservice clicks the Configure button inside the named card', async () => {
    document.body.innerHTML = `
      <div class="env-manager">
        <div data-svc-name="ws-demo">
          <button data-testid="em-svc-configure-abc">Configure</button>
        </div>
      </div>`;
    const ctx = makeCtx();
    await expandNamedMicroservice(ctx, 'ws-demo');
    expect(ctx.waitFor).toHaveBeenCalledWith(EM.PROTOCOL_PANEL);
  });

  it('expandNamedMicroservice is no-op when the named card is already expanded', async () => {
    const manager = document.createElement('div');
    manager.className = 'env-manager';
    mockRect(manager, 100, 100);
    const svcCard = document.createElement('div');
    svcCard.dataset.svcName = 'ws-demo';
    const configBtn = document.createElement('button');
    configBtn.dataset.testid = 'em-svc-configure-abc';
    configBtn.textContent = 'Collapse';
    const panel = document.createElement('div');
    panel.dataset.testid = 'microservice-protocol-panel';
    svcCard.append(configBtn, panel);
    document.body.append(manager, svcCard);
    const ctx = makeCtx();
    await expandNamedMicroservice(ctx, 'ws-demo');
    expect(ctx.waitFor).not.toHaveBeenCalled();
  });

  it('expandNamedMicroservice falls back to first svc when named card not found', async () => {
    document.body.innerHTML =
      '<button data-testid="em-svc-configure-xyz">Configure</button>';
    const ctx = makeCtx();
    await expandNamedMicroservice(ctx, 'nonexistent-svc');
    // Falls through to expandFirstMicroservice
    expect(ctx.click).toHaveBeenCalledWith(EM.SVC_CONFIGURE);
    expect(ctx.waitFor).toHaveBeenCalledWith(EM.PROTOCOL_PANEL);
  });

  // ── cleanupDemoMicroservice ──────────────────────────────────────

  it('cleanupDemoMicroservice uses settings bridge when available (no EM navigation)', async () => {
    const remove = vi.fn();
    (window as unknown as Record<string, unknown>).__demoRemoveSettingsSvc = remove;
    const ctx = makeCtx();
    await cleanupDemoMicroservice(ctx, 'sse-demo');
    expect(remove).toHaveBeenCalledWith('sse-demo');
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsSvc;
  });

  it('cleanupDemoMicroservice is no-op when svc not in DOM', async () => {
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsSvc;
    document.body.innerHTML = '<div class="env-manager"></div>';
    const ctx = makeCtx();
    await cleanupDemoMicroservice(ctx, 'sse-demo');
    const clickCalls = (ctx.click as ReturnType<typeof vi.fn>).mock.calls;
    const dangerClicks = clickCalls.filter((c: string[]) => c[0]?.includes('btn-danger'));
    expect(dangerClicks.length).toBe(0);
  });

  it('cleanupDemoMicroservice clicks Delete and confirms when svc card is present', async () => {
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsSvc;
    document.body.innerHTML = `
      <div class="env-manager">
        <div data-svc-name="sse-demo">
          <button data-testid="em-svc-configure-svc1" class="btn btn-xs">Configure</button>
          <button class="btn btn-xs btn-danger">Delete</button>
        </div>
        <div class="confirm-dialog"><button class="btn-danger">Delete Permanently</button></div>
      </div>`;
    const deleteBtn = document.querySelector<HTMLElement>('[data-svc-name="sse-demo"] .btn-danger')!;
    const clickSpy = vi.spyOn(deleteBtn, 'click');
    const ctx = makeCtx();
    await cleanupDemoMicroservice(ctx, 'sse-demo');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('cleanupDemoMicroservice collapses expanded panel before deleting', async () => {
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsSvc;
    document.body.innerHTML = `
      <div class="env-manager">
        <div data-svc-name="sse-demo">
          <button data-testid="em-svc-configure-svc1" class="btn btn-xs">Collapse</button>
          <button class="btn btn-xs btn-danger">Delete</button>
        </div>
      </div>`;
    const collapseBtn = document.querySelector<HTMLElement>('[data-testid="em-svc-configure-svc1"]')!;
    const collapseSpy = vi.spyOn(collapseBtn, 'click');
    const ctx = makeCtx();
    await cleanupDemoMicroservice(ctx, 'sse-demo');
    expect(collapseSpy).toHaveBeenCalled();
  });

  // ── cleanupDemoEnvironment ───────────────────────────────────────

  it('cleanupDemoEnvironment uses settings bridge when available (no EM navigation)', async () => {
    const remove = vi.fn();
    (window as unknown as Record<string, unknown>).__demoRemoveSettingsEnv = remove;
    const ctx = makeCtx();
    await cleanupDemoEnvironment(ctx, 'SSE Demo');
    expect(remove).toHaveBeenCalledWith('SSE Demo');
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsEnv;
  });

  it('cleanupDemoEnvironment is no-op when env chip not in DOM', async () => {
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsEnv;
    document.body.innerHTML = '<div class="env-manager"></div>';
    const ctx = makeCtx();
    await cleanupDemoEnvironment(ctx, 'SSE Demo');
    const clickCalls = (ctx.click as ReturnType<typeof vi.fn>).mock.calls;
    const chipDeleteClicks = clickCalls.filter((c: string[]) => c[0]?.includes('settings-chip-delete'));
    expect(chipDeleteClicks.length).toBe(0);
  });

  it('cleanupDemoEnvironment clicks × and confirms when chip is present', async () => {
    delete (window as unknown as Record<string, unknown>).__demoRemoveSettingsEnv;
    document.body.innerHTML = `
      <div class="env-manager">
        <div data-env-name="SSE Demo" class="settings-chip">
          <button class="settings-chip-delete">×</button>
        </div>
        <div class="confirm-dialog"><button class="btn-danger">Delete Permanently</button></div>
      </div>`;
    const chipDeleteBtn = document.querySelector<HTMLElement>('[data-env-name="SSE Demo"] .settings-chip-delete')!;
    const clickSpy = vi.spyOn(chipDeleteBtn, 'click');
    const ctx = makeCtx();
    await cleanupDemoEnvironment(ctx, 'SSE Demo');
    expect(clickSpy).toHaveBeenCalled();
  });

  // ── cleanupGqlDemoLessonEnvironment ──────────────────────────────

  it('cleanupGqlDemoLessonEnvironment deletes studio Demo env via bridge', async () => {
    const purgeBridge = vi.fn(async () => {});
    (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments = purgeBridge;
    const ctx = makeCtx();
    await cleanupGqlDemoLessonEnvironment(ctx);
    expect(purgeBridge).toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).__demoPurgeGqlLessonEnvironments;
  });

  it('cleanupGqlDemoLessonEnvironment falls back to storage purge when bridge absent', async () => {
    const ctx = makeCtx();
    await cleanupGqlDemoLessonEnvironment(ctx);
    expect(ctx.navigateToTab).not.toHaveBeenCalled();
  });

  // ── Visible header selects (live demo pacing) ───────────────────

  it('selectEnvInHeaderVisible selects native option even when already chosen', async () => {
    document.body.innerHTML = `
      <select data-testid="header-env-select">
        <option value="e1" selected>GraphQL Demo</option>
        <option value="e2">Other</option>
      </select>`;
    const ctx = makeCtx();
    await selectEnvInHeaderVisible(ctx, 'GraphQL Demo');
    expect(ctx.selectOption).toHaveBeenCalledWith(APP.HEADER_ENV_SELECT, 'e1');
  });

  it('selectSvcInHeaderVisible opens CustomSelect menu and picks the option', async () => {
    document.body.innerHTML = `
      <div data-testid="header-svc-select">
        <button type="button" class="cs-trigger"><span class="cs-text">other</span></button>
      </div>`;
    const wrap = document.querySelector('[data-testid="header-svc-select"]')!;
    const trigger = wrap.querySelector<HTMLElement>('.cs-trigger')!;
    const itemClick = vi.fn();
    trigger.addEventListener('click', () => {
      if (document.querySelector('.cs-menu')) return;
      const menu = document.createElement('div');
      menu.className = 'cs-menu';
      const item = document.createElement('div');
      item.className = 'cs-item';
      item.textContent = 'graphql-demo';
      item.addEventListener('click', itemClick);
      menu.appendChild(item);
      document.body.appendChild(menu);
    });
    const ctx = makeCtx();
    (ctx.click as ReturnType<typeof vi.fn>).mockImplementation(async (sel: string) => {
      document.querySelector<HTMLElement>(sel)?.click();
    });
    (ctx.waitFor as ReturnType<typeof vi.fn>).mockImplementation(async (sel: string) => {
      if (!document.querySelector(sel)) throw new Error(`missing ${sel}`);
    });
    await selectSvcInHeaderVisible(ctx, 'graphql-demo');
    expect(ctx.click).toHaveBeenCalledWith(`${APP.HEADER_SVC_SELECT} .cs-trigger`);
    expect(itemClick).toHaveBeenCalled();
  });
});
