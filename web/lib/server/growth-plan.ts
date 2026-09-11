import { z } from 'zod';
import type { DemoForecast } from '../contracts.ts';
import type {
  GrowthInputs,
  GrowthPlan,
  RothRoom,
} from '../growth-contracts.ts';
import { formatMoney } from '../money.ts';
import { buildForecast } from './forecast.ts';
import { estimateBudget } from './budget-estimate.ts';
import { explainIncome } from './income.ts';

const money = z.number().int().min(0).max(100000000);
const schema = z
  .object({
    budgetMode: z.enum(['estimated', 'manual']).optional(),
    spendingCents: money,
    extraCommitmentsCents: money,
    checkingBufferCents: money,
    emergencyTargetCents: money,
    earmarkedSavingsCents: money,
    budgetReviewed: z.boolean(),
    retirementPrioritiesReviewed: z.boolean(),
    hysaApyBasisPoints: z.number().int().min(0).max(1500),
    rothGoalCents: money,
    roth: z
      .object({
        taxYear: z.literal(2026),
        age: z.number().int().min(18).max(120),
        filingStatus: z.enum([
          'single',
          'head_of_household',
          'joint',
          'surviving_spouse',
          'separate',
          'unknown',
        ]),
        compensationCents: money,
        modifiedAgiCents: money,
        traditionalContributionsCents: money,
        rothContributionsCents: money,
        detailsReviewed: z.boolean(),
      })
      .strict(),
  })
  .strict();

export function parseGrowthInputs(value: unknown): GrowthInputs {
  return schema.parse(value);
}

/** 2026 regular direct contributions only. Phase-outs and special cases require review. */
export function calculateRothRoom(input: GrowthInputs['roth']): RothRoom {
  const review = (reason: string): RothRoom => ({
    status: 'review',
    annualLimitCents: null,
    remainingCents: null,
    reason,
  });
  if (
    !input.detailsReviewed ||
    input.taxYear !== 2026 ||
    input.filingStatus === 'unknown'
  )
    return review(
      'Confirm the tax year, income, filing status and contributions across all your IRAs before planning a Roth contribution.',
    );
  if (input.filingStatus === 'separate')
    return review(
      'Married filing separately requires additional eligibility checks. No Roth amount is suggested.',
    );
  if (input.compensationCents === 0)
    return review(
      'Eligible compensation is not established. Spousal IRA eligibility and other special cases need separate review.',
    );
  const joint = ['joint', 'surviving_spouse'].includes(input.filingStatus);
  const phaseStart = joint ? 24200000 : 15300000;
  const phaseEnd = joint ? 25200000 : 16800000;
  if (input.modifiedAgiCents >= phaseEnd)
    return {
      status: 'unavailable',
      annualLimitCents: null,
      remainingCents: 0,
      reason:
        'The entered income is above the 2026 direct Roth contribution range. No direct Roth contribution is suggested.',
    };
  if (input.modifiedAgiCents >= phaseStart)
    return review(
      'The entered income is in the 2026 Roth phase-out range. Confirm your reduced limit before contributing.',
    );
  const annualLimitCents = Math.min(
    input.age >= 50 ? 860000 : 750000,
    input.compensationCents,
  );
  const contributed =
    input.traditionalContributionsCents + input.rothContributionsCents;
  if (contributed > annualLimitCents)
    return review(
      'Reported IRA contributions exceed the modeled combined limit. Review those contributions before adding more.',
    );
  const remainingCents = annualLimitCents - contributed;
  return {
    status: remainingCents ? 'eligible' : 'unavailable',
    annualLimitCents,
    remainingCents,
    reason: remainingCents
      ? `${formatMoney(remainingCents)} of estimated 2026 IRA room remains based on the entered profile and contributions across traditional and Roth IRAs.`
      : 'The entered contributions have used all modeled 2026 IRA contribution room.',
  };
}

