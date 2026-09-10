import type { DemoForecast } from './contracts.ts';

/** Optimistic version check only; all balances are independently loaded by the server. */
export function growthContext(demo: DemoForecast, savingsMinimumCents: number) {
  return JSON.stringify({
    scenario: demo.scenario,
    corrections: demo.corrections,
    snapshot: demo.snapshot,
    savingsMinimumCents,
  });
}
