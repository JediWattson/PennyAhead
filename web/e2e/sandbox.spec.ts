import { expect, test } from '@playwright/test';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { buildBillSuggestion } from '../lib/server/bill-suggestion.ts';
import { MockAssistant } from '../lib/server/mock-assistant.ts';
import {
  buildGrowthPlan,
  explainGrowthPlan,
} from '../lib/server/growth-plan.ts';
import { initialGrowthInputs } from '../lib/growth-contracts.ts';
import { weeklyIncomeTransactions } from '../scripts/weekly-income-fixture.ts';
import type { DemoForecast } from '../lib/contracts.ts';

async function sandboxFixture(): Promise<DemoForecast> {
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

test('assistant Markdown renders formatting safely and contains wide content on desktop and mobile', async ({
  page,
}) => {
  const view = await sandboxFixture();
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  const markdown = [
    '## Your plan',
    'Set aside **$250.00** for Roth and *review your reserve*.',
    '- Keep spending cash available.\n- Recheck after payday.',
    '| Account | Current | Available | Suggested | Remaining | Timing |\n| --- | --- | --- | --- | --- | --- |\n| Checking | $1,510.00 | $1,500.00 | $250.00 | $1,250.00 | After review |',
    '```ts\nconst plan = { contribution: "$250.00", description: "A long example that should scroll inside the code block rather than stretch the whole page" };\n```',
    '[Read more](https://example.com/plan)',
    '[Unsafe link](javascript:alert(1))',
    '<script>window.markdownExecuted = true</script>',
    '<img src="https://example.com/markdown-tracker" onerror="window.markdownExecuted = true">',
    '![Hidden remote image](https://example.com/markdown-tracker)',
  ].join('\n\n');
  let imageRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('markdown-tracker')) imageRequests++;
  });
  await page.route('**/api/sandbox/assistant', (route) =>
    route.fulfill({
      json: {
        mode: 'mock',
        source: 'plaid_sandbox',
        asOf: view.snapshot.asOf,
        reads: ['get_growth_plan'],
        text: markdown,
      },
    }),
  );
  await page.goto('/sandbox');
  await page
    .getByLabel('Ask about your demo accounts')
    .fill('**Keep user text literal**');
  await page.getByRole('button', { name: 'Send message' }).click();
  const response = page.locator('.message-response').last();
  await expect(
    response.getByRole('heading', { name: 'Your plan' }),
  ).toBeVisible();
  const bold = response.locator('[data-streamdown="strong"]');
  await expect(bold).toHaveText('$250.00');
  expect(
    await bold.evaluate((node) => Number(getComputedStyle(node).fontWeight)),
  ).toBeGreaterThanOrEqual(600);
  await expect(response.locator('em')).toHaveText('review your reserve');
  await expect(response.locator('li')).toHaveCount(2);
  await expect(response.getByRole('table')).toHaveCount(1);
  await expect(response.locator('pre')).toContainText('const plan');
  await expect(
    response.getByRole('link', { name: 'Read more' }),
  ).toHaveAttribute('href', 'https://example.com/plan');
  await expect(response.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(response.locator('script, img')).toHaveCount(0);
  expect(await page.evaluate(() => 'markdownExecuted' in window)).toBe(false);
  expect(imageRequests).toBe(0);
  await expect(page.locator('.chat-message.user')).toContainText(
    '**Keep user text literal**',
  );
  await expect(page.locator('.chat-message.user strong')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await response.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator('.assistant-panel')
      .screenshot({ path: `work/chat-markdown-${width}.png` });
  }
});

