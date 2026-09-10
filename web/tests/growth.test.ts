import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_GROWTH_INPUTS } from '../lib/growth-contracts.ts';
import {
  buildGrowthPlan,
  calculateRothRoom,
  parseGrowthInputs,
} from '../lib/server/growth-plan.ts';
import { getDemoForecast } from '../lib/server/demo-forecast.ts';
import { DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';

const inputs = () => structuredClone(DEMO_GROWTH_INPUTS);
const demo = () =>
  getDemoForecast(DEMO_OWNER_ID, { scenario: 'growth', corrections: [] });

void test('growth plan reserves spending once, fills savings first, caps Roth at the chosen goal, and conserves every cent', async () => {
  const plan = buildGrowthPlan(await demo(), inputs(), 100000);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.checkingAvailableCents, 350000);
  assert.equal(plan.spendingReserveCents, 270000);
  assert.equal(plan.availableForGoalsCents, 50000);
  assert.equal(plan.hysaSuggestedCents, 15000);
  assert.equal(plan.rothSuggestedCents, 25000);
  assert.equal(plan.keepInCheckingCents, 10000);
  assert.equal(plan.hypotheticalAnnualInterestCents, 600);
  assert.equal(plan.roth.remainingCents, 500000);
  assert.equal(
    plan.checkingAvailableCents,
    plan.spendingReserveCents +
      plan.checkingBufferCents +
      plan.hysaSuggestedCents +
      plan.rothSuggestedCents +
      plan.keepInCheckingCents,
  );
});

void test('retirement cannot borrow from bills, existing savings, or a higher protected savings floor', async () => {
  const current = await demo();
  const protectedPlan = buildGrowthPlan(current, inputs(), 300000);
  assert.equal(protectedPlan.emergencyTargetCents, 300000);
  assert.equal(protectedPlan.hysaSuggestedCents, 50000);
  assert.equal(protectedPlan.rothSuggestedCents, 0);
  const shortage = buildGrowthPlan(
    await getDemoForecast(DEMO_OWNER_ID),
    inputs(),
    100000,
  );
  assert.equal(shortage.status, 'cash_first');
  assert.equal(shortage.hysaSuggestedCents + shortage.rothSuggestedCents, 0);
  const earmarked = inputs();
  earmarked.earmarkedSavingsCents = 180000;
  assert.equal(
    buildGrowthPlan(current, earmarked, 100000).rothSuggestedCents,
    0,
  );
});

void test('missing budget, stale checking, or stale savings suppress all allocation suggestions', async () => {
  const unreviewed = inputs();
  unreviewed.budgetReviewed = false;
  const current = await demo();
  assert.equal(
    buildGrowthPlan(current, unreviewed, 100000).status,
    'needs_review',
  );
  const stale = await getDemoForecast(DEMO_OWNER_ID, {
    scenario: 'stale',
    corrections: [],
  });
  assert.equal(
    buildGrowthPlan(stale, inputs(), 100000).availableForGoalsCents,
    0,
  );
  current.snapshot.accounts[1].observedAt = '2026-09-01T00:00:00Z';
  const savingsStale = buildGrowthPlan(current, inputs(), 100000);
  assert.equal(savingsStale.status, 'needs_review');
  assert.equal(
    savingsStale.hysaSuggestedCents + savingsStale.rothSuggestedCents,
    0,
  );
});

void test('pending debits reserve cash and pending income is never investable', async () => {
  const current = await demo();
  current.snapshot.transactions.unshift({
    id: 'pending-extra',
    accountId: 'demo-checking',
    merchant: 'One-off commitment',
    amountCents: -50000,
    date: current.snapshot.asOf,
    status: 'pending',
    availableBalanceEffect: 'excluded',
  });
  current.snapshot.transactions.unshift({
    id: 'pending-income',
    accountId: 'demo-checking',
    merchant: 'Future income',
    amountCents: 100000,
    date: current.snapshot.asOf,
    status: 'pending',
    availableBalanceEffect: 'excluded',
  });
  current.forecast = buildForecast(
    current.snapshot,
    'demo-checking',
    current.forecast.evaluatedAt,
  );
  const plan = buildGrowthPlan(current, inputs(), 100000);
  assert.equal(plan.checkingAvailableCents, 300000);
  assert.equal(plan.availableForGoalsCents, 0);
});

