import type {
  BankSnapshot,
  DemoForecast,
  MonitorState,
  SessionTransfer,
} from '../contracts.ts';
import { FixtureBankProvider, DEMO_NOW, DEMO_OWNER_ID } from './fixtures.ts';
import { buildForecast } from './forecast.ts';

/** A session-only synthetic ledger. Provider observations must reconcile independently. */
export function applySessionTransfers(
  snapshot: BankSnapshot,
  transfers: SessionTransfer[],
  generation: number,
): BankSnapshot {
  const result = structuredClone(snapshot);
  for (const transfer of transfers.filter(
    (t) =>
      t.generation === generation &&
      t.environment === 'local_simulation' &&
      t.status !== 'failed',
  )) {
    const approved = transfer.approvedTransfer;
    const source = result.accounts.find(
      (a) =>
        a.id === approved.sourceAccountId && a.ownerId === approved.ownerId,
    );
    const destination = result.accounts.find(
      (a) =>
        a.id === approved.destinationAccountId &&
        a.ownerId === approved.ownerId,
    );
    if (!source || !destination || source.id === destination.id)
      throw new Error('Invalid transfer ownership');
    source.availableCents -= approved.amountCents;
    if (transfer.status === 'completed') {
      source.currentCents -= approved.amountCents;
      destination.currentCents += approved.amountCents;
      destination.availableCents += approved.amountCents;
    }
    result.transactions.unshift(
      {
        id: `${transfer.id}-debit`,
        accountId: source.id,
        merchant: 'PennyAhead simulated transfer',
        amountCents: -approved.amountCents,
        date: DEMO_NOW,
        status: transfer.status === 'completed' ? 'posted' : 'pending',
        availableBalanceEffect: 'included',
      },
      {
        id: `${transfer.id}-credit`,
        accountId: destination.id,
        merchant: 'PennyAhead simulated transfer',
        amountCents: approved.amountCents,
        date: DEMO_NOW,
        status: transfer.status === 'completed' ? 'posted' : 'pending',
        availableBalanceEffect: 'excluded',
      },
    );
  }
  if (
    result.accounts.some(
      (a) =>
        !Number.isSafeInteger(a.availableCents) ||
        !Number.isSafeInteger(a.currentCents),
    )
  )
    throw new Error('Invalid ledger money');
  return result;
}
export async function getSessionDemo(
  state: MonitorState,
): Promise<DemoForecast> {
  const snapshot = applySessionTransfers(
    await new FixtureBankProvider(state.config.scenario).getSnapshot(
      DEMO_OWNER_ID,
    ),
    state.transfers,
    state.generation,
  );
  const checking = snapshot.accounts.find((a) => a.kind === 'checking')!;
  return {
    scenario: state.config.scenario,
    corrections: state.config.corrections,
    clock: 'fixed-demo',
    snapshot,
    forecast: buildForecast(
      snapshot,
      checking.id,
      DEMO_NOW,
      state.config.corrections,
    ),
  };
}
