/**
 * Lesson GRPC-20: Full Form Editor — Guided Complex Request Editing
 *
 * Introduces the Full Form Editor modal that opens from the compact JSON
 * composer on the Form Input tab.  Uses `echo.EchoService/CreateComplexEcho`
 * (Go echo fixture) to walk every field shape the editor handles:
 *   - a scalar string
 *   - a nested message (JSON sub-editor)
 *   - a repeated field
 *   - a map field
 *   - a `oneof` group
 *   - the `google.protobuf.Timestamp` well-known type
 *
 * Step map:
 *   grpc20-intro               — Form Input compact composer + Open Full Form Editor button
 *   grpc20-open-modal          — Open Full Form Editor; three tabs: Form View / Focus View / JSON View
 *   grpc20-form-view           — Form View: insight chips + guided form rows; fill scalar message
 *   grpc20-nested-message      — Nested `shipping_address` JSON sub-editor
 *   grpc20-repeated-field      — Add & remove `labels` repeated items
 *   grpc20-map-field           — Add `attributes` map entries
 *   grpc20-oneof-group         — `payment_method` oneof: card → invoice
 *   grpc20-focus-view          — Focus View: field navigator + per-field editor; set deadline
 *   grpc20-json-view           — JSON View: raw JSON + assist sidebar; prove Apply syncs back
 *   grpc20-send-verify         — Apply to Request, then Send; server echoes every field back
 */
import { GRPC } from '@shared/selectors';
import {
  buildGrpcLessonShellFromRoster,
  buildGrpcContractMetaFromRoster,
  getGrpcLessonRosterEntry,
  type GrpcDemoLesson,
} from './grpc-lesson-contract';
import { grpcProtoFormConcept } from './grpc-proto-form.content';
import {
  GRPC_ECHO_SERVICE,
  GRPC_ECHO_SERVICE_SEL,
  ensureGrpcStudioSubNavQuiet,
  grpcFirstCallCleanup,
  grpcFirstCallSetup,
  closeGrpcSettingsDrawerQuiet,
  guardGrpcTargetQuiet,
  resetGrpcConnectionSettingsQuiet,
  spotlightRequestJsonContentTight,
  spotlightResponseJsonContentTight,
  spotlightAndPause,
  spotlightElementAndPause,
  isGrpcHybridComposerActive,
} from './grpc-lesson-helpers';
import { navigateToGrpcStudio } from '../env-manager-lesson-helpers';
import type { DemoActionContext } from '../../types';

const GRPC20_ROSTER = getGrpcLessonRosterEntry('grpc-proto-form')!;

const GRPC_COMPLEX_METHOD = 'CreateComplexEcho';
const GRPC_COMPLEX_METHOD_SEL = GRPC.METHOD(GRPC_ECHO_SERVICE, GRPC_COMPLEX_METHOD);

