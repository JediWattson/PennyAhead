import type {
  BankDataProvider,
  BankSnapshot,
  Transaction,
  DemoScenario,
} from '../contracts.ts';

// Public, read-only demo identity. This is not production authentication.
export const DEMO_OWNER_ID = 'demo-alex';
export const DEMO_NOW = '2026-09-08T16:00:00.000Z';
const AS_OF = DEMO_NOW;
const subscriptions = [
  { merchant: 'Netflix', cents: 1999, day: 10 },
  { merchant: 'Spotify', cents: 1199, day: 12 },
  { merchant: 'Anytime Fitness', cents: 8900, day: 15 },
  { merchant: 'Adobe Creative Cloud', cents: 5999, day: 18 },
  { merchant: 'iCloud+', cents: 299, day: 20 },
];
const history: Transaction[] = [6, 7, 8].flatMap((month) =>
  subscriptions.map((subscription, index) => ({
    id: `txn-${month}-${index}`,
    accountId: 'demo-checking',
    merchant: subscription.merchant,
    amountCents: -subscription.cents,
    date: `2026-${String(month).padStart(2, '0')}-${subscription.day}T12:00:00.000Z`,
    status: 'posted' as const,
  })),
);
const snapshot: BankSnapshot = {
  source: 'synthetic',
  asOf: AS_OF,
  accounts: [
    {
      id: 'demo-checking',
      ownerId: DEMO_OWNER_ID,
      name: 'Everyday checking',
      kind: 'checking',
      currency: 'USD',
      currentCents: 17910,
      availableCents: 14860,
      mask: '1042',
      observedAt: AS_OF,
    },
    {
      id: 'demo-savings',
      ownerId: DEMO_OWNER_ID,
      name: 'Rainy day savings',
      kind: 'savings',
      currency: 'USD',
      currentCents: 185000,
      availableCents: 185000,
      mask: '8091',
      observedAt: AS_OF,
    },
  ],
  transactions: [
    {
      id: 'txn-pending-grocery',
      accountId: 'demo-checking',
      merchant: 'Neighborhood Market',
      amountCents: -3050,
      date: AS_OF,
      status: 'pending' as const,
      availableBalanceEffect: 'included' as const,
    },
    {
      id: 'txn-coffee',
      accountId: 'demo-checking',
      merchant: 'Corner Coffee',
      amountCents: -650,
      date: '2026-09-07T09:00:00.000Z',
      status: 'posted' as const,
    },
    {
      id: 'txn-payroll',
      accountId: 'demo-checking',
      merchant: 'Paycheck',
      amountCents: 180000,
      date: '2026-09-04T09:00:00.000Z',
      status: 'posted' as const,
    },
    {
      id: 'txn-rent',
      accountId: 'demo-checking',
      merchant: 'Rent',
      amountCents: -140000,
      date: '2026-09-01T09:00:00.000Z',
      status: 'posted' as const,
    },
    ...history,
  ].sort((a, b) => b.date.localeCompare(a.date)),
};
export class FixtureBankProvider implements BankDataProvider {
  readonly source = 'synthetic' as const;
  private scenario: DemoScenario;
  constructor(scenario: DemoScenario = 'shortfall') {
    this.scenario = scenario;
  }
  async getSnapshot(ownerId: string): Promise<BankSnapshot> {
    if (ownerId !== DEMO_OWNER_ID) throw new Error('Demo owner not found');
    const result = structuredClone(snapshot);
    if (this.scenario === 'sufficient') {
      result.accounts[0].availableCents = 50000;
      result.accounts[0].currentCents = 53050;
    }
    if (this.scenario === 'uncertain') {
      result.transactions.find((txn) => txn.id === 'txn-6-3')!.date =
        '2026-06-16T12:00:00.000Z';
      result.transactions.find((txn) => txn.id === 'txn-7-3')!.date =
        '2026-07-19T12:00:00.000Z';
    }
    if (this.scenario === 'stale') {
      result.asOf = '2026-09-05T16:00:00.000Z';
      for (const account of result.accounts) account.observedAt = result.asOf;
      result.transactions = result.transactions.filter(
        (txn) => txn.date <= result.asOf || txn.status === 'pending',
      );
      result.transactions.find((txn) => txn.status === 'pending')!.date =
        result.asOf;
    }
    result.transactions.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }
}
export const bankProvider = new FixtureBankProvider();
