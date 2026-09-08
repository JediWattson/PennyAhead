import type {
  BankSnapshot,
  ForecastReport,
  FundingCandidate,
  FundingPlan,
  MonitorConfig,
} from '../contracts.ts';
import { buildForecast } from './forecast.ts';
import { parseDemoOptions } from './demo-forecast.ts';

export function parseMonitorConfig(input: unknown): MonitorConfig {
  const options = parseDemoOptions(input);
  const values = input as Record<string, unknown>;
  const minimum = values.savingsMinimumCents;
  if (
    typeof values.enabled !== 'boolean' ||
    typeof minimum !== 'number' ||
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    minimum > 100000000 ||
    (values.timing !== 'standard' && values.timing !== 'delayed')
  ) {
    throw new Error('Invalid monitoring settings');
  }
  return {
    ...options,
    enabled: values.enabled,
    savingsMinimumCents: minimum,
    timing: values.timing,
  };
}

/** Synthetic timing assumption, not a bank quote: weekdays only, no holiday/cutoff model. */
export function estimateDemoArrival(
  evaluatedAt: string,
  timing: MonitorConfig['timing'],
): string {
  const date = new Date(evaluatedAt);
  if (!Number.isFinite(date.getTime()))
    throw new Error('Invalid evaluation time');
  let remaining = timing === 'standard' ? 3 : 10;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

/** Narrow read-only operations for the mock and future Strands adapter. Owner is server context. */
export function createFundingTools(
  ownerId: string,
  snapshot: BankSnapshot,
  config: MonitorConfig,
  evaluatedAt: string,
) {
  const owned = {
    ...snapshot,
    accounts: snapshot.accounts.filter((a) => a.ownerId === ownerId),
  };
  const checking = owned.accounts.find((a) => a.kind === 'checking');
  if (!checking) throw new Error('Checking account unavailable');
  return {
    inspectForecast: () =>
      buildForecast(owned, checking.id, evaluatedAt, config.corrections),
    checkTransferTiming: () => estimateDemoArrival(evaluatedAt, config.timing),
    compareFundingAccounts(amountCents: number): FundingCandidate[] {
      if (!Number.isSafeInteger(amountCents) || amountCents < 0)
        throw new Error('Invalid amount');
      return owned.accounts
        .filter(
          (a) =>
            a.kind === 'savings' &&
            a.currency === checking.currency &&
            a.id !== checking.id,
        )
        .map((account) => {
          // Reuse the forecast's pending reconciliation and freshness checks, and
          // reserve this source account's own detected commitments.
          const sourceForecast = buildForecast(owned, account.id, evaluatedAt);
          const spendableCents = Math.min(
            sourceForecast.startingCents,
            ...sourceForecast.days.map((day) => day.cautiousBalanceCents),
          );
          const invalid =
            sourceForecast.status === 'stale' ||
            sourceForecast.status === 'incomplete' ||
            !Number.isSafeInteger(spendableCents);
          const remainingCents = spendableCents - amountCents;
          const eligible =
            !invalid &&
            Number.isSafeInteger(remainingCents) &&
            remainingCents >= config.savingsMinimumCents;
          return {
            accountId: account.id,
            name: account.name,
            spendableCents,
            remainingCents,
            eligible,
            reason: invalid
              ? 'Refresh or reconcile savings data before proposing funding.'
              : eligible
                ? 'The full shortage fits above your savings minimum.'
                : 'The full shortage would breach your savings minimum.',
          };
        })
        .sort(
          (a, b) =>
            Number(b.eligible) - Number(a.eligible) ||
            b.remainingCents - a.remainingCents ||
            a.accountId.localeCompare(b.accountId),
        );
    },
  };
}

export function buildFundingPlan(
  ownerId: string,
  snapshot: BankSnapshot,
  config: MonitorConfig,
  evaluatedAt: string,
): FundingPlan {
  const tools = createFundingTools(ownerId, snapshot, config, evaluatedAt);
  const forecast: ForecastReport = tools.inspectForecast();
  const amountCents = Math.max(
    forecast.shortageCents,
    forecast.cautiousShortageCents,
  );
  const neededBefore =
    [forecast.firstShortfall, forecast.cautiousFirstShortfall]
      .filter((d): d is string => d !== null)
      .sort()[0] ?? null;
  const candidates = tools.compareFundingAccounts(amountCents);
  const source = candidates.find((c) => c.eligible);
  const expectedArrival = tools.checkTransferTiming();
  const base: FundingPlan = {
    mode: 'deterministic-demo',
    status: 'blocked',
    reason: '',
    amountCents,
    sourceAccountId: null,
    destinationAccountId: forecast.accountId,
    expectedArrival,
    neededBefore,
    remainingSavingsCents: null,
    savingsMinimumCents: config.savingsMinimumCents,
    candidates,
    forecastStatus: forecast.status,
  };
  if (forecast.status === 'stale' || forecast.status === 'incomplete')
    return {
      ...base,
      reason:
        'Refresh or reconcile account data before preparing a funding proposal.',
    };
  if (amountCents === 0)
    return {
      ...base,
      status: 'no_shortfall',
      reason:
        'No shortage is projected for the detected bills, including the cautious estimate.',
    };
  if (!source)
    return {
      ...base,
      reason:
        'No eligible savings account can cover the full shortage while preserving your savings minimum.',
    };
  // Arrival on the bill date is too late: intraday charge ordering is unknown.
  if (!neededBefore || expectedArrival >= neededBefore)
    return {
      ...base,
      reason:
        'The estimated arrival is too late. Funding must arrive before the earliest projected shortage date.',
    };
  return {
    ...base,
    status: 'proposed',
    sourceAccountId: source.accountId,
    remainingSavingsCents: source.remainingCents,
    reason:
      'This proposal covers the cautious projected shortage and preserves your savings minimum. Arrival is an estimate; your bill is not yet covered.',
  };
}