void test('a declared spending budget cannot undercut the cautious detected commitments', async () => {
  const settings = inputs();
  settings.spendingCents = 0;
  settings.extraCommitmentsCents = 0;
  const plan = buildGrowthPlan(await demo(), settings, 100000);
  assert.equal(plan.spendingReserveCents, 18396);
});

void test('Roth room uses the 2026 combined IRA and compensation limits, including catch-up eligibility', () => {
  const roth = inputs().roth;
  assert.equal(calculateRothRoom(roth).remainingCents, 500000);
  assert.equal(calculateRothRoom({ ...roth, age: 50 }).remainingCents, 610000);
  assert.equal(
    calculateRothRoom({ ...roth, traditionalContributionsCents: 490000 })
      .remainingCents,
    10000,
  );
  assert.equal(
    calculateRothRoom({ ...roth, compensationCents: 300000 }).remainingCents,
    50000,
  );
  assert.equal(
    calculateRothRoom({ ...roth, compensationCents: 100000 }).status,
    'review',
  );
  assert.equal(
    calculateRothRoom({ ...roth, rothContributionsCents: 750000 })
      .remainingCents,
    0,
  );
});

void test('Roth phase-outs and special cases require review, and above-range income blocks direct contributions', () => {
  const roth = inputs().roth;
  assert.equal(
    calculateRothRoom({ ...roth, modifiedAgiCents: 15299999 }).status,
    'eligible',
  );
  assert.equal(
    calculateRothRoom({ ...roth, modifiedAgiCents: 15300000 }).status,
    'review',
  );
  assert.equal(
    calculateRothRoom({ ...roth, modifiedAgiCents: 16800000 }).status,
    'unavailable',
  );
  assert.equal(
    calculateRothRoom({
      ...roth,
      filingStatus: 'joint',
      modifiedAgiCents: 24199999,
    }).status,
    'eligible',
  );
  assert.equal(
    calculateRothRoom({
      ...roth,
      filingStatus: 'joint',
      modifiedAgiCents: 24200000,
    }).status,
    'review',
  );
  assert.equal(
    calculateRothRoom({
      ...roth,
      filingStatus: 'joint',
      modifiedAgiCents: 25200000,
    }).status,
    'unavailable',
  );
  for (const special of [
    { ...roth, detailsReviewed: false },
    { ...roth, filingStatus: 'unknown' as const },
    { ...roth, filingStatus: 'separate' as const },
    { ...roth, compensationCents: 0 },
  ])
    assert.equal(calculateRothRoom(special).status, 'review');
});

void test('unknown Roth details and unreviewed retirement priorities keep that allocation in cash', async () => {
  const current = await demo();
  const settings = inputs();
  settings.roth.detailsReviewed = false;
  const unknown = buildGrowthPlan(current, settings, 100000);
  assert.equal(unknown.hysaSuggestedCents, 15000);
  assert.equal(unknown.rothSuggestedCents, 0);
  assert.equal(unknown.keepInCheckingCents, 35000);
  const priorities = inputs();
  priorities.retirementPrioritiesReviewed = false;
  assert.equal(
    buildGrowthPlan(current, priorities, 100000).rothSuggestedCents,
    0,
  );
});

void test('Roth allocation never exceeds remaining annual room, even when the goal is larger', async () => {
  const settings = inputs();
  settings.roth.rothContributionsCents = 749900;
  const plan = buildGrowthPlan(await demo(), settings, 100000);
  assert.equal(plan.rothSuggestedCents, 100);
  assert.equal(plan.keepInCheckingCents, 34900);
});

void test('input parsing rejects fractional cents, unsupported years, unknown fields and invalid rates', () => {
  for (const invalid of [
    null,
    {},
    { ...inputs(), spendingCents: -1 },
    { ...inputs(), spendingCents: 1.5 },
    { ...inputs(), hysaApyBasisPoints: 1501 },
    { ...inputs(), balanceCents: 999999 },
    { ...inputs(), roth: { ...inputs().roth, taxYear: 2027 } },
  ])
    assert.throws(() => parseGrowthInputs(invalid));
});
