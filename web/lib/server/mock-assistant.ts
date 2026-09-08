import type {
  Assistant,
  AssistantReply,
  BankDataProvider,
  DemoOptions,
} from '../contracts.ts';
import { formatMoney } from '../money.ts';
import { buildForecast } from './forecast.ts';
import { FixtureBankProvider, DEMO_NOW } from './fixtures.ts';

/** Deliberately deterministic. Replace this adapter in M1b. */
export class MockAssistant implements Assistant {
  private bank: BankDataProvider;
  constructor(bank: BankDataProvider) {
    this.bank = bank;
  }

  async reply(
    ownerId: string,
    message: string,
    options?: DemoOptions,
  ): Promise<AssistantReply> {
    const query = message.trim().toLowerCase();
    const base: AssistantReply = {
      mode: 'mock',
      source: this.bank.source,
      text: '',
      asOf: null,
      reads: [],
    };
    if (/\b(transfer|move|send|approve)\b|\bpay\s+(?:\$|\d)/.test(query)) {
      return {
        ...base,
        text: 'Money movement is not available in this demo. No transfer was created. Approved sandbox transfers are planned for a later milestone.',
      };
    }
    if (
      /\b(bill|bills|forecast|shortfall|subscription|subscriptions|afford)\b/.test(
        query,
      )
    ) {
      const snapshot = await (
        options ? new FixtureBankProvider(options.scenario) : this.bank
      ).getSnapshot(ownerId);
      const account = snapshot.accounts.find(
        (entry) => entry.kind === 'checking',
      );
      if (!account) throw new Error('Checking account unavailable');
      const forecast = buildForecast(
        snapshot,
        account.id,
        DEMO_NOW,
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
        text: `${summary}\n\n${forecast.warnings.join(' ')}\n\nThis is a deterministic forecast of synthetic data using the September 8 demo clock and your current corrections. It excludes unrecorded spending and unconfirmed income. No transfer was created.`,
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
      options ? new FixtureBankProvider(options.scenario) : this.bank
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
          : 'There are no transactions for this account in the synthetic history.',
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
      text: `${text}\n\nThese are synthetic balances from the ${snapshot.asOf.slice(0, 10)} demo snapshot.`,
    };
  }
}
