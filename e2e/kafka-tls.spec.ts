/**
 * kafka-tls.spec.ts — E2E tests for K12: TLS-Encrypted Cluster (SASL + TLS)
 *
 * Prerequisites (must be running before this suite):
 *   - Dev servers:  npm run dev  (Vite :5173, Express :3001)
 *   - Docker stack: cd docker/kafka/tls && docker compose up -d
 *       redfireforge-redpanda-tls  → TLS+SASL Kafka on localhost:19095
 *       redfireforge-redpanda-tls-init → creates users + topics
 *       Admin API health probe      → localhost:19648
 *
 * The TLS stack uses a self-signed certificate (docker/kafka/tls/certs/).
 * RedfireForge's "Skip Certificate Verification" toggle must be enabled
 * (tls-verify-toggle) so the client accepts the self-signed cert.
 *
 * Pre-created SASL users (via init container):
 *   admin            / admin-secret    (superuser)
 *   redfireforge-app / app-password    (standard)
 *
 * Coverage:
 *   1. Settings page shows empty state with no clusters
 *   2. Create cluster editor opens
 *   3. Enabling TLS reveals the Skip Certificate Verification toggle
 *   4. Test Connection with TLS + skip-cert + valid SASL creds → success
 *   5. Test Connection with TLS + skip-cert + wrong password → failure
 *   6. Save cluster → card appears in the list
 *   7. Connect to TLS+SASL broker → status badge shows connected
 *   8. Publish a message over TLS to the secure broker → success result
 *   9. Disconnect → badge returns to disconnected
 *
 * Run with:
 *   npx playwright test e2e/kafka-tls.spec.ts --reporter=list
 */

import { expect, test, type Page } from '@playwright/test';
import { seedAppData } from './helpers';
import {
  connectKafkaClusterInSettings,
  selectCustomOption,
  disconnectKafkaClusterBackend,
  expectKafkaTestConnectionFailed,
  gotoKafkaPublishTab,
  publishKafkaMessage,
  waitForKafkaConnectedBadge,
  waitForKafkaDisconnectedBadge,
} from './kafka-docker-helpers';
import { installKafkaCompanionLock } from './kafka-companion-lock';

installKafkaCompanionLock(test);

// ── Skip guard ────────────────────────────────────────────────────────────────

