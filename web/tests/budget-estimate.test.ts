import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateBudget } from '../lib/server/budget-estimate.ts';
import {
  buildGrowthPlan,
  explainGrowthPlan,
} from '../lib/server/growth-plan.ts';
import { initialGrowthInputs } from '../lib/growth-contracts.ts';
import { getDemoForecast } from '../lib/server/demo-forecast.ts';
import { DEMO_OWNER_ID } from '../lib/server/fixtures.ts';

async function view() {
  const demo = await getDemoForecast(DEMO_OWNER_ID, {
    scenario: 'growth',
    corrections: [],
  });
  demo.snapshot.source = 'plaid_sandbox';
  demo.snapshot.coverage = {
    totalAccounts: 2,
    excludedAccounts: 0,
    historyComplete: true,
    transactionsUpdatedAt: demo.snapshot.asOf,
    warnings: [],
  };
  return demo;
}

void test('spending estimation deduplicates posted debits, ignores income, pending, future and other-account activity, and preserves input', async () => {
  const demo = await view();
  const base = {
    accountId: 'demo-checking',
    merchant: 'Purchase',
    status: 'posted' as const,
  };
  demo.snapshot.transactions = [
    { ...base, id: 'old', amountCents: -9000, date: '2026-06-11' },
    { ...base, id: 'middle', amountCents: -3000, date: '2026-08-01' },
    { ...base, id: 'recent', amountCents: -1000, date: '2026-09-01' },
    { ...base, id: 'recent', amountCents: -1000, date: '2026-09-01' },
    { ...base, id: 'income', amountCents: 999999, date: '2026-09-01' },
    {
      ...base,
      id: 'pending',
      amountCents: -999999,
      date: '2026-09-01',
      status: 'pending',
      availableBalanceEffect: 'included',
    },
    { ...base, id: 'future', amountCents: -999999, date: '2026-10-01' },
    {
      ...base,
      id: 'later-today',
      amountCents: -999999,
      date: '2026-09-08T23:00:00Z',
    },
    {
      ...base,
      id: 'saving',
      accountId: 'demo-savings',
      amountCents: -999999,
      date: '2026-09-01',
    },
  ];
  demo.forecast.bills = [];
  const before = structuredClone(demo);
  const estimate = estimateBudget(demo);
  assert.equal(estimate.historyDays, 90);
  assert.equal(estimate.transactionCount, 3);
  assert.equal(estimate.recentOutflowsCents, 1000);
  assert.equal(estimate.monthlyAverageCents, 4334);
  assert.equal(estimate.spendingCents, 4334);
  assert.equal(estimate.checkingBufferCents, 1012);
  assert.equal(estimate.emergencyTargetCents, 13002);
  assert.deepEqual(demo, before);
  demo.snapshot.transactions.push({
    ...base,
    id: 'larger',
    amountCents: -6000,
    date: '2026-09-02',
  });
  assert.equal(estimateBudget(demo).spendingCents, 7000);
});

void test('upcoming bills outside the 14-day chart floor the 30-day budget without double counting history, and corrections apply', async () => {
  const demo = await view();
  const bill = structuredClone(demo.forecast.bills[0]);
  bill.nextDate = '2026-10-01';
  bill.earliestDate = bill.nextDate;
  bill.amountCents = 200000;
  bill.maximumCents = 210000;
  demo.forecast.bills = [bill];
  assert.equal(estimateBudget(demo).spendingCents, 210000);
  bill.enabled = false;
  assert.ok(estimateBudget(demo).spendingCents < 210000);
});

void test('automatic planning needs no budget checkbox, separates Roth eligibility, respects extra commitments and cannot bypass stale data', async () => {
  const demo = await view();
  const inputs = initialGrowthInputs('plaid_sandbox');
  const before = structuredClone(inputs);
  const plan = buildGrowthPlan(demo, inputs, 0);
  assert.equal(plan.status, 'ready');
  assert.ok(plan.hysaSuggestedCents > 0);
  assert.equal(plan.rothSuggestedCents, 0);
  assert.match(explainGrowthPlan(plan), /transaction-based estimates/);
  assert.deepEqual(inputs, before);
  const conservative = buildGrowthPlan(
    demo,
    { ...inputs, extraCommitmentsCents: 400000 },
    0,
  );
  assert.equal(conservative.status, 'cash_first');
  assert.equal(conservative.hysaSuggestedCents, 0);
  demo.snapshot.accounts[1].observedAt = '2026-09-01T00:00:00Z';
  assert.equal(buildGrowthPlan(demo, inputs, 0).availableForGoalsCents, 0);
});

void test('short history does not imply zero spending or automatic surplus; a manual budget is an independent override', async () => {
  const demo = await view();
  demo.snapshot.transactions = demo.snapshot.transactions.filter(
    (txn) => txn.date >= '2026-09-01',
  );
  const inputs = initialGrowthInputs('plaid_sandbox');
  const plan = buildGrowthPlan(demo, inputs, 0);
  assert.equal(plan.status, 'needs_review');
  assert.equal(plan.hysaSuggestedCents, 0);
  assert.match(plan.blockers.join(' '), /less than 30 days/);
  const manual = buildGrowthPlan(
    demo,
    {
      ...inputs,
      budgetMode: 'manual',
      budgetReviewed: true,
      spendingCents: 200000,
      checkingBufferCents: 20000,
      emergencyTargetCents: 300000,
    },
    0,
  );
  assert.equal(manual.budgetEstimate, undefined);
  assert.equal(manual.spendingReserveCents, 200000);
  assert.equal(manual.status, 'ready');
});
