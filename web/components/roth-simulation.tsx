'use client';

import { useReducer, useState } from 'react';
import type { InvestmentPlan } from '../lib/investment-contracts';
import {
  advanceRothSimulation,
  prepareRothSimulation,
  type RothSimulation,
} from '../lib/roth-simulation';
import { formatMoney } from '../lib/money';
import { Button } from './ui/button';

const messages: Record<RothSimulation['stage'], string> = {
  not_started: 'Start with an empty practice Roth.',
  account_ready: 'Practice Roth is ready. Review your test contribution next.',
  contribution_review: 'Review the contribution before adding test money.',
  contribution_pending:
    'Test contribution pending. Wait for simulated settlement before investing.',
  contribution_failed:
    'Test contribution failed. No cash was added. You can review and try again.',
  cash_ready:
    'Test contribution settled. Cash is available for simulated purchases.',
  order_review: 'Review these simulated purchases for your practice Roth.',
  orders_pending:
    'Simulated purchases pending. Test cash is reserved until a result arrives.',
  rejected: 'Simulated purchases rejected. Your test cash is available again.',
  filled:
    'Simulated purchases filled. Your contribution is now invested in the practice Roth.',
};

export function RothSimulationPanel({ plan }: { plan: InvestmentPlan }) {
  const [run, setRun] = useState(0);
  const initial = prepareRothSimulation(plan);
  return (
    <section
      className="roth-simulation"
      aria-label="Roth practice simulation"
      data-testid="roth-simulation"
    >
      <div className="investment-heading">
        <h4>Practice with test money</h4>
        <span className="investment-badge">Local simulation</span>
      </div>
      <p>
        Try opening a Roth, contributing and investing with fictional money.
        This practice account is separate from your sample holdings and Alpaca.
        No provider account, transfer or order is created.
      </p>
      {initial ? (
        <PracticeRun
          key={`${run}:${JSON.stringify(plan)}`}
          initial={initial}
          onReset={() => setRun((value) => value + 1)}
        />
      ) : (
        <p>
          Complete the plan review and choose a positive Roth contribution above
          to try the simulation.
        </p>
      )}
      <small>
        Practice activity stays in this panel. Reset, reload or a changed plan
        clears it; your planning balances stay unchanged.
      </small>
    </section>
  );
}

function PracticeRun({
  initial,
  onReset,
}: {
  initial: RothSimulation;
  onReset: () => void;
}) {
  const [state, dispatch] = useReducer(advanceRothSimulation, initial);
  const started = state.stage !== 'not_started';
  const reviewingOrders = state.stage === 'order_review';
  return (
    <>
      <output className="broker-status" data-testid="roth-practice-status">
        {messages[state.stage]}
      </output>
      {started && (
        <>
          <strong>Practice Roth · TEST-0001</strong>
          <dl className="practice-balances">
            <div>
              <dt>Test contributions received</dt>
              <dd data-testid="practice-contributed">
                {formatMoney(state.contributedCents)}
              </dd>
            </div>
            <div>
              <dt>Available test cash</dt>
              <dd data-testid="practice-cash">
                {formatMoney(state.cashCents)}
              </dd>
            </div>
            <div>
              <dt>Reserved for purchases</dt>
              <dd data-testid="practice-reserved">
                {formatMoney(state.reservedCents)}
              </dd>
            </div>
            <div>
              <dt>Simulated investments</dt>
              <dd data-testid="practice-invested">
                {formatMoney(state.investedCents)}
              </dd>
            </div>
          </dl>
        </>
      )}
      {state.stage === 'contribution_review' && (
        <div className="practice-review">
          <h5>Review test contribution</h5>
          <p>Fictional checking → Practice Roth · TEST-0001</p>
          <strong>
            {formatMoney(state.amountCents)} · simulated 2026 contribution
          </strong>
          <p>
            This uses the proposed contribution above. It does not debit
            checking or change your IRA contribution history.
          </p>
        </div>
      )}
      {(reviewingOrders ||
        state.stage === 'orders_pending' ||
        state.stage === 'filled') && (
        <div className="practice-review">
          <h5>
            {state.stage === 'filled'
              ? 'Sample holdings after the purchases'
              : 'Test purchases · Practice Roth · TEST-0001'}
          </h5>
          <dl className="practice-balances">
            {state.allocations.map((a) => (
              <div key={a.ticker}>
                <dt>{a.ticker}</dt>
                <dd>{formatMoney(a.amountCents)}</dd>
              </div>
            ))}
            <div>
              <dt>Total</dt>
              <dd>{formatMoney(state.amountCents)}</dd>
            </div>
          </dl>
          <p>
            Dollar amounts only. This simulation assumes fractional purchases
            and zero fees; it does not model market prices, share quantities or
            partial fills.
          </p>
        </div>
      )}
      <div className="practice-actions">
        {state.stage === 'not_started' && (
          <Button onClick={() => dispatch('create_account')}>
            Create practice Roth
          </Button>
        )}
        {['account_ready', 'contribution_failed'].includes(state.stage) && (
          <Button onClick={() => dispatch('review_contribution')}>
            Review test contribution
          </Button>
        )}
        {state.stage === 'contribution_review' && (
          <Button onClick={() => dispatch('confirm_contribution')}>
            Confirm test contribution
          </Button>
        )}
        {state.stage === 'contribution_pending' && (
          <>
            <Button onClick={() => dispatch('settle_contribution')}>
              Simulate contribution arrival
            </Button>
            <Button
              variant="outline"
              onClick={() => dispatch('fail_contribution')}
            >
              Simulate contribution failure
            </Button>
          </>
        )}
        {['cash_ready', 'rejected'].includes(state.stage) && (
          <Button onClick={() => dispatch('review_orders')}>
            Review simulated purchases
          </Button>
        )}
        {reviewingOrders && (
          <Button onClick={() => dispatch('confirm_orders')}>
            Confirm simulated purchases
          </Button>
        )}
        {(reviewingOrders || state.stage === 'contribution_review') && (
          <Button variant="outline" onClick={() => dispatch('cancel_review')}>
            Cancel review
          </Button>
        )}
        {state.stage === 'orders_pending' && (
          <>
            <Button onClick={() => dispatch('fill_orders')}>
              Simulate purchase fills
            </Button>
            <Button variant="outline" onClick={() => dispatch('reject_orders')}>
              Simulate purchase rejection
            </Button>
          </>
        )}
        {started && (
          <Button variant="ghost" onClick={onReset}>
            Reset practice
          </Button>
        )}
      </div>
      {state.activity.length > 0 && (
        <details className="investment-details">
          <summary>Practice activity · {state.activity.length} events</summary>
          <ol>
            {state.activity.map((entry) => (
              <li key={entry.id}>{entry.message}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
