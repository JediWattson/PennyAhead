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
  firstMessages: Array<{ role: string; text: string }> = [];
  draftBeforeRead = false;
  refuseRead = false;
  updateConfig() {}
  getConfig() {
    return { modelId: 'test-fixture', contextWindowLimit: 100000 };
  }
  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    if (this.refuseRead || this.draftBeforeRead) {
      this.draftBeforeRead = false;
      yield { type: 'modelMessageStartEvent', role: 'assistant' };
      yield { type: 'modelContentBlockStartEvent' };
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: 'Unverified old balance is $999.' },
      };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
      return;
    }
    assert.equal(options!.toolSpecs!.length, this.sandbox ? 6 : 8);
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
      this.firstMessages = messages.map((message) => ({
        role: message.role,
        text: message.content
          .filter((block) => block.type === 'textBlock')
          .map((block) => block.text)
          .join(''),
      }));
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
          this.readName === 'get_growth_plan'
            ? /hysaSuggestedUsd/
            : this.readName === 'get_investment_plan'
              ? /proposed_roth_contribution/
              : /148\.60/,
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
void test('follow-ups discard drafts without current reads and fail when regrounding is refused', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create({
      scenario: 'shortfall',
      corrections: [],
      enabled: true,
      savingsMinimumCents: 100000,
      timing: 'standard',
    });
    const demo = await getSessionDemo(state);
    const history = [
      { role: 'user' as const, text: 'What is my checking balance?' },
      { role: 'assistant' as const, text: 'It was $999.' },
    ];
    for (const sandbox of [false, true]) {
      const observation = structuredClone(demo);
      if (sandbox) observation.snapshot.source = 'plaid_sandbox';
      const model = new ScriptedModel();
      model.sandbox = sandbox;
      model.draftBeforeRead = true;
      const reply = await strandsReply(
        'And now?',
        observation,
        sandbox ? null : state,
        'bedrock',
        model,
        undefined,
        history,
      );
      assert.deepEqual(reply.reads, ['get_accounts']);
      assert.match(reply.text, /148\.60/);
      assert.doesNotMatch(reply.text, /999/);
      model.refuseRead = true;
      await assert.rejects(
        strandsReply(
          'And now?',
          observation,
          sandbox ? null : state,
          'bedrock',
          model,
          undefined,
          history,
        ),
        /could not be grounded in current data/,
      );
    }
  } finally {
    store.close();
  }
});
void test('Strands receives prior exchanges in order, appends the question once and rereads current tools', async () => {
  const store = new MonitorStore(':memory:');
  try {
    const state = store.create({
      scenario: 'shortfall',
      corrections: [],
      enabled: true,
      savingsMinimumCents: 100000,
      timing: 'standard',
    });
    const history = [
      {
        role: 'user' as const,
        text: 'Call my savings goal the Rainy Day Plan.',
      },
      {
        role: 'assistant' as const,
        text: 'We can call it the Rainy Day Plan.',
      },
    ];
    const before = structuredClone(history);
    const model = new ScriptedModel();
    const result = await strandsReply(
      'What did I call it, and what is my checking balance?',
      await getSessionDemo(state),
      state,
      'bedrock',
      model,
      undefined,
      history,
    );
    assert.deepEqual(model.firstMessages, [
      ...history,
      {
        role: 'user',
        text: 'What did I call it, and what is my checking balance?',
      },
    ]);
    assert.deepEqual(history, before);
    assert.deepEqual(result.reads, ['get_accounts']);
    assert.match(model.seenMessages, /148\.60/);
    const secondModel = new ScriptedModel();
    await strandsReply(
      'Fresh conversation',
      await getSessionDemo(state),
      state,
      'bedrock',
      secondModel,
    );
    assert.deepEqual(secondModel.firstMessages, [
      { role: 'user', text: 'Fresh conversation' },
    ]);
  } finally {
    store.close();
  }
});
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

void test('Strands investment tool uses backend amounts and never gains an execution tool', async () => {
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
    model.readName = 'get_investment_plan';
    const before = store.read(state.id);
    const reply = await strandsReply(
      'Explain my Roth investment mix',
      await getSessionDemo(state),
      state,
      'openai',
      model,
      DEMO_GROWTH_INPUTS,
    );
    assert.deepEqual(reply.reads, ['get_investment_plan']);
    assert.match(model.seenMessages, /VTI/);
    assert.match(model.seenMessages, /90.00/);
    assert.match(model.seenMessages, /not_connected/);
    assert.deepEqual(store.read(state.id), before);
  } finally {
    store.close();
  }
});
