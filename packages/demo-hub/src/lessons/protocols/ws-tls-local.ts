/**
 * Lesson: Local TLS Echo Server (Docker)
 *
 * Viewer arc (one idea per step, one payoff highlight per action):
 *  Phase 1 — Skip certificate validation
 *    1. Fill wss://localhost:8766 → TLS bar
 *    2. Enable skip-cert → Proxy badge
 *    3. Connect + Send echo
 *  Phase 2 — CA certificate validation
 *    4. Paste Root CA PEM
 *    5. Connect + Send (chain enforced)
 *  Phase 3 — Mutual TLS
 *    6. Switch URL to mTLS server (8768)
 *    7. Paste client cert + key → mTLS badge
 *    8. Connect + Send (mutual auth)
 *
 * Docker:
 *   TLS echo   → wss://localhost:8766  [docker-compose.tls.yml]
 *   mTLS echo  → wss://localhost:8768  [docker-compose.mtls.yml]
 * Health: http://localhost:8767 (gate) / http://localhost:8769 (mTLS)
 */
import type { DemoActionContext, DemoLesson } from '../../types';
import { applyWsTlsConfig, prepareWsTlsLessonQuiet } from '../../adapters';
import { showSpotlightRing } from '../../demoRipple';
import {
  closeExtraConnectionTabs,
  disconnectWebSocket,
  clearEvents,
  resetAuth,
  clearCustomHeaders,
  switchToClientModeQuiet,
  fillControlledInput,
  firstVisibleEl,
} from '../setup-helpers';
import { WS } from '@shared/selectors';
import { firstVisibleElement } from '../../utils/domVisibility';
import {
  WS_TLS_DEMO_CA_CERT as DEV_CA_CERT,
  WS_TLS_DEMO_CLIENT_CERT as DEV_CLIENT_CERT,
  WS_TLS_DEMO_CLIENT_KEY as DEV_CLIENT_KEY,
} from './ws-tls-demo-certs';

const TLS_URL = 'wss://localhost:8766';
const MTLS_URL = 'wss://localhost:8768';

const HOLD = {
  look: 1000,
  beat: 700,
  outcome: 1200,
};

/** One steady ring + pause. Never stack a second hold on the same target. */
async function spotlightHold(
  ctx: DemoActionContext,
  el: HTMLElement | null | undefined,
  holdMs: number = HOLD.look,
): Promise<void> {
  if (!el) return;
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const remove = showSpotlightRing(el, { steady: true });
  try {
    await ctx.delay(holdMs);
  } finally {
    remove();
  }
}

async function waitConnected(ctx: DemoActionContext, maxTicks = 40): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (firstVisibleElement(WS.STATUS_CONNECTED)) return true;
    await ctx.delay(250);
  }
  return !!firstVisibleElement(WS.STATUS_CONNECTED);
}

// ── Quiet guards (no ripples — preAction / setup only) ─────────────

async function ensureConnectTab(ctx: DemoActionContext): Promise<void> {
  firstVisibleEl<HTMLElement>(WS.MODE_CLIENT)?.click();
  await ctx.delay(80);
  firstVisibleEl<HTMLElement>(WS.LEFT_TAB_CONNECT)?.click();
  await ctx.delay(80);
}

async function ensureTlsUrl(ctx: DemoActionContext, url: string): Promise<void> {
  await ensureConnectTab(ctx);
  const urlInput = firstVisibleElement<HTMLInputElement>(WS.URL_INPUT);
  if (urlInput && urlInput.value !== url) {
    fillControlledInput(urlInput, url);
    await ctx.delay(150);
  }
}

async function ensureTlsPanelExpanded(ctx: DemoActionContext): Promise<void> {
  await ctx.waitFor(WS.TLS_TOGGLE, 2000);
  if (firstVisibleElement(WS.TLS_BODY)) return;
  const toggle = firstVisibleElement<HTMLElement>(WS.TLS_TOGGLE);
  if (toggle) {
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await ctx.waitFor(WS.TLS_BODY, 2000);
  }
}

async function closeTlsModal(ctx: DemoActionContext): Promise<void> {
  const closeBtn = firstVisibleElement<HTMLElement>(WS.TLS_CLOSE);
  if (!closeBtn) return;
  closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20 && !!firstVisibleElement(WS.TLS_BODY); i++) {
    await ctx.delay(50);
  }
  await ctx.delay(80);
}

