import { expect, test } from '@playwright/test';

test('four repeatable scenarios explain shortfall, sufficient funds, timing uncertainty, and stale data', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('forecast-title')).toHaveText(
    '$35.36 projected shortfall',
  );
  await expect(page.getByTestId('bill-row')).toHaveCount(5);
  await expect(
    page.getByText('First projected below zero: Sep 18.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Demo scenario').selectOption('sufficient');
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'Detected bills fit this balance',
  );
  await expect(page.getByTestId('forecast-ending')).toHaveText('$316.04');
  await page.getByLabel('Demo scenario').selectOption('uncertain');
  await expect(page.getByText(/shortfall could begin Sep 16/)).toBeVisible();
  await expect(page.getByText('Date window: Sep 16–Sep 19')).toBeVisible();
  await page.getByLabel('Demo scenario').selectOption('stale');
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'Account data needs a refresh',
  );
  await expect(
    page.getByText(/72 hours old against the fixed demo clock/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a bill correction updates the forecast and the mock assistant consistently, and reset restores it', async ({
  page,
}) => {
  await page.goto('/');
  const bill = page.getByTestId('bill-row').filter({
    has: page.getByRole('heading', {
      name: 'Adobe Creative Cloud',
      exact: true,
    }),
  });
  await bill.getByText('3 observed monthly payments').click();
  await expect(bill.getByText('Aug 18 · $59.99 · Posted')).toBeVisible();
  await bill.getByText('Correct estimate', { exact: true }).click();
  await bill.getByLabel('Next date').fill('2026-09-25');
  await bill.getByRole('button', { name: 'Apply correction' }).click();
  await expect(page.getByTestId('forecast-ending')).toHaveText('$24.63');
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'Detected bills fit this balance',
  );
  await page.getByRole('button', { name: 'Will my bills be covered?' }).click();
  await expect(page.getByRole('log')).toContainText('14 days at $24.63');
  await page.getByRole('button', { name: 'Reset corrections' }).click();
  await expect(page.getByTestId('forecast-ending')).toHaveText('-$35.36');
  await expect(page.getByRole('log')).not.toContainText('$24.63');
});

test('a failed correction keeps the displayed scenario and balances intact', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('**/api/forecast', async (route) => {
    await route.fulfill({ status: 500, body: '{}' });
  });
  await page.getByLabel('Demo scenario').selectOption('sufficient');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'The forecast could not be updated' }),
  ).toContainText('Your previous forecast is still shown');
  await expect(page.getByLabel('Demo scenario')).toHaveValue('shortfall');
  await expect(page.getByTestId('forecast-ending')).toHaveText('-$35.36');
});

test('mobile and desktop layouts keep the forecast readable without horizontal overflow', async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('forecast-title')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: `work/m2-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByText('Daily estimated balances', { exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(15);
  }
});
