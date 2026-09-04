// ── Lesson GQL-5: HTTPS, TLS & Certificates ──────────────────────────────────

import type { DemoActionContext } from '../../../types';
import { GQL } from '@shared/selectors';
import {
  GQL_HEALTH_QUERY,
  closeAuthPanelQuiet,
  configureDemoTabEndpointOverride,
  ensureAuthPanelVisible,
  ensureEditorMode,
  fillGqlEditor,
  getEndpointInput,
  getGqlEditorQuery,
  resetDemoTabToPlainHttp,
  resetGqlLessonSessionFlags,
  resetGqlLesson2SessionFlags,
  selectAuthInPanel,
} from './core';
import { resetLesson2VariablesHistoryFlags } from './lesson2-variables-history';
import { resetGqlLesson3SessionFlags } from './lesson3-mutations';
import { resetGqlLesson4SessionFlags } from './lesson4-schema-exploration';
import { resetGqlLesson5SessionFlags } from './lesson5-subscriptions';
import { resetGqlLesson6SessionFlags, LESSON6_AUTH_TOKEN_VALUE, LESSON6_RV_METADATA_AUTHORIZATION_VAL, upsertGqlDemoEnvVars } from './lesson6-auth-headers';
import { closeGqlDemoTabs, ensureGqlDemoTab, activateGqlDemoTabQuiet } from './gql-demo-tab';
import {
  applyGqlTlsSettings,
  getDemoBridgeWindow,
  loadDemoSession,
  loadTabs,
  patchDemoTabConnection,
} from '../../../adapters';
import { setControlledCheckbox } from '../../setup-helpers';
import type { GqlTlsSettings } from '@shared/types/gqlTls';

// ── Endpoints & health probe ─────────────────────────────────────────────────

/** HTTPS endpoint for the Docker TLS proxy (Phase 1 — skip-cert). */
export const GQL_TLS_HTTPS_ENDPOINT = 'https://localhost:4443/graphql';
/** HTTPS/mTLS endpoint for the Docker mTLS proxy (Phase 3 — client cert). */
export const GQL_TLS_MTLS_ENDPOINT = 'https://localhost:4445/graphql';
/** HTTP health probe for PrerequisiteGate (Phase 1 TLS stack). */
export const GQL_TLS_HEALTH_PROBE = 'http://127.0.0.1:4444/health';
/** HTTP health probe for mTLS stack on port 4445 (Phase 3). */
export const GQL_TLS_MTLS_HEALTH_PROBE = 'http://127.0.0.1:4446/health';
/** Both Docker stacks required before GQL-5 can start (TLS proxy + mTLS proxy). */
export const GQL_TLS_DOCKER_HEALTH_PROBES = [
  GQL_TLS_HEALTH_PROBE,
  GQL_TLS_MTLS_HEALTH_PROBE,
] as const;
/** Plain HTTP restore endpoint after TLS steps. */
export const GQL_PLAIN_HTTP = 'http://localhost:4010/graphql';
/** Bearer token template for auth-over-TLS step. */
export const GQL_TLS_BEARER_TEMPLATE = '{{authToken}}';

// ── Embedded TLS certificates (synced from docker/graphql/tls/certs/) ─────────

