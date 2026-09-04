/**
 * Lesson K12: TLS-Encrypted Cluster
 *
 * Shows how to create a cluster config with TLS enabled (SASL + TLS),
 * paste the demo CA PEM, disable certificate verification for the self-signed
 * stack, save, test (✓ Verified), connect, and publish over TLS.
 */
import type { DemoLesson } from '../../types';
import { kafkaTlsSetup } from '../setup-helpers';
import { deleteKafkaClusterByName } from '../../adapters/kafkaStudioAdapter';
import { showSpotlightRing } from '../../demoRipple';
import { KAFKA } from '@shared/selectors';

/** Demo Root CA from `docker/kafka/tls/certs/ca.crt` (self-signed RedfireForge-CA). */
export const KAFKA_TLS_DEMO_CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIDmTCCAoGgAwIBAgIUHsOgAtX/IVBgTYe/+QjgGuxhyOgwDQYJKoZIhvcNAQEL\nBQAwXDELMAkGA1UEBhMCVVMxDTALBgNVBAgMBFRlc3QxDTALBgNVBAcMBFRlc3Qx\nFTATBgNVBAoMDFJlZGZpcmVGb3JnZTEYMBYGA1UEAwwPUmVkZmlyZUZvcmdlLUNB\nMB4XDTI2MDkwMjEyMjc1MVoXDTM2MDgzMDEyMjc1MVowXDELMAkGA1UEBhMCVVMx\nDTALBgNVBAgMBFRlc3QxDTALBgNVBAcMBFRlc3QxFTATBgNVBAoMDFJlZGZpcmVG\nb3JnZTEYMBYGA1UEAwwPUmVkZmlyZUZvcmdlLUNBMIIBIjANBgkqhkiG9w0BAQEF\nAAOCAQ8AMIIBCgKCAQEAq4BVWWVDg8LqJnMXBMJJeVM2mt3Jc0+pHv44ggZhiUpY\n9wh56xNlDGpGl1UkrOYBjQz1rtPfZiddwafloWVbSR2oj6lI3jNnobThQ9SyvPT+\nD5XRy1SL5XbhOJxWdpOXHRqU7CLs9VahKZagNCTU0JkPg/6ty+QfpPpncrIC+rVy\nO0PAy/bGiMJuF1zmyFivqhqHT7C7gXIuoNt3elsGy18k+q8eonSv5caojCGR69At\nu7O15agE5ntz+PGaX/yGtJYsvexiA3DraVHRPGjUUKOfwu4xInKEzEdYRnW9+Rg8\nsprvueKZxmR+PsHlKwy3EEjUB0HReu7Vq3EMMtK5uwIDAQABo1MwUTAdBgNVHQ4E\nFgQULaCwAZ3YW31s5KfWePOD8pjyXPgwHwYDVR0jBBgwFoAULaCwAZ3YW31s5KfW\nePOD8pjyXPgwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEADj3M\nYIcm72WaozoTzYM9zvEA8GNVgdLgLDv7G1yFYyvKeCjVCdlMaFGhYC9DXOrttBpp\nZyiuALW8VY5JOM7XIqI+w/+0mObJaTFq5uxmEmJMFfHDd5kTBfTt/yhyZgyDvQQl\nU2Hf+/7fmxvXie+2UrlltkuRJOYodl5GYa2lsFzklAdqao0NN8f0WQdMPENLjD7r\nxCKzO6OPQjYtb8SExJ2r9uGaPyjzr0+Eg0rOfDpdzYB5NJPNOUmsrpnXADDcOPlh\n95OkmY6iS4D8uaubFarrRFgVvYSM7W9O4Lx/Xskx9SZ1GjMznh2YO8m2bpF6MIMV\nbGyxfQNs/uOYaVuPlA==\n-----END CERTIFICATE-----";

