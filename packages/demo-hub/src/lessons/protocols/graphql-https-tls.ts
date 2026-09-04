/** Lesson GQL-5: HTTPS, TLS & Certificates */
import type { DemoLesson } from '../../types';
import { GQL } from '@shared/selectors';
import {
  GQL_STUDIO_LESSON_ALLOWED_TABS,
  GQL_TLS_HTTPS_ENDPOINT,
  GQL_TLS_HEALTH_PROBE,
  GQL_TLS_DOCKER_HEALTH_PROBES,
  GQL_PLAIN_HTTP,
  GQL_TLS_BEARER_TEMPLATE,
  configureDemoTabEndpointOverride,
  ensurePlainHttpEndpoint,
  ensureTlsEndpoint,
  ensureSkipCertEnabled,
  ensureTlsSkipIntrospectOutcome,
  prepareGqltSkipIntrospectReading,
  ensureTlsCaIntrospectOutcome,
  prepareGqltCaIntrospectReading,
  ensureMtlsIntrospectOutcome,
  prepareGqltMtlsIntrospectReading,
  ensurePlainRestoreIntrospectOutcome,
  prepareGqltRestoreReading,
  runTlsIntrospectClickOnly,
  prepareGqltAuthConfigReading,
  runGqltAuthConfigAction,
  prepareGqltAuthExecReading,
  runGqltAuthExecAction,
  prepareGqltAuthObserveReading,
  runGqltAuthObserveAction,
  ensureTlsPhase2Ready,
  ensureTlsCaConfigured,
  ensureTlsCaIntrospected,
  ensureMtlsEndpoint,
  ensureMtlsPanelReady,
  ensureMtlsConfigured,
  gqlTlsLessonSetup,
  gqlTlsLessonCleanup,
  LESSON6_RV_METADATA_AUTHORIZATION_VAL,
} from './graphql-lesson-helpers';

