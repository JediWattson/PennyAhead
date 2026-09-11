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
import { buildGrowthPlan } from '../lib/server/growth-plan.ts';
import { initialGrowthInputs } from '../lib/growth-contracts.ts';
import { renameDemoMerchant } from './demo-merchant-names.ts';
import { weeklyIncomeTransactions } from './weekly-income-fixture.ts';

// Run from web. Default: prepare only. --activate creates, verifies, then selects a test Item.
if (
  process.env.PLAID_ENV !== 'sandbox' ||
  !process.env.PLAID_ACCESS_TOKEN?.startsWith('access-sandbox-')
)
  throw new Error('An existing Plaid Sandbox Item is required');
const privateDir = resolve('work/private');
const surplus = process.argv.includes('--surplus');
const weeklyIncome = process.argv.includes('--weekly-income');
const renameMerchants = process.argv.includes('--rename-merchants');
if ([surplus, weeklyIncome, renameMerchants].filter(Boolean).length > 1)
  throw new Error('Choose one seed mode');
const journalPath = resolve(
  privateDir,
  renameMerchants
    ? 'plaid-merchant-names-seed.json'
    : weeklyIncome
      ? 'plaid-weekly-income-seed.json'
      : surplus
        ? 'plaid-surplus-seed.json'
        : 'plaid-activity-seed.json',
);
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
  if (renameMerchants) {
    const original = JSON.parse(
      await readFile(
        resolve(privateDir, 'plaid-weekly-income-seed.json'),
        'utf8',
      ),
    );
    if (
      original.phase !== 'activated' ||
      original.accessToken !== process.env.PLAID_ACCESS_TOKEN
    )
      throw new Error(
        'Merchant renaming requires the active weekly income seed',
      );
    const config = structuredClone(original.config);
    let renamedTransactions = 0;
    for (const account of config.override_accounts) {
      for (const transaction of account.transactions) {
        const description = renameDemoMerchant(transaction.description);
        if (description !== transaction.description) renamedTransactions++;
        transaction.description = description;
      }
    }
    if (!renamedTransactions) throw new Error('No demo merchants to rename');
    journal = {
      phase: 'prepared',
      previousAccessToken: process.env.PLAID_ACCESS_TOKEN,
      config,
      anchor: original.anchor,
      addedTransactions: 0,
      renamedTransactions,
      renameMerchants: true,
      nextBills: original.nextBills.map((bill) => ({
        ...bill,
        name: renameDemoMerchant(bill.name),
      })),
      sampleRothProfile: original.sampleRothProfile,
      weeklyIncome: original.weeklyIncome,
    };
  } else if (weeklyIncome) {
    const original = JSON.parse(
      await readFile(resolve(privateDir, 'plaid-surplus-seed.json'), 'utf8'),
    );
    if (
      original.phase !== 'activated' ||
      original.accessToken !== process.env.PLAID_ACCESS_TOKEN
    )
      throw new Error(
        'Weekly income requires the currently active surplus seed',
      );
    const anchor = new Date().toISOString().slice(0, 10);
    const config = structuredClone(original.config);
    config.seed = `${config.seed}-weekly-income`;
    const checking = config.override_accounts.find(
      (account) => account.subtype === 'checking',
    );
    checking.transactions.push(...weeklyIncomeTransactions(anchor));
    journal = {
      phase: 'prepared',
      previousAccessToken: process.env.PLAID_ACCESS_TOKEN,
      config,
      anchor,
      nextBills: original.nextBills,
      addedTransactions: 8,
      sampleRothProfile: true,
      weeklyIncome: true,
    };
  } else if (surplus) {
    const original = JSON.parse(
      await readFile(resolve(privateDir, 'plaid-activity-seed.json'), 'utf8'),
    );
    if (
      original.phase !== 'activated' ||
      original.accessToken !== process.env.PLAID_ACCESS_TOKEN
    )
      throw new Error(
        'The surplus demo requires the currently active activity seed',
      );
    const config = structuredClone(original.config);
    config.seed = `${config.seed}-surplus`;
    const checking = config.override_accounts.find(
      (account) => account.subtype === 'checking',
    );
    checking.starting_balance += 1500 - checking.force_available_balance;
    checking.force_available_balance = 1500;
    journal = {
      phase: 'prepared',
      previousAccessToken: process.env.PLAID_ACCESS_TOKEN,
      config,
      anchor: original.anchor,
      nextBills: original.nextBills,
      addedTransactions: 0,
      sampleRothProfile: true,
    };
  } else {
    const snapshot =
      await configuredPlaidProvider().getSnapshot(PLAID_DEMO_OWNER_ID);
    journal = {
      phase: 'prepared',
      previousAccessToken: process.env.PLAID_ACCESS_TOKEN,
      ...activityFixture(snapshot, new Date().toISOString().slice(0, 10)),
    };
  }
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
if (journal.renameMerchants) {
  for (const expected of journal.config.override_accounts) {
    const actual = snapshot.accounts.find(
      (account) => account.kind === expected.subtype,
    );
    const key = (description, date, cents) =>
      JSON.stringify([description, date.slice(0, 10), cents]);
    const wanted = expected.transactions
      .map((transaction) =>
        key(
          transaction.description,
          transaction.date_posted,
          Math.round(-transaction.amount * 100),
        ),
      )
      .sort();
    const received = snapshot.transactions
      .filter((transaction) => transaction.accountId === actual.id)
      .map((transaction) =>
        key(transaction.description, transaction.date, transaction.amountCents),
      )
      .sort();
    if (JSON.stringify(wanted) !== JSON.stringify(received))
      throw new Error(
        'Renamed provider history changed amounts, dates or descriptions; existing configuration is preserved',
      );
  }
  if (
    snapshot.transactions.some((transaction) =>
      /pennyahead/i.test(transaction.merchant),
    )
  )
    throw new Error(
      'Provider merchant names still contain PennyAhead; existing configuration is preserved',
    );
  for (const bill of journal.nextBills) {
    if (
      !forecast.bills.some(
        (actual) =>
          actual.merchant === bill.name && actual.nextDate === bill.date,
      )
    )
      throw new Error(
        'Renamed bill was not detected correctly; existing configuration is preserved',
      );
  }
}
const growthPlan = journal.sampleRothProfile
  ? buildGrowthPlan(
      {
        snapshot,
        forecast,
        sampleRothProfile: true,
        clock: 'provider-observation',
        scenario: 'shortfall',
        corrections: [],
      },
      initialGrowthInputs('plaid_sandbox', true),
      0,
    )
  : null;
