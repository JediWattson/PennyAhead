import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/api/sandbox/growth/route.ts';
import { POST as chat } from '../app/api/sandbox/assistant/route.ts';
import {
  SandboxObservations,
  sandboxForecast,
} from '../lib/server/sandbox-view.ts';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { PLAID_DEMO_OWNER_ID } from '../lib/server/plaid-bank.ts';
import {
  DEMO_GROWTH_INPUTS,
  initialGrowthInputs,
} from '../lib/growth-contracts.ts';
import { buildGrowthPlan } from '../lib/server/growth-plan.ts';

const request = (body: unknown) =>
  new Request('http://localhost/api/sandbox/growth', {
    method: 'POST',
    body: JSON.stringify(body),
  });

void test('Sandbox planning and chat use the stored observation, corrections and entered goals without refreshing or moving money', async () => {
  const globals = globalThis as typeof globalThis & {
    pennyAheadSandboxObservations?: SandboxObservations;
  };
  const previous = globals.pennyAheadSandboxObservations;
  const enabled = process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED;
  let clock = Date.parse(DEMO_NOW);
  let reads = 0;
  const snapshot = await new FixtureBankProvider('growth').getSnapshot(
    DEMO_OWNER_ID,
  );
  snapshot.source = 'plaid_sandbox';
  snapshot.coverage = {
    totalAccounts: 2,
    excludedAccounts: 0,
    historyComplete: true,
    transactionsUpdatedAt: DEMO_NOW,
    warnings: [],
  };
  snapshot.accounts.forEach((account) => {
    account.ownerId = PLAID_DEMO_OWNER_ID;
  });
  snapshot.accounts[0].availableCents = 410000;
  snapshot.accounts[0].currentCents = 413050;
  snapshot.accounts[1].availableCents = 180000;
  snapshot.accounts[1].currentCents = 180000;
  try {
    process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED = 'true';
    const cache = new SandboxObservations(
      {
        source: 'plaid_sandbox',
        getSnapshot: async () => {
          reads++;
          return structuredClone(snapshot);
        },
      },
      () => clock,
    );
    globals.pennyAheadSandboxObservations = cache;
    const observation = await cache.latest();
    const body = {
      snapshotId: observation.id,
      corrections: [],
      growth: DEMO_GROWTH_INPUTS,
    };
    const response = await POST(request(body));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const plan = await response.json();
    assert.equal(plan.status, 'ready', JSON.stringify(plan.blockers));
    assert.equal(plan.source, 'plaid_sandbox');
    assert.equal(plan.checkingAvailableCents, 410000);
    assert.equal(plan.hysaSuggestedCents, 20000);
    assert.equal(plan.rothSuggestedCents, 25000);
    const answer = await chat(
      request({ ...body, message: 'Explain my savings and Roth plan' }),
    );
    assert.equal(answer.status, 200);
    const reply = await answer.json();
    assert.equal(reply.source, 'plaid_sandbox');
    assert.deepEqual(reply.reads, ['get_growth_plan']);
    assert.match(
      reply.text,
      /\$200.00 toward high-yield savings and \$250.00 toward a Roth IRA/,
    );
    assert.match(reply.text, /Plaid Sandbox test balances/);
    assert.doesNotMatch(reply.text, /using synthetic data/);
    const bill = sandboxForecast(observation).forecast.bills[0];
    const corrected = await POST(
      request({
        ...body,
        corrections: [
          {
            billId: bill.id,
            amountCents: 600000,
            nextDate: bill.nextDate,
            enabled: true,
          },
        ],
      }),
    );
    assert.equal(corrected.status, 200);
    assert.equal((await corrected.json()).status, 'cash_first');
    const movement = await chat(
      request({ ...body, message: 'Move $250 into my Roth' }),
    );
    assert.match(
      (await movement.json()).text,
      /read-only.*No transfer was created/,
    );
    assert.equal(
      (await POST(request({ ...body, balances: [99999999] }))).status,
      400,
    );
    assert.equal((await POST(request({ ...body, growth: {} }))).status, 400);
    assert.equal(
      (await POST(request({ ...body, snapshotId: 'invented' }))).status,
      409,
    );
    assert.deepEqual(cache.read(observation.id).snapshot, snapshot);
    assert.equal(reads, 1);
    clock += 15 * 60000;
    assert.equal((await POST(request(body))).status, 409);
    assert.equal(
      (await chat(request({ ...body, message: 'Explain my Roth plan' })))
        .status,
      409,
    );
    process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED = 'false';
    assert.equal((await POST(request(body))).status, 503);
  } finally {
    globals.pennyAheadSandboxObservations = previous;
    if (enabled === undefined)
      delete process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED;
    else process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED = enabled;
  }
});

void test('Sandbox estimates spending automatically while unknown Roth details, incomplete data and missing savings retain their own guards', async () => {
  const snapshot = await new FixtureBankProvider('growth').getSnapshot(
    DEMO_OWNER_ID,
  );
  snapshot.source = 'plaid_sandbox';
  snapshot.coverage = {
    totalAccounts: 2,
    excludedAccounts: 0,
    historyComplete: true,
    transactionsUpdatedAt: DEMO_NOW,
    warnings: [],
  };
  const view = () =>
    sandboxForecast({
      id: 'test',
      snapshot,
      evaluatedAt: DEMO_NOW,
      createdAt: Date.parse(DEMO_NOW),
    });
  const defaults = initialGrowthInputs('plaid_sandbox');
  assert.equal(defaults.budgetReviewed, false);
  assert.equal(defaults.roth.detailsReviewed, false);
  assert.equal(defaults.roth.filingStatus, 'unknown');
  const estimated = buildGrowthPlan(view(), defaults, 0);
  assert.equal(estimated.status, 'ready');
  assert.equal(estimated.budgetEstimate?.usable, true);
  assert.ok(estimated.spendingReserveCents > 0);
  assert.ok(estimated.hysaSuggestedCents > 0);
  assert.equal(estimated.rothSuggestedCents, 0);
  snapshot.transactions[0].availableBalanceEffect = 'unknown';
  const incomplete = buildGrowthPlan(view(), DEMO_GROWTH_INPUTS, 0);
  assert.equal(incomplete.status, 'needs_review');
  assert.equal(
    incomplete.hysaSuggestedCents + incomplete.rothSuggestedCents,
    0,
  );
  snapshot.transactions[0].availableBalanceEffect = 'included';
  snapshot.accounts = snapshot.accounts.filter(
    (account) => account.kind === 'checking',
  );
  const missing = buildGrowthPlan(view(), DEMO_GROWTH_INPUTS, 0);
  assert.equal(missing.status, 'needs_review');
  assert.match(missing.blockers.join(' '), /No savings account/);
});