export const gqlHttpsTlsLesson: DemoLesson = {
  id: 'gql-https-tls',
  domainId: 'protocols',
  category: 'graphql',
  name: 'HTTPS, TLS & Certificates',
  description:
    'Connect to a real HTTPS GraphQL server, bypass self-signed certificate errors with skip-cert validation, and understand how TLS protects the auth credentials you configured in GQL-4.',
  estimatedMinutes: 10,
  initialTab: 'graphql-studio',
  allowedTabs: GQL_STUDIO_LESSON_ALLOWED_TABS,
  /** Reserved demo tab slot — user workspace must stay untouched (§11.0). */
  tabBudget: 1,

  dockerEndpoint: GQL_TLS_HEALTH_PROBE,
  dockerEndpoints: [...GQL_TLS_DOCKER_HEALTH_PROBES],
  dockerCommand:
    'cd docker/graphql/tls && ./generate-cert.sh && ./generate-client-cert.sh && docker compose up -d && docker compose -f docker-compose.mtls.yml up -d',
  tag: '🐳 Docker',

  setup: gqlTlsLessonSetup,
  cleanup: gqlTlsLessonCleanup,

  concept: {
    title: 'HTTPS — Encrypted GraphQL in Transit',
    body: `Every production GraphQL API is served over **HTTPS**. GQL-4 showed how to inject credentials — but without TLS those credentials travel as plain text, readable by anyone who intercepts the connection.

**How TLS works in one paragraph:** When you connect to an HTTPS endpoint, the server presents a **certificate** signed by a **Certificate Authority (CA)**. Your client (or the proxy) verifies: *Was this certificate signed by a CA I trust? Does the hostname match? Has it expired?* Only when all three checks pass does the encrypted channel open.

**The self-signed certificate problem:** Development servers (like our port 4443) use a certificate signed by a private CA — not a public CA that browsers trust by default. Your browser would show a certificate error. RedfireForge gives you two escape hatches:

1. **Skip Certificate Validation** — the \`SSL\` toggle on the connection bar. This disables all three cert checks. Traffic is still **encrypted**, but you accept *any* server — including a rogue one. Use only on loopback for local dev.

2. **Custom CA Certificate** *(advanced)* — paste your organisation's root CA PEM. The proxy validates the full certificate chain without bypassing any checks. Safe for staging environments with internal CAs.

**How RedfireForge routes TLS traffic:** In **web mode**, the browser cannot attach custom CA or client certificates to \`fetch\`. GraphQL Studio routes \`https://\` requests through a local **Node.js proxy** (Vite \`/__proxy\` or port 3001) that applies skip-cert, CA, and mTLS settings before forwarding. In **Tauri desktop mode**, the same TLS options are applied by a **native Rust HTTP client** (rustls) — the same stack as WebSocket Studio — so mTLS on \`https://localhost:4445\` works without starting \`npm run server\`.

| Endpoint | Encryption | Certificate check |
|----------|-----------|------------------|
| \`http://localhost:4010\` | None | None |
| \`https://localhost:4443\` (skip-cert) | ✅ AES-256 | ❌ Bypassed |
| \`https://localhost:4443\` (CA cert) | ✅ AES-256 | ✅ Full chain |`,
    keyTerms: [
      {
        term: 'TLS (Transport Layer Security)',
        definition:
          'The cryptographic protocol behind HTTPS. Establishes an encrypted channel between client and server before any HTTP traffic is sent. Successor to SSL (the term "SSL" is still widely used colloquially).',
      },
      {
        term: 'Certificate Authority (CA)',
        definition:
          'A trusted organisation (DigiCert, Let\'s Encrypt, your company\'s internal PKI) that signs server certificates. The CA\'s root certificate is pre-installed in browsers and OS certificate stores.',
      },
      {
        term: 'Self-signed certificate',
        definition:
          'A certificate signed by its own private key (or a private CA) rather than a publicly trusted CA. Valid for encryption, but triggers cert errors in standard clients because no trusted CA vouches for it.',
      },
      {
        term: 'Skip certificate validation',
        definition:
          '`rejectUnauthorized: false` — bypasses hostname, chain-of-trust, and expiry checks. Traffic is still encrypted, but any server is accepted. Safe only for localhost dev.',
      },
      {
        term: 'Custom CA certificate',
        definition:
          'Paste your organisation\'s root CA PEM so the proxy can validate internal certificates without bypassing checks. Required for staging environments with private certificate authorities.',
      },
      {
        term: 'TLS proxy',
        definition:
          'Web mode routes custom TLS through Vite\'s `/__proxy` middleware or the Node.js proxy on port 3001. Tauri desktop uses native rustls for skip-cert, CA, and mTLS HTTP — no proxy required for those paths.',
      },
    ],
    diagram: `<svg viewBox="0 0 700 430" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, sans-serif">
  <!-- ── Window chrome ─────────────────────────────────────────────────────── -->
  <rect x="0" y="0" width="700" height="430" rx="10" fill="#0f172a" stroke="#3b4a60" stroke-width="1.5"/>
  <!-- Title bar -->
  <rect x="0" y="0" width="700" height="32" rx="10" fill="#1e293b"/>
  <rect x="0" y="22" width="700" height="10" fill="#1e293b"/>
  <!-- Traffic lights -->
  <circle cx="18" cy="16" r="5" fill="#ff5f57"/>
  <circle cx="34" cy="16" r="5" fill="#febc2e"/>
  <circle cx="50" cy="16" r="5" fill="#28c840"/>
  <text x="350" y="21" text-anchor="middle" fill="#a8b8cc" font-size="11" font-weight="500">GraphQL Studio — HTTPS, TLS &amp; Certificates</text>

  <!-- ── Connection bar ────────────────────────────────────────────────────── -->
  <rect x="8" y="38" width="684" height="30" rx="5" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <!-- HTTPS padlock (green, secure) -->
  <rect x="14" y="46" width="13" height="12" rx="2" fill="none" stroke="#28c840" stroke-width="1.5"/>
  <path d="M16.5 46 v-2.5 a3.5 3.5 0 0 1 7 0 v2.5" fill="none" stroke="#28c840" stroke-width="1.5"/>
  <circle cx="20.5" cy="52" r="1.5" fill="#28c840"/>
  <!-- HTTPS endpoint -->
  <rect x="34" y="42" width="360" height="22" rx="3" fill="#0f172a" stroke="#28c840" stroke-width="1.2"/>
  <text x="42" y="57" fill="#28c840" font-size="10" font-family="monospace">https://localhost:4443/graphql</text>
  <!-- Introspect -->
  <rect x="402" y="42" width="72" height="22" rx="3" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <text x="438" y="57" text-anchor="middle" fill="#a8b8cc" font-size="9">⟳ Introspect</text>
  <!-- SSL toggle — active (highlighted) -->
  <rect x="482" y="42" width="52" height="22" rx="3" fill="color-mix(in srgb, #febc2e 18%, #1e293b)" stroke="#febc2e" stroke-width="1.5"/>
  <text x="508" y="53" text-anchor="middle" fill="#febc2e" font-size="9" font-weight="600">🛡 SSL</text>
  <text x="508" y="62" text-anchor="middle" fill="#febc2e" font-size="7" font-weight="500">off</text>
  <!-- Execute -->
  <rect x="542" y="42" width="70" height="22" rx="3" fill="#3b82f6" stroke="none"/>
  <text x="577" y="57" text-anchor="middle" fill="white" font-size="10" font-weight="600">▶ Execute</text>
  <!-- Schema badge OK -->
  <rect x="620" y="42" width="62" height="22" rx="3" fill="#1a3324" stroke="#28c840" stroke-width="1"/>
  <text x="651" y="57" text-anchor="middle" fill="#28c840" font-size="9" font-weight="600">✓ Schema</text>

  <!-- ── Editor pane ─────────────────────────────────────────────────────────── -->
  <rect x="8" y="74" width="336" height="196" rx="4" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <rect x="8" y="74" width="336" height="24" rx="4" fill="#0f172a"/>
  <rect x="8" y="88" width="336" height="10" fill="#0f172a"/>
  <rect x="16" y="78" width="52" height="16" rx="3" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <text x="42" y="89" text-anchor="middle" fill="#f1f5f9" font-size="9" font-weight="600">Editor</text>
  <rect x="74" y="78" width="52" height="16" rx="3" fill="none"/>
  <text x="100" y="89" text-anchor="middle" fill="#a8b8cc" font-size="9">Builder</text>
  <!-- Code -->
  <rect x="8" y="98" width="336" height="172" fill="#0f172a"/>
  <text x="18" y="116" fill="#a8b8cc" font-size="9" opacity="0.5">1</text>
  <text x="18" y="130" fill="#a8b8cc" font-size="9" opacity="0.5">2</text>
  <text x="18" y="144" fill="#a8b8cc" font-size="9" opacity="0.5">3</text>
  <text x="34" y="116" fill="#a78bfa" font-size="10" font-family="monospace">query</text>
  <text x="70" y="116" fill="#f1f5f9" font-size="10" font-family="monospace">{</text>
  <text x="44" y="130" fill="#34d399" font-size="10" font-family="monospace">  health</text>
  <text x="34" y="144" fill="#f1f5f9" font-size="10" font-family="monospace">}</text>

  <!-- ── Response pane ───────────────────────────────────────────────────────── -->
  <rect x="350" y="74" width="342" height="196" rx="4" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <rect x="350" y="74" width="342" height="24" rx="4" fill="#0f172a"/>
  <rect x="350" y="88" width="342" height="10" fill="#0f172a"/>
  <rect x="358" y="78" width="64" height="16" rx="3" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <text x="390" y="89" text-anchor="middle" fill="#f1f5f9" font-size="9" font-weight="600">Response</text>
  <rect x="428" y="78" width="50" height="16" rx="3" fill="none"/>
  <text x="453" y="89" text-anchor="middle" fill="#a8b8cc" font-size="9">Schema</text>
  <!-- Response body -->
  <rect x="350" y="98" width="342" height="172" fill="#0f172a"/>
  <!-- Sub-tabs -->
  <rect x="358" y="104" width="38" height="14" rx="2" fill="color-mix(in srgb, #3b82f6 12%, #0f172a)"/>
  <text x="377" y="114" text-anchor="middle" fill="#3b82f6" font-size="8" font-weight="600">Body</text>
  <text x="412" y="114" fill="#a8b8cc" font-size="8">Headers</text>
  <text x="450" y="114" fill="#a8b8cc" font-size="8">Metadata</text>
  <!-- JSON response -->
  <text x="366" y="134" fill="#f1f5f9" font-size="9" font-family="monospace">{</text>
  <text x="376" y="148" fill="#a8b8cc" font-size="9" font-family="monospace">  "data": {</text>
  <text x="386" y="162" fill="#34d399" font-size="9" font-family="monospace">    "health": "ok"</text>
  <text x="376" y="176" fill="#a8b8cc" font-size="9" font-family="monospace">  }</text>
  <text x="366" y="190" fill="#f1f5f9" font-size="9" font-family="monospace">}</text>
  <!-- TLS encrypted indicator -->
  <rect x="510" y="128" width="170" height="42" rx="4" fill="color-mix(in srgb, #28c840 10%, #0f172a)" stroke="#28c840" stroke-width="1"/>
  <text x="595" y="143" text-anchor="middle" fill="#28c840" font-size="8" font-weight="600">🔒 TLS Encrypted</text>
  <text x="595" y="156" text-anchor="middle" fill="#28c840" font-size="7">AES-256 · Certificate</text>
  <text x="595" y="165" text-anchor="middle" fill="#28c840" font-size="7">verification bypassed</text>

  <!-- ── Bottom panel ────────────────────────────────────────────────────────── -->
  <rect x="8" y="276" width="684" height="26" rx="4" fill="#0f172a" stroke="#3b4a60" stroke-width="1"/>
  <text x="20" y="293" fill="#a8b8cc" font-size="8.5">Variables</text>
  <text x="68" y="293" fill="#a8b8cc" font-size="8.5">Headers</text>
  <text x="110" y="293" fill="#a8b8cc" font-size="8.5">Files</text>

  <!-- ── TLS flow diagram (lower section) ───────────────────────────────────── -->
  <text x="350" y="322" text-anchor="middle" fill="#a8b8cc" font-size="9" font-weight="600" opacity="0.7">TLS connection flow</text>

  <!-- Phase 1: https:// URL -->
  <rect x="8" y="330" width="152" height="54" rx="5" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <rect x="8" y="330" width="152" height="18" rx="5" fill="#1a3324"/>
  <rect x="8" y="340" width="152" height="8" fill="#1a3324"/>
  <text x="84" y="342" text-anchor="middle" fill="#28c840" font-size="8.5" font-weight="700">① https:// URL</text>
  <text x="84" y="356" text-anchor="middle" fill="#a8b8cc" font-size="8">Change endpoint to</text>
  <text x="84" y="366" text-anchor="middle" fill="#28c840" font-size="7.5" font-family="monospace">https://…4443/graphql</text>
  <text x="84" y="376" text-anchor="middle" fill="#a8b8cc" font-size="8">SSL toggle appears</text>

  <!-- Phase 2: Skip-cert -->
  <rect x="168" y="330" width="152" height="54" rx="5" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <rect x="168" y="330" width="152" height="18" rx="5" fill="color-mix(in srgb, #febc2e 12%, #1e293b)"/>
  <rect x="168" y="340" width="152" height="8" fill="color-mix(in srgb, #febc2e 12%, #1e293b)"/>
  <text x="244" y="342" text-anchor="middle" fill="#febc2e" font-size="8.5" font-weight="700">② SSL toggle</text>
  <text x="244" y="356" text-anchor="middle" fill="#a8b8cc" font-size="8">Click to enable</text>
  <text x="244" y="366" text-anchor="middle" fill="#a8b8cc" font-size="8">skip-cert mode</text>
  <text x="244" y="376" text-anchor="middle" fill="#a8b8cc" font-size="8">(dev only — not safe)</text>

  <!-- Phase 3: Introspect -->
  <rect x="328" y="330" width="152" height="54" rx="5" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <rect x="328" y="330" width="152" height="18" rx="5" fill="#1f3048"/>
  <rect x="328" y="340" width="152" height="8" fill="#1f3048"/>
  <text x="404" y="342" text-anchor="middle" fill="#3b82f6" font-size="8.5" font-weight="700">③ Introspect</text>
  <text x="404" y="356" text-anchor="middle" fill="#a8b8cc" font-size="8">Schema loads over</text>
  <text x="404" y="366" text-anchor="middle" fill="#a8b8cc" font-size="8">encrypted tunnel</text>
  <text x="404" y="376" text-anchor="middle" fill="#a8b8cc" font-size="8">despite self-signed cert</text>

  <!-- Phase 4: Credentials inside TLS -->
  <rect x="488" y="330" width="204" height="54" rx="5" fill="#1e293b" stroke="#3b4a60" stroke-width="1"/>
  <rect x="488" y="330" width="204" height="18" rx="5" fill="color-mix(in srgb, #34d399 12%, #1e293b)"/>
  <rect x="488" y="340" width="204" height="8" fill="color-mix(in srgb, #34d399 12%, #1e293b)"/>
  <text x="590" y="342" text-anchor="middle" fill="#34d399" font-size="8.5" font-weight="700">④ Credentials inside TLS</text>
  <text x="590" y="356" text-anchor="middle" fill="#a8b8cc" font-size="8">Auth headers travel</text>
  <text x="590" y="366" text-anchor="middle" fill="#a8b8cc" font-size="8">encrypted — never in</text>
  <text x="590" y="376" text-anchor="middle" fill="#a8b8cc" font-size="8">plain text over the wire</text>

  <!-- Flow arrows -->
  <line x1="160" y1="357" x2="168" y2="357" stroke="#3b4a60" stroke-width="1.5" marker-end="url(#arr2)"/>
  <line x1="320" y1="357" x2="328" y2="357" stroke="#3b4a60" stroke-width="1.5" marker-end="url(#arr2)"/>
  <line x1="480" y1="357" x2="488" y2="357" stroke="#3b4a60" stroke-width="1.5" marker-end="url(#arr2)"/>

  <defs>
    <marker id="arr2" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
      <polygon points="0 0,5 2.5,0 5" fill="#3b4a60"/>
    </marker>
  </defs>

  <!-- Callout from SSL toggle legend to the connection bar toggle -->
  <line x1="244" y1="330" x2="508" y2="64" stroke="#febc2e" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
</svg>`,
  },

  steps: [
    {
      id: 'gqlt-intro',
      title: 'Why GraphQL Needs HTTPS',
      description:
        'Every GraphQL API you call in production is served over **HTTPS**. In GQL-4 you configured Bearer tokens and API Keys — but without encryption those credentials travel in **plain text** across every router and switch between your machine and the server. Anyone on the same network can read them. HTTPS wraps the entire HTTP exchange in a **TLS tunnel**: the request, response, and every header (including `Authorization`) are encrypted before leaving your machine. The demo tab still points at plain `http://localhost:4010/graphql` — the next step switches to a **real local TLS server** on port 4443.',
      highlight: GQL.CONNECTION_BAR,
      pauseAfter: true,
    },

    {
      id: 'gqlt-endpoint',
      title: 'Switch to the HTTPS Endpoint',
      description:
        'Clear the endpoint field and type `https://localhost:4443/graphql`. Notice two things happen immediately: the padlock icon in the address bar turns **green** (indicating `https://` is detected), and a new **SSL** badge appears on the connection bar. This badge is hidden for plain `http://` endpoints — it only surfaces when TLS settings are relevant. The SSL badge controls whether certificate verification is active.',
      highlight: GQL.ENDPOINT_INPUT,
      preAction: ensurePlainHttpEndpoint,
      action: async (ctx) => {
        await configureDemoTabEndpointOverride(ctx, GQL_TLS_HTTPS_ENDPOINT);
        await ctx.waitFor(GQL.TLS_TOGGLE, 3000);
        await ctx.delay(800);
      },
      verify: GQL.TLS_TOGGLE,
      pauseAfter: true,
    },

    {
      id: 'gqlt-tls-panel',
      title: 'The SSL Badge — Your TLS Control',
      description:
        'The **SSL badge** on the connection bar is GraphQL Studio\'s TLS control. In its default state it shows **"SSL"** (verification enabled) — clicking it toggles to **"SSL off"** (skip-cert mode). When skip-cert is **active**, the badge turns amber and shows a struck-through shield icon to make the unsafe state visually obvious. **Why this matters:** the server at 4443 has a self-signed certificate not trusted by any public CA. With verification enabled, the connection would fail. With skip-cert, the encrypted tunnel opens anyway — identity unchecked, but data still encrypted.',
      highlight: GQL.TLS_TOGGLE,
      preAction: ensureTlsEndpoint,
      pauseAfter: true,
    },

    {
      id: 'gqlt-skip-cert',
      title: 'Phase 1 — Enable Skip Certificate Validation',
      description:
        'Click the **SSL badge** to enable skip-cert mode. The **TLS** button then shows an amber **Skip Verify** badge — that is the spotlighted control. What skip-cert disables: **hostname check** (server name matches cert), **chain-of-trust check** (cert signed by a trusted CA), and **expiry check**. Traffic is still encrypted with AES-256 — skip-cert removes *identity verification*, not encryption. In web mode, Studio routes the request through a local Node.js proxy that sets `rejectUnauthorized: false`. **Only use this on loopback (localhost) where you control the server.**',
      highlight: GQL.TLS_INDICATOR_SKIP,
      preAction: ensureTlsEndpoint,
      action: async (ctx) => {
        await ensureSkipCertEnabled(ctx);
        await ctx.delay(600);
      },
      verify: GQL.TLS_INDICATOR_SKIP,
      pauseAfter: true,
    },

    {
      id: 'gqlt-connect-skip',
      title: 'Introspect Over TLS (Phase 1)',
      description:
        'Click **Introspect** to start the TLS handshake with skip-cert enabled. The request goes through the local proxy with `rejectUnauthorized: false` — watch the button ripple; the outcome appears in the next step.',
      highlight: GQL.INTROSPECT_BTN,
      preAction: prepareGqltSkipIntrospectReading,
      action: async (ctx) => {
        await runTlsIntrospectClickOnly(ctx);
        await ctx.delay(800);
      },
      verify: GQL.INTROSPECT_BTN,
      pauseAfter: true,
    },

    {
      id: 'gqlt-observe-skip',
      title: 'Schema Loaded Over Encrypted TLS',
      description:
        'Despite the self-signed certificate, the schema loads and the green **✓ Schema** badge appears. The connection IS encrypted (your query and response are ciphertext on the wire), but the *identity* of the server was accepted without cryptographic proof. In a real attack scenario, a man-in-the-middle server could impersonate `localhost:4443` and you would never know — which is why skip-cert is forbidden in production.',
      highlight: GQL.SCHEMA_BADGE_OK,
      preAction: ensureTlsSkipIntrospectOutcome,
      action: async (ctx) => {
        await ctx.delay(1200);
      },
      verify: GQL.SCHEMA_BADGE_OK,
      pauseAfter: true,
    },

    {
      id: 'gqlt-auth-tls-config',
      title: 'Wire Bearer Auth for TLS',
      description:
        'The **Demo** environment stores `authToken = lesson6-demo-jwt` so Bearer auth can use the `{{authToken}}` placeholder. ' +
        'Open the **Auth** bottom tab → select **Bearer Token** → enter `' + GQL_TLS_BEARER_TEMPLATE + '`. ' +
        'Watch the footer preview resolve the placeholder to `Authorization: Bearer lesson6-demo-jwt` **before** you execute — that is the same env-variable pattern from GQL-4.',
      highlight: GQL.AUTH_BEARER_INPUT,
      preAction: prepareGqltAuthConfigReading,
      action: async (ctx) => {
        await runGqltAuthConfigAction(ctx);
      },
      verify: GQL.AUTH_BEARER_INPUT,
      pauseAfter: true,
    },

    {
      id: 'gqlt-auth-tls-exec',
      title: 'Execute Over Encrypted TLS',
      description:
        'Click **Execute** to send the `health` query over the TLS tunnel on port **4443**. ' +
        'The response you see is decrypted by Studio for display — on the wire it was ciphertext. ' +
        'The next step opens **Metadata** so you can inspect exactly what left your machine inside that tunnel.',
      highlight: GQL.EXECUTE_BTN,
      preAction: prepareGqltAuthExecReading,
      action: async (ctx) => {
        await runGqltAuthExecAction(ctx);
      },
      verify: GQL.RESPONSE_VIEWER,
      pauseAfter: true,
    },

    {
      id: 'gqlt-auth-tls-observe',
      title: 'Credentials Encrypted Inside TLS',
      description:
        'The spotlighted **Authorization** row in **Metadata → Request headers** shows `Bearer lesson6-demo-jwt` — the env variable resolved before send. ' +
        'What you are reading is the *decoded* header logged by Studio for debugging. ' +
        'On the wire, that entire value was encrypted inside the TLS tunnel. **Mental model:** HTTPS does not hide credentials from your screen — it protects them *in transit* so they cannot be intercepted between your machine and the server.',
      highlight: LESSON6_RV_METADATA_AUTHORIZATION_VAL,
      preAction: prepareGqltAuthObserveReading,
      action: async (ctx) => {
        await runGqltAuthObserveAction(ctx);
      },
      verify: LESSON6_RV_METADATA_AUTHORIZATION_VAL,
      pauseAfter: true,
    },

    {
      id: 'gqlt-ca-cert',
      title: 'Phase 2 — Paste the CA Certificate',
      description:
        'Skip-cert is a dev-only shortcut. Watch each change in order: click **TLS** → **Configure** to open the certificate modal, then **uncheck** skip certificate validation — the connection bar **SSL** badge returns to verification-on (no longer amber). Paste the **GraphQL Dev Root CA** PEM into the **CA Certificate** field (the same root CA that signed the server cert at `docker/graphql/tls/certs/ca.crt`). The demo pauses so you can read the certificate block. Click **Close** when done — the TLS badge should read **Custom CA** (not Skip Verify). The next step uses **Introspect** — not Execute — to reload the schema with full chain validation.',
      highlight: GQL.TLS_CONFIGURE,
      preAction: ensureTlsPhase2Ready,
      action: async (ctx) => {
        await ensureTlsCaConfigured(ctx, { visible: true });
      },
      verify: GQL.TLS_INDICATOR_CA,
      pauseAfter: true,
    },

    {
      id: 'gqlt-connect-ca',
      title: 'Introspect With CA Validation (Phase 2)',
      description:
        'Click **Introspect** (not Execute — schema reload needs a fresh TLS handshake with your CA). Watch the ripple on the button; full certificate validation runs on the next beat.',
      highlight: GQL.INTROSPECT_BTN,
      preAction: prepareGqltCaIntrospectReading,
      action: async (ctx) => {
        await runTlsIntrospectClickOnly(ctx);
        await ctx.delay(800);
      },
      verify: GQL.INTROSPECT_BTN,
      pauseAfter: true,
    },

    {
      id: 'gqlt-observe-ca',
      title: 'Full Chain Validation — Schema Confirmed',
      description:
        'The connection succeeds with **full certificate validation** — hostname, chain-of-trust, and expiry are all checked against the CA you pasted. The green **✓ Schema** badge confirms the server\'s identity was cryptographically verified, not merely accepted. This is how staging environments with internal CAs work in production.',
      highlight: GQL.SCHEMA_BADGE_OK,
      preAction: ensureTlsCaIntrospectOutcome,
      action: async (ctx) => {
        await ctx.delay(1200);
      },
      verify: GQL.SCHEMA_BADGE_OK,
      pauseAfter: true,
    },

    {
      id: 'gqlt-mtls-intro',
      title: 'Phase 3 — Switch to the mTLS Endpoint',
      description:
        '**Mutual TLS (mTLS)** adds a second layer: the server verifies **your** identity too. Change the endpoint to `https://localhost:4445/graphql` — a separate Docker proxy that **requires** a client certificate. The schema panel may briefly show an error until client credentials are pasted in the next step — that is expected. Open **TLS → Configure**, keep skip-cert **off**, and confirm the **CA Certificate** is still set (the mTLS server uses the same private CA).',
      highlight: GQL.ENDPOINT_INPUT,
      preAction: ensureTlsCaIntrospected,
      action: async (ctx) => {
        await ensureMtlsEndpoint(ctx);
      },
      verify: GQL.TLS_CONFIGURE,
      pauseAfter: true,
    },

    {
      id: 'gqlt-mtls-creds',
      title: 'Paste Client Certificate & Key',
      description:
        'Open **TLS → Configure** and scroll to **Client Identity (mTLS)**. The demo pauses at each step so you can follow along: it confirms the **CA Certificate** is still set, then pastes the pre-bundled **client certificate** PEM, then the **private key** PEM. The cert proves who you are; the key proves you own that cert. Watch the TLS indicator update to **mTLS**, then click **Close**.',
      highlight: GQL.TLS_CLIENT_CERT,
      preAction: ensureMtlsPanelReady,
      action: async (ctx) => {
        await ensureMtlsConfigured(ctx, { visible: true });
      },
      verify: GQL.TLS_INDICATOR_MTLS,
      pauseAfter: true,
    },

    {
      id: 'gqlt-mtls-connect',
      title: 'Introspect Over mTLS (Phase 3)',
      description:
        'Click **Introspect**. The proxy will present your client certificate to the server at port 4445 — watch the button; the three-way trust outcome appears next.',
      highlight: GQL.INTROSPECT_BTN,
      preAction: prepareGqltMtlsIntrospectReading,
      action: async (ctx) => {
        await runTlsIntrospectClickOnly(ctx);
        await ctx.delay(800);
      },
      verify: GQL.INTROSPECT_BTN,
      pauseAfter: true,
    },

    {
      id: 'gqlt-observe-mtls',
      title: 'mTLS Handshake Complete',
      description:
        'The server verified your client certificate was signed by the same CA, and only then returned the schema. **Three-way trust** is now complete: you verified the server (CA cert), the server verified you (client cert), and all traffic remains AES-256 encrypted. This is how zero-trust service meshes authenticate GraphQL gateways.',
      highlight: GQL.SCHEMA_BADGE_OK,
      preAction: ensureMtlsIntrospectOutcome,
      action: async (ctx) => {
        await ctx.delay(1200);
      },
      verify: GQL.SCHEMA_BADGE_OK,
      pauseAfter: true,
    },

    {
      id: 'gqlt-restore',
      title: 'Restore to Plain HTTP',
      description:
        'Change the endpoint back to `http://localhost:4010/graphql` and click **Introspect**. The TLS badge will disappear — plain HTTP endpoints have no TLS controls.',
      highlight: GQL.ENDPOINT_INPUT,
      preAction: prepareGqltRestoreReading,
      action: async (ctx) => {
        await configureDemoTabEndpointOverride(ctx, GQL_PLAIN_HTTP);
        await ctx.delay(500);
        await runTlsIntrospectClickOnly(ctx);
        await ctx.delay(800);
      },
      verify: GQL.ENDPOINT_INPUT,
      pauseAfter: true,
    },

    {
      id: 'gqlt-observe-restore',
      title: 'Plain HTTP Schema Reloaded',
      description:
        'The schema reloads instantly with no certificate to validate — green **✓ Schema** on a plain `http://` endpoint. **When is plain HTTP acceptable?** Only on **loopback** (localhost / 127.0.0.1), when no credentials are involved, and only for local dev. The moment your traffic crosses a network boundary, touches real auth tokens, or reaches a public server — switch to HTTPS.',
      highlight: GQL.SCHEMA_BADGE_OK,
      preAction: ensurePlainRestoreIntrospectOutcome,
      action: async (ctx) => {
        await ctx.delay(1200);
      },
      verify: GQL.SCHEMA_BADGE_OK,
      pauseAfter: true,
    },
  ],
};
