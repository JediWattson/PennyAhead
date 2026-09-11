import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from '../app/api/broker/route.ts';
import { getMonitorStore } from '../lib/server/monitor-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'pennyahead-broker-'));
process.env.PENNYAHEAD_MONITOR_DB = join(dir, 'monitor.sqlite');
process.env.PENNYAHEAD_ALPACA_SANDBOX_ENABLED = 'false';
after(() => {
  getMonitorStore().close();
  rmSync(dir, { recursive: true });
});

void test('broker reads require a current capability and reject browser-supplied account identifiers', async () => {
  const request = (body: unknown, token?: string) =>
    new Request('http://localhost/api/broker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await POST(request({}))).status, 401);
  const state = getMonitorStore().create({
    scenario: 'growth',
    corrections: [],
    enabled: false,
    savingsMinimumCents: 100000,
    timing: 'standard',
  });
  const result = await POST(request({}, state.id));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).status, 'not_configured');
  assert.equal(
    (await POST(request({ accountId: 'arbitrary' }, state.id))).status,
    400,
  );
  assert.equal(
    (
      await POST(
        request({ snapshotId: '00000000-0000-4000-8000-000000000001' }),
      )
    ).status,
    400,
  );
});