/** GraphQL Dev Root CA — validates the TLS proxy server leaf cert. */
export const GQL_TLS_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIDjzCCAnegAwIBAgIUI51WVTCTDDc27aPCbrKeNq/wtRYwDQYJKoZIhvcNAQEL
BQAwVzEhMB8GA1UEAwwYUmVkZmlyZUZvcmdlIERldiBSb290IENBMRkwFwYDVQQK
DBBSZWRmaXJlRm9yZ2UgRGV2MRcwFQYDVQQLDA5HcmFwaFFMIFN0dWRpbzAeFw0y
NjA5MDIxMjI3NTdaFw0zNjA4MzAxMjI3NTdaMFcxITAfBgNVBAMMGFJlZGZpcmVG
b3JnZSBEZXYgUm9vdCBDQTEZMBcGA1UECgwQUmVkZmlyZUZvcmdlIERldjEXMBUG
A1UECwwOR3JhcGhRTCBTdHVkaW8wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCnqziL+vcY5lPpwyx02mBdyBbcmst7rAB4ATQgGED91BtIDEl1RrgdEk0Z
mDiseiuF0OxXyUFdTK5CfVs5RScblZJqHVWwmb+NgpBHuRB2zLaRSTPYubJ0pxAY
N5SGoGWxtzjKJmOUIpYPHSRLoH4yVfQpj+M1GAZCHYG2R/BjK9qzJsgqDWajU2zG
7czzxWdiFgp3C1a0kQTzaZ4S2pLL5mZIlwrSQwR2Z/05onKvkGiiolFLiz/foBDy
r0nIRaOsUgE/BGAj8HnIJkoP+Nn88B1jEdrc3Xg4hF/H6hXRctxojvBGp+67XNMH
/+zPdJKp0dmeQc4ZsXZ4jjv6QucxAgMBAAGjUzBRMB0GA1UdDgQWBBTr8mb39SiC
EcSopPpMP0yXkyJRNDAfBgNVHSMEGDAWgBTr8mb39SiCEcSopPpMP0yXkyJRNDAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQA0gj1ccjOVkXvBra7h
Kp4dqcgCfi1hCW8J9F4CqgcYBAD8gKynltyEXM/0W8ePCZ7xquIgyVfByQxHfdpM
qGel1NVnQWvd/+zexNUnRicrHeC5gEGkh7UEUhiP9lgPaG/9A8A1STs7rYpV+t0S
SlyemjSdze27/PjLndrl9N9TFobKcyEJ30yyN9Pds6zpNTmMDYZMt4spmN7r75nF
t01AuLZO5aQOaKZVHAUTKVLijDCLaZGbvTbcOXahTw9Harws0QFzwDoVhTeLFhLh
euzkopKO3UXihf4T69QYH0XBPEj7VJjqybyiLXP1YVZHTUdYFv8UrEb4kG9gVhne
Tl1X
-----END CERTIFICATE-----`;

/** Client leaf cert signed by GraphQL Dev Root CA — for future mTLS Phase 3. */
export const GQL_TLS_CLIENT_CERT = `-----BEGIN CERTIFICATE-----
MIIDqzCCApOgAwIBAgIUbcIWrPJiucIKJ3vSPcELh8cfa1EwDQYJKoZIhvcNAQEL
BQAwVzEhMB8GA1UEAwwYUmVkZmlyZUZvcmdlIERldiBSb290IENBMRkwFwYDVQQK
DBBSZWRmaXJlRm9yZ2UgRGV2MRcwFQYDVQQLDA5HcmFwaFFMIFN0dWRpbzAeFw0y
NjA5MDIxMjI3NTdaFw0zNjA4MzAxMjI3NTdaMFcxITAfBgNVBAMMGFJlZGZpcmVG
b3JnZSBUZXN0IENsaWVudDEZMBcGA1UECgwQUmVkZmlyZUZvcmdlIERldjEXMBUG
A1UECwwOR3JhcGhRTCBTdHVkaW8wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCrjhuGVuFXI8SR5GKm7XeyVd7wQgJiwIY+1zNWgdlzQztqlxu4v/8WflJ/
bvI3sQ66CwePWWZ7TVK1/9WrZHZvc6YUvvWpYhN7yy7PVWiXg8L7uf9Nl92SMe6p
cnjLndpdK2OhQT877MvMDqv0el0dMa8Ki/ZCMSiV3d3eIkmBTVig10O/2aBw5WWD
mhAw2UhYbWAmjKIyubCm1NsHgiFyWoHdwoNWX6iWR+pRjJsmA86wmYdB69WcRfrM
2OerkL7JzoRfpTFx7TPf1dIx013EE3FwWDOhHXpnqs6xXnET7FyHWqbqkozIyd/b
I+9lcFiEY0PhdWn9eVgimGNYHx8DAgMBAAGjbzBtMAkGA1UdEwQCMAAwCwYDVR0P
BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMCMB0GA1UdDgQWBBSnWBnAQ1cboNI1
4qmsCKK03UV6jDAfBgNVHSMEGDAWgBTr8mb39SiCEcSopPpMP0yXkyJRNDANBgkq
hkiG9w0BAQsFAAOCAQEAILdRgaM1DtKgteoqnnGHLTsPo361hDBam4udlPZau7P4
q+QCw3hpDe8t57/LwOWUm5uz6cnrGj2gDzjjqTTTUsBI9OHq+8fkoOOjhoaf9uDg
e/PCM6+a8DrilT46GeHV2McU3C2iiAI3U/b+fA8UGPZRJOowIbljLc2vs/5Z2z3Q
URKlCxN+NWejtScH4x8/AuBSn0qZriZ8Z+CL+8y7yI2bkNdLevR9kDiM5xUIRbRF
w9qW0qi0ec5d45eQztBoDuyPV4/TH5OQvtxHO5Xl479B3shv1H78JtVh+trqakKc
WNiOaL71kiEBkpxD1RXDTCnIsKf55oTzLCEymxe2cA==
-----END CERTIFICATE-----`;

/** Client private key — paired with GQL_TLS_CLIENT_CERT for future mTLS. */
export const GQL_TLS_CLIENT_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCrjhuGVuFXI8SR
5GKm7XeyVd7wQgJiwIY+1zNWgdlzQztqlxu4v/8WflJ/bvI3sQ66CwePWWZ7TVK1
/9WrZHZvc6YUvvWpYhN7yy7PVWiXg8L7uf9Nl92SMe6pcnjLndpdK2OhQT877MvM
Dqv0el0dMa8Ki/ZCMSiV3d3eIkmBTVig10O/2aBw5WWDmhAw2UhYbWAmjKIyubCm
1NsHgiFyWoHdwoNWX6iWR+pRjJsmA86wmYdB69WcRfrM2OerkL7JzoRfpTFx7TPf
1dIx013EE3FwWDOhHXpnqs6xXnET7FyHWqbqkozIyd/bI+9lcFiEY0PhdWn9eVgi
mGNYHx8DAgMBAAECggEAD1Hq8lW63NnEWZTwHGETcdkKRiFW7jOsKVt1abHB1fG4
kh25a4e1w2/3dQrW1ZNZsdJ/U9VTegpfKwKUNbCMhQpqV+rvrDcmb0UnQnupkfJB
zNIA0xCPSFluKzKeR+yqTeysgn99op/UWT4sK/Jrc0p3C7WRAbs7GRsNj6M3NjUp
FOvAsBjfcC/1N14WWFqDqkHZAqhweWBzsO4qPBGvwFBskaz29rjwRvPRKKgPtqlp
6Uu6KtTB2+8rP9ZaCJm4KOLHJrYMudiCeBgl7g/vwBUH17qQ6s5cMgp9lKtK3KRW
fwqrUfKlXQcH5KY+neLO8hQIwNxQSzWUz2kJwn1RmQKBgQDYMVgb0qd2fCMJC/4w
V7qtxADnf8uUD9bHjQDcAQ1cr/KPsqhQipD305VVSpTS2N8Im8v0Lazm+sNPchYJ
Boobw7KDg44a8d1p5MqTJv+a61S9JE9hLzDQhLJ0zABAOCWnXTp3SV23J0XHCmzU
lvVajuHly1DMAn2sKg3GSRVnuQKBgQDLJK7q3oor1Zj8SUXYsurEzQDgTDt2Hni+
6rlqbGZ5Cr9kLXDpK5AYf9sPe+yiR6BoRHQwe2okE0KfgAv9doRiNyszu22RjRCK
a0JFyo3enzvaePCJ8sEeT2uVh/v9HVYyfZmer31YWKV/VrDht7Gy4X6IGvOkJaMS
Tj0YY1jimwKBgQCxX2KjiSQ98MEp5f4JmaCeekYnqNDUzF3x4LzIw9A7sFt5DCJN
2jHwMla94G/TwXzTakdeMa8+3pQpdTeg9g2Pk/K9Ncz8TF3VSJHvQzrI1rTybXz3
BimtmoFzk//MsIQsGTAjuDy8TOtRzzrU/HmWb83ko/fJOW30N5iPi1yVeQKBgF/D
sE36kOpvLEqqhCnO1ovmFKaoaVOas9NUtgnshjZDkcw4+8SAC9Lw2yUmh3xNBdqB
gsCkPXo6NisY4w4ew/PFDDG8BsAZ3xVR0REzlsO/DylD4Ck37kBKsm3wiCNfpBXz
TesX0aBHUeWAyavuu++XC94/zmGweHqVtYl8tBdHAoGBAIE3nBprBRdxkEDZ02xK
zD1Fe6CkZ4eWsdkwGrqPCq+LkilNiPQlvKqt+hbY3bAlitWWqrv2engCDMqxYm2z
Wp0p7s+toc93xlRqSnYsDdK2TKEC9jVW6ZxEeBbo116CJaWzAUs3BY7f07zGMESt
DxsnE9Sm9Ly8rNN7Irc0lmtQ
-----END PRIVATE KEY-----`;

