export interface GrowthInputs {
  /** All bills, living costs and minimum debt payments for the next 30 days. */
  spendingCents: number;
  extraCommitmentsCents: number;
  checkingBufferCents: number;
  emergencyTargetCents: number;
  earmarkedSavingsCents: number;
  budgetReviewed: boolean;
  retirementPrioritiesReviewed: boolean;
  hysaApyBasisPoints: number;
  rothGoalCents: number;
  roth: {
    taxYear: 2026;
    age: number;
    filingStatus:
      | 'single'
      | 'head_of_household'
      | 'joint'
      | 'surviving_spouse'
      | 'separate'
      | 'unknown';
    compensationCents: number;
    modifiedAgiCents: number;
    traditionalContributionsCents: number;
    rothContributionsCents: number;
    detailsReviewed: boolean;
  };
}

export interface RothRoom {
  status: 'eligible' | 'review' | 'unavailable';
  annualLimitCents: number | null;
  remainingCents: number | null;
  reason: string;
}

export interface GrowthPlan {
  status: 'ready' | 'cash_first' | 'needs_review';
  source: 'synthetic';
  asOf: string;
  horizonDays: 30;
  checkingAvailableCents: number;
  spendingReserveCents: number;
  checkingBufferCents: number;
  availableForGoalsCents: number;
  cashGapCents: number;
  existingReserveCents: number;
  emergencyTargetCents: number;
  emergencyGapCents: number;
  hysaSuggestedCents: number;
  rothSuggestedCents: number;
  keepInCheckingCents: number;
  hypotheticalAnnualInterestCents: number;
  hysaApyBasisPoints: number;
  roth: RothRoom;
  reasons: string[];
  blockers: string[];
}

/** Public illustrative inputs for Alex, never inferred from the user's finances. */
export const DEMO_GROWTH_INPUTS: GrowthInputs = {
  spendingCents: 270000,
  extraCommitmentsCents: 0,
  checkingBufferCents: 30000,
  emergencyTargetCents: 200000,
  earmarkedSavingsCents: 0,
  budgetReviewed: true,
  retirementPrioritiesReviewed: true,
  hysaApyBasisPoints: 400,
  rothGoalCents: 25000,
  roth: {
    taxYear: 2026,
    age: 30,
    filingStatus: 'single',
    compensationCents: 6000000,
    modifiedAgiCents: 6000000,
    traditionalContributionsCents: 0,
    rothContributionsCents: 250000,
    detailsReviewed: true,
  },
};
