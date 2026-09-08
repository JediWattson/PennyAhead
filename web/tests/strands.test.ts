import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Model,
  type ModelStreamEvent,
  type Message,
  type StreamOptions,
} from '@strands-agents/sdk';
import { strandsReply } from '../lib/server/strands-assistant.ts';
import { MonitorStore } from '../lib/server/monitor-store.ts';
import { getSessionDemo } from '../lib/server/session-bank.ts';
class ScriptedModel extends Model {
  calls = 0;
  invalidInput = false;
  updateConfig() {}
  getConfig() {
    return { modelId: 'test-fixture', contextWindowLimit: 100000 };
  }
  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    assert.equal(options!.toolSpecs!.length, 6);
    assert(
      options!.toolSpecs!.every((t) => !/approve|execute|settle/.test(t.name)),
    );
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (this.calls++ === 0) {
      yield {
        type: 'modelContentBlockStartEvent',
        start: {
          type: 'toolUseStart',
          name: 'get_accounts',
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
      if (!this.invalidInput) assert.match(serialized, /14860/);
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
