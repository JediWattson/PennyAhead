import { requireInvite } from '../../../lib/server/invite-access.ts';
import { getMonitorStore } from '../../../lib/server/monitor-store.ts';
import {
  sessionToken,
  jsonResponse,
  monitorView,
} from '../../../lib/server/monitor-api.ts';
import {
  buildSessionPlan,
  parseApproval,
  transferEnvironment,
} from '../../../lib/server/transfer-policy.ts';
import { getSessionDemo } from '../../../lib/server/session-bank.ts';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  const store = getMonitorStore();
  const id = sessionToken(request);
  const state = store.read(id);
  if (!state)
    return jsonResponse({ error: 'Demo session not found or expired.' }, 404);
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object')
      throw new Error('Choose a transfer action');
    switch (body.action) {
      case 'approve': {
        const input = parseApproval(body);
        const demo = await getSessionDemo(state);
        store.approve(
          state,
          input,
          buildSessionPlan(state, demo.snapshot),
          transferEnvironment(),
        );
        break;
      }
      case 'decline':
        if (
          typeof body.proposalId !== 'string' ||
          !store.decline(id, body.proposalId)
        )
          throw new Error('This proposal is no longer available');
        break;
      case 'complete_simulation':
      case 'fail_simulation':
        if (typeof body.transferId !== 'string')
          throw new Error('Select a transfer');
        store.settleSimulation(
          id,
          body.transferId,
          body.action === 'complete_simulation' ? 'completed' : 'failed',
        );
        break;
      case 'enable_rule':
        if (body.authorize !== true || typeof body.capCents !== 'number')
          throw new Error('Explicitly authorize the rule and its cap');
        store.configureRule(id, body.capCents);
        break;
      case 'revoke_rule':
        store.configureRule(id, null);
        break;
      case 'reset_simulation':
        store.reset(id);
        break;
      default:
        throw new Error('Unknown transfer action');
    }
    return jsonResponse(await monitorView(store.read(id)!));
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'The transfer action could not be completed.',
      },
      409,
    );
  }
}