const DEMO_MESSAGE = 'Complex echo demo';
const DEMO_MESSAGE_EDITED = 'Complex echo demo (edited via JSON)';
const DEMO_ADDRESS = { street: '500 Market St', city: 'San Francisco', country: 'USA' };
const DEMO_LABELS_STAGED = ['alpha', 'beta', 'gamma'];
const DEMO_LABELS_FINAL = ['alpha', 'gamma'];
const DEMO_ATTRIBUTES: Record<string, string> = { env: 'prod', region: 'us-east' };
const DEMO_CARD = { card_number: '4111111111111111', expiry: '12/29' };
const DEMO_INVOICE = { invoice_number: 'INV-2026-0042', due_date: '2026-08-01' };
const DEMO_DEADLINE_ISO = '2026-12-31T23:59:00.000Z';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function setInputValueQuiet(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  nativeSet?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function ensureStudioNav(ctx: DemoActionContext): Promise<void> {
  await navigateToGrpcStudio(ctx);
  await closeGrpcSettingsDrawerQuiet(ctx);
  await ensureGrpcStudioSubNavQuiet(ctx);
}

/**
 * Reflect quietly using a direct DOM click — no viewer ripple.
 *
 * The shared `guardGrpcReflectedQuiet` delegates to `ensureGrpcReflected`, which
 * calls `ctx.click(REFLECT_BTN)` — that draws a demo ripple. In a preAction (the
 * "beginning" of a step, before narration) that ripple is exactly the "quick
 * unnecessary highlight" the viewer sees flashing. A plain DOM `.click()` fires
 * the same reflect without any spotlight/ripple. Returns early when the service
 * tree is already present (steps 2+ during sequential playback).
 */
async function reflectComplexQuiet(ctx: DemoActionContext): Promise<void> {
  if (document.querySelector(GRPC.EXPLORER_TREE) || document.querySelector(GRPC.EXPLORER_SOURCE)) {
    return;
  }
  const reflectBtn = document.querySelector<HTMLButtonElement>(GRPC.REFLECT_BTN);
  if (reflectBtn && !reflectBtn.disabled) {
    reflectBtn.click();
  }
  try {
    await ctx.waitFor(`${GRPC.EXPLORER_TREE}, ${GRPC.EXPLORER_SOURCE}`, 12_000);
  } catch {
    // Remain navigable if local reflection infra is unavailable.
  }
  await ctx.delay(200);
}

async function selectComplexMethodQuiet(ctx: DemoActionContext): Promise<void> {
  await reflectComplexQuiet(ctx);
  if (
    document.querySelector(GRPC.CALL_METHOD_NAME)?.textContent?.includes(GRPC_COMPLEX_METHOD)
  ) {
    return;
  }
  if (!document.querySelector(GRPC_COMPLEX_METHOD_SEL)) {
    document.querySelector<HTMLElement>(GRPC_ECHO_SERVICE_SEL)?.click();
    await ctx.delay(120);
  }
  document.querySelector<HTMLElement>(GRPC_COMPLEX_METHOD_SEL)?.click();
  try {
    await ctx.waitFor(GRPC.REQUEST_FORM_SCROLL, 5_000);
  } catch {
    await ctx.delay(150);
  }
}

async function ensureComplexBaselineQuiet(ctx: DemoActionContext): Promise<void> {
  await ensureStudioNav(ctx);
  await resetGrpcConnectionSettingsQuiet(ctx);
  await guardGrpcTargetQuiet(ctx);
  await reflectComplexQuiet(ctx);
  await selectComplexMethodQuiet(ctx);
  // Wait for React to finish resetting the form, then pre-fill message and
  // expand nested objects so the compact JSON matches the Full Form Editor JSON View.
  await ctx.delay(300);
  const jsonTextarea = document.querySelector<HTMLTextAreaElement>('[data-testid="grpc-request-json"]');
  if (jsonTextarea) {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(jsonTextarea.value); } catch { /* ignore */ }
    let changed = false;
    if (!parsed.message) { parsed.message = DEMO_MESSAGE; changed = true; }
    // Expand nested message fields so compact JSON matches Full Form Editor JSON View
    const addr = parsed.shipping_address as Record<string, unknown> | undefined;
    if (!addr || (!addr.street && !addr.city && !addr.country && Object.keys(addr).length === 0)) {
      parsed.shipping_address = { street: '', city: '', country: '' };
      changed = true;
    }
    const card = parsed.card as Record<string, unknown> | undefined;
    if (!card || (!card.card_number && !card.expiry && Object.keys(card).length === 0)) {
      parsed.card = { card_number: '', expiry: '' };
      changed = true;
    }
    if (changed) {
      setInputValueQuiet(jsonTextarea, JSON.stringify(parsed, null, 2));
    }
  }
}

/** Close the Full Form Editor modal quietly if it is still open. */
async function closeHybridModalQuiet(ctx: DemoActionContext): Promise<void> {
  const closeBtn = document.querySelector<HTMLButtonElement>('[data-testid="grpc-hybrid-close-btn"]');
  if (!closeBtn) return;
  // If a discard-confirm is visible, dismiss it first.
  const discardClose = document.querySelector<HTMLButtonElement>('[data-testid="grpc-hybrid-close-discard-btn"]');
  if (discardClose) {
    discardClose.click();
    await ctx.delay(150);
    return;
  }
  closeBtn.click();
  await ctx.delay(150);

  // Some modal states prompt a discard-confirm only after the first close click.
  // Dismiss it here so lesson startup does not show a quick popup flicker.
  const discardAfterClose = document.querySelector<HTMLButtonElement>('[data-testid="grpc-hybrid-close-discard-btn"]');
  if (discardAfterClose) {
    discardAfterClose.click();
    await ctx.delay(150);
  }
}

/** Open the Full Form Editor from the compact JSON composer, or from the send-bar button. */
async function openHybridModalQuiet(ctx: DemoActionContext): Promise<void> {
  if (document.querySelector(GRPC.HYBRID_MODAL)) return;
  // Prefer the inline strip button (visible when form-scroll is shown); fall back to send-bar.
  const inlineBtn = document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN_INLINE)
    ?? document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN);
  if (!inlineBtn) return;
  inlineBtn.click();
  try {
    await ctx.waitFor(GRPC.HYBRID_MODAL, 5_000);
  } catch {
    await ctx.delay(400);
  }
}

/** Switch to a given modal tab quietly (does nothing if already on that tab). */
async function switchHybridTabQuiet(
  ctx: DemoActionContext,
  testId: string,
  waitForPanel: string,
): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!btn || btn.getAttribute('aria-selected') === 'true') return;
  btn.click();
  try {
    await ctx.waitFor(`[data-testid="${waitForPanel}"]`, 3_000);
  } catch {
    await ctx.delay(300);
  }
}

