import { z } from 'zod';
import type {
  BankDataProvider,
  BankSnapshot,
  Transaction,
} from '../contracts.ts';
import { validDate, reconcileTransactions } from './forecast.ts';

// One operator-configured, synthetic Sandbox Item. This is not customer authentication.
export const PLAID_DEMO_OWNER_ID = 'plaid-sandbox-demo';
export class SandboxError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code = 'UNAVAILABLE', status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const plaidSandboxEnabled = () =>
  process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED === 'true';
const id = z.string().min(1).max(300);
const instant = z.iso.datetime({ offset: true });
const accountSchema = z.object({
  account_id: id,
  name: z.string().min(1).max(300),
  mask: z.string().max(10).nullable(),
  type: z.string(),
  subtype: z.string().nullable(),
  balances: z.object({
    available: z.number().nullable(),
    current: z.number().nullable(),
    iso_currency_code: z.string().nullable(),
    unofficial_currency_code: z.string().nullable(),
    last_updated_datetime: instant.nullable().optional(),
  }),
});
const transactionSchema = z.object({
  transaction_id: id,
  account_id: id,
  amount: z.number(),
  name: z.string().max(500),
  merchant_name: z.string().max(500).nullable(),
  date: z.string().refine(validDate),
  pending: z.boolean(),
  pending_transaction_id: id.nullable(),
  iso_currency_code: z.string().nullable(),
  unofficial_currency_code: z.string().nullable(),
});
const syncSchema = z.object({
  added: z.array(transactionSchema).max(500),
  modified: z.array(transactionSchema).max(500),
  removed: z.array(z.object({ transaction_id: id, account_id: id })).max(500),
  next_cursor: z.string().max(10000),
  has_more: z.boolean(),
  transactions_update_status: z.enum([
    'TRANSACTIONS_UPDATE_STATUS_UNKNOWN',
    'NOT_READY',
    'INITIAL_UPDATE_COMPLETE',
    'HISTORICAL_UPDATE_COMPLETE',
  ]),
});
const balanceSchema = z.object({
  accounts: z.array(accountSchema).max(100),
  item: z.object({ item_id: id }),
});
const itemSchema = z.object({
  item: z.object({ item_id: id, error: z.unknown().nullable().optional() }),
  status: z
    .object({
      transactions: z
        .object({ last_successful_update: instant.nullable() })
        .nullable()
        .optional(),
    })
    .nullable(),
});

/** Convert the decimal representation exactly; never silently round fractional cents or substitute null. */
export function plaidCents(value: number | null): number {
  if (value === null || !Number.isFinite(value))
    throw new SandboxError('BALANCE_UNAVAILABLE');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new SandboxError('INVALID_MONEY');
  const cents = Number(
    `${match[1]}${match[2]}${(match[3] ?? '').padEnd(2, '0')}`,
  );
  if (!Number.isSafeInteger(cents)) throw new SandboxError('INVALID_MONEY');
  return cents;
}

