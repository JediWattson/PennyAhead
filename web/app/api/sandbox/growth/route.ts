import { requireInvite } from '../../../../lib/server/invite-access.ts';
import { buildGrowthPlan } from '../../../../lib/server/growth-plan.ts';
import {
  getSandboxObservations,
  parseSandboxGrowthInput,
  sandboxErrorResponse,
  sandboxForecast,
} from '../../../../lib/server/sandbox-view.ts';
import { SandboxError } from '../../../../lib/server/plaid-bank.ts';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  try {
    const input = parseSandboxGrowthInput(
      await request.json().catch(() => {
        throw new SandboxError('INVALID_INPUT', 400);
      }),
    );
    const observation = getSandboxObservations().read(input.snapshotId);
    let demo;
    try {
      demo = sandboxForecast(observation, input.corrections);
    } catch {
      throw new SandboxError('INVALID_INPUT', 400);
    }
    return Response.json(buildGrowthPlan(demo, input.growth, 0), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