// ── Session flags ─────────────────────────────────────────────────────────────

let _gqltEnvReady = false;
let _gqltEndpointSet = false;
let _gqltSkipCertEnabled = false;
let _gqltIntrospected = false;
let _gqltAuthConfigured = false;
let _gqltAuthExecuted = false;
let _gqltAuthMetadataReady = false;
let _gqltCaConfigured = false;
let _gqltCaIntrospected = false;
let _gqltMtlsConfigured = false;
let _gqltMtlsIntrospected = false;

export function resetGqlTlsSessionFlags(): void {
  _gqltEnvReady = false;
  _gqltEndpointSet = false;
  _gqltSkipCertEnabled = false;
  _gqltIntrospected = false;
  _gqltAuthConfigured = false;
  _gqltAuthExecuted = false;
  _gqltAuthMetadataReady = false;
  _gqltCaConfigured = false;
  _gqltCaIntrospected = false;
  _gqltMtlsConfigured = false;
  _gqltMtlsIntrospected = false;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function endpointValue(): string {
  return (getEndpointInput()?.value ?? '').trim();
}

function endpointIsHttpsTls(): boolean {
  const v = endpointValue().toLowerCase();
  return v.startsWith('https://') && v.includes(':4443');
}

function endpointIsMtls(): boolean {
  return endpointValue().includes(':4445');
}

function isTlsToggleActive(): boolean {
  const btn = document.querySelector<HTMLButtonElement>(GQL.TLS_TOGGLE);
  return btn?.getAttribute('aria-pressed') === 'true';
}

function isSkipCertDisabledInDom(): boolean {
  if (isTlsToggleActive()) return false;
  const checkbox = document.querySelector<HTMLInputElement>(`${GQL.TLS_SKIP_CERT} input[type="checkbox"]`);
  if (checkbox?.checked) return false;
  return true;
}

function isTlsCaConfiguredInDom(): boolean {
  if (isTlsToggleActive()) return false;
  if (document.querySelector(GQL.TLS_INDICATOR_CA)) return true;
  const ca = document.querySelector<HTMLTextAreaElement>(GQL.TLS_CA_CERT);
  return !!(ca?.value?.includes('BEGIN CERTIFICATE') && isSkipCertDisabledInDom());
}

function isMtlsBadgeActive(): boolean {
  return !!document.querySelector(GQL.TLS_INDICATOR_MTLS);
}

function applyGqlTlsViaDemoBridge(patch: Partial<GqlTlsSettings>): boolean {
  return applyGqlTlsSettings(patch);
}

/** Sync skip-cert to React state and demo-tab storage — required for Tauri native TLS introspect. */
async function persistSkipCertForTlsDemo(ctx: DemoActionContext): Promise<void> {
  await activateGqlDemoTabQuiet(ctx);
  applyGqlTlsViaDemoBridge({ skipTlsVerify: true });
  await patchDemoTabConnection({ skipTlsVerify: true });
  await ctx.delay(500);
  for (let i = 0; i < 30; i++) {
    const btn = document.querySelector<HTMLButtonElement>(GQL.TLS_TOGGLE);
    if (btn?.getAttribute('aria-pressed') === 'true') break;
    await ctx.delay(100);
  }
}

/** Sync mTLS PEM fields to React state and demo-tab storage — required before port 4445 introspect. */
async function persistMtlsForTlsDemo(ctx: DemoActionContext): Promise<void> {
  await activateGqlDemoTabQuiet(ctx);
  applyGqlTlsViaDemoBridge({
    skipTlsVerify: false,
    caCert: GQL_TLS_CA_CERT,
    clientCert: GQL_TLS_CLIENT_CERT,
    clientKey: GQL_TLS_CLIENT_KEY,
  });
  await patchDemoTabConnection({
    skipTlsVerify: false,
    tlsCaCert: GQL_TLS_CA_CERT,
    tlsClientCert: GQL_TLS_CLIENT_CERT,
    tlsClientKey: GQL_TLS_CLIENT_KEY,
  });
  await ctx.delay(500);
  for (let i = 0; i < 40; i++) {
    if (isMtlsBadgeActive()) break;
    await ctx.delay(100);
  }
}

async function ensureGqlTlsPanelOpen(ctx: DemoActionContext): Promise<void> {
  if (!document.querySelector(GQL.TLS_CONFIGURE)) {
    // Never revert an mTLS endpoint (4445) back to the TLS-only port (4443).
    if (endpointIsMtls()) {
      await ctx.waitFor(GQL.TLS_CONFIGURE, 5000);
    } else {
      await ensureTlsEndpoint(ctx);
    }
  }
  await ctx.waitFor(GQL.TLS_CONFIGURE, 5000);
  if (!document.querySelector(GQL.TLS_BODY)) {
    await ctx.click(GQL.TLS_CONFIGURE);
    await ctx.waitFor(GQL.TLS_BODY, 5000);
    await ctx.delay(600);
  }
}

async function setGqlSkipCertInModal(ctx: DemoActionContext, checked: boolean, pauseMs = 400): Promise<void> {
  await ctx.waitFor(`${GQL.TLS_SKIP_CERT} input[type="checkbox"]`, 3000);
  const checkbox = document.querySelector<HTMLInputElement>(`${GQL.TLS_SKIP_CERT} input[type="checkbox"]`);
  if (checkbox && checkbox.checked !== checked) {
    setControlledCheckbox(checkbox, checked);
    await ctx.delay(pauseMs);
  }
}

async function closeGqlTlsModal(ctx: DemoActionContext, opts: { visible?: boolean } = {}): Promise<void> {
  const visible = opts.visible !== false;
  if (!document.querySelector(GQL.TLS_BODY)) return;
  const closeSel = document.querySelector(GQL.TLS_CLOSE) ? GQL.TLS_CLOSE : GQL.TLS_SAVE;
  if (visible) {
    await ctx.click(closeSel);
    await ctx.delay(700);
  } else {
    const closeBtn = document.querySelector<HTMLButtonElement>(GQL.TLS_CLOSE);
    if (closeBtn) {
      closeBtn.click();
    } else {
      await ctx.click(GQL.TLS_SAVE);
    }
    for (let i = 0; i < 20 && document.querySelector(GQL.TLS_BODY); i++) {
      await ctx.delay(50);
    }
    await ctx.delay(100);
  }
}

/** Human-paced Phase 2 demo — open TLS modal, disable skip-cert, paste CA, close (~8–10s at 1×). */
async function runTlsCaCertDemoAction(ctx: DemoActionContext): Promise<void> {
  await ctx.waitFor(GQL.TLS_CONFIGURE, 5000);
  if (!document.querySelector(GQL.TLS_BODY)) {
    await ctx.click(GQL.TLS_CONFIGURE);
    await ctx.waitFor(GQL.TLS_BODY, 5000);
    await ctx.delay(800);
  }

  if (isTlsToggleActive()) {
    await ctx.click(GQL.TLS_TOGGLE);
    await ctx.delay(800);
  }

  await setGqlSkipCertInModal(ctx, false, 500);
  await ctx.delay(600);

  await ctx.fill(GQL.TLS_CLIENT_CERT, '');
  await ctx.delay(300);
  await ctx.fill(GQL.TLS_CLIENT_KEY, '');
  await ctx.delay(300);
  const caField = document.querySelector(GQL.TLS_CA_CERT);
  caField?.scrollIntoView?.({ block: 'center' });
  await ctx.delay(400);

  if (applyGqlTlsViaDemoBridge({
    skipTlsVerify: false,
    caCert: GQL_TLS_CA_CERT,
    clientCert: undefined,
    clientKey: undefined,
  })) {
    await ctx.waitFor(GQL.TLS_INDICATOR_CA, 5000);
  } else {
    await ctx.fill(GQL.TLS_CA_CERT, GQL_TLS_CA_CERT);
  }
  await ctx.delay(2000);

  await closeGqlTlsModal(ctx, { visible: true });
  _gqltSkipCertEnabled = false;
  _gqltCaConfigured = true;
}

/** Human-paced Phase 3 demo — open TLS modal, confirm CA, paste client cert + key (~12–15s at 1×). */
async function runMtlsCredsDemoAction(ctx: DemoActionContext): Promise<void> {
  await ctx.waitFor(GQL.TLS_CONFIGURE, 5000);
  if (!document.querySelector(GQL.TLS_BODY)) {
    await ctx.click(GQL.TLS_CONFIGURE);
    await ctx.waitFor(GQL.TLS_BODY, 5000);
    await ctx.delay(600);
  }

  if (isTlsToggleActive()) {
    await ctx.click(GQL.TLS_TOGGLE);
    await ctx.delay(800);
  }

  await setGqlSkipCertInModal(ctx, false, 500);
  await ctx.delay(600);

  document.querySelector(GQL.TLS_CA_CERT)?.scrollIntoView?.({ block: 'center' });
  await ctx.delay(600);
  const caField = document.querySelector<HTMLTextAreaElement>(GQL.TLS_CA_CERT);
  if (!caField?.value?.trim()) {
    await ctx.fill(GQL.TLS_CA_CERT, GQL_TLS_CA_CERT);
    await ctx.delay(1500);
  } else {
    await ctx.delay(800);
  }

  document.querySelector(GQL.TLS_CLIENT_CERT)?.scrollIntoView?.({ block: 'center' });
  await ctx.delay(600);

  // Re-animate: clear then re-fill so viewers see each paste moment (never use demo bridge here).
  await ctx.fill(GQL.TLS_CLIENT_CERT, '');
  await ctx.delay(400);
  await ctx.fill(GQL.TLS_CLIENT_CERT, GQL_TLS_CLIENT_CERT);
  await ctx.delay(1500);

  document.querySelector(GQL.TLS_CLIENT_KEY)?.scrollIntoView?.({ block: 'center' });
  await ctx.delay(400);
  await ctx.fill(GQL.TLS_CLIENT_KEY, '');
  await ctx.delay(400);
  await ctx.fill(GQL.TLS_CLIENT_KEY, GQL_TLS_CLIENT_KEY);
  await ctx.delay(1500);

  await ctx.waitFor(GQL.TLS_INDICATOR_MTLS, 5000);
  await ctx.delay(700);

  await closeGqlTlsModal(ctx, { visible: true });
  await persistMtlsForTlsDemo(ctx);
  _gqltMtlsConfigured = true;
}

/** Turn off skip-cert in both the connection-bar SSL toggle and the TLS modal. */
async function ensureSkipCertDisabled(ctx: DemoActionContext): Promise<void> {
  applyGqlTlsViaDemoBridge({ skipTlsVerify: false });

  if (isTlsToggleActive()) {
    await ctx.click(GQL.TLS_TOGGLE);
    await ctx.delay(500);
  }

  await ensureGqlTlsPanelOpen(ctx);
  await setGqlSkipCertInModal(ctx, false);
  await ctx.delay(500);

  if (isTlsToggleActive()) {
    applyGqlTlsViaDemoBridge({ skipTlsVerify: false });
    await ctx.click(GQL.TLS_TOGGLE);
    await ctx.delay(500);
  }

  _gqltSkipCertEnabled = false;
}

async function clearGqlTlsCertFields(ctx: DemoActionContext): Promise<void> {
  await ctx.fill(GQL.TLS_CA_CERT, '');
  await ctx.fill(GQL.TLS_CLIENT_CERT, '');
  await ctx.fill(GQL.TLS_CLIENT_KEY, '');
  await ctx.delay(150);
}

async function saveGqlTlsModal(ctx: DemoActionContext): Promise<void> {
  await closeGqlTlsModal(ctx, { visible: false });
}

/** Phase 2 prerequisites — HTTPS endpoint + prior auth step (sidebar jump recovery). */
export async function ensureTlsPhase2Ready(ctx: DemoActionContext): Promise<void> {
  await ensureTlsAuthExecuted(ctx);
  await ensureTlsEndpoint(ctx);
}

/** Disable skip-cert and paste the dev CA certificate (Phase 2). */
export async function ensureTlsCaConfigured(
  ctx: DemoActionContext,
  opts: { visible?: boolean } = {},
): Promise<void> {
  const visible = opts.visible !== false;
  await ensureTlsPhase2Ready(ctx);
  if (_gqltCaConfigured && isTlsCaConfiguredInDom()) return;
  _gqltCaConfigured = false;

  if (!visible && applyGqlTlsViaDemoBridge({
    skipTlsVerify: false,
    caCert: GQL_TLS_CA_CERT,
    clientCert: undefined,
    clientKey: undefined,
  })) {
    await ctx.waitFor(GQL.TLS_INDICATOR_CA, 5000);
    _gqltSkipCertEnabled = false;
    _gqltCaConfigured = true;
    return;
  }

  if (visible) {
    await runTlsCaCertDemoAction(ctx);
    return;
  }

  await ensureSkipCertDisabled(ctx);
  await clearGqlTlsCertFields(ctx);
  await ctx.fill(GQL.TLS_CA_CERT, GQL_TLS_CA_CERT);
  await saveGqlTlsModal(ctx);
  _gqltSkipCertEnabled = false;
  _gqltCaConfigured = true;
}

/** Introspect with CA validation on port 4443 (Phase 2). */
export async function ensureTlsCaIntrospected(ctx: DemoActionContext): Promise<void> {
  // Port 4445 requires client credentials — introspect belongs to Phase 3 helpers.
  if (endpointIsMtls()) return;
  await ensureTlsCaConfigured(ctx, { visible: false });
  if (_gqltCaIntrospected && document.querySelector(GQL.SCHEMA_BADGE_OK)) return;
  const schemaTab = document.querySelector<HTMLElement>(GQL.RIGHT_TAB_SCHEMA);
  if (schemaTab?.getAttribute('aria-selected') === 'true') {
    await ctx.click(GQL.RIGHT_TAB_RESPONSE);
    await ctx.delay(400);
  }
  await ctx.click(GQL.INTROSPECT_BTN);
  await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
  await ctx.delay(800);
  _gqltCaIntrospected = true;
}

/** Human-paced Phase 2 introspect — Custom CA badge → schema tab → Introspect → badge (~6–8s at 1×). */
export async function runTlsCaIntrospectDemoAction(ctx: DemoActionContext): Promise<void> {
  await ctx.waitFor(GQL.TLS_INDICATOR_CA, 5000);
  await ctx.delay(1000);

  const schemaTab = document.querySelector<HTMLElement>(GQL.RIGHT_TAB_SCHEMA);
  if (schemaTab && schemaTab.getAttribute('aria-selected') !== 'true') {
    await ctx.click(GQL.RIGHT_TAB_SCHEMA);
    await ctx.delay(800);
  } else {
    await ctx.delay(600);
  }

  await ctx.delay(800);
  await ctx.click(GQL.INTROSPECT_BTN);
  await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
  await ctx.delay(2400);
  _gqltCaIntrospected = true;
}

/** Switch to the mTLS endpoint on port 4445. */
export async function ensureMtlsEndpoint(ctx: DemoActionContext): Promise<void> {
  if (endpointIsMtls()) return;
  await ensureTlsCaIntrospected(ctx);
  await configureDemoTabEndpointOverride(ctx, GQL_TLS_MTLS_ENDPOINT);
  await ctx.waitFor(GQL.TLS_CONFIGURE, 5000);
  await ctx.delay(800);
}

/** Configure CA + client cert + key for mTLS (Phase 3). */
export async function ensureMtlsConfigured(
  ctx: DemoActionContext,
  opts: { visible?: boolean } = {},
): Promise<void> {
  const visible = opts.visible !== false;
  await ensureMtlsEndpoint(ctx);
  if (_gqltMtlsConfigured && isMtlsBadgeActive()) return;
  _gqltMtlsConfigured = false;

  if (!visible && applyGqlTlsViaDemoBridge({
    skipTlsVerify: false,
    caCert: GQL_TLS_CA_CERT,
    clientCert: GQL_TLS_CLIENT_CERT,
    clientKey: GQL_TLS_CLIENT_KEY,
  })) {
    await persistMtlsForTlsDemo(ctx);
    _gqltMtlsConfigured = true;
    return;
  }

  if (visible) {
    await runMtlsCredsDemoAction(ctx);
    return;
  }

  await ensureSkipCertDisabled(ctx);
  await ctx.fill(GQL.TLS_CA_CERT, GQL_TLS_CA_CERT);
  await ctx.delay(400);
  await ctx.fill(GQL.TLS_CLIENT_CERT, GQL_TLS_CLIENT_CERT);
  await ctx.delay(400);
  document.querySelector(GQL.TLS_CLIENT_KEY)?.scrollIntoView?.({ block: 'center' });
  await ctx.fill(GQL.TLS_CLIENT_KEY, GQL_TLS_CLIENT_KEY);
  await ctx.delay(200);
  await saveGqlTlsModal(ctx);
  await persistMtlsForTlsDemo(ctx);
  _gqltMtlsConfigured = true;
}

/** Introspect over mTLS on port 4445 (Phase 3). */
export async function ensureMtlsIntrospected(ctx: DemoActionContext): Promise<void> {
  await ensureMtlsConfigured(ctx, { visible: false });
  if (!isMtlsBadgeActive()) {
    await persistMtlsForTlsDemo(ctx);
  }
  if (_gqltMtlsIntrospected && document.querySelector(GQL.SCHEMA_BADGE_OK)) return;
  await ctx.click(GQL.INTROSPECT_BTN);
  await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
  await ctx.delay(800);
  _gqltMtlsIntrospected = true;
}

/** Reset demo tab to plain HTTP before the HTTPS endpoint switch (step 2). */
export async function ensurePlainHttpEndpoint(ctx: DemoActionContext): Promise<void> {
  const v = endpointValue().toLowerCase();
  const isPlainHttpDom =
    v.startsWith('http://') && !v.includes(':4443') && !v.includes(':4445');
  const session = await loadDemoSession();
  let storagePlain = false;
  if (session?.demoTabId) {
    const tab = (await loadTabs()).find((t) => t.id === session.demoTabId);
    storagePlain = tab?.endpoint === GQL_PLAIN_HTTP;
  }
  if (isPlainHttpDom && storagePlain && !document.querySelector(GQL.TLS_TOGGLE)) {
    _gqltEndpointSet = false;
    _gqltSkipCertEnabled = false;
    return;
  }

  await resetDemoTabToPlainHttp(ctx);
  _gqltEndpointSet = false;
  _gqltSkipCertEnabled = false;
}

/** Fill the HTTPS TLS endpoint if not already set. */
export async function ensureTlsEndpoint(ctx: DemoActionContext): Promise<void> {
  // Re-apply when session flags say "done" but the tab reverted to plain HTTP
  // (e.g. {{graphqlUrl}} inherit) — TLS controls are hidden without https://.
  // Also recover from a stale mTLS port (4445) left on the tab from a prior run.
  const onTlsOnlyPort = endpointIsHttpsTls() && !endpointIsMtls();
  if (_gqltEndpointSet && onTlsOnlyPort) return;
  await activateGqlDemoTabQuiet(ctx);
  await configureDemoTabEndpointOverride(ctx, GQL_TLS_HTTPS_ENDPOINT);
  await ctx.waitFor(GQL.TLS_TOGGLE, 5000);
  await ctx.delay(200);
  _gqltEndpointSet = true;
}

/** Enable skip-cert toggle if not already enabled. */
export async function ensureSkipCertEnabled(ctx: DemoActionContext): Promise<void> {
  await ensureTlsEndpoint(ctx);
  if (_gqltSkipCertEnabled && isTlsToggleActive()) {
    await persistSkipCertForTlsDemo(ctx);
    return;
  }
  if (!document.querySelector(GQL.TLS_TOGGLE)) {
    _gqltSkipCertEnabled = false;
    return;
  }
  const btn = document.querySelector<HTMLButtonElement>(GQL.TLS_TOGGLE);
  if (btn && btn.getAttribute('aria-pressed') !== 'true') {
    btn.click();
    await ctx.delay(400);
  }
  await persistSkipCertForTlsDemo(ctx);
  _gqltSkipCertEnabled = true;
}

/** Introspect the TLS endpoint with skip-cert enabled. */
export async function ensureTlsIntrospected(ctx: DemoActionContext): Promise<void> {
  await ensureTlsSkipIntrospectOutcome(ctx);
}

/** Click Introspect only — outcome verified in the following observe step. */
export async function runTlsIntrospectClickOnly(ctx: DemoActionContext): Promise<void> {
  if (endpointIsMtls()) {
    if (!isMtlsBadgeActive()) {
      await persistMtlsForTlsDemo(ctx);
    }
  } else if (endpointIsHttpsTls() && isTlsToggleActive()) {
    // Phase 1 skip-cert on port 4443 only — never on mTLS (4445) or CA-validated (4443) paths.
    await persistSkipCertForTlsDemo(ctx);
  }
  await ctx.click(GQL.INTROSPECT_BTN);
  await ctx.delay(400);
}

/** Ensure Phase 1 skip-cert introspect reached green schema badge. */
export async function ensureTlsSkipIntrospectOutcome(ctx: DemoActionContext): Promise<void> {
  await ensureSkipCertEnabled(ctx);
  if (_gqltIntrospected && document.querySelector(GQL.SCHEMA_BADGE_OK)) return;
  if (!document.querySelector(GQL.SCHEMA_BADGE_OK)) {
    await ctx.click(GQL.INTROSPECT_BTN);
    await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
    await ctx.delay(800);
  }
  _gqltIntrospected = true;
}

export async function prepareGqltSkipIntrospectReading(ctx: DemoActionContext): Promise<void> {
  await ensureSkipCertEnabled(ctx);
  // Clear a stale schema-error from introspecting before skip-cert was persisted (common on Tauri).
  if (document.querySelector(GQL.SCHEMA_BADGE_ERROR) && !document.querySelector(GQL.SCHEMA_BADGE_OK)) {
    await ctx.click(GQL.INTROSPECT_BTN);
    await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
    await ctx.delay(400);
    if (document.querySelector(GQL.SCHEMA_BADGE_OK)) {
      _gqltIntrospected = true;
    }
  }
}

/** Ensure Phase 2 CA-validated introspect outcome. */
export async function ensureTlsCaIntrospectOutcome(ctx: DemoActionContext): Promise<void> {
  if (endpointIsMtls()) return;
  await ensureTlsCaConfigured(ctx, { visible: false });
  if (_gqltCaIntrospected && document.querySelector(GQL.SCHEMA_BADGE_OK)) return;
  if (!document.querySelector(GQL.SCHEMA_BADGE_OK)) {
    const schemaTab = document.querySelector<HTMLElement>(GQL.RIGHT_TAB_SCHEMA);
    if (schemaTab?.getAttribute('aria-selected') === 'true') {
      await ctx.click(GQL.RIGHT_TAB_RESPONSE);
      await ctx.delay(400);
    }
    await ctx.click(GQL.INTROSPECT_BTN);
    await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
    await ctx.delay(800);
  }
  _gqltCaIntrospected = true;
}

export async function prepareGqltCaIntrospectReading(ctx: DemoActionContext): Promise<void> {
  await ensureTlsCaConfigured(ctx, { visible: false });
}

/** Ensure Phase 3 mTLS introspect outcome. */
export async function ensureMtlsIntrospectOutcome(ctx: DemoActionContext): Promise<void> {
  await ensureMtlsConfigured(ctx, { visible: false });
  if (!isMtlsBadgeActive()) {
    await persistMtlsForTlsDemo(ctx);
  }
  if (_gqltMtlsIntrospected && document.querySelector(GQL.SCHEMA_BADGE_OK)) return;
  if (!document.querySelector(GQL.SCHEMA_BADGE_OK)) {
    await ctx.click(GQL.INTROSPECT_BTN);
    await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
    await ctx.delay(800);
  }
  _gqltMtlsIntrospected = true;
}

export async function prepareGqltMtlsIntrospectReading(ctx: DemoActionContext): Promise<void> {
  await ensureMtlsConfigured(ctx, { visible: false });
  if (!isMtlsBadgeActive()) {
    await persistMtlsForTlsDemo(ctx);
  }
}

/** Ensure plain HTTP restore + introspect outcome. */
export async function ensurePlainRestoreIntrospectOutcome(ctx: DemoActionContext): Promise<void> {
  await ensureMtlsIntrospected(ctx);
  const v = endpointValue().toLowerCase();
  if (!v.startsWith('http://') || v.includes(':4443') || v.includes(':4445')) {
    await configureDemoTabEndpointOverride(ctx, GQL_PLAIN_HTTP);
    await ctx.delay(500);
  }
  if (!document.querySelector(GQL.SCHEMA_BADGE_OK)) {
    await ctx.click(GQL.INTROSPECT_BTN);
    await ctx.waitFor(GQL.SCHEMA_BADGE_OK, 25000);
    await ctx.delay(600);
  }
}

export async function prepareGqltRestoreReading(ctx: DemoActionContext): Promise<void> {
  await ensureMtlsIntrospected(ctx);
}

/** Ensure `query { health }` is in the editor without Environment Manager setup (TLS demo tab). */
async function ensureTlsHealthQuery(ctx: DemoActionContext): Promise<void> {
  await activateGqlDemoTabQuiet(ctx);
  await ensureEditorMode(ctx);
  if (getGqlEditorQuery().includes('health')) return;
  await fillGqlEditor(ctx, GQL_HEALTH_QUERY, { focus: false });
}

/** Poll until GraphQL Studio mounts the env bridge (lazy Suspense on first paint). */
async function waitForGqlEnvBridge(ctx: DemoActionContext, timeoutMs = 8000): Promise<boolean> {
  const maxIter = Math.ceil(timeoutMs / 100);
  for (let i = 0; i < maxIter; i++) {
    if (getDemoBridgeWindow().__demoUpsertGqlEnv) return true;
    await ctx.delay(100);
  }
  return !!getDemoBridgeWindow().__demoUpsertGqlEnv;
}

/** Seed Demo env with authToken so {{authToken}} resolves during auth-over-TLS. */
export async function ensureTlsEnvReady(ctx: DemoActionContext): Promise<void> {
  if (_gqltEnvReady) return;
  await waitForGqlEnvBridge(ctx);
  await upsertGqlDemoEnvVars(ctx, [{ key: 'authToken', value: LESSON6_AUTH_TOKEN_VALUE }]);
  _gqltEnvReady = true;
}

/** Configure Bearer auth for the auth-over-TLS step. */
export async function ensureTlsAuthConfigured(ctx: DemoActionContext): Promise<void> {
  await ensureTlsIntrospected(ctx);
  if (_gqltAuthConfigured) return;
  await ensureTlsEnvReady(ctx);
  await selectAuthInPanel(ctx, 'bearer');
  await ctx.fill(GQL.AUTH_BEARER_INPUT, GQL_TLS_BEARER_TEMPLATE);
  await ctx.delay(500);
  _gqltAuthConfigured = true;
}

/** Step gqlt-auth-tls-config reading — TLS introspected, Demo env armed, Auth panel open. */
export async function prepareGqltAuthConfigReading(ctx: DemoActionContext): Promise<void> {
  await ensureTlsIntrospected(ctx);
  await ensureTlsEnvReady(ctx);
  if (!_gqltAuthConfigured) {
    await ensureAuthPanelVisible(ctx);
    return;
  }
  const input = document.querySelector<HTMLInputElement>(GQL.AUTH_BEARER_INPUT);
  if (input?.value !== GQL_TLS_BEARER_TEMPLATE) {
    await ensureAuthPanelVisible(ctx);
    await selectAuthInPanel(ctx, 'bearer');
    await ctx.fill(GQL.AUTH_BEARER_INPUT, GQL_TLS_BEARER_TEMPLATE);
    await ctx.delay(400);
  }
  await ensureAuthPanelVisible(ctx);
}

/** Visible Bearer setup for gqlt-auth-tls-config. */
export async function runGqltAuthConfigAction(ctx: DemoActionContext): Promise<void> {
  await selectAuthInPanel(ctx, 'bearer');
  await ctx.delay(600);
  await ctx.fill(GQL.AUTH_BEARER_INPUT, GQL_TLS_BEARER_TEMPLATE);
  await ctx.delay(700);
  _gqltAuthConfigured = true;
}

/** Step gqlt-auth-tls-exec reading — Bearer configured, Response pane visible. */
export async function prepareGqltAuthExecReading(ctx: DemoActionContext): Promise<void> {
  await ensureTlsAuthConfigured(ctx);
  await ensureTlsHealthQuery(ctx);
  const responseTab = document.querySelector<HTMLElement>(GQL.RIGHT_TAB_RESPONSE);
  if (responseTab?.getAttribute('aria-selected') !== 'true') {
    await ctx.click(GQL.RIGHT_TAB_RESPONSE);
    await ctx.delay(800);
  }
}

/** Visible Execute for gqlt-auth-tls-exec. */
export async function runGqltAuthExecAction(ctx: DemoActionContext): Promise<void> {
  await ensureTlsHealthQuery(ctx);
  await ctx.click(GQL.EXECUTE_BTN);
  await ctx.waitFor(GQL.RESPONSE_VIEWER, 15000);
  await ctx.delay(1000);
  _gqltAuthExecuted = true;
}

/** Step gqlt-auth-tls-observe reading — health response present, Metadata primed quietly if needed. */
export async function prepareGqltAuthObserveReading(ctx: DemoActionContext): Promise<void> {
  await ensureTlsAuthConfigured(ctx);
  if (!_gqltAuthExecuted || !document.querySelector(GQL.RESPONSE_VIEWER)) {
    await ensureTlsHealthQuery(ctx);
    await ctx.click(GQL.EXECUTE_BTN);
    await ctx.waitFor(GQL.RESPONSE_VIEWER, 15000);
    await ctx.delay(800);
    _gqltAuthExecuted = true;
  }
  if (!document.querySelector(LESSON6_RV_METADATA_AUTHORIZATION_VAL)) {
    await ctx.click(GQL.RV_TAB_METADATA);
    await ctx.waitFor(LESSON6_RV_METADATA_AUTHORIZATION_VAL, 5000);
    await ctx.delay(800);
  }
  await ensureAuthPanelVisible(ctx);
}

/** Open Metadata and pause on the Authorization row (gqlt-auth-tls-observe action). */
export async function runGqltAuthObserveAction(ctx: DemoActionContext): Promise<void> {
  await ctx.click(GQL.RV_TAB_METADATA);
  await ctx.waitFor(LESSON6_RV_METADATA_AUTHORIZATION_VAL, 5000);
  await ctx.delay(1200);
  await ensureAuthPanelVisible(ctx);
  _gqltAuthMetadataReady = true;
}

/** Execute with TLS auth and confirm the header appears in Metadata (quiet chain for Phase 2). */
export async function ensureTlsAuthExecuted(ctx: DemoActionContext): Promise<void> {
  if (_gqltAuthMetadataReady) return;
  await prepareGqltAuthObserveReading(ctx);
  if (_gqltAuthMetadataReady) return;
  await runGqltAuthObserveAction(ctx);
}

/** Ensure mTLS endpoint is set (quiet preAction — modal opens during action). */
export async function ensureMtlsPanelReady(ctx: DemoActionContext): Promise<void> {
  await ensureMtlsEndpoint(ctx);
}

/** Setup for Lesson GQL-5 — demo tab, health query, modals closed. */
export async function gqlTlsLessonSetup(ctx: DemoActionContext): Promise<void> {
  resetGqlLessonSessionFlags();
  resetGqlLesson2SessionFlags();
  resetLesson2VariablesHistoryFlags();
  resetGqlLesson3SessionFlags();
  resetGqlLesson4SessionFlags();
  resetGqlLesson5SessionFlags();
  resetGqlLesson6SessionFlags();
  resetGqlTlsSessionFlags();

  // Close any open auth panel
  await closeAuthPanelQuiet(ctx);

  const editorBtn = document.querySelector<HTMLElement>(GQL.MODE_EDITOR);
  if (editorBtn && !editorBtn.classList.contains('gql-mode-btn--active')) {
    editorBtn.click();
  }
  const responseTab = document.querySelector<HTMLElement>(GQL.RIGHT_TAB_RESPONSE);
  if (responseTab && responseTab.getAttribute('aria-selected') !== 'true') {
    responseTab.click();
  }
  await ctx.delay(200);
  const historyBtn = document.querySelector<HTMLElement>(GQL.ACTIVITY_HISTORY);
  if (historyBtn?.classList.contains('gql-activity-tab--active')) {
    historyBtn.click();
    await ctx.delay(200);
  }

  await ensureGqlDemoTab(ctx, 'gql-https-tls', 'HTTPS, TLS & Certificates');
  await ensurePlainHttpEndpoint(ctx);
  await fillGqlEditor(ctx, GQL_HEALTH_QUERY, { focus: false });
  // Seed authToken quietly during setup so auth steps never open Settings → Environments.
  await ensureTlsEnvReady(ctx);
}

/** Cleanup for Lesson GQL-5 — reset TLS endpoint then close demo tab. */
export async function gqlTlsLessonCleanup(ctx: DemoActionContext): Promise<void> {
  resetGqlTlsSessionFlags();
  await resetDemoTabToPlainHttp(ctx);
  await closeGqlDemoTabs(ctx, 'gql-https-tls');
}
