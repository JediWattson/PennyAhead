import type { IncomeOutlook } from '../lib/contracts';
import { formatMoney } from '../lib/money';

export function IncomeSummary({
  income,
  horizonDays,
  cashFlowCents,
}: {
  income?: IncomeOutlook;
  horizonDays: 14 | 30;
  cashFlowCents?: number;
}) {
  if (!income?.streams.length) return null;
  return (
    <section
      className="income-summary"
      data-testid={`income-summary-${horizonDays}`}
      aria-label="Expected weekly income"
    >
      <strong>Expected weekly income</strong>
      <ul>
        {income.streams.map((stream) => (
          <li key={stream.id}>
            <span>{stream.name}</span>
            <b>{formatMoney(stream.amountCents)} / week</b>
            <small>
              {stream.status === 'review'
                ? 'Review payday'
                : 'Next estimated payday'}
              : {stream.nextDate} · {stream.evidenceIds.length} posted deposits
            </small>
          </li>
        ))}
      </ul>
      <p>
        <b>
          {formatMoney(
            horizonDays === 14
              ? income.expected14DaysCents
              : income.expected30DaysCents,
          )}
        </b>{' '}
        expected in the next {horizonDays} days.
      </p>
      {cashFlowCents !== undefined && (
        <p>
          After planned spending: <b>{formatMoney(cashFlowCents)}</b> estimated
          net cash flow over 30 days.
        </p>
      )}
      <p>{income.explanation}</p>
      <small>
        Pay history does not verify taxable income or Roth eligibility.
      </small>
    </section>
  );
}
