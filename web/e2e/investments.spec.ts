import { expect, test } from '@playwright/test';

test('practice Roth settles test cash, reviews purchases, retries failures and never calls a provider', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  const practice = page.getByTestId('roth-simulation');
  await expect(
    practice.getByRole('button', { name: 'Create practice Roth' }),
  ).toBeVisible();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') requests.push(request.url());
  });
  await practice.getByRole('button', { name: 'Create practice Roth' }).click();
  await practice
    .getByRole('button', { name: 'Review test contribution', exact: true })
    .click();
  await expect(practice).toContainText('$250.00 · simulated 2026 contribution');
  await practice
    .getByRole('button', { name: 'Confirm test contribution' })
    .click();
  await expect(practice.getByTestId('practice-cash')).toHaveText('$0.00');
  await expect(
    practice.getByRole('button', { name: 'Review simulated purchases' }),
  ).toHaveCount(0);
  await practice
    .getByRole('button', { name: 'Simulate contribution failure' })
    .click();
  await expect(practice.getByTestId('practice-contributed')).toHaveText(
    '$0.00',
  );
  await practice
    .getByRole('button', { name: 'Review test contribution', exact: true })
    .click();
  await practice
    .getByRole('button', { name: 'Confirm test contribution' })
    .click();
  await practice
    .getByRole('button', { name: 'Simulate contribution arrival' })
    .click();
  await expect(practice.getByTestId('practice-cash')).toHaveText('$250.00');
  await practice
    .getByRole('button', { name: 'Review simulated purchases' })
    .click();
  await expect(practice).toContainText('VTI$90.00');
  await expect(practice).toContainText('VXUS$60.00');
  await expect(practice).toContainText('BND$100.00');
  await practice
    .getByRole('button', { name: 'Confirm simulated purchases' })
    .click();
  await expect(practice.getByTestId('practice-reserved')).toHaveText('$250.00');
  await expect(practice.getByTestId('practice-cash')).toHaveText('$0.00');
  await practice
    .getByRole('button', { name: 'Simulate purchase rejection' })
    .click();
  await expect(practice.getByTestId('practice-cash')).toHaveText('$250.00');
  await practice
    .getByRole('button', { name: 'Review simulated purchases' })
    .click();
  await practice
    .getByRole('button', { name: 'Confirm simulated purchases' })
    .click();
  await practice
    .getByRole('button', { name: 'Simulate purchase fills' })
    .click();
  await expect(practice.getByTestId('practice-invested')).toHaveText('$250.00');
  await expect(practice.getByTestId('practice-contributed')).toHaveText(
    '$250.00',
  );
  await expect(practice.getByTestId('practice-reserved')).toHaveText('$0.00');
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await expect(page.getByTestId('growth-keep')).toHaveText('$3,100.00');
  await expect(page.getByTestId('transfer-record')).toHaveCount(0);
  expect(requests).toEqual([]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await practice.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await practice.screenshot({ path: `work/roth-practice-${width}.png` });
  }
  await practice.getByRole('button', { name: 'Reset practice' }).click();
  await expect(
    practice.getByRole('button', { name: 'Create practice Roth' }),
  ).toBeVisible();
  await expect(practice.getByTestId('practice-invested')).toHaveCount(0);
});

test('practice progress clears when plan assumptions change or the page reloads', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  const practice = page.getByTestId('roth-simulation');
  await practice.getByRole('button', { name: 'Create practice Roth' }).click();
  await practice
    .getByRole('button', { name: 'Review test contribution', exact: true })
    .click();
  await practice
    .getByRole('button', { name: 'Confirm test contribution' })
    .click();
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page
    .getByLabel('Comfort with investment losses')
    .selectOption('growth');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(
    practice.getByRole('button', { name: 'Create practice Roth' }),
  ).toBeVisible();
  await expect(practice.getByTestId('practice-contributed')).toHaveCount(0);
  await practice.getByRole('button', { name: 'Create practice Roth' }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(
    practice.getByRole('button', { name: 'Create practice Roth' }),
  ).toBeVisible();
  await page.getByLabel('Demo scenario').selectOption('shortfall');
  await expect(
    practice.getByRole('button', { name: 'Create practice Roth' }),
  ).toHaveCount(0);
  await expect(practice).toContainText('choose a positive Roth contribution');
});

