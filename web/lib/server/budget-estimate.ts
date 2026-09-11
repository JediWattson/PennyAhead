import type { DemoForecast } from '../contracts.ts';
import type { BudgetEstimate } from '../growth-contracts.ts';
import { reconcileTransactions } from './forecast.ts';

const DAY = 86400000;
const day = (value: string) => Math.floor(Date.parse(value) / DAY);

/** A starting cash-outflow estimate, never a claim that all household spending is known. */
export function estimateBudget(demo: DemoForecast): BudgetEstimate {
  const today = day(demo.snapshot.asOf);
  const posted = reconcileTransactions(demo.snapshot.transactions).filter(
    (txn) =>
      txn.accountId === demo.forecast.accountId &&
      txn.status === 'posted' &&
      Date.parse(txn.date) <= Date.parse(demo.snapshot.asOf),
  );
  const historyDays = posted.length
    ? Math.min(90, today - Math.min(...posted.map((txn) => day(txn.date))) + 1)
    : 0;
  const debits = posted.filter(
    (txn) => txn.amountCents < 0 && day(txn.date) > today - historyDays,
  );
  const recentOutflowsCents = debits.reduce(
    (total, txn) => total + (day(txn.date) > today - 30 ? -txn.amountCents : 0),
    0,
  );
  const monthlyAverageCents = historyDays
    ? Math.ceil(
        (debits.reduce((total, txn) => total - txn.amountCents, 0) * 30) /
          historyDays,
      )
    : 0;
  const upcomingBillsCents = demo.forecast.bills.reduce(
    (total, bill) =>
      total +
      (bill.enabled &&
      !bill.pendingTransactionId &&
      day(bill.earliestDate) < today + 30
        ? bill.maximumCents
        : 0),
    0,
  );
  const spendingCents = Math.max(
    recentOutflowsCents,
    monthlyAverageCents,
    upcomingBillsCents,
  );
  // These are editable product defaults, not inferred user preferences.
  const checkingBufferCents = Math.ceil((spendingCents * 7) / 30);
  const emergencyTargetCents = spendingCents * 3;
  return {
    historyDays,
    transactionCount: debits.length,
    recentOutflowsCents,
    monthlyAverageCents,
    upcomingBillsCents,
    spendingCents,
    checkingBufferCents,
    emergencyTargetCents,
    usable: historyDays >= 30 && debits.length > 0,
  };
}
