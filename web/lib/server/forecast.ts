import type {
  BankSnapshot,
  BillCorrection,
  DetectedBill,
  ForecastReport,
  Transaction,
} from '../contracts.ts';

const DAY = 86400000;
const isoDay = (value: string) => new Date(value).toISOString().slice(0, 10);
const merchantKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const monthIndex = (value: string) =>
  new Date(value).getUTCFullYear() * 12 + new Date(value).getUTCMonth();
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const money = (value: number) => {
  if (!Number.isSafeInteger(value))
    throw new Error('Money must be safe integer cents');
  return value;
};
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    isoDay(value) === value
  );
}
function nextMonthDate(last: string, day: number) {
  const date = new Date(last);
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0),
  );
  return isoDay(
    new Date(
      Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        Math.min(day, end.getUTCDate()),
      ),
    ).toISOString(),
  );
}

/** Provider IDs deduplicate records; a posted replacement removes only its own pending record. */
export function reconcileTransactions(
  transactions: Transaction[],
): Transaction[] {
  const unique = new Map<string, Transaction>();
  for (const txn of transactions) {
    money(txn.amountCents);
    if (!Number.isFinite(Date.parse(txn.date)))
      throw new Error('Invalid transaction date');
    const key = `${txn.accountId}\0${txn.id}`;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(txn))
      throw new Error('Conflicting transaction records');
    unique.set(key, txn);
  }
  const replaced = new Set(
    [...unique.values()]
      .filter((txn) => txn.status === 'posted' && txn.pendingTransactionId)
      .map((txn) => `${txn.accountId}\0${txn.pendingTransactionId}`),
  );
  return [...unique.values()].filter(
    (txn) =>
      txn.status !== 'pending' || !replaced.has(`${txn.accountId}\0${txn.id}`),
  );
}

/** Monthly candidates need one debit in each of three consecutive months. */
export function detectRecurring(snapshot: BankSnapshot): DetectedBill[] {
  const transactions = reconcileTransactions(snapshot.transactions);
  const groups = new Map<string, Transaction[]>();
  for (const txn of transactions) {
    if (
      txn.status !== 'posted' ||
      txn.amountCents >= 0 ||
      Date.parse(txn.date) > Date.parse(snapshot.asOf)
    )
      continue;
    const key = `${encodeURIComponent(txn.accountId)}:${encodeURIComponent(merchantKey(txn.merchant))}`;
    const group = groups.get(key) ?? [];
    group.push(txn);
    groups.set(key, group);
  }
  const bills: DetectedBill[] = [];
  for (const [id, records] of groups) {
    records.sort((a, b) => b.date.localeCompare(a.date));
    const recent = records.slice(0, 3);
    if (
      recent.length < 3 ||
      monthIndex(recent[0].date) - monthIndex(recent[1].date) !== 1 ||
      monthIndex(recent[1].date) - monthIndex(recent[2].date) !== 1
    )
      continue;
    // Multiple charges per month are ambiguous, not automatically a subscription.
    if (
      records.filter(
        (txn) => monthIndex(txn.date) >= monthIndex(recent[2].date),
      ).length !== 3
    )
      continue;
    const days = recent.map((txn) => new Date(txn.date).getUTCDate());
    if (Math.max(...days) - Math.min(...days) > 7) continue;
    const amounts = recent.map((txn) => -txn.amountCents);
    // Widely varying spending at one merchant is not a stable monthly bill.
    if (Math.max(...amounts) > Math.min(...amounts) * 1.25) continue;
    const endOfMonth = recent.every((txn) => {
      const date = new Date(txn.date);
      return (
        date.getUTCDate() ===
        new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
        ).getUTCDate()
      );
    });
    const nextDate = nextMonthDate(
      recent[0].date,
      endOfMonth ? 31 : median(days),
    );
    const earliestDate = nextMonthDate(
      recent[0].date,
      endOfMonth ? 31 : Math.min(...days),
    );
    const latestDate = nextMonthDate(
      recent[0].date,
      endOfMonth ? 31 : Math.max(...days),
    );
    const pending = transactions.find(
      (txn) =>
        txn.status === 'pending' &&
        txn.accountId === recent[0].accountId &&
        merchantKey(txn.merchant) === merchantKey(recent[0].merchant) &&
        txn.amountCents < 0 &&
        Math.abs(Date.parse(isoDay(txn.date)) - Date.parse(nextDate)) <=
          5 * DAY &&
        Math.abs(-txn.amountCents - median(amounts)) <=
          Math.max(100, median(amounts) * 0.1),
    );
    bills.push({
      id,
      accountId: recent[0].accountId,
      merchant: recent[0].merchant,
      amountCents: median(amounts),
      maximumCents: Math.max(...amounts),
      nextDate,
      earliestDate,
      latestDate,
      evidenceIds: recent.map((txn) => txn.id),
      uncertain:
        earliestDate !== latestDate ||
        Math.min(...amounts) !== Math.max(...amounts),
      corrected: false,
      enabled: true,
      overdue: false,
      pendingTransactionId: pending?.id ?? null,
    });
  }
  return bills.sort(
    (a, b) => a.nextDate.localeCompare(b.nextDate) || a.id.localeCompare(b.id),
  );
}