for (const width of [1440, 390]) {
  test(`chat scrolls on send and preserves its position when long answers arrive at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const view = await sandboxFixture();
    await page.route('**/api/sandbox', (route) =>
      route.fulfill({ json: view }),
    );
    await page.route('**/api/sandbox/growth', (route) =>
      route.fulfill({
        json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
      }),
    );
    let release!: () => void;
    const hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    let pending = hold();
    await page.route('**/api/sandbox/assistant', async (route) => {
      await pending;
      await route.fulfill({
        json: {
          mode: 'mock',
          source: 'plaid_sandbox',
          asOf: view.snapshot.asOf,
          reads: ['get_accounts'],
          text: Array.from(
            { length: 35 },
            (_, i) =>
              `Detail ${i + 1}: Review the displayed account balances before allocating money.`,
          ).join('\n\n'),
        },
      });
    });
    await page.goto('/sandbox');
    const log = page.getByRole('log');
    const input = page.getByLabel('Ask about your demo accounts');
    const send = page.getByRole('button', { name: 'Send message' });
    for (let turn = 0; turn < 2; turn++) {
      await input.fill(`Explain my balances ${turn + 1}`);
      await send.click();
      await expect(page.locator('.busy-note')).toBeVisible();
      await expect
        .poll(() =>
          log.evaluate(
            (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
          ),
        )
        .toBeLessThan(2);
      const sentPosition = await log.evaluate((node) => node.scrollTop);
      if (turn === 1) expect(sentPosition).toBeGreaterThan(500);
      release();
      await expect(page.locator('.busy-note')).toHaveCount(0);
      await expect(input).toBeEnabled();
      await expect
        .poll(() => log.evaluate((node) => node.scrollTop))
        .toBe(sentPosition);
      expect(
        await log.evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
      ).toBeGreaterThan(500);
      pending = hold();
    }
  });
}

test('chat shows a sent message immediately, adds one reply, and restores failed messages for retry', async ({
  page,
}) => {
  const view = await sandboxFixture();
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  let release!: () => void;
  const hold = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  let pending = hold();
  let fail = false;
  let calls = 0;
  await page.route('**/api/sandbox/assistant', async (route) => {
    calls++;
    await pending;
    await route.fulfill(
      fail
        ? {
            status: 503,
            json: { error: 'The assistant is temporarily unavailable.' },
          }
        : {
            json: {
              mode: 'mock',
              source: 'plaid_sandbox',
              asOf: view.snapshot.asOf,
              reads: ['get_accounts'],
              text: 'Your checking has $148.60 available.',
            },
          },
    );
  });
  await page.goto('/sandbox');
  const input = page.getByLabel('Ask about your demo accounts');
  const send = page.getByRole('button', { name: 'Send message' });
  const prompt = 'What can I spend today?';
  const suggestions = page.locator('.suggestions');
  await expect(suggestions).toBeVisible();
  const userMessages = page
    .locator('.chat-message.user')
    .filter({ hasText: prompt });
  await input.fill(prompt);
  await expect(suggestions).toHaveCount(0);
  await input.fill('');
  await expect(suggestions).toBeVisible();
  await input.fill(prompt);
  await send.click();
  await expect(userMessages).toHaveCount(1);
  await expect(userMessages).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(suggestions).toHaveCount(0);
  await expect(input).toBeDisabled();
  await expect(page.locator('.busy-note')).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText(
    'Your checking has $148.60 available.',
  );
  release();
  await expect(page.getByRole('log')).toContainText(
    'Your checking has $148.60 available.',
  );
  await expect(userMessages).toHaveCount(1);
  await expect(input).toBeEnabled();
  await expect(suggestions).toHaveCount(0);
  pending = hold();
  fail = true;
  await input.fill('Try that again');
  await send.click();
  const retryMessage = page
    .locator('.chat-message.user')
    .filter({ hasText: 'Try that again' });
  await expect(retryMessage).toHaveCount(1);
  release();
  await expect(page.locator('.assistant-controls [role=alert]')).toContainText(
    'temporarily unavailable',
  );
  await expect(input).toHaveValue('Try that again');
  await expect(retryMessage).toHaveCount(0);
  pending = hold();
  fail = false;
  await send.click();
  await expect(retryMessage).toHaveCount(1);
  release();
  await expect(input).toBeEnabled();
  await expect(retryMessage).toHaveCount(1);
  await expect(page.locator('.busy-note')).toHaveCount(0);
  expect(calls).toBe(3);
});

test('forecast explains a flat window and distinguishes affordable variation from a cautious shortfall', async ({
  page,
}) => {
  let view = await sandboxFixture();
  const future = '2026-09-24T16:00:00.000Z';
  view.snapshot.asOf = future;
  view.snapshot.coverage!.transactionsUpdatedAt = future;
  view.snapshot.accounts.forEach((account) => {
    account.observedAt = future;
  });
  for (const transaction of view.snapshot.transactions) {
    if (/^txn-[678]-/.test(transaction.id)) {
      const date = new Date(transaction.date);
      date.setUTCMonth(date.getUTCMonth() + 1);
      transaction.date = date.toISOString();
    }
    if (transaction.status === 'pending')
      transaction.availableBalanceEffect = 'included';
  }
  view.snapshot.transactions.find(
    (transaction) => transaction.id === 'txn-6-3',
  )!.date = '2026-07-16T12:00:00.000Z';
  view.forecast = buildForecast(view.snapshot, 'demo-checking', future);
  expect(view.forecast.status).toBe('watch');
  expect(view.forecast.scheduledCents).toBe(0);
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'No detected bills due in this 14-day view',
  );
  await expect(
    page.getByText(/The next detected bill is Netflix, estimated for Oct 10/),
  ).toBeVisible();
  await expect(
    page.getByText('No bill deductions projected in this window', {
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator('.forecast-card')
      .screenshot({ path: `work/forecast-flat-${width}.png` });
  }
  view = await sandboxFixture();
  view.snapshot.transactions[0].availableBalanceEffect = 'included';
  view.snapshot.transactions.find(
    (transaction) => transaction.id === 'txn-6-3',
  )!.date = '2026-06-16T12:00:00.000Z';
  view.snapshot.accounts[0].availableCents = 50000;
  view.forecast = buildForecast(view.snapshot, 'demo-checking', DEMO_NOW);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'Bills still fit the cautious estimate',
  );
  await expect(
    page.getByText(/lowest projected balance is \$316.04/),
  ).toBeVisible();
  view.snapshot.accounts[0].availableCents = 19000;
  view.snapshot.transactions.find(
    (transaction) => transaction.id === 'txn-6-3',
  )!.amountCents = -7000;
  view.forecast = buildForecast(view.snapshot, 'demo-checking', DEMO_NOW);
  expect(view.forecast.shortageCents).toBe(0);
  expect(view.forecast.cautiousShortageCents).toBe(397);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await expect(page.getByTestId('forecast-title')).toHaveText(
    'Earlier or higher bills could leave you $3.97 short',
  );
});

test('Bills suggests a manual top-up and explains it without transfer calls, then follows corrections', async ({
  page,
}) => {
  const view = await sandboxFixture();
  view.snapshot.transactions[0].availableBalanceEffect = 'included';
  const update = () => {
    view.forecast = buildForecast(
      view.snapshot,
      view.snapshot.accounts[0].id,
      DEMO_NOW,
      view.corrections,
    );
    view.billSuggestion = buildBillSuggestion(view.snapshot, view.forecast);
  };
  update();
  let moneyCalls = 0;
  page.on('request', (request) => {
    if (/\/api\/(monitor|transfers)/.test(request.url())) moneyCalls++;
  });
  await page.route('**/api/sandbox', (route) => {
    if (route.request().method() === 'POST') {
      view.corrections = route.request().postDataJSON().corrections;
      update();
    }
    return route.fulfill({ json: view });
  });
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.route('**/api/sandbox/assistant', async (route) => {
    const assistant = new MockAssistant(
      { source: 'plaid_sandbox', getSnapshot: async () => view.snapshot },
      undefined,
      true,
      view.forecast,
    );
    return route.fulfill({
      json: await assistant.reply(
        DEMO_OWNER_ID,
        route.request().postDataJSON().message,
        view,
      ),
    });
  });
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  const suggestion = page.getByRole('region', {
    name: /Consider a \$35.36 top-up/,
  });
  await expect(suggestion).toContainText('Plaid Saving to Plaid Checking');
  await expect(suggestion).toContainText('$1,814.64 would remain');
  await expect(page.getByText('Transfers are not connected')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `work/bill-suggestion-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Explain this suggestion' }).click();
  await expect(page.getByRole('log')).toContainText('Consider a $35.36 top-up');
  await expect(page.getByRole('log')).toContainText('No money has moved');
  const bill = page
    .getByTestId('bill-row')
    .filter({ hasText: 'Adobe Creative Cloud' });
  await bill.getByText('Correct estimate', { exact: true }).click();
  await bill.getByLabel('Next date', { exact: true }).fill('2026-09-25');
  await bill.getByRole('button', { name: 'Apply correction' }).click();
  await expect(
    page.getByRole('heading', { name: 'Keep the bill money in checking' }),
  ).toBeVisible();
  await expect(page.getByRole('log')).toBeEmpty();
  await expect(
    page.getByRole('button', { name: /Approve|Simulate|Enable automatic/ }),
  ).toHaveCount(0);
  expect(moneyCalls).toBe(0);
});

