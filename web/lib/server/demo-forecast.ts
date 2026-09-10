import type {
  DemoForecast,
  DemoOptions,
  BillCorrection,
} from '../contracts.ts';
import { FixtureBankProvider, DEMO_NOW } from './fixtures.ts';
import { buildForecast } from './forecast.ts';

export function parseDemoOptions(input: unknown): DemoOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Expected demo options');
  const values = input as Record<string, unknown>;
  const scenario = values.scenario ?? 'shortfall';
  if (
    scenario !== 'growth' &&
    scenario !== 'shortfall' &&
    scenario !== 'sufficient' &&
    scenario !== 'uncertain' &&
    scenario !== 'stale'
  )
    throw new Error('Unknown scenario');
  const raw = values.corrections ?? [];
  if (!Array.isArray(raw) || raw.length > 20)
    throw new Error('Invalid corrections');
  const corrections: BillCorrection[] = raw.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Invalid bill correction');
    const bill = entry as Record<string, unknown>;
    if (
      typeof bill.billId !== 'string' ||
      bill.billId.length > 300 ||
      typeof bill.amountCents !== 'number' ||
      typeof bill.nextDate !== 'string' ||
      typeof bill.enabled !== 'boolean'
    )
      throw new Error('Invalid bill correction');
    return {
      billId: bill.billId,
      amountCents: bill.amountCents,
      nextDate: bill.nextDate,
      enabled: bill.enabled,
    };
  });
  return { scenario, corrections };
}
export async function getDemoForecast(
  ownerId: string,
  options: DemoOptions = { scenario: 'shortfall', corrections: [] },
): Promise<DemoForecast> {
  const snapshot = await new FixtureBankProvider(options.scenario).getSnapshot(
    ownerId,
  );
  const account = snapshot.accounts.find((entry) => entry.kind === 'checking');
  if (!account) throw new Error('Checking account unavailable');
  return {
    ...options,
    clock: 'fixed-demo',
    snapshot,
    forecast: buildForecast(
      snapshot,
      account.id,
      DEMO_NOW,
      options.corrections,
    ),
  };
}
