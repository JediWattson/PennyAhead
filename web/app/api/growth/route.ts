import { requireInvite } from '../../../lib/server/invite-access.ts';
import { getMonitorStore } from '../../../lib/server/monitor-store.ts';
import { sessionToken, jsonResponse } from '../../../lib/server/monitor-api.ts';
import { getSessionDemo } from '../../../lib/server/session-bank.ts';
import {
  buildGrowthPlan,
  parseGrowthInputs,
} from '../../../lib/server/growth-plan.ts';
import { growthContext } from '../../../lib/growth-context.ts';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  const state = getMonitorStore().read(sessionToken(request));
  if (!state)
    return jsonResponse(
      { error: 'Start a demo session before planning.' },
      401,
    );
  try {
    const body = await request.json();
    const inputs = parseGrowthInputs(body?.inputs);
    const demo = await getSessionDemo(state);
    if (body.context !== growthContext(demo, state.config.savingsMinimumCents))
      return jsonResponse(
        { error: 'Your balances or settings changed. Refresh the plan.' },
        409,
      );
    return jsonResponse(
      buildGrowthPlan(demo, inputs, state.config.savingsMinimumCents),
    );
  } catch {
    return jsonResponse(
      {
        error: 'Check the plan amounts and 2026 Roth details, then try again.',
      },
      400,
    );
  }
}
