import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvestmentPlan } from '../lib/server/investment-plan.ts';
import {
  advanceRothSimulation as advance,
  prepareRothSimulation,
} from '../lib/roth-simulation.ts';
import type {
  RothSimulation,
  RothSimulationAction,
} from '../lib/roth-simulation.ts';

const plan = buildInvestmentPlan(25000, {
  horizonYears: 30,
  risk: 'balanced',
  reviewed: true,
});
const steps = (state: RothSimulation, ...actions: RothSimulationAction[]) =>
  actions.reduce(advance, state);
const funded = () =>
  steps(
    prepareRothSimulation(plan)!,
    'create_account',
    'review_contribution',
    'confirm_contribution',
    'settle_contribution',
  );

void test('practice requires a valid current preview and copies only the proposed contribution', () => {
  assert.equal(
    prepareRothSimulation({ ...plan, status: 'needs_review' }),
    null,
  );
  assert.equal(prepareRothSimulation({ ...plan, amountCents: 0 }), null);
  assert.equal(prepareRothSimulation({ ...plan, amountCents: 25001 }), null);
  assert.equal(prepareRothSimulation({ ...plan, allocations: [] }), null);
  assert.equal(
    prepareRothSimulation({
      ...plan,
      allocations: [plan.allocations[0], plan.allocations[0]],
    }),
    null,
  );
  const initial = prepareRothSimulation(plan)!;
  assert.equal(initial.cashCents, 0);
  assert.equal(initial.investedCents, 0);
  assert.deepEqual(
    initial.allocations.map((a) => a.amountCents),
    [9000, 6000, 10000],
  );
  initial.allocations[0].amountCents = 1;
  assert.equal(plan.allocations[0].amountCents, 9000);
  assert.equal(plan.execution, 'not_connected');
});

void test('practice contributions and purchases require review; pending and repeated events do not create money', () => {
  const initial = prepareRothSimulation(plan)!;
  assert.equal(advance(initial, 'confirm_contribution'), initial);
  const pending = steps(
    initial,
    'create_account',
    'review_contribution',
    'confirm_contribution',
  );
  assert.equal(pending.cashCents, 0);
  assert.equal(advance(pending, 'review_orders'), pending);
  assert.equal(advance(pending, 'confirm_contribution'), pending);
  const cash = advance(pending, 'settle_contribution');
  assert.equal(cash.cashCents, 25000);
  assert.equal(advance(cash, 'settle_contribution'), cash);
  assert.equal(advance(cash, 'confirm_orders'), cash);
  const orders = steps(cash, 'review_orders', 'confirm_orders');
  assert.equal(orders.reservedCents, 25000);
  assert.equal(orders.cashCents, 0);
  assert.equal(advance(orders, 'confirm_orders'), orders);
  const filled = advance(orders, 'fill_orders');
  assert.equal(filled.investedCents, 25000);
  assert.equal(filled.contributedCents, 25000);
  assert.equal(filled.reservedCents, 0);
  assert.equal(advance(filled, 'fill_orders'), filled);
  assert.equal(advance(filled, 'reject_orders'), filled);
  assert.equal(advance(filled, 'review_contribution'), filled);
});

void test('failed contributions and rejected purchases can retry without counting the deposit twice', () => {
  const failed = steps(
    prepareRothSimulation(plan)!,
    'create_account',
    'review_contribution',
    'confirm_contribution',
    'fail_contribution',
  );
  assert.equal(failed.cashCents, 0);
  assert.equal(failed.contributedCents, 0);
  assert.equal(advance(failed, 'settle_contribution'), failed);
  const cash = steps(
    failed,
    'review_contribution',
    'confirm_contribution',
    'settle_contribution',
  );
  assert.equal(cash.contributionAttempt, 2);
  const rejected = steps(
    cash,
    'review_orders',
    'confirm_orders',
    'reject_orders',
  );
  assert.equal(rejected.cashCents, 25000);
  assert.equal(rejected.reservedCents, 0);
  assert.equal(rejected.investedCents, 0);
  assert.equal(advance(rejected, 'reject_orders'), rejected);
  const filled = steps(
    rejected,
    'review_orders',
    'confirm_orders',
    'fill_orders',
  );
  assert.equal(filled.orderAttempt, 2);
  assert.equal(filled.contributedCents, 25000);
  assert.equal(filled.investedCents, 25000);
  assert.equal(
    new Set(filled.activity.map((a) => a.id)).size,
    filled.activity.length,
  );
  assert.ok(filled.activity.some((a) => a.message.includes('C1 failed')));
  assert.ok(filled.activity.some((a) => a.message.includes('C2 settled')));
  assert.ok(filled.activity.some((a) => a.message.includes('O1 rejected')));
  assert.ok(filled.activity.some((a) => a.message.includes('O2 filled')));
});

void test('canceling a review preserves cash and reachable practice states conserve every cent', () => {
  const initial = prepareRothSimulation(plan)!;
  const canceled = steps(
    initial,
    'create_account',
    'review_contribution',
    'cancel_review',
  );
  assert.equal(canceled.contributionAttempt, 0);
  const cash = funded();
  assert.equal(steps(cash, 'review_orders', 'cancel_review').cashCents, 25000);
  const actions: RothSimulationAction[] = [
    'create_account',
    'review_contribution',
    'confirm_contribution',
    'settle_contribution',
    'fail_contribution',
    'review_orders',
    'confirm_orders',
    'fill_orders',
    'reject_orders',
    'cancel_review',
  ];
  // Explore all transitions from every distinct stage, including invalid/out-of-order callbacks.
  const queue = [initial];
  const seen = new Set<string>();
  while (queue.length) {
    const state = queue.shift()!;
    if (seen.has(state.stage)) continue;
    seen.add(state.stage);
    for (const action of actions) {
      const next = advance(state, action);
      assert.equal(
        next.cashCents + next.reservedCents + next.investedCents,
        next.contributedCents,
      );
      assert.ok(
        [next.cashCents, next.reservedCents, next.investedCents].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ),
      );
      assert.ok(next.contributedCents === 0 || next.contributedCents === 25000);
      queue.push(next);
    }
  }
  assert.equal(seen.size, 10);
});
