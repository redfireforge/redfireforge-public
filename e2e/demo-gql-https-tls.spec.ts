/**
 * Demo — GQL-5 HTTPS, TLS & Certificates: smoke validation
 *
 * ONLY this lesson — run via:
 *   npm run test:e2e:demo:gql5
 *
 * Full lesson needs TLS + mTLS + plain GraphQL Docker stacks (certs are pre-bundled):
 *   cd docker/graphql/tls && docker compose up -d && docker compose -f docker-compose.mtls.yml up -d
 *   cd docker/graphql && docker compose up -d
 *
 * Last-step rule: step 18 disables Next — use walkFullGql5Lesson (GQL-1 style), not runNextStep on the final step.
 */

import { test, expect } from '@playwright/test';
import { exitLesson, getStepInfo, launchGqlLesson, takeNamedScreenshot } from './demo-player-helpers';
import { GQL_HEALTH, isGraphqlServerHealthy, silenceLogStream } from './graphql-helpers';
import {
  GQL5_LESSON,
  GQL_TLS_HEALTH,
  GQL_TLS_MTLS_HEALTH,
  prepareGql5DockerLesson,
  walkFullGql5Lesson,
  isGqlTlsServerHealthy,
  isGqlMtlsServerHealthy,
} from './graphql-lesson-smoke-helpers';

const LESSON_NAME = GQL5_LESSON.name;
const TOTAL_STEPS = GQL5_LESSON.steps;

/** Unlock the TLS Docker prerequisite gate when ports 4444/4446 are not running locally. */
async function mockTlsHealthProbe(page: Parameters<typeof silenceLogStream>[0]): Promise<void> {
  for (const url of [GQL_TLS_HEALTH, GQL_TLS_MTLS_HEALTH]) {
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      }),
    );
  }
}

/** Unlock plain GraphQL prerequisite gate for lesson shell test. */
async function mockGraphqlHealthProbe(page: Parameters<typeof silenceLogStream>[0]): Promise<void> {
  await page.route(GQL_HEALTH, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    }),
  );
}

test.describe.configure({ retries: 0 });

test.beforeEach(async ({ page }) => {
  await silenceLogStream(page);
  await mockTlsHealthProbe(page);
  await mockGraphqlHealthProbe(page);
});

test.describe('GQL-5 — lesson shell', () => {
  // Docker + Vite cold-start compete for CPU on the nightly runner — the shell
  // test runs first and can hit APP_SHELL_TIMEOUT (300 s) before the activity
  // bar mounts. One retry is enough: Vite is warm by the second attempt.
  test.describe.configure({ retries: 1 });

  test(`lesson has ${TOTAL_STEPS} steps`, async ({ page }) => {
    await launchGqlLesson(page, LESSON_NAME);
    const counter = await page.locator('.demo-live-step-counter').textContent();
    expect(counter).toMatch(new RegExp(`1\\s*[/]\\s*${TOTAL_STEPS}`));
  });
});

test.describe('GQL-5 — full lesson (Docker)', () => {
  test('auto-play completes without errors', async ({ page, request }) => {
    const tlsHealthy = await isGqlTlsServerHealthy(request);
    const mtlsHealthy = await isGqlMtlsServerHealthy(request);
    const plainHealthy = await isGraphqlServerHealthy(request);
    test.skip(
      !tlsHealthy || !mtlsHealthy || !plainHealthy,
      'TLS (4444), mTLS (4446), and plain GraphQL (4010) must be running — see docker/graphql/tls + docker/graphql',
    );

    test.setTimeout(900_000);
    await prepareGql5DockerLesson(page, request);
    await walkFullGql5Lesson(page);

    const { counter, title } = await getStepInfo(page);
    expect(counter).toMatch(new RegExp(`${TOTAL_STEPS}\\s*[/]\\s*${TOTAL_STEPS}`));
    expect(title).toMatch(/Plain HTTP Schema Reloaded/i);

    await expect(page.getByTestId('gql-schema-badge-ok')).toBeVisible({ timeout: 15_000 });

    const endpoint = page.locator('[data-testid="gql-endpoint-input"]');
    await expect(endpoint).toHaveValue('http://localhost:4010/graphql');

    // Bearer auth from the TLS phase persists on the demo tab after restore to plain HTTP.
    await page.locator('[data-testid="gql-bottom-tab-auth"]').click({ force: true });
    await expect(page.locator('[data-testid="gql-auth-preview"]')).toContainText('lesson6-demo-jwt');

    await takeNamedScreenshot(page, 'gql5-https-tls-lesson-complete');
    await exitLesson(page);
  });
});
