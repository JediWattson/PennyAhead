import { z } from 'zod';
import type { RothHoldings } from '../investment-contracts.ts';

const id = z.string().min(1).max(300);
const currency = {
  iso_currency_code: z.string().nullable(),
  unofficial_currency_code: z.string().nullable(),
};
const schema = z.object({
  item: z.object({ item_id: id }),
  accounts: z
    .array(
      z.object({
        account_id: id,
        name: z.string().min(1).max(300),
        type: z.string(),
        subtype: z.string().nullable(),
        balances: z.object({ current: z.number().nullable(), ...currency }),
      }),
    )
    .max(100),
  securities: z
    .array(
      z.object({
        security_id: id,
        name: z.string().max(500).nullable(),
        ticker_symbol: z.string().max(100).nullable(),
        is_cash_equivalent: z.boolean().nullable(),
      }),
    )
    .max(10000),
  holdings: z
    .array(
      z.object({
        account_id: id,
        security_id: id,
        institution_value: z.number().min(0),
        institution_price_as_of: z.iso.date().nullable(),
        ...currency,
      }),
    )
    .max(10000),
});

/** Valuations may have sub-cent precision. Round for display only, never for buying power. */
function valuation(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error('Invalid investment valuation');
  return cents;
}

export function normalizeRothHoldings(
  raw: unknown,
  itemId: string,
  retrievedAt: string,
): RothHoldings {
  const data = schema.parse(raw);
  if (data.item.item_id !== itemId) throw new Error('Investment Item mismatch');
  const ids = (values: string[]) => {
    if (new Set(values).size !== values.length)
      throw new Error('Duplicate investment records');
  };
  ids(data.accounts.map((a) => a.account_id));
  ids(data.securities.map((s) => s.security_id));
  ids(data.holdings.map((h) => `${h.account_id}:${h.security_id}`));
  const securities = new Map(data.securities.map((s) => [s.security_id, s]));
  const accounts = data.accounts
    .filter((a) => a.type === 'investment' && a.subtype === 'roth')
    .map((a) => {
      if (
        a.balances.iso_currency_code !== 'USD' ||
        a.balances.unofficial_currency_code !== null
      )
        throw new Error('Unsupported investment currency');
      return {
        id: a.account_id,
        name: a.name,
        valueCents:
          a.balances.current === null ? null : valuation(a.balances.current),
        holdings: data.holdings
          .filter((h) => h.account_id === a.account_id)
          .map((h) => {
            const security = securities.get(h.security_id);
            if (
              !security ||
              h.iso_currency_code !== 'USD' ||
              h.unofficial_currency_code !== null
            )
              throw new Error('Incomplete investment holding');
            return {
              id: h.security_id,
              name: security.name ?? 'Unnamed holding',
              ticker: security.ticker_symbol,
              valueCents: valuation(h.institution_value),
              priceAsOf: h.institution_price_as_of,
              cashEquivalent: security.is_cash_equivalent === true,
            };
          }),
      };
    });
  return {
    status: accounts.length ? 'observed' : 'not_connected',
    source: 'plaid_sandbox',
    retrievedAt,
    accounts,
  };
}
