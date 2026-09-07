/**
 * CAT-2 — Live API Execution
 *
 * 7 steps: configure the Host Strategy (From Spec → Environment + Microservice →
 * Custom URL hostname → back to From Spec) → open Try It Out on POST /posts with
 * auto-generated body → execute GET /posts/{id} with a path parameter → Send to
 * Harness (Target cascade) → Send to Harness Options → authorize via Auth panel →
 * copy as cURL.
 *
 * Purpose: Catalog as a live sandbox — pick the host, Execute real HTTP from
 * the OpenAPI spec, then promote to Harness / Authorize / copy cURL.
 *
 * Uses the real JSONPlaceholder API (CORS-friendly, no auth required for GETs).
 */
import type { DemoLesson, DemoActionContext } from '../../types';
import { CAT, REQ } from '@shared/selectors';
import {
  JSONPLACEHOLDER_API_SPEC,
  seedCatalogEntry,
  deleteCatalogEntryByName,
  deleteCollectionsByName,
  selectCatalogEntryByName,
  ensureCatalogTab,
  ensureEndpointsView,
  ensureCardTryItOpen,
  collapseAllCards,
  closeAuthPanelIfOpen,
  spotlightEl,
  waitForSelector,
  closeEditModalIfOpen,
  resetHostStrategyToFromSpec,
} from './cat-demo-helpers';
import { fillControlledInput } from '../setup-helpers';
import { cleanupOtherRequestDemoCollections } from './req-demo-helpers';
import {
  ensureSettingsEnvironment,
  ensureSettingsMicroservice,
  getDemoBridgeWindow,
} from '../../adapters';

// ─── Constants ──────────────────────────────────────────────────

const DEMO_ENTRY_NAME = 'JSONPlaceholder API';
const DEMO_ENTRY_NAME_VERSIONED = 'JSONPlaceholder API (1.0.0)';
const DEMO_CUSTOM_HOST = 'https://staging.example.com';
const CAT2_ENV_NAME = 'demo';
const CAT2_SVC_NAME = 'jsonplaceholder';
const CAT2_FG_NAME = 'Catalog Demo Tests';
const CAT2_SCENARIO_NAME = 'GET Post by ID';
const CAT2_SVC_BASE = 'https://jsonplaceholder.typicode.com';

/** Quietly close the Send to Harness modal if open. */
async function closeHarnessModalIfOpen(ctx: DemoActionContext): Promise<void> {
  const modal = document.querySelector(REQ.HARNESS_MODAL);
  if (!modal) return;
  const cancel = document.querySelector<HTMLElement>(REQ.HARNESS_CANCEL_BTN)
    ?? document.querySelector<HTMLElement>('.send-harness-cancel-btn');
  cancel?.click();
  await ctx.delay(250);
}

/** Hold on status code first, then the full live-response panel (human payoff). */
async function spotlightLiveResponseOutcome(
  ctx: DemoActionContext,
  card: HTMLElement,
): Promise<void> {
  const response = card.querySelector<HTMLElement>(CAT.LIVE_RESPONSE);
  if (!response) return;
  response.scrollIntoView({ block: 'nearest' });
  const statusCode = response.querySelector<HTMLElement>('.sw-resp-code');
  if (statusCode) {
    await spotlightEl(ctx, statusCode, 1800);
  }
  await spotlightEl(ctx, response, 2200);
}

function cleanupDemoFeatureGroups(): void {
  getDemoBridgeWindow().__demoDeleteFeatureGroupsByName?.(CAT2_FG_NAME);
}

/** Ensure env + microservice exist so the Target cascade can be filled. */
function ensureHarnessTargets(): void {
  const envId = ensureSettingsEnvironment(CAT2_ENV_NAME);
  if (envId) {
    ensureSettingsMicroservice(CAT2_SVC_NAME, { [envId]: CAT2_SVC_BASE });
  }
}

/** Execute GET /posts/{id} if needed so Send to Harness appears. */
async function ensureGetPostExecuted(ctx: DemoActionContext): Promise<void> {
  await ensureCardTryItOpen('GET', '/posts/{id}');
  const getCard = document.querySelector<HTMLElement>(CAT.endpointCard('GET', '/posts/{id}'));
  if (!getCard) return;
  if (getCard.querySelector(CAT.LIVE_RESPONSE) && getCard.querySelector(CAT.SAVE_AS_TEST_BTN)) {
    return;
  }
  const paramInput = getCard.querySelector<HTMLInputElement>(CAT.paramInput('id'));
  if (paramInput && !paramInput.value) {
    fillControlledInput(paramInput, '1');
  }
  const execBtn = getCard.querySelector<HTMLElement>(CAT.EXECUTE_BTN);
  if (execBtn) execBtn.click();
  try {
    await waitForSelector(
      `${CAT.endpointCard('GET', '/posts/{id}')} ${CAT.SAVE_AS_TEST_BTN}`,
      10000,
    );
  } catch {
    try {
      await waitForSelector(
        `${CAT.endpointCard('GET', '/posts/{id}')} ${CAT.LIVE_RESPONSE}`,
        4000,
      );
    } catch { /* network may fail */ }
  }
  await ctx.delay(200);
}

