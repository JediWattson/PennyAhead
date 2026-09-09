import { expect, test } from '@playwright/test';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';

async function sandboxFixture() {
  const snapshot = await new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
  snapshot.source = 'plaid_sandbox';
  snapshot.accounts[0].name = 'Plaid Checking';
  snapshot.accounts[1].name = 'Plaid Saving';
  snapshot.transactions[0].availableBalanceEffect = 'unknown';
  snapshot.coverage = {
    totalAccounts: 14,
    excludedAccounts: 12,
    historyComplete: true,
    transactionsUpdatedAt: DEMO_NOW,
    warnings: [],
  };
  return {
    clock: 'provider-observation',
    snapshotId: 'recorded-sandbox-observation',
    scenario: 'shortfall',
    corrections: [],
    snapshot,
    forecast: buildForecast(snapshot, snapshot.accounts[0].id, DEMO_NOW),
  };
}

test('Sandbox view labels provider data, flags pending uncertainty, and scopes chat to the displayed observation', async ({
  page,
}) => {
  const view = await sandboxFixture();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let monitorCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/monitor')) monitorCalls++;
  });
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/assistant', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      message: 'What are my balances?',
      snapshotId: view.snapshotId,
      corrections: [],
    });
    return route.fulfill({
      json: {
        mode: 'mock',
        source: 'plaid_sandbox',
        text: 'Plaid Checking: $148.60 available. These are Plaid Sandbox test balances.',
        reads: ['get_accounts'],
        asOf: DEMO_NOW,
      },
    });
  });
  await page.goto('/sandbox');
  await expect(
    page.getByRole('heading', { name: 'Plaid Checking', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Showing 2 USD checking and savings accounts from 14/),
  ).toBeVisible();
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'Some activity needs verification',
  );
  await expect(
    page.getByText(
      /balance treatment for pending Neighborhood Market is unknown/,
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Demo scenario')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Approve|Simulate|Enable automatic/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'What are my balances?' }).click();
  await expect(page.getByRole('log')).toContainText(
    'Read Plaid Sandbox account balances',
  );
  await expect(page.getByRole('log')).toContainText('$148.60 available');
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  }
  expect(monitorCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('failed Sandbox refresh preserves the observation and a successful refresh clears old chat', async ({
  page,
}) => {
  const view = await sandboxFixture();
  let fail = false;
  await page.route('**/api/sandbox', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: 'The test bank is unavailable.' },
        })
      : route.fulfill({ json: view }),
  );
  await page.goto('/sandbox');
  await expect(
    page.getByRole('heading', { name: 'Plaid Checking', exact: true }),
  ).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'previous observation is still shown; it has not been refreshed',
  );
  await expect(page.locator('.account-balance').first()).toHaveText('$148.60');
  fail = false;
  view.snapshotId = 'refreshed-observation';
  view.snapshot.accounts[0].availableCents = 20000;
  view.forecast = buildForecast(view.snapshot, 'demo-checking', DEMO_NOW);
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await expect(page.locator('.account-balance').first()).toHaveText('$200.00');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('log')).toBeEmpty();
});

test('initial Sandbox failure exposes retry without substituting fixture balances', async ({
  page,
}) => {
  const view = await sandboxFixture();
  let fail = true;
  await page.route('**/api/sandbox', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: 'Plaid is still preparing transaction history.' },
        })
      : route.fulfill({ json: view }),
  );
  await page.goto('/sandbox');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'still preparing',
  );
  await expect(page.locator('.account-card')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry Sandbox connection' }).click();
  await expect(
    page.getByRole('heading', { name: 'Plaid Checking', exact: true }),
  ).toBeVisible();
});
