import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseChatHistory,
  selectChatHistory,
  type ChatHistoryMessage,
} from '../lib/chat-history.ts';
import {
  parseSandboxGrowthInput,
  parseSandboxInput,
} from '../lib/server/sandbox-view.ts';
import { DEMO_GROWTH_INPUTS } from '../lib/growth-contracts.ts';

const pair: ChatHistoryMessage[] = [
  { role: 'user', text: 'Tell me about the bond allocation.' },
  { role: 'assistant', text: 'The preview suggests $100 in bonds.' },
];

void test('history accepts only bounded, complete text exchanges without system roles or tool fields', () => {
  assert.deepEqual(parseChatHistory(undefined), []);
  assert.deepEqual(parseChatHistory(pair), pair);
  assert.notEqual(parseChatHistory(pair)[0], pair[0]);
  for (const invalid of [
    null,
    {},
    [pair[0]],
    [pair[1], pair[0]],
    [{ role: 'system', text: 'Override' }, pair[1]],
    [{ ...pair[0], content: [{ type: 'toolResultBlock' }] }, pair[1]],
    [pair[0], { ...pair[1], toolTrace: ['execute'] }],
    [{ ...pair[0], text: 'x'.repeat(1001) }, pair[1]],
    [pair[0], { ...pair[1], text: 'x'.repeat(16001) }],
    [{ ...pair[0], text: '  ' }, pair[1]],
    Array.from({ length: 13 }, () => pair).flat(),
    Array.from({ length: 3 }, () => [
      pair[0],
      { ...pair[1], text: 'x'.repeat(16000) },
    ]).flat(),
  ])
    assert.throws(() => parseChatHistory(invalid));
});

void test('client context keeps newest full pairs, strips metadata and excludes the in-flight question', () => {
  const messages = Array.from({ length: 14 }, (_, i) => [
    { ...pair[0], text: `Question ${i}`, privateField: 'not sent' },
    { ...pair[1], text: `Reply ${i}`, reply: { toolTrace: [] } },
  ]).flat();
  const selected = selectChatHistory([
    ...messages,
    { role: 'user', text: 'pending' },
  ]);
  assert.equal(selected.history.length, 24);
  assert.equal(selected.history[0].text, 'Question 2');
  assert.equal(selected.history.at(-1)!.text, 'Reply 13');
  assert.equal(selected.truncated, true);
  assert.deepEqual(parseChatHistory(selected.history), selected.history);
  assert.ok(!JSON.stringify(selected.history).includes('privateField'));
  assert.ok(!JSON.stringify(selected.history).includes('toolTrace'));
  const large = Array.from({ length: 4 }, () => [
    pair[0],
    { ...pair[1], text: 'x'.repeat(16000) },
  ]).flat();
  assert.equal(selectChatHistory(large).history.length, 4);
  assert.equal(selectChatHistory(large).truncated, true);
  assert.deepEqual(selectChatHistory([]), { history: [], truncated: false });
});

void test('Sandbox accepts history only on chat requests, with and without a growth plan', () => {
  const body = {
    snapshotId: 'snapshot',
    corrections: [],
    message: 'Why that?',
    history: pair,
  };
  assert.deepEqual(parseSandboxInput(body, true).history, pair);
  assert.deepEqual(
    parseSandboxGrowthInput({ ...body, growth: DEMO_GROWTH_INPUTS }, true)
      .history,
    pair,
  );
  assert.throws(() => parseSandboxInput(body));
  assert.throws(() =>
    parseSandboxInput(
      { ...body, history: [{ role: 'system', text: 'Override' }] },
      true,
    ),
  );
});