/** Open a cascade field, pick by name (or first item). `quiet` skips spotlights (preAction). */
async function selectCascadeByName(
  ctx: DemoActionContext,
  fieldSel: string,
  matchName: string,
  options: { holdMs?: number; quiet?: boolean } = {},
): Promise<void> {
  const { holdMs = 1100, quiet = false } = options;
  const field = document.querySelector<HTMLElement>(fieldSel);
  if (!field) return;
  if (!quiet) await spotlightEl(ctx, field, holdMs);
  const trigger = field.querySelector<HTMLButtonElement>('.cascade-dropdown-trigger');
  if (!trigger) return;
  trigger.click();
  await ctx.delay(quiet ? 200 : 550);
  const items = Array.from(field.querySelectorAll<HTMLButtonElement>('.cascade-dropdown-item:not(.cascade-dropdown-create)'));
  const match = items.find((i) => {
    const name = i.querySelector('.cascade-dropdown-item-name')?.textContent?.trim().toLowerCase();
    return name === matchName.toLowerCase();
  }) ?? items[0];
  if (match) {
    match.scrollIntoView({ block: 'nearest' });
    // One beat on the chosen option — do not re-spotlight the field afterward.
    if (!quiet) await spotlightEl(ctx, match, 1000);
    match.click();
    await ctx.delay(quiet ? 200 : 600);
  }
}

/** Open cascade → + Create New → fill name. `quiet` skips spotlights (preAction). */
async function createCascadeItem(
  ctx: DemoActionContext,
  fieldSel: string,
  newName: string,
  options: { holdMs?: number; quiet?: boolean } = {},
): Promise<void> {
  const { holdMs = 1100, quiet = false } = options;
  const field = document.querySelector<HTMLElement>(fieldSel);
  if (!field) return;
  if (!quiet) await spotlightEl(ctx, field, holdMs);

  // Already in create mode (e.g. Scenario auto-opens after new Feature Group)
  let input = field.querySelector<HTMLInputElement>('input');
  if (!input) {
    const trigger = field.querySelector<HTMLButtonElement>('.cascade-dropdown-trigger');
    if (trigger) {
      trigger.click();
      await ctx.delay(quiet ? 200 : 500);
    }
    const createBtn = field.querySelector<HTMLButtonElement>('.cascade-dropdown-create');
    if (createBtn) {
      if (!quiet) await spotlightEl(ctx, createBtn, 1000);
      createBtn.click();
      await ctx.delay(quiet ? 200 : 500);
    }
    input = field.querySelector<HTMLInputElement>('input');
  }

  if (input) {
    if (!quiet) await spotlightEl(ctx, input, 900);
    fillControlledInput(input, newName);
    input.blur();
    await ctx.delay(quiet ? 200 : 600);
  }
}

/** Linked microservice chip text (excludes the Change button label). */
export function readLinkedMicroserviceName(): string {
  const label = document.querySelector<HTMLElement>(CAT.HOST_SVC_LABEL);
  if (!label) return '';
  const textNode = Array.from(label.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim() ?? '').length > 0,
  );
  return textNode?.textContent?.trim()
    ?? label.textContent?.replace(/\s*Change\s*$/u, '').trim()
    ?? '';
}

/** Prefer the demo microservice in the Edit modal select; never grab the first product svc. */
export function findPreferredMicroserviceOption(preferredName: string): HTMLElement | undefined {
  const options = Array.from(
    document.querySelectorAll<HTMLElement>('.cat-dark-select__option'),
  );
  const preferred = options.find((opt) => {
    const label = opt.querySelector('.cat-dark-select__option-label')?.textContent?.trim()
      ?? opt.textContent?.trim()
      ?? '';
    return label.toLowerCase() === preferredName.toLowerCase();
  });
  if (preferred) return preferred;
  return options.find((opt) => {
    const label = opt.querySelector('.cat-dark-select__option-label')?.textContent?.trim() ?? '';
    return Boolean(label) && !label.includes('None');
  });
}

/** Prefer the demo env (or one carrying the JSONPlaceholder base URL). */
export function findPreferredEnvOption(
  items: HTMLElement[],
  envName = CAT2_ENV_NAME,
): HTMLElement | undefined {
  const envKey = envName.toLowerCase();
  const hostKey = 'jsonplaceholder';
  return items.find((item) => {
    const text = item.textContent?.toLowerCase() ?? '';
    return text.includes(envKey) || text.includes(hostKey);
  }) ?? items[0];
}

/**
 * Link/select the demo **jsonplaceholder** microservice + **demo** env.
 * Never picks the first leftover product microservice (e.g. inventory-api).
 */
