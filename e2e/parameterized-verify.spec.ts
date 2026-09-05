import { test, expect, type Page } from '@playwright/test';

/**
 * E2E test: Parameterized test copy + Verify All should send auth headers.
 *
 * Seeds a regular test with OAuth2 auth (via global profile), converts it to
 * a parameterized copy, then intercepts the /__proxy call during Verify All
 * to confirm the Authorization header is present.
 */

async function _seedWithOAuth2Test(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'https://api.example.com' },
    }]));
    localStorage.setItem('perf-test-global-auth-profiles', JSON.stringify([{
      id: 'profile-1',
      name: 'test-oauth2',
      auth: {
        type: 'oauth2',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
      id: 'fg-1',
      name: 'E2E Feature',
      microserviceId: 'svc-1',
      environmentId: 'env-1',
      auth: { type: 'inherit' },
      globalAuthProfileId: 'profile-1',
      scenarios: [{
        id: 'sc-1',
        name: 'E2E Scenario',
        auth: { type: 'inherit' },
        tests: [{
          id: 'test-1',
          name: 'Vehicle Offers',
          url: 'https://api.example.com/vehicles/VIN123/offers?channel=WEB&country=US',
          method: 'GET',
          headers: [{ key: 'Accept-Language', value: 'en-US' }],
          body: '',
          auth: { type: 'inherit' },
          validation: { mode: 'selective', expectedFields: [{ jsonPath: 'status', expectedValue: 'ok' }] },
        }],
      }],
    }]));
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
  });
}

/** Seed with a ready-made parameterized test (skip the copy wizard) */
async function seedWithParameterizedTest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
    localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
      id: 'svc-1', name: 'test-service',
      baseUrls: { 'env-1': 'https://api.example.com' },
    }]));
    localStorage.setItem('perf-test-global-auth-profiles', JSON.stringify([{
      id: 'profile-1',
      name: 'test-oauth2',
      auth: {
        type: 'oauth2',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      },
    }]));
    localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
      id: 'fg-1',
      name: 'E2E Feature',
      microserviceId: 'svc-1',
      environmentId: 'env-1',
      auth: { type: 'inherit' },
      globalAuthProfileId: 'profile-1',
      scenarios: [{
        id: 'sc-1',
        name: 'E2E Scenario',
        auth: { type: 'inherit' },
        tests: [{
          id: 'test-p',
          name: 'Vehicle Offers (Parameterized)',
          url: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}&country={{country}}',
          method: 'GET',
          headers: [{ key: 'Accept-Language', value: 'en-US' }],
          body: '',
          auth: { type: 'inherit' },
          validation: { mode: 'none' },
          sourceTestId: 'test-orig',
          dataSource: {
            id: 'ds-1',
            columns: [
              { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
              { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
              { id: 'col-co', name: 'country', type: 'param', mapping: 'country' },
            ],
            rows: [
              { id: 'row-1', values: { 'col-vin': 'VIN123', 'col-ch': 'WEB', 'col-co': 'US' }, enabled: true, isSample: true },
            ],
            source: { type: 'inline' },
            distribution: 'sequential',
            validationMode: 'selective',
          },
        }],
      }],
    }]));
    localStorage.setItem('perf-test-v3-selected-env', 'env-1');
    localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
    localStorage.setItem('perf-test-v3-migrated', 'true');
    localStorage.setItem('perf-test-theme', 'dark');
  });
}

