import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, GET, PATCH } from '../app/api/monitor/route.ts';
import { getMonitorStore } from '../lib/server/monitor-store.ts';
import { runMonitorTick } from '../lib/server/monitor.ts';
import type { MonitorState } from '../lib/contracts.ts';

const dir = mkdtempSync(join(tmpdir(), 'pennyahead-api-'));
process.env.PENNYAHEAD_MONITOR_DB = join(dir, 'monitor.sqlite');
after(() => {
  getMonitorStore().close();
  rmSync(dir, { recursive: true });
});
const config = {
  scenario: 'shortfall',
  corrections: [],
  enabled: true,
  savingsMinimumCents: 100000,
  timing: 'standard',
};
const request = (method: string, body?: unknown, id?: string) =>
  new Request('http://localhost/api/monitor', {
    method,
    headers: id ? { Authorization: `Bearer ${id}` } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

void test('monitor API creates isolated capabilities; GET only reads and cannot trigger checks', async () => {
  const response = await POST(
    request('POST', {
      ...config,
      ownerId: 'foreign',
      sourceAccountId: 'foreign',
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const state = (await response.json()) as MonitorState;
  assert.equal(state.plan, null);
  const read = await GET(request('GET', undefined, state.id));
  assert.equal(((await read.json()) as MonitorState).checkCount, 0);
  assert.equal((await GET(request('GET'))).status, 404);
  assert.equal(
    (
      await PATCH(
        request(
          'PATCH',
          { action: 'configure', config, revision: 1 },
          'not-a-session',
        ),
      )
    ).status,
    404,
  );
  await runMonitorTick(getMonitorStore());
  const checked = (await (
    await GET(request('GET', undefined, state.id))
  ).json()) as MonitorState;
  assert.equal(checked.plan?.sourceAccountId, 'demo-savings');
  const second = (await (
    await POST(request('POST', config))
  ).json()) as MonitorState;
  const wrongAlert = await PATCH(
    request(
      'PATCH',
      { action: 'acknowledge', alertId: checked.alerts[0].id },
      second.id,
    ),
  );
  assert.equal(wrongAlert.status, 404);
  const ack = await PATCH(
    request(
      'PATCH',
      { action: 'acknowledge', alertId: checked.alerts[0].id },
      state.id,
    ),
  );
  assert.equal(ack.status, 200);
  assert(((await ack.json()) as MonitorState).alerts[0].acknowledgedAt);
});

void test('API rejects invalid corrections, limits, revisions and execution actions', async () => {
  for (const value of [
    null,
    {},
    { ...config, savingsMinimumCents: -1 },
    {
      ...config,
      corrections: [
        {
          billId: 'made-up',
          nextDate: '2026-09-12',
          amountCents: 100,
          enabled: true,
        },
      ],
    },
  ]) {
    assert.equal((await POST(request('POST', value))).status, 400);
  }
  const state = (await (
    await POST(request('POST', config))
  ).json()) as MonitorState;
  for (const body of [
    { action: 'approve' },
    { action: 'configure', revision: 0, config },
    {
      action: 'configure',
      revision: 1,
      config: { ...config, timing: 'instant' },
    },
  ])
    assert.equal((await PATCH(request('PATCH', body, state.id))).status, 400);
  const update = await PATCH(
    request(
      'PATCH',
      {
        action: 'configure',
        revision: 2,
        config: { ...config, timing: 'delayed' },
      },
      state.id,
    ),
  );
  assert.equal(update.status, 200);
  const late = await PATCH(
    request('PATCH', { action: 'configure', revision: 1, config }, state.id),
  );
  assert.equal(((await late.json()) as MonitorState).config.timing, 'delayed');
});

void test('transfer endpoint enforces session capability, exact approval and explicit rule authorization', async () => {
  const { POST: transfer } = await import('../app/api/transfers/route.ts');
  assert.equal(
    (await transfer(request('POST', { action: 'approve' }))).status,
    404,
  );
  const created = (await (
    await POST(request('POST', config))
  ).json()) as MonitorState;
  await runMonitorTick(getMonitorStore());
  const state = getMonitorStore().read(created.id)!;
  const bound = {
    action: 'approve',
    proposalId: state.proposalId,
    revision: state.revision,
    amountCents: state.plan!.amountCents,
    sourceAccountId: state.plan!.sourceAccountId,
    destinationAccountId: state.plan!.destinationAccountId,
  };
  assert.equal(
    (await transfer(request('POST', { ...bound, amountCents: 1 }, state.id)))
      .status,
    409,
  );
  assert.equal(
    (
      await transfer(
        request('POST', { action: 'enable_rule', capCents: 5000 }, state.id),
      )
    ).status,
    409,
  );
  const approved = await transfer(request('POST', bound, state.id));
  assert.equal(approved.status, 200);
  assert.equal(approved.headers.get('Cache-Control'), 'no-store');
  assert.equal((await transfer(request('POST', bound, state.id))).status, 200);
  assert.equal(getMonitorStore().read(state.id)!.transfers.length, 1);
});
