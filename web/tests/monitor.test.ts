import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MonitorConfig } from '../lib/contracts.ts';
import {
  FixtureBankProvider,
  DEMO_NOW,
  DEMO_OWNER_ID,
} from '../lib/server/fixtures.ts';
import {
  buildFundingPlan,
  createFundingTools,
  estimateDemoArrival,
  parseMonitorConfig,
} from '../lib/server/funding.ts';
import {
  MonitorStore,
  MONITOR_INTERVAL_MS,
} from '../lib/server/monitor-store.ts';
import { runMonitorTick } from '../lib/server/monitor.ts';
import { MockAssistant } from '../lib/server/mock-assistant.ts';

const config: MonitorConfig = {
  scenario: 'shortfall',
  corrections: [],
  enabled: true,
  savingsMinimumCents: 100000,
  timing: 'standard',
};
const fixture = () => new FixtureBankProvider().getSnapshot(DEMO_OWNER_ID);
const now = Date.parse('2026-09-08T20:00:00Z');

void test('proposal covers cautious shortage with exact accounts, amount, arrival and savings floor', async () => {
  const snapshot = await fixture();
  const original = structuredClone(snapshot);
  const plan = buildFundingPlan(DEMO_OWNER_ID, snapshot, config, DEMO_NOW);
  assert.equal(plan.status, 'proposed');
  assert.equal(plan.amountCents, 3536);
  assert.equal(plan.sourceAccountId, 'demo-savings');
  assert.equal(plan.destinationAccountId, 'demo-checking');
  assert.equal(plan.remainingSavingsCents, 181464);
  assert.equal(plan.expectedArrival, '2026-09-11');
  assert.equal(plan.neededBefore, '2026-09-18');
  assert.deepEqual(snapshot, original);
  const tools = createFundingTools(DEMO_OWNER_ID, snapshot, config, DEMO_NOW);
  assert.equal(tools.inspectForecast().shortageCents, 3536);
  assert.equal(tools.compareFundingAccounts(3536)[0].eligible, true);
  assert.equal(tools.checkTransferTiming(), '2026-09-11');
});

void test('a savings floor at the exact remaining amount passes, one cent above blocks the entire proposal', async () => {
  const snapshot = await fixture();
  assert.equal(
    buildFundingPlan(
      DEMO_OWNER_ID,
      snapshot,
      { ...config, savingsMinimumCents: 181464 },
      DEMO_NOW,
    ).status,
    'proposed',
  );
  const blocked = buildFundingPlan(
    DEMO_OWNER_ID,
    snapshot,
    { ...config, savingsMinimumCents: 181465 },
    DEMO_NOW,
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.sourceAccountId, null);
  assert.match(blocked.reason, /savings minimum/);
});

void test('timing skips weekends and blocks late or same-day arrival', async () => {
  assert.equal(
    estimateDemoArrival('2026-09-11T16:00:00Z', 'standard'),
    '2026-09-16',
  );
  const snapshot = await fixture();
  const late = buildFundingPlan(
    DEMO_OWNER_ID,
    snapshot,
    { ...config, timing: 'delayed' },
    DEMO_NOW,
  );
  assert.equal(late.expectedArrival, '2026-09-22');
  assert.equal(late.status, 'blocked');
  assert.match(late.reason, /too late/);
  const bill = createFundingTools(DEMO_OWNER_ID, snapshot, config, DEMO_NOW)
    .inspectForecast()
    .bills.find((b) => b.merchant === 'Adobe Creative Cloud')!;
  // Force a shortfall on the arrival date, before the later gym bill.
  const early = buildFundingPlan(
    DEMO_OWNER_ID,
    snapshot,
    {
      ...config,
      corrections: [
        {
          billId: bill.id,
          amountCents: 20000,
          nextDate: '2026-09-11',
          enabled: true,
        },
      ],
    },
    DEMO_NOW,
  );
  assert.equal(early.neededBefore, early.expectedArrival);
  assert.equal(early.status, 'blocked');
});