if (
  journal.weeklyIncome &&
  (!forecast.income?.streams.some(
    (stream) =>
      stream.status === 'estimated' &&
      stream.amountCents === 50000 &&
      stream.evidenceIds.length === 8,
  ) ||
    forecast.income.expected30DaysCents <= 0)
)
  throw new Error(
    'Weekly pay was not detected in the provider history; existing configuration is preserved',
  );
if (
  growthPlan &&
  (growthPlan.status !== 'ready' || growthPlan.rothSuggestedCents <= 0)
)
  throw new Error(
    'The surplus Item did not produce a usable Roth preview; existing configuration is preserved',
  );
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
let updatedEnv = env.replace(
  /^PLAID_ACCESS_TOKEN=.*$/m,
  `PLAID_ACCESS_TOKEN=${journal.accessToken}`,
);
if (journal.sampleRothProfile) {
  const setting = 'PENNYAHEAD_SANDBOX_SAMPLE_ROTH=true';
  updatedEnv = /^PENNYAHEAD_SANDBOX_SAMPLE_ROTH=.*$/m.test(updatedEnv)
    ? updatedEnv.replace(/^PENNYAHEAD_SANDBOX_SAMPLE_ROTH=.*$/m, setting)
    : `${updatedEnv.trimEnd()}\n${setting}\n`;
}
await writePrivate(envPath, updatedEnv);
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
    ...(journal.weeklyIncome
      ? {
          expectedIncome14DaysCents: forecast.income.expected14DaysCents,
          expectedIncome30DaysCents: forecast.income.expected30DaysCents,
        }
      : {}),
    ...(growthPlan
      ? {
          hysaSuggestedCents: growthPlan.hysaSuggestedCents,
          rothSuggestedCents: growthPlan.rothSuggestedCents,
        }
      : {}),
    bills: forecast.bills.map((bill) => ({
      merchant: bill.merchant,
      nextDate: bill.nextDate,
      amountCents: bill.amountCents,
    })),
    realMoneyMoved: false,
  }),
);