async function setSkipCert(ctx: DemoActionContext, checked: boolean): Promise<void> {
  await ctx.waitFor(`${WS.TLS_SKIP_CERT} input[type="checkbox"]`, 2000);
  const checkbox = firstVisibleElement<HTMLInputElement>(`${WS.TLS_SKIP_CERT} input[type="checkbox"]`);
  if (!checkbox || checkbox.checked === checked) return;
  checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await ctx.delay(150);
}

async function openTlsEditorQuiet(ctx: DemoActionContext, url: string): Promise<void> {
  await ensureTlsUrl(ctx, url);
  await disconnectWebSocket(ctx);
  await ctx.delay(120);
  await ensureTlsPanelExpanded(ctx);
  await ctx.waitFor(WS.TLS_CA_CERT, 2000);
}

/**
 * Live PEM paste. Pass `ring: false` when step.highlight already covers the field.
 */
async function pastePemField(
  ctx: DemoActionContext,
  selector: string,
  pem: string,
  opts: { ring?: boolean } = {},
): Promise<void> {
  const withRing = opts.ring !== false;
  await ctx.waitFor(selector, 2000);
  const field = firstVisibleElement<HTMLTextAreaElement>(selector);
  if (!field) return;
  field.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const remove = withRing ? showSpotlightRing(field, { steady: true }) : () => {};
  try {
    await ctx.delay(HOLD.beat);
    fillControlledInput(field, pem);
    await ctx.delay(HOLD.outcome);
  } finally {
    remove();
  }
}

async function quietClick(selector: string, ctx: DemoActionContext): Promise<void> {
  const el = firstVisibleElement<HTMLElement>(selector);
  if (!el) return;
  el.click();
  await ctx.delay(HOLD.beat);
}

/** Connect → optional echo → return to Connect → one Proxy badge hold. */
async function connectSendAndShowProxy(
  ctx: DemoActionContext,
  messageJson: string,
): Promise<void> {
  await ctx.click(WS.CONNECT_BTN);
  const ok = await waitConnected(ctx);
  if (ok) {
    firstVisibleEl<HTMLElement>(WS.LEFT_TAB_SEND)?.click();
    await ctx.delay(HOLD.beat);
    const msgInput = firstVisibleElement<HTMLTextAreaElement | HTMLInputElement>(WS.MESSAGE_INPUT);
    if (msgInput) {
      fillControlledInput(msgInput, messageJson);
      await ctx.delay(HOLD.look);
    }
    await ctx.click(WS.SEND_BTN);
    await ctx.delay(1200);
    firstVisibleEl<HTMLElement>(WS.LEFT_TAB_CONNECT)?.click();
    await ctx.delay(HOLD.beat);
  }
  await spotlightHold(ctx, firstVisibleElement<HTMLElement>(WS.TRANSPORT_BADGE), HOLD.outcome);
}

// ── Setup / Cleanup ────────────────────────────────────────────────

async function localTlsSetupDomFallback(ctx: DemoActionContext): Promise<void> {
  await switchToClientModeQuiet(ctx);
  await disconnectWebSocket(ctx);
  await closeExtraConnectionTabs(ctx);
  await clearEvents(ctx);
  await resetAuth(ctx);
  await clearCustomHeaders(ctx);

  const sub = firstVisibleEl<HTMLInputElement>(WS.SUBPROTOCOLS);
  if (sub) fillControlledInput(sub, '');
  firstVisibleEl<HTMLElement>(WS.LEFT_TAB_CONNECT)?.click();
  await ctx.delay(60);
  firstVisibleEl<HTMLElement>(WS.RIGHT_TAB_EVENTS)?.click();
  await ctx.delay(60);

  const url = firstVisibleEl<HTMLInputElement>(WS.URL_INPUT);
  if (url) fillControlledInput(url, '');
  await ctx.delay(60);
}

async function localTlsSetup(ctx: DemoActionContext): Promise<void> {
  if (prepareWsTlsLessonQuiet()) {
    await ctx.delay(120);
    return;
  }
  await localTlsSetupDomFallback(ctx);
}

