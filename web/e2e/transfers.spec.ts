import { test, expect } from '@playwright/test';
test('approved simulation is pending until settlement, updates forecast and chat, then resets', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 12000,
  });
  const approve = page.getByRole('button', {
    name: 'Approve $35.36 simulation',
    exact: true,
  });
  await expect(approve).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I approve $35.36 from savings to checking.',
    })
    .check();
  await approve.click();
  await expect(page.getByTestId('transfer-record')).toHaveCount(1);
  await expect(page.getByTestId('transfer-record')).toContainText('pending');
  await expect(page.getByTestId('transfer-record')).toContainText(
    'Checking has not received',
  );
  await page
    .getByRole('button', { name: 'Simulate success', exact: true })
    .click();
  await expect(page.getByTestId('transfer-record')).toContainText('completed');
  await expect(page.getByTestId('funding-proposal')).toContainText(
    'Your detected bills fit',
    { timeout: 12000 },
  );
  await page.getByRole('button', { name: 'What are my balances?' }).click();
  await expect(page.getByRole('log')).toContainText('$183.96');
  await page
    .getByText('Reset simulated money', { exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Reset simulated money', exact: true })
    .click();
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 12000,
  });
  await expect(page.getByRole('log')).not.toContainText('$183.96');
});
test('declining does not send and automatic funding can be revoked before a later check', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 12000,
  });
  await page.getByRole('button', { name: 'Decline proposal' }).click();
  await expect(page.getByTestId('approval-controls')).toContainText(
    'Proposal declined',
  );
  await expect(page.getByTestId('transfer-record')).toHaveCount(0);
  await page.getByText('Optional automatic funding', { exact: true }).click();
  await page.getByLabel('Total funding budget ($)').fill('20');
  await page
    .getByRole('checkbox', { name: /I authorize simulated funding/ })
    .check();
  await page
    .getByRole('button', { name: 'Enable automatic funding', exact: true })
    .click();
  await expect(page.getByText('Rule active', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Revoke automatic funding', exact: true })
    .click();
  await expect(page.getByText('Rule active', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: 'work/m5-mobile.png', fullPage: true });
});
