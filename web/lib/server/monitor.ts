import type { MonitorConfig, BankSnapshot } from '../contracts.ts';
import { FixtureBankProvider, DEMO_OWNER_ID } from './fixtures.ts';
import { buildSessionPlan, transferEnvironment } from './transfer-policy.ts';
import { applySessionTransfers } from './session-bank.ts';
import {
  getMonitorStore,
  MonitorStore,
  MONITOR_INTERVAL_MS,
} from './monitor-store.ts';

export async function runMonitorTick(
  store: MonitorStore,
  now = Date.now(),
  load: (config: MonitorConfig) => Promise<BankSnapshot> = (config) =>
    new FixtureBankProvider(config.scenario).getSnapshot(DEMO_OWNER_ID),
) {
  for (const state of store.due(now)) {
    try {
      const snapshot = applySessionTransfers(
        await load(state.config),
        state.transfers,
        state.generation,
      );
      const plan = buildSessionPlan(state, snapshot);
      const committed = store.complete(state, plan, null, now);
      if (committed && plan.status === 'proposed' && state.rule?.enabled) {
        const current = store.read(state.id, now)!;
        if (
          current.proposalId &&
          current.proposalStatus === 'open' &&
          current.rule &&
          plan.amountCents + current.rule.spentCents <= current.rule.capCents
        ) {
          store.approve(
            current,
            {
              proposalId: current.proposalId,
              revision: current.revision,
              amountCents: plan.amountCents,
              sourceAccountId: plan.sourceAccountId!,
              destinationAccountId: plan.destinationAccountId,
            },
            plan,
            transferEnvironment(),
            'automation',
            now,
          );
        }
      }
    } catch {
      store.complete(
        state,
        null,
        'The latest check failed. Previous proposals are unavailable until a successful check.',
        now,
      );
    }
  }
}

const runtime = globalThis as typeof globalThis & {
  pennyMonitorTimer?: ReturnType<typeof setInterval>;
};
export function startMonitor() {
  if (runtime.pennyMonitorTimer) return;
  const store = getMonitorStore();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMonitorTick(store);
    } catch {
      console.error('PennyAhead background monitor failed; it will retry.');
    } finally {
      running = false;
    }
  };
  void tick();
  runtime.pennyMonitorTimer = setInterval(() => {
    void tick();
  }, MONITOR_INTERVAL_MS);
  runtime.pennyMonitorTimer.unref();
}