test('investment preview explains the same dollars as chat and keeps existing Roth assets separate', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('investment-title')).toHaveText(
    '60% stocks · 40% bonds',
  );
  await expect(page.getByTestId('investment-vti')).toHaveText('$90.00');
  await expect(page.getByTestId('investment-vxus')).toHaveText('$60.00');
  await expect(page.getByTestId('investment-bnd')).toHaveText('$100.00');
  await page
    .getByText('Roth holdings · Sample account', { exact: true })
    .click();
  await expect(page.getByTestId('investment-plan')).toContainText('$12,000.00');
  await expect(page.getByTestId('growth-keep')).toHaveText('$3,100.00');
  await page
    .getByRole('button', { name: 'Explain this investment mix' })
    .click();
  await expect(page.getByRole('log')).toContainText('$90.00');
  await expect(page.getByRole('log')).toContainText(
    'not an order; no money was moved',
  );
  await expect(page.getByRole('log')).toContainText('Roth investment preview');
  await expect(page.getByTestId('transfer-record')).toHaveCount(0);
});

test('changed preferences and cash checks invalidate investment previews and old chat', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('investment-vti')).toHaveText('$90.00');
  await page
    .getByRole('button', { name: 'Explain this investment mix' })
    .click();
  await expect(page.getByRole('log')).toContainText('$90.00');
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page
    .getByLabel('Comfort with investment losses')
    .selectOption('growth');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('investment-title')).toHaveText(
    '80% stocks · 20% bonds',
  );
  await expect(page.getByRole('log')).not.toContainText('$90.00');
  await page.getByLabel('Years before you need this money').fill('3');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('investment-title')).toHaveText(
    'Review your shorter time horizon',
  );
  await expect(page.getByTestId('investment-vti')).toHaveCount(0);
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await page.getByLabel('Demo scenario').selectOption('shortfall');
  await expect(page.getByTestId('investment-title')).toHaveText(
    'Plan a contribution first',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
});

test('investment rows and brokerage guidance fit desktop and mobile', async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
    await expect(page.getByTestId('investment-title')).toBeVisible();
    await page.getByTestId('investment-plan').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `work/investments-${width}.png` });
    await page
      .getByText('How to use this at your brokerage', { exact: true })
      .click();
    await expect(page.getByTestId('investment-plan')).toContainText(
      'Buying directly through PennyAhead is not connected',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
});

test('broker connection shows the provider state, hides old results after failure, and retries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('investment-title')).toBeVisible();
  let failed = false;
  await page.route('**/api/broker', (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    return failed
      ? route.fulfill({ status: 503, json: { error: 'Broker unavailable.' } })
      : route.fulfill({
          json: {
            source: 'alpaca_sandbox',
            status: 'needs_roth',
            message:
              'Alpaca Sandbox is connected, but no Roth IRA is available.',
            observedAt: '2026-09-11T03:00:00.000Z',
            account: null,
            execution: 'not_connected',
          },
        });
  });
  const panel = page.getByTestId('broker-connection');
  await panel.getByRole('button', { name: 'Check Alpaca connection' }).click();
  await expect(panel.getByRole('status')).toContainText(
    'connected, but no Roth IRA',
  );
  failed = true;
  await panel.getByRole('button', { name: 'Check Alpaca connection' }).click();
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.getByRole('alert')).toContainText(
    'Previous brokerage observations are hidden',
  );
  failed = false;
  await panel.getByRole('button', { name: 'Check Alpaca connection' }).click();
  await expect(panel.getByRole('status')).toContainText(
    'connected, but no Roth IRA',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await expect(page.getByTestId('investment-vti')).toHaveText('$90.00');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: 'work/broker-connection-390.png' });
});
