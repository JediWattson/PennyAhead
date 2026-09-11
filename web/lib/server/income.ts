import type { IncomeOutlook, IncomeStream, Transaction } from '../contracts.ts';
import { formatMoney } from '../money.ts';

const DAY = 86400000;
const day = (date: string) => Math.floor(Date.parse(date) / DAY);
const iso = (date: number) => new Date(date * DAY).toISOString().slice(0, 10);
const key = (txn: Transaction) =>
  (txn.description || txn.merchant)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const payroll = (txn: Transaction) =>
  /\b(payroll|paycheck|salary)\b/.test(key(txn)) &&
  !/\b(refund|transfer|interest|reversal)\b/.test(key(txn));

/** Receives reconciled records from the forecast. Name/cadence evidence is an estimate, not income verification. */
export function buildIncomeOutlook(
  transactions: Transaction[],
  asOf: string,
  evaluatedAt: string,
  reliable: boolean,
): IncomeOutlook {
  const today = day(evaluatedAt);
  const groups = new Map<string, Transaction[]>();
  for (const txn of transactions) {
    if (
      txn.status !== 'posted' ||
      txn.amountCents <= 0 ||
      Date.parse(txn.date) > Date.parse(asOf) ||
      !payroll(txn)
    )
      continue;
    const name = key(txn);
    groups.set(name, [...(groups.get(name) ?? []), txn]);
  }
  const streams: IncomeStream[] = [];
  for (const [name, history] of groups) {
    const records = history
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
    if (records.length < 4) continue;
    const gaps = records
      .slice(1)
      .map((txn, i) => day(records[i].date) - day(txn.date));
    if (gaps.some((gap) => gap < 6 || gap > 8)) continue;
    const amounts = records.map((txn) => txn.amountCents).sort((a, b) => a - b);
    if (amounts.at(-1)! > amounts[0] * 1.25) continue;
    const next = day(records[0].date) + 7;
    const pending = transactions.some(
      (txn) =>
        txn.status === 'pending' &&
        txn.amountCents > 0 &&
        key(txn) === name &&
        Math.abs(day(txn.date) - next) <= 2,
    );
    streams.push({
      id: `weekly:${encodeURIComponent(records[0].accountId)}:${encodeURIComponent(name)}`,
      name: records[0].description || records[0].merchant,
      amountCents: amounts[Math.floor(amounts.length / 2)],
      minimumCents: amounts[0],
      nextDate: iso(next),
      evidenceIds: records.map((txn) => txn.id),
      status: reliable && next >= today && !pending ? 'estimated' : 'review',
    });
  }
  const payments: IncomeOutlook['payments'] = [];
  for (const stream of streams.filter(
    (entry) => entry.status === 'estimated',
  )) {
    for (let due = day(stream.nextDate); due < today + 30; due += 7) {
      payments.push({
        date: iso(due),
        amountCents: stream.amountCents,
        streamId: stream.id,
      });
    }
  }
  payments.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.streamId.localeCompare(b.streamId),
  );
  return {
    status: streams.some((stream) => stream.status === 'review')
      ? 'review'
      : streams.length
        ? 'estimated'
        : 'none',
    streams,
    payments,
    expected14DaysCents: payments
      .filter((payment) => day(payment.date) < today + 14)
      .reduce((total, payment) => total + payment.amountCents, 0),
    expected30DaysCents: payments.reduce(
      (total, payment) => total + payment.amountCents,
      0,
    ),
    explanation: streams.some((stream) => stream.status === 'review')
      ? 'Some weekly pay needs review: data is incomplete or stale, a payday has passed without a posted deposit, or a matching deposit is pending. Those streams are excluded from expected income.'
      : streams.length
        ? 'Estimated from at least four posted payroll-like credits, 6–8 days apart. Amounts use the observed median. Pay can arrive late, change or stop; these deposits are not available to invest until posted.'
        : 'No stable weekly payroll pattern detected. At least four posted payroll-like deposits are needed; transfers, refunds and interest are not treated as pay.',
  };
}

export function explainIncome(income: IncomeOutlook): string {
  const streams = income.streams
    .map(
      (stream) =>
        `${stream.name}: ${formatMoney(stream.amountCents)} estimated weekly from ${stream.evidenceIds.length} posted deposits; ${stream.status === 'review' ? 'review expected payday' : 'next estimated payday'} ${stream.nextDate}.`,
    )
    .join(' ');
  return `${streams}${streams ? ' ' : ''}${formatMoney(income.expected14DaysCents)} is expected over 14 days and ${formatMoney(income.expected30DaysCents)} over 30 days. ${income.explanation} Deposit amounts do not establish annual taxable income or Roth eligibility.`;
}
