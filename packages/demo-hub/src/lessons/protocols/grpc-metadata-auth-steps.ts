/** GRPC-4 Metadata & Auth — lesson steps */
import { GRPC } from '@shared/selectors';
import type { GrpcDemoLesson } from './grpc-lesson-contract';
import { upsertWorkspaceDefaults } from '../../adapters';
import {
  GRPC_DEMO_MESSAGE,
  closeGrpcSettingsDrawerQuiet,
  ensureUnaryExecuted,
  spotlightAndPause,
  spotlightResponseJsonContentTight,
} from './grpc-lesson-helpers';
import {
  DEMO_API_KEY_NAME,
  DEMO_API_KEY_VALUE,
  DEMO_BASIC_PASSWORD,
  DEMO_BASIC_USERNAME,
  DEMO_BEARER_TOKEN,
  DEMO_ENV_AUTH_TOKEN,
  DEMO_ENV_METADATA_KEY,
  DEMO_ENV_METADATA_VALUE,
  DEMO_OAUTH2_CLIENT_ID,
  DEMO_OAUTH2_CLIENT_SECRET,
  DEMO_OAUTH2_TOKEN_URL,
  DEMO_REQUEST_ID,
  addMetadataRowQuiet,
  addMetadataRowVisible,
  clearAllMetadataRowsQuiet,
  ensureAuthReadyFast,
  ensureEchoReadyFast,
  isAuthStepAlreadyConfigured,
  openAuthTabQuiet,
  removeMetadataRowsByKey,
  resetAuthToNoneQuiet,
  selectAuthType,
  spotlightAuthField,
  spotlightMetadataRowKeyValue,
  tryFillAuthField,
  waitForIfMissing,
} from './grpc-metadata-auth-helpers';

