import { expect, test } from '@playwright/test';

test('the main experience leads with savings and retirement and chat explains the displayed allocation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A little saved. A future built.' }),
  ).toBeVisible();
  await expect(page.getByTestId('growth-title')).toHaveText(
    '$400.00 toward your goals',
  );
  await expect(page.getByTestId('growth-hysa')).toHaveText('$150.00');
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await expect(page.getByTestId('growth-keep')).toHaveText('$3,100.00');
  await page
    .getByRole('button', { name: 'Explain my savings and Roth plan' })
    .click();
  await expect(page.getByRole('log')).toContainText(
    '$150.00 toward high-yield savings and $250.00 toward a Roth IRA',
  );
  await expect(page.getByTestId('transfer-record')).toHaveCount(0);
  await page.getByLabel('Demo scenario').selectOption('shortfall');
  await expect(page.getByTestId('growth-title')).toHaveText(
    'Protect your cash first',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 12000,
  });
});

test('edited goals and Roth review requirements update the plan and clear old explanations', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$400.00');
  await page
    .getByRole('button', { name: 'Explain my savings and Roth plan' })
    .click();
  await expect(page.getByRole('log')).toContainText(
    '$250.00 toward a Roth IRA',
  );
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page.getByLabel('Roth goal for this plan ($)').fill('100');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$250.00');
  await expect(page.getByRole('log')).not.toContainText(
    '$250.00 toward a Roth IRA',
  );
  await page.getByLabel('2026 filing status').selectOption('unknown');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
  await expect(page.getByTestId('growth-hysa')).toHaveText('$150.00');
  await page
    .getByLabel(
      'The demo budget includes spending and commitments for the full 30 days.',
    )
    .uncheck();
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toHaveText(
    'Review a few details first',
  );
  await expect(page.getByTestId('growth-hysa')).toHaveText('$0.00');
});

test('failed calculations hide old suggestions and recover through retry', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$400.00');
  await page.route('**/api/growth', (route) =>
    route.fulfill({ status: 500, json: { error: 'Planner unavailable.' } }),
  );
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page.getByLabel('Roth goal for this plan ($)').fill('100');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toHaveCount(0);
  await expect(
    page.getByText('Planner unavailable. Previous suggestions are hidden.'),
  ).toBeVisible();
  await page.unroute('**/api/growth');
  await page.getByRole('button', { name: 'Retry plan' }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$250.00');
});

test('late calculations cannot overwrite a newer plan and stale balances suppress suggestions', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$400.00');
  let release: (() => void) | undefined;
  let seen: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const captured = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route('**/api/growth', async (route) => {
    if (route.request().postDataJSON().inputs.rothGoalCents !== 10000)
      return route.continue();
    const response = await route.fetch();
    seen!();
    await delayed;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page.getByLabel('Roth goal for this plan ($)').fill('100');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await captured;
  await page.getByLabel('Roth goal for this plan ($)').fill('50');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-roth')).toHaveText('$50.00');
  release!();
  await expect(page.getByTestId('growth-roth')).toHaveText('$50.00');
  await page.getByLabel('Demo scenario').selectOption('stale');
  await expect(page.getByTestId('growth-title')).toHaveText(
    'Review a few details first',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
});

test('the planner and its inputs remain readable on mobile and desktop', async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
    await expect(page.getByTestId('growth-title')).toContainText('$400.00');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `work/growth-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByText('Edit plan assumptions', { exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `work/growth-settings-${viewport.width}.png`,
      fullPage: true,
    });
  }
});