// ---------------------------------------------------------------------------
// Quiet field setters for preAction state reconstruction
// ---------------------------------------------------------------------------

async function ensureMessageFieldInModalQuiet(ctx: DemoActionContext, value: string): Promise<void> {
  const el = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT('message'));
  if (!el || el.value === value) return;
  setInputValueQuiet(el, value);
  await ctx.delay(80);
}

async function ensureJsonSubFieldInModalQuiet(
  ctx: DemoActionContext,
  fieldName: string,
  value: Record<string, unknown>,
): Promise<void> {
  const el = document.querySelector<HTMLTextAreaElement>(GRPC.PROTO_FIELD_INPUT(fieldName));
  if (!el) return;
  const json = JSON.stringify(value, null, 2);
  let current: unknown;
  try {
    current = JSON.parse(el.value);
  } catch {
    current = undefined;
  }
  if (JSON.stringify(current) === JSON.stringify(value)) return;
  setInputValueQuiet(el, json);
  await ctx.delay(80);
}

async function ensureRepeatedStringFieldInModalQuiet(
  ctx: DemoActionContext,
  fieldName: string,
  items: string[],
): Promise<void> {
  const countCurrent = (): number => {
    let i = 0;
    while (document.querySelector(GRPC.PROTO_FIELD_INPUT_INDEXED(fieldName, i))) i += 1;
    return i;
  };

  let count = countCurrent();
  while (count > 0) {
    const removeBtn = document.querySelector<HTMLButtonElement>(`[aria-label="Remove ${fieldName} item ${count}"]`);
    if (!removeBtn) break;
    removeBtn.click();
    count -= 1;
    await ctx.delay(50);
  }

  for (const item of items) {
    await commitRepeatedStringToken(ctx, fieldName, item);
  }
}

/** Repeated string fields use a token draft input — + Add item only commits when draft has text. */
async function commitRepeatedStringToken(
  ctx: DemoActionContext,
  fieldName: string,
  value: string,
): Promise<void> {
  const tokenSel = GRPC.PROTO_FIELD_REPEATED_TOKEN_INPUT(fieldName);
  await ctx.fill(tokenSel, value);
  await ctx.delay(80);
  await ctx.click(GRPC.PROTO_FIELD_REPEATED_ADD(fieldName));
  await ctx.delay(100);
}

async function ensureMapFieldInModalQuiet(
  ctx: DemoActionContext,
  fieldName: string,
  entries: Record<string, string>,
): Promise<void> {
  const desired = Object.entries(entries);
  const countCurrent = (): number => {
    let i = 0;
    while (document.querySelector(GRPC.PROTO_FIELD_MAP_KEY(fieldName, i))) i += 1;
    return i;
  };

  let count = countCurrent();
  while (count > desired.length) {
    const removeBtn = document.querySelector<HTMLButtonElement>(`[aria-label="Remove ${fieldName} entry ${count}"]`);
    if (!removeBtn) break;
    removeBtn.click();
    count -= 1;
    await ctx.delay(50);
  }
  while (count < desired.length) {
    const addBtn = document.querySelector<HTMLButtonElement>(GRPC.PROTO_FIELD_MAP_ADD(fieldName));
    if (!addBtn) break;
    addBtn.click();
    count += 1;
    await ctx.delay(50);
  }
  for (let idx = 0; idx < desired.length; idx += 1) {
    const [key, value] = desired[idx]!;
    const keyEl = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_MAP_KEY(fieldName, idx));
    const valueEl = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_MAP_VALUE(fieldName, idx));
    if (keyEl && keyEl.value !== key) { setInputValueQuiet(keyEl, key); await ctx.delay(50); }
    if (valueEl && valueEl.value !== value) { setInputValueQuiet(valueEl, value); await ctx.delay(50); }
  }
}

async function ensureOneofMemberInModalQuiet(
  ctx: DemoActionContext,
  oneofName: string,
  member: string,
  value: Record<string, unknown>,
): Promise<void> {
  const radio = document.querySelector<HTMLButtonElement>(GRPC.PROTO_ONEOF_RADIO(oneofName, member));
  if (radio && radio.getAttribute('aria-checked') !== 'true') {
    radio.click();
    await ctx.delay(120);
  }
  await ensureJsonSubFieldInModalQuiet(ctx, member, value);
}

