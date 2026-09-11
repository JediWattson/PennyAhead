import { expect, test } from '@playwright/test';

test('desktop chat fills the viewport as the page scrolls and restores its height at the top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$400.00');
  await page
    .getByRole('button', { name: 'Explain my savings and Roth plan' })
    .click();
  await expect(page.getByRole('log')).toContainText(
    '$250.00 toward a Roth IRA',
  );
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const panel = page.locator('.assistant-panel');
  const initial = (await panel.boundingBox())!.height;
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect
    .poll(async () => (await panel.boundingBox())!.height)
    .toBeGreaterThan(initial + 100);
  await expect.poll(async () => (await panel.boundingBox())!.y).toBe(20);
  await expect(
    page.getByLabel('Ask about your demo accounts'),
  ).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(async () => Math.abs((await panel.boundingBox())!.height - initial))
    .toBeLessThan(2);
  await expect
    .poll(async () =>
      page
        .getByRole('log')
        .evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
    )
    .toBeLessThan(24);
});

test('account cards filter activity and preserve selection across detail tabs', async ({
  page,
}) => {
  await page.goto('/');
  const activity = page.getByRole('region', { name: 'Recent activity' });
  const checking = page.getByRole('button', {
    name: /Show activity for Everyday checking/,
  });
  const savings = page.getByRole('button', {
    name: /Show activity for Rainy day savings/,
  });
  await expect(checking).toHaveAttribute('aria-pressed', 'true');
  await expect(activity).toContainText('Neighborhood Market');
  await savings.focus();
  await page.keyboard.press('Enter');
  await expect(savings).toHaveAttribute('aria-pressed', 'true');
  await expect(checking).toHaveAttribute('aria-pressed', 'false');
  await expect(activity).toContainText('Rainy day savings · •• 8091');
  await expect(activity).toContainText(
    'No transactions for this account in the loaded history.',
  );
  await expect(activity).not.toContainText('Neighborhood Market');
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(savings).toHaveAttribute('aria-pressed', 'true');
  await checking.click();
  await expect(activity).toContainText('Neighborhood Market');
});

test('dashboard tabs preserve the current session, unsaved inputs and conversation', async ({
  page,
}) => {
  let creations = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/api/monitor' &&
      request.method() === 'POST'
    )
      creations++;
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Recent activity' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Save & invest' }).click();
  await expect(page.getByTestId('growth-title')).toContainText('$400.00');
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page.getByLabel('Roth goal for this plan ($)').fill('100');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Everyday checking' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Save & invest' }).click();
  await expect(page.getByLabel('Roth goal for this plan ($)')).toHaveValue(
    '100',
  );
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-roth')).toHaveText('$100.00');
  await page
    .getByRole('button', { name: 'Explain my savings and Roth plan' })
    .click();
  await expect(page.getByRole('log')).toContainText(
    '$100.00 toward a Roth IRA',
  );
  await page.getByLabel('Ask about your demo accounts').fill('Keep this draft');
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await expect(page.getByTestId('forecast-title')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('log')).toContainText(
    '$100.00 toward a Roth IRA',
  );
  await expect(page.getByLabel('Ask about your demo accounts')).toHaveValue(
    'Keep this draft',
  );
  expect(creations).toBe(1);
});

test('tabs support keyboard navigation and chat stays usable on desktop and mobile', async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByLabel('Ask about your demo accounts')).toBeEnabled();
    await expect(page.getByRole('tab')).toHaveText([
      'Overview',
      'Save & invest',
      'Bills',
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `work/dashboard-tabs-${viewport.width}.png`,
      fullPage: true,
    });
    if (viewport.width < 780)
      await page
        .getByRole('link', { name: 'Ask assistant', exact: true })
        .click();
    await expect(
      page.getByLabel('Ask about your demo accounts'),
    ).toBeInViewport();
    const composer = await page
      .getByLabel('Ask about your demo accounts')
      .boundingBox();
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({
      path: `work/dashboard-chat-${viewport.width}.png`,
    });
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('tab', { name: 'Save & invest' }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('growth-title')).toBeVisible();
  }
});
