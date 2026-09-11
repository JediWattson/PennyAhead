import type { InvestmentPlan } from './investment-contracts.ts';

/** Browser-only practice ledger. It has no provider, persistence or execution hooks. */
export interface RothSimulation {
  stage:
    | 'not_started'
    | 'account_ready'
    | 'contribution_review'
    | 'contribution_pending'
    | 'contribution_failed'
    | 'cash_ready'
    | 'order_review'
    | 'orders_pending'
    | 'rejected'
    | 'filled';
  amountCents: number;
  allocations: Array<{ ticker: string; amountCents: number }>;
  contributedCents: number;
  cashCents: number;
  reservedCents: number;
  investedCents: number;
  contributionAttempt: number;
  orderAttempt: number;
  activity: Array<{ id: string; message: string }>;
}

export type RothSimulationAction =
  | 'create_account'
  | 'review_contribution'
  | 'confirm_contribution'
  | 'settle_contribution'
  | 'fail_contribution'
  | 'review_orders'
  | 'confirm_orders'
  | 'fill_orders'
  | 'reject_orders'
  | 'cancel_review';

export function prepareRothSimulation(
  plan: InvestmentPlan,
): RothSimulation | null {
  const allocations = plan.allocations.map((a) => ({
    ticker: a.exampleTicker,
    amountCents: a.amountCents,
  }));
  if (
    plan.status !== 'preview' ||
    !Number.isSafeInteger(plan.amountCents) ||
    plan.amountCents <= 0 ||
    plan.amountCents > 100000000 ||
    allocations.length === 0 ||
    new Set(allocations.map((a) => a.ticker)).size !== allocations.length ||
    allocations.some(
      (a) =>
        !a.ticker || !Number.isSafeInteger(a.amountCents) || a.amountCents < 0,
    ) ||
    allocations.reduce((sum, a) => sum + a.amountCents, 0) !== plan.amountCents
  )
    return null;
  return {
    stage: 'not_started',
    amountCents: plan.amountCents,
    allocations: allocations.filter((a) => a.amountCents > 0),
    contributedCents: 0,
    cashCents: 0,
    reservedCents: 0,
    investedCents: 0,
    contributionAttempt: 0,
    orderAttempt: 0,
    activity: [],
  };
}

export function advanceRothSimulation(
  state: RothSimulation,
  action: RothSimulationAction,
): RothSimulation {
  const event = (message: string) => [
    ...state.activity,
    {
      id: `practice-${state.activity.length + 1}`,
      message,
    },
  ];
  switch (action) {
    case 'create_account':
      if (state.stage !== 'not_started') return state;
      return {
        ...state,
        stage: 'account_ready',
        activity: event('Practice Roth created with a zero balance.'),
      };
    case 'review_contribution':
      if (!['account_ready', 'contribution_failed'].includes(state.stage))
        return state;
      return { ...state, stage: 'contribution_review' };
    case 'confirm_contribution': {
      if (state.stage !== 'contribution_review') return state;
      const attempt = state.contributionAttempt + 1;
      return {
        ...state,
        stage: 'contribution_pending',
        contributionAttempt: attempt,
        activity: event(
          `Test contribution C${attempt} pending. Cash is not available to invest.`,
        ),
      };
    }
    case 'settle_contribution':
      if (
        state.stage !== 'contribution_pending' ||
        state.contributedCents !== 0
      )
        return state;
      return {
        ...state,
        stage: 'cash_ready',
        contributedCents: state.amountCents,
        cashCents: state.amountCents,
        activity: event(
          `Test contribution C${state.contributionAttempt} settled in the practice Roth.`,
        ),
      };
    case 'fail_contribution':
      if (state.stage !== 'contribution_pending') return state;
      return {
        ...state,
        stage: 'contribution_failed',
        activity: event(
          `Test contribution C${state.contributionAttempt} failed. No cash was added.`,
        ),
      };
    case 'review_orders':
      if (
        !['cash_ready', 'rejected'].includes(state.stage) ||
        state.cashCents < state.amountCents
      )
        return state;
      return { ...state, stage: 'order_review' };
    case 'confirm_orders': {
      if (state.stage !== 'order_review' || state.cashCents < state.amountCents)
        return state;
      const attempt = state.orderAttempt + 1;
      return {
        ...state,
        stage: 'orders_pending',
        orderAttempt: attempt,
        cashCents: state.cashCents - state.amountCents,
        reservedCents: state.amountCents,
        activity: event(
          `Test purchase batch O${attempt} pending. Test cash is reserved.`,
        ),
      };
    }
    case 'fill_orders':
      if (state.stage !== 'orders_pending') return state;
      return {
        ...state,
        stage: 'filled',
        reservedCents: 0,
        investedCents: state.investedCents + state.reservedCents,
        activity: event(
          `Test purchase batch O${state.orderAttempt} filled. This is not another IRA contribution.`,
        ),
      };
    case 'reject_orders':
      if (state.stage !== 'orders_pending') return state;
      return {
        ...state,
        stage: 'rejected',
        reservedCents: 0,
        cashCents: state.cashCents + state.reservedCents,
        activity: event(
          `Test purchase batch O${state.orderAttempt} rejected. Reserved cash is available again.`,
        ),
      };
    case 'cancel_review':
      if (state.stage === 'contribution_review')
        return { ...state, stage: 'account_ready' };
      if (state.stage === 'order_review')
        return { ...state, stage: 'cash_ready' };
      return state;
  }
}
