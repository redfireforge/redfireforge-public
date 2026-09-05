/**
 * REQ-3 v2: Multi-Environment Requests
 *
 * 7 steps: create Settings environments → create manual ENV collection (spotlight the
 * Linked Microservice dropdown) → add request + resolved URL → switch env + send →
 * create a Linked Microservice ENV collection → send from it → manual-vs-linked summary.
 * Follows Lesson 1 guidelines: one spotlight at a time, pause before each beat,
 * no reading/action overlap noise, expand sidebar to show created request, hard cleanup.
 * Public API: DummyJSON
 */
import type { DemoLesson, DemoActionContext } from '../../types';
import { APP, EM, REQ, emEnvByNameSel, emSvcByNameSel, emSvcConfigureByNameSel, emAddProtocolItemSel } from '@shared/selectors';
import { fillControlledInput } from '../setup-helpers';
import { STEP_REQ3_CREATE_DESC, STEP_REQ3_LINKED_SVC_DESC, reqMultiEnvConcept } from './req-multi-env.content';
import {
  spotlight,
  spotlightEl,
  spotlightElNoScroll,
  firstVisible,
  findRequestVisibleInCollection,
  openContextMenuForElement,
  clickContextItemVisible,
  spotlightContextItem,
} from './req-multi-env.ui';
import {
  ensureRequestsTab,
  dismissContextMenu,
  shrinkAllCollections,
  ensureCollectionExpanded,
  selectRequestByName,
  closeExtraRequestTabs,
  fillNewRequestPrompt,
  cleanupOtherRequestDemoCollections,
} from './req-demo-helpers';
import {
  ensureSettingsEnvironment,
  removeSettingsEnvironment,
  ensureSettingsMicroservice,
  removeSettingsMicroservice,
} from '../../adapters';

const COLLECTION_NAME = 'DummyJSON';
const REQUEST_NAME = 'Search Laptops';
const ENV_PROD = 'production';
const ENV_STAGING = 'staging';
const BASE_URL_PROD = 'https://dummyjson.com';
const BASE_URL_STAGING = 'https://dummyjson.com';
const REQUEST_PATH = '/products/search?q=laptop&limit=3';

const LINKED_COLLECTION_NAME = 'Product Service';
const LINKED_SVC_NAME = 'product-api';
const LINKED_REQUEST_NAME = 'Get Products';
const LINKED_REQUEST_PATH = '/products?limit=5';

async function deleteCollectionByName(ctx: DemoActionContext, collectionName: string): Promise<void> {
  ensureRequestsTab(ctx);
  await ctx.delay(40);
  let guard = 0;
  while (document.querySelector(REQ.colByName(collectionName)) && guard < 4) {
    const col = firstVisible(REQ.colByName(collectionName));
    if (!col) break;
    col.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const opened = await openContextMenuForElement(ctx, col);
    if (!opened) break;
    const clicked = await clickContextItemVisible(ctx, 'Delete Collection');
    if (!clicked) {
      dismissContextMenu();
      break;
    }
    const confirmBtn = document.querySelector<HTMLElement>('.req-confirm-dialog .req-confirm-ok');
    if (confirmBtn) {
      confirmBtn.click();
      await ctx.delay(120);
    }
    guard += 1;
  }
}

async function cleanupLessonCollections(ctx: DemoActionContext): Promise<void> {
  await deleteCollectionByName(ctx, COLLECTION_NAME);
  await deleteCollectionByName(ctx, LINKED_COLLECTION_NAME);
  // Remove demo collections left behind by any other lesson (keep our own two,
  // which this lesson recreates itself).
  await cleanupOtherRequestDemoCollections(ctx, [COLLECTION_NAME, LINKED_COLLECTION_NAME]);
}

async function closeOpenOverlays(ctx: DemoActionContext): Promise<void> {
  dismissContextMenu();
  const modalClose = document.querySelector<HTMLElement>('.req-col-modal .btn-secondary')
    ?? document.querySelector<HTMLElement>('.req-col-modal .btn-ghost');
  if (modalClose) {
    modalClose.click();
    await ctx.delay(60);
  }
  if (document.querySelector(REQ.HISTORY_DROPDOWN)) {
    document.querySelector<HTMLElement>(REQ.HISTORY_TRIGGER)?.click();
    await ctx.delay(40);
  }
}

/**
 * Base URL rows are keyed by env id and ordered by existing RequestEnvs
 * (e.g. dev, test first). Never use baseInputs[0]/[1] — fill by env name label.
 */
