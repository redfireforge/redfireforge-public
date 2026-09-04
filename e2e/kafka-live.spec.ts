/**
 * kafka-live.spec.ts — Live Docker-backed E2E tests for Kafka features.
 *
 * Prerequisites (must be running before this suite):
 *   - Dev servers:  npm run dev  (Vite :5173, Express :3001)
 *   - Docker stack: docker compose -f docker/docker-compose.yml up -d
 *       redfireforge-redpanda  → plaintext Kafka on localhost:19092
 *       redfireforge-schema-registry → Schema Registry HTTP on localhost:8085
 *
 * Coverage:
 *   1. Kafka cluster creation in Settings → auto-connects
 *   2. Publish — send a message to orders.created, assert success result
 *   3. Consume — fetch earliest 5 messages, assert results table + detail pane
 *   4. Topics — list topics, filter to "orders" domain, open orders.created details
 *   5. Schema Registry — connect to localhost:8085, browse subjects, open schema, switch version
 *   6. Gallery — load all 4 Kafka workflow samples, run Quick Test, assert all pass
 *
 * Run with:
 *   npx playwright test e2e/kafka-live.spec.ts --reporter=list
 */

import { expect, test, type Page } from '@playwright/test';
import { seedAppData } from './helpers';
import {
  consumeKafkaMessages,
  gotoKafkaPublishTab,
  isSchemaRegistryReachable,
  publishKafkaMessage,
  waitForKafkaStatusConnected,
} from './kafka-docker-helpers';
import { installKafkaCompanionLock } from './kafka-companion-lock';
import { seedSchemaRegistryOrdersValue } from './schema-registry-seed';

installKafkaCompanionLock(test);

// ── Skip entire suite when backend / Docker infra is not running ──────────────

