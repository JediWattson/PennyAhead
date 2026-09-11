import { BrokerConnectionPanel } from './broker-connection';
import { RothSimulationPanel } from './roth-simulation';
import type { InvestmentPlan } from '../lib/investment-contracts';
import { formatMoney } from '../lib/money';
import { Button } from './ui/button';

export function InvestmentPanel({
  plan,
  sessionId,
  snapshotId,
  synthetic,
  busy,
  onAsk,
}: {
  plan: InvestmentPlan;
  sessionId: string | null;
  snapshotId?: string;
  synthetic: boolean;
  busy: boolean;
  onAsk: () => void;
}) {
  const holdings = plan.holdings;
  return (
    <section
      className="investment-panel"
      aria-labelledby="investment-heading"
      data-testid="investment-plan"
    >
      <div className="investment-heading">
        <div>
          <span className="investment-eyebrow">Inside your Roth IRA</span>
          <h3 id="investment-heading">Put your contribution to work</h3>
        </div>
        <span className="investment-badge">Investment preview</span>
      </div>
      <h4 data-testid="investment-title">{plan.title}</h4>
      <p>{plan.explanation}</p>
      {plan.status === 'preview' && (
        <>
          <p className="investment-basis">
            After your proposed <strong>{formatMoney(plan.amountCents)}</strong>{' '}
            contribution arrives and is available to trade
          </p>
          <div className="investment-mix" aria-hidden="true">
            {plan.allocations.map((a, i) => (
              <span
                key={a.label}
                className={`investment-color-${i}`}
                style={{ width: `${a.percent}%` }}
              />
            ))}
          </div>
          <div className="investment-allocations">
            {plan.allocations.map((a, i) => (
              <div className="investment-row" key={a.label}>
                <span className={`investment-dot investment-color-${i}`} />
                <div>
                  <strong>{a.label}</strong>
                  <small>
                    Example:{' '}
                    <a
                      href={a.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={a.exampleName}
                    >
                      {a.exampleTicker}
                    </a>
                  </small>
                </div>
                <span>{a.percent}%</span>
                <strong
                  data-testid={`investment-${a.exampleTicker.toLowerCase()}`}
                >
                  {formatMoney(a.amountCents)}
                </strong>
              </div>
            ))}
          </div>
          <p className="investment-note">
            These funds are examples. Compare fees, risks and overlap with your
            holdings. Dollar amounts assume fractional shares are supported;
            prices and orders are not quoted.
          </p>
          <Button variant="outline" disabled={busy} onClick={onAsk}>
            Explain this investment mix
          </Button>
        </>
      )}
      <details className="investment-details">
        <summary>
          Roth holdings{' '}
          {holdings?.source === 'synthetic' ? '· Sample account' : ''}
        </summary>
        {holdings?.status === 'observed' && holdings.accounts.length > 0 ? (
          <>
            <p>
              {holdings.source === 'synthetic'
                ? 'Illustrative holdings and values.'
                : 'Plaid Sandbox test holdings.'}{' '}
              Retrieved{' '}
              {new Date(holdings.retrievedAt).toLocaleDateString('en-US', {
                timeZone: 'UTC',
              })}
              . Values may reflect earlier prices; these are not live quotes.
            </p>
            {holdings.accounts.map((account) => (
              <div key={account.id} className="investment-account">
                <div>
                  <strong>{account.name}</strong>
                  <strong>
                    {account.valueCents === null
                      ? 'Value unavailable'
                      : formatMoney(account.valueCents)}
                  </strong>
                </div>
                {account.holdings.length ? (
                  account.holdings.map((holding) => (
                    <div key={holding.id}>
                      <span>
                        {holding.ticker ?? holding.name}
                        {holding.cashEquivalent ? ' · Cash equivalent' : ''}
                      </span>
                      <span>{formatMoney(holding.valueCents)}</span>
                    </div>
                  ))
                ) : (
                  <p>No holdings were returned for this account.</p>
                )}
              </div>
            ))}
            <p>
              Holdings are separate from your new contribution. Cash equivalents
              do not establish settled cash or buying power. Review the complete
              portfolio at your brokerage.
            </p>
          </>
        ) : (
          <p>
            {holdings?.status === 'unavailable'
              ? 'Roth holdings could not be refreshed. Refresh your Sandbox data to try again.'
              : 'No Roth holdings are connected. You can still explore the contribution preview; check existing investments at your brokerage before acting.'}
          </p>
        )}
      </details>
      {synthetic && <RothSimulationPanel key={sessionId} plan={plan} />}
      <BrokerConnectionPanel
        key={JSON.stringify({ sessionId, snapshotId })}
        sessionId={sessionId}
        snapshotId={snapshotId}
      />
      <details className="investment-details">
        <summary>How to use this at your brokerage</summary>
        <p>
          Review the examples alongside your other retirement investments. A
          diversified target-date fund is another approach if you prefer a
          single fund that adjusts its mix over time.
        </p>
        <ol>
          <li>Choose your Roth IRA at your brokerage.</li>
          <li>
            Confirm the contribution has arrived and the cash is available to
            trade.
          </li>
          <li>
            Check fund availability, fees, fractional shares and the order
            preview before deciding whether to buy.
          </li>
        </ol>
        <p>
          Buying directly through PennyAhead is not connected. No contribution
          or investment order is created here.
        </p>
        <a
          href="https://www.investor.gov/introduction-investing/getting-started/asset-allocation"
          target="_blank"
          rel="noreferrer"
        >
          Understand allocation and diversification
        </a>
      </details>
    </section>
  );
}
