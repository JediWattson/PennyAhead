import type { activityFixture } from './plaid-activity-fixture.ts';

type Config = ReturnType<typeof activityFixture>['config'];

/** Clean operator-authored Sandbox history; never rewrite provider data in the UI. */
export function cleanSavingsHistory(original: Config, anchor: string): Config {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== anchor
  )
    throw new Error('Valid anchor date required');
  const config = structuredClone(original);
  const checking = config.override_accounts.find(
    (a) => a.subtype === 'checking',
  );
  const savings = config.override_accounts.find((a) => a.subtype === 'savings');
  if (!checking || !savings) throw new Error('Checking and savings required');
  const deposits = checking.transactions.filter(
    (t) => t.description === 'Transfer to Savings' && t.amount > 0,
  );
  if (!deposits.length) throw new Error('Matching checking transfers required');
  savings.transactions = [
    ...deposits.map((t) => ({
      ...t,
      amount: -t.amount,
      description: 'Transfer from Checking',
    })),
    ...[0, 1, 2].map((monthsAgo) => {
      const monthEnd = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthsAgo, 0),
      );
      const posted = monthEnd.toISOString().slice(0, 10);
      return {
        date_transacted: posted,
        date_posted: posted,
        amount: -0.67,
        description: 'Monthly Savings Interest',
        currency: 'USD',
      };
    }),
  ];
  config.seed = `${config.seed}-clean-savings`;
  return config;
}
