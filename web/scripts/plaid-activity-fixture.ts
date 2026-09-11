import type { BankSnapshot } from '../lib/contracts.ts';

const day = (date: Date) => date.toISOString().slice(0, 10);
const dollars = (cents: number) => cents / 100;
const transaction = (date: string, amount: number, description: string) => ({
  date_transacted: date,
  date_posted: date,
  amount,
  description,
  currency: 'USD',
});

/** Operator-authored Plaid Sandbox records, never a replacement inside the app adapter. */
export function activityFixture(snapshot: BankSnapshot, anchor: string) {
  if (snapshot.source !== 'plaid_sandbox')
    throw new Error('Sandbox data required');
  const now = new Date(`${anchor}T12:00:00Z`);
  if (!Number.isFinite(now.getTime()) || day(now) !== anchor)
    throw new Error('Valid anchor date required');
  const checking = snapshot.accounts.find(
    (account) => account.kind === 'checking',
  );
  const savings = snapshot.accounts.find(
    (account) =>
      account.kind === 'savings' && account.ownerId === checking?.ownerId,
  );
  if (!checking || !savings) throw new Error('Checking and savings required');
  const bills = [
    { name: 'PennyAhead Mobile', offset: 2, amounts: [45, 45, 45] },
    { name: 'PennyAhead Home Internet', offset: 5, amounts: [65, 65, 65] },
    { name: 'PennyAhead Gym', offset: 8, amounts: [29.99, 29.99, 29.99] },
    { name: 'PennyAhead Electric', offset: 11, amounts: [18.5, 21, 19.99] },
  ];
  // Keep dates inside the 14-day view and stable across three historical months.
  const candidateDates = Array.from({ length: 13 }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + index + 1);
    return date;
  }).filter((date) => date.getUTCDate() <= 28);
  const nextBills = bills.map((bill) => ({
    ...bill,
    date: day(
      candidateDates[Math.min(bill.offset - 1, candidateDates.length - 1)],
    ),
  }));
  const recent = (daysAgo: number) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return day(date);
  };
  const additions = new Map([
    [
      checking.id,
      [
        ...nextBills.flatMap((bill) =>
          [3, 2, 1].map((monthsAgo, index) => {
            const due = new Date(`${bill.date}T12:00:00Z`);
            due.setUTCMonth(due.getUTCMonth() - monthsAgo);
            return transaction(day(due), bill.amounts[index], bill.name);
          }),
        ),
        transaction(recent(1), 42.75, 'PennyAhead Neighborhood Market'),
        transaction(recent(2), 6.5, 'PennyAhead Corner Coffee'),
        transaction(recent(3), -250, 'PennyAhead Paycheck'),
        transaction(recent(1), 25, 'PennyAhead Savings Deposit'),
      ],
    ],
    [
      savings.id,
      [
        transaction(recent(1), -25, 'PennyAhead Savings Deposit'),
        transaction(recent(2), -0.67, 'PennyAhead Savings Interest'),
      ],
    ],
  ]);
  const config = {
    seed: `pennyahead-activity-${anchor}`,
    override_accounts: [checking, savings].map((account) => {
      const existing = snapshot.transactions.filter(
        (entry) => entry.accountId === account.id,
      );
      if (existing.some((entry) => entry.status !== 'posted'))
        throw new Error(
          'Resolve existing pending records before cloning the test Item',
        );
      return {
        type: 'depository',
        subtype: account.kind,
        starting_balance: dollars(account.currentCents),
        force_available_balance: dollars(account.availableCents),
        currency: 'USD',
        meta: {
          name: account.name,
          official_name: account.name,
          mask: account.mask,
        },
        transactions: [
          ...existing.map((entry) =>
            transaction(
              entry.date.slice(0, 10),
              dollars(-entry.amountCents),
              entry.merchant,
            ),
          ),
          ...additions.get(account.id)!,
        ],
      };
    }),
  };
  return {
    config,
    anchor,
    nextBills: nextBills.map(({ name, date }) => ({ name, date })),
    addedTransactions: 18,
  };
}