test('Sandbox account selection shows savings history and follows refreshed account data', async ({
  page,
}) => {
  const view = await sandboxFixture();
  // This older savings record falls outside the first six combined transactions.
  view.snapshot.transactions.push({
    id: 'recorded-savings-interest',
    accountId: view.snapshot.accounts[1].id,
    merchant: 'Savings interest',
    amountCents: 425,
    date: '2026-01-01T00:00:00.000Z',
    status: 'posted',
  });
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.goto('/sandbox');
  const activity = page.getByRole('region', { name: 'Recent activity' });
  const savings = page.getByRole('button', {
    name: /Show activity for Plaid Saving/,
  });
  await expect(activity).not.toContainText('Savings interest');
  await savings.click();
  await expect(activity).toContainText('Savings interest');
  await expect(activity).toContainText('+$4.25');
  await expect(activity).not.toContainText('Neighborhood Market');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `work/account-activity-${width}.png`,
      fullPage: true,
    });
  }
  view.snapshot.transactions[
    view.snapshot.transactions.length - 1
  ].amountCents = 500;
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await expect(activity).toContainText('+$5.00');
  await expect(savings).toHaveAttribute('aria-pressed', 'true');
  view.snapshot.accounts = view.snapshot.accounts.slice(0, 1);
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await expect(savings).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Show activity for Plaid Checking/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(activity).toContainText('Neighborhood Market');
  await expect(activity).not.toContainText('Savings interest');
});