void test('stale and uncertain checking data never become an unconditional funding claim', async () => {
  const stale = await new FixtureBankProvider('stale').getSnapshot(
    DEMO_OWNER_ID,
  );
  assert.equal(
    buildFundingPlan(DEMO_OWNER_ID, stale, config, DEMO_NOW).status,
    'blocked',
  );
  const uncertain = await new FixtureBankProvider('uncertain').getSnapshot(
    DEMO_OWNER_ID,
  );
  const plan = buildFundingPlan(DEMO_OWNER_ID, uncertain, config, DEMO_NOW);
  assert.equal(plan.neededBefore, '2026-09-16');
  assert.equal(plan.amountCents, 3536);
  const sufficient = await new FixtureBankProvider('sufficient').getSnapshot(
    DEMO_OWNER_ID,
  );
  assert.equal(
    buildFundingPlan(DEMO_OWNER_ID, sufficient, config, DEMO_NOW).status,
    'no_shortfall',
  );
});

void test('foreign, stale, or unreconciled savings accounts are not eligible sources', async () => {
  for (const change of ['foreign', 'stale', 'future', 'pending'] as const) {
    const snapshot = await fixture();
    if (change === 'foreign') snapshot.accounts[1].ownerId = 'other-owner';
    if (change === 'stale')
      snapshot.accounts[1].observedAt = '2026-09-01T16:00:00Z';
    if (change === 'future')
      snapshot.accounts[1].observedAt = '2026-09-09T16:00:00Z';
    if (change === 'pending')
      snapshot.transactions.push({
        id: 'unknown',
        accountId: 'demo-savings',
        amountCents: -10000,
        status: 'pending',
        date: DEMO_NOW,
        merchant: 'Unknown',
        availableBalanceEffect: 'unknown',
      });
    assert.equal(
      buildFundingPlan(DEMO_OWNER_ID, snapshot, config, DEMO_NOW).status,
      'blocked',
      change,
    );
  }
  const snapshot = await fixture();
  assert.throws(() =>
    buildFundingPlan('other-owner', snapshot, config, DEMO_NOW),
  );
});

void test('pending incoming savings is not treated as received and source commitments are reserved', async () => {
  const snapshot = await fixture();
  snapshot.transactions.push({
    id: 'pending-income',
    accountId: 'demo-savings',
    merchant: 'Deposit',
    date: DEMO_NOW,
    amountCents: 85000,
    status: 'pending',
    availableBalanceEffect: 'included',
  });
  assert.equal(
    buildFundingPlan(DEMO_OWNER_ID, snapshot, config, DEMO_NOW).status,
    'blocked',
  );
  snapshot.transactions = snapshot.transactions.filter(
    (t) => t.id !== 'pending-income',
  );
  for (const month of ['06', '07', '08'])
    snapshot.transactions.push({
      id: `reserve-${month}`,
      accountId: 'demo-savings',
      merchant: 'Savings bill',
      date: `2026-${month}-10T12:00:00Z`,
      amountCents: -85000,
      status: 'posted',
    });
  assert.equal(
    buildFundingPlan(DEMO_OWNER_ID, snapshot, config, DEMO_NOW).status,
    'blocked',
  );
});

void test('invalid settings and fractional cents are rejected', () => {
  for (const input of [
    null,
    {},
    { ...config, savingsMinimumCents: -1 },
    { ...config, savingsMinimumCents: 1.1 },
    { ...config, savingsMinimumCents: 100000001 },
    { ...config, timing: 'instant' },
    { ...config, enabled: 'true' },
  ])
    assert.throws(() => parseMonitorConfig(input));
});

void test('background worker creates an alert without chat, suppresses repeats and preserves acknowledgement', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create(config, now);
    assert.equal(state.alerts.length, 0);
    await runMonitorTick(store, now);
    const first = store.read(state.id, now)!;
    assert.equal(first.alerts.length, 1);
    assert.equal(first.plan?.status, 'proposed');
    store.acknowledge(state.id, first.alerts[0].id, now);
    await runMonitorTick(store, now + MONITOR_INTERVAL_MS);
    const second = store.read(state.id, now)!;
    assert.equal(second.checkCount, 2);
    assert.equal(second.alerts.length, 1);
    assert.equal(second.alerts[0].id, first.alerts[0].id);
    assert(second.alerts[0].acknowledgedAt);
  } finally {
    store.close();
  }
});

