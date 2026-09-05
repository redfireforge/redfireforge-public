import { test, expect } from '@playwright/test';

async function selectCustomOption(page: import('@playwright/test').Page, select: import('@playwright/test').Locator, label: string) {
  await select.locator('.cs-trigger').click();
  await page.locator('.cs-menu[role="listbox"] .cs-item[role="option"]', { hasText: label }).click();
}

async function expectCustomSelectValue(select: import('@playwright/test').Locator, value: string) {
  await expect(select).toHaveAttribute('data-value', value);
}
import { seedAppData } from './helpers';

test.describe('Shared Data Sources Modal', () => {
  /** Click a builder-tab inside the fetch panel by label */
  const clickFetchTab = async (page: import('@playwright/test').Page, label: string) => {
    await page.locator('.shared-ds-fetch-panel .builder-tab', { hasText: label }).click();
  };

  test.beforeEach(async ({ page }) => {
    await seedAppData(page);
    await page.goto('/?tab=scenarios');
    await page.waitForSelector('.header-actions', { timeout: 10000 });
  });

  test('opens as default full-panel modal aligned to content area', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    // Overlay should appear
    const overlay = page.locator('.shared-ds-overlay.modal-overlay');
    await expect(overlay).toBeVisible();

    // Background should be opaque full-panel style (same family as edit modal)
    const bgColor = await overlay.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\.[0-9]+\s*\)/);

    // Overlay should align exactly to app-main bounds (so left activity/toggle bars stay visible).
    const appMain = page.locator('.app-main');
    const appMainBox = await appMain.boundingBox();
    expect(appMainBox).not.toBeNull();

    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(Math.round(overlayBox!.x)).toBe(Math.round(appMainBox!.x));
    expect(Math.round(overlayBox!.y)).toBe(Math.round(appMainBox!.y));
    expect(Math.round(overlayBox!.width)).toBe(Math.round(appMainBox!.width));
    expect(Math.round(overlayBox!.height)).toBe(Math.round(appMainBox!.height));

    // Left vertical divider should remain visible (parity with default page separator).
    const leftShadow = await overlay.evaluate(el => getComputedStyle(el).boxShadow);
    expect(leftShadow).toContain('inset');
    expect(leftShadow).toContain('1px');

    // Modal dialog is centered within the full-panel overlay by AppModalFrame.
    const dialog = page.locator('.shared-ds-modal');
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.width).toBeGreaterThan(0);
    expect(dialogBox!.height).toBeGreaterThan(0);
    expect(dialogBox!.x + dialogBox!.width).toBeGreaterThan(overlayBox!.x);
    expect(dialogBox!.y + dialogBox!.height).toBeGreaterThan(overlayBox!.y);
  });

  test('no expand or X buttons (full-panel style)', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    const dialog = page.locator('.shared-ds-modal');
    await expect(dialog).toBeVisible();

    // No expand button
    const expandBtns = dialog.locator('.modal-expand-btn');
    await expect(expandBtns).toHaveCount(0);

    // No X close button
    const closeBtn = dialog.locator('.ram-modal-close');
    await expect(closeBtn).toHaveCount(0);
  });

  test('modal is not movable by header drag', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    const dialog = page.locator('.shared-ds-modal');
    await expect(dialog).toBeVisible();

    const before = await dialog.boundingBox();
    expect(before).not.toBeNull();

    const header = page.locator('.shared-ds-header');
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();

    await page.mouse.move(headerBox!.x + 40, headerBox!.y + 20);
    await page.mouse.down();
    await page.mouse.move(headerBox!.x + 240, headerBox!.y + 120);
    await page.mouse.up();

    const after = await dialog.boundingBox();
    expect(after).not.toBeNull();

    expect(Math.round(after!.x)).toBe(Math.round(before!.x));
    expect(Math.round(after!.y)).toBe(Math.round(before!.y));
    expect(Math.round(after!.width)).toBe(Math.round(before!.width));
    expect(Math.round(after!.height)).toBe(Math.round(before!.height));
  });

  test('shows empty state with create button when no data sources exist', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    // Empty state in editor panel
    await expect(page.locator('.shared-ds-editor-empty')).toBeVisible();
    await expect(page.locator('.shared-ds-empty-icon')).toBeVisible();
    await expect(page.locator('text=Create a shared data source to get started')).toBeVisible();

    // "+ Create First Shared Data Source" button
    const createBtn = page.locator('.shared-ds-editor-empty button', { hasText: 'Create First Shared Data Source' });
    await expect(createBtn).toBeVisible();
  });

  test('creates a new data source from empty state', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    const createBtn = page.locator('.shared-ds-editor-empty button', { hasText: 'Create First Shared Data Source' });
    await createBtn.click();

    // List should now show the new item
    const listItem = page.locator('.shared-ds-list-item');
    await expect(listItem).toHaveCount(1);
    await expect(listItem).toHaveClass(/active/);

    // Editor should show name input
    const nameInput = page.locator('.shared-ds-name-input');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Data Source 1');

    // Footer should show updated stats
    await expect(page.locator('.shared-ds-footer-stats')).toContainText('1 shared data source');
  });

  test('creates from "+ New" button in left panel', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    await page.locator('.shared-ds-new-btn').click();
    await expect(page.locator('.shared-ds-list-item')).toHaveCount(1);

    await page.locator('.shared-ds-new-btn').click();
    await expect(page.locator('.shared-ds-list-item')).toHaveCount(2);

    await expect(page.locator('.shared-ds-footer-stats')).toContainText('2 shared data sources');
  });

  test('new data source auto-focuses name input with full selection', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    await page.locator('.shared-ds-new-btn').click();

    const nameInput = page.locator('.shared-ds-name-input');
    await expect(nameInput).toBeFocused();

    const selection = await nameInput.evaluate((el) => {
      const input = el as HTMLInputElement;
      return {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
    });

    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.value.length);
  });

  test('closes via Close button in footer', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();
    await expect(page.locator('.shared-ds-overlay')).toBeVisible();

    await page.locator('.shared-ds-footer button', { hasText: 'Close' }).click();
    await expect(page.locator('.shared-ds-overlay')).not.toBeVisible();
  });

  test('left panel list item structure matches mockup', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    await page.locator('.shared-ds-new-btn').click();

    const item = page.locator('.shared-ds-list-item').first();
    await expect(item.locator('.shared-ds-list-name')).toBeVisible();
    await expect(item.locator('.shared-ds-list-count')).toBeVisible();
    await expect(item.locator('.shared-ds-list-menu-btn')).toBeAttached();
  });

  test('list panel can be collapsed and expanded with toggle button', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    // List panel should be visible initially
    const listPanel = page.locator('.shared-ds-list-panel');
    await expect(listPanel).toBeVisible();

    // Find collapse toggle button (shows ◀ when expanded)
    const toggleBtn = page.locator('.shared-ds-panel-toggle');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveText('◀');

    // Click to collapse
    await toggleBtn.evaluate((button) => (button as HTMLButtonElement).click());

    // List panel should be hidden
    await expect(listPanel).not.toBeVisible();
    // Toggle should now show ▶
    await expect(toggleBtn).toHaveText('▶');

    // Click to expand again
    await toggleBtn.evaluate((button) => (button as HTMLButtonElement).click());

    // List panel should be visible again
    await expect(listPanel).toBeVisible();
    await expect(toggleBtn).toHaveText('◀');
  });

  test('collapsed list panel gives more space to editor panel', async ({ page }) => {
    const openBtn = page.locator('.header-actions button', { hasText: 'Shared Data Sources' });
    await openBtn.click();

    const editorPanel = page.locator('.shared-ds-editor-panel');
    const initialBox = await editorPanel.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    // Collapse the list panel
    const toggleBtn = page.locator('.shared-ds-panel-toggle');
    await toggleBtn.click();

    // Editor panel should be wider now
    const expandedBox = await editorPanel.boundingBox();
    expect(expandedBox).not.toBeNull();
    const expandedWidth = expandedBox!.width;

    // Editor should gain the width of the collapsed list panel (~220px)
    expect(expandedWidth).toBeGreaterThan(initialWidth + 200);
  });

  test('imports fetch config from cURL command', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'cURL Import' }).click();
    await page.locator('.shared-ds-curl-input').fill(
      "curl -X POST 'https://api.example.com/v1/users?env=test' -H 'Authorization: Bearer {{token}}' -H 'Content-Type: application/json' -d '{\"name\":\"A\"}'"
    );
    await page.locator('.shared-ds-curl-actions .btn', { hasText: 'Import & Apply' }).click();

    // Import opens Detect Variables wizard; close it to verify persisted fetch config.
    if (await page.locator('.full-panel-modal').isVisible()) {
      await page.locator('.wf-config-modal-footer .btn', { hasText: 'Cancel' }).click();
      await expect(page.locator('.full-panel-modal')).not.toBeVisible();
    }

    await expectCustomSelectValue(page.locator('.shared-ds-fetch-method'), 'POST');
    await expect(page.locator('.shared-ds-fetch-url')).toHaveValue('https://api.example.com/v1/users?env=test');

    // Check headers tab
    await clickFetchTab(page, 'Headers');
    await expect(page.locator('.shared-ds-fetch-header-row').first().locator('.shared-ds-fetch-header-key')).toHaveValue('Content-Type');
    await expect(page.locator('.shared-ds-fetch-header-row').first().locator('.shared-ds-fetch-header-value')).toHaveValue('application/json');

    // Check auth tab
    await clickFetchTab(page, 'Auth');
    await expectCustomSelectValue(page.locator('.shared-ds-fetch-auth-type').first(), 'bearer');
    await expect(page.locator('.shared-ds-fetch-auth-input').nth(1)).toHaveValue('{{token}}');

    // Check body tab
    await clickFetchTab(page, 'Body');
    await expect(page.locator('.shared-ds-fetch-body-input')).toHaveValue('{"name":"A"}');
  });

  test('persists fetch config per selected shared source', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    await page.locator('.shared-ds-fetch-url').fill('https://api.example.com/source-1');
    await selectCustomOption(page, page.locator('.shared-ds-fetch-method'), 'PUT');

    await page.locator('.shared-ds-new-btn').click();
    await expect(page.locator('.shared-ds-list-item')).toHaveCount(2);

    await expect(page.locator('.shared-ds-fetch-url')).toHaveValue('');
    await expectCustomSelectValue(page.locator('.shared-ds-fetch-method'), 'GET');

    await page.locator('.shared-ds-fetch-url').fill('https://api.example.com/source-2');
    await selectCustomOption(page, page.locator('.shared-ds-fetch-method'), 'POST');

    await page.locator('.shared-ds-list-item').first().click();
    await expect(page.locator('.shared-ds-fetch-url')).toHaveValue('https://api.example.com/source-1');
    await expectCustomSelectValue(page.locator('.shared-ds-fetch-method'), 'PUT');

    await page.locator('.shared-ds-list-item').nth(1).click();
    await expect(page.locator('.shared-ds-fetch-url')).toHaveValue('https://api.example.com/source-2');
    await expectCustomSelectValue(page.locator('.shared-ds-fetch-method'), 'POST');
  });

  test('shows fetch URL bar and mapping chips with warnings', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    // URL bar is always visible with default GET + empty URL
    await expectCustomSelectValue(page.locator('.shared-ds-fetch-method'), 'GET');
    await expect(page.locator('.shared-ds-fetch-url')).toHaveValue('');

    await expect(page.locator('.shared-ds-mapping-chip[data-map-type="path"]')).toHaveText('path:0');
    await expect(page.locator('.shared-ds-mapping-chip[data-map-type="param"]')).toHaveText('param:1');
    await expect(page.locator('.shared-ds-mapping-chip[data-map-type="validate"]')).toHaveText('validate:0');
    await expect(page.locator('.shared-ds-mapping-warning-count')).toHaveText('1 issue');
  });

  test('opens tab content when mapping chip is clicked', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    await page.locator('.shared-ds-mapping-chip[data-map-type="param"]').click();
    await expect(page.locator('.shared-ds-tab-content')).toBeVisible();
    await expect(page.locator('.shared-ds-params-tab')).toBeVisible();
  });

  test('populate from API supports append and replace modes', async ({ page }) => {
    await page.route('**/__proxy', async route => {
      const rows = [{ id: '1', code: 'A' }, { id: '2', code: 'B' }];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rows),
        }),
      });
    });

    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();
    await page.locator('.shared-ds-fetch-url').fill('https://api.example.com/users?column=');

    // Populate opens the Data Mapper modal (new flow)
    await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'Populate Rows from API' }).click();
    await expect(page.locator('.dm-modal-overlay')).toBeVisible();

    // Data Mapper modal should have source/target panels and Save/Cancel
    const dmModal = page.locator('.dm-modal-overlay');
    await expect(dmModal.locator('.dm-modal-header')).toBeVisible();
    await expect(dmModal.locator('.dm-modal-footer button', { hasText: 'Save' })).toBeVisible();
    await expect(dmModal.locator('.dm-modal-footer button', { hasText: 'Cancel' })).toBeVisible();

    // Click Cancel to close (since no sample data is fetched without real API)
    await dmModal.locator('.dm-modal-footer button', { hasText: 'Cancel' }).click();
    await expect(page.locator('.dm-modal-overlay')).not.toBeVisible();
  });

  test('shows Detect Variables wizard after cURL import', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'cURL Import' }).click();
    await page.locator('.shared-ds-curl-input').fill(
      "curl -X GET 'https://api.example.com/v1/orders/ORD-1001/items?channel=WEB&country=US'"
    );
    await page.locator('.shared-ds-curl-actions .btn', { hasText: 'Import & Apply' }).click();

    // Wizard (DataSourceSetupModal) should open as a FullPanelModal overlay
    await expect(page.locator('.full-panel-modal')).toBeVisible();
    await expect(page.locator('.ds-setup-step-label', { hasText: /Detect Variables|Path Variables/ })).toBeVisible();
    await expect(page.locator('.ds-section-label', { hasText: 'Path Variables' })).toBeVisible();
    await expect(page.locator('.ds-section-label', { hasText: 'Query Variables' })).toBeVisible();
    await expect(page.locator('.ds-section-label', { hasText: 'URL Template Preview' })).toBeVisible();

    const orderSeg = page.locator('.path-seg').filter({ hasText: '/ORD-1001' }).first();
    await orderSeg.locator('input[type="checkbox"]').check();
    await orderSeg.locator('.path-var-input').fill('orderId');

    await expect(page.locator('.url-pattern-box')).toContainText('{{orderId}}');
    await expect(page.locator('.url-pattern-box')).toContainText('channel={{channel}}');
    await expect(page.locator('.url-pattern-box')).toContainText('country={{country}}');

    await page.locator('.wf-config-modal-footer .btn', { hasText: 'Cancel' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible();
  });

  test('keeps raw cURL text after import and while switching sources', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    const curl = "curl -X GET 'https://api.example.com/items?channel=MC' -H 'Authorization: Bearer {{token}}'";
    await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'cURL Import' }).click();
    await page.locator('.shared-ds-curl-input').fill(curl);
    await page.locator('.shared-ds-curl-actions .btn', { hasText: 'Import & Apply' }).click();

    // Wizard opens after import — close it before checking cURL persistence
    await page.locator('.wf-config-modal-footer .btn', { hasText: 'Cancel' }).click();
    await expect(page.locator('.full-panel-modal')).not.toBeVisible();

    await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'cURL Import' }).click();
    await expect(page.locator('.shared-ds-curl-input')).toHaveValue(curl);

    await page.locator('.shared-ds-new-btn').click();
    if (!(await page.locator('.shared-ds-curl-input').isVisible())) {
      await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'cURL Import' }).click();
    }
    await expect(page.locator('.shared-ds-curl-input')).toHaveValue('');

    await page.locator('.shared-ds-list-item').first().click();
    if (!(await page.locator('.shared-ds-curl-input').isVisible())) {
      await page.locator('.shared-ds-fetch-actions .btn', { hasText: 'cURL Import' }).click();
    }
    await expect(page.locator('.shared-ds-curl-input')).toHaveValue(curl);
  });

  test('supports auth type selection including inherit', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();
    await clickFetchTab(page, 'Auth');

    const authType = page.locator('.shared-ds-fetch-auth-type').first();
    await expectCustomSelectValue(authType, 'none');

    await selectCustomOption(page, authType, 'Inherit');
    await expectCustomSelectValue(authType, 'inherit');

    await selectCustomOption(page, authType, 'Bearer');
    await expect(page.locator('.shared-ds-fetch-auth-input').nth(1)).toBeVisible();

    await selectCustomOption(page, authType, 'Basic');
    await expect(page.locator('.shared-ds-fetch-auth-input[placeholder="Enter username"]')).toBeVisible();
  });

  test('footer provides Cancel, Save, and Close actions', async ({ page }) => {
    await page.locator('.header-actions button', { hasText: 'Shared Data Sources' }).click();
    await page.locator('.shared-ds-new-btn').click();

    const footer = page.locator('.shared-ds-footer');
    await expect(footer.locator('button', { hasText: 'Cancel' })).toBeVisible();
    await expect(footer.locator('button', { hasText: 'Save' })).toBeVisible();
    await expect(footer.locator('button', { hasText: 'Close' })).toBeVisible();

    await page.locator('.shared-ds-name-input').fill('Draft Name');
    await footer.locator('button', { hasText: 'Save' }).click();

    await page.locator('.shared-ds-name-input').fill('Unsaved Name');
    await footer.locator('button', { hasText: 'Cancel' }).click();
    await expect(page.locator('.shared-ds-name-input')).toHaveValue('Draft Name');
  });
});
