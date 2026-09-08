import type {
  BankDataProvider,
  BankSnapshot,
  Transaction,
} from '../contracts.ts';

// Public, read-only demo identity. This is not production authentication.
export const DEMO_OWNER_ID = 'demo-alex';
const AS_OF = '2026-09-08T16:00:00.000Z';
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
  async getSnapshot(ownerId: string): Promise<BankSnapshot> {
    if (ownerId !== DEMO_OWNER_ID) throw new Error('Demo owner not found');
    return structuredClone(snapshot);
  }
}
export const bankProvider = new FixtureBankProvider();
