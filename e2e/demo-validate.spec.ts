import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test('demo control simplification visual check', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Navigate to Demo Hub via title="Demo Hub" on the activity bar button
  await page.getByTestId('ab-demo-hub').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/01-hub.png' });

  // Enter first domain
  const domainCard = page.locator('.demo-hub-domain-card, .demo-domain-card').first();
  await domainCard.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/02-domain.png' });

  // Switch to WebSocket category (no Docker required, reliable for CI)
  const wsTab = page.locator('.demo-category-tab').filter({ hasText: /WebSocket/i });
  if (await wsTab.count() > 0) {
    await wsTab.click();
    await page.waitForTimeout(300);
    console.log('[ACTION] Switched to WebSocket category');
  }

  // Enter first lesson in the active category
  const lessonItem = page.locator('.demo-hub-lesson-item, .demo-lesson-item').first();
  await lessonItem.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/03-lesson.png' });

  // LessonPlayer: only "Start Demo" visible (enabled), no speed selectors, no back btn
  const startBtn = page.locator('button').filter({ hasText: /Start Demo/ }).first();
  await expect(startBtn).toBeVisible({ timeout: 5000 });
  await expect(startBtn).toBeEnabled({ timeout: 5000 });
  const speedSelector = page.locator('.demo-speed-selector');
  expect(await speedSelector.count()).toBe(0);
  const lessonBackBtn = page.locator('.demo-lesson-player-footer button:has-text("Back")');
  expect(await lessonBackBtn.count()).toBe(0);
  console.log('[PASS] LessonPlayer footer: only Start Demo, no speed/back');

  // Start the demo
  await startBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/04-live.png' });

  // LiveDemo panel must have: restart btn, no prev btn, no speed controls
  const restartBtn = page.locator('.demo-live-restart-btn');
  await expect(restartBtn).toBeVisible({ timeout: 5000 });
  const prevBtn = page.locator('.demo-live-prev-btn');
  expect(await prevBtn.count()).toBe(0);
  const liveSpeedBtns = page.locator('.demo-live-speed-btn');
  expect(await liveSpeedBtns.count()).toBe(0);
  console.log('[PASS] LiveDemo controls: restart present, no prev/speed');

  // Next stays disabled during reading/action; enabled only when step is done
  const nextBtn = page.locator('[aria-label="Next step"]');
  await expect(nextBtn).toBeVisible();
  const isDisabled = await nextBtn.getAttribute('disabled');
  console.log('[CHECK] Next disabled during pipeline:', isDisabled !== null ? 'YES' : 'NO (step already done)');

  // Wait for reading phase via panel attribute (Next remains disabled while reading)
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="demo-live-panel"]')?.getAttribute('data-step-phase') === 'reading';
  }, { timeout: 15000 }).catch(() => console.log('[WARN] Never reached reading phase'));
  await expect(nextBtn).toBeDisabled();
  await page.screenshot({ path: '/tmp/05-reading.png' });
  console.log('[PASS] Next button disabled in reading phase');

  // Pause auto-play so demo doesn't advance while we check controls
  const playBtn = page.locator('.demo-live-play-btn');
  const playTitle = await playBtn.getAttribute('title').catch(() => '');
  if (playTitle && playTitle.includes('Pause')) {
    await playBtn.click();
    await page.waitForTimeout(300);
    console.log('[ACTION] Paused auto-play');
  }

  // Open overview drawer and verify read-only
  const overviewBtn = page.locator('.demo-live-overview-btn');
  if (await overviewBtn.count() > 0) {
    await overviewBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/06-overview.png' });
    const clickableBtns = await page.locator('.demo-overview-modal-item button').count();
    const readonlyDivs = await page.locator('.demo-overview-modal-item--readonly').count();
    expect(clickableBtns).toBe(0);
    expect(readonlyDivs).toBeGreaterThan(0);
    console.log('[PASS] Overview is read-only -', readonlyDivs, 'readonly items');
    // Close via the X button (not Escape — Escape also exits the live demo via useDemoShortcuts)
    const closeBtn = page.locator('.demo-overview-modal-close');
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(200);
  }

  // Restart button should still be visible (overview close must NOT exit the demo)
  await expect(restartBtn).toBeVisible({ timeout: 5000 });
  console.log('[PASS] Restart button still visible after closing overview');

  // Click restart — demo goes back to step 1
  await restartBtn.click();
  // Wait for restart to complete (cleanup + setup + step 0 action)
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/07-restarted.png' });
  const stepText = await page.locator('.demo-live-step-counter').textContent().catch(() => '');
  console.log('[CHECK] Step counter after restart:', JSON.stringify(stepText));

  // Exit demo — must work without crashing
  const exitBtn = page.locator('.demo-live-exit-btn');
  await expect(exitBtn).toBeVisible({ timeout: 3000 });
  await exitBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/08-exited.png' });
  console.log('[PASS] Exit worked');
});
