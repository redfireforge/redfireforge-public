/**
 * Visual validation: Kafka Consume timestamp column.
 *
 * Strategy:
 * - Pre-seed localStorage via addInitScript (runs before page JS)
 * - Set up route mocks BEFORE page.goto so the first status poll is intercepted
 * - Navigate after both are ready
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as path from 'path';

const SCREENSHOT_DIR = 'e2e/screenshots';
const CLUSTER_ID = 'e2e-ts-cluster';

const MOCK_CLUSTER = {
  clusterId: CLUSTER_ID,
  name: 'E2E Visual Cluster',
  clientId: `redfireforge-${CLUSTER_ID}`,
  brokers: ['localhost:9092'],
  auth: { mechanism: 'none' },
  tls: { enabled: false },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/** Build the mock messages for consume-once. */
function buildMockMessages(nowMs: number) {
  return {
    messageCount: 5,
    timedOut: false,
    hasMore: true,
    messages: [
      { topic: 'orders.created', partition: 2, offset: '999',  timestamp: String(nowMs - 4 * 60_000),    key: 'order-999',          value: JSON.stringify({ orderId: 'ORD-999',  status: 'CREATED', amount: 42.50 }) },
      { topic: 'orders.created', partition: 1, offset: '1000', timestamp: String(nowMs - 2 * 3_600_000), key: 'tpl-customer-456',   value: JSON.stringify({ orderId: 'ORD-TPL-001', status: 'PENDING' }) },
      { topic: 'orders.created', partition: 2, offset: '1001', timestamp: String(nowMs - 30_000),         key: 'order-001',          value: JSON.stringify({ orderId: 'ORD-001',  status: 'CREATED', amount: 99.56 }) },
      { topic: 'orders.created', partition: 2, offset: '1002', timestamp: String(nowMs - 5000),           key: 'order-002',          value: JSON.stringify({ orderId: 'ORD-002',  status: 'CREATED', amount: 150.00 }) },
      { topic: 'orders.created', partition: 2, offset: '1003', /* no timestamp */                         key: 'CUST-TEST-VISUAL',   value: JSON.stringify({ orderId: 'VIS-TEST-001' }) },
    ],
  };
}