/** Reconstruct modal Form View state up to the given step (1-indexed over the field-filling steps). */
async function applyFormStateInModalThroughStep(ctx: DemoActionContext, throughStep: number): Promise<void> {
  await ensureComplexBaselineQuiet(ctx);
  await openHybridModalQuiet(ctx);
  // Ensure we are on Form View.
  await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-a', 'grpc-hybrid-form-view');
  if (throughStep >= 1) await ensureMessageFieldInModalQuiet(ctx, DEMO_MESSAGE);
  if (throughStep >= 2) await ensureJsonSubFieldInModalQuiet(ctx, 'shipping_address', DEMO_ADDRESS);
  if (throughStep >= 3) await ensureRepeatedStringFieldInModalQuiet(ctx, 'labels', DEMO_LABELS_FINAL);
  if (throughStep >= 4) await ensureMapFieldInModalQuiet(ctx, 'attributes', DEMO_ATTRIBUTES);
  if (throughStep >= 5) await ensureOneofMemberInModalQuiet(ctx, 'payment_method', 'invoice', DEMO_INVOICE);
}

// ---------------------------------------------------------------------------
// Lesson
// ---------------------------------------------------------------------------

export const grpcProtoFormLesson: GrpcDemoLesson = {
  ...buildGrpcLessonShellFromRoster(GRPC20_ROSTER),
  domainId: 'protocols',
  category: 'grpc',
  description:
    'Open the **Full Form Editor** from the compact JSON composer and build a complex, deeply-typed gRPC request ' +
    'without writing raw JSON. Walk through Form View, Focus View, and JSON View to fill every field shape — ' +
    'scalar, nested message, repeated, map, oneof, and Timestamp — then apply the result to the request and send.',

  setup: async (ctx) => {
    // Skip the Manage Schemas draft reset — this lesson only covers the Full Form
    // Editor over the reflected schema, never staged schema sources. Running it
    // would open/close the Manage Schemas modal (cycling Proto Files/Protoset/URL/
    // BSR sub-tabs) for every tab, which the viewer sees as a burst of modals
    // flashing on and off before step 1.
    await grpcFirstCallSetup(ctx, { resetSchemaDrafts: false });
  },
  cleanup: async (ctx) => {
    await closeHybridModalQuiet(ctx);
    await grpcFirstCallCleanup(ctx);
  },

  grpc: buildGrpcContractMetaFromRoster(GRPC20_ROSTER),

  concept: grpcProtoFormConcept,

  steps: [
    // -------------------------------------------------------------------------
    // Step 1 — Compact JSON composer + the button
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-intro',
      title: 'Form Input: Compact JSON Composer',
      description:
        'Select `CreateComplexEcho` from the Service Explorer. When the hybrid editor is on, the **Form Input** ' +
        'tab shows a compact JSON composer instead of expanded proto-form rows — it is faster to read and works ' +
        'for simple payloads. But this method has **six typed fields**: nested messages, a repeated field, a map, ' +
        'a `oneof`, and a Timestamp. That\'s where the **Open Full Form Editor** button comes in — it launches a ' +
        'guided modal without leaving the call panel.',
      highlight: GRPC.REQUEST_FORM_SCROLL,
      pauseAfter: true,
      preAction: async (ctx) => {
        await closeHybridModalQuiet(ctx);
        await ensureStudioNav(ctx);
        await resetGrpcConnectionSettingsQuiet(ctx);
        await guardGrpcTargetQuiet(ctx);
        await reflectComplexQuiet(ctx);
        await selectComplexMethodQuiet(ctx);
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.CALL_METHOD_NAME, 750);
        await spotlightAndPause(ctx, GRPC.REQUEST_FORM_SCROLL, 850);

        if (isGrpcHybridComposerActive()) {
          await spotlightRequestJsonContentTight(ctx, 850);
          const openBtn = document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN_INLINE)
            ?? document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN);
          if (openBtn) {
            await spotlightElementAndPause(ctx, openBtn, 800);
          }
        } else {
          await spotlightAndPause(ctx, GRPC.PROTO_FORM, 750);
          const openBtn = document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN);
          if (openBtn) {
            await spotlightElementAndPause(ctx, openBtn, 800);
          }
        }
      },
      verify: GRPC.REQUEST_FORM_SCROLL,
    },

    // -------------------------------------------------------------------------
    // Step 2 — Open the Full Form Editor; tour three tabs
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-open-modal',
      title: 'Open Full Form Editor',
      description:
        'Click **Open Full Form Editor**. The modal opens over the call panel. Three tabs appear in the header: ' +
        '**Form View** (guided rows), **Focus View** (navigator + single-field detail), and **JSON View** ' +
        '(raw textarea + assist sidebar). All three edit the same working draft — switching tabs never loses your ' +
        'work. The **Apply to Request** button in the footer pushes the draft back to the compact composer.',
      highlight: GRPC.HYBRID_TAB_FORM_VIEW,
      pauseAfter: true,
      preAction: async (ctx) => {
        await closeHybridModalQuiet(ctx);
        await ensureComplexBaselineQuiet(ctx);
      },
      action: async (ctx) => {
        const openBtn = document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN_INLINE)
          ?? document.querySelector<HTMLButtonElement>(GRPC.OPEN_FULL_FORM_EDITOR_BTN);
        if (openBtn) {
          await spotlightElementAndPause(ctx, openBtn, 800);
          await ctx.click(
            document.querySelector(GRPC.OPEN_FULL_FORM_EDITOR_BTN_INLINE)
              ? GRPC.OPEN_FULL_FORM_EDITOR_BTN_INLINE
              : GRPC.OPEN_FULL_FORM_EDITOR_BTN,
          );
        }
        try { await ctx.waitFor(GRPC.HYBRID_MODAL, 5_000); } catch { await ctx.delay(400); }
        await ctx.delay(600);

        await spotlightAndPause(ctx, GRPC.HYBRID_TAB_FORM_VIEW, 800);
        await spotlightAndPause(ctx, GRPC.HYBRID_TAB_FOCUS_VIEW, 700);
        await spotlightAndPause(ctx, GRPC.HYBRID_TAB_JSON_VIEW, 700);

        // Come back to Form View.
        await ctx.click(GRPC.HYBRID_TAB_FORM_VIEW);
        try { await ctx.waitFor(GRPC.HYBRID_FORM_VIEW, 2_000); } catch { await ctx.delay(300); }
        await ctx.delay(400);
        await spotlightAndPause(ctx, GRPC.HYBRID_APPLY_BTN, 900);
      },
      verify: GRPC.HYBRID_TAB_FORM_VIEW,
    },

    // -------------------------------------------------------------------------
    // Step 3 — Form View: insight chips + scalar message
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-form-view',
      title: 'Form View: Insight Chips + Scalar Field',
      description:
        'The **insight chips** at the top of Form View give an instant read of schema complexity: how many ' +
        '`oneof` groups, map fields, and repeated fields this method has. Below them, each field gets its own ' +
        'row with a type badge and field-number note.\n\n' +
        'Fill the `message` scalar field — the simplest entry. Notice the `string` badge and the `#1 optional` ' +
        'label beside the input; every row follows this same convention, whatever its type.',
      highlight: GRPC.HYBRID_FORM_VIEW,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureComplexBaselineQuiet(ctx);
        await openHybridModalQuiet(ctx);
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-a', 'grpc-hybrid-form-view');
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.HYBRID_INSIGHT_CHIPS, 1_100);
        await spotlightAndPause(ctx, GRPC.HYBRID_FORM_VIEW, 800);

        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('message'), 800);
        await ctx.fill(GRPC.PROTO_FIELD_INPUT('message'), DEMO_MESSAGE);
        await ctx.delay(400);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD_INPUT('message'), 900);
      },
      verify: GRPC.PROTO_FIELD_INPUT('message'),
    },

    // -------------------------------------------------------------------------
    // Step 4 — Nested message: shipping_address sub-editor
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-nested-message',
      title: 'Nested Message: JSON Sub-Editor',
      description:
        'The `shipping_address` row is a nested `message` field. RedfireForge renders it as a compact **inline ' +
        'JSON textarea** — not expanded street/city/country sub-fields — so the form stays manageable even for ' +
        'arbitrarily deep schemas.\n\n' +
        'Type a JSON object with `street`, `city`, and `country` directly into the textarea. The field is live — ' +
        'the working draft updates on every keystroke.',
      highlight: GRPC.PROTO_FIELD('shipping_address'),
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureComplexBaselineQuiet(ctx);
        await openHybridModalQuiet(ctx);
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-a', 'grpc-hybrid-form-view');
        await ensureMessageFieldInModalQuiet(ctx, DEMO_MESSAGE);
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('shipping_address'), 900);
        await ctx.fill(GRPC.PROTO_FIELD_INPUT('shipping_address'), JSON.stringify(DEMO_ADDRESS, null, 2));
        await ctx.delay(500);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD_INPUT('shipping_address'), 1_100);
      },
      verify: GRPC.PROTO_FIELD_INPUT('shipping_address'),
    },

    // -------------------------------------------------------------------------
    // Step 5 — Repeated field: labels
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-repeated-field',
      title: 'Repeated Field: Add and Remove Items',
      description:
        'The `labels` row is a `repeated string`. Type each value in the **Enter labels…** draft field, then click **+ Add item** (or press Enter):\n\n' +
        '1. `alpha` → Add item\n' +
        '2. `beta` → Add item\n' +
        '3. `gamma` → Add item\n\n' +
        'Each committed value appears as a **token chip** above the draft field. Click **×** on the `beta` chip to remove it.\n\n' +
        'The remove control updates the underlying array immediately — there is no "apply" step inside the row.',
      highlight: GRPC.PROTO_GUIDED_CARD_REPEATED,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureComplexBaselineQuiet(ctx);
        await openHybridModalQuiet(ctx);
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-a', 'grpc-hybrid-form-view');
        await ensureMessageFieldInModalQuiet(ctx, DEMO_MESSAGE);
        await ensureJsonSubFieldInModalQuiet(ctx, 'shipping_address', DEMO_ADDRESS);
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.PROTO_GUIDED_CARD_REPEATED, 800);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('labels'), 750);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD_REPEATED_TOKEN_INPUT('labels'), 750);

        for (let idx = 0; idx < DEMO_LABELS_STAGED.length; idx += 1) {
          await spotlightAndPause(ctx, GRPC.PROTO_FIELD_REPEATED_TOKEN_INPUT('labels'), 500);
          await ctx.fill(GRPC.PROTO_FIELD_REPEATED_TOKEN_INPUT('labels'), DEMO_LABELS_STAGED[idx]!);
          await ctx.delay(450);
          await spotlightAndPause(ctx, GRPC.PROTO_FIELD_REPEATED_ADD('labels'), 500);
          await ctx.click(GRPC.PROTO_FIELD_REPEATED_ADD('labels'));
          const chipSel = GRPC.PROTO_FIELD_INPUT_INDEXED('labels', idx);
          try { await ctx.waitFor(chipSel, 3_000); } catch { await ctx.delay(300); }
          await spotlightAndPause(ctx, chipSel, 500);
        }

        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('labels'), 900);

        const removeBtnSel = '[aria-label="Remove labels item 2"]';
        const removeBtn = document.querySelector<HTMLButtonElement>(removeBtnSel);
        if (removeBtn) {
          await spotlightElementAndPause(ctx, removeBtn, 700);
          await ctx.click(removeBtnSel);
          await ctx.delay(400);
        }

        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('labels'), 1_000);
      },
      verify: GRPC.PROTO_FIELD('labels'),
    },

    // -------------------------------------------------------------------------
    // Step 6 — Map field: attributes
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-map-field',
      title: 'Map Field: Key-Value Entries',
      description:
        'The `attributes` row is a `map<string, string>`. Click **+ Add entry** twice, filling a key and value ' +
        'for each: `env` → `prod`, then `region` → `us-east`. Each entry is a pair of adjacent inputs with a ' +
        'remove control; the map serializes as a plain JSON object (not an array) in the wire body.',
      highlight: GRPC.PROTO_GUIDED_CARD_MAPS,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureComplexBaselineQuiet(ctx);
        await openHybridModalQuiet(ctx);
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-a', 'grpc-hybrid-form-view');
        await ensureMessageFieldInModalQuiet(ctx, DEMO_MESSAGE);
        await ensureJsonSubFieldInModalQuiet(ctx, 'shipping_address', DEMO_ADDRESS);
        await ensureRepeatedStringFieldInModalQuiet(ctx, 'labels', DEMO_LABELS_FINAL);
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.PROTO_GUIDED_CARD_MAPS, 800);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('attributes'), 800);

        const entries = Object.entries(DEMO_ATTRIBUTES);
        for (let idx = 0; idx < entries.length; idx += 1) {
          const [key, value] = entries[idx]!;
          await spotlightAndPause(ctx, GRPC.PROTO_FIELD_MAP_ADD('attributes'), 500);
          await ctx.click(GRPC.PROTO_FIELD_MAP_ADD('attributes'));

          const keySel = GRPC.PROTO_FIELD_MAP_KEY('attributes', idx);
          const valueSel = GRPC.PROTO_FIELD_MAP_VALUE('attributes', idx);
          try { await ctx.waitFor(keySel, 3_000); } catch { await ctx.delay(300); }
          await spotlightAndPause(ctx, keySel, 450);
          await ctx.fill(keySel, key);
          await ctx.delay(250);
          await spotlightAndPause(ctx, valueSel, 450);
          await ctx.fill(valueSel, value);
          await ctx.delay(300);
        }

        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('attributes'), 1_000);
      },
      verify: GRPC.PROTO_FIELD('attributes'),
    },

    // -------------------------------------------------------------------------
    // Step 7 — Oneof group: payment_method
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-oneof-group',
      title: 'Oneof Group: Mutually Exclusive Members',
      description:
        'The `payment_method` row is a `oneof` — only one member can be set at a time. Select the **card** radio ' +
        'pill: a JSON sub-editor for `CardPayment` appears. Fill `card_number` and `expiry`. Then select ' +
        '**invoice** — the card sub-editor is replaced by `InvoicePayment` and the card data is cleared, exactly ' +
        'as the proto `oneof` wire semantics require. Fill `invoice_number` and `due_date`.',
      highlight: GRPC.PROTO_ONEOF_RADIO_PAYMENT_METHOD_CARD,
      pauseAfter: true,
      preAction: async (ctx) => {
        await applyFormStateInModalThroughStep(ctx, 4);
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.PROTO_GUIDED_CARD_ONEOF('payment_method'), 850);
        await spotlightAndPause(ctx, GRPC.PROTO_ONEOF_RADIO('payment_method', 'card'), 800);
        await ctx.click(GRPC.PROTO_ONEOF_RADIO('payment_method', 'card'));
        await ctx.delay(400);
        const cardSel = GRPC.PROTO_FIELD_INPUT('card');
        try { await ctx.waitFor(cardSel, 3_000); } catch { await ctx.delay(300); }
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('card'), 700);
        await spotlightAndPause(ctx, cardSel, 700);
        await ctx.fill(cardSel, JSON.stringify(DEMO_CARD, null, 2));
        await ctx.delay(500);
        await spotlightAndPause(ctx, cardSel, 900);

        await spotlightAndPause(ctx, GRPC.PROTO_ONEOF_RADIO('payment_method', 'invoice'), 800);
        await ctx.click(GRPC.PROTO_ONEOF_RADIO('payment_method', 'invoice'));
        await ctx.delay(400);
        const invoiceSel = GRPC.PROTO_FIELD_INPUT('invoice');
        try { await ctx.waitFor(invoiceSel, 3_000); } catch { await ctx.delay(300); }
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('invoice'), 700);
        await spotlightAndPause(ctx, invoiceSel, 700);
        await ctx.fill(invoiceSel, JSON.stringify(DEMO_INVOICE, null, 2));
        await ctx.delay(500);
        await spotlightAndPause(ctx, invoiceSel, 900);
      },
      verify: GRPC.PROTO_ONEOF_RADIO_PAYMENT_METHOD_INVOICE,
    },

    // -------------------------------------------------------------------------
    // Step 8 — Focus View: navigate to deadline, set Timestamp
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-focus-view',
      title: 'Focus View: Navigate to a Single Field',
      description:
        'Switch to **Focus View**. The left panel is a searchable field navigator — every top-level field in ' +
        'the request schema is listed by name. Click `deadline` in the navigator to jump directly to its detail ' +
        'editor on the right.\n\n' +
        'The `deadline` field is a `google.protobuf.Timestamp`. RedfireForge renders it as a **plain text input** ' +
        'pre-filled with the current instant as an RFC3339/ISO8601 string. Replace it with ' +
        '`2026-12-31T23:59:00.000Z`.',
      highlight: GRPC.HYBRID_NAV_ITEM_FIELD_DEADLINE,
      pauseAfter: true,
      preAction: async (ctx) => {
        await applyFormStateInModalThroughStep(ctx, 5);
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-b', 'grpc-hybrid-option-b-view');
        const deadlineInput = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT('deadline'));
        if (deadlineInput?.value === DEMO_DEADLINE_ISO) {
          const navBtn = document.querySelector<HTMLButtonElement>(GRPC.HYBRID_NAV_ITEM_FIELD('deadline'));
          if (navBtn && navBtn.getAttribute('aria-selected') !== 'true') {
            navBtn.click();
            await ctx.delay(120);
          }
        }
      },
      action: async (ctx) => {
        if (!document.querySelector(GRPC.HYBRID_FOCUS_VIEW)) {
          await spotlightAndPause(ctx, GRPC.HYBRID_TAB_FOCUS_VIEW, 750);
          await ctx.click(GRPC.HYBRID_TAB_FOCUS_VIEW);
          try { await ctx.waitFor(GRPC.HYBRID_FOCUS_VIEW, 3_000); } catch { await ctx.delay(400); }
        }

        await spotlightAndPause(ctx, GRPC.HYBRID_FOCUS_VIEW, 800);
        await spotlightAndPause(ctx, GRPC.HYBRID_NAVIGATOR, 850);
        await spotlightAndPause(ctx, GRPC.HYBRID_NAVIGATOR_SEARCH, 700);
        await spotlightAndPause(ctx, GRPC.HYBRID_NAVIGATOR_LIST, 800);

        await spotlightAndPause(ctx, GRPC.HYBRID_NAV_ITEM_FIELD('deadline'), 900);
        await ctx.click(GRPC.HYBRID_NAV_ITEM_FIELD('deadline'));
        try { await ctx.waitFor(GRPC.HYBRID_FOCUS_EDITOR, 3_000); } catch { await ctx.delay(300); }
        await ctx.delay(400);

        await spotlightAndPause(ctx, GRPC.HYBRID_FOCUS_EDITOR, 850);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD('deadline'), 800);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD_INPUT('deadline'), 800);
        await ctx.fill(GRPC.PROTO_FIELD_INPUT('deadline'), DEMO_DEADLINE_ISO);
        await ctx.delay(450);
        await spotlightAndPause(ctx, GRPC.PROTO_FIELD_INPUT('deadline'), 1_000);
      },
      verify: GRPC.PROTO_FIELD_INPUT('deadline'),
    },

    // -------------------------------------------------------------------------
    // Step 9 — JSON View: raw JSON + assist sidebar → Apply
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-json-view',
      title: 'JSON View: Raw Draft + Assist Sidebar',
      description:
        'Switch to **JSON View**. The left side shows the raw JSON draft reflecting every field you just filled ' +
        'in Form View and Focus View. The right-side assist sidebar summarises your `oneof` branches, map entry ' +
        'counts, and repeated item counts — a safety check before you apply.\n\n' +
        'Edit the `message` value directly in the JSON to `"' + DEMO_MESSAGE_EDITED + '"`. Then click ' +
        '**Apply to Request** — the working draft is pushed back to the compact composer and the modal closes.',
      highlight: GRPC.HYBRID_JSON_VIEW,
      pauseAfter: true,
      preAction: async (ctx) => {
        await applyFormStateInModalThroughStep(ctx, 5);
        // Set deadline quietly via Focus View before switching to JSON View.
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-b', 'grpc-hybrid-option-b-view');
        document.querySelector<HTMLButtonElement>(GRPC.HYBRID_NAV_ITEM_FIELD('deadline'))?.click();
        await ctx.delay(120);
        const deadlineInput = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT('deadline'));
        if (deadlineInput) {
          setInputValueQuiet(deadlineInput, DEMO_DEADLINE_ISO);
          await ctx.delay(80);
        }
        await switchHybridTabQuiet(ctx, 'grpc-hybrid-tab-option-c', 'grpc-hybrid-json-view');
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.HYBRID_JSON_VIEW, 900);
        await spotlightAndPause(ctx, GRPC.HYBRID_JSON_EDITOR, 800);

        const jsonEl = document.querySelector<HTMLTextAreaElement>(GRPC.HYBRID_JSON_EDITOR);
        if (jsonEl) {
          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(jsonEl.value) as Record<string, unknown>; } catch { parsed = {}; }
          parsed.message = DEMO_MESSAGE_EDITED;
          await ctx.fill(GRPC.HYBRID_JSON_EDITOR, JSON.stringify(parsed, null, 2));
          await ctx.delay(500);
        }
        await spotlightAndPause(ctx, GRPC.HYBRID_JSON_EDITOR, 900);

        // Show the assist sidebar.
        const assistPanel = document.querySelector<HTMLElement>('[data-testid="grpc-hybrid-json-assist"]');
        if (assistPanel) {
          await spotlightElementAndPause(ctx, assistPanel, 900);
        }

        await spotlightAndPause(ctx, GRPC.HYBRID_APPLY_BTN, 800);
        await ctx.click(GRPC.HYBRID_APPLY_BTN);
        await ctx.delay(600);

        // Confirm the modal closed and compact composer shows the updated body.
        if (isGrpcHybridComposerActive()) {
          await spotlightRequestJsonContentTight(ctx, 900);
        } else {
          await spotlightAndPause(ctx, GRPC.PROTO_FIELD_INPUT('message'), 900);
        }
      },
      verify: GRPC.REQUEST_FORM_SCROLL,
    },

    // -------------------------------------------------------------------------
    // Step 10 — Send and verify
    // -------------------------------------------------------------------------
    {
      id: 'grpc20-send-verify',
      title: 'Send and Verify the Full Response',
      description:
        'Click **Send**. The server echoes back `request_id`, `message`, `labels`, `attributes`, ' +
        '`shipping_address`, `deadline`, and the active `payment_method` member — confirming the proto encoding ' +
        'was correct for every field shape covered in this lesson: scalar, nested message, repeated, map, oneof, ' +
        'and well-known type.',
      pauseAfter: true,
      preAction: async (ctx) => {
        // If the modal was left open, apply any remaining draft first.
        if (document.querySelector(GRPC.HYBRID_MODAL)) {
          await ctx.click(GRPC.HYBRID_APPLY_BTN);
          await ctx.delay(400);
          if (document.querySelector(GRPC.HYBRID_MODAL)) {
            await closeHybridModalQuiet(ctx);
          }
        }
        await ensureComplexBaselineQuiet(ctx);
      },
      action: async (ctx) => {
        await spotlightAndPause(ctx, GRPC.SEND_BTN, 800);
        await ctx.click(GRPC.SEND_BTN);
        try {
          await ctx.waitFor(GRPC.RESPONSE_BODY, 12_000);
        } catch {
          await ctx.waitFor(GRPC.RESPONSE_STATUS, 15_000);
        }
        await ctx.delay(600);

        await spotlightAndPause(ctx, GRPC.RESPONSE_STATUS, 800);
        await spotlightResponseJsonContentTight(ctx, 1_200);
      },
      verify: GRPC.RESPONSE_BODY,
    },
  ],
};
