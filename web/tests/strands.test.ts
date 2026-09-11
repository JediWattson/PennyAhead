import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Model,
  type ModelStreamEvent,
  type Message,
  type StreamOptions,
} from '@strands-agents/sdk';
import { DEMO_GROWTH_INPUTS } from '../lib/growth-contracts.ts';
import { strandsReply } from '../lib/server/strands-assistant.ts';
import { MonitorStore } from '../lib/server/monitor-store.ts';
import { getSessionDemo } from '../lib/server/session-bank.ts';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { sandboxForecast } from '../lib/server/sandbox-view.ts';
import { PLAID_DEMO_OWNER_ID } from '../lib/server/plaid-bank.ts';
import type { AssistantReply } from '../lib/contracts.ts';
import { buildGrowthPlan } from '../lib/server/growth-plan.ts';
import {
  assistantEvidence,
  growthPlanEvidence,
} from '../lib/server/assistant-evidence.ts';

void test('model evidence formats nested cent amounts without changing application data', () => {
  const value = {
    rothSuggestedCents: 25000,
    room: { remainingCents: null },
    deposits: [{ amountCents: 50000 }, { amountCents: -4275 }],
    horizonDays: 30,
  };
  assert.deepEqual(assistantEvidence(value), {
    rothSuggestedUsd: '$250.00',
    room: { remainingUsd: null },
    deposits: [{ amountUsd: '$500.00' }, { amountUsd: '-$42.75' }],
    horizonDays: 30,
  });
  assert.equal(value.rothSuggestedCents, 25000);
  assert.throws(
    () => assistantEvidence({ amountCents: 1.5 }),
    /safe integer cents/,
  );
});
class ScriptedModel extends Model {
  calls = 0;
  invalidInput = false;
  readName: AssistantReply['reads'][number] = 'get_accounts';
  sandbox = false;
  seenMessages = '';
  updateConfig() {}
  getConfig() {
    return { modelId: 'test-fixture', contextWindowLimit: 100000 };
  }
  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    assert.equal(options!.toolSpecs!.length, this.sandbox ? 5 : 7);
    if (this.sandbox) {
      assert(
        !options!.toolSpecs!.some((t) =>
          /get_funding_proposal|check_transfer_timing|compare_funding_accounts/.test(
            t.name,
          ),
        ),
      );
      assert.match(
        JSON.stringify(options!.systemPrompt),
        /Plaid Sandbox provider-generated/,
      );
      assert.match(
        JSON.stringify(options!.systemPrompt),
        /There is no approval card/,
      );
    }
    assert(
      options!.toolSpecs!.every((t) => !/approve|execute|settle/.test(t.name)),
    );
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (this.calls++ === 0) {
      yield {
        type: 'modelContentBlockStartEvent',
        start: {
          type: 'toolUseStart',
          name: this.readName,
          toolUseId: 'test-read',
        },
      };
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'toolUseInputDelta',
          input: this.invalidInput ? '{"ownerId":"other"}' : '{}',
        },
      };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
    } else {
      const serialized = JSON.stringify(messages);
      this.seenMessages = serialized;
      if (!this.invalidInput && !this.sandbox)
        assert.match(
          serialized,
          this.readName === 'get_growth_plan' ? /hysaSuggestedUsd/ : /148\.60/,
        );
      yield { type: 'modelContentBlockStartEvent' };
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'textDelta',
          text: 'Synthetic checking has $148.60 available.',
        },
      };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
    }
  }
}
void test('real Strands loop dispatches a fixture model tool request and records only executed reads', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create({
      scenario: 'shortfall',
      corrections: [],
      enabled: true,
      savingsMinimumCents: 100000,
      timing: 'standard',
    });
    const model = new ScriptedModel();
    const result = await strandsReply(
      'What are my balances?',
      await getSessionDemo(state),
      state,
      'openai',
      model,
    );
    assert.equal(model.calls, 2);
    assert.deepEqual(result.reads, ['get_accounts']);
    assert.deepEqual(result.toolTrace, [
      { name: 'get_accounts', status: 'completed' },
    ]);
    assert.equal(store.read(state.id)!.transfers.length, 0);
    model.calls = 0;
    model.invalidInput = true;
    const invalid = await strandsReply(
      'Read another owner',
      await getSessionDemo(state),
      state,
      'openai',
      model,
    );
    assert.deepEqual(invalid.reads, []);
    assert.deepEqual(invalid.toolTrace, []);
  } finally {
    store.close();
  }
});

void test('Sandbox Strands tools read the displayed observation and exact backend plan without synthetic transfer tools', async () => {
  const snapshot = await new FixtureBankProvider('growth').getSnapshot(
    DEMO_OWNER_ID,
  );
  snapshot.source = 'plaid_sandbox';
  snapshot.accounts.forEach((account) => {
    account.ownerId = PLAID_DEMO_OWNER_ID;
  });
  snapshot.accounts[0].availableCents = 410000;
  const before = structuredClone(snapshot);
  const demo = sandboxForecast({
    id: 'bedrock-fixture',
    snapshot,
    evaluatedAt: DEMO_NOW,
    createdAt: Date.parse(DEMO_NOW),
  });
  for (const readName of [
    'get_accounts',
    'get_growth_plan',
    'get_bill_suggestion',
  ] as const) {
    const model = new ScriptedModel();
    model.sandbox = true;
    model.readName = readName;
    const result = await strandsReply(
      'Explain the displayed data',
      demo,
      null,
      'bedrock',
      model,
      DEMO_GROWTH_INPUTS,
    );
    assert.equal(result.provider, 'bedrock');
    assert.equal(result.source, 'plaid_sandbox');
    assert.deepEqual(result.toolTrace, [
      { name: readName, status: 'completed' },
    ]);
    const expected =
      readName === 'get_accounts'
        ? snapshot.accounts
        : readName === 'get_growth_plan'
          ? growthPlanEvidence(buildGrowthPlan(demo, DEMO_GROWTH_INPUTS, 0))
              .currentCashPlan
          : demo.billSuggestion;
    assert(
      model.seenMessages.includes(
        JSON.stringify(JSON.stringify(assistantEvidence(expected))).slice(
          1,
          -1,
        ),
      ),
    );
    assert.deepEqual(snapshot, before);
  }
  const model = new ScriptedModel();
  model.sandbox = true;
  model.invalidInput = true;
  const denied = await strandsReply(
    'Read a different owner',
    demo,
    null,
    'bedrock',
    model,
  );
  assert.deepEqual(denied.toolTrace, []);
  assert.deepEqual(snapshot, before);
});

void test('Strands growth tool reads the same backend allocation and cannot mutate the ledger', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create({
      scenario: 'growth',
      corrections: [],
      enabled: true,
      savingsMinimumCents: 100000,
      timing: 'standard',
    });
    const model = new ScriptedModel();
    model.readName = 'get_growth_plan';
    const reply = await strandsReply(
      'How much can I save or invest?',
      await getSessionDemo(state),
      state,
      'openai',
      model,
      DEMO_GROWTH_INPUTS,
    );
    assert.deepEqual(reply.reads, ['get_growth_plan']);
    assert.deepEqual(reply.toolTrace, [
      { name: 'get_growth_plan', status: 'completed' },
    ]);
    assert.equal(store.read(state.id)!.transfers.length, 0);
  } finally {
    store.close();
  }
});
