import { mkdir, open, readFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants } from 'node:fs';

// Run from web with Node's --env-file=.env.local. Never print tokens or raw errors.
if (process.env.PLAID_ENV !== 'sandbox')
  throw new Error('PLAID_ENV must explicitly be sandbox');
if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET)
  throw new Error('Configure private Plaid Sandbox credentials first');
const envPath = resolve('.env.local');
const journalPath = resolve('work/private/plaid-item-setup.json');
await mkdir(resolve('work/private'), { recursive: true, mode: 0o700 });
async function savePrivate(path, value) {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.chmod(0o600);
    await file.writeFile(JSON.stringify(value, null, 2));
  } finally {
    await file.close();
  }
}
async function call(path, body = {}) {
  const response = await fetch(`https://sandbox.plaid.com${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'Plaid-Version': '2020-09-14',
    },
    body: JSON.stringify({
      ...body,
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    const code =
      typeof result.error_code === 'string' &&
      /^[A-Z_]+$/.test(result.error_code)
        ? result.error_code
        : 'REQUEST_FAILED';
    const error = new Error(`Plaid Sandbox ${code} (HTTP ${response.status})`);
    error.providerRejected = response.status >= 400 && response.status < 500;
    error.providerCode = code;
    throw error;
  }
  return result;
}
let accessToken = process.env.PLAID_ACCESS_TOKEN;
if (!accessToken && process.argv.includes('--create-item')) {
  let journal = null;
  try {
    journal = JSON.parse(await readFile(journalPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!journal || journal.phase === 'creation_rejected') {
    // Plaid's documented non-OAuth test institution, checked against the API.
    const { institution } = await call('/institutions/get_by_id', {
      country_codes: ['US'],
      institution_id: 'ins_109508',
    });
    if (!institution.products.includes('transactions'))
      throw new Error('Test institution does not support Transactions');
    await savePrivate(journalPath, {
      phase: 'creating',
      institutionId: institution.institution_id,
    });
    let created;
    try {
      created = await call('/sandbox/public_token/create', {
        institution_id: institution.institution_id,
        initial_products: ['transactions'],
        options: {
          override_username: 'user_good',
          override_password: 'pass_good',
        },
      });
    } catch (error) {
      if (error.providerRejected)
        await savePrivate(journalPath, {
          phase: 'creation_rejected',
          institutionId: institution.institution_id,
          errorCode: error.providerCode,
        });
      throw error;
    }
    journal = {
      phase: 'public_token_created',
      publicToken: created.public_token,
      institutionId: institution.institution_id,
    };
    await savePrivate(journalPath, journal);
  }
  if (journal.accessToken) accessToken = journal.accessToken;
  else {
    if (!journal.publicToken || journal.phase !== 'public_token_created')
      throw new Error(
        'An earlier creation outcome is uncertain; inspect the Plaid dashboard before creating another Item',
      );
    // Persist an intent before a potentially ambiguous response; never silently create another Item.
    journal.phase = 'exchanging';
    await savePrivate(journalPath, journal);
    const exchanged = await call('/item/public_token/exchange', {
      public_token: journal.publicToken,
    });
    accessToken = exchanged.access_token;
    await savePrivate(journalPath, {
      phase: 'connected',
      institutionId: journal.institutionId,
      accessToken,
      itemId: exchanged.item_id,
    });
  }
  if (
    typeof accessToken !== 'string' ||
    !accessToken.startsWith('access-sandbox-')
  )
    throw new Error('Refusing an unexpected access-token environment');
  let env = await readFile(envPath, 'utf8');
  if (/^PLAID_ACCESS_TOKEN=.*$/m.test(env))
    env = env.replace(
      /^PLAID_ACCESS_TOKEN=.*$/m,
      `PLAID_ACCESS_TOKEN=${accessToken}`,
    );
  else env += `\nPLAID_ACCESS_TOKEN=${accessToken}\n`;
  const handle = await open(
    envPath,
    constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(env);
  } finally {
    await handle.close();
  }
}
if (!accessToken?.startsWith('access-sandbox-'))
  throw new Error('No Sandbox Item configured; run once with --create-item');
const accounts = await call('/accounts/balance/get', {
  access_token: accessToken,
});
let cursor;
let complete = false;
let historyStatus;
const transactions = new Map();
for (let page = 0; page < 20; page++) {
  const result = await call('/transactions/sync', {
    access_token: accessToken,
    count: 500,
    ...(cursor ? { cursor } : {}),
  });
  for (const entry of [...result.added, ...result.modified])
    transactions.set(entry.transaction_id, entry);
  for (const entry of result.removed) transactions.delete(entry.transaction_id);
  historyStatus = result.transactions_update_status;
  if (!result.has_more) {
    complete = true;
    break;
  }
  if (!result.next_cursor || result.next_cursor === cursor)
    throw new Error('Transaction pagination did not advance');
  cursor = result.next_cursor;
}
if (!complete)
  throw new Error('Transaction history exceeded the bounded setup read');
const evidence = {
  environment: 'sandbox',
  verifiedAt: new Date().toISOString(),
  balanceReadSucceeded: true,
  transactionsReadSucceeded: true,
  accountCount: accounts.accounts.length,
  depositoryAccountCount: accounts.accounts.filter(
    (a) =>
      a.type === 'depository' && ['checking', 'savings'].includes(a.subtype),
  ).length,
  transactionCount: transactions.size,
  historyStatus,
  realBankConnected: false,
  transfersCreated: false,
};
await savePrivate(resolve('work/private/plaid-verification.json'), evidence);
await chmod(journalPath, 0o600).catch(() => {});
console.log(JSON.stringify(evidence));
