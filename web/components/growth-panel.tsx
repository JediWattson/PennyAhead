'use client';

import { useEffect, useState, type SubmitEvent } from 'react';
import {
  ArrowUpRight,
  ShieldCheck,
  Sprout,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { DemoForecast } from '../lib/contracts';
import {
  initialGrowthInputs,
  type GrowthInputs,
  type GrowthPlan,
} from '../lib/growth-contracts';
import { growthContext } from '../lib/growth-context';
import { formatMoney, parseMoney } from '../lib/money';

function MoneyField({
  name,
  label,
  value,
  hint,
  disabled,
}: {
  name: string;
  label: string;
  value: number;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="growth-field" htmlFor={`growth-${name}`}>
      <span>{label}</span>
      <Input
        id={`growth-${name}`}
        name={name}
        type="number"
        min="0"
        max="1000000"
        step="0.01"
        required
        disabled={disabled}
        defaultValue={(value / 100).toFixed(2)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function GrowthPanel({
  demo,
  inputs,
  savingsMinimumCents,
  sessionId,
  busy,
  onChange,
  onAsk,
}: {
  demo: DemoForecast;
  inputs: GrowthInputs;
  savingsMinimumCents: number;
  sessionId: string | null;
  busy: boolean;
  onChange: (inputs: GrowthInputs) => void;
  onAsk: () => void;
}) {
  const sandbox = demo.snapshot.source === 'plaid_sandbox';
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    plan?: GrowthPlan;
    error?: string;
  } | null>(null);
  const [formError, setFormError] = useState('');
  const [budgetMode, setBudgetMode] = useState(inputs.budgetMode ?? 'manual');
  const desired = JSON.stringify({
    context: growthContext(demo, savingsMinimumCents),
    sandbox,
    snapshotId: demo.snapshotId,
    corrections: demo.corrections,
    inputs,
    sessionId,
    retry,
  });
  const current = result?.key === desired ? result : null;
  const plan = current?.plan;
  const estimate = plan?.budgetEstimate;
  const formInputs = estimate
    ? {
        ...inputs,
        spendingCents: estimate.spendingCents,
        checkingBufferCents: estimate.checkingBufferCents,
        emergencyTargetCents: estimate.emergencyTargetCents,
      }
    : inputs;

  useEffect(() => {
    const request = JSON.parse(desired) as {
      context: string;
      sandbox: boolean;
      snapshotId?: string;
      corrections: DemoForecast['corrections'];
      inputs: GrowthInputs;
      sessionId: string | null;
    };
    if (request.sandbox ? !request.snapshotId : !request.sessionId) return;
    const controller = new AbortController();
    let stopped = false;
    void (async () => {
      try {
        const response = await fetch(
          request.sandbox ? '/api/sandbox/growth' : '/api/growth',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(!request.sandbox
                ? { Authorization: `Bearer ${request.sessionId}` }
                : {}),
            },
            body: JSON.stringify(
              request.sandbox
                ? {
                    snapshotId: request.snapshotId,
                    corrections: request.corrections,
                    growth: request.inputs,
                  }
                : {
                    context: request.context,
                    inputs: request.inputs,
                  },
            ),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? 'Unable to calculate the plan.');
        if (!stopped) setResult({ key: desired, plan: body as GrowthPlan });
      } catch (error) {
        if (!stopped)
          setResult({
            key: desired,
            error:
              error instanceof Error
                ? error.message
                : 'Unable to calculate the plan.',
          });
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [desired]);

  function update(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const dollars = (name: string) => {
      const value = text(name);
      return /^0(?:\.0{1,2})?$/.test(value) ? 0 : parseMoney(value);
    };
    try {
      const next: GrowthInputs = {
        ...(sandbox ? { budgetMode } : {}),
        spendingCents:
          sandbox && budgetMode === 'estimated'
            ? inputs.spendingCents
            : dollars('spending'),
        extraCommitmentsCents: dollars('extra'),
        checkingBufferCents:
          sandbox && budgetMode === 'estimated'
            ? inputs.checkingBufferCents
            : dollars('buffer'),
        emergencyTargetCents:
          sandbox && budgetMode === 'estimated'
            ? inputs.emergencyTargetCents
            : dollars('target'),
        earmarkedSavingsCents: dollars('earmarked'),
        budgetReviewed: sandbox
          ? budgetMode === 'manual'
          : form.has('budgetReviewed'),
        retirementPrioritiesReviewed: form.has('prioritiesReviewed'),
        hysaApyBasisPoints: dollars('apy'),
        rothGoalCents: dollars('rothGoal'),
        roth: {
          taxYear: 2026,
          age: Number(text('age')),
          filingStatus: text(
            'filingStatus',
          ) as GrowthInputs['roth']['filingStatus'],
          compensationCents: dollars('compensation'),
          modifiedAgiCents: dollars('magi'),
          traditionalContributionsCents: dollars('traditional'),
          rothContributionsCents: dollars('rothContributions'),
          detailsReviewed: form.has('rothReviewed'),
        },
      };
      setFormError('');
      onChange(next);
      setRetry((value) => value + 1);
    } catch {
      setFormError(
        'Use dollar amounts from $0 to $1,000,000 with at most two decimal places.',
      );
    }
  }

  return (
    <section
      className="growth-section"
      aria-labelledby="growth-heading"
      data-testid="growth-planner"
    >
      <div className="section-heading">
        <h2 id="growth-heading">
          <Sprout size={20} />
          Save and invest
        </h2>
        <span>A plan for your next 30 days</span>
      </div>
      <div className="growth-card">
        <div className="growth-card-top">
          <span className="growth-kicker">MAKE ROOM FOR WHAT’S NEXT</span>
          <span className="growth-preview">Planning preview</span>
        </div>
        {!plan && !current?.error && (
          <output className="growth-loading">
            {sessionId || sandbox
              ? 'Checking your cash reserves and contribution room…'
              : 'Preparing your private demo plan…'}
          </output>
        )}
        {current?.error && (
          <div className="growth-error" role="alert">
            <p>{current.error} Previous suggestions are hidden.</p>
            <Button
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry plan
            </Button>
          </div>
        )}
        {plan && (
          <>
            <h3 className="growth-title" data-testid="growth-title">
              {plan.status === 'ready'
                ? `${formatMoney(plan.hysaSuggestedCents + plan.rothSuggestedCents)} toward your goals`
                : plan.status === 'cash_first'
                  ? 'Protect your cash first'
                  : 'Review a few details first'}
            </h3>
            <p className="growth-subtitle">
              {plan.status === 'ready'
                ? `${formatMoney(plan.availableForGoalsCents)} is ${estimate ? 'potentially ' : ''}available after ${estimate ? 'estimated spending and the suggested buffer' : 'the spending and buffer you entered'}. Start with your cash reserve, then make room for retirement.`
                : plan.status === 'cash_first'
                  ? `${formatMoney(plan.cashGapCents)} more is needed in checking to cover the ${estimate ? 'estimated' : 'entered'} spending reserve and buffer. New contributions can wait.`
                  : 'Complete the missing information before using a savings or retirement amount.'}
            </p>
            {estimate && (
              <div className="growth-estimate" data-testid="growth-estimate">
                <strong>A starting plan from your transactions</strong>
                <p>
                  Based on {estimate.transactionCount} posted checking outflows
                  across {estimate.historyDays} days.
                </p>
                <dl>
                  <div>
                    <dt>Next 30 days · estimated spending</dt>
                    <dd>{formatMoney(plan.spendingReserveCents)}</dd>
                  </div>
                  <div>
                    <dt>Suggested checking buffer · 7 days</dt>
                    <dd>{formatMoney(plan.checkingBufferCents)}</dd>
                  </div>
                  <div>
                    <dt>Suggested cash reserve · 3 months</dt>
                    <dd>{formatMoney(plan.emergencyTargetCents)}</dd>
                  </div>
                </dl>
                <p>
                  Includes transfers and one-off purchases. Other accounts or
                  commitments may be missing. Adjust the estimates below as
                  needed.
                </p>
              </div>
            )}
            <div className="growth-allocations">
              <article>
                <span className="growth-goal-icon">
                  <ShieldCheck size={19} />
                </span>
                <h4>High-yield savings</h4>
                <strong data-testid="growth-hysa">
                  {formatMoney(plan.hysaSuggestedCents)}
                </strong>
                <p>Toward your cash reserve</p>
              </article>
              <article>
                <span className="growth-goal-icon">
                  <Sprout size={19} />
                </span>
                <h4>Roth IRA</h4>
                <strong data-testid="growth-roth">
                  {formatMoney(plan.rothSuggestedCents)}
                </strong>
                <p>
                  {plan.roth.status === 'review'
                    ? 'Contribution details need review'
                    : 'Toward your retirement goal'}
                </p>
              </article>
              <article className="growth-keep">
                <span className="growth-goal-icon">
                  <ArrowUpRight size={19} />
                </span>
                <h4>Keep in checking</h4>
                <strong data-testid="growth-keep">
                  {formatMoney(
                    plan.checkingAvailableCents -
                      plan.hysaSuggestedCents -
                      plan.rothSuggestedCents,
                  )}
                </strong>
                <p>For spending, buffer and flexibility</p>
              </article>
            </div>
            {plan.blockers.length > 0 && (
              <ul className="growth-blockers">
                {plan.blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <div className="growth-progress">
              <div>
                <span>Cash reserve today</span>
                <strong>
                  {formatMoney(plan.existingReserveCents)} /{' '}
                  {formatMoney(plan.emergencyTargetCents)}
                </strong>
              </div>
              <progress
                aria-label="Cash reserve progress"
                value={Math.min(
                  plan.existingReserveCents,
                  plan.emergencyTargetCents,
                )}
                max={Math.max(1, plan.emergencyTargetCents)}
              />
              <small>
                Suggested contributions are not included in today’s balance.
              </small>
            </div>
            <details className="growth-explanation">
              <summary>Why these amounts?</summary>
              <ul>
                {plan.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p>
                At an illustrative {(plan.hysaApyBasisPoints / 100).toFixed(2)}%
                APY, the proposed savings deposit could earn about{' '}
                {formatMoney(plan.hypotheticalAnnualInterestCents)} over one
                year if the rate and deposit stay unchanged. This is before
                taxes and fees, and is not a bank offer.
              </p>
              <p>
                A Roth IRA is an account, not an investment selection. This
                planner does not choose securities or predict investment
                returns.
              </p>
              <a
                href="https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits"
                target="_blank"
                rel="noreferrer"
              >
                2026 IRA contribution rules
              </a>
            </details>
            <Button
              variant="outline"
              className="growth-ask"
              onClick={onAsk}
              disabled={busy}
            >
              Explain my savings and Roth plan
              <ArrowUpRight size={16} />
            </Button>
          </>
        )}
        <p className="growth-disclosure">
          {sandbox
            ? 'Plaid Sandbox balances and transactions · Spending is estimated from history unless you enter your own budget. Suggested buffers and reserve targets are adjustable. Roth eligibility and IRA contributions need your details.'
            : 'Alex’s illustrative profile · Synthetic money.'}{' '}
          This previews a possible allocation; no account is opened and no money
          is moved. Assumptions reset when you reload.
        </p>
      </div>
      <details className="growth-settings">
        <summary>
          <SlidersHorizontal size={16} />
          Edit plan assumptions
        </summary>
        <form onSubmit={update} key={JSON.stringify(formInputs)}>
          <fieldset disabled={busy}>
            <legend>Protect your next 30 days</legend>
            <p>
              {sandbox
                ? 'Start with the transaction estimate, or use your own amounts. Add any commitments and savings earmarks the account history cannot show.'
                : 'Include rent, bills, everyday spending and minimum debt payments. The detected-bill forecast covers only 14 days; the larger spending reserve is entered here.'}
            </p>
            {sandbox && (
              <label className="growth-field" htmlFor="growth-budgetMode">
                <span>Budget approach</span>
                <select
                  id="growth-budgetMode"
                  value={budgetMode}
                  onChange={(event) =>
                    setBudgetMode(event.target.value as 'estimated' | 'manual')
                  }
                >
                  <option value="estimated">Estimate from transactions</option>
                  <option value="manual">Use my own amounts</option>
                </select>
              </label>
            )}
            <div className="growth-fields">
              <MoneyField
                name="spending"
                label="All spending for the next 30 days ($)"
                value={formInputs.spendingCents}
                disabled={sandbox && budgetMode === 'estimated'}
              />
              <MoneyField
                name="extra"
                label="Additional known commitments ($)"
                value={inputs.extraCommitmentsCents}
              />
              <MoneyField
                name="buffer"
                label="Checking buffer ($)"
                value={formInputs.checkingBufferCents}
                disabled={sandbox && budgetMode === 'estimated'}
              />
              <MoneyField
                name="target"
                label="Cash reserve target ($)"
                value={formInputs.emergencyTargetCents}
                disabled={sandbox && budgetMode === 'estimated'}
              />
              <MoneyField
                name="earmarked"
                label="Savings reserved for other goals ($)"
                value={inputs.earmarkedSavingsCents}
              />
              <label className="growth-field" htmlFor="growth-apy">
                <span>Illustrative savings APY (%)</span>
                <Input
                  id="growth-apy"
                  name="apy"
                  type="number"
                  min="0"
                  max="15"
                  step="0.01"
                  required
                  defaultValue={(inputs.hysaApyBasisPoints / 100).toFixed(2)}
                />
              </label>
            </div>
            {savingsMinimumCents > 0 && (
              <p className="growth-hint">
                Your existing protected savings minimum is{' '}
                {formatMoney(savingsMinimumCents)}. This plan preserves at least
                that target.
              </p>
            )}
            {!sandbox && (
              <label className="growth-check">
                <input
                  type="checkbox"
                  name="budgetReviewed"
                  defaultChecked={inputs.budgetReviewed}
                />
                The demo budget includes spending and commitments for the full
                30 days.
              </label>
            )}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Plan a Roth contribution</legend>
            <p>
              Regular direct contributions for tax year 2026. Phase-outs,
              married filing separately, and spousal eligibility need separate
              review.
            </p>
            <div className="growth-fields">
              <MoneyField
                name="rothGoal"
                label="Roth goal for this plan ($)"
                value={inputs.rothGoalCents}
              />
              <label className="growth-field" htmlFor="growth-age">
                <span>Age at year end</span>
                <Input
                  id="growth-age"
                  name="age"
                  type="number"
                  min="18"
                  max="120"
                  step="1"
                  required
                  defaultValue={inputs.roth.age}
                />
              </label>
              <label className="growth-field" htmlFor="growth-filingStatus">
                <span>2026 filing status</span>
                <select
                  id="growth-filingStatus"
                  name="filingStatus"
                  defaultValue={inputs.roth.filingStatus}
                >
                  <option value="unknown">Not confirmed</option>
                  <option value="single">Single</option>
                  <option value="head_of_household">Head of household</option>
                  <option value="joint">Married filing jointly</option>
                  <option value="surviving_spouse">
                    Qualifying surviving spouse
                  </option>
                  <option value="separate">Married filing separately</option>
                </select>
              </label>
              <MoneyField
                name="compensation"
                label="2026 eligible compensation ($)"
                value={inputs.roth.compensationCents}
              />
              <MoneyField
                name="magi"
                label="2026 modified adjusted gross income ($)"
                value={inputs.roth.modifiedAgiCents}
              />
              <MoneyField
                name="traditional"
                label="2026 traditional IRA contributions so far ($)"
                value={inputs.roth.traditionalContributionsCents}
              />
              <MoneyField
                name="rothContributions"
                label="2026 Roth IRA contributions so far ($)"
                value={inputs.roth.rothContributionsCents}
              />
            </div>
            <label className="growth-check">
              <input
                type="checkbox"
                name="rothReviewed"
                defaultChecked={inputs.roth.detailsReviewed}
              />
              The demo income and contributions across all IRAs are reviewed.
            </label>
            <label className="growth-check">
              <input
                type="checkbox"
                name="prioritiesReviewed"
                defaultChecked={inputs.retirementPrioritiesReviewed}
              />
              Debt priorities and any workplace retirement match have been
              considered.
            </label>
          </fieldset>
          {formError && (
            <p role="alert" className="growth-error">
              {formError}
            </p>
          )}
          <div className="growth-form-actions">
            <Button type="submit" disabled={busy}>
              Update plan
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setFormError('');
                setBudgetMode(sandbox ? 'estimated' : 'manual');
                onChange(initialGrowthInputs(demo.snapshot.source));
                setRetry((value) => value + 1);
              }}
            >
              Reset plan assumptions
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}
