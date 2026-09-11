import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AssistantAccess,
  liveAssistantError,
} from '../lib/server/assistant-access.ts';

void test('both chat routes share concurrency, cooldown and daily budgets', () => {
  const gate = new AssistantAccess();
  const now = Date.parse('2026-09-10T12:00:00Z');
  const release = gate.acquire('sandbox:one', now)!;
  assert(release);
  assert.equal(gate.acquire('sandbox:one', now + 4000), null);
  const releaseTwo = gate.acquire('demo:two', now)!;
  const releaseThree = gate.acquire('demo:three', now)!;
  assert.equal(gate.acquire('demo:four', now), null);
  release();
  assert.equal(gate.acquire('sandbox:one', now + 2999), null);
  const releaseAgain = gate.acquire('sandbox:one', now + 3000)!;
  release();
  assert.equal(gate.acquire('sandbox:one', now + 6000), null);
  releaseAgain();
  releaseTwo();
  releaseThree();
  const budget = new AssistantAccess();
  for (let i = 0; i < 200; i++) {
    const done = budget.acquire(`demo:${i}`, now);
    assert(done);
    done();
  }
  assert.equal(budget.acquire('sandbox:new', now), null);
  assert(budget.acquire('sandbox:new', now + 86400000));
});

void test('Bedrock verification has actionable copy while arbitrary provider errors stay private', async () => {
  const pending = liveAssistantError(
    new Error(
      'Your account is currently being verified. private provider detail',
    ),
  );
  assert.equal(pending.status, 503);
  assert.equal(pending.headers.get('cache-control'), 'no-store');
  const message = (await pending.json()).error;
  assert.match(message, /AWS is still verifying/);
  assert.doesNotMatch(message, /private provider detail/);
  const generic = await liveAssistantError(
    new Error('secret upstream detail'),
  ).json();
  assert.match(generic.error, /Live AI is unavailable/);
  assert.doesNotMatch(generic.error, /secret upstream detail/);
});