export const kafkaTlsLesson: DemoLesson = {
  id: 'kafka-tls',
  domainId: 'protocols',
  category: 'kafka',
  name: 'TLS-Encrypted Cluster',
  description:
    'Add TLS encryption on top of SASL authentication: enable the TLS toggle, paste the demo CA, skip certificate verification for the self-signed stack, save, test, connect, and publish over TLS.',
  estimatedMinutes: 5,
  initialTab: 'kafka-settings',
  allowedTabs: ['kafka-settings', 'kafka-message-studio'],

  dockerEndpoint: 'http://localhost:19648',
  dockerCommand: 'cd docker/kafka/tls && docker compose up -d',
  tag: '🐳 Docker',

  setup: kafkaTlsSetup,
  cleanup: async () => { deleteKafkaClusterByName('Local TLS'); },

  concept: {
    title: 'TLS Encryption for Kafka',
    body: `SASL protects **who** can connect. TLS protects **what** travels over the wire — it encrypts the connection so no one can sniff credentials or message payloads in transit.

**TLS in Kafka works like HTTPS:**
1. The broker presents an X.509 certificate during the TLS handshake
2. The client validates the certificate against a trusted CA
3. If valid, an encrypted channel is established
4. All data (including SASL credentials and message payloads) flows over that encrypted channel

**Self-signed certificates (development):**
The demo TLS stack uses a self-signed certificate — one not issued by a public CA. Paste the demo **CA PEM** and uncheck **Verify server certificate** so the handshake succeeds locally.

> ⚠️ Skip cert verification only for development/local stacks. Production clusters should use certificates from a trusted CA (or your organisation's internal CA).

**TLS vs SASL+TLS:**
| Mode | Encryption | Authentication |
|---|---|---|
| Plain | ❌ | ❌ |
| SASL only | ❌ | ✅ |
| TLS only | ✅ | ❌ |
| SASL + TLS | ✅ | ✅ |

The demo TLS stack runs SASL/SCRAM-256 on an TLS-encrypted port **19095** — the most secure combination. Client certificate fields stay empty (the stack does not require mTLS).`,
    keyTerms: [
      {
        term: 'TLS',
        definition:
          'Transport Layer Security — a cryptographic protocol that encrypts the connection between client and server. All data (including credentials) is encrypted in transit.',
      },
      {
        term: 'X.509 Certificate',
        definition:
          'A digital certificate that proves the identity of the broker. Signed by a Certificate Authority (CA) — or self-signed for development.',
      },
      {
        term: 'CA PEM',
        definition:
          'The Certificate Authority public certificate in PEM format. Paste it into the cluster editor so the client can trust the broker certificate chain.',
      },
      {
        term: 'Skip Certificate Verification',
        definition:
          'Unchecking Verify server certificate disables CA/hostname checking during the TLS handshake. Use only with trusted self-signed development environments.',
      },
    ],
    diagram: `<svg viewBox="0 0 380 130" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="25" width="100" height="80" rx="5" fill="var(--surface2,#1e1e2e)" stroke="var(--border,#45475a)" stroke-width="1.3"/>
  <text x="58" y="48" text-anchor="middle" fill="var(--text)" font-size="10">RedfireForge</text>
  <text x="58" y="62" text-anchor="middle" fill="var(--text-muted)" font-size="8">TLS handshake</text>
  <text x="58" y="74" text-anchor="middle" fill="var(--text-muted)" font-size="8">SCRAM-256 auth</text>
  <text x="58" y="86" text-anchor="middle" fill="var(--primary)" font-size="8">🔒 Encrypted</text>
  <text x="58" y="98" text-anchor="middle" fill="var(--text-muted)" font-size="7">CA PEM + skip verify</text>
  <line x1="108" y1="55" x2="200" y2="55" stroke="var(--success,#a6e3a1)" stroke-width="2" stroke-dasharray="5 2" marker-end="url(#tls-a)"/>
  <text x="154" y="48" text-anchor="middle" fill="var(--success,#a6e3a1)" font-size="7">Encrypted tunnel</text>
  <line x1="200" y1="75" x2="108" y2="75" stroke="var(--success,#a6e3a1)" stroke-width="2" stroke-dasharray="5 2" marker-end="url(#tls-b)"/>
  <text x="154" y="90" text-anchor="middle" fill="var(--success,#a6e3a1)" font-size="7">Broker response</text>
  <rect x="202" y="25" width="100" height="80" rx="5" fill="var(--surface2,#1e1e2e)" stroke="var(--success,#a6e3a1)" stroke-width="1.5"/>
  <text x="252" y="48" text-anchor="middle" fill="var(--text)" font-size="10">Redpanda</text>
  <text x="252" y="62" text-anchor="middle" fill="var(--text-muted)" font-size="8">:19095</text>
  <text x="252" y="76" text-anchor="middle" fill="var(--success,#a6e3a1)" font-size="8">SASL + TLS</text>
  <text x="252" y="90" text-anchor="middle" fill="var(--text-muted)" font-size="8">Self-signed cert</text>
  <rect x="314" y="40" width="58" height="50" rx="4" fill="var(--success,#a6e3a1)" opacity="0.1" stroke="var(--success,#a6e3a1)" stroke-width="1"/>
  <text x="343" y="62" text-anchor="middle" fill="var(--success,#a6e3a1)" font-size="12">🔐</text>
  <text x="343" y="76" text-anchor="middle" fill="var(--text-muted)" font-size="7">Auth +</text>
  <text x="343" y="87" text-anchor="middle" fill="var(--text-muted)" font-size="7">Encrypted</text>
  <defs>
    <marker id="tls-a" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="var(--success,#a6e3a1)" stroke-width="1.3"/></marker>
    <marker id="tls-b" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M6,0 L0,3 L6,6" fill="none" stroke="var(--success,#a6e3a1)" stroke-width="1.3"/></marker>
  </defs>
</svg>`,
  },

  steps: [
    {
      id: 'tls-intro',
      title: 'TLS-Encrypted Cluster',
      description:
        'Adding TLS on top of SASL gives you encryption in transit — no one can sniff your messages or credentials on the network. In this lesson you\'ll configure a new cluster for the TLS-enabled stack running on port **19095**. Make sure the TLS Docker stack is up: `cd docker/kafka/tls && docker compose up -d`. ' +
        'Click **New Cluster** to open a fresh Cluster Editor.',
      highlight: KAFKA.NEW_CLUSTER_BTN,
      preAction: async () => {
        document.querySelectorAll('.kafka-cluster-card.selected').forEach((el) => {
          el.classList.remove('selected');
        });
      },
      action: async (ctx) => {
        await ctx.waitFor(KAFKA.SETTINGS_PAGE, 3000);
        await ctx.click(KAFKA.NEW_CLUSTER_BTN);
        await ctx.delay(400);
      },
    },

    {
      id: 'tls-broker',
      title: 'Set Broker and Name',
      description:
        'Set the **Name** to `Local TLS` and the **Broker** to `127.0.0.1:19095`. Port 19095 is the TLS-enabled listener on the demo stack.',
      highlight: KAFKA.BROKER_INPUT,
      preAction: async (ctx) => {
        const nameInput = document.querySelector<HTMLInputElement>('input[placeholder*="cluster" i], input[placeholder*="name" i], #kafka-cluster-name');
        if (nameInput) {
          nameInput.focus();
          nameInput.value = '';
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await ctx.fill('input[placeholder*="cluster" i], input[placeholder*="name" i], #kafka-cluster-name', 'Local TLS');
          await ctx.delay(100);
        }
        await ctx.fill(KAFKA.BROKER_INPUT, '127.0.0.1:19095');
        await ctx.delay(200);
      },
    },

    {
      id: 'tls-auth',
      title: 'Configure SASL Auth',
      description:
        'Set **Auth Mode** to **SCRAM-SHA-256** and fill in the credentials: **Username** `redfireforge-app`, **Password** `app-password`. The TLS stack uses the same SASL users as the SASL-only stack.',
      highlight: KAFKA.AUTH_TYPE_SELECT,
      action: async (ctx) => {
        await ctx.selectOption(KAFKA.AUTH_TYPE_SELECT, 'scram-sha-256');
        await ctx.delay(300);
        await ctx.fill(KAFKA.AUTH_USER_INPUT, 'redfireforge-app');
        await ctx.delay(100);
        await ctx.fill(KAFKA.AUTH_PASS_INPUT, 'app-password');
        await ctx.delay(200);
      },
    },

    {
      id: 'tls-enable',
      title: 'Enable TLS',
      description:
        'Click the **Enable TLS** toggle to turn on encryption. This reveals the CA / client certificate fields and tells the Kafka client to use a TLS-upgraded connection.',
      highlight: KAFKA.TLS_TOGGLE,
      action: async (ctx) => {
        const toggle = document.querySelector<HTMLElement>(KAFKA.TLS_TOGGLE);
        if (toggle) {
          const checked = toggle.getAttribute('aria-checked') === 'true' || (toggle as HTMLInputElement).checked;
          if (!checked) {
            toggle.click();
            await ctx.delay(400);
          }
        }
        await ctx.waitFor(KAFKA.TLS_CA_PEM, 3000);
        await ctx.delay(300);
      },
    },

    // Step 6: CA PEM + skip verify + Save (Test Connection needs a saved cluster)
    {
      id: 'tls-ca',
      title: 'CA Certificate & Save',
      description:
        'Uncheck **Verify server certificate** (self-signed demo stack), then paste the demo **CA PEM** from `docker/kafka/tls/certs/ca.crt` into **CA PEM**. ' +
        'Client Certificate / Key stay empty — this broker does not require mTLS. ' +
        'Click **Save Cluster** so **Test Connection** becomes available (it only works against a saved selected profile).',
      highlight: KAFKA.TLS_CA_PEM,
      preAction: async (ctx) => {
        const toggle = document.querySelector<HTMLElement>(KAFKA.TLS_TOGGLE);
        if (toggle) {
          const checked = toggle.getAttribute('aria-checked') === 'true' || (toggle as HTMLInputElement).checked;
          if (!checked) {
            toggle.click();
            await ctx.waitFor(KAFKA.TLS_CA_PEM, 3000);
          }
        }
      },
      action: async (ctx) => {
        await ctx.waitFor(KAFKA.TLS_VERIFY_TOGGLE, 3000);
        const verifyToggle = document.querySelector<HTMLInputElement>(KAFKA.TLS_VERIFY_TOGGLE);
        if (verifyToggle) {
          const checked = verifyToggle.getAttribute('aria-checked') === 'true' || verifyToggle.checked;
          if (checked) {
            verifyToggle.click();
            await ctx.delay(500);
          }
        }

        await ctx.waitFor(KAFKA.TLS_CA_PEM, 3000);
        await ctx.fill(KAFKA.TLS_CA_PEM, KAFKA_TLS_DEMO_CA_PEM);
        const caEl = document.querySelector<HTMLElement>(KAFKA.TLS_CA_PEM);
        if (caEl) showSpotlightRing(caEl);
        await ctx.delay(1400);

        await ctx.waitFor(KAFKA.SAVE_BTN, 3000);
        const saveEl = document.querySelector<HTMLElement>(KAFKA.SAVE_BTN);
        if (saveEl) {
          saveEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
          const dispose = showSpotlightRing(saveEl);
          await ctx.delay(1000);
          dispose();
        }
        await ctx.click(KAFKA.SAVE_BTN);
        const start = Date.now();
        while (Date.now() - start < 8000) {
          const testBtn = document.querySelector<HTMLButtonElement>(KAFKA.TEST_BTN);
          if (testBtn && !testBtn.disabled) break;
          await ctx.delay(100);
        }
        await ctx.delay(900);
      },
      verify: KAFKA.TEST_BTN,
      pauseAfter: true,
    },

    // Step 7: Test Connection → ✓ Verified
    {
      id: 'tls-test',
      title: 'Test Connection',
      description:
        'Click **Test Connection** on the saved **Local TLS** profile. RedfireForge performs the TLS handshake (with the pasted CA / skip-verify settings) and SASL authentication. Watch for **✓ Verified** next to the button.',
      highlight: KAFKA.TEST_BTN,
      preAction: async (ctx) => {
        const testBtn = document.querySelector<HTMLButtonElement>(KAFKA.TEST_BTN);
        if (!testBtn || testBtn.disabled) {
          const saveBtn = document.querySelector<HTMLElement>(KAFKA.SAVE_BTN);
          if (saveBtn) {
            saveBtn.click();
            await ctx.delay(400);
          }
        }
        const start = Date.now();
        while (Date.now() - start < 5000) {
          const btn = document.querySelector<HTMLButtonElement>(KAFKA.TEST_BTN);
          if (btn && !btn.disabled) break;
          await ctx.delay(100);
        }
      },
      action: async (ctx) => {
        const btn = document.querySelector<HTMLButtonElement>(KAFKA.TEST_BTN);
        if (!btn || btn.disabled) {
          console.warn('[DemoHub] kafka-tls: Test Connection still disabled — Save may have failed');
          return;
        }
        await ctx.click(KAFKA.TEST_BTN);
        await ctx.waitFor(KAFKA.TEST_RESULT, 15000);
        const badge = document.querySelector<HTMLElement>(KAFKA.TEST_RESULT);
        if (badge) showSpotlightRing(badge);
        await ctx.delay(1800);
      },
      verify: KAFKA.TEST_RESULT,
      pauseAfter: 2200,
    },

    {
      id: 'tls-connect',
      title: 'Connect',
      description:
        'Click **Connect** to activate **Local TLS** as the live cluster. A green connected badge appears — Publish Studio will use this SASL + TLS connection.',
      highlight: KAFKA.CONNECT_BTN,
      preAction: async (ctx) => {
        const start = Date.now();
        while (Date.now() - start < 5000) {
          const btn = document.querySelector<HTMLButtonElement>(KAFKA.CONNECT_BTN);
          if (btn && !btn.disabled) break;
          await ctx.delay(100);
        }
      },
      action: async (ctx) => {
        const connectBtn = document.querySelector<HTMLButtonElement>(KAFKA.CONNECT_BTN);
        if (connectBtn && !connectBtn.disabled) {
          await ctx.click(KAFKA.CONNECT_BTN);
          const start = Date.now();
          while (Date.now() - start < 10000) {
            const dcBtn = document.querySelector<HTMLButtonElement>(KAFKA.DISCONNECT_BTN);
            if (dcBtn && !dcBtn.disabled) break;
            await ctx.delay(200);
          }
          await ctx.delay(900);
        }
      },
      verify: KAFKA.DISCONNECT_BTN,
      pauseAfter: true,
    },

    {
      id: 'tls-publish',
      title: 'Publish Over TLS',
      description:
        'Navigate to the **Publish** tab, set Topic to `tls.demo.orders`, and publish a message. The message travels over the encrypted TLS channel — partition and offset in the result confirm the broker accepted it.',
      highlight: KAFKA.PUB_SEND_BTN,
      preAction: async (ctx) => {
        ctx.navigateToTab('kafka-message-studio');
        await ctx.delay(500);
        await ctx.click(KAFKA.PUBLISH_TAB);
        await ctx.delay(300);
        await ctx.fill(KAFKA.PUB_TOPIC_INPUT, 'tls.demo.orders');
        await ctx.delay(100);
        await ctx.fill(KAFKA.PUB_BODY_TEXTAREA, '{"tlsTest":true,"cluster":"SCRAM-256+TLS"}');
        await ctx.delay(200);
      },
      action: async (ctx) => {
        await ctx.click(KAFKA.PUB_SEND_BTN);
        await ctx.waitFor(`${KAFKA.PUB_RESULT}, ${KAFKA.PUB_ERROR}`, 15000);
        await ctx.delay(400);
      },
    },
  ],
};
