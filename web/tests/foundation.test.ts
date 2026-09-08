import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FixtureBankProvider, DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { MockAssistant } from '../lib/server/mock-assistant.ts';
import { formatMoney } from '../lib/money.ts';
import { GET } from '../app/api/accounts/route.ts';
import { POST } from '../app/api/assistant/route.ts';
import type { AssistantReply, BankSnapshot } from '../lib/contracts.ts';

void test('fixture data is scoped, deterministic, and isolated between reads', async () => {
  const bank = new FixtureBankProvider();
  await assert.rejects(bank.getSnapshot('another-owner'));
  const snapshot = await bank.getSnapshot(DEMO_OWNER_ID);
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(snapshot.source, 'synthetic');
  assert.equal(snapshot.transactions.length, 19);
  const checking = snapshot.accounts.find(
    (account) => account.kind === 'checking',
  )!;
  assert.equal(checking.currentCents - checking.availableCents, 3050);
  assert.equal(
    snapshot.transactions.filter((txn) => txn.status === 'pending').length,
    1,
  );
  assert(
    snapshot.accounts.every(
      (account) =>
        account.ownerId === DEMO_OWNER_ID &&
        Number.isSafeInteger(account.availableCents),
    ),
  );
  assert(
    snapshot.transactions.every(
      (txn) =>
        Number.isSafeInteger(txn.amountCents) && txn.date <= snapshot.asOf,
    ),
  );
  checking.availableCents = 0;
  snapshot.transactions.length = 0;
  const fresh = await bank.getSnapshot(DEMO_OWNER_ID);
  assert.equal(fresh.accounts[0].availableCents, 14860);
  assert.equal(fresh.transactions.length, 19);
});

void test('mock response reads current provider balances instead of canned amounts', async () => {
  const seed = await new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
  seed.accounts[0].availableCents = 12345;
  let reads = 0;
  const assistant = new MockAssistant({
    source: 'synthetic',
    async getSnapshot(ownerId) {
      assert.equal(ownerId, DEMO_OWNER_ID);
      reads++;
      return seed;
    },
  });
  const reply = await assistant.reply(DEMO_OWNER_ID, 'What are my balances?');
  assert.equal(reads, 1);
  assert.equal(reply.mode, 'mock');
  assert.equal(reply.asOf, seed.asOf);
  assert.deepEqual(reply.reads, ['get_accounts']);
  assert.match(reply.text, /\$123\.45 available/);
  assert.match(reply.text, /\$1,850\.00 available/);
  assert.doesNotMatch(reply.text, /\$148\.60 available/);
});

void test('available balance is not reduced a second time by the pending debit', async () => {
  const reply = await new MockAssistant(new FixtureBankProvider()).reply(
    DEMO_OWNER_ID,
    'Why is my checking available balance lower?',
  );
  assert.match(reply.text, /\$148\.60 available/);
  assert.match(reply.text, /\$179\.10 current/);
  assert.match(reply.text, /\$30\.50 difference/);
  assert.doesNotMatch(reply.text, /Rainy day/);
});

void test('activity and empty savings history stay scoped to the selected account', async () => {
  const assistant = new MockAssistant(new FixtureBankProvider());
  const checking = await assistant.reply(
    DEMO_OWNER_ID,
    'Show checking transactions',
  );
  assert.match(checking.text, /Neighborhood Market: -\$30\.50 \(pending/);
  const savings = await assistant.reply(
    DEMO_OWNER_ID,
    'Show savings transactions',
  );
  assert.match(savings.text, /no transactions/);
  assert.doesNotMatch(savings.text, /Neighborhood/);
});

void test('unsupported requests do not pretend to transfer or invoke a model', async () => {
  const assistant = new MockAssistant({
    source: 'synthetic',
    getSnapshot() {
      throw new Error('Unexpected bank read');
    },
  });
  for (const prompt of ['Transfer $50 from savings', 'Write a poem']) {
    const reply = await assistant.reply(DEMO_OWNER_ID, prompt);
    assert.deepEqual(reply.reads, []);
    assert.equal(reply.asOf, null);
    assert.equal(reply.mode, 'mock');
  }
});

void test('money formatting rejects fractional cents and unsafe numbers', () => {
  assert.equal(formatMoney(1999), '$19.99');
  assert.equal(formatMoney(-3050), '-$30.50');
  for (const invalid of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatMoney(invalid));
  }
});

void test('API validates malformed, empty, and oversized questions', async () => {
  for (const body of [
    'not json',
    'null',
    '{}',
    '{"message":4}',
    '{"message":"   "}',
    JSON.stringify({ message: 'x'.repeat(1001) }),
  ]) {
    const response = await POST(
      new Request('http://localhost/api/assistant', { method: 'POST', body }),
    );
    assert.equal(response.status, 400);
  }
});

void test('API returns labeled data and cannot be redirected to a supplied owner', async () => {
  const accounts = await GET();
  assert.equal(accounts.headers.get('Cache-Control'), 'no-store');
  assert.equal(((await accounts.json()) as BankSnapshot).source, 'synthetic');
  const response = await POST(
    new Request('http://localhost/api/assistant', {
      method: 'POST',
      body: JSON.stringify({
        message: 'What are my balances?',
        ownerId: 'someone-else',
        balance: 999999,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const reply = (await response.json()) as AssistantReply;
  assert.equal(reply.mode, 'mock');
  assert.equal(reply.source, 'synthetic');
  assert.match(reply.text, /\$148\.60/);
  assert.doesNotMatch(reply.text, /999999/);
});
