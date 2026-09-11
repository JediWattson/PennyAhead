import { formatMoney } from '../money.ts';
import type { GrowthPlan } from '../growth-contracts.ts';

export function growthPlanEvidence(plan: GrowthPlan) {
  const { income, expectedCashFlowCents, keepInCheckingCents, ...currentPlan } =
    plan;
  return {
    currentCashPlan: {
      basis:
        'Already available cash only. No future income is included in these suggested contributions.',
      ...currentPlan,
      unallocatedAfterReservesCents: keepInCheckingCents,
      checkingAfterSuggestedContributionsCents:
        plan.checkingAvailableCents -
        plan.hysaSuggestedCents -
        plan.rothSuggestedCents,
    },
    futureIncomeOutlook: {
      basis:
        'Unreceived estimates only, including any forecast deposit dated today. Recalculate the plan after deposits actually arrive.',
      income,
      expectedCashFlowCents,
    },
  };
}

/** Keep integer cents in the application; give the model unambiguous USD strings. */
export function assistantEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(assistantEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key.endsWith('Cents')) {
        return [
          key.slice(0, -5) + 'Usd',
          typeof entry === 'number' ? formatMoney(entry) : entry,
        ];
      }
      return [key, assistantEvidence(entry)];
    }),
  );
}
