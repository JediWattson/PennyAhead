import type {
  Assistant,
  AssistantReply,
  BankDataProvider,
} from '../contracts.ts';
import { formatMoney } from '../money.ts';

/** Deliberately deterministic. Replace this adapter in M1b. */
export class MockAssistant implements Assistant {
  private bank: BankDataProvider;
  constructor(bank: BankDataProvider) {
    this.bank = bank;
  }

  async reply(ownerId: string, message: string): Promise<AssistantReply> {
    const query = message.trim().toLowerCase();
    const base: AssistantReply = {
      mode: 'mock',
      source: this.bank.source,
      text: '',
      asOf: null,
      reads: [],
    };
    if (/\b(transfer|move|send|pay|approve)\b/.test(query)) {
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
      return {
        ...base,
        text: 'Bill detection and the 14-day forecast are planned for M2. This mock can show balances, pending activity, and recent transactions; it cannot yet tell you whether upcoming bills are covered.',
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
    const snapshot = await this.bank.getSnapshot(ownerId);
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
      text: `${text}\n\nThese are synthetic balances from the fixed September 8 demo snapshot.`,
    };
  }
}
