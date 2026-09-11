import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { buildBillSuggestion } from '../lib/server/bill-suggestion.ts';
import type { BankSnapshot } from '../lib/contracts.ts';

const advice = (snapshot: BankSnapshot) =>
  buildBillSuggestion(
    snapshot,
    buildForecast(snapshot, 'demo-checking', DEMO_NOW),
  );

void test('bill advice suggests only the cautious gap and reserves pending savings commitments without changing balances', async () => {
  const snapshot = await new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
  snapshot.source = 'plaid_sandbox';
  snapshot.transactions.push({
    id: 'savings-pending',
    accountId: 'demo-savings',
    merchant: 'Reserved savings payment',
    amountCents: -20000,
    date: DEMO_NOW,
    status: 'pending',
    availableBalanceEffect: 'excluded',
  });
  const original = structuredClone(snapshot);
  const result = advice(snapshot);
  assert.equal(result.status, 'consider_top_up');
  assert.equal(result.suggestedCents, 3536);
  assert.equal(result.remainingSavingsCents, 161464);
  assert.equal(result.neededBefore, '2026-09-18');
  assert.match(result.explanation, /emergency reserve/);
  assert.match(result.explanation, /arrival timing has not been checked/);
  assert.deepEqual(snapshot, original);
  const forecast = buildForecast(snapshot, 'demo-checking', DEMO_NOW);
  forecast.cautiousShortageCents = 5000;
  forecast.cautiousFirstShortfall = '2026-09-16';
  const cautious = buildBillSuggestion(snapshot, forecast);
  assert.equal(cautious.suggestedCents, 5000);
  assert.equal(cautious.neededBefore, '2026-09-16');
});

void test('bill advice withholds top-ups for unverified checking or savings and never uses another owner', async () => {
  const snapshot = await new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
  snapshot.source = 'plaid_sandbox';
  snapshot.transactions[0].availableBalanceEffect = 'unknown';
  assert.equal(advice(snapshot).status, 'review');
  snapshot.transactions[0].availableBalanceEffect = 'included';
  snapshot.accounts[1].observedAt = '2026-09-01T00:00:00.000Z';
  assert.equal(advice(snapshot).status, 'review');
  assert.equal(advice(snapshot).suggestedCents, 0);
  snapshot.accounts[1].observedAt = DEMO_NOW;
  snapshot.accounts[1].ownerId = 'someone-else';
  assert.equal(advice(snapshot).status, 'other_options');
  assert.equal(advice(snapshot).sourceAccountId, null);
});

void test('bill advice distinguishes enough checking from insufficient savings', async () => {
  const snapshot = await new FixtureBankProvider('growth').getSnapshot(
    DEMO_OWNER_ID,
  );
  snapshot.source = 'plaid_sandbox';
  assert.equal(advice(snapshot).status, 'covered');
  assert.equal(advice(snapshot).suggestedCents, 0);
  snapshot.accounts[0].availableCents = 14860;
  snapshot.accounts[1].availableCents = 1000;
  const result = advice(snapshot);
  assert.equal(result.status, 'other_options');
  assert.equal(result.shortageCents, 3536);
  assert.equal(result.suggestedCents, 0);
  assert.match(result.explanation, /changing the payment date/);
});
