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
export const runtime = 'nodejs';
const active = new Set<string>();
const recent = new Map<string, number>();
let callsToday = 0;
let day = '';
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
  try {
    const options = parseDemoOptions(body);
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
    const mode = assistantMode();
    if (mode !== 'mock') {
      if (!state)
        return Response.json(
          { error: 'Start a demo session first.' },
          { status: 401 },
        );
      const today = new Date().toISOString().slice(0, 10);
      if (day !== today) {
        day = today;
        callsToday = 0;
        recent.clear();
      }
      if (
        active.has(token) ||
        active.size >= 3 ||
        Date.now() - (recent.get(token) ?? 0) < 3000 ||
        callsToday >= 200
      )
        return Response.json(
          {
            error:
              'The demo assistant is busy or has reached its daily limit. Try again later.',
          },
          { status: 429 },
        );
      active.add(token);
      recent.set(token, Date.now());
      callsToday++;
      try {
        const reply = await strandsReply(
          body.message,
          await getSessionDemo(state),
          state,
          mode,
        );
        return Response.json(reply, {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch {
        return Response.json(
          {
            error:
              'Live AI is unavailable. No transfer was created. The deterministic dashboard remains available.',
          },
          { status: 503 },
        );
      } finally {
        active.delete(token);
      }
    }
    const demo = state ? await getSessionDemo(state) : null;
    const assistant =
      state && demo
        ? new MockAssistant(
            {
              source: demo.snapshot.source,
              getSnapshot: async () => demo.snapshot,
            },
            buildSessionPlan(state, demo.snapshot),
            true,
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