export function buildGrowthPlan(
  demo: DemoForecast,
  raw: GrowthInputs,
  savingsMinimumCents: number,
): GrowthPlan {
  const entered = parseGrowthInputs(raw);
  const budgetEstimate =
    entered.budgetMode === 'estimated' ? estimateBudget(demo) : undefined;
  const inputs = budgetEstimate
    ? {
        ...entered,
        spendingCents: budgetEstimate.spendingCents,
        checkingBufferCents: budgetEstimate.checkingBufferCents,
        emergencyTargetCents: budgetEstimate.emergencyTargetCents,
      }
    : entered;
  if (
    !Number.isSafeInteger(savingsMinimumCents) ||
    savingsMinimumCents < 0 ||
    savingsMinimumCents > 100000000
  )
    throw new Error('Invalid savings floor');
  const checking = demo.snapshot.accounts.find(
    (a) => a.id === demo.forecast.accountId && a.kind === 'checking',
  );
  const savings = demo.snapshot.accounts.filter(
    (a) => a.kind === 'savings' && a.ownerId === checking?.ownerId,
  );
  if (
    !checking ||
    demo.snapshot.accounts.some(
      (a) => !Number.isSafeInteger(a.availableCents) || a.currency !== 'USD',
    )
  )
    throw new Error('Incomplete accounts');
  const blockers: string[] = [];
  if (!savings.length)
    blockers.push(
      'No savings account is available to verify the cash reserve. Review your savings before allocating money to goals.',
    );
  if (budgetEstimate && !budgetEstimate.usable)
    blockers.push(
      'There is less than 30 days of usable spending history. Add history or enter your own budget to build a starting plan.',
    );
  if (!budgetEstimate && !inputs.budgetReviewed)
    blockers.push(
      'Review all spending, minimum debt payments and other commitments for the next 30 days. The 14-day bill forecast alone cannot establish surplus.',
    );
  if (['stale', 'incomplete'].includes(demo.forecast.status))
    blockers.push(
      'Refresh or reconcile checking data before allocating money to goals.',
    );
  const savingForecasts = savings.map((account) =>
    buildForecast(demo.snapshot, account.id, demo.forecast.evaluatedAt),
  );
  if (
    savingForecasts.some((forecast) =>
      ['stale', 'incomplete'].includes(forecast.status),
    )
  )
    blockers.push(
      'Refresh or reconcile savings data before counting it toward your cash reserve.',
    );
  // The forecast starting balance already reserves unresolved pending debits. Never add pending income.
  const checkingAvailableCents = Math.min(
    checking.availableCents,
    demo.forecast.startingCents,
  );
  const cautiousMinimum = Math.min(
    demo.forecast.startingCents,
    ...demo.forecast.days.map((day) => day.cautiousBalanceCents),
  );
  const detectedCommitments = Math.max(
    0,
    demo.forecast.startingCents - cautiousMinimum,
  );
  // The declared 30-day spending includes detected bills; max avoids counting those bills twice.
  const spendingReserveCents = Math.max(
    inputs.spendingCents + inputs.extraCommitmentsCents,
    detectedCommitments,
  );
  const protectedChecking = spendingReserveCents + inputs.checkingBufferCents;
  const rawSurplus = checkingAvailableCents - protectedChecking;
  const availableForGoalsCents = blockers.length ? 0 : Math.max(0, rawSurplus);
  const existingReserveCents = Math.max(
    0,
    savingForecasts.reduce(
      (total, forecast) =>
        total +
        Math.min(
          forecast.startingCents,
          ...forecast.days.map((day) => day.cautiousBalanceCents),
        ),
      0,
    ) - inputs.earmarkedSavingsCents,
  );
  const emergencyTargetCents = Math.max(
    inputs.emergencyTargetCents,
    savingsMinimumCents,
  );
  const emergencyGapCents = Math.max(
    0,
    emergencyTargetCents - existingReserveCents,
  );
  const hysaSuggestedCents = Math.min(
    availableForGoalsCents,
    emergencyGapCents,
  );
  const roth = calculateRothRoom(inputs.roth);
  const rothSuggestedCents =
    inputs.retirementPrioritiesReviewed && roth.status === 'eligible'
      ? Math.min(
          availableForGoalsCents - hysaSuggestedCents,
          inputs.rothGoalCents,
          roth.remainingCents!,
        )
      : 0;
  const keepInCheckingCents =
    availableForGoalsCents - hysaSuggestedCents - rothSuggestedCents;
  const reasons = [
    `Keep ${formatMoney(spendingReserveCents)} for the next 30 days and ${formatMoney(inputs.checkingBufferCents)} as your checking buffer. Future paychecks are not counted in today's allocation.`,
    emergencyGapCents > 0
      ? `Your cash reserve is ${formatMoney(emergencyGapCents)} below your ${formatMoney(emergencyTargetCents)} target. This plan fills that gap before allocating to retirement.`
      : `Your ${budgetEstimate ? 'suggested' : 'entered'} cash-reserve target is covered by unearmarked savings in this snapshot.`,
    roth.reason,
  ];
  const income = demo.forecast.income;
  if (income?.streams.length)
    reasons.push(
      `${explainIncome(income)} Expected 30-day income minus ${formatMoney(spendingReserveCents)} of planned spending is ${formatMoney(income.expected30DaysCents - spendingReserveCents)}. This is a cash-flow outlook, not additional money available today. Revisit contributions after pay arrives.`,
    );
  if (demo.sampleRothProfile)
    reasons.push(
      'This demo starts with an illustrative Roth profile for Alex. The income, filing status and IRA contributions are sample inputs, not inferred from Plaid. Edited values, if any, are used for this calculation.',
    );
  if (budgetEstimate)
    reasons.push(
      `The starting budget uses ${budgetEstimate.transactionCount} posted checking outflows over ${budgetEstimate.historyDays} days. It takes the largest of the last 30 days (${formatMoney(budgetEstimate.recentOutflowsCents)}), the history scaled to 30 days (${formatMoney(budgetEstimate.monthlyAverageCents)}), and cautious upcoming monthly bills (${formatMoney(budgetEstimate.upcomingBillsCents)}), without adding them together. Transfers, debt payments and one-off purchases remain included; credits do not offset spending. The suggested buffer is seven days of estimated spending and the cash-reserve target is three months. These are adjustable starting points. Spending outside this account and savings earmarked elsewhere may be missing.`,
    );
  if (!inputs.retirementPrioritiesReviewed)
    reasons.push(
      'Review debt commitments and any workplace retirement match before allocating to a Roth IRA. Roth planning is paused.',
    );
  if (rawSurplus <= 0)
    reasons.unshift(
      'Keep cash available for spending and your buffer before adding to savings or retirement.',
    );
  return {
    ...(income?.streams.length
      ? {
          income,
          expectedCashFlowCents:
            income.expected30DaysCents - spendingReserveCents,
        }
      : {}),
    ...(budgetEstimate ? { budgetEstimate } : {}),
    status: blockers.length
      ? 'needs_review'
      : rawSurplus <= 0
        ? 'cash_first'
        : 'ready',
    source: demo.snapshot.source,
    asOf: demo.snapshot.asOf,
    horizonDays: 30,
    checkingAvailableCents,
    spendingReserveCents,
    checkingBufferCents: inputs.checkingBufferCents,
    availableForGoalsCents,
    cashGapCents: Math.max(0, -rawSurplus),
    existingReserveCents,
    emergencyTargetCents,
    emergencyGapCents,
    hysaSuggestedCents,
    rothSuggestedCents,
    keepInCheckingCents,
    hypotheticalAnnualInterestCents: Math.floor(
      (hysaSuggestedCents * inputs.hysaApyBasisPoints) / 10000,
    ),
    hysaApyBasisPoints: inputs.hysaApyBasisPoints,
    roth,
    reasons,
    blockers,
  };
}