test.describe('Kafka Consume — Timestamp column', () => {

  /** Shared setup for all tests that need consume results. */
  async function setupWithResults(page: Page, context: BrowserContext) {
    const nowMs = Date.now();

    // 1. Seed localStorage BEFORE navigation
    await context.addInitScript((cluster: typeof MOCK_CLUSTER) => {
      localStorage.setItem('perf-test-kafka-clusters-v1', JSON.stringify([cluster]));
      localStorage.setItem('perf-test-kafka-selected-cluster-id', cluster.clusterId);
      localStorage.setItem('perf-test-kafka-auto-connect-on-startup', 'false');
    }, MOCK_CLUSTER);

    // 2. Mock API routes BEFORE navigation — all responses use the KafkaEnvelope format:
    //    { ok: true, op: "<operation>", data: { ... } }
    await page.route('**/api/kafka/status**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, op: 'status', data: { state: 'connected', clusterId: CLUSTER_ID, connectedAt: new Date().toISOString() } }) })
    );
    await page.route('**/api/kafka/connect', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, op: 'connect', data: { state: 'connected', clusterId: CLUSTER_ID } }) })
    );
    await page.route('**/api/kafka/consume-once', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, op: 'consume-once', data: buildMockMessages(nowMs) }) })
    );

    // 3. Navigate
    await page.goto('http://localhost:5173/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // 4. Go to Protocols → Consume tab
    await page.locator('.ab-btn').filter({ hasText: /Protocols/i }).click();
    await page.waitForSelector('button:has-text("Consume")', { timeout: 10000 });
    await page.locator('button').filter({ hasText: /^Consume$/ }).first().click();
    await page.waitForTimeout(500);

    // 5. Fill topic — use the id selector (id=kms-con-topic)
    const topicInput = page.locator('#kms-con-topic');
    await topicInput.waitFor({ state: 'visible', timeout: 8000 });
    await topicInput.fill('orders.created');
    await page.waitForTimeout(300);

    // 6. Wait for Consume button to enable, then click
    const btn = page.locator('[data-testid="con-consume-btn"]');
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="con-consume-btn"]')?.hasAttribute('disabled'),
      undefined,
      { timeout: 12000 }
    );
    await btn.click();
    await page.waitForSelector('[data-testid="con-row-0"]', { timeout: 10000 });
    await page.waitForTimeout(400);
  }

  test('KT-01: Consume tab loads and topic input is visible', async ({ page, context }) => {
    await context.addInitScript((cluster: typeof MOCK_CLUSTER) => {
      localStorage.setItem('perf-test-kafka-clusters-v1', JSON.stringify([cluster]));
      localStorage.setItem('perf-test-kafka-selected-cluster-id', cluster.clusterId);
    }, MOCK_CLUSTER);

    await page.route('**/api/kafka/status**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, op: 'status', data: { state: 'connected', clusterId: CLUSTER_ID, connectedAt: new Date().toISOString() } }) })
    );

    await page.goto('http://localhost:5173/', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.locator('.ab-btn').filter({ hasText: /Protocols/i }).click();
    await page.waitForSelector('button:has-text("Consume")', { timeout: 10000 });
    await page.locator('button').filter({ hasText: /^Consume$/ }).first().click();
    await page.waitForTimeout(500);

    // Use id selector as the reliable fallback
    const topicInput = page.locator('#kms-con-topic');
    await expect(topicInput).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kt-01-consume-empty.png') });
    console.log('[KT-01] Consume form visible ✓');
  });

  test('KT-02: Timestamp column header visible after consuming', async ({ page, context }) => {
    await setupWithResults(page, context);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kt-02-consume-results.png') });

    const tsHeader = page.locator('th.kafka-ts-th');
    await expect(tsHeader).toBeVisible({ timeout: 5000 });
    await expect(tsHeader).toHaveText('Timestamp');
    console.log('[KT-02] Timestamp header visible ✓');
  });

  test('KT-03: 4 cells with local time, 1 missing dash', async ({ page, context }) => {
    await setupWithResults(page, context);

    const tsCells = page.locator('[data-testid="ts-cell"]');
    await expect(tsCells).toHaveCount(4, { timeout: 5000 });

    const texts = await tsCells.allTextContents();
    console.log('[KT-03] Local times:', texts);
    for (const text of texts) {
      expect(text.trim()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }

    const missingCells = page.locator('[data-testid="ts-cell-missing"]');
    await expect(missingCells).toHaveCount(1);
    const missingText = (await missingCells.first().textContent())?.trim() ?? '';
    expect(['—', '-']).toContain(missingText);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kt-03-timestamp-cells.png') });
    console.log('[KT-03] Timestamp variants and missing cell ✓');
  });

  test('KT-04: Tooltips contain full datetime with year', async ({ page, context }) => {
    await setupWithResults(page, context);

    const tsCells = page.locator('[data-testid="ts-cell"]');
    await expect(tsCells).toHaveCount(4);

    const titles = await Promise.all(
      Array.from({ length: 4 }, (_, i) => tsCells.nth(i).getAttribute('title'))
    );
    console.log('[KT-04] Tooltips:', titles);
    for (const title of titles) {
      expect(title).toMatch(/202\d.*\d{2}:\d{2}:\d{2}/);
    }

    // Hover first cell
    await tsCells.first().hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kt-04-tooltip-hover.png') });
    console.log('[KT-04] Tooltips validated ✓');
  });

  test('KT-05: Full table screenshot — all 5 rows with timestamp column', async ({ page, context }) => {
    await setupWithResults(page, context);

    for (let i = 0; i < 5; i++) {
      await expect(page.locator(`[data-testid="con-row-${i}"]`)).toBeVisible();
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'kt-05-full-table.png'),
      fullPage: false,
    });
    console.log('[KT-05] All 5 rows visible ✓');
  });
});
