import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BankDataProvider, BankSnapshot } from '../lib/contracts.ts';
import {
  PlaidSandboxProvider,
  PLAID_DEMO_OWNER_ID,
  plaidCents,
  SandboxError,
} from '../lib/server/plaid-bank.ts';
import {
  SandboxObservations,
  sandboxForecast,
  parseSandboxInput,
  sandboxErrorResponse,
} from '../lib/server/sandbox-view.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { applySessionTransfers } from '../lib/server/session-bank.ts';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { GET, POST } from '../app/api/sandbox/route.ts';
import { POST as chat } from '../app/api/sandbox/assistant/route.ts';

const now = '2026-09-09T01:30:00.000Z';
const credentials = {
  clientId: 'test-client',
  secret: 'private-secret-marker',
  accessToken: 'access-sandbox-private-token-marker',
};
function account(
  accountId = 'checking',
  subtype = 'checking',
  available: number | null = 100,
) {
  return {
    account_id: accountId,
    name: `Test ${subtype}`,
    mask: '1234',
    type: 'depository',
    subtype,
    balances: {
      available,
      current: 110,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
    },
  };
}
function transaction(transactionId: string, extra = {}) {
  return {
    transaction_id: transactionId,
    account_id: 'checking',
    amount: 12.34,
    name: 'Test merchant',
    merchant_name: null,
    date: '2026-09-07',
    pending: false,
    pending_transaction_id: null,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    ...extra,
  };
}
function page(added: unknown[] = [], extra = {}) {
  return {
    added,
    modified: [],
    removed: [],
    next_cursor: 'done',
    has_more: false,
    transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
    ...extra,
  };
}
function fakeProvider(
  options: {
    pages?: unknown[];
    accounts?: unknown[];
    updatedAt?: string | null;
    onRequest?: (path: string, body: Record<string, unknown>) => void;
  } = {},
) {
  const pages = [...(options.pages ?? [page()])];
  const request: typeof fetch = async (url, init) => {
    const address = new URL(url instanceof Request ? url.url : url);
    assert.equal(address.origin, 'https://sandbox.plaid.com');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    const body = JSON.parse(init!.body as string);
    assert.equal(body.access_token, credentials.accessToken);
    options.onRequest?.(address.pathname, body);
    let result: unknown;
    if (address.pathname === '/transactions/sync') result = pages.shift();
    else if (address.pathname === '/item/get')
      result = {
        item: { item_id: 'item', error: null },
        status: {
          transactions: {
            last_successful_update:
              options.updatedAt === undefined ? now : options.updatedAt,
          },
        },
      };
    else if (address.pathname === '/accounts/balance/get')
      result = {
        item: { item_id: 'item' },
        accounts: options.accounts ?? [
          account(),
          account('savings', 'savings', 200),
        ],
      };
    else assert.fail(`Unexpected endpoint ${address.pathname}`);
    assert.notEqual(result, undefined);
    if (result instanceof Response) return result;
    return Response.json(result);
  };
  return new PlaidSandboxProvider(credentials, request, () => new Date(now));
}
async function monthlySnapshot(): Promise<BankSnapshot> {
  const snapshot = await new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
  snapshot.source = 'plaid_sandbox';
  snapshot.accounts.forEach((a) => {
    a.ownerId = PLAID_DEMO_OWNER_ID;
  });
  snapshot.transactions = snapshot.transactions.filter(
    (t) => t.status === 'posted',
  );
  snapshot.coverage = {
    totalAccounts: 14,
    excludedAccounts: 12,
    historyComplete: true,
    transactionsUpdatedAt: DEMO_NOW,
    warnings: [],
  };
  return snapshot;
}

void test('Plaid money conversion preserves cents and rejects unavailable, unsafe and fractional-cent values', () => {
  for (const [value, expected] of [
    [1.01, 101],
    [12.34, 1234],
    [-19.99, -1999],
    [0, 0],
    [100, 10000],
  ])
    assert.equal(plaidCents(value), expected);
  for (const value of [
    null,
    NaN,
    Infinity,
    1.001,
    1e20,
    Number.MAX_SAFE_INTEGER,
  ])
    assert.throws(() => plaidCents(value));
});

void test('provider stays owner-bound and Sandbox-only before any request', async () => {
  let calls = 0;
  const provider = fakeProvider({
    onRequest: () => {
      calls++;
    },
  });
  await assert.rejects(
    provider.getSnapshot('browser-supplied-owner'),
    /UNKNOWN_OWNER/,
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      new PlaidSandboxProvider({
        ...credentials,
        accessToken: 'access-production-no',
      }),
    /NOT_CONFIGURED/,
  );
});

