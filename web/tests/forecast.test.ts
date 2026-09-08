import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import {
  buildForecast,
  detectRecurring,
  reconcileTransactions,
} from '../lib/server/forecast.ts';
import { getDemoForecast } from '../lib/server/demo-forecast.ts';
import { parseMoney } from '../lib/money.ts';
import { POST } from '../app/api/forecast/route.ts';
import { POST as chat } from '../app/api/assistant/route.ts';
import type {
  AssistantReply,
  BankSnapshot,
  BillCorrection,
  DemoForecast,
} from '../lib/contracts.ts';
const seed = () => new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
const forecast = (snapshot: BankSnapshot, corrections: BillCorrection[] = []) =>
  buildForecast(snapshot, 'demo-checking', DEMO_NOW, corrections);

void test('three months of posted evidence detects five bills, not a paycheck, rent, or one-off spending', async () => {
  const bills = detectRecurring(await seed());
  assert.equal(bills.length, 5);
  assert.deepEqual(
    bills.map((bill) => bill.merchant),
    [
      'Netflix',
      'Spotify',
      'Anytime Fitness',
      'Adobe Creative Cloud',
      'iCloud+',
    ],
  );
  assert(bills.every((bill) => bill.evidenceIds.length === 3));
  assert.deepEqual(
    bills.map((bill) => bill.nextDate),
    ['2026-09-10', '2026-09-12', '2026-09-15', '2026-09-18', '2026-09-20'],
  );
});
void test('default scenario projects the exact shortfall without deducting the included $30.50 hold twice', async () => {
  const result = forecast(await seed());
  assert.equal(result.startingCents, 14860);
  assert.equal(result.days.length, 14);
  assert.equal(result.days[0].date, '2026-09-08');
  assert.equal(result.days[13].date, '2026-09-21');
  assert.equal(result.scheduledCents, 18396);
  assert.equal(result.firstShortfall, '2026-09-18');
  assert.equal(result.shortageCents, 3536);
  assert.equal(result.endingCents, -3536);
  assert.equal(result.status, 'shortfall');
});
void test('sufficient funds do not trigger a shortage', async () => {
  const { forecast: result } = await getDemoForecast(DEMO_OWNER_ID, {
    scenario: 'sufficient',
    corrections: [],
  });
  assert.equal(result.status, 'sufficient');
  assert.equal(result.firstShortfall, null);
  assert.equal(result.endingCents, 31604);
  assert.equal(result.shortageCents, 0);
});
void test('uncertain dates expose an earlier possible shortage', async () => {
  const { forecast: result } = await getDemoForecast(DEMO_OWNER_ID, {
    scenario: 'uncertain',
    corrections: [],
  });
  const adobe = result.bills.find(
    (bill) => bill.merchant === 'Adobe Creative Cloud',
  )!;
  assert(adobe.uncertain);
  assert.equal(adobe.earliestDate, '2026-09-16');
  assert.equal(adobe.latestDate, '2026-09-19');
  assert.equal(result.firstShortfall, '2026-09-18');
  assert.equal(result.cautiousFirstShortfall, '2026-09-16');
});
void test('stale and future observations cannot be called sufficient', async () => {
  const stale = await getDemoForecast(DEMO_OWNER_ID, {
    scenario: 'stale',
    corrections: [],
  });
  assert.equal(stale.forecast.status, 'stale');
  assert.equal(stale.forecast.ageHours, 72);
  const data = await seed();
  data.accounts[0].availableCents = 50000;
  data.accounts[0].observedAt = '2026-09-09T16:00:00Z';
  assert.equal(forecast(data).status, 'incomplete');
});
void test('an individually stale account is detected even if snapshot metadata is fresh', async () => {
  const data = await seed();
  data.accounts[0].observedAt = '2026-09-06T16:00:00Z';
  assert.equal(forecast(data).status, 'stale');
});
void test('pending bill already in available balance is not scheduled again', async () => {
  const data = await seed();
  data.accounts[0].availableCents -= 1999;
  data.transactions.push({
    id: 'pending-netflix',
    accountId: 'demo-checking',
    merchant: 'Netflix',
    amountCents: -1999,
    date: DEMO_NOW,
    status: 'pending',
    availableBalanceEffect: 'included',
  });
  const result = forecast(data);
  assert.equal(result.scheduledCents, 16397);
  assert.equal(result.endingCents, -3536);
  assert.equal(
    result.bills.find((bill) => bill.merchant === 'Netflix')
      ?.pendingTransactionId,
    'pending-netflix',
  );
});
void test('pending bill excluded from available funds is deducted exactly once', async () => {
  const data = await seed();
  data.transactions.push({
    id: 'pending-netflix',
    accountId: 'demo-checking',
    merchant: 'Netflix',
    amountCents: -1999,
    date: DEMO_NOW,
    status: 'pending',
    availableBalanceEffect: 'excluded',
  });
  const result = forecast(data);
  assert.equal(result.startingCents, 12861);
  assert.equal(result.scheduledCents, 16397);
  assert.equal(result.endingCents, -3536);
});
void test('unknown pending treatment blocks a sufficiency claim', async () => {
  const data = await seed();
  data.accounts[0].availableCents = 50000;
  delete data.transactions[0].availableBalanceEffect;
  assert.equal(forecast(data).status, 'incomplete');
});
void test('pending credits never count as money received', async () => {
  for (const included of [true, false]) {
    const data = await seed();
    if (included) data.accounts[0].availableCents += 100000;
    data.transactions.push({
      id: 'incoming-transfer',
      accountId: 'demo-checking',
      merchant: 'Transfer from savings',
      amountCents: 100000,
      date: DEMO_NOW,
      status: 'pending',
      availableBalanceEffect: included ? 'included' : 'excluded',
    });
    assert.equal(forecast(data).endingCents, -3536);
  }
});
void test('posted replacement removes its pending record; repeated sync IDs do not duplicate bills', async () => {
  const data = await seed();
  data.transactions.push({ ...data.transactions[0] });
  data.transactions.push({
    id: 'posted-grocery',
    accountId: 'demo-checking',
    merchant: 'Neighborhood Market',
    amountCents: -3050,
    date: DEMO_NOW,
    status: 'posted',
    pendingTransactionId: 'txn-pending-grocery',
  });
  assert.equal(
    reconcileTransactions(data.transactions).filter(
      (txn) => txn.status === 'pending',
    ).length,
    0,
  );
  assert.equal(forecast(data).endingCents, -3536);
  data.transactions.push({ ...data.transactions[2] });
  assert.equal(detectRecurring(data).length, 5);
});
void test('conflicting duplicate IDs fail instead of silently changing the forecast', async () => {
  const data = await seed();
  data.transactions.push({ ...data.transactions[0], amountCents: -1 });
  assert.throws(() => forecast(data), /Conflicting/);
});
void test('corrections change dates and exact cents, and can exclude a false positive', async () => {
  const data = await seed();
  const bill = detectRecurring(data).find(
    (entry) => entry.merchant === 'Adobe Creative Cloud',
  )!;
  const correction = {
    billId: bill.id,
    nextDate: '2026-09-25',
    amountCents: 2500,
    enabled: true,
  };
  const result = forecast(data, [correction]);
  assert.equal(result.endingCents, 2463);
  assert.equal(result.firstShortfall, null);
  assert.equal(
    result.bills.find((entry) => entry.id === bill.id)?.corrected,
    true,
  );
  assert.equal(
    forecast(data, [{ ...correction, nextDate: '2026-09-18' }]).endingCents,
    -37,
  );
  assert.equal(
    forecast(data, [{ ...correction, enabled: false }]).endingCents,
    2463,
  );
  assert.equal(forecast(data).endingCents, -3536);
});
void test('unknown, repeated, fractional, negative, invalid-calendar, and remote-date corrections fail', async () => {
  const data = await seed();
  const bill = detectRecurring(data)[0];
  const correction = {
    billId: bill.id,
    nextDate: bill.nextDate,
    amountCents: bill.amountCents,
    enabled: true,
  };
  for (const change of [
    { billId: 'other-owner-bill' },
    { amountCents: 1.5 },
    { amountCents: -1 },
    { nextDate: '2026-02-30' },
    { nextDate: '2028-01-01' },
  ]) {
    assert.throws(() => forecast(data, [{ ...correction, ...change }]));
  }
  assert.throws(() => forecast(data, [correction, correction]));
});
void test('monthly recurrence handles end-of-month and year rollover', async () => {
  const data = await seed();
  data.asOf = '2027-01-01T00:00:00Z';
  data.transactions = ['2026-10-31', '2026-11-30', '2026-12-31'].map(
    (date, index) => ({
      id: `eom-${index}`,
      accountId: 'demo-checking',
      merchant: 'Monthly bill',
      amountCents: -1000,
      date: `${date}T12:00:00Z`,
      status: 'posted',
    }),
  );
  const bill = detectRecurring(data)[0];
  assert.equal(bill.nextDate, '2027-01-31');
  assert.equal(bill.uncertain, false);
  data.transactions = ['2026-11-30', '2026-12-31', '2027-01-31'].map(
    (date, index) => ({
      ...data.transactions[0],
      id: `feb-${index}`,
      date: `${date}T12:00:00Z`,
    }),
  );
  data.asOf = '2027-02-01T00:00:00Z';
  assert.equal(detectRecurring(data)[0].nextDate, '2027-02-28');
});
void test('a missing past-due payment is flagged and reserved rather than silently rolled forward', async () => {
  const data = await seed();
  data.asOf = '2026-09-22T16:00:00Z';
  data.accounts[0].observedAt = data.asOf;
  const result = buildForecast(data, 'demo-checking', data.asOf);
  assert.equal(result.status, 'incomplete');
  assert(result.bills.every((bill) => bill.overdue));
  assert.equal(result.days[0].balanceCents, -3536);
});
void test('variable amounts have a cautious estimate and frequent merchant spending is excluded', async () => {
  const data = await seed();
  data.transactions.find((txn) => txn.id === 'txn-6-0')!.amountCents = -2099;
  const bill = detectRecurring(data).find(
    (entry) => entry.merchant === 'Netflix',
  )!;
  assert.equal(bill.maximumCents, 2099);
  assert(bill.uncertain);
  const result = forecast(data);
  assert.equal(result.cautiousShortageCents, 3636);
  data.transactions.push({
    ...data.transactions.find((txn) => txn.id === 'txn-6-0')!,
    id: 'extra-charge',
    date: '2026-08-05T00:00:00Z',
  });
  assert.equal(
    detectRecurring(data).find((entry) => entry.merchant === 'Netflix'),
    undefined,
  );
});
void test('exact input parsing avoids floating-point currency errors', () => {
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('0.01'), 1);
  for (const value of ['1.001', '-1', '0', '1e3', 'NaN', '999999999999999999'])
    assert.throws(() => parseMoney(value));
});
void test('API rejects invalid options without corrupting a later request', async () => {
  for (const body of [
    '{',
    '{"scenario":"unknown"}',
    '{"corrections":[{}]}',
    '{"corrections":[{"billId":"fake","amountCents":100,"nextDate":"2026-09-10","enabled":true}]}',
  ]) {
    const response = await POST(
      new Request('http://localhost/api/forecast', { method: 'POST', body }),
    );
    assert.equal(response.status, 400);
  }
  const response = await POST(
    new Request('http://localhost/api/forecast', {
      method: 'POST',
      body: '{}',
    }),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as DemoForecast;
  assert.equal(data.forecast.endingCents, -3536);
});
void test('mock forecast uses the same scenario and corrections as the dashboard', async () => {
  const data = await getDemoForecast(DEMO_OWNER_ID);
  const bill = data.forecast.bills.find(
    (entry) => entry.merchant === 'Adobe Creative Cloud',
  )!;
  const response = await chat(
    new Request('http://localhost/api/assistant', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Will my bills be covered?',
        scenario: 'shortfall',
        corrections: [
          {
            billId: bill.id,
            amountCents: bill.amountCents,
            nextDate: '2026-09-25',
            enabled: true,
          },
        ],
      }),
    }),
  );
  const reply = (await response.json()) as AssistantReply;
  assert.equal(reply.mode, 'mock');
  assert.deepEqual(reply.reads, ['get_forecast']);
  assert.match(reply.text, /\$24\.63/);
});