async function linkDemoMicroserviceViaEditModal(ctx: DemoActionContext): Promise<void> {
  const msSelect = document.querySelector<HTMLElement>(CAT.EDIT_MICROSERVICE_SELECT);
  if (!msSelect) return;

  await spotlightEl(ctx, msSelect, 1200);
  const trigger = msSelect.querySelector<HTMLElement>('.cat-dark-select__trigger');
  trigger?.click();
  await ctx.delay(600);

  const preferredSvc = findPreferredMicroserviceOption(CAT2_SVC_NAME);
  if (preferredSvc) {
    await spotlightEl(ctx, preferredSvc, 1400);
    preferredSvc.click();
    await ctx.delay(700);
  }

  // Save without a second spotlight tour — the chosen svc is the teaching beat.
  const saveBtn = document.querySelector<HTMLElement>(CAT.EDIT_SAVE_BTN);
  if (saveBtn) {
    await spotlightEl(ctx, saveBtn, 900);
    saveBtn.click();
    await ctx.delay(900);
  }
}

/**
 * Environment mode: ensure the demo microservice is linked, then pick the demo env.
 */
async function demonstrateEnvironmentMode(ctx: DemoActionContext): Promise<void> {
  // Make sure the demo svc exists before the Edit modal opens.
  ensureHarnessTargets();

  const envBtn = document.querySelector<HTMLElement>(CAT.HOST_ENVIRONMENT);
  if (!envBtn) return;

  await spotlightEl(ctx, envBtn, 1600);
  envBtn.click();
  await ctx.delay(1000);

  // Path A — Edit modal opened (no microservice linked yet)
  if (document.querySelector(CAT.EDIT_MICROSERVICE_SELECT)) {
    await linkDemoMicroserviceViaEditModal(ctx);
    // Quiet re-activate — no second Environment spotlight.
    document.querySelector<HTMLElement>(CAT.HOST_ENVIRONMENT)?.click();
    await ctx.delay(900);
  }

  // Already linked to the wrong product svc? Open Change → pick jsonplaceholder.
  const linkedName = readLinkedMicroserviceName();
  if (
    linkedName
    && linkedName.toLowerCase() !== CAT2_SVC_NAME.toLowerCase()
    && document.querySelector(CAT.HOST_SVC_CHANGE)
  ) {
    const changeBtn = document.querySelector<HTMLElement>(CAT.HOST_SVC_CHANGE);
    if (changeBtn) {
      await spotlightEl(ctx, changeBtn, 1400);
      changeBtn.click();
      await ctx.delay(900);
      await linkDemoMicroserviceViaEditModal(ctx);
      const envBtn3 = document.querySelector<HTMLElement>(CAT.HOST_ENVIRONMENT);
      if (envBtn3 && !envBtn3.classList.contains('active')) {
        envBtn3.click();
        await ctx.delay(900);
      }
    }
  }

  // Env CustomSelect — one spotlight on the chosen demo env (no option tour).
  const envSelect = document.querySelector<HTMLElement>(CAT.HOST_ENV_SELECT);
  if (envSelect) {
    await spotlightEl(ctx, envSelect, 1600);
    const trigger = envSelect.querySelector<HTMLElement>('.cs-trigger, button');
    trigger?.click();
    await ctx.delay(700);

    const items = Array.from(document.querySelectorAll<HTMLElement>('.cs-menu .cs-item, .cs-item'));
    const pick = findPreferredEnvOption(items);
    if (pick) {
      await spotlightEl(ctx, pick, 1500);
      pick.click();
      await ctx.delay(900);
    } else {
      trigger?.click();
    }
  }

  // Payoff: resolved Base URL now comes from Environments settings.
  const baseUrl = document.querySelector<HTMLElement>(CAT.BASE_URL);
  if (baseUrl) {
    await spotlightEl(ctx, baseUrl, 1800);
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Ensure the demo entry exists in the sidebar. Seeds it if missing. */
async function ensureDemoEntry(): Promise<void> {
  if (document.querySelector(CAT.entryByName(DEMO_ENTRY_NAME))) return;
  await seedCatalogEntry(DEMO_ENTRY_NAME, JSONPLACEHOLDER_API_SPEC);
  await waitForSelector(CAT.entryByName(DEMO_ENTRY_NAME), 3000);
}

/** Ensure the demo entry is selected and the main panel is visible. */
async function ensureDemoEntrySelected(): Promise<void> {
  await ensureDemoEntry();
  selectCatalogEntryByName(DEMO_ENTRY_NAME);
  await new Promise(r => setTimeout(r, 150));
}

// ─── Lesson ─────────────────────────────────────────────────────

export const catTryItOutLesson: DemoLesson = {
  id: 'cat-try-execute',
  domainId: 'api',
  category: 'catalog',
  name: 'Live API Execution',
  description:
    'Turn the Catalog into a live sandbox: pick where requests go, execute real HTTP calls ' +
    'from the OpenAPI spec, then promote a working call into the Harness or copy it as cURL.',
  estimatedMinutes: 10,
  initialTab: 'catalog',
  allowedTabs: ['catalog', 'environments'],
  // First Catalog paint = Endpoints (not Overview restore / Welcome hop).
  initialSurface: { catalogView: 'endpoints' },

  concept: {
    title: 'Why this lesson exists',
    body:
      'The Catalog is not only a read-only API browser. This lesson shows the full **live path**:\n\n' +
      '1. **Choose the host** — decide whether Execute hits the URL in the OpenAPI `servers` block, ' +
      'a linked Environment/Microservice, or a custom hostname (staging / localhost).\n' +
      '2. **Try It Out → Execute** — fill params/body from the schema and send a **real** HTTP call ' +
      '(we use public JSONPlaceholder so you see a true 201/200 response).\n' +
      '3. **Promote or share** — once a call works, **Send to Harness** turns it into a reusable test, ' +
      '**Authorize** covers authenticated APIs, and **cURL** exports the exact command for a terminal or CI.\n\n' +
      '**Takeaway:** explore an imported spec → prove the endpoint works against a live host → ' +
      'hand off that working request into testing or the command line — without leaving Catalog.',
    keyTerms: [
      { term: 'Host Strategy', definition: 'Chooses the base URL for Execute: From Spec (OpenAPI servers), Environment (linked microservice), or Custom URL' },
      { term: 'Try It Out', definition: 'Interactive form on an endpoint card — fill parameters/body, then Execute a live request' },
      { term: 'Schema Stub', definition: 'JSON body auto-generated from the request schema so you edit values instead of typing from scratch' },
      { term: 'Path Parameter', definition: 'URL template like {id} — becomes its own input field before Execute' },
      { term: 'Send to Harness', definition: 'After a successful Execute, promotes the Try It Out request into the Test Harness (Target + Options)' },
      { term: 'Authorize', definition: 'Catalog-wide auth (Bearer, Basic, API Key, …) applied to subsequent Execute calls' },
      { term: 'cURL', definition: 'Exports the configured request as a paste-ready shell command' },
    ],
    diagram: `<svg viewBox="0 0 460 90" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="25" width="90" height="40" rx="6" fill="#1e293b" stroke="#8b5cf6" stroke-width="1.5"/>
      <text x="50" y="44" text-anchor="middle" fill="#f1f5f9" font-size="9">Host Strategy</text>
      <text x="50" y="57" text-anchor="middle" fill="#94a3b8" font-size="7">base URL</text>
      <path d="M100 45 L135 45" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#cat2arr)"/>
      <rect x="140" y="25" width="90" height="40" rx="6" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>
      <text x="185" y="44" text-anchor="middle" fill="#f1f5f9" font-size="9">Try It Out</text>
      <text x="185" y="57" text-anchor="middle" fill="#94a3b8" font-size="7">params · body</text>
      <path d="M235 45 L270 45" stroke="#f59e0b" stroke-width="1.5" marker-end="url(#cat2arr)"/>
      <rect x="275" y="25" width="80" height="40" rx="6" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/>
      <text x="315" y="44" text-anchor="middle" fill="#f1f5f9" font-size="9">Execute</text>
      <text x="315" y="57" text-anchor="middle" fill="#94a3b8" font-size="7">live HTTP</text>
      <path d="M360 45 L395 45" stroke="#10b981" stroke-width="1.5" marker-end="url(#cat2arr)"/>
      <rect x="400" y="25" width="55" height="40" rx="6" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
      <text x="427" y="44" text-anchor="middle" fill="#f1f5f9" font-size="9">Harness</text>
      <text x="427" y="57" text-anchor="middle" fill="#94a3b8" font-size="7">or cURL</text>
      <defs><marker id="cat2arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#94a3b8"/></marker></defs>
    </svg>`,
  },

  // Seed + select BEFORE Catalog mounts so Start Demo never paints Welcome /
  // Overview / wrong API, then hops to Host Strategy.
  prepareBeforeNavigate: async (ctx) => {
    ensureHarnessTargets();
    deleteCollectionsByName(DEMO_ENTRY_NAME);
    deleteCollectionsByName(DEMO_ENTRY_NAME_VERSIONED);
    await cleanupOtherRequestDemoCollections(ctx);
    // Reseed fresh — idempotent seed keeps a prior wrong microserviceId link.
    deleteCatalogEntryByName(DEMO_ENTRY_NAME);
    await seedCatalogEntry(DEMO_ENTRY_NAME, JSONPLACEHOLDER_API_SPEC);
    selectCatalogEntryByName(DEMO_ENTRY_NAME);
    await ctx.delay(80);
  },

  setup: async (ctx) => {
    closeEditModalIfOpen();
    closeAuthPanelIfOpen();
    ensureCatalogTab(ctx);
    await ensureDemoEntrySelected();
    await ensureEndpointsView(ctx);
    await ctx.delay(80);
  },

  cleanup: async (ctx) => {
    await closeHarnessModalIfOpen(ctx);
    closeEditModalIfOpen();
    closeAuthPanelIfOpen();
    collapseAllCards();
    cleanupDemoFeatureGroups();
    deleteCatalogEntryByName(DEMO_ENTRY_NAME);
    deleteCollectionsByName(DEMO_ENTRY_NAME);
    deleteCollectionsByName(DEMO_ENTRY_NAME_VERSIONED);
    await cleanupOtherRequestDemoCollections(ctx);
    // Skip Catalog navigate during Restart boot — prepareBeforeNavigate reseeds
    // first, then the hub lands on Catalog once (avoids Welcome flash).
    if (document.body.getAttribute('data-demo-bootstrapping') !== '1') {
      ensureCatalogTab(ctx);
    }
    await ctx.delay(60);
  },

  steps: [
    // ── Step 1: Host Strategy — Where Requests Go ───────────────
    {
      id: 'cat2-host',
      title: 'Host Strategy — Where Requests Go',
      description:
        '**Purpose of this control:** every Execute call needs a base URL. Host Strategy is ' +
        'how Catalog decides that URL — watch the **resolved Base URL** update as we switch modes:\n\n' +
        '1. **From Spec** (default) — URL from the OpenAPI `servers` block (JSONPlaceholder)\n' +
        '2. **Environment** — link a Microservice + env so the URL comes from Settings\n' +
        '3. **Custom URL** — type any host (staging / localhost)\n\n' +
        'We finish back on **From Spec** so the next live Execute steps hit the real public API.',
      highlight: CAT.HOST_STRATEGY,

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        ensureHarnessTargets();
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        closeEditModalIfOpen();
        resetHostStrategyToFromSpec();
      },

      action: async (ctx) => {
        const hostBar = document.querySelector<HTMLElement>(CAT.HOST_STRATEGY);
        if (hostBar) {
          hostBar.scrollIntoView({ block: 'nearest' });
          await spotlightEl(ctx, hostBar, 1600);
        }

        const fromSpecBtn = document.querySelector<HTMLElement>(CAT.HOST_FROM_SPEC);
        if (fromSpecBtn) {
          await spotlightEl(ctx, fromSpecBtn, 1500);
        }

        const serverSelect = document.querySelector<HTMLElement>(CAT.HOST_SERVER_SELECT);
        if (serverSelect) {
          await spotlightEl(ctx, serverSelect, 1500);
        }

        const baseUrl = document.querySelector<HTMLElement>(CAT.BASE_URL);
        if (baseUrl) {
          await spotlightEl(ctx, baseUrl, 1800);
        }

        await demonstrateEnvironmentMode(ctx);

        const customBtn = document.querySelector<HTMLElement>(CAT.HOST_CUSTOM_URL);
        if (customBtn) {
          await spotlightEl(ctx, customBtn, 1500);
          customBtn.click();
          await ctx.delay(900);

          const hostInput = document.querySelector<HTMLInputElement>(CAT.HOST_INPUT);
          if (hostInput) {
            await spotlightEl(ctx, hostInput, 1000);
            fillControlledInput(hostInput, DEMO_CUSTOM_HOST);
            await spotlightEl(ctx, hostInput, 1600);
          }

          const customBase = document.querySelector<HTMLElement>(CAT.BASE_URL);
          if (customBase) {
            await spotlightEl(ctx, customBase, 1800);
          }
        }

        if (fromSpecBtn) {
          await spotlightEl(ctx, fromSpecBtn, 1400);
          fromSpecBtn.click();
          await ctx.delay(900);
          const restoredBase = document.querySelector<HTMLElement>(CAT.BASE_URL);
          if (restoredBase) {
            await spotlightEl(ctx, restoredBase, 1800);
          }
        }
      },
    },

    // ── Step 2: Try It Out — POST /posts ────────────────────────
    {
      id: 'cat2-try-post',
      title: 'Try It Out — Create a Post (live)',
      description:
        '**This is the core of the lesson:** prove an endpoint works against a live host.\n\n' +
        'Expand **POST /posts**, click **Try it out**, and watch the body fill from the OpenAPI ' +
        'schema (`title`, `body`, `userId`). We edit those values, then click **Execute**.\n\n' +
        'Watch for a real **201 Created** response from JSONPlaceholder — status, body, and ' +
        'latency. Not a mock: this is the Catalog calling the network.',
      highlight: CAT.endpointCard('POST', '/posts'),

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        closeEditModalIfOpen();
        resetHostStrategyToFromSpec();
        collapseAllCards();
      },

      action: async (ctx) => {
        const postCard = document.querySelector<HTMLElement>(CAT.endpointCard('POST', '/posts'));
        if (!postCard) return;
        postCard.scrollIntoView({ block: 'center' });
        await spotlightEl(ctx, postCard.querySelector<HTMLElement>('.sw-header') ?? postCard, 1400);

        const header = postCard.querySelector<HTMLElement>('.sw-header');
        if (header) header.click();
        await ctx.delay(1000);

        const tryitBtn = postCard.querySelector<HTMLElement>(CAT.TRYIT_BTN);
        if (tryitBtn) {
          await spotlightEl(ctx, tryitBtn, 1400);
          tryitBtn.click();
        }
        await ctx.delay(1000);

        const bodyEditor = postCard.querySelector<HTMLTextAreaElement>(CAT.BODY_EDITOR);
        if (bodyEditor) {
          await spotlightEl(ctx, bodyEditor, 1800);
          const edited = JSON.stringify({
            title: 'Hello from RedfireForge',
            body: 'This post was created from the Catalog Try It Out demo.',
            userId: 1,
          }, null, 2);
          fillControlledInput(bodyEditor, edited);
          bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
          bodyEditor.dispatchEvent(new Event('change', { bubbles: true }));
          await spotlightEl(ctx, bodyEditor, 1600);
        }

        const execBtn = postCard.querySelector<HTMLElement>(CAT.EXECUTE_BTN);
        if (execBtn) {
          await spotlightEl(ctx, execBtn, 1400);
          execBtn.click();
          await ctx.delay(600);
        }

        try {
          await waitForSelector(
            `${CAT.endpointCard('POST', '/posts')} ${CAT.LIVE_RESPONSE}`,
            8000,
          );
        } catch { /* Network may fail — still continue */ }

        await spotlightLiveResponseOutcome(ctx, postCard);
      },
    },

    // ── Step 3: Path Parameters — GET /posts/{id} ───────────────
    {
      id: 'cat2-path-param',
      title: 'Path Parameters — Fetch One Resource',
      description:
        'Many APIs use path templates like `/posts/{id}`. Catalog turns each `{param}` into ' +
        'its own input — no hand-editing the URL.\n\n' +
        'Expand **GET /posts/{id}**, open **Try it out**, set `id = 1`, then **Execute**. ' +
        'Watch the live response return that single post — proof the path variable was wired ' +
        'into the request URL.',
      highlight: CAT.endpointCard('GET', '/posts/{id}'),

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        collapseAllCards();
      },

      action: async (ctx) => {
        const getCard = document.querySelector<HTMLElement>(CAT.endpointCard('GET', '/posts/{id}'));
        if (!getCard) return;
        getCard.scrollIntoView({ block: 'center' });
        await spotlightEl(ctx, getCard.querySelector<HTMLElement>('.sw-header') ?? getCard, 1400);

        const header = getCard.querySelector<HTMLElement>('.sw-header');
        if (header) header.click();
        await ctx.delay(1000);

        const tryitBtn = getCard.querySelector<HTMLElement>(CAT.TRYIT_BTN);
        if (tryitBtn) {
          await spotlightEl(ctx, tryitBtn, 1400);
          tryitBtn.click();
        }
        await ctx.delay(900);

        const paramInput = getCard.querySelector<HTMLInputElement>(CAT.paramInput('id'));
        if (paramInput) {
          await spotlightEl(ctx, paramInput, 1400);
          paramInput.focus();
          fillControlledInput(paramInput, '1');
          paramInput.dispatchEvent(new Event('input', { bubbles: true }));
          paramInput.dispatchEvent(new Event('change', { bubbles: true }));
          await spotlightEl(ctx, paramInput, 1200);
        }

        const execBtn = getCard.querySelector<HTMLElement>(CAT.EXECUTE_BTN);
        if (execBtn) {
          await spotlightEl(ctx, execBtn, 1300);
          execBtn.click();
          await ctx.delay(600);
        }

        try {
          await waitForSelector(
            `${CAT.endpointCard('GET', '/posts/{id}')} ${CAT.LIVE_RESPONSE}`,
            8000,
          );
        } catch { /* Network may fail */ }

        await spotlightLiveResponseOutcome(ctx, getCard);
      },
    },

    // ── Step 4: Send to Harness — Target ─────────────────────────
    {
      id: 'cat2-save-test',
      title: 'Send to Harness — Choose Target',
      description:
        '**Why this button appears:** once Execute succeeds, Catalog can promote that working ' +
        'request into the **Test Harness** so you can re-run it as an automated test.\n\n' +
        'Click **Send to Harness**. On the **Target** step, pick where the test lives:\n' +
        '- Environment → Microservice → Feature Group → Test Scenario\n\n' +
        'We fill each cascade (creating a group and scenario). The next step opens **Options**.',
      highlight: CAT.SAVE_AS_TEST_BTN,

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        await ctx.delay(400);
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        closeAuthPanelIfOpen();
        closeEditModalIfOpen();
        await closeHarnessModalIfOpen(ctx);
        resetHostStrategyToFromSpec();
        await ensureGetPostExecuted(ctx);
      },

      action: async (ctx) => {
        const getCard = document.querySelector<HTMLElement>(CAT.endpointCard('GET', '/posts/{id}'));
        if (!getCard) return;

        const response = getCard.querySelector<HTMLElement>(CAT.LIVE_RESPONSE);
        if (response) {
          response.scrollIntoView({ block: 'nearest' });
          await spotlightEl(ctx, response, 1200);
        }

        const saveBtn = getCard.querySelector<HTMLElement>(CAT.SAVE_AS_TEST_BTN);
        if (!saveBtn) return;
        saveBtn.scrollIntoView({ block: 'nearest' });
        await spotlightEl(ctx, saveBtn, 1600);
        saveBtn.click();

        await waitForSelector(REQ.HARNESS_MODAL, 3000);
        await ctx.delay(900);

        await selectCascadeByName(ctx, REQ.HARNESS_CASCADE_ENV, CAT2_ENV_NAME, { holdMs: 1200 });
        await selectCascadeByName(ctx, REQ.HARNESS_CASCADE_SVC, CAT2_SVC_NAME, { holdMs: 1200 });
        await createCascadeItem(ctx, REQ.HARNESS_CASCADE_GROUP, CAT2_FG_NAME, { holdMs: 1200 });
        await createCascadeItem(ctx, REQ.HARNESS_CASCADE_SCENARIO, CAT2_SCENARIO_NAME, { holdMs: 1200 });

        const nextBtn = document.querySelector<HTMLButtonElement>(REQ.HARNESS_NEXT_BTN);
        if (nextBtn) {
          await spotlightEl(ctx, nextBtn, 1500);
        }
      },
    },

    // ── Step 5: Send to Harness — Options ────────────────────────
    {
      id: 'cat2-save-options',
      title: 'Send to Harness — Options',
      description:
        'Click **Next** to open **Options** — the second half of promotion.\n\n' +
        'Watch for:\n' +
        '- **Target summary** — confirms Environment / Microservice / Group / Scenario\n' +
        '- **Validation → Status 200** — assert the harness test expects HTTP 200\n\n' +
        'We select **Status 200**, then **Cancel**. Confirming the promote is covered in the ' +
        'Requests → Harness lesson; here the point is the Catalog → Harness handoff.',
      highlight: REQ.HARNESS_NEXT_BTN,

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        await ctx.delay(400);
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        closeAuthPanelIfOpen();
        resetHostStrategyToFromSpec();
        await ensureGetPostExecuted(ctx);

        if (!document.querySelector(REQ.HARNESS_MODAL)) {
          const getCard = document.querySelector<HTMLElement>(CAT.endpointCard('GET', '/posts/{id}'));
          const saveBtn = getCard?.querySelector<HTMLElement>(CAT.SAVE_AS_TEST_BTN);
          if (saveBtn) {
            saveBtn.click();
            await waitForSelector(REQ.HARNESS_MODAL, 3000).catch(() => {});
            await ctx.delay(300);
            await selectCascadeByName(ctx, REQ.HARNESS_CASCADE_ENV, CAT2_ENV_NAME, { quiet: true });
            await selectCascadeByName(ctx, REQ.HARNESS_CASCADE_SVC, CAT2_SVC_NAME, { quiet: true });
            await createCascadeItem(ctx, REQ.HARNESS_CASCADE_GROUP, CAT2_FG_NAME, { quiet: true });
            await createCascadeItem(ctx, REQ.HARNESS_CASCADE_SCENARIO, CAT2_SCENARIO_NAME, { quiet: true });
          }
        }
      },

      action: async (ctx) => {
        const modal = document.querySelector<HTMLElement>(REQ.HARNESS_MODAL);
        if (!modal) return;

        const nextBtn = modal.querySelector<HTMLButtonElement>(REQ.HARNESS_NEXT_BTN);
        if (nextBtn && !nextBtn.disabled) {
          await spotlightEl(ctx, nextBtn, 1400);
          nextBtn.click();
          await ctx.delay(1000);
        }

        const summary = modal.querySelector<HTMLElement>('.send-harness-target-summary');
        if (summary) {
          await spotlightEl(ctx, summary, 1600);
        }

        const validationGroup = modal.querySelectorAll<HTMLElement>('.send-harness-option-group')[1];
        if (validationGroup) {
          const status200 = Array.from(validationGroup.querySelectorAll<HTMLLabelElement>('.send-harness-option-card'))
            .find((card) => card.textContent?.includes('Status 200'));
          if (status200) {
            await spotlightEl(ctx, status200, 1500);
            status200.click();
            await ctx.delay(900);
            await spotlightEl(ctx, status200, 1200);
          }
        }

        const cancelBtn = modal.querySelector<HTMLElement>(REQ.HARNESS_CANCEL_BTN);
        if (cancelBtn) {
          await spotlightEl(ctx, cancelBtn, 1200);
          cancelBtn.click();
          await ctx.delay(800);
        }
      },
    },

    // ── Step 6: Authorize ───────────────────────────────────────
    {
      id: 'cat2-auth',
      title: 'Authorize Your Requests',
      description:
        'Real APIs usually need credentials. **Authorize** configures auth once for the Catalog ' +
        'entry — every later Execute includes it.\n\n' +
        'Open **Authorize**, pick **Bearer Token**, enter a token, glance at the ' +
        '**prefix** (default `Bearer`), then **Verify Auth**. We close the panel afterward so ' +
        'the main Catalog stays visible for the next step.',
      highlight: CAT.AUTHORIZE_BTN,

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        await closeHarnessModalIfOpen(ctx);
        // Keep panel closed so the action can show Authorize → open (human beat).
        closeAuthPanelIfOpen();
      },

      action: async (ctx) => {
        const authBtn = document.querySelector<HTMLElement>(CAT.AUTHORIZE_BTN);
        if (authBtn) {
          await spotlightEl(ctx, authBtn, 1500);
          authBtn.click();
        }
        await waitForSelector(CAT.AUTH_PANEL, 2000);
        await ctx.delay(800);

        const authPanel = document.querySelector<HTMLElement>(CAT.AUTH_PANEL);
        if (!authPanel) return;

        const typeSelect = authPanel.querySelector<HTMLElement>(CAT.AUTH_TYPE_SELECT);
        if (!typeSelect) return;
        await spotlightEl(ctx, typeSelect, 1400);
        const trigger = typeSelect.querySelector<HTMLElement>('.cs-trigger');
        trigger?.click();
        await ctx.delay(700);

        // Menu is portaled to body — query that, spotlight the option (not the trigger).
        const menu = document.querySelector<HTMLElement>('body > .cs-menu, .cs-menu');
        if (menu) {
          const items = Array.from(menu.querySelectorAll<HTMLElement>('.cs-item, [role="option"]'));
          const bearerOpt = items.find((item) => {
            const label = item.querySelector('.cs-item-label')?.textContent?.trim().toLowerCase()
              ?? item.textContent?.trim().toLowerCase()
              ?? '';
            return label.includes('bearer');
          });
          if (bearerOpt) {
            bearerOpt.classList.add('cs-item--demo-highlight');
            await spotlightEl(ctx, bearerOpt, 1400, { skipScroll: true });
            bearerOpt.classList.remove('cs-item--demo-highlight');
            bearerOpt.click();
            await ctx.delay(800);
          } else {
            trigger?.click();
          }
        }

        const tokenInput = authPanel.querySelector<HTMLInputElement>(CAT.AUTH_TOKEN_INPUT);
        if (tokenInput) {
          await spotlightEl(ctx, tokenInput, 1000);
          tokenInput.focus();
          fillControlledInput(tokenInput, 'demo-token-2024');
          await spotlightEl(ctx, tokenInput, 1400);
        }

        const prefixInput = authPanel.querySelector<HTMLElement>(CAT.AUTH_PREFIX_INPUT);
        if (prefixInput) {
          await spotlightEl(ctx, prefixInput, 1300);
        }

        const verifyBtn = authPanel.querySelector<HTMLElement>(CAT.VERIFY_AUTH_BTN);
        if (verifyBtn) {
          await spotlightEl(ctx, verifyBtn, 1300);
          await ctx.click(CAT.VERIFY_AUTH_BTN);
          try {
            await waitForSelector(`${CAT.AUTH_PANEL} .ceb-verify-result`, 4000);
          } catch { /* verify may fail offline */ }
          await ctx.delay(800);
          const verifyResult = authPanel.querySelector<HTMLElement>('.ceb-verify-result');
          if (verifyResult) {
            await spotlightEl(ctx, verifyResult, 2000);
          }
        }

        const closeBtn = authPanel.querySelector<HTMLElement>(CAT.AUTH_CLOSE_BTN)
          ?? document.querySelector<HTMLElement>(CAT.AUTH_CLOSE_BTN);
        if (closeBtn) {
          await spotlightEl(ctx, closeBtn, 1100);
          closeBtn.click();
        } else {
          closeAuthPanelIfOpen();
        }
        await ctx.delay(800);
      },
    },

    // ── Step 7: Copy as cURL ────────────────────────────────────
    {
      id: 'cat2-curl',
      title: 'Copy as cURL — Share Outside the App',
      description:
        'Last handoff path: take the same Try It Out request into a **terminal or CI script**.\n\n' +
        'On **POST /posts**, click **cURL** in the execute bar. Read the generated command ' +
        '(`-X POST`, headers, `-d` body), toggle **single-line** vs **multi-line**, then **Copy**. ' +
        'That is the Catalog request ready to paste anywhere.',
      highlight: CAT.CURL_BTN,

      preAction: async (ctx) => {
        ensureCatalogTab(ctx);
        await ensureDemoEntrySelected();
        await ensureEndpointsView(ctx);
        await closeHarnessModalIfOpen(ctx);
        closeAuthPanelIfOpen();
        collapseAllCards();
        await ensureCardTryItOpen('POST', '/posts');
      },

      action: async (ctx) => {
        const postCard = document.querySelector<HTMLElement>(CAT.endpointCard('POST', '/posts'));
        if (!postCard) return;
        postCard.scrollIntoView({ block: 'center' });
        await ctx.delay(700);

        const curlBtn = postCard.querySelector<HTMLElement>(CAT.CURL_BTN);
        if (curlBtn) {
          curlBtn.scrollIntoView({ block: 'nearest' });
          await spotlightEl(ctx, curlBtn, 1500);
          curlBtn.click();
        }
        await ctx.delay(1100);

        const curlBox = postCard.querySelector<HTMLElement>(CAT.CURL_BOX);
        if (curlBox) {
          curlBox.scrollIntoView({ block: 'nearest' });
          await spotlightEl(ctx, curlBox, 2000);

          const toggleBtns = curlBox.querySelectorAll<HTMLElement>('.sw-curl-toggle');
          const multiBtn = toggleBtns[0];
          const singleBtn = toggleBtns[1];
          if (singleBtn) {
            await spotlightEl(ctx, singleBtn, 1100);
            singleBtn.click();
            await ctx.delay(1100);
            await spotlightEl(ctx, curlBox, 1400);
          }
          if (multiBtn) {
            await spotlightEl(ctx, multiBtn, 1100);
            multiBtn.click();
            await ctx.delay(1100);
            await spotlightEl(ctx, curlBox, 1400);
          }

          const copyBtn = curlBox.querySelector<HTMLElement>('.sw-copy-btn');
          if (copyBtn) {
            await spotlightEl(ctx, copyBtn, 1300);
            copyBtn.click();
            await ctx.delay(1000);
          }
        }
      },
    },
  ],
};