export function explainGrowthPlan(plan: GrowthPlan): string {
  const source =
    plan.source === 'plaid_sandbox'
      ? `Plaid Sandbox test balances and ${plan.budgetEstimate ? 'transaction-based estimates' : 'entered assumptions'}`
      : 'synthetic data';
  if (plan.status === 'needs_review')
    return `The savings and retirement plan needs more information. ${plan.blockers.join(' ')} No allocation is suggested. This preview uses ${source}; no money was moved.`;
  if (plan.status === 'cash_first')
    return `Keep cash available first: checking is ${formatMoney(plan.cashGapCents)} below the ${plan.budgetEstimate ? 'estimated' : 'entered'} spending reserve and buffer. Suggested new savings and Roth contributions are $0.00. ${plan.reasons.join(' ')} This preview uses ${source}; no money was moved.`;
  return `Based on ${plan.budgetEstimate ? 'the transaction history and suggested reserves' : 'the entered demo assumptions'}, ${formatMoney(plan.availableForGoalsCents)} is ${plan.budgetEstimate ? 'potentially ' : ''}available for goals after spending and the checking buffer. This plan suggests ${formatMoney(plan.hysaSuggestedCents)} toward high-yield savings and ${formatMoney(plan.rothSuggestedCents)} toward a Roth IRA, leaving ${formatMoney(plan.keepInCheckingCents)} unallocated in checking.\n\n${plan.reasons.join(' ')}\n\nThis is a one-time planning preview using ${source}. No account was opened, investment selected, or contribution made.`;
}