test('weekly income appears in the plan, chart and matching chat, then pauses when the newest paycheck is missing', async ({
  page,
}) => {
  const view = await sandboxFixture();
  view.sampleRothProfile = true;
  view.snapshot.accounts[0].availableCents = 1000000;
  view.snapshot.accounts[0].currentCents = 1000000;
  view.snapshot.transactions[0].availableBalanceEffect = 'included';
  view.snapshot.transactions.push(
    ...weeklyIncomeTransactions('2026-09-08').map((txn, index) => ({
      id: `weekly-${index}`,
      accountId: view.snapshot.accounts[0].id,
      merchant: txn.description,
      description: txn.description,
      amountCents: -txn.amount * 100,
      date: txn.date_posted,
      status: 'posted' as const,
    })),
  );
  const update = () => {
    view.forecast = buildForecast(
      view.snapshot,
      view.snapshot.accounts[0].id,
      DEMO_NOW,
    );
  };
  update();
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.route('**/api/sandbox/assistant', async (route) => {
    const input = route.request().postDataJSON();
    const assistant = new MockAssistant(
      { source: 'plaid_sandbox', getSnapshot: async () => view.snapshot },
      undefined,
      true,
      view.forecast,
      buildGrowthPlan(view, input.growth, 0),
    );
    await route.fulfill({
      json: await assistant.reply(DEMO_OWNER_ID, input.message, view),
    });
  });
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Save & invest' }).click();
  await expect(page.getByTestId('income-summary-30')).toContainText(
    '$2,000.00',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await page
    .getByRole('button', { name: 'When is my next paycheck?', exact: true })
    .click();
  await expect(page.getByRole('log')).toContainText('$500.00 estimated weekly');
  await expect(page.getByRole('log')).toContainText('2026-09-11');
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await expect(page.locator('.income-line')).toHaveCount(1);
  await expect(page.getByTestId('income-summary-14')).toContainText(
    '$1,000.00',
  );
  view.snapshot.transactions = view.snapshot.transactions.filter(
    (txn) => txn.id !== 'weekly-0',
  );
  view.snapshotId = 'missing-paycheck-observation';
  update();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await expect(page.getByTestId('income-summary-14')).toContainText(
    'Review payday',
  );
  await expect(page.locator('.income-line')).toHaveCount(0);
  await expect(page.getByRole('log')).toBeEmpty();
});

test('an operator-selected sample Roth profile is labeled, editable and restored on reset', async ({
  page,
}) => {
  const view = await sandboxFixture();
  view.sampleRothProfile = true;
  view.snapshot.accounts[0].availableCents = 1000000;
  view.snapshot.accounts[0].currentCents = 1000000;
  view.snapshot.transactions[0].availableBalanceEffect = 'included';
  view.forecast = buildForecast(
    view.snapshot,
    view.snapshot.accounts[0].id,
    DEMO_NOW,
  );
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Save & invest' }).click();
  await expect(page.getByTestId('growth-sample-profile')).toHaveCount(0);
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await expect(page.getByLabel('2026 eligible compensation ($)')).toHaveValue(
    '60000.00',
  );
  await page.getByLabel('2026 filing status').selectOption('unknown');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
  await page.getByRole('button', { name: 'Reset plan assumptions' }).click();
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
});

test('Sandbox savings planning estimates automatically, accepts overrides, refreshes with displayed balances and handles expired observations', async ({
  page,
}) => {
  const view = await sandboxFixture();
  view.snapshot.accounts[0].availableCents = 350000;
  view.snapshot.accounts[0].currentCents = 353050;
  view.snapshot.transactions[0].availableBalanceEffect = 'included';
  view.forecast = buildForecast(
    view.snapshot,
    view.snapshot.accounts[0].id,
    DEMO_NOW,
  );
  let expired = false;
  let moneyCalls = 0;
  page.on('request', (request) => {
    if (/\/api\/(monitor|transfers)/.test(request.url())) moneyCalls++;
  });
  await page.route('**/api/sandbox', (route) => route.fulfill({ json: view }));
  await page.route('**/api/sandbox/growth', (route) => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual([
      'corrections',
      'growth',
      'snapshotId',
    ]);
    expect(body.snapshotId).toBe(view.snapshotId);
    return expired
      ? route.fulfill({
          status: 409,
          json: {
            error:
              'This observation expired. Refresh Sandbox data before continuing.',
          },
        })
      : route.fulfill({ json: buildGrowthPlan(view, body.growth, 0) });
  });
  await page.route('**/api/sandbox/assistant', (route) => {
    const body = route.request().postDataJSON();
    expect(body.snapshotId).toBe(view.snapshotId);
    const plan = buildGrowthPlan(view, body.growth, 0);
    return route.fulfill({
      json: {
        mode: 'mock',
        source: 'plaid_sandbox',
        text: explainGrowthPlan(plan),
        reads: ['get_growth_plan'],
        asOf: DEMO_NOW,
      },
    });
  });
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Save & invest' }).click();
  await expect(page.getByTestId('growth-title')).toContainText(
    'toward your goals',
  );
  await expect(page.getByTestId('growth-estimate')).toContainText(
    'A starting plan from your transactions',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
  await page
    .getByRole('button', { name: 'Explain my savings and Roth plan' })
    .click();
  await expect(page.getByRole('log')).toContainText(
    'transaction-based estimates',
  );
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await expect(
    page.getByLabel('All spending for the next 30 days ($)'),
  ).toBeDisabled();
  await page.getByLabel('Budget approach').selectOption('manual');
  await page.getByLabel('All spending for the next 30 days ($)').fill('2700');
  await page.getByLabel('Checking buffer ($)').fill('300');
  await page.getByLabel('Cash reserve target ($)').fill('2000');
  await page.getByLabel('2026 filing status').selectOption('single');
  await page.getByLabel('2026 eligible compensation ($)').fill('60000');
  await page
    .getByLabel('2026 modified adjusted gross income ($)')
    .fill('60000');
  await page
    .getByLabel(
      'The demo income and contributions across all IRAs are reviewed.',
    )
    .check();
  await page
    .getByLabel(
      'Debt priorities and any workplace retirement match have been considered.',
    )
    .check();
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-hysa')).toHaveText('$150.00');
  await expect(page.getByTestId('growth-roth')).toHaveText('$250.00');
  await page
    .getByRole('button', { name: 'Explain my savings and Roth plan' })
    .click();
  await expect(page.getByRole('log')).toContainText(
    'Plaid Sandbox test balances',
  );
  await expect(page.getByRole('log')).toContainText(
    '$250.00 toward a Roth IRA',
  );
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `work/sandbox-growth-${width}.png`,
      fullPage: true,
    });
  }
  expired = true;
  await page.getByText('Edit plan assumptions', { exact: true }).click();
  await page.getByLabel('Roth goal for this plan ($)').fill('100');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await expect(page.getByTestId('growth-title')).toHaveCount(0);
  await expect(
    page.getByText(/This observation expired.*Previous suggestions are hidden/),
  ).toBeVisible();
  expired = false;
  view.snapshotId = 'refreshed-growth-observation';
  view.snapshot.accounts[0].availableCents = 100000;
  view.snapshot.accounts[0].currentCents = 103050;
  view.forecast = buildForecast(
    view.snapshot,
    view.snapshot.accounts[0].id,
    DEMO_NOW,
  );
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
  await page.getByRole('tab', { name: 'Save & invest' }).click();
  await expect(page.getByTestId('growth-title')).toHaveText(
    'Protect your cash first',
  );
  await expect(page.getByTestId('growth-roth')).toHaveText('$0.00');
  await expect(page.getByRole('log')).toBeEmpty();
  expect(moneyCalls).toBe(0);
});

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
      growth: initialGrowthInputs('plaid_sandbox'),
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
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Plaid Checking', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.scenario-controls')).toHaveCount(0);
  await expect(page.locator('.sandbox-scope')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
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
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.goto('/sandbox');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
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
  let release!: () => void;
  let pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/sandbox', async (route) => {
    await pending;
    return fail
      ? route.fulfill({
          status: 503,
          json: { error: 'Plaid is still preparing transaction history.' },
        })
      : route.fulfill({ json: view });
  });
  await page.route('**/api/sandbox/growth', (route) =>
    route.fulfill({
      json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
    }),
  );
  await page.goto('/sandbox');
  const loading = page.getByTestId('page-loading');
  await expect(loading).toBeVisible();
  await expect(loading.getByLabel('PennyAhead', { exact: true })).toBeVisible();
  await expect(
    loading.getByRole('status', { name: 'Loading PennyAhead' }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `work/loading-screen-${width}.png` });
  }
  release();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'still preparing',
  );
  await expect(loading).toHaveCount(0);
  await expect(page.locator('.account-card')).toHaveCount(0);
  fail = false;
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole('button', { name: 'Retry Sandbox connection' }).click();
  await expect(loading).toBeVisible();
  release();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(loading).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Plaid Checking', exact: true }),
  ).toBeVisible();
});
