import type {
  ApprovalInput,
  BankSnapshot,
  FundingPlan,
  MonitorState,
  TransferRecord,
} from '../contracts.ts';
import { buildFundingPlan } from './funding.ts';
import { DEMO_NOW, DEMO_OWNER_ID } from './fixtures.ts';

export const MAX_TRANSFER_CENTS = 50000;
export function transferEnvironment(): TransferRecord['environment'] {
  const value = process.env.PENNYAHEAD_TRANSFER_PROVIDER ?? 'local_simulation';
  if (value !== 'local_simulation')
    throw new Error(
      'Dwolla sandbox access is not configured; only local simulation is available',
    );
  return value;
}
export function parseApproval(input: unknown): ApprovalInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid approval');
  const body = input as Record<string, unknown>;
  if (
    typeof body.proposalId !== 'string' ||
    body.proposalId.length > 100 ||
    !Number.isSafeInteger(body.revision) ||
    typeof body.revision !== 'number' ||
    body.revision < 0 ||
    typeof body.amountCents !== 'number' ||
    !Number.isSafeInteger(body.amountCents) ||
    body.amountCents < 1 ||
    body.amountCents > MAX_TRANSFER_CENTS ||
    typeof body.sourceAccountId !== 'string' ||
    typeof body.destinationAccountId !== 'string' ||
    body.sourceAccountId === body.destinationAccountId
  )
    throw new Error(
      'Approval must bind the exact proposal, accounts and amount, up to $500',
    );
  return {
    proposalId: body.proposalId,
    revision: body.revision,
    amountCents: body.amountCents,
    sourceAccountId: body.sourceAccountId,
    destinationAccountId: body.destinationAccountId,
  };
}
export function constrainSessionPlan(
  state: MonitorState,
  plan: FundingPlan,
): FundingPlan {
  if (
    state.transfers.some(
      (t) => t.generation === state.generation && t.status === 'pending',
    )
  )
    return {
      ...plan,
      status: 'pending_funding',
      sourceAccountId: null,
      remainingSavingsCents: null,
      reason:
        'A transfer is pending. Checking has not received that money, and another transfer will not be proposed until its status is resolved.',
    };
  if (plan.amountCents > MAX_TRANSFER_CENTS)
    return {
      ...plan,
      status: 'blocked',
      sourceAccountId: null,
      remainingSavingsCents: null,
      reason: 'The projected shortage exceeds this demo’s $500 transfer limit.',
    };
  return plan;
}
export function buildSessionPlan(
  state: MonitorState,
  snapshot: BankSnapshot,
): FundingPlan {
  const config = {
    ...state.config,
    savingsMinimumCents: Math.max(
      state.config.savingsMinimumCents,
      state.rule?.enabled ? state.rule.savingsMinimumCents : 0,
    ),
  };
  return constrainSessionPlan(
    state,
    buildFundingPlan(DEMO_OWNER_ID, snapshot, config, DEMO_NOW),
  );
}