function findBaseUrlInputByEnvName(envName: string): HTMLInputElement | null {
  const rows = document.querySelectorAll<HTMLElement>('.req-base-url-row');
  for (const row of rows) {
    const label = row.querySelector('.req-env-label')?.textContent?.trim().toLowerCase();
    if (label === envName.toLowerCase()) {
      return row.querySelector<HTMLInputElement>(REQ.BASE_URL_INPUT);
    }
  }
  return null;
}

async function waitForBaseUrlInputByEnvName(
  ctx: DemoActionContext,
  envName: string,
  attempts = 24,
): Promise<HTMLInputElement | null> {
  for (let i = 0; i < attempts; i += 1) {
    const input = findBaseUrlInputByEnvName(envName);
    if (input) return input;
    await ctx.delay(50);
  }
  return null;
}

async function ensureEnvWithBaseUrl(
  ctx: DemoActionContext,
  envName: string,
  baseUrl: string,
  options?: { visible?: boolean },
): Promise<void> {
  const visible = options?.visible ?? false;
  let input = findBaseUrlInputByEnvName(envName);
  if (!input) {
    // Wait briefly — React may need a tick to render the row after env creation.
    input = await waitForBaseUrlInputByEnvName(ctx, envName);
  }
  if (!input) return;
  fillControlledInput(input, baseUrl);
  if (visible) await spotlightElNoScroll(ctx, input, 900);
  else await ctx.delay(80);
}

async function createSettingsEnvironmentVisible(
  ctx: DemoActionContext,
  envName: string,
): Promise<void> {
  await ctx.waitFor(EM.ADD_ENV_INPUT, 2200);
  const existing = document.querySelector<HTMLElement>(emEnvByNameSel(envName));
  if (existing) {
    existing.click();
    await spotlightEl(ctx, existing, 1000);
    return;
  }

  const envInput = document.querySelector<HTMLInputElement>(EM.ADD_ENV_INPUT);
  if (!envInput) return;
  await spotlight(ctx, EM.ADD_ENV_INPUT, 900);
  envInput.focus();
  await ctx.delay(180);
  fillControlledInput(envInput, envName);
  await ctx.delay(420);
  await spotlight(ctx, EM.ADD_ENV_BTN, 750);
  await ctx.click(EM.ADD_ENV_BTN);
  await ctx.waitFor(emEnvByNameSel(envName), 2200);
  const row = document.querySelector<HTMLElement>(emEnvByNameSel(envName));
  if (row) {
    row.click();
    await spotlightEl(ctx, row, 1050);
  }
}

async function openCollectionModalForCreate(ctx: DemoActionContext): Promise<boolean> {
  await ctx.click(REQ.SIDEBAR_ADD_BTN);
  await ctx.waitFor(REQ.ADD_ENV_COLLECTION, 1500);
  await ctx.click(REQ.ADD_ENV_COLLECTION);
  await ctx.waitFor(REQ.COLLECTION_MODAL, 2000);
  return !!document.querySelector(REQ.COLLECTION_MODAL);
}

async function openCollectionModalForEdit(ctx: DemoActionContext): Promise<boolean> {
  const col = firstVisible(REQ.colByName(COLLECTION_NAME));
  if (!col) return false;
  const opened = await openContextMenuForElement(ctx, col);
  if (!opened) return false;
  await clickContextItemVisible(ctx, 'Edit Collection');
  await ctx.waitFor(REQ.COLLECTION_MODAL, 2000);
  return !!document.querySelector(REQ.COLLECTION_MODAL);
}

async function saveCollectionModal(ctx: DemoActionContext): Promise<void> {
  document.querySelector<HTMLButtonElement>('.req-col-modal .btn-primary')?.click();
  await ctx.delay(300);
}

async function closeCollectionModalIfOpen(ctx: DemoActionContext): Promise<void> {
  const modalClose = document.querySelector<HTMLElement>('.req-col-modal .btn-secondary')
    ?? document.querySelector<HTMLElement>('.req-col-modal .btn-ghost');
  if (modalClose) {
    modalClose.click();
    await ctx.delay(60);
  }
}

function envBaseUrlLooksCorrect(envName: string, expectedUrl: string): boolean {
  const input = findBaseUrlInputByEnvName(envName);
  return !!input && input.value.trim() === expectedUrl;
}

/**
 * Quietly ensure DummyJSON exists with production + staging base URLs filled
 * on the correct env rows (not the first workspace envs like dev/test).
 */
