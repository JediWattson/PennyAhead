import type { GrowthPlan } from '../growth-contracts.ts';
import { explainGrowthPlan } from './growth-plan.ts';
import type {
  Assistant,
  AssistantReply,
  BankDataProvider,
  DemoOptions,
  MonitorConfig,
  FundingPlan,
  ForecastReport,
} from '../contracts.ts';
import { formatMoney } from '../money.ts';
import { buildForecast } from './forecast.ts';
import { FixtureBankProvider, DEMO_NOW } from './fixtures.ts';
import { buildFundingPlan } from './funding.ts';
import {
  buildBillSuggestion,
  explainBillSuggestion,
} from './bill-suggestion.ts';

/** Deliberately deterministic. Replace this adapter in M1b. */
export class MockAssistant implements Assistant {
  private bank: BankDataProvider;
  private sessionPlan?: FundingPlan;
  private sessionBound: boolean;
  private observedForecast?: ForecastReport;
  private growthPlan?: GrowthPlan;
  constructor(
    bank: BankDataProvider,
    sessionPlan?: FundingPlan,
    sessionBound = false,
    observedForecast?: ForecastReport,
    growthPlan?: GrowthPlan,
  ) {
    this.bank = bank;
    this.sessionPlan = sessionPlan;
    this.sessionBound = sessionBound;
    this.observedForecast = observedForecast;
    this.growthPlan = growthPlan;
  }

