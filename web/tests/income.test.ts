import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyIncomeTransactions } from '../scripts/weekly-income-fixture.ts';
import {
  FixtureBankProvider,
  DEMO_NOW,
  DEMO_OWNER_ID,
} from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { buildIncomeOutlook } from '../lib/server/income.ts';
import {
  buildGrowthPlan,
  explainGrowthPlan,
} from '../lib/server/growth-plan.ts';
import { initialGrowthInputs } from '../lib/growth-contracts.ts';
import { MockAssistant } from '../lib/server/mock-assistant.ts';

const deposits = () =>
  weeklyIncomeTransactions('2026-09-08').map((entry, i) => ({
    id: `pay-${i}`,
    accountId: 'demo-checking',
    merchant: 'Normalized merchant',
    description: entry.description,
    amountCents: -entry.amount * 100,
    date: entry.date_posted,
    status: 'posted' as const,
  }));

void test('eight weekly payroll credits yield dated 14/30-day expectations, preserving the original provider description', () => {
  const transactions = deposits();
  const result = buildIncomeOutlook(transactions, DEMO_NOW, DEMO_NOW, true);
  assert.equal(result.status, 'estimated');
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0].amountCents, 50000);
  assert.equal(result.streams[0].nextDate, '2026-09-11');
  assert.equal(result.expected14DaysCents, 100000);
  assert.equal(result.expected30DaysCents, 200000);
  assert.deepEqual(
    result.payments.map((p) => p.date),
    ['2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02'],
  );
  for (const anchor of ['2026-01-01', '2026-02-28', '2026-09-11']) {
    const records = weeklyIncomeTransactions(anchor);
    assert.equal(records.length, 8);
    assert.ok(
      records.every(
        (entry) =>
          entry.date_posted < anchor &&
          new Date(entry.date_posted).getUTCDay() === 5,
      ),
    );
  }
});

void test('refunds, transfers, interest, irregular or sparse deposits and future records cannot establish weekly pay', () => {
  for (const description of [
    'Transfer from savings',
    'Payroll refund',
    'Weekly interest',
    'Airline refund',
  ]) {
    assert.equal(
      buildIncomeOutlook(
        deposits().map((txn) => ({ ...txn, description })),
        DEMO_NOW,
        DEMO_NOW,
        true,
      ).status,
      'none',
    );
  }
  assert.equal(
    buildIncomeOutlook(deposits().slice(0, 3), DEMO_NOW, DEMO_NOW, true).status,
    'none',
  );
  const irregular = deposits();
  irregular[1].date = '2026-09-03';
  assert.equal(
    buildIncomeOutlook(irregular, DEMO_NOW, DEMO_NOW, true).status,
    'none',
  );
  const variable = deposits();
  variable[0].amountCents = 100000;
  assert.equal(
    buildIncomeOutlook(variable, DEMO_NOW, DEMO_NOW, true).status,
    'none',
  );
  const future = [
    ...deposits(),
    {
      ...deposits()[0],
      id: 'future',
      date: '2026-09-08T23:00:00Z',
      amountCents: 999999,
    },
  ];
  assert.equal(
    buildIncomeOutlook(future, DEMO_NOW, DEMO_NOW, true).streams[0].amountCents,
    50000,
  );
});

void test('late or pending pay and stale data pause projections instead of silently rolling paydays forward', () => {
  const late = buildIncomeOutlook(
    deposits(),
    '2026-09-12T12:00:00Z',
    '2026-09-12T12:00:00Z',
    true,
  );
  assert.equal(late.status, 'review');
  assert.equal(late.expected30DaysCents, 0);
  assert.equal(late.streams[0].nextDate, '2026-09-11');
  const stale = buildIncomeOutlook(deposits(), DEMO_NOW, DEMO_NOW, false);
  assert.equal(stale.expected30DaysCents, 0);
  const pending = [
    ...deposits(),
    {
      ...deposits()[0],
      id: 'pending-pay',
      status: 'pending' as const,
      date: '2026-09-11',
    },
  ];
  assert.equal(
    buildIncomeOutlook(pending, DEMO_NOW, DEMO_NOW, true).expected14DaysCents,
    0,
  );
});

void test('income changes the cash-flow outlook and agent explanation without increasing current funds, shrinking bill gaps or establishing Roth eligibility', async () => {
  const snapshot = await new FixtureBankProvider('shortfall').getSnapshot(
    DEMO_OWNER_ID,
  );
  const base = buildForecast(snapshot, 'demo-checking', DEMO_NOW);
  const inputs = initialGrowthInputs('plaid_sandbox');
  const view = {
    snapshot,
    forecast: base,
    scenario: 'shortfall' as const,
    corrections: [],
    clock: 'fixed-demo' as const,
  };
  const before = buildGrowthPlan(view, inputs, 0);
  snapshot.transactions.push(...deposits(), deposits()[0]);
  snapshot.transactions.push({
    ...deposits()[0],
    id: 'other-pay',
    accountId: 'demo-savings',
  });
  const forecast = buildForecast(snapshot, 'demo-checking', DEMO_NOW);
  assert.equal(forecast.income!.streams[0].evidenceIds.length, 8);
  assert.equal(forecast.startingCents, base.startingCents);
  assert.equal(forecast.shortageCents, base.shortageCents);
  assert.equal(forecast.cautiousShortageCents, base.cautiousShortageCents);
  assert.equal(
    forecast.days.at(-1)!.balanceWithIncomeCents,
    base.endingCents + 100000,
  );
  const after = buildGrowthPlan({ ...view, forecast }, inputs, 0);
  assert.equal(after.availableForGoalsCents, before.availableForGoalsCents);
  assert.equal(after.rothSuggestedCents, 0);
  assert.equal(after.checkingAvailableCents, before.checkingAvailableCents);
  assert.equal(
    after.expectedCashFlowCents,
    200000 - after.spendingReserveCents,
  );
  assert.match(
    explainGrowthPlan(after),
    /cash-flow outlook, not additional money available today/,
  );
  const bank = { source: snapshot.source, getSnapshot: async () => snapshot };
  const assistant = new MockAssistant(bank, undefined, true, forecast, after);
  const income = await assistant.reply(DEMO_OWNER_ID, 'What income do I have?');
  assert.deepEqual(income.reads, ['get_forecast']);
  assert.match(income.text, /\$500.00 estimated weekly/);
  assert.match(income.text, /do not establish annual taxable income/);
  const growth = await assistant.reply(
    DEMO_OWNER_ID,
    'How do paychecks affect my Roth?',
  );
  assert.match(growth.text, /\$2,000.00 over 30 days/);
});