async function isBackendReachable(): Promise<boolean> {
  try {
    const r = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function isTlsStackReachable(): Promise<boolean> {
  try {
    // Redpanda Admin API on the TLS stack — plain HTTP, no auth needed
    const r = await fetch('http://localhost:19648/', { signal: AbortSignal.timeout(3000) });
    return r.status < 600;
  } catch {
    return false;
  }
}

const infraUp = Promise.all([isBackendReachable(), isTlsStackReachable()]).then(
  ([backend, docker]) => backend && docker,
);

// ── Constants ─────────────────────────────────────────────────────────────────

const TLS_BROKER = '127.0.0.1:19095';
const TLS_CLUSTER_NAME = 'TLS Demo';
const TLS_USERNAME = 'redfireforge-app';
const TLS_PASSWORD = 'app-password';
// Must match the <option value="scram-sha-256"> in KafkaClusterEditor
const TLS_TOPIC = 'redfireforge.workflow.test'; // pre-created by init container
const TLS_WRONG_CLUSTER_NAME = 'TLS Demo Bad Password';

// ── Helper: save cluster and verify it appears in list ───────────────────────
// The Test Connection / Connect buttons are rendered only when
// clusters.length > 0 in the left panel. Save must precede testing.
async function saveCluster(page: Page): Promise<void> {
  await page.locator('[data-testid="kafka-save-cluster-btn"]').click();
  await page.waitForTimeout(800);
  // Use .kafka-cluster-card to avoid matching the name field in the still-open editor
  await expect(page.locator('.kafka-cluster-card').filter({ hasText: TLS_CLUSTER_NAME }).first()).toBeVisible({ timeout: 6000 });
}

// ── Helper: navigate to Kafka Settings ────────────────────────────────────────

async function gotoKafkaSettings(page: Page): Promise<void> {
  await page.goto('/?tab=kafka-settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
}

// ── Helper: open the cluster editor (handles empty-state or toolbar button) ───

async function openClusterEditor(page: Page): Promise<void> {
  const emptyBtn = page.locator('[data-testid="kafka-empty-create-btn"]');
  const addBtn = page.locator('[data-testid="kafka-add-cluster-btn"]');
  if (await emptyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emptyBtn.click();
  } else {
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
  }
  await expect(page.locator('[data-testid="kafka-cluster-editor"]')).toBeVisible({ timeout: 5000 });
}

// ── Helper: fill the cluster editor for a TLS+SASL cluster ───────────────────

async function fillTlsClusterForm(page: Page): Promise<void> {
  const editor = page.locator('[data-testid="kafka-cluster-editor"]');

  // Cluster name
  await editor.locator('#kafka-cluster-name').fill(TLS_CLUSTER_NAME);
  await page.waitForTimeout(200);

  // Broker address — clear then fill with TLS port
  const brokerInput = editor.locator('input[placeholder="127.0.0.1:19092"]');
  await expect(brokerInput).toBeVisible({ timeout: 5000 });
  await brokerInput.fill('');
  await brokerInput.fill(TLS_BROKER);
  await page.waitForTimeout(200);

  // Auth Mode → SCRAM-SHA-256 (CustomSelect, not native <select>)
  const authSelect = editor.getByLabel('Mechanism');
  await expect(authSelect).toBeVisible({ timeout: 5000 });
  await selectCustomOption(page, authSelect, 'SCRAM-SHA-256');
  await page.waitForTimeout(300);

  // Username + password
  await editor.locator('#kafka-auth-username').fill(TLS_USERNAME);
  await editor.locator('#kafka-auth-password').fill(TLS_PASSWORD);
  await page.waitForTimeout(200);

  // Enable TLS toggle
  const tlsToggle = editor.locator('[data-testid="kafka-tls-toggle"]');
  await expect(tlsToggle).toBeVisible({ timeout: 5000 });
  const isTlsEnabled = await tlsToggle.isChecked().catch(() => false);
  if (!isTlsEnabled) {
    await tlsToggle.click();
    await page.waitForTimeout(300);
  }

  // Skip Certificate Verification (self-signed cert in dev stack)
  const verifyCertToggle = editor.locator('[data-testid="kafka-tls-verify-toggle"]');
  await expect(verifyCertToggle).toBeVisible({ timeout: 5000 });
  const isVerifyEnabled = await verifyCertToggle.isChecked().catch(() => true);
  if (isVerifyEnabled) {
    // Uncheck it — we want to skip cert verification for the self-signed cert
    await verifyCertToggle.click();
    await page.waitForTimeout(300);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Test suite
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Kafka TLS-Encrypted Cluster — TLS + SASL/SCRAM-256 (Live Docker)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const up = await infraUp;
    test.skip(!up, 'Skipped: backend (port 3001) or TLS Docker stack (port 19648) not running');
    await seedAppData(page);
    await disconnectKafkaClusterBackend(page);
  });

  // ── 1. Empty state ──────────────────────────────────────────────────────────
  test('settings page shows empty state when no clusters are configured', async ({ page }) => {
    await gotoKafkaSettings(page);
    await expect(page.locator('[data-testid="kafka-settings-empty"]')).toBeVisible({ timeout: 8000 });
  });

  // ── 2. Cluster editor opens ─────────────────────────────────────────────────
  test('clicking Create opens the cluster editor form', async ({ page }) => {
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await expect(page.locator('[data-testid="kafka-cluster-editor"]')).toBeVisible({ timeout: 5000 });
  });

  // ── 3. TLS toggle reveals Skip Certificate Verification ────────────────────
  test('enabling TLS toggle reveals the Skip Certificate Verification option', async ({ page }) => {
    await gotoKafkaSettings(page);
    await openClusterEditor(page);

    const tlsToggle = page.locator('[data-testid="kafka-tls-toggle"]');
    await expect(tlsToggle).toBeVisible({ timeout: 5000 });

    // Enable TLS if not already on
    const isEnabled = await tlsToggle.isChecked().catch(() => false);
    if (!isEnabled) {
      await tlsToggle.click();
      await page.waitForTimeout(300);
    }

    // Skip cert verification toggle should now be visible
    await expect(page.locator('[data-testid="kafka-tls-verify-toggle"]')).toBeVisible({
      timeout: 4000,
    });
  });

  // ── 4. Test Connection succeeds with TLS + skip-cert + valid credentials ────
  test('Test Connection succeeds with TLS enabled and correct SASL credentials', async ({ page }) => {
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await fillTlsClusterForm(page);
    // Save first — Test Connection button only visible when clusters.length > 0
    await saveCluster(page);

    await page.locator('[data-testid="kafka-test-btn"]').click();

    await expect(page.locator('[data-testid="kafka-test-result"].kafka-test-result--ok')).toBeVisible({
      timeout: 15000,
    });
  });

  // ── 5. Test Connection fails with wrong password ────────────────────────────
  test('Test Connection shows failure with wrong SASL password over TLS', async ({ page }) => {
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await fillTlsClusterForm(page);

    await page.locator('#kafka-cluster-name').fill(TLS_WRONG_CLUSTER_NAME);
    await page.locator('#kafka-auth-password').fill('definitely-wrong');
    await page.waitForTimeout(200);

    await page.locator('[data-testid="kafka-save-cluster-btn"]').click();
    await page.waitForTimeout(800);
    await expect(page.locator('.kafka-cluster-card').filter({ hasText: TLS_WRONG_CLUSTER_NAME }).first()).toBeVisible({ timeout: 6000 });
    await expectKafkaTestConnectionFailed(page, 'tls-demo-bad-password');
  });

  // ── 6. Save cluster → card appears in list ──────────────────────────────────
  test('saving TLS cluster adds a card to the cluster list', async ({ page }) => {
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await fillTlsClusterForm(page);

    await page.locator('[data-testid="kafka-save-cluster-btn"]').click();
    await page.waitForTimeout(800);

    await expect(page.locator('.kafka-cluster-card').filter({ hasText: TLS_CLUSTER_NAME }).first()).toBeVisible({ timeout: 6000 });
  });

  // ── 7. Connect → status badge shows connected ───────────────────────────────
  test('connecting to the TLS+SASL broker shows a connected status badge', async ({ page }) => {
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await fillTlsClusterForm(page);

    await page.locator('[data-testid="kafka-save-cluster-btn"]').click();
    await page.waitForTimeout(800);

    const connectBtn = page.locator('[data-testid="kafka-connect-btn"]').first();
    await expect(connectBtn).toBeVisible({ timeout: 6000 });
    await connectBtn.click();
    await waitForKafkaConnectedBadge(page);
  });

  // ── 8. Publish a message over TLS ───────────────────────────────────────────
  test('can publish a message to the TLS-encrypted broker after connecting', async ({ page }) => {
    test.setTimeout(120_000);
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await fillTlsClusterForm(page);

    await page.locator('[data-testid="kafka-save-cluster-btn"]').click();
    await page.waitForTimeout(800);
    await connectKafkaClusterInSettings(page, 'tls-demo');
    await gotoKafkaPublishTab(page);
    await publishKafkaMessage(page, TLS_TOPIC, { demo: 'tls-e2e', cluster: TLS_CLUSTER_NAME });
  });

  // ── 9. Disconnect returns badge to disconnected ─────────────────────────────
  test('clicking Disconnect returns the status badge to disconnected', async ({ page }) => {
    test.setTimeout(90_000);
    await gotoKafkaSettings(page);
    await openClusterEditor(page);
    await fillTlsClusterForm(page);

    await page.locator('[data-testid="kafka-save-cluster-btn"]').click();
    await page.waitForTimeout(800);
    await connectKafkaClusterInSettings(page, 'tls-demo');

    const disconnectBtn = page.locator('[data-testid="kafka-disconnect-btn"]').first();
    await expect(disconnectBtn).toBeEnabled({ timeout: 5000 });
    await disconnectBtn.click();

    await waitForKafkaDisconnectedBadge(page);
  });
});
