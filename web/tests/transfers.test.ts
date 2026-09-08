import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MonitorStore } from '../lib/server/monitor-store.ts';
import { runMonitorTick } from '../lib/server/monitor.ts';
import { getSessionDemo } from '../lib/server/session-bank.ts';
import {
  buildSessionPlan,
  parseApproval,
} from '../lib/server/transfer-policy.ts';
import type { MonitorState, MonitorConfig } from '../lib/contracts.ts';
const config: MonitorConfig = {
  scenario: 'shortfall',
  corrections: [],
  enabled: true,
  savingsMinimumCents: 100000,
  timing: 'standard',
};
const now = Date.now();
const input = (s: MonitorState) => ({
  proposalId: s.proposalId!,
  revision: s.revision,
  amountCents: s.plan!.amountCents,
  sourceAccountId: s.plan!.sourceAccountId!,
  destinationAccountId: s.plan!.destinationAccountId,
});
async function setup() {
  const store = new MonitorStore(':memory:');
  const created = store.create(config, now);
  await runMonitorTick(store, now);
  return { store, state: store.read(created.id, now)! };
}
async function approve(store: MonitorStore, state: MonitorState) {
  return store.approve(
    state,
    input(state),
    buildSessionPlan(state, (await getSessionDemo(state)).snapshot),
    'local_simulation',
    'approval',
    now,
  );
}
void test('exact approval reserves savings, retries deduplicate and pending checking is not spendable', async () => {
  const { store, state } = await setup();
  try {
    const t = await approve(store, state);
    assert.equal((await approve(store, state)).id, t.id);
    assert.equal(store.read(state.id, now)!.transfers.length, 1);
    const pending = await getSessionDemo(store.read(state.id, now)!);
    assert.equal(pending.snapshot.accounts[0].availableCents, 14860);
    assert.equal(pending.snapshot.accounts[1].availableCents, 181464);
    assert.equal(pending.forecast.shortageCents, 3536);
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.plan!.status, 'pending_funding');
    store.settleSimulation(state.id, t.id, 'completed', now);
    const completed = await getSessionDemo(store.read(state.id, now)!);
    assert.equal(completed.snapshot.accounts[0].availableCents, 18396);
    assert.equal(completed.forecast.shortageCents, 0);
    store.settleSimulation(state.id, t.id, 'completed', now);
    assert.throws(() => store.settleSimulation(state.id, t.id, 'failed', now));
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.plan!.status, 'no_shortfall');
  } finally {
    store.close();
  }
});
void test('changed amounts, accounts, declined and stale proposals cannot authorize movement', async () => {
  const { store, state } = await setup();
  try {
    for (const patch of [
      { amountCents: 3537 },
      { sourceAccountId: 'foreign' },
      { destinationAccountId: 'demo-savings' },
      { proposalId: 'invented' },
      { revision: 3 },
    ])
      assert.throws(() =>
        store.approve(
          state,
          { ...input(state), ...patch },
          state.plan!,
          'local_simulation',
          'approval',
          now,
        ),
      );
    assert.throws(() =>
      store.approve(
        state,
        input(state),
        state.plan!,
        'local_simulation',
        'approval',
        now + 20001,
      ),
    );
    store.decline(state.id, state.proposalId!, now);
    await assert.rejects(approve(store, state));
    await runMonitorTick(store, now + 5000);
    assert.equal(store.read(state.id, now)!.proposalStatus, 'declined');
    assert.equal(store.read(state.id, now)!.transfers.length, 0);
  } finally {
    store.close();
  }
});
void test('preferences and ledger changes invalidate an in-flight approval or monitor calculation', async () => {
  const { store, state } = await setup();
  try {
    store.configure(
      state.id,
      { ...config, savingsMinimumCents: 185000 },
      1,
      now,
    );
    await assert.rejects(approve(store, state));
    assert.equal(store.complete(state, state.plan, null, now), false);
  } finally {
    store.close();
  }
});
void test('failed transfers release reservation, revoke automation and cannot affect another session', async () => {
  const { store, state } = await setup();
  try {
    store.configureRule(state.id, 4000, now);
    await Promise.all([runMonitorTick(store, now), runMonitorTick(store, now)]);
    const sent = store.read(state.id, now)!;
    assert.equal(sent.transfers.length, 1);
    assert.equal(sent.rule!.spentCents, 3536);
    const other = store.create(config, now);
    assert.throws(() =>
      store.settleSimulation(other.id, sent.transfers[0].id, 'completed', now),
    );
    store.settleSimulation(state.id, sent.transfers[0].id, 'failed', now);
    assert.equal(store.read(state.id, now)!.rule!.enabled, false);
    assert.equal(
      (await getSessionDemo(store.read(state.id, now)!)).snapshot.accounts[1]
        .availableCents,
      185000,
    );
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.transfers.length, 1);
  } finally {
    store.close();
  }
});
void test('automatic rules enforce cap and captured floor, revoke immediately and reset isolates generations', async () => {
  const { store, state } = await setup();
  try {
    store.configureRule(state.id, 3535, now);
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.transfers.length, 0);
    store.configureRule(state.id, null, now);
    store.configure(
      state.id,
      { ...config, savingsMinimumCents: 185000 },
      1,
      now,
    );
    store.configureRule(state.id, 5000, now);
    store.configure(state.id, config, 2, now);
    await runMonitorTick(store, now);
    assert.equal(store.read(state.id, now)!.plan!.status, 'blocked');
    store.configureRule(state.id, null, now);
    await runMonitorTick(store, now);
    const fresh = store.read(state.id, now)!;
    const t = await approve(store, fresh);
    store.reset(state.id, now);
    assert.equal(store.read(state.id, now)!.transfers[0].status, 'failed');
    assert.equal(
      (await getSessionDemo(store.read(state.id, now)!)).snapshot.accounts[1]
        .availableCents,
      185000,
    );
    assert.throws(() =>
      store.settleSimulation(state.id, t.id, 'completed', now),
    );
  } finally {
    store.close();
  }
});
void test('approval parser rejects fractional cents and over-limit transfers', () => {
  for (const amountCents of [0, -1, 1.5, 50001, NaN])
    assert.throws(() =>
      parseApproval({
        proposalId: 'id',
        revision: 0,
        amountCents,
        sourceAccountId: 'a',
        destinationAccountId: 'b',
      }),
    );
});
