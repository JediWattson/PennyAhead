import type { MonitorConfig, BankSnapshot } from '../contracts.ts';
import { FixtureBankProvider, DEMO_NOW, DEMO_OWNER_ID } from './fixtures.ts';
import { buildFundingPlan } from './funding.ts';
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
      const snapshot = await load(state.config);
      const plan = buildFundingPlan(
        DEMO_OWNER_ID,
        snapshot,
        state.config,
        DEMO_NOW,
      );
      store.complete(state, plan, null, now);
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
