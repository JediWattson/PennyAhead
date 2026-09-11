import { z } from 'zod';
import type { BrokerConnection } from '../broker-contracts.ts';

// No configurable host: this adapter can never target a funded production account.
const API = 'https://broker-api.sandbox.alpaca.markets';
const AUTH = 'https://authx.sandbox.alpaca.markets/v1/oauth2/token';
const accountSchema = z.object({
  id: z.uuid(),
  account_number: z.string().nullable().optional(),
  status: z.string().max(100),
  account_type: z.string().nullish(),
  account_sub_type: z.string().nullish(),
});
const tradingSchema = z.object({
  id: z.uuid(),
  status: z.string().max(100),
  currency: z.literal('USD'),
  cash: z.string().nullable().optional(),
  portfolio_value: z.string().nullable().optional(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().min(30).max(3600),
});

export class BrokerError extends Error {
  readonly code:
    | 'AUTH_FAILED'
    | 'ACCESS_DENIED'
    | 'UNAVAILABLE'
    | 'INVALID_DATA';
  constructor(code: BrokerError['code']) {
    super(code);
    this.code = code;
  }
}

/** Broker decimals are display observations only, never authority to trade. */
function displayCents(value: string | null | undefined): number | null {
  if (value == null) return null;
  if (!/^-?\d{1,12}(?:\.\d{1,18})?$/.test(value))
    throw new BrokerError('INVALID_DATA');
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount)) throw new BrokerError('INVALID_DATA');
  return amount;
}

export class AlpacaSandboxBroker {
  private token: { value: string; expires: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private credentials: { keyId: string; secretKey: string; accountId?: string };
  private request: typeof fetch;
  private now: () => number;
  constructor(
    credentials: { keyId: string; secretKey: string; accountId?: string },
    request: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    if (
      !credentials.keyId.trim() ||
      !credentials.secretKey.trim() ||
      (credentials.accountId &&
        !z.uuid().safeParse(credentials.accountId).success)
    )
      throw new BrokerError('AUTH_FAILED');
    this.credentials = credentials;
    this.request = request;
    this.now = now;
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > this.now()) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const response = await this.request(AUTH, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.credentials.keyId,
          client_secret: this.credentials.secretKey,
        }),
      });
      if (!response.ok) throw new BrokerError('AUTH_FAILED');
      const token = tokenSchema.parse(await response.json());
      this.token = {
        value: token.access_token,
        expires: this.now() + (token.expires_in - 20) * 1000,
      };
      return token.access_token;
    })();
    try {
      return await this.pendingToken;
    } finally {
      this.pendingToken = null;
    }
  }
  private async read(path: string): Promise<unknown> {
    const token = await this.accessToken();
    const response = await this.request(API + path, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      this.token = null;
      throw new BrokerError('AUTH_FAILED');
    }
    if (response.status === 403) throw new BrokerError('ACCESS_DENIED');
    if (!response.ok) throw new BrokerError('UNAVAILABLE');
    return response.json();
  }
  async connection(): Promise<BrokerConnection> {
    const base: BrokerConnection = {
      source: 'alpaca_sandbox',
      status: 'unavailable',
      message: '',
      observedAt: null,
      account: null,
      execution: 'not_connected',
    };
    try {
      const accounts = z
        .array(accountSchema)
        .max(10000)
        .parse(await this.read('/v1/accounts'));
      const roth = accounts.filter(
        (a) => a.account_type === 'ira' && a.account_sub_type === 'roth',
      );
      const chosenId =
        this.credentials.accountId ??
        (roth.length === 1
          ? roth[0].id
          : accounts.length === 1
            ? accounts[0].id
            : undefined);
      const observedAt = new Date(this.now()).toISOString();
      if (!chosenId) {
        const needsSelection =
          roth.length > 1 ||
          accounts.some(
            (a) =>
              !a.account_type ||
              (a.account_type === 'ira' && !a.account_sub_type),
          );
        return {
          ...base,
          observedAt,
          status: needsSelection ? 'choose_account' : 'needs_roth',
          message: needsSelection
            ? 'Alpaca Sandbox is connected. Select a test Roth account in the server configuration.'
            : 'Alpaca Sandbox is connected, but no Roth IRA is available. IRA access and account-creation permission must be enabled before a test Roth can be created.',
        };
      }
      if (!accounts.some((a) => a.id === chosenId))
        throw new BrokerError('INVALID_DATA');
      const chosen = accountSchema.parse(
        await this.read(`/v1/accounts/${chosenId}`),
      );
      if (
        chosen.id !== chosenId ||
        chosen.account_type !== 'ira' ||
        chosen.account_sub_type !== 'roth'
      )
        return {
          ...base,
          observedAt,
          message:
            'The selected account could not be verified as a Roth IRA. Check the Sandbox account selection.',
        };
      const trading = tradingSchema.parse(
        await this.read(`/v1/trading/accounts/${chosen.id}/account`),
      );
      if (trading.id !== chosen.id) throw new BrokerError('INVALID_DATA');
      return {
        ...base,
        status: 'connected',
        observedAt,
        message:
          'Test Roth account verified with Alpaca. These are Sandbox observations; contributions and direct orders are not enabled in PennyAhead.',
        account: {
          mask: chosen.account_number?.slice(-4) ?? '',
          status: trading.status,
          cashCents: displayCents(trading.cash),
          portfolioValueCents: displayCents(trading.portfolio_value),
        },
      };
    } catch (error) {
      return {
        ...base,
        message:
          error instanceof BrokerError && error.code === 'AUTH_FAILED'
            ? 'Alpaca Sandbox authentication failed. Check the saved client credentials.'
            : error instanceof BrokerError && error.code === 'ACCESS_DENIED'
              ? 'Alpaca denied access. Review the Sandbox credential permissions and IRA enablement.'
              : 'Alpaca Sandbox could not be verified. Retry the connection check.',
      };
    }
  }
}

let cached:
  | {
      keyId: string;
      secretKey: string;
      accountId?: string;
      client: AlpacaSandboxBroker;
    }
  | undefined;
export function configuredBroker(): AlpacaSandboxBroker | null {
  if (process.env.PENNYAHEAD_ALPACA_SANDBOX_ENABLED !== 'true') return null;
  const keyId = process.env.ALPACA_BROKER_SANDBOX_KEY_ID ?? '';
  const secretKey = process.env.ALPACA_BROKER_SANDBOX_SECRET_KEY ?? '';
  const accountId = process.env.ALPACA_BROKER_ROTH_ACCOUNT_ID || undefined;
  if (!keyId || !secretKey) return null;
  if (
    !cached ||
    cached.keyId !== keyId ||
    cached.secretKey !== secretKey ||
    cached.accountId !== accountId
  )
    cached = {
      keyId,
      secretKey,
      accountId,
      client: new AlpacaSandboxBroker({ keyId, secretKey, accountId }),
    };
  return cached.client;
}

export async function brokerConnection(): Promise<BrokerConnection> {
  try {
    const broker = configuredBroker();
    return broker
      ? await broker.connection()
      : {
          source: 'alpaca_sandbox',
          status: 'not_configured',
          message:
            'A brokerage Sandbox connection has not been configured yet.',
          observedAt: null,
          account: null,
          execution: 'not_connected',
        };
  } catch {
    return {
      source: 'alpaca_sandbox',
      status: 'unavailable',
      message: 'Check the Alpaca Sandbox configuration.',
      observedAt: null,
      account: null,
      execution: 'not_connected',
    };
  }
}
