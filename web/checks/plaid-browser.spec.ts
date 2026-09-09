import { expect, test } from '@playwright/test';
import { formatMoney } from '../lib/money.ts';
import type { DemoForecast } from '../lib/contracts.ts';

test('actual Plaid Sandbox observations power balances, corrections, forecast and chat on desktop and mobile', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sandbox') &&
      response.request().method() === 'GET',
  );
  await page.goto('/sandbox');
  const response = await loaded;
  expect(response.status()).toBe(200);
  const demo: DemoForecast = await response.json();
  expect(demo.snapshot.source).toBe('plaid_sandbox');
  expect(demo.snapshot.coverage?.historyComplete).toBe(true);
  expect(demo.snapshot.transactions.length).toBeGreaterThan(0);
  expect(JSON.stringify(demo)).not.toMatch(
    /access-sandbox-|public-sandbox-|client_id|access_token/,
  );
  for (const account of demo.snapshot.accounts) {
    const card = page.locator('.account-card').filter({
      has: page.getByRole('heading', { name: account.name, exact: true }),
    });
    await expect(card.locator('.account-balance')).toHaveText(
      formatMoney(account.availableCents),
    );
  }
  await page.getByRole('button', { name: 'What are my balances?' }).click();
  await expect(page.getByRole('log')).toContainText(
    `${formatMoney(demo.snapshot.accounts[0].availableCents)} available`,
  );
  await expect(page.getByRole('log')).toContainText(
    'Read Plaid Sandbox account balances',
  );
  await expect(
    page.getByRole('button', { name: /Approve|Simulate/ }),
  ).toHaveCount(0);
  expect(demo.forecast.bills.length).toBeGreaterThan(0);
  const bill = page.getByTestId('bill-row').first();
  await bill.getByText('Correct estimate', { exact: true }).click();
  const tomorrow = new Date(demo.forecast.evaluatedAt);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await bill.getByLabel('Next date').fill(tomorrow.toISOString().slice(0, 10));
  await bill.getByLabel('Amount ($)').fill('125.00');
  const correctionResponse = page.waitForResponse(
    (result) =>
      result.url().endsWith('/api/sandbox') &&
      result.request().method() === 'POST',
  );
  await bill.getByRole('button', { name: 'Apply correction' }).click();
  const correction = await correctionResponse;
  expect(correction.status()).toBe(200);
  const changed: DemoForecast = await correction.json();
  await expect(page.getByTestId('forecast-ending')).toHaveText(
    formatMoney(changed.forecast.endingCents),
  );
  await page.getByRole('button', { name: 'Will my bills be covered?' }).click();
  await expect(page.getByRole('log')).toContainText('Plaid Sandbox test data');
  await expect(page.getByRole('log')).toContainText(
    changed.forecast.shortageCents > 0
      ? formatMoney(changed.forecast.shortageCents)
      : formatMoney(changed.forecast.endingCents),
  );
  await page.getByRole('button', { name: 'Reset corrections' }).click();
  await expect(page.getByTestId('forecast-ending')).toHaveText(
    formatMoney(demo.forecast.endingCents),
  );
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
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `work/plaid-sandbox-${viewport.width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