void test('complete sync applies modifications, removals and pending replacements before publishing scoped USD data', async () => {
  const snapshot = await fakeProvider({
    accounts: [
      account(),
      account('savings', 'savings'),
      { ...account('credit'), type: 'credit' },
      {
        ...account('euro'),
        balances: { ...account().balances, iso_currency_code: 'EUR' },
      },
    ],
    pages: [
      page(
        [
          transaction('pending', { pending: true }),
          transaction('remove'),
          transaction('modify'),
          transaction('credit-only', { account_id: 'credit' }),
        ],
        { has_more: true, next_cursor: 'page2' },
      ),
      page(
        [
          transaction('posted', { pending_transaction_id: 'pending' }),
          transaction('income', { amount: -50 }),
        ],
        {
          modified: [transaction('modify', { amount: 17.23 })],
          removed: [{ transaction_id: 'remove', account_id: 'checking' }],
        },
      ),
    ],
  }).getSnapshot(PLAID_DEMO_OWNER_ID);
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(snapshot.coverage?.excludedAccounts, 2);
  assert.equal(snapshot.accounts[0].availableCents, 10000);
  assert.equal(snapshot.accounts[0].observedAt, now);
  assert.equal(snapshot.transactions.length, 3);
  assert.equal(
    snapshot.transactions.find((t) => t.id === 'modify')?.amountCents,
    -1723,
  );
  assert.equal(
    snapshot.transactions.find((t) => t.id === 'income')?.amountCents,
    5000,
  );
  assert.equal(
    snapshot.transactions.find((t) => t.id === 'posted')?.pendingTransactionId,
    'pending',
  );
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /private-(?:secret|token)-marker/,
  );
});

void test('unknown pending balance effects, missing history and stale history cannot produce a confident forecast', async () => {
  const pending = await fakeProvider({
    pages: [page([transaction('pending', { pending: true })])],
  }).getSnapshot(PLAID_DEMO_OWNER_ID);
  assert.equal(pending.transactions[0].availableBalanceEffect, 'unknown');
  const report = buildForecast(pending, 'checking', now);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.startingCents, 10000);
  assert.match(report.warnings.join(' '), /balance treatment.*unknown/);
  const monthly = await monthlySnapshot();
  monthly.coverage!.historyComplete = false;
  assert.equal(
    buildForecast(monthly, 'demo-checking', DEMO_NOW).status,
    'incomplete',
  );
  monthly.coverage!.historyComplete = true;
  monthly.coverage!.transactionsUpdatedAt = '2026-09-05T00:00:00.000Z';
  assert.equal(
    buildForecast(monthly, 'demo-checking', DEMO_NOW).status,
    'stale',
  );
  monthly.coverage!.transactionsUpdatedAt = null;
  assert.equal(
    buildForecast(monthly, 'demo-checking', DEMO_NOW).status,
    'incomplete',
  );
});

void test('provider rejects missing balances, invalid currency, cursor loops and malformed responses without leaking details', async () => {
  await assert.rejects(
    fakeProvider({
      accounts: [account('checking', 'checking', null)],
    }).getSnapshot(PLAID_DEMO_OWNER_ID),
    /BALANCE_UNAVAILABLE/,
  );
  await assert.rejects(
    fakeProvider({
      pages: [
        page([transaction('wrong-currency', { iso_currency_code: 'EUR' })]),
      ],
    }).getSnapshot(PLAID_DEMO_OWNER_ID),
    /INVALID_CURRENCY/,
  );
  await assert.rejects(
    fakeProvider({
      pages: [
        page([], { has_more: true, next_cursor: 'loop' }),
        page([], { has_more: true, next_cursor: 'loop' }),
      ],
    }).getSnapshot(PLAID_DEMO_OWNER_ID),
    /INVALID_CURSOR/,
  );
  await assert.rejects(
    fakeProvider({ pages: [{ secret: credentials.secret }] }).getSnapshot(
      PLAID_DEMO_OWNER_ID,
    ),
    /INVALID_PROVIDER_DATA/,
  );
  const response = sandboxErrorResponse(new Error(credentials.secret));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-secret-marker/);
});

