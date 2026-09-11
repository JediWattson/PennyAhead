import type {
  BankSnapshot,
  BillSuggestion,
  ForecastReport,
} from '../contracts.ts';
import { formatMoney } from '../money.ts';
import { buildForecast } from './forecast.ts';

/** A read-only option, with no provider timing assumptions or authorization. */
export function buildBillSuggestion(
  snapshot: BankSnapshot,
  forecast: ForecastReport,
): BillSuggestion {
  const checking = snapshot.accounts.find(
    (account) =>
      account.id === forecast.accountId && account.kind === 'checking',
  );
  const shortageCents = Math.max(
    0,
    forecast.shortageCents,
    forecast.cautiousShortageCents,
  );
  const neededBefore =
    [forecast.firstShortfall, forecast.cautiousFirstShortfall]
      .filter((date): date is string => date !== null)
      .sort()[0] ?? null;
  const base: BillSuggestion = {
    status: 'review',
    title: 'Review the account data first',
    explanation:
      'Refresh the account data and check uncertain or missing activity before choosing how to cover bills.',
    shortageCents,
    suggestedCents: 0,
    sourceAccountId: null,
    remainingSavingsCents: null,
    neededBefore,
  };
  if (
    !checking ||
    forecast.status === 'stale' ||
    forecast.status === 'incomplete'
  )
    return base;
  if (shortageCents === 0)
    return {
      ...base,
      status: 'covered',
      title: 'Keep the bill money in checking',
      explanation:
        'The detected bills fit within this checking balance, including the cautious estimate. No top-up is suggested for those bills. Leave room for everyday spending and other payments missing from the forecast.',
    };
  const sources = snapshot.accounts
    .filter(
      (account) =>
        account.kind === 'savings' &&
        account.ownerId === checking.ownerId &&
        account.currency === checking.currency,
    )
    .map((account) => {
      const sourceForecast = buildForecast(
        snapshot,
        account.id,
        forecast.evaluatedAt,
      );
      const available = Math.min(
        account.availableCents,
        sourceForecast.startingCents,
        ...sourceForecast.days.map((day) => day.cautiousBalanceCents),
      );
      return {
        account,
        available,
        valid:
          sourceForecast.status !== 'stale' &&
          sourceForecast.status !== 'incomplete' &&
          Number.isSafeInteger(available),
      };
    });
  const source = sources
    .filter((entry) => entry.valid && entry.available >= shortageCents)
    .sort(
      (a, b) =>
        b.available - a.available || a.account.id.localeCompare(b.account.id),
    )[0];
  if (!source)
    return {
      ...base,
      status: sources.some((entry) => !entry.valid)
        ? 'review'
        : 'other_options',
      title: sources.some((entry) => !entry.valid)
        ? 'Check savings before choosing a top-up'
        : 'Review other ways to cover the gap',
      explanation: `The cautious bill forecast shows a ${formatMoney(shortageCents)} gap${neededBefore ? ` starting ${neededBefore}` : ''}. ${sources.some((entry) => !entry.valid) ? 'Some savings data needs a refresh or reconciliation.' : 'No single eligible savings account has enough recorded funds to cover it after its detected commitments.'} Check the bill amounts, pause optional spending, or ask the biller about changing the payment date.`,
    };
  const remainingSavingsCents = source.available - shortageCents;
  return {
    ...base,
    status: 'consider_top_up',
    title: `Consider a ${formatMoney(shortageCents)} top-up`,
    explanation: `Moving ${formatMoney(shortageCents)} from ${source.account.name} to ${checking.name} could cover the cautious 14-day bill gap${neededBefore ? ` starting ${neededBefore}` : ''}. After this top-up and detected savings commitments, ${formatMoney(remainingSavingsCents)} would remain. Only consider this if that leaves enough for your emergency reserve and other savings commitments. Confirm with your bank that the money can be available before the shortfall; arrival timing has not been checked.`,
    suggestedCents: shortageCents,
    sourceAccountId: source.account.id,
    remainingSavingsCents,
  };
}

export function explainBillSuggestion(suggestion: BillSuggestion): string {
  return `${suggestion.title}. ${suggestion.explanation}\n\nThis is a suggestion based on the displayed test data. You decide whether to act in your bank app. No money has moved, and no bill has been paid.`;
}