async function isBackendReachable(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

const backendUp = isBackendReachable();

// ── Config ────────────────────────────────────────────────────────────────────

const BROKER = '127.0.0.1:19092';
const SR_URL = 'http://localhost:8085';
const CLUSTER_NAME = 'Local Plaintext';
// Must match the clusterId hardcoded in the Gallery workflow factories
const CLUSTER_ID = 'local-plaintext';

// ── Helper: seed a Kafka cluster in localStorage ──────────────────────────────

async function seedKafkaCluster(page: Page): Promise<void> {
  await page.addInitScript(
    ([name, id, broker]: [string, string, string]) => {
      const cluster = {
        id,
        name,
        clientId: `redfireforge-${id}`,
        brokers: [broker],
        auth: { type: 'none' },
        tls: { enabled: false, verifyCert: true },
        connectionTimeoutMs: 10000,
        requestTimeoutMs: 10000,
      };
      // Canonical storage keys from src/shared/kafka/kafkaStorage.ts
      localStorage.setItem('perf-test-kafka-clusters-v1', JSON.stringify([cluster]));
      localStorage.setItem('perf-test-kafka-selected-cluster-id', id);
      localStorage.setItem('perf-test-kafka-auto-connect-on-startup', 'true');
    },
    [CLUSTER_NAME, CLUSTER_ID, BROKER] as [string, string, string],
  );
}

// ── Helper: load a Gallery workflow sample ────────────────────────────────────

async function loadGalleryWorkflow(page: Page, title: string): Promise<void> {
  await page.goto('/?tab=gallery', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('input[placeholder="Search gallery..."]').fill('kafka');
  await page.waitForTimeout(600);
  await page.locator(`button:has-text("${title}")`).click();
  await page.waitForTimeout(400);
  // Load Workflow button may be intercepted by overlay — use JS click
  await page.evaluate((t: string) => {
    const btns = [...document.querySelectorAll('button')];
    const load = btns.find(b => b.textContent?.trim() === 'Load Workflow');
    if (load) load.click();
    void t;
  }, title);
  await page.waitForURL('**/\\?tab=workflow', { timeout: 8000 });
  await page.waitForTimeout(600);
}

// ── Helper: run Quick Test and assert N/N passed ──────────────────────────────

async function runQuickTestAndAssertPassed(
  page: Page,
  expectedTotal: number,
  timeoutMs = 25_000,
): Promise<void> {
  const status = page.locator('text=/\\d+\\/\\d+ passed/').first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      btns.find(b => b.textContent?.trim() === 'Quick Test')?.click();
    });
    try {
      await expect(status).toBeVisible({ timeout: timeoutMs });
      break;
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
  const statusText = await status.textContent();
  expect(statusText).toContain(`${expectedTotal}/${expectedTotal} passed`);
}

// ── Kafka Message Studio ───────────────────────────────────────────────────────

test.describe('Kafka Message Studio — Live Docker', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    test.skip(!(await backendUp), 'Skipped: backend server (port 3001) or Docker Kafka not running');
    await seedAppData(page);
    await seedKafkaCluster(page);
    await page.goto('/?tab=kafka-message-studio', { waitUntil: 'domcontentloaded' });
    const kafkaBtn = page.locator('main button:has-text("Kafka")').first();
    if (await kafkaBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await kafkaBtn.click();
    }
    await waitForKafkaStatusConnected(page, 30_000);
  });

  test('Publish — sends a message to orders.created and shows success result', async ({ page }) => {
    await gotoKafkaPublishTab(page);
    await publishKafkaMessage(page, 'orders.created', {
      orderId: 'E2E-LIVE-001',
      status: 'CREATED',
      amount: '99.00',
    });
  });

  test('Consume — fetches messages from orders.created and shows detail pane', async ({ page }) => {
    test.setTimeout(150_000);
    await gotoKafkaPublishTab(page);
    await publishKafkaMessage(page, 'orders.created', {
      orderId: 'E2E-LIVE-CONSUME',
      status: 'CREATED',
      amount: '1.00',
    });
    await consumeKafkaMessages(page, 'orders.created');

    const rows = page.locator('[data-testid^="con-row-"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    await rows.last().click();
    const detail = page.getByRole('dialog', { name: 'Message Detail' });
    await expect(detail).toBeVisible({ timeout: 5_000 });
    await expect(detail.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
  });

  test('Topics — lists topics with domain chips and opens orders.created detail', async ({ page }) => {
    await page.locator('[data-testid="tab-topics"]').click();
    await page.waitForTimeout(2500);

    // Domain chips should appear
    await expect(page.locator('button:has-text("orders")')).toBeVisible({ timeout: 8000 });

    // Filter to orders domain
    await page.locator('button:has-text("orders")').first().click();
    await page.waitForTimeout(600);

    // orders.created row should be visible
    await expect(page.locator('text=orders.created')).toBeVisible({ timeout: 5000 });

    // Click it to open topic detail
    await page.locator('[data-testid="topic-row-orders.created"]').click();
    await expect(page.getByText('Loading topic details…')).toHaveCount(0, { timeout: 15_000 });

    await expect(page.locator('[data-testid="detail-tab-partitions"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="detail-tab-partitions"]').click();

    const partitionRows = page.locator('[data-testid="detail-partitions-tab"] table.kafka-partition-table tbody tr');
    await expect(partitionRows.first()).toBeVisible({ timeout: 15_000 });
    expect(await partitionRows.count()).toBeGreaterThanOrEqual(1);
  });

  test('Schema Registry — connects to localhost:8085 and browses subjects', async ({ page }) => {
    test.skip(!(await isSchemaRegistryReachable()), 'Skipped: Schema Registry (port 8085) not running');
    await seedSchemaRegistryOrdersValue();
    await page.locator('[data-testid="tab-schema"]').click();
    await page.waitForTimeout(400);

    // Fill SR URL and connect / refresh subjects
    await page.locator('input[placeholder="http://localhost:8085"]').fill(SR_URL);
    await page.getByRole('button', { name: /Connect to Registry|Refresh Subjects/i }).click();
    await page.waitForTimeout(3000);

    // Subjects table should appear (Docker SR uses orders-value, not orders.created-value)
    await expect(page.locator('text=orders-value')).toBeVisible({ timeout: 8000 });

    await page.locator('text=orders-value').click();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Avro').first()).toBeVisible({ timeout: 5000 });

    // Version picker is a CustomSelect — latest version should be selected after load
    await expect(page.getByLabel('Schema version')).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('Schema version')).toContainText(/v\d+/);

    await expect(page.locator('[data-testid="copy-schema-btn"]')).toBeVisible({ timeout: 3000 });
  });
});

// ── Gallery Workflow Quick Tests ───────────────────────────────────────────────

test.describe('Gallery — Kafka Workflow Quick Tests (Live Docker)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    test.skip(!(await backendUp), 'Skipped: backend server (port 3001) or Docker Kafka not running');
    await seedAppData(page);
    await seedKafkaCluster(page);
  });

  test('Kafka: Publish Order Event — Quick Test 3/3 passed', async ({ page }) => {
    await loadGalleryWorkflow(page, 'Kafka: Publish Order Event');
    await waitForKafkaStatusConnected(page, 30_000);
    await runQuickTestAndAssertPassed(page, 3);
  });

  test('Kafka: Event-Triggered Processor — Quick Test 6/6 passed', async ({ page }) => {
    await loadGalleryWorkflow(page, 'Kafka: Event-Triggered Processor');
    await waitForKafkaStatusConnected(page, 30_000);
    await runQuickTestAndAssertPassed(page, 6);
  });

  test('Kafka: Full Event Pipeline — Quick Test 8/8 passed', async ({ page }) => {
    test.setTimeout(150_000);
    await loadGalleryWorkflow(page, 'Kafka: Full Event Pipeline');
    await waitForKafkaStatusConnected(page, 30_000);
    await runQuickTestAndAssertPassed(page, 8, 90_000);
  });

  test('Kafka: Async Request–Reply — Quick Test 8/8 passed', async ({ page }) => {
    test.setTimeout(60_000);
    await loadGalleryWorkflow(page, 'Kafka: Async Request');
    await waitForKafkaStatusConnected(page, 30_000);
    await runQuickTestAndAssertPassed(page, 8, 30_000);
  });
});