export function buildForecast(
  snapshot: BankSnapshot,
  accountId: string,
  evaluatedAt: string,
  corrections: BillCorrection[] = [],
): ForecastReport {
  const account = snapshot.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error('Unknown forecast account');
  money(account.availableCents);
  money(account.currentCents);
  const now = Date.parse(evaluatedAt);
  const observations = [
    Date.parse(snapshot.asOf),
    Date.parse(account.observedAt),
  ];
  if (
    !Number.isFinite(now) ||
    observations.some((value) => !Number.isFinite(value))
  )
    throw new Error('Invalid observation time');
  const today = isoDay(evaluatedAt);
  const transactions = reconcileTransactions(snapshot.transactions).filter(
    (txn) => txn.accountId === accountId,
  );
  const bills = detectRecurring(snapshot).filter(
    (bill) => bill.accountId === accountId,
  );
  const applied = new Set<string>();
  for (const correction of corrections) {
    const bill = bills.find((entry) => entry.id === correction.billId);
    if (!bill || applied.has(bill.id))
      throw new Error('Unknown or duplicate bill correction');
    if (
      !Number.isSafeInteger(correction.amountCents) ||
      correction.amountCents <= 0 ||
      correction.amountCents > 100000000 ||
      !validDate(correction.nextDate) ||
      typeof correction.enabled !== 'boolean' ||
      Math.abs(Date.parse(correction.nextDate) - Date.parse(today)) > 62 * DAY
    )
      throw new Error('Invalid bill correction');
    applied.add(bill.id);
    Object.assign(bill, {
      amountCents: correction.amountCents,
      maximumCents: correction.amountCents,
      nextDate: correction.nextDate,
      earliestDate: correction.nextDate,
      latestDate: correction.nextDate,
      enabled: correction.enabled,
      uncertain: false,
      corrected: true,
    });
  }
  const warnings: string[] = [];
  let incomplete = observations.some((value) => value > now);
  if (incomplete)
    warnings.push(
      'The data timestamp is in the future; verify it before relying on this forecast.',
    );
  let startingCents = account.availableCents;
  for (const txn of transactions.filter(
    (entry) => entry.status === 'pending',
  )) {
    if (
      !txn.availableBalanceEffect ||
      txn.availableBalanceEffect === 'unknown'
    ) {
      incomplete = true;
      warnings.push(
        `The balance treatment for pending ${txn.merchant} is unknown. Refresh or reconcile it before using this forecast.`,
      );
      continue;
    }
    if (txn.amountCents < 0 && txn.availableBalanceEffect === 'excluded')
      startingCents = money(startingCents + txn.amountCents);
    if (txn.amountCents > 0 && txn.availableBalanceEffect === 'included')
      startingCents = money(startingCents - txn.amountCents);
    if (txn.amountCents > 0)
      warnings.push(
        `Pending ${txn.merchant} income is not treated as money received.`,
      );
  }
  for (const bill of bills) {
    bill.overdue =
      bill.latestDate < today && !bill.pendingTransactionId && bill.enabled;
    if (bill.overdue) {
      incomplete = true;
      warnings.push(
        `${bill.merchant} appears overdue with no matching payment. Its estimated charge is reserved today; verify whether it was paid or canceled.`,
      );
    }
  }
  let balance = startingCents;
  let cautious = startingCents;
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = isoDay(
      new Date(Date.parse(today) + index * DAY).toISOString(),
    );
    const due = bills.filter(
      (bill) =>
        bill.enabled &&
        !bill.pendingTransactionId &&
        (bill.nextDate < today ? today : bill.nextDate) === date,
    );
    const earliest = bills.filter(
      (bill) =>
        bill.enabled &&
        !bill.pendingTransactionId &&
        (bill.earliestDate < today ? today : bill.earliestDate) === date,
    );
    for (const bill of due) balance = money(balance - bill.amountCents);
    for (const bill of earliest) cautious = money(cautious - bill.maximumCents);
    return {
      date,
      balanceCents: balance,
      cautiousBalanceCents: cautious,
      billIds: due.map((bill) => bill.id),
    };
  });
  const minimumCents = Math.min(
    startingCents,
    ...days.map((day) => day.balanceCents),
  );
  const cautiousMinimum = Math.min(
    startingCents,
    ...days.map((day) => day.cautiousBalanceCents),
  );
  const ageHours = Math.max(0, (now - Math.min(...observations)) / 3600000);
  if (ageHours > 24)
    warnings.push(
      `Account data is ${Math.floor(ageHours)} hours old. Refresh it before acting; this is a projection of the old snapshot.`,
    );
  if (bills.some((bill) => bill.enabled && bill.uncertain))
    warnings.push(
      'Some payment dates or amounts vary. The cautious estimate uses earlier dates and higher observed amounts.',
    );
  const status =
    ageHours > 24
      ? 'stale'
      : incomplete
        ? 'incomplete'
        : minimumCents < 0
          ? 'shortfall'
          : cautiousMinimum < 0 ||
              bills.some((bill) => bill.enabled && bill.uncertain)
            ? 'watch'
            : 'sufficient';
  return {
    accountId,
    evaluatedAt,
    observedAt: new Date(Math.min(...observations)).toISOString(),
    ageHours,
    status,
    startingCents,
    endingCents: balance,
    minimumCents,
    shortageCents: Math.max(0, -minimumCents),
    firstShortfall: days.find((day) => day.balanceCents < 0)?.date ?? null,
    cautiousShortageCents: Math.max(0, -cautiousMinimum),
    cautiousFirstShortfall:
      days.find((day) => day.cautiousBalanceCents < 0)?.date ?? null,
    scheduledCents: money(startingCents - balance),
    bills: bills.sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
    days,
    warnings,
  };
}