export const grpcMetadataAuthSteps: GrpcDemoLesson['steps'] = [
    // -------------------------------------------------------------------------
    // Step 1 — Intro: gRPC session settings tour
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-intro',
      title: 'gRPC Session Settings',
      description:
        'Click the **gear icon ⚙** in the connection bar to open **gRPC session settings**. ' +
        'The panel has **five tabs**:\n\n' +
        '- **Call** — Deadline / timeout, max response size, keepalive interval\n' +
        '- **Compression** — Payload compression (gzip, deflate)\n' +
        '- **Health** — gRPC Health Protocol probe (grpc.health.v1)\n' +
        '- **K8s** — Kubernetes port-forward tunnel\n' +
        '- **Transport** — Call routing mode (Express Proxy, Tauri Native, gRPC-Web, Spring Servlet)\n\n' +
        'Watch as the demo opens gRPC session settings so you can see what options are available.\n\n' +
        'This lesson focuses on **Authentication** (Bearer, Basic, API Key, OAuth2) and the **Metadata tab** in the Call Panel. ' +
        '**Auth is not in gRPC session settings** — it lives in the **Auth tab** of the Call Panel below. ' +
        'Click the **Auth badge** in the connection bar (or the Auth tab) to open it. ' +
        'Auth settings apply per-tab — changing them on one gRPC tab does not affect others.',
      highlight: GRPC.CONNECTION_SETTINGS_BTN,
      pauseAfter: true,
      action: async (ctx) => {
        // Reading spotlight is the gear; Acting must click it visibly (not a quiet open)
        // so viewers connect the narration to the control before the settings tour.
        await spotlightAndPause(ctx, GRPC.CONNECTION_SETTINGS_BTN, 1100);
        if (!document.querySelector(GRPC.SETTINGS_DRAWER)) {
          await ctx.click(GRPC.CONNECTION_SETTINGS_BTN);
          try {
            await ctx.waitFor(GRPC.SETTINGS_DRAWER, 5_000);
          } catch {
            // Best-effort — tour skips missing tabs below.
          }
        }
        // Hold on the open panel so viewers can orient before tab tour starts.
        await ctx.delay(2200);

        // Tour all five tabs at human-friendly pacing.
        const settingsTabs: Array<'call' | 'compression' | 'health' | 'k8s' | 'transport'> = [
          'call',
          'compression',
          'health',
          'k8s',
          'transport',
        ];
        for (const tab of settingsTabs) {
          const tabSelector = GRPC.SETTINGS_NAV_ITEM(tab);
          const tabButton = document.querySelector<HTMLButtonElement>(tabSelector);
          if (!tabButton || tabButton.disabled) continue;

          await spotlightAndPause(ctx, tabSelector, 1200);
          tabButton.click();
          await ctx.delay(900);
        }

        // Keep the last tab visible a bit longer before closing.
        await ctx.delay(1400);

        // Close gRPC session settings so the call panel is fully visible for the next step.
        const closeBtn = document.querySelector<HTMLElement>(GRPC.SETTINGS_CLOSE);
        if (closeBtn) {
          closeBtn.click();
          await ctx.delay(700);
        }

        // Show destinations without changing active tab state.
        // Narrative order: Metadata first, then Authentication.
        await spotlightAndPause(ctx, GRPC.REQUEST_TAB_METADATA, 1200);
        await ctx.delay(700);
        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 1100);
        await spotlightAndPause(ctx, GRPC.REQUEST_TAB_AUTH, 1200);
      },
      verify: GRPC.CONNECTION_BAR,
    },

    // -------------------------------------------------------------------------
    // Step 2 — Metadata tab: add x-request-id header
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-metadata-add',
      title: 'Add Request Metadata',
      description:
        'In the Call Panel, click the **Metadata** tab. This editor manages the **HTTP/2 headers** sent ' +
        'alongside your RPC — every row becomes a header field.\n\n' +
        `Click **+ Add row** and fill in the new entry:\n- **Key:** \`x-request-id\`\n- **Value:** \`${DEMO_REQUEST_ID}\`\n\n` +
        'This header will appear in the **request metadata** the echo server receives. ' +
        'Use `x-request-id` for distributed tracing, `x-feature` for flag passing, or any custom header your server reads.',
      pauseAfter: false,
      preAction: async (ctx) => {
        // The Metadata editor (like the whole Call Panel composer) only renders
        // once a method is bound — otherwise it shows "select a method to edit
        // the request body". Step 1 only tours the settings drawer and never
        // selects a method, so use ensureEchoReadyFast (not ensureAuthReadyFast)
        // to bind the Echo method here. It returns fast when a method is already
        // selected, so sequential playback stays cheap.
        await ensureEchoReadyFast(ctx);
        await closeGrpcSettingsDrawerQuiet(ctx);

        // Reset auth only when it is clearly not in None mode.
        const authSelect = document.querySelector<HTMLSelectElement>(GRPC.AUTH_TYPE_SELECT);
        const authBadgeText = document.querySelector<HTMLElement>(GRPC.AUTH_BADGE)?.textContent ?? '';
        const authLooksNone = authSelect?.value === 'none' || /\bnone\b/i.test(authBadgeText);
        if (!authLooksNone) {
          await resetAuthToNoneQuiet(ctx);
          await closeGrpcSettingsDrawerQuiet(ctx);
        }

        // Resume/jump safety: clear stale metadata (especially x-api-key conflict rows)
        // so this step always demonstrates a single fresh x-request-id addition.
        await clearAllMetadataRowsQuiet(ctx);
      },
      action: async (ctx) => {
        await waitForIfMissing(ctx, GRPC.REQUEST_TAB_METADATA, 2_500);
        await ctx.click(GRPC.REQUEST_TAB_METADATA);
        await waitForIfMissing(ctx, GRPC.METADATA_EDITOR, 2_500);
        await ctx.delay(80);

        // Add the x-request-id row.
        await addMetadataRowQuiet(ctx, 'x-request-id', DEMO_REQUEST_ID);

        // Single spotlight on the final row keeps focus without rapid jumps.
        await spotlightMetadataRowKeyValue(ctx, 'x-request-id', 950);
      },
      verify: GRPC.METADATA_EDITOR,
    },

    // -------------------------------------------------------------------------
    // Step 3 — Send Echo with metadata, verify response
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-send-metadata',
      title: 'Send Call with Metadata',
      description:
        'Click **Send**. The Echo call now carries `x-request-id: lesson-4-demo` as an HTTP/2 header ' +
        'alongside the request body. The echo server returns OK — the call succeeds with your metadata attached.\n\n' +
        'Notice: the response **Body**, **Headers**, and **Trailers** tabs show the standard echo response. ' +
        'The `x-request-id` header traveled to the server as initial metadata — not reflected in the echo body ' +
        'unless the server is configured to echo headers back. This is the typical gRPC pattern: ' +
        'metadata handles infrastructure concerns (auth, tracing, routing), while the business payload stays in the message body.',
      highlight: GRPC.SEND_BTN,
      pauseAfter: true,
      preAction: async (ctx) => {
        await closeGrpcSettingsDrawerQuiet(ctx);

        const sendBtn = document.querySelector<HTMLButtonElement>(GRPC.SEND_BTN);
        let messageField = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT_MESSAGE);

        // Step 2 usually leaves the Metadata tab active; switch back to Form Input first
        // before deciding whether a heavier readiness path is needed.
        if (!messageField) {
          const formTabBtn = document.querySelector<HTMLButtonElement>(GRPC.REQUEST_TAB_FORM);
          if (formTabBtn && !formTabBtn.disabled) {
            formTabBtn.click();
            try {
              await waitForIfMissing(ctx, GRPC.PROTO_FIELD_INPUT_MESSAGE, 1_400);
            } catch {
              // Best-effort: fall through to fast readiness helper below.
            }
            messageField = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT_MESSAGE);
          }
        }

        // Fast-path: avoid replaying full target/reflect/method setup when composer is already ready.
        if (!sendBtn || !messageField) {
          await ensureEchoReadyFast(ctx);
        }

        // Ensure a message is filled so Send is enabled.
        const field = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT_MESSAGE);
        if (field && !field.value.trim()) {
          await ctx.fill(GRPC.PROTO_FIELD_INPUT_MESSAGE, GRPC_DEMO_MESSAGE);
          // Fallback: force native input/change in case synthetic fill is dropped.
          if (!field.value.trim()) {
            const valueSetter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value',
            )?.set;
            if (valueSetter) {
              valueSetter.call(field, GRPC_DEMO_MESSAGE);
            } else {
              field.value = GRPC_DEMO_MESSAGE;
            }
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await ctx.delay(300);
        }
      },
      action: async (ctx) => {
        const statusText = document.querySelector<HTMLElement>(GRPC.RESPONSE_STATUS)?.textContent ?? '';
        const hasResponseBody = Boolean(document.querySelector(GRPC.RESPONSE_BODY));
        const hasRecentSuccess = /\bOK\b/i.test(statusText) && hasResponseBody;

        if (!hasRecentSuccess) {
          await ensureUnaryExecuted(ctx);
        }

        // Spotlight the response body so the viewer sees the successful result.
        await spotlightResponseJsonContentTight(ctx, 1100);
      },
      verify: GRPC.RESPONSE_BODY,
    },

    // -------------------------------------------------------------------------
    // Step 4 — Bearer auth
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-bearer-auth',
      title: 'Bearer Token Authentication',
      description:
        'Click the **Auth badge** in the connection bar (or the **Auth** tab in the Call Panel) to open the auth settings. ' +
        'Select **Bearer Token** as the auth type. ' +
        `Fill in a demo token: \`${DEMO_BEARER_TOKEN.slice(0, 30)}…\`\n\n` +
        'RedfireForge stores the token in the **session vault** — it is never written to localStorage ' +
        'or included in collection / History exports. The **Outgoing metadata** preview at the bottom of the panel ' +
        'shows the exact header that will be sent: `authorization: bearer <token>`.\n\n' +
        'With Bearer selected, click **Send** — the `authorization` header is automatically forwarded ' +
        'by the proxy to the echo server. Most gRPC services validate it via a server-side interceptor.',
      // AUTH_BADGE is always visible in the connection bar — the natural entry point for auth settings.
      highlight: GRPC.AUTH_BADGE,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureAuthReadyFast(ctx);
      },
      action: async (ctx) => {
        const bearerReady = isAuthStepAlreadyConfigured('bearer', [
          { testId: 'grpc-auth-bearer-token', value: DEMO_BEARER_TOKEN },
        ]);

        // Spotlight the Auth badge so the viewer knows which element opens auth settings.
        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 900);

        if (!bearerReady) {
          // Click the Auth badge — this closes gRPC session settings and activates the Auth tab.
          await ctx.click(GRPC.AUTH_BADGE);
          try {
            await ctx.waitFor(GRPC.AUTH_PANEL, 5_000);
          } catch {
            // Auth panel may already be visible from a previous step.
          }
          await ctx.delay(220);

          // Spotlight the auth type dropdown before changing it.
          await spotlightAndPause(ctx, GRPC.AUTH_TYPE_SELECT, 650);
          await selectAuthType(ctx, 'bearer');
          await ctx.delay(220);

          // Fill the bearer token field.
          await spotlightAuthField(ctx, 'grpc-auth-bearer-token', 840);
          await tryFillAuthField(ctx, 'grpc-auth-bearer-token', DEMO_BEARER_TOKEN);
          await ctx.delay(260);
        }

        // Spotlight the auth preview to confirm the header was generated.
        try {
          await ctx.waitFor(GRPC.AUTH_PREVIEW, 3_000);
          await spotlightAndPause(ctx, GRPC.AUTH_PREVIEW, 900);
        } catch {
          // Preview may not render until token is filled.
          await ctx.delay(320);
        }

        // Spotlight the auth badge — it now shows "Bearer" to confirm the mode is active.
        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 900);
      },
      verify: GRPC.AUTH_BADGE,
    },

    // -------------------------------------------------------------------------
    // Step 5 — Basic auth
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-basic-auth',
      title: 'Basic Authentication',
      description:
        'Click the **Auth badge** again to return to the Auth tab. Switch the auth type to **Basic Auth**. ' +
        `Fill in **Username:** \`${DEMO_BASIC_USERNAME}\` and **Password:** \`${DEMO_BASIC_PASSWORD}\`.\n\n` +
        'RedfireForge encodes these as `authorization: basic <base64(username:password)>`. ' +
        'Use Basic auth for services that accept HTTP Basic credentials — typically internal ' +
        'APIs or legacy gRPC services that read the `authorization` header directly. ' +
        'Note: Basic auth transmits credentials on every call; prefer Bearer or OAuth2 for production.',
      // AUTH_BADGE reflects current auth type — draws attention to its updated state before changing it.
      highlight: GRPC.AUTH_BADGE,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureAuthReadyFast(ctx);
        await closeGrpcSettingsDrawerQuiet(ctx);
      },
      action: async (ctx) => {
        const basicReady = isAuthStepAlreadyConfigured('basic', [
          { testId: 'grpc-auth-basic-user', value: DEMO_BASIC_USERNAME },
          { testId: 'grpc-auth-basic-pass', value: DEMO_BASIC_PASSWORD },
        ]);

        // Spotlight auth badge first to show Bearer is active, then open auth tab.
        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 750);
        if (!basicReady) {
          await ctx.click(GRPC.AUTH_BADGE);
          try {
            await ctx.waitFor(GRPC.AUTH_PANEL, 5_000);
          } catch {
            await ctx.delay(220);
          }
          await ctx.delay(220);

          // Spotlight auth type dropdown before switching.
          await spotlightAndPause(ctx, GRPC.AUTH_TYPE_SELECT, 650);
          await selectAuthType(ctx, 'basic');
          await ctx.delay(220);

          // Fill username then password with a brief pause on each field.
          await spotlightAuthField(ctx, 'grpc-auth-basic-user', 760);
          await tryFillAuthField(ctx, 'grpc-auth-basic-user', DEMO_BASIC_USERNAME);
          await ctx.delay(260);
          await spotlightAuthField(ctx, 'grpc-auth-basic-pass', 840);
          await tryFillAuthField(ctx, 'grpc-auth-basic-pass', DEMO_BASIC_PASSWORD);
        }

        // Hold on the auth preview strip to show the base64-encoded header.
        try {
          await ctx.waitFor(GRPC.AUTH_PREVIEW, 2_000);
          await spotlightAndPause(ctx, GRPC.AUTH_PREVIEW, 900);
        } catch {
          await ctx.delay(340);
        }

        // Spotlight the auth badge so the viewer sees it now shows Basic.
        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 900);
      },
      verify: GRPC.AUTH_BADGE,
    },

    // -------------------------------------------------------------------------
    // Step 6 — API Key auth
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-api-key-auth',
      title: 'API Key Authentication',
      description:
        'Open the **Auth** tab again. Switch the auth type to **API Key**. ' +
        `Set the header name to \`${DEMO_API_KEY_NAME}\` and the key value to \`${DEMO_API_KEY_VALUE}\`.\n\n` +
        'Unlike Bearer, API Key auth lets you **choose the header name** — useful for services that ' +
        'read `x-api-key`, `x-auth-token`, or any custom key. The key is sent as a standard metadata header, ' +
        'so the server reads it the same way it reads any other gRPC request metadata.\n\n' +
        'The **Outgoing metadata** preview shows: `x-api-key: my-key-123`. In the next step you will see what happens ' +
        'when you also add this key manually in the Metadata tab.',
      highlight: GRPC.AUTH_BADGE,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureAuthReadyFast(ctx);
        await closeGrpcSettingsDrawerQuiet(ctx);
      },
      action: async (ctx) => {
        const apiKeyReady = isAuthStepAlreadyConfigured('api_key', [
          { testId: 'grpc-auth-api-key-name', value: DEMO_API_KEY_NAME },
          { testId: 'grpc-auth-api-key-value', value: DEMO_API_KEY_VALUE },
        ]);

        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 750);
        if (!apiKeyReady) {
          await ctx.click(GRPC.AUTH_BADGE);
          try {
            await ctx.waitFor(GRPC.AUTH_PANEL, 5_000);
          } catch {
            await ctx.delay(220);
          }
          await ctx.delay(220);

          await spotlightAndPause(ctx, GRPC.AUTH_TYPE_SELECT, 650);
          await selectAuthType(ctx, 'api_key');
          await ctx.delay(220);

          // Fill header name and value with a pause on each so the viewer can read them.
          await spotlightAuthField(ctx, 'grpc-auth-api-key-name', 760);
          await tryFillAuthField(ctx, 'grpc-auth-api-key-name', DEMO_API_KEY_NAME);
          await ctx.delay(260);
          await spotlightAuthField(ctx, 'grpc-auth-api-key-value', 840);
          await tryFillAuthField(ctx, 'grpc-auth-api-key-value', DEMO_API_KEY_VALUE);
        }

        // Spotlight auth preview.
        try {
          await ctx.waitFor(GRPC.AUTH_PREVIEW, 3_000);
          await spotlightAndPause(ctx, GRPC.AUTH_PREVIEW, 900);
        } catch {
          await ctx.delay(320);
        }

        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 900);
      },
      verify: GRPC.AUTH_BADGE,
    },

    // -------------------------------------------------------------------------
    // Step 7 — Conflict detection
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-conflict',
      title: 'Auth Conflict Detection',
      description:
        'The Auth tab is set to **API Key** with header `x-api-key`. ' +
        `Now click the **Metadata** tab and add another row with the same key: \`${DEMO_API_KEY_NAME}\` and a **different** value.\n\n` +
        'Studio immediately shows a **conflict warning** — the Auth tab owns `x-api-key`, so a duplicate ' +
        'manual entry would produce two headers with conflicting values. The warning prevents ' +
        'subtle bugs where the wrong key silently overrides the structured auth config.\n\n' +
        'The **Outgoing metadata** preview still shows the authoritative value from the Auth tab. ' +
        'Remove the conflicting metadata row or switch auth type to `none` to resolve it.',
      // REQUEST_TAB_METADATA is always visible and is what the viewer needs to click.
      // AUTH_CONFLICTS only exists once the conflict is triggered, so using it here
      // would leave the spotlight invisible during reading.
      highlight: GRPC.REQUEST_TAB_METADATA,
      pauseAfter: true,
      preAction: async (ctx) => {
        // Skip preAction setup if API Key auth is already configured.
        const apiKeyAlreadyConfigured = isAuthStepAlreadyConfigured('api_key', [
          { testId: 'grpc-auth-api-key-name', value: DEMO_API_KEY_NAME },
          { testId: 'grpc-auth-api-key-value', value: DEMO_API_KEY_VALUE },
        ]);
        if (apiKeyAlreadyConfigured) {
          return;
        }

        await ensureAuthReadyFast(ctx);
        await closeGrpcSettingsDrawerQuiet(ctx);

        // Ensure API Key auth is active.
        await openAuthTabQuiet(ctx);
        await selectAuthType(ctx, 'api_key');
        await tryFillAuthField(ctx, 'grpc-auth-api-key-name', DEMO_API_KEY_NAME);
        await tryFillAuthField(ctx, 'grpc-auth-api-key-value', DEMO_API_KEY_VALUE);
        // Navigate back to form tab so action starts from a clean state.
        const formTabBtn = document.querySelector<HTMLButtonElement>(GRPC.REQUEST_TAB_FORM);
        if (formTabBtn && !formTabBtn.disabled) {
          formTabBtn.click();
          await ctx.delay(40);
        }
      },
      action: async (ctx) => {
        // Beat 1 — Auth owns x-api-key (hold so viewers can read the fields).
        await openAuthTabQuiet(ctx);
        await waitForIfMissing(ctx, '[data-testid="grpc-auth-api-key-value"]', 3_000);
        await spotlightAuthField(ctx, 'grpc-auth-api-key-name', 900);
        await spotlightAuthField(ctx, 'grpc-auth-api-key-value', 1000);

        const authApiKeyValueInput = document.querySelector<HTMLInputElement>('[data-testid="grpc-auth-api-key-value"]');
        const authApiKeyValue = authApiKeyValueInput?.value.trim() ?? '';
        const conflictingMetadataValue = authApiKeyValue
          ? `${authApiKeyValue}-conflict`
          : 'conflicting-value';

        await closeGrpcSettingsDrawerQuiet(ctx);

        // Beat 2 — switch to Metadata (tab switch needs a human-readable pause).
        await spotlightAndPause(ctx, GRPC.REQUEST_TAB_METADATA, 800);
        await waitForIfMissing(ctx, GRPC.REQUEST_TAB_METADATA, 8_000);
        const metadataTabBtn = document.querySelector<HTMLButtonElement>(GRPC.REQUEST_TAB_METADATA);
        if (metadataTabBtn && !metadataTabBtn.disabled) {
          await ctx.click(GRPC.REQUEST_TAB_METADATA);
        }
        await waitForIfMissing(ctx, GRPC.METADATA_EDITOR, 5_000);
        await ctx.waitFor(GRPC.METADATA_EDITOR, 5_000);
        await ctx.delay(700);

        // Beat 3 — add a duplicate x-api-key row with a different value (visible fills).
        await removeMetadataRowsByKey(ctx, DEMO_API_KEY_NAME);
        await spotlightAndPause(ctx, GRPC.METADATA_ADD_BTN, 700);
        await addMetadataRowVisible(ctx, DEMO_API_KEY_NAME, conflictingMetadataValue);
        await spotlightMetadataRowKeyValue(ctx, DEMO_API_KEY_NAME, 900);
        await ctx.delay(800);

        // Beat 4 — outcome: Auth conflict warning (main teaching payoff).
        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 700);
        await ctx.click(GRPC.AUTH_BADGE);
        await waitForIfMissing(ctx, GRPC.AUTH_PANEL, 3_000);
        await ctx.delay(800);

        try {
          await ctx.waitFor(GRPC.AUTH_CONFLICTS, 4_000);
          await spotlightAndPause(ctx, GRPC.AUTH_CONFLICTS, 1400);
          try {
            await ctx.waitFor(GRPC.SEND_BLOCK_HINT, 1_500);
            await spotlightAndPause(ctx, GRPC.SEND_BLOCK_HINT, 1000);
          } catch {
            // Optional visual strip can be hidden in compact/mocked layouts.
          }
        } catch {
          // Conflict indicator may appear asynchronously; continue the lesson.
          await ctx.delay(400);
        }
      },
      verify: GRPC.AUTH_PANEL,
    },

    // -------------------------------------------------------------------------
    // Step 8 — OAuth2 client-credentials
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-oauth2',
      title: 'OAuth2 Client-Credentials Flow',
      description:
        'Open the **Auth** tab and select **OAuth 2.0 (Client Credentials)**. Fill in:\n\n' +
        `- **Token URL:** \`${DEMO_OAUTH2_TOKEN_URL}\`\n` +
        `- **Client ID:** \`${DEMO_OAUTH2_CLIENT_ID}\`\n` +
        '- **Client Secret:** (your secret)\n\n' +
        'RedfireForge fetches the token **server-side** before each gRPC call — the raw credentials ' +
        'never reach the browser. The access token is stored in the session secret vault and ' +
        'injected as `authorization: bearer <token>` automatically.\n\n' +
        '**Why server-side?** If the token URL were fetched directly from the browser, the client secret ' +
        'would appear in network devtools. Routing through the proxy keeps secrets server-only.',
      // AUTH_BADGE is visible after step 6 set API Key — draws the viewer's eye to
      // the current auth state before the step changes it to OAuth2.
      highlight: GRPC.AUTH_BADGE,
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureAuthReadyFast(ctx);
        await closeGrpcSettingsDrawerQuiet(ctx);
      },
      action: async (ctx) => {
        const oauthReady = isAuthStepAlreadyConfigured('oauth2', [
          { testId: 'grpc-auth-oauth-token-url', value: DEMO_OAUTH2_TOKEN_URL },
          { testId: 'grpc-auth-oauth-client-id', value: DEMO_OAUTH2_CLIENT_ID },
          { testId: 'grpc-auth-oauth-client-secret', value: DEMO_OAUTH2_CLIENT_SECRET },
        ]);

        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 750);
        if (!oauthReady) {
          await ctx.click(GRPC.AUTH_BADGE);
          try {
            await ctx.waitFor(GRPC.AUTH_PANEL, 5_000);
          } catch {
            await ctx.delay(220);
          }
          await ctx.delay(220);

          await spotlightAndPause(ctx, GRPC.AUTH_TYPE_SELECT, 650);
          await selectAuthType(ctx, 'oauth2');
          await ctx.delay(220);

          // Fill token URL and client ID with a pause on each field.
          await spotlightAuthField(ctx, 'grpc-auth-oauth-token-url', 760);
          await tryFillAuthField(ctx, 'grpc-auth-oauth-token-url', DEMO_OAUTH2_TOKEN_URL);
          await ctx.delay(260);
          await spotlightAuthField(ctx, 'grpc-auth-oauth-client-id', 760);
          await tryFillAuthField(ctx, 'grpc-auth-oauth-client-id', DEMO_OAUTH2_CLIENT_ID);
          await ctx.delay(260);
          await spotlightAuthField(ctx, 'grpc-auth-oauth-client-secret', 840);
          await tryFillAuthField(ctx, 'grpc-auth-oauth-client-secret', DEMO_OAUTH2_CLIENT_SECRET);
          await ctx.delay(500);
        }

        await spotlightAndPause(ctx, GRPC.AUTH_BADGE, 900);
      },
      verify: GRPC.AUTH_BADGE,
    },

    // -------------------------------------------------------------------------
    // Step 9 — Env-var interpolation in metadata
    // -------------------------------------------------------------------------
    {
      id: 'grpc18-env-var',
      title: 'Environment Variables in Metadata',
      description:
        'Open the **Metadata** tab again. Add a new row:\n\n' +
        `- **Key:** \`${DEMO_ENV_METADATA_KEY}\`\n` +
        `- **Value:** \`${DEMO_ENV_METADATA_VALUE}\`\n\n` +
        'The `{{authToken}}` template resolves against the **active environment**. ' +
        'The **Interpolation Preview Strip** below the target field shows the resolved value — ' +
        'or an orange **Interpolation Error** banner if `authToken` is missing from the environment.\n\n' +
        'In production, define `authToken` as a **Custom Variable** inside your microservice Configure panel ' +
        '(one value per environment — `local`, `staging`, `production`). The Workspace Defaults section ' +
        'provides a global fallback for the same key.\n\n' +
        'This pattern lets you drive metadata values from environment configs: switch environments and ' +
        'the metadata values update automatically without editing the call. Use `{{grpcHost}}` in the ' +
        'target, `{{authToken}}` in metadata, and `{{userId}}` in the request body for fully ' +
        'environment-driven gRPC calls. Then click **Send Unary** and confirm the **Response Body** renders successfully.',
      pauseAfter: true,
      preAction: async (ctx) => {
        await ensureEchoReadyFast(ctx);
        // Reset auth to none for a clean final state.
        await resetAuthToNoneQuiet(ctx);
        // Seed interpolation env for deterministic lesson playback.
        upsertWorkspaceDefaults({ authToken: DEMO_ENV_AUTH_TOKEN });

        // Ensure a message is filled so Send is enabled when the step fires.
        const field = document.querySelector<HTMLInputElement>(GRPC.PROTO_FIELD_INPUT_MESSAGE);
        if (field && !field.value.trim()) {
          await ctx.fill(GRPC.PROTO_FIELD_INPUT_MESSAGE, GRPC_DEMO_MESSAGE);
          // Fallback: force native input/change in case synthetic fill is dropped.
          if (!field.value.trim()) {
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (valueSetter) {
              valueSetter.call(field, GRPC_DEMO_MESSAGE);
            } else {
              field.value = GRPC_DEMO_MESSAGE;
            }
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await ctx.delay(300);
        }
      },
      action: async (ctx) => {
        // Spotlight the Metadata tab before clicking.
        await spotlightAndPause(ctx, GRPC.REQUEST_TAB_METADATA, 850);
        await ctx.waitFor(GRPC.REQUEST_TAB_METADATA, 8_000);
        await ctx.click(GRPC.REQUEST_TAB_METADATA);
        await ctx.waitFor(GRPC.METADATA_EDITOR, 5_000);
        await ctx.delay(500);

        // Spotlight the + Add row button before clicking.
        await spotlightAndPause(ctx, GRPC.METADATA_ADD_BTN, 750);

        // Ensure this step visibly demonstrates adding the row even on replay.
        await removeMetadataRowsByKey(ctx, DEMO_ENV_METADATA_KEY);
        await ctx.delay(120);

        // Add {{authToken}} metadata row.
        await addMetadataRowQuiet(ctx, DEMO_ENV_METADATA_KEY, DEMO_ENV_METADATA_VALUE);
        await ctx.delay(500);

        // Spotlight the entire metadata row (key + value) to highlight the template.
        await spotlightMetadataRowKeyValue(ctx, DEMO_ENV_METADATA_KEY, 1050);
        await ctx.delay(300);

        // Spotlight the value field where the {{authToken}} template is visible.
        await spotlightAndPause(
          ctx,
          `[data-testid="grpc-metadata-row-value-${DEMO_ENV_METADATA_KEY}"]`,
          1_300
        );

        // Now highlight the interpolation preview or error banner showing the resolved value.
        const hasPreview = document.querySelector(GRPC.INTERPOLATION_PREVIEW_STRIP);
        const hasErrorBanner = document.querySelector(GRPC.INTERPOLATION_ERROR_BANNER);

        if (hasPreview) {
          await spotlightAndPause(ctx, GRPC.INTERPOLATION_PREVIEW_STRIP, 1_200);
          await ctx.delay(200);
          // Highlight the template part of the preview.
          await spotlightAndPause(ctx, GRPC.INTERPOLATION_PREVIEW_TEMPLATE, 800);
          await ctx.delay(200);
          // Highlight the resolved part.
          await spotlightAndPause(ctx, GRPC.INTERPOLATION_PREVIEW_VALUE, 1000);
        } else if (hasErrorBanner) {
          await spotlightAndPause(ctx, GRPC.INTERPOLATION_ERROR_BANNER, 1_200);
        } else {
          await ctx.delay(600);
        }

        // Send Unary and focus Response Body as the user-visible result for this final step.
        await ctx.delay(300);
        const sendBtn = document.querySelector<HTMLButtonElement>(GRPC.SEND_BTN);
        if (sendBtn && !sendBtn.disabled) {
          await spotlightAndPause(ctx, GRPC.SEND_BTN, 850);
          await ctx.click(GRPC.SEND_BTN);
        } else {
          await ensureUnaryExecuted(ctx);
        }

        await ctx.waitFor(GRPC.RESPONSE_PANEL, 8_000);
        await ctx.waitFor(GRPC.RESPONSE_BODY, 8_000);
        await spotlightResponseJsonContentTight(ctx, 1100);
      },
      verify: GRPC.RESPONSE_BODY,
    },
];