void test('a pagination mutation restarts from the original cursor once and discards the abandoned pages', async () => {
  const cursors: unknown[] = [];
  const snapshot = await fakeProvider({
    pages: [
      page([transaction('abandoned')], { has_more: true, next_cursor: 'next' }),
      Response.json(
        { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' },
        { status: 400 },
      ),
      page([transaction('final')]),
    ],
    onRequest: (path, body) => {
      if (path === '/transactions/sync') cursors.push(body.cursor);
    },
  }).getSnapshot(PLAID_DEMO_OWNER_ID);
  assert.deepEqual(cursors, ['', 'next', '']);
  assert.deepEqual(
    snapshot.transactions.map((t) => t.id),
    ['final'],
  );
  const errors = [0, 1].map(() =>
    Response.json(
      { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' },
      { status: 400 },
    ),
  );
  await assert.rejects(
    fakeProvider({ pages: errors }).getSnapshot(PLAID_DEMO_OWNER_ID),
    /SYNC_CHANGED/,
  );
});

void test('observations deduplicate concurrent reads, isolate returned values, and retain the displayed version across failed refreshes', async () => {
  let clock = Date.parse(DEMO_NOW);
  let reads = 0;
  let reject = false;
  const bank: BankDataProvider = {
    source: 'plaid_sandbox',
    getSnapshot: async () => {
      reads++;
      if (reject) throw new SandboxError();
      return monthlySnapshot();
    },
  };
  const cache = new SandboxObservations(bank, () => clock);
  const [a, b] = await Promise.all([cache.latest(), cache.latest()]);
  assert.equal(reads, 1);
  assert.equal(a.id, b.id);
  a.snapshot.accounts[0].availableCents = 999999;
  assert.equal(cache.read(b.id).snapshot.accounts[0].availableCents, 14860);
  clock += 60_001;
  reject = true;
  await assert.rejects(cache.latest());
  assert.equal(reads, 2);
  await assert.rejects(cache.latest(), /RETRY_LATER/);
  assert.equal(reads, 2);
  assert.equal(sandboxForecast(cache.read(b.id)).forecast.startingCents, 14860);
  clock += 15 * 60_000;
  assert.throws(() => cache.read(b.id), /SNAPSHOT_EXPIRED/);
});

void test('Sandbox API and chat use the same corrected observation, reject unknown scope and never enable local settlement', async () => {
  const global = globalThis as typeof globalThis & {
    pennyAheadSandboxObservations?: SandboxObservations;
  };
  const previous = global.pennyAheadSandboxObservations;
  const enabled = process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED;
  try {
    process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED = 'true';
    global.pennyAheadSandboxObservations = new SandboxObservations(
      { source: 'plaid_sandbox', getSnapshot: monthlySnapshot },
      () => Date.parse(DEMO_NOW),
    );
    const initial = await GET();
    assert.equal(initial.headers.get('Cache-Control'), 'no-store');
    const demo = await initial.json();
    const bill = demo.forecast.bills.find(
      (b: { merchant: string }) => b.merchant === 'Adobe Creative Cloud',
    );
    const input = {
      snapshotId: demo.snapshotId,
      corrections: [
        {
          billId: bill.id,
          amountCents: 5999,
          nextDate: '2026-09-25',
          enabled: true,
        },
      ],
    };
    const corrected = await POST(
      new Request('http://localhost/api/sandbox', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    assert.equal(corrected.status, 200);
    assert.equal((await corrected.json()).forecast.endingCents, 2463);
    const answer = await chat(
      new Request('http://localhost/api/sandbox/assistant', {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          message: 'Will my bills be covered?',
        }),
      }),
    );
    assert.equal(answer.status, 200);
    const reply = await answer.json();
    assert.equal(reply.source, 'plaid_sandbox');
    assert.match(reply.text, /14 days at \$24\.63/);
    assert.match(reply.text, /Plaid Sandbox/);
    assert.doesNotMatch(reply.text, /September 8 demo clock/);
    const transfer = await chat(
      new Request('http://localhost/api/sandbox/assistant', {
        method: 'POST',
        body: JSON.stringify({ ...input, message: 'Transfer $50' }),
      }),
    );
    assert.match(
      (await transfer.json()).text,
      /read-only.*No transfer was created/,
    );
    assert.throws(
      () => applySessionTransfers(demo.snapshot, [], 0),
      /cannot modify provider/,
    );
    const expired = await POST(
      new Request('http://localhost/api/sandbox', {
        method: 'POST',
        body: JSON.stringify({ ...input, snapshotId: 'unknown' }),
      }),
    );
    assert.equal(expired.status, 409);
    for (const extra of [
      { ownerId: 'other' },
      { accessToken: 'other' },
      { scenario: 'sufficient' },
    ])
      assert.throws(
        () => parseSandboxInput({ ...input, ...extra }),
        /INVALID_INPUT/,
      );
    process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED = 'false';
    assert.equal((await GET()).status, 503);
  } finally {
    global.pennyAheadSandboxObservations = previous;
    if (enabled === undefined)
      delete process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED;
    else process.env.PENNYAHEAD_PLAID_SANDBOX_ENABLED = enabled;
  }
});