async function localTlsCleanup(ctx: DemoActionContext): Promise<void> {
  if (prepareWsTlsLessonQuiet()) {
    await ctx.delay(80);
    return;
  }
  await switchToClientModeQuiet(ctx);
  firstVisibleEl<HTMLElement>(WS.LEFT_TAB_CONNECT)?.click();
  await ctx.delay(60);
  await disconnectWebSocket(ctx);
  await clearEvents(ctx);
  const url = firstVisibleEl<HTMLInputElement>(WS.URL_INPUT);
  if (url) fillControlledInput(url, '');
  const sub = firstVisibleEl<HTMLInputElement>(WS.SUBPROTOCOLS);
  if (sub) fillControlledInput(sub, '');
  await closeExtraConnectionTabs(ctx);
}

// ── Lesson Definition ──────────────────────────────────────────────

export const wsTlsLocalLesson: DemoLesson = {
  id: 'ws-tls-local',
  domainId: 'protocols',
  category: 'websocket',
  name: 'Local TLS Echo Server (Docker)',
  description:
    'Three phases of TLS against a real local server in Docker: skip-cert validation, CA certificate chain, and Mutual TLS (mTLS) with a client certificate.',
  estimatedMinutes: 8,
  tag: '🐳 Docker',
  initialTab: 'websocket-studio',
  skipStudioTabIsolation: true,

  dockerEndpoint: 'http://localhost:8767',
  dockerCommand:
    'cd docker/websocket && ./generate-cert.sh && ./generate-client-cert.sh && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d',

  setup: localTlsSetup,
  cleanup: localTlsCleanup,

  concept: {
    title: 'TLS in Three Phases — Local Docker Server',
    body: `This lesson uses a **real local TLS server** in Docker — no external dependencies, no external risk. It works on **both Web and Tauri desktop** — the transport mechanism differs by platform:

| Platform | Transport | How TLS options are applied |
|----------|-----------|----------------------------|
| **Web browser** | Node.js Proxy | \`npm run server\` opens the TLS connection server-side and bridges the browser |
| **Tauri desktop** | Native (Rust) | The Rust client applies TLS options directly — **no proxy required** |

The server uses a **self-signed certificate** from a dev Root CA, exactly what you encounter in staging environments with internal PKI. RedfireForge supports three TLS approaches via its **TLS / mTLS Configuration** panel:

| Phase | Approach | Use case |
|-------|----------|----------|
| **1** | **Skip certificate validation** — \`rejectUnauthorized: false\` | Local dev, quick iteration |
| **2** | **CA Certificate** — paste root CA PEM | Staging / internal PKI environments |
| **3** | **Mutual TLS (mTLS)** — client cert + key | APIs that verify client identity |

**Prerequisites — Web browser**
1. \`npm run server\` — starts Node.js proxy on port 3001 (required for browser TLS)
2. \`cd docker/websocket && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d\`
   (TLS certs are pre-bundled in the repo and Learning Hub.)

**Prerequisites — Tauri desktop** *(no proxy needed)*
1. Use **Start Stack** in the lesson gate, or:
   \`cd docker/websocket && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d\``,
    diagram: `<svg viewBox="0 -10 720 390" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="tls-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--primary)"/>
    </marker>
    <marker id="tls-arrow-warn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--warning, #f59e0b)"/>
    </marker>
    <marker id="tls-arrow-tauri" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--success, #10b981)"/>
    </marker>
  </defs>

  <!-- ══ LEFT COLUMN ══ -->

  <!-- Web Browser box -->
  <rect x="20" y="52" width="130" height="62" rx="6" fill="var(--primary)" opacity="0.15" stroke="var(--primary)" stroke-width="1.5"/>
  <text x="85" y="76" text-anchor="middle" fill="var(--text)" font-size="12" font-family="system-ui" font-weight="600">Web Browser</text>
  <text x="85" y="92" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">/api/ws/connect</text>
  <text x="85" y="106" text-anchor="middle" fill="var(--primary)" font-size="9" font-family="system-ui">→ via Proxy</text>

  <!-- Tauri Desktop box -->
  <rect x="20" y="243" width="130" height="62" rx="6" fill="var(--success, #10b981)" opacity="0.12" stroke="var(--success, #10b981)" stroke-width="1.5"/>
  <text x="85" y="267" text-anchor="middle" fill="var(--text)" font-size="12" font-family="system-ui" font-weight="600">Tauri Desktop</text>
  <text x="85" y="283" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">Rust WebSocket</text>
  <text x="85" y="297" text-anchor="middle" fill="var(--success, #10b981)" font-size="9" font-family="system-ui">→ Native (no proxy)</text>

  <!-- ══ MIDDLE COLUMN ══ -->

  <!-- Node.js Proxy box (browser only) -->
  <rect x="208" y="44" width="155" height="85" rx="6" fill="rgba(59,130,246,0.08)" stroke="var(--primary)" stroke-width="1.5" stroke-dasharray="4 2"/>
  <text x="285" y="67" text-anchor="middle" fill="var(--text)" font-size="12" font-family="system-ui" font-weight="600">Node.js Proxy</text>
  <text x="285" y="83" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">npm run server</text>
  <text x="285" y="98" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">port 3001</text>
  <text x="285" y="120" text-anchor="middle" fill="var(--primary)" font-size="9" font-family="system-ui" opacity="0.7">TLS settings applied here</text>

  <!-- "Direct — no proxy" label between proxy box and Tauri path -->
  <text x="285" y="210" text-anchor="middle" fill="var(--success, #10b981)" font-size="9" font-family="system-ui" opacity="0.7" font-style="italic">direct — no proxy</text>

  <!-- ══ RIGHT COLUMN ══ -->

  <!-- Phase 1+2 badge -->
  <rect x="452" y="5" width="70" height="18" rx="9" fill="var(--primary)" opacity="0.2"/>
  <text x="487" y="18" text-anchor="middle" fill="var(--primary)" font-size="10" font-weight="600">Phase 1+2</text>

  <!-- nginx TLS proxy box -->
  <rect x="450" y="28" width="205" height="65" rx="6" fill="var(--accent, #8b5cf6)" opacity="0.12" stroke="var(--accent, #8b5cf6)" stroke-width="1.5"/>
  <text x="552" y="50" text-anchor="middle" fill="var(--text)" font-size="12" font-family="system-ui" font-weight="600">nginx TLS Proxy</text>
  <text x="552" y="67" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">wss://localhost:8766</text>
  <text x="552" y="83" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui" opacity="0.7">docker-compose.tls.yml</text>

  <!-- Phase 3 badge -->
  <rect x="452" y="215" width="60" height="18" rx="9" fill="var(--warning, #f59e0b)" opacity="0.2"/>
  <text x="482" y="228" text-anchor="middle" fill="var(--warning, #f59e0b)" font-size="10" font-weight="600">Phase 3</text>

  <!-- nginx mTLS proxy box -->
  <rect x="450" y="238" width="205" height="80" rx="6" fill="var(--warning, #f59e0b)" opacity="0.1" stroke="var(--warning, #f59e0b)" stroke-width="1.5"/>
  <text x="552" y="260" text-anchor="middle" fill="var(--text)" font-size="12" font-family="system-ui" font-weight="600">nginx mTLS Proxy</text>
  <text x="552" y="277" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">wss://localhost:8768</text>
  <text x="552" y="294" text-anchor="middle" fill="var(--warning, #f59e0b)" font-size="9" font-family="system-ui" font-weight="500">ssl_verify_client on</text>
  <text x="552" y="310" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui" opacity="0.7">docker-compose.mtls.yml</text>

  <!-- ══ ARROWS — Browser path (blue, solid) ══ -->

  <!-- Web Browser → Node.js Proxy -->
  <line x1="150" y1="83" x2="208" y2="83" stroke="var(--primary)" stroke-width="1.5" marker-end="url(#tls-arrow)"/>

  <!-- Node.js Proxy → nginx TLS (Phase 1+2) -->
  <line x1="363" y1="68" x2="450" y2="53" stroke="var(--primary)" stroke-width="1.5" marker-end="url(#tls-arrow)"/>

  <!-- Node.js Proxy → nginx mTLS (Phase 3) -->
  <line x1="363" y1="108" x2="450" y2="255" stroke="var(--warning, #f59e0b)" stroke-width="1.5" marker-end="url(#tls-arrow-warn)"/>

  <!-- ══ ARROWS — Tauri path (green, dashed) ══ -->

  <!-- Tauri → nginx TLS (Phase 1+2): route right past proxy, then up -->
  <path d="M150,265 L408,265 L408,60 L450,60" fill="none" stroke="var(--success, #10b981)" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#tls-arrow-tauri)"/>

  <!-- Tauri → nginx mTLS (Phase 3): straight across below proxy box -->
  <line x1="150" y1="277" x2="450" y2="277" stroke="var(--success, #10b981)" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#tls-arrow-tauri)"/>

  <!-- ══ LEGEND ══ -->
  <line x1="20" y1="355" x2="45" y2="355" stroke="var(--primary)" stroke-width="1.5"/>
  <text x="50" y="358" fill="var(--text-muted)" font-size="9" font-family="system-ui">Web (via Node.js proxy)</text>
  <line x1="205" y1="355" x2="230" y2="355" stroke="var(--success, #10b981)" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="235" y="358" fill="var(--text-muted)" font-size="9" font-family="system-ui">Tauri (native, direct)</text>

  <!-- Echo server label -->
  <text x="552" y="335" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="system-ui">&#x2193; jmalloc/echo-server (ws://localhost:8080)</text>
</svg>`,
  },

  steps: [
    // ═══════════════════════════════════════════════════════════════
    // PHASE 1 — Skip Certificate Validation
    // ═══════════════════════════════════════════════════════════════

    {
      id: 'local-tls-url',
      title: 'Phase 1 — The Local TLS Server',
      description:
        'We fill `wss://localhost:8766` — the local nginx reverse proxy with a self-signed certificate. Watch the **TLS / mTLS** bar appear under Connect. That bar only shows for `wss://` URLs; we configure it next.',
      highlight: WS.URL_INPUT,
      preAction: async (ctx) => {
        await ensureConnectTab(ctx);
        await closeTlsModal(ctx);
        const url = firstVisibleEl<HTMLInputElement>(WS.URL_INPUT);
        if (url?.value) fillControlledInput(url, '');
      },
      action: async (ctx) => {
        // One fill under the reading ring — no clear/refill flash.
        const url = firstVisibleElement<HTMLInputElement>(WS.URL_INPUT);
        if (url) {
          fillControlledInput(url, TLS_URL);
          await ctx.delay(HOLD.look);
        }
        await spotlightHold(ctx, firstVisibleElement<HTMLElement>(WS.TLS_TOGGLE), HOLD.outcome);
      },
      verify: WS.TLS_TOGGLE,
      pauseAfter: true,
    },

    {
      id: 'local-tls-skip-cert',
      title: 'Skip Certificate Validation',
      description:
        'Open **Configure** and check **Skip certificate validation** (`rejectUnauthorized: false`). Browsers cannot bypass TLS checks in Direct mode, so RedfireForge routes through the **Proxy** transport. Watch the transport badge become **Proxy**. Use this only for local/staging smoke tests — Phase 2 trusts a real CA instead.',
      highlight: WS.TLS_SKIP_CERT,
      preAction: async (ctx) => {
        await openTlsEditorQuiet(ctx, TLS_URL);
        await setSkipCert(ctx, false);
      },
      action: async (ctx) => {
        // Reading ring is already on the checkbox — toggle without a second ring.
        if (!firstVisibleElement(WS.TLS_BODY)) await openTlsEditorQuiet(ctx, TLS_URL);
        await setSkipCert(ctx, true);
        applyWsTlsConfig({ rejectUnauthorized: false });
        await ctx.delay(HOLD.beat);
        await quietClick(WS.TLS_CLOSE, ctx);
        await spotlightHold(ctx, firstVisibleElement<HTMLElement>(WS.TRANSPORT_BADGE), HOLD.outcome);
      },
      pauseAfter: true,
    },

    {
      id: 'local-tls-connect',
      title: 'Connect & Echo — Phase 1 Confirmed',
      description:
        'Click **Connect**. The proxy accepts the self-signed cert — status **Connected**, transport **Proxy**. We send a short echo, then return to Connect so you can read the badge.',
      highlight: WS.CONNECT_BTN,
      preAction: async (ctx) => {
        await closeTlsModal(ctx);
        await ensureTlsUrl(ctx, TLS_URL);
        await disconnectWebSocket(ctx);
        // Ensure skip-cert is on if the viewer skipped the prior action.
        applyWsTlsConfig({ rejectUnauthorized: false });
        await closeTlsModal(ctx);
      },
      action: async (ctx) => {
        await connectSendAndShowProxy(
          ctx,
          '{"phase":1,"method":"skip-cert","msg":"Hello over local TLS!"}',
        );
      },
      verify: WS.STATUS_CONNECTED,
      pauseAfter: true,
    },

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2 — CA Certificate Validation
    // ═══════════════════════════════════════════════════════════════

    {
      id: 'local-tls-ca-intro',
      title: 'Phase 2 — CA Certificate Validation',
      description:
        'Turn off skip-cert and paste the **Root CA** that signed the server certificate. The proxy verifies the chain — production-grade trust for internal PKI, without accepting a rogue cert. The modal stays open so you can see the PEM.',
      highlight: WS.TLS_CA_CERT,
      preAction: async (ctx) => {
        await openTlsEditorQuiet(ctx, TLS_URL);
        await setSkipCert(ctx, false);
        const ca = firstVisibleElement<HTMLTextAreaElement>(WS.TLS_CA_CERT);
        if (ca?.value?.trim()) fillControlledInput(ca, '');
        const cert = firstVisibleElement<HTMLTextAreaElement>(WS.TLS_CLIENT_CERT);
        if (cert?.value?.trim()) fillControlledInput(cert, '');
        const key = firstVisibleElement<HTMLTextAreaElement>(WS.TLS_CLIENT_KEY);
        if (key?.value?.trim()) fillControlledInput(key, '');
      },
      action: async (ctx) => {
        if (!firstVisibleElement(WS.TLS_BODY)) await openTlsEditorQuiet(ctx, TLS_URL);
        // Reading ring already on CA — paste without a second ring.
        await pastePemField(ctx, WS.TLS_CA_CERT, DEV_CA_CERT, { ring: false });
        applyWsTlsConfig({
          rejectUnauthorized: true,
          caCert: DEV_CA_CERT,
          clientCert: '',
          clientKey: '',
        });
        const saveBtn = firstVisibleElement<HTMLButtonElement>(WS.TLS_SAVE);
        if (saveBtn && !saveBtn.disabled) await quietClick(WS.TLS_SAVE, ctx);
      },
      verify: WS.TLS_CA_CERT,
      pauseAfter: true,
    },

    {
      id: 'local-tls-ca-connect',
      title: 'Connect with CA Certificate',
      description:
        'Click **Connect**. The proxy validates the server leaf against your Root CA — chain OK → **Connected** / **Proxy**. Unlike Phase 1, a server with a different CA would be rejected.',
      highlight: WS.CONNECT_BTN,
      preAction: async (ctx) => {
        await closeTlsModal(ctx);
        await ensureTlsUrl(ctx, TLS_URL);
        await disconnectWebSocket(ctx);
        applyWsTlsConfig({
          rejectUnauthorized: true,
          caCert: DEV_CA_CERT,
          clientCert: '',
          clientKey: '',
        });
        await closeTlsModal(ctx);
      },
      action: async (ctx) => {
        await connectSendAndShowProxy(
          ctx,
          '{"phase":2,"method":"ca-cert","msg":"Chain validated!"}',
        );
      },
      verify: WS.STATUS_CONNECTED,
      pauseAfter: true,
    },

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3 — Mutual TLS (mTLS)
    // ═══════════════════════════════════════════════════════════════

    {
      id: 'local-tls-mtls-intro',
      title: 'Phase 3 — Mutual TLS (mTLS)',
      description:
        'Switch the URL to the **mTLS server** at `wss://localhost:8768`. That nginx has `ssl_verify_client on` — without a client certificate the handshake fails. Next we paste client identity; CA trust for the server is applied quietly in the background.',
      highlight: WS.URL_INPUT,
      preAction: async (ctx) => {
        await closeTlsModal(ctx);
        await ensureConnectTab(ctx);
        await disconnectWebSocket(ctx);
      },
      action: async (ctx) => {
        // URL only under the reading ring — no modal open/clear/refill tour.
        const url = firstVisibleElement<HTMLInputElement>(WS.URL_INPUT);
        if (url) {
          fillControlledInput(url, MTLS_URL);
          await ctx.delay(HOLD.look);
        }
        // Quiet: keep CA for server trust; clear client fields for the next paste step.
        applyWsTlsConfig({
          rejectUnauthorized: true,
          caCert: DEV_CA_CERT,
          clientCert: '',
          clientKey: '',
        });
        await spotlightHold(ctx, firstVisibleElement<HTMLElement>(WS.TLS_TOGGLE), HOLD.outcome);
      },
      pauseAfter: true,
    },

    {
      id: 'local-tls-mtls-creds',
      title: 'Client Certificate & Private Key',
      description:
        'Paste the **Client Certificate** and matching **Client Key** (signed by the same Dev Root CA). Skip-cert stays off — mTLS needs real mutual verification. **Save** and **Close**; the TLS bar shows **mTLS**.',
      highlight: WS.TLS_CLIENT_CERT,
      preAction: async (ctx) => {
        await openTlsEditorQuiet(ctx, MTLS_URL);
        await setSkipCert(ctx, false);
        const ca = firstVisibleElement<HTMLTextAreaElement>(WS.TLS_CA_CERT);
        if (ca && !ca.value?.trim()) fillControlledInput(ca, DEV_CA_CERT);
        const cert = firstVisibleElement<HTMLTextAreaElement>(WS.TLS_CLIENT_CERT);
        if (cert?.value?.trim()) fillControlledInput(cert, '');
        const key = firstVisibleElement<HTMLTextAreaElement>(WS.TLS_CLIENT_KEY);
        if (key?.value?.trim()) fillControlledInput(key, '');
      },
      action: async (ctx) => {
        if (!firstVisibleElement(WS.TLS_BODY)) await openTlsEditorQuiet(ctx, MTLS_URL);
        await pastePemField(ctx, WS.TLS_CLIENT_CERT, DEV_CLIENT_CERT, { ring: false });
        await pastePemField(ctx, WS.TLS_CLIENT_KEY, DEV_CLIENT_KEY, { ring: true });
        applyWsTlsConfig({
          rejectUnauthorized: true,
          caCert: DEV_CA_CERT,
          clientCert: DEV_CLIENT_CERT,
          clientKey: DEV_CLIENT_KEY,
        });
        const saveBtn = firstVisibleElement<HTMLButtonElement>(WS.TLS_SAVE);
        if (saveBtn && !saveBtn.disabled) await quietClick(WS.TLS_SAVE, ctx);
        await quietClick(WS.TLS_CLOSE, ctx);
        await spotlightHold(
          ctx,
          firstVisibleElement<HTMLElement>(WS.TLS_INDICATOR)
            ?? firstVisibleElement<HTMLElement>(WS.TLS_TOGGLE),
          HOLD.outcome,
        );
      },
      verify: WS.TLS_INDICATOR,
      pauseAfter: true,
    },

    {
      id: 'local-tls-mtls-connect',
      title: 'Connect via mTLS — Phase 3 Confirmed',
      description:
        'Click **Connect**. The proxy presents your client cert; the server verifies it against the CA. Both sides authenticated — you trust the server (CA), the server trusts you (client cert). Echo confirms the encrypted round-trip.',
      highlight: WS.CONNECT_BTN,
      preAction: async (ctx) => {
        await closeTlsModal(ctx);
        await ensureTlsUrl(ctx, MTLS_URL);
        await disconnectWebSocket(ctx);
        applyWsTlsConfig({
          rejectUnauthorized: true,
          caCert: DEV_CA_CERT,
          clientCert: DEV_CLIENT_CERT,
          clientKey: DEV_CLIENT_KEY,
        });
        await closeTlsModal(ctx);
      },
      action: async (ctx) => {
        await connectSendAndShowProxy(
          ctx,
          '{"phase":3,"method":"mtls","msg":"Both sides authenticated!"}',
        );
      },
      verify: WS.STATUS_CONNECTED,
      pauseAfter: true,
    },
  ],
};