async function ensureMultiEnvCollection(ctx: DemoActionContext): Promise<void> {
  // Guarantee the envs exist in Settings before touching the collection modal.
  ensureSettingsEnvironment(ENV_PROD);
  ensureSettingsEnvironment(ENV_STAGING);
  await ctx.delay(60);

  if (document.querySelector(REQ.colByName(COLLECTION_NAME))) {
    const opened = await openCollectionModalForEdit(ctx);
    if (!opened) return;
    const ok =
      envBaseUrlLooksCorrect(ENV_PROD, BASE_URL_PROD)
      && envBaseUrlLooksCorrect(ENV_STAGING, BASE_URL_STAGING);
    if (ok) {
      await closeCollectionModalIfOpen(ctx);
      return;
    }
    await ensureEnvWithBaseUrl(ctx, ENV_PROD, BASE_URL_PROD, { visible: false });
    await ensureEnvWithBaseUrl(ctx, ENV_STAGING, BASE_URL_STAGING, { visible: false });
    await saveCollectionModal(ctx);
    return;
  }

  const opened = await openCollectionModalForCreate(ctx);
  if (!opened) return;

  const nameInput = document.querySelector<HTMLInputElement>('.req-col-modal .req-input');
  if (nameInput) {
    nameInput.focus();
    fillControlledInput(nameInput, COLLECTION_NAME);
  }

  await ensureEnvWithBaseUrl(ctx, ENV_PROD, BASE_URL_PROD, { visible: false });
  await ensureEnvWithBaseUrl(ctx, ENV_STAGING, BASE_URL_STAGING, { visible: false });
  await saveCollectionModal(ctx);
}

/**
 * If staging/production pills resolve without a DummyJSON host, open Edit and repair.
 * Avoids opening the modal on every step when config is already correct.
 */
async function repairBaseUrlsIfNeeded(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(REQ.colByName(COLLECTION_NAME))) {
    await ensureMultiEnvCollection(ctx);
    return;
  }
  const staging = firstVisible(REQ.envPillByName(ENV_STAGING));
  const prod = firstVisible(REQ.envPillByName(ENV_PROD));
  if (!staging || !prod) {
    await ensureMultiEnvCollection(ctx);
    return;
  }
  staging.click();
  await ctx.delay(100);
  const resolved = (document.querySelector(REQ.RESOLVED_URL)?.textContent || '').trim();
  const ok = resolved.startsWith(BASE_URL_STAGING) || resolved.includes('dummyjson.com/');
  if (!ok) await ensureMultiEnvCollection(ctx);
}

async function ensureRequestReady(ctx: DemoActionContext): Promise<void> {
  await repairBaseUrlsIfNeeded(ctx);
  await ensureCollectionExpanded(ctx, COLLECTION_NAME);
  const existingReq = findRequestVisibleInCollection(COLLECTION_NAME, REQUEST_NAME);
  if (existingReq) {
    await selectRequestByName(ctx, REQUEST_NAME, COLLECTION_NAME);
    const urlInput = document.querySelector<HTMLInputElement>(REQ.URL_INPUT);
    if (urlInput && urlInput.value !== REQUEST_PATH) {
      fillControlledInput(urlInput, REQUEST_PATH);
    }
    return;
  }

  const col = firstVisible(REQ.colByName(COLLECTION_NAME));
  if (!col) return;
  const opened = await openContextMenuForElement(ctx, col);
  if (!opened) return;
  await clickContextItemVisible(ctx, 'Add Request');
  await fillNewRequestPrompt(ctx, REQUEST_NAME);
  await ctx.waitFor(REQ.URL_INPUT, 2200);

  const urlInput = document.querySelector<HTMLInputElement>(REQ.URL_INPUT);
  if (urlInput) fillControlledInput(urlInput, REQUEST_PATH);
}