void test('overlapping workers commit once and old in-flight checks cannot overwrite new preferences', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create(config, now);
    await Promise.all([runMonitorTick(store, now), runMonitorTick(store, now)]);
    assert.equal(store.read(state.id, now)!.checkCount, 1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = runMonitorTick(
      store,
      now + MONITOR_INTERVAL_MS,
      async () => {
        await blocked;
        return fixture();
      },
    );
    store.configure(
      state.id,
      { ...config, savingsMinimumCents: 185000 },
      2,
      now,
    );
    release();
    await pending;
    assert.equal(store.read(state.id, now)!.plan, null);
    store.configure(state.id, config, 1, now); // late request must lose
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.plan?.status, 'blocked');
  } finally {
    store.close();
  }
});

void test('changed risk supersedes alerts, resolution removes active risk, and recurrence alerts again', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create(config, now);
    await runMonitorTick(store, now);
    store.configure(state.id, { ...config, timing: 'delayed' }, 1, now);
    await runMonitorTick(store, now);
    let next = store.read(state.id, now)!;
    assert.equal(next.alerts.length, 2);
    assert(next.alerts[1].resolvedAt);
    store.configure(state.id, { ...config, scenario: 'sufficient' }, 2, now);
    await runMonitorTick(store, now);
    next = store.read(state.id, now)!;
    assert(next.alerts.every((a) => a.resolvedAt));
    assert.equal(next.plan?.status, 'no_shortfall');
    store.configure(state.id, config, 3, now);
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.alerts.length, 3);
  } finally {
    store.close();
  }
});

void test('failures hide previous proposals and retry without duplicating unchanged alerts', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create(config, now);
    await runMonitorTick(store, now);
    await runMonitorTick(store, now + MONITOR_INTERVAL_MS, async () => {
      throw new Error('Provider offline');
    });
    assert.equal(store.read(state.id, now)!.plan, null);
    assert.match(store.read(state.id, now)!.error!, /failed/);
    await runMonitorTick(store, now + 2 * MONITOR_INTERVAL_MS);
    assert.equal(store.read(state.id, now)!.error, null);
    assert.equal(store.read(state.id, now)!.alerts.length, 1);
  } finally {
    store.close();
  }
});

void test('paused and expired sessions do not run, and session capabilities isolate state', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const first = store.create(config, now);
    const second = store.create({ ...config, enabled: false }, now);
    await runMonitorTick(store, now);
    assert.equal(store.read(second.id, now)!.checkCount, 0);
    assert.equal(
      store.acknowledge(
        second.id,
        store.read(first.id, now)!.alerts[0].id,
        now,
      ),
      null,
    );
    store.configure(first.id, { ...config, enabled: false }, 1, now);
    await runMonitorTick(store, now + MONITOR_INTERVAL_MS);
    assert.equal(store.read(first.id, now)!.checkCount, 1);
    assert.equal(store.read(first.id, now + 86400000), null);
    assert.equal(store.due(now + 86400000).length, 0);
  } finally {
    store.close();
  }
});

void test('monitor state and deduplication survive closing and reopening the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pennyahead-monitor-'));
  const path = join(dir, 'state.sqlite');
  const first = new MonitorStore(path);
  const state = first.create(config, now);
  await runMonitorTick(first, now);
  const alertId = first.read(state.id, now)!.alerts[0].id;
  first.close();
  const restarted = new MonitorStore(path);
  const otherWorker = new MonitorStore(path);
  try {
    await Promise.all([
      runMonitorTick(restarted, now + MONITOR_INTERVAL_MS),
      runMonitorTick(otherWorker, now + MONITOR_INTERVAL_MS),
    ]);
    assert.equal(restarted.read(state.id, now)!.checkCount, 2);
    assert.equal(restarted.read(state.id, now)!.alerts[0].id, alertId);
    assert.equal(restarted.read(state.id, now)!.alerts.length, 1);
  } finally {
    restarted.close();
    otherWorker.close();
    rmSync(dir, { recursive: true });
  }
});

void test('mock assistant describes the same proposal and respects changed preferences', async () => {
  const assistant = new MockAssistant(new FixtureBankProvider());
  const reply = await assistant.reply(
    DEMO_OWNER_ID,
    'How can I cover the shortfall?',
    config,
    config,
  );
  assert.match(reply.text, /\$35\.36/);
  assert.match(reply.text, /\$1,814\.64/);
  assert.match(reply.text, /No transfer was created/);
  const blocked = await assistant.reply(
    DEMO_OWNER_ID,
    'Show funding proposal',
    config,
    { ...config, timing: 'delayed' },
  );
  assert.match(blocked.text, /too late/);
});