export class PlaidSandboxProvider implements BankDataProvider {
  readonly source = 'plaid_sandbox' as const;
  private credentials: {
    clientId: string;
    secret: string;
    accessToken: string;
  };
  private request: typeof fetch;
  private now: () => Date;
  constructor(
    credentials: { clientId: string; secret: string; accessToken: string },
    request: typeof fetch = fetch,
    now: () => Date = () => new Date(),
  ) {
    if (
      !credentials.clientId ||
      !credentials.secret ||
      !credentials.accessToken.startsWith('access-sandbox-')
    )
      throw new SandboxError('NOT_CONFIGURED');
    this.credentials = credentials;
    this.request = request;
    this.now = now;
  }
  private async call(
    path: string,
    body: object,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await this.request(`https://sandbox.plaid.com${path}`, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Plaid-Version': '2020-09-14',
        },
        body: JSON.stringify({
          ...body,
          client_id: this.credentials.clientId,
          secret: this.credentials.secret,
          access_token: this.credentials.accessToken,
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error_code?: unknown };
        // Allowlist useful states. Never forward provider messages, bodies or credentials.
        if (error.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')
          throw new SandboxError('SYNC_CHANGED');
        if (error.error_code === 'ITEM_LOGIN_REQUIRED')
          throw new SandboxError('RECONNECT_REQUIRED');
        if (error.error_code === 'PRODUCT_NOT_READY')
          throw new SandboxError('HISTORY_LOADING');
        throw new SandboxError();
      }
      return await response.json();
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError();
    }
  }
  async getSnapshot(ownerId: string): Promise<BankSnapshot> {
    if (ownerId !== PLAID_DEMO_OWNER_ID)
      throw new SandboxError('UNKNOWN_OWNER', 403);
    const signal = AbortSignal.timeout(35000);
    try {
      // Build a complete candidate in memory. Never publish partial pagination or a failed refresh.
      let records = new Map<string, z.infer<typeof transactionSchema>>();
      let historyComplete = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        records = new Map();
        let cursor = '';
        const seen = new Set<string>();
        try {
          for (let page = 0; ; page++) {
            if (page >= 20) throw new SandboxError('HISTORY_TOO_LARGE');
            const result = syncSchema.parse(
              await this.call(
                '/transactions/sync',
                { cursor, count: 500 },
                signal,
              ),
            );
            for (const txn of [...result.added, ...result.modified])
              records.set(`${txn.account_id}:${txn.transaction_id}`, txn);
            for (const txn of result.removed)
              records.delete(`${txn.account_id}:${txn.transaction_id}`);
            if (!result.has_more) {
              historyComplete =
                result.transactions_update_status ===
                'HISTORICAL_UPDATE_COMPLETE';
              break;
            }
            if (
              !result.next_cursor ||
              result.next_cursor === cursor ||
              seen.has(result.next_cursor)
            )
              throw new SandboxError('INVALID_CURSOR');
            seen.add(result.next_cursor);
            cursor = result.next_cursor;
          }
          break;
        } catch (error) {
          if (
            attempt === 0 &&
            error instanceof SandboxError &&
            error.code === 'SYNC_CHANGED'
          )
            continue;
          throw error;
        }
      }
      const item = itemSchema.parse(await this.call('/item/get', {}, signal));
      if (item.item.error) throw new SandboxError('RECONNECT_REQUIRED');
      const observedAt = this.now().toISOString();
      const balances = balanceSchema.parse(
        await this.call('/accounts/balance/get', {}, signal),
      );
      if (balances.item.item_id !== item.item.item_id)
        throw new SandboxError('ITEM_MISMATCH');
      const supported = balances.accounts.filter(
        (a) =>
          a.type === 'depository' &&
          (a.subtype === 'checking' || a.subtype === 'savings') &&
          a.balances.iso_currency_code === 'USD' &&
          a.balances.unofficial_currency_code === null,
      );
      const accounts = supported.map((a) => ({
        id: a.account_id,
        ownerId,
        name: a.name,
        kind: a.subtype as 'checking' | 'savings',
        currency: 'USD' as const,
        currentCents: plaidCents(a.balances.current),
        availableCents: plaidCents(a.balances.available),
        mask: a.mask ?? '',
        observedAt: a.balances.last_updated_datetime ?? observedAt,
      }));
      if (!accounts.some((a) => a.kind === 'checking'))
        throw new SandboxError('CHECKING_UNAVAILABLE');
      if (new Set(accounts.map((a) => a.id)).size !== accounts.length)
        throw new SandboxError('INVALID_ACCOUNTS');
      const accountIds = new Set(accounts.map((a) => a.id));
      const transactions: Transaction[] = [...records.values()]
        .filter((t) => accountIds.has(t.account_id))
        .map((t) => {
          if (
            t.iso_currency_code !== 'USD' ||
            t.unofficial_currency_code !== null
          )
            throw new SandboxError('INVALID_CURRENCY');
          return {
            id: t.transaction_id,
            accountId: t.account_id,
            merchant: t.merchant_name || t.name || 'Unnamed transaction',
            amountCents: -plaidCents(t.amount),
            date: `${t.date}T00:00:00.000Z`,
            status: t.pending ? 'pending' : 'posted',
            ...(t.pending_transaction_id
              ? { pendingTransactionId: t.pending_transaction_id }
              : {}),
            ...(t.pending
              ? { availableBalanceEffect: 'unknown' as const }
              : {}),
          };
        });
      return {
        source: this.source,
        asOf: observedAt,
        accounts,
        transactions: reconcileTransactions(transactions).sort(
          (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
        ),
        coverage: {
          totalAccounts: balances.accounts.length,
          excludedAccounts: balances.accounts.length - accounts.length,
          historyComplete,
          transactionsUpdatedAt:
            item.status?.transactions?.last_successful_update ?? null,
          warnings: [],
        },
      };
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError('INVALID_PROVIDER_DATA');
    }
  }
}

export function configuredPlaidProvider(): PlaidSandboxProvider {
  if (!plaidSandboxEnabled() || process.env.PLAID_ENV !== 'sandbox')
    throw new SandboxError('NOT_CONFIGURED');
  return new PlaidSandboxProvider({
    clientId: process.env.PLAID_CLIENT_ID ?? '',
    secret: process.env.PLAID_SECRET ?? '',
    accessToken: process.env.PLAID_ACCESS_TOKEN ?? '',
  });
}
