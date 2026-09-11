import { requireInvite } from '../../../../lib/server/invite-access.ts';
import {
  getSandboxObservations,
  parseSandboxInput,
  parseSandboxGrowthInput,
  sandboxErrorResponse,
  sandboxForecast,
} from '../../../../lib/server/sandbox-view.ts';
import {
  PLAID_DEMO_OWNER_ID,
  SandboxError,
} from '../../../../lib/server/plaid-bank.ts';
import { MockAssistant } from '../../../../lib/server/mock-assistant.ts';
import { buildGrowthPlan } from '../../../../lib/server/growth-plan.ts';
import {
  assistantMode,
  strandsReply,
} from '../../../../lib/server/strands-assistant.ts';
import {
  assistantAccess,
  assistantBusyResponse,
  liveAssistantError,
} from '../../../../lib/server/assistant-access.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => {
      throw new SandboxError('INVALID_INPUT', 400);
    });
    const planInput =
      body && typeof body === 'object' && 'growth' in body
        ? parseSandboxGrowthInput(body, true)
        : null;
    const input = planInput ?? parseSandboxInput(body, true);
    const observation = getSandboxObservations().read(input.snapshotId);
    let demo;
    try {
      demo = sandboxForecast(observation, input.corrections);
    } catch {
      throw new SandboxError('INVALID_INPUT', 400);
    }
    const mode = assistantMode();
    if (mode !== 'mock') {
      const release = assistantAccess.acquire(`sandbox:${observation.id}`);
      if (!release) return assistantBusyResponse();
      try {
        const reply = await strandsReply(
          input.message,
          demo,
          null,
          mode,
          undefined,
          planInput?.growth,
        );
        return Response.json(reply, {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return liveAssistantError(error);
      } finally {
        release();
      }
    }
    const bank = {
      source: demo.snapshot.source,
      getSnapshot: async (ownerId: string) => {
        if (ownerId !== PLAID_DEMO_OWNER_ID)
          throw new SandboxError('UNKNOWN_OWNER', 403);
        return demo.snapshot;
      },
    };
    const assistant = new MockAssistant(
      bank,
      undefined,
      true,
      demo.forecast,
      planInput ? buildGrowthPlan(demo, planInput.growth, 0) : undefined,
    );
    return Response.json(
      await assistant.reply(PLAID_DEMO_OWNER_ID, input.message, demo),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
