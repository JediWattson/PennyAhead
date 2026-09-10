import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { MonitorState } from '../lib/contracts';

test('background checks create one proposal without chat, persist acknowledgement, and agree with the mock', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?scenario=shortfall');
  await expect(page.getByTestId('proposal-title')).toHaveText(
    'Set aside $35.36 for upcoming bills',
    { timeout: 12000 },
  );
  await expect(page.getByTestId('funding-proposal')).toContainText('$1,814.64');
  await expect(page.getByRole('log')).not.toContainText(
    'A demo proposal would move',
  );
  await page
    .getByRole('button', { name: 'Mark alert as read', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Alert marked as read' }),
  ).toBeDisabled();
  await expect
    .poll(
      async () =>
        Number(await page.getByTestId('monitor-check-count').innerText()),
      { timeout: 12000 },
    )
    .toBeGreaterThanOrEqual(2);
  await expect(
    page.getByText('Alert history (1)', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'How can I cover the shortfall?' })
    .click();
  await expect(page.getByRole('log')).toContainText('$1,814.64');
  expect(errors).toEqual([]);
});

test('savings restriction, delayed timing, pause and sufficient funds replace outdated proposals', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/?scenario=shortfall');
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 12000,
  });
  await page.getByText('Monitoring preferences', { exact: true }).click();
  await page.getByLabel('Savings minimum ($)').fill('1850');
  await page
    .getByRole('button', { name: 'Save monitoring preferences' })
    .click();
  await expect(page.getByTestId('funding-proposal')).toContainText(
    'No eligible savings account',
    { timeout: 12000 },
  );
  await expect(page.getByTestId('funding-proposal')).not.toContainText('From');
  await page.getByLabel('Savings minimum ($)').fill('1000');
  await page.getByLabel('Demo transfer timing').selectOption('delayed');
  await page
    .getByRole('button', { name: 'Save monitoring preferences' })
    .click();
  await expect(page.getByTestId('funding-proposal')).toContainText(
    'estimated arrival is too late',
    { timeout: 12000 },
  );
  await expect(page.getByTestId('funding-proposal')).toContainText('Sep 22');
  await page.getByRole('button', { name: 'Pause monitoring' }).click();
  await expect(page.getByTestId('monitor-status')).toHaveText(
    'Monitoring paused',
  );
  await expect(page.getByTestId('funding-proposal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume monitoring' }).click();
  await page.getByLabel('Demo scenario').selectOption('sufficient');
  await expect(page.getByTestId('proposal-title')).toHaveText(
    'Your detected bills fit',
    { timeout: 12000 },
  );
  await page.getByLabel('Demo scenario').selectOption('stale');
  await expect(page.getByTestId('funding-proposal')).toContainText(
    'Refresh or reconcile account data',
    { timeout: 12000 },
  );
});

test('server keeps monitoring with no browser or API requests', async ({
  request,
}) => {
  const response = await request.post('/api/monitor', {
    data: {
      scenario: 'shortfall',
      corrections: [],
      savingsMinimumCents: 100000,
      timing: 'standard',
      enabled: true,
    },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as MonitorState;
  expect(session.plan).toBeNull();
  // Observe persisted state without HTTP requests. Timer scheduling can skip a
  // due boundary, so wait for two actual checks instead of assuming exactly 11s.
  const database = new DatabaseSync(resolve('work/e2e-monitor.sqlite'), {
    readOnly: true,
  });
  try {
    await expect
      .poll(
        () => {
          const row = database
            .prepare(
              "SELECT json_extract(state, '$.checkCount') AS count FROM monitors WHERE id = ?",
            )
            .get(session.id);
          return Number(row?.count ?? 0);
        },
        { timeout: 25000, intervals: [250, 500, 1000] },
      )
      .toBeGreaterThanOrEqual(2);
  } finally {
    database.close();
  }
  const read = await request.get('/api/monitor', {
    headers: { Authorization: `Bearer ${session.id}` },
  });
  const state = (await read.json()) as MonitorState;
  expect(state.checkCount).toBeGreaterThanOrEqual(2);
  expect(state.alerts).toHaveLength(1);
  expect(state.plan?.amountCents).toBe(3536);
});

test('failed preference writes hide previous proposals and recover on retry', async ({
  page,
}) => {
  await page.goto('/?scenario=shortfall');
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 12000,
  });
  await page.route('**/api/monitor', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({ status: 500, body: '{}' });
    else await route.continue();
  });
  await page.getByText('Monitoring preferences', { exact: true }).click();
  await page.getByLabel('Savings minimum ($)').fill('1850');
  await page
    .getByRole('button', { name: 'Save monitoring preferences' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Monitoring settings' }),
  ).toContainText('Monitoring settings could not be saved');
  await expect(page.getByTestId('funding-proposal')).toHaveCount(0);
  await page.unroute('**/api/monitor');
  await expect(page.getByTestId('funding-proposal')).toContainText(
    'No eligible savings account',
    { timeout: 12000 },
  );
  await page.route('**/api/monitor', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({ status: 500, body: '{}' });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Pause monitoring' }).click();
  await expect(page.getByTestId('monitor-status')).toHaveText(
    'Monitor needs attention',
  );
  await page.unroute('**/api/monitor');
  await expect(page.getByTestId('monitor-status')).toHaveText(
    'Monitoring paused',
    { timeout: 12000 },
  );
});

test('proposal and settings remain readable at desktop and mobile widths', async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await page.goto('/?scenario=shortfall');
    await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
      timeout: 12000,
    });
    await page.getByText('Monitoring preferences', { exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({ path: `work/m3-${width}.png`, fullPage: true });
  }
});