async function openTestEditor(page: Page) {
  await page.goto('/?tab=scenarios');
  await page.waitForSelector('.app-header', { timeout: 25000 });
  await page.waitForLoadState('networkidle');

  const fgName = page.locator('.feature-group-card .feature-group-name', { hasText: 'E2E Feature' });
  await expect(fgName).toBeVisible({ timeout: 10000 });
  await fgName.click();

  const scName = page.locator('.scenario-group-name', { hasText: 'E2E Scenario' });
  await expect(scName).toBeVisible({ timeout: 5000 });
  await scName.click();

  await expect(page.locator('.test-card')).toBeVisible({ timeout: 5000 });
  await page.locator('.test-card button:has-text("Edit")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
}

test.describe('Parameterized Test — Verify All Auth', () => {

  test('Verify All sends Authorization header for inherited OAuth2 auth', async ({ page }) => {
    await seedWithParameterizedTest(page);
    await openTestEditor(page);

    // Navigate to Data Source tab
    const dataTab = page.locator('.builder-tab', { hasText: 'Data Source' });
    await expect(dataTab).toBeVisible({ timeout: 5000 });
    await dataTab.click();

    // Should see the data source toolbar
    await expect(page.locator('.params-section-label', { hasText: 'DATA SOURCE' })).toBeVisible({ timeout: 5000 });

    // Intercept /__proxy calls to capture what headers are sent
    const proxyRequests: { url: string; headers: Record<string, string> }[] = [];

    // First intercept the OAuth2 token request
    await page.route('**/__proxy', async (route) => {
      const postData = route.request().postDataJSON();

      // If this is the token request, return a fake token
      if (postData?.url?.includes('/token')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 200,
            statusText: 'OK',
            headers: {},
            body: JSON.stringify({ access_token: 'fake-oauth2-token-12345', token_type: 'Bearer', expires_in: 3600 }),
          }),
        });
        return;
      }

      // For the actual API request, capture the headers and return a mock response
      proxyRequests.push({
        url: postData?.url ?? '',
        headers: postData?.headers ?? {},
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'ok', offers: [] }),
        }),
      });
    });

    // Click Verify All button in the toolbar to open the modal
    await page.locator('.data-source-toolbar-btn-primary', { hasText: '▶ Verify All' }).click();

    // Wait for verify modal to appear
    await expect(page.getByText('Data Source — Verify & Inspect')).toBeVisible({ timeout: 10000 });

    // Click Verify All button INSIDE the modal footer to trigger verification
    await page.locator('.verify-modal-footer button', { hasText: '▶ Verify All' }).click();

    // Wait for verification to complete (Re-verify button appears when done)
    await expect(page.locator('.verify-modal-footer button', { hasText: '▶ Re-verify' })).toBeVisible({ timeout: 15000 });

    // Wait a moment for async requests to complete
    await page.waitForTimeout(2000);

    // Verify the proxy received at least one API request (not token request)
    const apiRequests = proxyRequests.filter(r => !r.url.includes('/token'));
    expect(apiRequests.length).toBeGreaterThan(0);

    // The key assertion: Authorization header must be present
    const req = apiRequests[0];
    expect(req.headers).toHaveProperty('Authorization');
    expect(req.headers['Authorization']).toContain('Bearer fake-oauth2-token-12345');

    // URL should have {{vin}} replaced with actual value, not %7B%7B
    expect(req.url).toContain('/vehicles/VIN123/');
    expect(req.url).not.toContain('%7B%7B');
    expect(req.url).not.toContain('{{');

    // Query params should be properly substituted
    expect(req.url).toContain('channel=WEB');
    expect(req.url).toContain('country=US');
  });

  test('Verify All resolves empty param values without {{placeholder}} leak', async ({ page }) => {
    // Seed with a test that has an empty param column value
    await page.addInitScript(() => {
      localStorage.setItem('perf-test-v3-environments', JSON.stringify([{ id: 'env-1', name: 'test' }]));
      localStorage.setItem('perf-test-v3-microservices', JSON.stringify([{
        id: 'svc-1', name: 'test-service',
        baseUrls: { 'env-1': 'https://api.example.com' },
      }]));
      localStorage.setItem('perf-test-global-auth-profiles', JSON.stringify([{
        id: 'profile-1',
        name: 'test-oauth2',
        auth: { type: 'oauth2', tokenUrl: 'https://auth.example.com/token', clientId: 'c', clientSecret: 's' },
      }]));
      localStorage.setItem('perf-test-v3-feature-groups', JSON.stringify([{
        id: 'fg-1',
        name: 'E2E Feature',
        microserviceId: 'svc-1',
        environmentId: 'env-1',
        auth: { type: 'inherit' },
        globalAuthProfileId: 'profile-1',
        scenarios: [{
          id: 'sc-1',
          name: 'E2E Scenario',
          auth: { type: 'inherit' },
          tests: [{
            id: 'test-p',
            name: 'Empty Param Test',
            url: 'https://api.example.com/vehicles/{{vin}}/offers?channel={{channel}}&code={{code}}',
            method: 'GET',
            headers: [],
            body: '',
            auth: { type: 'inherit' },
            validation: { mode: 'none' },
            dataSource: {
              id: 'ds-1',
              columns: [
                { id: 'col-vin', name: 'vin', type: 'path', mapping: 'vin' },
                { id: 'col-ch', name: 'channel', type: 'param', mapping: 'channel' },
                { id: 'col-code', name: 'code', type: 'param', mapping: 'code' },
              ],
              rows: [
                { id: 'row-1', values: { 'col-vin': 'VIN999', 'col-ch': 'WEB', 'col-code': '' }, enabled: true },
              ],
              source: { type: 'inline' },
              distribution: 'sequential',
            },
          }],
        }],
      }]));
      localStorage.setItem('perf-test-v3-selected-env', 'env-1');
      localStorage.setItem('perf-test-v3-selected-svc', 'svc-1');
      localStorage.setItem('perf-test-v3-migrated', 'true');
      localStorage.setItem('perf-test-theme', 'dark');
    });

    await openTestEditor(page);

    const dataTab = page.locator('.builder-tab', { hasText: 'Data Source' });
    await expect(dataTab).toBeVisible({ timeout: 5000 });
    await dataTab.click();

    const proxyRequests: { url: string; headers: Record<string, string> }[] = [];

    await page.route('**/__proxy', async (route) => {
      const postData = route.request().postDataJSON();

      if (postData?.url?.includes('/token')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 200, statusText: 'OK', headers: {},
            body: JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
          }),
        });
        return;
      }

      proxyRequests.push({ url: postData?.url ?? '', headers: postData?.headers ?? {} });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 200, statusText: 'OK', headers: {},
          body: JSON.stringify({ ok: true }),
        }),
      });
    });

    // Click the ⚡ fetch button on the row
    const fetchBtn = page.locator('.data-source-row-action-btn', { hasText: '⚡' });
    await expect(fetchBtn).toBeVisible({ timeout: 5000 });
    await fetchBtn.click();

    // Wait for fetch to complete
    await page.waitForTimeout(2000);

    const apiRequests = proxyRequests.filter(r => !r.url.includes('/token'));
    expect(apiRequests.length).toBeGreaterThan(0);

    const req = apiRequests[0];

    // Path variable must be substituted
    expect(req.url).toContain('/vehicles/VIN999/');

    // No {{placeholder}} leak in the URL
    expect(req.url).not.toContain('%7B%7B');
    expect(req.url).not.toContain('{{');

    // channel=WEB should be present
    expect(req.url).toContain('channel=WEB');

    // code= should be present (empty value, NOT {{code}})
    expect(req.url).toMatch(/code=(&|$)/);

    // Auth header must be present
    expect(req.headers).toHaveProperty('Authorization');
  });

  test('inline fetch (⚡ button) sends Authorization header', async ({ page }) => {
    await seedWithParameterizedTest(page);
    await openTestEditor(page);

    const dataTab = page.locator('.builder-tab', { hasText: 'Data Source' });
    await expect(dataTab).toBeVisible({ timeout: 5000 });
    await dataTab.click();

    const proxyRequests: { url: string; headers: Record<string, string> }[] = [];

    await page.route('**/__proxy', async (route) => {
      const postData = route.request().postDataJSON();

      if (postData?.url?.includes('/token')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 200, statusText: 'OK', headers: {},
            body: JSON.stringify({ access_token: 'inline-token-xyz', token_type: 'Bearer', expires_in: 3600 }),
          }),
        });
        return;
      }

      proxyRequests.push({ url: postData?.url ?? '', headers: postData?.headers ?? {} });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 200, statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'ok' }),
        }),
      });
    });

    // Click ⚡ fetch on the first row
    const fetchBtn = page.locator('.data-source-row-action-btn', { hasText: '⚡' });
    await expect(fetchBtn).toBeVisible({ timeout: 5000 });
    await fetchBtn.click();

    await page.waitForTimeout(2000);

    const apiRequests = proxyRequests.filter(r => !r.url.includes('/token'));
    expect(apiRequests.length).toBeGreaterThan(0);

    const req = apiRequests[0];
    expect(req.headers).toHaveProperty('Authorization');
    expect(req.headers['Authorization']).toContain('Bearer inline-token-xyz');

    // URL should be properly resolved
    expect(req.url).toContain('/vehicles/VIN123/');
    expect(req.url).toContain('channel=WEB');
    expect(req.url).toContain('country=US');
  });
});
