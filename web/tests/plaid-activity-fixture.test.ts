import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityFixture } from '../scripts/plaid-activity-fixture.ts';
import { FixtureBankProvider, DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import type { BankSnapshot } from '../lib/contracts.ts';

void test('custom Plaid activity preserves existing records and balances, and supplies posted history for four upcoming bills on both sides of month end', async () => {
  const snapshot = await new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
  snapshot.source = 'plaid_sandbox';
  snapshot.transactions = snapshot.transactions.filter(
    (transaction) => transaction.status === 'posted',
  );
  const before = structuredClone(snapshot);
  for (const anchor of [
    '2026-09-10',
    '2026-01-28',
    '2026-02-25',
    '2026-12-31',
  ]) {
    const fixture = activityFixture(snapshot, anchor);
    assert.equal(fixture.addedTransactions, 18);
    assert.equal(fixture.config.override_accounts.length, 2);
    assert.equal(
      fixture.config.override_accounts.reduce(
        (n, account) => n + account.transactions.length,
        0,
      ),
      snapshot.transactions.length + 18,
    );
    const generated: BankSnapshot = {
      source: 'plaid_sandbox',
      asOf: `${anchor}T12:00:00Z`,
      accounts: snapshot.accounts.map((account) => ({
        ...account,
        observedAt: `${anchor}T12:00:00Z`,
      })),
      transactions: fixture.config.override_accounts.flatMap((account, index) =>
        account.transactions
          .filter((transaction) =>
            transaction.description.startsWith('PennyAhead'),
          )
          .map((transaction, j) => ({
            id: `test-${index}-${j}`,
            accountId: snapshot.accounts[index].id,
            merchant: transaction.description,
            date: transaction.date_posted,
            amountCents: Math.round(-transaction.amount * 100),
            status: 'posted' as const,
          })),
      ),
    };
    const forecast = buildForecast(generated, 'demo-checking', generated.asOf);
    assert.equal(forecast.bills.length, 4);
    assert.equal(forecast.scheduledCents, 15998);
    assert.equal(
      forecast.startingCents - forecast.days.at(-1)!.cautiousBalanceCents,
      16099,
    );
    for (const bill of forecast.bills) {
      assert.ok(bill.nextDate > anchor);
      assert.ok(bill.nextDate <= forecast.days.at(-1)!.date);
    }
    assert.deepEqual(snapshot, before);
  }
  assert.throws(
    () => activityFixture({ ...snapshot, source: 'synthetic' }, '2026-09-10'),
    /Sandbox data required/,
  );
});
