import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvestmentPlan } from '../lib/server/investment-plan.ts';
import { normalizeRothHoldings } from '../lib/server/plaid-investments.ts';
import {
  buildGrowthPlan,
  parseGrowthInputs,
} from '../lib/server/growth-plan.ts';
import {
  DEMO_GROWTH_INPUTS,
  initialGrowthInputs,
} from '../lib/growth-contracts.ts';
import { getDemoForecast } from '../lib/server/demo-forecast.ts';
import { DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { MockAssistant } from '../lib/server/mock-assistant.ts';

const prefs = { horizonYears: 30, risk: 'balanced' as const, reviewed: true };
void test('investment previews conserve cents, cap medium-horizon exposure and withhold unsupported preferences', () => {
  for (const risk of ['cautious', 'balanced', 'growth'] as const) {
    for (const amount of [1, 2, 99, 101, 25000, 750000]) {
      const plan = buildInvestmentPlan(amount, { ...prefs, risk });
      assert.equal(
        plan.allocations.reduce((n, a) => n + a.amountCents, 0),
        amount,
      );
      assert.equal(
        plan.allocations.reduce((n, a) => n + a.percent, 0),
        100,
      );
      assert.ok(
        plan.allocations.every(
          (a) => Number.isSafeInteger(a.amountCents) && a.amountCents >= 0,
        ),
      );
      assert.equal(plan.basis, 'proposed_roth_contribution');
      assert.equal(plan.execution, 'not_connected');
    }
  }
  assert.deepEqual(
    buildInvestmentPlan(25000, prefs).allocations.map((a) => a.amountCents),
    [9000, 6000, 10000],
  );
  assert.equal(
    buildInvestmentPlan(100, { ...prefs, horizonYears: 7, risk: 'growth' })
      .title,
    '40% stocks · 60% bonds',
  );
  for (const profile of [
    undefined,
    { ...prefs, reviewed: false },
    { ...prefs, risk: 'unknown' as const },
    { ...prefs, horizonYears: 4 },
  ]) {
    assert.equal(buildInvestmentPlan(25000, profile).status, 'needs_review');
    assert.deepEqual(buildInvestmentPlan(25000, profile).allocations, []);
  }
  assert.equal(buildInvestmentPlan(0, prefs).status, 'no_contribution');
  for (const amount of [-1, 1.5, NaN, Infinity, 100000001])
    assert.throws(() => buildInvestmentPlan(amount, prefs));
});

void test('preferences are validated and no cash, security or order inputs are accepted', () => {
  for (const investment of [
    { ...prefs, horizonYears: -1 },
    { ...prefs, horizonYears: 8.5 },
    { ...prefs, risk: 'yolo' },
    { ...prefs, cashCents: 999999 },
    { ...prefs, ticker: 'ANY' },
  ]) {
    assert.throws(() =>
      parseGrowthInputs({ ...DEMO_GROWTH_INPUTS, investment }),
    );
  }
  assert.equal(
    initialGrowthInputs('plaid_sandbox').investment?.reviewed,
    false,
  );
});

void test('Roth holdings cannot fund a contribution, change IRA room or bypass cash-first checks', async () => {
  const demo = await getDemoForecast(DEMO_OWNER_ID, {
    scenario: 'growth',
    corrections: [],
  });
  const before = structuredClone(demo);
  const plan = buildGrowthPlan(demo, DEMO_GROWTH_INPUTS, 100000);
  assert.equal(plan.investment.amountCents, 25000);
  assert.equal(plan.investment.holdings?.accounts[0].valueCents, 1200000);
  assert.equal(plan.roth.remainingCents, 500000);
  demo.snapshot.rothHoldings!.accounts[0].valueCents = 999999999;
  assert.equal(
    buildGrowthPlan(demo, DEMO_GROWTH_INPUTS, 100000).investment.amountCents,
    25000,
  );
  const stopped = buildGrowthPlan(
    demo,
    { ...DEMO_GROWTH_INPUTS, budgetReviewed: false },
    100000,
  );
  assert.equal(stopped.investment.amountCents, 0);
  assert.equal(stopped.investment.allocations.length, 0);
  const assistant = new MockAssistant(
    { source: 'synthetic', getSnapshot: async () => before.snapshot },
    undefined,
    true,
    undefined,
    plan,
  );
  const reply = await assistant.reply(
    DEMO_OWNER_ID,
    'Buy the funds for my Roth and show my holdings',
  );
  assert.deepEqual(reply.reads, ['get_investment_plan']);
  assert.match(reply.text, /\$90.00/);
  assert.match(reply.text, /not an order; no money was moved/);
  assert.match(reply.text, /Sample Roth holdings/);
  assert.deepEqual(
    before,
    await getDemoForecast(DEMO_OWNER_ID, {
      scenario: 'growth',
      corrections: [],
    }),
  );
});

export function investmentResponse() {
  return {
    item: { item_id: 'item' },
    accounts: [
      {
        account_id: 'roth',
        name: 'Test Roth IRA',
        type: 'investment',
        subtype: 'roth',
        balances: {
          current: 100.12,
          iso_currency_code: 'USD',
          unofficial_currency_code: null,
        },
      },
      {
        account_id: 'traditional',
        name: 'Traditional IRA',
        type: 'investment',
        subtype: 'ira',
        balances: {
          current: 100,
          iso_currency_code: 'USD',
          unofficial_currency_code: null,
        },
      },
    ],
    securities: [
      {
        security_id: 'vti',
        name: 'Stock fund',
        ticker_symbol: 'VTI',
        is_cash_equivalent: false,
      },
    ],
    holdings: [
      {
        account_id: 'roth',
        security_id: 'vti',
        institution_value: 100.1234,
        institution_price_as_of: '2026-09-09',
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    ],
  };
}

void test('Plaid holdings keep Roth accounts separate and reject mismatched or incomplete observations', () => {
  const raw = investmentResponse();
  const normalized = normalizeRothHoldings(
    raw,
    'item',
    '2026-09-10T12:00:00.000Z',
  );
  assert.equal(normalized.accounts.length, 1);
  assert.equal(normalized.accounts[0].holdings[0].valueCents, 10012);
  assert.equal(normalized.accounts[0].holdings[0].priceAsOf, '2026-09-09');
  assert.throws(() =>
    normalizeRothHoldings(raw, 'other', normalized.retrievedAt),
  );
  assert.throws(() =>
    normalizeRothHoldings(
      { ...raw, securities: [] },
      'item',
      normalized.retrievedAt,
    ),
  );
  assert.throws(() =>
    normalizeRothHoldings(
      { ...raw, holdings: [...raw.holdings, ...raw.holdings] },
      'item',
      normalized.retrievedAt,
    ),
  );
  raw.holdings[0].iso_currency_code = 'EUR';
  assert.throws(() =>
    normalizeRothHoldings(raw, 'item', normalized.retrievedAt),
  );
  const empty = normalizeRothHoldings(
    { item: { item_id: 'item' }, accounts: [], securities: [], holdings: [] },
    'item',
    normalized.retrievedAt,
  );
  assert.equal(empty.status, 'not_connected');
});
