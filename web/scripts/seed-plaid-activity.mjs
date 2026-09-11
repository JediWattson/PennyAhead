import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  configuredPlaidProvider,
  PlaidSandboxProvider,
  PLAID_DEMO_OWNER_ID,
} from '../lib/server/plaid-bank.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { activityFixture } from './plaid-activity-fixture.ts';

// Run from web. Default: prepare only. --activate creates, verifies, then selects a test Item.
if (
  process.env.PLAID_ENV !== 'sandbox' ||
  !process.env.PLAID_ACCESS_TOKEN?.startsWith('access-sandbox-')
)
  throw new Error('An existing Plaid Sandbox Item is required');
const privateDir = resolve('work/private');
const journalPath = resolve(privateDir, 'plaid-activity-seed.json');
const envPath = resolve('.env.local');
await mkdir(privateDir, { recursive: true, mode: 0o700 });
async function writePrivate(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(value);
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}
let journal;
try {
  journal = JSON.parse(await readFile(journalPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const save = () => writePrivate(journalPath, JSON.stringify(journal, null, 2));
async function call(path, body) {
  let response;
  try {
    response = await fetch(`https://sandbox.plaid.com${path}`, {
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
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error(
      'Sandbox request outcome is uncertain; the saved journal prevents duplicate creation',
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    await writePrivate(
      resolve(privateDir, 'plaid-activity-error.json'),
      JSON.stringify({ path, status: response.status, result }, null, 2),
    );
    if (response.status === 400 && path === '/sandbox/public_token/create') {
      journal.phase = 'creation_rejected';
      await save();
    }
    throw new Error(
      `Sandbox request failed (HTTP ${response.status}); inspect the private journal before retrying`,
    );
  }
  return result;
}
if (!journal) {
  const snapshot =
    await configuredPlaidProvider().getSnapshot(PLAID_DEMO_OWNER_ID);
  journal = {
    phase: 'prepared',
    previousAccessToken: process.env.PLAID_ACCESS_TOKEN,
    ...activityFixture(snapshot, new Date().toISOString().slice(0, 10)),
  };
  await save();
}
console.log(
  JSON.stringify({
    phase: journal.phase,
    anchor: journal.anchor,
    addedTransactions: journal.addedTransactions,
    accounts: journal.config.override_accounts.map((account) => ({
      name: account.meta.name,
      count: account.transactions.length,
    })),
    nextBills: journal.nextBills,
  }),
);
if (!process.argv.includes('--activate')) process.exit(0);
if (journal.phase === 'prepared') {
  journal.phase = 'creating';
  await save();
  const result = await call('/sandbox/public_token/create', {
    institution_id: 'ins_109508',
    initial_products: ['transactions'],
    options: {
      override_username: 'user_custom',
      override_password: JSON.stringify(journal.config),
      transactions: { days_requested: 180 },
    },
  });
  if (!result.public_token?.startsWith('public-sandbox-'))
    throw new Error('Unexpected public token; inspect the private journal');
  journal.publicToken = result.public_token;
  journal.phase = 'public_ready';
  await save();
}
if (journal.phase === 'public_ready') {
  journal.phase = 'exchanging';
  await save();
  const result = await call('/item/public_token/exchange', {
    public_token: journal.publicToken,
  });
  if (!result.access_token?.startsWith('access-sandbox-'))
    throw new Error('Unexpected access token; inspect the private journal');
  journal.accessToken = result.access_token;
  journal.itemId = result.item_id;
  journal.phase = 'created';
  await save();
}
if (!['created', 'verified', 'activated'].includes(journal.phase))
  throw new Error(
    'An earlier creation outcome is uncertain; reconcile the private journal before continuing',
  );
const bank = new PlaidSandboxProvider({
  clientId: process.env.PLAID_CLIENT_ID,
  secret: process.env.PLAID_SECRET,
  accessToken: journal.accessToken,
});
let snapshot;
const expectedCount = journal.config.override_accounts.reduce(
  (count, account) => count + account.transactions.length,
  0,
);
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    snapshot = await bank.getSnapshot(PLAID_DEMO_OWNER_ID);
    if (snapshot.transactions.length < expectedCount && attempt < 7) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    break;
  } catch (error) {
    if (error.code !== 'HISTORY_LOADING' || attempt === 7) throw error;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
const checking = snapshot.accounts.find(
  (account) => account.kind === 'checking',
);
const forecast = buildForecast(snapshot, checking.id, new Date().toISOString());
if (
  snapshot.accounts.length !== 2 ||
  snapshot.transactions.length < expectedCount ||
  forecast.scheduledCents <= 0 ||
  ['stale', 'incomplete'].includes(forecast.status)
)
  throw new Error(
    'The custom Item did not produce the expected activity and usable bill forecast; existing configuration is preserved',
  );
for (const expected of journal.config.override_accounts) {
  const actual = snapshot.accounts.find(
    (account) => account.kind === expected.subtype,
  );
  if (
    actual.availableCents !== Math.round(expected.force_available_balance * 100)
  )
    throw new Error(
      'Custom account balance did not match; existing configuration is preserved',
    );
}
journal.phase = 'verified';
journal.verifiedAt = new Date().toISOString();
await save();
const env = await readFile(envPath, 'utf8');
const currentToken = env
  .match(/^PLAID_ACCESS_TOKEN=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^['"]|['"]$/g, '');
if (![journal.previousAccessToken, journal.accessToken].includes(currentToken))
  throw new Error(
    'The configured Item changed during setup; refusing to overwrite it',
  );
await writePrivate(
  envPath,
  env.replace(
    /^PLAID_ACCESS_TOKEN=.*$/m,
    `PLAID_ACCESS_TOKEN=${journal.accessToken}`,
  ),
);
journal.phase = 'activated';
await save();
console.log(
  JSON.stringify({
    phase: journal.phase,
    transactionCount: snapshot.transactions.length,
    addedTransactions: journal.addedTransactions,
    scheduledCents: forecast.scheduledCents,
    shortageCents: forecast.shortageCents,
    cautiousShortageCents: forecast.cautiousShortageCents,
    bills: forecast.bills.map((bill) => ({
      merchant: bill.merchant,
      nextDate: bill.nextDate,
      amountCents: bill.amountCents,
    })),
    realMoneyMoved: false,
  }),
);
