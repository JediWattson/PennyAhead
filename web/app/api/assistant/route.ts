import {
  buildGrowthPlan,
  parseGrowthInputs,
} from '../../../lib/server/growth-plan.ts';
import { parseChatHistory } from '../../../lib/chat-history.ts';
import { growthContext } from '../../../lib/growth-context.ts';
import { requireInvite } from '../../../lib/server/invite-access.ts';
import { bankProvider, DEMO_OWNER_ID } from '../../../lib/server/fixtures.ts';
import { MockAssistant } from '../../../lib/server/mock-assistant.ts';
import { parseDemoOptions } from '../../../lib/server/demo-forecast.ts';
import { parseMonitorConfig } from '../../../lib/server/funding.ts';
import { getMonitorStore } from '../../../lib/server/monitor-store.ts';
import { sessionToken } from '../../../lib/server/monitor-api.ts';
import { getSessionDemo } from '../../../lib/server/session-bank.ts';
import { buildSessionPlan } from '../../../lib/server/transfer-policy.ts';
import {
  assistantMode,
  strandsReply,
} from '../../../lib/server/strands-assistant.ts';
import {
  assistantAccess,
  assistantBusyResponse,
  liveAssistantError,
} from '../../../lib/server/assistant-access.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send a JSON message.' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('message' in body) ||
    typeof body.message !== 'string' ||
    !body.message.trim() ||
    body.message.length > 1000
  ) {
    return Response.json(
      { error: 'Enter a message between 1 and 1,000 characters.' },
      { status: 400 },
    );
  }
  // No owner/account IDs are accepted from the browser or the assistant.
  let history;
  try {
    history = parseChatHistory('history' in body ? body.history : undefined);
  } catch {
    return Response.json(
      { error: 'Chat history is invalid or too long. Start a new chat.' },
      { status: 400 },
    );
  }
  try {
    const options = parseDemoOptions(body);
    const growth =
      'growth' in body ? parseGrowthInputs(body.growth) : undefined;
    const monitoring =
      'monitoring' in body
        ? parseMonitorConfig({ ...(body.monitoring as object), ...options })
        : undefined;
    const token = sessionToken(request);
    const state = token ? getMonitorStore().read(token) : null;
    if (request.headers.has('authorization') && !state)
      return Response.json(
        { error: 'Demo session expired; reload the page.' },
        { status: 401 },
      );
    const demo = state ? await getSessionDemo(state) : null;
    if (
      growth &&
      (!state ||
        !demo ||
        !('growthContext' in body) ||
        body.growthContext !==
          growthContext(demo, state.config.savingsMinimumCents))
    )
      return Response.json(
        {
          error:
            'Your balances or plan settings changed. Wait for the plan to refresh, then ask again.',
        },
        { status: 409 },
      );
    const mode = assistantMode();
    if (mode !== 'mock') {
      if (!state)
        return Response.json(
          { error: 'Start a demo session first.' },
          { status: 401 },
        );
      const release = assistantAccess.acquire(`demo:${token}`);
      if (!release) return assistantBusyResponse();
      try {
        const reply = await strandsReply(
          body.message,
          demo!,
          state,
          mode,
          undefined,
          growth,
          history,
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
    const assistant =
      state && demo
        ? new MockAssistant(
            {
              source: demo.snapshot.source,
              getSnapshot: async () => demo.snapshot,
            },
            buildSessionPlan(state, demo.snapshot),
            true,
            undefined,
            growth
              ? buildGrowthPlan(demo, growth, state.config.savingsMinimumCents)
              : undefined,
          )
        : new MockAssistant(bankProvider);
    return Response.json(
      await assistant.reply(
        DEMO_OWNER_ID,
        body.message,
        state?.config ?? options,
        state?.config ?? monitoring,
      ),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch {
    return Response.json(
      { error: 'Invalid demo scenario or bill corrections.' },
      { status: 400 },
    );
  }
}
