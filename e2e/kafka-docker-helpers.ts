/**
 * Shared helpers for live Docker-backed Kafka E2E specs.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** Pick an option from a CustomSelect (pass wrapper, trigger, or aria-label locator). */
export async function selectCustomOption(page: Page, select: Locator, label: string): Promise<void> {
  const wrapper = select.locator('xpath=ancestor-or-self::*[contains(@class,"cs-wrapper")]').first();
  await wrapper.locator('.cs-trigger').click();
  const menu = page.locator('.cs-menu[role="listbox"]');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  await menu.locator('.cs-item[role="option"]', { hasText: label }).click();
}

/** Enable auto-connect so Message Studio reconnects after a full page reload. */
export async function seedKafkaAutoConnect(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-kafka-auto-connect-on-startup', 'true');
  });
}

/** Navigate to publish tab without full reload — preserves in-memory Kafka connection. */
export async function gotoKafkaPublishTab(page: Page): Promise<void> {
  const studioNav = page.getByTestId('nav-tab-kafka-message-studio');
  if (await studioNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    await studioNav.click();
  } else {
    await page.getByTestId('ab-protocols').click();
    await expect(studioNav).toBeVisible({ timeout: 5000 });
    await studioNav.click();
  }
  await page.waitForTimeout(600);

  await page.locator('[data-testid="tab-publish"]').click();
  await page.waitForTimeout(400);
  await expect(page.getByRole('button', { name: /Kafka status:.*Connected/i })).toBeVisible({ timeout: 20_000 });
}

export async function waitForKafkaConnectedBadge(page: Page, timeoutMs = 20_000): Promise<void> {
  await expect(page.locator('.kafka-status-badge.state-connected').first()).toBeVisible({ timeout: timeoutMs });
}

/** Header indicator on Message Studio / Designer — auto-connect can take >8s under CI load. */
export async function waitForKafkaStatusConnected(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect(page.getByRole('button', { name: /Kafka status:.*Connected/i })).toBeVisible({ timeout: timeoutMs });
}

async function prepareKafkaConsumeForm(page: Page, topic: string): Promise<void> {
  await page.locator('[data-testid="tab-consume"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="con-topic-input"]').fill(topic);
  await selectCustomOption(page, page.locator('[data-testid="con-position-select"]'), 'Earliest');
  await expect(page.locator('[data-testid="con-position-select"]')).toContainText(/Earliest/i);

  // Fresh group so Earliest is not stuck on a previously committed offset.
  const group = page.locator('#kms-con-group');
  if (await group.isVisible().catch(() => false)) await group.fill('');

  const max = page.locator('#kms-con-max');
  if (await max.isVisible().catch(() => false)) await max.fill('5');

  const timeout = page.locator('#kms-con-timeout');
  if (await timeout.isVisible().catch(() => false)) await timeout.fill('8000');

  const jsonPath = page.locator('[data-testid="con-jsonpath-input"]');
  if (await jsonPath.isVisible().catch(() => false)) await jsonPath.fill('');
  const jsonVal = page.locator('[data-testid="con-jsonval-input"]');
  if (await jsonVal.isVisible().catch(() => false)) await jsonVal.fill('');
  const bodyContains = page.locator('[data-testid="con-body-contains-input"]');
  if (await bodyContains.isVisible().catch(() => false)) await bodyContains.fill('');

  // consumeOnce closes over React draft state — wait for fills/select to commit
  // or the request still goes out as Latest and waits the full timeout on an empty window.
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="con-consume-btn"]')).toBeEnabled({ timeout: 10_000 });
}

export async function consumeKafkaMessages(page: Page, topic: string): Promise<void> {
  await prepareKafkaConsumeForm(page, topic);

  const btn = page.locator('[data-testid="con-consume-btn"]');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await page.locator('[data-testid="tab-publish"]').click();
      await page.waitForTimeout(300);
      await publishKafkaMessage(page, topic, { orderId: `E2E-CONSUME-RETRY-${attempt}`, status: 'CREATED' });
      await prepareKafkaConsumeForm(page, topic);
    }

    await btn.click();
    // locator.isVisible({ timeout }) does not wait — wait for the in-flight consume
    // to finish, then assert the first result row.
    await expect(btn).toHaveText(/Consume Once/, { timeout: 50_000 });
    if (await page.locator('[data-testid="con-row-0"]').isVisible().catch(() => false)) return;
  }
  await expect(page.locator('[data-testid="con-row-0"]')).toBeVisible({ timeout: 5_000 });
}

export async function waitForKafkaDisconnectedBadge(page: Page, timeoutMs = 15_000): Promise<void> {
  await expect(page.locator('.kafka-status-badge.state-disconnected').first()).toBeVisible({ timeout: timeoutMs });
}

export async function disconnectKafkaClusterBackend(page: Page, clusterId?: string): Promise<void> {
  await page.request.post('http://localhost:3001/api/kafka/disconnect', {
    data: clusterId ? { clusterId } : {},
  }).catch(() => {});
  await page.waitForTimeout(500);
}

export async function connectKafkaClusterInSettings(page: Page, clusterId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await disconnectKafkaClusterBackend(page, clusterId);
    const clearError = page.getByRole('button', { name: 'Clear Error' });
    if (await clearError.isEnabled({ timeout: 500 }).catch(() => false)) {
      await clearError.click();
      await page.waitForTimeout(400);
    }
    const connectBtn = page.locator('[data-testid="kafka-connect-btn"]').first();
    await expect(connectBtn).toBeEnabled({ timeout: 8000 });
    await connectBtn.click();
    try {
      await waitForKafkaConnectedBadge(page, 30_000);
      return;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  await waitForKafkaConnectedBadge(page, 30_000);
}

export async function expectKafkaTestConnectionFailed(page: Page, clusterId: string): Promise<void> {
  // Backend reuses open connections by clusterId — force a fresh SASL probe.
  await disconnectKafkaClusterBackend(page, clusterId);
  await expect(page.locator('[data-testid="kafka-test-btn"]')).toBeEnabled({ timeout: 15_000 });
  await page.locator('[data-testid="kafka-test-btn"]').click();
  await expect(page.locator('[data-testid="kafka-test-result"].kafka-test-result--fail')).toBeVisible({
    timeout: 30_000,
  });
}

export async function publishKafkaMessage(
  page: Page,
  topic: string,
  body: Record<string, unknown>,
): Promise<void> {
  await page.locator('input[placeholder="e.g. orders.events"]').fill(topic);
  await page.locator('textarea[placeholder*="key"]').fill(JSON.stringify(body));
  await expect(page.locator('[data-testid="pub-send-btn"]')).toBeEnabled({ timeout: 10_000 });
  await page.locator('[data-testid="pub-send-btn"]').click();
  await expect(page.locator('[data-testid="pub-result"]')).toBeVisible({ timeout: 20_000 });
  const resultText = await page.locator('[data-testid="pub-result"]').textContent();
  expect(resultText).toContain(topic);
  expect(resultText).not.toContain('Error');
}

export async function isSchemaRegistryReachable(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:8085/subjects', { signal: AbortSignal.timeout(3_000) });
    return resp.ok;
  } catch {
    return false;
  }
}
