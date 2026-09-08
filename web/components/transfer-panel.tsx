'use client';
import { useState, type SubmitEvent } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatMoney } from '../lib/money';
import type { MonitorView } from '../lib/contracts';

export function TransferPanel({
  state,
  busy,
  action,
}: {
  state: MonitorView;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [cap, setCap] = useState('50');
  const [authorizedTerms, setAuthorizedTerms] = useState<string | null>(null);
  const terms = JSON.stringify([
    cap,
    state.revision,
    state.config.savingsMinimumCents,
  ]);
  const authorize = authorizedTerms === terms;
  const [confirmedProposal, setConfirmedProposal] = useState<string | null>(
    null,
  );
  const plan = state.plan;
  const simulated = state.transferEnvironment === 'local_simulation';
  function enableRule(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorize || !/^\d+(\.\d{1,2})?$/.test(cap)) return;
    void action({
      action: 'enable_rule',
      capCents: Math.round(Number(cap) * 100),
      authorize: true,
    }).then(() => setAuthorizedTerms(null));
  }
  return (
    <div className="transfer-section">
      {plan?.status === 'proposed' && state.proposalId && (
        <div className="approval-controls" data-testid="approval-controls">
          {state.proposalStatus === 'declined' ? (
            <p>Proposal declined. No transfer was created.</p>
          ) : state.proposalStatus === 'submitted' ? (
            <p>Proposal submitted. Check its status below.</p>
          ) : (
            <>
              <p>
                {simulated
                  ? 'Approve a local simulation of this exact proposal. No bank is connected.'
                  : 'Approve this exact proposal in Dwolla Sandbox. Sandbox funds are not real money.'}
              </p>
              <label className="bill-enabled">
                <input
                  type="checkbox"
                  checked={confirmedProposal === state.proposalId}
                  onChange={(event) =>
                    setConfirmedProposal(
                      event.target.checked ? state.proposalId : null,
                    )
                  }
                  disabled={busy}
                />{' '}
                I approve {formatMoney(plan.amountCents)} from savings to
                checking.
              </label>
              <div className="transfer-actions">
                <Button
                  disabled={busy || confirmedProposal !== state.proposalId}
                  onClick={() => {
                    void action({
                      action: 'approve',
                      proposalId: state.proposalId,
                      revision: state.revision,
                      amountCents: plan.amountCents,
                      sourceAccountId: plan.sourceAccountId,
                      destinationAccountId: plan.destinationAccountId,
                    }).then(() => setConfirmedProposal(null));
                  }}
                >
                  Approve {formatMoney(plan.amountCents)}{' '}
                  {simulated ? 'simulation' : 'sandbox transfer'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void action({
                      action: 'decline',
                      proposalId: state.proposalId,
                    });
                  }}
                >
                  Decline proposal
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {!!state.transfers.length && (
        <div className="transfer-history">
          <h3>Transfer activity</h3>
          <ul>
            {state.transfers.map((transfer) => (
              <li key={transfer.id} data-testid="transfer-record">
                <div className="transfer-title">
                  <strong>
                    {formatMoney(transfer.approvedTransfer.amountCents)} ·
                    Savings → Checking
                  </strong>
                  <span className={`transfer-badge ${transfer.status}`}>
                    {transfer.status}
                  </span>
                </div>
                <p>
                  {transfer.environment === 'local_simulation'
                    ? 'Local simulation'
                    : 'Dwolla Sandbox'}{' '}
                  ·{' '}
                  {transfer.initiatedBy === 'automation'
                    ? 'Authorized rule'
                    : 'Explicit approval'}
                </p>
                {transfer.status === 'pending' && (
                  <p>
                    Checking has not received this money.{' '}
                    {transfer.execution === 'uncertain'
                      ? 'Provider confirmation is delayed; no new transfer will be created.'
                      : 'Wait for a confirmed result.'}
                  </p>
                )}
                {transfer.failureReason && <p>{transfer.failureReason}</p>}
                {transfer.status === 'completed' &&
                  transfer.environment === 'local_simulation' && (
                    <p>
                      Simulated money received. Your demo balances and forecast
                      now include it.
                    </p>
                  )}
                {transfer.status === 'completed' &&
                  transfer.environment === 'dwolla_sandbox' && (
                    <p>
                      Provider reports completion. Refresh bank observations
                      before treating the funds as available.
                    </p>
                  )}
                {transfer.status === 'pending' &&
                  transfer.environment === 'local_simulation' && (
                    <div className="transfer-actions">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void action({
                            action: 'complete_simulation',
                            transferId: transfer.id,
                          });
                        }}
                      >
                        Simulate success
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void action({
                            action: 'fail_simulation',
                            transferId: transfer.id,
                          });
                        }}
                      >
                        Simulate failure
                      </Button>
                    </div>
                  )}
                <details>
                  <summary>Transfer receipt</summary>
                  <p className="receipt-id">{transfer.id}</p>
                  <p>
                    Created{' '}
                    {new Date(transfer.createdAt).toLocaleString('en-US')}.{' '}
                    {transfer.providerId
                      ? `Provider ID: ${transfer.providerId}`
                      : 'No provider transfer ID.'}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="automation-settings">
        <summary>Optional automatic funding</summary>
        <p>
          Authorize savings → checking proposals without another approval,
          subject to a total budget and your savings minimum. Pausing monitoring
          pauses new automatic funding.
        </p>
        {state.rule?.enabled ? (
          <div className="rule-summary">
            <strong>Rule active</strong>
            <p>
              {formatMoney(state.rule.spentCents)} of{' '}
              {formatMoney(state.rule.capCents)} total budget used. Savings
              floor: {formatMoney(state.rule.savingsMinimumCents)}.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void action({ action: 'revoke_rule' });
              }}
            >
              Revoke automatic funding
            </Button>
          </div>
        ) : (
          <form onSubmit={enableRule}>
            <label htmlFor="automation-cap">Total funding budget ($)</label>
            <Input
              id="automation-cap"
              type="number"
              min="0.01"
              max="500"
              step="0.01"
              value={cap}
              onChange={(event) => setCap(event.target.value)}
              required
              disabled={busy}
            />
            <label className="bill-enabled">
              <input
                type="checkbox"
                checked={authorize}
                onChange={(event) =>
                  setAuthorizedTerms(event.target.checked ? terms : null)
                }
                disabled={busy}
              />{' '}
              I authorize {simulated ? 'simulated' : 'sandbox'} funding within
              this budget, keeping at least{' '}
              {formatMoney(state.config.savingsMinimumCents)} in savings.
            </label>
            <Button type="submit" disabled={busy || !authorize}>
              Enable automatic funding
            </Button>
          </form>
        )}
        <p className="monitor-meta">
          No automatic retry after a failed transfer. Revoke at any time;
          revoking does not cancel a transfer already submitted. Changing
          scenarios ends this rule.
        </p>
      </details>
      <details className="reset-demo">
        <summary>Reset simulated money</summary>
        <p>
          Reset this scenario’s local transfers and automation. Completed
          provider transfers cannot be undone here.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void action({ action: 'reset_simulation' });
          }}
        >
          Reset simulated money
        </Button>
      </details>
    </div>
  );
}
