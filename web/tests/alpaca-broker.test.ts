import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlpacaSandboxBroker } from '../lib/server/alpaca-broker.ts';

const id = 'c8f1ef5d-edc0-4f23-9ee4-378f19cb92a4';
const account = {
  id,
  account_number: '12345678',
  status: 'ACTIVE',
  account_type: 'ira',
  account_sub_type: 'roth',
};
const trading = {
  id,
  status: 'ACTIVE',
  currency: 'USD',
  cash: '250.001',
  portfolio_value: '12000.12',
};
const credentials = {
  keyId: 'private-key-marker',
  secretKey: 'private-secret-marker',
};

function fixture(
  options: {
    accounts?: unknown[];
    detail?: unknown;
    trading?: unknown;
    authStatus?: number;
    accountStatus?: number;
  } = {},
) {
  const calls: string[] = [];
  let now = 100000;
  const request: typeof fetch = async (url, init) => {
    const address = new URL(url instanceof Request ? url.url : url);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    calls.push(address.pathname);
    if (address.hostname === 'authx.sandbox.alpaca.markets') {
      assert.equal(address.pathname, '/v1/oauth2/token');
      assert.equal(init?.method, 'POST');
      const body = new URLSearchParams(init!.body as URLSearchParams);
      assert.equal(body.get('grant_type'), 'client_credentials');
      assert.equal(body.get('client_secret'), credentials.secretKey);
      return Response.json(
        {
          access_token: 'private-token-marker',
          token_type: 'Bearer',
          expires_in: 899,
        },
        { status: options.authStatus ?? 200 },
      );
    }
    assert.equal(address.hostname, 'broker-api.sandbox.alpaca.markets');
    assert.equal(init?.method, 'GET');
    assert.equal(
      (init!.headers as Record<string, string>).Authorization,
      'Bearer private-token-marker',
    );
    if (options.accountStatus)
      return Response.json(
        { message: 'private-secret-marker' },
        { status: options.accountStatus },
      );
    if (address.pathname === '/v1/accounts')
      return Response.json(options.accounts ?? [account]);
    if (address.pathname === `/v1/accounts/${id}`)
      return Response.json(options.detail ?? account);
    if (address.pathname === `/v1/trading/accounts/${id}/account`)
      return Response.json(options.trading ?? trading);
    assert.fail('Unexpected endpoint');
  };
  return {
    client: new AlpacaSandboxBroker(credentials, request, () => now),
    calls,
    advance: () => {
      now += 900000;
    },
  };
}

void test('OAuth is cached and concurrent connection reads verify a Roth without exposing secrets or executing orders', async () => {
  const { client, calls, advance } = fixture();
  const results = await Promise.all([client.connection(), client.connection()]);
  assert.equal(calls.filter((p) => p === '/v1/oauth2/token').length, 1);
  for (const result of results) {
    assert.equal(result.status, 'connected');
    assert.equal(result.account?.mask, '5678');
    assert.equal(result.account?.cashCents, 25000);
    assert.equal(result.execution, 'not_connected');
    assert.doesNotMatch(JSON.stringify(result), /private-|12345678/);
  }
  advance();
  await client.connection();
  assert.equal(calls.filter((p) => p === '/v1/oauth2/token').length, 2);
  assert.ok(calls.every((path) => !/orders|transfers|journals/.test(path)));
});

void test('an empty broker list is authenticated but still requires a test Roth', async () => {
  const result = await fixture({ accounts: [] }).client.connection();
  assert.equal(result.status, 'needs_roth');
  assert.equal(result.account, null);
  assert.match(result.message, /connected, but no Roth IRA/);
});

void test('wrong account type, mismatched account identity and malformed balances never become verified Roth data', async () => {
  for (const options of [
    { detail: { ...account, account_type: 'trading' } },
    { detail: { ...account, account_sub_type: 'traditional' } },
    { trading: { ...trading, id: '00000000-0000-4000-8000-000000000001' } },
    { trading: { ...trading, cash: 'NaN' } },
    { trading: { ...trading, currency: 'EUR' } },
  ]) {
    const result = await fixture(options).client.connection();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.account, null);
  }
});

void test('broker errors are sanitized and do not substitute synthetic account balances', async () => {
  for (const options of [
    { authStatus: 401 },
    { accountStatus: 403 },
    { accountStatus: 500 },
  ]) {
    const result = await fixture(options).client.connection();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.account, null);
    assert.doesNotMatch(JSON.stringify(result), /private-/);
  }
});