  async reply(
    ownerId: string,
    message: string,
    options?: DemoOptions,
    monitoring?: MonitorConfig,
  ): Promise<AssistantReply> {
    const query = message.trim().toLowerCase();
    const sandbox = this.bank.source === 'plaid_sandbox';
    const base: AssistantReply = {
      mode: 'mock',
      source: this.bank.source,
      text: '',
      asOf: null,
      reads: [],
    };
    if (
      !sandbox &&
      !/\b(roth|ira|invest|retirement|save|growth|goals|allocate)\b|high[- ]yield/.test(
        query,
      ) &&
      /\b(proposal|cover|funding)\b/.test(query) &&
      !/\b(approve|execute|send)\b/.test(query)
    ) {
      const config: MonitorConfig = monitoring ?? {
        scenario: options?.scenario ?? 'shortfall',
        corrections: options?.corrections ?? [],
        enabled: true,
        savingsMinimumCents: 100000,
        timing: 'standard',
      };
      const snapshot = await (
        options && !this.sessionBound && !sandbox
          ? new FixtureBankProvider(options.scenario)
          : this.bank
      ).getSnapshot(ownerId);
      const plan =
        this.sessionPlan ??
        buildFundingPlan(ownerId, snapshot, config, DEMO_NOW);
      const source = snapshot.accounts.find(
        (a) => a.id === plan.sourceAccountId,
      );
      const destination = snapshot.accounts.find(
        (a) => a.id === plan.destinationAccountId,
      );
      return {
        ...base,
        asOf: snapshot.asOf,
        reads: ['get_funding_proposal'],
        text:
          plan.status === 'proposed'
            ? `A demo proposal would move ${formatMoney(plan.amountCents)} from ${source?.name} to ${destination?.name}. Estimated arrival: ${plan.expectedArrival}, before the earliest projected shortage on ${plan.neededBefore}. Savings would retain ${formatMoney(plan.remainingSavingsCents!)} above your ${formatMoney(plan.savingsMinimumCents)} minimum.\n\nTiming is simulated, not a bank quote. This is a deterministic proposal only, not approval. No transfer was created; the bill is not yet covered.`
            : `${plan.reason}\n\nNo transfer was created. These are deterministic demo checks, not live AI decisions.`,
      };
    }
    if (
      sandbox &&
      !/\b(roth|ira|invest|retirement|growth)\b/.test(query) &&
      (/\b(bill|bills|forecast|shortfall|subscription|subscriptions|afford|cover|funding|proposal)\b/.test(
        query,
      ) ||
        (/\b(should|suggest|recommend|consider)\b|how much/.test(query) &&
          /\b(transfer|move|savings)\b/.test(query)))
    ) {
      const snapshot = await this.bank.getSnapshot(ownerId);
      const checking = snapshot.accounts.find(
        (account) => account.kind === 'checking',
      );
      if (!checking) throw new Error('Checking account unavailable');
      const forecast =
        this.observedForecast ??
        buildForecast(
          snapshot,
          checking.id,
          new Date().toISOString(),
          options?.corrections,
        );
      const summary =
        forecast.shortageCents > 0
          ? `Checking is projected to fall below zero on ${forecast.firstShortfall}, with a maximum shortage of ${formatMoney(forecast.shortageCents)} over 14 days.`
          : `Checking is projected to end the 14 days at ${formatMoney(forecast.endingCents)} after the detected bills.`;
      return {
        ...base,
        asOf: snapshot.asOf,
        reads: ['get_forecast', 'get_accounts'],
        text: `Using the displayed Plaid Sandbox observation: ${summary}\n\n${explainBillSuggestion(buildBillSuggestion(snapshot, forecast))}${forecast.warnings.length ? `\n\n${forecast.warnings.join(' ')}` : ''}`,
      };
    }
    if (/\b(transfer|move|send|approve)\b|\bpay\s+(?:\$|\d)/.test(query)) {
      return {
        ...base,
        text: sandbox
          ? 'This view is read-only. No transfer was created. I can suggest how to cover upcoming bills or plan savings contributions; you decide whether to act in your bank app.'
          : /\b(roth|ira|invest|investing|retirement|save|goals)\b|high[- ]yield/.test(
                query,
              )
            ? 'Chat cannot authorize contributions. No transfer was created. Savings and Roth amounts are planning previews; contribution execution is not connected.'
            : 'Chat cannot authorize money movement. No transfer was created. Review the exact amount and accounts in the approval card to create a clearly labeled local simulation.',
      };
    }
    if (
      /\b(roth|ira|invest|investing|retirement|save|growth|goals|allocate)\b|high[- ]yield/.test(
        query,
      )
    ) {
      return {
        ...base,
        asOf: this.growthPlan?.asOf ?? null,
        reads: this.growthPlan ? ['get_growth_plan'] : [],
        text: this.growthPlan
          ? explainGrowthPlan(this.growthPlan)
          : 'Open the Save and invest planner to review your spending reserve, savings goal and Roth details. A 14-day bill forecast alone cannot establish an amount to invest. The planner uses your displayed test balances and entered assumptions.',
      };
    }
    if (
      /\b(bill|bills|forecast|shortfall|subscription|subscriptions|afford|cover|funding|proposal)\b/.test(
        query,
      )
    ) {
      const snapshot = await (
        options && !this.sessionBound && !sandbox
          ? new FixtureBankProvider(options.scenario)
          : this.bank
      ).getSnapshot(ownerId);
      const account = snapshot.accounts.find(
        (entry) => entry.kind === 'checking',
      );
      if (!account) throw new Error('Checking account unavailable');
      const forecast =
        this.observedForecast ??
        buildForecast(
          snapshot,
          account.id,
          sandbox ? new Date().toISOString() : DEMO_NOW,
          options?.corrections,
        );
      const summary =
        forecast.shortageCents > 0
          ? `Checking is projected to fall below zero on ${forecast.firstShortfall}, with a maximum shortage of ${formatMoney(forecast.shortageCents)} over 14 days.`
          : `Checking is projected to end the 14 days at ${formatMoney(forecast.endingCents)} after the detected bills.`;
      return {
        ...base,
        asOf: snapshot.asOf,
        reads: ['get_forecast'],
        text: `${summary}\n\n${forecast.warnings.join(' ')}\n\n${sandbox ? `This is a deterministic forecast of Plaid Sandbox test data evaluated at ${forecast.evaluatedAt}, with your current corrections. Provider transfers are not connected.` : 'This is a deterministic forecast of synthetic data using the September 8 demo clock and your current corrections.'} It excludes unrecorded spending and unconfirmed income. No transfer was created.`,
      };
    }
    if (
      !/\b(balance|balances|account|accounts|checking|saving|savings|money|funds|available|pending|transaction|transactions|activity|spent)\b/.test(
        query,
      )
    ) {
      return {
        ...base,
        text: 'I’m a mock assistant with a few supported questions. Try “What are my balances?”, “Why is my available balance lower?”, or “Show recent transactions”. Live AI is a separate setup step.',
      };
    }
    const snapshot = await (
      options && !this.sessionBound && !sandbox
        ? new FixtureBankProvider(options.scenario)
        : this.bank
    ).getSnapshot(ownerId);
    const context = { ...base, asOf: snapshot.asOf };
    const asksSavings = /\b(saving|savings)\b/.test(query);
    const asksChecking = /\bchecking\b/.test(query);
    const accounts = snapshot.accounts.filter((account) =>
      asksSavings !== asksChecking
        ? account.kind === (asksSavings ? 'savings' : 'checking')
        : true,
    );
    if (/\b(transaction|transactions|activity|spent)\b/.test(query)) {
      const ids = new Set(accounts.map((account) => account.id));
      const transactions = snapshot.transactions
        .filter((txn) => ids.has(txn.accountId))
        .slice(0, 5);
      return {
        ...context,
        reads: ['get_transactions'],
        text: transactions.length
          ? transactions
              .map(
                (txn) =>
                  `${txn.merchant}: ${formatMoney(txn.amountCents)} (${txn.status}, ${txn.date.slice(0, 10)}).`,
              )
              .join('\n')
          : `There are no transactions for this account in the ${sandbox ? 'Plaid Sandbox' : 'synthetic'} history.`,
      };
    }
    const text = accounts
      .map((account) => {
        const difference = account.currentCents - account.availableCents;
        return `${account.name}: ${formatMoney(account.availableCents)} available; ${formatMoney(account.currentCents)} current balance.${difference > 0 ? ` The ${formatMoney(difference)} difference is already reflected in the available balance; do not subtract it again.` : ''}`;
      })
      .join('\n\n');
    return {
      ...context,
      reads: ['get_accounts'],
      text: `${text}\n\n${sandbox ? `These are Plaid Sandbox test balances observed at ${snapshot.asOf}. Pending-transaction balance treatment is not assumed.` : `These are synthetic balances from the ${snapshot.asOf.slice(0, 10)} demo snapshot.`}`,
    };
  }
}