export const reqMultiEnvLesson: DemoLesson = {
  id: 'req-multi-env',
  domainId: 'api',
  category: 'requests',
  name: 'Multi-Environment Requests',
  description:
    'Create production and staging environments in Settings, build an ENV collection with manual base URLs, ' +
    'then create a Linked Microservice collection that pulls URLs automatically from Settings.',
  estimatedMinutes: 6,
  initialTab: 'requests',
  allowedTabs: ['requests', 'environments'],

  concept: reqMultiEnvConcept,

  setup: async (ctx) => {
    ctx.navigateToTab('requests');
    await ctx.delay(80);
    await closeExtraRequestTabs(ctx);
    await closeOpenOverlays(ctx);
    await cleanupLessonCollections(ctx);
    await shrinkAllCollections();
    const sidebar = document.querySelector<HTMLElement>(REQ.SIDEBAR);
    if (sidebar) sidebar.scrollTop = 0;
  },

  cleanup: async (ctx) => {
    await closeOpenOverlays(ctx);
    await closeExtraRequestTabs(ctx);
    await cleanupLessonCollections(ctx);
    removeSettingsMicroservice(LINKED_SVC_NAME);
    removeSettingsEnvironment(ENV_PROD);
    removeSettingsEnvironment(ENV_STAGING);
    ctx.navigateToTab('requests');
    await ctx.delay(60);
  },

  steps: [
    {
      id: 'req3-settings-envs',
      title: 'Create Environments in Settings',
      description:
        'Open **Settings**, add the **production** environment, then add **staging**. ' +
        'Pause on each new environment row so viewers can confirm both exist before returning to Requests.',
      // No step-level highlight: the action spotlights Settings when it starts, and
      // this step ends back on the Requests tab — a lingering ring on Settings would
      // be misplaced during the reading/done phases.
      preAction: async (ctx) => {
        await closeOpenOverlays(ctx);
        await cleanupLessonCollections(ctx);
        removeSettingsEnvironment(ENV_PROD);
        removeSettingsEnvironment(ENV_STAGING);
        ensureRequestsTab(ctx);
      },
      action: async (ctx) => {
        await spotlight(ctx, APP.AB_SETTINGS, 1200);
        ctx.navigateToTab('environments');
        await ctx.delay(700);
        await ctx.waitFor(EM.ADD_ENV_INPUT, 2200);

        await createSettingsEnvironmentVisible(ctx, ENV_PROD);
        await createSettingsEnvironmentVisible(ctx, ENV_STAGING);

        ctx.navigateToTab('requests');
        await ctx.delay(700);
        await shrinkAllCollections();
      },
    },

    // ── Step 1: Create Multi-Env Collection ──
    {
      id: 'req3-create',
      title: 'Create Multi-Env Collection',
      description: STEP_REQ3_CREATE_DESC,
      highlight: REQ.SIDEBAR_ADD_BTN,
      preAction: async (ctx) => {
        ensureRequestsTab(ctx);
        await closeOpenOverlays(ctx);
        ensureSettingsEnvironment(ENV_PROD);
        ensureSettingsEnvironment(ENV_STAGING);
        if (document.querySelector(REQ.colByName(COLLECTION_NAME))) return;
        await shrinkAllCollections();
      },
      action: async (ctx) => {
        if (document.querySelector(REQ.colByName(COLLECTION_NAME))) {
          // Repair prior bad runs (URLs written onto dev/test instead of production/staging).
          await ensureMultiEnvCollection(ctx);
          await spotlight(ctx, REQ.colByName(COLLECTION_NAME), 900);
          return;
        }

        // Reading already highlights + — click once, then pause on dropdown.
        await ctx.click(REQ.SIDEBAR_ADD_BTN);
        await ctx.waitFor(REQ.ADD_DROPDOWN, 1500);
        await ctx.delay(400);

        await spotlight(ctx, REQ.ADD_ENV_COLLECTION, 1000);
        await ctx.click(REQ.ADD_ENV_COLLECTION);
        await ctx.waitFor(REQ.COLLECTION_MODAL, 2000);
        await ctx.delay(280);

        const nameInput = document.querySelector<HTMLInputElement>('.req-col-modal .req-input');
        if (nameInput) {
          await spotlightElNoScroll(ctx, nameInput, 900);
          nameInput.focus();
          fillControlledInput(nameInput, COLLECTION_NAME);
          await ctx.delay(300);
        }

        // Linked Microservice — one of the most important beats. Open the dropdown so the
        // viewer sees BOTH modes (None (manual config) + any microservices), then dwell on
        // "None (manual config)" a little longer before re-selecting it (keeps manual mode).
        const svcSelectRoot = firstVisible(REQ.SVC_SELECT);
        if (svcSelectRoot) {
          await spotlightElNoScroll(ctx, svcSelectRoot, 900);
          const trigger = svcSelectRoot.querySelector<HTMLButtonElement>('.wf-dark-select__trigger');
          if (trigger) {
            trigger.click();
            await ctx.waitFor('.wf-dark-select__menu', 1500);
            await ctx.delay(400);
            // Show the full option list first so viewers see manual vs linked choices.
            const menu = firstVisible('.wf-dark-select__menu');
            if (menu) await spotlightElNoScroll(ctx, menu, 1700);
            // Then dwell longer on the important default: None (manual config).
            const noneOption = Array.from(
              document.querySelectorAll<HTMLButtonElement>('.wf-dark-select__menu [role="option"]'),
            ).find(o => /none \(manual config\)/i.test((o.textContent || '').trim()));
            if (noneOption) {
              await spotlightElNoScroll(ctx, noneOption, 2000);
              noneOption.click(); // re-selects None (no-op change) and closes the menu
              await ctx.delay(450);
            } else {
              trigger.click(); // fallback: close without changing selection
              await ctx.delay(200);
            }
          }
          await spotlightElNoScroll(ctx, svcSelectRoot, 900);
        }

        const baseMap = firstVisible(REQ.BASE_URL_MAP);
        if (baseMap) await spotlightEl(ctx, baseMap, 1000);

        // Fill by env NAME — workspace may already have dev/test rows before these.
        await ensureEnvWithBaseUrl(ctx, ENV_PROD, BASE_URL_PROD, { visible: true });
        await ensureEnvWithBaseUrl(ctx, ENV_STAGING, BASE_URL_STAGING, { visible: true });

        const formGroups = document.querySelectorAll<HTMLElement>('.req-col-modal .req-form-group');
        const authGroup = Array.from(formGroups).find(g =>
          g.querySelector('label')?.textContent?.includes('Default Auth')
        );
        if (authGroup) await spotlightEl(ctx, authGroup, 1000);

        await saveCollectionModal(ctx);
        await spotlight(ctx, REQ.colByName(COLLECTION_NAME), 1100);
      },
    },

    // ── Step 2: Add Request & Resolved URL ──
    {
      id: 'req3-request',
      title: 'Add Request & See Resolved URL',
      description:
        'Right-click the collection and choose **Add Request** — it opens in its own **tab**. ' +
        'Rename it **"Search Laptops"**, enter the relative path `/products/search?q=laptop&limit=3`, ' +
        'then read the **Resolved URL** and the **production / staging** env pills.',
      // No reading highlight on DummyJSON — Step 1 already showed it.
      preAction: async (ctx) => {
        ensureRequestsTab(ctx);
        await closeOpenOverlays(ctx);
        if (!document.querySelector(REQ.colByName(COLLECTION_NAME))) {
          await ensureMultiEnvCollection(ctx);
        }
      },
      action: async (ctx) => {
        const existing = findRequestVisibleInCollection(COLLECTION_NAME, REQUEST_NAME);
        if (!existing) {
          const col = firstVisible(REQ.colByName(COLLECTION_NAME));
          if (!col) return;
          const opened = await openContextMenuForElement(ctx, col);
          if (!opened) return;
          // Highlight only the menu action we take — not the whole menu then the item.
          await spotlightContextItem(ctx, 'Add Request', 1100);
          await clickContextItemVisible(ctx, 'Add Request');
          await ctx.delay(300);
          const prompt = document.querySelector<HTMLElement>('[data-testid="req-new-request-prompt"]');
          if (prompt) await spotlightElNoScroll(ctx, prompt, 900);
          await fillNewRequestPrompt(ctx, REQUEST_NAME);
          await ctx.waitFor(REQ.URL_INPUT, 2200);
          await ctx.delay(240);
        } else {
          existing.click();
          await ctx.delay(120);
        }

        const urlInput = firstVisible(REQ.URL_INPUT) as HTMLInputElement | null;
        if (urlInput) {
          await spotlightElNoScroll(ctx, urlInput, 800);
          if (urlInput.value !== REQUEST_PATH) {
            urlInput.focus();
            fillControlledInput(urlInput, REQUEST_PATH);
            await ctx.delay(300);
          }
          await spotlightElNoScroll(ctx, urlInput, 900);
        }

        await spotlight(ctx, REQ.RESOLVED_URL, 1200);
        await spotlight(ctx, REQ.ENV_BAR, 1100);

        // Leave production selected (workspace may also show dev/test with empty hosts).
        const prodPill = firstVisible(REQ.envPillByName(ENV_PROD));
        if (prodPill) {
          prodPill.click();
          await ctx.delay(160);
          await spotlight(ctx, REQ.RESOLVED_URL, 900);
        }

        // Expand sidebar so the created request is visible (no collection ring).
        await selectRequestByName(ctx, REQUEST_NAME, COLLECTION_NAME);
        const createdReq = findRequestVisibleInCollection(COLLECTION_NAME, REQUEST_NAME);
        if (createdReq) await spotlightElNoScroll(ctx, createdReq, 1000);
      },
    },

    // ── Step 3: Switch Environments & Send ──
    {
      id: 'req3-switch',
      title: 'Switch Environments & Send',
      description:
        'Click the **staging** pill and watch the **Resolved URL** update. Switch back to **production**, ' +
        'then **Send**. Review status, time, size, and the JSON response.',
      highlight: REQ.envPillByName(ENV_STAGING),
      preAction: async (ctx) => {
        ensureRequestsTab(ctx);
        await closeOpenOverlays(ctx);
        await ensureRequestReady(ctx);
        await ctx.waitFor(REQ.ENV_BAR, 2000);
      },
      action: async (ctx) => {
        // Reading already highlights staging — click once, then show resolved URL.
        const stagingPill = firstVisible(REQ.envPillByName(ENV_STAGING));
        if (stagingPill) {
          stagingPill.click();
          await ctx.delay(350);
          await spotlight(ctx, REQ.RESOLVED_URL, 1200);
        }

        const prodPill = firstVisible(REQ.envPillByName(ENV_PROD));
        if (prodPill) {
          await spotlightElNoScroll(ctx, prodPill, 1000);
          prodPill.click();
          await ctx.delay(350);
          await spotlight(ctx, REQ.RESOLVED_URL, 1100);
        }

        await spotlight(ctx, REQ.SEND_BTN, 1000);
        await ctx.click(REQ.SEND_BTN);
        await ctx.waitFor(REQ.STATUS_PILL, 5000);

        await spotlight(ctx, REQ.STATUS_PILL, 1100);
        await spotlight(ctx, REQ.RESPONSE_TIME, 900);
        await spotlight(ctx, REQ.RESPONSE_SIZE, 900);

        const json = firstVisible(REQ.JSON_PREVIEW);
        if (json) await spotlightEl(ctx, json, 1100);

        // Keep the request selected at the end of the step so the editor does not
        // transition through an empty state before the summary step starts.
        await selectRequestByName(ctx, REQUEST_NAME, COLLECTION_NAME);
      },
    },

    // ── Step 4: Create Linked Microservice Collection ──
    {
      id: 'req3-linked-svc',
      title: 'Linked Microservice Collection',
      description: STEP_REQ3_LINKED_SVC_DESC,
      highlight: REQ.SIDEBAR_ADD_BTN,
      preAction: async (ctx) => {
        ensureRequestsTab(ctx);
        await closeOpenOverlays(ctx);
        // Ensure the first scenario is complete
        ensureSettingsEnvironment(ENV_PROD);
        ensureSettingsEnvironment(ENV_STAGING);
        if (!document.querySelector(REQ.colByName(COLLECTION_NAME))) {
          await ensureMultiEnvCollection(ctx);
        }
        // Clean up linked collection if it already exists (restart)
        if (document.querySelector(REQ.colByName(LINKED_COLLECTION_NAME))) {
          await deleteCollectionByName(ctx, LINKED_COLLECTION_NAME);
        }
        removeSettingsMicroservice(LINKED_SVC_NAME);
      },
      action: async (ctx) => {
        // 1. Navigate to Settings → create microservice
        await spotlight(ctx, APP.AB_SETTINGS, 1200);
        ctx.navigateToTab('environments');
        await ctx.delay(700);
        await ctx.waitFor(EM.ADD_SVC_INPUT, 2200);

        // Create the microservice
        if (!document.querySelector(emSvcByNameSel(LINKED_SVC_NAME))) {
          const svcInput = document.querySelector<HTMLInputElement>(EM.ADD_SVC_INPUT);
          if (svcInput) {
            await spotlight(ctx, EM.ADD_SVC_INPUT, 900);
            svcInput.focus();
            fillControlledInput(svcInput, LINKED_SVC_NAME);
            await ctx.delay(420);
            await spotlight(ctx, EM.ADD_SVC_BTN, 750);
            await ctx.click(EM.ADD_SVC_BTN);
            await ctx.waitFor(emSvcByNameSel(LINKED_SVC_NAME), 2200);
            await ctx.delay(400);
          }
        }

        // Highlight the created microservice
        const svcRow = document.querySelector<HTMLElement>(emSvcByNameSel(LINKED_SVC_NAME));
        if (svcRow) await spotlightEl(ctx, svcRow, 1200);

        // 2. Click "Configure" to expand the microservice card
        const configureBtn = document.querySelector<HTMLButtonElement>(emSvcConfigureByNameSel(LINKED_SVC_NAME));
        if (configureBtn?.textContent?.includes('Configure')) {
          await spotlight(ctx, emSvcConfigureByNameSel(LINKED_SVC_NAME), 1000);
          await ctx.click(emSvcConfigureByNameSel(LINKED_SVC_NAME));
          await ctx.delay(850);
        }

        // 3. Add HTTP protocol
        await ctx.waitFor(EM.PROTOCOL_PANEL, 2200);
        if (!document.querySelector(EM.PROTOCOL_TAB_HTTP)) {
          await ctx.waitFor(EM.ADD_PROTOCOL_BTN, 2200);
          await spotlight(ctx, EM.ADD_PROTOCOL_BTN, 1000);
          await ctx.click(EM.ADD_PROTOCOL_BTN);
          await ctx.delay(600);
          await ctx.waitFor(emAddProtocolItemSel('http'), 2200);
          await spotlight(ctx, emAddProtocolItemSel('http'), 900);
          await ctx.click(emAddProtocolItemSel('http'));
          await ctx.delay(900);
        }

        // Ensure HTTP tab is active
        await ctx.waitFor(EM.PROTOCOL_TAB_HTTP, 2200);
        await ctx.click(EM.PROTOCOL_TAB_HTTP);
        await ctx.delay(600);
        await spotlight(ctx, EM.PROTOCOL_TAB_HTTP, 900);

        // 4. Enable deploy checkboxes + set base URLs for production and staging
        const svcSel = emSvcByNameSel(LINKED_SVC_NAME);
        for (const { envName, baseUrl } of [
          { envName: ENV_PROD, baseUrl: BASE_URL_PROD },
          { envName: ENV_STAGING, baseUrl: BASE_URL_STAGING },
        ]) {
          const envChip = document.querySelector<HTMLElement>(
            `${svcSel} .svc-env-table [data-env-name="${envName}"]`,
          );
          const row = envChip?.closest('tr');
          if (!row) continue;

          // Enable deploy checkbox if not checked
          const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (checkbox && !checkbox.checked) {
            await spotlightElNoScroll(ctx, checkbox, 800);
            checkbox.click();
            await ctx.delay(600);
          }

          // Check if base URL already set
          const urlText = row.querySelector<HTMLElement>('.em-url-text')?.textContent ?? '';
          if (urlText.includes(baseUrl)) continue;

          // Click Edit → fill → Save
          const editBtn = row.querySelector<HTMLButtonElement>('[data-testid="em-endpoint-edit-btn"]');
          if (editBtn) {
            await spotlightElNoScroll(ctx, editBtn, 800);
            editBtn.click();
            await ctx.delay(500);
          }
          const editInput = document.querySelector<HTMLInputElement>(EM.ENDPOINT_EDIT_INPUT);
          if (editInput) {
            fillControlledInput(editInput, baseUrl);
            await spotlightElNoScroll(ctx, editInput, 1000);
          }
          const saveBtn = document.querySelector<HTMLButtonElement>(EM.ENDPOINT_SAVE);
          if (saveBtn) {
            saveBtn.click();
            await ctx.delay(700);
          }
        }

        // Pause on the configured table
        const envTable = document.querySelector<HTMLElement>(`${svcSel} .svc-env-table`);
        if (envTable) await spotlightEl(ctx, envTable, 1500);

        // 5. Navigate back to Requests → create linked collection
        ctx.navigateToTab('requests');
        await ctx.delay(700);
        await shrinkAllCollections();

        // Open + Add → ENV Collection
        await ctx.click(REQ.SIDEBAR_ADD_BTN);
        await ctx.waitFor(REQ.ADD_DROPDOWN, 1500);
        await ctx.click(REQ.ADD_ENV_COLLECTION);
        await ctx.waitFor(REQ.COLLECTION_MODAL, 2000);
        await ctx.delay(280);

        // Name it
        const nameInput = document.querySelector<HTMLInputElement>('.req-col-modal .req-input');
        if (nameInput) {
          nameInput.focus();
          fillControlledInput(nameInput, LINKED_COLLECTION_NAME);
          await ctx.delay(300);
        }

        // Select linked microservice from the WfDarkSelect dropdown
        const svcSelectRoot = document.querySelector<HTMLElement>(REQ.SVC_SELECT);
        if (svcSelectRoot) {
          await spotlightElNoScroll(ctx, svcSelectRoot, 1000);
          const trigger = svcSelectRoot.querySelector<HTMLButtonElement>('.wf-dark-select__trigger');
          if (trigger) {
            trigger.click();
            await ctx.delay(300);
            // Find option in the portaled listbox menu
            const menuOptions = document.querySelectorAll<HTMLButtonElement>('.wf-dark-select__menu [role="option"]');
            const svcOption = Array.from(menuOptions).find(btn =>
              btn.textContent?.includes(LINKED_SVC_NAME),
            );
            if (svcOption) {
              await spotlightElNoScroll(ctx, svcOption, 900);
              svcOption.click();
              await ctx.delay(500);
            }
          }
          await spotlightElNoScroll(ctx, svcSelectRoot, 1200);
        }

        // Show the read-only base URL map (auto-filled from microservice)
        await ctx.delay(400);
        const baseMap = firstVisible(REQ.BASE_URL_MAP);
        if (baseMap) await spotlightEl(ctx, baseMap, 1500);

        // Save
        await saveCollectionModal(ctx);
        await spotlight(ctx, REQ.colByName(LINKED_COLLECTION_NAME), 1100);
      },
    },

    // ── Step 5: Send from Linked Collection ──
    {
      id: 'req3-linked-send',
      title: 'Send from Linked Collection',
      description:
        'Add a request to the **Product Service** collection, enter `/products?limit=5`, and ' +
        'notice the env pills are automatically available. Switch environments and **Send** — ' +
        'the base URL is resolved from the microservice config without any manual entry.',
      highlight: REQ.envPillByName(ENV_PROD),
      preAction: async (ctx) => {
        ensureRequestsTab(ctx);
        await closeOpenOverlays(ctx);
        // Ensure linked scenario is set up
        const prodEnvId = ensureSettingsEnvironment(ENV_PROD);
        const stagingEnvId = ensureSettingsEnvironment(ENV_STAGING);
        const baseUrls: Record<string, string> = {};
        if (prodEnvId) baseUrls[prodEnvId] = BASE_URL_PROD;
        if (stagingEnvId) baseUrls[stagingEnvId] = BASE_URL_STAGING;
        ensureSettingsMicroservice(LINKED_SVC_NAME, baseUrls);
        // If linked collection doesn't exist, bail (prior step must run)
        if (!document.querySelector(REQ.colByName(LINKED_COLLECTION_NAME))) return;
      },
      action: async (ctx) => {
        await ensureCollectionExpanded(ctx, LINKED_COLLECTION_NAME);

        // Add or select the request
        const existing = firstVisible(REQ.reqInCollection(LINKED_COLLECTION_NAME, LINKED_REQUEST_NAME));
        if (!existing) {
          const col = firstVisible(REQ.colByName(LINKED_COLLECTION_NAME));
          if (!col) return;
          const opened = await openContextMenuForElement(ctx, col);
          if (!opened) return;
          await clickContextItemVisible(ctx, 'Add Request');
          await fillNewRequestPrompt(ctx, LINKED_REQUEST_NAME);
          await ctx.waitFor(REQ.URL_INPUT, 2200);
          await ctx.delay(240);
        } else {
          existing.click();
          await ctx.delay(120);
        }

        // Fill the URL
        const urlInput = firstVisible(REQ.URL_INPUT) as HTMLInputElement | null;
        if (urlInput) {
          if (urlInput.value !== LINKED_REQUEST_PATH) {
            urlInput.focus();
            fillControlledInput(urlInput, LINKED_REQUEST_PATH);
            await ctx.delay(300);
          }
          await spotlightElNoScroll(ctx, urlInput, 900);
        }

        // Show env bar + resolved URL
        await spotlight(ctx, REQ.ENV_BAR, 1100);
        await spotlight(ctx, REQ.RESOLVED_URL, 1200);

        // Switch to staging, pause on resolved URL
        const stagingPill = firstVisible(REQ.envPillByName(ENV_STAGING));
        if (stagingPill) {
          stagingPill.click();
          await ctx.delay(350);
          await spotlight(ctx, REQ.RESOLVED_URL, 1100);
        }

        // Switch to production + send
        const prodPill = firstVisible(REQ.envPillByName(ENV_PROD));
        if (prodPill) {
          prodPill.click();
          await ctx.delay(350);
        }

        await spotlight(ctx, REQ.SEND_BTN, 1000);
        await ctx.click(REQ.SEND_BTN);
        await ctx.waitFor(REQ.STATUS_PILL, 5000);
        await spotlight(ctx, REQ.STATUS_PILL, 1100);

        const json = firstVisible(REQ.JSON_PREVIEW);
        if (json) await spotlightEl(ctx, json, 1100);
      },
    },

    // ── Step 6: Summary ──
    {
      id: 'req3-summary',
      title: 'Manual vs Linked Microservice',
      description:
        'You\'ve seen two multi-env approaches:\n\n' +
        '**None (manual config)** — type base URLs directly in the collection modal. Best for ad-hoc APIs.\n\n' +
        '**Linked Microservice** — base URLs come from Settings automatically. Change the URL in Settings once ' +
        'and every linked collection updates. Best for team services with shared environments.\n\n' +
        'Both support env pills, per-env auth, and relative paths.',
      highlight: REQ.ENV_BAR,
      pauseAfter: true,
      preAction: async (ctx) => {
        ensureRequestsTab(ctx);
        await closeOpenOverlays(ctx);
        if (!document.querySelector(REQ.colByName(LINKED_COLLECTION_NAME))
          && !document.querySelector(REQ.colByName(COLLECTION_NAME))) {
          await ensureMultiEnvCollection(ctx);
        }
      },
    },
  ],
};
