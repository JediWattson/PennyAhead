'use client';
import { useId, useState, type SubmitEvent } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { IncomeSummary } from './income-summary';
import type {
  BillCorrection,
  DemoForecast,
  DemoOptions,
  DetectedBill,
} from '../lib/contracts';
import { formatMoney, parseMoney } from '../lib/money';

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date));

function BillEditor({
  bill,
  busy,
  save,
}: {
  bill: DetectedBill;
  busy: boolean;
  save: (correction: BillCorrection) => Promise<boolean>;
}) {
  const id = useId();
  const [amount, setAmount] = useState((bill.amountCents / 100).toFixed(2));
  const [date, setDate] = useState(bill.nextDate);
  const [enabled, setEnabled] = useState(bill.enabled);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const amountCents = parseMoney(amount);
      setError(null);
      await save({ billId: bill.id, amountCents, nextDate: date, enabled });
    } catch {
      setError('Enter a positive amount with no more than two decimal places.');
    }
  }
  return (
    <details className="bill-editor">
      <summary>Correct estimate</summary>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="bill-fields">
          <label htmlFor={`${id}-amount`}>
            Amount ($)
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              required
              value={amount}
              disabled={busy}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-date`}>
            Next date
            <Input
              id={`${id}-date`}
              type="date"
              required
              value={date}
              disabled={busy}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </div>
        <label className="bill-enabled" htmlFor={`${id}-enabled`}>
          <Checkbox
            id={`${id}-enabled`}
            checked={enabled}
            disabled={busy}
            onCheckedChange={(value) => setEnabled(value === true)}
          />
          Include this bill in the forecast
        </label>
        <Button type="submit" disabled={busy}>
          Apply correction
        </Button>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}

export function ForecastPanel({
  demo,
  busy,
  change,
}: {
  demo: DemoForecast;
  busy: boolean;
  change: (options: DemoOptions) => Promise<boolean>;
}) {
  const report = demo.forecast;
  const withIncome = (report.income?.expected14DaysCents ?? 0) > 0;
  const uncertain = report.bills.some((bill) => bill.enabled && bill.uncertain);
  const lastDay = report.days[report.days.length - 1];
  const noBillCharges =
    report.scheduledCents === 0 &&
    lastDay.cautiousBalanceCents === report.startingCents;
  const reliable = report.status !== 'stale' && report.status !== 'incomplete';
  const nextBill = report.bills
    .filter(
      (bill) =>
        bill.enabled &&
        !bill.pendingTransactionId &&
        bill.nextDate > lastDay.date,
    )
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
  const cautiousMinimum = Math.min(
    report.startingCents,
    ...report.days.map((day) => day.cautiousBalanceCents),
  );
  const title =
    report.status === 'stale'
      ? 'Account data needs a refresh'
      : report.status === 'incomplete'
        ? 'Some activity needs verification'
        : report.status === 'shortfall'
          ? `${formatMoney(report.shortageCents)} projected shortfall`
          : noBillCharges
            ? 'No detected bills due in this 14-day view'
            : report.status === 'watch'
              ? report.cautiousShortageCents > 0
                ? `Earlier or higher bills could leave you ${formatMoney(report.cautiousShortageCents)} short`
                : 'Bills still fit the cautious estimate'
              : 'Detected bills fit this balance';
  const max = Math.max(
    report.startingCents,
    ...report.days.map((day) => day.balanceCents),
    ...report.days.map((day) => day.balanceWithIncomeCents ?? day.balanceCents),
    1000,
  );
  const min = Math.min(
    ...report.days.map((day) => day.cautiousBalanceCents),
    0,
  );
  const y = (cents: number) => 25 + ((max - cents) / (max - min)) * 125;
  const line = (cautious: boolean) =>
    report.days
      .map(
        (day, index) =>
          `${24 + index * (532 / 13)},${y(cautious ? day.cautiousBalanceCents : day.balanceCents)}`,
      )
      .join(' ');
  return (
    <section
      className="forecast-section"
      aria-labelledby="forecast-heading"
      aria-busy={busy}
    >
      <div className="section-heading">
        <h2 id="forecast-heading">The next 14 days</h2>
        <span>
          {dateLabel(report.days[0].date)}–{dateLabel(report.days[13].date)} ·
          UTC
        </span>
      </div>
      <div className={`forecast-card ${report.status}`}>
        <div className="forecast-verdict">
          <p className="eyebrow">
            {demo.snapshot.source === 'plaid_sandbox'
              ? demo.snapshot.accounts.find(
                  (account) => account.id === report.accountId,
                )?.name
              : 'CHECKING'}{' '}
            · ESTIMATE
          </p>
          <h3 data-testid="forecast-title">{title}</h3>
          <p>
            {reliable && noBillCharges && report.shortageCents === 0
              ? `${withIncome ? 'The bill-only projection stays' : 'Checking stays'} at ${formatMoney(report.startingCents)} in this projection because no additional bill deductions are expected through ${dateLabel(lastDay.date)}.${nextBill ? ` The next detected bill is ${nextBill.merchant}, estimated for ${dateLabel(nextBill.nextDate)}.` : ''} Everyday spending is not included.`
              : report.firstShortfall
                ? `First projected below zero: ${dateLabel(report.firstShortfall)}.`
                : report.status === 'watch' &&
                    report.cautiousShortageCents === 0
                  ? `The lowest projected balance is ${formatMoney(cautiousMinimum)} using earlier payment dates and higher observed amounts. Confirm the estimates below before deciding what to save.`
                  : 'No estimated negative balance on the expected payment dates.'}
            {report.cautiousFirstShortfall &&
            report.cautiousFirstShortfall !== report.firstShortfall
              ? ` If bills arrive earlier, the shortfall could begin ${dateLabel(report.cautiousFirstShortfall)}.`
              : ''}
          </p>
        </div>
        <div className="forecast-metrics">
          <div>
            <span>Available to start</span>
            <strong>{formatMoney(report.startingCents)}</strong>
          </div>
          <div>
            <span>Still expected</span>
            <strong>{formatMoney(report.scheduledCents)}</strong>
          </div>
          <div>
            <span>
              {withIncome ? 'Ending before new pay' : 'Estimated ending'}
            </span>
            <strong data-testid="forecast-ending">
              {formatMoney(report.endingCents)}
            </strong>
          </div>
        </div>
        {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- An inline SVG chart needs its image role; an img cannot contain its plotted data. */}
        <svg
          className="balance-chart"
          viewBox="0 0 580 182"
          role="img"
          aria-label={`14-day estimated checking balance before new pay, ending at ${formatMoney(report.endingCents)}.${withIncome ? ` With estimated pay, ending at ${formatMoney(lastDay.balanceWithIncomeCents!)}.` : ''} Daily values are available below.`}
        >
          <line x1="24" x2="556" y1={y(0)} y2={y(0)} className="zero-line" />
          <text x="24" y={y(0) - 6}>
            $0
          </text>
          {uncertain && (
            <polyline points={line(true)} className="cautious-line" />
          )}
          <polyline points={line(false)} className="balance-line" />
          {withIncome && (
            <polyline
              className="income-line"
              points={report.days
                .map(
                  (day, index) =>
                    `${24 + index * (532 / 13)},${y(day.balanceWithIncomeCents ?? day.balanceCents)}`,
                )
                .join(' ')}
            />
          )}
          <text x="24" y="178">
            {dateLabel(report.days[0].date)}
          </text>
          <text x="556" y="178" textAnchor="end">
            {dateLabel(report.days[13].date)}
          </text>
        </svg>
        {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
        {withIncome && (
          <p className="chart-legend" data-testid="income-chart-caption">
            Blue: if estimated pay arrives, ending at{' '}
            {formatMoney(lastDay.balanceWithIncomeCents!)}. Green: bills before
            any new pay.
          </p>
        )}
        {reliable && noBillCharges && report.shortageCents === 0 && (
          <p className="chart-legend">
            No bill deductions projected in this window
          </p>
        )}
        {uncertain && !noBillCharges && (
          <p className="chart-legend">
            Green: expected bill timing · Amber: earlier dates and higher
            observed amounts
          </p>
        )}
        <p className="freshness">
          Data observed {dateLabel(report.observedAt)},{' '}
          {new Date(report.observedAt).toISOString().slice(11, 16)} UTC ·{' '}
          {Math.floor(report.ageHours)} hours old against{' '}
          {demo.clock === 'fixed-demo'
            ? 'the fixed demo clock'
            : 'the observation time'}
          .
        </p>
        {report.warnings.length > 0 && (
          <ul className="forecast-warnings">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <details className="daily-balances">
          <summary>Daily estimated balances</summary>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Expected and cautious daily checking balances
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Cautious</th>
                  {withIncome && (
                    <>
                      <th scope="col">Expected pay</th>
                      <th scope="col">With pay</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.days.map((day) => (
                  <tr key={day.date}>
                    <td>{dateLabel(day.date)}</td>
                    <td>{formatMoney(day.balanceCents)}</td>
                    <td>{formatMoney(day.cautiousBalanceCents)}</td>
                    {withIncome && (
                      <>
                        <td>{formatMoney(day.expectedIncomeCents ?? 0)}</td>
                        <td>
                          {formatMoney(
                            day.balanceWithIncomeCents ?? day.balanceCents,
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="forecast-limits">
          The bill protection check excludes future income. The blue outlook,
          when shown, adds estimated weekly pay. Unrecorded spending is
          excluded. Estimates do not guarantee a payday or a covered bill.
        </p>
        <IncomeSummary income={report.income} horizonDays={14} />
      </div>
      <div className="section-heading upcoming-heading">
        <h2>Upcoming bills</h2>
        <span>Inferred from transaction history</span>
      </div>
      <ul className="bill-list">
        {report.bills.length === 0 && (
          <li className="bill-row">
            No monthly bills detected. Detection needs three consecutive monthly
            payments; other spending is not included in this estimate.
          </li>
        )}
        {report.bills.map((bill) => (
          <li
            key={`${bill.id}:${bill.amountCents}:${bill.nextDate}:${bill.enabled}`}
            className={`bill-row ${bill.enabled ? '' : 'excluded'}`}
            data-testid="bill-row"
          >
            <div className="bill-top">
              <div>
                <h3>{bill.merchant}</h3>
                <p>
                  {bill.pendingTransactionId
                    ? 'Already pending · not deducted again'
                    : bill.enabled
                      ? `${dateLabel(bill.nextDate)} estimated${bill.corrected ? ' · Your correction' : ''}`
                      : 'Excluded by you'}
                  {bill.overdue ? ' · Check overdue payment' : ''}
                </p>
                {bill.uncertain && (
                  <p className="uncertain-note">
                    Date window: {dateLabel(bill.earliestDate)}–
                    {dateLabel(bill.latestDate)}
                    {bill.maximumCents !== bill.amountCents
                      ? ` · Up to ${formatMoney(bill.maximumCents)}`
                      : ''}
                  </p>
                )}
              </div>
              <strong>{formatMoney(bill.amountCents)}</strong>
            </div>
            <details className="bill-evidence">
              <summary>
                {bill.evidenceIds.length} observed monthly payments
              </summary>
              <ul>
                {bill.evidenceIds.map((id) => {
                  const txn = demo.snapshot.transactions.find(
                    (entry) => entry.id === id,
                  )!;
                  return (
                    <li key={id}>
                      {dateLabel(txn.date)} · {formatMoney(-txn.amountCents)} ·
                      Posted
                    </li>
                  );
                })}
              </ul>
            </details>
            <BillEditor
              bill={bill}
              busy={busy}
              save={(correction) =>
                change({
                  scenario: demo.scenario,
                  corrections: [
                    ...demo.corrections.filter(
                      (entry) => entry.billId !== correction.billId,
                    ),
                    correction,
                  ],
                })
              }
            />
          </li>
        ))}
      </ul>
      <div className="correction-note">
        <p>
          Corrections apply to this demo session and reset on reload. Changing
          them starts a fresh assistant conversation.
        </p>
        {demo.corrections.length > 0 && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void change({ scenario: demo.scenario, corrections: [] });
            }}
          >
            Reset corrections
          </Button>
        )}
      </div>
    </section>
  );
}
